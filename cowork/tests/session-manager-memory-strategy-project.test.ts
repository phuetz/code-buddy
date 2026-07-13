import { describe, expect, it, vi } from 'vitest';
import type { DatabaseInstance } from '../src/main/db/database';
import type { ContentBlock, Session } from '../src/renderer/types';

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
    public path = '/tmp/mock-session-manager-memory-project-config-store.json';

    constructor(options: { defaults?: Record<string, unknown> }) {
      this.store = { ...(options?.defaults || {}) };
    }

    get<K extends keyof T>(key: K): T[K] {
      return this.store[key as string] as T[K];
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

vi.mock('../src/main/claude/agent-runner', () => ({
  ClaudeAgentRunner: class {
    run = vi.fn(async () => {});
    cancel = vi.fn();
    handleQuestionResponse = vi.fn();
  },
}));

vi.mock('../src/main/mcp/mcp-config-store', () => ({
  mcpConfigStore: {
    getEnabledServers: () => [],
  },
}));

vi.mock('../src/main/config/config-store', () => ({
  configStore: {
    get: (key: string) => {
      if (key === 'memoryStrategy') return 'auto';
      if (key === 'model') return 'gpt-5.5';
      return undefined;
    },
    getAll: () => ({ memoryStrategy: 'auto', model: 'gpt-5.5' }),
  },
}));

import { SessionManager } from '../src/main/session/session-manager';

function makeDb(): DatabaseInstance {
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
      getBySessionId: vi.fn(() => []),
      delete: vi.fn(),
      deleteBySessionId: vi.fn(),
    },
    traceSteps: {
      create: vi.fn(),
      update: vi.fn(),
      getBySessionId: vi.fn(() => []),
      deleteBySessionId: vi.fn(),
    },
  } as unknown as DatabaseInstance;
}

describe('SessionManager project memory strategy', () => {
  it('honors a project-level manual memory override even when the global strategy is auto', async () => {
    const db = makeDb();
    const manager = new SessionManager(db, vi.fn());

    const projectMemory = {
      loadProjectContext: vi.fn(async () => '<project_memory>ctx</project_memory>'),
      consolidateSessionMemory: vi.fn(async () => ({ added: 1, duplicatesSkipped: 0, memoryDir: '/tmp' })),
    };
    const icmIntegration = {
      isAvailable: () => true,
      searchRelevantMemories: vi.fn(async () => [{ id: 'm1' }]),
      formatContextBlock: vi.fn(() => '<icm>ctx</icm>'),
      storeEpisode: vi.fn(async () => undefined),
    };

    manager.setProjectServices(
      {
        getActiveId: () => null,
        get: () => ({
          id: 'project-1',
          name: 'Manual Memory Project',
          memoryConfig: { memoryStrategy: 'manual' },
        }),
      },
      projectMemory as never
    );
    manager.setICMIntegration(icmIntegration as never);

    const session: Session = {
      id: 's-project-manual',
      title: 'Project override',
      status: 'idle',
      mountedPaths: [],
      allowedTools: [],
      memoryEnabled: true,
      cwd: undefined,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      projectId: 'project-1',
      source: 'cowork',
    };
    const content: ContentBlock[] = [{ type: 'text', text: 'Remember this exact fact.' }];

    await (manager as unknown as {
      processPrompt(session: Session, prompt: string, content?: ContentBlock[]): Promise<void>;
    }).processPrompt(session, 'Remember this exact fact.', content);

    expect(projectMemory.loadProjectContext).toHaveBeenCalledWith('project-1', {
      includeMemory: false,
    });
    expect(projectMemory.consolidateSessionMemory).not.toHaveBeenCalled();
    expect(icmIntegration.searchRelevantMemories).not.toHaveBeenCalled();
    expect(icmIntegration.storeEpisode).not.toHaveBeenCalled();
  });
});
