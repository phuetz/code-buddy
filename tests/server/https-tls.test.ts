import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import https from 'https';
import { execFileSync } from 'child_process';
import type { AddressInfo } from 'net';
import type { Server as HttpServer } from 'http';
import { resetDatabaseManager } from '../../src/database/database-manager.js';

/**
 * Real TLS round-trip proof for the optional HTTPS transport on the main API
 * server (which carries /api/mobile). Generates a throwaway self-signed cert,
 * boots the server with CODEBUDDY_HTTPS=1 + the cert/key paths on an ephemeral
 * port, then makes a real https request with rejectUnauthorized:false. No mocks
 * on the transport — this exercises https.createServer end to end.
 */

function opensslAvailable(): boolean {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const hasOpenssl = opensslAvailable();

/** Minimal promisified HTTPS GET (undici's global fetch rejects self-signed). */
function httpsGet(
  port: number,
  reqPath: string
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      {
        host: '127.0.0.1',
        port,
        path: reqPath,
        rejectUnauthorized: false, // throwaway self-signed cert
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => resolve({ statusCode: res.statusCode ?? 0, body: data }));
      }
    );
    req.on('error', reject);
  });
}

describe('optional HTTPS transport (off-device TLS packaging)', () => {
  let tmpDir: string;
  let tmpHome: string;
  let certPath: string;
  let keyPath: string;

  // Save env we mutate so we never bleed TLS state into other tests.
  const savedEnv: Record<string, string | undefined> = {};
  const ENV_KEYS = [
    'CODEBUDDY_HTTPS',
    'CODEBUDDY_MOBILE_TLS',
    'CODEBUDDY_TLS_CERT',
    'CODEBUDDY_TLS_KEY',
    'CODEBUDDY_HOME',
  ];

  let started: { server: HttpServer } | undefined;

  beforeAll(() => {
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-tls-test-'));
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-tls-home-'));
    certPath = path.join(tmpDir, 'cert.pem');
    keyPath = path.join(tmpDir, 'key.pem');

    if (hasOpenssl) {
      execFileSync(
        'openssl',
        [
          'req',
          '-x509',
          '-newkey',
          'rsa:2048',
          '-nodes',
          '-keyout',
          keyPath,
          '-out',
          certPath,
          '-subj',
          '/CN=localhost',
          '-days',
          '1',
        ],
        { stdio: 'ignore' }
      );
    }
  });

  afterEach(async () => {
    if (started) {
      await new Promise<void>((resolve, reject) => {
        started!.server.close((err) => (err ? reject(err) : resolve()));
      });
      started = undefined;
    }
  });

  afterAll(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k]!;
    }
    resetDatabaseManager();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it.skipIf(!hasOpenssl)(
    'serves /api/health over real HTTPS when CODEBUDDY_HTTPS=1 with a provided cert/key',
    async () => {
      process.env.CODEBUDDY_HOME = tmpHome;
      process.env.CODEBUDDY_HTTPS = '1';
      process.env.CODEBUDDY_TLS_CERT = certPath;
      process.env.CODEBUDDY_TLS_KEY = keyPath;

      resetDatabaseManager();
      const { startServer } = await import('../../src/server/index.js');
      started = await startServer({
        port: 0,
        host: '127.0.0.1',
        authEnabled: false,
        websocketEnabled: false,
        logging: false,
        rateLimit: false,
        cors: false,
      });

      const address = started.server.address() as AddressInfo;
      const port = address.port;

      // Real TLS round-trip — plain http would be refused / mismatched here.
      const health = await httpsGet(port, '/api/health');
      expect(health.statusCode).toBe(200);
      const body = JSON.parse(health.body) as { status?: string };
      expect(body).toHaveProperty('status');

      // The mobile router rides the same server: prove a mobile route answers
      // over HTTPS too. /api/mobile/snapshot requires a bearer token, so an
      // unauthenticated call must reach the auth middleware and return 401
      // (i.e. TLS terminated and the request was routed into /api/mobile).
      const snapshot = await httpsGet(port, '/api/mobile/snapshot');
      expect(snapshot.statusCode).toBe(401);
    },
    30_000
  );

  it.skipIf(!hasOpenssl)(
    'also enables HTTPS via the CODEBUDDY_MOBILE_TLS alias',
    async () => {
      process.env.CODEBUDDY_HOME = tmpHome;
      delete process.env.CODEBUDDY_HTTPS;
      process.env.CODEBUDDY_MOBILE_TLS = '1';
      process.env.CODEBUDDY_TLS_CERT = certPath;
      process.env.CODEBUDDY_TLS_KEY = keyPath;

      resetDatabaseManager();
      const { startServer } = await import('../../src/server/index.js');
      started = await startServer({
        port: 0,
        host: '127.0.0.1',
        authEnabled: false,
        websocketEnabled: false,
        logging: false,
        rateLimit: false,
        cors: false,
      });

      const address = started.server.address() as AddressInfo;
      const health = await httpsGet(address.port, '/api/health');
      expect(health.statusCode).toBe(200);
    },
    30_000
  );

  it('throws (never silently downgrades) when TLS is on but the cert is unreadable', async () => {
    process.env.CODEBUDDY_HTTPS = '1';
    process.env.CODEBUDDY_TLS_CERT = path.join(tmpDir, 'does-not-exist.pem');
    process.env.CODEBUDDY_TLS_KEY = path.join(tmpDir, 'also-missing.pem');

    const { resolveServerTlsOptions } = await import('../../src/server/tls-config.js');
    expect(() => resolveServerTlsOptions()).toThrow(/could not be read/);
  });

  it.skipIf(!hasOpenssl)(
    'generates and reuses a dev self-signed cert under ~/.codebuddy/tls when no cert is provided',
    async () => {
      const genHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-tls-gen-'));
      try {
        process.env.CODEBUDDY_HOME = genHome;
        process.env.CODEBUDDY_HTTPS = '1';
        delete process.env.CODEBUDDY_MOBILE_TLS;
        delete process.env.CODEBUDDY_TLS_CERT;
        delete process.env.CODEBUDDY_TLS_KEY;

        const { resolveServerTlsOptions } = await import('../../src/server/tls-config.js');
        const opts = resolveServerTlsOptions();
        expect(opts).not.toBeNull();
        expect(opts!.cert).toBeInstanceOf(Buffer);
        expect(opts!.key).toBeInstanceOf(Buffer);

        const certFile = path.join(genHome, '.codebuddy', 'tls', 'dev-cert.pem');
        const keyFile = path.join(genHome, '.codebuddy', 'tls', 'dev-key.pem');
        expect(fs.existsSync(certFile)).toBe(true);
        expect(fs.existsSync(keyFile)).toBe(true);

        // Second call reuses the same files (no regeneration).
        const certBefore = fs.readFileSync(certFile);
        const opts2 = resolveServerTlsOptions();
        expect(opts2!.cert.equals(certBefore)).toBe(true);
      } finally {
        fs.rmSync(genHome, { recursive: true, force: true });
      }
    },
    30_000
  );

  it('returns null (plain HTTP, default) when no TLS env is set', async () => {
    delete process.env.CODEBUDDY_HTTPS;
    delete process.env.CODEBUDDY_MOBILE_TLS;
    delete process.env.CODEBUDDY_TLS_CERT;
    delete process.env.CODEBUDDY_TLS_KEY;

    const { resolveServerTlsOptions } = await import('../../src/server/tls-config.js');
    expect(resolveServerTlsOptions()).toBeNull();
  });
});
