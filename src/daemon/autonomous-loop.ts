/**
 * Fleet autonomous loop — the execution layer that makes Code Buddy run
 * continuously and (by default) for free.
 *
 * One `tick()`:
 *   1. advertise presence (active),
 *   2. pick the next auto-claimable task (never `critical` — that needs Patrice),
 *   3. claim it,
 *   4. choose the model tier (LOCAL/$0 by default; escalate only on policy),
 *   5. run the injected executor,
 *   6. on success → complete + worklog; on failure → release + worklog (so the
 *      task is retryable, never stuck); always return presence to idle.
 *
 * Safety is structural:
 *   - `critical` tasks are excluded by {@link FleetColabStore.nextClaimable}.
 *   - a kill-switch (`enabled`) short-circuits the whole tick.
 *   - the executor is injected, so the loop logic is testable without real
 *     inference and the dangerous part (what actually runs) is swappable.
 *
 * The loop never pushes git itself — claiming is advisory; cross-machine
 * arbitration stays "first to push wins" per the fleet protocol.
 */

import {
  chooseAutonomousModel,
  type AutonomousModelChoice,
  type ModelTierConfig,
  type ModelTierPolicy,
} from '../agent/model-tier.js';
import { beginFleetWork, isFleetSaturated } from '../fleet/fleet-load.js';
import type {
  ColabTask,
  ColabWorklogFileChange,
  FleetColabStore,
} from '../fleet/colab-store.js';
import { DEFAULT_COLAB_GOAL_MAX_TURNS, type ColabGoalJudge } from './colab-goal.js';
import * as fs from 'fs';
import * as path from 'path';
import { getCodeBuddyPath } from '../utils/codebuddy-home.js';
import { readJsonAtomicSync, writeJsonAtomicSync } from '../utils/atomic-write.js';

/** Read the persisted last-self-improve timestamp (ms). Best-effort → null. */
function readSelfImproveState(file: string): number | null {
  const data = readJsonAtomicSync<{ lastSelfImproveAt?: unknown } | null>(file, null, {
    mode: 0o600,
    isValid: (value): value is { lastSelfImproveAt?: unknown } => Boolean(
      value && typeof value === 'object' && !Array.isArray(value),
    ),
  });
  const at = data?.lastSelfImproveAt;
  return typeof at === 'number' && Number.isFinite(at) ? at : null;
}

/** Persist the last-self-improve timestamp (ms). Best-effort, never-throws. */
function writeSelfImproveState(file: string, at: number): void {
  try {
    writeJsonAtomicSync(file, { lastSelfImproveAt: at }, { mode: 0o600 });
  } catch {
    /* the cooldown persistence is best-effort — never block the loop */
  }
}

export interface TaskExecutionResult {
  ok: boolean;
  summary: string;
  filesModified?: ColabWorklogFileChange[];
  elapsedSeconds?: number;
  error?: string;
  /**
   * Tail of the worker's actual output (capped). Goal-mode judges evaluate
   * this; absent for executors that don't capture output (judge falls back
   * to `summary`).
   */
  output?: string;
}

export type TaskExecutor = (
  task: ColabTask,
  model: AutonomousModelChoice,
) => Promise<TaskExecutionResult>;

/**
 * Idle-time self-improvement hook. Runs ONE bounded improvement cycle and reports
 * whether it kept anything. Injected so the loop stays testable and the heavy
 * engine is swappable; the default (lazy) hook runs the tool-improvement engine.
 */
export type SelfImproveHook = () => Promise<{ applied: boolean; detail: string }>;

/**
 * Default idle self-improvement: author tools for any seed scenario NOT yet in the
 * evolutionary archive (so it stops once the seed benchmark is covered, and the
 * bound persists across restarts). Auto-apply; gated by the caller on idle +
 * CODEBUDDY_SELF_IMPROVE + cooldown.
 */
