/**
 * Audit sécurité 2.3.0 — constats 3, 4, 7, 8, 9 (serveur HTTP/WebSocket).
 * Chaque cas échoue sur le code d'avant la correction.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { createHmac } from 'crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket, { type WebSocketServer } from 'ws';

import { SERVER_CONFIG } from '../../src/config/constants.js';
import { DEFAULT_SERVER_CONFIG, type ServerConfig } from '../../src/server/types.js';
import { generateToken, verifyToken } from '../../src/server/auth/jwt.js';
import { setupWebSocket } from '../../src/server/websocket/handler.js';
import { resetDatabaseManager } from '../../src/database/database-manager.js';
import { removeTmpDirStrict } from '../helpers/tmp.js';

describe('constat 3 — bind loopback par défaut', () => {
  it('le serveur écoute sur 127.0.0.1 par défaut', () => {
    expect(SERVER_CONFIG.DEFAULT_HOST).toBe('127.0.0.1');
  });

  describe('startServer sans hôte explicite', () => {
    let tmpHome: string;
    const saved: Record<string, string | undefined> = {};
    beforeEach(() => {
      for (const key of ['CODEBUDDY_HOME', 'HOST', 'JWT_SECRET', 'CODEBUDDY_TRUSTED_PROXIES']) saved[key] = process.env[key];
      tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-secu-serveur-'));
      process.env.CODEBUDDY_HOME = tmpHome;
      delete process.env.HOST;
      delete process.env.CODEBUDDY_TRUSTED_PROXIES;
      resetDatabaseManager();
    });
    afterEach(() => {
      resetDatabaseManager();
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      removeTmpDirStrict(tmpHome);
    });

    it('lie la socket au loopback et la limite de débit ignore X-Forwarded-For (constat 4)', async () => {
      const { startServer } = await import('../../src/server/index.js');
      const started = await startServer({
        port: 0,
        authEnabled: false,
        websocketEnabled: false,
        logging: false,
        rateLimit: true,
        rateLimitMax: 2,
        rateLimitWindow: 60_000,
        routeRateLimits: { '/api/': { maxRequests: 2, windowMs: 60_000, keyPrefix: 'qa-secu-2-3-0' } },
        cors: false,
      });
      try {
        const address = started.server.address() as AddressInfo;
        expect(address.address).toBe('127.0.0.1');

        const statuses: number[] = [];
        for (let i = 1; i <= 4; i += 1) {
          const response = await fetch(`http://127.0.0.1:${address.port}/api/health`, {
            headers: { 'X-Forwarded-For': `203.0.113.${i}` },
          });
          statuses.push(response.status);
          await response.arrayBuffer();
        }
        // Le quota suit la socket réelle : un en-tête tournant n'en rouvre pas.
        expect(statuses.slice(0, 2)).toEqual([200, 200]);
        expect(statuses.slice(2)).toEqual([429, 429]);
      } finally {
        await new Promise<void>((resolve, reject) => {
          started.server.close((error) => (error ? reject(error) : resolve()));
        });
      }
    });

    it('protège les métriques détaillées et réserve leur remise à zéro aux administrateurs', async () => {
      const { startServer } = await import('../../src/server/index.js');
      const secret = 'qa-jwt-metrics-secret';
      const started = await startServer({
        port: 0,
        host: '127.0.0.1',
        authEnabled: true,
        jwtSecret: secret,
        websocketEnabled: false,
        logging: false,
        rateLimit: false,
        cors: false,
      });
      try {
        const port = (started.server.address() as AddressInfo).port;
        const base = `http://127.0.0.1:${port}`;
        expect((await fetch(`${base}/api/metrics/json`)).status).toBe(401);
        expect((await fetch(`${base}/metrics`)).status).toBe(401);
        expect((await fetch(`${base}/api/metrics/reset`, { method: 'POST' })).status).toBe(401);
        expect((await fetch(`${base}/api/health`)).status).toBe(200);

        const chatToken = generateToken({ userId: 'qa', scopes: ['chat'] }, secret);
        const chatReset = await fetch(`${base}/api/metrics/reset`, {
          method: 'POST', headers: { Authorization: `Bearer ${chatToken}` },
        });
        expect(chatReset.status).toBe(403);

        const adminToken = generateToken({ userId: 'qa', scopes: ['admin'] }, secret);
        const adminMetrics = await fetch(`${base}/api/metrics/json`, {
          headers: { Authorization: `Bearer ${adminToken}` },
        });
        expect(adminMetrics.status).toBe(200);
        const adminReset = await fetch(`${base}/api/metrics/reset`, {
          method: 'POST', headers: { Authorization: `Bearer ${adminToken}` },
        });
        expect(adminReset.status).toBe(200);
      } finally {
        await new Promise<void>((resolve, reject) => {
          started.server.close((error) => (error ? reject(error) : resolve()));
        });
      }
    });
  });

  it('CODEBUDDY_TRUSTED_PROXIES est la seule façon de faire confiance à un proxy', async () => {
    const { resolveTrustProxySetting } = await import('../../src/server/index.js');
    expect(resolveTrustProxySetting(undefined)).toBe(false);
    expect(resolveTrustProxySetting('  ')).toBe(false);
    expect(resolveTrustProxySetting('loopback, 198.51.100.0/24')).toEqual(['loopback', '198.51.100.0/24']);
  });
});

describe('constat 4 — pas de secret par défaut mort', () => {
  it("DEFAULT_SERVER_CONFIG ne porte ni secret connu ni origine '*'", () => {
    expect(DEFAULT_SERVER_CONFIG.jwtSecret).not.toBe('change-me-in-production');
    expect(DEFAULT_SERVER_CONFIG.corsOrigins).not.toBe('*');
    expect(DEFAULT_SERVER_CONFIG.corsOrigins).not.toContain('*');
  });

  it('un secret vide ne valide aucun jeton', () => {
    const token = generateToken({ userId: 'qa', scopes: ['chat'] }, '');
    expect(verifyToken(token, '')).toBeNull();
  });
});

describe('constat 7 — jeton sans exp refusé', () => {
  const secret = 'qa-secret-securite-2-3-0';
  const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  function sign(payload: Record<string, unknown>): string {
    const head = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}`;
    return `${head}.${createHmac('sha256', secret).update(head).digest('base64url')}`;
  }

  it('refuse un jeton signé sans exp', () => {
    expect(verifyToken(sign({ userId: 'qa', scopes: ['admin'], iat: 1 }), secret)).toBeNull();
  });

  it('refuse un exp non numérique', () => {
    expect(verifyToken(sign({ userId: 'qa', scopes: ['admin'], exp: '9999999999' }), secret)).toBeNull();
  });

  it('accepte toujours un jeton de generateToken', () => {
    expect(verifyToken(generateToken({ userId: 'qa', scopes: ['chat'] }, secret), secret)?.userId).toBe('qa');
  });
});

describe('constats 8 et 9 — WebSocket', () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  async function startWs(config: Partial<ServerConfig>): Promise<string> {
    const server: Server = createServer();
    const wss: WebSocketServer = await setupWebSocket(server, {
      ...DEFAULT_SERVER_CONFIG,
      jwtSecret: 'qa-secret-securite-2-3-0',
      ...config,
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    cleanups.push(async () => {
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    return `ws://127.0.0.1:${port}/ws`;
  }

  async function ask(url: string, message: Record<string, unknown>, headers: Record<string, string> = {}) {
    const socket = new WebSocket(url, { headers });
    cleanups.push(async () => socket.terminate());
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', reject);
    });
    const wanted = new Set([String(message.type), 'error', 'avatar:sync']);
    const reply = new Promise<{ type: string; payload?: Record<string, unknown> }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no reply')), 5_000);
      socket.on('message', (raw) => {
        const parsed = JSON.parse(String(raw)) as { type: string; payload?: Record<string, unknown> };
        if (wanted.has(parsed.type)) {
          clearTimeout(timer);
          resolve(parsed);
        }
      });
    });
    socket.send(JSON.stringify(message));
    return reply;
  }

  it('status avant authentification ne révèle ni version ni compteurs', async () => {
    const url = await startWs({ authEnabled: true });
    const reply = await ask(url, { type: 'status' });
    expect(reply.type).toBe('status');
    expect(reply.payload?.authenticated).toBe(false);
    expect(reply.payload).not.toHaveProperty('server');
    expect(reply.payload).not.toHaveProperty('connections');
  });

  it('avatar.sync refuse un client anonyme distant (--no-auth, passage par un proxy)', async () => {
    const url = await startWs({ authEnabled: false });
    const reply = await ask(url, { type: 'avatar.sync' }, { 'X-Forwarded-For': '203.0.113.9' });
    expect(reply.type).toBe('error');
    expect(JSON.stringify(reply)).toContain('REMOTE_AUTH_REQUIRED');
  });
});
