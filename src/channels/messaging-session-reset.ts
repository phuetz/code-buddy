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

import { createHash, randomBytes } from 'node:crypto';
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
  epoch: string;
}

const MODES = new Set<MessagingSessionResetMode>(['both', 'idle', 'daily', 'none']);
const DIGEST_RECEIPT = /^[a-f0-9]{64}$/;

/**
 * Every store the channel reset erases. Each one is archived on its own.
 * A failure of any part cancels the reset before anything is cleared.
 */
export const MESSAGING_MEMORY_SOURCES = [
  'agent-cache',
  'session-store',
  'companion-history',
  'local-map',
] as const;

export type MessagingMemorySource = (typeof MESSAGING_MEMORY_SOURCES)[number];

export interface MessagingMemoryPart {
  source: MessagingMemorySource;
  transcript: string;
  /**
   * Omitted or `ok`: the transcript was read, even when it is empty.
   * `failed`: the store could not be read. Nothing may be archived or erased.
   */
  readState?: 'ok' | 'failed';
}

const ARCHIVE_EPOCH = /^[0-9a-z]{8,80}$/;

export function resolveMessagingSessionResetArchiveDir(env: NodeJS.ProcessEnv, homeDir: string): string {
  const configured = env.CODEBUDDY_SESSION_RESET_ARCHIVE_DIR?.trim();
  if (configured) return configured;
  return path.join(homeDir, '.codebuddy', 'companion', 'session-reset-archive');
}

function sessionStem(sessionKey: string): string {
  return createHash('sha256').update(sessionKey).digest('hex').slice(0, 32);
}

function allocateArchiveEpoch(now: number): string {
  const time = Math.max(0, Math.floor(now)).toString(36);
  return `${time}${randomBytes(4).toString('hex')}`;
}

/**
 * One epoch file per save. Without `epoch`, the returned path is only a
 * stable prefix helper; saves themselves never reuse a previous file.
 */
export function messagingMemoryArchivePath(
  archiveDir: string,
  sessionKey: string,
  source?: MessagingMemorySource,
  epoch?: string,
): string {
  if (epoch !== undefined && !ARCHIVE_EPOCH.test(epoch)) {
    throw new Error('invalid archive epoch');
  }
  const directory = source ? path.join(archiveDir, source) : archiveDir;
  const fileName = epoch ? `${sessionStem(sessionKey)}.${epoch}.json` : `${sessionStem(sessionKey)}.json`;
  return path.join(directory, fileName);
}

function assertRealDirectory(directory: string, label: string): void {
  const listed = fs.lstatSync(directory);
  if (listed.isSymbolicLink() || !listed.isDirectory()) {
    throw new Error(`${label} is not a real directory`);
  }
}

function prepareRealDirectory(directory: string, label: string): void {
  try {
    assertRealDirectory(directory, label);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') throw err;
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    assertRealDirectory(directory, label);
  }
}

function prepareSourceDirectory(archiveDir: string, source: MessagingMemorySource): string {
  prepareRealDirectory(archiveDir, 'memory archive directory');
  const child = path.join(archiveDir, source);
  try {
    assertRealDirectory(child, 'memory archive source');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') throw err;
    fs.mkdirSync(child, { mode: 0o700 });
    assertRealDirectory(child, 'memory archive source');
  }
  return child;
}

/** Read every epoch already stored for one session source. Symlinks are skipped. */
export function readMessagingMemoryArchive(
  archiveDir: string,
  sessionKey: string,
  source?: MessagingMemorySource,
): string {
  const directory = source ? path.join(archiveDir, source) : archiveDir;
  const stem = sessionStem(sessionKey);
  let names: string[];
  try {
    const listed = fs.lstatSync(directory);
    if (listed.isSymbolicLink() || !listed.isDirectory()) return '';
    names = fs.readdirSync(directory);
  } catch {
    return '';
  }
  return names
    .filter((name) => name.startsWith(`${stem}.`) && name.endsWith('.json'))
    .sort()
    .map((name) => {
      const full = path.join(directory, name);
      try {
        const listed = fs.lstatSync(full);
        if (listed.isSymbolicLink() || !listed.isFile()) return '';
        return fs.readFileSync(full, 'utf8');
      } catch {
        return '';
      }
    })
    .filter((text) => text.length > 0)
    .join('\n');
}

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

function isArchiveRecord(value: unknown): value is MemoryArchiveRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<MemoryArchiveRecord>;
  return candidate.schemaVersion === 1
    && typeof candidate.transcript === 'string'
    && typeof candidate.digest === 'string'
    && typeof candidate.epoch === 'string'
    && (candidate.reason === 'idle' || candidate.reason === 'daily');
}

