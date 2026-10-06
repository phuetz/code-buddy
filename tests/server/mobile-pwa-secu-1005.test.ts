/**
 * CB-PWA-SECU-1005 — sécurité PWA mobile (côté serveur).
 * Les cas XSS DOM sont dans mobile-pwa-secu-1005-xss.test.ts (happy-dom).
 */
import http from 'node:http';
import { createHmac } from 'node:crypto';
import express, { type Request, type Response, type NextFunction } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { generateToken, createUserToken, verifyToken } from '../../src/server/auth/jwt.js';
import { requireAlbumAccess, mobilePwaRouter } from '../../src/server/mobile/index.js';
import * as deviceStores from '../../src/server/auth/device-store.js';
import { readAlbumEntry } from '../../src/server/mobile/album.js';

const SECRET = 'cb-pwa-secu-1005-test-secret-32b-min';

function mockReq(opts: {
  method?: string;
  remoteAddress?: string;
  authorization?: string;
  headers?: Record<string, string>;
  params?: Record<string, string>;
}): Request {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.authorization) headers.authorization = opts.authorization;
  return {
    method: opts.method ?? 'GET',
    headers,
    params: opts.params ?? {},
    socket: { remoteAddress: opts.remoteAddress ?? '127.0.0.1' },
  } as unknown as Request;
}

function mockRes(): Response & { statusCode: number; body: unknown } {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

describe('CB-PWA-SECU-1005 — jeton URL / Referrer', () => {
  it('pose Referrer-Policy: no-referrer sur la coquille PWA (anti-fuite jeton)', async () => {
    const app = express();
    app.use('/__codebuddy__/mobile', mobilePwaRouter);
    const server = await new Promise<http.Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
      const { port } = server.address() as { port: number };
      const res = await fetch(`http://127.0.0.1:${port}/__codebuddy__/mobile/`);
      expect(res.status).toBe(200);
      expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });

  it('buddy token place le jeton dans le fragment (#token=), pas la query', async () => {
    const { buildMobileOpenUrl } = await import('../../src/commands/token.js');
    const url = buildMobileOpenUrl('http://127.0.0.1:3460', 'abc.def.ghi');
    expect(url).toContain('/__codebuddy__/mobile/#token=');
    expect(url).not.toMatch(/[?&]token=/);
  });
});

describe('CB-PWA-SECU-1005 — expiration du jeton', () => {
  it('refuse un JWT expiré sur requireAlbumAccess', () => {
    process.env.JWT_SECRET = SECRET;
    const dead = generateToken({ sub: 'u', scopes: ['chat'], type: 'user' }, SECRET, '1s');
    const parts = dead.split('.');
    const payload = JSON.parse(
      Buffer.from(parts[1]!.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(),
    ) as { exp: number };
    payload.exp = Math.floor(Date.now() / 1000) - 60;
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = createHmac('sha256', SECRET).update(`${parts[0]}.${body}`).digest('base64url');
    const token = `${parts[0]}.${body}.${sig}`;
    expect(verifyToken(token, SECRET)).toBeNull();

    const req = mockReq({ authorization: `Bearer ${token}`, remoteAddress: '203.0.113.9' });
    const res = mockRes();
    let nextCalled = false;
    requireAlbumAccess(req, res, (() => {
      nextCalled = true;
    }) as NextFunction);
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
    delete process.env.JWT_SECRET;
  });
});

describe('CB-PWA-SECU-1005 — rejeu / révocation appareil', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.JWT_SECRET;
  });

  it('refuse un jeton appareil révoqué (amr=device) sur l’album', () => {
    process.env.JWT_SECRET = SECRET;
    vi.spyOn(deviceStores, 'getDeviceAuthStore').mockReturnValue({
      isActive: () => false,
    } as ReturnType<typeof deviceStores.getDeviceAuthStore>);

    const token = generateToken(
      {
        sub: 'device-revoked-1',
        scopes: ['chat', 'tools'],
        type: 'user',
        amr: ['biometric', 'device'],
      },
      SECRET,
      '1h',
    );
    expect(verifyToken(token, SECRET)).not.toBeNull();

    const req = mockReq({
      authorization: `Bearer ${token}`,
      remoteAddress: '203.0.113.10',
    });
    const res = mockRes();
    let nextCalled = false;
    requireAlbumAccess(req, res, (() => {
      nextCalled = true;
    }) as NextFunction);
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
  });
});