async function defaultSelfImproveHook(): Promise<{ applied: boolean; detail: string }> {
  // Research first: when CODEBUDDY_RESEARCH_TOPICS is set, study scientific publications into
  // the collective knowledge graph (one topic per idle cycle). The self-improvement drafters
  // then recall this knowledge — "with an AI knowledge base, Code Buddy self-improves more
  // easily". Opt-in, bounded, never-throws.
  const { defaultAutoResearchIngest } = await import('../research/auto-ingest.js');
  const research = await defaultAutoResearchIngest();
  if (research.applied) return research;

  const { EvolutionaryArchive } = await import('../agent/self-improvement/evolutionary-archive.js');
  const archived = new Set(new EvolutionaryArchive().list().map((e) => e.targetScenarioId));

  // Tools first.
  const { ToolImprovementEngine } = await import('../agent/self-improvement/tool-engine.js');
  const { LlmToolProposer } = await import('../agent/self-improvement/llm-tool-proposer.js');
  const { SEED_TOOL_SCENARIOS } = await import('../agent/self-improvement/tool-benchmark.js');
  const uncoveredTools = SEED_TOOL_SCENARIOS.filter((s) => !archived.has(s.id));
  if (uncoveredTools.length > 0) {
    const r = await new ToolImprovementEngine({
      scenarios: uncoveredTools,
      proposer: new LlmToolProposer(),
      autonomy: 'auto-apply',
    }).runCycle();
    if (r.applied) return { applied: true, detail: `authored tool ${r.gate?.appliedRef}` };
  }

  // Then skills.
  const { SkillImprovementEngine } = await import('../agent/self-improvement/skill-engine.js');
  const { LlmSkillProposer } = await import('../agent/self-improvement/skill-proposer.js');
  const { SEED_SKILL_SCENARIOS } = await import('../agent/self-improvement/skill-benchmark.js');
  const uncoveredSkills = SEED_SKILL_SCENARIOS.filter((s) => !archived.has(s.id));
  if (uncoveredSkills.length > 0) {
    const r = await new SkillImprovementEngine({
      scenarios: uncoveredSkills,
      proposer: new LlmSkillProposer(),
      autonomy: 'auto-apply',
    }).runCycle();
    if (r.applied) return { applied: true, detail: `authored skill ${r.gate?.appliedRef}` };
  }

  return { applied: false, detail: 'all seed tool + skill scenarios already covered (or no proposal)' };
}

function resolveGoalMaxTurns(raw: unknown): number {
  return typeof raw === 'number' && Number.isSafeInteger(raw) && raw > 0
    ? raw
    : DEFAULT_COLAB_GOAL_MAX_TURNS;
}

function resolveGoalTurnsUsed(raw: unknown): number {
  return typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0 ? raw : 0;
}

export interface AutonomousLoopConfig {
  store: FleetColabStore;
  tierConfig: ModelTierConfig;
  executor: TaskExecutor;
  policy?: ModelTierPolicy;
  /** Kill-switch — when it returns false the tick is a no-op. Default: always on. */
  enabled?: () => boolean;
  /**
   * Judge for `goalMode` tasks (Hermes kanban goal-mode parity). When absent,
   * goal-mode tasks complete like plain tasks (no judge gate).
   */
  goalJudge?: ColabGoalJudge;
  /**
   * Idle-time self-improvement. When the queue is empty AND
   * `CODEBUDDY_SELF_IMPROVE=true`, run one bounded improvement cycle (cooldown-
   * gated). Injected for tests; defaults to the tool-improvement engine.
   */
  selfImprove?: SelfImproveHook;
  /** Minimum ms between idle self-improvement cycles (default 15 min). */
  selfImproveCooldownMs?: number;
  /** Clock for the cooldown (tests). Default Date.now. */
  now?: () => number;
  /**
   * Where the last-self-improve timestamp is persisted so the cooldown
   * SURVIVES a daemon restart. Without persistence, `lastSelfImproveAt`
   * reset to -Infinity on every boot and a crash-looping daemon fired an
   * unbounded LLM self-improve cycle on each start. Default under the
   * CodeBuddy home; injectable for hermetic tests.
   */
  selfImproveStatePath?: string;
}

export interface TickResult {
  outcome: 'disabled' | 'idle' | 'completed' | 'failed' | 'saturated' | 'goal_continue' | 'goal_blocked' | 'self_improved';
  taskId?: string;
  taskTitle?: string;
  model?: AutonomousModelChoice;
  detail?: string;
}

export class FleetAutonomousLoop {
  private readonly store: FleetColabStore;
  private readonly tierConfig: ModelTierConfig;
  private readonly executor: TaskExecutor;
  private readonly policy: ModelTierPolicy;
  private readonly enabled: () => boolean;
  // Per-task failure counts now live on the task itself (`ColabTask.attempts`,
  // persisted by FleetColabStore) so they survive daemon restarts and are visible
  // cross-machine. They feed {@link chooseAutonomousModel} for model-ladder
  // escalation AND the retry budget that dead-letters a hopeless task.
  private readonly goalJudge: ColabGoalJudge | undefined;
  private readonly selfImprove: SelfImproveHook;
  private readonly selfImproveCooldownMs: number;
  private readonly now: () => number;
  private readonly selfImproveStatePath: string;
  private lastSelfImproveAt: number;

