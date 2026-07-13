import type { NextFunction, Request, Response } from 'express';
import type { AddressInfo } from 'net';
import { describe, expect, it, vi } from 'vitest';
import {
  createAuthMiddleware,
  isLoopbackRemoteAddress,
  requireLocalAnonymousAccess,
} from '../../src/server/middleware/auth.js';

function request(
  remoteAddress: string,
  options: { anonymous?: boolean; forwardedFor?: string } = {},
): Request {
  return {
    auth: options.anonymous === false
      ? { scopes: ['tools:execute'], type: 'api_key', keyId: 'key-1' }
      : { scopes: ['admin'], type: 'api_key', anonymous: true },
    headers: options.forwardedFor ? { 'x-forwarded-for': options.forwardedFor } : {},
    socket: { remoteAddress },
  } as unknown as Request;
}

function response() {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  return { value: { status } as unknown as Response, status, json };
}

describe('anonymous privileged HTTP access', () => {
  it('recognizes IPv4, mapped IPv4, and IPv6 loopback only', () => {
    expect(isLoopbackRemoteAddress('127.0.0.1')).toBe(true);
    expect(isLoopbackRemoteAddress('127.23.4.5')).toBe(true);
    expect(isLoopbackRemoteAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopbackRemoteAddress('::1')).toBe(true);
    expect(isLoopbackRemoteAddress('192.168.1.20')).toBe(false);
    expect(isLoopbackRemoteAddress('::ffff:10.0.0.2')).toBe(false);
    expect(isLoopbackRemoteAddress('127.999.999.999')).toBe(false);
  });

  it('allows no-auth tool routes only for a direct loopback client', () => {
    const next = vi.fn() as unknown as NextFunction;
    const localResponse = response();
    requireLocalAnonymousAccess(request('::ffff:127.0.0.1'), localResponse.value, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(localResponse.status).not.toHaveBeenCalled();

    const remoteNext = vi.fn() as unknown as NextFunction;
    const remoteResponse = response();
    requireLocalAnonymousAccess(request('192.168.1.20'), remoteResponse.value, remoteNext);
    expect(remoteNext).not.toHaveBeenCalled();
    expect(remoteResponse.status).toHaveBeenCalledWith(403);
  });

  it('rejects a public client forwarded through a loopback reverse proxy', () => {
    const next = vi.fn() as unknown as NextFunction;
    const res = response();
    requireLocalAnonymousAccess(
      request('127.0.0.1', { forwardedFor: '203.0.113.7, 127.0.0.1' }),
      res.value,
      next,
    );
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);

    const spoofedNext = vi.fn() as unknown as NextFunction;
    const spoofedResponse = response();
    requireLocalAnonymousAccess(
      request('127.0.0.1', { forwardedFor: '127.0.0.1' }),
      spoofedResponse.value,
      spoofedNext,
    );
    expect(spoofedNext).not.toHaveBeenCalled();
    expect(spoofedResponse.status).toHaveBeenCalledWith(403);
  });

  it('does not restrict authenticated callers and marks --no-auth access anonymous', async () => {
    const authenticatedNext = vi.fn() as unknown as NextFunction;
    const authenticatedResponse = response();
    requireLocalAnonymousAccess(
      request('203.0.113.7', { anonymous: false }),
      authenticatedResponse.value,
      authenticatedNext,
    );
    expect(authenticatedNext).toHaveBeenCalledTimes(1);

    const anonymousReq = request('127.0.0.1', { anonymous: false });
    anonymousReq.auth = undefined;
    const authNext = vi.fn() as unknown as NextFunction;
    await createAuthMiddleware({ authEnabled: false } as never)(
      anonymousReq,
      response().value,
      authNext,
    );
    expect(anonymousReq.auth).toMatchObject({ anonymous: true, scopes: ['admin'] });
    expect(authNext).toHaveBeenCalledTimes(1);
  });

  it('is mounted before the real /api/tools router', async () => {
    const { startServer, stopServer } = await import('../../src/server/index.js');
    const started = await startServer({
      port: 0,
      host: '127.0.0.1',
      authEnabled: false,
      websocketEnabled: false,
      logging: false,
      rateLimit: false,
      cors: false,
    });
    try {
      const address = started.server.address() as AddressInfo;
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const denied = await fetch(`${baseUrl}/api/tools`, {
        headers: { 'X-Forwarded-For': '203.0.113.44' },
      });
      expect(denied.status).toBe(403);
      expect((await denied.json()) as Record<string, unknown>).toMatchObject({
        message: expect.stringContaining('local-only'),
      });
      const detail = await fetch(`${baseUrl}/api/tools/view_file`);
      expect(detail.status).toBe(200);
      expect((await detail.json()) as Record<string, unknown>).toMatchObject({
        name: 'view_file',
      });
      const meetingDetail = await fetch(`${baseUrl}/api/tools/meeting_notes`);
      expect(meetingDetail.status).toBe(200);
      expect((await meetingDetail.json()) as Record<string, unknown>).toMatchObject({
        name: 'meeting_notes',
        requiresConfirmation: true,
      });
      const confirmation = await fetch(`${baseUrl}/api/tools/meeting_notes/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parameters: { input_path: 'meeting.txt' } }),
      });
      expect(confirmation.status).toBe(200);
      expect((await confirmation.json()) as Record<string, unknown>).toMatchObject({
        success: false,
        requiresConfirmation: true,
      });
      // Public health remains intentionally reachable.
      expect((await fetch(`${baseUrl}/api/health`)).status).toBe(200);
    } finally {
      await stopServer(started.server);
    }
  });
});
