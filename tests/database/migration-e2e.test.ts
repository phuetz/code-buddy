/**
 * E2E Database Migration Tests — V1 GA blocker WS8-T3
 *
 * "Upgrade an old install through all migrations cleanly."
 *
 * Two upgrade surfaces are covered end-to-end (no mocks on the DB layer):
 *
 * 1. SQLite schema migrations — a database file frozen at an older
 *    SCHEMA_VERSION is opened by the current DatabaseManager and walked
 *    through every pending migration: data preserved, FTS rebuilt,
 *    re-initialization idempotent.
 *
 * 2. Legacy JSON → SQLite import (DatabaseMigration) — an old
 *    ~/.codebuddy JSON install (memories.json, sessions/, semantic-cache,
 *    cost-history) is imported into the live database, with dry-run,
 *    deleteAfterMigration renames and corrupted-file resilience.
 */

import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Real SQLite I/O (one fsync per commit, rollback journal, no WAL): an upgrade
// takes ~3 s on Windows CI runners with ~5× jitter (0.8–4.4 s across runs) and
// occasional I/O stall bursts — run 32590054137 (Node 22 job) spent 22 s in
// each of two adjacent upgrades that the three previous runs finished in <5 s.
// Give the e2e file the same 60 s budget as the other real-I/O suites and log
// slow phases so a stall is attributable.
vi.setConfig({ testTimeout: 60_000 });

const SLOW_PHASE_MS = 5_000;
async function initializeTimed(manager: { initialize(): Promise<void> }, label: string): Promise<void> {
  const started = Date.now();
  await manager.initialize();
  const elapsed = Date.now() - started;
  if (elapsed > SLOW_PHASE_MS) {
    console.error(`[migration-e2e] slow ${label}.initialize(): ${elapsed}ms on ${process.platform}/node ${process.version}`);
  }
}

// Probe the native module the same way tests/database.test.ts does:
// skip the whole suite when better-sqlite3 isn't loadable at this Node ABI.
let hasBetterSqlite3 = false;
let RawDatabase: any = null;
try {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const nativeModulePath = join(
    __dirname, '..', '..', 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node'
  );
  if (existsSync(nativeModulePath)) {
    RawDatabase = (await import('better-sqlite3')).default;
    const testDb = new RawDatabase(':memory:');
    testDb.close();
    hasBetterSqlite3 = true;
  }
} catch {
  // Native module unavailable (ABI mismatch, not installed, etc.)
}

