/**
 * Concurrency bench for the messaging reset. At each step of a reset, another
 * writer acts: a turn added through the session store (it takes the session
 * lock), a turn written straight to the file without the lock (another
 * process), an encryption of the session, a change of the reset policy, or a
 * companion turn, or a real second process writing a session or companion
 * turn. Besides the start of each phase, the bench stops inside each purge,
 * between its last read and its final write: the companion rename, the
 * deletion of the session's SQLite index rows, and the session rename. After
 * every interleaving, no turn is lost in silence (it is still in the session
 * or the companion history, or it was archived, or its writer was refused and
 * told so) and no byte that was only ever stored encrypted appears in clear.
 *
 * HOME and USERPROFILE are throwaway directories created inside the test, so
 * the encryption key and every file live there. Product modules are imported
 * only after that, so every captured path matches it.
 */
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

const dirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  // Retries absorb a brief scan by an antivirus or indexer on Windows; a file
  // this process still holds open keeps failing, so a leak is still reported.
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

/**
 * Files under `roots` this process still holds open. Windows refuses to delete
 * an open file, so a handle left at teardown fails there with EBUSY; Linux
 * deletes it anyway, so the leak is looked for in /proc/self/fd instead. Where
 * there is no /proc (macOS, Windows) the list is empty and the teardown's
 * `rmSync` is the check.
 */
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

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cb-reset-race-'));
  dirs.push(dir);
  return dir;
}

function filesUnder(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  for (const name of readdirSync(root)) {
    const full = path.join(root, name);
    if (statSync(full).isDirectory()) out.push(...filesUnder(full));
    else out.push(full);
  }
  return out;
}

const IDLE = '[session_reset]\nmode = "idle"\nidle_minutes = 1\n';
const NONE = '[session_reset]\nmode = "none"\n';

const STEPS = [
  'archive',
  'erase',
  'companion-clear',
  'companion-rename',
  'session-save',
  'index-purge',
  'session-rename',
  'memory-evict',
] as const;
type Step = typeof STEPS[number];
const ACTIONS = [
  'tour-verrouille',
  'tour-sans-verrou',
  'chiffrement',
  'politique',
  'tour-compagnon',
  'processus-session',
  'processus-compagnon',
] as const;
type Action = typeof ACTIONS[number];

/** Steps inside a purge's locked section, after its last read. */
const INSIDE_LOCK: ReadonlySet<Step> = new Set(['companion-rename', 'index-purge', 'session-rename']);

/**
 * Pairs the bench does not run, and why. Inside a locked section, a writer
 * that ignores the lock cannot be protected by any lock: every product writer
 * takes it, and another process is modelled by `processus-*`. The companion
 * purge is synchronous: in one process no turn write can start between its
 * read and its rename, so `tour-compagnon` there would only model a callback
 * re-entering the section, which the lock refuses.
 */
function skipped(step: Step, action: Action): boolean {
  if (INSIDE_LOCK.has(step) && action === 'tour-sans-verrou') return true;
  return step === 'companion-rename' && action === 'tour-compagnon';
}

