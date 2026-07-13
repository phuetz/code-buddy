import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it, vi } from 'vitest';
import type { DatabaseInstance } from '../src/main/db/database';
import type { ServerEvent, Session } from '../src/renderer/types';

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
    public path = '/tmp/mock-session-manager-crud-config-store.json';

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
    run = vi.fn();
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
      if (key === 'model') return 'model';
      return undefined;
    },
    getAll: () => ({ memoryStrategy: 'auto', model: 'model' }),
  },
}));

import {
  SessionManager,
  createUniqueAttachmentFilename,
  formatFileAttachmentPromptLine,
} from '../src/main/session/session-manager';
import { TurnJournal } from '../src/main/session/turn-journal';

// Shared minimal DB factory used across tests
function makeDb(overrides: Partial<DatabaseInstance> = {}): DatabaseInstance {
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
    ...overrides,
  } as unknown as DatabaseInstance;
}

// ------------------------------------------------------------------
// listSessions
// ------------------------------------------------------------------
describe('SessionManager.listSessions', () => {
  it('returns empty array when database is empty', () => {
    const db = makeDb();
    const manager = new SessionManager(db, vi.fn());
    expect(manager.listSessions()).toEqual([]);
    expect(db.sessions.getAll).toHaveBeenCalledTimes(1);
  });

  it('maps database rows to Session objects', () => {
    const row = {
      id: 's1',
      title: 'My Session',
      claude_session_id: null,
      openai_thread_id: null,
      status: 'idle',
      cwd: '/tmp/workspace',
      mounted_paths: JSON.stringify([{ virtual: '/mnt/workspace', real: '/tmp/workspace' }]),
      allowed_tools: JSON.stringify(['read', 'write']),
      memory_enabled: 0,
      model: 'claude-3-5-sonnet',
      project_id: 'project-1',
      is_background: 1,
      execution_mode: 'task',
      created_at: 1000,
      updated_at: 2000,
    };
    const db = makeDb({
      sessions: {
        create: vi.fn(),
        get: vi.fn(() => null),
        getAll: vi.fn(() => [row]),
        update: vi.fn(),
        delete: vi.fn(),
      } as any,
    });

    const manager = new SessionManager(db, vi.fn());
    const sessions = manager.listSessions();

    expect(sessions).toHaveLength(1);
    const s = sessions[0];
    expect(s.id).toBe('s1');
    expect(s.title).toBe('My Session');
    expect(s.cwd).toBe('/tmp/workspace');
    expect(s.mountedPaths).toEqual([{ virtual: '/mnt/workspace', real: '/tmp/workspace' }]);
    expect(s.allowedTools).toEqual(['read', 'write']);
    expect(s.memoryEnabled).toBe(false);
    expect(s.model).toBe('claude-3-5-sonnet');
    expect(s.projectId).toBe('project-1');
    expect(s.isBackground).toBe(true);
    expect(s.executionMode).toBe('task');
    expect(s.pinned).toBe(false);
    expect(s.archived).toBe(false);
    expect(s.tags).toEqual([]);
    expect(s.source).toBe('cowork');
    expect(s.createdAt).toBe(1000);
    expect(s.updatedAt).toBe(2000);
  });

  it('maps pinned/archive metadata and falls back to title-derived tags', () => {
    const row = {
      id: 's-tags',
      title: 'Work on #Fleet #Hermes',
      claude_session_id: null,
      openai_thread_id: null,
      status: 'idle',
      cwd: null,
      mounted_paths: '[]',
      allowed_tools: '[]',
      memory_enabled: 0,
      model: null,
      project_id: null,
      is_background: 0,
      execution_mode: null,
      pinned: 1,
      archived: 1,
      tags: null,
      source: 'cli-import',
      created_at: 1,
      updated_at: 2,
    };
    const db = makeDb({
      sessions: {
        create: vi.fn(),
        get: vi.fn(() => null),
        getAll: vi.fn(() => [row]),
        update: vi.fn(),
        delete: vi.fn(),
      } as any,
    });

    const manager = new SessionManager(db, vi.fn());
    const [session] = manager.listSessions();

    expect(session.pinned).toBe(true);
    expect(session.archived).toBe(true);
    expect(session.tags).toEqual(['fleet', 'hermes']);
    expect(session.source).toBe('cli-import');
  });

  it('falls back to empty arrays when mounted_paths or allowed_tools JSON is malformed', () => {
    const row = {
      id: 's2',
      title: 'Broken JSON',
      claude_session_id: null,
      openai_thread_id: null,
      status: 'idle',
      cwd: null,
      mounted_paths: '{{{broken',
      allowed_tools: '[unclosed',
      memory_enabled: 0,
      model: null,
      created_at: 1,
      updated_at: 1,
    };
    const db = makeDb({
      sessions: {
        create: vi.fn(),
        get: vi.fn(() => null),
        getAll: vi.fn(() => [row]),
        update: vi.fn(),
        delete: vi.fn(),
      } as any,
    });

    const manager = new SessionManager(db, vi.fn());
    const [s] = manager.listSessions();

    expect(s.mountedPaths).toEqual([]);
    expect(s.allowedTools).toEqual([]);
  });
});

