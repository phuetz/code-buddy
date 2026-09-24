/**
 * Automatic reset of messaging-channel sessions.
 *
 * Modes follow the Hermes session_reset policy (both, idle, daily, none).
 * The default is none: an absent or invalid section keeps today's behavior.
 * A reset is applied only after a memory archive has been written and read
 * back. A failed save leaves the session untouched. The session file itself
 * is archived as a verbatim copy of its bytes, so the copy has the file's
 * at-rest state by construction. When the session is encrypted at rest, every
 * other archived store is sealed with the same key.
 *
 * The clock is injected. This module never sleeps.
 *
 * @module channels/messaging-session-reset
 */

import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { decryptSessionContent, hasEncryptedSessionContent } from '../persistence/session-content.js';
import type { SessionMessage } from '../persistence/session-store.js';
import { readJsonAtomicSyncReadOnly, writeJsonAtomicSync } from '../utils/atomic-write.js';

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

interface PlainMemoryArchiveRecord {
  schemaVersion: 1;
  savedAt: string;
  reason: MessagingSessionResetReason;
  transcript: string;
  digest: string;
  epoch: string;
}

/**
 * Archive of a session whose messages are encrypted at rest. The transcript
 * is stored only sealed, and the digest covers the sealed payload so no hash
 * of the plaintext lands on disk either.
 */
interface SealedMemoryArchiveRecord {
  schemaVersion: 1;
  savedAt: string;
  reason: MessagingSessionResetReason;
  encrypted: true;
  sealed: string;
  digest: string;
  epoch: string;
}

type MemoryArchiveRecord = PlainMemoryArchiveRecord | SealedMemoryArchiveRecord;

/**
 * Encryption of an archive, the same one the session store applies to the
 * messages it archives. `seal` must never return the text it was given.
 */
export interface MessagingArchiveSealer {
  seal(transcript: string): Promise<string>;
  /** Throws when the payload cannot be opened with the current key. */
  open(sealed: string): string;
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
  /** Sealed form of `transcript`. When present, only this form is written. */
  sealed?: string;
  /**
   * Exact bytes of the store's file, read once. When present, these bytes are
   * the archive: never decoded, sealed or rewritten. `transcript` is what they
   * decode to, for the caller's own checks only.
   */
  raw?: Uint8Array;
  /**
   * Omitted or `ok`: the transcript was read, even when it is empty.
   * `failed`: the store could not be read. Nothing may be archived or erased.
   */
  readState?: 'ok' | 'failed';
}

const ARCHIVE_EPOCH = /^[0-9a-z]{8,80}$/;
/** Suffix of a verbatim session file copy, next to the JSON archive records. */
const VERBATIM_SUFFIX = '.session.json';

/** The text form of session messages that archives and reset checks compare. */
export function sessionMessagesTranscript(messages: ReadonlyArray<{ type: string; content: string }>): string {
  return messages
    .map((message) => `${message.type}: ${message.content}`)
    .filter((line) => line.trim().length > 2)
    .join('\n');
}

/**
 * Throws on a relative configured directory: it would resolve against
 * whatever directory the process is in when the reset runs, so archives
 * would land in, and be looked for in, a different place after a chdir.
 */
