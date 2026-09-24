/**
 * Shared, durable companion conversation history across messaging channels.
 *
 * Telegram / Discord / WhatsApp / webchat used an in-memory Map keyed by the
 * raw channel session. A daemon restart wiped Lisa's last turns, and a switch
 * of channel looked like amnesia.
 *
 * This store:
 *   - keys by person, not by channel (channel prefixes are stripped);
 *   - persists under ~/.codebuddy/companion/channel-history/;
 *   - keeps the last 20 turns, 7 days of idle life;
 *   - never writes image bytes.
 *
 * Opt-out: CODEBUDDY_CHANNEL_HISTORY=false.
 *
 * @module companion/channel-history
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SessionLock } from '../persistence/session-lock.js';
import { readJsonAtomicSync, readJsonAtomicSyncReadOnly, writeJsonAtomicSync } from '../utils/atomic-write.js';
import { logger } from '../utils/logger.js';
import type { ConversationTurn } from '../conversation/types.js';

export const CHANNEL_HISTORY_MAX_TURNS = 20;
export const CHANNEL_HISTORY_TURN_CHAR_CAP = 2000;
export const CHANNEL_HISTORY_IDLE_MS = 7 * 24 * 60 * 60 * 1000;

const CHANNEL_PREFIX =
  /^(telegram|discord|slack|whatsapp|signal|matrix|teams|webchat|web|gmail|cli|imessage|line|ntfy|feishu|wecom|weixin|qq|dingtalk|mattermost):/i;

export interface CompanionChannelHistoryRecord {
  schemaVersion: 1;
  personKey: string;
  updatedAt: string;
  turns: ConversationTurn[];
}

export function isChannelHistoryPersistenceEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = (env.CODEBUDDY_CHANNEL_HISTORY ?? '').trim().toLowerCase();
  return raw !== 'false' && raw !== '0' && raw !== 'off';
}

export function resolveChannelHistoryDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.CODEBUDDY_CHANNEL_HISTORY_DIR?.trim();
  if (configured) return configured;
  return path.join(os.homedir(), '.codebuddy', 'companion', 'channel-history');
}

/**
 * Collapse a channel session key to the person behind it.
 * `telegram:12345` and `discord:12345` share a history only when the trailing
 * id is the same; otherwise each distinct id stays isolated.
 */
export function personKeyFromSession(sessionKey: string): string {
  const raw = (sessionKey || '').trim() || 'default-global';
  const stripped = raw.replace(CHANNEL_PREFIX, '').trim() || raw;
  return stripped.toLowerCase();
}

/** Best available person key when the handler session id is not passed through. */
export function companionHistorySessionKey(input: {
  sessionKey?: string;
  userId?: string;
  chatId?: string;
  env?: NodeJS.ProcessEnv;
}): string {
  const env = input.env ?? process.env;
  return (
    input.sessionKey?.trim() ||
    input.userId?.trim() ||
    input.chatId?.trim() ||
    env.CODEBUDDY_CHANNEL_HISTORY_KEY?.trim() ||
    env.CODEBUDDY_USER_NAME?.trim() ||
    'default-global'
  );
}

export function resolveChannelHistoryFile(
  sessionKey: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const digest = createHash('sha256').update(personKeyFromSession(sessionKey)).digest('hex').slice(0, 32);
  return path.join(resolveChannelHistoryDir(env), `${digest}.json`);
}

function capTurn(content: string): string {
  const trimmed = content.replace(/\s+/g, ' ').trim();
  if (trimmed.length <= CHANNEL_HISTORY_TURN_CHAR_CAP) return trimmed;
  return `${trimmed.slice(0, CHANNEL_HISTORY_TURN_CHAR_CAP - 1).trimEnd()}…`;
}

function sanitizeTurn(turn: ConversationTurn | undefined): ConversationTurn | null {
  if (!turn) return null;
  if (turn.role !== 'user' && turn.role !== 'assistant') return null;
  if (typeof turn.content !== 'string') return null;
  const content = capTurn(turn.content);
  if (!content) return null;
  return { role: turn.role, content };
}

const memory = new Map<string, CompanionChannelHistoryRecord>();