describe('SessionManager session recall prefill', () => {
  it('only builds recall context for memory-enabled sessions', () => {
    const now = Date.now();
    const createdTraceSteps: any[] = [];
    const sessions = [
      {
        id: 'current',
        title: 'Current auth work',
        claude_session_id: null,
        openai_thread_id: null,
        status: 'idle',
        cwd: '/repo',
        mounted_paths: JSON.stringify([]),
        allowed_tools: JSON.stringify([]),
        memory_enabled: 1,
        model: 'gpt-5.5',
        project_id: null,
        is_background: 0,
        execution_mode: null,
        pinned: 0,
        archived: 0,
        tags: JSON.stringify([]),
        source: 'cowork',
        created_at: now - 1_000,
        updated_at: now,
      },
      {
        id: 'previous',
        title: 'Auth regression fix',
        claude_session_id: null,
        openai_thread_id: null,
        status: 'completed',
        cwd: '/repo',
        mounted_paths: JSON.stringify([]),
        allowed_tools: JSON.stringify([]),
        memory_enabled: 1,
        model: 'gpt-5.5',
        project_id: null,
        is_background: 0,
        execution_mode: null,
        pinned: 0,
        archived: 0,
        tags: JSON.stringify(['auth']),
        source: 'cowork',
        created_at: now - 2_000,
        updated_at: now - 500,
      },
    ];
    const db = makeDb({
      sessions: {
        create: vi.fn(),
        get: vi.fn(() => null),
        getAll: vi.fn(() => sessions),
        update: vi.fn(),
        delete: vi.fn(),
      } as any,
      messages: {
        create: vi.fn(),
        getBySessionId: vi.fn((sessionId: string) =>
          sessionId === 'previous'
            ? [
                {
                  id: 'm-prev',
                  session_id: 'previous',
                  role: 'assistant',
                  content: JSON.stringify([
                    {
                      type: 'text',
                      text: 'The auth regression was fixed by refreshing the OAuth token cache.',
                    },
                  ]),
                  timestamp: now - 400,
                  token_usage: null,
                  execution_time_ms: null,
                  metadata: null,
                },
              ]
            : []
        ),
        delete: vi.fn(),
        deleteBySessionId: vi.fn(),
      } as any,
      traceSteps: {
        create: vi.fn((step) => createdTraceSteps.push(step)),
        update: vi.fn(),
        getBySessionId: vi.fn(() => []),
        deleteBySessionId: vi.fn(),
      } as any,
    });
    const manager = new SessionManager(db, vi.fn());
    const memoryEnabledSession: Session = {
      id: 'current',
      title: 'Current auth work',
      status: 'idle',
      cwd: '/repo',
      mountedPaths: [],
      allowedTools: [],
      memoryEnabled: true,
      createdAt: now - 1_000,
      updatedAt: now,
    };
    const memoryDisabledSession: Session = {
      ...memoryEnabledSession,
      memoryEnabled: false,
    };
    const testManager = manager as unknown as {
      buildRecallPrefillContext(session: Session, prompt: string): string | null;
    };

    expect(
      testManager.buildRecallPrefillContext(memoryDisabledSession, 'auth regression')
    ).toBeNull();
    const context = testManager.buildRecallPrefillContext(memoryEnabledSession, 'auth regression');

    expect(context).toContain('<session_recall_context>');
    expect(context).toContain('Auth regression fix');
    expect(context).toContain('OAuth token cache');
    expect(createdTraceSteps[0]).toMatchObject({
      type: 'thinking',
      status: 'completed',
      title: 'Session recall prefill',
    });
    expect(createdTraceSteps[0]?.content).toContain('prior session(s) matched');
  });
});

