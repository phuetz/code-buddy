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

import healthRoutes, { createK8sHealthAliases } from '../../src/server/routes/health.js';

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
  let previousProvider: string | undefined;
  let previousApiKey: string | undefined;
  let previousBaseUrl: string | undefined;

  beforeAll(async () => {
    const app = express();
    app.use('/api/health', healthRoutes);
    app.use(createK8sHealthAliases());
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  beforeEach(() => {
    previousProvider = process.env.CODEBUDDY_PROVIDER;
    previousApiKey = process.env.GROK_API_KEY;
    previousBaseUrl = process.env.GROK_BASE_URL;
    process.env.CODEBUDDY_PROVIDER = 'grok';
    process.env.GROK_API_KEY = 'fake-r30-key';
    process.env.GROK_BASE_URL = 'http://probe.invalid/v1';
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('sonde Grok échouée'));
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

  it('exposes providerApi on /readyz and returns 503 when the probe fails', async () => {
    const response = await getJson(port, '/readyz');
    const checks = response.body.checks as Record<string, boolean>;
    expect(checks.providerApi).toBe(false);
    expect(response.status).toBe(503);
    expect(response.body.ready).toBe(false);
  });

  it('probes the configured OpenAI endpoint even when CODEBUDDY_PROVIDER is not grok', async () => {
    delete process.env.GROK_API_KEY;
    process.env.CODEBUDDY_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'fake-openai-key';
    const previousOpenAi = process.env.OPENAI_BASE_URL;
    process.env.OPENAI_BASE_URL = 'http://probe.invalid/v1';
    try {
      const response = await getJson(port, '/readyz');
      const checks = response.body.checks as Record<string, boolean>;
      expect(checks.providerApi).toBe(false);
      expect(response.status).toBe(503);
      expect(response.body.ready).toBe(false);
    } finally {
      delete process.env.OPENAI_API_KEY;
      if (previousOpenAi === undefined) delete process.env.OPENAI_BASE_URL;
      else process.env.OPENAI_BASE_URL = previousOpenAi;
    }
  });
});
