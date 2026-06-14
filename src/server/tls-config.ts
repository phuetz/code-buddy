/**
 * Optional TLS for the API server.
 *
 * The mobile-supervision endpoint (`/api/mobile`) rides the main HTTP server.
 * To expose it off-device securely it can be served over HTTPS. This is purely
 * transport security — it does not change any product gate (the dispatch gate
 * `CODEBUDDY_MOBILE_ALLOW_DISPATCH` is untouched).
 *
 * Behaviour, gated by env (HTTP stays the default — no env, no TLS):
 *  - `CODEBUDDY_HTTPS=1` (or `CODEBUDDY_MOBILE_TLS=1`) enables HTTPS.
 *  - `CODEBUDDY_TLS_CERT` / `CODEBUDDY_TLS_KEY` = paths to a PEM cert/key. This
 *    is the standard production approach (Let's Encrypt / reverse proxy / the
 *    operator provisions the cert).
 *  - If TLS is enabled but no cert is provided, a dev self-signed cert is
 *    generated via `openssl` (if on PATH) into `~/.codebuddy/tls/` and reused.
 *  - If TLS is enabled but it cannot be satisfied (cert unreadable, or openssl
 *    absent), this **throws** with a clear message. It never silently falls back
 *    to plain HTTP — an operator who asked for TLS must not be downgraded.
 *
 * Uses only Node built-ins (`https`, `fs`, `child_process`) — no new dependency.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { logger } from '../utils/logger.js';

export interface ServerTlsOptions {
  cert: string | Buffer;
  key: string | Buffer;
}

/** Truthy env flag check — accepts `1`, `true`, `yes`, `on` (case-insensitive). */
function isEnvTrue(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/** Whether HTTPS is requested for the API server. */
export function isTlsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isEnvTrue(env.CODEBUDDY_HTTPS) || isEnvTrue(env.CODEBUDDY_MOBILE_TLS);
}

function tlsDir(): string {
  const home = process.env.CODEBUDDY_HOME || os.homedir();
  return path.join(home, '.codebuddy', 'tls');
}

function hasOpenssl(): boolean {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate (once) and return a dev self-signed cert/key under `~/.codebuddy/tls/`.
 * Reuses an existing pair if both files are present. Throws if openssl is absent.
 */
function ensureDevSelfSignedCert(): ServerTlsOptions {
  const dir = tlsDir();
  const certPath = path.join(dir, 'dev-cert.pem');
  const keyPath = path.join(dir, 'dev-key.pem');

  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    return { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) };
  }

  if (!hasOpenssl()) {
    throw new Error(
      'TLS is enabled (CODEBUDDY_HTTPS) but no cert/key was provided and `openssl` ' +
        'is not available on PATH to generate a dev self-signed certificate. ' +
        'Provide CODEBUDDY_TLS_CERT and CODEBUDDY_TLS_KEY (PEM paths), or install openssl.'
    );
  }

  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
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
        '365',
      ],
      { stdio: 'ignore' }
    );
    // Restrict the private key to the owner.
    try {
      fs.chmodSync(keyPath, 0o600);
    } catch {
      /* best-effort on platforms without POSIX perms */
    }
  } catch (err) {
    throw new Error(
      'TLS is enabled (CODEBUDDY_HTTPS) but generating a dev self-signed certificate ' +
        `with openssl failed: ${err instanceof Error ? err.message : String(err)}. ` +
        'Provide CODEBUDDY_TLS_CERT and CODEBUDDY_TLS_KEY (PEM paths) instead.'
    );
  }

  logger.warn(
    `TLS: generated a dev self-signed certificate at ${certPath}. ` +
      'This is for development/off-device testing only — use a real cert ' +
      '(CODEBUDDY_TLS_CERT / CODEBUDDY_TLS_KEY) in production.'
  );
  return { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) };
}

/**
 * Resolve TLS options for the server, or `null` when TLS is not requested.
 *
 * Returns `null` (HTTP, unchanged default) when neither `CODEBUDDY_HTTPS` nor
 * `CODEBUDDY_MOBILE_TLS` is set. Throws a clear error if TLS is requested but
 * cannot be satisfied — it never downgrades to HTTP behind the operator's back.
 */
export function resolveServerTlsOptions(
  env: NodeJS.ProcessEnv = process.env
): ServerTlsOptions | null {
  if (!isTlsEnabled(env)) {
    return null;
  }

  const certPath = env.CODEBUDDY_TLS_CERT?.trim();
  const keyPath = env.CODEBUDDY_TLS_KEY?.trim();

  // One of the two paths set but not the other → operator misconfiguration.
  if ((certPath && !keyPath) || (!certPath && keyPath)) {
    throw new Error(
      'TLS is enabled (CODEBUDDY_HTTPS) but only one of CODEBUDDY_TLS_CERT / ' +
        'CODEBUDDY_TLS_KEY is set. Provide both, or neither (to use a dev self-signed cert).'
    );
  }

  if (certPath && keyPath) {
    let cert: Buffer;
    let key: Buffer;
    try {
      cert = fs.readFileSync(certPath);
    } catch (err) {
      throw new Error(
        `TLS is enabled but CODEBUDDY_TLS_CERT (${certPath}) could not be read: ` +
          `${err instanceof Error ? err.message : String(err)}`
      );
    }
    try {
      key = fs.readFileSync(keyPath);
    } catch (err) {
      throw new Error(
        `TLS is enabled but CODEBUDDY_TLS_KEY (${keyPath}) could not be read: ` +
          `${err instanceof Error ? err.message : String(err)}`
      );
    }
    return { cert, key };
  }

  // TLS requested with no explicit cert — generate/reuse a dev self-signed cert.
  return ensureDevSelfSignedCert();
}
