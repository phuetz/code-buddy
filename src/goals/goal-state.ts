/**
 * Persistent session goals — the Ralph loop for Code Buddy.
 *
 * A goal is a free-form user objective that stays active across turns. After
 * each turn completes, a small judge call asks an auxiliary model "is this
 * goal satisfied by the assistant's last response?". If not, Code Buddy feeds
 * a continuation prompt back into the same session and keeps working until
 * the goal is done, the turn budget is exhausted, the user pauses/clears it,
 * or a real user message preempts the loop.
 *
 * Ported from Hermes Agent's goal system (hermes_cli/goals.py). Invariants:
 * - The continuation prompt is a plain user message — no system-prompt
 *   mutation, no toolset swap, prompt caching stays intact.
 * - Judge failures are fail-OPEN ("continue"): a broken judge must not wedge
 *   progress; the turn budget is the backstop.
 * - A real user message mid-loop preempts the continuation prompt; the judge
 *   re-runs after that turn.
 */

import { createHash, randomUUID } from 'node:crypto';
import type { GoalPlan } from './goal-decomposer.js';
import {
  formatGoalPlan,
  goalPlanToCriteria,
  normalizeGoalPlan,
} from './goal-decomposer.js';

export type GoalStatus = 'active' | 'paused' | 'done' | 'cleared';
export type GoalVerdict = 'done' | 'continue' | 'skipped';

export interface GoalState {
  /** Stable mission identity shared by the Intent Graph and Proof Ledger. */
  goalId: string;
  goal: string;
  status: GoalStatus;
  turnsUsed: number;
  maxTurns: number;
  createdAt: number;
  lastTurnAt: number;
  lastVerdict?: GoalVerdict;
  lastReason?: string;
  /** Why we auto-paused (budget exhausted, judge parse failures, interrupt). */
  pausedReason?: string;
  /** Judge-output parse failures in a row. API/transport errors don't count. */
  consecutiveParseFailures: number;
  /**
   * User-added criteria appended mid-loop via /subgoal. When non-empty both
   * the judge prompt and the continuation prompt include them. Defaults to
   * empty so old persisted state loads unchanged.
   */
  subgoals: string[];
  /**
   * Optional Hermes-style decomposition graph generated for complex goals.
   * Its acceptance criteria are fed to the judge alongside user-added
   * subgoals, while remaining separate so /subgoal stays a manual control.
   */
  goalPlan?: GoalPlan;
  /** True once an LLM planning attempt was made for this goal. */
  goalPlanAttempted?: boolean;
  /** Last planning failure, kept for status/debug without retrying forever. */
  goalPlanLastError?: string;
  /**
   * Dev-loop mode (set by /loop, not /goal). When true, the after-turn hook
   * gates a judge "done" behind an independent Verifier: the goal is only
   * accepted as done once the Verifier CONFIRMS. Off/absent ⇒ classic /goal
   * judge-only loop (unchanged). Requires a `verify` bridge from the host;
   * hosts without one (desktop/headless CLI) fall back to judge-only.
   */
  verifyGated?: boolean;
}

// ──────────────────────────────────────────────────────────────────────
// Constants & defaults
// ──────────────────────────────────────────────────────────────────────

export const DEFAULT_MAX_TURNS = 20;
export const DEFAULT_JUDGE_TIMEOUT_MS = 30_000;
// Judge output budget. The judge returns a one-line JSON verdict, but
// reasoning models burn tokens on hidden reasoning before emitting the
// visible JSON. Tight caps truncate the JSON and trip the auto-pause.
export const DEFAULT_JUDGE_MAX_TOKENS = 4096;
// Caps how much of the inputs we send to the judge.
export const JUDGE_GOAL_SNIPPET_CHARS = 2000;
export const JUDGE_SUBGOALS_SNIPPET_CHARS = 2000;
export const JUDGE_RESPONSE_SNIPPET_CHARS = 4000;
// After this many consecutive judge *parse* failures (empty output /
// non-JSON), the loop auto-pauses and points the user at the judge config.
// Guards against small models that can't follow the strict JSON contract.
export const MAX_CONSECUTIVE_PARSE_FAILURES = 3;

export const CONTINUATION_PROMPT_TEMPLATE =
  '[Continuing toward your standing goal]\n' +
  'Goal: {goal}\n\n' +
  'Continue working toward this goal. Take the next concrete step. ' +
  'If you believe the goal is complete, state so explicitly and stop. ' +
  'If you are blocked and need input from the user, say so clearly and stop.';

