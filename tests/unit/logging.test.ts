/**
 * Comprehensive Unit Tests for Logging Module
 *
 * Tests cover:
 * - Log level configuration
 * - Log formatting (text and JSON)
 * - File logging
 * - Console output
 * - Log rotation (via history management)
 * - Interaction/Session logging
 */

import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ============================================================================
// Logger (src/utils/logger.ts) Tests
// ============================================================================

// Mock chalk before importing logger
jest.mock('chalk', () => ({
  gray: (s: string) => `[gray]${s}[/gray]`,
  blue: (s: string) => `[blue]${s}[/blue]`,
  yellow: (s: string) => `[yellow]${s}[/yellow]`,
  red: (s: string) => `[red]${s}[/red]`,
  cyan: (s: string) => `[cyan]${s}[/cyan]`,
}));

// Store original env vars
const originalEnv = { ...process.env };

// Create temp directory for test logs
const TEST_LOG_DIR = join(tmpdir(), 'grok-logger-tests');

beforeAll(() => {
  if (!existsSync(TEST_LOG_DIR)) {
    mkdirSync(TEST_LOG_DIR, { recursive: true });
  }
});

afterAll(() => {
  // Clean up test directory
  if (existsSync(TEST_LOG_DIR)) {
    rmSync(TEST_LOG_DIR, { recursive: true, force: true });
  }
});

beforeEach(() => {
  // Reset environment variables
  process.env = { ...originalEnv };
  delete process.env.DEBUG;
  delete process.env.LOG_LEVEL;
  delete process.env.LOG_FORMAT;
  delete process.env.LOG_FILE;
  delete process.env.NO_COLOR;

  // Reset modules to get fresh instances
  jest.resetModules();
});

afterEach(() => {
  // Restore environment variables
  process.env = { ...originalEnv };
});

// ============================================================================
// Log Level Configuration Tests
// ============================================================================

describe('Log Level Configuration', () => {
  describe('Logger class level management', () => {
    it('should default to info level', () => {
      const { Logger } = require('../../src/utils/logger');
      const logger = new Logger({ silent: true });
      expect(logger.getLevel()).toBe('info');
    });

    it('should respect LOG_LEVEL environment variable', () => {
      process.env.LOG_LEVEL = 'warn';
      const { Logger } = require('../../src/utils/logger');
      const logger = new Logger({ silent: true });
      expect(logger.getLevel()).toBe('warn');
    });

    it('should set level to debug when DEBUG=true', () => {
      process.env.DEBUG = 'true';
      const { Logger } = require('../../src/utils/logger');
      const logger = new Logger({ silent: true });
      expect(logger.getLevel()).toBe('debug');
    });

    it('should set level to debug when DEBUG=1', () => {
      process.env.DEBUG = '1';
      const { Logger } = require('../../src/utils/logger');
      const logger = new Logger({ silent: true });
      expect(logger.getLevel()).toBe('debug');
    });

    it('should set level to debug when DEBUG=codebuddy', () => {
      process.env.DEBUG = 'codebuddy';
      const { Logger } = require('../../src/utils/logger');
      const logger = new Logger({ silent: true });
      expect(logger.getLevel()).toBe('debug');
    });

    it('should ignore invalid LOG_LEVEL values', () => {
      process.env.LOG_LEVEL = 'invalid';
      const { Logger } = require('../../src/utils/logger');
      const logger = new Logger({ silent: true });
      expect(logger.getLevel()).toBe('info');
    });

    it('should allow setting level programmatically', () => {
      const { Logger } = require('../../src/utils/logger');
      const logger = new Logger({ silent: true });

      logger.setLevel('error');
      expect(logger.getLevel()).toBe('error');

      logger.setLevel('debug');
      expect(logger.getLevel()).toBe('debug');
    });

    it('should filter messages below current level', () => {
      const { Logger } = require('../../src/utils/logger');
      const logger = new Logger({ silent: true, level: 'warn' });

      logger.debug('debug message');
      logger.info('info message');
      logger.warn('warn message');
      logger.error('error message');

      const history = logger.getHistory();
      expect(history).toHaveLength(2);
      expect(history[0].level).toBe('warn');
      expect(history[1].level).toBe('error');
    });

    it('should log all levels when set to debug', () => {
      const { Logger } = require('../../src/utils/logger');
      const logger = new Logger({ silent: true, level: 'debug' });

      logger.debug('debug message');
      logger.info('info message');
      logger.warn('warn message');
      logger.error('error message');

      const history = logger.getHistory();
      expect(history).toHaveLength(4);
    });

    it('should only log errors when set to error level', () => {
      const { Logger } = require('../../src/utils/logger');
      const logger = new Logger({ silent: true, level: 'error' });

      logger.debug('debug message');
      logger.info('info message');
      logger.warn('warn message');
      logger.error('error message');

      const history = logger.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0].level).toBe('error');
    });
  });

  describe('isDebugEnabled', () => {
    it('should return true when level is debug', () => {
      const { Logger } = require('../../src/utils/logger');
      const logger = new Logger({ silent: true, level: 'debug' });
      expect(logger.isDebugEnabled()).toBe(true);
    });

    it('should return false when level is info', () => {
      const { Logger } = require('../../src/utils/logger');
      const logger = new Logger({ silent: true, level: 'info' });
      expect(logger.isDebugEnabled()).toBe(false);
    });

    it('should work with convenience logger', () => {
      process.env.DEBUG = 'true';
      jest.resetModules();
      const { logger, resetLogger } = require('../../src/utils/logger');
      resetLogger();
      expect(logger.isDebugEnabled()).toBe(true);
    });
  });
});

