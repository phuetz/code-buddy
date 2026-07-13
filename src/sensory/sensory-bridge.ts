/**
 * Sensory bridge — the ingress for the Rust `buddy-sense` nervous-system daemon.
 *
 * A loopback-only WebSocket server that receives `SensoryEvent` JSON frames from
 * the daemon and re-emits them onto Code Buddy's internal event bus as
 * `sensory:perception` events. Reactions (reactions.ts) subscribe to the bus.
 *
 * Opt-in via `CODEBUDDY_SENSORY=true` (wired in `buddy server`). Loopback-only +
 * optional shared token. Never throws on a malformed frame.
 *
 * @module sensory/sensory-bridge
 */

import { WebSocketServer } from 'ws';
import { getGlobalEventBus } from '../events/event-bus.js';
import { logger } from '../utils/logger.js';

export interface SensoryBridgeOptions {
  host?: string;
  port?: number;
  /** If set, frames must carry a matching `token` field. */
  token?: string;
}

export interface SensoryBridgeHandle {
  readonly port: number;
  /** Resolves only after the socket is bound; rejects on bind failure. */
  ready: Promise<void>;
  close(): Promise<void>;
}

export interface SensoryBridgeHealth {
  status: 'disabled' | 'starting' | 'listening' | 'error' | 'closed';
  ready: boolean;
  port?: number;
  error?: string;
}

interface RawSensoryFrame {
  modality?: string;
  kind?: string;
  ts_ms?: number;
  salience?: number;
  payload?: unknown;
  token?: string;
}

/** The trust boundary: only known modalities pass; kinds are sanitized to a safe
 * shape (no control chars / newlines, ≤64 chars) so a crafted local frame can't
 * inject content downstream (e.g. into CODEBUDDY_MEMORY.md via dreaming). */
const KNOWN_MODALITIES = new Set(['audio', 'vision', 'screen', 'vital', 'ui']);

let bridgeHealth: SensoryBridgeHealth = { status: 'disabled', ready: false };

/** Lightweight process-local status consumed by the HTTP health endpoints. */
export function getSensoryBridgeHealth(): SensoryBridgeHealth {
  return { ...bridgeHealth };
}

function sanitizeKind(kind: string): string {
  return kind.replace(/[^a-zA-Z0-9_:.-]/g, '').slice(0, 64);
}

export function startSensoryBridge(options: SensoryBridgeOptions = {}): SensoryBridgeHandle {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? Number(process.env.CODEBUDDY_SENSORY_PORT ?? 8129);
  const token = options.token ?? process.env.CODEBUDDY_SENSORY_TOKEN;
  const bus = getGlobalEventBus();

  const wss = new WebSocketServer({ host, port });
  bridgeHealth = { status: 'starting', ready: false, port };

  let readySettled = false;
  const ready = new Promise<void>((resolve, reject) => {
    wss.once('listening', () => {
      readySettled = true;
      const address = wss.address();
      const boundPort = typeof address === 'object' && address ? address.port : port;
      bridgeHealth = { status: 'listening', ready: true, port: boundPort };
      logger.info(`[sensory] bridge listening on ws://${host}:${boundPort}`);
      resolve();
    });

    wss.on('error', (err) => {
      const code = (err as NodeJS.ErrnoException).code;
      const message = err instanceof Error ? err.message : String(err);
      bridgeHealth = { status: 'error', ready: false, port, error: message };
      if (code === 'EADDRINUSE') {
        logger.error(
          `[sensory] bridge cannot bind ws://${host}:${port}: port already in use; sensory input is unavailable`,
        );
      } else {
        logger.error(`[sensory] bridge error on ws://${host}:${port}: ${message}`);
      }
      if (!readySettled) {
        readySettled = true;
        reject(err);
      }
    });
  });

  wss.on('connection', (ws, req) => {
    // Reject cross-origin (CSWSH): the Rust daemon sends NO Origin header; a
    // browser page / extension always does. This stops a local web origin from
    // injecting frames (and, with the camera reaction on, triggering the webcam).
    if (req.headers.origin) {
      ws.close();
      return;
    }
    // Loopback-only: exact match, tolerating IPv4-mapped IPv6 (::ffff:127.0.0.1).
    const remote = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
    if (remote !== '127.0.0.1' && remote !== '::1') {
      ws.close();
      return;
    }
    logger.info('[sensory] daemon connected');

    ws.on('message', (data) => {
      let frame: RawSensoryFrame;
      try {
        frame = JSON.parse(String(data)) as RawSensoryFrame;
      } catch {
        return; // ignore malformed
      }
      if (token && frame.token !== token) return;
      if (!frame.modality || !frame.kind) return;
      // Validate the string fields at the trust boundary (not just the numbers):
      // unknown modality is dropped, kind is sanitized — blocks memory injection.
      if (!KNOWN_MODALITIES.has(frame.modality)) return;
      const kind = sanitizeKind(frame.kind);
      if (!kind) return;

      // Validate/clamp numeric fields so a malformed frame can't poison downstream.
      const salience = Number.isFinite(frame.salience) ? Math.max(0, Math.min(255, Math.round(frame.salience as number))) : 0;
      const tsMs = Number.isFinite(frame.ts_ms) && (frame.ts_ms as number) >= 0 ? (frame.ts_ms as number) : undefined;

      bus.emit('sensory:perception', {
        source: 'buddy-sense',
        metadata: {
          modality: frame.modality,
          kind,
          salience,
          tsMs,
          payload: frame.payload,
        },
      });
    });
  });

  return {
    get port() {
      const address = wss.address();
      return typeof address === 'object' && address ? address.port : port;
    },
    ready,
    close: () =>
      new Promise<void>((resolve) => {
        wss.close(() => {
          bridgeHealth = { status: 'closed', ready: false, port };
          resolve();
        });
      }),
  };
}