  constructor(config: AutonomousLoopConfig) {
    this.store = config.store;
    this.tierConfig = config.tierConfig;
    this.executor = config.executor;
    this.policy = config.policy ?? {};
    this.enabled = config.enabled ?? (() => true);
    this.goalJudge = config.goalJudge;
    this.selfImprove = config.selfImprove ?? defaultSelfImproveHook;
    this.selfImproveCooldownMs = config.selfImproveCooldownMs ?? 15 * 60 * 1000;
    this.now = config.now ?? (() => Date.now());
    this.selfImproveStatePath =
      config.selfImproveStatePath ?? getCodeBuddyPath('self-improvement', 'idle-cooldown.json');
    // Restore the cooldown across restarts (see selfImproveStatePath docs).
    this.lastSelfImproveAt = readSelfImproveState(this.selfImproveStatePath) ?? Number.NEGATIVE_INFINITY;
  }

  /**
   * Idle hook: when the queue is empty and self-improvement is opted in, run one
   * bounded, cooldown-gated improvement cycle instead of sitting fully idle.
   * Double-gated (idle + CODEBUDDY_SELF_IMPROVE) and bounded (cooldown + the
   * engine no-ops once seed scenarios are covered). Never throws.
   */
  private async maybeSelfImprove(): Promise<TickResult> {
    if (process.env.CODEBUDDY_SELF_IMPROVE !== 'true') {
      this.store.updatePresence({ status: 'idle', currentTask: null });
      return { outcome: 'idle' };
    }
    const now = this.now();
    if (now - this.lastSelfImproveAt < this.selfImproveCooldownMs) {
      this.store.updatePresence({ status: 'idle', currentTask: null });
      return { outcome: 'idle', detail: 'self-improve on cooldown' };
    }
    this.lastSelfImproveAt = now;
    writeSelfImproveState(this.selfImproveStatePath, now); // survive a restart
    this.store.updatePresence({ status: 'active', currentTask: 'self-improvement' });
    const doneLoad = beginFleetWork('autonomy.task');
    try {
      const r = await this.selfImprove();
      return { outcome: r.applied ? 'self_improved' : 'idle', detail: r.detail };
    } catch (err) {
      return { outcome: 'idle', detail: `self-improve error: ${err instanceof Error ? err.message : String(err)}` };
    } finally {
      doneLoad();
      this.store.updatePresence({ status: 'idle', currentTask: null });
    }
  }

  /** Run a single autonomous tick. Never throws — failures are logged + reported. */
  async tick(): Promise<TickResult> {
    if (!this.enabled()) {
      return { outcome: 'disabled' };
    }

    // Saturation backpressure (fleet load balancing): when this peer is
    // at its configured capacity (CODEBUDDY_FLEET_MAX_CONCURRENCY), it
    // ABSTAINS from claiming. The colab queue is shared across machines,
    // so an idle peer's daemon wins the claim instead — utilization
    // spreads over the fleet without any new RPC. Opt-in: with no
    // configured capacity this never triggers.
    if (isFleetSaturated()) {
      this.store.updatePresence({ status: 'active' });
      return { outcome: 'saturated', detail: 'at capacity — leaving the queue to idle peers' };
    }

    this.store.updatePresence({ status: 'active' });

    // Zombie sweep (Hermes-kanban parity): reclaim crashed peers' expired claims
    // before picking work. Each reclaim counts against the task's retry budget,
    // dead-lettering a task that has been claimed-and-abandoned too many times.
    this.store.reclaimExpired();

    const next = this.store.nextClaimable();
    if (!next) {
      // No real work — use the idle moment for one bounded self-improvement
      // cycle (opt-in + cooldown), otherwise sit idle.
      return this.maybeSelfImprove();
    }

    // Claim. If another agent won the race between read and claim, treat it as
    // idle for this tick rather than crashing.
    let task: ColabTask;
    try {
      task = this.store.claim(next.id);
    } catch (err) {
      this.store.updatePresence({ status: 'idle', currentTask: null });
      return { outcome: 'idle', detail: err instanceof Error ? err.message : String(err) };
    }

    this.store.updatePresence({ status: 'active', currentTask: task.title });
    const failures = task.attempts ?? 0;
    const model = chooseAutonomousModel(
      this.tierConfig,
      { priority: task.priority, ...(failures > 0 ? { failures } : {}) },
      this.policy,
    );

    let result: TaskExecutionResult;
    const doneLoad = beginFleetWork('autonomy.task');
    try {
      result = await this.executor(task, model);
    } catch (err) {
      result = { ok: false, summary: 'executor threw', error: err instanceof Error ? err.message : String(err) };
    } finally {
      doneLoad();
    }

    if (result.ok) {
      // Goal-mode gate (Hermes kanban goal-mode): a successful attempt is not
      // enough — the judge must confirm the task's criteria are satisfied.
      if (task.goalMode && this.goalJudge) {
        const goalOutcome = await this.evaluateGoalModeTask(task, result, model);
        if (goalOutcome) return goalOutcome;
        // null → judge said done (or skipped): fall through to completion.
      }
      this.store.resetAttempts(task.id);
      this.store.completeTask(task.id, {
        summary: result.summary,
        filesModified: result.filesModified ?? [],
        ...(result.elapsedSeconds !== undefined ? { elapsedSeconds: result.elapsedSeconds } : {}),
      });
      this.store.updatePresence({ status: 'idle', currentTask: null });
      return { outcome: 'completed', taskId: task.id, taskTitle: task.title, model };
    }

    // Persist the failure (retry-budget counter — survives restarts, visible
    // cross-machine). The next attempt can escalate up the model ladder; once the
    // budget is exhausted the task is dead-lettered to `blocked` (the Review
    // column) instead of being released to spin forever.
    const { attempts, exhausted } = this.store.recordFailure(task.id);
    this.store.appendWorklog({
      agent: this.store.agentId,
      taskId: task.id,
      summary: `Autonomous attempt failed: ${result.summary}`,
      filesModified: [],
      issues: [result.error ?? 'unknown error'],
      nextSteps: exhausted
        ? [`retry budget (${attempts} attempts) exhausted — dead-lettered for human review`]
        : ['retry on a later tick or escalate to the strong model'],
    });
    if (exhausted) {
      this.store.blockTask(task.id, `Failed ${attempts}× (retry budget exhausted) — needs review`);
    } else {
      this.store.releaseTask(task.id);
    }
    this.store.updatePresence({ status: 'idle', currentTask: null });
    return {
      outcome: 'failed',
      taskId: task.id,
      taskTitle: task.title,
      model,
      ...(result.error ? { detail: result.error } : {}),
    };
  }