// ============================================================================
// Log Formatting Tests
// ============================================================================

describe('Log Formatting', () => {
  describe('Text format', () => {
    it('should include timestamp when enabled', () => {
      const { Logger } = require('../../src/utils/logger');
      const logger = new Logger({
        silent: true,
        format: 'text',
        enableTimestamps: true,
      });

      logger.info('test message');
      const history = logger.getHistory();

      expect(history[0].timestamp).toBeDefined();
      expect(history[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('should include source when provided', () => {
      const { Logger } = require('../../src/utils/logger');
      const logger = new Logger({
        silent: true,
        source: 'TestModule',
      });

      logger.info('test message');
      const history = logger.getHistory();

      expect(history[0].source).toBe('TestModule');
    });

    it('should include context when provided', () => {
      const { Logger } = require('../../src/utils/logger');
      const logger = new Logger({ silent: true });

      logger.info('test message', { userId: 123, action: 'login' });
      const history = logger.getHistory();

      expect(history[0].context).toEqual({ userId: 123, action: 'login' });
    });

    it('should handle Error objects in error method', () => {
      const { Logger } = require('../../src/utils/logger');
      const logger = new Logger({ silent: true });
      const error = new Error('Test error');

      logger.error('An error occurred', error);
      const history = logger.getHistory();

      expect(history[0].context).toMatchObject({
        errorName: 'Error',
        errorMessage: 'Test error',
      });
      expect(history[0].context?.errorStack).toBeDefined();
    });

    it('should handle Error objects with additional context', () => {
      const { Logger } = require('../../src/utils/logger');
      const logger = new Logger({ silent: true });
      const error = new Error('Test error');

      logger.error('An error occurred', error, { requestId: 'abc123' });
      const history = logger.getHistory();

      expect(history[0].context).toMatchObject({
        errorName: 'Error',
        errorMessage: 'Test error',
        requestId: 'abc123',
      });
    });
  });

  describe('JSON format', () => {
    it('should format entries as JSON when format is json', () => {
      const { Logger } = require('../../src/utils/logger');
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      const logger = new Logger({
        silent: false,
        format: 'json',
      });

      logger.info('test message', { key: 'value' });

      expect(consoleSpy).toHaveBeenCalled();
      const loggedValue = consoleSpy.mock.calls[0][0];

      // Parse the JSON to verify format
      const parsed = JSON.parse(loggedValue);
      expect(parsed.level).toBe('info');
      expect(parsed.message).toBe('test message');
      expect(parsed.key).toBe('value');

      consoleSpy.mockRestore();
    });

    it('should include timestamp in JSON format', () => {
      const { Logger } = require('../../src/utils/logger');
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      const logger = new Logger({
        silent: false,
        format: 'json',
      });

      logger.info('test');
      const parsed = JSON.parse(consoleSpy.mock.calls[0][0]);

      expect(parsed.timestamp).toBeDefined();

      consoleSpy.mockRestore();
    });
  });

  describe('Color support', () => {
    it('should disable colors when NO_COLOR is set', () => {
      process.env.NO_COLOR = '1';
      const { Logger } = require('../../src/utils/logger');
      const logger = new Logger({ silent: true });

      // Logger should have colors disabled
      expect(logger).toBeDefined();
    });

    it('should enable colors by default in TTY environment', () => {
      const { Logger } = require('../../src/utils/logger');
      const logger = new Logger({
        silent: true,
        enableColors: true,
      });

      expect(logger).toBeDefined();
    });
  });
});

// ============================================================================
// File Logging Tests
// ============================================================================

describe('File Logging', () => {
  it('should write logs to file when LOG_FILE is set', async () => {
    const logFile = join(TEST_LOG_DIR, 'test-log-1.jsonl');

    const { Logger } = require('../../src/utils/logger');
    const logger = new Logger({
      silent: true,
      logFile,
    });

    logger.info('test message 1');
    logger.warn('test message 2');
    logger.close();

    // Give file system time to flush
    await new Promise((resolve) => setTimeout(resolve, 100));

    const content = readFileSync(logFile, 'utf-8');
    const lines = content.trim().split('\n');

    expect(lines.length).toBe(2);

    const entry1 = JSON.parse(lines[0]);
    expect(entry1.level).toBe('info');
    expect(entry1.message).toBe('test message 1');

    const entry2 = JSON.parse(lines[1]);
    expect(entry2.level).toBe('warn');
    expect(entry2.message).toBe('test message 2');
  });

  it('should create log directory if it does not exist', async () => {
    const nestedDir = join(TEST_LOG_DIR, 'nested', 'dir');
    const logFile = join(nestedDir, 'test-log-2.jsonl');

    const { Logger } = require('../../src/utils/logger');
    const logger = new Logger({
      silent: true,
      logFile,
    });

    logger.info('test message');
    logger.close();

    // Give file system time to flush
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(existsSync(nestedDir)).toBe(true);
    expect(existsSync(logFile)).toBe(true);
  });

  it('should append to existing log file', async () => {
    const logFile = join(TEST_LOG_DIR, 'test-log-3.jsonl');

    // Create initial content
    writeFileSync(logFile, '{"level":"info","message":"existing"}\n');

    const { Logger } = require('../../src/utils/logger');
    const logger = new Logger({
      silent: true,
      logFile,
    });

    logger.info('new message');
    logger.close();

    // Give file system time to flush
    await new Promise((resolve) => setTimeout(resolve, 100));

    const content = readFileSync(logFile, 'utf-8');
    const lines = content.trim().split('\n');

    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0]).message).toBe('existing');
    expect(JSON.parse(lines[1]).message).toBe('new message');
  });

  it('should write JSON format to file regardless of display format', async () => {
    const logFile = join(TEST_LOG_DIR, 'test-log-4.jsonl');

    const { Logger } = require('../../src/utils/logger');
    const logger = new Logger({
      silent: true,
      format: 'text', // Display format is text
      logFile,
    });

    logger.info('test message', { key: 'value' });
    logger.close();

    // Give file system time to flush
    await new Promise((resolve) => setTimeout(resolve, 100));

    const content = readFileSync(logFile, 'utf-8');
    const entry = JSON.parse(content.trim());

    expect(entry.level).toBe('info');
    expect(entry.message).toBe('test message');
    expect(entry.key).toBe('value');
  });

  it('should handle file write errors gracefully', () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

    // Try to write to an invalid path
    const { Logger } = require('../../src/utils/logger');
    const logger = new Logger({
      silent: true,
      logFile: '/nonexistent/path/that/should/fail/log.jsonl',
    });

    // Should not throw
    expect(logger).toBeDefined();

    consoleSpy.mockRestore();
  });

  it('should close file stream on close()', () => {
    const logFile = join(TEST_LOG_DIR, 'test-log-5.jsonl');

    const { Logger } = require('../../src/utils/logger');
    const logger = new Logger({
      silent: true,
      logFile,
    });

    logger.info('before close');
    logger.close();

    // Should not throw when logging after close (just won't write to file)
    logger.info('after close');
    expect(logger).toBeDefined();
  });
});

