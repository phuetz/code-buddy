/**
 * The reset erases two stores of one session: its file and its SQLite index
 * rows. Whatever step fails, both must tell the same story: a session whose
 * turn is still in its file is still found by the search, and a session whose
 * file was emptied keeps no indexed row of that turn. The archive written
 * before the erase stays restorable in every case.
 *
 * Each case injects one failure (a policy change at a step, a failed archive,
 * a failed temporary write, a failed rename, a failure reported after the
 * rename, a failed index purge, an index purge whose rows are deleted but
 * whose count update fails), then reads the file, the index, the search
 * and the archive. A second session holds the same turn, so the search gets
 * SQLite results and does not fall back to scanning the JSON files: a session
 * missing from the index is then missing from the search.
 *
 * HOME and USERPROFILE are throwaway directories created inside the test.
 */
import fs, {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const dirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cb-reset-index-'));
  dirs.push(dir);
  return dir;
}

/** Files under `roots` this process still holds open (Linux only; see the concurrency bench). */
function openHandlesUnder(roots: string[]): string[] {
  const fdDir = '/proc/self/fd';
  if (!existsSync(fdDir)) return [];
  const real = roots.map((root) => realpathSync(root) + path.sep);
  const open: string[] = [];
  for (const fd of readdirSync(fdDir)) {
    let target: string;
    try {
      target = readlinkSync(path.join(fdDir, fd));
    } catch {
      continue;
    }
    if (real.some((root) => target.startsWith(root))) open.push(target);
  }
  return open;
}

/** better-sqlite3 is a native module: absent or built for another runtime, it cannot open a base. */
const sqliteAvailable = (() => {
  try {
    const Database = createRequire(import.meta.url)('better-sqlite3') as new (file: string) => { close(): void };
    new Database(':memory:').close();
    return true;
  } catch {
    return false;
  }
})();

const IDLE = '[session_reset]\nmode = "idle"\nidle_minutes = 1\n';
const TURN = 'TOUR_INDEXE_COHERENCE';

type Injection =
  | 'aucune'
  | 'archive'
  | 'politique:companion-clear'
  | 'politique:session-save'
  | 'politique:session-rename'
  | 'politique:index-purge'
  | 'politique:memory-evict'
  | 'ecriture-temporaire'
  | 'renommage'
  | 'apres-renommage'
  | 'purge-index'
  | 'purge-index-partielle';

/** Where the session file and its index end up once the reset stops. */
const PURGED: ReadonlySet<Injection> = new Set(['aucune', 'politique:memory-evict']);
/** Injections that stop the reset before any archive is written. */
const NO_ARCHIVE: ReadonlySet<Injection> = new Set(['archive']);

interface Outcome {
  fileUnchanged: boolean;
  fileHasTurn: boolean;
  indexedBefore: Array<string | undefined>;
  indexedAfter: Array<string | undefined>;
  searchBefore: { target: boolean; other: boolean };
  searchAfter: { target: boolean; other: boolean };
  archived: string;
  archiveError: string;
  injected: boolean;
  openHandles: string[];
}

