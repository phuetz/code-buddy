/**
 * FleetBridge quit lifecycle — the bridge main creates at boot must be shut
 * down when Cowork really quits, within a bounded delay, exactly once, without
 * creating the module singleton, and without any peer reconnecting afterwards.
 *
 * `src/main/index.ts` cannot be imported in a test (Electron boot side effects),
 * so its wiring is checked statically, like `single-mainwindow-sync.test.ts`;
 * the behaviour is checked on the helper it calls, with a real FleetBridge.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';
import { readFileSync } from 'fs';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';

const tmpDir = path.join(os.tmpdir(), `cowork-fleet-quit-${process.pid}`);

vi.mock('electron', () => ({
  app: {
    isReady: () => true,
    getPath: () => tmpDir,
  },
}));

const logErrorMock = vi.fn();
vi.mock('../src/main/utils/logger', () => ({
  log: () => {},
  logWarn: () => {},
  logError: (...args: unknown[]) => logErrorMock(...args),
}));

class QuitFakeListener extends EventEmitter {
  static instances: QuitFakeListener[] = [];
  static connectImpl: (listener: QuitFakeListener) => Promise<void> = () => Promise.resolve();
  static disconnectImpl: ((listener: QuitFakeListener) => Promise<void>) | null = null;
  authenticated = false;
  disconnectCount = 0;

  constructor(readonly options: { url: string }) {
    super();
    QuitFakeListener.instances.push(this);
  }

  connect(): Promise<void> {
    return QuitFakeListener.connectImpl(this);
  }

  async disconnect(): Promise<void> {
    this.disconnectCount += 1;
    if (QuitFakeListener.disconnectImpl) return QuitFakeListener.disconnectImpl(this);
    this.authenticated = false;
    this.emit('disconnected');
  }

  async request(): Promise<unknown> {
    throw new Error('peer.invoke NOT_AUTHENTICATED: listener is not authenticated');
  }
}

vi.mock('../src/main/utils/core-loader', () => ({
  loadCoreModule: vi.fn(async () => ({ FleetListener: QuitFakeListener })),
}));

import { FleetBridge, getFleetBridge } from '../src/main/fleet/fleet-bridge';
import {
  FLEET_BRIDGE_QUIT_TIMEOUT_MS,
  createFleetDiscoverySchedule,
  shutdownFleetBridgeForQuit,
} from '../src/main/fleet/fleet-bridge-lifecycle';

function authenticate(listener: QuitFakeListener): Promise<void> {
  listener.emit('connected');
  listener.authenticated = true;
  listener.emit('authenticated');
  return Promise.resolve();
}

function refuse(listener: QuitFakeListener): Promise<void> {
  const err = new Error('connect ECONNREFUSED 203.0.113.11:3000');
  listener.emit('error', err);
  listener.emit('disconnected');
  return Promise.reject(err);
}

async function flush(): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** A hub that answers and a spoke that is down, so a recovery timer is armed. */
async function bridgeWithLiveAndDownPeers(): Promise<FleetBridge> {
  QuitFakeListener.connectImpl = (listener) =>
    listener.options.url.includes('203.0.113.10') ? authenticate(listener) : refuse(listener);
  const bridge = new FleetBridge(() => {}, null, { recoveryDelaysMs: [1_000] });
  await bridge.init();
  await bridge.addPeer({ url: 'ws://203.0.113.10:3000/ws', apiKey: 'k', label: 'hub' });
  await bridge.addPeer({ url: 'ws://203.0.113.11:3000/ws', apiKey: 'k', label: 'spoke' });
  await flush();
  expect(QuitFakeListener.instances).toHaveLength(2);
  return bridge;
}

