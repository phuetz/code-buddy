/**
 * Phase (d).13 V0.4.1 — peer-rpc server-side dispatcher tests.
 *
 * Validates the registry (register / unregister / list / reset),
 * built-in methods (peer.describe, peer.ping, peer.echo), and
 * dispatchPeerRequest's error envelopes.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  registerPeerMethod,
  unregisterPeerMethod,
  listPeerMethods,
  dispatchPeerRequest,
  _resetPeerRpcForTests,
  getPeerRole,
  type PeerMethodContext,
} from '../../src/server/websocket/peer-rpc.js';

const ctx: PeerMethodContext = {
  connectionId: 'ws_test_123',
  scopes: ['peer:invoke', 'fleet:listen'],
  traceId: '',
  depth: 0,
};

describe('peer-rpc — Phase (d).13', () => {
  beforeEach(() => {
    _resetPeerRpcForTests();
  });

  describe('registry', () => {
    it('exposes the built-in methods after reset', () => {
      const methods = listPeerMethods();
      expect(methods).toContain('peer.describe');
      expect(methods).toContain('peer.ping');
      expect(methods).toContain('peer.dispatch');
      expect(methods).toContain('peer.dispatchStatus');
      expect(methods).toContain('peer.dispatchClear');
      expect(methods).toContain('peer.echo');
    });

    it('register adds a new method (last-wins on re-register)', () => {
      registerPeerMethod('test.first', async () => ({ first: true }));
      expect(listPeerMethods()).toContain('test.first');

      registerPeerMethod('test.first', async () => ({ second: true }));
      expect(listPeerMethods().filter((m) => m === 'test.first')).toHaveLength(1);
    });

    it('unregister removes a method', () => {
      registerPeerMethod('temp', async () => 'x');
      expect(listPeerMethods()).toContain('temp');
      unregisterPeerMethod('temp');
      expect(listPeerMethods()).not.toContain('temp');
    });
  });

  describe('built-in methods', () => {
    it('peer.describe returns hostname + pid + methods + apiVersion', async () => {
      const r = await dispatchPeerRequest({ id: '1', method: 'peer.describe' }, ctx);
      expect(r.ok).toBe(true);
      expect(r.id).toBe('1');
      const payload = r.payload as { hostname: string; pid: number; methods: string[]; apiVersion: string };
      expect(typeof payload.hostname).toBe('string');
      expect(payload.hostname.length).toBeGreaterThan(0);
      expect(payload.pid).toBe(process.pid);
      expect(payload.methods).toContain('peer.describe');
      // apiVersion bumped d.13 → d.14 → d.15 → d.16 → d.17 (capabilities) → d.21 (chat-session).
      expect(payload.apiVersion).toBe('d.21');
    });

    it('peer.describe honors CODEBUDDY_FLEET_HOSTNAME env override', async () => {
      const orig = process.env.CODEBUDDY_FLEET_HOSTNAME;
      process.env.CODEBUDDY_FLEET_HOSTNAME = 'darkstar-test';
      try {
        const r = await dispatchPeerRequest({ id: '1', method: 'peer.describe' }, ctx);
        const payload = r.payload as { hostname: string };
        expect(payload.hostname).toBe('darkstar-test');
      } finally {
        if (orig === undefined) delete process.env.CODEBUDDY_FLEET_HOSTNAME;
        else process.env.CODEBUDDY_FLEET_HOSTNAME = orig;
      }
    });

    it('peer.ping returns { pong: true, serverTime }', async () => {
      const before = Date.now();
      const r = await dispatchPeerRequest({ id: '2', method: 'peer.ping' }, ctx);
      expect(r.ok).toBe(true);
      const payload = r.payload as { pong: boolean; serverTime: number };
      expect(payload.pong).toBe(true);
      expect(payload.serverTime).toBeGreaterThanOrEqual(before);
    });

    it('peer.echo returns { echoed: params }', async () => {
      const r = await dispatchPeerRequest(
        { id: '3', method: 'peer.echo', params: { hello: 'world', n: 42 } },
        ctx,
      );
      expect(r.ok).toBe(true);
      const payload = r.payload as { echoed: { hello: string; n: number } };
      expect(payload.echoed).toEqual({ hello: 'world', n: 42 });
    });

    it('peer.echo with no params returns { echoed: {} }', async () => {
      const r = await dispatchPeerRequest({ id: '4', method: 'peer.echo' }, ctx);
      const payload = r.payload as { echoed: Record<string, unknown> };
      expect(payload.echoed).toEqual({});
    });
  });

  describe('dispatch error envelopes', () => {
    it('UNKNOWN_METHOD when method is not registered', async () => {
      const r = await dispatchPeerRequest({ id: '5', method: 'nope.gone' }, ctx);
      expect(r.ok).toBe(false);
      expect(r.id).toBe('5');
      expect(r.error?.code).toBe('UNKNOWN_METHOD');
      expect(r.error?.message).toContain('nope.gone');
    });

    it('INVALID_REQUEST when id is missing', async () => {
      const r = await dispatchPeerRequest(
        { id: '', method: 'peer.ping' },
        ctx,
      );
      expect(r.ok).toBe(false);
      expect(r.error?.code).toBe('INVALID_REQUEST');
    });

    it('INVALID_REQUEST when method is missing', async () => {
      const r = await dispatchPeerRequest({ id: '6', method: '' }, ctx);
      expect(r.ok).toBe(false);
      expect(r.error?.code).toBe('INVALID_REQUEST');
    });

    it('METHOD_ERROR when handler throws — captures the message', async () => {
      registerPeerMethod('boom', async () => {
        throw new Error('intentional handler boom');
      });
      const r = await dispatchPeerRequest({ id: '7', method: 'boom' }, ctx);
      expect(r.ok).toBe(false);
      expect(r.error?.code).toBe('METHOD_ERROR');
      expect(r.error?.message).toBe('intentional handler boom');
    });

    it('METHOD_ERROR when handler rejects with a non-Error value', async () => {
      registerPeerMethod('reject-string', async () => {
        return Promise.reject('string-rejection');
      });
      const r = await dispatchPeerRequest({ id: '8', method: 'reject-string' }, ctx);
      expect(r.ok).toBe(false);
      expect(r.error?.message).toBe('string-rejection');
    });
  });

  describe('handler context', () => {
    it('passes connectionId + scopes to the handler', async () => {
      let captured: PeerMethodContext | null = null;
      registerPeerMethod('inspect-ctx', async (_p, c) => {
        captured = c;
        return null;
      });
      await dispatchPeerRequest({ id: '9', method: 'inspect-ctx' }, ctx);
      // Phase (d).14 — ctx now includes traceId/depth, so deep equal
      // would fail (dispatcher generates a fresh traceId). Compare
      // selectively.
      expect(captured?.connectionId).toBe(ctx.connectionId);
      expect(captured?.scopes).toEqual(ctx.scopes);
    });

    it('passes the params dict verbatim (no mutation)', async () => {
      let captured: Record<string, unknown> | null = null;
      registerPeerMethod('inspect-params', async (p) => {
        captured = p;
        return null;
      });
      const params = { a: 1, b: 'two', c: { nested: true } };
      await dispatchPeerRequest({ id: '10', method: 'inspect-params', params }, ctx);
      expect(captured).toEqual(params);
    });
  });

  // ========================================================================
  // Phase (d).14 — role taxonomy + depth cap + trace propagation
  // ========================================================================
  describe('Phase (d).14 — depth cap + trace propagation', () => {
    it('peer.describe (Phase (d).14 → d.21) exposes role + maxDepth + apiVersion=d.21', async () => {
      const r = await dispatchPeerRequest({ id: 'd', method: 'peer.describe' }, ctx);
      expect(r.ok).toBe(true);
      const payload = r.payload as { apiVersion: string; role: string; maxDepth: number };
      expect(payload.apiVersion).toBe('d.21');
      expect(['main', 'orchestrator', 'leaf']).toContain(payload.role);
      expect(typeof payload.maxDepth).toBe('number');
    });

    it('generates a fresh traceId when frame omits it (top-level call)', async () => {
      let captured: PeerMethodContext | null = null;
      registerPeerMethod('inspect-trace', async (_p, c) => {
        captured = c;
        return null;
      });
      await dispatchPeerRequest({ id: 't1', method: 'inspect-trace' }, ctx);
      expect(captured?.traceId).toMatch(/^trace-[a-z0-9]+-[a-z0-9]+$/);
      expect(captured?.depth).toBe(0);
    });

    it('propagates the frame.traceId + depth verbatim to the handler ctx', async () => {
      let captured: PeerMethodContext | null = null;
      registerPeerMethod('inspect-trace', async (_p, c) => {
        captured = c;
        return null;
      });
      await dispatchPeerRequest(
        { id: 't2', method: 'inspect-trace', traceId: 'trace-custom-xyz', depth: 2 },
        ctx,
      );
      expect(captured?.traceId).toBe('trace-custom-xyz');
      expect(captured?.depth).toBe(2);
    });

    it('rejects with MAX_DEPTH_EXCEEDED when depth is past the cap (default 3)', async () => {
      const r = await dispatchPeerRequest(
        { id: 'd1', method: 'peer.ping', depth: 4 },
        ctx,
      );
      expect(r.ok).toBe(false);
      expect(r.error?.code).toBe('MAX_DEPTH_EXCEEDED');
      expect(r.error?.message).toContain('depth 4');
      expect(r.error?.message).toContain('max 3');
    });

    it('honors CODEBUDDY_PEER_MAX_DEPTH env override', async () => {
      const orig = process.env.CODEBUDDY_PEER_MAX_DEPTH;
      process.env.CODEBUDDY_PEER_MAX_DEPTH = '0';
      try {
        // depth=1 with cap=0 → exceeds
        const r = await dispatchPeerRequest(
          { id: 'd2', method: 'peer.ping', depth: 1 },
          ctx,
        );
        expect(r.ok).toBe(false);
        expect(r.error?.code).toBe('MAX_DEPTH_EXCEEDED');
        // depth=0 still allowed at cap=0
        const r2 = await dispatchPeerRequest(
          { id: 'd3', method: 'peer.ping', depth: 0 },
          ctx,
        );
        expect(r2.ok).toBe(true);
      } finally {
        if (orig === undefined) delete process.env.CODEBUDDY_PEER_MAX_DEPTH;
        else process.env.CODEBUDDY_PEER_MAX_DEPTH = orig;
      }
    });

    it('treats negative / NaN / non-numeric depth as 0 (defensive)', async () => {
      let captured: PeerMethodContext | null = null;
      registerPeerMethod('inspect-d', async (_p, c) => {
        captured = c;
        return null;
      });
      await dispatchPeerRequest(
        { id: 'd4', method: 'inspect-d', depth: -5 },
        ctx,
      );
      expect(captured?.depth).toBe(0);
      await dispatchPeerRequest(
        { id: 'd5', method: 'inspect-d', depth: NaN },
        ctx,
      );
      expect(captured?.depth).toBe(0);
    });

    it('floors fractional depth values', async () => {
      let captured: PeerMethodContext | null = null;
      registerPeerMethod('inspect-d', async (_p, c) => {
        captured = c;
        return null;
      });
      await dispatchPeerRequest(
        { id: 'd6', method: 'inspect-d', depth: 2.7 },
        ctx,
      );
      expect(captured?.depth).toBe(2);
    });
  });

  describe('Phase (d).14 — getPeerRole', () => {
    it('returns "main" by default', () => {
      const orig = process.env.CODEBUDDY_PEER_ROLE;
      delete process.env.CODEBUDDY_PEER_ROLE;
      try {
        expect(getPeerRole()).toBe('main');
      } finally {
        if (orig !== undefined) process.env.CODEBUDDY_PEER_ROLE = orig;
      }
    });

    it('returns the env value when it matches the union', () => {
      const orig = process.env.CODEBUDDY_PEER_ROLE;
      try {
        process.env.CODEBUDDY_PEER_ROLE = 'orchestrator';
        expect(getPeerRole()).toBe('orchestrator');
        process.env.CODEBUDDY_PEER_ROLE = 'leaf';
        expect(getPeerRole()).toBe('leaf');
        process.env.CODEBUDDY_PEER_ROLE = 'main';
        expect(getPeerRole()).toBe('main');
      } finally {
        if (orig === undefined) delete process.env.CODEBUDDY_PEER_ROLE;
        else process.env.CODEBUDDY_PEER_ROLE = orig;
      }
    });

    it('falls back to "main" for an unknown role string', () => {
      const orig = process.env.CODEBUDDY_PEER_ROLE;
      process.env.CODEBUDDY_PEER_ROLE = 'unknown-role-xyz';
      try {
        expect(getPeerRole()).toBe('main');
      } finally {
        if (orig === undefined) delete process.env.CODEBUDDY_PEER_ROLE;
        else process.env.CODEBUDDY_PEER_ROLE = orig;
      }
    });
  });
});
