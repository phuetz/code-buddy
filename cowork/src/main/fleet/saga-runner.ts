/**
 * SagaRunner — wires fleet.dispatch IPC end-to-end (Wiring W1+W2+W3).
 *
 * Once the IPC handler has built a DispatchPlan and persisted a saga
 * via SagaStore, this runner takes over:
 *
 *   1. Fires `peer.dispatch` on each step's peer (FleetBridge.peerRequest)
 *   2. Stores the returned `runId` on the saga step
 *   3. Polls `peer.dispatchStatus` every 2 s until each step is terminal
 *   4. Calls `saga.completeStep` / `saga.failStep` accordingly
 *   5. When all parallel steps are terminal, calls the result aggregator
 *      and `saga.finalise`
 *
 * For sequential primary+fallback sagas, only the active lane is
 * polled at any time (fallback is skipped if primary succeeds, fired
 * if primary fails).
 *
 * The runner emits `fleet.saga.update` ServerEvents at each transition
 * so the FleetCommandCenter can render live progress without polling.
 *
 * @module main/fleet/saga-runner
 */

import { log, logError, logWarn } from '../utils/logger';
import { loadCoreModule } from '../utils/core-loader';
import type { FleetBridge } from './fleet-bridge';
import type { ServerEvent } from '../../renderer/types';
import type { ActivityFeed } from '../activity/activity-feed';

// Wide types — the core fleet modules don't ship typings reachable
// from Cowork's tsconfig. Each shape mirrors the relevant exported
// surface.

interface DispatchLaneShape {
  peerId: string;
  model: string;
  /** Exact backend selected by the core router; absent on legacy plans. */
  provider?: string;
}

interface DispatchPlanShape {
  primary: DispatchLaneShape;
  fallback?: DispatchLaneShape;
  parallel?: DispatchLaneShape[];
  /** Hermes-style sequential chain (Draft → Review → Test). */
  chain?: Array<DispatchLaneShape & { role?: string }>;
}

interface SagaStepShape {
  peerId: string;
  model: string;
  /** Exact backend selected by the core router; absent on legacy sagas. */
  provider?: string;
  /** Durable execution provenance. Absent on sagas written by older builds. */
  attempts?: SagaStepAttemptShape[];
  lane: 'primary' | 'fallback' | 'parallel' | 'chain';
  /** Only set on chain steps — role hint (`code|review|safe|...`). */
  role?: string;
  /** Only set on chain steps — index of predecessor step. */
  dependsOn?: number;
  /**
   * Phase H — set to `true` after the runner has retried this chain
   * step on an alternative peer. Acts as a 1-retry cap: a second
   * stall on the alt peer fails the chain for good.
   */
  retried?: boolean;
  runId?: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'skipped';
  toolPolicy?: DispatchToolPolicyShape;
  toolDecisions?: DispatchToolDecisionShape[];
  toolset?: DispatchHermesToolsetShape;
  result?: string;
  error?: string;
}

interface SagaStepAttemptShape {
  peerId: string;
  model: string;
  providerRequested?: string;
  providerResolved?: string;
  runId?: string;
  status: 'running' | 'completed' | 'failed';
  failureDomain?: FailureDomain;
  startedAt: number;
  completedAt?: number;
  error?: string;
}

interface SagaShape {
  id: string;
  goal: string;
  plan: DispatchPlanShape;
  steps: SagaStepShape[];
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  finalResult?: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
  completedAt?: number;
}

interface SagaStoreShape {
  load: (sagaId: string) => Promise<SagaShape | null>;
  update: (
    sagaId: string,
    mutator: (current: SagaShape) => SagaShape | Promise<SagaShape>,
  ) => Promise<SagaShape | null>;
  completeStep: (sagaId: string, laneIndex: number, result: string) => Promise<SagaShape | null>;
  failStep: (sagaId: string, laneIndex: number, error: string) => Promise<SagaShape | null>;
  finalise: (sagaId: string, finalResult: string) => Promise<SagaShape | null>;
  /** Hermes chain advance — present on core SagaStore since Phase A. */
  advanceChain?: (sagaId: string) => Promise<SagaShape | null>;
}

interface SagaStoreModule {
  getSagaStore: () => SagaStoreShape;
}

/**
 * Deterministic agreement summary returned by the core council
 * aggregator. Wide shape mirroring `ConsensusSummary` in
 * `src/fleet/result-aggregator.ts` — Cowork's tsconfig can't reach the
 * core typings, so we re-declare the surface we read.
 */
interface ConsensusSummaryShape {
  score: number;
  reached: boolean;
  threshold: number;
  agreeingCount: number;
  total: number;
  perSource: Array<{ peerId: string; model: string; agreement: number }>;
  disagreements: Array<{ peerId: string; model: string; preview: string }>;
}

interface AggregatorModule {
  aggregateParallelResults: (saga: SagaShape) => Promise<string>;
  finaliseFromSingle: (saga: SagaShape) => string | null;
  /**
   * Council aggregation (consensus mode). Present on core since the
   * fleet-council change; older cores omit it and the runner falls back
   * to `aggregateParallelResults`.
   */
  aggregateWithConsensus?: (
    saga: SagaShape,
    options?: { threshold?: number },
  ) => Promise<{ finalText: string; consensus: ConsensusSummaryShape }>;
}

/**
 * Core council→lesson bridge (`src/agent/council-lesson-proposer.ts`). Present
 * since the consolidation change; older cores omit it and the auto-propose is a
 * no-op.
 */
