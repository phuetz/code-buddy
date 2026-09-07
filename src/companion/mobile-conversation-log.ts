/**
 * Append-only PWA conversation journal (not the 20-turn LLM window).
 * Path: ~/.codebuddy/companion/mobile-conversations/<sha256>.jsonl (0600).
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { logger } from '../utils/logger.js';

export const CONVERSATION_LOG_MAX_BYTES = 5 * 1024 * 1024;
export const CONVERSATION_LOG_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

export interface ConversationLogEntry {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  ts: number;
}

export function resolveConversationLogDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.CODEBUDDY_MOBILE_CONVERSATIONS_DIR?.trim();
  if (configured) return configured;
  return path.join(os.homedir(), '.codebuddy', 'companion', 'mobile-conversations');
}

export function resolveConversationLogFile(
  userId: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const id = (userId ?? '').trim();
  if (!id) return null;
  const digest = createHash('sha256').update(id).digest('hex').slice(0, 32);
  return path.join(resolveConversationLogDir(env), `${digest}.jsonl`);
}

function isConversationLogName(name: string): boolean {
  return name.endsWith('.jsonl') || name.endsWith('.jsonl.1');
}

function purgeStaleConversationLogs(dir: string, now = Date.now()): void {
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (!isConversationLogName(name)) continue;
    const full = path.join(dir, name);
    try {
      const st = fs.statSync(full);
      if (now - st.mtimeMs > CONVERSATION_LOG_MAX_AGE_MS) {
        fs.unlinkSync(full);
      }
    } catch {
      /* skip unreadable */
    }
  }
}

function rotateConversationLogIfNeeded(file: string): void {
  try {
    const st = fs.statSync(file);
    if (st.size <= CONVERSATION_LOG_MAX_BYTES) return;
  } catch {
    return;
  }
  const rotated = `${file}.1`;
  try {
    fs.unlinkSync(rotated);
  } catch {
    /* no previous generation */
  }
  fs.renameSync(file, rotated);
  try {
    fs.chmodSync(rotated, 0o600);
  } catch {
    /* best-effort */
  }
}

function openConversationLog(file: string): void {
  const dir = path.dirname(file);
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  } catch {
    /* append/read will surface the error */
  }
  purgeStaleConversationLogs(dir);
  rotateConversationLogIfNeeded(file);
}

function parseConversationLogFile(file: string): ConversationLogEntry[] {
  if (!fs.existsSync(file)) return [];
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const rows: ConversationLogEntry[] = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as ConversationLogEntry;
        if (parsed && (parsed.role === 'user' || parsed.role === 'assistant') && parsed.id) {
          rows.push({
            id: String(parsed.id),
            role: parsed.role,
            text: String(parsed.text || ''),
            ts: typeof parsed.ts === 'number' ? parsed.ts : 0,
          });
        }
      } catch {
        /* skip bad line */
      }
    }
    return rows;
  } catch {
    return [];
  }
}

export function appendConversationLog(
  userId: string | undefined,
  entries: readonly ConversationLogEntry[],
  env: NodeJS.ProcessEnv = process.env,
): void {
  const file = resolveConversationLogFile(userId, env);
  if (!file || entries.length === 0) return;
  try {
    openConversationLog(file);
    const lines = entries
      .map((entry) => JSON.stringify({
        id: String(entry.id).slice(0, 80),
        role: entry.role,
        text: String(entry.text || '').slice(0, 4000),
        ts: entry.ts,
      }))
      .join('\n') + '\n';
    fs.writeFileSync(file, lines, { flag: 'a', mode: 0o600 });
  } catch (err) {
    logger.warn('[mobile-conversation] append failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function readConversationLog(
  userId: string | undefined,
  opts: { before?: string; limit?: number } = {},
  env: NodeJS.ProcessEnv = process.env,
): ConversationLogEntry[] {
  const file = resolveConversationLogFile(userId, env);
  if (!file) return [];
  try {
    openConversationLog(file);
  } catch {
    return [];
  }
  const limit = Math.min(50, Math.max(1, opts.limit ?? 50));
  const rows = [...parseConversationLogFile(`${file}.1`), ...parseConversationLogFile(file)];
  let slice = rows;
  if (opts.before) {
    const idx = rows.findIndex((row) => row.id === opts.before);
    slice = idx > 0 ? rows.slice(0, idx) : [];
  }
  return slice.slice(-limit);
}
