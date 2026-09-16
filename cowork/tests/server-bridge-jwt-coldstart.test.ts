import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as nodeFs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

type CoreEvent = { event: string; jwtSecret?: string | null; nodeEnv?: string };

const state = vi.hoisted(() => ({
  userData: '',
  appPath: '',
  config: {} as Record<string, unknown>,
  failSecretWrite: false,
  failSecretRename: false,
}));

vi.mock('electron', () => {
  const app = {
    isPackaged: true,
    getPath: (name: string) => (name === 'home' ? process.env.HOME ?? '' : state.userData),
    getAppPath: () => state.appPath,
    getVersion: () => '0.0.0-coldstart',
  };
  return { app, default: { app } };
});

vi.mock('../src/main/config/config-store', () => ({
  configStore: { getAll: () => state.config },
}));

// Used only by the simulated failures: writing any `.jwt_secret*` file creates it
// empty, then fails the way a full disk does; renaming onto `.jwt_secret` fails
// the way a locked or foreign-owned target does.
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  const writeFileSync = ((file: nodeFs.PathOrFileDescriptor, data: string, options?: nodeFs.WriteFileOptions) => {
    if (state.failSecretWrite && String(file).includes('.jwt_secret')) {
      actual.writeFileSync(file, '', options);
      throw Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' });
    }
    return actual.writeFileSync(file, data, options);
  }) as typeof actual.writeFileSync;
  const renameSync = ((from: nodeFs.PathLike, to: nodeFs.PathLike) => {
    if (state.failSecretRename && String(to).endsWith('.jwt_secret')) {
      throw Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' });
    }
    return actual.renameSync(from, to);
  }) as typeof actual.renameSync;
  return {
    ...actual,
    writeFileSync,
    renameSync,
    default: { ...actual, writeFileSync, renameSync },
  };
});

const ENV_KEYS = [
  'HOME',
  'USERPROFILE',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
  'NODE_ENV',
  'JWT_SECRET',
  'CODEBUDDY_ENGINE_PATH',
] as const;
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
const roots: string[] = [];

/**
 * Fake core `dist/` reached through the real core-loader: the database and server
 * modules record JWT_SECRET when they are loaded, and startServer applies the
 * production guard of `getJwtSecret()` (src/server/index.ts). Nothing listens.
 */
function writeFakeCore(dist: string): void {
  nodeFs.mkdirSync(path.join(dist, 'database'), { recursive: true });
  nodeFs.mkdirSync(path.join(dist, 'server'), { recursive: true });
  nodeFs.writeFileSync(
    path.join(dist, 'database', 'database-manager.js'),
    `globalThis.__coldStart.events.push({ event: 'load:database', jwtSecret: process.env.JWT_SECRET ?? null, nodeEnv: process.env.NODE_ENV });
export function getDatabaseManager() {
  return { isInitialized: () => true, async initialize() {} };
}
`,
  );
  nodeFs.writeFileSync(
    path.join(dist, 'server', 'index.js'),
    `globalThis.__coldStart.events.push({ event: 'load:server', jwtSecret: process.env.JWT_SECRET ?? null, nodeEnv: process.env.NODE_ENV });
export async function startServer(config = {}) {
  const authEnabled = process.env.NODE_ENV === 'production' ? true : process.env.AUTH_ENABLED !== 'false';
  if (!process.env.JWT_SECRET && authEnabled && process.env.NODE_ENV === 'production') {
    throw new Error('SECURITY ERROR: JWT_SECRET environment variable must be set in production.');
  }
  globalThis.__coldStart.events.push({ event: 'startServer', jwtSecret: process.env.JWT_SECRET ?? null });
  return {
    app: {},
    server: { close: (cb) => cb && cb(), address: () => ({ port: 43210 }) },
    config: { port: 43210, host: config.host ?? 'localhost', websocketEnabled: false },
    cognitionPort: {},
  };
}
export async function stopServer() {}
`,
  );
}

