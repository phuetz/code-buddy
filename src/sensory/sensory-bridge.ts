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
  port: number;
  close(): Promise<void>;
}

interface RawSensoryFrame {
  modality?: string;
  kind?: string;
  ts_ms?: number;
  salience?: number;
  payload?: unknown;
  token?: string;
}

export function startSensoryBridge(options: SensoryBridgeOptions = {}): SensoryBridgeHandle {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? Number(process.env.CODEBUDDY_SENSORY_PORT ?? 8129);
  const token = options.token ?? process.env.CODEBUDDY_SENSORY_TOKEN;
  const bus = getGlobalEventBus();

  const wss = new WebSocketServer({ host, port });

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

      // Validate/clamp numeric fields so a malformed frame can't poison downstream.
      const salience = Number.isFinite(frame.salience) ? Math.max(0, Math.min(255, Math.round(frame.salience as number))) : 0;
      const tsMs = Number.isFinite(frame.ts_ms) && (frame.ts_ms as number) >= 0 ? (frame.ts_ms as number) : undefined;

      bus.emit('sensory:perception', {
        source: 'buddy-sense',
        metadata: {
          modality: frame.modality,
          kind: frame.kind,
          salience,
          tsMs,
          payload: frame.payload,
        },
      });
    });
  });

  wss.on('error', (err) => logger.warn(`[sensory] bridge error: ${err instanceof Error ? err.message : String(err)}`));
  logger.info(`[sensory] bridge listening on ws://${host}:${port}`);

  return {
    port,
    close: () => new Promise<void>((resolve) => wss.close(() => resolve())),
  };
}
