/**
 * Tests for Log Rotation
 *
 * Validates log rotation configuration, path generation, and environment variable parsing.
 * File-based assertions are minimal since WriteStream is async and tests run synchronously.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { Logger, resetLogger } from '../../src/utils/logger.js';

// Use temp directory for test log files
const TEST_LOG_DIR = path.join(process.cwd(), '.test-logs-rotation');
const TEST_LOG_FILE = path.join(TEST_LOG_DIR, 'test.log');

describe('Log Rotation', () => {
  beforeEach(() => {
    resetLogger();
    try {
      if (fs.existsSync(TEST_LOG_DIR)) {
        fs.rmSync(TEST_LOG_DIR, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      }
    } catch { /* ignore */ }
    fs.mkdirSync(TEST_LOG_DIR, { recursive: true });
  });

  afterEach(() => {
    resetLogger();
    delete process.env.LOG_MAX_SIZE;
    delete process.env.LOG_MAX_FILES;
    try {
      if (fs.existsSync(TEST_LOG_DIR)) {
        fs.rmSync(TEST_LOG_DIR, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      }
    } catch { /* ignore */ }
  });

  it('constructs logger with file output without errors', () => {
    const logger = new Logger({
      logFile: TEST_LOG_FILE,
      silent: true,
      level: 'debug',
    });

    logger.info('test message');
    logger.close();

    // Logger should construct and accept log calls without throwing
    expect(logger).toBeDefined();
  });

  it('getRotatedPath generates correct filenames', () => {
    const logger = new Logger({
      logFile: TEST_LOG_FILE,
      silent: true,
    });

    // Access private method via prototype for testing
    const getRotatedPath = (logger as unknown as { getRotatedPath: (file: string, idx: number) => string }).getRotatedPath.bind(logger);

    expect(getRotatedPath(TEST_LOG_FILE, 1)).toBe(path.join(TEST_LOG_DIR, 'test.1.log'));
    expect(getRotatedPath(TEST_LOG_FILE, 2)).toBe(path.join(TEST_LOG_DIR, 'test.2.log'));
    expect(getRotatedPath(TEST_LOG_FILE, 5)).toBe(path.join(TEST_LOG_DIR, 'test.5.log'));

    logger.close();
  });

  it('getRotatedPath handles files without extension', () => {
    const logger = new Logger({
      logFile: TEST_LOG_FILE,
      silent: true,
    });

    const getRotatedPath = (logger as unknown as { getRotatedPath: (file: string, idx: number) => string }).getRotatedPath.bind(logger);

    const noExtFile = path.join(TEST_LOG_DIR, 'logfile');
    expect(getRotatedPath(noExtFile, 1)).toBe(path.join(TEST_LOG_DIR, 'logfile.1'));
    expect(getRotatedPath(noExtFile, 3)).toBe(path.join(TEST_LOG_DIR, 'logfile.3'));

    logger.close();
  });

  it('respects LOG_MAX_SIZE environment variable', () => {
    process.env.LOG_MAX_SIZE = '1024';

    const logger = new Logger({
      logFile: TEST_LOG_FILE,
      silent: true,
      level: 'debug',
    });

    // Access private field to verify it was parsed
    const logMaxSize = (logger as unknown as { logMaxSize: number }).logMaxSize;
    expect(logMaxSize).toBe(1024);

    logger.close();
  });

  it('respects LOG_MAX_FILES environment variable', () => {
    process.env.LOG_MAX_FILES = '10';

    const logger = new Logger({
      logFile: TEST_LOG_FILE,
      silent: true,
      level: 'debug',
    });

    const logMaxFiles = (logger as unknown as { logMaxFiles: number }).logMaxFiles;
    expect(logMaxFiles).toBe(10);

    logger.close();
  });

  it('uses default max size (10MB) when env var is invalid', () => {
    process.env.LOG_MAX_SIZE = 'invalid';

    const logger = new Logger({
      logFile: TEST_LOG_FILE,
      silent: true,
    });

    const logMaxSize = (logger as unknown as { logMaxSize: number }).logMaxSize;
    expect(logMaxSize).toBe(10 * 1024 * 1024); // 10MB

    logger.close();
  });

  it('uses default max files (5) when env var is negative', () => {
    process.env.LOG_MAX_FILES = '-1';

    const logger = new Logger({
      logFile: TEST_LOG_FILE,
      silent: true,
    });

    const logMaxFiles = (logger as unknown as { logMaxFiles: number }).logMaxFiles;
    expect(logMaxFiles).toBe(5);

    logger.close();
  });

  it('uses default max files (5) when env var is zero', () => {
    process.env.LOG_MAX_FILES = '0';

    const logger = new Logger({
      logFile: TEST_LOG_FILE,
      silent: true,
    });

    const logMaxFiles = (logger as unknown as { logMaxFiles: number }).logMaxFiles;
    expect(logMaxFiles).toBe(5);

    logger.close();
  });

  it('rotation does not throw even with many writes', () => {
    process.env.LOG_MAX_SIZE = '500';

    const logger = new Logger({
      logFile: TEST_LOG_FILE,
      silent: true,
      level: 'debug',
    });

    // This should not throw even with aggressive rotation triggered
    expect(() => {
      for (let i = 0; i < 200; i++) {
        logger.info(`message ${i} padding ${'x'.repeat(30)}`);
      }
    }).not.toThrow();

    logger.close();
  });

  it('writesSinceRotationCheck resets after interval', () => {
    const logger = new Logger({
      logFile: TEST_LOG_FILE,
      silent: true,
      level: 'debug',
    });

    // Write less than the interval
    for (let i = 0; i < 50; i++) {
      logger.info(`msg ${i}`);
    }

    const counter = (logger as unknown as { writesSinceRotationCheck: number }).writesSinceRotationCheck;
    expect(counter).toBe(50);

    logger.close();
  });

  it('writesSinceRotationCheck resets to 0 after reaching interval', () => {
    // Use a large max size so rotation check runs but doesn't rotate
    process.env.LOG_MAX_SIZE = '999999999';

    const logger = new Logger({
      logFile: TEST_LOG_FILE,
      silent: true,
      level: 'debug',
    });

    // Write exactly 100 messages to trigger the check
    for (let i = 0; i < 100; i++) {
      logger.info(`msg ${i}`);
    }

    const counter = (logger as unknown as { writesSinceRotationCheck: number }).writesSinceRotationCheck;
    expect(counter).toBe(0); // Reset after reaching 100

    logger.close();
  });

  it('does not rotate when no logFile is configured', () => {
    const logger = new Logger({
      silent: true,
      level: 'debug',
    });

    // Write many messages — should not crash even without file output
    for (let i = 0; i < 200; i++) {
      logger.info(`msg ${i}`);
    }

    logger.close();
    expect(logger).toBeDefined();
  });
});