export function resolveMessagingSessionResetArchiveDir(env: NodeJS.ProcessEnv, homeDir: string): string {
  const configured = env.CODEBUDDY_SESSION_RESET_ARCHIVE_DIR?.trim();
  if (configured && !path.isAbsolute(configured)) {
    throw new Error('memory archive directory must be absolute');
  }
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

function openVerbatimSessionCopy(file: string, open: ((sealed: string) => string) | undefined, keyPath?: string): string {
  const data: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
  const messages = (data as { messages?: unknown } | null)?.messages;
  if (!Array.isArray(messages)) throw new Error('memory archive invalid');
  const stored = messages as SessionMessage[];
  if (!hasEncryptedSessionContent(stored)) return sessionMessagesTranscript(stored);
  if (!open) throw new Error('memory archive is sealed');
  return sessionMessagesTranscript(decryptSessionContent(stored, keyPath));
}

/**
 * Restore the transcripts archived for one session source, oldest first.
 * A sealed archive needs `open`; without it, or with a wrong key, this throws.
 * A verbatim session copy holding the encrypted envelope is opened with the
 * session key at `keyPath` (the default key when omitted), and needs `open` too.
 */
export function openMessagingMemoryArchive(
  archiveDir: string,
  sessionKey: string,
  source: MessagingMemorySource,
  open?: (sealed: string) => string,
  keyPath?: string,
): string[] {
  const raw = readMessagingMemoryArchive(archiveDir, sessionKey, source);
  if (!raw) return [];
  const directory = path.join(archiveDir, source);
  const stem = sessionStem(sessionKey);
  return fs.readdirSync(directory)
    .filter((name) => name.startsWith(`${stem}.`) && name.endsWith('.json'))
    .sort()
    .map((name) => {
      if (name.endsWith(VERBATIM_SUFFIX)) return openVerbatimSessionCopy(path.join(directory, name), open, keyPath);
      const read = readJsonAtomicSyncReadOnly<MemoryArchiveRecord>(path.join(directory, name), isArchiveRecord);
      if (read.status !== 'ok') throw new Error(`memory archive ${read.status}`);
      if (!('sealed' in read.value)) return read.value.transcript;
      if (!open) throw new Error('memory archive is sealed');
      return open(read.value.sealed);
    });
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
  const candidate = value as Partial<PlainMemoryArchiveRecord> & Partial<SealedMemoryArchiveRecord>;
  const common = candidate.schemaVersion === 1
    && typeof candidate.digest === 'string'
    && typeof candidate.epoch === 'string'
    && (candidate.reason === 'idle' || candidate.reason === 'daily');
  if (!common) return false;
  if (candidate.encrypted === true) return typeof candidate.sealed === 'string' && !('transcript' in candidate);
  return typeof candidate.transcript === 'string' && !('sealed' in candidate);
}

export function proveMessagingMemorySave(input: {
  archiveDir: string;
  sessionKey: string;
  transcript: string;
  now: number;
  reason: MessagingSessionResetReason;
  source?: MessagingMemorySource;
  /**
   * Sealed form of the transcript and its opener. When set, the transcript
   * never reaches the file: only the sealed payload is written, then opened
   * again to prove the archive can be restored.
   */
  sealed?: { payload: string; open: (sealed: string) => string };
  /**
   * Exact bytes of the store file. When set, the archive is these bytes and
   * nothing else, written once and compared byte for byte on read-back.
   */
  raw?: Uint8Array;
}): MemorySaveResult {
  const sealed = input.sealed;
  const raw = input.raw;
  if (sealed && raw) return { ok: false, error: 'memory archive is both sealed and verbatim' };
  if (sealed && input.transcript.length > 0 && sealed.payload.includes(input.transcript)) {
    return { ok: false, error: 'memory archive sealing left plaintext' };
  }
  const digest = raw
    ? createHash('sha256').update(raw).digest('hex')
    : digestTranscript(sealed ? sealed.payload : input.transcript);
  const suffix = raw ? VERBATIM_SUFFIX : '.json';
  try {
    let directory = input.archiveDir;
    if (input.source) directory = prepareSourceDirectory(input.archiveDir, input.source);
    else prepareRealDirectory(input.archiveDir, 'memory archive directory');
    let epoch = allocateArchiveEpoch(input.now);
    let filePath = path.join(directory, `${sessionStem(input.sessionKey)}.${epoch}${suffix}`);
    for (let attempt = 0; attempt < 5 && fs.existsSync(filePath); attempt += 1) {
      epoch = allocateArchiveEpoch(input.now + attempt + 1);
      filePath = path.join(directory, `${sessionStem(input.sessionKey)}.${epoch}${suffix}`);
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
    if (raw) {
      // 'wx': never follows or replaces an existing path. No decode, no rewrite.
      const fd = fs.openSync(filePath, 'wx', 0o600);
      try {
        fs.writeFileSync(fd, raw);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      if (!fs.readFileSync(filePath).equals(Buffer.from(raw))) {
        return { ok: false, error: 'memory archive read-back mismatch' };
      }
      return { ok: true, receipt: digest };
    }
    const savedAt = new Date(input.now).toISOString();
    const record: MemoryArchiveRecord = sealed
      ? { schemaVersion: 1, savedAt, reason: input.reason, encrypted: true, sealed: sealed.payload, digest, epoch }
      : { schemaVersion: 1, savedAt, reason: input.reason, transcript: input.transcript, digest, epoch };
    writeJsonAtomicSync(filePath, record, { mode: 0o600 });
    const readBack = readJsonAtomicSyncReadOnly<MemoryArchiveRecord>(filePath, isArchiveRecord);
    if (readBack.status === 'missing') return { ok: false, error: 'memory archive read-back missing' };
    if (readBack.status !== 'ok') return { ok: false, error: `memory archive read-back ${readBack.status}` };
    if (readBack.value.digest !== digest || readBack.value.epoch !== epoch) {
      return { ok: false, error: 'memory archive read-back mismatch' };
    }
    if (sealed) {
      if (!('sealed' in readBack.value) || readBack.value.sealed !== sealed.payload) {
        return { ok: false, error: 'memory archive read-back mismatch' };
      }
      if (sealed.open(readBack.value.sealed) !== input.transcript) {
        return { ok: false, error: 'memory archive cannot be opened' };
      }
    } else if (!('transcript' in readBack.value) || readBack.value.transcript !== input.transcript) {
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
  /** Required as soon as one part is sealed; then every part must be. */
  open?: (sealed: string) => string;
}): MemorySaveResult {
  for (const part of input.parts) {
    if (part.readState === 'failed') {
      return { ok: false, error: `memory read failed: ${part.source}` };
    }
  }
  // A verbatim part keeps its file's own at-rest state; the rule covers the others.
  const copied = input.parts.filter((part) => part.raw === undefined);
  const sealedCount = copied.filter((part) => part.sealed !== undefined).length;
  if (sealedCount > 0 && (sealedCount !== copied.length || !input.open)) {
    return { ok: false, error: 'memory archive partly sealed' };
  }
  const open = input.open;
  const proved: string[] = [];
  for (const part of input.parts) {
    const saved = proveMessagingMemorySave({
      archiveDir: input.archiveDir,
      sessionKey: input.sessionKey,
      transcript: part.transcript,
      now: input.now,
      reason: input.reason,
      source: part.source,
      ...(part.raw !== undefined ? { raw: part.raw } : {}),
      ...(part.sealed !== undefined && open ? { sealed: { payload: part.sealed, open } } : {}),
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
  /**
   * Set when the session is encrypted at rest. Every archived part is then
   * sealed, including the stores that may repeat the same turns, except a
   * verbatim part (`raw`), already in its file's at-rest form. A sealing
   * failure cancels the reset before anything is written.
   */
  sealer?: MessagingArchiveSealer;
  resetSession: () => Promise<void>;
}): Promise<MessagingSessionResetOutcome> {
  const sealer = input.sealer;
  return enforceMessagingSessionReset({
    policy: input.policy,
    now: input.now,
    snapshot: input.snapshot,
    saveMemory: async (transcript, reason) => {
      if (input.parts && input.parts.length > 0) {
        // One at a time: a first seal may create the key, and parallel
        // creations can each write a different one.
        let parts: readonly MessagingMemoryPart[] = input.parts;
        if (sealer) {
          const sealedParts: MessagingMemoryPart[] = [];
          for (const part of input.parts) {
            sealedParts.push(part.raw !== undefined ? part : { ...part, sealed: await sealer.seal(part.transcript) });
          }
          parts = sealedParts;
        }
        return proveMessagingMemoryParts({
          archiveDir: input.archiveDir,
          sessionKey: input.sessionKey,
          parts,
          now: input.now,
          reason,
          ...(sealer ? { open: (payload: string) => sealer.open(payload) } : {}),
        });
      }
      return proveMessagingMemorySave({
        archiveDir: input.archiveDir,
        sessionKey: input.sessionKey,
        transcript,
        now: input.now,
        reason,
        ...(sealer
          ? { sealed: { payload: await sealer.seal(transcript), open: (payload: string) => sealer.open(payload) } }
          : {}),
      });
    },
    resetSession: input.resetSession,
  });
}
