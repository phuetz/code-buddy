/**
 * Phase (d).7 V0.4.1 — broadcast backpressure tests.
 *
 * Validates that broadcast() in src/server/websocket/handler.ts skips
 * clients whose ws.bufferedAmount exceeds the configured ceiling, that
 * per-client drop counters are maintained, and that getConnectionStats()
 * surfaces the cross-client total.
 *
 * The handler maintains a module-level `connections` Map. We use the
 * test-only hooks `_registerConnectionForTests` + `_resetConnectionsForTests`
 * to bypass the real ws auth handshake.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { WebSocket } from 'ws';

import {
  broadcast,
  getConnectionStats,
  _registerConnectionForTests,
  _resetConnectionsForTests,
} from '../../src/server/websocket/handler.js';
import { SERVER_CONFIG } from '../../src/config/constants.js';

/**
 * Minimal server-side ws stub. Only the surface broadcast() touches:
 * `bufferedAmount`, `readyState`, `send`. All other ws methods (close,
 * removeAllListeners, etc.) would only fire if a test triggers them
 * indirectly — none of these tests do.
 */
class FakeServerWS {
  readyState = 1; // OPEN
  bufferedAmount = 0;
  sent: string[] = [];
  send(data: string): void {
    this.sent.push(data);
  }
}

/** Build a ConnectionState matching the handler's init shape. */
function buildState(opts: {
  id: string;
  scopes?: string[];
  authenticated?: boolean;
}) {
  return {
    id: opts.id,
    authenticated: opts.authenticated ?? true,
    scopes: opts.scopes ?? ['fleet:listen'],
    lastActivity: Date.now(),
    streaming: false,
    authAttempts: 0,
    authWindowStart: Date.now(),
    messageCount: 0,
    messageWindowStart: Date.now(),
    toolCount: 0,
    toolWindowStart: Date.now(),
    peerRequestCount: 0,
    peerWindowStart: Date.now(),
    droppedBroadcasts: 0,
  };
}

describe('broadcast backpressure — Phase (d).7 V0.4.1', () => {
  beforeEach(() => {
    _resetConnectionsForTests();
    delete process.env.CODEBUDDY_FLEET_BROADCAST_BUFFER_LIMIT;
  });

  afterEach(() => {
    _resetConnectionsForTests();
    delete process.env.CODEBUDDY_FLEET_BROADCAST_BUFFER_LIMIT;
  });

  it('delivers to a client whose buffer is below the limit', () => {
    const ws = new FakeServerWS();
    _registerConnectionForTests(
      ws as unknown as WebSocket,
      buildState({ id: 'c1' }),
    );

    broadcast(
      { type: 'fleet:agent:tool_started', payload: { tool: 'view_file' } },
      'fleet:listen',
    );

    expect(ws.sent).toHaveLength(1);
    const decoded = JSON.parse(ws.sent[0]);
    expect(decoded.type).toBe('fleet:agent:tool_started');
    expect(getConnectionStats().totalBroadcastsDropped).toBe(0);
  });

  it('skips a client whose bufferedAmount exceeds the default limit', () => {
    const ws = new FakeServerWS();
    ws.bufferedAmount = SERVER_CONFIG.WS_BROADCAST_BUFFER_LIMIT + 1;
    const state = buildState({ id: 'slow' });
    _registerConnectionForTests(ws as unknown as WebSocket, state);

    broadcast(
      { type: 'fleet:agent:tool_started', payload: {} },
      'fleet:listen',
    );

    expect(ws.sent).toHaveLength(0);
    expect(state.droppedBroadcasts).toBe(1);
    expect(getConnectionStats().totalBroadcastsDropped).toBe(1);
  });

  it('only the saturated client is skipped — others still receive', () => {
    const slow = new FakeServerWS();
    slow.bufferedAmount = SERVER_CONFIG.WS_BROADCAST_BUFFER_LIMIT + 100;
    const free = new FakeServerWS();

    const slowState = buildState({ id: 'slow' });
    const freeState = buildState({ id: 'free' });
    _registerConnectionForTests(slow as unknown as WebSocket, slowState);
    _registerConnectionForTests(free as unknown as WebSocket, freeState);

    broadcast(
      { type: 'fleet:workflow:event', payload: { kind: 't' } },
      'fleet:listen',
    );

    expect(slow.sent).toHaveLength(0);
    expect(free.sent).toHaveLength(1);
    expect(slowState.droppedBroadcasts).toBe(1);
    expect(freeState.droppedBroadcasts).toBe(0);
    expect(getConnectionStats().totalBroadcastsDropped).toBe(1);
  });

  it('honors CODEBUDDY_FLEET_BROADCAST_BUFFER_LIMIT env override', () => {
    process.env.CODEBUDDY_FLEET_BROADCAST_BUFFER_LIMIT = '1000';
    const ws = new FakeServerWS();
    ws.bufferedAmount = 1500; // over the override, way under the default 2 MiB
    const state = buildState({ id: 'env-test' });
    _registerConnectionForTests(ws as unknown as WebSocket, state);

    broadcast({ type: 'fleet:agent:tool_started', payload: {} }, 'fleet:listen');

    expect(ws.sent).toHaveLength(0);
    expect(state.droppedBroadcasts).toBe(1);
  });

  it('scope filter short-circuits before backpressure check (no spurious drop count)', () => {
    // Lock the ordering: a client without the fleet:listen scope must be
    // skipped on scope grounds alone, not counted as a backpressure drop
    // even if its bufferedAmount happens to be over the limit.
    const ws = new FakeServerWS();
    ws.bufferedAmount = SERVER_CONFIG.WS_BROADCAST_BUFFER_LIMIT + 1;
    const state = buildState({ id: 'no-scope', scopes: ['chat'] });
    _registerConnectionForTests(ws as unknown as WebSocket, state);

    broadcast({ type: 'fleet:agent:tool_started', payload: {} }, 'fleet:listen');

    expect(ws.sent).toHaveLength(0);
    expect(state.droppedBroadcasts).toBe(0);
    expect(getConnectionStats().totalBroadcastsDropped).toBe(0);
  });

  it('counts repeated drops per client and aggregates across clients', () => {
    const slowA = new FakeServerWS();
    slowA.bufferedAmount = SERVER_CONFIG.WS_BROADCAST_BUFFER_LIMIT + 1;
    const slowB = new FakeServerWS();
    slowB.bufferedAmount = SERVER_CONFIG.WS_BROADCAST_BUFFER_LIMIT + 1;
    const stateA = buildState({ id: 'A' });
    const stateB = buildState({ id: 'B' });
    _registerConnectionForTests(slowA as unknown as WebSocket, stateA);
    _registerConnectionForTests(slowB as unknown as WebSocket, stateB);

    for (let i = 0; i < 5; i++) {
      broadcast({ type: 'fleet:agent:tool_started', payload: { i } }, 'fleet:listen');
    }

    expect(stateA.droppedBroadcasts).toBe(5);
    expect(stateB.droppedBroadcasts).toBe(5);
    expect(getConnectionStats().totalBroadcastsDropped).toBe(10);
  });
});
