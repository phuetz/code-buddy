/**
 * Background extraction of reusable memories from completed sessions.
 *
 * The worker is deliberately advisory: it coordinates with other workers via
 * a short-lived file lock, but never participates in the interactive turn
 * path. Every public failure is converted to a result and logged.
 */

import { promises as fsPromises } from 'node:fs';
import * as path from 'node:path';
import { extractMemoriesFromRollout, consolidateMemories } from './memory-consolidation.js';
import { getGlobalEventBus } from '../events/event-bus.js';
import { getCodeBuddyHome } from '../utils/codebuddy-home.js';
import { readJsonAtomic, writeJsonAtomic } from '../utils/atomic-write.js';
import { logger } from '../utils/logger.js';

export const LOCK_STALE_MS = 35 * 60 * 1000;
export const MIN_IDLE_MS = 5 * 60 * 1000;
export const MIN_EXTRACTION_INTERVAL_MS = 30 * 60 * 1000;

const LOCK_FILE = '.extraction.lock';
const STATE_FILE = '.extraction-state.json';

export interface ExtractionLock {
  pid: number;
  startedAt: string;
}

export interface ExtractionRun {
  runAt: string;
  sessionIds: string[];
  memoriesAdded: number;
  durationMs: number;
}

export interface ExtractionState {
  runs: ExtractionRun[];
}

export interface BackgroundExtractionResult {
  status: 'completed' | 'locked' | 'throttled' | 'no_candidates' | 'error';
  sessionCount: number;
  memoriesAdded: number;
  durationMs: number;
}

export interface ExtractionLockHandle {
  path: string;
  lock: ExtractionLock;
}

interface CandidateSession {
  id: string;
  workingDirectory?: string;
  messages: Array<{ role: string; content: string }>;
  lastActivityAt: number;
  completed: boolean;
}

interface RawSessionRecord {
  [key: string]: unknown;
}

function errorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = error.code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

function asRecord(value: unknown): RawSessionRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as RawSessionRecord
    : null;
}

function parseTimestamp(value: unknown): number | undefined {
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) ? timestamp : undefined;
  }
  if (typeof value !== 'string' && typeof value !== 'number') {
    return undefined;
  }
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function isCompletedRecord(record: RawSessionRecord): boolean {
  const metadata = asRecord(record.metadata);
  const statuses = [record.status, record.sessionStatus, metadata?.status, metadata?.sessionStatus]
    .filter((value): value is string => typeof value === 'string')
    .map(value => value.toLowerCase());
  if (record.completed === true || record.isCompleted === true) return true;
  if (statuses.some(status => ['completed', 'complete', 'ended', 'closed', 'finished', 'failed', 'cancelled'].includes(status))) {
    return true;
  }
  return ['completedAt', 'endedAt', 'finishedAt'].some(key => parseTimestamp(record[key]) !== undefined);
}

function normalizeMessages(value: unknown): Array<{ role: string; content: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap(message => {
    const record = asRecord(message);
    if (!record || typeof record.content !== 'string') return [];
    const role = typeof record.role === 'string'
      ? record.role
      : typeof record.type === 'string'
        ? record.type
        : null;
    return role ? [{ role, content: record.content }] : [];
  });
}

function normalizeSession(value: unknown, fallbackId?: string, fileMtime?: number): CandidateSession | null {
  const record = asRecord(value);
  const rawMessages = Array.isArray(value) ? value : record?.messages;
  if (!record && !Array.isArray(value)) return null;
  const id = typeof record?.id === 'string' && record.id.trim() ? record.id : fallbackId;
  if (!id) return null;

  const messages = normalizeMessages(rawMessages);
  if (messages.length === 0) return null;
  const recordForMetadata = record ?? {};
  const lastActivityAt = parseTimestamp(recordForMetadata.lastAccessedAt)
    ?? parseTimestamp(recordForMetadata.updatedAt)
    ?? parseTimestamp(recordForMetadata.endedAt)
    ?? fileMtime
    ?? 0;
  const workingDirectory = typeof recordForMetadata.workingDirectory === 'string'
    ? recordForMetadata.workingDirectory
    : typeof recordForMetadata.cwd === 'string'
      ? recordForMetadata.cwd
      : undefined;

  return {
    id,
    ...(workingDirectory ? { workingDirectory } : {}),
    messages,
    lastActivityAt,
    completed: isCompletedRecord(recordForMetadata),
  };
}