export const CONTINUATION_PROMPT_WITH_SUBGOALS_TEMPLATE =
  '[Continuing toward your standing goal]\n' +
  'Goal: {goal}\n\n' +
  'Additional criteria the user added mid-loop:\n' +
  '{subgoals_block}\n\n' +
  'Continue working toward the goal AND all additional criteria. Take ' +
  'the next concrete step. If you believe the goal and every ' +
  'additional criterion are complete, state so explicitly and stop. ' +
  'If you are blocked and need input from the user, say so clearly ' +
  'and stop.';

export const CONTINUATION_PROMPT_WITH_PLAN_TEMPLATE =
  '[Continuing toward your standing goal]\n' +
  'Goal: {goal}\n\n' +
  'Decomposition plan:\n' +
  '{goal_plan_block}\n\n' +
  '{manual_subgoals_block}' +
  'Continue working through the plan. Prefer ready tasks whose dependencies ' +
  'are already satisfied, keep independent lanes separate, and produce ' +
  'concrete evidence for every acceptance criterion. If you believe the goal ' +
  'and every criterion are complete, state so explicitly and stop. If you are ' +
  'blocked and need input from the user, say so clearly and stop.';

export const JUDGE_SYSTEM_PROMPT =
  "You are a strict judge evaluating whether an autonomous agent has " +
  "achieved a user's stated goal. You receive the goal text and the " +
  "agent's most recent response. Your only job is to decide whether " +
  'the goal is fully satisfied based on that response.\n\n' +
  'The response may begin with internal evidence metadata such as ' +
  '`[tool evidence: none]` or `[tool:<name> success]`. Treat those ' +
  'bracketed metadata lines as evidence annotations only. They are NOT ' +
  "part of the assistant's answer text for exact-answer goals; ignore " +
  'the metadata itself when comparing exact requested output. For ' +
  'side-effect goals, use the metadata and any following tool output to ' +
  'decide whether concrete evidence exists.\n\n' +
  'A goal is DONE only when:\n' +
  '- For answer-only or explanation goals, the response directly answers the requested question, OR\n' +
  '- The response clearly shows the final deliverable was produced, OR\n' +
  '- The response explains the goal is unachievable / blocked / needs ' +
  'user input (treat this as DONE with reason describing the block).\n\n' +
  'For goals that require external side effects such as creating, editing, ' +
  'moving, deleting, reading, or verifying files; running commands; calling ' +
  'tools; changing repository state; or producing artifacts, unsupported ' +
  'assistant claims are NOT evidence. Do not accept statements like "I ' +
  'created the file" or "I verified it" unless the response includes concrete ' +
  'evidence such as a tool result, command output, file contents excerpt, diff, ' +
  'test output, or artifact path backed by tool output. If a side-effect goal ' +
  'has no concrete evidence, return CONTINUE.\n\n' +
  'Otherwise the goal is NOT done — CONTINUE.\n\n' +
  'Reply ONLY with a single JSON object on one line:\n' +
  '{"done": <true|false>, "reason": "<one-sentence rationale>"}';

export const JUDGE_USER_PROMPT_TEMPLATE =
  'Goal:\n{goal}\n\n' +
  'Current time: {current_time}\n\n' +
  "Agent's most recent response is delimited by <response> tags. " +
  'Text outside those tags is prompt metadata, not part of the response:\n' +
  '<response>\n{response}\n</response>\n\n' +
  'Is the goal satisfied?';

export const JUDGE_USER_PROMPT_WITH_SUBGOALS_TEMPLATE =
  'Goal:\n{goal}\n\n' +
  'Additional criteria the user added mid-loop (all must also be ' +
  'satisfied for the goal to be DONE):\n{subgoals_block}\n\n' +
  'Current time: {current_time}\n\n' +
  "Agent's most recent response is delimited by <response> tags. " +
  'Text outside those tags is prompt metadata, not part of the response:\n' +
  '<response>\n{response}\n</response>\n\n' +
  'Decision: For each numbered criterion above, find concrete ' +
  "evidence in the agent's response that the criterion is " +
  "satisfied. Do not accept generic phrases like 'all requirements " +
  "met' or 'implying it was done' — require specific evidence (a " +
  'file contents excerpt, an output line, a command result). If ' +
  'ANY criterion lacks specific evidence in the response, the goal ' +
  'is NOT done — return CONTINUE.\n\n' +
  'Is the goal AND every additional criterion satisfied?';

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

export function truncateText(text: string, limit: number): string {
  if (!text) return '';
  if (text.length <= limit) return text;
  return text.slice(0, limit) + '… [truncated]';
}

/** Render subgoals as a numbered `- N. text` block. Empty string when none. */
export function renderSubgoalsBlock(subgoals: string[]): string {
  if (!subgoals.length) return '';
  return subgoals.map((text, i) => `- ${i + 1}. ${text}`).join('\n');
}

export function getGoalJudgeCriteria(state: Pick<GoalState, 'goalPlan' | 'subgoals'>): string[] {
  return [...goalPlanToCriteria(state.goalPlan), ...state.subgoals];
}

