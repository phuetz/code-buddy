import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { resetDatabaseManager } from '../../src/database/database-manager.js';

describe('SERV1 JWT production fail-closed', () => {
  let tmpHome = '';
  let previousHome: string | undefined;
  let previousNodeEnv: string | undefined;
  let previousJwt: string | undefined;

  afterEach(() => {
    resetDatabaseManager();
    if (previousHome === undefined) delete process.env.CODEBUDDY_HOME;
    else process.env.CODEBUDDY_HOME = previousHome;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousJwt === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousJwt;
    if (tmpHome) {
      fs.rmSync(tmpHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      tmpHome = '';
    }
  });

  it('refuses to start when NODE_ENV=production and JWT_SECRET is missing', async () => {
    previousHome = process.env.CODEBUDDY_HOME;
    previousNodeEnv = process.env.NODE_ENV;
    previousJwt = process.env.JWT_SECRET;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-serv1-jwt-'));
    process.env.CODEBUDDY_HOME = tmpHome;
    process.env.NODE_ENV = 'production';
    delete process.env.JWT_SECRET;
    resetDatabaseManager();

    const { startServer } = await import('../../src/server/index.js');
    await expect(
      startServer({
        port: 0,
        host: '127.0.0.1',
        authEnabled: true,
        websocketEnabled: false,
        logging: false,
        rateLimit: false,
        cors: false,
      })
    ).rejects.toThrow(/JWT_SECRET/);
  });
});