function samePath(left: string, right: string): boolean {
  const normalize = (value: string): string => {
    const resolved = path.resolve(value);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
}

function belongsToWorkspace(session: CandidateSession, cwd: string, localDirectory: boolean): boolean {
  if (!session.workingDirectory) return localDirectory;
  return samePath(session.workingDirectory, cwd);
}

function isExtractionState(value: unknown): value is ExtractionState {
  const record = asRecord(value);
  if (!record || !Array.isArray(record.runs)) return false;
  return record.runs.every(run => {
    const item = asRecord(run);
    return Boolean(
      item
      && typeof item.runAt === 'string'
      && Array.isArray(item.sessionIds)
      && item.sessionIds.every(id => typeof id === 'string')
      && typeof item.memoriesAdded === 'number'
      && Number.isFinite(item.memoriesAdded)
      && typeof item.durationMs === 'number'
      && Number.isFinite(item.durationMs),
    );
  });
}

function staleLock(lock: unknown, now: number): boolean {
  const record = asRecord(lock);
  if (!record || typeof record.startedAt !== 'string') return false;
  const startedAt = Date.parse(record.startedAt);
  return Number.isFinite(startedAt) && now - startedAt > LOCK_STALE_MS;
}

async function readLock(lockPath: string): Promise<unknown> {
  try {
    return JSON.parse(await fsPromises.readFile(lockPath, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

export async function tryAcquireExtractionLock(lockPath: string): Promise<ExtractionLockHandle | null> {
  await fsPromises.mkdir(path.dirname(lockPath), { recursive: true });
  const lock: ExtractionLock = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let handle: Awaited<ReturnType<typeof fsPromises.open>> | undefined;
    try {
      handle = await fsPromises.open(lockPath, 'wx', 0o600);
      await handle.writeFile(`${JSON.stringify(lock)}\n`, { encoding: 'utf8' });
      await handle.sync();
      await handle.close();
      return { path: lockPath, lock };
    } catch (error) {
      await handle?.close().catch(() => undefined);
      if (handle) await fsPromises.unlink(lockPath).catch(() => undefined);
      if (errorCode(error) !== 'EEXIST') throw error;

      const existing = await readLock(lockPath);
      if (!staleLock(existing, Date.now())) return null;
      try {
        await fsPromises.unlink(lockPath);
      } catch (unlinkError) {
        if (errorCode(unlinkError) !== 'ENOENT') throw unlinkError;
      }
    }
  }
  return null;
}

export async function releaseExtractionLock(lockHandle: ExtractionLockHandle): Promise<void> {
  try {
    const current = await readLock(lockHandle.path);
    const record = asRecord(current);
    if (record?.pid === lockHandle.lock.pid && record.startedAt === lockHandle.lock.startedAt) {
      await fsPromises.unlink(lockHandle.path);
    }
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') {
      safeWarn('Background memory extraction could not release its lock', error);
    }
  }
}

async function readSessionDirectory(
  directory: string,
  cwd: string,
  localDirectory: boolean,
): Promise<CandidateSession[]> {
  let fileNames: string[];
  try {
    fileNames = await fsPromises.readdir(directory);
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') {
      logger.warn('Background memory extraction could not read the session directory', {
        directory,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return [];
  }

  const sessions: CandidateSession[] = [];
  for (const fileName of fileNames) {
    if (!fileName.endsWith('.json') && !fileName.endsWith('.jsonl')) continue;
    const filePath = path.join(directory, fileName);
    try {
      const [contents, fileStat] = await Promise.all([
        fsPromises.readFile(filePath, 'utf8'),
        fsPromises.stat(filePath),
      ]);
      const parsed = fileName.endsWith('.jsonl')
        ? contents.split(/\r?\n/).filter(line => line.trim()).flatMap(line => {
          try {
            return [JSON.parse(line) as unknown];
          } catch {
            return [];
          }
        })
        : JSON.parse(contents) as unknown;
      const session = normalizeSession(parsed, fileName.replace(/\.jsonl?$/, ''), fileStat.mtimeMs);
      if (session && belongsToWorkspace(session, cwd, localDirectory)) sessions.push(session);
    } catch (error) {
      logger.warn('Background memory extraction skipped a corrupt session file', {
        filePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return sessions;
}

async function loadSessions(cwd: string): Promise<CandidateSession[]> {
  const sessions = new Map<string, CandidateSession>();
  const configuredDirectory = process.env.CODEBUDDY_SESSIONS_DIR;
  const directories = [
    ...(configuredDirectory ? [{ directory: path.resolve(configuredDirectory), local: false }] : []),
    { directory: path.join(cwd, '.codebuddy', 'sessions'), local: true },
    { directory: path.join(getCodeBuddyHome(), 'sessions'), local: false },
  ];
  const seenDirectories = new Set<string>();
  for (const entry of directories) {
    const resolvedDirectory = path.resolve(entry.directory);
    if (seenDirectories.has(resolvedDirectory)) continue;
    seenDirectories.add(resolvedDirectory);
    for (const session of await readSessionDirectory(resolvedDirectory, cwd, entry.local)) {
      if (!sessions.has(session.id)) sessions.set(session.id, session);
    }
  }
  return [...sessions.values()];
}

function candidateSessions(sessions: CandidateSession[], processed: Set<string>, now: number): CandidateSession[] {
  return sessions.filter(session => {
    if (processed.has(session.id) || session.messages.length < 4) return false;
    return session.completed || now - session.lastActivityAt >= MIN_IDLE_MS;
  });
}

function latestRun(state: ExtractionState): ExtractionRun | undefined {
  return state.runs[state.runs.length - 1];
}

function safeWarn(message: string, error: unknown): void {
  try {
    logger.warn(message, { error: error instanceof Error ? error.message : String(error) });
  } catch {
    // Logging must not turn the never-rejecting public API into a rejection.
  }
}

/**
 * Trigger one background extraction pass. The returned promise always
 * resolves, including when persistence, extraction, or consolidation fails.
 */
export async function triggerBackgroundExtraction(
  options: { force?: boolean; cwd?: string } = {},
): Promise<BackgroundExtractionResult> {
  const startedAt = Date.now();
  let sessionCount = 0;
  let memoriesAdded = 0;
  let extractionStarted = false;
  let lockHandle: ExtractionLockHandle | undefined;

  try {
    const cwd = path.resolve(options.cwd ?? process.cwd());
    const codeBuddyDirectory = path.join(cwd, '.codebuddy');
    const lockPath = path.join(codeBuddyDirectory, LOCK_FILE);
    const statePath = path.join(codeBuddyDirectory, STATE_FILE);
    const acquiredLock = await tryAcquireExtractionLock(lockPath);
    if (!acquiredLock) {
      return { status: 'locked', sessionCount: 0, memoriesAdded: 0, durationMs: Date.now() - startedAt };
    }
    lockHandle = acquiredLock;

    const state = await readJsonAtomic<ExtractionState>(statePath, { runs: [] }, {
      mode: 0o600,
      isValid: isExtractionState,
    });
    const now = Date.now();
    const previousRun = latestRun(state);
    if (!options.force && previousRun) {
      const lastRunAt = Date.parse(previousRun.runAt);
      if (Number.isFinite(lastRunAt) && now - lastRunAt < MIN_EXTRACTION_INTERVAL_MS) {
        return { status: 'throttled', sessionCount: 0, memoriesAdded: 0, durationMs: Date.now() - startedAt };
      }
    }

    const processed = new Set(state.runs.flatMap(run => run.sessionIds));
    const candidates = candidateSessions(await loadSessions(cwd), processed, now);
    sessionCount = candidates.length;
    if (candidates.length === 0) {
      return { status: 'no_candidates', sessionCount: 0, memoriesAdded: 0, durationMs: Date.now() - startedAt };
    }

    getGlobalEventBus().emit('memory:extraction_started', {
      sessionCount,
      memoriesAdded: 0,
      durationMs: 0,
    });
    extractionStarted = true;

    const extracted = candidates.flatMap(session => {
      try {
        return extractMemoriesFromRollout(session.messages, session.id);
      } catch (error) {
        safeWarn(`Background memory extraction failed for session ${session.id}`, error);
        return [];
      }
    });
    memoriesAdded = consolidateMemories(extracted, cwd).memoriesAdded;
    const durationMs = Date.now() - startedAt;
    state.runs.push({
      runAt: new Date().toISOString(),
      sessionIds: candidates.map(session => session.id),
      memoriesAdded,
      durationMs,
    });
    await writeJsonAtomic(statePath, state, { mode: 0o600 });
    return { status: 'completed', sessionCount, memoriesAdded, durationMs };
  } catch (error) {
    safeWarn('Background memory extraction failed', error);
    return {
      status: 'error',
      sessionCount,
      memoriesAdded,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    if (extractionStarted) {
      try {
        getGlobalEventBus().emit('memory:extraction_completed', {
          sessionCount,
          memoriesAdded,
          durationMs: Date.now() - startedAt,
        });
      } catch (error) {
        safeWarn('Background memory extraction could not emit its completion event', error);
      }
    }
    if (lockHandle) await releaseExtractionLock(lockHandle);
  }
}