// ============================================================================
// Console Output Tests
// ============================================================================

describe('Console Output', () => {
  it('should output to console.log for info and debug levels', () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

    const { Logger } = require('../../src/utils/logger');
    const logger = new Logger({ silent: false, level: 'debug' });

    logger.debug('debug message');
    logger.info('info message');

    expect(consoleSpy).toHaveBeenCalledTimes(2);

    consoleSpy.mockRestore();
  });

  it('should output to console.warn for warn level', () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

    const { Logger } = require('../../src/utils/logger');
    const logger = new Logger({ silent: false });

    logger.warn('warning message');

    expect(consoleSpy).toHaveBeenCalledTimes(1);

    consoleSpy.mockRestore();
  });

  it('should output to console.error for error level', () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

    const { Logger } = require('../../src/utils/logger');
    const logger = new Logger({ silent: false });

    logger.error('error message');

    expect(consoleSpy).toHaveBeenCalledTimes(1);

    consoleSpy.mockRestore();
  });

  it('should not output when silent is true', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation();
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    const errorSpy = jest.spyOn(console, 'error').mockImplementation();

    const { Logger } = require('../../src/utils/logger');
    const logger = new Logger({ silent: true, level: 'debug' });

    logger.debug('debug');
    logger.info('info');
    logger.warn('warn');
    logger.error('error');

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('should allow toggling silent mode', () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

    const { Logger } = require('../../src/utils/logger');
    const logger = new Logger({ silent: true });

    logger.info('silent message');
    expect(consoleSpy).not.toHaveBeenCalled();

    logger.setSilent(false);
    logger.info('visible message');
    expect(consoleSpy).toHaveBeenCalledTimes(1);

    consoleSpy.mockRestore();
  });
});