/** Fresh module graph, fixture HOME/XDG/userData, NODE_ENV=production, no inherited JWT_SECRET. */
async function coldStart(options: {
  persistedSecret?: string;
  config?: Record<string, unknown>;
  shellSecret?: string;
  failSecretWrite?: boolean;
  failSecretRename?: boolean;
  home?: string;
} = {}) {
  vi.resetModules();
  const root = nodeFs.mkdtempSync(path.join(os.tmpdir(), 'cowork-jwt-coldstart-'));
  roots.push(root);
  const home = options.home ?? path.join(root, 'home');
  const dist = path.join(root, 'dist');
  state.userData = path.join(root, 'userData');
  state.appPath = path.join(root, 'app');
  state.config = options.config ?? {};
  state.failSecretWrite = options.failSecretWrite ?? false;
  state.failSecretRename = options.failSecretRename ?? false;
  nodeFs.mkdirSync(home, { recursive: true });
  writeFakeCore(dist);
  const secretPath = path.join(home, '.codebuddy', '.jwt_secret');
  if (options.persistedSecret !== undefined) {
    nodeFs.mkdirSync(path.dirname(secretPath), { recursive: true });
    nodeFs.writeFileSync(secretPath, options.persistedSecret, { mode: 0o600 });
  }
  Object.assign(process.env, {
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_DATA_HOME: path.join(home, '.local', 'share'),
    XDG_CACHE_HOME: path.join(home, '.cache'),
    NODE_ENV: 'production',
    CODEBUDDY_ENGINE_PATH: dist,
  });
  if (options.shellSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = options.shellSecret;

  const events: CoreEvent[] = [];
  (globalThis as { __coldStart?: { events: CoreEvent[] } }).__coldStart = { events };
  const consoleText: string[] = [];
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      consoleText.push(
        args.map((arg) => (arg instanceof Error ? `${arg.message}\n${arg.stack}` : String(arg))).join(' '),
      );
    });
  }

  const { ServerBridge } = await import('../src/main/server/server-bridge');
  const status = await new ServerBridge().start({ port: 43210, host: '127.0.0.1' });
  const logsDir = path.join(state.userData, 'logs');
  const logFiles = nodeFs.existsSync(logsDir)
    ? nodeFs.readdirSync(logsDir).map((name) => nodeFs.readFileSync(path.join(logsDir, name), 'utf8'))
    : [];
  return { status, events, home, secretPath, logs: [...consoleText, ...logFiles].join('\n') };
}

function secretDirectoryEntries(secretPath: string): string[] {
  const directory = path.dirname(secretPath);
  return nodeFs.existsSync(directory) ? nodeFs.readdirSync(directory).sort() : [];
}

beforeEach(() => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  for (const root of roots.splice(0)) {
    const blocked = path.join(root, 'home', '.codebuddy', '.jwt_secret');
    if (nodeFs.existsSync(blocked)) nodeFs.chmodSync(blocked, 0o600);
    nodeFs.rmSync(root, { recursive: true, force: true });
  }
});

describe('ServerBridge cold start under NODE_ENV=production — real filesystem and core-loader, fake core database/server modules, no listener', () => {
  it('mints and persists JWT_SECRET before any core module is loaded, without logging it', async () => {
    const run = await coldStart();

    const secret = nodeFs.readFileSync(run.secretPath, 'utf8');
    expect(secret).toMatch(/^[0-9a-f]{128}$/);
    if (process.platform !== 'win32') expect(nodeFs.statSync(run.secretPath).mode & 0o777).toBe(0o600);
    expect(secretDirectoryEntries(run.secretPath)).toEqual(['.jwt_secret']);
    expect(run.events.map((event) => event.event)).toEqual(['load:database', 'load:server', 'startServer']);
    for (const event of run.events) expect(event.jwtSecret).toBe(secret);
    expect(run.status).toMatchObject({ running: true, port: 43210, error: null });
    expect(run.logs).toContain('minted and persisted new JWT_SECRET');
    expect(run.logs).not.toContain(secret);
  });

  it('reuses a persisted secret without rewriting it', async () => {
    const persisted = 'a'.repeat(128);
    const run = await coldStart({ persistedSecret: persisted });

    expect(run.events.map((event) => event.jwtSecret)).toEqual([persisted, persisted, persisted]);
    expect(nodeFs.readFileSync(run.secretPath, 'utf8')).toBe(persisted);
    expect(run.status.running).toBe(true);
    expect(run.logs).not.toContain(persisted);
  });

  it('uses the shell secret first, then the Settings secret, and creates no file for either', async () => {
    const settings = await coldStart({ config: { server: { jwtSecret: 's'.repeat(64) } } });
    expect(settings.events.every((event) => event.jwtSecret === 's'.repeat(64))).toBe(true);
    expect(nodeFs.existsSync(settings.secretPath)).toBe(false);

    const shell = await coldStart({ shellSecret: 'e'.repeat(64) });
    expect(shell.events.every((event) => event.jwtSecret === 'e'.repeat(64))).toBe(true);
    expect(nodeFs.existsSync(shell.secretPath)).toBe(false);

    const both = await coldStart({ shellSecret: 'e'.repeat(64), config: { server: { jwtSecret: 's'.repeat(64) } } });
    expect(both.events.map((event) => event.jwtSecret)).toEqual(['e'.repeat(64), 'e'.repeat(64), 'e'.repeat(64)]);
    expect(process.env.JWT_SECRET).toBe('e'.repeat(64));
    expect(nodeFs.existsSync(both.secretPath)).toBe(false);
  });

  it.each([
    ['an empty', '', 'persisted JWT_SECRET is empty; replacing it'],
    ['a whitespace-only', ' \n', 'persisted JWT_SECRET is empty; replacing it'],
    ['a truncated', 'abc123\n', 'persisted JWT_SECRET is too short (6 characters); replacing it'],
  ])('replaces %s secret file instead of starting with it', async (_kind, content, message) => {
    const run = await coldStart({ persistedSecret: content });

    const secret = nodeFs.readFileSync(run.secretPath, 'utf8');
    expect(secret).toMatch(/^[0-9a-f]{128}$/);
    expect(run.events.map((event) => event.jwtSecret)).toEqual([secret, secret, secret]);
    expect(run.status).toMatchObject({ running: true, error: null });
    expect(run.logs).toContain(message);
    expect(run.logs).not.toContain(secret);
    expect(run.logs).not.toContain('loaded persisted JWT_SECRET');
  });

  it('keeps a persisted secret of exactly 32 characters, hex or not, and replaces a 31-character one', async () => {
    const compatible = 'Compat-secret-of-32-characters!!';
    expect(compatible).toHaveLength(32);
    const kept = await coldStart({ persistedSecret: `${compatible}\n` });

    expect(kept.events.map((event) => event.jwtSecret)).toEqual([compatible, compatible, compatible]);
    expect(nodeFs.readFileSync(kept.secretPath, 'utf8')).toBe(`${compatible}\n`);
    expect(kept.logs).toContain('loaded persisted JWT_SECRET');
    expect(kept.logs).not.toContain(compatible);

    const short = await coldStart({ persistedSecret: compatible.slice(1) });
    const replacement = nodeFs.readFileSync(short.secretPath, 'utf8');
    expect(replacement).toMatch(/^[0-9a-f]{128}$/);
    expect(short.logs).toContain('persisted JWT_SECRET is too short (31 characters); replacing it');
    expect(short.logs).not.toContain(compatible.slice(1));
  });

  it('runs on an ephemeral secret when the secret directory cannot be created', async () => {
    const root = nodeFs.mkdtempSync(path.join(os.tmpdir(), 'cowork-jwt-blocked-'));
    roots.push(root);
    nodeFs.writeFileSync(path.join(root, '.codebuddy'), 'not a directory');

    const run = await coldStart({ home: root });

    const secret = run.events[0]?.jwtSecret ?? '';
    expect(secret).toMatch(/^[0-9a-f]{128}$/);
    expect(run.status.running).toBe(true);
    expect(run.logs).toContain('failed to persist JWT_SECRET, using ephemeral fallback');
    expect(run.logs).not.toContain(secret);
  });

  it.runIf(process.platform !== 'win32' && process.getuid?.() !== 0)(
    'keeps an unreadable secret file untouched and says it could not be read',
    async () => {
      const root = nodeFs.mkdtempSync(path.join(os.tmpdir(), 'cowork-jwt-unreadable-'));
      roots.push(root);
      const home = path.join(root, 'home');
      const secretPath = path.join(home, '.codebuddy', '.jwt_secret');
      nodeFs.mkdirSync(path.dirname(secretPath), { recursive: true });
      nodeFs.writeFileSync(secretPath, 'k'.repeat(128), { mode: 0o000 });

      const run = await coldStart({ home });

      expect(run.status.running).toBe(true);
      expect(run.logs).toContain('could not read the persisted JWT_SECRET, using ephemeral fallback');
      expect(nodeFs.statSync(secretPath).mode & 0o777).toBe(0o000);
      expect(run.logs).not.toContain(run.events[0]?.jwtSecret ?? '<none>');
    },
  );
});

