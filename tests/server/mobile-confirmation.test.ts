import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket, { type WebSocketServer } from 'ws';
import { logger } from '../../src/utils/logger.js';

import { createUserToken } from '../../src/server/auth/jwt.js';
import { DEFAULT_SERVER_CONFIG } from '../../src/server/types.js';
import {
  closeAllConnections,
  collectApprovalSurfaceIds,
  setupWebSocket,
} from '../../src/server/websocket/handler.js';
import { ConfirmationService } from '../../src/utils/confirmation-service.js';

const SECRET = 'mobile-confirm-test-secret-32b-minimum';
const previousPwaFlag = process.env.CODEBUDDY_MOBILE_PWA;

function enableMobilePwa(): void {
  process.env.CODEBUDDY_MOBILE_PWA = 'true';
}

function restoreMobilePwa(): void {
  if (previousPwaFlag === undefined) delete process.env.CODEBUDDY_MOBILE_PWA;
  else process.env.CODEBUDDY_MOBILE_PWA = previousPwaFlag;
}

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
    enableMobilePwa();
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
    restoreMobilePwa();
  });

  async function authedClient(): Promise<{ ws: WebSocket; events: Frame[] }> {
    const { ws, events } = await connect(`${wsBase}/ws`);
    const token = createUserToken('mobile-user', ['chat', 'tools'], SECRET);
    ws.send(JSON.stringify({ type: 'authenticate', payload: { token, approvalCapable: true } }));
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
    enableMobilePwa();
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
    restoreMobilePwa();
  });

  it('refuses confirmation_response from a --no-auth remote socket and still accepts loopback', async () => {
    const remote = await connect(`${wsBase}/ws`, { 'X-Forwarded-For': '203.0.113.50' });
    const loopback = await connect(`${wsBase}/ws`);
    await waitUntil(() => remote.events.some((event) => event.type === 'connected'));
    await waitUntil(() => loopback.events.some((event) => event.type === 'connected'));
    loopback.ws.send(JSON.stringify({ type: 'status', payload: { approvalCapable: true } }));
    await waitUntil(() => loopback.events.some((event) => event.type === 'status'));

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

  it('C-1 status ignores approvalCapable on anonymous remote socket with warn', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const remote = await connect(`${wsBase}/ws`, { 'X-Forwarded-For': '203.0.113.50' });
    await waitUntil(() => remote.events.some((event) => event.type === 'connected'));
    remote.ws.send(JSON.stringify({ type: 'status', payload: { approvalCapable: true } }));
    await waitUntil(() => remote.events.some((event) => event.type === 'status'));
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('[ws] status approvalCapable ignored'),
      expect.objectContaining({ anonymousRemote: true }),
    );
    expect(collectApprovalSurfaceIds()).toHaveLength(0);
    warn.mockRestore();
    remote.ws.close();
  });
});

