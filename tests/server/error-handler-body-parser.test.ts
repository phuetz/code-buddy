import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../../src/server/middleware/error-handler.js';
import { logger } from '../../src/utils/logger.js';

describe('Error handler for body-parser errors', () => {
  let server: Server | null = null;
  let baseUrl = '';
  let loggerWarnSpy: ReturnType<typeof vi.spyOn>;
  let loggerErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    loggerWarnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    loggerErrorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => {
        server?.close((err) => (err ? reject(err) : resolve()));
      });
      server = null;
    }
    vi.restoreAllMocks();
  });

  async function startApp(setupRoutes: (app: express.Express) => void): Promise<string> {
    const app = express();
    app.set('authEnabled', true); // Pour ne pas exposer les stacks

    setupRoutes(app);
    app.use(errorHandler);

    server = createServer(app);
    await new Promise<void>((resolve, reject) => {
      server?.once('error', reject);
      server?.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
    return baseUrl;
  }

  it('1. real express app with payload too large -> 413 PAYLOAD_TOO_LARGE', async () => {
    await startApp((app) => {
      app.use(express.json({ limit: '1kb' }));
      app.post('/test', (req, res) => {
        res.json({ success: true });
      });
    });

    const largePayload = { data: 'x'.repeat(2048) };
    const res = await fetch(`${baseUrl}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(largePayload),
    });

    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.code).toBe('PAYLOAD_TOO_LARGE');
    expect(body.message).toBe('Request body too large');

    expect(loggerWarnSpy).toHaveBeenCalled();
    expect(loggerErrorSpy).not.toHaveBeenCalled();
  });

  it('2. synthetic body-parser 415 error -> 415 UNSUPPORTED_MEDIA_TYPE', async () => {
    await startApp((app) => {
      app.post('/test', (req, res, next) => {
        const err = Object.assign(new Error('unsupported charset "UTF-8"'), {
          status: 415,
          type: 'charset.unsupported',
          expose: true
        });
        next(err);
      });
    });

    const res = await fetch(`${baseUrl}/test`, { method: 'POST' });
    expect(res.status).toBe(415);
    const body = await res.json();
    expect(body.code).toBe('UNSUPPORTED_MEDIA_TYPE');

    expect(loggerWarnSpy).toHaveBeenCalled();
    expect(loggerErrorSpy).not.toHaveBeenCalled();
  });

  it('2b. synthetic body-parser 400 error -> 400 VALIDATION_ERROR', async () => {
    await startApp((app) => {
      app.post('/test', (req, res, next) => {
        const err = Object.assign(new Error('request aborted'), {
          status: 400,
          type: 'request.aborted',
          expose: true
        });
        next(err);
      });
    });

    const res = await fetch(`${baseUrl}/test`, { method: 'POST' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('VALIDATION_ERROR');

    expect(loggerWarnSpy).toHaveBeenCalled();
    expect(loggerErrorSpy).not.toHaveBeenCalled();
  });

  it('3. ordinary Error remains 500 INTERNAL_ERROR', async () => {
    await startApp((app) => {
      app.post('/test', (req, res, next) => {
        next(new Error('ordinary error'));
      });
    });

    const res = await fetch(`${baseUrl}/test`, { method: 'POST' });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe('INTERNAL_ERROR');

    expect(loggerErrorSpy).toHaveBeenCalled();
  });

  it('4. Invalid JSON remains 400 VALIDATION_ERROR with specific message', async () => {
    await startApp((app) => {
      app.use(express.json());
      app.post('/test', (req, res) => {
        res.json({ success: true });
      });
    });

    const res = await fetch(`${baseUrl}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ invalid json',
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.message).toBe('Invalid JSON in request body');
  });
});