function isRecord(value: unknown): value is CompanionChannelHistoryRecord {
  return Boolean(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      (value as { schemaVersion?: unknown }).schemaVersion === 1 &&
      typeof (value as { personKey?: unknown }).personKey === 'string' &&
      typeof (value as { updatedAt?: unknown }).updatedAt === 'string' &&
      Array.isArray((value as { turns?: unknown }).turns),
  );
}

function isFresh(updatedAt: string, now: number): boolean {
  const at = Date.parse(updatedAt);
  if (!Number.isFinite(at)) return false;
  return now - at <= CHANNEL_HISTORY_IDLE_MS;
}

function loadRecord(sessionKey: string, env: NodeJS.ProcessEnv, now: number): CompanionChannelHistoryRecord {
  const key = personKeyFromSession(sessionKey);
  const cached = memory.get(key);
  if (cached && isFresh(cached.updatedAt, now)) return cached;

  if (!isChannelHistoryPersistenceEnabled(env)) {
    const empty: CompanionChannelHistoryRecord = {
      schemaVersion: 1,
      personKey: key,
      updatedAt: new Date(now).toISOString(),
      turns: cached?.turns ?? [],
    };
    memory.set(key, empty);
    return empty;
  }

  const file = resolveChannelHistoryFile(sessionKey, env);
  const stored = readJsonAtomicSync<CompanionChannelHistoryRecord | null>(file, null, {
    mode: 0o600,
    isValid: (value): value is CompanionChannelHistoryRecord => isRecord(value),
  });
  if (!stored || !isFresh(stored.updatedAt, now)) {
    const empty: CompanionChannelHistoryRecord = {
      schemaVersion: 1,
      personKey: key,
      updatedAt: new Date(now).toISOString(),
      turns: [],
    };
    memory.set(key, empty);
    return empty;
  }
  const record: CompanionChannelHistoryRecord = {
    schemaVersion: 1,
    personKey: key,
    updatedAt: stored.updatedAt,
    turns: stored.turns.map(sanitizeTurn).filter((turn): turn is ConversationTurn => turn !== null).slice(-CHANNEL_HISTORY_MAX_TURNS),
  };
  memory.set(key, record);
  return record;
}

/** How long a writer waits for another process to release a history file. */
const HISTORY_LOCK_WAIT_MS = 5_000;
const historyLocksHeld = new Set<string>();

/**
 * Run `fn` with the history file's lock held: the `.lock` file next to it,
 * shared by every process. Each write of a turn and each purge reads,
 * decides and renames inside one such section, so no other writer can land
 * between the last read and the rename. The sections are synchronous: in one
 * process nothing else runs until they end. A section that re-enters the
 * same file is refused, never nested: its release would unlock the outer one.
 */
function withHistoryFileLock<T>(file: string, fn: () => T): T {
  const key = path.resolve(file);
  if (historyLocksHeld.has(key)) {
    throw new Error('companion history is already locked by this process');
  }
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const lock = new SessionLock(file);
  const deadline = Date.now() + HISTORY_LOCK_WAIT_MS;
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  while (!lock.acquire()) {
    if (Date.now() >= deadline) {
      throw new Error(`companion history is locked by PID ${lock.getLockHolder()?.pid ?? 'unknown'}`);
    }
    Atomics.wait(sleeper, 0, 0, 10);
  }
  historyLocksHeld.add(key);
  try {
    return fn();
  } finally {
    historyLocksHeld.delete(key);
    lock.release();
  }
}

/**
 * The record a turn is added to, read inside the file lock. The file wins
 * over this process's cache unless the cache is newer: another process may
 * have written or purged the file since this cache was filled.
 */
function loadRecordForWrite(sessionKey: string, env: NodeJS.ProcessEnv, now: number): CompanionChannelHistoryRecord {
  const key = personKeyFromSession(sessionKey);
  const cached = memory.get(key);
  const cachedFresh = cached && isFresh(cached.updatedAt, now) ? cached : null;
  const stored = readJsonAtomicSync<CompanionChannelHistoryRecord | null>(resolveChannelHistoryFile(sessionKey, env), null, {
    mode: 0o600,
    isValid: (value): value is CompanionChannelHistoryRecord => isRecord(value),
  });
  const storedFresh = stored && isFresh(stored.updatedAt, now) ? stored : null;
  if (storedFresh && (!cachedFresh || Date.parse(storedFresh.updatedAt) >= Date.parse(cachedFresh.updatedAt))) {
    const record: CompanionChannelHistoryRecord = {
      schemaVersion: 1,
      personKey: key,
      updatedAt: storedFresh.updatedAt,
      turns: storedFresh.turns.map(sanitizeTurn).filter((turn): turn is ConversationTurn => turn !== null).slice(-CHANNEL_HISTORY_MAX_TURNS),
    };
    memory.set(key, record);
    return record;
  }
  if (cachedFresh) return cachedFresh;
  return { schemaVersion: 1, personKey: key, updatedAt: new Date(now).toISOString(), turns: [] };
}

