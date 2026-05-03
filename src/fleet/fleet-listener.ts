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
}

interface IncomingMessage {
  type: string;
  payload?: Record<string, unknown>;
  error?: { code: string; message: string };
  timestamp?: string;
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
  private readonly options: FleetListenerOptions;
  private readonly reconnector: ReconnectionManager | null;

  constructor(options: FleetListenerOptions) {
    super();
    if (!options.apiKey && !options.jwt) {
      throw new Error('FleetListener requires apiKey or jwt');
    }
    this.options = options;
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
    // Fleet event re-emit. We forward type + payload as-is so consumers
    // can pattern-match on 'fleet:agent:tool_started' etc.
    if (msg.type.startsWith('fleet:')) {
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
}
