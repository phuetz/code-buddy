import { describe, expect, it, vi } from 'vitest';
import type { Message, ServerEvent, Session } from '../src/renderer/types';

const mocks = vi.hoisted(() => ({
  loadCoreModule: vi.fn(),
  ensureLoaded: vi.fn(),
  getActive: vi.fn(),
  getDetail: vi.fn(),
}));

vi.mock('electron', () => {
  const app = {
    isPackaged: false,
    isReady: () => true,
    getPath: () => '/tmp',
    getVersion: () => '0.0.0',
  };
  const ipcMain = { on: vi.fn() };
  const shell = { openPath: vi.fn() };
  const electron = { app, ipcMain, shell };
  return { default: electron, ...electron };
});

vi.mock('../src/main/utils/core-loader', () => ({
  loadCoreModule: mocks.loadCoreModule,
}));

vi.mock('../src/main/identity/identity-bridge', () => ({
  getIdentityBridge: () => ({
    ensureLoaded: mocks.ensureLoaded,
    getActive: mocks.getActive,
    getDetail: mocks.getDetail,
  }),
}));

vi.mock('../src/main/reasoning/reasoning-bridge', () => ({
  getReasoningBridge: () => ({}),
}));

vi.mock('../src/main/reasoning/reasoning-capture', () => ({
  createReasoningCapture: () => ({
    push: vi.fn(),
    complete: vi.fn(),
  }),
}));

import { CodeBuddyEngineRunner } from '../src/main/engine/codebuddy-engine-runner';

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('CodeBuddyEngineRunner startup latency', () => {
  it('loads the persona and creates the safety checkpoint concurrently', async () => {
    const checkpointStarted = deferred<void>();
    const personaStarted = deferred<void>();
    const checkpointRelease = deferred<void>();
    const personaRelease = deferred<void>();

    mocks.loadCoreModule.mockResolvedValue({
      getGhostSnapshotManager: () => ({
        createSnapshot: async () => {
          checkpointStarted.resolve();
          await checkpointRelease.promise;
          return {
            id: 'snapshot-1',
            commitHash: 'abc123',
            description: 'turn',
            timestamp: new Date(1_700_000_000_000),
            turn: 1,
          };
        },
      }),
    });
    mocks.ensureLoaded.mockImplementation(async () => {
      personaStarted.resolve();
      await personaRelease.promise;
      return [];
    });
    mocks.getActive.mockReturnValue({
      id: 'workspace:persona/calm.md',
      name: 'Calm',
      source: 'workspace',
      kind: 'persona',
    });
    mocks.getDetail.mockResolvedValue({
      id: 'workspace:persona/calm.md',
      name: 'Calm',
      source: 'workspace',
      kind: 'persona',
      content: 'Be calm and direct.',
    });

    const events: ServerEvent[] = [];
    const saved: Message[] = [];
    const adapter = {
      runSession: vi.fn(async (
        _sessionId: string,
        _messages: Array<{ role: string; content: string }>,
        onEvent: (event: { type: string }) => void,
      ) => {
        onEvent({ type: 'done' });
        return { content: '' };
      }),
      cancel: vi.fn(),
      clearSession: vi.fn(),
    };
    const runner = new CodeBuddyEngineRunner(adapter, {
      sendToRenderer: (event) => events.push(event),
      saveMessage: (message) => saved.push(message),
    });
    const session: Session = {
      id: 'session-latency',
      title: 'Latency',
      status: 'idle',
      cwd: '/tmp/project',
      mountedPaths: [],
      allowedTools: [],
      memoryEnabled: false,
      permissionMode: 'plan',
      permissionModeOverride: 'default',
      createdAt: 0,
      updatedAt: 0,
    };

    const runPromise = runner.run(session, 'help me', []);
    const startResult = await Promise.race([
      Promise.all([checkpointStarted.promise, personaStarted.promise]).then(() => 'both'),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 250)),
    ]);

    checkpointRelease.resolve();
    personaRelease.resolve();
    await runPromise;

    expect(startResult).toBe('both');
    expect(adapter.runSession).toHaveBeenCalledTimes(1);
    const options = adapter.runSession.mock.calls[0]?.[3] as {
      systemPromptAppend?: string;
      permissionMode?: string;
    };
    expect(options.systemPromptAppend).toContain('Be calm and direct.');
    expect(options.permissionMode).toBe('default');
    const checkpoint = events.find((event) => event.type === 'checkpoint.created');
    expect((checkpoint?.payload as { snapshot: { timestamp: number } }).snapshot.timestamp)
      .toBe(1_700_000_000_000);
  });
});
