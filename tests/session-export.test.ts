/**
 * Session Export & Replay Tests
 */

import {
  SessionRecorder,
  SessionExporter,
  SessionPlayer,
  getSessionRecorder,
  resetSessionRecorder,
  exportSession,
  type ExportedSession,
  type SessionMessage,
  type ExportFormat,
} from '../src/persistence/session-export.js';

describe('SessionRecorder', () => {
  let recorder: SessionRecorder;

  beforeEach(() => {
    recorder = new SessionRecorder({ name: 'Test Session' });
  });

  afterEach(() => {
    recorder.dispose();
  });

  describe('Recording', () => {
    it('should start and stop recording', () => {
      expect(recorder).toBeDefined();

      recorder.start();
      // Recording is active
      recorder.stop();
      // Recording is stopped
    });

    it('should not record when not started', () => {
      recorder.addUserMessage('test');
      const session = recorder.getSession();
      expect(session.messages).toHaveLength(0);
    });

    it('should record messages when started', () => {
      recorder.start();
      recorder.addUserMessage('Hello');
      recorder.addAssistantMessage('Hi there!');

      const session = recorder.getSession();
      expect(session.messages).toHaveLength(2);
    });
  });

  describe('Message Types', () => {
    beforeEach(() => {
      recorder.start();
    });

    it('should record user messages', () => {
      recorder.addUserMessage('User input');
      const session = recorder.getSession();

      expect(session.messages[0].role).toBe('user');
      expect(session.messages[0].content).toBe('User input');
    });

    it('should record assistant messages', () => {
      recorder.addAssistantMessage('Assistant response');
      const session = recorder.getSession();

      expect(session.messages[0].role).toBe('assistant');
    });

    it('should record assistant messages with tool calls', () => {
      recorder.addAssistantMessage('Let me check that', [
        {
          id: 'call_1',
          name: 'search',
          arguments: { query: 'test' },
          timestamp: Date.now(),
        },
      ]);

      const session = recorder.getSession();
      expect(session.messages[0].toolCalls).toHaveLength(1);
      expect(session.messages[0].toolCalls![0].name).toBe('search');
    });

    it('should record tool results', () => {
      recorder.addAssistantMessage('Checking...');
      recorder.addToolResult('call_1', 'Result data', true, 150);

      const session = recorder.getSession();
      expect(session.messages[0].toolResults).toHaveLength(1);
      expect(session.messages[0].toolResults![0].success).toBe(true);
      expect(session.messages[0].toolResults![0].duration).toBe(150);
    });
  });

  describe('Metadata', () => {
    beforeEach(() => {
      recorder.start();
    });

    it('should track message count', () => {
      recorder.addUserMessage('1');
      recorder.addAssistantMessage('2');
      recorder.addUserMessage('3');

      const session = recorder.getSession();
      expect(session.metadata.messageCount).toBe(3);
    });

    it('should track tool call count', () => {
      recorder.addAssistantMessage('', [
        { id: '1', name: 'tool1', arguments: {}, timestamp: Date.now() },
        { id: '2', name: 'tool2', arguments: {}, timestamp: Date.now() },
      ]);

      const session = recorder.getSession();
      expect(session.metadata.toolCallCount).toBe(2);
    });

    it('should update usage', () => {
      recorder.updateUsage(1000, 0.05);
      recorder.updateUsage(500, 0.02);

      const session = recorder.getSession();
      expect(session.metadata.totalTokens).toBe(1500);
      expect(session.metadata.totalCost).toBeCloseTo(0.07);
    });

    it('should support tags', () => {
      recorder.addTags('debug', 'feature-x');
      recorder.addTags('debug'); // Duplicate should be ignored

      const session = recorder.getSession();
      expect(session.metadata.tags).toContain('debug');
      expect(session.metadata.tags).toContain('feature-x');
      expect(session.metadata.tags).toHaveLength(2);
    });

    it('should set summary', () => {
      recorder.setSummary('This session debugged feature X');
      const session = recorder.getSession();
      expect(session.metadata.summary).toBe('This session debugged feature X');
    });
  });

  describe('Checkpoints', () => {
    beforeEach(() => {
      recorder.start();
    });

    it('should create checkpoints', () => {
      recorder.addUserMessage('msg1');
      recorder.addAssistantMessage('msg2');
      const cpId = recorder.createCheckpoint('Before change');

      const session = recorder.getSession();
      expect(session.checkpoints).toHaveLength(1);
      expect(session.checkpoints![0].label).toBe('Before change');
      expect(session.checkpoints![0].messageIndex).toBe(2);
      expect(cpId).toBeDefined();
    });

    it('should emit checkpoint event', () => {
      const handler = jest.fn();
      recorder.on('checkpoint:created', handler);

      recorder.createCheckpoint('Test CP');
      expect(handler).toHaveBeenCalled();
    });
  });

  describe('Events', () => {
    it('should emit recording events', () => {
      const startHandler = jest.fn();
      const stopHandler = jest.fn();

      recorder.on('recording:started', startHandler);
      recorder.on('recording:stopped', stopHandler);

      recorder.start();
      expect(startHandler).toHaveBeenCalled();

      recorder.stop();
      expect(stopHandler).toHaveBeenCalled();
    });

    it('should emit message added event', () => {
      const handler = jest.fn();
      recorder.on('message:added', handler);

      recorder.start();
      recorder.addUserMessage('test');

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('Singleton', () => {
    it('should return same instance', () => {
      resetSessionRecorder();
      const i1 = getSessionRecorder();
      const i2 = getSessionRecorder();
      expect(i1).toBe(i2);
    });
  });
});

describe('SessionExporter', () => {
  let exporter: SessionExporter;
  let testSession: ExportedSession;

  beforeEach(() => {
    exporter = new SessionExporter();
    testSession = {
      version: '1.0.0',
      exportedAt: Date.now(),
      metadata: {
        id: 'test-123',
        name: 'Test Session',
        createdAt: Date.now() - 60000,
        updatedAt: Date.now(),
        totalTokens: 1500,
        totalCost: 0.05,
        messageCount: 3,
        toolCallCount: 1,
        tags: ['test'],
        provider: 'grok',
        model: 'grok-3-latest',
      },
      messages: [
        { id: '1', role: 'user', content: 'Hello', timestamp: Date.now() - 30000 },
        {
          id: '2',
          role: 'assistant',
          content: 'Hi there!',
          timestamp: Date.now() - 20000,
          toolCalls: [{ id: 'tc1', name: 'greet', arguments: {}, timestamp: Date.now() }],
          toolResults: [{ toolCallId: 'tc1', result: 'ok', success: true, duration: 50 }],
        },
        { id: '3', role: 'user', content: 'Bye', timestamp: Date.now() },
      ],
      checkpoints: [{ id: 'cp1', messageIndex: 1, label: 'Test CP', createdAt: Date.now() }],
    };
  });

  describe('JSON Export', () => {
    it('should export as JSON', () => {
      const result = exporter.export(testSession, { format: 'json' });
      const parsed = JSON.parse(result);

      expect(parsed.version).toBe('1.0.0');
      expect(parsed.messages).toHaveLength(3);
    });

    it('should include metadata', () => {
      const result = exporter.export(testSession, { format: 'json', includeMetadata: true });
      const parsed = JSON.parse(result);

      expect(parsed.metadata.name).toBe('Test Session');
    });

    it('should exclude metadata when requested', () => {
      const result = exporter.export(testSession, { format: 'json', includeMetadata: false });
      const parsed = JSON.parse(result);

      expect(parsed.metadata).toBeUndefined();
    });

    it('should exclude tool results when requested', () => {
      const result = exporter.export(testSession, { format: 'json', includeToolResults: false });
      const parsed = JSON.parse(result);

      expect(parsed.messages[1].toolResults).toBeUndefined();
    });
  });

  describe('Markdown Export', () => {
    it('should export as Markdown', () => {
      const result = exporter.export(testSession, { format: 'markdown' });

      expect(result).toContain('# Test Session');
      expect(result).toContain('## Session Info');
      expect(result).toContain('## Conversation');
      expect(result).toContain('👤 User');
      expect(result).toContain('🤖 Assistant');
    });

    it('should include checkpoints', () => {
      const result = exporter.export(testSession, { format: 'markdown', includeCheckpoints: true });
      expect(result).toContain('## Checkpoints');
      expect(result).toContain('Test CP');
    });

    it('should use custom title', () => {
      const result = exporter.export(testSession, { format: 'markdown', title: 'Custom Title' });
      expect(result).toContain('# Custom Title');
    });
  });

  describe('HTML Export', () => {
    it('should export as HTML', () => {
      const result = exporter.export(testSession, { format: 'html' });

      expect(result).toContain('<!DOCTYPE html>');
      expect(result).toContain('<title>Test Session</title>');
      expect(result).toContain('class="message user"');
      expect(result).toContain('class="message assistant"');
    });

    it('should include styles', () => {
      const result = exporter.export(testSession, { format: 'html' });
      expect(result).toContain('<style>');
    });

    it('should escape HTML in content', () => {
      const sessionWithHtml: ExportedSession = {
        ...testSession,
        messages: [{ id: '1', role: 'user', content: '<script>alert("xss")</script>', timestamp: Date.now() }],
      };

      const result = exporter.export(sessionWithHtml, { format: 'html' });
      expect(result).not.toContain('<script>alert');
      expect(result).toContain('&lt;script&gt;');
    });
  });

  describe('Secret Redaction', () => {
    it('should redact secrets by default', () => {
      const sessionWithSecret: ExportedSession = {
        ...testSession,
        messages: [{ id: '1', role: 'user', content: 'Key: sk-1234567890abcdefghijklmnop', timestamp: Date.now() }],
      };

      const result = exporter.export(sessionWithSecret, { format: 'json', redactSecrets: true });
      expect(result).toContain('[REDACTED');
      expect(result).not.toContain('sk-1234567890');
    });

    it('should not redact when disabled', () => {
      const sessionWithSecret: ExportedSession = {
        ...testSession,
        messages: [{ id: '1', role: 'user', content: 'Key: sk-1234567890abcdefghijklmnop', timestamp: Date.now() }],
      };

      const result = exporter.export(sessionWithSecret, { format: 'json', redactSecrets: false });
      expect(result).toContain('sk-1234567890');
    });
  });
});

describe('SessionPlayer', () => {
  let player: SessionPlayer;
  let testSession: ExportedSession;

  beforeEach(() => {
    player = new SessionPlayer();
    testSession = {
      version: '1.0.0',
      exportedAt: Date.now(),
      metadata: {
        id: 'test',
        name: 'Test',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        totalTokens: 100,
        totalCost: 0.01,
        messageCount: 2,
        toolCallCount: 0,
        tags: [],
      },
      messages: [
        { id: '1', role: 'user', content: 'Hello', timestamp: 1000 },
        { id: '2', role: 'assistant', content: 'Hi', timestamp: 2000 },
        { id: '3', role: 'user', content: 'Bye', timestamp: 3000 },
      ],
      checkpoints: [{ id: 'cp1', messageIndex: 1, label: 'Mid', createdAt: Date.now() }],
    };
  });

  afterEach(() => {
    player.dispose();
  });

  describe('Loading', () => {
    it('should load session', () => {
      player.load(testSession);
      const state = player.getState();

      expect(state.loaded).toBe(true);
      expect(state.totalMessages).toBe(3);
    });

    it('should emit loaded event', () => {
      const handler = jest.fn();
      player.on('loaded', handler);

      player.load(testSession);
      expect(handler).toHaveBeenCalled();
    });
  });

  describe('State', () => {
    it('should report initial state', () => {
      const state = player.getState();

      expect(state.loaded).toBe(false);
      expect(state.playing).toBe(false);
      expect(state.paused).toBe(false);
      expect(state.progress).toBe(0);
    });

    it('should track progress', () => {
      player.load(testSession);
      player.jumpToIndex(1);

      const state = player.getState();
      expect(state.currentIndex).toBe(1);
      expect(state.progress).toBeGreaterThan(0);
    });
  });

  describe('Navigation', () => {
    beforeEach(() => {
      player.load(testSession);
    });

    it('should jump to index', () => {
      player.jumpToIndex(2);
      expect(player.getState().currentIndex).toBe(2);
    });

    it('should clamp index to valid range', () => {
      player.jumpToIndex(100);
      expect(player.getState().currentIndex).toBe(2); // Last message

      player.jumpToIndex(-5);
      expect(player.getState().currentIndex).toBe(0);
    });

    it('should jump to checkpoint', () => {
      const result = player.jumpToCheckpoint('cp1');
      expect(result).toBe(true);
      expect(player.getState().currentIndex).toBe(1);
    });

    it('should return false for invalid checkpoint', () => {
      const result = player.jumpToCheckpoint('invalid');
      expect(result).toBe(false);
    });
  });

  describe('Messages Up To Current', () => {
    beforeEach(() => {
      player.load(testSession);
    });

    it('should return messages up to current index', () => {
      player.jumpToIndex(1);
      const messages = player.getMessagesUpToCurrent();

      expect(messages).toHaveLength(2);
      expect(messages[0].content).toBe('Hello');
      expect(messages[1].content).toBe('Hi');
    });
  });

  describe('Replay Control', () => {
    beforeEach(() => {
      player.load(testSession);
    });

    it('should pause and resume', () => {
      player.pause();
      expect(player.getState().paused).toBe(true);

      player.resume();
      expect(player.getState().paused).toBe(false);
    });

    it('should stop', () => {
      player.stop();
      expect(player.getState().playing).toBe(false);
    });

    it('should emit control events', () => {
      const pauseHandler = jest.fn();
      const resumeHandler = jest.fn();
      const stopHandler = jest.fn();

      player.on('paused', pauseHandler);
      player.on('resumed', resumeHandler);
      player.on('stopped', stopHandler);

      player.pause();
      expect(pauseHandler).toHaveBeenCalled();

      player.resume();
      expect(resumeHandler).toHaveBeenCalled();

      player.stop();
      expect(stopHandler).toHaveBeenCalled();
    });
  });

  describe('Replay', () => {
    it('should replay with instant speed', async () => {
      player.load(testSession);
      const messageHandler = jest.fn();

      await player.replay({
        speed: 0, // Instant
        onMessage: messageHandler,
      });

      expect(messageHandler).toHaveBeenCalledTimes(3);
    });

    it('should respect startFrom option', async () => {
      player.load(testSession);
      const messageHandler = jest.fn();

      await player.replay({
        speed: 0,
        startFrom: 1,
        onMessage: messageHandler,
      });

      expect(messageHandler).toHaveBeenCalledTimes(2);
    });

    it('should respect stopAt option', async () => {
      player.load(testSession);
      const messageHandler = jest.fn();

      await player.replay({
        speed: 0,
        stopAt: 2,
        onMessage: messageHandler,
      });

      expect(messageHandler).toHaveBeenCalledTimes(2);
    });
  });
});
