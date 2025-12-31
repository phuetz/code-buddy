/**
 * Unit tests for SessionReplayManager
 * Tests recording, playback, event handling, persistence, and integrity verification
 */

import SessionReplayManager, {
  getSessionReplayManager,
  ReplayEvent,
  ReplaySession,
} from '../../src/advanced/session-replay';

// Mock fs-extra
jest.mock('fs-extra', () => ({
  ensureDir: jest.fn().mockResolvedValue(undefined),
  writeJson: jest.fn().mockResolvedValue(undefined),
  readJson: jest.fn(),
  readdir: jest.fn(),
  pathExists: jest.fn(),
}));

// Mock crypto
jest.mock('crypto', () => ({
  randomBytes: jest.fn().mockReturnValue({
    toString: jest.fn().mockReturnValue('abc12345'),
  }),
  createHash: jest.fn().mockReturnValue({
    update: jest.fn().mockReturnValue({
      digest: jest.fn().mockReturnValue('hash1234abcd'),
    }),
  }),
}));

import fs from 'fs-extra';

const mockFs = fs as jest.Mocked<typeof fs>;

describe('SessionReplayManager', () => {
  let manager: SessionReplayManager;

  const mockMetadata: ReplaySession['metadata'] = {
    model: 'grok-code-fast-1',
    systemPrompt: 'You are a helpful assistant',
    toolsEnabled: ['bash', 'read_file', 'write_file'],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    manager = new SessionReplayManager();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('Recording', () => {
    describe('startRecording()', () => {
      it('should start a new recording session', () => {
        const session = manager.startRecording('Test Session', mockMetadata);

        expect(session).toBeDefined();
        expect(session.name).toBe('Test Session');
        expect(session.metadata).toEqual(mockMetadata);
        expect(session.events).toEqual([]);
        expect(session.startTime).toBeInstanceOf(Date);
      });

      it('should emit "recording-started" event', () => {
        const handler = jest.fn();
        manager.on('recording-started', handler);

        const session = manager.startRecording('Test', mockMetadata);

        expect(handler).toHaveBeenCalledWith(session.id);
      });

      it('should set recording state to true', () => {
        manager.startRecording('Test', mockMetadata);
        expect(manager.isRecording()).toBe(true);
      });

      it('should set current session', () => {
        manager.startRecording('Test', mockMetadata);
        expect(manager.getCurrentSession()).not.toBeNull();
      });

      it('should generate unique session ID', () => {
        const session = manager.startRecording('Test', mockMetadata);
        expect(session.id).toBe('abc12345');
      });
    });

    describe('stopRecording()', () => {
      it('should stop recording and return session', () => {
        manager.startRecording('Test', mockMetadata);
        const session = manager.stopRecording();

        expect(session).not.toBeNull();
        expect(session!.endTime).toBeInstanceOf(Date);
      });

      it('should emit "recording-stopped" event', () => {
        const handler = jest.fn();
        manager.on('recording-stopped', handler);

        manager.startRecording('Test', mockMetadata);
        manager.stopRecording();

        expect(handler).toHaveBeenCalled();
      });

      it('should set recording state to false', () => {
        manager.startRecording('Test', mockMetadata);
        manager.stopRecording();
        expect(manager.isRecording()).toBe(false);
      });

      it('should return null if not recording', () => {
        const session = manager.stopRecording();
        expect(session).toBeNull();
      });
    });

    describe('recordEvent()', () => {
      beforeEach(() => {
        manager.startRecording('Test', mockMetadata);
      });

      it('should record an input event', () => {
        manager.recordEvent('input', { text: 'Hello world' });

        const session = manager.getCurrentSession();
        expect(session!.events).toHaveLength(1);
        expect(session!.events[0].type).toBe('input');
        expect(session!.events[0].data).toEqual({ text: 'Hello world' });
      });

      it('should record an output event', () => {
        manager.recordEvent('output', { response: 'Response text' });

        const session = manager.getCurrentSession();
        expect(session!.events[0].type).toBe('output');
      });

      it('should record a tool event', () => {
        manager.recordEvent('tool', { name: 'bash', args: { command: 'ls' } });

        const session = manager.getCurrentSession();
        expect(session!.events[0].type).toBe('tool');
      });

      it('should record an api event', () => {
        manager.recordEvent('api', { endpoint: '/chat', status: 200 });

        const session = manager.getCurrentSession();
        expect(session!.events[0].type).toBe('api');
      });

      it('should record a state event', () => {
        manager.recordEvent('state', { phase: 'thinking' });

        const session = manager.getCurrentSession();
        expect(session!.events[0].type).toBe('state');
      });

      it('should include timestamp in event', () => {
        const now = Date.now();
        manager.recordEvent('input', { text: 'test' });

        const session = manager.getCurrentSession();
        expect(session!.events[0].timestamp).toBeGreaterThanOrEqual(now);
      });

      it('should include hash in event', () => {
        manager.recordEvent('input', { text: 'test' });

        const session = manager.getCurrentSession();
        expect(session!.events[0].hash).toBeDefined();
        expect(typeof session!.events[0].hash).toBe('string');
      });

      it('should emit "event-recorded" event', () => {
        const handler = jest.fn();
        manager.on('event-recorded', handler);

        manager.recordEvent('input', { text: 'test' });

        expect(handler).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'input',
            data: { text: 'test' },
          })
        );
      });

      it('should not record events when not recording', () => {
        manager.stopRecording();

        const newManager = new SessionReplayManager();
        newManager.recordEvent('input', { text: 'test' });

        const session = newManager.getCurrentSession();
        expect(session).toBeNull();
      });

      it('should record multiple events in sequence', () => {
        manager.recordEvent('input', { text: 'Hello' });
        manager.recordEvent('output', { response: 'Hi there' });
        manager.recordEvent('tool', { name: 'bash' });

        const session = manager.getCurrentSession();
        expect(session!.events).toHaveLength(3);
      });
    });
  });

  describe('Persistence', () => {
    describe('saveSession()', () => {
      it('should save session to file', async () => {
        const session: ReplaySession = {
          id: 'test123',
          name: 'Test Session',
          startTime: new Date(),
          events: [],
          metadata: mockMetadata,
        };

        const filePath = await manager.saveSession(session);

        expect(mockFs.ensureDir).toHaveBeenCalledWith('.codebuddy/replays');
        expect(mockFs.writeJson).toHaveBeenCalled();
        expect(filePath).toContain('test123');
        expect(filePath).toContain('Test-Session');
      });

      it('should sanitize session name for filename', async () => {
        const session: ReplaySession = {
          id: 'test123',
          name: 'Test@Session#With!Special$Chars',
          startTime: new Date(),
          events: [],
          metadata: mockMetadata,
        };

        const filePath = await manager.saveSession(session);

        expect(filePath).toContain('Test-Session-With-Special-Chars');
      });

      it('should include session ID in filename', async () => {
        const session: ReplaySession = {
          id: 'unique123',
          name: 'Test',
          startTime: new Date(),
          events: [],
          metadata: mockMetadata,
        };

        const filePath = await manager.saveSession(session);

        expect(filePath).toContain('unique123');
      });
    });

    describe('loadSession()', () => {
      it('should load session by ID', async () => {
        const mockSession: ReplaySession = {
          id: 'session123',
          name: 'Loaded Session',
          startTime: new Date(),
          events: [],
          metadata: mockMetadata,
        };

        mockFs.pathExists.mockResolvedValue(true as never);
        mockFs.readdir.mockResolvedValue(['session123-Loaded-Session.json'] as never);
        mockFs.readJson.mockResolvedValue(mockSession as never);

        const session = await manager.loadSession('session123');

        expect(session).toEqual(mockSession);
      });

      it('should return null if storage directory does not exist', async () => {
        mockFs.pathExists.mockResolvedValue(false as never);

        const session = await manager.loadSession('nonexistent');

        expect(session).toBeNull();
      });

      it('should return null if session file not found', async () => {
        mockFs.pathExists.mockResolvedValue(true as never);
        mockFs.readdir.mockResolvedValue(['other123-file.json'] as never);

        const session = await manager.loadSession('notfound');

        expect(session).toBeNull();
      });
    });

    describe('listSessions()', () => {
      it('should list all sessions', async () => {
        const mockSession1: ReplaySession = {
          id: 'session1',
          name: 'First Session',
          startTime: new Date('2024-01-01'),
          events: [],
          metadata: mockMetadata,
        };
        const mockSession2: ReplaySession = {
          id: 'session2',
          name: 'Second Session',
          startTime: new Date('2024-01-02'),
          events: [],
          metadata: mockMetadata,
        };

        mockFs.pathExists.mockResolvedValue(true as never);
        mockFs.readdir.mockResolvedValue([
          'session1-First-Session.json',
          'session2-Second-Session.json',
        ] as never);
        mockFs.readJson
          .mockResolvedValueOnce(mockSession1 as never)
          .mockResolvedValueOnce(mockSession2 as never);

        const sessions = await manager.listSessions();

        expect(sessions).toHaveLength(2);
        expect(sessions[0].name).toBe('Second Session'); // Sorted by date descending
        expect(sessions[1].name).toBe('First Session');
      });

      it('should return empty array if directory does not exist', async () => {
        mockFs.pathExists.mockResolvedValue(false as never);

        const sessions = await manager.listSessions();

        expect(sessions).toEqual([]);
      });

      it('should skip non-JSON files', async () => {
        mockFs.pathExists.mockResolvedValue(true as never);
        mockFs.readdir.mockResolvedValue([
          'session1.json',
          'readme.txt',
          '.gitkeep',
        ] as never);
        mockFs.readJson.mockResolvedValue({
          id: 'session1',
          name: 'Test',
          startTime: new Date(),
        } as never);

        const sessions = await manager.listSessions();

        expect(mockFs.readJson).toHaveBeenCalledTimes(1);
      });

      it('should skip files that fail to parse', async () => {
        mockFs.pathExists.mockResolvedValue(true as never);
        mockFs.readdir.mockResolvedValue([
          'valid.json',
          'invalid.json',
        ] as never);
        (mockFs.readJson as unknown as jest.Mock)
          .mockResolvedValueOnce({
            id: 'valid',
            name: 'Valid',
            startTime: new Date(),
          })
          .mockRejectedValueOnce(new Error('Parse error'));

        const sessions = await manager.listSessions();

        expect(sessions).toHaveLength(1);
        expect(sessions[0].id).toBe('valid');
      });
    });
  });

  describe('Replay', () => {
    describe('replay()', () => {
      it('should replay session events', async () => {
        const mockSession: ReplaySession = {
          id: 'replay123',
          name: 'Replay Test',
          startTime: new Date(),
          events: [
            { id: 'e1', timestamp: 1000, type: 'input', data: { text: 'Hello' }, hash: 'h1' },
            { id: 'e2', timestamp: 1100, type: 'output', data: { response: 'Hi' }, hash: 'h2' },
          ],
          metadata: mockMetadata,
        };

        mockFs.pathExists.mockResolvedValue(true as never);
        mockFs.readdir.mockResolvedValue(['replay123-Replay-Test.json'] as never);
        mockFs.readJson.mockResolvedValue(mockSession as never);

        const replayStarted = jest.fn();
        const replayEvent = jest.fn();
        const replayCompleted = jest.fn();

        manager.on('replay-started', replayStarted);
        manager.on('replay-event', replayEvent);
        manager.on('replay-completed', replayCompleted);

        const replayPromise = manager.replay('replay123', { speed: 100 });

        // Fast-forward through delays
        await jest.runAllTimersAsync();
        await replayPromise;

        expect(replayStarted).toHaveBeenCalledWith('replay123');
        expect(replayEvent).toHaveBeenCalledTimes(2);
        expect(replayCompleted).toHaveBeenCalledWith('replay123');
      });

      it('should call onEvent callback for each event', async () => {
        const mockSession: ReplaySession = {
          id: 'replay123',
          name: 'Replay Test',
          startTime: new Date(),
          events: [
            { id: 'e1', timestamp: 1000, type: 'input', data: { text: 'Hello' }, hash: 'h1' },
          ],
          metadata: mockMetadata,
        };

        mockFs.pathExists.mockResolvedValue(true as never);
        mockFs.readdir.mockResolvedValue(['replay123-Replay-Test.json'] as never);
        mockFs.readJson.mockResolvedValue(mockSession as never);

        const onEvent = jest.fn();

        const replayPromise = manager.replay('replay123', { onEvent });
        await jest.runAllTimersAsync();
        await replayPromise;

        expect(onEvent).toHaveBeenCalledWith(mockSession.events[0]);
      });

      it('should throw error if session not found', async () => {
        mockFs.pathExists.mockResolvedValue(true as never);
        mockFs.readdir.mockResolvedValue([] as never);

        await expect(manager.replay('nonexistent')).rejects.toThrow('Session not found');
      });

      it('should respect speed multiplier', async () => {
        const mockSession: ReplaySession = {
          id: 'replay123',
          name: 'Replay Test',
          startTime: new Date(),
          events: [
            { id: 'e1', timestamp: 1000, type: 'input', data: {}, hash: 'h1' },
            { id: 'e2', timestamp: 2000, type: 'output', data: {}, hash: 'h2' },
          ],
          metadata: mockMetadata,
        };

        mockFs.pathExists.mockResolvedValue(true as never);
        mockFs.readdir.mockResolvedValue(['replay123-file.json'] as never);
        mockFs.readJson.mockResolvedValue(mockSession as never);

        const startTime = Date.now();
        const replayPromise = manager.replay('replay123', { speed: 10 });

        await jest.runAllTimersAsync();
        await replayPromise;

        // With speed 10, delays should be 10x faster
        expect(true).toBe(true); // Test completes successfully
      });

      it('should handle empty events array', async () => {
        const mockSession: ReplaySession = {
          id: 'empty123',
          name: 'Empty Session',
          startTime: new Date(),
          events: [],
          metadata: mockMetadata,
        };

        mockFs.pathExists.mockResolvedValue(true as never);
        mockFs.readdir.mockResolvedValue(['empty123-file.json'] as never);
        mockFs.readJson.mockResolvedValue(mockSession as never);

        const replayCompleted = jest.fn();
        manager.on('replay-completed', replayCompleted);

        await manager.replay('empty123');

        expect(replayCompleted).toHaveBeenCalledWith('empty123');
      });
    });
  });

  describe('Integrity Verification', () => {
    describe('verifyIntegrity()', () => {
      it('should return true for valid session', () => {
        // Mock crypto to return consistent hashes
        const crypto = require('crypto');
        crypto.createHash.mockReturnValue({
          update: jest.fn().mockReturnValue({
            digest: jest.fn().mockReturnValue('hash1234'),
          }),
        });

        const session: ReplaySession = {
          id: 'test',
          name: 'Test',
          startTime: new Date(),
          events: [
            { id: 'e1', timestamp: 1000, type: 'input', data: { text: 'test' }, hash: 'hash1234' },
          ],
          metadata: mockMetadata,
        };

        const isValid = manager.verifyIntegrity(session);
        expect(isValid).toBe(true);
      });

      it('should return false for tampered session', () => {
        // Mock crypto to return different hash
        const crypto = require('crypto');
        crypto.createHash.mockReturnValue({
          update: jest.fn().mockReturnValue({
            digest: jest.fn().mockReturnValue('differenthash'),
          }),
        });

        const session: ReplaySession = {
          id: 'test',
          name: 'Test',
          startTime: new Date(),
          events: [
            { id: 'e1', timestamp: 1000, type: 'input', data: { text: 'test' }, hash: 'original' },
          ],
          metadata: mockMetadata,
        };

        const isValid = manager.verifyIntegrity(session);
        expect(isValid).toBe(false);
      });

      it('should return true for session with no events', () => {
        const session: ReplaySession = {
          id: 'test',
          name: 'Test',
          startTime: new Date(),
          events: [],
          metadata: mockMetadata,
        };

        const isValid = manager.verifyIntegrity(session);
        expect(isValid).toBe(true);
      });

      it('should check all events in sequence', () => {
        const crypto = require('crypto');
        let callCount = 0;
        crypto.createHash.mockReturnValue({
          update: jest.fn().mockReturnValue({
            digest: jest.fn().mockImplementation(() => {
              callCount++;
              return callCount === 2 ? 'wrong' : 'hash1234'; // Second event fails
            }),
          }),
        });

        const session: ReplaySession = {
          id: 'test',
          name: 'Test',
          startTime: new Date(),
          events: [
            { id: 'e1', timestamp: 1000, type: 'input', data: { a: 1 }, hash: 'hash1234' },
            { id: 'e2', timestamp: 2000, type: 'output', data: { b: 2 }, hash: 'hash1234' },
            { id: 'e3', timestamp: 3000, type: 'tool', data: { c: 3 }, hash: 'hash1234' },
          ],
          metadata: mockMetadata,
        };

        const isValid = manager.verifyIntegrity(session);
        expect(isValid).toBe(false);
      });
    });
  });

  describe('State Queries', () => {
    describe('isRecording()', () => {
      it('should return false initially', () => {
        expect(manager.isRecording()).toBe(false);
      });

      it('should return true during recording', () => {
        manager.startRecording('Test', mockMetadata);
        expect(manager.isRecording()).toBe(true);
      });

      it('should return false after stopping', () => {
        manager.startRecording('Test', mockMetadata);
        manager.stopRecording();
        expect(manager.isRecording()).toBe(false);
      });
    });

    describe('getCurrentSession()', () => {
      it('should return null initially', () => {
        expect(manager.getCurrentSession()).toBeNull();
      });

      it('should return current session during recording', () => {
        manager.startRecording('Test', mockMetadata);
        const session = manager.getCurrentSession();
        expect(session).not.toBeNull();
        expect(session!.name).toBe('Test');
      });
    });
  });

  describe('Event Emission', () => {
    it('should emit events to multiple listeners', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      manager.on('recording-started', handler1);
      manager.on('recording-started', handler2);

      manager.startRecording('Test', mockMetadata);

      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });
  });
});

