/**
 * Automatic reset of messaging-channel sessions.
 *
 * Modes follow the Hermes session_reset policy (both, idle, daily, none).
 * The default is none: an absent or invalid section keeps today's behavior.
 * A reset is applied only after a memory archive has been written and read
 * back. A failed save leaves the session untouched.
 *
 * The clock is injected. This module never sleeps.
 *
 * @module channels/messaging-session-reset
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readJsonAtomicSync, writeJsonAtomicSync } from '../utils/atomic-write.js';

export type MessagingSessionResetMode = 'both' | 'idle' | 'daily' | 'none';
export type MessagingSessionResetReason = 'idle' | 'daily';

export interface MessagingSessionResetPolicy {
  mode: MessagingSessionResetMode;
  /** Minutes of inactivity. Used when mode is idle or both. */
  idleMinutes: number;
  /** Local hour 0-23 of the daily boundary. Used when mode is daily or both. */
  atHour: number;
}

/** Numeric defaults match the usual messaging policy; the mode does not. */
export const DEFAULT_MESSAGING_SESSION_RESET_POLICY: MessagingSessionResetPolicy = {
  mode: 'none',
  idleMinutes: 1440,
  atHour: 4,
};

export interface MessagingSessionSnapshot {
  /** Epoch ms of the last kept turn. Null when the session has no activity. */
  lastActivityAt: number | null;
  transcript: string;
}

export type MemorySaveResult =
  | { ok: true; receipt: string }
  | { ok: false; error: string };

export type MessagingSessionResetOutcome =
  | { action: 'kept' }
  | { action: 'reset'; reason: MessagingSessionResetReason; receipt: string }
  | { action: 'cancelled'; reason: MessagingSessionResetReason; error: string };

interface MemoryArchiveRecord {
  schemaVersion: 1;
  savedAt: string;
  reason: MessagingSessionResetReason;
  transcript: string;
  digest: string;
}

const MODES = new Set<MessagingSessionResetMode>(['both', 'idle', 'daily', 'none']);
const DIGEST_RECEIPT = /^[a-f0-9]{64}$/;

export function isDigestReceipt(receipt: string): boolean {
  return DIGEST_RECEIPT.test(receipt);
}

function digestTranscript(transcript: string): string {
  return createHash('sha256').update(transcript).digest('hex');
}

/**
 * Local daily boundary at atHour:00:00.000.
 * Before that hour, the boundary is the previous calendar day.
 */
export function dailyResetBoundaryMs(nowMs: number, atHour: number): number {
  const now = new Date(nowMs);
  const boundary = new Date(now.getFullYear(), now.getMonth(), now.getDate(), atHour, 0, 0, 0);
  if (now.getHours() < atHour) boundary.setDate(boundary.getDate() - 1);
  return boundary.getTime();
}

export function resolveSessionResetPolicy(raw: unknown): MessagingSessionResetPolicy {
  const base = { ...DEFAULT_MESSAGING_SESSION_RESET_POLICY };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
  const record = raw as { mode?: unknown; idle_minutes?: unknown; at_hour?: unknown };
  const mode = typeof record.mode === 'string' ? record.mode.trim().toLowerCase() : '';
  if (MODES.has(mode as MessagingSessionResetMode)) base.mode = mode as MessagingSessionResetMode;
  if (typeof record.idle_minutes === 'number' && Number.isInteger(record.idle_minutes) && record.idle_minutes >= 1) {
    base.idleMinutes = record.idle_minutes;
  }
  if (typeof record.at_hour === 'number' && Number.isInteger(record.at_hour) && record.at_hour >= 0 && record.at_hour <= 23) {
    base.atHour = record.at_hour;
  }
  return base;
}

/**
 * Idle is decided before daily, so mode both reports idle when both match.
 * Equality does not reset: idle uses a strict deadline, daily a strict boundary.
 */