export function createGoalState(goal: string, maxTurns: number = DEFAULT_MAX_TURNS): GoalState {
  if (!Number.isSafeInteger(maxTurns) || maxTurns <= 0) {
    throw new Error('maxTurns must be a positive integer');
  }
  return {
    goalId: `goal-${randomUUID()}`,
    goal,
    status: 'active',
    turnsUsed: 0,
    maxTurns,
    createdAt: Date.now(),
    lastTurnAt: 0,
    consecutiveParseFailures: 0,
    subgoals: [],
  };
}

/**
 * Defensive deserialization of a persisted goal state. Returns null when the
 * payload isn't a usable goal. Old payloads without `subgoals` load unchanged.
 */
export function normalizeGoalState(raw: unknown): GoalState | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  const goal = typeof data.goal === 'string' ? data.goal : '';
  if (!goal.trim()) return null;

  const status: GoalStatus = ['active', 'paused', 'done', 'cleared'].includes(String(data.status))
    ? (data.status as GoalStatus)
    : 'active';

  const subgoals: string[] = Array.isArray(data.subgoals)
    ? data.subgoals.map(s => String(s).trim()).filter(Boolean)
    : [];
  const goalPlan = normalizeGoalPlan(data.goalPlan);

  const verdict = ['done', 'continue', 'skipped'].includes(String(data.lastVerdict))
    ? (data.lastVerdict as GoalVerdict)
    : undefined;

  const createdAt = toNumber(data.createdAt, 0);
  const state: GoalState = {
    goalId: normalizeGoalId(data.goalId) || legacyGoalId(goal, createdAt),
    goal,
    status,
    turnsUsed: toNonNegativeInt(data.turnsUsed, 0),
    maxTurns: toPositiveInt(data.maxTurns, DEFAULT_MAX_TURNS),
    createdAt,
    lastTurnAt: toNumber(data.lastTurnAt, 0),
    consecutiveParseFailures: toNonNegativeInt(data.consecutiveParseFailures, 0),
    subgoals,
  };
  if (goalPlan) state.goalPlan = goalPlan;
  if (typeof data.goalPlanAttempted === 'boolean') {
    state.goalPlanAttempted = data.goalPlanAttempted;
  }
  if (typeof data.goalPlanLastError === 'string') {
    state.goalPlanLastError = data.goalPlanLastError;
  }
  if (verdict) state.lastVerdict = verdict;
  if (typeof data.lastReason === 'string') state.lastReason = data.lastReason;
  if (typeof data.pausedReason === 'string') state.pausedReason = data.pausedReason;
  if (typeof data.verifyGated === 'boolean') state.verifyGated = data.verifyGated;
  return state;
}

function normalizeGoalId(value: unknown): string {
  if (typeof value !== 'string') return '';
  const clean = value.trim();
  return /^[a-zA-Z0-9._-]{1,128}$/.test(clean) ? clean : '';
}

/** Stable migration id for goal files created before Code Buddy 2.0. */
function legacyGoalId(goal: string, createdAt: number): string {
  const digest = createHash('sha256')
    .update(`${createdAt}\0${goal}`)
    .digest('hex')
    .slice(0, 24);
  return `goal-legacy-${digest}`;
}

function toPositiveInt(value: unknown, fallback: number): number {
  const n = parseSafeInteger(value, /^[1-9]\d*$/);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}

function toNonNegativeInt(value: unknown, fallback: number): number {
  const n = parseSafeInteger(value, /^(?:0|[1-9]\d*)$/);
  return Number.isSafeInteger(n) && n >= 0 ? n : fallback;
}

function parseSafeInteger(value: unknown, stringPattern: RegExp): number {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return Number.NaN;
  const trimmed = value.trim();
  if (!stringPattern.test(trimmed)) return Number.NaN;
  return Number(trimmed);
}

function toNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Printable one-liner for /goal status. */
export function formatGoalStatusLine(state: GoalState | null): string {
  if (!state || state.status === 'cleared') {
    return 'No active goal. Set one with /goal <text>.';
  }
  const turns = `${state.turnsUsed}/${state.maxTurns} turns`;
  const sub = state.subgoals.length
    ? `, ${state.subgoals.length} subgoal${state.subgoals.length !== 1 ? 's' : ''}`
    : '';
  const plan = state.goalPlan
    ? `, plan ${state.goalPlan.tasks.length} task${state.goalPlan.tasks.length !== 1 ? 's' : ''}`
    : '';
  if (state.status === 'active') {
    return `⊙ Goal (active, ${turns}${sub}${plan}): ${state.goal}`;
  }
  if (state.status === 'paused') {
    const extra = state.pausedReason ? ` — ${state.pausedReason}` : '';
    return `⏸ Goal (paused, ${turns}${sub}${plan}${extra}): ${state.goal}`;
  }
  if (state.status === 'done') {
    return `✓ Goal done (${turns}${sub}${plan}): ${state.goal}`;
  }
  return `Goal (${state.status}, ${turns}${sub}${plan}): ${state.goal}`;
}