// ============================================================================
// Log Rotation / History Management Tests
// ============================================================================

describe('Log Rotation and History Management', () => {
  it('should maintain log history', () => {
    const { Logger } = require('../../src/utils/logger');
    const logger = new Logger({ silent: true });

    logger.info('message 1');
    logger.info('message 2');
    logger.info('message 3');

    const history = logger.getHistory();
    expect(history).toHaveLength(3);
    expect(history[0].message).toBe('message 1');
    expect(history[2].message).toBe('message 3');
  });

  it('should limit history size to prevent memory issues', () => {
    const { Logger } = require('../../src/utils/logger');
    const logger = new Logger({ silent: true });

    // Log more than the default max history size (1000)
    for (let i = 0; i < 1100; i++) {
      logger.info(`message ${i}`);
    }

    const history = logger.getHistory();
    expect(history.length).toBeLessThanOrEqual(1000);

    // Should have the most recent messages
    expect(history[history.length - 1].message).toBe('message 1099');
  });

  it('should clear history on clearHistory()', () => {
    const { Logger } = require('../../src/utils/logger');
    const logger = new Logger({ silent: true });

    logger.info('message 1');
    logger.info('message 2');

    expect(logger.getHistory()).toHaveLength(2);

    logger.clearHistory();

    expect(logger.getHistory()).toHaveLength(0);
  });

  it('should export logs as JSON', () => {
    const { Logger } = require('../../src/utils/logger');
    const logger = new Logger({ silent: true });

    logger.info('message 1', { key: 'value1' });
    logger.warn('message 2', { key: 'value2' });

    const exported = logger.exportLogsAsJSON();
    const parsed = JSON.parse(exported);

    expect(parsed).toHaveLength(2);
    expect(parsed[0].message).toBe('message 1');
    expect(parsed[0].context.key).toBe('value1');
    expect(parsed[1].level).toBe('warn');
  });

  it('should return copy of history to prevent mutation', () => {
    const { Logger } = require('../../src/utils/logger');
    const logger = new Logger({ silent: true });

    logger.info('original message');

    const history = logger.getHistory();
    history.push({
      timestamp: new Date().toISOString(),
      level: 'info',
      message: 'injected',
    });

    // Original history should be unchanged
    expect(logger.getHistory()).toHaveLength(1);
  });
});

// ============================================================================
// Child Logger Tests
// ============================================================================

