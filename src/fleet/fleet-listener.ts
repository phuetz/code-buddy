/**
 * Fleet listener client (Phase (d).5 + (d).6 V0.4.1).
 *
 * Connects to a peer Code Buddy's Gateway WebSocket and subscribes to
 * fleet:* events broadcast by that instance. Closes the streaming loop
 * started by (d).1 — the broadcast surface — by giving users an actual
 * way to consume events from another Claude.
 *
 * Authentication:
 * Uses the existing apiKey path on the peer's Gateway WS handler. The
 * apiKey must have the `fleet:listen` scope (added in (d).1).
 *
 * Lifecycle:
 *   const l = new FleetListener({ url, apiKey, autoReconnect: true });
 *   l.on('fleet:agent:tool_started', (payload) => ...);
 *   await l.connect();      // resolves on 'authenticated'
 *   ...
 *   await l.disconnect();   // closes ws cleanly
 *
 * Reconnect (Phase (d).6): opt-in via `autoReconnect: true`. Uses the
 * shared `ReconnectionManager` (exponential backoff + jitter) used by
 * the channel adapters. Only kicks in AFTER a first successful auth, so
 * a user-facing connect() error still surfaces immediately. Terminal
 * server errors (`AUTH_FAILED`, `INVALID_TOKEN`) cancel any retry.
 * Default `autoReconnect: false` preserves V0.4.1 behavior verbatim.
 *
 * Event surface (re-emitted from incoming WS messages):
 * - `fleet:agent:tool_started`, `fleet:agent:tool_completed`,
 *   `fleet:agent:tool_error` (from peer's (d).2)
 * - `fleet:workflow:start`, `fleet:workflow:event`,
 *   `fleet:workflow:complete` (from peer's (d).3)
 * - `fleet:session:spawn`, `fleet:session:message` (from peer's (d).4)
 * - `connected`, `authenticated`, `disconnected`, `error` (lifecycle)
 * - `reconnecting`, `reconnected`, `exhausted` (auto-reconnect, (d).6)
 *
 * Honest limitations (V0.5+):
 * - No backpressure on the receive side; if local handlers are slow,
 *   ws lib buffers. V0.5 adds per-event-type queue caps.
 * - Single peer at a time — singleton in the slash handler. Multi-peer
 *   fan-in is V0.5+.
 * - No event replay during the disconnected window: events emitted by
 *   the peer between drop and reconnect are lost. Server-side buffer
 *   needed for that (V0.6+).
 * - Cross-host trust model: caller picks the apiKey provisioning path.
 *   Hub-issued keys vs. per-spoke keys vs. shared keys all work; pick
 *   based on operational needs.
 */

import { EventEmitter } from 'events';
import { WebSocket } from 'ws';
import { logger } from '../utils/logger.js';
import {
  ReconnectionManager,
  type ReconnectionConfig,
} from '../channels/reconnection-manager.js';

export interface FleetListenerOptions {
  /** Peer Gateway WS URL, e.g. ws://100.98.18.76:3000/ws */
  url: string;
  /** API key with `fleet:listen` scope on the peer. Either this or jwt. */
  apiKey?: string;
  /** JWT token alternative to apiKey. */
  jwt?: string;
  /** Optional connection timeout in ms (default 10_000). */
  connectTimeoutMs?: number;
  /** Optional auth timeout in ms once connected (default 5_000). */
  authTimeoutMs?: number;
  /**
   * Auto-reconnect on ws drop after the first successful auth (Phase (d).6).
   * Default `false` to preserve V0.4.1 behavior. When `true`, ws drops
   * trigger exponential-backoff reconnect via `ReconnectionManager`.
   * Initial `connect()` failures still throw — they don't trigger retries.
   * Terminal server errors (AUTH_FAILED, INVALID_TOKEN) cancel any retry.
   */
  autoReconnect?: boolean;
  /** Override defaults for the reconnect backoff (only used when autoReconnect=true). */
  reconnect?: Partial<ReconnectionConfig>;
  /**
   * Phase (d).11 — capacity of the in-memory event history ring. Default
   * 50. Each record is ~500 bytes so 50 ≈ 25 KB per listener — safe for
   * any sane workload. Set to 0 to disable history capture entirely.
   */
  historyCapacity?: number;
}

interface IncomingMessage {
  type: string;
  payload?: Record<string, unknown>;
  error?: { code: string; message: string };
  timestamp?: string;
}

