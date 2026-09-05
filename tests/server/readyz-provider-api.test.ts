import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/database/database-manager.js', () => ({
  getDatabaseManager: () => ({
    isInitialized: () => true,
    getDatabase: () => ({ prepare: () => ({ get: () => ({ ok: 1 }) }) }),
  }),
}));

import { createK8sHealthAliases } from '../../src/server/routes/health.js';

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

describe('/readyz providerApi', () => {
  let server: Server;
  let port: number;
  const previous: Record<string, string | undefined> = {};

  beforeAll(async () => {
    const app = express();
    app.use(createK8sHealthAliases());
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  beforeEach(() => {
    for (const key of [
      'CODEBUDDY_PROVIDER',
      'GROK_API_KEY',
      'GROK_BASE_URL',
      'OPENAI_API_KEY',
      'OPENAI_BASE_URL',
    ]) {
      previous[key] = process.env[key];
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it('names the probe providerApi and fails closed when a hosted provider has no key', async () => {
    delete process.env.GROK_API_KEY;
    delete process.env.OPENAI_API_KEY;
    process.env.CODEBUDDY_PROVIDER = 'openai';
    const response = await getJson(port, '/readyz');
    const checks = response.body.checks as Record<string, boolean>;
    expect(checks.grokApi).toBeUndefined();
    expect(checks.providerApi).toBe(false);
    expect(response.status).toBe(503);
    expect(response.body.ready).toBe(false);
  });
});
