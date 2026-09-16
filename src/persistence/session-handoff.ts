/**
 * GUI → terminal session handoff (comparatif plan P6).
 *
 * Converts a text conversation (e.g. a Cowork session) into the CLI session
 * store format so `buddy --resume <id>` continues it in the terminal.
 *
 * Contract:
 * - only user/assistant TEXT turns are exported (no tool payloads, attachments
 *   or system/context blocks);
 * - every turn goes through the data-redaction engine; secrets become
 *   placeholders and are counted, never copied;
 * - the file is written atomically with mode 0600 in the CLI sessions dir
 *   (CODEBUDDY_SESSIONS_DIR or ~/.codebuddy/sessions); the id is deterministic
 *   (`cowork-<source id>`) so a later export refreshes the same terminal session;
 * - the returned command carries no credential.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getDataRedactionEngine } from '../security/data-redaction.js';
import { writeJsonAtomic } from '../utils/atomic-write.js';

export interface HandoffTurn {
  role: string;
  text: string;
  timestamp?: number | string;
}

export interface HandoffInput {
  source: 'cowork';
  sourceId: string;
  name: string;
  workingDirectory?: string;
  model?: string;
  createdAt?: number | string;
  turns: HandoffTurn[];
}

export interface HandoffResult {
  id: string;
  path: string;
  command: string;
  messageCount: number;
  redactions: number;
}

const MAX_TURN_CHARS = 200_000;

function isoTime(value: number | string | undefined, fallback: Date): string {
  const parsed = typeof value === 'number' ? new Date(value) : typeof value === 'string' ? new Date(value) : undefined;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : fallback.toISOString();
}

export function handoffSessionId(source: HandoffInput['source'], sourceId: string): string {
  const safe = sourceId.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  if (!safe) throw new Error('HANDOFF_INVALID_SOURCE_ID');
  return `${source}-${safe}`;
}

export function buildHandoffSession(input: HandoffInput, now = new Date()) {
  const engine = getDataRedactionEngine();
  let redactions = 0;
  const redact = (text: string): string => {
    const result = engine.redact(text);
    redactions += result.redactions.length;
    return result.redacted;
  };
  const messages = input.turns
    .filter((turn) => (turn.role === 'user' || turn.role === 'assistant') && typeof turn.text === 'string' && turn.text.trim())
    .map((turn) => ({
      type: turn.role as 'user' | 'assistant',
      content: redact(turn.text.slice(0, MAX_TURN_CHARS)),
      timestamp: isoTime(turn.timestamp, now),
    }));
  const createdAt = isoTime(input.createdAt, now);
  const session = {
    id: handoffSessionId(input.source, input.sourceId),
    name: redact(input.name || input.sourceId).slice(0, 200),
    workingDirectory: input.workingDirectory && path.isAbsolute(input.workingDirectory) ? input.workingDirectory : process.cwd(),
    model: input.model || 'unknown',
    messages,
    createdAt,
    lastAccessedAt: now.toISOString(),
    metadata: { handoffSource: input.source, handoffSourceId: input.sourceId, handoffAt: now.toISOString() },
  };
  return { session, redactions };
}

export function cliSessionsDir(): string {
  return path.resolve(process.env.CODEBUDDY_SESSIONS_DIR || path.join(os.homedir(), '.codebuddy', 'sessions'));
}

export async function writeHandoffSession(input: HandoffInput, options: { dir?: string; now?: Date } = {}): Promise<HandoffResult> {
  const { session, redactions } = buildHandoffSession(input, options.now);
  if (session.messages.length === 0) throw new Error('HANDOFF_EMPTY_CONVERSATION');
  const dir = options.dir ?? cliSessionsDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const filePath = path.join(dir, `${session.id}.json`);
  await writeJsonAtomic(filePath, session, { mode: 0o600 });
  return {
    id: session.id,
    path: filePath,
    command: `buddy --resume ${session.id}`,
    messageCount: session.messages.length,
    redactions,
  };
}
