import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket, { type WebSocketServer } from 'ws';

import { createUserToken } from '../../src/server/auth/jwt.js';
import { DEFAULT_SERVER_CONFIG } from '../../src/server/types.js';
import {
  closeAllConnections,
  setupWebSocket,
} from '../../src/server/websocket/handler.js';
import { ConfirmationService } from '../../src/utils/confirmation-service.js';

const SECRET = 'mobile-confirm-test-secret-32b-minimum';

type Frame = {
  type: string;
  payload?: Record<string, unknown>;
  error?: { code?: string; message?: string };
};

async function waitUntil(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function connect(
  url: string,
  headers?: Record<string, string>,
): Promise<{ ws: WebSocket; events: Frame[] }> {
  return new Promise((resolve, reject) => {
    const ws = headers ? new WebSocket(url, { headers }) : new WebSocket(url);
    const events: Frame[] = [];
    ws.on('message', (data) => {
      events.push(JSON.parse(data.toString()) as Frame);
    });
    ws.once('open', () => resolve({ ws, events }));
    ws.once('error', reject);
  });
}

describe('Mobile WS confirmations', () => {
  let server: HttpServer;
  let wss: WebSocketServer;
  let wsBase: string;
  const previousSecret = process.env.JWT_SECRET;
  const previousTimeout = process.env.CODEBUDDY_MOBILE_CONFIRM_TIMEOUT_MS;

  beforeEach(async () => {
    process.env.JWT_SECRET = SECRET;
    process.env.CODEBUDDY_MOBILE_CONFIRM_TIMEOUT_MS = '200';
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
    const address = server.address() as AddressInfo;
    wsBase = `ws://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    closeAllConnections();
    for (const client of wss.clients) client.terminate();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
    if (previousTimeout === undefined) delete process.env.CODEBUDDY_MOBILE_CONFIRM_TIMEOUT_MS;
    else process.env.CODEBUDDY_MOBILE_CONFIRM_TIMEOUT_MS = previousTimeout;
  });

  async function authedClient(): Promise<{ ws: WebSocket; events: Frame[] }> {
    const { ws, events } = await connect(`${wsBase}/ws`);
    const token = createUserToken('mobile-user', ['chat'], SECRET);
    ws.send(JSON.stringify({ type: 'authenticate', payload: { token } }));
    await waitUntil(() => events.some((event) => event.type === 'authenticated'));
    return { ws, events };
  }

  it('approves a forcePrompt confirmation from an authenticated client', async () => {
    const { ws, events } = await authedClient();
    const pending = ConfirmationService.getInstance().requestConfirmation(
      { operation: 'write', filename: 'notes.md', toolName: 'write_file', forcePrompt: true },
      'file',
    );
    await waitUntil(() => events.some((event) => event.type === 'confirmation_required'));
    const required = events.find((event) => event.type === 'confirmation_required');
    const id = required?.payload?.id;
    expect(typeof id).toBe('string');
    expect(required?.payload).toEqual(expect.objectContaining({
      tool: 'write_file',
      summary: expect.stringContaining('write'),
      risk: expect.any(String),
    }));
    ws.send(JSON.stringify({
      type: 'confirmation_response',
      payload: { id, approved: true },
    }));
    await expect(pending).resolves.toEqual({ confirmed: true });
    ws.close();
  });

  it('denies when the timeout elapses with no response', async () => {
    const { ws } = await authedClient();
    const pending = ConfirmationService.getInstance().requestConfirmation(
      { operation: 'bash', filename: 'ls', toolName: 'bash', forcePrompt: true, riskLevel: 'high' },
      'bash',
    );
    await expect(pending).resolves.toEqual({
      confirmed: false,
      feedback: 'Confirmation timed out',
    });
    ws.close();
  });

  it('rejects a second response for the same id', async () => {
    const { ws, events } = await authedClient();
    const pending = ConfirmationService.getInstance().requestConfirmation(
      { operation: 'write', filename: 'a.ts', toolName: 'write_file', forcePrompt: true },
      'file',
    );
    await waitUntil(() => events.some((event) => event.type === 'confirmation_required'));
    const id = events.find((event) => event.type === 'confirmation_required')?.payload?.id;
    ws.send(JSON.stringify({ type: 'confirmation_response', payload: { id, approved: false } }));
    await expect(pending).resolves.toEqual({ confirmed: false });
    ws.send(JSON.stringify({ type: 'confirmation_response', payload: { id, approved: true } }));
    await waitUntil(() => events.some((event) => event.error?.code === 'ALREADY_ANSWERED'
      || event.error?.code === 'UNKNOWN_CONFIRMATION'));
    ws.close();
  });

  it('requires authentication for confirmation_response', async () => {
    const { ws, events } = await connect(`${wsBase}/ws`);
    await waitUntil(() => events.some((event) => event.type === 'connected'));
    ws.send(JSON.stringify({
      type: 'confirmation_response',
      payload: { id: 'nope', approved: true },
    }));
    await waitUntil(() => events.some((event) => event.error?.code === 'UNAUTHORIZED'));
    ws.close();
  });
});

describe('A-1 confirmation_response rejects anonymousRemote', () => {
  let server: HttpServer;
  let wss: WebSocketServer;
  let wsBase: string;
  const previousSecret = process.env.JWT_SECRET;
  const previousTimeout = process.env.CODEBUDDY_MOBILE_CONFIRM_TIMEOUT_MS;

  beforeEach(async () => {
    process.env.JWT_SECRET = SECRET;
    process.env.CODEBUDDY_MOBILE_CONFIRM_TIMEOUT_MS = '3000';
    server = createServer((_req, res) => {
      res.statusCode = 404;
      res.end();
    });
    wss = await setupWebSocket(server, {
      ...DEFAULT_SERVER_CONFIG,
      port: 0,
      host: '127.0.0.1',
      authEnabled: false,
      jwtSecret: SECRET,
      websocketEnabled: true,
      cors: false,
      logging: false,
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    wsBase = `ws://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    closeAllConnections();
    for (const client of wss.clients) client.terminate();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
    if (previousTimeout === undefined) delete process.env.CODEBUDDY_MOBILE_CONFIRM_TIMEOUT_MS;
    else process.env.CODEBUDDY_MOBILE_CONFIRM_TIMEOUT_MS = previousTimeout;
  });

  it('refuses confirmation_response from a --no-auth remote socket and still accepts loopback', async () => {
    const remote = await connect(`${wsBase}/ws`, { 'X-Forwarded-For': '203.0.113.50' });
    const loopback = await connect(`${wsBase}/ws`);
    await waitUntil(() => remote.events.some((event) => event.type === 'connected'));
    await waitUntil(() => loopback.events.some((event) => event.type === 'connected'));

    const pending = ConfirmationService.getInstance().requestConfirmation(
      { operation: 'write', filename: 'notes.md', toolName: 'write_file', forcePrompt: true },
      'file',
    );

    await waitUntil(() => loopback.events.some((event) => event.type === 'confirmation_required')
      || remote.events.some((event) => event.type === 'confirmation_required'));
    const id = (loopback.events.find((event) => event.type === 'confirmation_required')
      ?? remote.events.find((event) => event.type === 'confirmation_required'))?.payload?.id;
    expect(typeof id).toBe('string');

    let settled: unknown;
    void pending.then((value) => { settled = value; });

    remote.ws.send(JSON.stringify({
      type: 'confirmation_response',
      payload: { id, approved: true },
    }));
    await waitUntil(() => remote.events.some((event) => event.error?.code === 'UNAUTHORIZED'));
    expect(settled).toBeUndefined();

    loopback.ws.send(JSON.stringify({
      type: 'confirmation_response',
      payload: { id, approved: true },
    }));
    await expect(pending).resolves.toEqual({ confirmed: true });

    remote.ws.close();
    loopback.ws.close();
  });
});