function persistRecord(sessionKey: string, record: CompanionChannelHistoryRecord, env: NodeJS.ProcessEnv): void {
  memory.set(record.personKey, record);
  if (!isChannelHistoryPersistenceEnabled(env)) return;
  const file = resolveChannelHistoryFile(sessionKey, env);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    writeJsonAtomicSync(file, record, { mode: 0o600 });
  } catch (err) {
    logger.warn('[channel-history] could not persist companion channel history', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function readCompanionChannelHistory(
  sessionKey: string,
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): ConversationTurn[] {
  return loadRecord(sessionKey, env, now).turns.slice();
}

export function rememberCompanionChannelTurn(
  sessionKey: string,
  userText: string,
  assistantText: string,
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): ConversationTurn[] {
  const added = [
    sanitizeTurn({ role: 'user', content: userText }),
    sanitizeTurn({ role: 'assistant', content: assistantText }),
  ].filter((turn): turn is ConversationTurn => turn !== null);
  const append = (current: CompanionChannelHistoryRecord): CompanionChannelHistoryRecord => ({
    schemaVersion: 1,
    personKey: current.personKey,
    updatedAt: new Date(now).toISOString(),
    turns: [...current.turns, ...added].slice(-CHANNEL_HISTORY_MAX_TURNS),
  });
  if (!isChannelHistoryPersistenceEnabled(env)) {
    const next = append(loadRecord(sessionKey, env, now));
    persistRecord(sessionKey, next, env);
    return next.turns.slice();
  }
  const file = resolveChannelHistoryFile(sessionKey, env);
  try {
    // Read, append and rename in one section under the file lock.
    const next = withHistoryFileLock(file, () => {
      const record = append(loadRecordForWrite(sessionKey, env, now));
      persistRecord(sessionKey, record, env);
      return record;
    });
    return next.turns.slice();
  } catch (err) {
    // Same outcome as a failed disk write: the turn stays in this process only.
    logger.warn('[channel-history] could not persist companion channel history', {
      error: err instanceof Error ? err.message : String(err),
    });
    const next = append(loadRecord(sessionKey, env, now));
    memory.set(next.personKey, next);
    return next.turns.slice();
  }
}

function turnsOf(record: CompanionChannelHistoryRecord): ConversationTurn[] {
  return record.turns
    .map((turn) => sanitizeTurn(turn))
    .filter((turn): turn is ConversationTurn => turn !== null);
}

export type CompanionHistoryRead =
  | { state: 'absent' }
  | { state: 'unreadable'; error: string }
  | { state: 'ok'; updatedAtMs: number; transcript: string };

/**
 * Read stored companion turns without the idle expiry used by the prompt.
 * ENOENT (and a valid file with no turns) is `absent`. A permission error
 * or a file that is present but not valid JSON is `unreadable`, even when
 * the memory cache is empty — that must not look like a missing history.
 * The read does not recover or rewrite anything.
 */
export function readCompanionHistoryForReset(
  sessionKey: string,
  env: NodeJS.ProcessEnv = process.env,
): CompanionHistoryRead {
  const key = personKeyFromSession(sessionKey);
  const candidates: CompanionChannelHistoryRecord[] = [];
  const cached = memory.get(key);
  if (cached && isRecord(cached)) candidates.push(cached);
  if (isChannelHistoryPersistenceEnabled(env)) {
    const outcome = readJsonAtomicSyncReadOnly<CompanionChannelHistoryRecord>(
      resolveChannelHistoryFile(sessionKey, env),
      isRecord,
    );
    if (outcome.status === 'unreadable' || outcome.status === 'corrupt') {
      return { state: 'unreadable', error: outcome.status };
    }
    if (outcome.status === 'ok') candidates.push(outcome.value);
  }
  const withTurns = candidates
    .map((record) => ({ record, turns: turnsOf(record) }))
    .filter((entry) => entry.turns.length > 0)
    .sort((a, b) => Date.parse(b.record.updatedAt) - Date.parse(a.record.updatedAt));
  const best = withTurns[0];
  if (!best) return { state: 'absent' };
  const updatedAtMs = Date.parse(best.record.updatedAt);
  if (!Number.isFinite(updatedAtMs)) {
    return { state: 'unreadable', error: 'invalid timestamp' };
  }
  return {
    state: 'ok',
    updatedAtMs,
    transcript: best.turns.map((turn) => `${turn.role}: ${turn.content}`).join('\n'),
  };
}

/**
 * Read stored companion turns without the idle expiry used by the prompt.
 * Empty cache entries are ignored so a freshness wipe cannot hide the file.
 * An unreadable file throws; only a proved absence returns null.
 */
export function inspectCompanionChannelHistory(
  sessionKey: string,
  env: NodeJS.ProcessEnv = process.env,
): { updatedAtMs: number; transcript: string } | null {
  const read = readCompanionHistoryForReset(sessionKey, env);
  if (read.state === 'unreadable') {
    throw new Error(`companion history unreadable: ${read.error}`);
  }
  if (read.state === 'absent') return null;
  return { updatedAtMs: read.updatedAtMs, transcript: read.transcript };
}

export type CompanionHistoryClearResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Replace the stored companion transcript with an empty record, whatever it
 * holds. A disk failure leaves both the file and the memory cache unchanged.
 */
export function clearCompanionChannelHistory(
  sessionKey: string,
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): CompanionHistoryClearResult {
  return clearCompanionHistory(sessionKey, env, now, null);
}

/**
 * Empty the companion history only if it still reads as `expected`, the
 * transcript a caller archived. Read, comparison and rename run in one
 * section under the file lock that every turn write takes, so a turn written
 * by another process lands either before the read (the comparison refuses)
 * or after the rename (on top of the empty record). `beforeWrite` runs
 * inside that section, after the comparison; a throw leaves the file as is.
 */
export function clearCompanionChannelHistoryIfUnchanged(
  sessionKey: string,
  expected: string,
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
  hooks: { beforeWrite?: () => void } = {},
): CompanionHistoryClearResult {
  return clearCompanionHistory(sessionKey, env, now, { expected: expected.trim(), ...hooks });
}

function clearCompanionHistory(
  sessionKey: string,
  env: NodeJS.ProcessEnv,
  now: number,
  guard: { expected: string; beforeWrite?: () => void } | null,
): CompanionHistoryClearResult {
  const personKey = personKeyFromSession(sessionKey);
  const empty = (at: number): CompanionChannelHistoryRecord => ({
    schemaVersion: 1,
    personKey,
    updatedAt: new Date(at).toISOString(),
    turns: [],
  });
  const compare = (): CompanionHistoryClearResult | number => {
    const read = readCompanionHistoryForReset(sessionKey, env);
    if (read.state === 'unreadable') {
      logger.warn('[channel-history] refused to replace an unreadable companion history', { error: read.error });
      return { ok: false, error: `companion history ${read.error}` };
    }
    if (guard && (read.state === 'ok' ? read.transcript.trim() : '') !== guard.expected) {
      return { ok: false, error: 'companion history changed before erase' };
    }
    guard?.beforeWrite?.();
    // Newer than the record it replaces, so no cache filled before it wins.
    return read.state === 'ok' ? Math.max(now, read.updatedAtMs + 1) : now;
  };
  if (!isChannelHistoryPersistenceEnabled(env)) {
    const at = compare();
    if (typeof at !== 'number') return at;
    memory.set(personKey, empty(at));
    return { ok: true };
  }
  const file = resolveChannelHistoryFile(sessionKey, env);
  try {
    return withHistoryFileLock(file, () => {
      const at = compare();
      if (typeof at !== 'number') return at;
      const next = empty(at);
      writeJsonAtomicSync(file, next, { mode: 0o600 });
      memory.set(personKey, next);
      return { ok: true };
    });
  } catch (err) {
    logger.warn('[channel-history] could not persist companion channel history', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Test-only. */
export function clearCompanionChannelHistoriesForTests(): void {
  memory.clear();
}
