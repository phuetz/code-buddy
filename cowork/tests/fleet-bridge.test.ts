import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';

const tmpDir = path.join(os.tmpdir(), `cowork-fleet-bridge-${Date.now()}`);

vi.mock('electron', () => ({
  app: {
    isReady: () => true,
    getPath: () => tmpDir,
  },
}));

vi.mock('../src/main/utils/logger', () => ({
  log: () => {},
  logWarn: () => {},
  logError: () => {},
}));

class FakeFleetListener extends EventEmitter {
  static instances: FakeFleetListener[] = [];
  /** Per-test override of connect(); the default authenticates on the next tick. */
  static connectImpl: ((listener: FakeFleetListener) => Promise<void>) | null = null;
  /** Per-test override of the socket teardown, e.g. to hold it open. */
  static disconnectImpl: ((listener: FakeFleetListener) => Promise<void>) | null = null;
  /** Per-test override of peer.describe, e.g. to answer late. */
  static describeImpl: ((listener: FakeFleetListener) => Promise<unknown>) | null = null;
  options: { url: string; apiKey?: string };
  connected = false;
  authenticated = false;
  requestCount = 0;
  disconnectCount = 0;

  constructor(options: { url: string; apiKey?: string }) {
    super();
    this.options = options;
    FakeFleetListener.instances.push(this);
  }

  async connect(): Promise<void> {
    if (FakeFleetListener.connectImpl) return FakeFleetListener.connectImpl(this);
    this.connected = true;
    setImmediate(() => {
      this.emit('connected');
      this.authenticated = true;
      this.emit('authenticated');
    });
  }

  async disconnect(): Promise<void> {
    this.disconnectCount += 1;
    if (FakeFleetListener.disconnectImpl) return FakeFleetListener.disconnectImpl(this);
    this.connected = false;
    this.authenticated = false;
    this.emit('disconnected');
  }

  async request(method: string): Promise<unknown> {
    if (method !== 'peer.describe') {
      throw new Error(`unexpected method: ${method}`);
    }
    // Mirrors the core listener: no RPC before authentication.
    if (!this.authenticated) {
      throw new Error('peer.invoke NOT_AUTHENTICATED: listener is not authenticated');
    }
    this.requestCount += 1;
    if (FakeFleetListener.describeImpl) return FakeFleetListener.describeImpl(this);
    return describeAnswer();
  }
}