describe('SessionManager Hermes-style session actions', () => {
  it('recovers missing user turns and interruption markers from turn journals on startup', () => {
    const journalDir = mkdtempSync(join(tmpdir(), 'cowork-startup-journal-'));
    try {
      const createdMessages: any[] = [];
      const sessionRow = {
        id: 's-recover',
        title: 'Recover me',
        claude_session_id: null,
        openai_thread_id: null,
        status: 'idle',
        cwd: '/tmp/work',
        mounted_paths: '[]',
        allowed_tools: '[]',
        memory_enabled: 1,
        model: 'model',
        project_id: null,
        is_background: 0,
        execution_mode: null,
        pinned: 0,
        archived: 0,
        tags: '[]',
        source: 'cowork',
        created_at: 1,
        updated_at: 2,
      };
      const db = makeDb({
        raw: {
          transaction: (fn: (messages: any[]) => void) => (messages: any[]) => fn(messages),
        } as any,
        sessions: {
          create: vi.fn(),
          get: vi.fn(() => sessionRow),
          getAll: vi.fn(() => [sessionRow]),
          update: vi.fn(),
          delete: vi.fn(),
        } as any,
        messages: {
          create: vi.fn((message) => createdMessages.push(message)),
          update: vi.fn(),
          delete: vi.fn(),
          deleteBySessionId: vi.fn(),
          getBySessionId: vi.fn(() => []),
        } as any,
      });
      const manager = new SessionManager(db, vi.fn());
      const journal = new TurnJournal(journalDir);
      (manager as unknown as { turnJournal: TurnJournal }).turnJournal = journal;
      journal.append(
        's-recover',
        'turn_submitted',
        {
          messageId: 'm-user-recovered',
          recoverable: true,
          content: [{ type: 'text', text: 'Recover this submitted turn' }],
        },
        'turn-recover'
      );
      journal.append('s-recover', 'turn_started', {}, 'turn-recover');

      const result = manager.recoverFromTurnJournals();

      expect(result).toMatchObject({
        sessionsScanned: 1,
        sessionsChanged: 1,
        injectedJournalUserMessages: 1,
        injectedJournalInterruptionMarkers: 1,
        errors: 0,
      });
      expect(createdMessages.map((message) => message.role)).toEqual(['user', 'assistant']);
      expect(JSON.parse(createdMessages[0].metadata)).toMatchObject({
        recovery: {
          kind: 'user_turn_recovered',
          turnId: 'turn-recover',
        },
      });
      expect(JSON.parse(createdMessages[1].metadata)).toMatchObject({
        recovery: {
          kind: 'turn_interrupted',
          turnId: 'turn-recover',
        },
      });

      const replay = journal.read('s-recover');
      const recoveryEvent = replay.events.find(
        (event) => event.type === 'trace_update' && event.data?.kind === 'startup_recovery'
      );
      expect(recoveryEvent?.runId).toBe('turn-recover');
      expect(recoveryEvent?.data).toMatchObject({
        replayRunId: 'turn-recover',
        replayTurnId: 'turn-recover',
        replayStatus: 'running',
        replayEventCount: 2,
        replayAnchorCount: 2,
        replayLatestType: 'turn_started',
      });
    } finally {
      rmSync(journalDir, { recursive: true, force: true });
    }
  });

  it('adds a stable turn anchor to messages saved during an active turn', () => {
    const createMessage = vi.fn();
    const db = makeDb({
      messages: {
        create: createMessage,
        update: vi.fn(),
        delete: vi.fn(),
        deleteBySessionId: vi.fn(),
        getBySessionId: vi.fn(() => []),
        searchContent: vi.fn(() => []),
      } as any,
    });
    const manager = new SessionManager(db, vi.fn());
    (manager as unknown as { activeTurnJournalIds: Map<string, string> }).activeTurnJournalIds.set(
      's1',
      'turn-1'
    );

    const message = {
      id: 'm1',
      sessionId: 's1',
      role: 'assistant' as const,
      content: [{ type: 'text' as const, text: 'done' }],
      timestamp: 1,
    };
    manager.saveMessage(message);

    expect(message.metadata?.turn).toEqual({ id: 'turn-1', role: 'assistant' });
    expect(createMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'm1',
        metadata: JSON.stringify({ turn: { id: 'turn-1', role: 'assistant' } }),
      })
    );
  });

  it('updates pin/archive/title tags and echoes renderer updates', () => {
    const update = vi.fn();
    const sendToRenderer = vi.fn();
    const db = makeDb({
      sessions: {
        create: vi.fn(),
        get: vi.fn(() => ({
          id: 's1',
          title: 'Old',
          claude_session_id: null,
          openai_thread_id: null,
          status: 'idle',
          cwd: null,
          mounted_paths: '[]',
          allowed_tools: '[]',
          memory_enabled: 0,
          model: null,
          project_id: null,
          is_background: 0,
          execution_mode: null,
          created_at: 1,
          updated_at: 1,
        })),
        getAll: vi.fn(() => []),
        update,
        delete: vi.fn(),
      } as any,
    });
    const manager = new SessionManager(db, sendToRenderer);

    expect(
      manager.updateSessionSettings('s1', {
        title: 'New #Memory',
        pinned: true,
        archived: true,
      })
    ).toBe(true);

    expect(update).toHaveBeenCalledWith('s1', {
      title: 'New #Memory',
      pinned: 1,
      archived: 1,
      tags: JSON.stringify(['memory']),
    });
    expect(sendToRenderer).toHaveBeenCalledWith({
      type: 'session.update',
      payload: {
        sessionId: 's1',
        updates: {
          title: 'New #Memory',
          pinned: true,
          archived: true,
          tags: ['memory'],
        },
      },
    });
  });

  it('duplicates messages while remapping tool ids inside the copied session', () => {
    const createdSessions: any[] = [];
    const createdMessages: any[] = [];
    const createdTraceSteps: any[] = [];
    const db = makeDb({
      raw: {
        transaction: (fn: () => void) => () => fn(),
      } as any,
      sessions: {
        create: vi.fn((session) => createdSessions.push(session)),
        get: vi.fn(() => ({
          id: 's1',
          title: 'Original #tag',
          claude_session_id: 'claude-session',
          openai_thread_id: 'thread',
          status: 'idle',
          cwd: '/tmp/work',
          mounted_paths: '[]',
          allowed_tools: '[]',
          memory_enabled: 1,
          model: 'model',
          project_id: 'project',
          is_background: 0,
          execution_mode: 'chat',
          pinned: 1,
          archived: 0,
          tags: JSON.stringify(['tag']),
          source: 'cowork',
          created_at: 1,
          updated_at: 2,
        })),
        getAll: vi.fn(() => []),
        update: vi.fn(),
        delete: vi.fn(),
      } as any,
      messages: {
        create: vi.fn((message) => createdMessages.push(message)),
        update: vi.fn(),
        delete: vi.fn(),
        deleteBySessionId: vi.fn(),
        getBySessionId: vi.fn(() => [
          {
            id: 'm1',
            session_id: 's1',
            role: 'assistant',
            content: JSON.stringify([
              { type: 'tool_use', id: 'tool-1', name: 'read', input: { path: 'a.ts' } },
              { type: 'tool_result', toolUseId: 'tool-1', content: 'ok' },
            ]),
            timestamp: 10,
            token_usage: null,
            metadata: JSON.stringify({ turn: { id: 'turn-original', role: 'assistant' } }),
            execution_time_ms: null,
          },
        ]),
      } as any,
      traceSteps: {
        create: vi.fn((step) => createdTraceSteps.push(step)),
        update: vi.fn(),
        getBySessionId: vi.fn(() => [
          {
            id: 'tool-1',
            session_id: 's1',
            type: 'tool_call',
            status: 'completed',
            title: 'read',
            content: null,
            tool_name: 'read',
            tool_input: JSON.stringify({ path: 'a.ts' }),
            tool_output: 'ok',
            is_error: null,
            timestamp: 11,
            duration: 12,
          },
        ]),
        deleteBySessionId: vi.fn(),
      } as any,
    });
    const manager = new SessionManager(db, vi.fn());

    const duplicate = manager.duplicateSession('s1');

    expect(duplicate?.id).toBeTruthy();
    expect(duplicate?.id).not.toBe('s1');
    expect(duplicate?.title).toBe('Original #tag copy');
    expect(duplicate?.pinned).toBe(false);
    expect(duplicate?.archived).toBe(false);
    expect(createdSessions).toHaveLength(1);
    expect(createdMessages).toHaveLength(1);
    const copiedContent = JSON.parse(createdMessages[0].content);
    expect(copiedContent[0].id).not.toBe('tool-1');
    expect(copiedContent[1].toolUseId).toBe(copiedContent[0].id);
    const copiedMetadata = JSON.parse(createdMessages[0].metadata);
    expect(copiedMetadata.turn.id).not.toBe('turn-original');
    expect(copiedMetadata.turn.role).toBe('assistant');
    expect(createdTraceSteps[0].id).toBe(copiedContent[0].id);
  });
});

