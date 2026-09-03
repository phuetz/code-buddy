/**
 * Installation ID — stable UUID identifying this Code Buddy install.
 *
 * Persisted at `~/.codebuddy/installation-id`. Generated on first read,
 * never regenerated. Used as `x-codex-installation-id` header on the
 * ChatGPT Codex Responses backend (mirrors `openai/codex` upstream
 * `default_client.rs`).
 *
 * NOT a security primitive — it's an opaque telemetry/identification
 * value. Don't store secrets here, don't read it for auth decisions.
 */

import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { readTextAtomicSync, writeFileAtomicSync } from './atomic-write.js';

const INSTALL_ID_PATH = path.join(os.homedir(), '.codebuddy', 'installation-id');

let cached: string | null = null;

/** UUID v4 — RFC 4122 §4.4. Stays inside Node stdlib (`crypto.randomUUID`
 *  exists since Node 14.17 / 16; we already require ≥18). */
function newUuid(): string {
  return crypto.randomUUID();
}

/**
 * Returns the persistent installation ID, generating it on first call.
 * Idempotent — subsequent calls in the same process return the cached
 * value without touching disk.
 */
export function getInstallationId(): string {
  if (cached) return cached;

  try {
    const raw = readTextAtomicSync(INSTALL_ID_PATH, '').trim();
    // Loose UUID v4 shape check — be tolerant of older formats.
    if (raw && /^[0-9a-f-]{8,}$/i.test(raw)) {
      cached = raw;
      return cached;
    }
  } catch {
    // Read error → fall through to (re)generate.
  }

  const fresh = newUuid();
  try {
    writeFileAtomicSync(INSTALL_ID_PATH, fresh);
  } catch {
    // Disk write failure is non-fatal — we still return the fresh id
    // for this process. Next launch will retry.
  }
  cached = fresh;
  return cached;
}

/** Test-only: reset the in-memory cache. */
export function __resetInstallationIdCache(): void {
  cached = null;
}

/** Path of the persisted ID — exposed for doctor / debug. */
export function getInstallationIdPath(): string {
  return INSTALL_ID_PATH;
}
