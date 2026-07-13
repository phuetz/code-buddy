import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  BrowserOperatorRuntimeEvent,
  BrowserOperatorRuntimeView,
  BrowserOperatorSessionDraftInput,
} from '../src/shared/browser-operator-runtime-types';

const electronMock = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  return {
    handlers,
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    }),
  };
});

vi.mock('electron', () => ({
  app: { getAppPath: vi.fn(() => '/app') },
  ipcMain: { handle: electronMock.handle },
}));

import { BrowserOperatorRuntimeBridge } from '../src/main/browser/browser-operator-runtime-bridge';
import { registerBrowserOperatorRuntimeIpcHandlers } from '../src/main/ipc/browser-operator-runtime-ipc';
import { BROWSER_OPERATOR_RUNTIME_CHANNELS } from '../src/shared/browser-operator-runtime-types';

const draft: BrowserOperatorSessionDraftInput = {
  schemaVersion: 1,
  sessionId: 'untrusted-model-id',
  generatedAt: '2026-07-12T00:00:00.000Z',
  goal: 'Open the documentation menu',
  query: 'documentation menu',
  sourceUrl: 'https://example.com/docs',
  mode: 'isolated',
  intent: 'research',
  dedicatedTab: { label: 'Docs', reason: 'Reviewed task' },
  consent: { required: true, granted: false, scopes: ['browser_interaction'], reason: 'Review' },
  stopControl: { enabled: true, label: 'Stop', stopConditions: ['captcha'] },
  actionLog: [{
    id: 'act',
    sequence: 1,
    status: 'planned',
    tool: 'browser',
    action: 'act',
    stage: 'interact',
    title: 'Open docs menu',
    evidence: 'user-action',
    requiresConsent: true,
    expectedArtifact: 'browser-action-log.jsonl',
    reason: 'Exact reviewed action',
    inputs: { instruction: 'open the documentation menu', maxActions: 1 },
  }],
  proofExport: { artifactName: 'draft.json', includes: ['action log'] },
};

function runtime(overrides: Partial<BrowserOperatorRuntimeView> = {}): BrowserOperatorRuntimeView {
  return {
    runtimeId: 'runtime-1',
    ownerSessionId: 'core-owner',
    workspaceRoot: '/active/project',
    draftHash: 'a'.repeat(64),
    state: 'prepared',
    goal: draft.goal,
    mode: 'isolated',
    interactionClass: 'interactive',
    sourceUrl: draft.sourceUrl!,
    actionCount: 2,
    createdAt: '2026-07-12T00:00:00.000Z',
    updatedAt: '2026-07-12T00:00:00.000Z',
    consent: null,
    ...overrides,
  };
}

function fakeRuntimeModule(calls: {
  prepare: Array<Record<string, unknown>>;
  starts: Array<Record<string, unknown>>;
  stops: Array<[string, string]>;
}) {
  return {
    BrowserOperatorRuntimeManager: class {
      private readonly onEvent?: (event: BrowserOperatorRuntimeEvent) => void;
      private current = runtime();

      constructor(options?: { onEvent?: (event: BrowserOperatorRuntimeEvent) => void }) {
        this.onEvent = options?.onEvent;
      }

      prepare(input: Record<string, unknown>) {
        calls.prepare.push(input);
        this.current = runtime({ ownerSessionId: String(input.ownerSessionId) });
        this.onEvent?.({ type: 'prepared', runtime: this.current });
        return this.current;
      }

      getPreparedDraft() {
        return { ...draft, sessionId: 'runtime-1' };
      }

      start(input: Record<string, unknown>) {
        calls.starts.push(input);
        this.current = runtime({
          ownerSessionId: String(input.ownerSessionId),
          state: 'running',
          consent: {
            draftHash: String(input.expectedDraftHash),
            approvedBy: String(input.approvedBy),
            approvedAt: '2026-07-12T00:01:00.000Z',
            scopes: ['browser_interaction'],
          },
        });
        this.onEvent?.({ type: 'started', runtime: this.current });
        return this.current;
      }

      stop(runtimeId: string, ownerSessionId: string) {
        calls.stops.push([runtimeId, ownerSessionId]);
        this.current = runtime({ ownerSessionId, state: 'stopping' });
        this.onEvent?.({ type: 'stopping', runtime: this.current });
        return true;
      }

      status() {
        return this.current;
      }

      list(ownerSessionId?: string) {
        return [runtime({ ownerSessionId: ownerSessionId ?? 'core-owner' })];
      }
    },
  };
}