describe('CB-PWA-SECU-1005 — CSRF album (mutations)', () => {
  afterEach(() => {
    delete process.env.JWT_SECRET;
  });

  it('POST favorite sans JWT est refusé même en loopback (anti-CSRF formulaire local)', () => {
    process.env.JWT_SECRET = SECRET;
    const req = mockReq({
      method: 'POST',
      remoteAddress: '127.0.0.1',
      params: { id: 'a'.repeat(64) },
      headers: { origin: 'https://evil.example' },
    });
    const res = mockRes();
    let nextCalled = false;
    requireAlbumAccess(req, res, (() => {
      nextCalled = true;
    }) as NextFunction);
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it('DELETE album sans JWT est refusé même en loopback', () => {
    process.env.JWT_SECRET = SECRET;
    const req = mockReq({ method: 'DELETE', remoteAddress: '127.0.0.1' });
    const res = mockRes();
    let nextCalled = false;
    requireAlbumAccess(req, res, (() => {
      nextCalled = true;
    }) as NextFunction);
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
  });
});

describe('CB-PWA-SECU-1005 — album sans JWT hors loopback', () => {
  afterEach(() => {
    delete process.env.JWT_SECRET;
  });

  it('GET album depuis une IP publique sans Bearer → 401', () => {
    process.env.JWT_SECRET = SECRET;
    const req = mockReq({ method: 'GET', remoteAddress: '198.51.100.20' });
    const res = mockRes();
    let nextCalled = false;
    requireAlbumAccess(req, res, (() => {
      nextCalled = true;
    }) as NextFunction);
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it('spoof X-Forwarded-For loopback ne suffit pas (socket distante)', () => {
    process.env.JWT_SECRET = SECRET;
    const req = mockReq({
      method: 'GET',
      remoteAddress: '198.51.100.21',
      headers: { 'x-forwarded-for': '127.0.0.1' },
    });
    const res = mockRes();
    let nextCalled = false;
    requireAlbumAccess(req, res, (() => {
      nextCalled = true;
    }) as NextFunction);
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it('JWT valide hors loopback est accepté', () => {
    process.env.JWT_SECRET = SECRET;
    const token = createUserToken('mobile', ['chat'], SECRET, '1h');
    const req = mockReq({
      method: 'GET',
      remoteAddress: '198.51.100.22',
      authorization: `Bearer ${token}`,
    });
    const res = mockRes();
    let nextCalled = false;
    requireAlbumAccess(req, res, (() => {
      nextCalled = true;
    }) as NextFunction);
    expect(nextCalled).toBe(true);
  });
});

describe('CB-PWA-SECU-1005 — traversée de chemin /album/<hash>', () => {
  it('readAlbumEntry refuse tout id hors sha256 hex 64', async () => {
    expect(await readAlbumEntry('../etc/passwd')).toBeNull();
    expect(await readAlbumEntry('....//....//etc/passwd')).toBeNull();
    expect(await readAlbumEntry(`%2e%2e%2f${'a'.repeat(60)}`)).toBeNull();
    expect(await readAlbumEntry('A'.repeat(64))).toBeNull();
    expect(await readAlbumEntry('g'.repeat(64))).toBeNull();
  });

  it('HTTP GET /album/<id-hostile> → 400', async () => {
    process.env.JWT_SECRET = SECRET;
    const token = createUserToken('mobile', ['chat'], SECRET, '1h');
    const app = express();
    app.use('/__codebuddy__/mobile', mobilePwaRouter);
    const server = await new Promise<http.Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
      const { port } = server.address() as { port: number };
      const traversal = await fetch(
        `http://127.0.0.1:${port}/__codebuddy__/mobile/album/${encodeURIComponent('../../etc/passwd')}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      expect(traversal.status).toBe(400);
      const dots = await fetch(
        `http://127.0.0.1:${port}/__codebuddy__/mobile/album/${'z'.repeat(64)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      expect(dots.status).toBe(400);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      delete process.env.JWT_SECRET;
    }
  });
});