export function decideMessagingSessionReset(
  policy: MessagingSessionResetPolicy,
  lastActivityAt: number | null,
  nowMs: number,
): MessagingSessionResetReason | null {
  if (policy.mode === 'none') return null;
  if (lastActivityAt === null || !Number.isFinite(lastActivityAt) || !Number.isFinite(nowMs)) return null;

  if (policy.mode === 'idle' || policy.mode === 'both') {
    const deadline = lastActivityAt + policy.idleMinutes * 60_000;
    if (nowMs > deadline) return 'idle';
  }

  if (policy.mode === 'daily' || policy.mode === 'both') {
    const boundary = dailyResetBoundaryMs(nowMs, policy.atHour);
    if (lastActivityAt < boundary) return 'daily';
  }

  return null;
}

export function proveMessagingMemorySave(input: {
  archiveDir: string;
  sessionKey: string;
  transcript: string;
  now: number;
  reason: MessagingSessionResetReason;
}): MemorySaveResult {
  const digest = digestTranscript(input.transcript);
  const record: MemoryArchiveRecord = {
    schemaVersion: 1,
    savedAt: new Date(input.now).toISOString(),
    reason: input.reason,
    transcript: input.transcript,
    digest,
  };
  const fileName = `${createHash('sha256').update(input.sessionKey).digest('hex').slice(0, 32)}.json`;
  const filePath = path.join(input.archiveDir, fileName);
  try {
    writeJsonAtomicSync(filePath, record, { mode: 0o600 });
    const readBack = readJsonAtomicSync<MemoryArchiveRecord | null>(filePath, null, {
      mode: 0o600,
      isValid: (value): value is MemoryArchiveRecord => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
        const candidate = value as Partial<MemoryArchiveRecord>;
        return candidate.schemaVersion === 1
          && typeof candidate.transcript === 'string'
          && typeof candidate.digest === 'string'
          && (candidate.reason === 'idle' || candidate.reason === 'daily');
      },
    });
    if (!readBack) return { ok: false, error: 'memory archive read-back failed' };
    if (readBack.transcript !== input.transcript || readBack.digest !== digest) {
      return { ok: false, error: 'memory archive read-back mismatch' };
    }
    const onDisk = fs.readFileSync(filePath, 'utf8');
    if (!onDisk.includes(digest)) return { ok: false, error: 'memory archive read-back mismatch' };
    return { ok: true, receipt: digest };
  } catch {
    return { ok: false, error: 'memory archive write failed' };
  }
}

export async function enforceMessagingSessionReset(input: {
  policy: MessagingSessionResetPolicy;
  now: number;
  snapshot: MessagingSessionSnapshot;
  saveMemory: (transcript: string, reason: MessagingSessionResetReason) => Promise<MemorySaveResult>;
  resetSession: () => Promise<void>;
}): Promise<MessagingSessionResetOutcome> {
  const reason = decideMessagingSessionReset(input.policy, input.snapshot.lastActivityAt, input.now);
  if (!reason) return { action: 'kept' };

  let saved: MemorySaveResult;
  try {
    saved = await input.saveMemory(input.snapshot.transcript, reason);
  } catch {
    return { action: 'cancelled', reason, error: 'memory save failed' };
  }
  if (!saved.ok || !isDigestReceipt(saved.receipt)) {
    return {
      action: 'cancelled',
      reason,
      error: saved.ok ? 'memory save not proven' : saved.error,
    };
  }

  await input.resetSession();
  return { action: 'reset', reason, receipt: saved.receipt };
}

export async function applyChannelMessagingSessionReset(input: {
  sessionKey: string;
  now: number;
  policy: MessagingSessionResetPolicy;
  snapshot: MessagingSessionSnapshot;
  archiveDir: string;
  resetSession: () => Promise<void>;
}): Promise<MessagingSessionResetOutcome> {
  return enforceMessagingSessionReset({
    policy: input.policy,
    now: input.now,
    snapshot: input.snapshot,
    saveMemory: (transcript, reason) => Promise.resolve(proveMessagingMemorySave({
      archiveDir: input.archiveDir,
      sessionKey: input.sessionKey,
      transcript,
      now: input.now,
      reason,
    })),
    resetSession: input.resetSession,
  });
}
