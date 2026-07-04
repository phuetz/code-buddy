/**
 * Integration coverage for the accessor-injection IPC modules extracted from
 * the `cowork/src/main/index.ts` god-file.
 *
 * These `register<Name>IpcHandlers({ getX: () => x })` groups read their
 * dependencies LAZILY through getter closures over a runtime-reassigned
 * mutable (rebuilt when the DB opens, created after boot, …). The two
 * behaviours that the extraction MUST preserve — and that this file pins:
 *
 *   (a) lazy read: mutating what the getter returns AFTER `register...()`
 *       makes the handler observe the NEW value on the next call;
 *   (b) null-safety: a `null`/absent service is handled with the module's
 *       documented default ([] / {success:false} / a zero object / an
 *       intentional throw) instead of an unhandled crash.
 *
 * Plus a pass-through check that a representative handler forwards its args to
 * the underlying service.
 *
 * The electron `ipcMain.handle` is captured into a hoisted Map (the same
 * pattern as the existing mission-ipc.test.ts), and the logger is mocked so
 * these tests neither touch the filesystem nor spam the console.
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

import { registerCostIpcHandlers } from '../src/main/ipc/cost-ipc';
import { registerRulesIpcHandlers } from '../src/main/ipc/rules-ipc';
import { registerBookmarksIpcHandlers } from '../src/main/ipc/bookmarks-ipc';
import { registerMemoryIpcHandlers } from '../src/main/ipc/memory-ipc';
import { registerSessionInsightsIpcHandlers } from '../src/main/ipc/session-insights-ipc';
import { registerTemplateIpcHandlers } from '../src/main/ipc/template-ipc';
import { registerPluginsIpcHandlers } from '../src/main/ipc/plugins-ipc';

const fakeEvent = {} as unknown;

/** Grab a captured handler by channel; throws a clear message if unregistered. */
function handler(channel: string): (...args: unknown[]) => unknown {
  const h = electronMock.handlers.get(channel);
  if (!h) throw new Error(`no handler registered for channel: ${channel}`);
  return h;
}

beforeEach(() => {
  electronMock.handlers.clear();
  electronMock.handle.mockClear();
});

