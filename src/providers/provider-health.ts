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

let cachedPath: string | undefined;
let memoryOverride: ProviderHealthSnapshot | undefined;

function defaultHealthPath(): string {
  return path.join(os.homedir(), '.codebuddy', 'provider-health.json');
}

export function getProviderHealthPath(): string {
  return cachedPath ?? defaultHealthPath();
}

/** Test seam — points the store at an isolated HOME file. */
export function setProviderHealthPathForTests(filePath: string | undefined): void {
  cachedPath = filePath;
  memoryOverride = undefined;
}

export function resetProviderHealthStoreForTests(): void {
  const filePath = getProviderHealthPath();
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    /* best-effort */
  }
  memoryOverride = undefined;
}

function isValidSnapshot(value: unknown): value is ProviderHealthSnapshot {
  if (!value || typeof value !== 'object') return false;
  const rec = value as ProviderHealthSnapshot;
  return rec.version === PROVIDER_HEALTH_VERSION && rec.providers !== null && typeof rec.providers === 'object';
}

export function readProviderHealthSnapshot(): ProviderHealthSnapshot {
  if (memoryOverride) return memoryOverride;
  const loaded = readJsonAtomicSync<ProviderHealthSnapshot>(getProviderHealthPath(), EMPTY, {
    isValid: isValidSnapshot,
  });
  return {
    version: PROVIDER_HEALTH_VERSION,
    providers: { ...loaded.providers },
    ...(loaded.lastFailover ? { lastFailover: loaded.lastFailover } : {}),
  };
}

function persist(snapshot: ProviderHealthSnapshot): void {
  memoryOverride = snapshot;
  try {
    writeJsonAtomicSync(getProviderHealthPath(), snapshot);
  } catch {
    /* disk full / read-only HOME — keep the in-memory view for this process */
  }
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
  const snapshot = readProviderHealthSnapshot();
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
    message: (options.message ?? '').slice(0, 500),
    failedAt: nowMs,
    resetsAt: nowMs + ttl,
    ...(kind === 'overloaded' ? { consecutiveOverloads } : {}),
    ...(options.lastModel ? { lastModel: options.lastModel } : {}),
  };
  snapshot.providers[providerId] = entry;
  persist(snapshot);
  return entry;
}

export function recordProviderSuccess(providerId: string): void {
  const snapshot = readProviderHealthSnapshot();
  if (!snapshot.providers[providerId]) return;
  delete snapshot.providers[providerId];
  persist(snapshot);
}

export function recordLastFailover(info: {
  from: string;
  to: string;
  toModel?: string;
  kind: FailoverKind;
  at?: number;
}): void {
  const snapshot = readProviderHealthSnapshot();
  snapshot.lastFailover = {
    from: info.from,
    to: info.to,
    ...(info.toModel ? { toModel: info.toModel } : {}),
    kind: info.kind,
    at: info.at ?? Date.now(),
  };
  persist(snapshot);
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