describe.skipIf(!hasBetterSqlite3)('Database migration E2E (old install → current)', () => {
  const ORIGINAL_HOME = process.env.HOME;
  // os.homedir() reads USERPROFILE on Windows, HOME elsewhere — redirect both.
  const ORIGINAL_USERPROFILE = process.env.USERPROFILE;
  let fakeHome: string;
  let workDir: string;

  // Modules loaded AFTER process.env.HOME is redirected — migration.ts
  // freezes its ~/.codebuddy paths at import time via os.homedir().
  let SCHEMA_VERSION: number;
  let MIGRATIONS: Record<number, string>;
  let DatabaseManager: any;
  let initializeDatabase: any;
  let resetDatabaseManager: any;
  let runMigration: any;
  let needsMigration: any;
  let getMemoryRepository: any;
  let resetMemoryRepository: any;
  let getSessionRepository: any;
  let resetSessionRepository: any;
  let getCacheRepository: any;
  let resetCacheRepository: any;
  let getAnalyticsRepository: any;
  let resetAnalyticsRepository: any;

  beforeAll(async () => {
    fakeHome = mkdtempSync(join(tmpdir(), 'codebuddy-mig-home-'));
    workDir = mkdtempSync(join(tmpdir(), 'codebuddy-mig-work-'));
    process.env.HOME = fakeHome;
    process.env.USERPROFILE = fakeHome;

    const schema = await import('../../src/database/schema.js');
    SCHEMA_VERSION = schema.SCHEMA_VERSION;
    MIGRATIONS = schema.MIGRATIONS;

    const dbManager = await import('../../src/database/database-manager.js');
    DatabaseManager = dbManager.DatabaseManager;
    initializeDatabase = dbManager.initializeDatabase;
    resetDatabaseManager = dbManager.resetDatabaseManager;

    const migration = await import('../../src/database/migration.js');
    runMigration = migration.runMigration;
    needsMigration = migration.needsMigration;

    const memRepo = await import('../../src/database/repositories/memory-repository.js');
    getMemoryRepository = memRepo.getMemoryRepository;
    resetMemoryRepository = memRepo.resetMemoryRepository;

    const sessRepo = await import('../../src/database/repositories/session-repository.js');
    getSessionRepository = sessRepo.getSessionRepository;
    resetSessionRepository = sessRepo.resetSessionRepository;

    const cacheRepo = await import('../../src/database/repositories/cache-repository.js');
    getCacheRepository = cacheRepo.getCacheRepository;
    resetCacheRepository = cacheRepo.resetCacheRepository;

    const analyticsRepo = await import('../../src/database/repositories/analytics-repository.js');
    getAnalyticsRepository = analyticsRepo.getAnalyticsRepository;
    resetAnalyticsRepository = analyticsRepo.resetAnalyticsRepository;
  });

  afterAll(() => {
    process.env.HOME = ORIGINAL_HOME;
    if (ORIGINAL_USERPROFILE === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = ORIGINAL_USERPROFILE;
    for (const dir of [fakeHome, workDir]) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
  });

  // ==========================================================================
  // Helpers
  // ==========================================================================

  let dbCounter = 0;
  function freshDbPath(): string {
    return join(workDir, `upgrade-${++dbCounter}.db`);
  }

  /**
   * Build a database file frozen at an old schema version, with real data,
   * exactly like an install left behind by an older Code Buddy release.
   */
  function createOldInstallDb(dbPath: string, upToVersion: number): void {
    const db = new RawDatabase(dbPath);
    for (let v = 1; v <= upToVersion; v++) {
      db.exec(MIGRATIONS[v]!);
      db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(v);
    }

    db.prepare(
      `INSERT INTO sessions (id, project_id, name, model, total_cost, message_count)
       VALUES ('sess-legacy', 'proj-1', 'Legacy session', 'grok-3', 0.42, 2)`
    ).run();
    db.prepare(
      `INSERT INTO messages (session_id, role, content)
       VALUES ('sess-legacy', 'user', 'the quick brown fox jumps over the lazy dog')`
    ).run();
    db.prepare(
      `INSERT INTO messages (session_id, role, content)
       VALUES ('sess-legacy', 'assistant', 'a perfectly ordinary answer about foxes')`
    ).run();
    db.prepare(
      `INSERT INTO memories (id, type, scope, content, importance)
       VALUES ('mem-legacy', 'fact', 'user', 'Patrice prefers TypeScript strict mode', 0.9)`
    ).run();
    db.prepare(
      `INSERT INTO cache (key, value) VALUES ('legacy-key', '"legacy-value"')`
    ).run();
    db.close();
  }

  function schemaVersions(dbPath: string): number[] {
    const db = new RawDatabase(dbPath, { readonly: true });
    const rows = db.prepare('SELECT version FROM schema_version ORDER BY version').all() as { version: number }[];
    db.close();
    return rows.map(r => r.version);
  }

  // ==========================================================================
  // 1. SQLite schema upgrade path
  // ==========================================================================

  describe('schema upgrade (old database file → current SCHEMA_VERSION)', () => {
    it('upgrades a v1 install through every pending migration and preserves data', async () => {
      const dbPath = freshDbPath();
      createOldInstallDb(dbPath, 1);

      const manager = new DatabaseManager({ dbPath, walMode: false });
      const applied: number[] = [];
      manager.on('db:migration', (e: { version: number }) => applied.push(e.version));

      await initializeTimed(manager, 'manager');

      // Every migration after v1 was applied, in order
      const expected = [];
      for (let v = 2; v <= SCHEMA_VERSION; v++) expected.push(v);
      expect(applied).toEqual(expected);
      expect(manager.getDatabaseStats().version).toBe(SCHEMA_VERSION);

      const db = manager.getDatabase();

      // Data survived the upgrade
      const session = db.prepare("SELECT * FROM sessions WHERE id = 'sess-legacy'").get() as any;
      expect(session).toBeDefined();
      expect(session.total_cost).toBeCloseTo(0.42);
      expect(db.prepare("SELECT COUNT(*) c FROM messages WHERE session_id = 'sess-legacy'").get()).toMatchObject({ c: 2 });
      expect(db.prepare("SELECT content FROM memories WHERE id = 'mem-legacy'").get()).toMatchObject({
        content: 'Patrice prefers TypeScript strict mode',
      });
      expect(db.prepare("SELECT value FROM cache WHERE key = 'legacy-key'").get()).toMatchObject({
        value: '"legacy-value"',
      });

      // Migration 2 added the parent_session_id column
      const sessionCols = (db.prepare('PRAGMA table_info(sessions)').all() as { name: string }[]).map(c => c.name);
      expect(sessionCols).toContain('parent_session_id');

      // FTS was rebuilt over pre-existing messages (migration 2 + 3)
      const hits = db.prepare(
        "SELECT rowid FROM messages_fts WHERE messages_fts MATCH 'quick'"
      ).all();
      expect(hits.length).toBe(1);

      manager.close();
      expect(schemaVersions(dbPath)).toEqual([...Array(SCHEMA_VERSION).keys()].map(i => i + 1));
    });

    it('keeps FTS triggers functional after the upgrade', async () => {
      const dbPath = freshDbPath();
      createOldInstallDb(dbPath, 1);

      const manager = new DatabaseManager({ dbPath, walMode: false });
      await initializeTimed(manager, 'manager');
      const db = manager.getDatabase();

      db.prepare(
        `INSERT INTO messages (session_id, role, content)
         VALUES ('sess-legacy', 'user', 'searchable zanzibar message')`
      ).run();
      const hits = db.prepare(
        "SELECT rowid FROM messages_fts WHERE messages_fts MATCH 'zanzibar'"
      ).all();
      expect(hits.length).toBe(1);

      manager.close();
    });

    it('upgrades a v2 install by applying only the missing migrations', async () => {
      const dbPath = freshDbPath();
      createOldInstallDb(dbPath, 2);

      const manager = new DatabaseManager({ dbPath, walMode: false });
      const applied: number[] = [];
      manager.on('db:migration', (e: { version: number }) => applied.push(e.version));

      await initializeTimed(manager, 'manager');

      const expected = [];
      for (let v = 3; v <= SCHEMA_VERSION; v++) expected.push(v);
      expect(applied).toEqual(expected);
      expect(manager.getDatabaseStats().version).toBe(SCHEMA_VERSION);
      manager.close();
    });

    it('initializes a fresh install by applying the full chain in order', async () => {
      const dbPath = freshDbPath();

      const manager = new DatabaseManager({ dbPath, walMode: false });
      const applied: number[] = [];
      manager.on('db:migration', (e: { version: number }) => applied.push(e.version));

      await initializeTimed(manager, 'manager');

      expect(applied).toEqual([...Array(SCHEMA_VERSION).keys()].map(i => i + 1));
      expect(manager.getDatabaseStats().version).toBe(SCHEMA_VERSION);
      manager.close();
    });

    it('is idempotent: re-opening an up-to-date database applies nothing', async () => {
      const dbPath = freshDbPath();
      createOldInstallDb(dbPath, 1);

      const first = new DatabaseManager({ dbPath, walMode: false });
      await initializeTimed(first, 'first');
      first.close();

      const second = new DatabaseManager({ dbPath, walMode: false });
      const applied: number[] = [];
      second.on('db:migration', (e: { version: number }) => applied.push(e.version));
      await initializeTimed(second, 'second');

      expect(applied).toEqual([]);
      expect(second.getDatabaseStats().version).toBe(SCHEMA_VERSION);
      second.close();

      // No duplicate rows in schema_version after the double init
      expect(schemaVersions(dbPath)).toEqual([...Array(SCHEMA_VERSION).keys()].map(i => i + 1));
    });
  });

  // ==========================================================================
  // 2. Legacy JSON install → SQLite import
  // ==========================================================================

  describe('legacy JSON install import (DatabaseMigration)', () => {
    function codebuddyDir(): string {
      return join(fakeHome, '.codebuddy');
    }

    function resetSingletons(): void {
      resetMemoryRepository();
      resetSessionRepository();
      resetCacheRepository();
      resetAnalyticsRepository();
      resetDatabaseManager();
    }

    beforeEach(async () => {
      rmSync(codebuddyDir(), { recursive: true, force: true });
      resetSingletons();
      // migration.ts drives the singleton manager — point it at a fresh file
      await initializeDatabase({ dbPath: freshDbPath(), walMode: false });
    });

    afterEach(() => {
      resetSingletons();
    });

    function writeOldJsonInstall(): void {
      const dir = codebuddyDir();
      mkdirSync(join(dir, 'sessions'), { recursive: true });
      mkdirSync(join(dir, 'cache'), { recursive: true });

      writeFileSync(join(dir, 'memories.json'), JSON.stringify([
        {
          id: 'mem-1',
          type: 'preference',
          content: 'Always answer in French',
          importance: 0.8,
          accessCount: 3,
          createdAt: '2025-11-01T10:00:00Z',
          updatedAt: '2025-11-01T10:00:00Z',
          lastAccessedAt: '2025-12-01T10:00:00Z',
          tags: ['lang'],
          metadata: { origin: 'unit-test' },
          embedding: [0.1, 0.2, 0.3],
        },
        {
          id: 'mem-2',
          type: 'totally-unknown-type', // must fall back to 'fact'
          content: 'Legacy entry with an unknown type',
          importance: 0.4,
          accessCount: 0,
          createdAt: '2025-11-02T10:00:00Z',
          updatedAt: '2025-11-02T10:00:00Z',
          lastAccessedAt: '2025-11-02T10:00:00Z',
          tags: [],
          metadata: {},
        },
      ]));

      writeFileSync(join(dir, 'sessions', 'sess-old.json'), JSON.stringify({
        id: 'sess-old',
        projectId: 'proj-old',
        projectPath: '/tmp/proj-old',
        name: 'Old JSON session',
        model: 'grok-3',
        messages: [
          { role: 'user', content: 'hello from the past' },
          { role: 'assistant', content: 'greetings', toolCalls: [{ id: 'tc-1', name: 'view_file' }] },
          { role: 'tool', content: 'file contents', toolCallId: 'tc-1' },
        ],
        createdAt: '2025-10-01T08:00:00Z',
        updatedAt: '2025-10-01T09:00:00Z',
        totalCost: 1.5,
        totalTokensIn: 1000,
        totalTokensOut: 500,
      }));

      const future = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
      const past = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      writeFileSync(join(dir, 'cache', 'semantic-cache.json'), JSON.stringify({
        entries: [
          { key: 'key-live', value: { answer: 42 }, createdAt: past, expiresAt: future, hits: 5 },
          { key: 'key-expired', value: 'stale', createdAt: past, expiresAt: past, hits: 1 },
        ],
      }));

      writeFileSync(join(dir, 'cost-history.json'), JSON.stringify({
        daily: { '2026-01-01': 1.23 },
        sessions: [{ cost: 0.5, tokens: 1000, model: 'grok-3', date: '2026-01-02' }],
      }));
    }

    it('imports a full old JSON install end-to-end', async () => {
      expect(needsMigration()).toBe(false);
      writeOldJsonInstall();
      expect(needsMigration()).toBe(true);

      // Dry run reports counts without writing anything
      const dry = await runMigration({ dryRun: true });
      expect(dry.success).toBe(true);
      expect(dry.migratedItems).toEqual({ memories: 2, sessions: 1, cache: 2, analytics: 2 });
      expect(getMemoryRepository().getById('mem-1')).toBeNull();

      // Real run, renaming source files once imported
      const result = await runMigration({ deleteAfterMigration: true });
      expect(result.errors).toEqual([]);
      expect(result.success).toBe(true);
      // Expired cache entries are skipped during the real import
      expect(result.migratedItems).toEqual({ memories: 2, sessions: 1, cache: 1, analytics: 2 });

      // Memories — content, fallback type, metadata merge
      const mem1 = getMemoryRepository().getById('mem-1');
      expect(mem1).not.toBeNull();
      expect(mem1.content).toBe('Always answer in French');
      const mem2 = getMemoryRepository().getById('mem-2');
      expect(mem2.type).toBe('fact');

      // Session — messages and stats carried over
      const session = getSessionRepository().getSessionById('sess-old');
      expect(session).not.toBeNull();
      const messages = getSessionRepository().getMessages('sess-old');
      expect(messages.length).toBe(3);
      expect(messages[2].tool_call_id).toBe('tc-1');

      // Cache — live entry readable, expired entry skipped
      expect(getCacheRepository().get('key-live')).toEqual({ answer: 42 });
      expect(getCacheRepository().get('key-expired')).toBeNull();

      // Analytics — daily + per-session records landed
      const analytics = getAnalyticsRepository().getAnalytics({});
      expect(analytics.length).toBeGreaterThanOrEqual(2);

      // Source files were renamed out of the way
      const dir = codebuddyDir();
      expect(existsSync(join(dir, 'memories.json'))).toBe(false);
      expect(existsSync(join(dir, 'memories.json.migrated'))).toBe(true);
      expect(existsSync(join(dir, 'sessions', 'sess-old.json'))).toBe(false);
      expect(existsSync(join(dir, 'sessions', 'sess-old.json.migrated'))).toBe(true);
      expect(existsSync(join(dir, 'cache', 'semantic-cache.json.migrated'))).toBe(true);
      expect(existsSync(join(dir, 'cost-history.json.migrated'))).toBe(true);
    });

    it('survives corrupted source files and reports them as errors', async () => {
      const dir = codebuddyDir();
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'memories.json'), '{ this is not valid JSON');

      const result = await runMigration({});
      expect(result.success).toBe(true); // per-file failure, not a global one
      expect(result.migratedItems.memories).toBe(0);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0]).toContain('memories file');
    });
  });
});
