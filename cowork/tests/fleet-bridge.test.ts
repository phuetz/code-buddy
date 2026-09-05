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
  options: { url: string; apiKey?: string };
  connected = false;
  requestCount = 0;

  constructor(options: { url: string; apiKey?: string }) {
    super();
    this.options = options;
    FakeFleetListener.instances.push(this);
  }

  async connect(): Promise<void> {
    this.connected = true;
    setImmediate(() => {
      this.emit('connected');
      this.emit('authenticated');
    });
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.emit('disconnected');
  }

  async request(method: string): Promise<unknown> {
    if (method !== 'peer.describe') {
      throw new Error(`unexpected method: ${method}`);
    }
    this.requestCount += 1;
    return {
      peerChatProvider: {
        provider: 'chatgpt-oauth',
        model: 'gpt-5.1-codex',
        isLocal: false,
      },
      capabilities: {
        egress: 'cloud',
        machineLabel: 'Hub Linux',
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
}

vi.mock('../src/main/utils/core-loader', () => ({
  loadCoreModule: vi.fn(async () => ({ FleetListener: FakeFleetListener })),
}));

import { FleetBridge } from '../src/main/fleet/fleet-bridge';
import type { ServerEvent } from '../src/renderer/types';

describe('FleetBridge', () => {
  beforeEach(async () => {
    FakeFleetListener.instances = [];
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
});
