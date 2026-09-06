/**
 * Persistent provider outage memory (`~/.codebuddy/provider-health.json`).
 *
 * A provider recorded as `quota_exhausted` stays benched until `resetsAt`
 * (or 1 h). `overloaded` uses 60 s with exponential backoff; `unreachable`
 * uses 5 min. Opt-in consumers consult this before calling the primary.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readJsonAtomicSync, writeJsonAtomicSync } from '../utils/atomic-write.js';
import type { FailoverKind } from '../codebuddy/provider-failover-kind.js';
import { failoverTtlMs } from '../codebuddy/provider-failover-kind.js';

export const PROVIDER_HEALTH_VERSION = 1 as const;

export interface ProviderHealthEntry {
  kind: FailoverKind;
  message: string;
  failedAt: number;
  resetsAt: number;
  consecutiveOverloads?: number;
  lastModel?: string;
}

export interface ProviderHealthSnapshot {
  version: typeof PROVIDER_HEALTH_VERSION;
  providers: Record<string, ProviderHealthEntry>;
  lastFailover?: {
    from: string;
    to: string;
    toModel?: string;
    kind: FailoverKind;
    at: number;
  };
}

const EMPTY: ProviderHealthSnapshot = { version: PROVIDER_HEALTH_VERSION, providers: {} };
const HEALTH_FILE_MODE = 0o600;
const LOCK_WAIT_MS = 2_000;
const LOCK_STALE_MS = 5_000;

let cachedPath: string | undefined;
/** Last known snapshot when the disk write fails. Never used to skip a disk read. */
let memoryFallback: ProviderHealthSnapshot | undefined;

function defaultHealthPath(): string {
  return path.join(os.homedir(), '.codebuddy', 'provider-health.json');
}

export function getProviderHealthPath(): string {
  return cachedPath ?? defaultHealthPath();
}

/** Test seam — points the store at an isolated HOME file. */
export function setProviderHealthPathForTests(filePath: string | undefined): void {
  cachedPath = filePath;
  memoryFallback = undefined;
}

export function resetProviderHealthStoreForTests(): void {
  const filePath = getProviderHealthPath();
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    /* best-effort */
  }
  try {
    fs.unlinkSync(`${filePath}.lock`);
  } catch {
    /* best-effort */
  }
  memoryFallback = undefined;
}

function isValidSnapshot(value: unknown): value is ProviderHealthSnapshot {
  if (!value || typeof value !== 'object') return false;
  const rec = value as ProviderHealthSnapshot;
  return rec.version === PROVIDER_HEALTH_VERSION && rec.providers !== null && typeof rec.providers === 'object';
}

function cloneSnapshot(loaded: ProviderHealthSnapshot): ProviderHealthSnapshot {
  return {
    version: PROVIDER_HEALTH_VERSION,
    providers: { ...loaded.providers },
    ...(loaded.lastFailover ? { lastFailover: { ...loaded.lastFailover } } : {}),
  };
}

function sleepMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Exclusive create-lock next to the JSON. Another process (server + channels)
 * must re-read + merge under this lock, otherwise a later persist() overwrites
 * the sibling's entries (lost update).
 */
function withExclusiveLock(fn: () => void): void {
  const lockPath = `${getProviderHealthPath()}.lock`;
  try {
    fs.mkdirSync(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  } catch {
    /* mkdir is best-effort; open will fail next if the dir is missing */
  }
  const deadline = Date.now() + LOCK_WAIT_MS;
  while (true) {
    try {
      const fd = fs.openSync(
        lockPath,
        fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY,
        HEALTH_FILE_MODE,
      );
      try {
        fs.writeSync(fd, `${process.pid}\n`);
        fn();
        return;
      } finally {
        try {
          fs.closeSync(fd);
        } catch {
          /* ignore */
        }
        try {
          fs.unlinkSync(lockPath);
        } catch {
          /* ignore */
        }
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') {
        fn();
        return;
      }
      let stale = Date.now() >= deadline;
      try {
        stale = stale || Date.now() - fs.statSync(lockPath).mtimeMs > LOCK_STALE_MS;
      } catch {
        stale = true;
      }
      if (stale) {
        try {
          fs.unlinkSync(lockPath);
        } catch {
          /* lost the race */
        }
        continue;
      }
      sleepMs(15);
    }
  }
}

function readFromDisk(): ProviderHealthSnapshot {
  const loaded = readJsonAtomicSync<ProviderHealthSnapshot>(getProviderHealthPath(), EMPTY, {
    isValid: isValidSnapshot,
  });
  return cloneSnapshot(loaded);
}

export function readProviderHealthSnapshot(): ProviderHealthSnapshot {
  try {
    const loaded = readFromDisk();
    memoryFallback = loaded;
    return cloneSnapshot(loaded);
  } catch {
    return cloneSnapshot(memoryFallback ?? EMPTY);
  }
}

/** Strip tokens / Bearer / sk- from the persisted diagnostic string. */
export function sanitizeProviderHealthMessage(raw: string): string {
  return raw
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500)
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{10,}/g, '[redacted-key]')
    .replace(/\b(api[_-]?key|access[_-]?token|authorization)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]');
}

