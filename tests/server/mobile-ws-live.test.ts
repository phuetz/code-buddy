/**
 * Live WS chat against a local Ollama. Skips when the host is down so
 * `tests/server` stays hermetic; the mission proof runs this with the
 * host up.
 */
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket, { type WebSocketServer } from 'ws';

import { createUserToken } from '../../src/server/auth/jwt.js';
import { DEFAULT_SERVER_CONFIG } from '../../src/server/types.js';
import {
  closeAllConnections,
  setupWebSocket,
} from '../../src/server/websocket/handler.js';

const SECRET = 'mobile-ws-live-test-secret-32bytes';
const OLLAMA = process.env.OLLAMA_HOST || 'http://127.0.0.1:11435';
const MODEL = process.env.GROK_MODEL || 'qwen3.8-ctx32k:latest';

type Frame = { type: string; payload?: { delta?: string; content?: string } };

async function ollamaUp(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA.replace(/\/$/, '')}/api/tags`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

describe.skipIf(process.env.RUN_MOBILE_LIVE !== '1')('Mobile WS live Ollama', () => {
  let server: HttpServer;
  let wss: WebSocketServer;
  const previous = {
    jwt: process.env.JWT_SECRET,
    provider: process.env.CODEBUDDY_PROVIDER,
    ollama: process.env.OLLAMA_HOST,
    model: process.env.GROK_MODEL,
  };

  afterEach(async () => {
    closeAllConnections();
    if (wss) {
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    }
    if (server?.listening) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    restore('JWT_SECRET', previous.jwt);
    restore('CODEBUDDY_PROVIDER', previous.provider);
    restore('OLLAMA_HOST', previous.ollama);
    restore('GROK_MODEL', previous.model);
  });

  function restore(key: string, value: string | undefined): void {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  it('streams an agent reply over the real WS protocol', async () => {
    if (!(await ollamaUp())) {
      throw new Error(`Ollama not reachable at ${OLLAMA}`);
    }
    process.env.JWT_SECRET = SECRET;
    process.env.CODEBUDDY_PROVIDER = 'ollama';
    process.env.OLLAMA_HOST = OLLAMA;
    process.env.GROK_MODEL = MODEL;

    server = createServer((_req, res) => {
      res.statusCode = 404;
      res.end();
    });
    wss = await setupWebSocket(server, {
      ...DEFAULT_SERVER_CONFIG,
      port: 0,
      host: '127.0.0.1',
      authEnabled: true,
      jwtSecret: SECRET,
      websocketEnabled: true,
      cors: false,
      logging: false,
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    expect(port).toBeGreaterThanOrEqual(0);

    const events: Frame[] = [];
    const ws = await new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      socket.on('message', (data) => {
        events.push(JSON.parse(data.toString()) as Frame);
      });
      socket.once('open', () => resolve(socket));
      socket.once('error', reject);
    });

    ws.send(JSON.stringify({
      type: 'authenticate',
      payload: { token: createUserToken('mobile-user', ['chat'], SECRET) },
    }));
    await waitFor(() => events.some((event) => event.type === 'authenticated'));
    ws.send(JSON.stringify({
      type: 'chat',
      payload: { message: 'Réponds : OK MOBILE', stream: true, assistant: 'agent' },
    }));
    await waitFor(() => events.some((event) => event.type === 'stream_end' || event.type === 'error'), 60_000);
    const error = events.find((event) => event.type === 'error');
    expect(error, error ? JSON.stringify(error) : 'no error').toBeUndefined();
    const text = events
      .filter((event) => event.type === 'stream_chunk')
      .map((event) => event.payload?.delta ?? '')
      .join('');
    expect(events.some((event) => event.type === 'stream_start')).toBe(true);
    expect(text.length).toBeGreaterThan(0);
    expect(events.some((event) => event.type === 'stream_end')).toBe(true);
    ws.close();
  }, 90_000);
});

async function waitFor(predicate: () => boolean, timeoutMs = 8_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