async function resetWithFailure(injection: Injection): Promise<Outcome> {
  const fakeHome = tempDir();
  const codebuddyHome = tempDir();
  const sessionsDir = tempDir();
  const archiveRoot = tempDir();
  const projectDir = tempDir();
  // A regular file where the archive directory should be: the archive cannot be written.
  const archiveDir = injection === 'archive' ? path.join(archiveRoot, 'not-a-directory') : archiveRoot;
  if (injection === 'archive') writeFileSync(archiveDir, 'occupied');
  const keys = ['HOME', 'USERPROFILE', 'CODEBUDDY_HOME', 'CODEBUDDY_SESSIONS_DIR', 'CODEBUDDY_SESSION_RESET_ARCHIVE_DIR', 'CODEBUDDY_CHANNEL_HISTORY'] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const previousCwd = process.cwd();
  let closeDatabase = (): void => {};
  Object.assign(process.env, {
    HOME: fakeHome,
    USERPROFILE: fakeHome,
    CODEBUDDY_HOME: codebuddyHome,
    CODEBUDDY_SESSIONS_DIR: sessionsDir,
    CODEBUDDY_SESSION_RESET_ARCHIVE_DIR: archiveDir,
    CODEBUDDY_CHANNEL_HISTORY: 'false',
  });
  try {
    process.chdir(projectDir);
    mkdirSync(path.join(projectDir, '.codebuddy'), { recursive: true });
    writeFileSync(path.join(projectDir, '.codebuddy', 'config.toml'), IDLE);
    vi.resetModules();
    const toml = await import('../../src/config/toml-config.js');
    const storeModule = await import('../../src/persistence/session-store.js');
    const handlers = await import('../../src/commands/handlers/channel-handlers.js');
    const repositoryModule = await import('../../src/database/repositories/session-repository.js');
    const messaging = await import('../../src/channels/messaging-session-reset.js');
    closeDatabase = (await import('../../src/database/index.js')).resetDatabaseSystem;
    toml.resetConfigManager();
    storeModule.resetSessionStore();
    handlers.__resetChannelAIHandlerForTests();

    const store = storeModule.getSessionStore();
    const target = await store.createSession('Channel coherence', 'r');
    await store.addMessageToCurrentSession({ type: 'user', content: TURN, timestamp: new Date() });
    const file = path.join(sessionsDir, `${target.id}.json`);
    const idle = new Date(Date.now() - 3_600_000).toISOString();
    const data = JSON.parse(readFileSync(file, 'utf8')) as { name: string; lastAccessedAt: string; createdAt: string; messages: Array<{ timestamp: string }> };
    data.name = `Channel ${target.id}`;
    data.lastAccessedAt = idle;
    data.createdAt = idle;
    for (const message of data.messages) message.timestamp = idle;
    writeFileSync(file, JSON.stringify(data));
    const bytesBefore = readFileSync(file);
    // Same turn in another session: the search answers from SQLite, without the JSON scan.
    const other = await store.createSession('Other coherence', 'r');
    await store.addMessageToCurrentSession({ type: 'user', content: TURN, timestamp: new Date() });

    const repository = repositoryModule.getSessionRepository();
    const found = async (): Promise<{ target: boolean; other: boolean }> => {
      const ids = (await store.searchSessions(TURN)).map((session) => session.id);
      return { target: ids.includes(target.id), other: ids.includes(other.id) };
    };
    const indexedBefore = repository.getMessages(target.id).map((row) => row.content);
    const searchBefore = await found();

    let injected = false;
    const fail = (what: string): Error => {
      injected = true;
      return Object.assign(new Error(`injected ${what} failure`), { code: 'EIO' });
    };
    if (injection.startsWith('politique:')) {
      const step = injection.slice('politique:'.length) as Parameters<typeof handlers.__beforeMessagingResetStepForTests>[0];
      handlers.__beforeMessagingResetStepForTests(step, () => {
        throw fail(step);
      });
    } else if (injection === 'ecriture-temporaire') {
      const open = fs.promises.open.bind(fs.promises);
      vi.spyOn(fs.promises, 'open').mockImplementation(((filePath: fs.PathLike, flags?: string | number, mode?: fs.Mode) => {
        const name = path.basename(String(filePath));
        if (!injected && flags === 'w' && name.startsWith(`${target.id}.json`) && name !== `${target.id}.json`) {
          return Promise.reject(fail('temporary write'));
        }
        return open(filePath, flags, mode);
      }) as typeof fs.promises.open);
    } else if (injection === 'renommage') {
      const rename = fs.promises.rename.bind(fs.promises);
      vi.spyOn(fs.promises, 'rename').mockImplementation(async (from, to) => {
        if (!injected && path.resolve(String(to)) === path.resolve(file)) throw fail('rename');
        return rename(from, to);
      });
    } else if (injection === 'apres-renommage') {
      // The rename landed, then the final chmod fails: the write reports an error
      // although the file already holds the emptied session.
      const chmod = fs.promises.chmod.bind(fs.promises);
      vi.spyOn(fs.promises, 'chmod').mockImplementation(async (filePath, mode) => {
        if (!injected && path.resolve(String(filePath)) === path.resolve(file)) throw fail('post-rename');
        return chmod(filePath, mode);
      });
    } else if (injection === 'purge-index') {
      vi.spyOn(repositoryModule.SessionRepository.prototype, 'deleteMessages').mockImplementation(() => {
        throw fail('index purge');
      });
    } else if (injection === 'purge-index-partielle') {
      // The rows are deleted, then the count update of the same purge fails.
      const db = (repository as unknown as { db: { prepare: (sql: string) => unknown } }).db;
      const prepare = db.prepare.bind(db);
      vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        if (!injected && sql === 'UPDATE sessions SET message_count = ? WHERE id = ?') throw fail('index count');
        return prepare(sql);
      });
    }

    await handlers.__resetInboundMessagingSessionForTests(target.id);
    vi.restoreAllMocks();
    if (injection.startsWith('politique:')) {
      handlers.__beforeMessagingResetStepForTests(injection.slice('politique:'.length) as Parameters<typeof handlers.__beforeMessagingResetStepForTests>[0]);
    }

    const bytesAfter = readFileSync(file);
    let archived = '';
    let archiveError = '';
    try {
      archived = injection === 'archive' ? '' : messaging.openMessagingMemoryArchive(archiveDir, target.id, 'session-store').join('\n');
    } catch (err) {
      archiveError = err instanceof Error ? err.message : String(err);
    }
    const outcome = {
      fileUnchanged: bytesAfter.equals(bytesBefore),
      fileHasTurn: bytesAfter.toString('utf8').includes(TURN),
      indexedBefore,
      indexedAfter: repository.getMessages(target.id).map((row) => row.content),
      searchBefore,
      searchAfter: await found(),
      archived,
      archiveError,
      injected,
    };
    closeDatabase();
    return { ...outcome, openHandles: openHandlesUnder([fakeHome, codebuddyHome, sessionsDir, archiveRoot, projectDir]) };
  } finally {
    closeDatabase();
    process.chdir(previousCwd);
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe.skipIf(!sqliteAvailable)('remise a zero : fichier de session et index SQLite restent coherents', () => {
  const injections: Injection[] = [
    'aucune',
    'archive',
    'politique:companion-clear',
    'politique:session-save',
    'politique:session-rename',
    'politique:index-purge',
    'politique:memory-evict',
    'ecriture-temporaire',
    'renommage',
    'apres-renommage',
    'purge-index',
    'purge-index-partielle',
  ];
  for (const injection of injections) {
    const purged = PURGED.has(injection);
    it(`${injection} : ${purged ? 'fichier et index purges ensemble' : 'la session reste dans son fichier et dans la recherche'}, archive restaurable`, async () => {
      const outcome = await resetWithFailure(injection);
      console.log('COHERENCE_INDEX', JSON.stringify({ injection, ...outcome }));
      expect(outcome.injected, 'echec injecte').toBe(injection !== 'aucune' && injection !== 'archive');
      expect(outcome.indexedBefore, 'index rempli avant').toEqual([TURN]);
      expect(outcome.searchBefore, 'recherche avant').toEqual({ target: true, other: true });
      if (purged) {
        expect(outcome.fileHasTurn, 'fichier vide').toBe(false);
        expect(outcome.indexedAfter, 'index vide').toEqual([]);
        expect(outcome.searchAfter, 'recherche apres').toEqual({ target: false, other: true });
      } else {
        expect(outcome.fileUnchanged, 'fichier intact').toBe(true);
        expect(outcome.indexedAfter, 'index intact').toEqual([TURN]);
        expect(outcome.searchAfter, 'session encore trouvee').toEqual({ target: true, other: true });
      }
      expect(outcome.archiveError, 'archive restaurable').toBe('');
      if (NO_ARCHIVE.has(injection)) expect(outcome.archived, 'aucune archive').toBe('');
      else expect(outcome.archived, 'archive restauree').toContain(TURN);
      expect(outcome.openHandles, 'fichiers encore ouverts au demontage').toEqual([]);
    });
  }
});