/** The canonical user-role continuation message for an active goal. */
export function buildContinuationPrompt(state: GoalState): string {
  if (state.goalPlan) {
    const manualSubgoalsBlock = state.subgoals.length
      ? `Additional user criteria:\n${renderSubgoalsBlock(state.subgoals)}\n\n`
      : '';
    return CONTINUATION_PROMPT_WITH_PLAN_TEMPLATE.replace('{goal}', state.goal)
      .replace('{goal_plan_block}', formatGoalPlan(state.goalPlan))
      .replace('{manual_subgoals_block}', manualSubgoalsBlock);
  }
  if (state.subgoals.length) {
    return CONTINUATION_PROMPT_WITH_SUBGOALS_TEMPLATE.replace('{goal}', state.goal).replace(
      '{subgoals_block}',
      renderSubgoalsBlock(state.subgoals)
    );
  }
  return CONTINUATION_PROMPT_TEMPLATE.replace('{goal}', state.goal);
}

// ──────────────────────────────────────────────────────────────────────
// After-turn decision ladder (pure — shared by GoalManager and the
// peer-session bridge)
// ──────────────────────────────────────────────────────────────────────

export interface GoalJudgeOutcome {
  verdict: GoalVerdict;
  reason: string;
  parseFailed: boolean;
}

export interface GoalTurnDecisionCore {
  status: GoalStatus;
  shouldContinue: boolean;
  continuationPrompt: string | null;
  verdict: GoalVerdict;
  reason: string;
  /** User-visible one-liner (✓ / ⏸ / ↻). */
  message: string;
}

/**
 * Apply a judge outcome to an active goal — the exact Hermes ladder.
 * MUTATES `state` (turn counter, verdict bookkeeping, status transitions)
 * and returns the decision; the caller persists the state wherever it
 * lives (GoalStore file, peer-session record, …).
 */
export function applyJudgeOutcome(
  state: GoalState,
  outcome: GoalJudgeOutcome,
  nowMs: number = Date.now()
): GoalTurnDecisionCore {
  state.turnsUsed += 1;
  state.lastTurnAt = nowMs;
  state.lastVerdict = outcome.verdict;
  state.lastReason = outcome.reason;
  // Reset the parse-failure streak on any usable reply, including
  // API/transport errors (parseFailed=false), so a flaky network doesn't
  // trip the auto-pause meant for bad judge models.
  state.consecutiveParseFailures = outcome.parseFailed ? state.consecutiveParseFailures + 1 : 0;

  if (outcome.verdict === 'done') {
    state.status = 'done';
    return {
      status: 'done',
      shouldContinue: false,
      continuationPrompt: null,
      verdict: 'done',
      reason: outcome.reason,
      message: `✓ Goal achieved: ${outcome.reason}`,
    };
  }

  if (state.consecutiveParseFailures >= MAX_CONSECUTIVE_PARSE_FAILURES) {
    state.status = 'paused';
    state.pausedReason = `judge model returned unparseable output ${state.consecutiveParseFailures} turns in a row`;
    return {
      status: 'paused',
      shouldContinue: false,
      continuationPrompt: null,
      verdict: 'continue',
      reason: outcome.reason,
      message:
        `⏸ Goal paused — the judge model (${state.consecutiveParseFailures} turns) ` +
        'isn\'t returning the required JSON verdict. Route the judge to a stricter ' +
        'model in .codebuddy/settings.json:\n' +
        '  { "goals": { "judgeModel": "<a model that follows JSON instructions>" } }\n' +
        'Then /goal resume to continue.',
    };
  }

  if (state.turnsUsed >= state.maxTurns) {
    state.status = 'paused';
    state.pausedReason = `turn budget exhausted (${state.turnsUsed}/${state.maxTurns})`;
    return {
      status: 'paused',
      shouldContinue: false,
      continuationPrompt: null,
      verdict: 'continue',
      reason: outcome.reason,
      message:
        `⏸ Goal paused — ${state.turnsUsed}/${state.maxTurns} turns used. ` +
        'Use /goal resume to keep going, or /goal clear to stop.',
    };
  }

  return {
    status: 'active',
    shouldContinue: true,
    continuationPrompt: buildContinuationPrompt(state),
    verdict: 'continue',
    reason: outcome.reason,
    message: `↻ Continuing toward goal (${state.turnsUsed}/${state.maxTurns}): ${outcome.reason}`,
  };
}
