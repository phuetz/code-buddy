/**
 * Remote Backend Manager (Phase B2).
 *
 * Singleton wrapper around {@link RemoteBackend} that:
 * - wires received ServerEvents back to the renderer via `sendToRenderer`,
 * - pushes connection-status changes to the renderer on the
 *   `remote-backend:status` IPC channel,
 * - persists URL/token via the encrypted config store, with env overrides
 *   (`COWORK_REMOTE_URL` / `COWORK_REMOTE_TOKEN`) applied at boot,
 * - exposes `connect` / `disconnect` / `status` / `forward` to the rest of
 *   the main process.
 *
 * The actual `sendToRenderer` / `BrowserWindow` push is injected so this
 * module is unit-testable without Electron.
 */

import type { ClientEvent, ServerEvent, Session } from '../../renderer/types';
import { log, logError } from '../utils/logger';
import {
  RemoteBackend,
  type RemoteBackendStatusEvent,
} from './remote-backend';
import { remoteBackendConfigStore } from './remote-backend-config-store';

/**
 * How long to wait for the remote backend to emit the canonical
 * `session.update` after a forwarded `session.start` before giving up and
 * resolving the invoke with null (which surfaces as an error notice in the
 * renderer's existing catch path).
 */
const START_ACK_TIMEOUT_MS = 30_000;

export interface RemoteBackendManagerWiring {
  /** Repipe a ServerEvent received from the remote backend to the renderer. */
  sendServerEvent: (event: ServerEvent) => void;
  /** Push a status change to the renderer (separate channel from server-event). */
  sendStatus: (event: RemoteBackendStatusEvent) => void;
}

class RemoteBackendManager {
  private backend: RemoteBackend | null = null;
  private wiring: RemoteBackendManagerWiring | null = null;
  private lastStatus: RemoteBackendStatusEvent = { status: 'disconnected' };

  /**
   * Pending `session.start` resolvers, awaiting the canonical `session.update`
   * the remote emits with the freshly-minted sessionId. FIFO: the next
   * `session.update` resolves the oldest pending start. (The B1 contract only
   * emits `session.update` from `session.start`, never `continue`, so this is
   * safe unless two starts race — see the documented limitation.)
   */
  private pendingStarts: Array<{
    resolve: (session: Session | null) => void;
    timer: NodeJS.Timeout;
  }> = [];

  /**
   * Inject the renderer-facing callbacks. Must be called once during boot,
   * before any connect attempt.
   */
  init(wiring: RemoteBackendManagerWiring): void {
    this.wiring = wiring;
    this.backend = new RemoteBackend({
      onServerEvent: (event) => {
        // Intercept the first session.update after a start to resolve the
        // pending invoke with the canonical Session. The event is STILL
        // repiped to the renderer (the upsert there is idempotent).
        if (event.type === 'session.update' && this.pendingStarts.length > 0) {
          const pending = this.pendingStarts.shift();
          if (pending) {
            clearTimeout(pending.timer);
            const updates = event.payload.updates as Partial<Session>;
            pending.resolve({ ...(updates as Session), id: event.payload.sessionId });
          }
        }
        this.wiring?.sendServerEvent(event);
      },
      onStatus: (event) => {
        this.lastStatus = event;
        this.wiring?.sendStatus(event);
      },
    });
  }

  /**
   * Apply env overrides and optionally auto-connect on boot.
   * `COWORK_REMOTE_URL` / `COWORK_REMOTE_TOKEN` take precedence over the
   * persisted config and force an auto-connect attempt.
   */
  async bootstrap(): Promise<void> {
    const envUrl = process.env.COWORK_REMOTE_URL?.trim();
    const envToken = process.env.COWORK_REMOTE_TOKEN?.trim();

    if (envUrl && envToken) {
      log('[RemoteBackendManager] Env override present; auto-connecting');
      remoteBackendConfigStore.setConfig({ url: envUrl, token: envToken, autoConnect: true });
      try {
        await this.connect(envUrl, envToken);
      } catch (err) {
        logError('[RemoteBackendManager] Env auto-connect failed:', err instanceof Error ? err.message : err);
      }
      return;
    }

    const cfg = remoteBackendConfigStore.getConfig();
    if (cfg.autoConnect && cfg.url && cfg.token) {
      try {
        await this.connect(cfg.url, cfg.token);
      } catch (err) {
        logError('[RemoteBackendManager] Auto-connect failed:', err instanceof Error ? err.message : err);
      }
    }
  }

  async connect(url: string, token: string): Promise<{ success: boolean; error?: string }> {
    if (!this.backend) {
      return { success: false, error: 'Remote backend not initialized' };
    }
    try {
      await this.backend.connect(url, token);
      // Persist on success (token stored encrypted). Keep autoConnect true so
      // the desktop reconnects on next boot.
      remoteBackendConfigStore.setConfig({ url, token, autoConnect: true });
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  disconnect(): { success: boolean } {
    this.backend?.disconnect();
    remoteBackendConfigStore.setConfig({ autoConnect: false });
    this.rejectPendingStarts();
    return { success: true };
  }

  private rejectPendingStarts(): void {
    for (const pending of this.pendingStarts.splice(0)) {
      clearTimeout(pending.timer);
      pending.resolve(null);
    }
  }

  status(): RemoteBackendStatusEvent {
    return this.backend ? this.backend.status() : this.lastStatus;
  }

  isConnected(): boolean {
    return this.backend?.isConnected() ?? false;
  }

  /**
   * Forward a core ClientEvent to the remote backend if connected and the
   * event is forwardable. Returns true if it was handled remotely.
   */
  forward(event: ClientEvent): boolean {
    return this.backend?.forward(event) ?? false;
  }

  describeControlPlane(): Promise<unknown> {
    return this.backend?.requestControl('describe') ?? Promise.reject(new Error('Remote backend not initialized'));
  }

  invokeControl(method: string): Promise<unknown> {
    return this.backend?.requestControl('invoke', { method }) ?? Promise.reject(new Error('Remote backend not initialized'));
  }

  /**
   * Forward a `session.start` and resolve with the canonical Session once the
   * remote emits its `session.update`. The renderer awaits this via invoke()
   * to add + activate the session and echo the user message — so this must
   * resolve with a real Session (or null on failure/timeout, which routes to
   * the renderer's existing error path).
   */
  forwardStart(event: ClientEvent & { type: 'session.start' }): Promise<Session | null> {
    if (!this.backend?.forward(event)) {
      return Promise.resolve(null);
    }
    return new Promise<Session | null>((resolve) => {
      const timer = setTimeout(() => {
        const idx = this.pendingStarts.findIndex((p) => p.timer === timer);
        if (idx >= 0) this.pendingStarts.splice(idx, 1);
        logError('[RemoteBackendManager] session.start ack timed out');
        resolve(null);
      }, START_ACK_TIMEOUT_MS);
      this.pendingStarts.push({ resolve, timer });
    });
  }
}

export const remoteBackendManager = new RemoteBackendManager();
