import { createServer, request, type Server } from 'http';
import type { AddressInfo } from 'net';
import express from 'express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/database/database-manager.js', () => ({
  getDatabaseManager: () => ({
    isInitialized: () => true,
    getDatabase: () => ({ prepare: () => ({ get: () => ({ ok: 1 }) }) }),
  }),
}));

import healthRoutes from '../../src/server/routes/health.js';

function getJson(port: number, pathname: string): Promise<{
  status: number;
  body: Record<string, unknown>;
}> {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path: pathname, method: 'GET' }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          status: res.statusCode ?? 0,
          body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>,
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

describe('health readiness probe', () => {
  let server: Server;
  let port: number;
  let previousProvider: string | undefined;
  let previousApiKey: string | undefined;
  let previousBaseUrl: string | undefined;

  beforeAll(async () => {
    const app = express();
    app.use('/api/health', healthRoutes);
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  beforeEach(() => {
    previousProvider = process.env.CODEBUDDY_PROVIDER;
    previousApiKey = process.env.GROK_API_KEY;
    previousBaseUrl = process.env.GROK_BASE_URL;
    process.env.CODEBUDDY_PROVIDER = 'grok';
    process.env.GROK_API_KEY = 'fake-r21-key';
    process.env.GROK_BASE_URL = 'http://probe.invalid/v1';
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('sonde R21 échouée'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (previousProvider === undefined) delete process.env.CODEBUDDY_PROVIDER;
    else process.env.CODEBUDDY_PROVIDER = previousProvider;
    if (previousApiKey === undefined) delete process.env.GROK_API_KEY;
    else process.env.GROK_API_KEY = previousApiKey;
    if (previousBaseUrl === undefined) delete process.env.GROK_BASE_URL;
    else process.env.GROK_BASE_URL = previousBaseUrl;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });

  it('répond 503 quand la dernière sonde Grok échoue', async () => {
    const response = await getJson(port, '/api/health/ready');
    const checks = response.body.checks as Record<string, { ready?: boolean }>;

    expect(checks.grokApi?.ready).toBe(false);
    expect(response.status).toBe(503);
    expect(response.body.ready).toBe(false);
  });

  it('n’annonce pas api ok avant la moindre sonde réussie', async () => {
    const response = await getJson(port, '/api/health');
    const checks = response.body.checks as Record<string, string>;

    expect(checks.api).toBe('unknown');
    expect(response.body.status).toBe('degraded');
  });
});
