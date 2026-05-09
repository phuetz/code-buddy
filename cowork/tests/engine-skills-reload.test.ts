/**
 * Phase 10 — verify SessionManager calls the engine adapter's
 * `reloadSkills()` whenever the user installs / removes / toggles a
 * skill in Cowork's Settings. Without this, the engine kept its boot-
 * time skills registry and Patrice had to restart Cowork after every
 * skill change.
 */
import { describe, expect, it, vi } from 'vitest';
import type { DatabaseInstance } from '../src/main/db/database';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp',
    getVersion: () => '0.0.0',
  },
}));

vi.mock('electron-store', () => {
  class MockStore<T extends Record<string, unknown>> {
    public store: Record<string, unknown>;
    public path = '/tmp/mock-skills-reload.json';
    constructor(options: { defaults?: Record<string, unknown> }) {
      this.store = { ...(options?.defaults || {}) };
    }
    get<K extends keyof T>(key: K, fallback?: unknown): T[K] {
      return (this.store[key as string] ?? fallback) as T[K];
    }
    set(key: string | Record<string, unknown>, value?: unknown): void {
      if (typeof key === 'string') {
        this.store[key] = value;
        return;
      }
      this.store = { ...this.store, ...key };
    }
  }
  return { default: MockStore };
});

vi.mock('../src/main/mcp/mcp-config-store', () => ({
  mcpConfigStore: {
    getServers: () => [],
    getEnabledServers: () => [],
  },
}));

vi.mock('../src/main/claude/agent-runner', () => ({
  ClaudeAgentRunner: class {
    run = vi.fn();
    cancel = vi.fn();
    invalidateMcpServersCache = vi.fn();
    invalidateSkillsSetup = vi.fn();
  },
}));

vi.mock('../src/main/mcp/mcp-manager', () => ({
  MCPManager: class {
    initializeServers = vi.fn(async () => undefined);
    getTools = vi.fn(() => []);
  },
}));

import { SessionManager, type EngineAdapterLike } from '../src/main/session/session-manager';

function makeMinimalDb(): DatabaseInstance {
  return {
    sessions: {
      create: vi.fn(),
      get: vi.fn(() => null),
      getAll: vi.fn(() => []),
      update: vi.fn(),
      delete: vi.fn(),
    },
    messages: {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      deleteBySessionId: vi.fn(),
      getBySessionId: vi.fn(() => []),
      searchContent: vi.fn(() => []),
    },
    traceSteps: {
      create: vi.fn(),
      update: vi.fn(),
      getBySessionId: vi.fn(() => []),
      deleteBySessionId: vi.fn(),
    },
  } as unknown as DatabaseInstance;
}

describe('SessionManager — engine skills hot-reload (Phase 10)', () => {
  it('calls engine.reloadSkills on invalidateSkillsSetup', async () => {
    const reloadSkills = vi.fn(async () => undefined);
    const engine = {
      runSession: vi.fn(async () => ({ content: '' })),
      cancel: vi.fn(),
      clearSession: vi.fn(),
      reloadSkills,
    } as unknown as EngineAdapterLike;
    const mgr = new SessionManager(makeMinimalDb(), vi.fn(), undefined, engine);
    await new Promise((r) => setImmediate(r)); // boot init
    reloadSkills.mockClear();

    mgr.invalidateSkillsSetup();
    await new Promise((r) => setImmediate(r));

    expect(reloadSkills).toHaveBeenCalledTimes(1);
  });

  it('skips silently when engine adapter has no reloadSkills (legacy)', async () => {
    const legacyEngine = {
      runSession: vi.fn(async () => ({ content: '' })),
      cancel: vi.fn(),
      clearSession: vi.fn(),
    } as unknown as EngineAdapterLike;
    expect(() => {
      const mgr = new SessionManager(makeMinimalDb(), vi.fn(), undefined, legacyEngine);
      mgr.invalidateSkillsSetup();
    }).not.toThrow();
  });

  it('still invalidates pi cache too (both runners get notified)', async () => {
    const reloadSkills = vi.fn(async () => undefined);
    const engine = {
      runSession: vi.fn(async () => ({ content: '' })),
      cancel: vi.fn(),
      clearSession: vi.fn(),
      reloadSkills,
    } as unknown as EngineAdapterLike;
    const mgr = new SessionManager(makeMinimalDb(), vi.fn(), undefined, engine);
    await new Promise((r) => setImmediate(r));
    reloadSkills.mockClear();

    // The Cowork pi runner is created lazily; force the legacy code-path
    // by ensuring the agentRunner is available. We don't assert on pi
    // here (covered elsewhere) — just confirm engine path fires.
    mgr.invalidateSkillsSetup();
    await new Promise((r) => setImmediate(r));
    expect(reloadSkills).toHaveBeenCalled();
  });

  it('does not throw when engine.reloadSkills itself rejects', async () => {
    const reloadSkills = vi.fn(async () => {
      throw new Error('boom');
    });
    const engine = {
      runSession: vi.fn(async () => ({ content: '' })),
      cancel: vi.fn(),
      clearSession: vi.fn(),
      reloadSkills,
    } as unknown as EngineAdapterLike;
    const mgr = new SessionManager(makeMinimalDb(), vi.fn(), undefined, engine);
    await new Promise((r) => setImmediate(r));
    reloadSkills.mockClear();

    expect(() => mgr.invalidateSkillsSetup()).not.toThrow();
    await new Promise((r) => setImmediate(r));
  });
});