const WRITER_PROCESS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'reset-writer-process.ts');
/** The repository root: `--import tsx` resolves from the child's working directory. */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Sleep without yielding: the hook runs inside a synchronous section. */
function blockFor(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

interface WriterProcess {
  signalDir: string;
  exited: Promise<string>;
}

async function startWriterProcess(mode: 'session' | 'companion', sessionKey: string, text: string): Promise<WriterProcess> {
  const signalDir = tempDir();
  const child = spawn(process.execPath, ['--import', 'tsx', WRITER_PROCESS, mode, sessionKey, signalDir, text], {
    cwd: REPO_ROOT,
    env: { ...process.env },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
  const exited = new Promise<string>((resolve) => child.on('exit', (code) => resolve(`code ${code} ${stderr.slice(-400)}`)));
  for (let i = 0; i < 3000 && !existsSync(path.join(signalDir, 'ready')); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  if (!existsSync(path.join(signalDir, 'ready'))) {
    child.kill('SIGKILL');
    throw new Error(`writer process not ready: ${stderr.slice(-400)}`);
  }
  return { signalDir, exited };
}

/**
 * Let the writer process run while the reset waits at its step. A writer
 * that is not blocked finishes; one blocked by a lock the reset holds is
 * given 400 ms to try, then the reset goes on and releases it.
 */
function releaseWriterProcess(writer: WriterProcess): void {
  const signal = (name: string): string => path.join(writer.signalDir, name);
  writeFileSync(signal('go'), '1');
  for (let i = 0; i < 1000 && !existsSync(signal('started')); i += 1) blockFor(10);
  for (let i = 0; i < 40 && !existsSync(signal('done')); i += 1) blockFor(10);
}

async function writerProcessResult(writer: WriterProcess): Promise<string> {
  const done = path.join(writer.signalDir, 'done');
  for (let i = 0; i < 1500 && !existsSync(done); i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  if (!existsSync(done)) return `no result (${await writer.exited})`;
  await writer.exited;
  return readFileSync(done, 'utf8');
}

const SESSION_TURN = 'TOUR_SESSION_INITIAL';
const COMPANION_TURN = 'TOUR_COMPAGNON_INITIAL';
const AGENT_TURN = 'TOUR_AGENT_EN_CACHE';
const LATE_TURN = 'TOUR_CONCURRENT_TARDIF';
const LATE_COMPANION = 'TOUR_COMPAGNON_TARDIF';

interface Outcome {
  /** Markers that are neither in the stores after the reset nor in an archive. */
  lost: string[];
  /** Files holding in clear a marker that was only ever stored encrypted. */
  clear: string[];
  /** A concurrent writer that failed. */
  writerErrors: string[];
  /** What the second process reported, when there is one. */
  processResult?: string;
  cancelled: boolean;
}

async function interleave(step: Step, action: Action, encrypted: boolean): Promise<Outcome> {
  const fakeHome = tempDir();
  const projectDir = tempDir();
  const sessionsDir = tempDir();
  const archiveDir = tempDir();
  const historyDir = tempDir();
  const keys = [
    'HOME',
    'USERPROFILE',
    'CODEBUDDY_SESSIONS_DIR',
    'CODEBUDDY_SESSION_RESET_ARCHIVE_DIR',
    'CODEBUDDY_CHANNEL_HISTORY',
    'CODEBUDDY_CHANNEL_HISTORY_DIR',
    'SESSION_ENCRYPTION',
  ] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const previousCwd = process.cwd();
  process.env.HOME = fakeHome;
  process.env.USERPROFILE = fakeHome;
  process.env.CODEBUDDY_SESSIONS_DIR = sessionsDir;
  process.env.CODEBUDDY_SESSION_RESET_ARCHIVE_DIR = archiveDir;
  process.env.CODEBUDDY_CHANNEL_HISTORY = 'true';
  process.env.CODEBUDDY_CHANNEL_HISTORY_DIR = historyDir;
  delete process.env.SESSION_ENCRYPTION;
  try {
    process.chdir(projectDir);
    expect(os.homedir(), 'faux HOME actif').toBe(fakeHome);
    mkdirSync(path.join(fakeHome, '.codebuddy'), { recursive: true });
    mkdirSync(path.join(projectDir, '.codebuddy'), { recursive: true });
    const projectFile = path.join(projectDir, '.codebuddy', 'config.toml');
    writeFileSync(projectFile, IDLE);

    vi.resetModules();
    const toml = await import('../../src/config/toml-config.js');
    const storeModule = await import('../../src/persistence/session-store.js');
    const content = await import('../../src/persistence/session-content.js');
    const messaging = await import('../../src/channels/messaging-session-reset.js');
    const handlers = await import('../../src/commands/handlers/channel-handlers.js');
    const history = await import('../../src/companion/channel-history.js');
    const { logger } = await import('../../src/utils/logger.js');
    toml.resetConfigManager();
    storeModule.resetSessionStore();
    handlers.__resetChannelAIHandlerForTests();

    const sessionKey = `race-${step}-${action}-${encrypted ? 'chiffree' : 'claire'}`;
    const file = path.join(sessionsDir, `${sessionKey}.json`);
    const old = Date.now() - 3_600_000;
    const idle = new Date(old).toISOString();
    const messages = [{ type: 'user' as const, content: SESSION_TURN, timestamp: idle }];
    const record = (list: unknown, at: string, sealed: boolean): string => JSON.stringify({
      id: sessionKey,
      name: 'r',
      workingDirectory: sessionsDir,
      model: 'r',
      messages: list,
      ...(sealed ? { encrypted: true } : {}),
      createdAt: idle,
      lastAccessedAt: at,
    });
    writeFileSync(file, record(encrypted ? await content.encryptSessionContent(messages) : messages, idle, encrypted));

    handlers.__seedChannelAgentForTests(sessionKey, {
      getChatHistory: () => [{ type: 'assistant', content: AGENT_TURN, timestamp: new Date(old) }],
      dispose: () => { agentDisposed = true; },
    } as never, old);
    let agentDisposed = false;
    history.clearCompanionChannelHistoriesForTests();
    history.rememberCompanionChannelTurn(sessionKey, 'bonjour', COMPANION_TURN, process.env, old);

    const logs: string[] = [];
    for (const level of ['debug', 'info', 'warn', 'error'] as const) {
      vi.spyOn(logger, level).mockImplementation(((...args: unknown[]) => {
        logs.push(JSON.stringify(args));
      }) as never);
    }

    // What a writer without the lock (another process) puts in the file.
    const lateMessage = { type: 'user' as const, content: LATE_TURN, timestamp: new Date().toISOString() };
    const unlockedList = encrypted
      ? await content.encryptSessionContent([...messages, lateMessage])
      : [...messages, lateMessage];
    // A second store, like the one a channel agent holds, adding one turn under the lock.
    const writer = new storeModule.SessionStore({ useSQLite: false });
    (writer as unknown as { currentSessionId: string }).currentSessionId = sessionKey;

    const writerProcess = action === 'processus-session' || action === 'processus-compagnon'
      ? await startWriterProcess(action === 'processus-session' ? 'session' : 'companion', sessionKey,
        action === 'processus-session' ? LATE_TURN : LATE_COMPANION)
      : null;
    const pending: Array<Promise<unknown>> = [];
    const writerErrors: string[] = [];
    const run = (task: () => Promise<unknown>): void => {
      pending.push(task().catch((err: unknown) => {
        writerErrors.push(err instanceof Error ? err.message : String(err));
      }));
    };
    // A turn of the same process comes from another async chain than the
    // reset: armed here, before the reset, and only released by the hook. A
    // writer started from the hook itself would run in the reset's locked
    // section as a re-entry, not as a concurrent writer waiting for the lock.
    let openGate!: () => void;
    const gate = new Promise<void>((resolve) => { openGate = resolve; });
    const runAfterGate = (task: () => Promise<unknown>): void => run(() => gate.then(task));
    if (action === 'tour-verrouille') {
      runAfterGate(() => writer.addMessageToCurrentSession({ type: 'user', content: LATE_TURN, timestamp: new Date() }));
    }
    if (action === 'chiffrement') {
      runAfterGate(async () => {
        const session = await writer.loadSession(sessionKey);
        if (session) await writer.saveSession(session);
      });
    }
    const act = (): void => {
      switch (action) {
        case 'tour-verrouille':
          openGate();
          break;
        case 'tour-sans-verrou':
          writeFileSync(file, record(unlockedList, new Date().toISOString(), encrypted));
          break;
        case 'chiffrement':
          process.env.SESSION_ENCRYPTION = 'true';
          openGate();
          break;
        case 'politique':
          writeFileSync(projectFile, NONE);
          break;
        case 'tour-compagnon':
          history.rememberCompanionChannelTurn(sessionKey, 'encore', LATE_COMPANION, process.env);
          break;
        case 'processus-session':
        case 'processus-compagnon':
          releaseWriterProcess(writerProcess!);
          break;
      }
    };
    handlers.__beforeMessagingResetStepForTests(step, act);

    await handlers.__resetInboundMessagingSessionForTests(sessionKey);
    openGate();
    await Promise.all(pending);
    handlers.__beforeMessagingResetStepForTests(step);
    // A writer never released (its step was not reached) is let go now.
    if (writerProcess && !existsSync(path.join(writerProcess.signalDir, 'go'))) releaseWriterProcess(writerProcess);
    const processResult = writerProcess ? await writerProcessResult(writerProcess) : undefined;
    // Another process refused by the lock was told so: its turn is not lost in silence.
    const refused = processResult?.startsWith('refused: ') === true;

    // Where every marker can still be found.
    const sessionRaw = existsSync(file) ? readFileSync(file, 'utf8') : '';
    const sessionText = sessionRaw
      ? JSON.stringify(content.decryptSessionContent((JSON.parse(sessionRaw) as { messages: Parameters<typeof content.decryptSessionContent>[0] }).messages))
      : '';
    const companionNow = history.readCompanionHistoryForReset(sessionKey, process.env);
    const companionText = companionNow.state === 'ok' ? companionNow.transcript : '';
    const restored = (source: 'session-store' | 'companion-history' | 'agent-cache'): string =>
      messaging.openMessagingMemoryArchive(archiveDir, sessionKey, source, (sealed) => content.openSessionText(sealed)).join('\n');
    const kept: Record<string, boolean> = {
      [SESSION_TURN]: sessionText.includes(SESSION_TURN) || restored('session-store').includes(SESSION_TURN),
      [COMPANION_TURN]: companionText.includes(COMPANION_TURN) || restored('companion-history').includes(COMPANION_TURN),
      [AGENT_TURN]: !agentDisposed || restored('agent-cache').includes(AGENT_TURN),
    };
    if (action === 'tour-verrouille' || action === 'tour-sans-verrou' || action === 'processus-session') {
      kept[LATE_TURN] = sessionText.includes(LATE_TURN) || restored('session-store').includes(LATE_TURN) || refused;
    }
    if (action === 'tour-compagnon' || action === 'processus-compagnon') {
      kept[LATE_COMPANION] = companionText.includes(LATE_COMPANION)
        || restored('companion-history').includes(LATE_COMPANION)
        || refused;
    }
    const lost = Object.entries(kept).filter(([, ok]) => !ok).map(([marker]) => marker);

    // Session turns of an encrypted session were only ever written encrypted.
    const sealedOnly = encrypted ? [SESSION_TURN, LATE_TURN] : [];
    const clear = [fakeHome, sessionsDir, archiveDir, historyDir, projectDir]
      .flatMap(filesUnder)
      .flatMap((f) => {
        const bytes = readFileSync(f, 'latin1');
        return sealedOnly.filter((marker) => bytes.includes(marker)).map((marker) => `${path.basename(f)}:${marker}`);
      });
    if (sessionRaw && (JSON.parse(sessionRaw) as { encrypted?: boolean }).encrypted === true && sessionRaw.includes(SESSION_TURN)) {
      clear.push(`session scellee:${SESSION_TURN}`);
    }
    return {
      lost,
      clear,
      writerErrors,
      ...(processResult !== undefined ? { processResult } : {}),
      cancelled: logs.some((line) => line.includes('messaging session reset cancelled')),
    };
  } finally {
    process.chdir(previousCwd);
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe('remise a zero : banc de concurrence', () => {
  for (const encrypted of [false, true]) {
    for (const step of STEPS) {
      for (const action of ACTIONS) {
        if (skipped(step, action)) continue;
        const inProcess = !action.startsWith('processus-');
        it(`${encrypted ? 'chiffree' : 'claire'} | ${step} | ${action} : aucun tour perdu, aucun octet en clair`, async () => {
          const outcome = await interleave(step, action, encrypted);
          console.log('ENTRELACEMENT', JSON.stringify({ encrypted, step, action, ...outcome }));
          expect(outcome.writerErrors, 'ecrivain concurrent refuse').toEqual([]);
          expect(outcome.lost, 'tour perdu').toEqual([]);
          expect(outcome.clear, 'octets en clair').toEqual([]);
          if (!inProcess) expect(outcome.processResult ?? '', 'resultat du second processus').toMatch(/^(written|refused: )/);
        }, inProcess ? undefined : 60_000);
      }
    }
  }
});

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

describe.skipIf(!sqliteAvailable)('remise a zero : index SQLite de la session', () => {
  /**
   * A session written with the SQLite index on, made idle, then reset. At the
   * given step a turn is added under the session lock. After the reset the
   * index holds no row of the archived turn, and the late turn is in the file
   * and in the index: it was written after the purge, never purged with it.
   */
  async function resetIndexedSession(step: 'index-purge' | 'session-rename' | null) {
    const fakeHome = tempDir();
    const codebuddyHome = tempDir();
    const sessionsDir = tempDir();
    const archiveDir = tempDir();
    const projectDir = tempDir();
    const keys = ['HOME', 'USERPROFILE', 'CODEBUDDY_HOME', 'CODEBUDDY_SESSIONS_DIR', 'CODEBUDDY_SESSION_RESET_ARCHIVE_DIR', 'CODEBUDDY_CHANNEL_HISTORY'] as const;
    const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    const previousCwd = process.cwd();
    // The session store opens `codebuddy.db` through a process-wide singleton
    // that nothing closes: the test closes it before its directories go.
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
      const { getSessionRepository } = await import('../../src/database/repositories/session-repository.js');
      const messaging = await import('../../src/channels/messaging-session-reset.js');
      closeDatabase = (await import('../../src/database/index.js')).resetDatabaseSystem;
      toml.resetConfigManager();
      storeModule.resetSessionStore();
      handlers.__resetChannelAIHandlerForTests();

      const store = storeModule.getSessionStore();
      const session = await store.createSession('Channel sqlite', 'r');
      await store.addMessageToCurrentSession({ type: 'user', content: SESSION_TURN, timestamp: new Date() });
      // Idle: the file's timestamps go back one hour; the index rows stay.
      // A channel session is named after its key, not titled from a message.
      const file = path.join(sessionsDir, `${session.id}.json`);
      const idle = new Date(Date.now() - 3_600_000).toISOString();
      const data = JSON.parse(readFileSync(file, 'utf8')) as { name: string; lastAccessedAt: string; createdAt: string; messages: Array<{ timestamp: string }> };
      data.name = `Channel ${session.id}`;
      data.lastAccessedAt = idle;
      data.createdAt = idle;
      for (const message of data.messages) message.timestamp = idle;
      writeFileSync(file, JSON.stringify(data));
      const repository = getSessionRepository();
      const indexedBefore = repository.getMessages(session.id).map((row) => row.content);

      const writer = new storeModule.SessionStore({ useSQLite: true });
      (writer as unknown as { currentSessionId: string }).currentSessionId = session.id;
      // Armed outside the reset, released at the step (see the bench above).
      let openGate!: () => void;
      const gate = new Promise<void>((resolve) => { openGate = resolve; });
      const late = step
        ? gate.then(() => writer.addMessageToCurrentSession({ type: 'user', content: LATE_TURN, timestamp: new Date() }))
        : Promise.resolve();
      if (step) handlers.__beforeMessagingResetStepForTests(step, () => openGate());
      await handlers.__resetInboundMessagingSessionForTests(session.id);
      openGate();
      await late;
      if (step) handlers.__beforeMessagingResetStepForTests(step);

      const outcome = {
        indexedBefore,
        indexedAfter: repository.getMessages(session.id).map((row) => row.content),
        indexedSearch: repository.searchMessages(SESSION_TURN).map((result) => result.message.content),
        fileAfter: readFileSync(file, 'utf8'),
        archived: messaging.openMessagingMemoryArchive(archiveDir, session.id, 'session-store').join('\n'),
      };
      closeDatabase();
      return { ...outcome, openHandles: openHandlesUnder([fakeHome, codebuddyHome, sessionsDir, archiveDir, projectDir]) };
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

  it('les lignes indexees du tour archive sont supprimees avec lui', async () => {
    const outcome = await resetIndexedSession(null);
    console.log('INDEX_SQLITE', JSON.stringify({ step: null, ...outcome, fileAfter: outcome.fileAfter.includes(SESSION_TURN) }));
    expect(outcome.indexedBefore, 'index rempli avant').toContain(SESSION_TURN);
    expect(outcome.archived, 'tour archive').toContain(SESSION_TURN);
    expect(outcome.fileAfter, 'fichier vide').not.toContain(SESSION_TURN);
    expect(outcome.indexedAfter, 'index vide').toEqual([]);
    expect(outcome.indexedSearch, 'recherche indexee').toEqual([]);
    expect(outcome.openHandles, 'fichiers encore ouverts au demontage').toEqual([]);
  });

  for (const step of ['index-purge', 'session-rename'] as const) {
    it(`${step} | tour-verrouille : le tour tardif reste dans le fichier et dans l index`, async () => {
      const outcome = await resetIndexedSession(step);
      console.log('INDEX_SQLITE', JSON.stringify({ step, ...outcome, fileAfter: outcome.fileAfter.includes(LATE_TURN) }));
      expect(outcome.archived, 'tour archive').toContain(SESSION_TURN);
      expect(outcome.indexedAfter, 'index apres').toEqual([LATE_TURN]);
      expect(outcome.fileAfter, 'fichier apres').toContain(LATE_TURN);
      expect(outcome.fileAfter, 'fichier apres').not.toContain(SESSION_TURN);
      expect(outcome.openHandles, 'fichiers encore ouverts au demontage').toEqual([]);
    });
  }
});