// ------------------------------------------------------------------
// getMessages — content normalization
// ------------------------------------------------------------------
describe('SessionManager.getMessages content normalization', () => {
  it('parses a JSON array content correctly', () => {
    const db = makeDb({
      messages: {
        create: vi.fn(),
        delete: vi.fn(),
        deleteBySessionId: vi.fn(),
        getBySessionId: vi.fn(() => [
          {
            id: 'm1',
            session_id: 's1',
            role: 'user',
            content: JSON.stringify([{ type: 'text', text: 'hello' }]),
            timestamp: 1,
            token_usage: null,
            execution_time_ms: null,
          },
        ]),
      } as any,
    });

    const manager = new SessionManager(db, vi.fn());
    const messages = manager.getMessages('s1');

    expect(messages).toHaveLength(1);
    expect(messages[0].content).toEqual([{ type: 'text', text: 'hello' }]);
  });

  it('wraps a single JSON object content in an array', () => {
    const db = makeDb({
      messages: {
        create: vi.fn(),
        delete: vi.fn(),
        deleteBySessionId: vi.fn(),
        getBySessionId: vi.fn(() => [
          {
            id: 'm2',
            session_id: 's1',
            role: 'user',
            content: JSON.stringify({ type: 'text', text: 'single block' }),
            timestamp: 2,
            token_usage: null,
            execution_time_ms: null,
          },
        ]),
      } as any,
    });

    const manager = new SessionManager(db, vi.fn());
    const [msg] = manager.getMessages('s1');
    expect(msg.content).toEqual([{ type: 'text', text: 'single block' }]);
  });

  it('wraps a plain JSON string as a text content block', () => {
    const db = makeDb({
      messages: {
        create: vi.fn(),
        delete: vi.fn(),
        deleteBySessionId: vi.fn(),
        getBySessionId: vi.fn(() => [
          {
            id: 'm3',
            session_id: 's1',
            role: 'assistant',
            content: JSON.stringify('plain string content'),
            timestamp: 3,
            token_usage: null,
            execution_time_ms: null,
          },
        ]),
      } as any,
    });

    const manager = new SessionManager(db, vi.fn());
    const [msg] = manager.getMessages('s1');
    expect(msg.content).toEqual([{ type: 'text', text: 'plain string content' }]);
  });

  it('falls back to raw string as text block when JSON parse fails', () => {
    const db = makeDb({
      messages: {
        create: vi.fn(),
        delete: vi.fn(),
        deleteBySessionId: vi.fn(),
        getBySessionId: vi.fn(() => [
          {
            id: 'm4',
            session_id: 's1',
            role: 'assistant',
            content: 'not valid json {{{',
            timestamp: 4,
            token_usage: null,
            execution_time_ms: null,
          },
        ]),
      } as any,
    });

    const manager = new SessionManager(db, vi.fn());
    const [msg] = manager.getMessages('s1');
    expect(msg.content).toEqual([{ type: 'text', text: 'not valid json {{{' }]);
  });
});

