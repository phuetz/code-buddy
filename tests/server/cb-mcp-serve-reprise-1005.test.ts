/**
 * Reprise CB-MCP-SERVE : PWA sur un nom tailnet autorisé, et production fail-closed.
 */
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { removeTmpDirStrict } from '../helpers/tmp.js';
import { resetDatabaseManager } from '../../src/database/database-manager.js';

type StartedServer = Awaited<ReturnType<typeof import('../../src/server/index.js').startServer>>;

function rawGet(port: number, urlPath: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: urlPath, headers }, (res) => {
      res.resume();
      resolve(res.statusCode || 0);
    });
    req.on('error', reject);
    req.end();
  });
}

describe('CB-MCP-SERVE reprise', () => {
  let tmpHome = '';
  let previousHome: string | undefined;
  const saved: Record<string, string | undefined> = {};
  let started: StartedServer | null = null;

  const setEnv = (k: string, v: string | undefined) => {
    if (!(k in saved)) saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  };

  beforeEach(() => {
    previousHome = process.env.CODEBUDDY_HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-cb-mcp-reprise-'));
    process.env.CODEBUDDY_HOME = tmpHome;
    resetDatabaseManager();
    vi.resetModules();
  });

  afterEach(async () => {
    if (started) {
      const { stopServer } = await import('../../src/server/index.js');
      await stopServer(started.server);
      started = null;
    }
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    for (const k of Object.keys(saved)) delete saved[k];
    resetDatabaseManager();
    if (previousHome === undefined) delete process.env.CODEBUDDY_HOME;
    else process.env.CODEBUDDY_HOME = previousHome;
    removeTmpDirStrict(tmpHome);
  });

  it('une origine identique au Host autorisé (PWA tailnet) atteint l\'authentification, une origine étrangère reste 403', async () => {
    setEnv('CODEBUDDY_ALLOWED_HOSTS', '100.64.1.2');
    const { startServer } = await import('../../src/server/index.js');
    started = await startServer({
      port: 0,
      host: '127.0.0.1',
      authEnabled: true,
      jwtSecret: 'reprise-secret',
      websocketEnabled: false,
      logging: false,
      rateLimit: false,
      cors: true,
      corsOrigins: ['http://localhost:*', 'http://127.0.0.1:*'],
      docsEnabled: false,
      securityHeaders: { enabled: false },
    });
    const port = (started.server.address() as AddressInfo).port;
    const host = `100.64.1.2:${port}`;
    // ÉCHOUE sur l'ancienne logique : 403 « Forbidden Origin » avant l'authentification.
    expect(await rawGet(port, '/api/tools', { Host: host, Origin: `http://${host}` })).toBe(401);
    expect(await rawGet(port, '/api/status', { Host: host, Origin: `http://${host}` })).toBe(401);
    expect(await rawGet(port, '/api/tools', { Host: host, Origin: 'http://evil.example' })).toBe(403);
  });

  it('en production, AUTH_ENABLED=false ne désactive pas l\'authentification', async () => {
    setEnv('NODE_ENV', 'production');
    setEnv('AUTH_ENABLED', 'false');
    setEnv('JWT_SECRET', 'reprise-production-secret');
    const { startServer } = await import('../../src/server/index.js');
    started = await startServer({
      port: 0,
      host: '127.0.0.1',
      websocketEnabled: false,
      logging: false,
      rateLimit: false,
      docsEnabled: false,
    });
    const port = (started.server.address() as AddressInfo).port;
    // ÉCHOUE sur l'ancienne logique : 200 sans jeton.
    expect(await rawGet(port, '/api/tools', { Host: `127.0.0.1:${port}` })).toBe(401);
  });
});
