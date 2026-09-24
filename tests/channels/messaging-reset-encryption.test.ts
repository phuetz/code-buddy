/**
 * A messaging reset copies the session out before erasing it. When the session
 * is encrypted at rest, no byte of its messages may land anywhere in clear:
 * not in the four archives, not in a temporary file, not in the emptied
 * session, not in the logs, not in an end-of-session export.
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
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cb-reset-enc-'));
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

const SECRETS = {
  session: 'OCTETS_SESSION_CHIFFREE',
  agent: 'OCTETS_AGENT_EN_CACHE',
  companion: 'OCTETS_HISTORIQUE_COMPAGNON',
  local: 'OCTETS_CARTE_LOCALE',
} as const;

type Source = 'agent-cache' | 'session-store' | 'companion-history' | 'local-map';

interface Run {
  /** Raw bytes of every archive file of one source, joined. */
  archiveBytes: (source: Source) => string;
  /** Archived transcripts of one source, opened with the session key. */
  restore: (source: Source) => string[];
  /** Every file the reset could have written: home, sessions, archive, history, project. */
  everyFile: () => Array<{ file: string; bytes: string }>;
  sessionRaw: string;
  /** Messages of the emptied session, opened with the session key. */
  sessionMessagesAfter: () => unknown[];
  logs: string[];
  disposeOptions: unknown[];
}

