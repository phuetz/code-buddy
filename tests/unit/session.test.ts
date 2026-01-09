/**
 * Comprehensive Unit Tests for Session Module
 *
 * Tests the SessionStore class in src/persistence/session-store.ts covering:
 * - Session creation and lifecycle
 * - Session persistence (save/load)
 * - Session recovery
 * - Multi-session handling
 */

import {
  SessionStore,
  Session,
  SessionMessage,
  getSessionStore,
  resetSessionStore,
  SessionStoreConfig,
  SessionMetadata,
} from '../../src/persistence/session-store';
import type { ChatEntry } from '../../src/agent/types';

// Mock fs module
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
  readFileSync: jest.fn(),
  readdirSync: jest.fn(),
  unlinkSync: jest.fn(),
}));

// Mock os module
jest.mock('os', () => ({
  homedir: jest.fn().mockReturnValue('/home/testuser'),
}));

// Mock the session repository
jest.mock('../../src/database/repositories/session-repository', () => ({
  getSessionRepository: jest.fn().mockReturnValue({
    createSession: jest.fn(),
    addMessage: jest.fn(),
    getSessionById: jest.fn(),
    findSessions: jest.fn().mockReturnValue([]),
  }),
  SessionRepository: jest.fn(),
}));

import fs from 'fs';
const mockFs = fs as jest.Mocked<typeof fs>;