interface CouncilProposerModule {
  proposeFromCouncilOutcome?: (
    input: {
      sagaId: string;
      goal: string;
      aggregation?: string;
      consensus: {
        score: number;
        threshold: number;
        total: number;
        disagreements: Array<{ peerId: string; model: string; preview?: string }>;
      };
    },
    workDir: string,
  ) => { proposed: boolean; reason?: string; candidate?: { id: string } };
}

interface DispatchStatusResponse {
  found?: boolean;
  status?: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  providerRequested?: string;
  providerResolved?: string;
  toolPolicy?: DispatchToolPolicyShape;
  toolDecisions?: DispatchToolDecisionShape[];
  toolset?: DispatchHermesToolsetShape;
  result?: string;
  error?: string;
}

type FleetDispatchProfile = 'balanced' | 'research' | 'code' | 'review' | 'safe';

interface DispatchToolPolicyShape {
  profile?: string;
  policyProfile?: string;
  defaultAction?: string;
  allowGroups?: string[];
  confirmGroups?: string[];
  denyGroups?: string[];
  summary?: string;
}

interface DispatchToolDecisionShape {
  tool: string;
  groups?: string[];
  action: string;
  source?: string;
  reason?: string;
  matchedGroup?: string;
}

interface DispatchHermesToolsetShape {
  toolsetId?: string;
  label?: string;
  intent?: string;
  policyProfile?: string;
  defaultAction?: string;
  allowedTools?: string[];
  confirmTools?: string[];
  deniedTools?: string[];
  summary?: string;
}

const FLEET_DISPATCH_PROFILES = new Set<FleetDispatchProfile>([
  'balanced',
  'research',
  'code',
  'review',
  'safe',
]);

const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 5 * 60 * 1_000;
const DISPATCH_TIMEOUT_MS = 30_000;

type FailureDomain = 'peer' | 'provider';

const PROVIDER_FAILURE_PATTERN = new RegExp(
  [
    'PROVIDER_UNAVAILABLE',
    '\\b(?:HTTP(?: status)?\\s*)?(?:500|502|503|504)\\b',
    '\\b(?:HTTP\\s*)?401\\b',
    '\\b(?:HTTP\\s*)?429\\b',
    '\\brate[ _-]?limit(?:ed|ing)?\\b',
    '\\btoo many requests\\b',
    '\\bquota\\b',
    '\\binsufficient[ _-]?(?:credits?|balance|quota)\\b',
    '\\bbilling(?: hard)? limit\\b',
    '\\bcircuit breaker[^\\n]*\\bopen\\b',
    '\\b(?:ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH)\\b',
    '\\bfetch failed\\b',
    '\\bsocket hang up\\b',
    '\\bconnection (?:refused|reset|timed out)\\b',
    '\\bnetwork (?:error|unreachable)\\b',
  ].join('|'),
  'i',
);

const PEER_TRANSPORT_FAILURE_PATTERN = new RegExp(
  [
    '\\bpeer\\.invoke REQUEST_TIMEOUT\\b',
    '\\bFleet listener (?:connect|auth) timeout\\b',
    '\\bpeer (?:disconnected|unreachable)\\b',
    '\\bWebSocket (?:closed|not connected)\\b',
    '\\b(?:ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH)\\b',
    '\\bfetch failed\\b',
    '\\bsocket hang up\\b',
    '\\bconnection (?:refused|reset|timed out)\\b',
    '\\bnetwork (?:error|unreachable)\\b',
  ].join('|'),
  'i',
);

function readDispatchProfile(value: unknown): FleetDispatchProfile {
  return typeof value === 'string' && FLEET_DISPATCH_PROFILES.has(value as FleetDispatchProfile)
    ? (value as FleetDispatchProfile)
    : 'balanced';
}

/**
 * Fail over only for explicit infrastructure signals. Deliberate model/task
 * outcomes such as `review_rejected` remain terminal and are never replayed on
 * a different provider.
 */
function classifyExplicitFailure(
  error: string | undefined,
  phase: 'dispatch' | 'provider',
): FailureDomain | null {
  if (!error) return null;
  if (error === 'poll_timeout') return 'peer';
  if (phase === 'dispatch' && PEER_TRANSPORT_FAILURE_PATTERN.test(error)) {
    return 'peer';
  }
  return PROVIDER_FAILURE_PATTERN.test(error) ? 'provider' : null;
}