function describeAnswer(machineLabel = 'Hub Linux'): Record<string, unknown> {
  return {
    peerChatProvider: {
      provider: 'chatgpt-oauth',
      model: 'gpt-5.1-codex',
      isLocal: false,
    },
    capabilities: {
      egress: 'cloud',
      machineLabel,
      models: [
        {
          id: 'gpt-5.1-codex',
          contextWindow: 200_000,
          strengths: ['reasoning', 'thinking', 'code'],
          provider: 'chatgpt-oauth',
        },
      ],
    },
  };
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

vi.mock('../src/main/utils/core-loader', () => ({
  loadCoreModule: vi.fn(async () => ({ FleetListener: FakeFleetListener })),
}));

import { FleetBridge } from '../src/main/fleet/fleet-bridge';
import type { FleetPeer as FleetPeerUpdate, ServerEvent } from '../src/renderer/types';

const HUB_URL = 'ws://203.0.113.10:3000/ws';

async function flush(): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** Core listener shape of an unreachable peer: error, close, then a rejected connect(). */
function refuse(listener: FakeFleetListener): Promise<void> {
  const err = new Error('connect ECONNREFUSED 203.0.113.10:3000');
  listener.emit('error', err);
  listener.emit('disconnected');
  return Promise.reject(err);
}

/** Core listener shape of a successful handshake: connect() resolves after `authenticated`. */
function authenticate(listener: FakeFleetListener): Promise<void> {
  listener.connected = true;
  listener.emit('connected');
  listener.authenticated = true;
  listener.emit('authenticated');
  return Promise.resolve();
}

describe('FleetBridge', () => {
  beforeEach(async () => {
    FakeFleetListener.instances = [];
    FakeFleetListener.connectImpl = null;
    FakeFleetListener.disconnectImpl = null;
    FakeFleetListener.describeImpl = null;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('addPeer persists, connects, and emits authenticated peer.update', async () => {
    const events: ServerEvent[] = [];
    const bridge = new FleetBridge((e) => events.push(e));
    await bridge.init();

    const result = await bridge.addPeer({
      url: 'ws://203.0.113.10:3000/ws',
      apiKey: 'test-key',
      label: 'Hub Linux',
    });
    expect(result.success).toBe(true);
    expect(result.peer?.id).toBe('hub-linux');

    // Wait for the listener event chain
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    const updates = events.filter((e) => e.type === 'fleet.peer.update');
    expect(updates.length).toBeGreaterThanOrEqual(2);
    const last = updates[updates.length - 1];
    expect(last.payload.peer.status).toBe('authenticated');

    // Persistence
    const raw = await fs.readFile(
      path.join(tmpDir, 'fleet-peers.json'),
      'utf-8'
    );
    const parsed = JSON.parse(raw);
    expect(parsed.peers[0].url).toBe('ws://203.0.113.10:3000/ws');
    expect(parsed.peers[0].apiKey).toBe('test-key');
  });

  it('refreshes peer.describe capabilities for Cowork routing and display', async () => {
    const events: ServerEvent[] = [];
    const bridge = new FleetBridge((e) => events.push(e));
    await bridge.init();

    const result = await bridge.addPeer({
      url: 'ws://203.0.113.10:3000/ws',
      apiKey: 'test-key',
      label: 'Hub Linux',
    });
    expect(result.success).toBe(true);

    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    const peers = await bridge.listPeers();
    expect(peers[0].peerChatProvider).toEqual({
      provider: 'chatgpt-oauth',
      model: 'gpt-5.1-codex',
      isLocal: false,
    });
    expect(peers[0].capability).toMatchObject({
      egress: 'cloud',
      machineLabel: 'Hub Linux',
      models: [
        {
          id: 'gpt-5.1-codex',
          provider: 'chatgpt-oauth',
        },
      ],
    });

    const updates = events.filter((e) => e.type === 'fleet.peer.update');
    expect(
      updates.some((e) => Boolean(e.payload.peer.capability?.models.length)),
    ).toBe(true);

    const listener = FakeFleetListener.instances[0];
    const requestCountBeforeManualRefresh = listener.requestCount;
    const refreshed = await bridge.refreshCapabilities(peers[0].id);
    expect(refreshed.success).toBe(true);
    expect(refreshed.peer?.capability?.models[0].id).toBe('gpt-5.1-codex');
    expect(listener.requestCount).toBe(requestCountBeforeManualRefresh + 1);
  });

  it('forwards fleet:event payloads as fleet.event ServerEvents', async () => {
    const events: ServerEvent[] = [];
    const bridge = new FleetBridge((e) => events.push(e));
    await bridge.init();

    await bridge.addPeer({
      url: 'ws://example/ws',
      apiKey: 'k',
      label: 'spoke-1',
    });
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    const listener = FakeFleetListener.instances[0];
    listener.emit('fleet:event', {
      type: 'fleet:agent:tool_started',
      payload: {
        toolName: 'view_file',
        source: { hostname: 'hub', agentId: 'agent-1' },
      },
    });

    await new Promise((r) => setImmediate(r));
    const fleetEvents = events.filter((e) => e.type === 'fleet.event');
    expect(fleetEvents).toHaveLength(1);
    expect(fleetEvents[0].payload.type).toBe('fleet:agent:tool_started');
    expect(fleetEvents[0].payload.hostname).toBe('hub');
  });

  it('tracks chat-session metadata on the peer without adding content to peer state', async () => {
    const events: ServerEvent[] = [];
    const activityFeed = { record: vi.fn() };
    const bridge = new FleetBridge((e) => events.push(e), activityFeed as never);
    await bridge.init();

    await bridge.addPeer({
      url: 'ws://example/ws',
      apiKey: 'k',
      label: 'spoke-1',
    });
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    const listener = FakeFleetListener.instances[0];
    listener.emit('fleet:event', {
      type: 'fleet:chat-session:start',
      payload: {
        sessionId: 'sess_review_123456',
        model: 'gpt-5.1-codex',
        dispatchProfile: 'review',
        source: { hostname: 'hub' },
      },
    });
    listener.emit('fleet:event', {
      type: 'fleet:chat-session:turn',
      payload: {
        sessionId: 'sess_review_123456',
        turnCount: 2,
        prompt: 'must not be kept',
        content: 'must not be kept either',
        source: { hostname: 'hub' },
      },
    });

    await new Promise((r) => setImmediate(r));

    const peers = await bridge.listPeers();
    expect(peers[0].chatSessions).toEqual([
      expect.objectContaining({
        sessionId: 'sess_review_123456',
        model: 'gpt-5.1-codex',
        dispatchProfile: 'review',
        turnCount: 2,
      }),
    ]);
    expect(JSON.stringify(peers[0].chatSessions)).not.toContain('must not be kept');
    expect(activityFeed.record).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'fleet.chatSession.started',
        metadata: expect.objectContaining({
          peerId: 'spoke-1',
          sessionId: 'sess_review_123456',
          dispatchProfile: 'review',
          model: 'gpt-5.1-codex',
        }),
      }),
    );
    expect(activityFeed.record).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'fleet.chatSession.turn',
        metadata: expect.objectContaining({
          turnCount: 2,
        }),
      }),
    );
    expect(JSON.stringify(activityFeed.record.mock.calls)).not.toContain('must not be kept');

    listener.emit('fleet:event', {
      type: 'fleet:chat-session:end',
      payload: { sessionId: 'sess_review_123456', reason: 'end' },
    });
    await new Promise((r) => setImmediate(r));
    const afterEnd = await bridge.listPeers();
    expect(afterEnd[0].chatSessions).toEqual([]);
    expect(activityFeed.record).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'fleet.chatSession.ended',
        metadata: expect.objectContaining({
          reason: 'end',
        }),
      }),
    );
  });

  it('removePeer disconnects listener and clears persisted entry', async () => {
    const events: ServerEvent[] = [];
    const bridge = new FleetBridge((e) => events.push(e));
    await bridge.init();
    const added = await bridge.addPeer({ url: 'ws://x/ws', apiKey: 'k' });
    expect(added.success).toBe(true);
    const peerId = added.peer!.id;
    await new Promise((r) => setImmediate(r));

    const result = await bridge.removePeer(peerId);
    expect(result.success).toBe(true);
    const list = await bridge.listPeers();
    expect(list).toHaveLength(0);

    const raw = await fs.readFile(
      path.join(tmpDir, 'fleet-peers.json'),
      'utf-8'
    );
    expect(JSON.parse(raw).peers).toHaveLength(0);
  });

  it('addPeer rejects without apiKey or jwt', async () => {
    const bridge = new FleetBridge(() => {});
    await bridge.init();
    const result = await bridge.addPeer({ url: 'ws://x/ws' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('apiKey');
  });

  it('keeps capability load live from fleet:peer:heartbeat beacons', async () => {
    const events: ServerEvent[] = [];
    const bridge = new FleetBridge((e) => events.push(e));
    await bridge.init();

    await bridge.addPeer({ url: 'ws://example/ws', apiKey: 'k', label: 'spoke-1' });
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    // Populate capability via peer.describe first.
    const peersBefore = await bridge.listPeers();
    expect(peersBefore[0].capability).toBeDefined();
    expect(peersBefore[0].capability?.activeRequests).toBeUndefined();

    const listener = FakeFleetListener.instances[0];
    listener.emit('fleet:event', {
      type: 'fleet:peer:heartbeat',
      payload: { activeRequests: 3, maxConcurrency: 4, utilization: 0.75 },
    });
    await new Promise((r) => setImmediate(r));

    // The 30s beacon refreshed the load fields without waiting for the
    // next (interval-gated) peer.describe.
    const peersAfter = await bridge.listPeers();
    expect(peersAfter[0].capability?.activeRequests).toBe(3);
    expect(peersAfter[0].capability?.maxConcurrency).toBe(4);

    // Idle beacon brings it back down.
    listener.emit('fleet:event', {
      type: 'fleet:peer:heartbeat',
      payload: { activeRequests: 0, maxConcurrency: 4 },
    });
    await new Promise((r) => setImmediate(r));
    const peersIdle = await bridge.listPeers();
    expect(peersIdle[0].capability?.activeRequests).toBe(0);
  });

  describe('connection loss and recovery', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('keeps a refused key visible after the server drops the socket, and does not retry it', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      FakeFleetListener.connectImpl = async (listener) => {
        listener.emit('connected');
        const err = Object.assign(new Error('Invalid credentials'), { code: 'AUTH_FAILED' });
        listener.emit('error', err);
        throw err;
      };
      const bridge = new FleetBridge(() => {}, null, { recoveryDelaysMs: [1_000] });
      await bridge.init();
      await bridge.addPeer({ url: HUB_URL, apiKey: 'wrong-key', label: 'hub' });
      await flush();

      // The server leaves the unauthenticated socket open, then terminates it at its idle timeout.
      FakeFleetListener.instances[0].emit('disconnected');
      const [peer] = await bridge.listPeers();

      expect(peer.lastError).toBe('Invalid credentials');
      await vi.advanceTimersByTimeAsync(60_000);
      await flush();
      expect(FakeFleetListener.instances).toHaveLength(1);
    });

    it('does not replace the connection cause with a peer.describe failure when the panel lists peers', async () => {
      FakeFleetListener.connectImpl = (listener) => refuse(listener);
      const bridge = new FleetBridge(() => {}, null, { recoveryDelaysMs: [60_000] });
      await bridge.init();
      await bridge.addPeer({ url: HUB_URL, apiKey: 'k', label: 'hub' });
      await flush();

      const [peer] = await bridge.listPeers();

      expect(peer.status).toBe('error');
      expect(peer.lastError).toBe('connect ECONNREFUSED 203.0.113.10:3000');
      await bridge.shutdown();
    });

    it('retries a peer that was unreachable at startup and clears the cause once it answers', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      let attempts = 0;
      FakeFleetListener.connectImpl = (listener) => {
        attempts += 1;
        return attempts === 1 ? refuse(listener) : authenticate(listener);
      };
      const bridge = new FleetBridge(() => {}, null, { recoveryDelaysMs: [5_000] });
      await bridge.init();
      await bridge.addPeer({ url: HUB_URL, apiKey: 'k', label: 'hub' });
      await flush();
      expect((await bridge.listPeers())[0].status).toBe('error');

      await vi.advanceTimersByTimeAsync(5_000);
      await flush();

      const [peer] = await bridge.listPeers();
      expect(FakeFleetListener.instances).toHaveLength(2);
      expect(FakeFleetListener.instances[0].disconnectCount).toBe(1);
      expect(peer.status).toBe('authenticated');
      expect(peer.lastError).toBeUndefined();
      await bridge.shutdown();
    });

    it('surfaces an abandoned auto-reconnect with its cause and keeps recovering at the bridge level', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      FakeFleetListener.connectImpl = (listener) => authenticate(listener);
      const bridge = new FleetBridge(() => {}, null, { recoveryDelaysMs: [5_000] });
      await bridge.init();
      await bridge.addPeer({ url: HUB_URL, apiKey: 'k', label: 'hub' });
      await flush();

      const first = FakeFleetListener.instances[0];
      first.authenticated = false;
      first.emit('error', new Error('connect ECONNREFUSED 203.0.113.10:3000'));
      first.emit('disconnected');
      first.emit('reconnecting', { attempt: 10, delayMs: 60_000 });
      first.emit('exhausted', { totalAttempts: 10 });

      let [peer] = await bridge.listPeers();
      expect(peer.status).toBe('error');
      expect(peer.lastError).toContain('10 attempts');
      expect(peer.lastError).toContain('ECONNREFUSED');

      await vi.advanceTimersByTimeAsync(5_000);
      await flush();

      [peer] = await bridge.listPeers();
      expect(FakeFleetListener.instances).toHaveLength(2);
      expect(peer.status).toBe('authenticated');
      expect(peer.lastError).toBeUndefined();
      await bridge.shutdown();
    });

    it('shares one attempt between concurrent reconnects and ignores the replaced listener', async () => {
      const events: ServerEvent[] = [];
      FakeFleetListener.connectImpl = (listener) => authenticate(listener);
      const bridge = new FleetBridge((e) => events.push(e));
      await bridge.init();
      await bridge.addPeer({ url: HUB_URL, apiKey: 'k', label: 'hub' });
      await flush();
      const initial = FakeFleetListener.instances[0];

      const results = await Promise.all([bridge.reconnectPeer('hub'), bridge.reconnectPeer('hub')]);
      await flush();

      expect(results).toEqual([{ success: true }, { success: true }]);
      expect(FakeFleetListener.instances).toHaveLength(2);
      const current = FakeFleetListener.instances[1];

      // Late signals from the torn-down socket must not repaint the live peer.
      initial.emit('disconnected');
      initial.emit('error', new Error('socket hang up'));
      events.length = 0;
      current.emit('fleet:event', { type: 'fleet:agent:tool_started', payload: {} });
      initial.emit('fleet:event', { type: 'fleet:agent:tool_started', payload: {} });

      const [peer] = await bridge.listPeers();
      expect(peer.status).toBe('authenticated');
      expect(peer.lastError).toBeUndefined();
      expect(events.filter((e) => e.type === 'fleet.event')).toHaveLength(1);
    });

    it('reports why a manual reconnect failed instead of a blind success', async () => {
      const bridge = new FleetBridge(() => {}, null, { recoveryDelaysMs: [60_000] });
      await bridge.init();
      await bridge.addPeer({ url: HUB_URL, apiKey: 'k', label: 'hub' });
      await flush();

      FakeFleetListener.connectImpl = (listener) => refuse(listener);
      const result = await bridge.reconnectPeer('hub');

      expect(result).toEqual({
        success: false,
        error: 'connect ECONNREFUSED 203.0.113.10:3000',
      });
      await bridge.shutdown();
    });

    it('explains that a single-peer capability refresh needs a live connection', async () => {
      FakeFleetListener.connectImpl = (listener) => refuse(listener);
      const bridge = new FleetBridge(() => {}, null, { recoveryDelaysMs: [60_000] });
      await bridge.init();
      await bridge.addPeer({ url: HUB_URL, apiKey: 'k', label: 'hub' });
      await flush();

      const result = await bridge.refreshCapabilities('hub');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not connected');
      expect(result.peer?.lastError).toBe('connect ECONNREFUSED 203.0.113.10:3000');
      expect(FakeFleetListener.instances[0].requestCount).toBe(0);
      await bridge.shutdown();
    });

    it('stops recovering a peer once it is removed or the bridge shuts down', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      FakeFleetListener.connectImpl = (listener) => refuse(listener);
      const bridge = new FleetBridge(() => {}, null, { recoveryDelaysMs: [1_000] });
      await bridge.init();
      await bridge.addPeer({ url: HUB_URL, apiKey: 'k', label: 'hub' });
      await bridge.addPeer({ url: 'ws://203.0.113.11:3000/ws', apiKey: 'k', label: 'spoke' });
      await flush();
      expect(FakeFleetListener.instances).toHaveLength(2);

      await bridge.removePeer('hub');
      await bridge.shutdown();
      await vi.advanceTimersByTimeAsync(10_000);
      await flush();

      expect(FakeFleetListener.instances).toHaveLength(2);
    });
  });

  describe('shutdown with an attempt in flight', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('opens no socket when shutdown lands while the listener module is loading', async () => {
      FakeFleetListener.connectImpl = (listener) => authenticate(listener);
      const bridge = new FleetBridge(() => {});
      await bridge.init();
      await bridge.addPeer({ url: HUB_URL, apiKey: 'k', label: 'hub' });
      await flush();

      // Suspended on `await loadFleetModule()` when shutdown starts.
      const attempt = bridge.reconnectPeer('hub');
      await bridge.shutdown();
      const result = await attempt;
      await flush();

      expect(FakeFleetListener.instances).toHaveLength(1);
      expect(result.success).toBe(false);
    });

    it('opens no socket when shutdown lands while the previous socket is still closing', async () => {
      FakeFleetListener.connectImpl = (listener) => authenticate(listener);
      const bridge = new FleetBridge(() => {});
      await bridge.init();
      await bridge.addPeer({ url: HUB_URL, apiKey: 'k', label: 'hub' });
      await flush();

      const closing = deferred();
      FakeFleetListener.disconnectImpl = () => closing.promise;
      const attempt = bridge.reconnectPeer('hub');
      await flush();
      expect(FakeFleetListener.instances[0].disconnectCount).toBe(1);

      const stopping = bridge.shutdown();
      closing.resolve();
      await stopping;
      const result = await attempt;
      await flush();

      expect(FakeFleetListener.instances).toHaveLength(1);
      expect(result.success).toBe(false);
    });

    it('refuses to reconnect a peer after shutdown', async () => {
      FakeFleetListener.connectImpl = (listener) => authenticate(listener);
      const bridge = new FleetBridge(() => {});
      await bridge.init();
      await bridge.addPeer({ url: HUB_URL, apiKey: 'k', label: 'hub' });
      await flush();
      await bridge.shutdown();

      const result = await bridge.reconnectPeer('hub');

      expect(result).toEqual({ success: false, error: 'Fleet bridge is stopped' });
      expect(FakeFleetListener.instances).toHaveLength(1);
    });

    it('neither repaints nor retries a handshake that fails after shutdown', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const handshake = deferred();
      FakeFleetListener.connectImpl = () => handshake.promise;
      const events: ServerEvent[] = [];
      const bridge = new FleetBridge((e) => events.push(e), null, { recoveryDelaysMs: [1_000] });
      await bridge.init();
      await bridge.addPeer({ url: HUB_URL, apiKey: 'k', label: 'hub' });
      await flush();

      events.length = 0;
      const stopping = bridge.shutdown();
      handshake.reject(new Error('Connection closed before authentication'));
      await stopping;
      await vi.advanceTimersByTimeAsync(10_000);
      await flush();

      expect(FakeFleetListener.instances).toHaveLength(1);
      expect(events).toEqual([]);
    });
  });

  describe('late peer.describe answers', () => {
    function lastPeerUpdate(events: ServerEvent[]): FleetPeerUpdate {
      const updates = events.filter(
        (e): e is Extract<ServerEvent, { type: 'fleet.peer.update' }> =>
          e.type === 'fleet.peer.update'
      );
      return updates[updates.length - 1].payload.peer;
    }

    it('keeps a newer AUTH_FAILED when the previous session answers peer.describe late', async () => {
      const answer = deferred<unknown>();
      FakeFleetListener.describeImpl = () => answer.promise;
      FakeFleetListener.connectImpl = (listener) => authenticate(listener);
      const events: ServerEvent[] = [];
      const bridge = new FleetBridge((e) => events.push(e), null, { recoveryDelaysMs: [60_000] });
      await bridge.init();
      await bridge.addPeer({ url: HUB_URL, apiKey: 'k', label: 'hub' });
      await flush();
      const listener = FakeFleetListener.instances[0];
      expect(listener.requestCount).toBe(1);

      listener.authenticated = false;
      listener.emit(
        'error',
        Object.assign(new Error('Invalid credentials'), { code: 'AUTH_FAILED' })
      );
      answer.resolve(describeAnswer());
      await flush();

      const peer = lastPeerUpdate(events);
      expect(peer.status).toBe('error');
      expect(peer.lastError).toBe('Invalid credentials');
      expect(peer.capability).toBeUndefined();
      await bridge.shutdown();
    });

    it('ignores a stale peer.describe failure that arrives after the peer reconnected', async () => {
      const answers: Array<ReturnType<typeof deferred<unknown>>> = [];
      FakeFleetListener.describeImpl = () => {
        const answer = deferred<unknown>();
        answers.push(answer);
        return answer.promise;
      };
      FakeFleetListener.connectImpl = (listener) => authenticate(listener);
      const events: ServerEvent[] = [];
      const bridge = new FleetBridge((e) => events.push(e));
      await bridge.init();
      await bridge.addPeer({ url: HUB_URL, apiKey: 'k', label: 'hub' });
      await flush();
      const listener = FakeFleetListener.instances[0];
      expect(answers).toHaveLength(1);

      // The socket drops and the core reconnects on its own before the first answer settles.
      listener.authenticated = false;
      listener.emit('disconnected');
      listener.emit('reconnecting', { attempt: 1, delayMs: 1_000 });
      listener.authenticated = true;
      listener.emit('authenticated');
      listener.emit('reconnected', { attempt: 1 });
      for (const fresh of answers.slice(1)) {
        fresh.resolve(describeAnswer('Hub Linux (reconnected)'));
      }
      await flush();
      answers[0].reject(new Error('peer.invoke TIMEOUT: peer.describe timed out'));
      await flush();

      const peer = lastPeerUpdate(events);
      expect(peer.status).toBe('authenticated');
      expect(peer.lastError).toBeUndefined();
      expect(peer.capability?.machineLabel).toBe('Hub Linux (reconnected)');
      await bridge.shutdown();
    });
  });
});
