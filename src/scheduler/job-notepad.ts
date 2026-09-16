/**
 * Per-job bounded continuity store (Hermes-inspired cron notepad).
 *
 * Isolated JSON files under `<cron-root>/notepads/<jobId>.json`, written
 * atomically (0600): 16 KiB per value, 128-char keys, 64 KiB per serialized
 * record. Mutations use an exclusive per-job lock across local processes.
 * Contention requires retry; abandoned locks require operator inspection and
 * are never stolen. Invalid/corrupt records are preserved for inspection.
 */

import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import * as path from 'node:path';
import { writeJsonAtomic } from '../utils/atomic-write.js';
import { logger } from '../utils/logger.js';

export const MAX_VALUE_BYTES = 16 * 1024;
export const MAX_KEY_CHARS = 128;
export const MAX_JOB_TOTAL_BYTES = 64 * 1024;
export const MAX_LAST_OUTPUT_BYTES = 16 * 1024;

export type ContinuityFlag =
  | boolean
  | {
      enabled?: boolean;
      notes?: Record<string, string>;
    };

export interface JobNotepadRecord {
  notes: Record<string, string>;
  /** Most recent non-empty successful output that was saved. */
  lastSuccessfulOutput?: string;
  updatedAt: string;
}

export class JobNotepadBusyError extends Error {
  constructor() {
    super('Job notepad mutation locked; retry. An abandoned lock requires operator inspection.');
    this.name = 'JobNotepadBusyError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

/** Validate operator/tool input before changing jobs or writing any notes. */
export function validateContinuity(value: unknown): ContinuityFlag {
  if (typeof value === 'boolean') return value;
  if (!isRecord(value) || Object.keys(value).some(key => key !== 'enabled' && key !== 'notes')
    || (value.enabled !== undefined && typeof value.enabled !== 'boolean')) {
    throw new Error('Invalid continuity: expected a boolean or an object with enabled and notes');
  }
  if (value.notes !== undefined) assertNotesWithinCaps(value.notes);
  return {
    ...(value.enabled !== undefined ? { enabled: value.enabled as boolean } : {}),
    ...(value.notes !== undefined ? { notes: { ...value.notes as Record<string, string> } } : {}),
  };
}

export function isContinuityEnabled(continuity: ContinuityFlag | undefined): boolean {
  if (!isRecord(continuity)) {
    return continuity === true;
  }
  return continuity.enabled !== false;
}

/** Persist the opt-in flag only — notes live in the notepad file, not jobs.json. */
export function persistableContinuity(
  continuity: ContinuityFlag | undefined,
): boolean | { enabled: boolean } | undefined {
  if (continuity === undefined) return undefined;
  continuity = validateContinuity(continuity);
  if (typeof continuity === 'boolean') return continuity;
  return { enabled: continuity.enabled !== false };
}

export function defaultNotepadDir(): string {
  const root = process.env.CODEBUDDY_CRON_HOME
    ? path.resolve(process.env.CODEBUDDY_CRON_HOME)
    : path.join(homedir(), '.codebuddy', 'cron');
  return path.join(root, 'notepads');
}

export function utf8ByteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

export function sanitizeJobId(jobId: string): string {
  if (typeof jobId !== 'string' || !jobId || jobId.length > 128 || !/^[A-Za-z0-9._-]+$/.test(jobId)) {
    throw new Error('invalid job id');
  }
  return jobId;
}

export function truncateUtf8(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return '';
  const buf = Buffer.from(value, 'utf8');
  if (buf.length <= maxBytes) return value;
  let end = maxBytes;
  while (end > 0 && ((buf[end] ?? 0) & 0xc0) === 0x80) end -= 1;
  return buf.subarray(0, end).toString('utf8');
}

export function notesByteTotal(notes: Record<string, string>): number {
  let total = 0;
  for (const [key, value] of Object.entries(notes)) {
    total += utf8ByteLength(key) + utf8ByteLength(value);
  }
  return total;
}

export function assertNotesWithinCaps(notes: unknown): asserts notes is Record<string, string> {
  if (!isRecord(notes)) throw new Error('notes must be an object of strings');
  let total = 0;
  for (const [key, value] of Object.entries(notes)) {
    if (!key) throw new Error('key must be non-empty');
    if (key.length > MAX_KEY_CHARS) {
      throw new Error(`key too long (max ${MAX_KEY_CHARS} characters)`);
    }
    if (typeof value !== 'string') {
      throw new Error(`note '${key}' must be a string`);
    }
    const valueBytes = utf8ByteLength(value);
    if (valueBytes > MAX_VALUE_BYTES) {
      throw new Error(`value too large (max ${MAX_VALUE_BYTES} bytes per key)`);
    }
    total += utf8ByteLength(key) + valueBytes;
    if (total > MAX_JOB_TOTAL_BYTES) {
      throw new Error(`notepad full: would exceed ${MAX_JOB_TOTAL_BYTES} bytes total`);
    }
  }
  assertRecordSize({ ...emptyRecord(), notes: notes as Record<string, string> });
}

function assertNotepadRecord(value: unknown): asserts value is JobNotepadRecord {
  if (!isRecord(value) || Object.keys(value).some(key => !['notes', 'updatedAt', 'lastSuccessfulOutput'].includes(key))
    || typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt))) {
    throw new Error('Invalid notepad record');
  }
  assertNotesWithinCaps(value.notes);
  if (value.lastSuccessfulOutput !== undefined && (typeof value.lastSuccessfulOutput !== 'string'
    || utf8ByteLength(value.lastSuccessfulOutput) > MAX_LAST_OUTPUT_BYTES)) throw new Error('Invalid last successful output');
  assertRecordSize(value as unknown as JobNotepadRecord);
}