describe('BrowserOperatorRuntimeBridge', () => {
  beforeEach(() => {
    electronMock.handlers.clear();
    electronMock.handle.mockClear();
  });

  it('pins execution to the active project and binds ownership to the renderer', async () => {
    const calls = { prepare: [] as Array<Record<string, unknown>>, starts: [] as Array<Record<string, unknown>>, stops: [] as Array<[string, string]> };
    const events: Array<{ rendererId: number; event: BrowserOperatorRuntimeEvent }> = [];
    const bridge = new BrowserOperatorRuntimeBridge({
      getWorkspaceRoot: () => '/active/project',
      loadRuntimeModule: async () => fakeRuntimeModule(calls),
      sendEvent: (rendererId, event) => events.push({ rendererId, event }),
    });

    const prepared = await bridge.prepare(7, { ownerSessionId: 'chat-42', draft });
    expect(prepared).toMatchObject({
      ok: true,
      runtime: { ownerSessionId: 'chat-42', workspaceRoot: '/active/project' },
      draft: { sessionId: 'runtime-1' },
    });
    expect(calls.prepare[0]).toMatchObject({
      ownerSessionId: 'cowork:7:chat-42',
      workspaceRoot: '/active/project',
    });

    const started = await bridge.start(7, {
      runtimeId: 'runtime-1',
      ownerSessionId: 'chat-42',
      expectedDraftHash: 'a'.repeat(64),
      approvedBy: 'Patrice',
    });
    expect(started).toMatchObject({ ok: true, runtime: { state: 'running' } });
    expect(calls.starts[0]).toMatchObject({
      ownerSessionId: 'cowork:7:chat-42',
      approvedBy: 'Patrice',
    });
    expect(events).toEqual([
      expect.objectContaining({
        rendererId: 7,
        event: expect.objectContaining({
          type: 'started',
          runtime: expect.objectContaining({ ownerSessionId: 'chat-42' }),
        }),
      }),
    ]);

    await expect(bridge.status(8, {
      runtimeId: 'runtime-1',
      ownerSessionId: 'chat-42',
    })).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/owner mismatch/i) });
  });

  it('fails closed without an active workspace or a core runtime module', async () => {
    const noProject = new BrowserOperatorRuntimeBridge({
      getWorkspaceRoot: () => null,
      loadRuntimeModule: async () => fakeRuntimeModule({ prepare: [], starts: [], stops: [] }),
    });
    await expect(noProject.prepare(1, { ownerSessionId: 'chat', draft })).resolves.toMatchObject({
      ok: false,
      error: expect.stringMatching(/active project/i),
    });

    const noCore = new BrowserOperatorRuntimeBridge({
      getWorkspaceRoot: () => '/active/project',
      loadRuntimeModule: async () => null,
    });
    await expect(noCore.prepare(1, { ownerSessionId: 'chat', draft })).resolves.toMatchObject({
      ok: false,
      error: expect.stringMatching(/module is unavailable/i),
    });
  });

  it('registers the five IPC handlers and uses the Electron sender identity', async () => {
    const bridge = {
      prepare: vi.fn(async () => ({ ok: true })),
      start: vi.fn(async () => ({ ok: true })),
      stop: vi.fn(async () => ({ ok: true })),
      status: vi.fn(async () => ({ ok: true })),
      list: vi.fn(async () => ({ ok: true })),
    };
    registerBrowserOperatorRuntimeIpcHandlers({
      getProjectManager: () => null,
      bridge: bridge as unknown as BrowserOperatorRuntimeBridge,
    });
    expect([...electronMock.handlers.keys()]).toEqual([
      BROWSER_OPERATOR_RUNTIME_CHANNELS.prepare,
      BROWSER_OPERATOR_RUNTIME_CHANNELS.start,
      BROWSER_OPERATOR_RUNTIME_CHANNELS.stop,
      BROWSER_OPERATOR_RUNTIME_CHANNELS.status,
      BROWSER_OPERATOR_RUNTIME_CHANNELS.list,
    ]);

    const sender = { id: 17, isDestroyed: () => false, send: vi.fn() };
    await electronMock.handlers.get(BROWSER_OPERATOR_RUNTIME_CHANNELS.prepare)?.(
      { sender },
      { ownerSessionId: 'chat', draft },
    );
    expect(bridge.prepare).toHaveBeenCalledWith(17, { ownerSessionId: 'chat', draft });
  });
});
