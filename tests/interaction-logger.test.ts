/**
 * Interaction Logger Tests
 */

import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  createInteractionLogger,
  InteractionLogger,
  SessionData,
} from '../src/logging/interaction-logger.js';

// ============================================================================
// Test Setup
// ============================================================================

const _TEST_DIR = join(tmpdir(), 'grok-test-logs');

// Mock the log directory
jest.mock('os', () => {
  const impl = {
  ...await vi.importActual('os'),
  homedir: () => join(tmpdir(), 'grok-test-home'),
};
  return { ...impl, default: impl };
});

beforeEach(() => {
  // Create test directories
  const mockHome = join(tmpdir(), 'grok-test-home');
  const logsDir = join(mockHome, '.codebuddy', 'logs');
  if (!existsSync(logsDir)) {
    mkdirSync(logsDir, { recursive: true });
  }
});

afterEach(() => {
  // Clean up test directories
  const mockHome = join(tmpdir(), 'grok-test-home');
  if (existsSync(mockHome)) {
    rmSync(mockHome, { recursive: true, force: true });
  }
});

// ============================================================================
// Session Management Tests
// ============================================================================

describe('Session Management', () => {
  it('should start a new session', () => {
    const logger = createInteractionLogger({ autoSave: false });

    const sessionId = logger.startSession({
      model: 'grok-3',
      provider: 'xai',
    });

    expect(sessionId).toBeDefined();
    expect(sessionId.length).toBe(36); // UUID length

    const session = logger.getCurrentSession();
    expect(session).not.toBeNull();
    expect(session?.metadata.model).toBe('grok-3');
    expect(session?.metadata.provider).toBe('xai');
    expect(session?.metadata.short_id.length).toBe(8);
  });

  it('should end a session', () => {
    const logger = createInteractionLogger({ autoSave: false });

    logger.startSession({
      model: 'grok-3',
      provider: 'xai',
    });

    logger.endSession();

    expect(logger.getCurrentSession()).toBeNull();
  });

  it('should include metadata in session', () => {
    const logger = createInteractionLogger({ autoSave: false });

    logger.startSession({
      model: 'grok-3',
      provider: 'xai',
      cwd: '/test/path',
      tags: ['test', 'example'],
      description: 'Test session',
      gitInfo: { branch: 'main', commit: 'abc123' },
    });

    const session = logger.getCurrentSession();
    expect(session?.metadata.cwd).toBe('/test/path');
    expect(session?.metadata.tags).toEqual(['test', 'example']);
    expect(session?.metadata.description).toBe('Test session');
    expect(session?.metadata.git_branch).toBe('main');
    expect(session?.metadata.git_commit).toBe('abc123');
  });
});

// ============================================================================
// Message Logging Tests
// ============================================================================

describe('Message Logging', () => {
  it('should log user messages', () => {
    const logger = createInteractionLogger({ autoSave: false });
    logger.startSession({ model: 'grok-3', provider: 'xai' });

    logger.logMessage({
      role: 'user',
      content: 'Hello, world!',
      tokens: 5,
    });

    const session = logger.getCurrentSession();
    expect(session?.messages.length).toBe(1);
    expect(session?.messages[0].role).toBe('user');
    expect(session?.messages[0].content).toBe('Hello, world!');
    expect(session?.metadata.turns).toBe(1);
    expect(session?.metadata.total_input_tokens).toBe(5);
  });

  it('should log assistant messages', () => {
    const logger = createInteractionLogger({ autoSave: false });
    logger.startSession({ model: 'grok-3', provider: 'xai' });

    logger.logMessage({
      role: 'assistant',
      content: 'Hello! How can I help?',
      tokens: 10,
    });

    const session = logger.getCurrentSession();
    expect(session?.messages[0].role).toBe('assistant');
    expect(session?.metadata.total_output_tokens).toBe(10);
  });

  it('should log system messages', () => {
    const logger = createInteractionLogger({ autoSave: false });
    logger.startSession({ model: 'grok-3', provider: 'xai' });

    logger.logMessage({
      role: 'system',
      content: 'You are a helpful assistant.',
      tokens: 20,
    });

    const session = logger.getCurrentSession();
    expect(session?.messages[0].role).toBe('system');
    expect(session?.metadata.total_input_tokens).toBe(20);
  });

  it('should log tool messages', () => {
    const logger = createInteractionLogger({ autoSave: false });
    logger.startSession({ model: 'grok-3', provider: 'xai' });

    logger.logMessage({
      role: 'tool',
      content: '{"result": "success"}',
      tool_call_id: 'call_123',
    });

    const session = logger.getCurrentSession();
    expect(session?.messages[0].role).toBe('tool');
    expect(session?.messages[0].tool_call_id).toBe('call_123');
  });
});

// ============================================================================
// Tool Call Logging Tests
// ============================================================================

