import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { errorHandler, ApiServerError } from '../../src/server/middleware/error-handler.js';
import { logger } from '../../src/utils/logger.js';

describe('B-7: Error handler stack and path exposure based on auth state', () => {
  let server: Server | null = null;
  let baseUrl = '';
  let originalNodeEnv: string | undefined;
  let originalAuthEnabled: string | undefined;
  let loggerErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    originalNodeEnv = process.env.NODE_ENV;
    originalAuthEnabled = process.env.AUTH_ENABLED;
    loggerErrorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close((err) => (err ? reject(err) : resolve()));
      });
      server = null;
    }
    if (originalNodeEnv !== undefined) {
      process.env.NODE_ENV = originalNodeEnv;
    } else {
      delete process.env.NODE_ENV;
    }
    if (originalAuthEnabled !== undefined) {
      process.env.AUTH_ENABLED = originalAuthEnabled;
    } else {
      delete process.env.AUTH_ENABLED;
    }
    loggerErrorSpy.mockRestore();
  });

  async function startApp(options: {
    authEnabled?: boolean;
    routeFn: (req: express.Request, res: express.Response) => void;
  }): Promise<string> {
    const app = express();
    if (options.authEnabled !== undefined) {
      app.set('authEnabled', options.authEnabled);
    }
    app.get('/test-error', options.routeFn);
    app.use(errorHandler);

    server = createServer(app);
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
    return baseUrl;
  }

  it('masque details.stack et chemins absolus quand authEnabled est actif (meme si NODE_ENV != production)', async () => {
    delete process.env.NODE_ENV; // non-production
    process.env.AUTH_ENABLED = 'true';

    await startApp({
      authEnabled: true,
      routeFn: () => {
        throw new Error('Crash dans /home/secret/project/db.ts: secret connection failed');
      },
    });

    const res = await fetch(`${baseUrl}/test-error`);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { code: string; message: string; details?: { stack?: string } };

    expect(body.code).toBe('INTERNAL_ERROR');
    // Le stack ne doit pas etre expose au client
    expect(body.details).toBeUndefined();
    // Le message generique doit masquer la fuite de chemin absolu
    expect(body.message).toBe('An unexpected error occurred');
    expect(body.message).not.toContain('/home/secret');

    // Mais le journal serveur DOIT conserver la trace pour diagnostic
    expect(loggerErrorSpy).toHaveBeenCalled();
    const loggedError = loggerErrorSpy.mock.calls[0]?.[1];
    expect(loggedError).toBeInstanceOf(Error);
    expect((loggedError as Error).stack).toContain('secret connection failed');
  });

  it('masque details.stack par defaut car l auth est activee par defaut dans Code Buddy', async () => {
    delete process.env.NODE_ENV; // non-production
    delete process.env.AUTH_ENABLED; // defaut (auth activee)

    await startApp({
      routeFn: () => {
        throw new Error('Unhandled fault with internal stack');
      },
    });

    const res = await fetch(`${baseUrl}/test-error`);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { code: string; message: string; details?: { stack?: string } };

    expect(body.code).toBe('INTERNAL_ERROR');
    expect(body.details).toBeUndefined();
    expect(body.message).toBe('An unexpected error occurred');
  });

  it('expose details.stack uniquement quand l auth est explicitement desactivee en dev (--no-auth)', async () => {
    delete process.env.NODE_ENV; // non-production
    process.env.AUTH_ENABLED = 'false';

    await startApp({
      authEnabled: false,
      routeFn: () => {
        throw new Error('Explicite dev error');
      },
    });

    const res = await fetch(`${baseUrl}/test-error`);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { code: string; message: string; details?: { stack?: string } };

    expect(body.code).toBe('INTERNAL_ERROR');
    expect(body.message).toBe('Explicite dev error');
    expect(body.details?.stack).toBeDefined();
    expect(body.details?.stack).toContain('Explicite dev error');
  });

  it('masque details.stack si NODE_ENV=production meme si authEnabled est false', async () => {
    process.env.NODE_ENV = 'production';
    process.env.AUTH_ENABLED = 'false';

    await startApp({
      authEnabled: false,
      routeFn: () => {
        throw new Error('Production error');
      },
    });

    const res = await fetch(`${baseUrl}/test-error`);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { code: string; message: string; details?: { stack?: string } };

    expect(body.code).toBe('INTERNAL_ERROR');
    expect(body.details).toBeUndefined();
    expect(body.message).toBe('An unexpected error occurred');
  });

  it('supprime stack des details d une ApiServerError quand l auth est active', async () => {
    delete process.env.NODE_ENV;
    process.env.AUTH_ENABLED = 'true';

    await startApp({
      authEnabled: true,
      routeFn: () => {
        throw new ApiServerError('Custom bad request', 'CUSTOM_ERR', 400, {
          stack: 'Sensitive stack trace',
          field: 'user_id',
        });
      },
    });

    const res = await fetch(`${baseUrl}/test-error`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string; message: string; details?: Record<string, unknown> };

    expect(body.code).toBe('CUSTOM_ERR');
    expect(body.details?.stack).toBeUndefined();
    expect(body.details?.field).toBe('user_id');
  });
});
