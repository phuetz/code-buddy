import { beforeEach, describe, expect, it, vi } from 'vitest';

const electronMock = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  return {
    handlers,
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    }),
  };
});

const coreLoaderMock = vi.hoisted(() => ({
  loadCoreModule: vi.fn(),
}));

const sagaRunnerMock = vi.hoisted(() => ({
  instances: [] as Array<{ start: ReturnType<typeof vi.fn> }>,
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: electronMock.handle,
  },
}));

vi.mock('../src/main/fleet/saga-runner', () => ({
  SagaRunner: class {
    start = vi.fn();

    constructor() {
      sagaRunnerMock.instances.push(this);
    }
  },
}));

vi.mock('../src/main/ipc-main-bridge', () => ({
  sendToRenderer: vi.fn(),
}));

vi.mock('../src/main/utils/core-loader', () => ({
  loadCoreModule: coreLoaderMock.loadCoreModule,
}));

vi.mock('../src/main/utils/logger', () => ({
  log: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

import { dispatchFleetSaga, registerFleetIpcHandlers } from '../src/main/ipc/fleet-ipc';
import type { FleetBridge } from '../src/main/fleet/fleet-bridge';

describe('registerFleetIpcHandlers', () => {
  beforeEach(() => {
    electronMock.handlers.clear();
    electronMock.handle.mockClear();
    coreLoaderMock.loadCoreModule.mockReset();
    sagaRunnerMock.instances = [];
  });

  it('wires manual Fleet capability refresh through IPC', async () => {
    const refreshCapabilities = vi.fn(async (peerId?: string) => ({
      success: true,
      peer: peerId ? { id: peerId } : undefined,
    }));
    const bridge = { refreshCapabilities } as unknown as FleetBridge;

    registerFleetIpcHandlers(bridge);

    const handler = electronMock.handlers.get('fleet.refreshCapabilities');
    expect(handler).toBeDefined();

    const result = await handler?.({}, 'ministar-linux');
    expect(refreshCapabilities).toHaveBeenCalledWith('ministar-linux');
    expect(result).toEqual({ success: true, peer: { id: 'ministar-linux' } });
  });

  it('returns a structured refresh error when FleetBridge is unavailable', async () => {
    registerFleetIpcHandlers(null);

    const handler = electronMock.handlers.get('fleet.refreshCapabilities');
    expect(handler).toBeDefined();

    await expect(handler?.({})).resolves.toEqual({
      success: false,
      error: 'FleetBridge not initialized',
    });
  });

  it('resolves FleetBridge lazily so startup-time IPC registration works', async () => {
    let bridge: FleetBridge | null = null;
    registerFleetIpcHandlers(() => bridge);

    const listHandler = electronMock.handlers.get('fleet.list');
    expect(listHandler).toBeDefined();
    await expect(listHandler?.({})).resolves.toEqual([]);

    const peers = [{ id: 'ministar-linux', status: 'connected' }];
    bridge = {
      listPeers: vi.fn(async () => peers),
    } as unknown as FleetBridge;

    await expect(listHandler?.({})).resolves.toEqual(peers);
  });

  it('refuses Fleet dispatch when no peer has known capabilities', async () => {
    const modules = installDispatchCoreModules();
    const bridge = {
      listPeers: vi.fn(async () => [{ id: 'ministar-linux' }]),
    } as unknown as FleetBridge;

    registerFleetIpcHandlers(bridge);

    const handler = electronMock.handlers.get('fleet.dispatch');
    expect(handler).toBeDefined();

    await expect(handler?.({}, { goal: 'Audit the CLI' })).resolves.toEqual({
      ok: false,
      error:
        'No peer with known capabilities — use the Command Center refresh button, then verify the peer key has both fleet:listen and peer:invoke scopes.',
    });
    expect(modules.createSaga).not.toHaveBeenCalled();
  });

  it('rejects invalid dispatchProfile values before routing', async () => {
    const modules = installDispatchCoreModules();
    const bridge = {
      listPeers: vi.fn(async () => [
        {
          id: 'ministar-linux',
          capability: {
            egress: 'cloud',
            models: [
              {
                id: 'gpt-5.1-codex',
                provider: 'chatgpt-oauth',
                contextWindow: 200_000,
                strengths: ['code'],
              },
            ],
          },
        },
      ]),
    } as unknown as FleetBridge;

    registerFleetIpcHandlers(bridge);

    const handler = electronMock.handlers.get('fleet.dispatch');
    expect(handler).toBeDefined();

    const result = await handler?.({}, {
      goal: 'Audit the CLI',
      dispatchProfile: 'chaos',
    });

    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining('dispatchProfile must be one of'),
    });
    expect(modules.plan).not.toHaveBeenCalled();
    expect(modules.createSaga).not.toHaveBeenCalled();
  });

  it('dispatches a Fleet saga using peer.describe capability slots', async () => {
    const modules = installDispatchCoreModules();
    const activityFeed = { record: vi.fn() };
    const capability = {
      egress: 'cloud',
      models: [
        {
          id: 'gpt-5.1-codex',
          provider: 'chatgpt-oauth',
          contextWindow: 200_000,
          strengths: ['code'],
        },
      ],
    };
    const bridge = {
      listPeers: vi.fn(async () => [{ id: 'ministar-linux', capability }]),
    } as unknown as FleetBridge;

    registerFleetIpcHandlers(bridge, activityFeed as never);

    const handler = electronMock.handlers.get('fleet.dispatch');
    expect(handler).toBeDefined();

    const result = await handler?.({}, {
      goal: 'Audit the CLI',
      parallelism: 2,
      privacyTag: 'public',
      dispatchProfile: 'review',
      targetPeerIds: [' ministar-linux ', 'ministar-linux', ''],
      targetPeerLabels: [' MiniStar ', ''],
      agentRunId: 'run-dispatch123456',
      parentRunId: 'run-parent123456',
      outcomeId: 'outcome-abcdef123456',
      scheduleTaskId: 'task-abcdef123456',
      sourceSessionId: 'session-source123456',
      deliveryChannel: 'cowork-manual',
      memoryCount: 2,
    });

    expect(modules.plan).toHaveBeenCalledWith(
      { kind: 'coding' },
      [{ peerId: 'ministar-linux', capability }],
      expect.objectContaining({
        parallelism: 2,
        privacyTag: 'public',
        dispatchProfile: 'review',
        targetPeerIds: ['ministar-linux'],
      }),
    );
    expect(modules.createSaga).toHaveBeenCalledWith(
      expect.objectContaining({
        goal: 'Audit the CLI',
        plan: modules.dispatchPlan,
        metadata: expect.objectContaining({
          targetPeerIds: ['ministar-linux'],
          targetPeerLabels: ['MiniStar'],
          agentRunId: 'run-dispatch123456',
          parentRunId: 'run-parent123456',
          outcomeId: 'outcome-abcdef123456',
          scheduleTaskId: 'task-abcdef123456',
          sourceSessionId: 'session-source123456',
          deliveryChannel: 'cowork-manual',
          memoryCount: 2,
        }),
      }),
    );
    expect(sagaRunnerMock.instances[0].start).toHaveBeenCalledWith('saga-1');
    expect(result).toMatchObject({
      ok: true,
      sagaId: 'saga-1',
      privacyTag: 'public',
      dispatchProfile: 'review',
    });
    expect(activityFeed.record).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'fleet.dispatch',
        title: 'Fleet saga started',
        description: 'Audit the CLI',
        metadata: expect.objectContaining({
          sagaId: 'saga-1',
          peerCount: 1,
          privacyTag: 'public',
          dispatchProfile: 'review',
          parallelism: 2,
          targetPeerIds: ['ministar-linux'],
          targetPeerLabels: ['MiniStar'],
          targetPeerCount: 1,
          agentRunId: 'run-dispatch123456',
          parentRunId: 'run-parent123456',
          outcomeId: 'outcome-abcdef123456',
          scheduleTaskId: 'task-abcdef123456',
          sourceSessionId: 'session-source123456',
          deliveryChannel: 'cowork-manual',
          memoryCount: 2,
        }),
      }),
    );
  });

  it('exposes the same Fleet dispatch service for scheduled tasks', async () => {
    const modules = installDispatchCoreModules();
    const activityFeed = { record: vi.fn() };
    const sagaRunner = { start: vi.fn() };
    const capability = {
      egress: 'cloud',
      models: [
        {
          id: 'gpt-5.1-codex',
          provider: 'chatgpt-oauth',
          contextWindow: 200_000,
          strengths: ['review'],
        },
      ],
    };
    const bridge = {
      listPeers: vi.fn(async () => [{ id: 'ministar-linux', capability }]),
    } as unknown as FleetBridge;

    const result = await dispatchFleetSaga(
      {
        goal: 'Scheduled review from Cowork',
        privacyTag: 'sensitive',
        dispatchProfile: 'review',
        hermesPlanId: 'hermes-integration-plan',
        hermesPlanProfile: 'safe',
        hermesPlanSurface: 'cowork',
        targetPeerIds: ['ministar-linux'],
        targetPeerLabels: ['MiniStar'],
        agentRunId: 'run-scheduled123456',
        agentRunSchemaVersion: 1,
        parentRunId: 'run-parent123456',
        outcomeId: 'outcome-abcdef123456',
        scheduleTaskId: 'task-abcdef123456',
        sourceSessionId: 'session-source123456',
        deliveryChannel: 'cowork-schedule',
        memoryCount: 3,
      },
      {
        fleetBridge: bridge,
        sagaRunner,
        activityFeed: activityFeed as never,
      },
    );

    expect(result).toMatchObject({
      ok: true,
      sagaId: 'saga-1',
      privacyTag: 'sensitive',
      dispatchProfile: 'review',
    });
    expect(modules.plan).toHaveBeenCalledWith(
      { kind: 'coding' },
      [{ peerId: 'ministar-linux', capability }],
      expect.objectContaining({
        privacyTag: 'sensitive',
        dispatchProfile: 'review',
        targetPeerIds: ['ministar-linux'],
      }),
    );
    expect(modules.createSaga).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          hermesPlanId: 'hermes-integration-plan',
          hermesPlanProfile: 'safe',
          hermesPlanSurface: 'cowork',
          targetPeerLabels: ['MiniStar'],
          agentRunId: 'run-scheduled123456',
          agentRunSchemaVersion: 1,
          parentRunId: 'run-parent123456',
          outcomeId: 'outcome-abcdef123456',
          scheduleTaskId: 'task-abcdef123456',
          sourceSessionId: 'session-source123456',
          deliveryChannel: 'cowork-schedule',
          memoryCount: 3,
        }),
      }),
    );
    expect(sagaRunner.start).toHaveBeenCalledWith('saga-1');
    expect(activityFeed.record).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'fleet.dispatch',
        description: 'Scheduled review from Cowork',
        metadata: expect.objectContaining({
          hermesPlanId: 'hermes-integration-plan',
          hermesPlanProfile: 'safe',
          hermesPlanSurface: 'cowork',
          targetPeerLabels: ['MiniStar'],
          agentRunId: 'run-scheduled123456',
          agentRunSchemaVersion: 1,
          parentRunId: 'run-parent123456',
          outcomeId: 'outcome-abcdef123456',
          scheduleTaskId: 'task-abcdef123456',
          sourceSessionId: 'session-source123456',
          deliveryChannel: 'cowork-schedule',
          memoryCount: 3,
        }),
      }),
    );
  });

  it('attaches an internet proof plan to web Fleet dispatches', async () => {
    const modules = installDispatchCoreModules();
    const activityFeed = { record: vi.fn() };
    const capability = {
      egress: 'cloud',
      models: [
        {
          id: 'gpt-5.1-codex',
          provider: 'chatgpt-oauth',
          contextWindow: 200_000,
          strengths: ['research'],
        },
      ],
    };
    const bridge = {
      listPeers: vi.fn(async () => [{ id: 'ministar-linux', capability }]),
    } as unknown as FleetBridge;

    registerFleetIpcHandlers(bridge, activityFeed as never);

    const handler = electronMock.handlers.get('fleet.dispatch');
    expect(handler).toBeDefined();

    const result = await handler?.({}, {
      goal: 'Verify https://example.com with browser automation',
      dispatchProfile: 'research',
    });

    expect(result).toMatchObject({ ok: true, sagaId: 'saga-1' });
    expect(modules.buildInternetProofPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        goal: 'Verify https://example.com with browser automation',
        sourceUrl: 'https://example.com',
        requiresBrowser: true,
        persistWhenProven: true,
      }),
    );
    expect(modules.createSaga).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          internetProofPlan: modules.internetProofPlan,
        }),
      }),
    );
    expect(activityFeed.record).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'fleet.dispatch',
        metadata: expect.objectContaining({
          internetProofStepCount: 3,
          internetProofRequiredCount: 3,
          internetProofAssertionCount: 1,
          internetProofTools: ['web_fetch', 'browser'],
          internetProofSteps: [
            {
              id: 'static-read',
              tool: 'web_fetch',
              evidence: 'static-read',
              required: true,
            },
            {
              id: 'extract',
              tool: 'browser',
              action: 'extract',
              evidence: 'extraction',
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
        }),
      }),
    );
  });
});

