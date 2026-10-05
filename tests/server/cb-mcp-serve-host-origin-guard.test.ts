/**
 * CB-MCP-SERVE-PATCH-1005 — fail-closed Host allowlist + Origin access control.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { removeTmpDirStrict } from '../helpers/tmp.js';
import { resetDatabaseManager } from '../../src/database/database-manager.js';
import { generateToken } from '../../src/server/auth/jwt.js';

type StartedServer = Awaited<ReturnType<typeof import('../../src/server/index.js').startServer>>;

describe('CB-MCP-SERVE Host/Origin/auth guards', () => {
  let tmpHome = '';
  let previousHome: string | undefined;
  let started: StartedServer | null = null;
  let baseUrl = '';
  let port = 0;
  const jwtSecret = 'cb-mcp-serve-1005-vitest-secret';

  beforeEach(async () => {
    previousHome = process.env.CODEBUDDY_HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-cb-mcp-serve-'));
    process.env.CODEBUDDY_HOME = tmpHome;
    resetDatabaseManager();

    const { startServer } = await import('../../src/server/index.js');
    started = await startServer({
      port: 0,
      host: '127.0.0.1',
      authEnabled: true,
      jwtSecret,
      websocketEnabled: false,
      logging: false,
      rateLimit: false,
      cors: true,
      corsOrigins: ['http://localhost:*', 'http://127.0.0.1:*'],
      docsEnabled: false,
      securityHeaders: { enabled: false },
    });
    const address = started.server.address() as AddressInfo;
    port = address.port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    if (started) {
      const { stopServer } = await import('../../src/server/index.js');
      await stopServer(started.server);
      started = null;
    }
    resetDatabaseManager();
    if (previousHome === undefined) delete process.env.CODEBUDDY_HOME;
    else process.env.CODEBUDDY_HOME = previousHome;
    removeTmpDirStrict(tmpHome);
  });

  it('rejects unauthenticated /api/tools with 401', async () => {
    const response = await fetch(`${baseUrl}/api/tools`);
    expect(response.status).toBe(401);
  });

  it('rejects foreign Host header (DNS rebinding)', async () => {
    const response = await fetch(`${baseUrl}/api/health`, {
      headers: { Host: 'evil.example' },
    });
    // undici/fetch may not allow overriding Host; fall back to raw http
    if (response.status === 200) {
      const http = await import('http');
      const status = await new Promise<number>((resolve, reject) => {
        const req = http.request(
          { host: '127.0.0.1', port, path: '/api/health', headers: { Host: 'evil.example' } },
          (res) => {
            res.resume();
            resolve(res.statusCode || 0);
          },
        );
        req.on('error', reject);
        req.end();
      });
      expect(status).toBe(403);
      return;
    }
    expect(response.status).toBe(403);
  });

  it('rejects foreign Origin on privileged routes with 403', async () => {
    const response = await fetch(`${baseUrl}/api/tools`, {
      headers: { Origin: 'http://evil.example' },
    });
    expect(response.status).toBe(403);
    const body = (await response.json()) as { message?: string };
    expect(body.message).toMatch(/Origin/i);
  });

  it('allows authenticated legitimate client', async () => {
    const token = generateToken(
      {
        sub: 'vitest-user',
        scopes: ['admin', 'tools', 'tools:execute'],
        type: 'user',
      },
      jwtSecret,
      '1h',
    );
    const response = await fetch(`${baseUrl}/api/tools`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: 'http://127.0.0.1:9999',
      },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { total?: number };
    expect(typeof body.total).toBe('number');
  });
});
