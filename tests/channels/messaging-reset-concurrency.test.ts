/**
 * Concurrency bench for the messaging reset. At each step of a reset, another
 * writer acts: a turn added through the session store (it takes the session
 * lock), a turn written straight to the file without the lock (another
 * process), an encryption of the session, a change of the reset policy, or a
 * companion turn. After every interleaving, no turn is lost (it is still in
 * the session or the companion history, or it was archived) and no byte that
 * was only ever stored encrypted appears in clear in any file.
 *
 * HOME and USERPROFILE are throwaway directories created inside the test, so
 * the encryption key and every file live there. Product modules are imported
 * only after that, so every captured path matches it.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const dirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

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

const STEPS = ['archive', 'erase', 'companion-clear', 'session-save', 'memory-evict'] as const;
type Step = typeof STEPS[number];
const ACTIONS = ['tour-verrouille', 'tour-sans-verrou', 'chiffrement', 'politique', 'tour-compagnon'] as const;
type Action = typeof ACTIONS[number];

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

    const pending: Array<Promise<unknown>> = [];
    const writerErrors: string[] = [];
    const run = (task: () => Promise<unknown>): void => {
      pending.push(task().catch((err: unknown) => {
        writerErrors.push(err instanceof Error ? err.message : String(err));
      }));
    };
    const act = (): void => {
      switch (action) {
        case 'tour-verrouille':
          run(() => writer.addMessageToCurrentSession({ type: 'user', content: LATE_TURN, timestamp: new Date() }));
          break;
        case 'tour-sans-verrou':
          writeFileSync(file, record(unlockedList, new Date().toISOString(), encrypted));
          break;
        case 'chiffrement':
          process.env.SESSION_ENCRYPTION = 'true';
          run(async () => {
            const session = await writer.loadSession(sessionKey);
            if (session) await writer.saveSession(session);
          });
          break;
        case 'politique':
          writeFileSync(projectFile, NONE);
          break;
        case 'tour-compagnon':
          history.rememberCompanionChannelTurn(sessionKey, 'encore', LATE_COMPANION, process.env);
          break;
      }
    };
    handlers.__beforeMessagingResetStepForTests(step, act);

    await handlers.__resetInboundMessagingSessionForTests(sessionKey);
    await Promise.all(pending);
    handlers.__beforeMessagingResetStepForTests(step);

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
    if (action === 'tour-verrouille' || action === 'tour-sans-verrou') {
      kept[LATE_TURN] = sessionText.includes(LATE_TURN) || restored('session-store').includes(LATE_TURN);
    }
    if (action === 'tour-compagnon') {
      kept[LATE_COMPANION] = companionText.includes(LATE_COMPANION) || restored('companion-history').includes(LATE_COMPANION);
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
        it(`${encrypted ? 'chiffree' : 'claire'} | ${step} | ${action} : aucun tour perdu, aucun octet en clair`, async () => {
          const outcome = await interleave(step, action, encrypted);
          console.log('ENTRELACEMENT', JSON.stringify({ encrypted, step, action, ...outcome }));
          expect(outcome.writerErrors, 'ecrivain concurrent refuse').toEqual([]);
          expect(outcome.lost, 'tour perdu').toEqual([]);
          expect(outcome.clear, 'octets en clair').toEqual([]);
        });
      }
    }
  }
});