function persistMutation(mutator: (snapshot: ProviderHealthSnapshot) => void): void {
  withExclusiveLock(() => {
    const snapshot = readFromDisk();
    mutator(snapshot);
    try {
      writeJsonAtomicSync(getProviderHealthPath(), snapshot, { mode: HEALTH_FILE_MODE });
      memoryFallback = cloneSnapshot(snapshot);
    } catch {
      memoryFallback = cloneSnapshot(snapshot);
    }
  });
}

export function isProviderUnavailable(providerId: string, nowMs: number = Date.now()): boolean {
  const entry = readProviderHealthSnapshot().providers[providerId];
  if (!entry) return false;
  if (entry.kind === 'auth' || entry.kind === 'other') return false;
  return entry.resetsAt > nowMs;
}

export function getProviderHealthEntry(providerId: string): ProviderHealthEntry | undefined {
  return readProviderHealthSnapshot().providers[providerId];
}

export function recordProviderFailure(
  providerId: string,
  kind: FailoverKind,
  options: {
    message?: string;
    resetsAt?: number;
    lastModel?: string;
    nowMs?: number;
    resetsInSeconds?: number;
  } = {},
): ProviderHealthEntry {
  const nowMs = options.nowMs ?? Date.now();
  let written: ProviderHealthEntry | undefined;
  persistMutation((snapshot) => {
    const previous = snapshot.providers[providerId];
    let ttl = options.resetsAt !== undefined
      ? Math.max(0, options.resetsAt - nowMs)
      : failoverTtlMs(kind, options.resetsInSeconds);
    let consecutiveOverloads = 1;
    if (kind === 'overloaded') {
      consecutiveOverloads = (previous?.kind === 'overloaded' ? (previous.consecutiveOverloads ?? 1) : 0) + 1;
      const backoff = 60_000 * (2 ** Math.max(0, consecutiveOverloads - 1));
      ttl = Math.min(15 * 60_000, backoff);
    }
    const entry: ProviderHealthEntry = {
      kind,
      message: sanitizeProviderHealthMessage(options.message ?? ''),
      failedAt: nowMs,
      resetsAt: nowMs + ttl,
      ...(kind === 'overloaded' ? { consecutiveOverloads } : {}),
      ...(options.lastModel ? { lastModel: options.lastModel } : {}),
    };
    snapshot.providers[providerId] = entry;
    written = entry;
  });
  if (!written) {
    throw new Error('provider-health: persistMutation did not record the failure');
  }
  return written;
}

export function recordProviderSuccess(providerId: string): void {
  persistMutation((snapshot) => {
    if (!snapshot.providers[providerId]) return;
    delete snapshot.providers[providerId];
  });
}

export function recordLastFailover(info: {
  from: string;
  to: string;
  toModel?: string;
  kind: FailoverKind;
  at?: number;
}): void {
  persistMutation((snapshot) => {
    snapshot.lastFailover = {
      from: info.from,
      to: info.to,
      ...(info.toModel ? { toModel: info.toModel } : {}),
      kind: info.kind,
      at: info.at ?? Date.now(),
    };
  });
}

export function formatProviderHealthLines(
  snapshot: ProviderHealthSnapshot = readProviderHealthSnapshot(),
  nowMs: number = Date.now(),
): string[] {
  const ids = Object.keys(snapshot.providers).sort();
  if (ids.length === 0) return [];
  const lines: string[] = ['Provider health:'];
  for (const id of ids) {
    const entry = snapshot.providers[id];
    if (!entry) continue;
    const remaining = entry.resetsAt - nowMs;
    const until = remaining > 0
      ? remaining >= 3_600_000
        ? `reset dans ${Math.round(remaining / 3_600_000)} h`
        : `reset dans ${Math.max(1, Math.round(remaining / 60_000))} min`
      : 'disponible';
    lines.push(`  ${id}: ${entry.kind} (${until})`);
  }
  if (snapshot.lastFailover) {
    const hop = snapshot.lastFailover;
    lines.push(`  last failover: ${hop.from} → ${hop.to}${hop.toModel ? ':' + hop.toModel : ''} (${hop.kind})`);
  }
  return lines;
}
