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
 *   5. Clears the remote peer's in-memory dispatch cache
 *   6. When all parallel steps are terminal, calls the result aggregator
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

// Wide types — the core fleet modules don't ship typings reachable
// from Cowork's tsconfig. Each shape mirrors the relevant exported
// surface.

interface DispatchLaneShape {
  peerId: string;
  model: string;
}

interface DispatchPlanShape {
  primary: DispatchLaneShape;
  fallback?: DispatchLaneShape;
  parallel?: DispatchLaneShape[];
}

interface SagaStepShape {
  peerId: string;
  model: string;
  lane: 'primary' | 'fallback' | 'parallel';
  runId?: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  result?: string;
  error?: string;
}

interface SagaShape {
  id: string;
  goal: string;
  plan: DispatchPlanShape;
  steps: SagaStepShape[];
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  finalResult?: string;
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
}

interface SagaStoreModule {
  getSagaStore: () => SagaStoreShape;
}

interface AggregatorModule {
  aggregateParallelResults: (saga: SagaShape) => Promise<string>;
  finaliseFromSingle: (saga: SagaShape) => string | null;
}

interface DispatchStatusResponse {
  found?: boolean;
  status?: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  result?: string;
  error?: string;
}

const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 5 * 60 * 1_000;
const DISPATCH_TIMEOUT_MS = 30_000;

export class SagaRunner {
  private readonly active = new Set<string>();

  constructor(
    private readonly fleetBridge: FleetBridge,
    private readonly sendToRenderer: (event: ServerEvent) => void,
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
    });
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

    const isParallel = (saga.plan.parallel?.length ?? 0) > 0;
    if (isParallel) {
      await this.runParallel(store, saga);
    } else {
      await this.runSequential(store, saga);
    }

    await this.maybeFinalise(store, sagaId);
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

    const fallbackIdx = refreshed.steps.findIndex((s) => s.lane === 'fallback');
    if (fallbackIdx < 0) return;
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

    // Mark running + emit.
    await store.update(sagaId, (s) => {
      const target = s.steps[laneIndex];
      if (target && target.status === 'pending') {
        target.status = 'running';
      }
      return s;
    });
    this.emitSagaUpdate(sagaId);

    // Fire peer.dispatch.
    let runId: string;
    try {
      const params = {
        prompt: saga.goal,
        model: step.model,
      };
      const response = (await this.fleetBridge.peerRequest(
        step.peerId,
        'peer.dispatch',
        params,
        { timeoutMs: DISPATCH_TIMEOUT_MS },
      )) as { runId?: string } | null;
      if (!response || typeof response.runId !== 'string') {
        throw new Error('peer.dispatch returned no runId');
      }
      runId = response.runId;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logWarn('[saga-runner] peer.dispatch failed', {
        sagaId,
        laneIndex,
        peerId: step.peerId,
        error: message,
      });
      await store.failStep(sagaId, laneIndex, `dispatch_failed: ${message}`);
      this.emitSagaUpdate(sagaId);
      return;
    }

    // Persist runId.
    await store.update(sagaId, (s) => {
      const target = s.steps[laneIndex];
      if (target) target.runId = runId;
      return s;
    });

    // Poll status.
    const result = await this.pollStatus(step.peerId, runId);
    if (result.status === 'completed') {
      await store.completeStep(sagaId, laneIndex, result.result ?? '');
    } else if (result.status === 'failed') {
      await store.failStep(sagaId, laneIndex, result.error ?? 'unknown_error');
    } else {
      // 'cancelled' or polling timeout — record as failed for now.
      await store.failStep(sagaId, laneIndex, `poll_terminal_unknown: ${result.status}`);
    }
    await this.clearRemoteDispatch(step.peerId, runId);
    this.emitSagaUpdate(sagaId);
  }

  private async pollStatus(
    peerId: string,
    runId: string,
  ): Promise<{ status: SagaStepShape['status']; result?: string; error?: string }> {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
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

  private async clearRemoteDispatch(peerId: string, runId: string): Promise<void> {
    try {
      await this.fleetBridge.peerRequest(
        peerId,
        'peer.dispatchClear',
        { runId },
        { timeoutMs: 5_000 },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logWarn('[saga-runner] dispatchClear failed', {
        peerId,
        runId,
        error: message,
      });
    }
  }

  private async maybeFinalise(store: SagaStoreShape, sagaId: string): Promise<void> {
    const saga = await store.load(sagaId);
    if (!saga) return;
    if (saga.status === 'completed' && saga.finalResult) return;

    const aggMod = await loadCoreModule<AggregatorModule>('fleet/result-aggregator.js');
    if (!aggMod) {
      logWarn('[saga-runner] result-aggregator module unavailable');
      return;
    }

    const isParallel = (saga.plan.parallel?.length ?? 0) > 0;
    let finalText: string | null = null;
    try {
      if (isParallel) {
        const completedCount = saga.steps.filter((s) => s.status === 'completed').length;
        if (completedCount === 0) {
          // Nothing to aggregate — leave saga in failed state.
          return;
        }
        finalText = await aggMod.aggregateParallelResults(saga);
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
    }
  }

  private emitSagaUpdate(sagaId: string): void {
    this.sendToRenderer({
      type: 'fleet.saga.update',
      payload: { sagaId },
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