async function runReset(options: {
  id: string;
  encryptSession: boolean;
  sessionEncryptionEnv?: boolean;
  /** Runs at the erase step, after the archive is written. */
  atErase?: (files: { projectFile: string }) => void;
}): Promise<Run> {
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
  if (options.sessionEncryptionEnv) process.env.SESSION_ENCRYPTION = 'true';
  else delete process.env.SESSION_ENCRYPTION;
  try {
    process.chdir(projectDir);
    expect(os.homedir(), 'faux HOME actif').toBe(fakeHome);
    mkdirSync(path.join(fakeHome, '.codebuddy'), { recursive: true });
    mkdirSync(path.join(projectDir, '.codebuddy'), { recursive: true });
    const projectFile = path.join(projectDir, '.codebuddy', 'config.toml');
    writeFileSync(projectFile, IDLE);

    vi.resetModules();
    const toml = await import('../../src/config/toml-config.js');
    const store = await import('../../src/persistence/session-store.js');
    const content = await import('../../src/persistence/session-content.js');
    const messaging = await import('../../src/channels/messaging-session-reset.js');
    const handlers = await import('../../src/commands/handlers/channel-handlers.js');
    const history = await import('../../src/companion/channel-history.js');
    const { logger } = await import('../../src/utils/logger.js');
    toml.resetConfigManager();
    store.resetSessionStore();
    handlers.__resetChannelAIHandlerForTests();

    const sessionKey = `reset-enc-${options.id}`;
    const file = path.join(sessionsDir, `${sessionKey}.json`);
    const old = Date.now() - 3_600_000;
    const idle = new Date(old).toISOString();
    const messages = [{ type: 'user' as const, content: SECRETS.session, timestamp: idle }];
    writeFileSync(file, JSON.stringify({
      id: sessionKey,
      name: 'r',
      workingDirectory: sessionsDir,
      model: 'r',
      messages: options.encryptSession ? await content.encryptSessionContent(messages) : messages,
      ...(options.encryptSession ? { encrypted: true } : {}),
      createdAt: idle,
      lastAccessedAt: idle,
    }));
    if (options.encryptSession) {
      expect(readFileSync(file, 'utf8'), 'session chiffree au depart').not.toContain(SECRETS.session);
    }

    const disposeOptions: unknown[] = [];
    handlers.__seedChannelAgentForTests(sessionKey, {
      getChatHistory: () => [{ type: 'assistant', content: SECRETS.agent, timestamp: new Date(old) }],
      dispose: (opts?: unknown) => { disposeOptions.push(opts); },
    } as never, old);
    handlers.__seedLocalCompanionHistoryForTests(sessionKey, SECRETS.local, old);
    history.clearCompanionChannelHistoriesForTests();
    history.rememberCompanionChannelTurn(sessionKey, 'bonjour', SECRETS.companion, process.env, old);

    const logs: string[] = [];
    for (const level of ['debug', 'info', 'warn', 'error'] as const) {
      vi.spyOn(logger, level).mockImplementation(((...args: unknown[]) => {
        logs.push(JSON.stringify(args));
      }) as never);
    }
    const atErase = options.atErase;
    if (atErase) handlers.__beforeMessagingResetStepForTests('erase', () => atErase({ projectFile }));

    await handlers.__resetInboundMessagingSessionForTests(sessionKey);

    const sessionRaw = existsSync(file) ? readFileSync(file, 'utf8') : '';
    const snapshotFiles = [fakeHome, sessionsDir, archiveDir, historyDir, projectDir]
      .flatMap(filesUnder)
      .map((f) => ({ file: f, bytes: readFileSync(f, 'latin1') }));
    return {
      archiveBytes: (source) => filesUnder(path.join(archiveDir, source))
        .map((f) => readFileSync(f, 'latin1'))
        .join('\n'),
      restore: (source) => messaging.openMessagingMemoryArchive(
        archiveDir,
        sessionKey,
        source,
        (sealed) => content.openSessionText(sealed),
      ),
      everyFile: () => snapshotFiles,
      sessionRaw,
      sessionMessagesAfter: () => {
        const parsed = JSON.parse(sessionRaw) as { messages: Parameters<typeof content.decryptSessionContent>[0] };
        return content.decryptSessionContent(parsed.messages);
      },
      logs,
      disposeOptions,
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

const EXPECTED: Record<Source, string> = {
  'session-store': SECRETS.session,
  'agent-cache': SECRETS.agent,
  'companion-history': SECRETS.companion,
  'local-map': SECRETS.local,
};

describe('remise a zero d une session chiffree : aucune copie en clair', () => {
  for (const source of Object.keys(EXPECTED) as Source[]) {
    it(`archive ${source} : scellee, sans octet en clair, et restaurable avec la cle`, async () => {
      const run = await runReset({ id: `archive-${source}`, encryptSession: true });
      const bytes = run.archiveBytes(source);
      console.log('ARCHIVE_CHIFFREE', JSON.stringify({ source, written: bytes.length > 0, plaintext: bytes.includes(EXPECTED[source]) }));
      expect(bytes, `${source} archive ecrite`).not.toBe('');
      expect(bytes, `${source} archive sans octet en clair`).not.toContain(EXPECTED[source]);
      expect(bytes, `${source} archive marquee chiffree`).toContain('"encrypted": true');
      expect(run.restore(source).join('\n'), `${source} restauration`).toContain(EXPECTED[source]);
      expect(run.sessionMessagesAfter(), 'session videe').toEqual([]);
    });
  }

  it('aucun fichier ecrit (archive, temporaire, historique, session, cle) ne contient un octet de message', async () => {
    const run = await runReset({ id: 'tous-fichiers', encryptSession: true });
    const files = run.everyFile();
    const leaks = files.flatMap(({ file, bytes }) => Object.values(SECRETS)
      .filter((secret) => bytes.includes(secret))
      .map((secret) => `${path.basename(path.dirname(file))}/${path.basename(file)}:${secret}`));
    const temporaries = files.filter(({ file }) => /\.tmp(\.|$)/.test(path.basename(file)));
    console.log('TOUS_FICHIERS', JSON.stringify({ files: files.length, leaks, temporaries: temporaries.length }));
    expect(files.length, 'des fichiers ont ete ecrits').toBeGreaterThan(4);
    expect(leaks, 'octets de message en clair').toEqual([]);
    expect(temporaries, 'fichier temporaire restant').toEqual([]);
  });

  it('la session videe reste chiffree : drapeau conserve, enveloppe, aucun octet en clair', async () => {
    const run = await runReset({ id: 'session-videe', encryptSession: true });
    const parsed = JSON.parse(run.sessionRaw) as { encrypted?: unknown };
    console.log('SESSION_VIDEE', JSON.stringify({ encrypted: parsed.encrypted, plaintext: run.sessionRaw.includes(SECRETS.session) }));
    expect(parsed.encrypted, 'drapeau chiffre conserve').toBe(true);
    expect(run.sessionRaw, 'session sans octet en clair').not.toContain(SECRETS.session);
    expect(run.sessionRaw, 'enveloppe chiffree').toContain('__encrypted');
    expect(run.sessionMessagesAfter()).toEqual([]);
  });

  it('les journaux de la remise a zero ne portent aucun octet de message, y compris en cas d annulation', async () => {
    const done = await runReset({ id: 'journal-ok', encryptSession: true });
    const cancelled = await runReset({
      id: 'journal-annule',
      encryptSession: true,
      atErase: ({ projectFile }) => writeFileSync(projectFile, '[session_reset]\nmode = "none"\n'),
    });
    const logs = [...done.logs, ...cancelled.logs];
    const leaks = Object.values(SECRETS).filter((secret) => logs.some((line) => line.includes(secret)));
    console.log('JOURNAUX', JSON.stringify({ lines: logs.length, cancelledLogged: cancelled.logs.some((l) => l.includes('cancelled')), leaks }));
    expect(cancelled.logs.some((line) => line.includes('messaging session reset cancelled')), 'annulation journalisee').toBe(true);
    expect(leaks, 'octets de message dans les journaux').toEqual([]);
  });

  it('l agent evince ne declenche aucun export de fin de session', async () => {
    const run = await runReset({ id: 'export-fin', encryptSession: true });
    console.log('EVICTION', JSON.stringify(run.disposeOptions));
    expect(run.disposeOptions, 'dispose appele une fois, sans apprentissage de fin de session').toEqual([
      { skipSessionLearning: true },
    ]);
  });

  it('SESSION_ENCRYPTION=true : la session serait chiffree a la prochaine ecriture, l archive l est deja', async () => {
    const run = await runReset({ id: 'env', encryptSession: false, sessionEncryptionEnv: true });
    const bytes = (Object.keys(EXPECTED) as Source[]).map((source) => run.archiveBytes(source)).join('\n');
    const leaks = Object.values(SECRETS).filter((secret) => bytes.includes(secret));
    console.log('ENV_CHIFFREMENT', JSON.stringify({ leaks, sessionPlain: run.sessionRaw.includes(SECRETS.session) }));
    expect(bytes).not.toBe('');
    expect(leaks, 'archives sans octet en clair').toEqual([]);
    expect(run.sessionRaw, 'session reecrite chiffree').toContain('__encrypted');
    expect(run.restore('session-store').join('\n')).toContain(SECRETS.session);
  });

  it('temoin : une session en clair, sans chiffrement demande, reste archivee en clair et restaurable', async () => {
    const run = await runReset({ id: 'temoin-clair', encryptSession: false });
    const bytes = run.archiveBytes('session-store');
    console.log('TEMOIN_CLAIR', JSON.stringify({ plaintext: bytes.includes(SECRETS.session), sealed: bytes.includes('"encrypted": true') }));
    expect(bytes).toContain(SECRETS.session);
    expect(bytes).not.toContain('"encrypted": true');
    expect(run.restore('session-store').join('\n')).toContain(SECRETS.session);
    expect(run.sessionRaw).not.toContain('__encrypted');
  });
});

describe('scellement de l archive : garde-fous du module', () => {
  const plainPolicy = { mode: 'idle' as const, idleMinutes: 1, atHour: 4 };

  it('un scelleur qui rend le texte en clair annule la remise a zero et n ecrit rien', async () => {
    const messaging = await import('../../src/channels/messaging-session-reset.js');
    const archiveDir = tempDir();
    let erased = false;
    const outcome = await messaging.applyChannelMessagingSessionReset({
      sessionKey: 'fuite',
      now: 10_000_000,
      policy: plainPolicy,
      snapshot: { lastActivityAt: 0, transcript: 'user: FUITE_SCELLEUR' },
      parts: [{ source: 'session-store', transcript: 'user: FUITE_SCELLEUR' }],
      archiveDir,
      sealer: { seal: async (text) => `{"wrapped":"${text}"}`, open: (sealed) => sealed },
      resetSession: async () => { erased = true; },
    });
    const bytes = filesUnder(archiveDir).map((f) => readFileSync(f, 'utf8')).join('\n');
    console.log('SCELLEUR_FUYANT', JSON.stringify({ action: outcome.action, erased, plaintext: bytes.includes('FUITE_SCELLEUR') }));
    expect(outcome).toMatchObject({ action: 'cancelled', error: 'memory archive sealing left plaintext' });
    expect(erased).toBe(false);
    expect(bytes).not.toContain('FUITE_SCELLEUR');
  });

  it('un scellement qui echoue annule la remise a zero avant toute ecriture', async () => {
    const messaging = await import('../../src/channels/messaging-session-reset.js');
    const archiveDir = tempDir();
    let erased = false;
    const outcome = await messaging.applyChannelMessagingSessionReset({
      sessionKey: 'cle-absente',
      now: 10_000_000,
      policy: plainPolicy,
      snapshot: { lastActivityAt: 0, transcript: 'user: CLE_ABSENTE' },
      parts: [{ source: 'session-store', transcript: 'user: CLE_ABSENTE' }],
      archiveDir,
      sealer: { seal: async () => { throw new Error('no key'); }, open: () => '' },
      resetSession: async () => { erased = true; },
    });
    expect(outcome).toMatchObject({ action: 'cancelled', error: 'memory save failed' });
    expect(erased).toBe(false);
    expect(filesUnder(archiveDir)).toEqual([]);
  });

  it('une archive scellee qui ne se rouvre pas avec la cle annule la remise a zero', async () => {
    const messaging = await import('../../src/channels/messaging-session-reset.js');
    let erased = false;
    const outcome = await messaging.applyChannelMessagingSessionReset({
      sessionKey: 'autre-cle',
      now: 10_000_000,
      policy: plainPolicy,
      snapshot: { lastActivityAt: 0, transcript: 'user: AUTRE_CLE' },
      parts: [{ source: 'session-store', transcript: 'user: AUTRE_CLE' }],
      archiveDir: tempDir(),
      sealer: { seal: async () => 'CHIFFRE_AVEC_UNE_AUTRE_CLE', open: () => 'user: illisible' },
      resetSession: async () => { erased = true; },
    });
    expect(outcome).toMatchObject({ action: 'cancelled', error: 'memory archive cannot be opened' });
    expect(erased).toBe(false);
  });

  it('des parties scellees en partie seulement sont refusees', async () => {
    const messaging = await import('../../src/channels/messaging-session-reset.js');
    const archiveDir = tempDir();
    const result = messaging.proveMessagingMemoryParts({
      archiveDir,
      sessionKey: 'partiel',
      now: 10_000_000,
      reason: 'idle',
      open: (sealed) => sealed,
      parts: [
        { source: 'session-store', transcript: 'user: A', sealed: 'SCELLE' },
        { source: 'local-map', transcript: 'user: PARTIEL_EN_CLAIR' },
      ],
    });
    expect(result).toEqual({ ok: false, error: 'memory archive partly sealed' });
    expect(filesUnder(archiveDir)).toEqual([]);
  });

  it('une archive scellee ne se restaure pas sans la cle', async () => {
    const messaging = await import('../../src/channels/messaging-session-reset.js');
    const archiveDir = tempDir();
    const saved = messaging.proveMessagingMemorySave({
      archiveDir,
      sessionKey: 'sans-cle',
      transcript: 'user: SANS_CLE',
      now: 10_000_000,
      reason: 'idle',
      source: 'session-store',
      sealed: { payload: 'CHIFFRE', open: () => 'user: SANS_CLE' },
    });
    expect(saved.ok).toBe(true);
    expect(() => messaging.openMessagingMemoryArchive(archiveDir, 'sans-cle', 'session-store')).toThrow('memory archive is sealed');
    expect(messaging.openMessagingMemoryArchive(archiveDir, 'sans-cle', 'session-store', () => 'user: SANS_CLE')).toEqual(['user: SANS_CLE']);
  });
});
