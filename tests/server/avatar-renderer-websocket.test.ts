import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import { resetAvatarRendererRegistry } from '../../src/avatar/avatar-renderer-registry.js';
import { resetDatabaseManager } from '../../src/database/database-manager.js';
import { generateToken } from '../../src/server/auth/jwt.js';

type StartedServer = Awaited<ReturnType<typeof import('../../src/server/index.js').startServer>>;
type Frame = { type: string; payload?: Record<string, unknown>; error?: { code?: string } };

const JWT_SECRET = 'avatar-renderer-websocket-test-secret';

describe('avatar renderer Gateway feedback', () => {
  let started: StartedServer | null = null;
  let home = '';
  let previousHome: string | undefined;
  let previousSecret: string | undefined;

  beforeEach(() => {
    previousHome = process.env.CODEBUDDY_HOME;
    previousSecret = process.env.JWT_SECRET;
    home = mkdtempSync(join(tmpdir(), 'avatar-ws-'));
    process.env.CODEBUDDY_HOME = home;
    process.env.JWT_SECRET = JWT_SECRET;
    resetAvatarRendererRegistry();
    resetDatabaseManager();
  });

  afterEach(async () => {
    if (started) {
      const { stopServer } = await import('../../src/server/index.js');
      await stopServer(started.server);
      started = null;
    }
    resetAvatarRendererRegistry();
    resetDatabaseManager();
    if (previousHome === undefined) delete process.env.CODEBUDDY_HOME;
    else process.env.CODEBUDDY_HOME = previousHome;
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
    rmSync(home, { recursive: true, force: true });
  });

  async function start(): Promise<string> {
    const { startServer } = await import('../../src/server/index.js');
    started = await startServer({
      port: 0,
      host: '127.0.0.1',
      authEnabled: true,
      jwtSecret: JWT_SECRET,
      websocketEnabled: true,
      logging: false,
      rateLimit: false,
      cors: false,
      docsEnabled: false,
      securityHeaders: { enabled: false },
    });
    const address = started.server.address() as AddressInfo;
    return `ws://127.0.0.1:${address.port}/ws`;
  }

  it('authenticates, registers, reports playback, and exposes bounded status', async () => {
    const url = await start();
    const token = generateToken(
      { sub: 'darkstar-avatar', scopes: ['avatar:read', 'avatar:write'], type: 'user' },
      JWT_SECRET,
      '1h'
    );
    const frames: Frame[] = [];

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error(`avatar websocket timed out: ${frames.map((frame) => frame.type).join(',')}`));
      }, 10_000);
      ws.on('message', (raw) => {
        const frame = JSON.parse(raw.toString()) as Frame;
        frames.push(frame);
        if (frame.type === 'connected') {
          ws.send(JSON.stringify({ type: 'authenticate', payload: { token } }));
        } else if (frame.type === 'authenticated') {
          ws.send(JSON.stringify({
            type: 'avatar.renderer.hello',
            payload: {
              rendererId: 'darkstar-metahuman',
              protocolVersion: 1,
              runtime: 'unreal',
              runtimeVersion: '5.8',
              capabilities: { wavStream: true, audioDrivenAnimation: true },
            },
          }));
        } else if (frame.type === 'avatar.renderer.ack' && frame.payload?.kind === 'hello') {
          ws.send(JSON.stringify({
            type: 'avatar.renderer.status',
            payload: {
              rendererId: 'darkstar-metahuman',
              phase: 'playing',
              activeTurnId: 'turn-live',
              lastSequence: 7,
              fps: 60,
              mouthLatencyMs: 32,
              droppedAudioChunks: 0,
            },
          }));
        } else if (frame.type === 'avatar.renderer.ack' && frame.payload?.kind === 'status') {
          ws.send(JSON.stringify({ type: 'avatar.status' }));
        } else if (frame.type === 'avatar.status') {
          clearTimeout(timer);
          ws.close();
          resolve();
        }
      });
      ws.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });

    const status = frames.find((frame) => frame.type === 'avatar.status');
    expect(status?.payload?.renderers).toEqual([
      expect.objectContaining({
        rendererId: 'darkstar-metahuman',
        runtime: 'unreal',
        phase: 'playing',
        activeTurnId: 'turn-live',
        lastSequence: 7,
        mouthLatencyMs: 32,
        connected: true,
      }),
    ]);
  }, 15_000);
});
