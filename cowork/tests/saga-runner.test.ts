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
    lane: 'primary' | 'fallback' | 'parallel' | 'chain';
    role?: string;
    dependsOn?: number;
    /** Phase H — set when SagaRunner reassigns the step on an alternate peer. */
    retried?: boolean;
    runId?: string;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
    toolPolicy?: {
      profile?: string;
      policyProfile?: string;
      defaultAction?: string;
      summary?: string;
    };
    toolDecisions?: Array<{
      tool: string;
      action: string;
      matchedGroup?: string;
    }>;
    toolset?: {
      toolsetId?: string;
      deniedTools?: string[];
      allowedTools?: string[];
      confirmTools?: string[];
    };
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
    metadata?: Record<string, unknown>;
    createdAt?: number;
    completedAt?: number;
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
            // For chain sagas, only mark the whole saga complete when
            // the LAST step finishes — otherwise the runner's chain
            // loop would exit early. Mirrors core deriveSagaStatus.
            const isChain =
              cur.steps.length > 0 && cur.steps.every((s) => s.lane === 'chain');
            if (isChain) {
              const last = cur.steps[cur.steps.length - 1];
              if (last && last.status === 'completed') {
                cur.status = 'completed';
                cur.completedAt = Date.now();
              } else {
                cur.status = 'running';
              }
            } else {
              cur.status = 'completed';
              cur.completedAt = Date.now();
            }
            return cur;
          },
          failStep: async (id: string, idx: number, error: string) => {
            const cur = state.sagas.get(id);
            if (!cur) return null;
            cur.steps[idx].status = 'failed';
            cur.steps[idx].error = error;
            cur.status = 'failed';
            cur.completedAt = Date.now();
            return cur;
          },
          finalise: async (id: string, finalResult: string) => {
            const cur = state.sagas.get(id);
            if (!cur) return null;
            cur.finalResult = finalResult;
            cur.status = 'completed';
            cur.completedAt = Date.now();
            return cur;
          },
          advanceChain: async (id: string) => {
            // Mirrors core SagaStore.advanceChain — flips the first
            // pending chain step whose predecessor is completed (or has
            // no predecessor) into 'running'.
            const cur = state.sagas.get(id);
            if (!cur) return null;
            for (let i = 0; i < cur.steps.length; i++) {
              const step = cur.steps[i];
              if (step.lane !== 'chain') continue;
              if (step.status !== 'pending') continue;
              if (step.dependsOn !== undefined) {
                const pred = cur.steps[step.dependsOn];
                if (!pred || pred.status !== 'completed') continue;
              }
              step.status = 'running';
              cur.status = 'running';
              return cur;
            }
            return cur;
          },
        }),
      };
    }
    if (relPath === 'fleet/task-router.js') {
      // Phase H mock — supports the retry helper's TaskRouter usage.
      // Tests opt-in by setting `state.alternatePeerForRole` to control
      // which peer is returned for a given role+exclude pair.
      return {
        TaskRouter: class {
          plan(
            _cls: unknown,
            peers: Array<{ peerId: string; capability: unknown }>,
            constraints: {
              requiredRole?: string;
              excludePeerIds?: string[];
            },
          ) {
            const exclude = new Set(constraints.excludePeerIds ?? []);
            const role = constraints.requiredRole;
            const alt = peers.find((p) => !exclude.has(p.peerId));
            if (!alt) {
              throw new Error('NoPeerAvailableError: no alt peer');
            }
            return {
              primary: { peerId: alt.peerId, model: `model-for-${role}` },
              rationale: 'retry alt',
            };
          }
        },
      };
    }
    if (relPath === 'optimization/model-routing.js') {
      return {
        classifyTaskComplexity: () => ({
          complexity: 'simple',
          requiresVision: false,
          requiresReasoning: false,
          requiresLongContext: false,
          estimatedTokens: 1000,
          confidence: 0.8,
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
          const typedSaga = saga as { steps: SagaStep[] };
          state.finaliseFromSingleCalls.push(typedSaga as never);
          const primary = typedSaga.steps.find((step) => step.lane === 'primary');
          if (primary?.status === 'completed' && primary.result) return primary.result;
          const fallback = typedSaga.steps.find((step) => step.lane === 'fallback');
          if (fallback?.status === 'completed' && fallback.result) return fallback.result;
          return null;
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
  opts: { peers?: Array<{ id: string; capability?: unknown }> } = {},
) {
  return {
    peerRequest: vi.fn(async (peerId: string, method: string, params = {}) => {
      const handler = responses[`${peerId}:${method}`] ?? responses[method];
      if (!handler) throw new Error(`unmocked ${peerId}:${method}`);
      return handler(params as Record<string, unknown>);
    }),
    listPeers: vi.fn(() => opts.peers ?? []),
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
      metadata: {
        privacyTag: 'public',
        dispatchProfile: 'code',
        hermesPlanId: 'hermes-integration-plan',
        hermesPlanProfile: 'safe',
        hermesPlanSurface: 'cowork',
        agentRunId: 'run-terminal123456',
        agentRunSchemaVersion: 1,
        parentRunId: 'run-parent123456',
        outcomeId: 'outcome-abcdef123456',
        scheduleTaskId: 'task-abcdef123456',
        sourceSessionId: 'session-source123456',
        deliveryChannel: 'cowork-schedule',
        memoryCount: 2,
        targetPeerIds: ['peer-a'],
        targetPeerLabels: ['Peer A'],
        internetProofPlan: {
          steps: [
            {
              id: 'discover',
              tool: 'web_search',
              evidence: 'discovery',
              required: true,
            },
            {
              id: 'assert',
              tool: 'browser',
              action: 'assert_text',
              evidence: 'assertion',
              required: true,
            },
          ],
        },
      },
      createdAt: Date.now() - 5_000,
    });

    const sendToRenderer = vi.fn();
    const activityFeed = { record: vi.fn() };
    const dispatchParams: Record<string, unknown>[] = [];
    const fleetBridge = makeFleetBridgeMock({
      'peer.dispatch': async (params) => {
        dispatchParams.push(params);
        return { runId: 'run-1' };
      },
      'peer.dispatchStatus': async () => ({
        found: true,
        status: 'completed',
        result: 'OK',
        toolPolicy: {
          profile: 'code',
          policyProfile: 'coding',
          defaultAction: 'confirm',
          summary: 'Code posture',
        },
        toolDecisions: [
          { tool: 'view_file', action: 'allow', matchedGroup: 'group:fs:read' },
          { tool: 'bash', action: 'confirm', matchedGroup: 'group:runtime:shell' },
        ],
        toolset: {
          toolsetId: 'fleet.hermes.code',
          allowedTools: ['view_file'],
          confirmTools: ['bash'],
          deniedTools: [],
        },
      }),
    });

    const runner = new SagaRunner(fleetBridge as never, sendToRenderer, activityFeed as never);
    runner.start('saga_seq_ok');

    await waitFor(() => state.sagas.get('saga_seq_ok')?.status === 'completed');
    await waitFor(() => activityFeed.record.mock.calls.length > 0);

    const saga = state.sagas.get('saga_seq_ok')!;
    expect(saga.steps[0].status).toBe('completed');
    expect(saga.steps[0].runId).toBe('run-1');
    expect(saga.finalResult).toBe('OK');
    expect(dispatchParams[0]).toMatchObject({
      prompt: 'hello',
      model: 'm1',
      dispatchProfile: 'code',
    });
    expect(saga.steps[0].toolPolicy).toMatchObject({
      profile: 'code',
      policyProfile: 'coding',
      summary: 'Code posture',
    });
    expect(saga.steps[0].toolDecisions).toEqual([
      { tool: 'view_file', action: 'allow', matchedGroup: 'group:fs:read' },
      { tool: 'bash', action: 'confirm', matchedGroup: 'group:runtime:shell' },
    ]);
    expect(saga.steps[0].toolset?.toolsetId).toBe('fleet.hermes.code');
    expect(state.finaliseFromSingleCalls.length).toBe(1);
    expect(state.aggregateCalls.length).toBe(0);
    expect(sendToRenderer).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'fleet.saga.update' }),
    );
    expect(activityFeed.record).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'fleet.saga.completed',
        title: 'Fleet saga completed',
        description: 'hello',
        metadata: expect.objectContaining({
          sagaId: 'saga_seq_ok',
          status: 'completed',
          completedSteps: 1,
          toolDecisionCount: 2,
          toolAllowCount: 1,
          toolConfirmCount: 1,
          toolDenyCount: 0,
          toolsetId: 'fleet.hermes.code',
          toolsetIds: ['fleet.hermes.code'],
          internetProofStepCount: 2,
          internetProofRequiredCount: 2,
          internetProofAssertionCount: 1,
          internetProofTools: ['web_search', 'browser'],
          internetProofSteps: [
            {
              id: 'discover',
              tool: 'web_search',
              evidence: 'discovery',
              required: true,
            },
            {
              id: 'assert',
              tool: 'browser',
              action: 'assert_text',
              evidence: 'assertion',
              required: true,
            },
          ],
          totalSteps: 1,
          privacyTag: 'public',
          dispatchProfile: 'code',
          hermesPlanId: 'hermes-integration-plan',
          hermesPlanProfile: 'safe',
          hermesPlanSurface: 'cowork',
          agentRunId: 'run-terminal123456',
          agentRunSchemaVersion: 1,
          parentRunId: 'run-parent123456',
          outcomeId: 'outcome-abcdef123456',
          scheduleTaskId: 'task-abcdef123456',
          sourceSessionId: 'session-source123456',
          deliveryChannel: 'cowork-schedule',
          memoryCount: 2,
          targetPeerIds: ['peer-a'],
          targetPeerLabels: ['Peer A'],
          finalResultPreview: 'OK',
        }),
      }),
    );
  });
});

