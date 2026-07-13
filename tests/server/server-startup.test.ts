import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import type { Server as HttpServer } from 'http';
import { resetDatabaseManager } from '../../src/database/database-manager.js';

describe('server startup', () => {
  let tmpHome: string;
  let previousHome: string | undefined;
  let previousProvider: string | undefined;
  let previousOpenAiKey: string | undefined;
  let previousOpenAiModel: string | undefined;
  let previousJwtSecret: string | undefined;

  beforeEach(() => {
    previousHome = process.env.CODEBUDDY_HOME;
    previousProvider = process.env.CODEBUDDY_PROVIDER;
    previousOpenAiKey = process.env.OPENAI_API_KEY;
    previousOpenAiModel = process.env.OPENAI_MODEL;
    previousJwtSecret = process.env.JWT_SECRET;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-server-startup-'));
    process.env.CODEBUDDY_HOME = tmpHome;
    resetDatabaseManager();
  });

  afterEach(() => {
    resetDatabaseManager();
    if (previousHome === undefined) {
      delete process.env.CODEBUDDY_HOME;
    } else {
      process.env.CODEBUDDY_HOME = previousHome;
    }
    if (previousProvider === undefined) {
      delete process.env.CODEBUDDY_PROVIDER;
    } else {
      process.env.CODEBUDDY_PROVIDER = previousProvider;
    }
    if (previousOpenAiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = previousOpenAiKey;
    }
    if (previousOpenAiModel === undefined) {
      delete process.env.OPENAI_MODEL;
    } else {
      process.env.OPENAI_MODEL = previousOpenAiModel;
    }
    if (previousJwtSecret === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = previousJwtSecret;
    }
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('initializes SQLite before health checks run', async () => {
    const { startServer } = await import('../../src/server/index.js');
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
      const response = await fetch(`http://127.0.0.1:${address.port}/api/health`);
      const body = (await response.json()) as { checks: { database: string } };

      expect(response.status).toBe(200);
      expect(body.checks.database).toBe('ok');
    } finally {
      await new Promise<void>((resolve, reject) => {
        started.server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('uses the actual bound port for ephemeral server URLs', async () => {
    const { logger } = await import('../../src/utils/logger.js');
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});
    const { startServer, stopServer } = await import('../../src/server/index.js');
    const started = await startServer({
      port: 0,
      host: '127.0.0.1',
      authEnabled: false,
      websocketEnabled: true,
      logging: false,
      rateLimit: false,
      cors: false,
    });

    try {
      const address = started.server.address() as AddressInfo;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      expect(infoSpy).toHaveBeenCalledWith(`API Server started on ${baseUrl}`);
      await vi.waitFor(
        () => {
          expect(infoSpy).toHaveBeenCalledWith(
            '[channel-a2a-bridge] active',
            expect.objectContaining({ hubBaseUrl: baseUrl })
          );
        },
        { timeout: 10_000 }
      );
    } finally {
      await stopServer(started.server);
      infoSpy.mockRestore();
    }
  }, 15_000);

  it('formats wildcard and IPv6 server URLs for logs and bridge callbacks', async () => {
    const { getServerBaseUrl } = await import('../../src/server/index.js');
    const fakeServer = {
      address: () => ({ address: '::1', family: 'IPv6', port: 4567 }),
    } as unknown as HttpServer;
    const baseConfig = {
      port: 0,
      cors: false,
      rateLimit: false,
      rateLimitWindow: 60000,
      rateLimitMax: 60,
      authEnabled: false,
      jwtSecret: 'test',
      jwtExpiration: '1h',
      websocketEnabled: false,
      logging: false,
    };

    expect(getServerBaseUrl(fakeServer, { ...baseConfig, host: '::1' })).toBe('http://[::1]:4567');
    expect(getServerBaseUrl(fakeServer, { ...baseConfig, host: '::' })).toBe(
      'http://127.0.0.1:4567'
    );
    expect(getServerBaseUrl(fakeServer, { ...baseConfig, host: '0.0.0.0' })).toBe(
      'http://127.0.0.1:4567'
    );
  });

  it('does not enforce CSRF when authentication is disabled', async () => {
    const { startServer } = await import('../../src/server/index.js');
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
      const response = await fetch(`http://127.0.0.1:${address.port}/api/nonexistent-csrf-probe`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });

      expect(response.status).toBe(404);
    } finally {
      await new Promise<void>((resolve, reject) => {
        started.server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('does not warn about JWT_SECRET when authentication is disabled', async () => {
    const { logger } = await import('../../src/utils/logger.js');
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
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
      expect(warnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('No JWT_SECRET set'),
      );
      expect(started.config.jwtSecret).toBe('');
    } finally {
      await stopServer(started.server);
      warnSpy.mockRestore();
    }
  });

  it('warns actionably but preserves explicit Fleet/A2A non-loopback no-auth startup', async () => {
    const { logger } = await import('../../src/utils/logger.js');
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const { startServer, stopServer } = await import('../../src/server/index.js');
    const started = await startServer({
      port: 0,
      host: '0.0.0.0',
      authEnabled: false,
      websocketEnabled: false,
      logging: false,
      rateLimit: false,
      cors: false,
    });

    try {
      expect(started.server.listening).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('SERVER_UNAUTHENTICATED_NETWORK_BIND'),
      );
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Fleet/A2A'));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('JWT_SECRET'));
    } finally {
      await stopServer(started.server);
      warnSpy.mockRestore();
    }
  });

  it('keeps health endpoints public when authentication is enabled', async () => {
    process.env.CODEBUDDY_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'test-openai-key';
    process.env.JWT_SECRET = 'test-jwt-secret';

    const { startServer } = await import('../../src/server/index.js');
    const started = await startServer({
      port: 0,
      host: '127.0.0.1',
      authEnabled: true,
      websocketEnabled: false,
      logging: false,
      rateLimit: false,
      cors: false,
    });

    try {
      const address = started.server.address() as AddressInfo;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      const healthResponse = await fetch(`${baseUrl}/api/health`);
      expect(healthResponse.status).toBe(200);

      const liveResponse = await fetch(`${baseUrl}/api/health/live`);
      expect(liveResponse.status).toBe(200);

      const chatResponse = await fetch(`${baseUrl}/api/chat/models`);
      expect(chatResponse.status).toBe(401);
    } finally {
      await new Promise<void>((resolve, reject) => {
        started.server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('treats non-Grok providers as ready for readiness probes', async () => {
    process.env.CODEBUDDY_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'test-openai-key';
    process.env.OPENAI_MODEL = 'gpt-test-server';

    const { startServer } = await import('../../src/server/index.js');
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

      const apiReadyResponse = await fetch(`${baseUrl}/api/health/ready`);
      const apiReadyBody = (await apiReadyResponse.json()) as {
        ready: boolean;
        checks: {
          provider: { ready: boolean };
          database: { ready: boolean };
          memory: { ready: boolean };
        };
      };
      expect(apiReadyResponse.status).toBe(200);
      expect(apiReadyBody.ready).toBe(true);
      expect(apiReadyBody.checks.provider.ready).toBe(true);
      expect(apiReadyBody.checks.database.ready).toBe(true);
      expect(apiReadyBody.checks.memory.ready).toBe(true);

      const readyzResponse = await fetch(`${baseUrl}/readyz`);
      const readyzBody = (await readyzResponse.json()) as {
        ready: boolean;
        checks: { provider: boolean; database: boolean; memory: boolean };
      };
      expect(readyzResponse.status).toBe(200);
      expect(readyzBody.ready).toBe(true);
      expect(readyzBody.checks.provider).toBe(true);
      expect(readyzBody.checks.database).toBe(true);
      expect(readyzBody.checks.memory).toBe(true);

      const modelsResponse = await fetch(`${baseUrl}/api/chat/models`);
      const modelsBody = (await modelsResponse.json()) as {
        data: Array<{ id: string; owned_by: string }>;
      };
      expect(modelsResponse.status).toBe(200);
      expect(modelsBody.data[0]).toMatchObject({
        id: 'gpt-test-server',
        owned_by: 'openai',
      });

      const openAiModelsResponse = await fetch(`${baseUrl}/v1/models`);
      const openAiModelsBody = (await openAiModelsResponse.json()) as {
        object: string;
        data: Array<{ id: string; object: string; owned_by: string }>;
      };
      expect(openAiModelsResponse.status).toBe(200);
      expect(openAiModelsBody.object).toBe('list');
      expect(openAiModelsBody.data[0]).toMatchObject({
        id: 'gpt-test-server',
        object: 'model',
        owned_by: 'openai',
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        started.server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});