function installDispatchCoreModules() {
  const dispatchPlan = {
    steps: [
      {
        peerId: 'ministar-linux',
        model: 'gpt-5.1-codex',
        lane: 'primary',
      },
    ],
  };
  const plan = vi.fn(() => dispatchPlan);
  const createSaga = vi.fn(async () => ({ id: 'saga-1' }));
  const internetProofPlan = {
    goal: 'Verify https://example.com with browser automation',
    sourceUrl: 'https://example.com',
    steps: [
      {
        id: 'static-read',
        tool: 'web_fetch',
        evidence: 'static-read',
        required: true,
      },
      {
        id: 'extract',
        tool: 'browser',
        action: 'extract',
        evidence: 'extraction',
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
  };
  const buildInternetProofPlan = vi.fn(() => internetProofPlan);

  coreLoaderMock.loadCoreModule.mockImplementation(async (moduleName: string) => {
    switch (moduleName) {
      case 'fleet/task-router.js':
        return { TaskRouter: class { plan = plan; } };
      case 'optimization/model-routing.js':
        return { classifyTaskComplexity: vi.fn(() => ({ kind: 'coding' })) };
      case 'fleet/saga-store.js':
        return { getSagaStore: () => ({ create: createSaga }) };
      case 'fleet/privacy-lint.js':
        return {
          scanForSecrets: vi.fn(() => ({
            hasSecrets: false,
            highConfidence: false,
            matches: [],
          })),
        };
      case 'fleet/cost-tracker.js':
        return { getCostTracker: () => ({ canSpend: vi.fn(async () => ({ ok: true })) }) };
      case 'browser-automation/internet-proof-plan.js':
        return { buildInternetProofPlan };
      default:
        return null;
    }
  });

  return { buildInternetProofPlan, createSaga, dispatchPlan, internetProofPlan, plan };
}

describe('buildSagaReplayInput', () => {
  it('replays the raw goal with the original routing intent (profile, sensitive, targets, parallelism)', async () => {
    const { buildSagaReplayInput } = await import('../src/main/ipc/fleet-ipc');

    const input = buildSagaReplayInput({
      id: 'saga_old',
      goal: '## Past fleet lessons\n- lesson\n\n## Goal\nreal goal',
      status: 'failed',
      plan: {},
      metadata: {
        rawGoal: 'real goal',
        dispatchProfile: 'review',
        privacyTag: 'sensitive',
        parallelism: 3,
        targetPeerIds: ['peer-a', 'peer-b'],
      },
    });

    // The augmented goal is NOT replayed — lessons would stack twice.
    expect(input.goal).toBe('real goal');
    expect(input.dispatchProfile).toBe('review');
    expect(input.privacyTag).toBe('sensitive');
    expect(input.parallelism).toBe(3);
    expect(input.targetPeerIds).toEqual(['peer-a', 'peer-b']);
    expect(input.chainRoles).toBeUndefined();
    expect(input.council).toBeUndefined();
  });

  it('reconstructs chain roles from the plan and drops parallelism for chain replays', async () => {
    const { buildSagaReplayInput } = await import('../src/main/ipc/fleet-ipc');

    const input = buildSagaReplayInput({
      id: 'saga_chain',
      goal: 'build it',
      status: 'completed',
      plan: { chain: [{ role: 'code' }, { role: 'review' }, { role: 'safe' }] },
      metadata: { parallelism: 2 },
    });

    expect(input.chainRoles).toEqual(['code', 'review', 'safe']);
    expect(input.parallelism).toBeUndefined();
    expect(input.council).toBeUndefined();
  });

  it('replays council sagas in council mode and never forces privacyTag=public', async () => {
    const { buildSagaReplayInput } = await import('../src/main/ipc/fleet-ipc');

    const input = buildSagaReplayInput({
      id: 'saga_council',
      goal: 'deliberate',
      status: 'cancelled',
      plan: {},
      metadata: { aggregation: 'consensus', parallelism: 2, privacyTag: 'public' },
    });

    expect(input.council).toBe(true);
    expect(input.parallelism).toBe(2);
    // A stored 'public' is dropped so the privacy lint re-decides on replay.
    expect(input.privacyTag).toBeUndefined();
  });
});