// ------------------------------------------------------------------
// handlePermissionResponse
// ------------------------------------------------------------------
describe('SessionManager.handlePermissionResponse', () => {
  it('resolves the pending permission promise with the given result', async () => {
    const db = makeDb();
    const sendToRenderer = vi.fn();
    const manager = new SessionManager(db, sendToRenderer);

    // Inject a fake pending permission via requestPermission
    const permissionPromise = manager.requestPermission('s1', 'tool-1', 'bash', { command: 'ls' });

    // Synchronously resolve it
    manager.handlePermissionResponse('tool-1', 'allow');

    const result = await permissionPromise;
    expect(result).toBe('allow');
  });

  it('is a no-op when the toolUseId is unknown', () => {
    const db = makeDb();
    const manager = new SessionManager(db, vi.fn());
    // Should not throw
    expect(() => manager.handlePermissionResponse('nonexistent', 'deny')).not.toThrow();
  });

  it('keeps remote permission requests pending beyond the channel timeout', async () => {
    vi.useFakeTimers();
    try {
      const db = makeDb();
      const sendToRenderer = vi.fn();
      const manager = new SessionManager(db, sendToRenderer, undefined, undefined, () => true);
      const permissionPromise = manager.requestPermission('remote-s1', 'tool-remote', 'bash', {
        command: 'pwd',
      });
      const resolved = vi.fn();
      void permissionPromise.then(resolved);

      await vi.advanceTimersByTimeAsync(5 * 60_000);
      expect(resolved).not.toHaveBeenCalled();

      manager.handlePermissionResponse('tool-remote', 'allow');
      await expect(permissionPromise).resolves.toBe('allow');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('SessionManager trace update persistence', () => {
  it('forwards transient tool deltas without journaling or empty SQLite updates', () => {
    const db = makeDb();
    const sendToRenderer = vi.fn();
    const manager = new SessionManager(db, sendToRenderer);
    const internals = manager as unknown as {
      sendToRenderer: (event: ServerEvent) => void;
      turnJournal: TurnJournal;
    };
    const journalAppend = vi.spyOn(internals.turnJournal, 'append');
    const event: ServerEvent = {
      type: 'trace.update',
      payload: {
        sessionId: 's1',
        stepId: 'step-1',
        updates: { toolOutputDelta: 'stream chunk' },
      },
    };

    internals.sendToRenderer(event);

    expect(db.traceSteps.update).not.toHaveBeenCalled();
    expect(journalAppend).not.toHaveBeenCalled();
    expect(sendToRenderer).toHaveBeenCalledWith(event);
    manager.dispose();
  });
});

// ------------------------------------------------------------------
// handleSudoPasswordResponse
// ------------------------------------------------------------------
describe('SessionManager.handleSudoPasswordResponse', () => {
  it('resolves the pending sudo password promise with the given password', async () => {
    const db = makeDb();
    const sendToRenderer = vi.fn();
    const manager = new SessionManager(db, sendToRenderer);

    const sudoPromise = manager.requestSudoPassword('s1', 'tool-2', 'sudo apt-get update');

    manager.handleSudoPasswordResponse('tool-2', 'secret123');

    const password = await sudoPromise;
    expect(password).toBe('secret123');
  });

  it('is a no-op when the toolUseId is unknown', () => {
    const db = makeDb();
    const manager = new SessionManager(db, vi.fn());
    expect(() => manager.handleSudoPasswordResponse('nonexistent', 'pw')).not.toThrow();
  });
});

// ------------------------------------------------------------------
// deleteSession — cache eviction
// ------------------------------------------------------------------
describe('SessionManager.deleteSession cache eviction', () => {
  it('evicts the message cache when a session is deleted', async () => {
    const db = makeDb({
      sessions: {
        create: vi.fn(),
        get: vi.fn(() => null),
        getAll: vi.fn(() => []),
        update: vi.fn(),
        delete: vi.fn(),
      } as any,
      messages: {
        create: vi.fn(),
        delete: vi.fn(),
        deleteBySessionId: vi.fn(),
        getBySessionId: vi.fn(() => [
          {
            id: 'm1',
            session_id: 's1',
            role: 'user',
            content: JSON.stringify([{ type: 'text', text: 'hi' }]),
            timestamp: 1,
            token_usage: null,
            execution_time_ms: null,
          },
        ]),
      } as any,
    });

    const manager = new SessionManager(db, vi.fn());

    // Populate the cache
    manager.getMessages('s1');
    expect(db.messages.getBySessionId).toHaveBeenCalledTimes(1);

    // Delete the session (mocked: no real DB changes)
    await manager.deleteSession('s1');

    // Cache should have been evicted — DB should be hit again on next call
    manager.getMessages('s1');
    expect(db.messages.getBySessionId).toHaveBeenCalledTimes(2);
  });
});

// ------------------------------------------------------------------
// searchMessageContent — Phase 3 (cross-session search)
// ------------------------------------------------------------------
describe('SessionManager.searchMessageContent', () => {
  it('returns empty array for empty/whitespace queries without hitting the DB', () => {
    const searchContent = vi.fn(() => []);
    const db = makeDb({
      messages: {
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        deleteBySessionId: vi.fn(),
        getBySessionId: vi.fn(() => []),
        searchContent,
      } as any,
    });
    const manager = new SessionManager(db, vi.fn());
    expect(manager.searchMessageContent('')).toEqual([]);
    expect(manager.searchMessageContent('   ')).toEqual([]);
    expect(searchContent).not.toHaveBeenCalled();
  });

  it('forwards the query and decorates hits with snippets centered on the match', () => {
    const searchContent = vi.fn(() => [
      {
        message_id: 'm1',
        session_id: 's1',
        role: 'user',
        content: JSON.stringify([
          { type: 'text', text: 'long preamble lorem ipsum BANANA dolor sit amet trailing copy' },
        ]),
        timestamp: 1234,
        session_title: 'My session',
        project_id: 'p1',
      },
    ]);
    const db = makeDb({
      messages: {
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        deleteBySessionId: vi.fn(),
        getBySessionId: vi.fn(() => []),
        searchContent,
      } as any,
    });
    const manager = new SessionManager(db, vi.fn());

    const hits = manager.searchMessageContent('banana', 25);
    expect(searchContent).toHaveBeenCalledWith('banana', 25);
    expect(hits).toHaveLength(1);
    expect(hits[0].messageId).toBe('m1');
    expect(hits[0].sessionId).toBe('s1');
    expect(hits[0].sessionTitle).toBe('My session');
    expect(hits[0].snippet).toContain('BANANA');
    expect(hits[0].timestamp).toBe(1234);
    expect(hits[0].projectId).toBe('p1');
  });

  it('handles plain-string content (legacy rows) without throwing', () => {
    const searchContent = vi.fn(() => [
      {
        message_id: 'm2',
        session_id: 's2',
        role: 'assistant',
        content: 'plain text needle hidden in a haystack',
        timestamp: 0,
        session_title: 'legacy',
        project_id: null,
      },
    ]);
    const db = makeDb({
      messages: {
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        deleteBySessionId: vi.fn(),
        getBySessionId: vi.fn(() => []),
        searchContent,
      } as any,
    });
    const manager = new SessionManager(db, vi.fn());

    const [hit] = manager.searchMessageContent('needle');
    expect(hit.snippet).toContain('needle');
    expect(hit.projectId).toBeNull();
  });
});

describe('formatFileAttachmentPromptLine', () => {
  it('includes MIME type context when available for document attachments', () => {
    expect(
      formatFileAttachmentPromptLine({
        filename: 'questions.docx',
        relativePath: '.tmp/questions.docx',
        size: 2048,
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      })
    ).toBe(
      '- questions.docx (2.0 KB, type: application/vnd.openxmlformats-officedocument.wordprocessingml.document) at path: .tmp/questions.docx'
    );
  });

  it('keeps the existing compact line when MIME type is unknown', () => {
    expect(
      formatFileAttachmentPromptLine({
        filename: 'notes.bin',
        relativePath: '.tmp/notes.bin',
        size: 512,
      })
    ).toBe('- notes.bin (0.5 KB) at path: .tmp/notes.bin');
  });
});

describe('createUniqueAttachmentFilename', () => {
  it('keeps duplicate attachment basenames from overwriting each other', () => {
    const used = new Set<string>();

    expect(createUniqueAttachmentFilename('questions.docx', used)).toBe('questions.docx');
    expect(createUniqueAttachmentFilename('questions.docx', used)).toBe('questions-2.docx');
    expect(
      createUniqueAttachmentFilename('questions.docx', used, (candidate) => candidate === 'questions-3.docx')
    ).toBe('questions-4.docx');
  });
});

describe('SessionManager file attachment processing', () => {
  it('copies duplicate attachment filenames to unique .tmp paths', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cowork-session-attachments-'));
    const firstDir = join(root, 'first');
    const secondDir = join(root, 'second');
    mkdirSync(firstDir);
    mkdirSync(secondDir);
    const firstSource = join(firstDir, 'questions.docx');
    const secondSource = join(secondDir, 'questions.docx');
    writeFileSync(firstSource, 'first');
    writeFileSync(secondSource, 'second');

    try {
      const manager = new SessionManager(makeDb(), vi.fn());
      const processed = await (manager as any).processFileAttachments(
        { id: 'session-attachments', cwd: root },
        [
          {
            type: 'file_attachment',
            filename: 'questions.docx',
            relativePath: firstSource,
            size: 5,
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          },
          {
            type: 'file_attachment',
            filename: 'questions.docx',
            relativePath: secondSource,
            size: 6,
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          },
        ]
      );

      expect(processed.map((block: any) => block.relativePath)).toEqual([
        join('.tmp', 'questions.docx'),
        join('.tmp', 'questions-2.docx'),
      ]);
      expect(readFileSync(join(root, '.tmp', 'questions.docx'), 'utf8')).toBe('first');
      expect(readFileSync(join(root, '.tmp', 'questions-2.docx'), 'utf8')).toBe('second');
      expect(existsSync(join(root, '.tmp', 'questions-3.docx'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('routes attachment-only Word documents through the workshop prompt', async () => {
    const db = makeDb();
    const manager = new SessionManager(db, vi.fn());
    const run = vi.fn(async () => undefined);
    (manager as any).agentRunner = { run, cancel: vi.fn() };
    (manager as any).ensureSandboxInitialized = vi.fn(async () => undefined);
    (manager as any).processFileAttachments = vi.fn(async (_session: unknown, content: unknown) => content);
    (manager as any).runSessionTitleGeneration = vi.fn(async () => undefined);

    await (manager as any).processPrompt(
      {
        id: 'session-word-workshop',
        title: 'Word workshop',
        status: 'idle',
        cwd: 'D:\\Workspace',
        mountedPaths: [],
        allowedTools: [],
        memoryEnabled: false,
        model: 'test-model',
        createdAt: 1,
        updatedAt: 1,
      },
      '',
      [
        {
          type: 'file_attachment',
          filename: 'questions.docx',
          relativePath: '.tmp/questions.docx',
          size: 2048,
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        },
      ]
    );

    expect(run).toHaveBeenCalledTimes(1);
    const enhancedPrompt = run.mock.calls[0][1] as string;
    expect(enhancedPrompt).toContain('Analyze the attached document(s): questions.docx');
    expect(enhancedPrompt).toContain('[Document workshop guidance]');
    expect(enhancedPrompt).toContain('[Document workshop path hints]');
    expect(enhancedPrompt).toContain('questions-livrable.docx');
  });

  it('recovers queued prompts that never reached turn_started after a crash', async () => {
    const journalDir = mkdtempSync(join(tmpdir(), 'cowork-queue-recovery-'));
    try {
      const session = {
        id: 's-queue-recover',
        title: 'Queued prompt recovery',
        status: 'idle' as const,
        cwd: '/tmp/work',
        mountedPaths: [],
        allowedTools: [],
        memoryEnabled: true,
        model: 'model',
        projectId: null,
        isBackground: false,
      };
      const sessionRow = {
        id: session.id,
        title: session.title,
        claude_session_id: null,
        openai_thread_id: null,
        status: session.status,
        cwd: session.cwd,
        mounted_paths: '[]',
        allowed_tools: '[]',
        memory_enabled: 1,
        model: 'model',
        project_id: null,
        is_background: 0,
        execution_mode: null,
        pinned: 0,
        archived: 0,
        tags: '[]',
        source: 'cowork',
        created_at: 1,
        updated_at: 2,
      };
      const db = makeDb({
        raw: {
          transaction: (fn: (messages: any[]) => void) => (messages: any[]) => fn(messages),
        } as any,
        sessions: {
          create: vi.fn(),
          get: vi.fn(() => sessionRow),
          getAll: vi.fn(() => [sessionRow]),
          update: vi.fn(),
          delete: vi.fn(),
        } as any,
        messages: {
          create: vi.fn(),
          update: vi.fn(),
          delete: vi.fn(),
          deleteBySessionId: vi.fn(),
          getBySessionId: vi.fn(() => []),
        } as any,
      });
      const manager = new SessionManager(db, vi.fn());
      const journal = new TurnJournal(journalDir);
      (manager as unknown as { turnJournal: TurnJournal }).turnJournal = journal;
      (manager as unknown as { loadSession: (id: string) => unknown }).loadSession = () => session;
      (manager as any).agentRunner = { run: vi.fn(async () => undefined), cancel: vi.fn() };
      (manager as any).ensureSandboxInitialized = vi.fn(async () => undefined);
      (manager as any).runSessionTitleGeneration = vi.fn(async () => undefined);

      journal.append(
        's-queue-recover',
        'intent_queued',
        {
          turnId: 'turn-pending',
          prompt: 'Resume the queued prompt',
          promptPreview: 'Resume the queued prompt',
          queueLength: 1,
          contentTypes: ['text'],
          recoverable: true,
          contentSnapshot: [{ type: 'text', text: 'Resume the queued prompt' }],
        },
        'turn-pending'
      );
      journal.append(
        's-queue-recover',
        'intent_queued',
        {
          turnId: 'turn-active',
          prompt: 'Already started',
          promptPreview: 'Already started',
          queueLength: 1,
          contentTypes: ['text'],
          recoverable: true,
          contentSnapshot: [{ type: 'text', text: 'Already started' }],
        },
        'turn-active'
      );
      journal.append('s-queue-recover', 'turn_started', { promptPreview: 'Already started' }, 'turn-active');

      const result = manager.recoverQueuedPromptsFromTurnJournals();
      expect(result).toMatchObject({
        sessionsScanned: 1,
        sessionsChanged: 1,
        recoveredQueuedPrompts: 1,
        skippedQueuedPrompts: 0,
        errors: 0,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect((manager as any).agentRunner.run).toHaveBeenCalledTimes(1);
      const runArgs = (manager as any).agentRunner.run.mock.calls[0];
      expect(runArgs[0]).toBe(session);
      expect(runArgs[1]).toBe('Resume the queued prompt');
      expect(runArgs[2]).toHaveLength(1);
      expect(runArgs[2][0]).toMatchObject({
        role: 'user',
        sessionId: session.id,
        content: [{ type: 'text', text: 'Resume the queued prompt' }],
        metadata: {
          turn: {
            id: 'turn-pending',
            role: 'user',
          },
        },
      });

      const replay = journal.read('s-queue-recover');
      const pendingRun = replay.replay.runs.find((run) => run.runId === 'turn-pending');
      expect(pendingRun?.events.map((event) => event.type)).toEqual([
        'intent_queued',
        'turn_started',
        'turn_submitted',
        'message_saved',
        'turn_completed',
      ]);
      expect(pendingRun?.events.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5]);
    } finally {
      rmSync(journalDir, { recursive: true, force: true });
    }
  });
});
