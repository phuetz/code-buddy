/**
 * Phase (d).5 V0.4.1 — FleetListener client tests with mocked ws.
 *
 * Validates the connect/auth handshake, fleet:* event re-emission,
 * disconnect cleanup, and error paths.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// vi.hoisted runs before imports, so we can't use any imported value
// inside it. We hand-roll a minimal EventEmitter substitute here so the
// fake ws stays self-contained.
const wsMock = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => void;
  type FakeWS = {
    readonly url: string;
    readyState: number;
    sentMessages: string[];
    handlers: Map<string, Handler[]>;
    on(event: string, h: Handler): FakeWS;
    once(event: string, h: Handler): FakeWS;
    off(event: string, h: Handler): FakeWS;
    removeListener(event: string, h: Handler): FakeWS;
    emit(event: string, ...args: unknown[]): boolean;
    send(data: string): void;
    close(): void;
    open(): void;
    receive(msg: object): void;
    fail(err: Error): void;
  };

  const instances: FakeWS[] = [];

  class FakeWebSocket implements FakeWS {
    readyState = 0; // CONNECTING
    sentMessages: string[] = [];
    handlers = new Map<string, Handler[]>();
    constructor(public url: string) {
      instances.push(this);
    }
    on(event: string, h: Handler): this {
      const list = this.handlers.get(event) || [];
      list.push(h);
      this.handlers.set(event, list);
      return this;
    }
    once(event: string, h: Handler): this {
      const wrap: Handler = (...args) => {
        this.off(event, wrap);
        h(...args);
      };
      return this.on(event, wrap);
    }
    off(event: string, h: Handler): this {
      const list = this.handlers.get(event) || [];
      const i = list.indexOf(h);
      if (i >= 0) list.splice(i, 1);
      return this;
    }
    removeListener(event: string, h: Handler): this {
      return this.off(event, h);
    }
    emit(event: string, ...args: unknown[]): boolean {
      const list = [...(this.handlers.get(event) || [])];
      for (const h of list) h(...args);
      return list.length > 0;
    }
    send(data: string): void {
      this.sentMessages.push(data);
    }
    close(): void {
      this.readyState = 3; // CLOSED
      setImmediate(() => this.emit('close'));
    }
    open(): void {
      this.readyState = 1;
      this.emit('open');
    }
    receive(msg: object): void {
      this.emit('message', Buffer.from(JSON.stringify(msg)));
    }
    fail(err: Error): void {
      this.emit('error', err);
    }
  }
  return { FakeWebSocket, instances };
});

vi.mock('ws', () => ({
  WebSocket: wsMock.FakeWebSocket,
}));

import { FleetListener } from '../../src/fleet/fleet-listener.js';

describe('FleetListener — Phase (d).5 V0.4.1', () => {
  beforeEach(() => {
    wsMock.instances.length = 0;
  });

  afterEach(() => {
    wsMock.instances.length = 0;
  });

  describe('constructor', () => {
    it('throws without apiKey or jwt', () => {
      expect(
        () => new FleetListener({ url: 'ws://x/ws' }),
      ).toThrow(/requires apiKey or jwt/);
    });

    it('accepts apiKey', () => {
      expect(
        () => new FleetListener({ url: 'ws://x/ws', apiKey: 'k' }),
      ).not.toThrow();
    });

    it('accepts jwt', () => {
      expect(
        () => new FleetListener({ url: 'ws://x/ws', jwt: 't' }),
      ).not.toThrow();
    });
  });

  describe('connect handshake', () => {
    it('opens ws, sends authenticate after server connected msg, resolves on authenticated', async () => {
      const l = new FleetListener({ url: 'ws://peer/ws', apiKey: 'cb_sk_abc' });
      const connectPromise = l.connect();

      // Wait for the WebSocket constructor to be called
      await new Promise((r) => setImmediate(r));
      const fake = wsMock.instances[0];
      expect(fake).toBeDefined();
      expect(fake.url).toBe('ws://peer/ws');

      // Simulate server flow
      fake.open();
      await new Promise((r) => setImmediate(r));
      // Server sends 'connected' welcome
      fake.receive({ type: 'connected', payload: { connectionId: 'c1' } });
      await new Promise((r) => setImmediate(r));
      // Listener should have sent 'authenticate'
      expect(fake.sentMessages).toHaveLength(1);
      const sent = JSON.parse(fake.sentMessages[0]);
      expect(sent.type).toBe('authenticate');
      expect(sent.payload.apiKey).toBe('cb_sk_abc');

      // Server confirms auth
      fake.receive({ type: 'authenticated', payload: { keyId: 'k1', scopes: ['fleet:listen'] } });
      await connectPromise; // should resolve

      expect(l.isConnected()).toBe(true);
      expect(l.isAuthenticated()).toBe(true);

      await l.disconnect();
    });

    it('uses jwt token when provided', async () => {
      const l = new FleetListener({ url: 'ws://peer/ws', jwt: 'eyJ.test' });
      const connectPromise = l.connect();
      await new Promise((r) => setImmediate(r));
      const fake = wsMock.instances[0];

      fake.open();
      await new Promise((r) => setImmediate(r));
      fake.receive({ type: 'connected' });
      await new Promise((r) => setImmediate(r));
      const sent = JSON.parse(fake.sentMessages[0]);
      expect(sent.payload.token).toBe('eyJ.test');

      fake.receive({ type: 'authenticated', payload: {} });
      await connectPromise;
      await l.disconnect();
    });

    it('rejects on auth error', async () => {
      const l = new FleetListener({ url: 'ws://peer/ws', apiKey: 'bad' });
      const connectPromise = l.connect();
      await new Promise((r) => setImmediate(r));
      const fake = wsMock.instances[0];

      fake.open();
      await new Promise((r) => setImmediate(r));
      fake.receive({ type: 'connected' });
      await new Promise((r) => setImmediate(r));
      fake.receive({ type: 'error', error: { code: 'AUTH_FAILED', message: 'Invalid credentials' } });

      await expect(connectPromise).rejects.toThrow(/Invalid credentials/);
    });

    it('rejects on connection close before auth', async () => {
      const l = new FleetListener({ url: 'ws://peer/ws', apiKey: 'k' });
      const connectPromise = l.connect();
      await new Promise((r) => setImmediate(r));
      const fake = wsMock.instances[0];

      fake.open();
      await new Promise((r) => setImmediate(r));
      // Close before the server's 'connected' message
      fake.emit('close');

      await expect(connectPromise).rejects.toThrow(/closed before authentication/);
    });

    it('rejects on ws error event', async () => {
      const l = new FleetListener({ url: 'ws://bad/ws', apiKey: 'k' });
      const connectPromise = l.connect();
      await new Promise((r) => setImmediate(r));
      const fake = wsMock.instances[0];

      fake.fail(new Error('ECONNREFUSED'));
      await expect(connectPromise).rejects.toThrow(/ECONNREFUSED/);
    });
  });

  describe('fleet event re-emission', () => {
    async function authenticated() {
      const l = new FleetListener({ url: 'ws://peer/ws', apiKey: 'k' });
      const cp = l.connect();
      await new Promise((r) => setImmediate(r));
      const fake = wsMock.instances[0];
      fake.open();
      await new Promise((r) => setImmediate(r));
      fake.receive({ type: 'connected' });
      await new Promise((r) => setImmediate(r));
      fake.receive({ type: 'authenticated', payload: {} });
      await cp;
      return { l, fake };
    }

    it('re-emits fleet:agent:tool_started events', async () => {
      const { l, fake } = await authenticated();
      const events: unknown[] = [];
      l.on('fleet:agent:tool_started', (p) => events.push(p));

      fake.receive({
        type: 'fleet:agent:tool_started',
        payload: { toolName: 'view_file', source: { hostname: 'darkstar' } },
      });

      expect(events).toHaveLength(1);
      const payload = events[0] as { toolName: string };
      expect(payload.toolName).toBe('view_file');

      await l.disconnect();
    });

    it('re-emits all fleet:* events on the generic fleet:event channel', async () => {
      const { l, fake } = await authenticated();
      const all: Array<{ type: string; payload: Record<string, unknown> }> = [];
      l.on('fleet:event', (e) => all.push(e));

      fake.receive({ type: 'fleet:agent:tool_started', payload: { toolName: 'a' } });
      fake.receive({ type: 'fleet:workflow:start', payload: { goal: 'g' } });
      fake.receive({ type: 'fleet:session:spawn', payload: { childSessionId: 'c1' } });

      expect(all).toHaveLength(3);
      expect(all.map((e) => e.type)).toEqual([
        'fleet:agent:tool_started',
        'fleet:workflow:start',
        'fleet:session:spawn',
      ]);

      await l.disconnect();
    });

    it('emits disconnected event on close', async () => {
      const { l, fake } = await authenticated();
      const closed: boolean[] = [];
      l.on('disconnected', () => closed.push(true));

      fake.emit('close');
      expect(closed).toHaveLength(1);
    });

    it('emits error event on ws error post-auth', async () => {
      const { l, fake } = await authenticated();
      const errors: Error[] = [];
      l.on('error', (e: Error) => errors.push(e));

      fake.fail(new Error('something bad'));
      expect(errors.length).toBeGreaterThanOrEqual(1);

      await l.disconnect();
    });
  });

  describe('disconnect', () => {
    it('closes the ws and resolves', async () => {
      const l = new FleetListener({ url: 'ws://peer/ws', apiKey: 'k' });
      const cp = l.connect();
      await new Promise((r) => setImmediate(r));
      const fake = wsMock.instances[0];
      fake.open();
      await new Promise((r) => setImmediate(r));
      fake.receive({ type: 'connected' });
      await new Promise((r) => setImmediate(r));
      fake.receive({ type: 'authenticated', payload: {} });
      await cp;

      await l.disconnect();
      expect(fake.readyState).toBe(3);
    });

    it('is idempotent (no-op when not connected)', async () => {
      const l = new FleetListener({ url: 'ws://peer/ws', apiKey: 'k' });
      await expect(l.disconnect()).resolves.toBeUndefined();
    });
  });

  // ==========================================================================
  // Phase (d).6 — auto-reconnect with exponential backoff
  // ==========================================================================
  describe('auto-reconnect (Phase (d).6)', () => {
    /**
     * Drive a brand-new FakeWebSocket through the open → connected →
     * authenticated handshake. Used by every reconnect test to put the
     * listener in a "post-auth, ready to drop" state.
     */
    async function driveAuth(fake: ReturnType<typeof getWs>): Promise<void> {
      fake.open();
      await flush();
      fake.receive({ type: 'connected' });
      await flush();
      fake.receive({ type: 'authenticated', payload: {} });
    }

    function getWs(idx: number) {
      const fake = wsMock.instances[idx];
      if (!fake) throw new Error(`No ws at index ${idx} (have ${wsMock.instances.length})`);
      return fake;
    }

    /** Wait one microtask + one immediate tick. */
    function flush(): Promise<void> {
      return new Promise((r) => setImmediate(r));
    }

    it('reconnects after ws drop with backoff and emits reconnected', async () => {
      // Exclude setImmediate from fake timers — FakeWebSocket.close()
      // and our flush() helper rely on it firing on the real event loop.
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        const l = new FleetListener({
          url: 'ws://peer/ws',
          apiKey: 'k',
          autoReconnect: true,
          reconnect: { initialDelayMs: 100, maxDelayMs: 1000, jitterMs: 0 },
        });
        const reconnectingEvents: Array<{ attempt: number; delayMs: number }> = [];
        const reconnectedEvents: Array<{ attempt: number }> = [];
        l.on('reconnecting', (e) => reconnectingEvents.push(e));
        l.on('reconnected', (e) => reconnectedEvents.push(e));

        // Initial connect + auth
        const cp = l.connect();
        await flush();
        await driveAuth(getWs(0));
        await cp;
        expect(l.isAuthenticated()).toBe(true);

        // Spontaneous drop (not user-initiated)
        getWs(0).emit('close');
        await flush();

        // Manager should have scheduled a reconnect
        expect(l.isReconnecting()).toBe(true);
        expect(reconnectingEvents).toHaveLength(1);
        expect(reconnectingEvents[0].attempt).toBe(1);
        expect(reconnectingEvents[0].delayMs).toBe(100); // initial * 2^0, no jitter

        // Advance the timer: the connectFn fires, opens a new ws.
        await vi.advanceTimersByTimeAsync(150);
        // The new FakeWebSocket has been constructed at index 1
        await driveAuth(getWs(1));
        // Let the connectFn resolve and the manager's onConnected fire
        await flush();

        expect(reconnectedEvents).toHaveLength(1);
        expect(reconnectedEvents[0].attempt).toBe(1);
        expect(l.getReconnectAttempts()).toBe(0); // reset after onConnected
        expect(l.isReconnecting()).toBe(false);
        expect(l.isAuthenticated()).toBe(true);

        await l.disconnect();
      } finally {
        vi.useRealTimers();
      }
    });

    it('emits exhausted after max retries and stops trying', async () => {
      // Exclude setImmediate from fake timers — FakeWebSocket.close()
      // and our flush() helper rely on it firing on the real event loop.
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        const l = new FleetListener({
          url: 'ws://peer/ws',
          apiKey: 'k',
          autoReconnect: true,
          reconnect: { maxRetries: 2, initialDelayMs: 50, jitterMs: 0 },
        });
        const exhaustedEvents: Array<{ totalAttempts: number }> = [];
        l.on('exhausted', (e) => exhaustedEvents.push(e));

        const cp = l.connect();
        await flush();
        await driveAuth(getWs(0));
        await cp;

        // Drop #1 — schedules retry 1
        getWs(0).emit('close');
        await flush();
        await vi.advanceTimersByTimeAsync(100);
        // Retry 1 opens ws[1]; we drop it before auth → close handler
        // fires again → schedules retry 2
        getWs(1).open();
        await flush();
        getWs(1).emit('close');
        await flush();
        await vi.advanceTimersByTimeAsync(200);
        // Retry 2 opens ws[2]; drop it too → no more retries (cap=2),
        // exhausted should fire on the next schedule attempt
        getWs(2).open();
        await flush();
        getWs(2).emit('close');
        await flush();

        expect(exhaustedEvents).toHaveLength(1);
        expect(exhaustedEvents[0].totalAttempts).toBe(2);

        await l.disconnect();
      } finally {
        vi.useRealTimers();
      }
    });

    it('user disconnect cancels a pending reconnect timer', async () => {
      // Exclude setImmediate from fake timers — FakeWebSocket.close()
      // and our flush() helper rely on it firing on the real event loop.
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        const l = new FleetListener({
          url: 'ws://peer/ws',
          apiKey: 'k',
          autoReconnect: true,
          reconnect: { initialDelayMs: 5000, jitterMs: 0 },
        });
        const reconnectedEvents: Array<unknown> = [];
        l.on('reconnected', (e) => reconnectedEvents.push(e));

        const cp = l.connect();
        await flush();
        await driveAuth(getWs(0));
        await cp;

        // Drop — schedules retry in 5000ms
        getWs(0).emit('close');
        await flush();
        expect(l.isReconnecting()).toBe(true);
        const wsCountBefore = wsMock.instances.length;

        // User cancels mid-wait
        await l.disconnect();

        // Advance past the would-be retry window
        await vi.advanceTimersByTimeAsync(10_000);
        await flush();

        // No new ws should have been constructed
        expect(wsMock.instances.length).toBe(wsCountBefore);
        expect(reconnectedEvents).toHaveLength(0);
        expect(l.isReconnecting()).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it('resets the attempt counter after a successful reconnect', async () => {
      // Exclude setImmediate from fake timers — FakeWebSocket.close()
      // and our flush() helper rely on it firing on the real event loop.
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        const l = new FleetListener({
          url: 'ws://peer/ws',
          apiKey: 'k',
          autoReconnect: true,
          reconnect: { initialDelayMs: 50, jitterMs: 0 },
        });

        const cp = l.connect();
        await flush();
        await driveAuth(getWs(0));
        await cp;

        // First drop + reconnect
        getWs(0).emit('close');
        await flush();
        await vi.advanceTimersByTimeAsync(100);
        await driveAuth(getWs(1));
        await flush();
        expect(l.getReconnectAttempts()).toBe(0);

        // Second drop — counter should start from 1 again, not 2
        const reconnectingEvents: Array<{ attempt: number }> = [];
        l.on('reconnecting', (e) => reconnectingEvents.push(e));
        getWs(1).emit('close');
        await flush();
        expect(reconnectingEvents).toHaveLength(1);
        expect(reconnectingEvents[0].attempt).toBe(1);

        await l.disconnect();
      } finally {
        vi.useRealTimers();
      }
    });

    it('AUTH_FAILED during reconnect is terminal — no further retry', async () => {
      // Exclude setImmediate from fake timers — FakeWebSocket.close()
      // and our flush() helper rely on it firing on the real event loop.
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        const l = new FleetListener({
          url: 'ws://peer/ws',
          apiKey: 'k',
          autoReconnect: true,
          reconnect: { maxRetries: 5, initialDelayMs: 50, jitterMs: 0 },
        });
        const exhaustedEvents: unknown[] = [];
        const reconnectingEvents: unknown[] = [];
        l.on('exhausted', (e) => exhaustedEvents.push(e));
        l.on('reconnecting', (e) => reconnectingEvents.push(e));

        const cp = l.connect();
        await flush();
        await driveAuth(getWs(0));
        await cp;

        // Drop → schedules retry
        getWs(0).emit('close');
        await flush();
        expect(reconnectingEvents).toHaveLength(1);

        // Retry fires, opens ws[1], server returns AUTH_FAILED
        await vi.advanceTimersByTimeAsync(100);
        const ws1 = getWs(1);
        ws1.open();
        await flush();
        ws1.receive({ type: 'connected' });
        await flush();
        ws1.receive({
          type: 'error',
          error: { code: 'AUTH_FAILED', message: 'key revoked' },
        });
        await flush();
        // The ws would close server-side; simulate
        ws1.emit('close');
        await flush();

        // No new schedule should fire — userDisconnected was set by the
        // AUTH_FAILED branch.
        await vi.advanceTimersByTimeAsync(5000);
        await flush();

        // Only the original retry → no further reconnecting events
        expect(reconnectingEvents).toHaveLength(1);
        expect(exhaustedEvents).toHaveLength(0); // we cancelled, not exhausted
        // No third ws constructed
        expect(wsMock.instances.length).toBe(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it('default (autoReconnect off) preserves V0.4.1 behavior — no retry', async () => {
      // Exclude setImmediate from fake timers — FakeWebSocket.close()
      // and our flush() helper rely on it firing on the real event loop.
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        const l = new FleetListener({ url: 'ws://peer/ws', apiKey: 'k' });
        const reconnectingEvents: unknown[] = [];
        l.on('reconnecting', (e) => reconnectingEvents.push(e));

        const cp = l.connect();
        await flush();
        await driveAuth(getWs(0));
        await cp;

        getWs(0).emit('close');
        await flush();
        await vi.advanceTimersByTimeAsync(60_000);
        await flush();

        expect(reconnectingEvents).toHaveLength(0);
        expect(wsMock.instances.length).toBe(1);
        expect(l.getReconnectAttempts()).toBe(0);
        expect(l.isReconnecting()).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // ==========================================================================
  // Phase (d).9 — presence tracking (lastSeenAt + isStale)
  // ==========================================================================
  describe('presence tracking (Phase (d).9)', () => {
    async function authenticated() {
      const l = new FleetListener({ url: 'ws://peer/ws', apiKey: 'k' });
      const cp = l.connect();
      await new Promise((r) => setImmediate(r));
      const fake = wsMock.instances[0];
      fake.open();
      await new Promise((r) => setImmediate(r));
      fake.receive({ type: 'connected' });
      await new Promise((r) => setImmediate(r));
      fake.receive({ type: 'authenticated', payload: {} });
      await cp;
      return { l, fake };
    }

    it('getLastSeen() returns nulls before any fleet:* event is received', async () => {
      const { l } = await authenticated();
      const seen = l.getLastSeen();
      expect(seen.at).toBe(null);
      expect(seen.reason).toBe(null);
      expect(seen.ageMs).toBe(null);
      expect(l.isStale()).toBe(false); // unknown ≠ stale
      await l.disconnect();
    });

    it('records "heartbeat" reason on fleet:peer:heartbeat reception', async () => {
      const { l, fake } = await authenticated();
      const before = Date.now();
      fake.receive({ type: 'fleet:peer:heartbeat', payload: {} });
      const seen = l.getLastSeen();
      expect(seen.at).toBeGreaterThanOrEqual(before);
      expect(seen.reason).toBe('heartbeat');
      expect(seen.ageMs).toBeGreaterThanOrEqual(0);
      await l.disconnect();
    });

    it('records the event type as reason for non-heartbeat fleet events', async () => {
      const { l, fake } = await authenticated();
      fake.receive({ type: 'fleet:agent:tool_started', payload: { tool: 'view_file' } });
      const seen = l.getLastSeen();
      expect(seen.reason).toBe('fleet:agent:tool_started');
      expect(seen.at).not.toBe(null);
      await l.disconnect();
    });

    it('isStale(threshold) returns true once threshold has elapsed since last event', async () => {
      const { l, fake } = await authenticated();
      fake.receive({ type: 'fleet:peer:heartbeat', payload: {} });
      expect(l.isStale(50)).toBe(false); // just received

      // Age the listener by mocking Date.now without disturbing setImmediate
      const realNow = Date.now;
      const seenAt = l.getLastSeen().at!;
      try {
        Date.now = () => seenAt + 60; // 60ms after the event
        expect(l.isStale(50)).toBe(true);
        expect(l.isStale(100)).toBe(false);
      } finally {
        Date.now = realNow;
      }
      await l.disconnect();
    });
  });

  // ==========================================================================
  // Phase (d).10 — peer compaction state tracking
  // ==========================================================================
  describe('peer compaction state (Phase (d).10)', () => {
    async function authenticatedListener() {
      const l = new FleetListener({ url: 'ws://peer/ws', apiKey: 'k' });
      const cp = l.connect();
      await new Promise((r) => setImmediate(r));
      const fake = wsMock.instances[0];
      fake.open();
      await new Promise((r) => setImmediate(r));
      fake.receive({ type: 'connected' });
      await new Promise((r) => setImmediate(r));
      fake.receive({ type: 'authenticated', payload: {} });
      await cp;
      return { l, fake };
    }

    it('returns inactive state by default', async () => {
      const { l } = await authenticatedListener();
      const s = l.getPeerCompactionState();
      expect(s.active).toBe(false);
      expect(s.startedAt).toBe(null);
      expect(s.ageMs).toBe(null);
      expect(s.lastResult).toBe(null);
      await l.disconnect();
    });

    it('flips active=true on fleet:peer:compacting:start', async () => {
      const { l, fake } = await authenticatedListener();
      const before = Date.now();
      fake.receive({
        type: 'fleet:peer:compacting:start',
        payload: { messageCount: 50, tokens: 12000 },
      });
      const s = l.getPeerCompactionState();
      expect(s.active).toBe(true);
      expect(s.startedAt).toBeGreaterThanOrEqual(before);
      expect(s.ageMs).toBeGreaterThanOrEqual(0);
      expect(s.lastResult).toBe(null); // no complete yet
      await l.disconnect();
    });

    it('flips active=false + records lastResult on fleet:peer:compacting:complete', async () => {
      const { l, fake } = await authenticatedListener();
      fake.receive({
        type: 'fleet:peer:compacting:start',
        payload: { messageCount: 50 },
      });
      fake.receive({
        type: 'fleet:peer:compacting:complete',
        payload: {
          success: true,
          originalTokens: 20_000,
          compactedTokens: 7_500,
          messagesRemoved: 18,
          strategy: 'hybrid',
          durationMs: 1234,
        },
      });
      const s = l.getPeerCompactionState();
      expect(s.active).toBe(false);
      expect(s.ageMs).toBe(null); // not active anymore
      expect(s.lastResult).not.toBe(null);
      expect(s.lastResult!.success).toBe(true);
      expect(s.lastResult!.originalTokens).toBe(20_000);
      expect(s.lastResult!.compactedTokens).toBe(7_500);
      expect(s.lastResult!.strategy).toBe('hybrid');
      expect(s.lastResult!.durationMs).toBe(1234);
      expect(typeof s.lastResult!.completedAt).toBe('number');
      await l.disconnect();
    });

    it('ageMs grows while active (Date.now override)', async () => {
      const { l, fake } = await authenticatedListener();
      fake.receive({ type: 'fleet:peer:compacting:start', payload: {} });
      const startedAt = l.getPeerCompactionState().startedAt!;
      const realNow = Date.now;
      try {
        Date.now = () => startedAt + 5_000;
        const s = l.getPeerCompactionState();
        expect(s.ageMs).toBe(5_000);
      } finally {
        Date.now = realNow;
      }
      await l.disconnect();
    });
  });

  // ==========================================================================
  // Phase (d).11 — in-memory event history ring
  // ==========================================================================
  describe('event history ring (Phase (d).11)', () => {
    async function authenticatedListenerWithCapacity(capacity?: number) {
      const l = new FleetListener({
        url: 'ws://peer/ws',
        apiKey: 'k',
        ...(capacity !== undefined ? { historyCapacity: capacity } : {}),
      });
      const cp = l.connect();
      await new Promise((r) => setImmediate(r));
      const fake = wsMock.instances[0];
      fake.open();
      await new Promise((r) => setImmediate(r));
      fake.receive({ type: 'connected' });
      await new Promise((r) => setImmediate(r));
      fake.receive({ type: 'authenticated', payload: {} });
      await cp;
      return { l, fake };
    }

    it('returns empty history before any fleet:* event', async () => {
      const { l } = await authenticatedListenerWithCapacity();
      expect(l.getEventHistory()).toEqual([]);
      expect(l.getHistoryCapacity()).toBe(50);
      await l.disconnect();
    });

    it('captures events in chronological order with hostname extracted from source', async () => {
      const { l, fake } = await authenticatedListenerWithCapacity();
      fake.receive({
        type: 'fleet:agent:tool_started',
        payload: { tool: 'view_file', source: { hostname: 'darkstar', agentId: 'abc12345' } },
      });
      fake.receive({
        type: 'fleet:workflow:start',
        payload: { workflowId: 'wf-1', source: { hostname: 'ministar' } },
      });

      const hist = l.getEventHistory();
      expect(hist).toHaveLength(2);
      expect(hist[0].type).toBe('fleet:agent:tool_started');
      expect(hist[0].hostname).toBe('darkstar');
      expect(hist[0].agentId).toBe('abc12345');
      expect(hist[0].at).toBeGreaterThan(0);
      expect(hist[1].type).toBe('fleet:workflow:start');
      expect(hist[1].hostname).toBe('ministar');
      await l.disconnect();
    });

    it('evicts oldest entries when capacity is exceeded', async () => {
      const { l, fake } = await authenticatedListenerWithCapacity(3);
      for (let i = 0; i < 5; i++) {
        fake.receive({
          type: 'fleet:agent:tool_started',
          payload: { tool: `tool-${i}`, source: { hostname: 'h' } },
        });
      }
      const hist = l.getEventHistory();
      expect(hist).toHaveLength(3);
      // Last three: tool-2, tool-3, tool-4 in order.
      expect((hist[0].payload as { tool: string }).tool).toBe('tool-2');
      expect((hist[1].payload as { tool: string }).tool).toBe('tool-3');
      expect((hist[2].payload as { tool: string }).tool).toBe('tool-4');
      await l.disconnect();
    });

    it('clearEventHistory() resets the ring', async () => {
      const { l, fake } = await authenticatedListenerWithCapacity();
      fake.receive({ type: 'fleet:peer:heartbeat', payload: {} });
      expect(l.getEventHistory()).toHaveLength(1);
      l.clearEventHistory();
      expect(l.getEventHistory()).toHaveLength(0);
      await l.disconnect();
    });

    it('getEventHistory() returns a defensive copy (mutations do not leak)', async () => {
      const { l, fake } = await authenticatedListenerWithCapacity();
      fake.receive({ type: 'fleet:peer:heartbeat', payload: {} });
      const snap = l.getEventHistory() as unknown as Array<unknown>;
      // Cast away readonly so the test can attempt the (illegal) mutation
      snap.length = 0;
      // Internal ring should still hold the event
      expect(l.getEventHistory()).toHaveLength(1);
      await l.disconnect();
    });

    it('historyCapacity=0 disables capture entirely', async () => {
      const { l, fake } = await authenticatedListenerWithCapacity(0);
      fake.receive({ type: 'fleet:peer:heartbeat', payload: {} });
      fake.receive({ type: 'fleet:agent:tool_started', payload: { tool: 'x' } });
      expect(l.getEventHistory()).toEqual([]);
      expect(l.getHistoryCapacity()).toBe(0);
      await l.disconnect();
    });
  });

  // ==========================================================================
  // Phase (d).13 — peer RPC request() method
  // ==========================================================================
  describe('peer RPC request() (Phase (d).13)', () => {
    async function authedListener() {
      const l = new FleetListener({ url: 'ws://peer/ws', apiKey: 'k' });
      const cp = l.connect();
      await new Promise((r) => setImmediate(r));
      const fake = wsMock.instances[0];
      fake.open();
      await new Promise((r) => setImmediate(r));
      fake.receive({ type: 'connected' });
      await new Promise((r) => setImmediate(r));
      fake.receive({ type: 'authenticated', payload: {} });
      await cp;
      return { l, fake };
    }

    it('sends a peer:request frame with id+method+params and resolves on matching peer:response', async () => {
      const { l, fake } = await authedListener();
      const reqPromise = l.request('peer.echo', { hello: 'world' });
      // The request was sent — find it in fake.sentMessages
      const sent = fake.sentMessages.map((m) => JSON.parse(m));
      const reqFrame = sent.find((m) => m.type === 'peer:request');
      expect(reqFrame).toBeDefined();
      expect(reqFrame.payload.method).toBe('peer.echo');
      expect(reqFrame.payload.params).toEqual({ hello: 'world' });
      expect(typeof reqFrame.payload.id).toBe('string');
      expect(reqFrame.payload.id).toMatch(/^req-/);

      // Server responds with the matching id
      fake.receive({
        type: 'peer:response',
        payload: { id: reqFrame.payload.id, ok: true, payload: { echoed: { hello: 'world' } } },
      });
      const result = await reqPromise;
      expect(result).toEqual({ echoed: { hello: 'world' } });
      expect(l.getPendingRequestCount()).toBe(0);
      await l.disconnect();
    });

    it('rejects with code=METHOD_ERROR when peer:response carries an error', async () => {
      const { l, fake } = await authedListener();
      const reqPromise = l.request('boom');
      const reqFrame = JSON.parse(fake.sentMessages.find((m) => m.includes('peer:request'))!);
      fake.receive({
        type: 'peer:response',
        payload: {
          id: reqFrame.payload.id,
          ok: false,
          error: { code: 'METHOD_ERROR', message: 'handler exploded' },
        },
      });
      await expect(reqPromise).rejects.toMatchObject({
        message: expect.stringContaining('METHOD_ERROR'),
      });
      await l.disconnect();
    });

    it('rejects with code=REQUEST_TIMEOUT when no response arrives within timeoutMs', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        const { l } = await authedListener();
        // Pre-attach a catch so the timeout-driven rejection has a handler
        // even if the test runner takes a tick to wire `expect().rejects`.
        const reqPromise = l.request('peer.echo', {}, { timeoutMs: 100 }).then(
          () => ({ ok: true as const }),
          (e: Error) => ({ ok: false as const, message: e.message }),
        );
        await vi.advanceTimersByTimeAsync(150);
        const result = await reqPromise;
        expect(result).toMatchObject({
          ok: false,
          message: expect.stringContaining('REQUEST_TIMEOUT'),
        });
        expect(l.getPendingRequestCount()).toBe(0);
        await l.disconnect();
      } finally {
        vi.useRealTimers();
      }
    });

    it('throws NOT_AUTHENTICATED when called before auth completes', async () => {
      const l = new FleetListener({ url: 'ws://peer/ws', apiKey: 'k' });
      // Don't await connect — just construct
      await expect(l.request('peer.ping')).rejects.toMatchObject({
        message: expect.stringContaining('NOT_AUTHENTICATED'),
      });
    });

    it('disconnect() rejects all in-flight requests with code=DISCONNECTED', async () => {
      const { l } = await authedListener();
      // Attach catch handlers immediately so the rejections that fire
      // inside disconnect() don't bubble up as unhandledRejection.
      const r1 = l.request('peer.ping').then(
        () => ({ ok: true }),
        (e: Error) => ({ ok: false, message: e.message }),
      );
      const r2 = l.request('peer.echo', { x: 1 }).then(
        () => ({ ok: true }),
        (e: Error) => ({ ok: false, message: e.message }),
      );
      expect(l.getPendingRequestCount()).toBe(2);

      await l.disconnect();

      const e1 = await r1;
      const e2 = await r2;
      expect(e1).toMatchObject({ ok: false, message: expect.stringContaining('DISCONNECTED') });
      expect(e2).toMatchObject({ ok: false, message: expect.stringContaining('DISCONNECTED') });
      expect(l.getPendingRequestCount()).toBe(0);
    });

    it('rejects in-flight requests immediately when the socket closes unexpectedly', async () => {
      const { l, fake } = await authedListener();
      const request = l.request('peer.chat', { prompt: 'slow answer' }, { timeoutMs: 30_000 });
      const outcome = request.then(
        () => ({ ok: true as const }),
        (error: Error & { code?: string }) => ({
          ok: false as const,
          code: error.code,
          message: error.message,
        }),
      );

      expect(l.getPendingRequestCount()).toBe(1);
      fake.close();

      await expect(outcome).resolves.toMatchObject({
        ok: false,
        code: 'DISCONNECTED',
        message: expect.stringContaining('connection closed'),
      });
      expect(l.getPendingRequestCount()).toBe(0);
    });

    it('two concurrent requests get matching responses by id (no swap)', async () => {
      const { l, fake } = await authedListener();
      const p1 = l.request('peer.echo', { which: 'first' });
      const p2 = l.request('peer.echo', { which: 'second' });
      const sent = fake.sentMessages.map((m) => JSON.parse(m));
      const reqs = sent.filter((m) => m.type === 'peer:request');
      expect(reqs).toHaveLength(2);
      // Respond out of order: second first
      fake.receive({
        type: 'peer:response',
        payload: { id: reqs[1].payload.id, ok: true, payload: { which: 'second' } },
      });
      fake.receive({
        type: 'peer:response',
        payload: { id: reqs[0].payload.id, ok: true, payload: { which: 'first' } },
      });
      expect(await p1).toEqual({ which: 'first' });
      expect(await p2).toEqual({ which: 'second' });
      await l.disconnect();
    });

    it('Phase (d).14 — CODEBUDDY_PEER_ROLE=leaf refuses outgoing request() with code=ROLE_LEAF', async () => {
      const orig = process.env.CODEBUDDY_PEER_ROLE;
      process.env.CODEBUDDY_PEER_ROLE = 'leaf';
      try {
        const { l } = await authedListener();
        await expect(l.request('peer.ping')).rejects.toMatchObject({
          message: expect.stringContaining('ROLE_LEAF'),
        });
        await l.disconnect();
      } finally {
        if (orig === undefined) delete process.env.CODEBUDDY_PEER_ROLE;
        else process.env.CODEBUDDY_PEER_ROLE = orig;
      }
    });

    it('Phase (d).14 — propagates traceId + depth in the wire frame when caller passes them', async () => {
      const { l, fake } = await authedListener();
      // Attach a catch so the timeout doesn't bubble (we never respond)
      void l.request('peer.ping', {}, { traceId: 'trace-test-123', depth: 2, timeoutMs: 100 }).catch(() => {});
      const sent = fake.sentMessages.map((m) => JSON.parse(m));
      const reqFrame = sent.find((m) => m.type === 'peer:request');
      expect(reqFrame.payload.traceId).toBe('trace-test-123');
      expect(reqFrame.payload.depth).toBe(2);
      await l.disconnect();
    });

    it('Phase (d).14 — omits traceId/depth from the wire frame when not provided (top-level call)', async () => {
      const { l, fake } = await authedListener();
      void l.request('peer.ping', {}, { timeoutMs: 100 }).catch(() => {});
      const sent = fake.sentMessages.map((m) => JSON.parse(m));
      const reqFrame = sent.find((m) => m.type === 'peer:request');
      expect(reqFrame.payload.traceId).toBeUndefined();
      expect(reqFrame.payload.depth).toBeUndefined();
      await l.disconnect();
    });

    it('peer:response with unknown id is silently ignored (no crash)', async () => {
      const { l, fake } = await authedListener();
      // No pending requests — response with id should just be dropped
      expect(() => {
        fake.receive({
          type: 'peer:response',
          payload: { id: 'never-sent', ok: true, payload: 'ghost' },
        });
      }).not.toThrow();
      expect(l.getPendingRequestCount()).toBe(0);
      await l.disconnect();
    });

    it('ignores a peer:chunk that arrives after the request has resolved', async () => {
      const { l, fake } = await authedListener();
      const onChunk = vi.fn();
      const request = l.requestStream('peer.chat-stream', { prompt: 'hello' }, onChunk);
      const sent = fake.sentMessages.map((message) => JSON.parse(message));
      const frame = sent.find((message) => message.type === 'peer:request');

      fake.receive({
        type: 'peer:response',
        payload: { id: frame.payload.id, ok: true, payload: { text: 'done' } },
      });
      await expect(request).resolves.toEqual({ text: 'done' });

      expect(() => fake.receive({
        type: 'peer:chunk',
        payload: { id: frame.payload.id, delta: 'late' },
      })).not.toThrow();
      expect(onChunk).not.toHaveBeenCalled();
      expect(l.getPendingRequestCount()).toBe(0);
      await l.disconnect();
    });
  });
});
