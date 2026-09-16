import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as nodeFs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

type Deferred = { promise: Promise<void>; resolve: () => void };
type FakeServer = { id: number; closed: boolean; listening: boolean };
type Lifecycle = {
  events: string[];
  servers: FakeServer[];
  realServers: http.Server[];
  failNextStop: boolean;
  closeThenFail: boolean;
  gate: (name: string) => Promise<void>;
};

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const state = vi.hoisted(() => ({
  userData: '',
  configGate: null as null | { promise: Promise<void>; reached: () => void },
}));

vi.mock('electron', () => {
  const app = {
    isPackaged: true,
    getPath: () => state.userData,
    getAppPath: () => state.userData,
    getVersion: () => '0.0.0-lifecycle',
  };
  return { app, default: { app } };
});

const ENV_KEYS = ['HOME', 'USERPROFILE', 'NODE_ENV', 'JWT_SECRET', 'CODEBUDDY_ENGINE_PATH'] as const;
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
const roots: string[] = [];
const realServers: http.Server[] = [];
const holds = new Map<string, { release: Deferred; reached: Deferred }>();

/** One request to the loopback server; resolves with the body or rejects with the connection error. */
function httpGet(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: '127.0.0.1', port, path: '/', agent: false, timeout: 2_000 }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => {
        body += chunk;
      });
      response.on('end', () => resolve(body));
    });
    request.on('timeout', () => request.destroy(new Error('request timed out')));
    request.on('error', reject);
  });
}

/** Hold the next pass through a named step of the fake core; returns when it is reached. */
function hold(name: string): { reached: Promise<void>; release: () => void } {
  const entry = { release: deferred(), reached: deferred() };
  holds.set(name, entry);
  return { reached: entry.reached.promise, release: entry.release.resolve };
}

/**
 * Fake core `dist/` reached through the real core-loader.
 *
 * - `held`: startServer creates its server before awaiting (a listening server
 *   exists before startServer resolves); stopServer refuses to close a server
 *   twice, can fail before closing (`failNextStop`) or close then reject like
 *   ERR_SERVER_NOT_RUNNING (`closeThenFail`). Nothing listens.
 * - `http`: a real `http.Server` on 127.0.0.1, port 0. As in src/server/index.ts,
 *   a teardown step can throw before `server.close()` is reached, and
 *   `server.close()` rejects when the server is not running. No API, core or
 *   provider code is involved.
 */
function writeFakeCore(dist: string, variant: 'held' | 'http'): void {
  if (variant === 'http') {
    nodeFs.mkdirSync(path.join(dist, 'server'), { recursive: true });
    nodeFs.writeFileSync(
      path.join(dist, 'server', 'index.js'),
      `import http from 'node:http';
const h = globalThis.__lifecycle;
export async function startServer() {
  const server = http.createServer((req, res) => { res.setHeader('Connection', 'close'); res.end('ok'); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  h.realServers.push(server);
  return { app: {}, server, config: { port: server.address().port, host: '127.0.0.1', websocketEnabled: false }, cognitionPort: { port: server.address().port } };
}
export async function stopServer(server) {
  if (h.failNextStop) { h.failNextStop = false; throw new Error('teardown failed before closing the HTTP server'); }
  await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}
`,
    );
    return;
  }
  nodeFs.mkdirSync(path.join(dist, 'database'), { recursive: true });
  nodeFs.mkdirSync(path.join(dist, 'server'), { recursive: true });
  nodeFs.writeFileSync(
    path.join(dist, 'database', 'database-manager.js'),
    `const h = globalThis.__lifecycle;
await h.gate('db:import');
export function getDatabaseManager() {
  h.events.push('db:getDatabaseManager');
  return {
    isInitialized: () => false,
    async initialize() { h.events.push('db:initialize'); await h.gate('db'); },
  };
}
`,
  );
  nodeFs.writeFileSync(
    path.join(dist, 'server', 'index.js'),
    `const h = globalThis.__lifecycle;
h.events.push('load:server');
await h.gate('server:import');
export async function startServer(config = {}) {
  const server = { id: h.servers.length + 1, closed: false, listening: true, close: (cb) => cb && cb() };
  server.address = () => (server.listening ? { port: 43210 } : null);
  h.servers.push(server);
  h.events.push('startServer:' + server.id + ':created');
  await h.gate('startServer');
  return { app: {}, server, config: { port: 43210, host: config.host ?? 'localhost', websocketEnabled: false }, cognitionPort: { serverId: server.id } };
}
export async function stopServer(server) {
  h.events.push('stopServer:' + server.id + ':begin');
  await h.gate('stopServer');
  if (h.failNextStop) { h.failNextStop = false; throw new Error('close failed for server ' + server.id); }
  if (server.closed) throw new Error('server ' + server.id + ' is already closed');
  server.closed = true;
  server.listening = false;
  h.events.push('stopServer:' + server.id + ':closed');
  if (h.closeThenFail) { h.closeThenFail = false; throw Object.assign(new Error('Server is not running.'), { code: 'ERR_SERVER_NOT_RUNNING' }); }
}
`,
  );
}

