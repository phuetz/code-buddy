/**
 * Remote Backend transport (Phase B2).
 *
 * Carries the WebSocket connection to a REMOTE Code Buddy backend's
 * dedicated `/desktop` endpoint, entirely inside the MAIN process. When a
 * remote backend is connected, the core session.* ClientEvents are
 * forwarded over this socket instead of the LOCAL session-manager, and the
 * ServerEvents that come back are repiped to the renderer via the supplied
 * callback (the caller wires it to `sendToRenderer`).
 *
 * Design notes:
 * - This module does NOT import `ipc-main-bridge` or any renderer surface.
 *   It takes `onServerEvent` / `onStatus` callbacks so it stays unit-testable
 *   with a mocked `ws` (no Electron, no IPC).
 * - The JWT token is appended as `?token=<jwt>` to the `/desktop` URL. The
 *   token is NEVER logged — log lines strip the query string.
 * - Only the four events named by the B1 contract are forwarded:
 *   `session.start`, `session.continue`, `session.stop`, `session.list`.
 *   Everything else stays on the local path.
 * - MVP: no automatic reconnect loop. Connection is manual.
 */

import { WebSocket } from 'ws';
import type { ClientEvent, ServerEvent } from '../../renderer/types';
import { log, logError, logWarn } from '../utils/logger';

export type RemoteBackendStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';

export interface RemoteBackendStatusEvent {
  status: RemoteBackendStatus;
  /** Host (and optional port) parsed from the URL — safe to display, no token. */
  host?: string;
  error?: string;
}

/** The ClientEvent types the remote `/desktop` contract accepts. */
const FORWARDABLE_EVENT_TYPES: ReadonlySet<ClientEvent['type']> = new Set<
  ClientEvent['type']
>(['session.start', 'session.continue', 'session.stop', 'session.list']);

export function isForwardableToRemote(event: ClientEvent): boolean {
  return FORWARDABLE_EVENT_TYPES.has(event.type);
}

/**
 * Strip the query string (token lives there) before logging a URL.
 */
function redactUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    const idx = rawUrl.indexOf('?');
    return idx >= 0 ? rawUrl.slice(0, idx) : rawUrl;
  }
}

/**
 * Build the `/desktop` WebSocket URL from a user-supplied base URL.
 * Accepts `ws://`, `wss://`, `http://`, `https://`. http(s) is rewritten
 * to ws(s). If the base already ends in `/desktop` it is left as-is.
 */
export function buildDesktopUrl(baseUrl: string, token: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  let normalized = trimmed;
  if (normalized.startsWith('https://')) {
    normalized = 'wss://' + normalized.slice('https://'.length);
  } else if (normalized.startsWith('http://')) {
    normalized = 'ws://' + normalized.slice('http://'.length);
  } else if (!normalized.startsWith('ws://') && !normalized.startsWith('wss://')) {
    // Default to ws:// for bare host:port
    normalized = 'ws://' + normalized;
  }
  const withPath = /\/desktop$/.test(normalized) ? normalized : `${normalized}/desktop`;
  const sep = withPath.includes('?') ? '&' : '?';
  return `${withPath}${sep}token=${encodeURIComponent(token)}`;
}

function hostFromUrl(rawUrl: string): string | undefined {
  try {
    return new URL(rawUrl).host;
  } catch {
    return undefined;
  }
}

export interface RemoteBackendCallbacks {
  /** Called for every ServerEvent received from the remote backend. */
  onServerEvent: (event: ServerEvent) => void;
  /** Called whenever the connection status changes. */
  onStatus: (event: RemoteBackendStatusEvent) => void;
}

export class RemoteBackend {
  private ws: WebSocket | null = null;
  private currentStatus: RemoteBackendStatus = 'disconnected';
  private host: string | undefined;
  private readonly callbacks: RemoteBackendCallbacks;
  private pendingControl = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();

  constructor(callbacks: RemoteBackendCallbacks) {
    this.callbacks = callbacks;
  }