export function proveMessagingMemorySave(input: {
  archiveDir: string;
  sessionKey: string;
  transcript: string;
  now: number;
  reason: MessagingSessionResetReason;
  source?: MessagingMemorySource;
}): MemorySaveResult {
  const digest = digestTranscript(input.transcript);
  try {
    let directory = input.archiveDir;
    if (input.source) directory = prepareSourceDirectory(input.archiveDir, input.source);
    else prepareRealDirectory(input.archiveDir, 'memory archive directory');
    let epoch = allocateArchiveEpoch(input.now);
    let filePath = path.join(directory, `${sessionStem(input.sessionKey)}.${epoch}.json`);
    for (let attempt = 0; attempt < 5 && fs.existsSync(filePath); attempt += 1) {
      epoch = allocateArchiveEpoch(input.now + attempt + 1);
      filePath = path.join(directory, `${sessionStem(input.sessionKey)}.${epoch}.json`);
    }
    if (fs.existsSync(filePath)) return { ok: false, error: 'memory archive path collision' };
    const existing = (() => {
      try {
        return fs.lstatSync(filePath);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw err;
      }
    })();
    if (existing) return { ok: false, error: 'memory archive path collision' };
    const record: MemoryArchiveRecord = {
      schemaVersion: 1,
      savedAt: new Date(input.now).toISOString(),
      reason: input.reason,
      transcript: input.transcript,
      digest,
      epoch,
    };
    writeJsonAtomicSync(filePath, record, { mode: 0o600 });
    const readBack = readJsonAtomicSync<MemoryArchiveRecord | null>(filePath, null, {
      mode: 0o600,
      isValid: isArchiveRecord,
    });
    if (!readBack) return { ok: false, error: 'memory archive read-back failed' };
    if (readBack.transcript !== input.transcript || readBack.digest !== digest || readBack.epoch !== epoch) {
      return { ok: false, error: 'memory archive read-back mismatch' };
    }
    const onDisk = fs.readFileSync(filePath, 'utf8');
    if (!onDisk.includes(digest) || !onDisk.includes(epoch)) {
      return { ok: false, error: 'memory archive read-back mismatch' };
    }
    return { ok: true, receipt: digest };
  } catch {
    return { ok: false, error: 'memory archive write failed' };
  }
}

/**
 * Archive every erased store. The first failure is returned as-is and the
 * caller must not clear anything. The receipt covers every part that was proved.
 */
export function proveMessagingMemoryParts(input: {
  archiveDir: string;
  sessionKey: string;
  parts: readonly MessagingMemoryPart[];
  now: number;
  reason: MessagingSessionResetReason;
}): MemorySaveResult {
  for (const part of input.parts) {
    if (part.readState === 'failed') {
      return { ok: false, error: `memory read failed: ${part.source}` };
    }
  }
  const proved: string[] = [];
  for (const part of input.parts) {
    const saved = proveMessagingMemorySave({
      archiveDir: input.archiveDir,
      sessionKey: input.sessionKey,
      transcript: part.transcript,
      now: input.now,
      reason: input.reason,
      source: part.source,
    });
    if (!saved.ok) return saved;
    proved.push(`${part.source}:${saved.receipt}`);
  }
  return {
    ok: true,
    receipt: createHash('sha256').update(proved.join('\n')).digest('hex'),
  };
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

  try {
    await input.resetSession();
  } catch (err) {
    return {
      action: 'cancelled',
      reason,
      error: err instanceof Error ? err.message : 'reset failed',
    };
  }
  return { action: 'reset', reason, receipt: saved.receipt };
}

export async function applyChannelMessagingSessionReset(input: {
  sessionKey: string;
  now: number;
  policy: MessagingSessionResetPolicy;
  snapshot: MessagingSessionSnapshot;
  archiveDir: string;
  /** When set, each part is proved. Any failure cancels the reset. */
  parts?: readonly MessagingMemoryPart[];
  resetSession: () => Promise<void>;
}): Promise<MessagingSessionResetOutcome> {
  return enforceMessagingSessionReset({
    policy: input.policy,
    now: input.now,
    snapshot: input.snapshot,
    saveMemory: (transcript, reason) => Promise.resolve(
      input.parts && input.parts.length > 0
        ? proveMessagingMemoryParts({
            archiveDir: input.archiveDir,
            sessionKey: input.sessionKey,
            parts: input.parts,
            now: input.now,
            reason,
          })
        : proveMessagingMemorySave({
            archiveDir: input.archiveDir,
            sessionKey: input.sessionKey,
            transcript,
            now: input.now,
            reason,
          }),
    ),
    resetSession: input.resetSession,
  });
}