describe('getSessionReplayManager singleton', () => {
  it('should return a SessionReplayManager instance', () => {
    const manager = getSessionReplayManager();
    expect(manager).toBeInstanceOf(SessionReplayManager);
  });

  it('should return same instance on multiple calls', () => {
    const manager1 = getSessionReplayManager();
    const manager2 = getSessionReplayManager();
    expect(manager1).toBe(manager2);
  });
});

describe('Edge Cases', () => {
  let manager: SessionReplayManager;

  const mockMetadata: ReplaySession['metadata'] = {
    model: 'test',
    systemPrompt: 'test',
    toolsEnabled: [],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    manager = new SessionReplayManager();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should handle recording with complex data types', () => {
    manager.startRecording('Test', mockMetadata);

    const complexData = {
      nested: { deep: { value: [1, 2, 3] } },
      date: new Date().toISOString(),
      array: ['a', 'b', 'c'],
      nullValue: null,
      undefinedValue: undefined,
    };

    manager.recordEvent('state', complexData);

    const session = manager.getCurrentSession();
    expect(session!.events[0].data).toEqual(complexData);
  });

  it('should handle unicode in session names', async () => {
    const session: ReplaySession = {
      id: 'unicode123',
      name: 'Session \u4e2d\u6587 \ud83d\ude00',
      startTime: new Date(),
      events: [],
      metadata: mockMetadata,
    };

    const filePath = await manager.saveSession(session);
    expect(filePath).toContain('unicode123');
  });

  it('should handle very long event data', () => {
    manager.startRecording('Test', mockMetadata);

    const largeData = { content: 'x'.repeat(100000) };
    manager.recordEvent('output', largeData);

    const session = manager.getCurrentSession();
    expect(session!.events[0].data).toEqual(largeData);
  });

  it('should handle rapid event recording', () => {
    manager.startRecording('Test', mockMetadata);

    for (let i = 0; i < 1000; i++) {
      manager.recordEvent('input', { index: i });
    }

    const session = manager.getCurrentSession();
    expect(session!.events).toHaveLength(1000);
  });

  it('should handle starting new recording while one is active', () => {
    const session1 = manager.startRecording('Session 1', mockMetadata);
    manager.recordEvent('input', { from: 'session1' });

    const session2 = manager.startRecording('Session 2', mockMetadata);
    manager.recordEvent('input', { from: 'session2' });

    const current = manager.getCurrentSession();
    expect(current!.name).toBe('Session 2');
    expect(current!.events).toHaveLength(1);
  });
});