describe('Tool Call Logging', () => {
  it('should log tool calls', () => {
    const logger = createInteractionLogger({ autoSave: false });
    logger.startSession({ model: 'grok-3', provider: 'xai' });

    // Add assistant message first
    logger.logMessage({
      role: 'assistant',
      content: 'Let me check that for you.',
    });

    // Log tool calls
    logger.logToolCalls([
      {
        id: 'call_123',
        name: 'search',
        arguments: { query: 'test' },
      },
    ]);

    const session = logger.getCurrentSession();
    expect(session?.messages[0].tool_calls?.length).toBe(1);
    expect(session?.messages[0].tool_calls?.[0].name).toBe('search');
    expect(session?.metadata.tool_calls).toBe(1);
  });

  it('should log tool results', () => {
    const logger = createInteractionLogger({ autoSave: false });
    logger.startSession({ model: 'grok-3', provider: 'xai' });

    logger.logMessage({
      role: 'assistant',
      content: 'Searching...',
    });

    logger.logToolCalls([
      {
        id: 'call_123',
        name: 'search',
        arguments: { query: 'test' },
      },
    ]);

    logger.logToolResult('call_123', {
      success: true,
      output: 'Found 5 results',
      duration_ms: 150,
    });

    const session = logger.getCurrentSession();
    const toolCall = session?.messages[0].tool_calls?.[0];
    expect(toolCall?.success).toBe(true);
    expect(toolCall?.output).toBe('Found 5 results');
    expect(toolCall?.duration_ms).toBe(150);
  });

  it('should log failed tool results', () => {
    const logger = createInteractionLogger({ autoSave: false });
    logger.startSession({ model: 'grok-3', provider: 'xai' });

    logger.logMessage({ role: 'assistant', content: 'Running...' });
    logger.logToolCalls([
      { id: 'call_456', name: 'bash', arguments: { command: 'ls' } },
    ]);
    logger.logToolResult('call_456', {
      success: false,
      error: 'Command not found',
    });

    const session = logger.getCurrentSession();
    const toolCall = session?.messages[0].tool_calls?.[0];
    expect(toolCall?.success).toBe(false);
    expect(toolCall?.error).toBe('Command not found');
  });
});

// ============================================================================
// Cost Tracking Tests
// ============================================================================

describe('Cost Tracking', () => {
  it('should update session cost', () => {
    const logger = createInteractionLogger({ autoSave: false });
    logger.startSession({ model: 'grok-3', provider: 'xai' });

    logger.updateCost(0.0025);

    const session = logger.getCurrentSession();
    expect(session?.metadata.estimated_cost).toBe(0.0025);
  });

  it('should accumulate token counts', () => {
    const logger = createInteractionLogger({ autoSave: false });
    logger.startSession({ model: 'grok-3', provider: 'xai' });

    logger.logMessage({ role: 'user', content: 'Hello', tokens: 10 });
    logger.logMessage({ role: 'assistant', content: 'Hi!', tokens: 5 });
    logger.logMessage({ role: 'user', content: 'How are you?', tokens: 15 });

    const session = logger.getCurrentSession();
    expect(session?.metadata.total_input_tokens).toBe(25);
    expect(session?.metadata.total_output_tokens).toBe(5);
    expect(session?.metadata.turns).toBe(2);
  });
});

// ============================================================================
// Session Search Tests
// ============================================================================

describe('Session Search', () => {
  it('should get current session ID', () => {
    const logger = createInteractionLogger({ autoSave: false });
    const sessionId = logger.startSession({ model: 'grok-3', provider: 'xai' });

    expect(logger.getCurrentSessionId()).toBe(sessionId);
  });

  it('should return null when no session', () => {
    const logger = createInteractionLogger({ autoSave: false });

    expect(logger.getCurrentSessionId()).toBeNull();
    expect(logger.getCurrentSession()).toBeNull();
  });
});

// ============================================================================
// Session Formatting Tests
// ============================================================================

describe('Session Formatting', () => {
  it('should format session for display', () => {
    const session: SessionData = {
      version: '1.0.0',
      metadata: {
        id: '12345678-1234-1234-1234-123456789012',
        short_id: '12345678',
        started_at: '2025-01-01T10:00:00.000Z',
        ended_at: '2025-01-01T10:30:00.000Z',
        duration_ms: 1800000,
        model: 'grok-3',
        provider: 'xai',
        cwd: '/home/test',
        total_input_tokens: 1000,
        total_output_tokens: 500,
        estimated_cost: 0.05,
        turns: 5,
        tool_calls: 3,
        tags: ['test'],
      },
      messages: [
        {
          role: 'user',
          content: 'Hello',
          timestamp: '2025-01-01T10:00:00.000Z',
        },
        {
          role: 'assistant',
          content: 'Hi there!',
          timestamp: '2025-01-01T10:00:01.000Z',
          tool_calls: [
            {
              id: 'call_1',
              name: 'search',
              arguments: { query: 'test' },
              timestamp: '2025-01-01T10:00:02.000Z',
              success: true,
            },
          ],
        },
      ],
    };

    const formatted = InteractionLogger.formatSession(session);

    expect(formatted).toContain('Session: 12345678');
    expect(formatted).toContain('Model: grok-3');
    expect(formatted).toContain('Turns: 5');
    expect(formatted).toContain('Tool calls: 3');
    expect(formatted).toContain('$0.0500');
    expect(formatted).toContain('USER');
    expect(formatted).toContain('ASSISTANT');
    expect(formatted).toContain('✓ Tool: search');
  });
});

// ============================================================================
// Cleanup Tests
// ============================================================================

describe('Logger Cleanup', () => {
  it('should dispose resources', () => {
    const logger = createInteractionLogger({ autoSave: false });
    logger.startSession({ model: 'grok-3', provider: 'xai' });

    logger.dispose();

    expect(logger.getCurrentSession()).toBeNull();
  });

  it('should not throw when no session', () => {
    const logger = createInteractionLogger({ autoSave: false });

    // These should not throw
    logger.logMessage({ role: 'user', content: 'test' });
    logger.logToolCalls([]);
    logger.logToolResult('id', { success: true });
    logger.updateCost(0);
    logger.dispose();
  });
});