/**
 * Phase (d).10 — payload shape stored after a fleet:peer:compacting:complete
 * event. `completedAt` is the local epoch ms (avoids cross-host clock drift).
 * All other fields are passthroughs from the SmartCompactionEngine result.
 */
export interface PeerCompactionResult {
  success?: boolean;
  originalTokens?: number;
  compactedTokens?: number;
  messagesRemoved?: number;
  strategy?: string;
  durationMs?: number;
  completedAt: number;
}

/**
 * Phase (d).11 — record kept in the in-memory event history ring. `at` is
 * the local epoch ms when the event was received (not the peer's clock —
 * avoids cross-host clock drift in the displayed timeline). `hostname`
 * and `agentId` are extracted from `payload.source` for convenience so
 * /fleet history doesn't have to dig into the payload to render the
 * source column.
 */
export interface FleetEventRecord {
  at: number;
  type: string;
  payload: Record<string, unknown>;
  hostname?: string;
  agentId?: string;
}

export class FleetListener extends EventEmitter {
  private ws: WebSocket | null = null;
  private connected = false;
  private authenticated = false;
  // Set true once we have completed an `authenticated` handshake at least
  // once. Auto-reconnect only kicks in after this — initial connect()
  // failures still surface to the caller as a normal Promise rejection.
  private hasBeenAuthenticated = false;
  // Set true when the user explicitly called disconnect() OR when the
  // server returned a terminal auth-failure code. Prevents auto-reconnect.
  private userDisconnected = false;
  // Phase (d).9 — presence tracking. Updated on every fleet:* event
  // (incl. fleet:peer:heartbeat). Lets `/fleet status` flag a stale
  // peer that hasn't said anything in a while. Null until the first
  // event arrives.
  private lastSeenAt: number | null = null;
  private lastSeenReason: string | null = null;
  // Phase (d).10 — peer compaction state. Tracks whether the connected
  // peer is currently in a compaction cycle so consumers can hold off
  // on sending tasks for ~5-30 s. Set true on fleet:peer:compacting:start,
  // false on :complete (and lastResult is captured then).
  private peerCompacting = false;
  private compactingStartedAt: number | null = null;
  private lastCompactionResult: PeerCompactionResult | null = null;
  // Phase (d).11 — in-memory event history ring. Capacity from options
  // (default 50). Push at end, evict from head when length > capacity.
  // capacity=0 disables history capture entirely.
  private readonly historyCapacity: number;
  private eventHistory: FleetEventRecord[] = [];
  // Phase (d).13 — pending peer:request map for ID-correlation between
  // sent peer:request frames and the matching peer:response. Mirror of
  // OpenClaw GatewayChannel.pending. Each entry carries resolve/reject
  // and a timer handle so disconnect() can flush + reject all in-flight
  // requests cleanly.
  private pendingRequests = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (reason: Error) => void;
      timer: NodeJS.Timeout;
      /** Phase (d).19 — optional onChunk for streaming requests. */
      onChunk?: (delta: string) => void;
    }
  >();
  private requestSeq = 0;
  private readonly options: FleetListenerOptions;
  private readonly reconnector: ReconnectionManager | null;

  constructor(options: FleetListenerOptions) {
    super();
    if (!options.apiKey && !options.jwt) {
      throw new Error('FleetListener requires apiKey or jwt');
    }
    this.options = options;
    // Phase (d).11 — clamp historyCapacity. Negative or NaN falls back
    // to default; 0 is honored as "history disabled".
    this.historyCapacity =
      typeof options.historyCapacity === 'number' &&
      Number.isFinite(options.historyCapacity) &&
      options.historyCapacity >= 0
        ? Math.floor(options.historyCapacity)
        : 50;
    // Default 'error' listener — EventEmitter throws synchronously when
    // 'error' is emitted with no listener registered, which would crash
    // the calling agent on a transient WS hiccup. Callers can still
    // listener.on('error', ...) for their own handling.
    this.on('error', () => {
      /* noop default — keep node from throwing on unhandled error */
    });

    if (options.autoReconnect) {
      this.reconnector = new ReconnectionManager('fleet-listener', options.reconnect);
      // Re-emit the manager events on this listener so consumers (the
      // /fleet slash handler, tests) can observe reconnect lifecycle
      // without reaching into the manager directly.
      this.reconnector.on('reconnecting', (attempt: number, delayMs: number) => {
        this.emit('reconnecting', { attempt, delayMs });
      });
      // The manager emits `reconnected(retryCount)` immediately after
      // the connectFn resolves. We re-emit with the meaningful attempt
      // number THEN call onConnected() to reset the counter — that way
      // consumers reading getReconnectAttempts() inside their listener
      // still see the attempt that succeeded.
      this.reconnector.on('reconnected', (attempt: number) => {
        this.emit('reconnected', { attempt });
        this.reconnector?.onConnected();
      });
      this.reconnector.on('exhausted', (totalAttempts: number) => {
        this.emit('exhausted', { totalAttempts });
      });
      // Default error listener — same rationale as above.
      this.reconnector.on('error', () => {
        /* noop default */
      });
    } else {
      this.reconnector = null;
    }
  }

  /**
   * Connect to the peer and authenticate. Resolves once the server
   * sends `authenticated`. Rejects on connect error, auth error, or
   * timeout. After this call, `connected` and `authenticated` flags
   * are true and incoming fleet:* messages are re-emitted as events.
   *
   * Re-callable: if the listener was previously authenticated and
   * dropped, calling connect() again opens a fresh ws (the auto-reconnect
   * path uses this internally; callers usually don't need to).
   */
  async connect(): Promise<void> {
    // Public connect() resets the user-disconnected latch — the user is
    // explicitly re-engaging after a previous disconnect() or terminal
    // server error. The internal reconnect path skips this method, so
    // it doesn't accidentally clear a flag the close handler still needs.
    this.userDisconnected = false;
    return this.connectInternal();
  }

  private async connectInternal(): Promise<void> {
    // Cleanup any leftover ws from a previous attempt. Important for the
    // reconnect path so the new ws's events don't interleave with the
    // old one's. Mirrors the discord adapter's reconnect cleanup.
    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        if (this.ws.readyState === 1 /* OPEN */) {
          this.ws.close();
        }
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (err?: unknown) => {
        if (settled) return;
        settled = true;
        if (err) reject(err);
        else resolve();
      };

      const connectTimer = setTimeout(() => {
        settle(new Error(`Fleet listener connect timeout (${this.options.connectTimeoutMs ?? 10_000}ms)`));
        try {
          this.ws?.close();
        } catch {
          /* ignore */
        }
      }, this.options.connectTimeoutMs ?? 10_000);

      let authTimer: NodeJS.Timeout | null = null;

      this.ws = new WebSocket(this.options.url);

      this.ws.on('open', () => {
        clearTimeout(connectTimer);
        this.connected = true;
        this.emit('connected');
      });

      this.ws.on('message', (data) => {
        let msg: IncomingMessage;
        try {
          msg = JSON.parse(data.toString());
        } catch {
          this.emit('error', new Error('Received non-JSON message'));
          return;
        }
        this.handleIncomingMessage(msg, settle, () => {
          if (authTimer) {
            clearTimeout(authTimer);
            authTimer = null;
          }
        });
      });

      this.ws.on('close', () => {
        if (authTimer) clearTimeout(authTimer);
        clearTimeout(connectTimer);
        this.connected = false;
        this.authenticated = false;
        this.emit('disconnected');
        // Responses sent to the old socket can never arrive on a replacement
        // connection. Reject immediately instead of leaving callers blocked
        // until their individual request timeouts expire.
        this.rejectPendingRequests('connection closed');
        // If we never settled, the connection died before auth — reject.
        settle(new Error('Connection closed before authentication'));
        // Phase (d).6 — schedule auto-reconnect only if:
        //  - the listener has been authenticated at least once (initial
        //    connect failures are surfaced to the caller, not retried),
        //  - the user did not call disconnect() (or hit a terminal auth
        //    error like AUTH_FAILED, which sets userDisconnected=true),
        //  - autoReconnect was enabled at construct.
        // If the manager throws during connectFn (e.g. the new ws also
        // closes before auth), this same handler fires on the new ws
        // and re-schedules — recursion via ws lifecycle, same as the
        // discord adapter pattern.
        if (
          this.hasBeenAuthenticated &&
          !this.userDisconnected &&
          this.reconnector
        ) {
          // Defer the schedule by one tick. During chained reconnects
          // (a retry's ws closes before auth → THIS handler fires), the
          // ReconnectionManager's IIFE is still in-flight (`active=true`
          // → scheduleReconnect would no-op). setImmediate lets the
          // manager's finally{ active=false } run first so the schedule
          // succeeds and the chain advances. For the normal single-drop
          // case this is just one extra tick of latency.
          this.scheduleReconnectDeferred();
        }
      });

      this.ws.on('error', (err) => {
        clearTimeout(connectTimer);
        if (authTimer) clearTimeout(authTimer);
        this.emit('error', err);
        settle(err instanceof Error ? err : new Error(String(err)));
      });

      // After 'connected' from the server, send the auth message. Set up
      // an auth timeout in case the server never responds.
      this.once('connected', () => {
        // 'connected' here is OUR emitted event when ws opened; we still
        // need to wait for the SERVER's 'connected' message. The
        // handleIncomingMessage path does the auth-send — see below.
      });

      // Bound auth wait: schedule the timeout after we send authenticate.
      // We'll trigger this from handleIncomingMessage after sending auth.
      this.once('__internal:auth-sent', () => {
        authTimer = setTimeout(() => {
          settle(new Error(`Fleet listener auth timeout (${this.options.authTimeoutMs ?? 5_000}ms)`));
          try {
            this.ws?.close();
          } catch {
            /* ignore */
          }
        }, this.options.authTimeoutMs ?? 5_000);
      });
    });
  }

  private handleIncomingMessage(
    msg: IncomingMessage,
    settle: (err?: unknown) => void,
    clearAuthTimer: () => void,
  ): void {
    // Server's welcome → send authenticate.
    if (msg.type === 'connected') {
      const auth: Record<string, unknown> = {};
      if (this.options.apiKey) auth.apiKey = this.options.apiKey;
      if (this.options.jwt) auth.token = this.options.jwt;
      this.send('authenticate', auth);
      this.emit('__internal:auth-sent');
      return;
    }
    if (msg.type === 'authenticated') {
      this.authenticated = true;
      this.hasBeenAuthenticated = true;
      clearAuthTimer();
      this.emit('authenticated', msg.payload);
      settle();
      return;
    }
    if (msg.type === 'error') {
      const code = msg.error?.code;
      const err = new Error(msg.error?.message || 'Server error');
      (err as Error & { code?: string }).code = code;
      // Phase (d).6 — terminal server errors must NOT trigger an
      // auto-reconnect. Set userDisconnected so the close handler skips
      // scheduling, and cancel any pending reconnect timer (defensive —
      // matters if the error arrives while a retry is queued).
      if (code === 'AUTH_FAILED' || code === 'INVALID_TOKEN') {
        this.userDisconnected = true;
        this.reconnector?.cancel();
      }
      this.emit('error', err);
      // If we haven't authenticated yet, the error is fatal for connect()
      if (!this.authenticated) {
        settle(err);
      }
      return;
    }
    // Phase (d).19 — peer RPC streaming chunk. Match by frame.id against
    // the pending map. If the pending request was opened with onChunk
    // (via requestStream), invoke it with the delta. Chunks BEFORE the
    // final peer:response do NOT clear the timer; the timeout still
    // applies to total request duration.
    if (msg.type === 'peer:chunk') {
      const frame = (msg.payload ?? {}) as { id?: string; delta?: string };
      if (typeof frame.id === 'string' && typeof frame.delta === 'string') {
        const pending = this.pendingRequests.get(frame.id);
        if (pending && pending.onChunk) {
          try {
            pending.onChunk(frame.delta);
          } catch (err) {
            logger.debug('[fleet-listener] onChunk threw', { error: String(err) });
          }
        }
      }
      return;
    }
    // Phase (d).13 — peer RPC response. Match by frame.id against the
    // pending map and resolve/reject the awaiting request().
    if (msg.type === 'peer:response') {
      const frame = (msg.payload ?? {}) as {
        id?: string;
        ok?: boolean;
        payload?: unknown;
        error?: { code?: string; message?: string };
      };
      if (typeof frame.id === 'string') {
        const pending = this.pendingRequests.get(frame.id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingRequests.delete(frame.id);
          if (frame.ok) {
            pending.resolve(frame.payload);
          } else {
            const code = frame.error?.code ?? 'UNKNOWN_ERROR';
            const message = frame.error?.message ?? 'peer returned an error';
            const err = new Error(`peer.invoke ${code}: ${message}`);
            (err as Error & { code?: string }).code = code;
            pending.reject(err);
          }
        }
      }
      // Don't re-emit on the user-facing event channels — peer:response
      // is a low-level RPC mechanism, callers use request() to await.
      return;
    }
    // Fleet event re-emit. We forward type + payload as-is so consumers
    // can pattern-match on 'fleet:agent:tool_started' etc.
    if (msg.type.startsWith('fleet:')) {
      // Phase (d).9 — every fleet:* event counts as presence. Heartbeat
      // is the explicit "still here" signal; activity events double as
      // implicit presence so we don't need both to keep the listener
      // confident the peer is alive.
      this.lastSeenAt = Date.now();
      this.lastSeenReason = msg.type === 'fleet:peer:heartbeat' ? 'heartbeat' : msg.type;
      // Phase (d).11 — capture in the in-memory ring before emit. Pushed
      // ahead of consumers so getEventHistory() called from inside an
      // event handler already sees the new record. capacity=0 = noop.
      if (this.historyCapacity > 0) {
        const payload = msg.payload ?? {};
        const source = payload.source as { hostname?: string; agentId?: string } | undefined;
        this.eventHistory.push({
          at: this.lastSeenAt,
          type: msg.type,
          payload,
          hostname: source?.hostname,
          agentId: source?.agentId,
        });
        // Evict from head until we're back at capacity. Single-shift loop
        // is fine — we push one at a time so length is at most capacity+1.
        while (this.eventHistory.length > this.historyCapacity) {
          this.eventHistory.shift();
        }
      }
      // Phase (d).10 — track peer compaction lifecycle so /fleet status
      // and downstream consumers can defer task dispatch.
      if (msg.type === 'fleet:peer:compacting:start') {
        this.peerCompacting = true;
        this.compactingStartedAt = Date.now();
      } else if (msg.type === 'fleet:peer:compacting:complete') {
        this.peerCompacting = false;
        const p = (msg.payload ?? {}) as Record<string, unknown>;
        this.lastCompactionResult = {
          success: typeof p.success === 'boolean' ? p.success : undefined,
          originalTokens: typeof p.originalTokens === 'number' ? p.originalTokens : undefined,
          compactedTokens: typeof p.compactedTokens === 'number' ? p.compactedTokens : undefined,
          messagesRemoved: typeof p.messagesRemoved === 'number' ? p.messagesRemoved : undefined,
          strategy: typeof p.strategy === 'string' ? p.strategy : undefined,
          durationMs: typeof p.durationMs === 'number' ? p.durationMs : undefined,
          completedAt: Date.now(),
        };
      }
      this.emit(msg.type, msg.payload ?? {});
      // Also emit on a generic 'fleet:event' channel so callers can
      // subscribe to all events at once for logging / debugging.
      this.emit('fleet:event', { type: msg.type, payload: msg.payload ?? {} });
      return;
    }
    // Anything else — log + forward verbatim. The peer might add new
    // message types we don't yet model.
    this.emit(msg.type, msg.payload ?? {});
  }

  /**
   * Schedule a reconnect attempt asynchronously (next tick) so the manager's
   * `active` guard isn't tripped when this fires during an in-flight retry.
   * Called by the close handler when auto-reconnect is on. The connectFn
   * doesn't call onConnected() — that happens in the `reconnected` listener
   * registered in the constructor, after consumers have observed the attempt.
   */
  private scheduleReconnectDeferred(): void {
    if (!this.reconnector) return;
    const reconnector = this.reconnector;
    setImmediate(() => {
      // Re-check the latch — disconnect() may have been called between
      // the close event and this microtask.
      if (this.userDisconnected) return;
      reconnector.scheduleReconnect(async () => {
        await this.connectInternal();
      });
    });
  }

  private send(type: string, payload?: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== 1 /* OPEN */) {
      logger.debug('[fleet-listener] tried to send on non-open ws', { type });
      return;
    }
    this.ws.send(JSON.stringify({ type, payload }));
  }

  /**
   * Close the WS connection. Idempotent. Cancels any pending auto-reconnect
   * (set by Phase (d).6) so the listener stays down until the user
   * explicitly calls connect() again.
   */
  async disconnect(): Promise<void> {
    // Set the flag BEFORE closing, so the ws close handler sees it and
    // skips scheduling a reconnect.
    this.userDisconnected = true;
    this.reconnector?.cancel();
    // Phase (d).13 — flush pending peer.invoke requests so awaiting
    // callers reject promptly rather than waiting for the per-call
    // timeout.
    this.rejectPendingRequests('disconnect() called');
    if (!this.ws) return;
    return new Promise<void>((resolve) => {
      const ws = this.ws;
      if (!ws) {
        resolve();
        return;
      }
      const onClose = () => {
        ws.removeListener('close', onClose);
        resolve();
      };
      ws.on('close', onClose);
      try {
        ws.close();
      } catch {
        // close() should never throw on a valid ws but guard anyway
        resolve();
      }
      // Safety net — close should fire 'close' but if for some reason it
      // doesn't, resolve after 1s so callers don't hang forever.
      setTimeout(resolve, 1000);
    });
  }

  isConnected(): boolean {
    return this.connected;
  }

  isAuthenticated(): boolean {
    return this.authenticated;
  }

  /**
   * Number of reconnect attempts performed by the auto-reconnect manager
   * since the last successful (re)connect. Returns 0 when autoReconnect
   * is disabled. Phase (d).6.
   */
  getReconnectAttempts(): number {
    return this.reconnector?.getRetryCount() ?? 0;
  }

  /**
   * True when an auto-reconnect attempt is currently scheduled or
   * in-flight. False otherwise (incl. when autoReconnect is disabled).
   * Phase (d).6.
   */
  isReconnecting(): boolean {
    return this.reconnector?.isPending() ?? false;
  }

  /**
   * Phase (d).9 — last-seen telemetry for the connected peer. Returns
   * the timestamp + reason (event type or 'heartbeat') of the most
   * recent fleet:* event received. `ageMs` is `Date.now() - at`, or
   * `null` until the first event arrives.
   */
  getLastSeen(): { at: number | null; reason: string | null; ageMs: number | null } {
    return {
      at: this.lastSeenAt,
      reason: this.lastSeenReason,
      ageMs: this.lastSeenAt === null ? null : Date.now() - this.lastSeenAt,
    };
  }

  /**
   * Phase (d).9 — true when the peer hasn't been heard from in
   * `thresholdMs` milliseconds. Returns false if no events have ever
   * been received (we can't say "stale" without a baseline).
   */
  isStale(thresholdMs: number = 90_000): boolean {
    if (this.lastSeenAt === null) return false;
    return Date.now() - this.lastSeenAt > thresholdMs;
  }

  /**
   * Phase (d).10 — peer compaction state snapshot.
   *
   * `active` is true while the peer is between fleet:peer:compacting:start
   * and :complete. `startedAt` is the local epoch ms when the start
   * event arrived (not the peer's clock — avoids cross-host clock
   * drift). `ageMs` = `Date.now() - startedAt` when active, otherwise
   * null. `lastResult` is the most recent `:complete` payload (or null
   * if the peer hasn't completed a compaction yet).
   */
  /**
   * Phase (d).11 — defensive copy of the in-memory event history ring.
   * Returns the most recent N events in chronological order (oldest at
   * index 0, newest last). Returns an empty array when no events have
   * been received OR when historyCapacity was set to 0.
   *
   * The returned array is a shallow copy: mutations don't affect the
   * internal ring. Each FleetEventRecord still references the original
   * payload object — callers shouldn't mutate that either.
   */
  getEventHistory(): readonly FleetEventRecord[] {
    return [...this.eventHistory];
  }

  /** Phase (d).11 — drop all stored events. Useful for tests + power users. */
  clearEventHistory(): void {
    this.eventHistory = [];
  }

  /** Phase (d).11 — current ring capacity (informational). */
  getHistoryCapacity(): number {
    return this.historyCapacity;
  }

  /**
   * Phase (d).13 — invoke a method on the connected peer via the
   * peer-rpc registry. Returns the method's payload on success or
   * rejects with an Error carrying `code` (UNKNOWN_METHOD,
   * METHOD_ERROR, INVALID_REQUEST, REQUEST_TIMEOUT, NOT_AUTHENTICATED,
   * NOT_OPEN, DISCONNECTED, MAX_DEPTH_EXCEEDED, ROLE_LEAF).
   *
   * The default timeout is 30s, mirror of OpenClaw's invoke default.
   * Override per-call via the `timeoutMs` option.
   *
   * Phase (d).14 — `traceId` and `depth` propagate the call chain so
   * the receiver can detect loops / enforce a depth cap. A handler
   * fanning out to another peer should pass them from its received
   * ctx: `request(m, p, { traceId: ctx.traceId, depth: ctx.depth + 1 })`.
   * Defaults: a fresh top-level call (no traceId, depth=0) lets the
   * server generate the traceId.
   *
   * Phase (d).14 — `CODEBUDDY_PEER_ROLE=leaf` makes this listener
   * REFUSE to issue outgoing peer.invoke calls (throws ROLE_LEAF).
   * This protects mesh deployments where some nodes are pure
   * service-providers and shouldn't initiate work themselves.
   */
  async request(
    method: string,
    params: Record<string, unknown> = {},
    options: { timeoutMs?: number; traceId?: string; depth?: number } = {},
  ): Promise<unknown> {
    // Phase (d).14 — leaf role refuses outgoing requests entirely.
    if (process.env.CODEBUDDY_PEER_ROLE === 'leaf') {
      const err = new Error(
        'peer.invoke ROLE_LEAF: this peer is configured as leaf and cannot initiate peer.invoke calls',
      );
      (err as Error & { code?: string }).code = 'ROLE_LEAF';
      throw err;
    }
    if (!this.authenticated) {
      const err = new Error('peer.invoke NOT_AUTHENTICATED: listener is not authenticated');
      (err as Error & { code?: string }).code = 'NOT_AUTHENTICATED';
      throw err;
    }
    if (!this.ws || this.ws.readyState !== 1) {
      const err = new Error('peer.invoke NOT_OPEN: ws is not in OPEN state');
      (err as Error & { code?: string }).code = 'NOT_OPEN';
      throw err;
    }
    const id = this.nextRequestId();
    const timeoutMs = options.timeoutMs ?? 30_000;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        const err = new Error(`peer.invoke REQUEST_TIMEOUT: ${method} did not respond within ${timeoutMs}ms`);
        (err as Error & { code?: string }).code = 'REQUEST_TIMEOUT';
        reject(err);
      }, timeoutMs);
      // unref so a hung request can't keep the process alive past exit
      timer.unref?.();
      this.pendingRequests.set(id, { resolve, reject, timer });
      // Phase (d).14 — include traceId + depth in the wire frame when
      // the caller provided them; otherwise omit and let the receiver
      // generate fresh ones (fresh top-level call).
      const frame: Record<string, unknown> = { id, method, params };
      if (options.traceId !== undefined) frame.traceId = options.traceId;
      if (options.depth !== undefined) frame.depth = options.depth;
      this.send('peer:request', frame);
    });
  }

  /**
   * Phase (d).19 — streaming variant of `request()`. Same semantics +
   * an `onChunk` callback that's invoked once per `peer:chunk` frame
   * received during the call. The promise resolves with the FINAL
   * `peer:response` payload (the same shape `request()` returns).
   *
   * Use this for methods like `peer.chat-stream` where the peer pushes
   * incremental output. The callback is invoked synchronously from the
   * ws message handler — keep it light. The total elapsed time is still
   * bounded by `timeoutMs` (chunks reset NEITHER the timer nor liveness
   * — they're a peek into the in-progress work).
   *
   * Anti-loop guards (ROLE_LEAF, depth cap propagation) are identical to
   * `request()` since the wire frame is the same.
   */
  async requestStream(
    method: string,
    params: Record<string, unknown> = {},
    onChunk: (delta: string) => void,
    options: { timeoutMs?: number; traceId?: string; depth?: number } = {},
  ): Promise<unknown> {
    if (process.env.CODEBUDDY_PEER_ROLE === 'leaf') {
      const err = new Error(
        'peer.invoke ROLE_LEAF: this peer is configured as leaf and cannot initiate peer.invoke calls',
      );
      (err as Error & { code?: string }).code = 'ROLE_LEAF';
      throw err;
    }
    if (!this.authenticated) {
      const err = new Error('peer.invoke NOT_AUTHENTICATED: listener is not authenticated');
      (err as Error & { code?: string }).code = 'NOT_AUTHENTICATED';
      throw err;
    }
    if (!this.ws || this.ws.readyState !== 1) {
      const err = new Error('peer.invoke NOT_OPEN: ws is not in OPEN state');
      (err as Error & { code?: string }).code = 'NOT_OPEN';
      throw err;
    }
    const id = this.nextRequestId();
    const timeoutMs = options.timeoutMs ?? 30_000;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        const err = new Error(
          `peer.invoke REQUEST_TIMEOUT: ${method} did not respond within ${timeoutMs}ms`,
        );
        (err as Error & { code?: string }).code = 'REQUEST_TIMEOUT';
        reject(err);
      }, timeoutMs);
      timer.unref?.();
      this.pendingRequests.set(id, { resolve, reject, timer, onChunk });
      const frame: Record<string, unknown> = { id, method, params };
      if (options.traceId !== undefined) frame.traceId = options.traceId;
      if (options.depth !== undefined) frame.depth = options.depth;
      this.send('peer:request', frame);
    });
  }

  /**
   * Phase (d).23 / V1.3 — invoke a read-only tool on the connected peer
   * via `peer.tool.invoke`. Convenience wrapper around `request()` with
   * the params shape the bridge expects (`{ tool, args }`).
   *
   * Returns the executor's structured payload `{ tool, output,
   * durationMs, truncated? }`. Errors carry the same `code` taxonomy as
   * `request()` plus the bridge codes propagated in `error.message`:
   * `TOOL_NOT_ALLOWED_FOR_PEER_INVOKE`, `TOOL_NOT_FLEET_SAFE`,
   * `PEER_WORKSPACE_NOT_CONFIGURED`, `PATH_OUTSIDE_PEER_WORKSPACE`,
   * `UNKNOWN_PEER_TOOL`, `SEARCH_TIMEOUT`, `SEARCH_FAILED`.
   */
  async invokeTool(
    toolName: string,
    args: Record<string, unknown> = {},
    options: { timeoutMs?: number; traceId?: string; depth?: number } = {},
  ): Promise<{ tool: string; output: string; durationMs: number; truncated?: boolean }> {
    const payload = await this.request(
      'peer.tool.invoke',
      { tool: toolName, args },
      options,
    );
    return payload as { tool: string; output: string; durationMs: number; truncated?: boolean };
  }

  /**
   * Phase (d).23 / V1.3 — streaming variant. Same semantics as
   * `invokeTool()` plus an `onChunk` callback invoked for each
   * `peer:chunk` frame. The promise resolves with the final aggregated
   * payload (the bridge accumulates locally too, so callers get the
   * complete `output` either way).
   */
  async invokeToolStream(
    toolName: string,
    args: Record<string, unknown>,
    onChunk: (delta: string) => void,
    options: { timeoutMs?: number; traceId?: string; depth?: number } = {},
  ): Promise<{ tool: string; output: string; durationMs: number; truncated?: boolean }> {
    const payload = await this.requestStream(
      'peer.tool.invoke.stream',
      { tool: toolName, args },
      onChunk,
      options,
    );
    return payload as { tool: string; output: string; durationMs: number; truncated?: boolean };
  }

  /**
   * Phase (d).13 — generate a unique request id. Combines a per-listener
   * monotonic counter with the current timestamp to keep ids unique
   * even across listener restarts within the same ms.
   */
  private nextRequestId(): string {
    this.requestSeq = (this.requestSeq + 1) >>> 0;
    return `req-${Date.now().toString(36)}-${this.requestSeq.toString(36)}`;
  }

  /**
   * Phase (d).13 — flush any in-flight requests with a DISCONNECTED
   * error so awaiting callers don't hang. Called from disconnect() and
   * on terminal close paths.
   */
  private rejectPendingRequests(reason: string): void {
    if (this.pendingRequests.size === 0) return;
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      const err = new Error(`peer.invoke DISCONNECTED: ${reason}`);
      (err as Error & { code?: string }).code = 'DISCONNECTED';
      pending.reject(err);
    }
    this.pendingRequests.clear();
  }

  /** Phase (d).13 — count of in-flight peer.invoke requests (debug aid). */
  getPendingRequestCount(): number {
    return this.pendingRequests.size;
  }

  getPeerCompactionState(): {
    active: boolean;
    startedAt: number | null;
    ageMs: number | null;
    lastResult: PeerCompactionResult | null;
  } {
    return {
      active: this.peerCompacting,
      startedAt: this.compactingStartedAt,
      ageMs:
        this.peerCompacting && this.compactingStartedAt !== null
          ? Date.now() - this.compactingStartedAt
          : null,
      lastResult: this.lastCompactionResult,
    };
  }
}