describe('FleetBridge quit lifecycle', () => {
  beforeEach(async () => {
    QuitFakeListener.instances = [];
    QuitFakeListener.disconnectImpl = null;
    logErrorMock.mockClear();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  afterEach(async () => {
    vi.useRealTimers();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('main/index.ts wiring', () => {
    const indexSource = readFileSync(
      fileURLToPath(new URL('../src/main/index.ts', import.meta.url)),
      'utf-8'
    );

    function functionBody(signature: string): string {
      const start = indexSource.indexOf(signature);
      expect(start, `${signature} not found in main/index.ts`).toBeGreaterThanOrEqual(0);
      const next = indexSource.indexOf('\n}\n', start);
      return indexSource.slice(start, next);
    }

    it('shuts the boot instance down in the full quit cleanup, before any slow await, and waits for it before closing logs', () => {
      const cleanup = functionBody('async function cleanupSandboxResources(): Promise<void> {');
      const call = cleanup.indexOf('shutdownFleetBridgeForQuit(fleetBridge)');
      const firstAwait = cleanup.indexOf('await ');
      const awaitsClose = cleanup.search(/await\s+fleetBridgeClosing/);

      expect(call).toBeGreaterThan(cleanup.indexOf('isCleaningUp = true'));
      expect(call).toBeLessThan(firstAwait);
      expect(awaitsClose).toBeGreaterThan(call);
      expect(awaitsClose).toBeLessThan(cleanup.indexOf('closeLogFile()'));
    });

    it('also disarms the bridge on the dev fast quit path', () => {
      const beforeQuit = indexSource.slice(indexSource.indexOf("app.on('before-quit'"));
      const devPath = beforeQuit.slice(
        beforeQuit.indexOf('if (process.env.VITE_DEV_SERVER_URL) {'),
        beforeQuit.indexOf('return;')
      );

      expect(devPath).toContain('shutdownFleetBridgeForQuit(fleetBridge)');
    });

    it('never reaches for the FleetBridge module singleton', () => {
      expect(indexSource).not.toMatch(/getFleetBridge\s*\(/);
      expect(indexSource).toMatch(
        /import \{[^}]*\bshutdownFleetBridgeForQuit\b[^}]*\} from '\.\/fleet\/fleet-bridge-lifecycle';/
      );
    });

    it('stops peer discovery at the start of the full quit cleanup, before any slow await', () => {
      const cleanup = functionBody('async function cleanupSandboxResources(): Promise<void> {');
      const stop = cleanup.indexOf('fleetDiscovery.stop()');

      expect(stop).toBeGreaterThan(cleanup.indexOf('isCleaningUp = true'));
      expect(stop).toBeLessThan(cleanup.indexOf('await '));
    });

    it('also stops peer discovery on the dev fast quit path', () => {
      const beforeQuit = indexSource.slice(indexSource.indexOf("app.on('before-quit'"));
      const devPath = beforeQuit.slice(
        beforeQuit.indexOf('if (process.env.VITE_DEV_SERVER_URL) {'),
        beforeQuit.indexOf('return;')
      );

      expect(devPath).toContain('fleetDiscovery.stop()');
    });

    it('schedules discovery through the stoppable schedule only, with the same cadence as before', () => {
      expect(indexSource).toMatch(
        /const fleetDiscovery = createFleetDiscoverySchedule\(runFleetDiscoveryPass, \{\s*firstDelayMs: 5_000,\s*intervalMs: DISCOVERY_INTERVAL_MS,?\s*\}\);/
      );
      expect(indexSource).toContain('const DISCOVERY_INTERVAL_MS = 5 * 60 * 1_000;');
      expect(indexSource).toContain('fleetDiscovery.start();');
      expect(indexSource).not.toContain('discoveryTimer');
      expect(indexSource).not.toMatch(/set(Timeout|Interval)\(\(\) => void runOnce/);
    });
  });

  describe('createFleetDiscoverySchedule', () => {
    const cadence = { firstDelayMs: 5_000, intervalMs: 300_000 };

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    });

    it('arms the first pass and the interval once, however often it is started', async () => {
      const pass = vi.fn(async () => {});
      const discovery = createFleetDiscoverySchedule(pass, cadence);

      discovery.start();
      discovery.start();
      expect(vi.getTimerCount()).toBe(2);

      await vi.advanceTimersByTimeAsync(5_000);
      expect(pass).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(300_000);
      expect(pass).toHaveBeenCalledTimes(2);
      discovery.stop();
    });

    it('cancels the pending first pass and the interval when quit comes early', async () => {
      const pass = vi.fn(async () => {});
      const discovery = createFleetDiscoverySchedule(pass, cadence);
      discovery.start();

      discovery.stop();

      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(30 * 60_000);
      expect(pass).not.toHaveBeenCalled();
    });

    it('keeps a pass already running at quit from publishing its result', async () => {
      const released = { resolve: () => {} };
      const published: string[] = [];
      const discovery = createFleetDiscoverySchedule(async (isActive) => {
        await new Promise<void>((resolve) => {
          released.resolve = resolve;
        });
        if (isActive()) published.push('fleet.peer.discovered');
      }, cadence);
      discovery.start();
      await vi.advanceTimersByTimeAsync(5_000);

      discovery.stop();
      released.resolve();
      await vi.advanceTimersByTimeAsync(0);

      expect(published).toEqual([]);
    });

    it('is idempotent and final once stopped', () => {
      const pass = vi.fn(async () => {});
      const discovery = createFleetDiscoverySchedule(pass, cadence);
      discovery.start();

      discovery.stop();
      discovery.stop();
      discovery.start();

      expect(vi.getTimerCount()).toBe(0);
      expect(discovery.isRunning()).toBe(false);
    });

    it('survives a pass that throws, like the silent best-effort discovery it replaces', async () => {
      const pass = vi.fn(async () => {
        throw new Error('tailscale not installed');
      });
      const discovery = createFleetDiscoverySchedule(pass, cadence);
      discovery.start();

      await vi.advanceTimersByTimeAsync(305_000);

      expect(pass).toHaveBeenCalledTimes(2);
      discovery.stop();
    });
  });

  describe('shutdownFleetBridgeForQuit', () => {
    it('does nothing when boot never created a bridge, and creates no singleton', async () => {
      await expect(shutdownFleetBridgeForQuit(null)).resolves.toBe('no-bridge');

      expect(() => getFleetBridge()).toThrow('FleetBridge requires sendToRenderer on first init');
      expect(QuitFakeListener.instances).toHaveLength(0);
    });

    it('closes the sockets of the running bridge and no peer reconnects afterwards', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const bridge = await bridgeWithLiveAndDownPeers();
      const [hub] = QuitFakeListener.instances;

      await expect(shutdownFleetBridgeForQuit(bridge)).resolves.toBe('closed');
      expect(hub.disconnectCount).toBe(1);

      await vi.advanceTimersByTimeAsync(60_000);
      await flush();
      expect(QuitFakeListener.instances).toHaveLength(2);
      await expect(bridge.reconnectPeer('hub')).resolves.toEqual({
        success: false,
        error: 'Fleet bridge is stopped',
      });
      expect(QuitFakeListener.instances).toHaveLength(2);
    });

    it('shuts a bridge down once even when several quit paths ask', async () => {
      const shutdown = vi.fn().mockResolvedValue(undefined);
      const bridge = { shutdown } as unknown as FleetBridge;

      const [first, second] = await Promise.all([
        shutdownFleetBridgeForQuit(bridge),
        shutdownFleetBridgeForQuit(bridge),
      ]);
      const third = await shutdownFleetBridgeForQuit(bridge);

      expect([first, second, third]).toEqual(['closed', 'closed', 'closed']);
      expect(shutdown).toHaveBeenCalledTimes(1);
    });

    it('lets quit proceed when closing the sockets hangs, and still keeps peers from reconnecting', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const bridge = await bridgeWithLiveAndDownPeers();
      QuitFakeListener.disconnectImpl = () => new Promise<void>(() => {});

      const quitting = shutdownFleetBridgeForQuit(bridge);
      await vi.advanceTimersByTimeAsync(FLEET_BRIDGE_QUIT_TIMEOUT_MS);

      await expect(quitting).resolves.toBe('timed-out');
      expect(logErrorMock).toHaveBeenCalledWith(expect.stringContaining('timed out'));
      await vi.advanceTimersByTimeAsync(60_000);
      await flush();
      expect(QuitFakeListener.instances).toHaveLength(2);
    });

    it('reports a failing shutdown instead of throwing into the quit sequence', async () => {
      const bridge = {
        shutdown: vi.fn().mockRejectedValue(new Error('socket already destroyed')),
      } as unknown as FleetBridge;

      await expect(shutdownFleetBridgeForQuit(bridge)).resolves.toBe('failed');
      expect(logErrorMock).toHaveBeenCalledWith(
        expect.stringContaining('shutdown failed'),
        expect.any(Error)
      );
    });

    it('starts every socket teardown at once, so one hanging socket cannot keep the others open', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      QuitFakeListener.connectImpl = (listener) => authenticate(listener);
      const bridge = new FleetBridge(() => {});
      await bridge.init();
      for (const label of ['hub', 'relay', 'spoke']) {
        await bridge.addPeer({ url: `ws://203.0.113.10:3000/ws#${label}`, apiKey: 'k', label });
      }
      await flush();
      const [hub, relay, spoke] = QuitFakeListener.instances;
      QuitFakeListener.disconnectImpl = (listener) =>
        listener === hub ? new Promise<void>(() => {}) : Promise.resolve();

      const quitting = shutdownFleetBridgeForQuit(bridge);
      expect([hub, relay, spoke].map((listener) => listener.disconnectCount)).toEqual([1, 1, 1]);
      await vi.advanceTimersByTimeAsync(FLEET_BRIDGE_QUIT_TIMEOUT_MS);

      await expect(quitting).resolves.toBe('timed-out');
      await expect(bridge.reconnectPeer('relay')).resolves.toEqual({
        success: false,
        error: 'Fleet bridge is stopped',
      });
      expect(QuitFakeListener.instances).toHaveLength(3);
    });

    it('clears its timer once the bridge has closed', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const bridge = { shutdown: vi.fn().mockResolvedValue(undefined) } as unknown as FleetBridge;

      await expect(shutdownFleetBridgeForQuit(bridge)).resolves.toBe('closed');

      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
