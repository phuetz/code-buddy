/**
 * Smoke tests for SagaRunner — the dispatch glue that fires
 * peer.dispatch, polls peer.dispatchStatus, and finalises sagas
 * via the result aggregator.
 *
 * The core fleet modules (`fleet/saga-store.js`, `fleet/result-aggregator.js`)
 * are mocked via the `core-loader` shim so the runner doesn't need
 * a real ~/.codebuddy/sagas/ directory or a real LLM client.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

// Hoist shared test state so the vi.mock factory can reference it.
const state = vi.hoisted(() => {
  type SagaStep = {
    peerId: string;
    model: string;
    lane: 'primary' | 'fallback' | 'parallel';
    runId?: string;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
    result?: string;
    error?: string;
  };
  type Saga = {
    id: string;
    goal: string;
    plan: {
      primary: { peerId: string; model: string };
      fallback?: { peerId: string; model: string };
      parallel?: Array<{ peerId: string; model: string }>;
    };
    steps: SagaStep[];
    status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
    finalResult?: string;
  };
  return {
    sagas: new Map<string, Saga>(),
    aggregateCalls: [] as Saga[],
    finaliseFromSingleCalls: [] as Saga[],
  };
});

vi.mock('../src/main/utils/core-loader', () => ({
  loadCoreModule: vi.fn(async (relPath: string) => {
    if (relPath === 'fleet/saga-store.js') {
      return {
        getSagaStore: () => ({
          load: async (id: string) => state.sagas.get(id) ?? null,
          update: async (
            id: string,
            mutator: (s: unknown) => unknown | Promise<unknown>,
          ) => {
            const cur = state.sagas.get(id);
            if (!cur) return null;
            const next = (await mutator(cur)) as typeof cur;
            state.sagas.set(id, next);
            return next;
          },
          completeStep: async (id: string, idx: number, result: string) => {
            const cur = state.sagas.get(id);
            if (!cur) return null;
            cur.steps[idx].status = 'completed';
            cur.steps[idx].result = result;
            return cur;
          },
          failStep: async (id: string, idx: number, error: string) => {
            const cur = state.sagas.get(id);
            if (!cur) return null;
            cur.steps[idx].status = 'failed';
            cur.steps[idx].error = error;
            return cur;
          },
          finalise: async (id: string, finalResult: string) => {
            const cur = state.sagas.get(id);
            if (!cur) return null;
            cur.finalResult = finalResult;
            cur.status = 'completed';
            return cur;
          },
        }),
      };
    }
    if (relPath === 'fleet/result-aggregator.js') {
      return {
        aggregateParallelResults: vi.fn(async (saga: unknown) => {
          state.aggregateCalls.push(saga as never);
          return 'AGGREGATED';
        }),
        finaliseFromSingle: vi.fn((saga: unknown) => {
          state.finaliseFromSingleCalls.push(saga as never);
          return 'SINGLE_FINAL';
        }),
      };
    }
    return null;
  }),
}));

vi.mock('../src/main/utils/logger', () => ({
  log: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

import { SagaRunner } from '../src/main/fleet/saga-runner';

function makeFleetBridgeMock(
  responses: Record<string, (params: Record<string, unknown>) => Promise<unknown>>,
) {
  return {
    peerRequest: vi.fn(async (peerId: string, method: string, params = {}) => {
      const handler = responses[`${peerId}:${method}`] ?? responses[method];
      if (!handler) throw new Error(`unmocked ${peerId}:${method}`);
      return handler(params as Record<string, unknown>);
    }),
  } as unknown as Parameters<typeof SagaRunner>[0] extends never
    ? never
    : ConstructorParameters<typeof SagaRunner>[0];
}

function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('waitFor timeout'));
      setTimeout(tick, 25);
    };
    tick();
  });
}

beforeEach(() => {
  state.sagas.clear();
  state.aggregateCalls.length = 0;
  state.finaliseFromSingleCalls.length = 0;
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout'] });
  vi.setConfig({ testTimeout: 10_000 });
});

describe('SagaRunner — sequential primary success', () => {
  it('fires peer.dispatch then polls dispatchStatus then finalises via finaliseFromSingle', async () => {
    state.sagas.set('saga_seq_ok', {
      id: 'saga_seq_ok',
      goal: 'hello',
      plan: { primary: { peerId: 'peer-a', model: 'm1' } },
      steps: [{ peerId: 'peer-a', model: 'm1', lane: 'primary', status: 'pending' }],
      status: 'pending',
    });

    const sendToRenderer = vi.fn();
    const fleetBridge = makeFleetBridgeMock({
      'peer.dispatch': async () => ({ runId: 'run-1' }),
      'peer.dispatchStatus': async () => ({ found: true, status: 'completed', result: 'OK' }),
      'peer.dispatchClear': async () => ({ runId: 'run-1', cleared: true }),
    });

    const runner = new SagaRunner(fleetBridge as never, sendToRenderer);
    runner.start('saga_seq_ok');

    await waitFor(() => state.sagas.get('saga_seq_ok')?.status === 'completed');

    const saga = state.sagas.get('saga_seq_ok')!;
    expect(saga.steps[0].status).toBe('completed');
    expect(saga.steps[0].runId).toBe('run-1');
    expect(saga.finalResult).toBe('SINGLE_FINAL');
    expect(state.finaliseFromSingleCalls.length).toBe(1);
    expect(state.aggregateCalls.length).toBe(0);
    expect(fleetBridge.peerRequest).toHaveBeenCalledWith(
      'peer-a',
      'peer.dispatchClear',
      { runId: 'run-1' },
      { timeoutMs: 5_000 },
    );
    expect(sendToRenderer).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'fleet.saga.update' }),
    );
  });
});

describe('SagaRunner — parallel all success', () => {
  it('fires every parallel step then aggregates', async () => {
    state.sagas.set('saga_par', {
      id: 'saga_par',
      goal: 'parallel',
      plan: {
        primary: { peerId: 'peer-a', model: 'm1' },
        parallel: [
          { peerId: 'peer-a', model: 'm1' },
          { peerId: 'peer-b', model: 'm2' },
        ],
      },
      steps: [
        { peerId: 'peer-a', model: 'm1', lane: 'parallel', status: 'pending' },
        { peerId: 'peer-b', model: 'm2', lane: 'parallel', status: 'pending' },
      ],
      status: 'pending',
    });

    let dispatchCounter = 0;
    const fleetBridge = makeFleetBridgeMock({
      'peer.dispatch': async () => ({ runId: `run-${++dispatchCounter}` }),
      'peer.dispatchStatus': async (params) => ({
        found: true,
        status: 'completed',
        result: `result-${params.runId}`,
      }),
    });

    const runner = new SagaRunner(fleetBridge as never, vi.fn());
    runner.start('saga_par');

    await waitFor(
      () => state.sagas.get('saga_par')?.finalResult !== undefined,
      5_000,
    );

    const saga = state.sagas.get('saga_par')!;
    expect(saga.steps.every((s) => s.status === 'completed')).toBe(true);
    expect(saga.finalResult).toBe('AGGREGATED');
    expect(state.aggregateCalls.length).toBe(1);
  });
});

describe('SagaRunner — primary fails, fallback fires', () => {
  it('fires fallback when primary peer.dispatch throws', async () => {
    state.sagas.set('saga_fb', {
      id: 'saga_fb',
      goal: 'fallback test',
      plan: {
        primary: { peerId: 'peer-a', model: 'm1' },
        fallback: { peerId: 'peer-b', model: 'm2' },
      },
      steps: [
        { peerId: 'peer-a', model: 'm1', lane: 'primary', status: 'pending' },
        { peerId: 'peer-b', model: 'm2', lane: 'fallback', status: 'pending' },
      ],
      status: 'pending',
    });

    const fleetBridge = makeFleetBridgeMock({
      'peer-a:peer.dispatch': async () => {
        throw new Error('peer-a unavailable');
      },
      'peer-b:peer.dispatch': async () => ({ runId: 'fb-run' }),
      'peer.dispatchStatus': async () => ({
        found: true,
        status: 'completed',
        result: 'FALLBACK_OK',
      }),
    });

    const runner = new SagaRunner(fleetBridge as never, vi.fn());
    runner.start('saga_fb');

    await waitFor(
      () => state.sagas.get('saga_fb')?.steps[1].status === 'completed',
      5_000,
    );

    const saga = state.sagas.get('saga_fb')!;
    expect(saga.steps[0].status).toBe('failed');
    expect(saga.steps[0].error).toContain('peer-a unavailable');
    expect(saga.steps[1].status).toBe('completed');
    expect(saga.steps[1].result).toBe('FALLBACK_OK');
  });
});
