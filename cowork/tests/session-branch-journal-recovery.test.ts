import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseInstance } from '../src/main/db/database';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp',
    getVersion: () => '0.0.0',
  },
}));

vi.mock('electron-store', () => ({
  default: class {
    store: Record<string, unknown> = {};
    path = '/tmp/branch-journal-config.json';
    get(key: string) {
      if (key === 'memoryStrategy') return 'manual';
      if (key === 'model') return 'test-model';
      return this.store[key];
    }
    getAll() {
      return { memoryStrategy: 'manual', model: 'test-model' };
    }
    set(key: string, value: unknown) {
      this.store[key] = value;
    }
  },
}));

vi.mock('../src/main/claude/agent-runner', () => ({
  ClaudeAgentRunner: class {
    run = vi.fn();
    cancel = vi.fn();
    clearSdkSession = vi.fn();
    handleQuestionResponse = vi.fn();
  },
}));

vi.mock('../src/main/mcp/mcp-config-store', () => ({
  mcpConfigStore: { getEnabledServers: () => [] },
}));

vi.mock('../src/main/config/config-store', () => ({
  configStore: {
    get: (key: string) => key === 'model' ? 'test-model' : key === 'memoryStrategy' ? 'manual' : undefined,
    getAll: () => ({ model: 'test-model', memoryStrategy: 'manual' }),
  },
}));

import { SessionManager } from '../src/main/session/session-manager';
import { TurnJournal } from '../src/main/session/turn-journal';

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('branch checkout journal recovery isolation', () => {
  it('hides a committed pre-checkout prefix if the process exits before rotation', () => {
    const journalDirectory = mkdtempSync(join(tmpdir(), 'branch-journal-fence-'));
    tempDirectories.push(journalDirectory);
    const journal = new TurnJournal(journalDirectory);
    journal.append(
      'session-1',
      'turn_submitted',
      { messageId: 'old-branch-message', recoverable: true },
      'old-turn',
    );
    const fence = journal.captureFence('session-1');
    expect(fence).not.toBeNull();

    // Simulates a new turn written after the SQLite checkout committed while
    // the old journal file could not yet be rotated.
    journal.append(
      'session-1',
      'turn_submitted',
      { messageId: 'new-branch-message', recoverable: true },
      'new-turn',
    );

    const visible = journal.read('session-1', 200, fence);
    expect(visible.events).toHaveLength(1);
    expect(visible.events[0]).toMatchObject({ turnId: 'new-turn' });
    expect(journal.read('session-1').events).toHaveLength(2);
  });

  it('archives stale turns so startup recovery cannot inject the previous branch', () => {
    const journalDirectory = mkdtempSync(join(tmpdir(), 'branch-journal-recovery-'));
    tempDirectories.push(journalDirectory);
    const createdMessages: unknown[] = [];
    const sessionRow = {
      id: 'session-1',
      title: 'Branch recovery',
      claude_session_id: null,
      openai_thread_id: null,
      status: 'idle',
      cwd: '/tmp',
      mounted_paths: '[]',
      allowed_tools: '[]',
      memory_enabled: 0,
      model: 'test-model',
      intelligence: null,
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
    const db = {
      sessions: {
        create: vi.fn(),
        update: vi.fn(),
        get: vi.fn(() => sessionRow),
        getAll: vi.fn(() => [sessionRow]),
        delete: vi.fn(),
      },
      messages: {
        create: vi.fn((message: unknown) => createdMessages.push(message)),
        update: vi.fn(),
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
    const manager = new SessionManager(db, vi.fn());
    const journal = new TurnJournal(journalDirectory);
    (manager as unknown as { turnJournal: TurnJournal }).turnJournal = journal;
    journal.append('session-1', 'turn_submitted', {
      messageId: 'old-branch-message',
      recoverable: true,
      content: [{ type: 'text', text: 'Must stay on the previous branch' }],
    }, 'old-branch-turn');
    journal.append('session-1', 'turn_started', {}, 'old-branch-turn');

    manager.rotateTurnJournalForBranchChange('session-1');
    const recovery = manager.recoverFromTurnJournals();

    expect(recovery).toMatchObject({
      sessionsScanned: 1,
      sessionsChanged: 0,
      injectedJournalUserMessages: 0,
      injectedJournalInterruptionMarkers: 0,
      errors: 0,
    });
    expect(createdMessages).toEqual([]);
    expect(journal.read('session-1').exists).toBe(false);
    expect(readdirSync(journalDirectory)).toEqual([
      expect.stringMatching(/^session-1\.jsonl\.branch-checkout\..+\.archived$/),
    ]);
  });
});