/** Persist useful diagnostics without ever copying credentials into saga JSON. */
function redactAttemptError(error: string): string {
  return error
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:sk|xai|or)-[A-Za-z0-9._-]{8,}\b/g, '[REDACTED]')
    .replace(/\bAIza[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')
    .replace(/([?&](?:api[_-]?key|token|access[_-]?token)=)[^&\s]+/gi, '$1[REDACTED]')
    .slice(0, 1_000);
}

export class SagaRunner {
  private readonly active = new Set<string>();
  /**
   * Sagas the operator cancelled mid-flight. Checked by the polling
   * loops so an in-flight run() winds down instead of completing or
   * retrying steps the operator already abandoned. Entries are cleared
   * when run() exits (or immediately, if no run() is active).
   */
  private readonly cancelRequested = new Set<string>();

  constructor(
    private readonly fleetBridge: FleetBridge,
    private readonly sendToRenderer: (event: ServerEvent) => void,
    private readonly activityFeed: ActivityFeed | null = null,
    /**
     * Resolves the working directory whose `.codebuddy/` hosts the lesson queue
     * for council auto-proposals (B1). Defaults to "no project" → auto-propose
     * is skipped (e.g. scheduled-task dispatch with no active project).
     */
    private readonly workDirResolver: () => string | null = () => null,
  ) {}

  /**
   * Kick off saga execution. Returns immediately — the actual work
   * runs in the background. Safe to call multiple times for the
   * same saga (subsequent calls are no-ops).
   */
  start(sagaId: string): void {
    if (this.active.has(sagaId)) {
      log('[saga-runner] already running, ignoring duplicate start', { sagaId });
      return;
    }
    this.active.add(sagaId);
    void this.run(sagaId).catch((err) => {
      logError('[saga-runner] run threw unexpectedly:', err);
    }).finally(() => {
      this.active.delete(sagaId);
      this.cancelRequested.delete(sagaId);
    });
  }

  /**
   * Operator-initiated cancellation. Marks the saga and every
   * non-terminal step `cancelled` in the store and aborts this runner's
   * polling/dispatch loops. Honest semantic: the *orchestration* stops —
   * an LLM call already in flight on a remote peer runs to completion
   * there, but its result is discarded (there is no `peer.dispatchCancel`
   * RPC in the protocol yet).
   */
  async cancel(sagaId: string): Promise<{ ok: boolean; error?: string; status?: string }> {
    const sagaMod = await loadCoreModule<SagaStoreModule>('fleet/saga-store.js');
    if (!sagaMod) {
      return { ok: false, error: 'Core saga-store module is unavailable (build the core dist first).' };
    }
    const store = sagaMod.getSagaStore();
    const saga = await store.load(sagaId);
    if (!saga) return { ok: false, error: `Unknown saga '${sagaId}'` };
    if (saga.status === 'completed' || saga.status === 'failed' || saga.status === 'cancelled') {
      return { ok: false, error: `Saga is already terminal ('${saga.status}')`, status: saga.status };
    }

    this.cancelRequested.add(sagaId);
    const updated = await store.update(sagaId, (s) => {
      for (const step of s.steps) {
        if (step.status === 'pending' || step.status === 'running') {
          step.status = 'cancelled';
        }
      }
      s.status = 'cancelled';
      s.completedAt = s.completedAt ?? Date.now();
      return s;
    });
    this.emitSagaUpdate(sagaId);
    this.activityFeed?.record({
      type: 'fleet.saga.cancelled',
      title: 'Fleet saga cancelled',
      description: truncateActivityText(saga.goal, 140),
      metadata: { sagaId, status: 'cancelled', totalSteps: saga.steps.length },
    });
    // No active run() to clean the flag up — drop it now so a future
    // replayed saga reusing this id (impossible today, defensive) or a
    // long-lived runner doesn't keep stale entries.
    if (!this.active.has(sagaId)) this.cancelRequested.delete(sagaId);
    log('[saga-runner] saga cancelled by operator', { sagaId });
    return { ok: true, status: updated?.status ?? 'cancelled' };
  }

  // ─────── internals ───────

  private async run(sagaId: string): Promise<void> {
    const sagaMod = await loadCoreModule<SagaStoreModule>('fleet/saga-store.js');
    if (!sagaMod) {
      logWarn('[saga-runner] saga-store module unavailable');
      return;
    }
    const store = sagaMod.getSagaStore();
    const saga = await store.load(sagaId);
    if (!saga) {
      logWarn('[saga-runner] saga not found at start', { sagaId });
      return;
    }

    const isChain =
      saga.steps.length > 0 && saga.steps.every((s) => s.lane === 'chain');
    const isParallel = (saga.plan.parallel?.length ?? 0) > 0;
    if (isChain) {
      await this.runChain(store, saga);
    } else if (isParallel) {
      await this.runParallel(store, saga);
    } else {
      await this.runSequential(store, saga);
    }

    await this.maybeFinalise(store, sagaId);
    await this.recordTerminalActivity(store, sagaId);
  }

  /**
   * Hermes-style chain execution. Steps run strictly in order — each
   * waits for its `dependsOn` predecessor to complete before firing.
   * The chain breaks on the first failed step; the saga then settles
   * into `failed` via the core `deriveSagaStatus` logic.
   *
   * Per-step prompt composition is delegated to {@link buildStepPrompt}
   * so a review step receives the draft, a test step receives the
   * reviewed output, etc. The step's `role` is forwarded as the
   * dispatch profile so the remote peer is configured for the right
   * job (review profile = audit-first, etc.).
   */
  private async runChain(store: SagaStoreShape, saga: SagaShape): Promise<void> {
    for (let i = 0; i < saga.steps.length; i++) {
      if (typeof store.advanceChain === 'function') {
        await store.advanceChain(saga.id);
      }
      await this.runStep(store, saga.id, i);
      const refreshed = await store.load(saga.id);
      const step = refreshed?.steps[i];
      if (!step || step.status === 'failed' || step.status === 'cancelled') {
        return; // chain broken or cancelled — later steps don't fire
      }
    }
  }

  /**
   * Compose the dispatch prompt for a single step. For chain steps with
   * a completed predecessor, the previous step's result is prepended so
   * the next agent (reviewer, tester…) has the context it needs without
   * an extra RPC round-trip. Falls back to `saga.goal` for non-chain
   * steps or the chain head.
   */
  private buildStepPrompt(saga: SagaShape, step: SagaStepShape): string {
    if (step.lane !== 'chain' || step.dependsOn === undefined) {
      return saga.goal;
    }
    const predecessor = saga.steps[step.dependsOn];
    if (!predecessor || !predecessor.result) return saga.goal;
    if (step.role === 'review') {
      return `${saga.goal}\n\nReview this draft critically and surface risks:\n\n${predecessor.result}`;
    }
    if (step.role === 'safe' || step.role === 'test') {
      return `${saga.goal}\n\nWrite tests covering the reviewed work:\n\n${predecessor.result}`;
    }
    return `${saga.goal}\n\nBuild on the previous step's output:\n\n${predecessor.result}`;
  }

  private async runParallel(store: SagaStoreShape, saga: SagaShape): Promise<void> {
    // Fire all parallel steps simultaneously then poll each.
    await Promise.all(
      saga.steps.map((_step, idx) => this.runStep(store, saga.id, idx)),
    );
  }

  private async runSequential(store: SagaStoreShape, saga: SagaShape): Promise<void> {
    // Primary first.
    const primaryIdx = saga.steps.findIndex((s) => s.lane === 'primary');
    if (primaryIdx < 0) return;
    await this.runStep(store, saga.id, primaryIdx);

    // If primary succeeded, skip fallback. Reload to inspect.
    const refreshed = await store.load(saga.id);
    if (!refreshed) return;
    const primary = refreshed.steps[primaryIdx];
    if (!primary || primary.status === 'completed') return;
    if (
      this.cancelRequested.has(saga.id) ||
      refreshed.status === 'cancelled' ||
      primary.status === 'cancelled'
    ) {
      return;
    }

    const fallbackIdx = refreshed.steps.findIndex((s) => s.lane === 'fallback');
    if (fallbackIdx < 0) return;
    const failureDomain = classifyExplicitFailure(primary.error, 'provider');
    if (!failureDomain) {
      // A pre-planned fallback is still a retry. Do not replay semantic/model
      // outcomes on another provider: make the untouched lane terminal and
      // preserve the primary failure as the saga result.
      await store.update(saga.id, (current) => {
        const fallback = current.steps[fallbackIdx];
        if (fallback?.status === 'pending') fallback.status = 'skipped';
        current.status = 'failed';
        current.completedAt = current.completedAt ?? Date.now();
        return current;
      });
      this.emitSagaUpdate(saga.id);
      return;
    }
    await this.runStep(store, saga.id, fallbackIdx);
  }

  private async runStep(
    store: SagaStoreShape,
    sagaId: string,
    laneIndex: number,
  ): Promise<void> {
    const saga = await store.load(sagaId);
    if (!saga) return;
    const step = saga.steps[laneIndex];
    if (!step) return;
    // Operator cancelled — don't fire (or re-fire) anything for this saga.
    if (this.cancelRequested.has(sagaId) || saga.status === 'cancelled' || step.status === 'cancelled') {
      return;
    }

    // Mark running + emit.
    await store.update(sagaId, (s) => {
      const target = s.steps[laneIndex];
      if (target && target.status === 'pending') {
        target.status = 'running';
      }
      return s;
    });
    await this.beginStepAttempt(store, sagaId, laneIndex, step);
    this.emitSagaUpdate(sagaId);

    // Fire peer.dispatch.
    let runId: string;
    try {
      const params = {
        prompt: this.buildStepPrompt(saga, step),
        model: step.model,
        ...(step.provider && step.provider !== 'unknown'
          ? { provider: step.provider }
          : {}),
        // Chain steps use the step's role as dispatch profile (so a
        // `review` step asks the remote peer to operate under the
        // review profile). Non-chain steps inherit the saga's overall
        // profile from metadata.
        dispatchProfile:
          step.lane === 'chain' && step.role
            ? readDispatchProfile(step.role)
            : readDispatchProfile(saga.metadata?.dispatchProfile),
      };
      const response = (await this.fleetBridge.peerRequest(
        step.peerId,
        'peer.dispatch',
        params,
        { timeoutMs: DISPATCH_TIMEOUT_MS },
      )) as {
        runId?: string;
        providerRequested?: string;
        providerResolved?: string;
        toolPolicy?: DispatchToolPolicyShape;
        toolDecisions?: DispatchToolDecisionShape[];
        toolset?: DispatchHermesToolsetShape;
      } | null;
      if (!response || typeof response.runId !== 'string') {
        throw new Error('peer.dispatch returned no runId');
      }
      runId = response.runId;
      await store.update(sagaId, (s) => {
        const target = s.steps[laneIndex];
        if (target) {
          target.runId = runId;
          applyDispatchMetadata(target, response);
          const attempt = findRunningAttempt(target);
          if (attempt) {
            attempt.runId = runId;
            if (response.providerRequested) {
              attempt.providerRequested = response.providerRequested;
            }
            if (response.providerResolved) {
              attempt.providerResolved = response.providerResolved;
            }
          }
        }
        return s;
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const failureDomain = classifyExplicitFailure(message, 'dispatch');
      logWarn('[saga-runner] peer.dispatch failed', {
        sagaId,
        laneIndex,
        peerId: step.peerId,
        error: message,
      });
      await this.finishStepAttempt(
        store,
        sagaId,
        laneIndex,
        'failed',
        message,
        failureDomain ?? undefined,
      );
      if (
        failureDomain &&
        await this.retryChainStepOnAlternateLane(
          store,
          sagaId,
          laneIndex,
          step,
          failureDomain,
        )
      ) {
        this.emitSagaUpdate(sagaId);
        await this.runStep(store, sagaId, laneIndex);
        return;
      }
      await store.failStep(sagaId, laneIndex, `dispatch_failed: ${message}`);
      this.emitSagaUpdate(sagaId);
      return;
    }

    // Poll status.
    const result = await this.pollStatus(step.peerId, runId, () => this.cancelRequested.has(sagaId));
    // Cancelled while in flight — the store already holds the cancelled
    // statuses; completing/failing/retrying the step would resurrect them.
    if (this.cancelRequested.has(sagaId)) return;
    if (
      hasDispatchMetadata(result) ||
      Boolean(result.providerRequested) ||
      Boolean(result.providerResolved)
    ) {
      await store.update(sagaId, (s) => {
        const target = s.steps[laneIndex];
        if (target) {
          applyDispatchMetadata(target, result);
          const attempt = findRunningAttempt(target);
          if (attempt) {
            if (result.providerRequested) {
              attempt.providerRequested = result.providerRequested;
            }
            if (result.providerResolved) {
              attempt.providerResolved = result.providerResolved;
            }
          }
        }
        return s;
      });
    }
    if (result.status === 'completed') {
      await this.finishStepAttempt(store, sagaId, laneIndex, 'completed');
      await store.completeStep(sagaId, laneIndex, result.result ?? '');
      this.emitSagaUpdate(sagaId);
      return;
    }
    const failureDomain = classifyExplicitFailure(result.error, 'provider');
    await this.finishStepAttempt(
      store,
      sagaId,
      laneIndex,
      'failed',
      result.error ?? `terminal status: ${result.status}`,
      failureDomain ?? undefined,
    );
    if (
      failureDomain &&
      await this.retryChainStepOnAlternateLane(
        store,
        sagaId,
        laneIndex,
        step,
        failureDomain,
      )
    ) {
      this.emitSagaUpdate(sagaId);
      await this.runStep(store, sagaId, laneIndex);
      return;
    }
    if (result.status === 'failed') {
      await store.failStep(sagaId, laneIndex, result.error ?? 'unknown_error');
    } else {
      // 'cancelled' or polling timeout — record as failed for now.
      await store.failStep(sagaId, laneIndex, `poll_terminal_unknown: ${result.status}`);
    }
    this.emitSagaUpdate(sagaId);
  }

  private async beginStepAttempt(
    store: SagaStoreShape,
    sagaId: string,
    laneIndex: number,
    step: SagaStepShape,
  ): Promise<void> {
    await store.update(sagaId, (saga) => {
      const target = saga.steps[laneIndex];
      if (!target) return saga;
      const attempt: SagaStepAttemptShape = {
        peerId: step.peerId,
        model: step.model,
        ...(step.provider && step.provider !== 'unknown'
          ? { providerRequested: step.provider }
          : {}),
        status: 'running',
        startedAt: Date.now(),
      };
      target.attempts = [...(target.attempts ?? []), attempt];
      return saga;
    });
  }

  private async finishStepAttempt(
    store: SagaStoreShape,
    sagaId: string,
    laneIndex: number,
    status: 'completed' | 'failed',
    error?: string,
    failureDomain?: FailureDomain,
  ): Promise<void> {
    await store.update(sagaId, (saga) => {
      const target = saga.steps[laneIndex];
      if (!target) return saga;
      const attempt = findRunningAttempt(target);
      if (!attempt) return saga;
      attempt.status = status;
      attempt.completedAt = Date.now();
      if (error) attempt.error = redactAttemptError(error);
      if (failureDomain) attempt.failureDomain = failureDomain;
      return saga;
    });
  }

  /**
   * Re-route one failed chain attempt while preserving its role. Provider
   * failures exclude only the failed backend (same peer remains eligible);
   * peer transport/timeouts exclude the machine. `retried` caps this to one
   * failover, and semantic failures never call this method.
   */
  private async retryChainStepOnAlternateLane(
    store: SagaStoreShape,
    sagaId: string,
    laneIndex: number,
    failedStep: SagaStepShape,
    failureDomain: FailureDomain,
  ): Promise<boolean> {
    if (failedStep.lane !== 'chain' || !failedStep.role || failedStep.retried) {
      return false;
    }
    try {
      type RouterMod = {
        TaskRouter: new () => {
          plan: (
            cls: Record<string, unknown>,
            peers: Array<{ peerId: string; capability: unknown }>,
            constraints?: {
              requiredRole?: string;
              excludePeerIds?: string[];
              excludeProviders?: string[];
              privacyTag?: unknown;
            },
          ) => {
            primary: { peerId: string; model: string; provider?: string };
          };
        };
      };
      type ClsMod = {
        classifyTaskComplexity: (msg: string) => Record<string, unknown>;
      };
      const [routerMod, clsMod] = await Promise.all([
        loadCoreModule<RouterMod>('fleet/task-router.js'),
        loadCoreModule<ClsMod>('optimization/model-routing.js'),
      ]);
      if (!routerMod || !clsMod) {
        logWarn('[saga-runner] retry: router/classifier modules unavailable');
        return false;
      }
      const saga = await store.load(sagaId);
      if (!saga) return false;
      const currentStep = saga.steps[laneIndex];
      if (!currentStep || currentStep.retried) return false;

      const failedProvider =
        currentStep.provider && currentStep.provider !== 'unknown'
          ? currentStep.provider
          : currentStep.attempts?.at(-1)?.providerResolved ??
            currentStep.attempts?.at(-1)?.providerRequested;
      if (failureDomain === 'provider' && !failedProvider) {
        logWarn('[saga-runner] retry: failed provider is unknown; refusing ambiguous replay', {
          sagaId,
          laneIndex,
        });
        return false;
      }

      const peers = (await Promise.resolve(this.fleetBridge.listPeers())) as Array<
        { id: string; capability?: unknown }
      >;
      const peerSlots = peers
        .filter((p) => Boolean(p.capability))
        .map((p) => ({ peerId: p.id, capability: p.capability as unknown }));
      if (peerSlots.length === 0) return false;

      const classification = clsMod.classifyTaskComplexity(saga.goal);
      const router = new routerMod.TaskRouter();
      const altPlan = router.plan(classification, peerSlots, {
        requiredRole: failedStep.role,
        ...(failureDomain === 'peer'
          ? { excludePeerIds: [currentStep.peerId] }
          : { excludeProviders: [failedProvider!] }),
        privacyTag: saga.metadata?.privacyTag,
      });
      const altPeerId = altPlan.primary.peerId;
      const altModel = altPlan.primary.model;
      const altProvider = altPlan.primary.provider;
      if (
        altPeerId === currentStep.peerId &&
        altModel === currentStep.model &&
        altProvider === currentStep.provider
      ) {
        logWarn('[saga-runner] retry: router returned the failed lane unchanged', {
          sagaId,
          laneIndex,
          failureDomain,
        });
        return false;
      }
      await store.update(sagaId, (s) => {
        const target = s.steps[laneIndex];
        if (!target) return s;
        target.peerId = altPeerId;
        target.model = altModel;
        target.provider = altProvider;
        target.status = 'pending';
        target.retried = true;
        target.runId = undefined;
        target.error = undefined;
        return s;
      });
      logWarn('[saga-runner] chain step retried on alternate failure domain', {
        sagaId,
        laneIndex,
        failureDomain,
        fromPeer: currentStep.peerId,
        fromProvider: failedProvider,
        toPeer: altPeerId,
        toProvider: altProvider,
        role: failedStep.role,
      });
      return true;
    } catch (err) {
      // NoPeerAvailableError or any router throw — chain breaks.
      logWarn('[saga-runner] retry: no alternate failure domain found', {
        sagaId,
        laneIndex,
        role: failedStep.role,
        failureDomain,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  private async pollStatus(
    peerId: string,
    runId: string,
    shouldAbort?: () => boolean,
  ): Promise<{
    status: SagaStepShape['status'];
    providerRequested?: string;
    providerResolved?: string;
    toolPolicy?: DispatchToolPolicyShape;
    toolDecisions?: DispatchToolDecisionShape[];
    toolset?: DispatchHermesToolsetShape;
    result?: string;
    error?: string;
  }> {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (shouldAbort?.()) {
        return { status: 'cancelled', error: 'cancelled_by_operator' };
      }
      try {
        const response = (await this.fleetBridge.peerRequest(
          peerId,
          'peer.dispatchStatus',
          { runId },
          { timeoutMs: 10_000 },
        )) as DispatchStatusResponse | null;
        if (response?.found && response.status) {
          if (
            response.status === 'completed' ||
            response.status === 'failed' ||
            response.status === 'cancelled'
          ) {
            return {
              status: response.status,
              providerRequested: response.providerRequested,
              providerResolved: response.providerResolved,
              toolPolicy: response.toolPolicy,
              toolDecisions: response.toolDecisions,
              toolset: response.toolset,
              result: response.result,
              error: response.error,
            };
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logWarn('[saga-runner] poll dispatchStatus failed', {
          peerId,
          runId,
          error: message,
        });
        // Single transient failure shouldn't kill the saga — keep polling.
      }
      await sleep(POLL_INTERVAL_MS);
    }
    return { status: 'failed', error: 'poll_timeout' };
  }

  private async maybeFinalise(store: SagaStoreShape, sagaId: string): Promise<void> {
    const saga = await store.load(sagaId);
    if (!saga) return;
    if (saga.status === 'completed' && saga.finalResult) return;
    // A cancelled saga stays cancelled — aggregating the steps that did
    // complete before the cancel would flip it back to 'completed'.
    if (saga.status === 'cancelled' || this.cancelRequested.has(sagaId)) return;

    const aggMod = await loadCoreModule<AggregatorModule>('fleet/result-aggregator.js');
    if (!aggMod) {
      logWarn('[saga-runner] result-aggregator module unavailable');
      return;
    }

    const isChainSaga =
      saga.steps.length > 0 && saga.steps.every((s) => s.lane === 'chain');
    const isParallel = (saga.plan.parallel?.length ?? 0) > 0;
    let finalText: string | null = null;
    // Captured when this is a council saga, so we can propose a review lesson
    // from the agreement summary after the saga is durably finalised (B1).
    let councilConsensus: ConsensusSummaryShape | null = null;
    try {
      if (isChainSaga) {
        // Chain saga: the final result is the LAST step's output.
        // Earlier steps' outputs are already woven into later prompts
        // via buildStepPrompt — no LLM aggregation needed.
        const lastStep = saga.steps[saga.steps.length - 1];
        if (lastStep && lastStep.status === 'completed' && lastStep.result) {
          finalText = lastStep.result;
        }
      } else if (isParallel) {
        const completedCount = saga.steps.filter((s) => s.status === 'completed').length;
        if (completedCount === 0) {
          // Nothing to aggregate — leave saga in failed state.
          return;
        }
        if (
          saga.metadata?.aggregation === 'consensus' &&
          typeof aggMod.aggregateWithConsensus === 'function'
        ) {
          // Council mode — arbitrate the N answers and persist the
          // agreement summary so the Council viewer can render the gauge
          // without recomputing it.
          const { finalText: text, consensus } = await aggMod.aggregateWithConsensus(saga);
          finalText = text;
          councilConsensus = consensus;
          await store.update(sagaId, (s) => {
            s.metadata = { ...(s.metadata ?? {}), consensus };
            return s;
          });
        } else {
          finalText = await aggMod.aggregateParallelResults(saga);
        }
      } else {
        finalText = aggMod.finaliseFromSingle(saga);
      }
    } catch (err) {
      logError('[saga-runner] aggregator threw:', err);
      return;
    }

    if (finalText !== null && finalText !== undefined) {
      await store.finalise(sagaId, finalText);
      this.emitSagaUpdate(sagaId);

      // Close the autonomy loop: a council outcome that diverged (or only
      // reached sub-threshold consensus) becomes a review-gated lesson
      // candidate. Best-effort, host-resolved workDir — never blocks finalise.
      if (councilConsensus) {
        await this.proposeCouncilLesson(saga, councilConsensus);
      }
    }
  }

  /**
   * B1 — turn a council outcome into a proposed lesson candidate for review.
   * Host-resolved workDir (the active project's `.codebuddy/`), so it lands
   * exactly where the Cowork LessonCandidatePanel reads. Fully best-effort.
   */
  private async proposeCouncilLesson(
    saga: SagaShape,
    consensus: ConsensusSummaryShape,
  ): Promise<void> {
    try {
      const workDir = this.workDirResolver();
      if (!workDir) {
        log('[saga-runner] no active project workDir — skipping council lesson proposal', {
          sagaId: saga.id,
        });
        return;
      }
      const mod = await loadCoreModule<CouncilProposerModule>('agent/council-lesson-proposer.js');
      if (!mod?.proposeFromCouncilOutcome) {
        logWarn('[saga-runner] council-lesson-proposer core module unavailable');
        return;
      }
      const result = mod.proposeFromCouncilOutcome(
        {
          sagaId: saga.id,
          goal: saga.goal,
          aggregation:
            typeof saga.metadata?.aggregation === 'string' ? saga.metadata.aggregation : undefined,
          consensus: {
            score: consensus.score,
            threshold: consensus.threshold,
            total: consensus.total,
            disagreements: consensus.disagreements,
          },
        },
        workDir,
      );
      if (result.proposed && result.candidate) {
        log('[saga-runner] council outcome proposed a lesson candidate for review', {
          sagaId: saga.id,
          candidateId: result.candidate.id,
        });
        // Nudge the renderer so the council strip can badge "lesson proposed".
        this.emitSagaUpdate(saga.id);
      } else {
        log('[saga-runner] council outcome did not propose a lesson', {
          sagaId: saga.id,
          reason: result.reason,
        });
      }
    } catch (err) {
      logWarn('[saga-runner] council lesson proposal failed (ignored):', err);
    }
  }

  private emitSagaUpdate(sagaId: string): void {
    this.sendToRenderer({
      type: 'fleet.saga.update',
      payload: { sagaId },
    });
  }

  private async recordTerminalActivity(
    store: SagaStoreShape,
    sagaId: string,
  ): Promise<void> {
    if (!this.activityFeed) return;

    const saga = await store.load(sagaId);
    if (!saga) return;
    if (saga.status !== 'completed' && saga.status !== 'failed') {
      // 'cancelled' is recorded by cancel() itself — recording it here too
      // would double-count the saga in the activity feed.
      return;
    }

    const completedSteps = saga.steps.filter((step) => step.status === 'completed').length;
    const failedSteps = saga.steps.filter((step) => step.status === 'failed').length;
    const toolDecisionCounts = countToolDecisions(saga.steps);
    const toolsetIds = collectToolsetIds(saga.steps);
    const internetProofSummary = summarizeInternetProofPlan(saga.metadata?.internetProofPlan);
    const lineageMetadata = buildSagaLineageActivityMetadata(saga.metadata);
    const errorSummary = saga.steps
      .filter((step) => step.status === 'failed' && step.error)
      .map((step) => `${step.peerId}: ${step.error}`)
      .join('; ');
    const terminalType =
      saga.status === 'completed' ? 'fleet.saga.completed' : 'fleet.saga.failed';

    this.activityFeed.record({
      type: terminalType,
      title: saga.status === 'completed' ? 'Fleet saga completed' : 'Fleet saga failed',
      description: truncateActivityText(saga.goal, 140),
      metadata: {
        sagaId: saga.id,
        ...lineageMetadata,
        status: saga.status,
        completedSteps,
        failedSteps,
        totalSteps: saga.steps.length,
        toolDecisionCount: toolDecisionCounts.total,
        toolAllowCount: toolDecisionCounts.allow,
        toolConfirmCount: toolDecisionCounts.confirm,
        toolDenyCount: toolDecisionCounts.deny,
        toolsetId: toolsetIds.length === 1 ? toolsetIds[0] : undefined,
        toolsetIds: toolsetIds.length > 0 ? toolsetIds : undefined,
        internetProofStepCount: internetProofSummary?.stepCount,
        internetProofRequiredCount: internetProofSummary?.requiredCount,
        internetProofAssertionCount: internetProofSummary?.assertionCount,
        internetProofTools: internetProofSummary?.tools,
        internetProofSteps: internetProofSummary?.steps,
        privacyTag: saga.metadata?.privacyTag,
        dispatchProfile: saga.metadata?.dispatchProfile,
        hermesPlanId: saga.metadata?.hermesPlanId,
        hermesPlanProfile: saga.metadata?.hermesPlanProfile,
        hermesPlanSurface: saga.metadata?.hermesPlanSurface,
        durationMs: saga.completedAt ? Math.max(0, saga.completedAt - saga.createdAt) : undefined,
        finalResultPreview: saga.finalResult
          ? truncateActivityText(saga.finalResult, 180)
          : undefined,
        errorSummary: errorSummary ? truncateActivityText(errorSummary, 180) : undefined,
      },
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findRunningAttempt(step: SagaStepShape): SagaStepAttemptShape | undefined {
  const attempts = step.attempts ?? [];
  for (let index = attempts.length - 1; index >= 0; index--) {
    const attempt = attempts[index];
    if (attempt?.status === 'running') return attempt;
  }
  return undefined;
}

function hasDispatchMetadata(input: {
  toolPolicy?: DispatchToolPolicyShape;
  toolDecisions?: DispatchToolDecisionShape[];
  toolset?: DispatchHermesToolsetShape;
}): boolean {
  return Boolean(input.toolPolicy || input.toolDecisions || input.toolset);
}

function applyDispatchMetadata(
  target: SagaStepShape,
  input: {
    toolPolicy?: DispatchToolPolicyShape;
    toolDecisions?: DispatchToolDecisionShape[];
    toolset?: DispatchHermesToolsetShape;
  },
): void {
  if (input.toolPolicy) target.toolPolicy = input.toolPolicy;
  if (input.toolDecisions) target.toolDecisions = input.toolDecisions;
  if (input.toolset) target.toolset = input.toolset;
}

function truncateActivityText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function countToolDecisions(steps: SagaStepShape[]): {
  allow: number;
  confirm: number;
  deny: number;
  total: number;
} {
  const counts = {
    allow: 0,
    confirm: 0,
    deny: 0,
    total: 0,
  };

  for (const step of steps) {
    for (const decision of step.toolDecisions ?? []) {
      counts.total++;
      if (decision.action === 'allow') {
        counts.allow++;
      } else if (decision.action === 'deny') {
        counts.deny++;
      } else {
        counts.confirm++;
      }
    }
  }

  return counts;
}

function collectToolsetIds(steps: SagaStepShape[]): string[] {
  return Array.from(
    new Set(
      steps
        .map((step) => step.toolset?.toolsetId)
        .filter((toolsetId): toolsetId is string =>
          typeof toolsetId === 'string' && toolsetId.trim().length > 0,
        ),
    ),
  );
}

function buildSagaLineageActivityMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!metadata) return {};
  const result: Record<string, unknown> = {};
  copyOptionalMetadataString(result, metadata, 'agentRunId');
  copyOptionalMetadataString(result, metadata, 'parentRunId');
  copyOptionalMetadataString(result, metadata, 'outcomeId');
  copyOptionalMetadataString(result, metadata, 'scheduleTaskId');
  copyOptionalMetadataString(result, metadata, 'sourceSessionId');
  copyOptionalMetadataString(result, metadata, 'deliveryChannel');
  copyOptionalMetadataNumber(result, metadata, 'agentRunSchemaVersion');
  copyOptionalMetadataNumber(result, metadata, 'memoryCount');

  const targetPeerIds = metadataStringList(metadata.targetPeerIds);
  if (targetPeerIds.length > 0) result.targetPeerIds = targetPeerIds;
  const targetPeerLabels = metadataStringList(metadata.targetPeerLabels);
  if (targetPeerLabels.length > 0) result.targetPeerLabels = targetPeerLabels;

  return result;
}

function copyOptionalMetadataString(
  target: Record<string, unknown>,
  metadata: Record<string, unknown>,
  key: string,
): void {
  const value = metadata[key];
  if (typeof value !== 'string') return;
  const trimmed = value.trim();
  if (!trimmed) return;
  target[key] = trimmed;
}

function copyOptionalMetadataNumber(
  target: Record<string, unknown>,
  metadata: Record<string, unknown>,
  key: string,
): void {
  const value = metadata[key];
  if (typeof value === 'number' && Number.isFinite(value)) {
    target[key] = value;
  }
}

function metadataStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

function summarizeInternetProofPlan(value: unknown): {
  assertionCount: number;
  requiredCount: number;
  stepCount: number;
  steps: Array<Record<string, unknown>>;
  tools: string[];
} | null {
  if (!isRecord(value) || !Array.isArray(value.steps)) return null;

  const tools = new Set<string>();
  let assertionCount = 0;
  let requiredCount = 0;
  let stepCount = 0;
  const steps: Array<Record<string, unknown>> = [];

  for (const rawStep of value.steps) {
    if (!isRecord(rawStep)) continue;
    stepCount++;

    if (rawStep.required === true) requiredCount++;
    if (typeof rawStep.tool === 'string') tools.add(rawStep.tool);
    if (typeof rawStep.tool === 'string' && steps.length < 8) {
      steps.push({
        ...(typeof rawStep.id === 'string' ? { id: rawStep.id } : {}),
        ...(typeof rawStep.title === 'string' ? { title: rawStep.title } : {}),
        tool: rawStep.tool,
        ...(typeof rawStep.action === 'string' ? { action: rawStep.action } : {}),
        ...(typeof rawStep.evidence === 'string' ? { evidence: rawStep.evidence } : {}),
        ...(typeof rawStep.required === 'boolean' ? { required: rawStep.required } : {}),
      });
    }

    const evidence = typeof rawStep.evidence === 'string' ? rawStep.evidence : '';
    const action = typeof rawStep.action === 'string' ? rawStep.action : '';
    if (`${evidence} ${action}`.toLowerCase().includes('assert')) {
      assertionCount++;
    }
  }

  if (stepCount === 0) return null;
  return {
    assertionCount,
    requiredCount,
    stepCount,
    steps,
    tools: [...tools],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
