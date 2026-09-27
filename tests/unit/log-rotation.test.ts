/**
 * Tests for Log Rotation
 *
 * Validates log rotation configuration, path generation, and environment variable parsing.
 * File-based assertions are minimal since WriteStream is async and tests run synchronously.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import { Logger, resetLogger } from '../../src/utils/logger.js';
import { makeTmpDir, removeTestDir } from '../helpers/tmp.js';

// Temp directory for test log files, one per test
let TEST_LOG_DIR: string;
let TEST_LOG_FILE: string;

describe('Log Rotation', () => {
  beforeEach(() => {
    resetLogger();
    TEST_LOG_DIR = makeTmpDir('log-rotation-', os.tmpdir());
    TEST_LOG_FILE = path.join(TEST_LOG_DIR, 'test.log');
  });

  afterEach(() => {
    resetLogger();
    delete process.env.LOG_MAX_SIZE;
    delete process.env.LOG_MAX_FILES;
    // Each test awaits logger.close(): the log file is released by now.
    removeTestDir(TEST_LOG_DIR);
  });

  it('constructs logger with file output without errors', async () => {
    const logger = new Logger({
      logFile: TEST_LOG_FILE,
      silent: true,
      level: 'debug',
    });

    logger.info('test message');
    await logger.close();

    // Logger should construct and accept log calls without throwing
    expect(logger).toBeDefined();
  });

  it('getRotatedPath generates correct filenames', async () => {
    const logger = new Logger({
      logFile: TEST_LOG_FILE,
      silent: true,
    });

    // Access private method via prototype for testing
    const getRotatedPath = (logger as unknown as { getRotatedPath: (file: string, idx: number) => string }).getRotatedPath.bind(logger);

    expect(getRotatedPath(TEST_LOG_FILE, 1)).toBe(path.join(TEST_LOG_DIR, 'test.1.log'));
    expect(getRotatedPath(TEST_LOG_FILE, 2)).toBe(path.join(TEST_LOG_DIR, 'test.2.log'));
    expect(getRotatedPath(TEST_LOG_FILE, 5)).toBe(path.join(TEST_LOG_DIR, 'test.5.log'));

    await logger.close();
  });

  it('getRotatedPath handles files without extension', async () => {
    const logger = new Logger({
      logFile: TEST_LOG_FILE,
      silent: true,
    });

    const getRotatedPath = (logger as unknown as { getRotatedPath: (file: string, idx: number) => string }).getRotatedPath.bind(logger);

    const noExtFile = path.join(TEST_LOG_DIR, 'logfile');
    expect(getRotatedPath(noExtFile, 1)).toBe(path.join(TEST_LOG_DIR, 'logfile.1'));
    expect(getRotatedPath(noExtFile, 3)).toBe(path.join(TEST_LOG_DIR, 'logfile.3'));

    await logger.close();
  });

  it('respects LOG_MAX_SIZE environment variable', async () => {
    process.env.LOG_MAX_SIZE = '1024';

    const logger = new Logger({
      logFile: TEST_LOG_FILE,
      silent: true,
      level: 'debug',
    });

    // Access private field to verify it was parsed
    const logMaxSize = (logger as unknown as { logMaxSize: number }).logMaxSize;
    expect(logMaxSize).toBe(1024);

    await logger.close();
  });

  it('respects LOG_MAX_FILES environment variable', async () => {
    process.env.LOG_MAX_FILES = '10';

    const logger = new Logger({
      logFile: TEST_LOG_FILE,
      silent: true,
      level: 'debug',
    });

    const logMaxFiles = (logger as unknown as { logMaxFiles: number }).logMaxFiles;
    expect(logMaxFiles).toBe(10);

    await logger.close();
  });

  it('uses default max size (10MB) when env var is invalid', async () => {
    process.env.LOG_MAX_SIZE = 'invalid';

    const logger = new Logger({
      logFile: TEST_LOG_FILE,
      silent: true,
    });

    const logMaxSize = (logger as unknown as { logMaxSize: number }).logMaxSize;
    expect(logMaxSize).toBe(10 * 1024 * 1024); // 10MB

    await logger.close();
  });

  it('uses default max files (5) when env var is negative', async () => {
    process.env.LOG_MAX_FILES = '-1';

    const logger = new Logger({
      logFile: TEST_LOG_FILE,
      silent: true,
    });

    const logMaxFiles = (logger as unknown as { logMaxFiles: number }).logMaxFiles;
    expect(logMaxFiles).toBe(5);

    await logger.close();
  });

  it('uses default max files (5) when env var is zero', async () => {
    process.env.LOG_MAX_FILES = '0';

    const logger = new Logger({
      logFile: TEST_LOG_FILE,
      silent: true,
    });

    const logMaxFiles = (logger as unknown as { logMaxFiles: number }).logMaxFiles;
    expect(logMaxFiles).toBe(5);

    await logger.close();
  });

  it('rotation does not throw even with many writes', async () => {
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

    await logger.close();
  });

  it('writesSinceRotationCheck resets after interval', async () => {
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

    await logger.close();
  });

  it('writesSinceRotationCheck resets to 0 after reaching interval', async () => {
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

    await logger.close();
  });

  it('does not rotate when no logFile is configured', async () => {
    const logger = new Logger({
      silent: true,
      level: 'debug',
    });

    // Write many messages — should not crash even without file output
    for (let i = 0; i < 200; i++) {
      logger.info(`msg ${i}`);
    }

    await logger.close();
    expect(logger).toBeDefined();
  });
});
