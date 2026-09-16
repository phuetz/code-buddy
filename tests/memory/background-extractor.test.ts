import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  LOCK_STALE_MS,
  MIN_EXTRACTION_INTERVAL_MS,
  MIN_IDLE_MS,
  releaseExtractionLock,
  triggerBackgroundExtraction,
  tryAcquireExtractionLock,
} from '../../src/memory/background-extractor.js';
import { getGlobalEventBus, resetEventBus } from '../../src/events/event-bus.js';

const testDirectories: string[] = [];

function makeDirectory(): string {
  const directory = fs.mkdtempSync(path.join(process.cwd(), '.memextract1-test-'));
  testDirectories.push(directory);
  return directory;
}

function writeSession(
  cwd: string,
  id: string,
  options: { lastAccessedAt?: string; status?: string; messageCount?: number } = {},
): void {
  const directory = path.join(cwd, '.codebuddy', 'sessions');
  fs.mkdirSync(directory, { recursive: true });
  const messageCount = options.messageCount ?? 4;
  const messages = Array.from({ length: messageCount }, (_, index) => ({
    type: index % 2 === 0 ? 'user' : 'assistant',
    content: index === 0
      ? 'I prefer single quotes in this project.'
      : `session message ${index}`,
    timestamp: new Date(Date.now() - 10 * MIN_IDLE_MS).toISOString(),
  }));
  fs.writeFileSync(path.join(directory, `${id}.json`), JSON.stringify({
    id,
    name: id,
    workingDirectory: cwd,
    model: 'test-model',
    messages,
    createdAt: new Date(Date.now() - 20 * MIN_IDLE_MS).toISOString(),
    lastAccessedAt: options.lastAccessedAt ?? new Date(Date.now() - 2 * MIN_IDLE_MS).toISOString(),
    ...(options.status ? { status: options.status } : {}),
  }));
}

function readState(cwd: string): { runs: Array<{ runAt: string; sessionIds: string[]; memoriesAdded: number; durationMs: number }> } {
  return JSON.parse(fs.readFileSync(path.join(cwd, '.codebuddy', '.extraction-state.json'), 'utf8')) as {
    runs: Array<{ runAt: string; sessionIds: string[]; memoriesAdded: number; durationMs: number }>;
  };
}

beforeEach(() => {
  resetEventBus();
});

afterEach(() => {
  resetEventBus();
  for (const directory of testDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('MEMEXTRACT1 background extractor', () => {
  it('takes the advisory lock and rejects a concurrent owner', async () => {
    const cwd = makeDirectory();
    const lockPath = path.join(cwd, '.codebuddy', '.extraction.lock');
    const first = await tryAcquireExtractionLock(lockPath);
    expect(first).not.toBeNull();
    expect(JSON.parse(fs.readFileSync(lockPath, 'utf8'))).toEqual({
      pid: process.pid,
      startedAt: first?.lock.startedAt,
    });

    const second = await tryAcquireExtractionLock(lockPath);
    expect(second).toBeNull();
    await releaseExtractionLock(first!);
  });

  it('releases the lock after success and after an operation error', async () => {
    const successCwd = makeDirectory();
    writeSession(successCwd, 'success-session');
    await expect(triggerBackgroundExtraction({ cwd: successCwd })).resolves.toMatchObject({ status: 'completed' });
    expect(fs.existsSync(path.join(successCwd, '.codebuddy', '.extraction.lock'))).toBe(false);

    const errorCwd = makeDirectory();
    writeSession(errorCwd, 'error-session');
    fs.mkdirSync(path.join(errorCwd, '.codebuddy', '.extraction-state.json'), { recursive: true });
    await expect(triggerBackgroundExtraction({ cwd: errorCwd })).resolves.toMatchObject({ status: 'error' });
    expect(fs.existsSync(path.join(errorCwd, '.codebuddy', '.extraction.lock'))).toBe(false);
  });

  it('reclaims a lock older than LOCK_STALE_MS', async () => {
    const cwd = makeDirectory();
    const lockPath = path.join(cwd, '.codebuddy', '.extraction.lock');
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, JSON.stringify({
      pid: 12345,
      startedAt: new Date(Date.now() - LOCK_STALE_MS - 1).toISOString(),
    }));

    const lock = await tryAcquireExtractionLock(lockPath);
    expect(lock).not.toBeNull();
    expect(JSON.parse(fs.readFileSync(lockPath, 'utf8')).pid).toBe(process.pid);
    await releaseExtractionLock(lock!);
  });

  it('throttles a recent pass but lets force process a new session', async () => {
    const cwd = makeDirectory();
    writeSession(cwd, 'first-session');
    await triggerBackgroundExtraction({ cwd });

    writeSession(cwd, 'second-session');
    await expect(triggerBackgroundExtraction({ cwd })).resolves.toMatchObject({ status: 'throttled' });
    await expect(triggerBackgroundExtraction({ cwd, force: true })).resolves.toMatchObject({
      status: 'completed',
      sessionCount: 1,
    });
    expect(readState(cwd).runs).toHaveLength(2);
    expect(MIN_EXTRACTION_INTERVAL_MS).toBe(30 * 60 * 1000);
  });

  it('extracts eligible sessions, persists the run, and emits start/completion events', async () => {
    const cwd = makeDirectory();
    writeSession(cwd, 'eligible-session');
    writeSession(cwd, 'too-short-session', { messageCount: 3 });
    writeSession(cwd, 'active-session', { lastAccessedAt: new Date().toISOString() });
    writeSession(cwd, 'completed-session', { lastAccessedAt: new Date().toISOString(), status: 'completed' });

    const started = vi.fn();
    const completed = vi.fn();
    getGlobalEventBus().on('memory:extraction_started', started);
    getGlobalEventBus().on('memory:extraction_completed', completed);

    await expect(triggerBackgroundExtraction({ cwd })).resolves.toMatchObject({
      status: 'completed',
      sessionCount: 2,
    });

    expect(readState(cwd).runs[0]).toEqual(expect.objectContaining({
      sessionIds: expect.arrayContaining(['eligible-session', 'completed-session']),
      memoriesAdded: 1,
    }));
    expect(started).toHaveBeenCalledWith(expect.objectContaining({
      sessionCount: 2,
      memoriesAdded: 0,
      durationMs: 0,
    }));
    expect(completed).toHaveBeenCalledWith(expect.objectContaining({
      sessionCount: 2,
      memoriesAdded: 1,
    }));
    expect(fs.readFileSync(path.join(cwd, '.codebuddy', 'memory', 'MEMORY.md'), 'utf8')).toContain('single quotes');
  });

  it('skips corrupt session files without crashing the pass', async () => {
    const cwd = makeDirectory();
    const directory = path.join(cwd, '.codebuddy', 'sessions');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'corrupt.json'), '{not-json');
    writeSession(cwd, 'valid-session');

    await expect(triggerBackgroundExtraction({ cwd })).resolves.toMatchObject({
      status: 'completed',
      sessionCount: 1,
    });
    expect(readState(cwd).runs[0].sessionIds).toEqual(['valid-session']);
  });
});
