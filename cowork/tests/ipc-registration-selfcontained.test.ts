/**
 * Registration + self-contained coverage for the IPC groups extracted from
 * the `cowork/src/main/index.ts` god-file.
 *
 * Two aspects the refactor must not have broken:
 *
 *   1. Registration surface — every `register<Name>IpcHandlers(...)` wires its
 *      EXACT set of `<prefix>.<action>` channels, registers each exactly ONCE
 *      (no accidental double-register from the copy/paste extraction), and
 *      does not throw at registration time even when its injected services are
 *      still null.
 *   2. Self-contained groups — `workflow-service-ipc` (static WorkflowService)
 *      and `persona-ipc` (lazy-imported identity-bridge + sendToRenderer
 *      side-effect) forward their args to the underlying collaborator.
 *
 * electron `ipcMain.handle` is captured into a hoisted Map; the logger,
 * config-store, ipc-main-bridge and identity-bridge are mocked so nothing
 * touches the filesystem or the real renderer.
 */

// @vitest-environment node
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

vi.mock('electron', () => ({ ipcMain: { handle: electronMock.handle } }));
vi.mock('../src/main/utils/logger', () => ({
  log: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));
// clipboard-ipc reads the configStore singleton — stub it so importing the
// module (and invoking its handlers) never loads the real 1300-line store.
vi.mock('../src/main/config/config-store', () => ({
  configStore: {
    getAll: vi.fn(() => ({ clipboard: { monitoringEnabled: false } })),
    update: vi.fn(),
  },
}));
// persona-ipc collaborators.
const identityBridgeMock = vi.hoisted(() => ({
  bridge: {
    list: vi.fn(async () => [{ id: 'lisa' }]),
    getDetail: vi.fn(async (_id: string) => ({ id: 'lisa', detail: true })),
    activate: vi.fn(async (_id: string) => ({ success: true, active: { id: 'lisa' } })),
    deactivate: vi.fn(async () => ({ success: true })),
    getActive: vi.fn(() => ({ id: 'lisa' })),
  },
}));
vi.mock('../src/main/identity/identity-bridge', () => ({
  getIdentityBridge: () => identityBridgeMock.bridge,
}));
const sendToRendererMock = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('../src/main/ipc-main-bridge', () => ({ sendToRenderer: sendToRendererMock.fn }));
// workflow-service static collaborator.
const workflowServiceMock = vi.hoisted(() => ({
  start: vi.fn(async () => ({ running: true })),
  stop: vi.fn(async () => ({ running: false })),
  status: vi.fn(() => ({ running: false })),
  logs: vi.fn((_limit?: number) => ['boot line']),
}));
vi.mock('../src/main/workflow-service', () => ({ WorkflowService: workflowServiceMock }));

import { registerCostIpcHandlers } from '../src/main/ipc/cost-ipc';
import { registerRulesIpcHandlers } from '../src/main/ipc/rules-ipc';
import { registerBookmarksIpcHandlers } from '../src/main/ipc/bookmarks-ipc';
import { registerMemoryIpcHandlers } from '../src/main/ipc/memory-ipc';
import { registerSessionInsightsIpcHandlers } from '../src/main/ipc/session-insights-ipc';
import { registerTemplateIpcHandlers } from '../src/main/ipc/template-ipc';
import { registerPluginsIpcHandlers } from '../src/main/ipc/plugins-ipc';
import { registerClipboardIpcHandlers } from '../src/main/ipc/clipboard-ipc';
import { registerWorkflowServiceIpcHandlers } from '../src/main/ipc/workflow-service-ipc';
import { registerPersonaIpcHandlers } from '../src/main/ipc/persona-ipc';

const fakeEvent = {} as unknown;

function handler(channel: string): (...args: unknown[]) => unknown {
  const h = electronMock.handlers.get(channel);
  if (!h) throw new Error(`no handler registered for channel: ${channel}`);
  return h;
}

function registeredChannels(): string[] {
  return electronMock.handle.mock.calls.map((c) => c[0] as string);
}

beforeEach(() => {
  electronMock.handlers.clear();
  electronMock.handle.mockClear();
});

// ─────────────────────────────────────────────────────────────────────────
// 1. Registration surface — exact channels, exactly once, never throws
// ─────────────────────────────────────────────────────────────────────────
describe('IPC registration surface', () => {
  // Each entry registers the module with all-null getters (registration never
  // invokes the getters — they fire lazily inside handlers).
  const cases: Array<{ name: string; register: () => void; channels: string[] }> = [
    {
      name: 'cost-ipc',
      register: () => registerCostIpcHandlers({ getCostBridge: () => null }),
      channels: [
        'cost.summary',
        'cost.history',
        'cost.modelBreakdown',
        'cost.setBudget',
        'cost.setDailyLimit',
        'cost.record',
      ],
    },
    {
      name: 'rules-ipc',
      register: () =>
        registerRulesIpcHandlers({ getRulesBridge: () => null, getProjectManager: () => null }),
      channels: ['rules.list', 'rules.add', 'rules.remove', 'rules.update', 'rules.test'],
    },
    {
      name: 'bookmarks-ipc',
      register: () => registerBookmarksIpcHandlers({ getBookmarksService: () => null }),
      channels: [
        'bookmarks.toggle',
        'bookmarks.list',
        'bookmarks.forSession',
        'bookmarks.updateNote',
        'bookmarks.remove',
      ],
    },
    {
      name: 'memory-ipc',
      register: () =>
        registerMemoryIpcHandlers({
          getProjectManager: () => null,
          getProjectMemoryService: () => null,
        }),
      channels: ['memory.list', 'memory.add', 'memory.update', 'memory.delete'],
    },
    {
      name: 'session-insights-ipc',
      register: () =>
        registerSessionInsightsIpcHandlers({ getSessionInsightsBridge: () => null }),
      channels: [
        'sessionInsights.list',
        'sessionInsights.search',
        'sessionInsights.detail',
        'sessionInsights.recallPrefill',
        'sessionInsights.audit',
        'sessionInsights.repair',
      ],
    },
    {
      name: 'template-ipc',
      register: () => registerTemplateIpcHandlers({ getTemplateService: () => null }),
      channels: ['template.list', 'template.preview', 'template.create'],
    },
    {
      name: 'plugins-ipc',
      register: () =>
        registerPluginsIpcHandlers({
          getPluginRuntimeService: () => null,
          getSessionManager: () => null,
        }),
      channels: [
        'plugins.listCatalog',
        'plugins.listInstalled',
        'plugins.install',
        'plugins.setEnabled',
        'plugins.setComponentEnabled',
        'plugins.uninstall',
      ],
    },
    {
      name: 'clipboard-ipc',
      register: () => registerClipboardIpcHandlers({ getClipboardWatcher: () => null }),
      channels: ['clipboard.summarizeNow', 'clipboard.setMonitoring', 'clipboard.status'],
    },
    {
      name: 'workflow-service-ipc',
      register: () => registerWorkflowServiceIpcHandlers(),
      channels: ['workflow.start', 'workflow.stop', 'workflow.status', 'workflow.logs'],
    },
    {
      name: 'persona-ipc',
      register: () => registerPersonaIpcHandlers(),
      channels: [
        'identity.list',
        'identity.getDetail',
        'identity.activate',
        'identity.deactivate',
        'identity.getActive',
      ],
    },
  ];

  for (const c of cases) {
    describe(c.name, () => {
      it('registers without throwing', () => {
        expect(() => c.register()).not.toThrow();
      });

      it('wires exactly its expected channels, each exactly once', () => {
        c.register();
        const seen = registeredChannels();
        // exact set (no extra, none missing)
        expect(new Set(seen)).toEqual(new Set(c.channels));
        // every expected channel present + registered exactly once
        for (const ch of c.channels) {
          expect(seen.filter((s) => s === ch)).toHaveLength(1);
          expect(electronMock.handlers.get(ch)).toBeInstanceOf(Function);
        }
      });
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// 2a. workflow-service-ipc — self-contained, static collaborator pass-through
// ─────────────────────────────────────────────────────────────────────────
describe('workflow-service-ipc pass-through', () => {
  it('forwards to the static WorkflowService methods', async () => {
    registerWorkflowServiceIpcHandlers();

    await expect(handler('workflow.start')(fakeEvent)).resolves.toEqual({ running: true });
    expect(workflowServiceMock.start).toHaveBeenCalledTimes(1);

    expect(handler('workflow.logs')(fakeEvent, 5)).toEqual(['boot line']); // sync
    expect(workflowServiceMock.logs).toHaveBeenCalledWith(5);

    expect(handler('workflow.status')(fakeEvent)).toEqual({ running: false });
    expect(workflowServiceMock.status).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 2b. persona-ipc — self-contained, lazy-imported bridge + renderer side-effect
// ─────────────────────────────────────────────────────────────────────────
describe('persona-ipc pass-through', () => {
  it('forwards list/getDetail to the lazily-imported identity bridge', async () => {
    registerPersonaIpcHandlers();
    await expect(handler('identity.list')(fakeEvent)).resolves.toEqual([{ id: 'lisa' }]);
    expect(identityBridgeMock.bridge.list).toHaveBeenCalledTimes(1);

    await expect(handler('identity.getDetail')(fakeEvent, 'lisa')).resolves.toEqual({
      id: 'lisa',
      detail: true,
    });
    expect(identityBridgeMock.bridge.getDetail).toHaveBeenCalledWith('lisa');
  });

  it('activate() forwards the id AND broadcasts identity.activated on success', async () => {
    registerPersonaIpcHandlers();
    const result = await handler('identity.activate')(fakeEvent, 'lisa');
    expect(result).toEqual({ success: true, active: { id: 'lisa' } });
    expect(identityBridgeMock.bridge.activate).toHaveBeenCalledWith('lisa');
    expect(sendToRendererMock.fn).toHaveBeenCalledWith({
      type: 'identity.activated',
      payload: { id: 'lisa' },
    });
  });

  it('deactivate() broadcasts a null payload', async () => {
    registerPersonaIpcHandlers();
    await handler('identity.deactivate')(fakeEvent);
    expect(identityBridgeMock.bridge.deactivate).toHaveBeenCalledTimes(1);
    expect(sendToRendererMock.fn).toHaveBeenCalledWith({
      type: 'identity.activated',
      payload: null,
    });
  });
});