async function freshBridge(variant: 'held' | 'http' = 'held') {
  vi.resetModules();
  const root = nodeFs.mkdtempSync(path.join(os.tmpdir(), 'cowork-bridge-lifecycle-'));
  roots.push(root);
  const dist = path.join(root, 'dist');
  state.userData = path.join(root, 'userData');
  writeFakeCore(dist, variant);
  Object.assign(process.env, {
    HOME: path.join(root, 'home'),
    USERPROFILE: path.join(root, 'home'),
    NODE_ENV: 'production',
    JWT_SECRET: 'lifecycle-test-secret-'.padEnd(64, 'x'),
    CODEBUDDY_ENGINE_PATH: dist,
  });
  const lifecycle: Lifecycle = {
    events: [],
    servers: [],
    realServers,
    failNextStop: false,
    closeThenFail: false,
    gate: (name) => {
      const entry = holds.get(name);
      if (!entry) return Promise.resolve();
      holds.delete(name);
      entry.reached.resolve();
      return entry.release.promise;
    },
  };
  (globalThis as { __lifecycle?: Lifecycle }).__lifecycle = lifecycle;
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, method).mockImplementation(() => {});
  }
  // The dynamic import of the Settings store is the first await of start();
  // registered per bridge so a held import is really evaluated again.
  vi.doMock('../src/main/config/config-store', async () => {
    const gate = state.configGate;
    if (gate) {
      gate.reached();
      await gate.promise;
    }
    return { configStore: { getAll: () => ({}) } };
  });
  const { ServerBridge } = await import('../src/main/server/server-bridge');
  return { bridge: new ServerBridge(), lifecycle };
}