describe('ServerBridge cold start under NODE_ENV=production — simulated rename failure onto the secret file (fs.renameSync stub), fake core modules', () => {
  it('removes the temp file, keeps no secret file, runs on an ephemeral secret, then persists on the next cold start', async () => {
    const first = await coldStart({ failSecretRename: true });

    const ephemeral = first.events[0]?.jwtSecret ?? '';
    expect(ephemeral).toMatch(/^[0-9a-f]{128}$/);
    expect(first.status).toMatchObject({ running: true, error: null });
    expect(first.logs).toContain('failed to persist JWT_SECRET, using ephemeral fallback');
    expect(first.logs).toContain('EPERM');
    expect(first.logs).not.toContain(ephemeral);
    expect(secretDirectoryEntries(first.secretPath)).toEqual([]);

    const next = await coldStart({ home: first.home });

    const secret = nodeFs.readFileSync(next.secretPath, 'utf8');
    expect(secret).toMatch(/^[0-9a-f]{128}$/);
    expect(secret).not.toBe(ephemeral);
    expect(secretDirectoryEntries(next.secretPath)).toEqual(['.jwt_secret']);
    expect(next.status).toMatchObject({ running: true, error: null });
  });
});

describe('ServerBridge cold start under NODE_ENV=production — simulated ENOSPC on the secret write (fs.writeFileSync stub), fake core modules', () => {
  it('leaves no torn secret file, so the next cold start mints and persists a valid one', async () => {
    const first = await coldStart({ failSecretWrite: true });

    expect(first.status.running).toBe(true);
    expect(first.events[0]?.jwtSecret).toMatch(/^[0-9a-f]{128}$/);
    expect(first.logs).toContain('failed to persist JWT_SECRET, using ephemeral fallback');
    expect(first.logs).toContain('ENOSPC');
    expect(secretDirectoryEntries(first.secretPath)).toEqual([]);

    const next = await coldStart({ home: first.home });

    const secret = nodeFs.readFileSync(next.secretPath, 'utf8');
    expect(secret).toMatch(/^[0-9a-f]{128}$/);
    expect(next.status).toMatchObject({ running: true, error: null });
    expect(next.events.map((event) => event.jwtSecret)).toEqual([secret, secret, secret]);
  });
});
