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
import { readJsonAtomicSync, writeJsonAtomicSync } from '../utils/atomic-write.js';
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
  const current = loadRecord(sessionKey, env, now);
  const nextTurns = [
    ...current.turns,
    ...[
      sanitizeTurn({ role: 'user', content: userText }),
      sanitizeTurn({ role: 'assistant', content: assistantText }),
    ].filter((turn): turn is ConversationTurn => turn !== null),
  ].slice(-CHANNEL_HISTORY_MAX_TURNS);
  const next: CompanionChannelHistoryRecord = {
    schemaVersion: 1,
    personKey: current.personKey,
    updatedAt: new Date(now).toISOString(),
    turns: nextTurns,
  };
  persistRecord(sessionKey, next, env);
  return nextTurns.slice();
}

/** Test-only. */
export function clearCompanionChannelHistoriesForTests(): void {
  memory.clear();
}
