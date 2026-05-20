/**
 * Fleet — Saga store (Fleet P4).
 *
 * A "saga" is a multi-step LLM dispatch composed of one or more
 * lanes (primary, fallback, or N parallel) plus an optional
 * aggregator that synthesises the parallel results into a single
 * answer. Sagas are persisted to disk so a process crash mid-flight
 * doesn't lose state — the next boot scans the directory and
 * resumes pending steps.
 *
 * Storage layout:
 *
 *   ~/.codebuddy/sagas/
 *     <sagaId>.json    — one file per saga
 *     <sagaId>.lock    — PID-based lock (reuses session-lock.ts)
 *
 * The store is intentionally minimal — the orchestration loop
 * (which decides when a step is `pending` vs `running` vs `done`)
 * lives in the saga executor (separate module).
 *
 * @module fleet/saga-store
 */

import * as fs from 'fs';
import * as path from 'path';
import { withSessionLock } from '../persistence/session-lock.js';
import { logger } from '../utils/logger.js';
import { getCodeBuddyPath } from '../utils/codebuddy-home.js';
import type { FleetHermesToolsetDescriptor } from './dispatch-profile.js';
import type { DispatchPlan } from './task-router.js';

export type SagaStepStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped';

export type SagaStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** A single dispatched step within a saga. */
export interface SagaStep {
  peerId: string;
  model: string;
  /**
   * Lane this step belongs to. `chain` is the Hermes-style sequential
   * collaboration lane (Draft→Review→Test) — chain steps run in order
   * and each waits for its `dependsOn` predecessor to complete.
   */
  lane: 'primary' | 'fallback' | 'parallel' | 'chain';
  /**
   * Hermes role hint — only meaningful for `chain` lanes. Values
   * mirror dispatch profile names (`'code'|'review'|'research'|'safe'|'balanced'`).
   * Used by the SagaRunner to build the per-step system prompt and by
   * the Cowork Kanban to bucket the saga into Draft/Review/Test columns.
   */
  role?: string;
  /**
   * Predecessor step index in the same saga. Only set for `chain`
   * steps (index 0 has no predecessor). The runner consults this via
   * `SagaStore.advanceChain()` to decide when a pending chain step is
   * eligible to start.
   */
  dependsOn?: number;
  /** RunId returned by `peer.dispatch` on the target peer. */
  runId?: string;
  status: SagaStepStatus;
  /** Snapshot of the remote dispatch tool-policy hint used for this lane. */
  toolPolicy?: {
    profile?: string;
    policyProfile?: string;
    defaultAction?: string;
    allowGroups?: string[];
    confirmGroups?: string[];
    denyGroups?: string[];
    summary?: string;
  };
  /** Per-tool allow/confirm/deny preview returned by the remote dispatch. */
  toolDecisions?: Array<{
    tool: string;
    groups?: string[];
    action: string;
    source?: string;
    reason?: string;
    matchedGroup?: string;
  }>;
  /** Hermes-style descriptor returned when the remote peer accepted the dispatch. */
  toolset?: FleetHermesToolsetDescriptor;
  startedAt?: number;
  completedAt?: number;
  result?: string;
  error?: string;
}

/** Persisted saga record. */
export interface SagaRecord {
  /** Stable id `saga_<ts>_<rand>` minted at creation. */
  id: string;
  /** Original goal text (used by the aggregator + UI). */
  goal: string;
  /** Plan from the TaskRouter (frozen at creation, not re-routed). */
  plan: DispatchPlan;
  /** Steps tracked per lane — populated as dispatch fires. */
  steps: SagaStep[];
  /** Optional aggregator prompt template (defaults if omitted). */
  aggregatorPrompt?: string;
  /** Final synthesised answer once all parallel steps complete. */
  finalResult?: string;
  /** Top-level status — derived from step statuses + aggregator. */
  status: SagaStatus;
  /** Free-form metadata (privacyTag, costTag, etc.). */
  metadata: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

/** Optional config for the SagaStore — testable. */
export interface SagaStoreConfig {
  /** Override the default `~/.codebuddy/sagas/` directory. */
  storeDir?: string;
}

/**
 * Disk-backed saga registry. One process per machine talks to the
 * same directory; the lockfile prevents concurrent writes from
 * stomping each other.
 */
export class SagaStore {
  private readonly dir: string;

  constructor(config: SagaStoreConfig = {}) {
    this.dir = config.storeDir ?? this.defaultDir();
    this.ensureDir();
  }

  /** Mint a new saga id. Format mirrors session-store for consistency. */
  static nextSagaId(): string {
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 8);
    return `saga_${ts}_${rand}`;
  }