describe('SessionStore', () => {
  let store: SessionStore;

  // Sample session data
  const createMockSession = (overrides: Partial<Session> = {}): Session => ({
    id: `session_${Date.now()}_abc123`,
    name: 'Test Session',
    workingDirectory: '/test/project',
    model: 'grok-3-latest',
    messages: [],
    createdAt: new Date(),
    lastAccessedAt: new Date(),
    ...overrides,
  });

  const createMockChatEntry = (overrides: Partial<ChatEntry> = {}): ChatEntry => ({
    type: 'user',
    content: 'Test message',
    timestamp: new Date(),
    ...overrides,
  });

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    resetSessionStore();

    // Default mock implementations
    mockFs.existsSync.mockReturnValue(true);
    mockFs.mkdirSync.mockReturnValue(undefined);
    mockFs.writeFileSync.mockReturnValue(undefined);
    mockFs.readdirSync.mockReturnValue([]);
    mockFs.unlinkSync.mockReturnValue(undefined);

    // Create store with SQLite disabled to test file-based persistence
    store = new SessionStore({ useSQLite: false });
  });

  afterEach(() => {
    resetSessionStore();
  });

  // ============================================================================
  // Session Creation and Lifecycle
  // ============================================================================

  describe('Session Creation and Lifecycle', () => {
    describe('createSession()', () => {
      it('should create a new session with default values', () => {
        const session = store.createSession();

        expect(session).toBeDefined();
        expect(session.id).toMatch(/^session_[a-z0-9]+_[a-z0-9]+$/);
        expect(session.messages).toEqual([]);
        expect(session.createdAt).toBeInstanceOf(Date);
        expect(session.lastAccessedAt).toBeInstanceOf(Date);
      });

      it('should create session with custom name', () => {
        const session = store.createSession('My Custom Session');

        expect(session.name).toBe('My Custom Session');
      });

      it('should create session with custom model', () => {
        const session = store.createSession('Test', 'grok-4-latest');

        expect(session.model).toBe('grok-4-latest');
      });

      it('should set working directory to current directory', () => {
        const session = store.createSession();

        expect(session.workingDirectory).toBe(process.cwd());
      });

      it('should set current session ID after creation', () => {
        const session = store.createSession();

        expect(store.getCurrentSessionId()).toBe(session.id);
      });

      it('should persist session to disk after creation', () => {
        store.createSession('Test Session');

        expect(mockFs.writeFileSync).toHaveBeenCalled();
      });

      it('should generate unique session IDs', () => {
        const session1 = store.createSession();
        const session2 = store.createSession();

        // Session IDs should be unique even when created in quick succession
        // due to the random component in the ID
        expect(session1.id).not.toBe(session2.id);
      });
    });

    describe('getCurrentSession()', () => {
      it('should return null when no session is active', () => {
        expect(store.getCurrentSession()).toBeNull();
      });

      it('should return current session after creation', () => {
        const created = store.createSession('Test');

        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockReturnValue(JSON.stringify({
          ...created,
          createdAt: created.createdAt.toISOString(),
          lastAccessedAt: created.lastAccessedAt.toISOString(),
        }));

        const current = store.getCurrentSession();

        expect(current).not.toBeNull();
        expect(current?.id).toBe(created.id);
      });
    });

    describe('getCurrentSessionId()', () => {
      it('should return null initially', () => {
        expect(store.getCurrentSessionId()).toBeNull();
      });

      it('should return session ID after creation', () => {
        const session = store.createSession();

        expect(store.getCurrentSessionId()).toBe(session.id);
      });
    });
  });

  // ============================================================================
  // Session Persistence
  // ============================================================================

  describe('Session Persistence', () => {
    describe('saveSession()', () => {
      it('should save session to JSON file', () => {
        const session = createMockSession();

        store.saveSession(session);

        expect(mockFs.writeFileSync).toHaveBeenCalled();
        const writtenPath = mockFs.writeFileSync.mock.calls[0][0];
        expect(writtenPath).toContain(session.id);
        expect(writtenPath).toContain('.json');
      });

      it('should serialize dates to ISO strings', () => {
        const session = createMockSession();

        store.saveSession(session);

        const writtenData = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string);
        expect(typeof writtenData.createdAt).toBe('string');
        expect(typeof writtenData.lastAccessedAt).toBe('string');
      });

      it('should update lastAccessedAt on save', () => {
        const session = createMockSession({
          // Set lastAccessedAt to a time in the past
          lastAccessedAt: new Date('2024-01-01T00:00:00.000Z'),
        });
        const originalTime = session.lastAccessedAt;

        store.saveSession(session);

        const writtenData = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string);
        // The saved session should have a newer lastAccessedAt (now)
        expect(new Date(writtenData.lastAccessedAt).getTime()).toBeGreaterThan(originalTime.getTime());
      });

      it('should create sessions directory if it does not exist', () => {
        mockFs.existsSync.mockReturnValue(false);

        const session = createMockSession();
        store.saveSession(session);

        expect(mockFs.mkdirSync).toHaveBeenCalledWith(
          expect.stringContaining('sessions'),
          { recursive: true }
        );
      });

      it('should save session with metadata', () => {
        const session = createMockSession({
          metadata: {
            description: 'Test session',
            tags: ['feature', 'debug'],
            totalCost: 0.05,
          },
        });

        store.saveSession(session);

        const writtenData = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string);
        expect(writtenData.metadata.description).toBe('Test session');
        expect(writtenData.metadata.tags).toContain('feature');
      });
    });

    describe('loadSession()', () => {
      it('should load session from JSON file', () => {
        const sessionData = {
          id: 'session_test_123',
          name: 'Loaded Session',
          workingDirectory: '/test',
          model: 'grok-3-latest',
          messages: [],
          createdAt: '2024-01-01T00:00:00.000Z',
          lastAccessedAt: '2024-01-01T12:00:00.000Z',
        };

        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockReturnValue(JSON.stringify(sessionData));

        const session = store.loadSession('session_test_123');

        expect(session).not.toBeNull();
        expect(session?.name).toBe('Loaded Session');
      });

      it('should convert date strings back to Date objects', () => {
        const sessionData = {
          id: 'session_test_123',
          name: 'Test',
          workingDirectory: '/test',
          model: 'grok-3-latest',
          messages: [],
          createdAt: '2024-01-01T00:00:00.000Z',
          lastAccessedAt: '2024-01-01T12:00:00.000Z',
        };

        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockReturnValue(JSON.stringify(sessionData));

        const session = store.loadSession('session_test_123');

        expect(session?.createdAt).toBeInstanceOf(Date);
        expect(session?.lastAccessedAt).toBeInstanceOf(Date);
      });

      it('should return null for non-existent session', () => {
        mockFs.existsSync.mockReturnValue(false);

        const session = store.loadSession('non_existent_id');

        expect(session).toBeNull();
      });

      it('should return null for corrupted session file', () => {
        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockReturnValue('invalid json {{{');

        const session = store.loadSession('corrupted_session');

        expect(session).toBeNull();
      });

      it('should load session with messages', () => {
        const sessionData = {
          id: 'session_test_123',
          name: 'Test',
          workingDirectory: '/test',
          model: 'grok-3-latest',
          messages: [
            { type: 'user', content: 'Hello', timestamp: '2024-01-01T00:00:00.000Z' },
            { type: 'assistant', content: 'Hi there!', timestamp: '2024-01-01T00:00:01.000Z' },
          ],
          createdAt: '2024-01-01T00:00:00.000Z',
          lastAccessedAt: '2024-01-01T12:00:00.000Z',
        };

        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockReturnValue(JSON.stringify(sessionData));

        const session = store.loadSession('session_test_123');

        expect(session?.messages).toHaveLength(2);
        expect(session?.messages[0].content).toBe('Hello');
      });
    });

    describe('updateCurrentSession()', () => {
      it('should update messages in current session', () => {
        const created = store.createSession('Test');

        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockReturnValue(JSON.stringify({
          ...created,
          createdAt: created.createdAt.toISOString(),
          lastAccessedAt: created.lastAccessedAt.toISOString(),
        }));

        const chatHistory: ChatEntry[] = [
          createMockChatEntry({ type: 'user', content: 'Hello' }),
          createMockChatEntry({ type: 'assistant', content: 'Hi!' }),
        ];

        store.updateCurrentSession(chatHistory);

        // Check that writeFileSync was called with updated messages
        expect(mockFs.writeFileSync).toHaveBeenCalledTimes(2); // Once for create, once for update
      });

      it('should not update when autoSave is disabled', () => {
        store.createSession('Test');
        store.setAutoSave(false);

        const initialCallCount = mockFs.writeFileSync.mock.calls.length;

        store.updateCurrentSession([createMockChatEntry()]);

        expect(mockFs.writeFileSync).toHaveBeenCalledTimes(initialCallCount);
      });

      it('should not update when no current session', () => {
        const chatHistory: ChatEntry[] = [createMockChatEntry()];

        // Should not throw
        expect(() => store.updateCurrentSession(chatHistory)).not.toThrow();
      });
    });

    describe('addMessageToCurrentSession()', () => {
      it('should add single message to current session', () => {
        const created = store.createSession('Test');

        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockReturnValue(JSON.stringify({
          ...created,
          createdAt: created.createdAt.toISOString(),
          lastAccessedAt: created.lastAccessedAt.toISOString(),
        }));

        const entry = createMockChatEntry({ type: 'user', content: 'New message' });

        store.addMessageToCurrentSession(entry);

        expect(mockFs.writeFileSync).toHaveBeenCalledTimes(2);
      });

      it('should handle tool call messages', () => {
        const created = store.createSession('Test');

        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockReturnValue(JSON.stringify({
          ...created,
          createdAt: created.createdAt.toISOString(),
          lastAccessedAt: created.lastAccessedAt.toISOString(),
        }));

        const toolEntry: ChatEntry = {
          type: 'tool_call',
          content: '{"command": "ls"}',
          timestamp: new Date(),
          toolCall: {
            id: 'call_123',
            type: 'function',
            function: { name: 'bash', arguments: '{"command": "ls"}' },
          },
        };

        store.addMessageToCurrentSession(toolEntry);

        expect(mockFs.writeFileSync).toHaveBeenCalled();
      });
    });
  });

  // ============================================================================
  // Session Recovery
  // ============================================================================

  describe('Session Recovery', () => {
    describe('resumeSession()', () => {
      it('should resume a session by ID', () => {
        const sessionData = {
          id: 'session_resume_123',
          name: 'Resume Test',
          workingDirectory: '/test',
          model: 'grok-3-latest',
          messages: [],
          createdAt: '2024-01-01T00:00:00.000Z',
          lastAccessedAt: '2024-01-01T12:00:00.000Z',
        };

        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockReturnValue(JSON.stringify(sessionData));

        const resumed = store.resumeSession('session_resume_123');

        expect(resumed).not.toBeNull();
        expect(resumed?.id).toBe('session_resume_123');
        expect(store.getCurrentSessionId()).toBe('session_resume_123');
      });

      it('should update lastAccessedAt on resume', () => {
        const oldDate = '2024-01-01T00:00:00.000Z';
        const sessionData = {
          id: 'session_resume_123',
          name: 'Resume Test',
          workingDirectory: '/test',
          model: 'grok-3-latest',
          messages: [],
          createdAt: oldDate,
          lastAccessedAt: oldDate,
        };

        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockReturnValue(JSON.stringify(sessionData));

        store.resumeSession('session_resume_123');

        // Check that save was called with updated timestamp
        expect(mockFs.writeFileSync).toHaveBeenCalled();
      });

      it('should return null for non-existent session', () => {
        mockFs.existsSync.mockReturnValue(false);

        const resumed = store.resumeSession('non_existent');

        expect(resumed).toBeNull();
      });
    });

    describe('resumeLastSession()', () => {
      it('should resume the most recent session', () => {
        const recentSession = {
          id: 'session_recent',
          name: 'Recent Session',
          workingDirectory: '/test',
          model: 'grok-3-latest',
          messages: [],
          createdAt: '2024-01-02T00:00:00.000Z',
          lastAccessedAt: '2024-01-02T12:00:00.000Z',
        };

        mockFs.readdirSync.mockReturnValue(['session_recent.json'] as any);
        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockReturnValue(JSON.stringify(recentSession));

        const resumed = store.resumeLastSession();

        expect(resumed).not.toBeNull();
        expect(resumed?.id).toBe('session_recent');
      });

      it('should return null when no sessions exist', () => {
        mockFs.readdirSync.mockReturnValue([]);

        const resumed = store.resumeLastSession();

        expect(resumed).toBeNull();
      });
    });

    describe('continueLastSession()', () => {
      it('should return session with last user message', () => {
        const sessionData = {
          id: 'session_continue',
          name: 'Continue Test',
          workingDirectory: '/test',
          model: 'grok-3-latest',
          messages: [
            { type: 'user', content: 'First message', timestamp: '2024-01-01T00:00:00.000Z' },
            { type: 'assistant', content: 'Response', timestamp: '2024-01-01T00:00:01.000Z' },
            { type: 'user', content: 'Last user message', timestamp: '2024-01-01T00:00:02.000Z' },
          ],
          createdAt: '2024-01-01T00:00:00.000Z',
          lastAccessedAt: '2024-01-01T12:00:00.000Z',
        };

        mockFs.readdirSync.mockReturnValue(['session_continue.json'] as any);
        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockReturnValue(JSON.stringify(sessionData));

        const result = store.continueLastSession();

        expect(result).not.toBeNull();
        expect(result?.lastUserMessage).toBe('Last user message');
      });

      it('should return empty string for last message if no user messages', () => {
        const sessionData = {
          id: 'session_continue',
          name: 'Continue Test',
          workingDirectory: '/test',
          model: 'grok-3-latest',
          messages: [
            { type: 'assistant', content: 'Only assistant message', timestamp: '2024-01-01T00:00:00.000Z' },
          ],
          createdAt: '2024-01-01T00:00:00.000Z',
          lastAccessedAt: '2024-01-01T12:00:00.000Z',
        };

        mockFs.readdirSync.mockReturnValue(['session_continue.json'] as any);
        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockReturnValue(JSON.stringify(sessionData));

        const result = store.continueLastSession();

        expect(result?.lastUserMessage).toBe('');
      });
    });

    describe('getSessionByPartialId()', () => {
      it('should find session by partial ID match', () => {
        const session = {
          id: 'session_abc123_xyz789',
          name: 'Partial ID Test',
          workingDirectory: '/test',
          model: 'grok-3-latest',
          messages: [],
          createdAt: '2024-01-01T00:00:00.000Z',
          lastAccessedAt: '2024-01-01T12:00:00.000Z',
        };

        mockFs.readdirSync.mockReturnValue(['session_abc123_xyz789.json'] as any);
        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockReturnValue(JSON.stringify(session));

        const found = store.getSessionByPartialId('abc123');

        expect(found).not.toBeNull();
        expect(found?.id).toContain('abc123');
      });

      it('should return null when no match found', () => {
        mockFs.readdirSync.mockReturnValue(['session_xyz.json'] as any);
        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockReturnValue(JSON.stringify({
          id: 'session_xyz',
          name: 'Test',
          workingDirectory: '/test',
          model: 'grok-3-latest',
          messages: [],
          createdAt: '2024-01-01T00:00:00.000Z',
          lastAccessedAt: '2024-01-01T12:00:00.000Z',
        }));

        const found = store.getSessionByPartialId('nomatch');

        expect(found).toBeNull();
      });
    });
  });

  // ============================================================================
  // Multi-Session Handling
  // ============================================================================

  describe('Multi-Session Handling', () => {
    describe('listSessions()', () => {
      it('should list all saved sessions', () => {
        const sessions = [
          {
            id: 'session_1',
            name: 'Session 1',
            workingDirectory: '/test',
            model: 'grok-3-latest',
            messages: [],
            createdAt: '2024-01-01T00:00:00.000Z',
            lastAccessedAt: '2024-01-03T00:00:00.000Z',
          },
          {
            id: 'session_2',
            name: 'Session 2',
            workingDirectory: '/test',
            model: 'grok-3-latest',
            messages: [],
            createdAt: '2024-01-02T00:00:00.000Z',
            lastAccessedAt: '2024-01-02T00:00:00.000Z',
          },
        ];

        mockFs.readdirSync.mockReturnValue(['session_1.json', 'session_2.json'] as any);
        mockFs.existsSync.mockReturnValue(true);

        let callCount = 0;
        mockFs.readFileSync.mockImplementation(() => {
          return JSON.stringify(sessions[callCount++ % sessions.length]);
        });

        const listed = store.listSessions();

        expect(listed.length).toBe(2);
      });

      it('should sort sessions by lastAccessedAt descending', () => {
        const olderSession = {
          id: 'session_old',
          name: 'Old Session',
          workingDirectory: '/test',
          model: 'grok-3-latest',
          messages: [],
          createdAt: '2024-01-01T00:00:00.000Z',
          lastAccessedAt: '2024-01-01T00:00:00.000Z',
        };

        const newerSession = {
          id: 'session_new',
          name: 'New Session',
          workingDirectory: '/test',
          model: 'grok-3-latest',
          messages: [],
          createdAt: '2024-01-02T00:00:00.000Z',
          lastAccessedAt: '2024-01-02T00:00:00.000Z',
        };

        mockFs.readdirSync.mockReturnValue(['session_old.json', 'session_new.json'] as any);
        mockFs.existsSync.mockReturnValue(true);

        let callCount = 0;
        mockFs.readFileSync.mockImplementation(() => {
          const session = callCount++ === 0 ? olderSession : newerSession;
          return JSON.stringify(session);
        });

        const listed = store.listSessions();

        expect(listed[0].id).toBe('session_new'); // Newer should be first
      });

      it('should filter out non-JSON files', () => {
        mockFs.readdirSync.mockReturnValue(['session_1.json', 'readme.txt', '.gitkeep'] as any);
        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockReturnValue(JSON.stringify({
          id: 'session_1',
          name: 'Session 1',
          workingDirectory: '/test',
          model: 'grok-3-latest',
          messages: [],
          createdAt: '2024-01-01T00:00:00.000Z',
          lastAccessedAt: '2024-01-01T00:00:00.000Z',
        }));

        const listed = store.listSessions();

        expect(listed.length).toBe(1);
      });

      it('should skip corrupted session files', () => {
        mockFs.readdirSync.mockReturnValue(['good.json', 'bad.json'] as any);
        mockFs.existsSync.mockReturnValue(true);

        let callCount = 0;
        mockFs.readFileSync.mockImplementation(() => {
          if (callCount++ === 0) {
            return JSON.stringify({
              id: 'good',
              name: 'Good Session',
              workingDirectory: '/test',
              model: 'grok-3-latest',
              messages: [],
              createdAt: '2024-01-01T00:00:00.000Z',
              lastAccessedAt: '2024-01-01T00:00:00.000Z',
            });
          }
          return 'corrupted {{{ data';
        });

        const listed = store.listSessions();

        expect(listed.length).toBe(1);
        expect(listed[0].id).toBe('good');
      });
    });

    describe('getRecentSessions()', () => {
      it('should return limited number of recent sessions', () => {
        const sessions = Array.from({ length: 15 }, (_, i) => ({
          id: `session_${i}`,
          name: `Session ${i}`,
          workingDirectory: '/test',
          model: 'grok-3-latest',
          messages: [],
          createdAt: '2024-01-01T00:00:00.000Z',
          lastAccessedAt: new Date(Date.now() - i * 1000).toISOString(),
        }));

        mockFs.readdirSync.mockReturnValue(
          sessions.map(s => `${s.id}.json`) as any
        );
        mockFs.existsSync.mockReturnValue(true);

        let callCount = 0;
        mockFs.readFileSync.mockImplementation(() => {
          return JSON.stringify(sessions[callCount++ % sessions.length]);
        });

        const recent = store.getRecentSessions(5);

        expect(recent.length).toBe(5);
      });

      it('should default to 10 sessions', () => {
        const sessions = Array.from({ length: 15 }, (_, i) => ({
          id: `session_${i}`,
          name: `Session ${i}`,
          workingDirectory: '/test',
          model: 'grok-3-latest',
          messages: [],
          createdAt: '2024-01-01T00:00:00.000Z',
          lastAccessedAt: new Date(Date.now() - i * 1000).toISOString(),
        }));

        mockFs.readdirSync.mockReturnValue(
          sessions.map(s => `${s.id}.json`) as any
        );
        mockFs.existsSync.mockReturnValue(true);

        let callCount = 0;
        mockFs.readFileSync.mockImplementation(() => {
          return JSON.stringify(sessions[callCount++ % sessions.length]);
        });

        const recent = store.getRecentSessions();

        expect(recent.length).toBe(10);
      });
    });

    describe('deleteSession()', () => {
      it('should delete session file', () => {
        mockFs.existsSync.mockReturnValue(true);

        const result = store.deleteSession('session_to_delete');

        expect(result).toBe(true);
        expect(mockFs.unlinkSync).toHaveBeenCalled();
      });

      it('should return false for non-existent session', () => {
        mockFs.existsSync.mockReturnValue(false);

        const result = store.deleteSession('non_existent');

        expect(result).toBe(false);
        expect(mockFs.unlinkSync).not.toHaveBeenCalled();
      });

      it('should clear current session ID if deleting current session', () => {
        const session = store.createSession('Test');

        mockFs.existsSync.mockReturnValue(true);

        store.deleteSession(session.id);

        expect(store.getCurrentSessionId()).toBeNull();
      });
    });

    describe('cleanupOldSessions()', () => {
      it('should delete sessions beyond MAX_SESSIONS limit', () => {
        // Create 55 sessions (limit is 50)
        const sessions = Array.from({ length: 55 }, (_, i) => ({
          id: `session_${i}`,
          name: `Session ${i}`,
          workingDirectory: '/test',
          model: 'grok-3-latest',
          messages: [],
          createdAt: '2024-01-01T00:00:00.000Z',
          lastAccessedAt: new Date(Date.now() - i * 1000).toISOString(),
        }));

        mockFs.readdirSync.mockReturnValue(
          sessions.map(s => `${s.id}.json`) as any
        );
        mockFs.existsSync.mockReturnValue(true);

        let callCount = 0;
        mockFs.readFileSync.mockImplementation(() => {
          return JSON.stringify(sessions[callCount++ % sessions.length]);
        });

        const deleted = store.cleanupOldSessions();

        expect(deleted).toBe(5); // 55 - 50 = 5 deleted
      });

      it('should not delete anything when under limit', () => {
        const sessions = Array.from({ length: 10 }, (_, i) => ({
          id: `session_${i}`,
          name: `Session ${i}`,
          workingDirectory: '/test',
          model: 'grok-3-latest',
          messages: [],
          createdAt: '2024-01-01T00:00:00.000Z',
          lastAccessedAt: new Date(Date.now() - i * 1000).toISOString(),
        }));

        mockFs.readdirSync.mockReturnValue(
          sessions.map(s => `${s.id}.json`) as any
        );
        mockFs.existsSync.mockReturnValue(true);

        let callCount = 0;
        mockFs.readFileSync.mockImplementation(() => {
          return JSON.stringify(sessions[callCount++ % sessions.length]);
        });

        const deleted = store.cleanupOldSessions();

        expect(deleted).toBe(0);
      });
    });

    describe('searchSessions()', () => {
      it('should find sessions by name', () => {
        const sessions = [
          {
            id: 'session_1',
            name: 'Debug Feature X',
            workingDirectory: '/test',
            model: 'grok-3-latest',
            messages: [],
            createdAt: '2024-01-01T00:00:00.000Z',
            lastAccessedAt: '2024-01-01T00:00:00.000Z',
          },
          {
            id: 'session_2',
            name: 'Implement Y',
            workingDirectory: '/test',
            model: 'grok-3-latest',
            messages: [],
            createdAt: '2024-01-01T00:00:00.000Z',
            lastAccessedAt: '2024-01-01T00:00:00.000Z',
          },
        ];

        mockFs.readdirSync.mockReturnValue(['session_1.json', 'session_2.json'] as any);
        mockFs.existsSync.mockReturnValue(true);

        let callCount = 0;
        mockFs.readFileSync.mockImplementation(() => {
          return JSON.stringify(sessions[callCount++ % sessions.length]);
        });

        const results = store.searchSessions('Debug');

        expect(results.length).toBe(1);
        expect(results[0].name).toContain('Debug');
      });

      it('should find sessions by message content', () => {
        const sessions = [
          {
            id: 'session_1',
            name: 'Session 1',
            workingDirectory: '/test',
            model: 'grok-3-latest',
            messages: [
              { type: 'user', content: 'How to fix TypeScript error?', timestamp: '2024-01-01T00:00:00.000Z' },
            ],
            createdAt: '2024-01-01T00:00:00.000Z',
            lastAccessedAt: '2024-01-01T00:00:00.000Z',
          },
          {
            id: 'session_2',
            name: 'Session 2',
            workingDirectory: '/test',
            model: 'grok-3-latest',
            messages: [
              { type: 'user', content: 'Deploy to production', timestamp: '2024-01-01T00:00:00.000Z' },
            ],
            createdAt: '2024-01-01T00:00:00.000Z',
            lastAccessedAt: '2024-01-01T00:00:00.000Z',
          },
        ];

        mockFs.readdirSync.mockReturnValue(['session_1.json', 'session_2.json'] as any);
        mockFs.existsSync.mockReturnValue(true);

        let callCount = 0;
        mockFs.readFileSync.mockImplementation(() => {
          return JSON.stringify(sessions[callCount++ % sessions.length]);
        });

        const results = store.searchSessions('TypeScript');

        expect(results.length).toBe(1);
        expect(results[0].id).toBe('session_1');
      });

      it('should be case-insensitive', () => {
        const session = {
          id: 'session_1',
          name: 'UPPERCASE SESSION',
          workingDirectory: '/test',
          model: 'grok-3-latest',
          messages: [],
          createdAt: '2024-01-01T00:00:00.000Z',
          lastAccessedAt: '2024-01-01T00:00:00.000Z',
        };

        mockFs.readdirSync.mockReturnValue(['session_1.json'] as any);
        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockReturnValue(JSON.stringify(session));

        const results = store.searchSessions('uppercase');

        expect(results.length).toBe(1);
      });
    });

    describe('cloneSession()', () => {
      it('should create a copy of session', () => {
        const original = {
          id: 'session_original',
          name: 'Original Session',
          workingDirectory: '/test',
          model: 'grok-3-latest',
          messages: [
            { type: 'user', content: 'Message 1', timestamp: '2024-01-01T00:00:00.000Z' },
          ],
          createdAt: '2024-01-01T00:00:00.000Z',
          lastAccessedAt: '2024-01-01T00:00:00.000Z',
        };

        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockReturnValue(JSON.stringify(original));

        const cloned = store.cloneSession('session_original');

        expect(cloned).not.toBeNull();
        expect(cloned?.id).not.toBe('session_original');
        expect(cloned?.name).toBe('Original Session (copy)');
        expect(cloned?.messages).toHaveLength(1);
      });

      it('should allow custom name for clone', () => {
        const original = {
          id: 'session_original',
          name: 'Original Session',
          workingDirectory: '/test',
          model: 'grok-3-latest',
          messages: [],
          createdAt: '2024-01-01T00:00:00.000Z',
          lastAccessedAt: '2024-01-01T00:00:00.000Z',
        };

        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockReturnValue(JSON.stringify(original));

        const cloned = store.cloneSession('session_original', 'My Clone');

        expect(cloned?.name).toBe('My Clone');
      });

      it('should return null for non-existent session', () => {
        mockFs.existsSync.mockReturnValue(false);

        const cloned = store.cloneSession('non_existent');

        expect(cloned).toBeNull();
      });
    });

    describe('branchSession()', () => {
      it('should create branch at specific message index', () => {
        const original = {
          id: 'session_original',
          name: 'Original Session',
          workingDirectory: '/test',
          model: 'grok-3-latest',
          messages: [
            { type: 'user', content: 'Message 1', timestamp: '2024-01-01T00:00:00.000Z' },
            { type: 'assistant', content: 'Response 1', timestamp: '2024-01-01T00:00:01.000Z' },
            { type: 'user', content: 'Message 2', timestamp: '2024-01-01T00:00:02.000Z' },
            { type: 'assistant', content: 'Response 2', timestamp: '2024-01-01T00:00:03.000Z' },
          ],
          createdAt: '2024-01-01T00:00:00.000Z',
          lastAccessedAt: '2024-01-01T00:00:00.000Z',
        };

        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockReturnValue(JSON.stringify(original));

        const branched = store.branchSession('session_original', 1);

        expect(branched).not.toBeNull();
        expect(branched?.messages).toHaveLength(2); // Messages 0 and 1
        expect(branched?.name).toBe('Original Session (branch)');
      });

      it('should include branch metadata', () => {
        const original = {
          id: 'session_original',
          name: 'Original Session',
          workingDirectory: '/test',
          model: 'grok-3-latest',
          messages: [
            { type: 'user', content: 'Message 1', timestamp: '2024-01-01T00:00:00.000Z' },
          ],
          createdAt: '2024-01-01T00:00:00.000Z',
          lastAccessedAt: '2024-01-01T00:00:00.000Z',
        };

        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockReturnValue(JSON.stringify(original));

        const branched = store.branchSession('session_original', 0);

        expect(branched?.metadata?.branchedFrom).toBe('session_original');
        expect(branched?.metadata?.branchedAt).toBe(0);
      });
    });
  });

  // ============================================================================
  // Message Conversion
  // ============================================================================

  describe('Message Conversion', () => {
    describe('convertMessagesToChatEntries()', () => {
      it('should convert SessionMessages to ChatEntries', () => {
        const messages: SessionMessage[] = [
          { type: 'user', content: 'Hello', timestamp: '2024-01-01T00:00:00.000Z' },
          { type: 'assistant', content: 'Hi!', timestamp: '2024-01-01T00:00:01.000Z' },
        ];

        const entries = store.convertMessagesToChatEntries(messages);

        expect(entries).toHaveLength(2);
        expect(entries[0].type).toBe('user');
        expect(entries[0].content).toBe('Hello');
        expect(entries[0].timestamp).toBeInstanceOf(Date);
      });

      it('should handle tool call messages', () => {
        const messages: SessionMessage[] = [
          {
            type: 'tool_call',
            content: 'Executing command',
            timestamp: '2024-01-01T00:00:00.000Z',
            toolCallName: 'bash',
          },
        ];

        const entries = store.convertMessagesToChatEntries(messages);

        expect(entries[0].toolCall).toBeDefined();
        expect(entries[0].toolCall?.function.name).toBe('bash');
      });

      it('should handle tool result messages', () => {
        const messages: SessionMessage[] = [
          {
            type: 'tool_result',
            content: 'Command output',
            timestamp: '2024-01-01T00:00:00.000Z',
            toolCallSuccess: true,
          },
        ];

        const entries = store.convertMessagesToChatEntries(messages);

        expect(entries[0].toolResult).toBeDefined();
        expect(entries[0].toolResult?.success).toBe(true);
      });
    });
  });

  // ============================================================================
  // Export Functionality
  // ============================================================================

  describe('Export Functionality', () => {
    describe('exportToMarkdown()', () => {
      it('should export session as markdown', () => {
        const session = {
          id: 'session_export',
          name: 'Export Test',
          workingDirectory: '/test',
          model: 'grok-3-latest',
          messages: [
            { type: 'user', content: 'Hello', timestamp: '2024-01-01T00:00:00.000Z' },
            { type: 'assistant', content: 'Hi!', timestamp: '2024-01-01T00:00:01.000Z' },
          ],
          createdAt: '2024-01-01T00:00:00.000Z',
          lastAccessedAt: '2024-01-01T00:00:00.000Z',
        };

        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockReturnValue(JSON.stringify(session));

        const markdown = store.exportToMarkdown('session_export');

        expect(markdown).toContain('# Export Test');
        expect(markdown).toContain('## User');
        expect(markdown).toContain('## Assistant');
        expect(markdown).toContain('Hello');
        expect(markdown).toContain('Hi!');
      });

      it('should return null for non-existent session', () => {
        mockFs.existsSync.mockReturnValue(false);

        const markdown = store.exportToMarkdown('non_existent');

        expect(markdown).toBeNull();
      });

      it('should include tool results with status', () => {
        const session = {
          id: 'session_export',
          name: 'Export Test',
          workingDirectory: '/test',
          model: 'grok-3-latest',
          messages: [
            {
              type: 'tool_result',
              content: 'Command output',
              timestamp: '2024-01-01T00:00:00.000Z',
              toolCallName: 'bash',
              toolCallSuccess: true,
            },
          ],
          createdAt: '2024-01-01T00:00:00.000Z',
          lastAccessedAt: '2024-01-01T00:00:00.000Z',
        };

        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockReturnValue(JSON.stringify(session));

        const markdown = store.exportToMarkdown('session_export');

        expect(markdown).toContain('Tool: bash');
      });

      it('should truncate long tool outputs', () => {
        const longOutput = 'x'.repeat(1000);
        const session = {
          id: 'session_export',
          name: 'Export Test',
          workingDirectory: '/test',
          model: 'grok-3-latest',
          messages: [
            {
              type: 'tool_result',
              content: longOutput,
              timestamp: '2024-01-01T00:00:00.000Z',
              toolCallName: 'bash',
              toolCallSuccess: true,
            },
          ],
          createdAt: '2024-01-01T00:00:00.000Z',
          lastAccessedAt: '2024-01-01T00:00:00.000Z',
        };

        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockReturnValue(JSON.stringify(session));

        const markdown = store.exportToMarkdown('session_export');

        expect(markdown).toContain('[truncated]');
      });
    });

    describe('exportSessionToFile()', () => {
      it('should write markdown to file', () => {
        const session = {
          id: 'session_export',
          name: 'Export Test',
          workingDirectory: '/test',
          model: 'grok-3-latest',
          messages: [],
          createdAt: '2024-01-01T00:00:00.000Z',
          lastAccessedAt: '2024-01-01T00:00:00.000Z',
        };

        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockReturnValue(JSON.stringify(session));

        const path = store.exportSessionToFile('session_export');

        expect(path).not.toBeNull();
        expect(mockFs.writeFileSync).toHaveBeenCalled();
      });
    });
  });

  // ============================================================================
  // Auto-Save Configuration
  // ============================================================================

  describe('Auto-Save Configuration', () => {
    describe('setAutoSave()', () => {
      it('should enable auto-save', () => {
        store.setAutoSave(true);

        expect(store.isAutoSaveEnabled()).toBe(true);
      });

      it('should disable auto-save', () => {
        store.setAutoSave(false);

        expect(store.isAutoSaveEnabled()).toBe(false);
      });
    });

    describe('isAutoSaveEnabled()', () => {
      it('should return true by default', () => {
        expect(store.isAutoSaveEnabled()).toBe(true);
      });
    });
  });

  // ============================================================================
  // Formatting
  // ============================================================================

  describe('Formatting', () => {
    describe('formatSession()', () => {
      it('should format session for display', () => {
        const session = createMockSession({
          id: 'session_abc123_xyz',
          name: 'Test Session',
          messages: [
            { type: 'user', content: 'Hello', timestamp: '2024-01-01T00:00:00.000Z' },
          ],
        });

        const formatted = store.formatSession(session);

        // Format is: [<first 8 chars of ID>] <name> - <message count> messages - <date> <time>
        expect(formatted).toContain('[session_');
        expect(formatted).toContain('Test Session');
        expect(formatted).toContain('1 messages');
      });
    });

    describe('formatSessionList()', () => {
      it('should format session list for display', () => {
        const sessions = [
          {
            id: 'session_1',
            name: 'Session 1',
            workingDirectory: '/test',
            model: 'grok-3-latest',
            messages: [],
            createdAt: '2024-01-01T00:00:00.000Z',
            lastAccessedAt: '2024-01-01T00:00:00.000Z',
          },
        ];

        mockFs.readdirSync.mockReturnValue(['session_1.json'] as any);
        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockReturnValue(JSON.stringify(sessions[0]));

        const formatted = store.formatSessionList();

        expect(formatted).toContain('Recent Sessions');
        expect(formatted).toContain('Session 1');
      });

      it('should show message when no sessions', () => {
        mockFs.readdirSync.mockReturnValue([]);

        const formatted = store.formatSessionList();

        expect(formatted).toBe('No saved sessions.');
      });
    });

    describe('formatHelp()', () => {
      it('should return help text', () => {
        const help = store.formatHelp();

        expect(help).toContain('/sessions');
        expect(help).toContain('--resume');
        expect(help).toContain('Examples');
      });
    });
  });

  // ============================================================================
  // Singleton Pattern
  // ============================================================================

  describe('Singleton Pattern', () => {
    describe('getSessionStore()', () => {
      it('should return same instance', () => {
        resetSessionStore();

        const store1 = getSessionStore();
        const store2 = getSessionStore();

        expect(store1).toBe(store2);
      });
    });

    describe('resetSessionStore()', () => {
      it('should reset singleton instance', () => {
        const store1 = getSessionStore();
        resetSessionStore();
        const store2 = getSessionStore();

        expect(store1).not.toBe(store2);
      });
    });
  });

  // ============================================================================
  // SQLite Integration
  // ============================================================================

  describe('SQLite Integration', () => {
    it('should fallback to JSON when SQLite fails', () => {
      // Mock getSessionRepository to throw
      jest.resetModules();
      jest.doMock('../../src/database/repositories/session-repository', () => ({
        getSessionRepository: jest.fn().mockImplementation(() => {
          throw new Error('SQLite not available');
        }),
      }));

      // Re-import to get new instance
      const { SessionStore: FreshSessionStore } = require('../../src/persistence/session-store');

      const sqliteStore = new FreshSessionStore({ useSQLite: true });

      // Should not throw, should fallback gracefully
      expect(sqliteStore).toBeDefined();
    });
  });
});