describe('B-2 confirmation is scoped, bound, and opt-in as an approval surface', () => {
  let server: HttpServer;
  let wss: WebSocketServer;
  let wsBase: string;
  const previousSecret = process.env.JWT_SECRET;
  const previousTimeout = process.env.CODEBUDDY_MOBILE_CONFIRM_TIMEOUT_MS;
  const originalStdinIsTTY = process.stdin.isTTY;

  beforeEach(async () => {
    enableMobilePwa();
    process.env.JWT_SECRET = SECRET;
    process.env.CODEBUDDY_MOBILE_CONFIRM_TIMEOUT_MS = '2000';
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
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
    Object.defineProperty(process.stdin, 'isTTY', { value: originalStdinIsTTY, configurable: true });
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
    if (previousTimeout === undefined) delete process.env.CODEBUDDY_MOBILE_CONFIRM_TIMEOUT_MS;
    else process.env.CODEBUDDY_MOBILE_CONFIRM_TIMEOUT_MS = previousTimeout;
    restoreMobilePwa();
  });

  async function clientWith(
    scopes: Parameters<typeof createUserToken>[1],
    extra: { approvalCapable?: boolean; userId?: string } = {},
  ): Promise<{ ws: WebSocket; events: Frame[] }> {
    const { ws, events } = await connect(`${wsBase}/ws`);
    const token = createUserToken(extra.userId ?? 'mobile-user', scopes, SECRET);
    ws.send(JSON.stringify({
      type: 'authenticate',
      payload: extra.approvalCapable ? { token, approvalCapable: true } : { token },
    }));
    await waitUntil(() => events.some((event) => event.type === 'authenticated'));
    return { ws, events };
  }

  it('does not capture when only a fleet listen socket is present — Telegram fallback runs', async () => {
    const fleet = await clientWith(['fleet:listen', 'chat'], { userId: 'fleet-peer' });
    const requestApproval = vi.fn(async () => true);
    ConfirmationService.getInstance().setRemoteApprovalService({
      hasChannels: () => true,
      requestApproval,
    } as never);

    const pending = ConfirmationService.getInstance().requestConfirmation(
      { operation: 'write', filename: 'notes.md', toolName: 'write_file', forcePrompt: true },
      'file',
    );
    await expect(pending).resolves.toEqual({ confirmed: true });
    expect(requestApproval).toHaveBeenCalledTimes(1);
    expect(fleet.events.some((event) => event.type === 'confirmation_required')).toBe(false);
    fleet.ws.close();
  });

  it('sends confirmation_required only to the PWA and ignores a fleet listen reply', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const pwa = await clientWith(['chat', 'tools'], { approvalCapable: true, userId: 'pwa-user' });
    const fleet = await clientWith(['fleet:listen', 'chat', 'tools'], { userId: 'fleet-peer' });

    const pending = ConfirmationService.getInstance().requestConfirmation(
      { operation: 'write', filename: 'secret.md', toolName: 'write_file', forcePrompt: true },
      'file',
    );
    await waitUntil(() => pwa.events.some((event) => event.type === 'confirmation_required'));
    expect(fleet.events.some((event) => event.type === 'confirmation_required')).toBe(false);

    const id = pwa.events.find((event) => event.type === 'confirmation_required')?.payload?.id;
    expect(typeof id).toBe('string');

    let settled: unknown;
    void pending.then((value) => { settled = value; });

    fleet.ws.send(JSON.stringify({
      type: 'confirmation_response',
      payload: { id, approved: true },
    }));
    await waitUntil(() => warn.mock.calls.some((call) => String(call[0]).includes('not a recipient')
      || String(call[0]).includes('non destinataire')
      || String(call[0]).includes('ignored')));
    expect(settled).toBeUndefined();

    pwa.ws.send(JSON.stringify({
      type: 'confirmation_response',
      payload: { id, approved: true },
    }));
    await expect(pending).resolves.toEqual({ confirmed: true });

    warn.mockRestore();
    pwa.ws.close();
    fleet.ws.close();
  });

  it('requires the tools scope to answer confirmation_response', async () => {
    const pwa = await clientWith(['chat', 'tools'], { approvalCapable: true, userId: 'pwa-user' });
    const chatOnly = await clientWith(['chat'], { approvalCapable: true, userId: 'chat-user' });

    const pending = ConfirmationService.getInstance().requestConfirmation(
      { operation: 'write', filename: 'a.ts', toolName: 'write_file', forcePrompt: true },
      'file',
    );
    await waitUntil(() => pwa.events.some((event) => event.type === 'confirmation_required'));
    expect(chatOnly.events.some((event) => event.type === 'confirmation_required')).toBe(false);
    const id = pwa.events.find((event) => event.type === 'confirmation_required')?.payload?.id;

    let settled: unknown;
    void pending.then((value) => { settled = value; });

    chatOnly.ws.send(JSON.stringify({
      type: 'confirmation_response',
      payload: { id, approved: true },
    }));
    await waitUntil(() => chatOnly.events.some((event) => event.error?.code === 'FORBIDDEN'));
    expect(settled).toBeUndefined();

    pwa.ws.send(JSON.stringify({
      type: 'confirmation_response',
      payload: { id, approved: false },
    }));
    await expect(pending).resolves.toEqual({ confirmed: false });
    pwa.ws.close();
    chatOnly.ws.close();
  });

  it('C-1 status only sets approvalCapable for authenticated non-anonymous socket with tools scope', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    // 1. Unauthenticated socket sends status with approvalCapable: true
    const unauthed = await connect(`${wsBase}/ws`);
    await waitUntil(() => unauthed.events.some((event) => event.type === 'connected'));
    unauthed.ws.send(JSON.stringify({ type: 'status', payload: { approvalCapable: true } }));
    await waitUntil(() => unauthed.events.some((event) => event.type === 'status'));
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('[ws] status approvalCapable ignored'),
      expect.objectContaining({ authenticated: false }),
    );
    expect(collectApprovalSurfaceIds()).toHaveLength(0);

    // 2. Authenticated socket missing 'tools' scope
    warn.mockClear();
    const chatOnly = await clientWith(['chat'], { userId: 'chat-user' });
    chatOnly.ws.send(JSON.stringify({ type: 'status', payload: { approvalCapable: true } }));
    await waitUntil(() => chatOnly.events.some((event) => event.type === 'status'));
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('[ws] status approvalCapable ignored'),
      expect.objectContaining({ authenticated: true }),
    );
    expect(collectApprovalSurfaceIds()).toHaveLength(0);

    // 3. Authenticated socket with 'tools' scope
    warn.mockClear();
    const toolsUser = await clientWith(['chat', 'tools'], { userId: 'tools-user' });
    toolsUser.ws.send(JSON.stringify({ type: 'status', payload: { approvalCapable: true } }));
    await waitUntil(() => toolsUser.events.some((event) => event.type === 'status'));
    expect(warn).not.toHaveBeenCalled();
    expect(collectApprovalSurfaceIds()).toHaveLength(1);

    warn.mockRestore();
    unauthed.ws.close();
    chatOnly.ws.close();
    toolsUser.ws.close();
  });

  it('C-2 approvalCapable is cleared when omitted or false in status, and on socket close — Telegram fallback resumes', async () => {
    const pwa = await clientWith(['chat', 'tools'], { approvalCapable: true, userId: 'pwa-user' });
    expect(collectApprovalSurfaceIds()).toEqual([expect.any(String)]);

    const requestApproval = vi.fn(async () => true);
    ConfirmationService.getInstance().setRemoteApprovalService({
      hasChannels: () => true,
      requestApproval,
    } as never);

    // 1. Send status omitting approvalCapable (payload: {})
    pwa.ws.send(JSON.stringify({ type: 'status', payload: {} }));
    await waitUntil(() => pwa.events.some((e) => e.type === 'status'));

    // Verify approvalCapable is now false / collectApprovalSurfaceIds is empty
    expect(collectApprovalSurfaceIds()).toHaveLength(0);

    // Request confirmation: PWA must NOT receive confirmation_required, and Telegram fallback must resume
    pwa.events.length = 0;
    const pending = ConfirmationService.getInstance().requestConfirmation(
      { operation: 'write', filename: 'fallback.md', toolName: 'write_file', forcePrompt: true },
      'file',
    );
    await expect(pending).resolves.toEqual({ confirmed: true });
    expect(requestApproval).toHaveBeenCalledTimes(1);
    expect(pwa.events.some((e) => e.type === 'confirmation_required')).toBe(false);

    // 2. Re-enable via status
    pwa.ws.send(JSON.stringify({ type: 'status', payload: { approvalCapable: true } }));
    await waitUntil(() => pwa.events.some((e) => e.type === 'status'));
    expect(collectApprovalSurfaceIds()).toHaveLength(1);

    // 3. Clear explicitly with approvalCapable: false
    pwa.events.length = 0;
    pwa.ws.send(JSON.stringify({ type: 'status', payload: { approvalCapable: false } }));
    await waitUntil(() => pwa.events.some((e) => e.type === 'status'));
    expect(collectApprovalSurfaceIds()).toHaveLength(0);

    // 4. Re-enable, then close socket: verify collectApprovalSurfaceIds is empty and fallback resumes
    pwa.events.length = 0;
    pwa.ws.send(JSON.stringify({ type: 'status', payload: { approvalCapable: true } }));
    await waitUntil(() => pwa.events.some((e) => e.type === 'status'));
    expect(collectApprovalSurfaceIds()).toHaveLength(1);

    pwa.ws.close();
    await waitUntil(() => collectApprovalSurfaceIds().length === 0);

    requestApproval.mockClear();
    const pendingAfterClose = ConfirmationService.getInstance().requestConfirmation(
      { operation: 'write', filename: 'fallback-after-close.md', toolName: 'write_file', forcePrompt: true },
      'file',
    );
    await expect(pendingAfterClose).resolves.toEqual({ confirmed: true });
    expect(requestApproval).toHaveBeenCalledTimes(1);
  });

  it('C-3 falls back to Telegram immediately if all approval sockets drop under backpressure', async () => {
    const pwa = await clientWith(['chat', 'tools'], { approvalCapable: true, userId: 'pwa-user' });
    expect(collectApprovalSurfaceIds()).toHaveLength(1);

    // Mock high bufferedAmount on the server-side socket to simulate backpressure
    const serverWs = Array.from(wss.clients).find((c) => c !== pwa.ws);
    expect(serverWs).toBeDefined();
    Object.defineProperty(serverWs, 'bufferedAmount', { value: 10_000_000, configurable: true });

    const requestApproval = vi.fn(async () => true);
    ConfirmationService.getInstance().setRemoteApprovalService({
      hasChannels: () => true,
      requestApproval,
    } as never);

    const pending = ConfirmationService.getInstance().requestConfirmation(
      { operation: 'write', filename: 'backpressure.md', toolName: 'write_file', forcePrompt: true },
      'file',
    );
    // Must fall back to Telegram immediately without waiting for timeout
    await expect(pending).resolves.toEqual({ confirmed: true });
    expect(requestApproval).toHaveBeenCalledTimes(1);
    expect(pwa.events.some((e) => e.type === 'confirmation_required')).toBe(false);

    pwa.ws.close();
  });
});