/** Let every pending promise continuation run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await new Promise((done) => setImmediate(done));
}

function tracked<T>(promise: Promise<T>): { promise: Promise<T>; settled: () => boolean } {
  let done = false;
  promise.then(
    () => {
      done = true;
    },
    () => {
      done = true;
    },
  );
  return { promise, settled: () => done };
}

beforeEach(() => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
});

afterEach(async () => {
  // Real loopback servers are always closed, whatever the test left behind.
  for (const server of realServers.splice(0)) {
    if (server.listening) {
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
    }
  }
  vi.restoreAllMocks();
  holds.clear();
  state.configGate = null;
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  for (const root of roots.splice(0)) nodeFs.rmSync(root, { recursive: true, force: true });
});

describe('ServerBridge start/stop lifecycle — real core-loader, fake core server with held steps, no listener', () => {
  it('closes a server created while stop was requested and never publishes it as running', async () => {
    const { bridge, lifecycle } = await freshBridge();
    const startStep = hold('startServer');

    const starting = tracked(bridge.start());
    await startStep.reached;
    const stopping = tracked(bridge.stop());
    await settle();
    expect(stopping.settled()).toBe(false);

    startStep.release();
    const [started, stopped] = await Promise.all([starting.promise, stopping.promise]);

    expect(started.running).toBe(false);
    expect(stopped.running).toBe(false);
    expect((await bridge.status()).running).toBe(false);
    expect(bridge.getCognitionPort()).toBeNull();
    expect(lifecycle.servers).toEqual([expect.objectContaining({ id: 1, closed: true })]);
    expect(lifecycle.events.filter((event) => event.startsWith('stopServer:1:begin'))).toHaveLength(1);
  });

  it('does not create a server when stop is requested while the database is initializing', async () => {
    const { bridge, lifecycle } = await freshBridge();
    const dbStep = hold('db');

    const starting = bridge.start();
    await dbStep.reached;
    const stopping = tracked(bridge.stop());
    await settle();
    expect(stopping.settled()).toBe(false);

    dbStep.release();
    const [started, stopped] = await Promise.all([starting, stopping.promise]);

    expect(started.running).toBe(false);
    expect(stopped.running).toBe(false);
    expect(lifecycle.servers).toEqual([]);
    expect(lifecycle.events.some((event) => event.startsWith('startServer'))).toBe(false);
  });

  it('does not get or initialize the database when stop is requested while its module is still loading', async () => {
    const { bridge, lifecycle } = await freshBridge();
    const importStep = hold('db:import');

    const starting = bridge.start();
    await importStep.reached;
    const stopping = tracked(bridge.stop());
    await settle();
    expect(stopping.settled()).toBe(false);

    importStep.release();
    const [started, stopped] = await Promise.all([starting, stopping.promise]);

    expect(started.running).toBe(false);
    expect(stopped.running).toBe(false);
    expect(lifecycle.events).toEqual([]);
    expect(lifecycle.servers).toEqual([]);

    expect(await bridge.start()).toMatchObject({ running: true, error: null });
    expect(lifecycle.events).toEqual([
      'db:getDatabaseManager',
      'db:initialize',
      'load:server',
      'startServer:1:created',
    ]);
  });

  it('does not create a server when stop is requested while the server module is still loading', async () => {
    const { bridge, lifecycle } = await freshBridge();
    const importStep = hold('server:import');

    const starting = bridge.start();
    await importStep.reached;
    const stopping = tracked(bridge.stop());
    await settle();
    expect(stopping.settled()).toBe(false);

    importStep.release();
    const [started, stopped] = await Promise.all([starting, stopping.promise]);

    expect(started.running).toBe(false);
    expect(stopped.running).toBe(false);
    expect(lifecycle.events).toEqual(['db:getDatabaseManager', 'db:initialize', 'load:server']);
    expect(lifecycle.servers).toEqual([]);

    expect(await bridge.start()).toMatchObject({ running: true, error: null });
    expect(lifecycle.servers.map((server) => [server.id, server.closed])).toEqual([[1, false]]);
  });

  it('does not boot at all when stop is requested while start is still reading the Settings store', async () => {
    const { bridge, lifecycle } = await freshBridge();
    const configRelease = deferred();
    const configReached = deferred();
    state.configGate = { promise: configRelease.promise, reached: configReached.resolve };

    const starting = bridge.start();
    await configReached.promise;
    const stopped = await bridge.stop();
    configRelease.resolve();
    const started = await starting;

    expect(stopped.running).toBe(false);
    expect(started.running).toBe(false);
    expect(lifecycle.events).toEqual([]);
    expect(lifecycle.servers).toEqual([]);
  });

  it('boots again when start is requested while a stop is closing the server', async () => {
    const { bridge, lifecycle } = await freshBridge();
    expect((await bridge.start()).running).toBe(true);
    const stopStep = hold('stopServer');

    const stopping = bridge.stop();
    await stopStep.reached;
    const restarting = tracked(bridge.start());
    await settle();
    expect(restarting.settled()).toBe(false);

    stopStep.release();
    const [stopped, restarted] = await Promise.all([stopping, restarting.promise]);

    expect(stopped.running).toBe(false);
    expect(restarted).toMatchObject({ running: true, port: 43210 });
    expect(lifecycle.servers.map((server) => [server.id, server.closed])).toEqual([
      [1, true],
      [2, false],
    ]);
    expect(bridge.getCognitionPort()).toEqual({ serverId: 2 });
  });

  it('closes a running server once when stop is requested twice', async () => {
    const { bridge, lifecycle } = await freshBridge();
    await bridge.start();
    const stopStep = hold('stopServer');

    const first = bridge.stop();
    await stopStep.reached;
    const second = bridge.stop();
    stopStep.release();
    const [firstStatus, secondStatus] = await Promise.all([first, second]);

    expect(firstStatus).toMatchObject({ running: false, error: null });
    expect(secondStatus).toMatchObject({ running: false, error: null });
    expect(lifecycle.events.filter((event) => event.startsWith('stopServer:1:begin'))).toHaveLength(1);
  });

  it('can be started explicitly again after a stop cancelled a boot', async () => {
    const { bridge, lifecycle } = await freshBridge();
    const startStep = hold('startServer');
    const starting = bridge.start();
    await startStep.reached;
    const stopping = bridge.stop();
    startStep.release();
    await Promise.all([starting, stopping]);

    const restarted = await bridge.start();

    expect(restarted).toMatchObject({ running: true, port: 43210, error: null });
    expect(lifecycle.servers.map((server) => [server.id, server.closed])).toEqual([
      [1, true],
      [2, false],
    ]);
    expect(bridge.getCognitionPort()).toEqual({ serverId: 2 });
  });

  it('shares one boot between concurrent starts', async () => {
    const { bridge, lifecycle } = await freshBridge();

    const [first, second] = await Promise.all([bridge.start(), bridge.start()]);

    expect(first).toMatchObject({ running: true, port: 43210 });
    expect(second).toMatchObject({ running: true, port: 43210 });
    expect(lifecycle.servers).toHaveLength(1);
  });

  it('keeps tracking a late server whose close failed, so a later stop can close it', async () => {
    const { bridge, lifecycle } = await freshBridge();
    const startStep = hold('startServer');
    const starting = bridge.start();
    await startStep.reached;
    lifecycle.failNextStop = true;
    const stopping = bridge.stop();
    startStep.release();
    const [, stopped] = await Promise.all([starting, stopping]);

    expect(stopped.running).toBe(true);
    expect(stopped.error).toContain('close failed for server 1');
    expect(lifecycle.servers[0]?.closed).toBe(false);

    const retried = await bridge.stop();

    expect(retried.running).toBe(false);
    expect(lifecycle.servers[0]?.closed).toBe(true);
  });
});

describe('ServerBridge normal stop failure — real core-loader, fake core server with held steps, no listener', () => {
  it('keeps a server whose stop failed, starts no second server, and closes it on retry', async () => {
    const { bridge, lifecycle } = await freshBridge();
    await bridge.start();
    lifecycle.failNextStop = true;

    const stopped = await bridge.stop();

    expect(stopped).toMatchObject({ running: true, port: 43210, error: 'close failed for server 1' });
    expect(await bridge.status()).toMatchObject({ running: true, error: 'close failed for server 1' });
    expect(bridge.getCognitionPort()).toEqual({ serverId: 1 });

    const startedAgain = await bridge.start();
    expect(startedAgain).toMatchObject({ running: true, port: 43210 });
    expect(lifecycle.servers).toHaveLength(1);

    const retried = await bridge.stop();
    expect(retried).toMatchObject({ running: false, error: null });
    expect(lifecycle.servers[0]).toMatchObject({ closed: true, listening: false });
    expect(bridge.getCognitionPort()).toBeNull();

    const restarted = await bridge.start();
    expect(restarted).toMatchObject({ running: true, error: null });
    expect(lifecycle.servers.map((server) => [server.id, server.closed])).toEqual([
      [1, true],
      [2, false],
    ]);
  });

  it('gives both simultaneous stops the same failure, attempts the close once, and closes on retry', async () => {
    const { bridge, lifecycle } = await freshBridge();
    await bridge.start();
    lifecycle.failNextStop = true;
    const stopStep = hold('stopServer');

    const first = bridge.stop();
    await stopStep.reached;
    const second = bridge.stop();
    stopStep.release();
    const [firstStatus, secondStatus] = await Promise.all([first, second]);

    expect(firstStatus).toMatchObject({ running: true, error: 'close failed for server 1' });
    expect(secondStatus).toEqual(firstStatus);
    expect(lifecycle.events.filter((event) => event === 'stopServer:1:begin')).toHaveLength(1);

    expect(await bridge.stop()).toMatchObject({ running: false, error: null });
    expect(lifecycle.servers[0]?.closed).toBe(true);
  });

  it('does not publish a late server that is closed although its late close rejected', async () => {
    const { bridge, lifecycle } = await freshBridge();
    const startStep = hold('startServer');
    const starting = bridge.start();
    await startStep.reached;
    lifecycle.closeThenFail = true;
    const stopping = bridge.stop();
    startStep.release();
    const [started, stopped] = await Promise.all([starting, stopping]);

    expect(started.running).toBe(false);
    expect(stopped).toMatchObject({
      running: false,
      error: 'stop requested during start, but closing the server failed: Server is not running.',
    });
    expect(bridge.getCognitionPort()).toBeNull();
    expect(await bridge.start()).toMatchObject({ running: true, error: null });
    expect(lifecycle.servers.map((server) => [server.id, server.closed])).toEqual([
      [1, true],
      [2, false],
    ]);
  });

  it('forgets a server that is closed although stopServer rejected, so start boots again', async () => {
    const { bridge, lifecycle } = await freshBridge();
    await bridge.start();
    lifecycle.closeThenFail = true;

    const stopped = await bridge.stop();

    expect(stopped).toMatchObject({ running: false, error: 'Server is not running.' });
    expect(bridge.getCognitionPort()).toBeNull();
    expect(await bridge.start()).toMatchObject({ running: true, error: null });
    expect(lifecycle.servers.map((server) => [server.id, server.closed])).toEqual([
      [1, true],
      [2, false],
    ]);
  });
});

describe('ServerBridge normal stop failure — real http.Server on 127.0.0.1 port 0, fake core modules, no API/core/provider', () => {
  it('reports a server that still answers after a failed teardown and really closes it on retry', async () => {
    const { bridge, lifecycle } = await freshBridge('http');
    const started = await bridge.start();
    const port = started.port as number;
    expect(await httpGet(port)).toBe('ok');
    lifecycle.failNextStop = true;

    const stopped = await bridge.stop();

    expect(stopped).toMatchObject({ running: true, port, error: 'teardown failed before closing the HTTP server' });
    expect(await httpGet(port)).toBe('ok');
    expect(await bridge.start()).toMatchObject({ running: true, port });
    expect(lifecycle.realServers).toHaveLength(1);

    expect(await bridge.stop()).toMatchObject({ running: false, error: null });
    expect(lifecycle.realServers[0]?.listening).toBe(false);
    await expect(httpGet(port)).rejects.toMatchObject({ code: 'ECONNREFUSED' });

    const restarted = await bridge.start();
    expect(restarted).toMatchObject({ running: true, error: null });
    expect(await httpGet(restarted.port as number)).toBe('ok');
    expect(lifecycle.realServers).toHaveLength(2);
  });

  it('treats a server closed behind the bridge as closed when stopServer rejects, and boots again', async () => {
    const { bridge, lifecycle } = await freshBridge('http');
    const started = await bridge.start();
    const server = lifecycle.realServers[0] as http.Server;
    await new Promise<void>((done) => server.close(() => done()));

    const stopped = await bridge.stop();

    expect(stopped).toMatchObject({ running: false, error: 'Server is not running.' });
    await expect(httpGet(started.port as number)).rejects.toMatchObject({ code: 'ECONNREFUSED' });
    const restarted = await bridge.start();
    expect(restarted).toMatchObject({ running: true, error: null });
    expect(await httpGet(restarted.port as number)).toBe('ok');
  });
});
