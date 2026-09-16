import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { logger } from '../utils/logger.js';
import { readJsonLinesAtomic } from '../utils/atomic-write.js';

export interface TimelineToolCall {
  name: string;
  ok: boolean;
}

export interface TimelineEntry {
  turn: number;
  ts: string;
  role: 'user' | 'assistant';
  textPreview: string;
  toolCalls: TimelineToolCall[];
  filesTouched: string[];
  checkpointId?: string;
}

export interface SessionTimelineOptions {
  sessionId?: string;
  directory?: string;
}

const MAX_PREVIEW_LENGTH = 400;

function isTimelineEntry(value: unknown): value is TimelineEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return (
    Number.isInteger(entry.turn) &&
    typeof entry.turn === 'number' &&
    entry.turn > 0 &&
    typeof entry.ts === 'string' &&
    (entry.role === 'user' || entry.role === 'assistant') &&
    typeof entry.textPreview === 'string' &&
    Array.isArray(entry.toolCalls) &&
    entry.toolCalls.every((call) => {
      if (!call || typeof call !== 'object') return false;
      const candidate = call as Record<string, unknown>;
      return typeof candidate.name === 'string' && typeof candidate.ok === 'boolean';
    }) &&
    Array.isArray(entry.filesTouched) &&
    entry.filesTouched.every((file) => typeof file === 'string') &&
    (entry.checkpointId === undefined || typeof entry.checkpointId === 'string')
  );
}

/**
 * Append-only, preview-only timeline for one or more persisted sessions.
 *
 * Every public operation is best-effort: timeline storage must never break an
 * agent turn or a replay inspection command.
 */
export class SessionTimeline {
  private readonly sessionId?: string;
  private readonly directory: string;

  constructor(options?: SessionTimelineOptions);
  constructor(sessionId?: string, options?: Omit<SessionTimelineOptions, 'sessionId'>);
  constructor(
    sessionIdOrOptions: string | SessionTimelineOptions = {},
    options: Omit<SessionTimelineOptions, 'sessionId'> = {},
  ) {
    if (typeof sessionIdOrOptions === 'string') {
      this.sessionId = sessionIdOrOptions;
      this.directory = options.directory ?? path.join(os.homedir(), '.codebuddy', 'timelines');
    } else {
      this.sessionId = sessionIdOrOptions.sessionId;
      this.directory = sessionIdOrOptions.directory ?? path.join(os.homedir(), '.codebuddy', 'timelines');
    }
  }

  async record(entry: TimelineEntry): Promise<void> {
    if (!this.sessionId) {
      logger.warn('[session-timeline] cannot record without a session id');
      return;
    }

    try {
      await fs.mkdir(this.directory, { recursive: true });
      const normalized: TimelineEntry = {
        ...entry,
        textPreview: entry.textPreview.slice(0, MAX_PREVIEW_LENGTH),
        toolCalls: entry.toolCalls.map((call) => ({ name: call.name, ok: call.ok })),
        filesTouched: [...new Set(entry.filesTouched)],
      };
      await fs.appendFile(this.filePath(this.sessionId), `${JSON.stringify(normalized)}\n`, {
        encoding: 'utf8',
        flag: 'a',
        mode: 0o600,
      });
    } catch (error) {
      logger.warn('[session-timeline] failed to append timeline entry', {
        sessionId: this.sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async list(sessionId: string): Promise<TimelineEntry[]> {
    const entries = await readJsonLinesAtomic(this.filePath(sessionId), [], isTimelineEntry);
    return entries.sort((left, right) => left.turn - right.turn);
  }

  async get(sessionId: string, turn: number): Promise<TimelineEntry | undefined> {
    const entries = await this.list(sessionId);
    return entries.find((entry) => entry.turn === turn);
  }

  private filePath(sessionId: string): string {
    return path.join(this.directory, `${encodeURIComponent(sessionId)}.jsonl`);
  }
}
