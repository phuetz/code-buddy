/**
 * The companion conversation must survive from one WS message to the next.
 *
 * Reproduces the phone session of 2026-09-06 over the real WS protocol:
 * a selfie, then « Encore une ? ». Before the fix the second turn reached the
 * model with an empty history and no trace of the selfie.
 */
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket, { type WebSocketServer } from 'ws';

import { createUserToken } from '../../src/server/auth/jwt.js';
import { DEFAULT_SERVER_CONFIG } from '../../src/server/types.js';
import { closeAllConnections, setupWebSocket } from '../../src/server/websocket/handler.js';
import type { CodeBuddyMessage } from '../../src/codebuddy/client.js';

const SECRET = 'companion-ws-memory-test-secret-32b';
type Frame = { type: string; payload?: { delta?: string; content?: string } };

const ENV_KEYS = [
  'JWT_SECRET',
  'CODEBUDDY_PROVIDER',
  'OLLAMA_HOST',
  'GROK_MODEL',
  'CODEBUDDY_COMPANION_PERSONA',
  'CODEBUDDY_CHANNEL_PROFILE',
  'CODEBUDDY_LISA_SELFIE',
  'CODEBUDDY_MOBILE_HISTORY_DIR',
] as const;
const saved: Record<string, string | undefined> = {};

let server: HttpServer | undefined;
let wss: WebSocketServer | undefined;
let historyDir: string;

beforeEach(() => {
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  historyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-ws-memory-'));
  process.env.JWT_SECRET = SECRET;
  process.env.CODEBUDDY_PROVIDER = 'ollama';
  process.env.OLLAMA_HOST = 'http://127.0.0.1:4198';
  process.env.GROK_MODEL = 'test-model';
  process.env.CODEBUDDY_COMPANION_PERSONA = 'copine';
  process.env.CODEBUDDY_LISA_SELFIE = 'false';
  process.env.CODEBUDDY_MOBILE_HISTORY_DIR = historyDir;
});

afterEach(async () => {
  closeAllConnections();
  if (wss) {
    for (const client of wss.clients) client.terminate();
    await new Promise<void>((resolve) => wss!.close(() => resolve()));
    wss = undefined;
  }
  if (server?.listening) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  }
  server = undefined;
  fs.rmSync(historyDir, { recursive: true, force: true });
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  vi.restoreAllMocks();
});

async function startServer(): Promise<number> {
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
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  return (server!.address() as AddressInfo).port;
}

async function connect(port: number, events: Frame[]): Promise<WebSocket> {
  const socket = await new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    ws.on('message', (data) => events.push(JSON.parse(data.toString()) as Frame));
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
  socket.send(
    JSON.stringify({
      type: 'authenticate',
      payload: { token: createUserToken('mobile-user', ['chat'], SECRET) },
    }),
  );
  await waitFor(() => events.some((e) => e.type === 'authenticated'));
  return socket;
}

async function waitFor(predicate: () => boolean, timeoutMs = 8_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function say(ws: WebSocket, events: Frame[], message: string): Promise<void> {
  const before = events.length;
  ws.send(JSON.stringify({ type: 'chat', payload: { message, stream: false, assistant: 'companion' } }));
  await waitFor(() =>
    events.slice(before).some((e) => e.type === 'chat_response' || e.type === 'error'),
  );
}

function stubCompanionChat(replies: string[]) {
  const seen: CodeBuddyMessage[][] = [];
  let index = 0;
  return {
    seen,
    install: async () => {
      const mod = await import('../../src/channels/companion-channel-turn.js');
      vi.spyOn(mod, 'runCompanionChannelTurn').mockImplementation(async (input) => {
        seen.push(input.messages);
        const text = replies[Math.min(index, replies.length - 1)] ?? 'ok';
        index += 1;
        return { text, model: 'test-model' };
      });
    },
  };
}

describe('companion WS conversation memory', () => {
  it('carries the previous turns to the next companion message', async () => {
    const stub = stubCompanionChat(['Coucou toi.', 'Oui : tu m’as dit coucou.']);
    await stub.install();
    const port = await startServer();
    const events: Frame[] = [];
    const ws = await connect(port, events);

    await say(ws, events, 'Coucou 💕');
    await say(ws, events, 'tu te souviens de ce que je viens de dire ?');
    ws.close();

    expect(stub.seen.length).toBe(2);
    const second = stub.seen[1] ?? [];
    const roles = second.map((m) => m.role);
    expect(roles).toEqual(['system', 'user', 'assistant', 'user']);
    expect(second[1]?.content).toContain('Coucou');
    expect(second[2]?.content).toBe('Coucou toi.');
    expect(second[3]?.content).toBe('tu te souviens de ce que je viens de dire ?');
  }, 30_000);

  it('restores the history after a reconnection, and never stores image bytes', async () => {
    const stub = stubCompanionChat(['Coucou toi.', 'Je me souviens.']);
    await stub.install();
    const port = await startServer();

    const first: Frame[] = [];
    const wsA = await connect(port, first);
    await say(wsA, first, 'Coucou 💕');
    wsA.close();
    await waitFor(() => wsA.readyState === WebSocket.CLOSED);

    const second: Frame[] = [];
    const wsB = await connect(port, second);
    await say(wsB, second, 'et maintenant ?');
    wsB.close();

    const messages = stub.seen[1] ?? [];
    expect(messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    const files = fs.readdirSync(historyDir);
    expect(files.length).toBe(1);
    const raw = fs.readFileSync(path.join(historyDir, files[0] as string), 'utf8');
    expect(raw).not.toMatch(/base64|image\//);
    expect(files[0]).not.toContain('mobile-user');
  }, 30_000);
});