describe('SagaRunner — terminal failure activity', () => {
  it('persists accepted dispatch toolset metadata before the first status poll', async () => {
    state.sagas.set('saga_accept_meta', {
      id: 'saga_accept_meta',
      goal: 'review safely',
      plan: { primary: { peerId: 'peer-a', model: 'reviewer' } },
      steps: [{ peerId: 'peer-a', model: 'reviewer', lane: 'primary', status: 'pending' }],
      status: 'pending',
      metadata: { dispatchProfile: 'review' },
      createdAt: Date.now() - 1_000,
    });

    const fleetBridge = makeFleetBridgeMock({
      'peer.dispatch': async () => ({
        runId: 'run-accept-meta',
        dispatchProfile: 'review',
        toolPolicy: {
          profile: 'review',
          policyProfile: 'minimal',
          defaultAction: 'confirm',
          summary: 'Review posture',
        },
        toolDecisions: [
          { tool: 'view_file', action: 'allow', matchedGroup: 'group:fs:read' },
          { tool: 'create_file', action: 'deny', matchedGroup: 'group:fs:write' },
        ],
        toolset: {
          toolsetId: 'fleet.hermes.review',
          allowedTools: ['view_file'],
          deniedTools: ['create_file'],
        },
      }),
      'peer.dispatchStatus': async () => {
        const step = state.sagas.get('saga_accept_meta')?.steps[0];
        expect(step?.runId).toBe('run-accept-meta');
        expect(step?.toolPolicy).toMatchObject({
          profile: 'review',
          policyProfile: 'minimal',
        });
        expect(step?.toolDecisions).toEqual([
          { tool: 'view_file', action: 'allow', matchedGroup: 'group:fs:read' },
          { tool: 'create_file', action: 'deny', matchedGroup: 'group:fs:write' },
        ]);
        expect(step?.toolset?.toolsetId).toBe('fleet.hermes.review');
        return {
          found: true,
          status: 'completed',
          result: 'ACCEPTED_META_OK',
        };
      },
    });

    const runner = new SagaRunner(fleetBridge as never, vi.fn());
    runner.start('saga_accept_meta');

    await waitFor(() => state.sagas.get('saga_accept_meta')?.status === 'completed');

    const step = state.sagas.get('saga_accept_meta')?.steps[0];
    expect(step?.toolset?.deniedTools).toEqual(['create_file']);
  });

  it('records a failed Fleet saga when no lane succeeds', async () => {
    state.sagas.set('saga_seq_fail', {
      id: 'saga_seq_fail',
      goal: 'doomed',
      plan: { primary: { peerId: 'peer-a', model: 'm1' } },
      steps: [{ peerId: 'peer-a', model: 'm1', lane: 'primary', status: 'pending' }],
      status: 'pending',
      metadata: { privacyTag: 'sensitive', dispatchProfile: 'safe' },
      createdAt: Date.now() - 1_000,
    });

    const activityFeed = { record: vi.fn() };
    const fleetBridge = makeFleetBridgeMock({
      'peer.dispatch': async () => {
        throw new Error('peer-a unavailable');
      },
    });

    const runner = new SagaRunner(fleetBridge as never, vi.fn(), activityFeed as never);
    runner.start('saga_seq_fail');

    await waitFor(() => activityFeed.record.mock.calls.length > 0);

    expect(activityFeed.record).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'fleet.saga.failed',
        title: 'Fleet saga failed',
        description: 'doomed',
        metadata: expect.objectContaining({
          sagaId: 'saga_seq_fail',
          status: 'failed',
          completedSteps: 0,
          failedSteps: 1,
          totalSteps: 1,
          privacyTag: 'sensitive',
          dispatchProfile: 'safe',
        }),
      }),
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

describe('SagaRunner — Hermes-style chain (Draft → Review → Test)', () => {
  it('runs chain steps in order, advancing each via advanceChain and threading prior results into prompts', async () => {
    state.sagas.set('saga_chain', {
      id: 'saga_chain',
      goal: 'Fix the off-by-one bug',
      plan: {
        primary: { peerId: 'drafter', model: 'm-draft' },
        chain: [
          { peerId: 'drafter', model: 'm-draft', role: 'code' },
          { peerId: 'reviewer', model: 'm-review', role: 'review' },
          { peerId: 'tester', model: 'm-test', role: 'safe' },
        ],
      },
      steps: [
        {
          peerId: 'drafter',
          model: 'm-draft',
          lane: 'chain',
          role: 'code',
          status: 'pending',
        },
        {
          peerId: 'reviewer',
          model: 'm-review',
          lane: 'chain',
          role: 'review',
          dependsOn: 0,
          status: 'pending',
        },
        {
          peerId: 'tester',
          model: 'm-test',
          lane: 'chain',
          role: 'safe',
          dependsOn: 1,
          status: 'pending',
        },
      ],
      status: 'pending',
    });

    const dispatchParams: Record<string, unknown>[] = [];
    let runCounter = 0;
    const fleetBridge = makeFleetBridgeMock({
      'peer.dispatch': async (params) => {
        dispatchParams.push(params);
        runCounter += 1;
        return { runId: `chain-run-${runCounter}` };
      },
      'peer.dispatchStatus': async (params) => {
        const runId = String(params.runId ?? '');
        // Each step returns a distinguishable result so we can assert
        // that the next step's prompt actually inherited the predecessor.
        const result =
          runId === 'chain-run-1'
            ? 'DRAFT_OK'
            : runId === 'chain-run-2'
              ? 'REVIEW_OK'
              : 'TEST_OK';
        return { found: true, status: 'completed', result };
      },
    });

    const runner = new SagaRunner(fleetBridge as never, vi.fn());
    runner.start('saga_chain');

    await waitFor(
      () => state.sagas.get('saga_chain')?.finalResult !== undefined,
      5_000,
    );

    const saga = state.sagas.get('saga_chain')!;
    // All three chain steps ran to completion.
    expect(saga.steps.map((s) => s.status)).toEqual([
      'completed',
      'completed',
      'completed',
    ]);
    // Chain final result is the LAST step's result (no LLM aggregation).
    expect(saga.finalResult).toBe('TEST_OK');
    expect(saga.status).toBe('completed');
    // Dispatch fired three times — once per chain step.
    expect(dispatchParams).toHaveLength(3);
    // Step 0 (Draft) uses the bare goal + 'code' profile.
    expect(dispatchParams[0]).toMatchObject({
      prompt: 'Fix the off-by-one bug',
      model: 'm-draft',
      dispatchProfile: 'code',
    });
    // Step 1 (Review) inherits the draft output + 'review' profile.
    expect(dispatchParams[1]).toMatchObject({
      model: 'm-review',
      dispatchProfile: 'review',
    });
    expect(String(dispatchParams[1].prompt)).toContain('DRAFT_OK');
    expect(String(dispatchParams[1].prompt)).toContain('Review this draft');
    // Step 2 (Test) inherits the reviewer's output + 'safe' profile.
    expect(dispatchParams[2]).toMatchObject({
      model: 'm-test',
      dispatchProfile: 'safe',
    });
    expect(String(dispatchParams[2].prompt)).toContain('REVIEW_OK');
    expect(String(dispatchParams[2].prompt)).toContain('Write tests');
    // Aggregator NOT called for chain sagas.
    expect(state.aggregateCalls.length).toBe(0);
    expect(state.finaliseFromSingleCalls.length).toBe(0);
  });

  it('breaks the chain on the first failed step (subsequent steps stay pending)', async () => {
    state.sagas.set('saga_chain_break', {
      id: 'saga_chain_break',
      goal: 'will fail at review',
      plan: {
        primary: { peerId: 'drafter', model: 'm-draft' },
        chain: [
          { peerId: 'drafter', model: 'm-draft', role: 'code' },
          { peerId: 'reviewer', model: 'm-review', role: 'review' },
          { peerId: 'tester', model: 'm-test', role: 'safe' },
        ],
      },
      steps: [
        {
          peerId: 'drafter',
          model: 'm-draft',
          lane: 'chain',
          role: 'code',
          status: 'pending',
        },
        {
          peerId: 'reviewer',
          model: 'm-review',
          lane: 'chain',
          role: 'review',
          dependsOn: 0,
          status: 'pending',
        },
        {
          peerId: 'tester',
          model: 'm-test',
          lane: 'chain',
          role: 'safe',
          dependsOn: 1,
          status: 'pending',
        },
      ],
      status: 'pending',
    });

    let runCounter = 0;
    const fleetBridge = makeFleetBridgeMock({
      'peer.dispatch': async () => {
        runCounter += 1;
        return { runId: `break-run-${runCounter}` };
      },
      'peer.dispatchStatus': async (params) => {
        const runId = String(params.runId ?? '');
        if (runId === 'break-run-2') {
          return { found: true, status: 'failed', error: 'review_rejected' };
        }
        return { found: true, status: 'completed', result: 'DRAFT_OK' };
      },
    });

    const runner = new SagaRunner(fleetBridge as never, vi.fn());
    runner.start('saga_chain_break');

    await waitFor(
      () => state.sagas.get('saga_chain_break')?.steps[1].status === 'failed',
      5_000,
    );

    const saga = state.sagas.get('saga_chain_break')!;
    expect(saga.steps[0].status).toBe('completed');
    expect(saga.steps[1].status).toBe('failed');
    expect(saga.steps[1].error).toContain('review_rejected');
    // Tester step never fires — chain broke.
    expect(saga.steps[2].status).toBe('pending');
    // Only 2 dispatches happened (no run on the tester).
    expect(runCounter).toBe(2);
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

describe('SagaRunner — Phase H chain step retry on stall', () => {
  it('reassigns a stalled chain step to an alternate peer with the same role and completes', async () => {
    state.sagas.set('saga_retry', {
      id: 'saga_retry',
      goal: 'Review my draft',
      plan: {
        primary: { peerId: 'drafter', model: 'm-draft' },
        chain: [
          { peerId: 'drafter', model: 'm-draft', role: 'code' },
          { peerId: 'reviewer-stall', model: 'm-review', role: 'review' },
        ],
      },
      steps: [
        {
          peerId: 'drafter',
          model: 'm-draft',
          lane: 'chain',
          role: 'code',
          status: 'pending',
        },
        {
          peerId: 'reviewer-stall',
          model: 'm-review',
          lane: 'chain',
          role: 'review',
          dependsOn: 0,
          status: 'pending',
        },
      ],
      status: 'pending',
    });

    let runIdCounter = 0;
    const dispatchCalls: Array<{ peerId: string; runId: string }> = [];
    const fleetBridge = makeFleetBridgeMock(
      {
        'peer.dispatch': async () => {
          runIdCounter += 1;
          return { runId: `retry-run-${runIdCounter}` };
        },
        'peer.dispatchStatus': async (params) => {
          const runId = String(params.runId ?? '');
          // runId 1 = drafter draft → completes immediately.
          if (runId === 'retry-run-1') {
            return { found: true, status: 'completed', result: 'DRAFT_DONE' };
          }
          // runId 2 = reviewer-stall → never reports terminal status
          // (pending forever) so pollStatus eventually hits its
          // 5-minute deadline. To keep the test fast, we instead
          // return `failed` with the exact `poll_timeout` error string
          // the runner emits on real stalls.
          if (runId === 'retry-run-2') {
            return { found: true, status: 'failed', error: 'poll_timeout' };
          }
          // runId 3 = alt-reviewer (after retry) → completes.
          return { found: true, status: 'completed', result: 'REVIEW_DONE_ALT' };
        },
      },
      {
        peers: [
          { id: 'reviewer-stall', capability: { roles: ['review'] } },
          { id: 'alt-reviewer', capability: { roles: ['review'] } },
        ],
      },
    );
    // Track which peers received dispatch.
    const originalPeerRequest = fleetBridge.peerRequest as ReturnType<typeof vi.fn>;
    originalPeerRequest.mockImplementation(
      async (peerId: string, method: string, params: Record<string, unknown> = {}) => {
        if (method === 'peer.dispatch') {
          runIdCounter += 1;
          const runId = `retry-run-${runIdCounter}`;
          dispatchCalls.push({ peerId, runId });
          return { runId };
        }
        if (method === 'peer.dispatchStatus') {
          const runId = String(params.runId ?? '');
          if (runId === 'retry-run-1') {
            return { found: true, status: 'completed', result: 'DRAFT_DONE' };
          }
          if (runId === 'retry-run-2') {
            return { found: true, status: 'failed', error: 'poll_timeout' };
          }
          return { found: true, status: 'completed', result: 'REVIEW_DONE_ALT' };
        }
        throw new Error(`unmocked ${peerId}:${method}`);
      },
    );
    runIdCounter = 0;

    const runner = new SagaRunner(fleetBridge as never, vi.fn());
    runner.start('saga_retry');

    await waitFor(
      () => state.sagas.get('saga_retry')?.finalResult !== undefined,
      5_000,
    );

    const saga = state.sagas.get('saga_retry')!;
    expect(saga.status).toBe('completed');
    expect(saga.finalResult).toBe('REVIEW_DONE_ALT');
    // Step 1 was reassigned from reviewer-stall to alt-reviewer.
    expect(saga.steps[1].peerId).toBe('alt-reviewer');
    expect(saga.steps[1].retried).toBe(true);
    expect(saga.steps[1].status).toBe('completed');
    // 3 dispatches happened: drafter, reviewer-stall, alt-reviewer.
    expect(dispatchCalls).toHaveLength(3);
    expect(dispatchCalls[1].peerId).toBe('reviewer-stall');
    expect(dispatchCalls[2].peerId).toBe('alt-reviewer');
  });

  it('breaks the chain when no alternate peer carries the required role', async () => {
    state.sagas.set('saga_no_alt', {
      id: 'saga_no_alt',
      goal: 'Review with no alt',
      plan: {
        primary: { peerId: 'lone', model: 'm' },
        chain: [
          { peerId: 'lone', model: 'm', role: 'code' },
          { peerId: 'lone', model: 'm', role: 'review' },
        ],
      },
      steps: [
        { peerId: 'lone', model: 'm', lane: 'chain', role: 'code', status: 'pending' },
        {
          peerId: 'lone',
          model: 'm',
          lane: 'chain',
          role: 'review',
          dependsOn: 0,
          status: 'pending',
        },
      ],
      status: 'pending',
    });

    let runIdCounter = 0;
    const fleetBridge = makeFleetBridgeMock(
      {
        'peer.dispatch': async () => {
          runIdCounter += 1;
          return { runId: `no-alt-${runIdCounter}` };
        },
        'peer.dispatchStatus': async (params) => {
          const runId = String(params.runId ?? '');
          if (runId === 'no-alt-1') {
            return { found: true, status: 'completed', result: 'DRAFT_DONE' };
          }
          // Reviewer stalls; only one peer exists so retry can't find alt.
          return { found: true, status: 'failed', error: 'poll_timeout' };
        },
      },
      { peers: [{ id: 'lone', capability: { roles: ['code', 'review'] } }] },
    );

    const runner = new SagaRunner(fleetBridge as never, vi.fn());
    runner.start('saga_no_alt');

    await waitFor(
      () => state.sagas.get('saga_no_alt')?.steps[1].status === 'failed',
      5_000,
    );

    const saga = state.sagas.get('saga_no_alt')!;
    // Step 1 stayed on the lone peer and failed — chain breaks.
    expect(saga.steps[1].peerId).toBe('lone');
    expect(saga.steps[1].status).toBe('failed');
    expect(saga.steps[1].retried).toBeUndefined();
    expect(saga.status).toBe('failed');
  });
});