// ─────────────────────────────────────────────────────────────────────────
// cost-ipc — single accessor (getCostBridge)
// ─────────────────────────────────────────────────────────────────────────
describe('cost-ipc accessor injection', () => {
  function makeCostBridge() {
    return {
      getSummary: vi.fn(async () => ({ sessionCost: 42, dailyCost: 1 })),
      getDailyHistory: vi.fn((_days?: number) => [{ date: '2026-07-04', cost: 1 }]),
      getModelBreakdown: vi.fn((_days?: number) => [{ model: 'gpt', cost: 1 }]),
      setBudget: vi.fn(async () => {}),
      setDailyLimit: vi.fn(async () => {}),
      record: vi.fn(async () => {}),
    };
  }

  it('reads the CURRENT bridge lazily and defaults to a zero-summary when null', async () => {
    let bridge: ReturnType<typeof makeCostBridge> | null = null;
    registerCostIpcHandlers({ getCostBridge: () => bridge as never });

    // null → documented zero-summary default, no throw
    await expect(handler('cost.summary')(fakeEvent)).resolves.toEqual({
      sessionCost: 0,
      dailyCost: 0,
      weeklyCost: 0,
      monthlyCost: 0,
      totalCost: 0,
      sessionTokens: { input: 0, output: 0 },
      modelBreakdown: {},
    });
    expect(handler('cost.history')(fakeEvent, 7)).toEqual([]); // sync handler
    await expect(handler('cost.setBudget')(fakeEvent, 100)).resolves.toEqual({ success: false });

    // reassign the mutable AFTER register — handler must observe the new value
    bridge = makeCostBridge();
    await expect(handler('cost.summary')(fakeEvent)).resolves.toEqual({
      sessionCost: 42,
      dailyCost: 1,
    });
    expect(bridge.getSummary).toHaveBeenCalledTimes(1);
  });

  it('passes history/record args through to the current bridge', async () => {
    const bridge = makeCostBridge();
    registerCostIpcHandlers({ getCostBridge: () => bridge as never });

    await handler('cost.history')(fakeEvent, 14);
    expect(bridge.getDailyHistory).toHaveBeenCalledWith(14);

    await handler('cost.record')(fakeEvent, 100, 50, 'gpt-5.5', 0.02);
    expect(bridge.record).toHaveBeenCalledWith(100, 50, 'gpt-5.5', 0.02);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// rules-ipc — TWO accessors (getRulesBridge + getProjectManager)
// ─────────────────────────────────────────────────────────────────────────
describe('rules-ipc accessor injection', () => {
  function makeRulesBridge() {
    return {
      list: vi.fn(async (_root: string) => ({ allow: ['view_file'], deny: [] })),
      add: vi.fn(async () => ({ success: true })),
      remove: vi.fn(async () => ({ success: true })),
      update: vi.fn(async () => ({ success: true })),
      test: vi.fn(async () => ({ decision: 'allow' as const })),
    };
  }
  function makeProjectManager(workspacePath: string) {
    return {
      get: vi.fn((_id: string) => ({ workspacePath })),
      getActive: vi.fn(() => ({ workspacePath })),
    };
  }

  it('defaults to empty rule buckets when the bridge is null', async () => {
    registerRulesIpcHandlers({
      getRulesBridge: () => null,
      getProjectManager: () => null,
    });
    await expect(handler('rules.list')(fakeEvent)).resolves.toEqual({ allow: [], deny: [] });
    await expect(handler('rules.add')(fakeEvent, 'allow', 'ls(*)')).resolves.toEqual({
      success: false,
      error: 'Rules bridge unavailable',
    });
    await expect(handler('rules.test')(fakeEvent, 'view_file', {})).resolves.toEqual({
      decision: 'ask',
    });
  });

  it('resolves the workspace via the CURRENT project manager (lazy) and forwards it', async () => {
    const bridge = makeRulesBridge();
    let projectManager = makeProjectManager('/ws/old');
    registerRulesIpcHandlers({
      getRulesBridge: () => bridge as never,
      getProjectManager: () => projectManager as never,
    });

    await handler('rules.list')(fakeEvent);
    expect(bridge.list).toHaveBeenLastCalledWith('/ws/old');
    expect(projectManager.getActive).toHaveBeenCalled();

    // Reassign the project manager mutable — the getter must be re-read.
    projectManager = makeProjectManager('/ws/new');
    await handler('rules.list')(fakeEvent);
    expect(bridge.list).toHaveBeenLastCalledWith('/ws/new');

    // Explicit projectId routes through get(id), not getActive().
    await handler('rules.list')(fakeEvent, 'proj-7');
    expect(projectManager.get).toHaveBeenCalledWith('proj-7');
  });

  it('passes bucket/rule args through to add', async () => {
    const bridge = makeRulesBridge();
    registerRulesIpcHandlers({
      getRulesBridge: () => bridge as never,
      getProjectManager: () => makeProjectManager('/ws') as never,
    });
    await handler('rules.add')(fakeEvent, 'deny', 'rm(*)', 'proj-1');
    expect(bridge.add).toHaveBeenCalledWith('/ws', 'deny', 'rm(*)');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// bookmarks-ipc — single accessor + try/catch swallow
// ─────────────────────────────────────────────────────────────────────────
describe('bookmarks-ipc accessor injection', () => {
  function makeBookmarks() {
    return {
      toggle: vi.fn((_entry: unknown) => ({ bookmarked: true })),
      list: vi.fn((_projectId: string | null, _limit: number) => [{ id: 1 }]),
      getBookmarkedMessageIds: vi.fn((_sessionId: string) => ['m1']),
      updateNote: vi.fn((_id: number, _note: string) => true),
      remove: vi.fn((_id: number) => true),
    };
  }

  it('returns safe defaults when the service is null and observes it once set', async () => {
    let svc: ReturnType<typeof makeBookmarks> | null = null;
    registerBookmarksIpcHandlers({ getBookmarksService: () => svc as never });

    await expect(handler('bookmarks.toggle')(fakeEvent, { sessionId: 's', messageId: 'm', preview: 'p' }))
      .resolves.toEqual({ bookmarked: false });
    await expect(handler('bookmarks.list')(fakeEvent)).resolves.toEqual([]);
    await expect(handler('bookmarks.remove')(fakeEvent, 1)).resolves.toEqual({ success: false });

    svc = makeBookmarks();
    await expect(handler('bookmarks.toggle')(fakeEvent, { sessionId: 's', messageId: 'm', preview: 'p' }))
      .resolves.toEqual({ bookmarked: true });
  });

  it('swallows a throwing service into the safe default (try/catch preserved)', async () => {
    const svc = makeBookmarks();
    svc.toggle.mockImplementation(() => {
      throw new Error('db exploded');
    });
    registerBookmarksIpcHandlers({ getBookmarksService: () => svc as never });
    await expect(handler('bookmarks.toggle')(fakeEvent, { sessionId: 's', messageId: 'm', preview: 'p' }))
      .resolves.toEqual({ bookmarked: false });
  });

  it('passes list args (projectId + limit) through with documented defaults', async () => {
    const svc = makeBookmarks();
    registerBookmarksIpcHandlers({ getBookmarksService: () => svc as never });
    await handler('bookmarks.list')(fakeEvent); // no args → null + 100
    expect(svc.list).toHaveBeenLastCalledWith(null, 100);
    await handler('bookmarks.list')(fakeEvent, 'proj-9', 25);
    expect(svc.list).toHaveBeenLastCalledWith('proj-9', 25);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// memory-ipc — TWO accessors (getProjectManager + getProjectMemoryService)
// ─────────────────────────────────────────────────────────────────────────
describe('memory-ipc accessor injection', () => {
  function makeMemorySvc() {
    return {
      listMemoryEntries: vi.fn((_id: string) => [{ category: 'preference', content: 'x' }]),
      addMemoryEntry: vi.fn(() => ({ success: true })),
      updateMemoryEntry: vi.fn(() => ({ success: true })),
      deleteMemoryEntry: vi.fn(() => ({ success: true })),
    };
  }
  function makeProjectManager(activeId: string | null) {
    return { getActiveId: vi.fn(() => activeId) };
  }

  it('returns [] when either dependency is null and reads the current active id lazily', async () => {
    let pm = makeProjectManager(null);
    let svc: ReturnType<typeof makeMemorySvc> | null = null;
    registerMemoryIpcHandlers({
      getProjectManager: () => pm as never,
      getProjectMemoryService: () => svc as never,
    });

    // service null → []
    await expect(handler('memory.list')(fakeEvent)).resolves.toEqual([]);

    // service set but no active project id → still []
    svc = makeMemorySvc();
    await expect(handler('memory.list')(fakeEvent)).resolves.toEqual([]);
    expect(svc.listMemoryEntries).not.toHaveBeenCalled();

    // reassign the project manager so getActiveId returns an id
    pm = makeProjectManager('proj-active');
    await expect(handler('memory.list')(fakeEvent)).resolves.toEqual([
      { category: 'preference', content: 'x' },
    ]);
    expect(svc.listMemoryEntries).toHaveBeenCalledWith('proj-active');
  });

  it('passes category/content through to addMemoryEntry, honouring explicit projectId', async () => {
    const svc = makeMemorySvc();
    registerMemoryIpcHandlers({
      getProjectManager: () => makeProjectManager('active') as never,
      getProjectMemoryService: () => svc as never,
    });
    await handler('memory.add')(fakeEvent, 'decision', 'we ship on friday', 'proj-explicit');
    expect(svc.addMemoryEntry).toHaveBeenCalledWith('proj-explicit', 'decision', 'we ship on friday');
  });

  it('reports "No active project" when the id cannot be resolved', async () => {
    const svc = makeMemorySvc();
    registerMemoryIpcHandlers({
      getProjectManager: () => makeProjectManager(null) as never,
      getProjectMemoryService: () => svc as never,
    });
    await expect(handler('memory.add')(fakeEvent, 'context', 'note')).resolves.toEqual({
      success: false,
      error: 'No active project',
    });
    expect(svc.addMemoryEntry).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// session-insights-ipc — single accessor read via optional chaining
// ─────────────────────────────────────────────────────────────────────────
describe('session-insights-ipc accessor injection', () => {
  function makeBridge() {
    return {
      list: vi.fn((_limit: number) => [{ sessionId: 's1' }]),
      search: vi.fn((_q: string, _limit: number) => [{ sessionId: 's2' }]),
      getDetail: vi.fn((_id: string) => ({ sessionId: 's1', detail: true })),
      getRecallPrefill: vi.fn(() => ({ text: 'recall' })),
      getAudit: vi.fn(() => ({ ok: true })),
      repair: vi.fn(() => ({ repaired: 1 })),
    };
  }

  it('defaults to [] / null when the bridge is null, then observes it once set', async () => {
    let bridge: ReturnType<typeof makeBridge> | null = null;
    registerSessionInsightsIpcHandlers({ getSessionInsightsBridge: () => bridge as never });

    await expect(handler('sessionInsights.list')(fakeEvent)).resolves.toEqual([]);
    await expect(handler('sessionInsights.detail')(fakeEvent, 's1')).resolves.toBeNull();

    bridge = makeBridge();
    await expect(handler('sessionInsights.list')(fakeEvent, 5)).resolves.toEqual([
      { sessionId: 's1' },
    ]);
    expect(bridge.list).toHaveBeenCalledWith(5);
  });

  it('applies the documented default limits and forwards search args', async () => {
    const bridge = makeBridge();
    registerSessionInsightsIpcHandlers({ getSessionInsightsBridge: () => bridge as never });
    await handler('sessionInsights.list')(fakeEvent); // no limit → 100
    expect(bridge.list).toHaveBeenCalledWith(100);
    await handler('sessionInsights.search')(fakeEvent, 'auth bug', 10);
    expect(bridge.search).toHaveBeenCalledWith('auth bug', 10);
  });

  it('swallows a throwing bridge into the safe default', async () => {
    const bridge = makeBridge();
    bridge.list.mockImplementation(() => {
      throw new Error('boom');
    });
    registerSessionInsightsIpcHandlers({ getSessionInsightsBridge: () => bridge as never });
    await expect(handler('sessionInsights.list')(fakeEvent)).resolves.toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// template-ipc — single accessor, async service
// ─────────────────────────────────────────────────────────────────────────
describe('template-ipc accessor injection', () => {
  function makeService() {
    return {
      list: vi.fn(async () => [{ name: 'node-cli' }]),
      preview: vi.fn(async (_name: string) => ({ content: '# SKILL' })),
      apply: vi.fn(async (_name: string, _root: string) => ({ success: true })),
    };
  }

  it('defaults ([] / null / {success:false}) when the service is null and observes it once set', async () => {
    let svc: ReturnType<typeof makeService> | null = null;
    registerTemplateIpcHandlers({ getTemplateService: () => svc as never });

    await expect(handler('template.list')(fakeEvent)).resolves.toEqual([]);
    await expect(handler('template.preview')(fakeEvent, 'x')).resolves.toBeNull();
    await expect(handler('template.create')(fakeEvent, 'x', '/ws')).resolves.toEqual({
      success: false,
      error: 'Template service unavailable',
    });

    svc = makeService();
    await expect(handler('template.list')(fakeEvent)).resolves.toEqual([{ name: 'node-cli' }]);
  });

  it('passes name/workspaceRoot through to apply and swallows a rejecting list', async () => {
    const svc = makeService();
    registerTemplateIpcHandlers({ getTemplateService: () => svc as never });
    await handler('template.create')(fakeEvent, 'node-cli', '/home/ws');
    expect(svc.apply).toHaveBeenCalledWith('node-cli', '/home/ws');

    svc.list.mockRejectedValueOnce(new Error('fs error'));
    await expect(handler('template.list')(fakeEvent)).resolves.toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// plugins-ipc — TWO accessors; INTENTIONALLY THROWS on a null runtime service
// ─────────────────────────────────────────────────────────────────────────
describe('plugins-ipc accessor injection', () => {
  function makeRuntime() {
    return {
      listCatalog: vi.fn(async () => [{ name: 'p' }]),
      listInstalled: vi.fn(() => [{ id: 'p', enabled: true }]),
      install: vi.fn(async () => ({ success: true })),
      setEnabled: vi.fn(async () => ({ success: true })),
      setComponentEnabled: vi.fn(async () => ({ success: true })),
      uninstall: vi.fn(async () => ({ success: true })),
    };
  }

  it('rejects with the documented error when the runtime service is null (intentional throw)', async () => {
    registerPluginsIpcHandlers({
      getPluginRuntimeService: () => null,
      getSessionManager: () => null,
    });
    await expect(handler('plugins.listInstalled')(fakeEvent)).rejects.toThrow(
      'PluginRuntimeService not initialized'
    );
    await expect(handler('plugins.install')(fakeEvent, 'p')).rejects.toThrow(
      'PluginRuntimeService not initialized'
    );
  });

  it('reads the CURRENT runtime + session manager lazily and invalidates skills setup on install', async () => {
    let runtime: ReturnType<typeof makeRuntime> | null = null;
    const sessionManager = { invalidateSkillsSetup: vi.fn() };
    registerPluginsIpcHandlers({
      getPluginRuntimeService: () => runtime as never,
      getSessionManager: () => sessionManager as never,
    });

    // still null → throws
    await expect(handler('plugins.listInstalled')(fakeEvent)).rejects.toThrow();

    // reassign the runtime mutable after register → handler sees it
    runtime = makeRuntime();
    await expect(handler('plugins.listInstalled')(fakeEvent)).resolves.toEqual([
      { id: 'p', enabled: true },
    ]);

    await handler('plugins.install')(fakeEvent, 'my-plugin');
    expect(runtime.install).toHaveBeenCalledWith('my-plugin');
    expect(sessionManager.invalidateSkillsSetup).toHaveBeenCalledTimes(1);
  });

  it('tolerates a null session manager on install via optional chaining', async () => {
    const runtime = makeRuntime();
    registerPluginsIpcHandlers({
      getPluginRuntimeService: () => runtime as never,
      getSessionManager: () => null,
    });
    await expect(handler('plugins.install')(fakeEvent, 'p')).resolves.toEqual({ success: true });
    // setComponentEnabled only invalidates for the 'skills' component
    await handler('plugins.setComponentEnabled')(fakeEvent, 'p', 'skills', true);
    expect(runtime.setComponentEnabled).toHaveBeenCalledWith('p', 'skills', true);
  });
});
