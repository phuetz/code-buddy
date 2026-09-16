import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetDatabaseManager } from '../../src/database/database-manager.js';
import { LIMIT_CONFIG } from '../../src/config/constants.js';

type StartedServer = Awaited<ReturnType<typeof import('../../src/server/index.js').startServer>>;

describe('SERV1 real HTTP rate limit', () => {
  let tmpHome = '';
  let previousHome: string | undefined;
  let started: StartedServer | null = null;

  beforeEach(() => {
    previousHome = process.env.CODEBUDDY_HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-serv1-ratelimit-'));
    process.env.CODEBUDDY_HOME = tmpHome;
    resetDatabaseManager();
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
    fs.rmSync(tmpHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('announces a 100 req/min default', () => {
    expect(LIMIT_CONFIG.DEFAULT_RATE_LIMIT_MAX).toBe(100);
  });

  it('returns 429 with Retry-After when the /api/ window is exceeded', async () => {
    const { startServer } = await import('../../src/server/index.js');
    const keyPrefix = `serv1-rl-${Date.now()}-${Math.random()}`;
    started = await startServer({
      port: 0,
      host: '127.0.0.1',
      authEnabled: false,
      websocketEnabled: false,
      logging: false,
      rateLimit: true,
      rateLimitMax: 100,
      rateLimitWindow: 60_000,
      routeRateLimits: {
        '/api/': {
          maxRequests: 3,
          windowMs: 60_000,
          keyPrefix,
        },
      },
      cors: false,
      docsEnabled: false,
      securityHeaders: { enabled: false },
    });
    const address = started.server.address() as AddressInfo;
    const url = `http://127.0.0.1:${address.port}/api/health`;
    const statuses: number[] = [];
    let limited: Response | null = null;
    for (let i = 0; i < 5; i++) {
      const response = await fetch(url);
      statuses.push(response.status);
      if (response.status === 429) {
        limited = response;
        break;
      }
    }
    expect(limited).not.toBeNull();
    expect(statuses.filter((status) => status === 200).length).toBe(3);
    expect(limited?.headers.get('retry-after')).toBeTruthy();
    expect(limited?.headers.get('x-ratelimit-limit')).toBe('3');
    const body = (await limited!.json()) as { status?: number; code?: string };
    expect(body.status).toBe(429);
    expect(body.code).toBe('RATE_LIMITED');
  });
});