  /**
   * Goal-mode decision ladder. Returns a TickResult when the loop should NOT
   * complete the task (judge says continue / budget exhausted), or null when
   * the task may complete (judge done/skipped, or judge unreachable —
   * fail-open like the interactive Ralph loop).
   */
  private async evaluateGoalModeTask(
    task: ColabTask,
    result: TaskExecutionResult,
    model: AutonomousModelChoice,
  ): Promise<TickResult | null> {
    let verdict;
    try {
      verdict = await this.goalJudge!(task, result, model);
    } catch {
      return null; // fail-open: an unusable judge never blocks completion
    }
    if (verdict.verdict !== 'continue') return null;

    const maxTurns = resolveGoalMaxTurns(task.goalMaxTurns);
    const turnsUsed = resolveGoalTurnsUsed(task.goalTurnsUsed) + 1;

    if (turnsUsed >= maxTurns) {
      // Hermes rule: block for human review instead of spinning forever.
      const reason = `goal budget exhausted (${turnsUsed}/${maxTurns}) — judge: ${verdict.reason}`;
      this.store.recordGoalTurn(task.id, verdict.reason);
      this.store.blockTask(task.id, reason);
      this.store.appendWorklog({
        agent: this.store.agentId,
        taskId: task.id,
        summary: `Goal-mode blocked after ${turnsUsed}/${maxTurns} turns: ${verdict.reason}`,
        filesModified: result.filesModified ?? [],
        issues: [reason],
        nextSteps: ['human review: unblock, split, or complete the task manually'],
      });
      this.store.updatePresence({ status: 'idle', currentTask: null });
      return { outcome: 'goal_blocked', taskId: task.id, taskTitle: task.title, model, detail: verdict.reason };
    }

    // Under budget: persist the consumed turn + reason, release the task so a
    // later tick continues it with the continuation nudge. A judge "continue"
    // is NOT an executor failure — the model ladder must not escalate.
    this.store.recordGoalTurn(task.id, verdict.reason);
    this.store.appendWorklog({
      agent: this.store.agentId,
      taskId: task.id,
      summary: `Goal-mode turn ${turnsUsed}/${maxTurns} — judge: continue: ${verdict.reason}`,
      filesModified: result.filesModified ?? [],
      issues: [],
      nextSteps: ['continue on a later tick with the goal continuation nudge'],
    });
    this.store.releaseTask(task.id);
    this.store.updatePresence({ status: 'idle', currentTask: null });
    return { outcome: 'goal_continue', taskId: task.id, taskTitle: task.title, model, detail: verdict.reason };
  }
}