function emptyRecord(): JobNotepadRecord {
  return { notes: {}, updatedAt: new Date().toISOString() };
}

function serializedBytes(record: JobNotepadRecord): number {
  // Match writeJsonAtomic's indentation and final newline, including escaping.
  return utf8ByteLength(`${JSON.stringify(record, null, 2)}\n`);
}

function assertRecordSize(record: JobNotepadRecord): void {
  if (serializedBytes(record) > MAX_JOB_TOTAL_BYTES) {
    throw new Error(`notepad full: would exceed ${MAX_JOB_TOTAL_BYTES} serialized bytes total`);
  }
}

export class JobNotepadStore {
  constructor(private readonly dir: string = defaultNotepadDir()) {}

  fileFor(jobId: string): string {
    const safe = sanitizeJobId(jobId);
    const root = path.resolve(this.dir);
    const file = path.resolve(root, `${safe}.json`);
    const prefix = root.endsWith(path.sep) ? root : root + path.sep;
    if (file !== path.join(root, `${safe}.json`) && !file.startsWith(prefix)) {
      throw new Error('invalid job id');
    }
    return file;
  }

  async load(jobId: string): Promise<JobNotepadRecord> {
    let handle;
    try { handle = await fs.open(this.fileFor(jobId), 'r'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyRecord();
      throw error;
    }
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new Error('Notepad must be a regular file');
      if (stat.size > MAX_JOB_TOTAL_BYTES) throw new Error('Notepad record exceeds size limit');
      const buffer = Buffer.alloc(MAX_JOB_TOTAL_BYTES + 1);
      let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
        if (bytesRead === 0) break;
        length += bytesRead;
      }
      if (length > MAX_JOB_TOTAL_BYTES) throw new Error('Notepad record exceeds size limit');
      const loaded: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length)));
      assertNotepadRecord(loaded);
      return loaded;
    } finally { await handle.close(); }
  }

  async setNote(jobId: string, key: string, value: string): Promise<JobNotepadRecord> {
    assertNotesWithinCaps({ [key]: value });
    return this.withMutationLock(jobId, async () => {
      const current = await this.load(jobId);
      return this.commitNotes(jobId, current, { ...current.notes, [key]: value });
    });
  }

  async replaceNotes(jobId: string, notes: Record<string, string>): Promise<JobNotepadRecord> {
    assertNotesWithinCaps(notes);
    const snapshot = { ...notes };
    return this.withMutationLock(jobId, async () => this.commitNotes(jobId, await this.load(jobId), snapshot));
  }

  async getNote(jobId: string, key: string): Promise<string | undefined> {
    const current = await this.load(jobId);
    return Object.hasOwn(current.notes, key) ? current.notes[key] : undefined;
  }

  async deleteNote(jobId: string, key: string): Promise<boolean> {
    return this.withMutationLock(jobId, async () => {
      const current = await this.load(jobId);
      if (!Object.hasOwn(current.notes, key)) return false;
      const nextNotes = { ...current.notes };
      delete nextNotes[key];
      await this.commitNotes(jobId, current, nextNotes);
      return true;
    });
  }

  async listNotes(jobId: string): Promise<Array<{ key: string; value: string }>> {
    const current = await this.load(jobId);
    return Object.keys(current.notes)
      .sort()
      .map((key) => ({ key, value: current.notes[key] ?? '' }));
  }

  /**
   * Record the last *successful* job output. Truncates to the per-value and
   * serialized per-job caps. Storage errors are reported to the caller.
   * Empty output leaves the previous non-empty successful output in place.
   */
  async saveLastSuccessfulOutput(jobId: string, output: string): Promise<void> {
    if (typeof output !== 'string' || output.length === 0) return;
    await this.withMutationLock(jobId, async () => {
      const current = await this.load(jobId);
      const capped = truncateUtf8(output, MAX_LAST_OUTPUT_BYTES);
      const next = { ...current, lastSuccessfulOutput: capped, updatedAt: new Date().toISOString() };
      let low = 0;
      let high = utf8ByteLength(capped);
      let best = '';
      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const candidate = truncateUtf8(capped, middle);
        if (serializedBytes({ ...next, lastSuccessfulOutput: candidate }) <= MAX_JOB_TOTAL_BYTES) {
          best = candidate;
          low = middle + 1;
        } else high = middle - 1;
      }
      if (!best) throw new Error('notepad full: no room for the latest successful output');
      await this.write(jobId, { ...next, lastSuccessfulOutput: best });
    });
  }

  /** Missing files are a no-op; existing files share writer exclusion. */
  async clear(jobId: string): Promise<void> {
    try { await fs.lstat(this.fileFor(jobId)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    await this.withMutationLock(jobId, async () => {
      try { await fs.unlink(this.fileFor(jobId)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    });
  }

  /**
   * Prompt section for this job. Empty notepad MUST return '' so jobs that
   * never use continuity keep a byte-identical agent prompt.
   */
  async renderSection(jobId: string): Promise<string> {
    try {
      const rec = await this.load(jobId);
      const keys = Object.keys(rec.notes).sort();
      const hasNotes = keys.length > 0;
      const last = rec.lastSuccessfulOutput;
      const hasOutput = typeof last === 'string' && last.length > 0;
      if (!hasNotes && !hasOutput) return '';

      const parts: string[] = [];
      if (hasNotes) {
        const lines = keys.map((key) => `- ${key}: ${rec.notes[key] ?? ''}`);
        parts.push(
          '## Job notepad (persistent across runs)\n'
          + 'This durable scratchpad survives between scheduled runs of this job.\n\n'
          + lines.join('\n'),
        );
      }
      if (hasOutput) {
        parts.push(`## Last successful output (last non-empty result)\n${last}`);
      }
      return `${parts.join('\n\n')}\n`;
    } catch (error) {
      logger.warn('Cron continuity could not be loaded; proceeding without stored context', { jobId, error: String(error) });
      return '';
    }
  }

  private async commitNotes(
    jobId: string,
    current: JobNotepadRecord,
    nextNotes: Record<string, string>,
  ): Promise<JobNotepadRecord> {
    const next: JobNotepadRecord = {
      notes: nextNotes,
      updatedAt: new Date().toISOString(),
      ...(current.lastSuccessfulOutput !== undefined
        ? { lastSuccessfulOutput: current.lastSuccessfulOutput }
        : {}),
    };
    await this.write(jobId, next);
    return next;
  }

  private async write(jobId: string, record: JobNotepadRecord): Promise<void> {
    assertNotepadRecord(record);
    await writeJsonAtomic(this.fileFor(jobId), record, { mode: 0o600 });
  }

  private async withMutationLock<T>(jobId: string, action: () => Promise<T>): Promise<T> {
    const file = this.fileFor(jobId);
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const lock = `${file}.lock`;
    let handle;
    try { handle = await fs.open(lock, 'wx', 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new JobNotepadBusyError();
      throw error;
    }
    try {
      await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
      return await action();
    } finally {
      await handle.close();
      await fs.unlink(lock);
    }
  }
}
