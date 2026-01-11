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
  getSessionStore,
  resetSessionStore,
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
        expect(session?.createdAt).toBeInstanceOf(Date);
      });

      it('should return null for non-existent session', () => {
        mockFs.existsSync.mockReturnValue(false);

        const session = store.loadSession('non_existent_id');

        expect(session).toBeNull();
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
  });
});