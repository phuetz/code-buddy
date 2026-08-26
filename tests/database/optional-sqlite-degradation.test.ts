import fs from 'node:fs';
import path from 'node:path';
import { vi } from 'vitest';

vi.mock('better-sqlite3', () => {
  const error = new Error("Cannot find package 'better-sqlite3'");
  Object.assign(error, { code: 'ERR_MODULE_NOT_FOUND' });
  throw error;
});

describe('optional better-sqlite3 degradation', () => {
  let tempDir: string;
  let previousSessionsDir: string | undefined;

  beforeEach(() => {
    vi.resetModules();
    previousSessionsDir = process.env.CODEBUDDY_SESSIONS_DIR;
    tempDir = fs.mkdtempSync(path.join(process.cwd(), '.x4-sqlite-test-'));
    process.env.CODEBUDDY_SESSIONS_DIR = path.join(tempDir, 'sessions');
  });

  afterEach(async () => {
    const { GracefulShutdownManager } = await import('../../src/utils/graceful-shutdown.js');
    GracefulShutdownManager.reset();

    if (previousSessionsDir === undefined) {
      delete process.env.CODEBUDDY_SESSIONS_DIR;
    } else {
      process.env.CODEBUDDY_SESSIONS_DIR = previousSessionsDir;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('loads every shared SQLite boundary without loading the optional driver', async () => {
    await expect(import('../../src/database/database-manager.js')).resolves.toBeDefined();
    await expect(import('../../src/observability/run-store.js')).resolves.toBeDefined();
    await expect(import('../../src/tools/db-migration.js')).resolves.toBeDefined();
  });

  it('announces the loss and persists sessions as JSON', async () => {
    const { logger } = await import('../../src/utils/logger.js');
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const { SessionStore } = await import('../../src/persistence/session-store.js');
    const store = new SessionStore({ useSQLite: true });

    const session = await store.createSession('without sqlite', 'test-model');

    expect(fs.existsSync(path.join(tempDir, 'sessions', `${session.id}.json`))).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('using JSON session persistence'),
      expect.objectContaining({ error: expect.stringContaining('better-sqlite3') }),
    );
  });

  it('keeps RunStore file persistence and announces its file-scan fallback', async () => {
    const { logger } = await import('../../src/utils/logger.js');
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const { RunStore } = await import('../../src/observability/run-store.js');
    const store = new RunStore(path.join(tempDir, 'runs'));
    const internalStore = store as unknown as {
      loadDatabaseConstructor: () => never;
    };
    internalStore.loadDatabaseConstructor = () => {
      throw new Error("Cannot find package 'better-sqlite3'");
    };

    const runId = store.startRun('fallback proof');
    const artifactPath = store.saveArtifact(runId, 'proof.txt', 'still persisted');

    expect(fs.readFileSync(artifactPath, 'utf-8')).toBe('still persisted');
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('falling back to file scan'),
      expect.objectContaining({ error: expect.stringContaining('better-sqlite3') }),
    );
    store.endRun(runId, 'completed');
    store.dispose();
  });

  it('imports the session shutdown hook without a second SQLite failure', async () => {
    const { logger } = await import('../../src/utils/logger.js');
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const shutdown = await import('../../src/utils/graceful-shutdown.js');
    shutdown.registerDefaultShutdownHandlers();
    const manager = shutdown.getShutdownManager() as unknown as {
      handlers: Array<{ name: string; handler: () => void | Promise<void> }>;
    };
    const sessionSave = manager.handlers.find((handler) => handler.name === 'session-save');

    await expect(sessionSave?.handler()).resolves.toBeUndefined();
    expect(warn).not.toHaveBeenCalledWith(
      'Failed to save session during shutdown',
      expect.anything(),
    );
  });
});