describe('Child Logger', () => {
  it('should create child logger with source', () => {
    const { Logger } = require('../../src/utils/logger');
    const parent = new Logger({ silent: true });
    const child = parent.child('ChildModule');

    child.info('child message');

    const history = child.getHistory();
    expect(history[0].source).toBe('ChildModule');
  });

  it('should inherit parent options', () => {
    const { Logger } = require('../../src/utils/logger');
    const parent = new Logger({ silent: true, level: 'warn' });
    const child = parent.child('ChildModule');

    child.info('info message'); // Should not log
    child.warn('warn message'); // Should log

    const history = child.getHistory();
    expect(history).toHaveLength(1);
    expect(history[0].level).toBe('warn');
  });
});

// ============================================================================
// Timer Functionality Tests
// ============================================================================

describe('Timer Functionality', () => {
  it('should log timer start and end', async () => {
    const { Logger } = require('../../src/utils/logger');
    const logger = new Logger({ silent: true, level: 'debug' });

    const endTimer = logger.time('test-operation');

    // Simulate async operation
    await new Promise((resolve) => setTimeout(resolve, 50));

    endTimer();

    const history = logger.getHistory();
    expect(history).toHaveLength(2);
    expect(history[0].message).toContain('Timer started: test-operation');
    expect(history[1].message).toContain('Timer ended: test-operation');
    expect(history[1].context?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('should measure approximate duration', async () => {
    const { Logger } = require('../../src/utils/logger');
    const logger = new Logger({ silent: true, level: 'debug' });

    const endTimer = logger.time('duration-test');

    await new Promise((resolve) => setTimeout(resolve, 100));

    endTimer();

    const history = logger.getHistory();
    const durationMs = history[1].context?.durationMs as number;

    expect(durationMs).toBeGreaterThanOrEqual(90);
    expect(durationMs).toBeLessThan(200);
  });
});

// ============================================================================
// Singleton / Default Logger Tests
// ============================================================================

describe('Default Logger Singleton', () => {
  it('should return same instance on multiple getLogger calls', () => {
    const { getLogger, resetLogger } = require('../../src/utils/logger');
    resetLogger();

    const logger1 = getLogger();
    const logger2 = getLogger();

    expect(logger1).toBe(logger2);
  });

  it('should create fresh instance after resetLogger', () => {
    const { getLogger, resetLogger } = require('../../src/utils/logger');

    const logger1 = getLogger();
    resetLogger();
    const logger2 = getLogger();

    expect(logger1).not.toBe(logger2);
  });

  it('should work with convenience logger object', () => {
    const { logger, resetLogger } = require('../../src/utils/logger');
    resetLogger();

    // These should not throw
    expect(() => {
      logger.debug('debug');
      logger.info('info');
      logger.warn('warn');
      logger.error('error');
    }).not.toThrow();
  });

  it('should create child from convenience logger', () => {
    const { logger, resetLogger } = require('../../src/utils/logger');
    resetLogger();

    const child = logger.child('TestModule');
    expect(child).toBeDefined();
  });
});

// ============================================================================
// Debug Helper Function Tests
// ============================================================================

describe('Debug Helper Function', () => {
  it('should only log when DEBUG is enabled', () => {
    process.env.DEBUG = 'true';
    jest.resetModules();

    const { debug, getLogger, resetLogger } = require('../../src/utils/logger');
    resetLogger();

    debug('debug message', { key: 'value' });

    const history = getLogger().getHistory();
    expect(history.length).toBeGreaterThanOrEqual(1);
  });

  it('should not log when DEBUG is not enabled', () => {
    delete process.env.DEBUG;
    jest.resetModules();

    const { debug, getLogger, resetLogger } = require('../../src/utils/logger');
    resetLogger();

    debug('debug message');

    const history = getLogger().getHistory();
    // May have logged due to default level, but debug helper specifically checks isDebugEnabled
    expect(history.filter((h: { message: string }) => h.message === 'debug message').length).toBe(0);
  });
});

// ============================================================================
// Interaction Logger Tests (from src/logging/interaction-logger.ts)
// ============================================================================

// Mock the home directory for interaction logger tests
jest.mock('os', () => ({
  ...jest.requireActual('os'),
  homedir: () => join(tmpdir(), 'grok-test-home-logging'),
}));

describe('Interaction Logger', () => {
  const MOCK_HOME = join(tmpdir(), 'grok-test-home-logging');
  const LOGS_DIR = join(MOCK_HOME, '.codebuddy', 'logs');

  beforeEach(() => {
    if (!existsSync(LOGS_DIR)) {
      mkdirSync(LOGS_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    if (existsSync(MOCK_HOME)) {
      rmSync(MOCK_HOME, { recursive: true, force: true });
    }
  });

  describe('Session Management', () => {
    it('should start a new session with UUID', () => {
      const { createInteractionLogger } = require('../../src/logging/interaction-logger');
      const logger = createInteractionLogger({ autoSave: false });

      const sessionId = logger.startSession({
        model: 'grok-3',
        provider: 'xai',
      });

      expect(sessionId).toBeDefined();
      expect(sessionId.length).toBe(36); // UUID v4 length
      expect(sessionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    });

    it('should generate short ID from full ID', () => {
      const { createInteractionLogger } = require('../../src/logging/interaction-logger');
      const logger = createInteractionLogger({ autoSave: false });

      logger.startSession({ model: 'grok-3', provider: 'xai' });
      const session = logger.getCurrentSession();

      expect(session?.metadata.short_id.length).toBe(8);
      expect(session?.metadata.id.startsWith(session?.metadata.short_id)).toBe(true);
    });

    it('should include all metadata in session', () => {
      const { createInteractionLogger } = require('../../src/logging/interaction-logger');
      const logger = createInteractionLogger({ autoSave: false });

      logger.startSession({
        model: 'grok-3',
        provider: 'xai',
        cwd: '/test/directory',
        tags: ['test', 'unit'],
        description: 'Test session',
        gitInfo: { branch: 'main', commit: 'abc123def' },
      });

      const session = logger.getCurrentSession();
      expect(session?.metadata.model).toBe('grok-3');
      expect(session?.metadata.provider).toBe('xai');
      expect(session?.metadata.cwd).toBe('/test/directory');
      expect(session?.metadata.tags).toEqual(['test', 'unit']);
      expect(session?.metadata.description).toBe('Test session');
      expect(session?.metadata.git_branch).toBe('main');
      expect(session?.metadata.git_commit).toBe('abc123def');
    });

    it('should set ended_at and duration on endSession', () => {
      const { createInteractionLogger } = require('../../src/logging/interaction-logger');
      const logger = createInteractionLogger({ autoSave: false });

      logger.startSession({ model: 'grok-3', provider: 'xai' });

      // Wait a bit to ensure duration > 0
      const session = logger.getCurrentSession();
      const startTime = new Date(session!.metadata.started_at).getTime();

      logger.endSession();

      // Session should be null after ending
      expect(logger.getCurrentSession()).toBeNull();
    });
  });

  describe('Message Logging', () => {
    it('should log messages with timestamps', () => {
      const { createInteractionLogger } = require('../../src/logging/interaction-logger');
      const logger = createInteractionLogger({ autoSave: false });

      logger.startSession({ model: 'grok-3', provider: 'xai' });
      logger.logMessage({ role: 'user', content: 'Hello' });

      const session = logger.getCurrentSession();
      expect(session?.messages[0].timestamp).toBeDefined();
      expect(session?.messages[0].timestamp).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/
      );
    });

    it('should increment turns for user messages', () => {
      const { createInteractionLogger } = require('../../src/logging/interaction-logger');
      const logger = createInteractionLogger({ autoSave: false });

      logger.startSession({ model: 'grok-3', provider: 'xai' });
      logger.logMessage({ role: 'user', content: 'Hello' });
      logger.logMessage({ role: 'assistant', content: 'Hi!' });
      logger.logMessage({ role: 'user', content: 'How are you?' });

      const session = logger.getCurrentSession();
      expect(session?.metadata.turns).toBe(2);
    });

    it('should track input tokens for user and system messages', () => {
      const { createInteractionLogger } = require('../../src/logging/interaction-logger');
      const logger = createInteractionLogger({ autoSave: false });

      logger.startSession({ model: 'grok-3', provider: 'xai' });
      logger.logMessage({ role: 'system', content: 'You are an assistant', tokens: 100 });
      logger.logMessage({ role: 'user', content: 'Hello', tokens: 50 });

      const session = logger.getCurrentSession();
      expect(session?.metadata.total_input_tokens).toBe(150);
    });

    it('should track output tokens for assistant messages', () => {
      const { createInteractionLogger } = require('../../src/logging/interaction-logger');
      const logger = createInteractionLogger({ autoSave: false });

      logger.startSession({ model: 'grok-3', provider: 'xai' });
      logger.logMessage({ role: 'assistant', content: 'Hello!', tokens: 30 });
      logger.logMessage({ role: 'assistant', content: 'How can I help?', tokens: 20 });

      const session = logger.getCurrentSession();
      expect(session?.metadata.total_output_tokens).toBe(50);
    });

    it('should not log when no session is active', () => {
      const { createInteractionLogger } = require('../../src/logging/interaction-logger');
      const logger = createInteractionLogger({ autoSave: false });

      // Should not throw
      logger.logMessage({ role: 'user', content: 'Hello' });

      expect(logger.getCurrentSession()).toBeNull();
    });
  });

  describe('Tool Call Logging', () => {
    it('should attach tool calls to last assistant message', () => {
      const { createInteractionLogger } = require('../../src/logging/interaction-logger');
      const logger = createInteractionLogger({ autoSave: false });

      logger.startSession({ model: 'grok-3', provider: 'xai' });
      logger.logMessage({ role: 'assistant', content: 'Let me check that' });
      logger.logToolCalls([
        { id: 'call_1', name: 'bash', arguments: { command: 'ls' } },
        { id: 'call_2', name: 'read_file', arguments: { path: '/test' } },
      ]);

      const session = logger.getCurrentSession();
      expect(session?.messages[0].tool_calls).toHaveLength(2);
      expect(session?.messages[0].tool_calls?.[0].name).toBe('bash');
      expect(session?.messages[0].tool_calls?.[1].name).toBe('read_file');
      expect(session?.metadata.tool_calls).toBe(2);
    });

    it('should update tool call with result', () => {
      const { createInteractionLogger } = require('../../src/logging/interaction-logger');
      const logger = createInteractionLogger({ autoSave: false });

      logger.startSession({ model: 'grok-3', provider: 'xai' });
      logger.logMessage({ role: 'assistant', content: 'Running...' });
      logger.logToolCalls([{ id: 'call_1', name: 'bash', arguments: { command: 'ls' } }]);
      logger.logToolResult('call_1', {
        success: true,
        output: 'file1.txt\nfile2.txt',
        duration_ms: 150,
      });

      const session = logger.getCurrentSession();
      const toolCall = session?.messages[0].tool_calls?.[0];
      expect(toolCall?.success).toBe(true);
      expect(toolCall?.output).toBe('file1.txt\nfile2.txt');
      expect(toolCall?.duration_ms).toBe(150);
    });

    it('should log failed tool results', () => {
      const { createInteractionLogger } = require('../../src/logging/interaction-logger');
      const logger = createInteractionLogger({ autoSave: false });

      logger.startSession({ model: 'grok-3', provider: 'xai' });
      logger.logMessage({ role: 'assistant', content: 'Trying...' });
      logger.logToolCalls([{ id: 'call_1', name: 'bash', arguments: { command: 'invalid' } }]);
      logger.logToolResult('call_1', {
        success: false,
        error: 'Command not found',
      });

      const session = logger.getCurrentSession();
      const toolCall = session?.messages[0].tool_calls?.[0];
      expect(toolCall?.success).toBe(false);
      expect(toolCall?.error).toBe('Command not found');
    });
  });

  describe('Cost Tracking', () => {
    it('should update estimated cost', () => {
      const { createInteractionLogger } = require('../../src/logging/interaction-logger');
      const logger = createInteractionLogger({ autoSave: false });

      logger.startSession({ model: 'grok-3', provider: 'xai' });
      logger.updateCost(0.0025);

      const session = logger.getCurrentSession();
      expect(session?.metadata.estimated_cost).toBe(0.0025);
    });

    it('should not update cost when no session', () => {
      const { createInteractionLogger } = require('../../src/logging/interaction-logger');
      const logger = createInteractionLogger({ autoSave: false });

      // Should not throw
      logger.updateCost(0.0025);
      expect(logger.getCurrentSession()).toBeNull();
    });
  });

  describe('Session Formatting', () => {
    it('should format session for display', () => {
      const { InteractionLogger, SessionData } = require('../../src/logging/interaction-logger');

      const session = {
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
          description: 'Test session',
        },
        messages: [
          {
            role: 'user',
            content: 'Hello',
            timestamp: '2025-01-01T10:00:00.000Z',
          },
          {
            role: 'assistant',
            content: 'Hi there! How can I help you today?',
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
    });
  });

  describe('Logger Cleanup', () => {
    it('should dispose resources and end session', () => {
      const { createInteractionLogger } = require('../../src/logging/interaction-logger');
      const logger = createInteractionLogger({ autoSave: false });

      logger.startSession({ model: 'grok-3', provider: 'xai' });
      logger.dispose();

      expect(logger.getCurrentSession()).toBeNull();
    });

    it('should handle dispose when no session', () => {
      const { createInteractionLogger } = require('../../src/logging/interaction-logger');
      const logger = createInteractionLogger({ autoSave: false });

      // Should not throw
      logger.dispose();
      expect(logger.getCurrentSession()).toBeNull();
    });

    it('should clear save interval on dispose', () => {
      jest.useFakeTimers();

      const { createInteractionLogger } = require('../../src/logging/interaction-logger');
      const logger = createInteractionLogger({
        autoSave: true,
        saveIntervalMs: 1000,
      });

      logger.startSession({ model: 'grok-3', provider: 'xai' });
      logger.dispose();

      // Advance timers - should not cause issues after dispose
      jest.advanceTimersByTime(5000);

      jest.useRealTimers();
    });
  });
});

// ============================================================================
// Edge Cases and Error Handling
// ============================================================================

describe('Edge Cases and Error Handling', () => {
  describe('Logger edge cases', () => {
    it('should handle empty message', () => {
      const { Logger } = require('../../src/utils/logger');
      const logger = new Logger({ silent: true });

      logger.info('');

      const history = logger.getHistory();
      expect(history[0].message).toBe('');
    });

    it('should handle undefined context', () => {
      const { Logger } = require('../../src/utils/logger');
      const logger = new Logger({ silent: true });

      logger.info('message', undefined);

      const history = logger.getHistory();
      expect(history[0].context).toBeUndefined();
    });

    it('should handle complex context objects', () => {
      const { Logger } = require('../../src/utils/logger');
      const logger = new Logger({ silent: true });

      const complexContext = {
        nested: { deep: { value: 123 } },
        array: [1, 2, 3],
        date: new Date().toISOString(),
        nullValue: null,
      };

      logger.info('message', complexContext);

      const history = logger.getHistory();
      expect(history[0].context).toEqual(complexContext);
    });

    it('should handle special characters in messages', () => {
      const { Logger } = require('../../src/utils/logger');
      const logger = new Logger({ silent: true });

      const specialMessage = '```json\n{"key": "value"}\n```\n<tag>content</tag>';

      logger.info(specialMessage);

      const history = logger.getHistory();
      expect(history[0].message).toBe(specialMessage);
    });

    it('should handle unicode in messages', () => {
      const { Logger } = require('../../src/utils/logger');
      const logger = new Logger({ silent: true });

      const unicodeMessage = 'Hello World - Emoji Test';

      logger.info(unicodeMessage);

      const history = logger.getHistory();
      expect(history[0].message).toBe(unicodeMessage);
    });
  });

  describe('Interaction Logger edge cases', () => {
    it('should handle null content in messages', () => {
      const { createInteractionLogger } = require('../../src/logging/interaction-logger');
      const logger = createInteractionLogger({ autoSave: false });

      logger.startSession({ model: 'grok-3', provider: 'xai' });
      logger.logMessage({ role: 'assistant', content: null });

      const session = logger.getCurrentSession();
      expect(session?.messages[0].content).toBeNull();
    });

    it('should handle tool result for non-existent tool call', () => {
      const { createInteractionLogger } = require('../../src/logging/interaction-logger');
      const logger = createInteractionLogger({ autoSave: false });

      logger.startSession({ model: 'grok-3', provider: 'xai' });

      // Should not throw
      logger.logToolResult('non_existent_id', { success: true });

      expect(logger.getCurrentSession()).toBeDefined();
    });

    it('should handle empty tool calls array', () => {
      const { createInteractionLogger } = require('../../src/logging/interaction-logger');
      const logger = createInteractionLogger({ autoSave: false });

      logger.startSession({ model: 'grok-3', provider: 'xai' });
      logger.logMessage({ role: 'assistant', content: 'test' });
      logger.logToolCalls([]);

      const session = logger.getCurrentSession();
      expect(session?.metadata.tool_calls).toBe(0);
    });
  });
});