  /** Create + persist a fresh saga from a router plan. */
  async create(input: {
    goal: string;
    plan: DispatchPlan;
    aggregatorPrompt?: string;
    metadata?: Record<string, unknown>;
  }): Promise<SagaRecord> {
    const now = Date.now();
    const record: SagaRecord = {
      id: SagaStore.nextSagaId(),
      goal: input.goal,
      plan: input.plan,
      steps: this.buildInitialSteps(input.plan),
      aggregatorPrompt: input.aggregatorPrompt,
      status: 'pending',
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now,
    };
    await this.write(record);
    return record;
  }

  /** Read a saga by id. Returns null if not found. */
  async load(sagaId: string): Promise<SagaRecord | null> {
    const file = this.fileFor(sagaId);
    if (!fs.existsSync(file)) return null;
    try {
      const raw = await fs.promises.readFile(file, 'utf-8');
      return JSON.parse(raw) as SagaRecord;
    } catch (err) {
      logger.warn?.('[saga-store] failed to read saga', {
        sagaId,
        err: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  /**
   * Atomically mutate a saga via a callback. Caller receives the
   * current record, returns the new state. The store handles
   * locking + write + bumping `updatedAt`.
   */
  async update(
    sagaId: string,
    mutator: (current: SagaRecord) => SagaRecord | Promise<SagaRecord>,
  ): Promise<SagaRecord | null> {
    const file = this.fileFor(sagaId);
    let result: SagaRecord | null = null;
    await withSessionLock(file, async () => {
      const current = await this.load(sagaId);
      if (!current) return;
      const next = await mutator(current);
      next.updatedAt = Date.now();
      // Derive top-level status from step statuses if mutator didn't.
      next.status = next.status ?? deriveSagaStatus(next);
      if (
        next.status === 'completed' ||
        next.status === 'failed' ||
        next.status === 'cancelled'
      ) {
        next.completedAt = next.completedAt ?? Date.now();
      }
      await this.writeUnlocked(next);
      result = next;
    });
    return result;
  }

  /** Mark a step as completed and store the result. */
  async completeStep(
    sagaId: string,
    laneIndex: number,
    result: string,
  ): Promise<SagaRecord | null> {
    return this.update(sagaId, (saga) => {
      const step = saga.steps[laneIndex];
      if (!step) return saga;
      step.status = 'completed';
      step.result = result;
      step.completedAt = Date.now();
      saga.status = deriveSagaStatus(saga);
      return saga;
    });
  }

  /** Mark a step as failed. */
  async failStep(
    sagaId: string,
    laneIndex: number,
    error: string,
  ): Promise<SagaRecord | null> {
    return this.update(sagaId, (saga) => {
      const step = saga.steps[laneIndex];
      if (!step) return saga;
      step.status = 'failed';
      step.error = error;
      step.completedAt = Date.now();
      saga.status = deriveSagaStatus(saga);
      return saga;
    });
  }

  /**
   * Set the aggregator output. Marks the saga `completed` and triggers
   * Hermes-style skill writeback — the goal + truncated finalResult
   * are appended to the project's persistent memory so future agents
   * can recall what the fleet learned from this run.
   *
   * Writeback is **warning-only**: a memory-system failure (locked
   * file, missing dir, mock module in tests) logs a warning and
   * returns the finalised saga unchanged. The golden path is the
   * saga finalisation itself — capture is best-effort.
   */
  async finalise(
    sagaId: string,
    finalResult: string,
  ): Promise<SagaRecord | null> {
    const updated = await this.update(sagaId, (saga) => {
      saga.finalResult = finalResult;
      saga.status = 'completed';
      saga.completedAt = Date.now();
      return saga;
    });
    if (updated && updated.finalResult) {
      await appendSagaLesson(updated).catch((err) => {
        logger.warn?.('[saga-store] skill writeback failed (ignored)', {
          sagaId: updated.id,
          err: err instanceof Error ? err.message : String(err),
        });
      });
    }
    return updated;
  }

  /**
   * Advance a chain saga (Hermes-style sequential collaboration).
   *
   * Scans steps in order, finds the first `chain` step still `pending`
   * whose `dependsOn` predecessor is `completed` (or has no
   * predecessor), and flips it to `running`. Idempotent: if no step is
   * ready (chain stalled or every chain step already running/done),
   * returns the saga unchanged.
   *
   * Called by SagaRunner after each chain step completes so the next
   * one can pick up. Failure of any chain step short-circuits — this
   * method then finds no eligible step and the saga settles into
   * `failed` via `deriveSagaStatus`.
   */
  async advanceChain(sagaId: string): Promise<SagaRecord | null> {
    return this.update(sagaId, (saga) => {
      for (let i = 0; i < saga.steps.length; i++) {
        const step = saga.steps[i];
        if (step.lane !== 'chain') continue;
        if (step.status !== 'pending') continue;
        if (step.dependsOn !== undefined) {
          const pred = saga.steps[step.dependsOn];
          if (!pred || pred.status !== 'completed') continue;
        }
        step.status = 'running';
        step.startedAt = Date.now();
        saga.status = deriveSagaStatus(saga);
        return saga;
      }
      return saga;
    });
  }

  /** List all saga ids on disk, sorted by updatedAt desc. */
  async list(): Promise<SagaRecord[]> {
    const files = await fs.promises.readdir(this.dir);
    const records: SagaRecord[] = [];
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const id = f.slice(0, -5);
      const r = await this.load(id);
      if (r) records.push(r);
    }
    records.sort((a, b) => b.updatedAt - a.updatedAt);
    return records;
  }

  /**
   * Find sagas that need resuming after a process restart. A saga
   * "needs resume" when it has at least one step in `pending` or
   * `running` and is not itself `completed`/`failed`/`cancelled`.
   */
  async findResumable(): Promise<SagaRecord[]> {
    const all = await this.list();
    return all.filter((s) => {
      if (s.status === 'completed' || s.status === 'failed' || s.status === 'cancelled') {
        return false;
      }
      return s.steps.some(
        (step) => step.status === 'pending' || step.status === 'running',
      );
    });
  }

  /** Delete a saga (and its lockfile). */
  async delete(sagaId: string): Promise<boolean> {
    const file = this.fileFor(sagaId);
    if (!fs.existsSync(file)) return false;
    await fs.promises.unlink(file);
    const lock = file + '.lock';
    if (fs.existsSync(lock)) {
      try {
        await fs.promises.unlink(lock);
      } catch {
        /* lock might be held by another process */
      }
    }
    return true;
  }

  // ─────────── Internals ───────────

  private defaultDir(): string {
    return getCodeBuddyPath('sagas');
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.dir)) {
      fs.mkdirSync(this.dir, { recursive: true });
    }
  }

  private fileFor(sagaId: string): string {
    return path.join(this.dir, `${sagaId}.json`);
  }

  private async write(record: SagaRecord): Promise<void> {
    const file = this.fileFor(record.id);
    await withSessionLock(file, async () => {
      await this.writeUnlocked(record);
    });
  }

  private async writeUnlocked(record: SagaRecord): Promise<void> {
    const file = this.fileFor(record.id);
    const tmp = `${file}.tmp.${process.pid}`;
    await fs.promises.writeFile(tmp, JSON.stringify(record, null, 2));
    await fs.promises.rename(tmp, file);
  }

  private buildInitialSteps(plan: DispatchPlan): SagaStep[] {
    const steps: SagaStep[] = [];
    // Chain takes precedence — Hermes-style sequential collaboration.
    if (plan.chain && plan.chain.length > 0) {
      plan.chain.forEach((lane, idx) => {
        steps.push({
          peerId: lane.peerId,
          model: lane.model,
          lane: 'chain',
          role: lane.role,
          dependsOn: idx > 0 ? idx - 1 : undefined,
          status: 'pending',
        });
      });
      return steps;
    }
    if (plan.parallel && plan.parallel.length > 0) {
      // Pure parallel dispatch — each lane is independent.
      for (const lane of plan.parallel) {
        steps.push({
          peerId: lane.peerId,
          model: lane.model,
          lane: 'parallel',
          status: 'pending',
        });
      }
    } else {
      steps.push({
        peerId: plan.primary.peerId,
        model: plan.primary.model,
        lane: 'primary',
        status: 'pending',
      });
      if (plan.fallback) {
        steps.push({
          peerId: plan.fallback.peerId,
          model: plan.fallback.model,
          lane: 'fallback',
          status: 'pending',
        });
      }
    }
    return steps;
  }
}

/**
 * Derive the top-level saga status from its steps. Pure function
 * exposed for tests. Non-trivial because a fallback step is only
 * meaningful when the primary failed — a pending fallback shouldn't
 * keep a saga in `pending` once the primary succeeds.
 */
export function deriveSagaStatus(saga: SagaRecord): SagaStatus {
  if (saga.steps.length === 0) return 'pending';

  // Chain saga — Hermes-style sequential collaboration. The chain
  // breaks at the first failed step; completes when the LAST step
  // finishes; reports `running` whenever the chain is advancing
  // (some step active, or completed predecessors with pending heirs).
  const isChainSaga = saga.steps.every((s) => s.lane === 'chain');
  if (isChainSaga) {
    if (saga.steps.some((s) => s.status === 'failed')) return 'failed';
    if (saga.steps.some((s) => s.status === 'running')) return 'running';
    const hasCompleted = saga.steps.some((s) => s.status === 'completed');
    const hasPending = saga.steps.some((s) => s.status === 'pending');
    // Mid-chain handoff window: some completed, some pending — saga is
    // logically running even if no step is `running` for the instant
    // between `completeStep` and `advanceChain`.
    if (hasCompleted && hasPending) return 'running';
    const last = saga.steps[saga.steps.length - 1];
    if (last && last.status === 'completed') return 'completed';
    return 'pending';
  }

  // Parallel-only sagas: at-least-one-success == saga success once
  // every step is in a terminal state.
  const isParallelSaga = saga.steps.every((s) => s.lane === 'parallel');
  if (isParallelSaga) {
    if (saga.steps.some((s) => s.status === 'running')) return 'running';
    if (saga.steps.some((s) => s.status === 'pending')) return 'pending';
    const completed = saga.steps.filter((s) => s.status === 'completed').length;
    if (completed > 0) return 'completed';
    return 'failed';
  }

  // Sequential saga (primary + optional fallback).
  const primary = saga.steps.find((s) => s.lane === 'primary');
  const fallback = saga.steps.find((s) => s.lane === 'fallback');

  // Primary success short-circuits regardless of fallback state.
  if (primary?.status === 'completed') return 'completed';
  if (primary?.status === 'running' || fallback?.status === 'running') {
    return 'running';
  }
  if (primary?.status === 'pending') return 'pending';
  if (primary?.status === 'failed') {
    if (!fallback) return 'failed';
    if (fallback.status === 'completed') return 'completed';
    if (fallback.status === 'failed') return 'failed';
    // running was already handled above; remaining cases are
    // 'pending' | 'skipped' — both equivalent to "not started yet".
    return 'pending';
  }
  return 'pending';
}

/**
 * Recall recent saga lessons relevant to a new goal. Pairs with
 * {@link appendSagaLesson} — Phase E writes, this reads. Together they
 * close the Hermes-style self-improving loop: every chain saga that
 * completes leaves a trace, and the next dispatch with a similar goal
 * pulls the trace back into the prompt as context.
 *
 * The recall uses `PersistentMemoryManager.getRelevantMemories` (keyword
 * scoring + access-count boost) then filters to entries whose `key`
 * starts with `fleet-saga-` so non-saga memory (preferences, decisions)
 * doesn't leak into dispatch prompts.
 *
 * Warning-only: any failure (memory module unavailable, locked file,
 * mock throwing in tests) returns an empty array. Callers are designed
 * around `length === 0` ⇒ skip the injection block.
 *
 * @param query free-form goal text used to score memories
 * @param opts.limit max lessons to return (default 3)
 * @returns formatted snippets ready to inline in a prompt, or `[]` on failure
 */
export async function loadRelevantSagaLessons(
  query: string,
  opts: { limit?: number } = {},
): Promise<string[]> {
  const limit = opts.limit ?? 3;
  try {
    const { getMemoryManager } = await import('../memory/persistent-memory.js');
    const manager = getMemoryManager();
    await manager.initialize();
    // Pull a wider candidate set then filter by fleet prefix. The
    // memory manager scores 5 by default; we ask for limit*3 to give
    // the filter room to find fleet entries even when the project has
    // many non-fleet memories.
    const candidates = manager.getRelevantMemories(query, Math.max(limit * 3, 9));
    const fleetLessons = candidates.filter((m) =>
      m.key.startsWith('fleet-saga-'),
    );
    return fleetLessons.slice(0, limit).map((m) => {
      const value =
        m.value.length > 300 ? `${m.value.slice(0, 297)}...` : m.value;
      return `- ${value}`;
    });
  } catch (err) {
    logger.warn?.(
      '[saga-store] loadRelevantSagaLessons failed (returning empty)',
      { error: err instanceof Error ? err.message : String(err) },
    );
    return [];
  }
}

/**
 * Append a saga's finalised outcome to the project persistent memory.
 * Used by `finalise()` so an autonomous Draft→Review→Test chain leaves
 * a Hermes-style "learned skill" trace future agents can recall.
 *
 * Lazy-imports the memory module so saga-store stays import-light for
 * tests that only exercise the in-memory store. Truncates `finalResult`
 * to 500 chars — the goal of writeback is a discoverable summary, not
 * a full transcript dump.
 */
async function appendSagaLesson(saga: SagaRecord): Promise<void> {
  const { getMemoryManager } = await import('../memory/persistent-memory.js');
  const manager = getMemoryManager();
  await manager.initialize();
  const truncated = (saga.finalResult ?? '').slice(0, 500);
  const key = `fleet-saga-${saga.id}`;
  const value = `Goal: ${saga.goal}\n\nOutcome: ${truncated}`;
  await manager.remember(key, value, {
    scope: 'project',
    category: 'context',
    tags: ['fleet', 'saga', `id:${saga.id}`],
  });
}

let cachedStore: SagaStore | null = null;

/** Process-wide saga store. */
export function getSagaStore(): SagaStore {
  if (!cachedStore) cachedStore = new SagaStore();
  return cachedStore;
}

/** Test-only reset hook. */
export function resetSagaStore(): void {
  cachedStore = null;
}
