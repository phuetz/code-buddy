/**
 * list_peers tool tests — Phase (d).17.
 *
 * Verifies the read-only projection of FleetRegistry state.
 * No real WS — just feed the mocked registry.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { executeListPeers, type ListedPeer } from '../../src/tools/list-peers-tool.js';
import {
  getFleetRegistry,
  _resetFleetRegistryForTests,
  type ActiveListenerEntry,
  type FleetListenerPublicAPI,
} from '../../src/fleet/fleet-registry.js';

interface ListenerStubOptions {
  lastSeenAgeMs?: number | null;
  lastSeenReason?: string | null;
  compactionActive?: boolean;
  stale?: boolean;
  request?: FleetListenerPublicAPI['request'];
}

function makeStubListener(opts: ListenerStubOptions = {}): FleetListenerPublicAPI {
  return {
    disconnect: async () => undefined,
    getReconnectAttempts: () => 0,
    isReconnecting: () => false,
    request: opts.request ?? (async () => ({})),
    getLastSeen: () => ({
      at: opts.lastSeenAgeMs != null ? Date.now() - opts.lastSeenAgeMs : null,
      reason: opts.lastSeenReason ?? null,
      ageMs: opts.lastSeenAgeMs ?? null,
    }),
    isStale: () => opts.stale ?? false,
    getPeerCompactionState: () => ({
      active: opts.compactionActive ?? false,
      startedAt: null,
      ageMs: null,
      lastResult: null,
    }),
    getEventHistory: () => [],
  };
}

function registerPeer(id: string, opts: ListenerStubOptions = {}): ActiveListenerEntry {
  const entry: ActiveListenerEntry = {
    id,
    url: `ws://example/${id}`,
    startedAt: new Date('2026-05-08T10:00:00Z'),
    eventCount: 5,
    autoReconnect: false,
    maxAttempts: 5,
    listener: makeStubListener(opts),
  };
  getFleetRegistry().register(entry);
  return entry;
}

describe('list_peers tool', () => {
  beforeEach(() => {
    _resetFleetRegistryForTests();
  });

  it('returns success with empty array when no peers connected', async () => {
    const result = await executeListPeers();
    expect(result.success).toBe(true);
    expect(result.output).toContain('No fleet peers connected');
    const data = result.data as { peers: ListedPeer[] };
    expect(data.peers).toEqual([]);
  });

  it('lists multiple peers with full status', async () => {
    registerPeer('darkstar', {
      lastSeenAgeMs: 1500,
      lastSeenReason: 'heartbeat',
      compactionActive: false,
      stale: false,
    });
    registerPeer('ministar', {
      lastSeenAgeMs: 200,
      lastSeenReason: 'event',
      compactionActive: false,
      stale: false,
    });

    const result = await executeListPeers();
    expect(result.success).toBe(true);

    const data = result.data as { peers: ListedPeer[] };
    expect(data.peers).toHaveLength(2);

    const darkstar = data.peers.find((p) => p.id === 'darkstar')!;
    expect(darkstar.url).toBe('ws://example/darkstar');
    expect(darkstar.eventCount).toBe(5);
    expect(darkstar.lastSeenAgeMs).toBe(1500);
    expect(darkstar.lastSeenReason).toBe('heartbeat');
    expect(darkstar.compacting).toBe(false);
    expect(darkstar.stale).toBe(false);
    expect(darkstar.peerChatLikelyAvailable).toBe(true);
    expect(darkstar.connectedSince).toBe('2026-05-08T10:00:00.000Z');

    // Output is JSON-pretty.
    expect(typeof result.output).toBe('string');
    const parsed = JSON.parse(result.output as string);
    expect(parsed).toHaveLength(2);
  });

  it('marks compacting peer as not likely available', async () => {
    registerPeer('busy', {
      lastSeenAgeMs: 500,
      compactionActive: true,
    });
    const result = await executeListPeers();
    const data = result.data as { peers: ListedPeer[] };
    expect(data.peers[0].compacting).toBe(true);
    expect(data.peers[0].peerChatLikelyAvailable).toBe(false);
  });

  it('marks never-seen peer as not likely available', async () => {
    registerPeer('cold', { lastSeenAgeMs: null });
    const result = await executeListPeers();
    const data = result.data as { peers: ListedPeer[] };
    expect(data.peers[0].lastSeenAgeMs).toBeNull();
    expect(data.peers[0].peerChatLikelyAvailable).toBe(false);
  });

  it('reflects stale flag from listener', async () => {
    registerPeer('lagging', { lastSeenAgeMs: 200_000, stale: true });
    const result = await executeListPeers();
    const data = result.data as { peers: ListedPeer[] };
    expect(data.peers[0].stale).toBe(true);
  });

  it('optionally enriches peers with peer.describe provider capabilities', async () => {
    registerPeer('chatgpt-peer', {
      lastSeenAgeMs: 100,
      request: async (method) => {
        expect(method).toBe('peer.describe');
        return {
          peerChatProvider: {
            provider: 'chatgpt-oauth',
            model: 'gpt-5.1-codex',
            isLocal: false,
          },
          capabilities: {
            machineLabel: 'ministar',
            egress: 'cloud',
            models: [
              {
                id: 'gpt-5.1-codex',
                contextWindow: 200_000,
                strengths: ['reasoning', 'code'],
                provider: 'chatgpt-oauth',
              },
              {
                id: 'qwen3.6:35b',
                contextWindow: 32_000,
                strengths: ['reasoning', 'thinking'],
                provider: 'ollama',
              },
            ],
            maxConcurrency: 3,
            activeRequests: 1,
          },
        };
      },
    });

    const result = await executeListPeers({ includeCapabilities: true });
    expect(result.success).toBe(true);

    const data = result.data as { peers: ListedPeer[] };
    expect(data.peers[0].peerChatProvider).toEqual({
      provider: 'chatgpt-oauth',
      model: 'gpt-5.1-codex',
      isLocal: false,
    });
    expect(data.peers[0].capabilities).toMatchObject({
      machineLabel: 'ministar',
      egress: 'cloud',
      modelCount: 2,
      providers: ['chatgpt-oauth', 'ollama'],
      topModels: ['gpt-5.1-codex', 'qwen3.6:35b'],
      maxConcurrency: 3,
      activeRequests: 1,
    });
    expect(data.peers[0].capabilities?.strengths).toEqual([
      'code',
      'reasoning',
      'thinking',
    ]);
  });

  it('keeps the peer listed when peer.describe enrichment fails', async () => {
    registerPeer('listen-only', {
      lastSeenAgeMs: 100,
      request: async () => {
        throw new Error('FORBIDDEN: peer:invoke scope required');
      },
    });

    const result = await executeListPeers({ includeCapabilities: true });
    const data = result.data as { peers: ListedPeer[] };
    expect(data.peers[0].id).toBe('listen-only');
    expect(data.peers[0].describeError).toContain('peer:invoke');
  });
});
