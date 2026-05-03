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
});