  /**
   * Open a WebSocket to `<baseUrl>/desktop?token=<token>`.
   * Resolves once the socket is open (or rejects on the first error).
   */
  connect(baseUrl: string, token: string): Promise<void> {
    if (!baseUrl.trim()) {
      return Promise.reject(new Error('Remote backend URL is required'));
    }
    if (!token.trim()) {
      return Promise.reject(new Error('Remote backend token is required'));
    }

    // Tear down any existing socket first.
    this.disconnect();

    const url = buildDesktopUrl(baseUrl, token);
    this.host = hostFromUrl(url);
    this.setStatus('connecting');
    log('[RemoteBackend] Connecting to', redactUrl(url));

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch (err) {
        this.setStatus('error', err instanceof Error ? err.message : String(err));
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      this.ws = ws;

      ws.on('open', () => {
        settled = true;
        this.setStatus('connected');
        log('[RemoteBackend] Connected to', redactUrl(url));
        resolve();
      });

      ws.on('message', (data: unknown) => {
        this.handleMessage(data);
      });

      ws.on('error', (err: Error) => {
        // Do not log the URL with token; err.message from ws is token-free.
        logError('[RemoteBackend] WebSocket error:', err?.message ?? err);
        this.setStatus('error', err?.message ?? 'WebSocket error');
        if (!settled) {
          settled = true;
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });

      ws.on('close', (code: number) => {
        log('[RemoteBackend] WebSocket closed (code', code, ')');
        if (this.ws === ws) {
          this.ws = null;
        }
        // Only emit disconnected if we are not already in an error state from
        // the same teardown — avoids overwriting a meaningful error message.
        if (this.currentStatus !== 'error') {
          this.setStatus('disconnected');
        }
        if (!settled) {
          settled = true;
          reject(new Error(`Connection closed before open (code ${code})`));
        }
      });
    });
  }

  disconnect(): void {
    const ws = this.ws;
    if (ws) {
      this.ws = null;
      try {
        ws.removeAllListeners();
        ws.close();
      } catch (err) {
        logWarn('[RemoteBackend] Error during disconnect:', err);
      }
    }
    if (this.currentStatus !== 'disconnected') {
      this.setStatus('disconnected');
    }
    for (const pending of this.pendingControl.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Remote backend disconnected'));
    }
    this.pendingControl.clear();
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  status(): RemoteBackendStatusEvent {
    return {
      status: this.currentStatus,
      host: this.host,
    };
  }

  /**
   * Forward a (forwardable) core ClientEvent to the remote backend.
   * Returns true if the event was sent, false otherwise (caller should then
   * keep the event on the local path).
   */
  forward(event: ClientEvent): boolean {
    if (!this.isConnected() || !this.ws) {
      return false;
    }
    if (!isForwardableToRemote(event)) {
      return false;
    }
    try {
      this.ws.send(JSON.stringify(event));
      return true;
    } catch (err) {
      logError('[RemoteBackend] Failed to forward event', event.type, ':', err);
      return false;
    }
  }

  requestControl(method: 'describe' | 'invoke', payload: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.isConnected() || !this.ws) return Promise.reject(new Error('Remote backend is not connected'));
    const requestId = `control_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingControl.delete(requestId);
        reject(new Error('Remote control request timed out'));
      }, 10_000);
      this.pendingControl.set(requestId, { resolve, reject, timer });
      this.ws!.send(JSON.stringify({ type: `control.${method}`, payload, requestId }));
    });
  }

  private handleMessage(data: unknown): void {
    let text: string;
    if (typeof data === 'string') {
      text = data;
    } else if (data instanceof Buffer) {
      text = data.toString('utf-8');
    } else if (Array.isArray(data)) {
      text = Buffer.concat(data as Buffer[]).toString('utf-8');
    } else {
      text = String(data);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      logWarn('[RemoteBackend] Received non-JSON frame; ignoring');
      return;
    }

    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof (parsed as { type?: unknown }).type !== 'string'
    ) {
      logWarn('[RemoteBackend] Received frame without a type; ignoring');
      return;
    }

    if ((parsed as { type: string }).type === 'control.result') {
      const payload = (parsed as { payload?: { requestId?: string; ok?: boolean; result?: unknown; error?: string } }).payload;
      const requestId = payload?.requestId;
      if (requestId) {
        const pending = this.pendingControl.get(requestId);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingControl.delete(requestId);
          if (payload?.ok) pending.resolve(payload.result);
          else pending.reject(new Error(payload?.error || 'Remote control request failed'));
        }
      }
      return;
    }

    // Trust the server contract: the frame is a ServerEvent. Repipe it.
    this.callbacks.onServerEvent(parsed as ServerEvent);
  }

  private setStatus(status: RemoteBackendStatus, error?: string): void {
    this.currentStatus = status;
    const event: RemoteBackendStatusEvent = { status };
    if (this.host) event.host = this.host;
    if (error) event.error = error;
    this.callbacks.onStatus(event);
  }
}
