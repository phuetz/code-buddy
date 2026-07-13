import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { DatabaseInstance, MessageRow, TraceStepRow } from '../db/database';
import type { TurnJournalFence } from './turn-journal';

export interface PersistedConversationBranch {
  id: string;
  sessionId: string;
  name: string;
  parentId?: string;
  parentMessageId?: string;
  parentMessageIndex?: number;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  isCurrent: boolean;
}

export interface ConversationBranchForkPoint {
  messageId?: string;
  messageIndex?: number;
}

interface BranchRow {
  id: string;
  session_id: string;
  name: string;
  parent_id: string | null;
  parent_message_id: string | null;
  parent_message_index: number | null;
  snapshot: string;
  trace_snapshot: string;
  is_current: number;
  created_at: number;
  updated_at: number;
}

export interface ConversationBranchMutation {
  branch: PersistedConversationBranch;
  messages: MessageRow[];
}

interface JournalFenceRow {
  byte_offset: number;
  prefix_sha256: string;
}

const MAX_BRANCH_NAME_LENGTH = 80;

export function readConversationBranchJournalFence(
  db: Pick<DatabaseInstance, 'raw'>,
  sessionId: string,
): TurnJournalFence | null {
  if (!db.raw || typeof db.raw.prepare !== 'function') return null;
  try {
    const row = db.raw
      .prepare(
        `SELECT byte_offset, prefix_sha256
           FROM conversation_branch_journal_fences
          WHERE session_id = ?`,
      )
      .get(sessionId) as JournalFenceRow | undefined;
    return row
      ? { byteOffset: row.byte_offset, prefixSha256: row.prefix_sha256 }
      : null;
  } catch (error) {
    if (error instanceof Error && /no such table/u.test(error.message)) return null;
    throw error;
  }
}

function rebaseMessageTimestamps(
  messages: MessageRow[],
  previousTimestamp?: number,
): MessageRow[] {
  let previous = previousTimestamp;
  return messages.map((message) => {
    const timestamp = appendTimestamp(previous, message.timestamp);
    previous = timestamp;
    return { ...message, timestamp };
  });
}

function rebaseTraceTimestamps(
  steps: TraceStepRow[],
  previousTimestamp?: number,
): TraceStepRow[] {
  let previous = previousTimestamp;
  return steps.map((step) => {
    const timestamp = appendTimestamp(previous, step.timestamp);
    previous = timestamp;
    return { ...step, timestamp };
  });
}

function appendTimestamp(previous: number | undefined, original: number): number {
  if (previous === undefined) return original;
  if (previous >= Number.MAX_SAFE_INTEGER) {
    throw new Error('Conversation timestamps cannot be ordered safely; merge was not applied.');
  }
  return Math.max(original, previous + 1);
}

function maxTimestamp(rows: Array<{ timestamp: number }>): number | undefined {
  if (rows.length === 0) return undefined;
  return rows.reduce((maximum, row) => Math.max(maximum, row.timestamp), rows[0]!.timestamp);
}

function parseSnapshot(raw: string, sessionId: string): MessageRow[] {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('Branch history is corrupted; the active conversation was not changed.');
  }
  if (!Array.isArray(value)) {
    throw new Error('Branch history is invalid; the active conversation was not changed.');
  }

  return value.map((entry, index) => {
    if (
      entry === null ||
      typeof entry !== 'object' ||
      Array.isArray(entry) ||
      typeof (entry as MessageRow).id !== 'string' ||
      typeof (entry as MessageRow).role !== 'string' ||
      typeof (entry as MessageRow).content !== 'string' ||
      !Number.isFinite((entry as MessageRow).timestamp)
    ) {
      throw new Error(`Branch history contains an invalid message at position ${index + 1}.`);
    }
    const row = entry as MessageRow;
    return {
      id: row.id,
      session_id: sessionId,
      role: row.role,
      content: row.content,
      timestamp: row.timestamp,
      token_usage: typeof row.token_usage === 'string' ? row.token_usage : null,
      execution_time_ms: Number.isFinite(row.execution_time_ms)
        ? row.execution_time_ms
        : null,
      metadata: typeof row.metadata === 'string' ? row.metadata : null,
    };
  });
}

function parseTraceSnapshot(raw: string, sessionId: string): TraceStepRow[] {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('Branch trace history is corrupted; the active conversation was not changed.');
  }
  if (!Array.isArray(value)) {
    throw new Error('Branch trace history is invalid; the active conversation was not changed.');
  }

  return value.map((entry, index) => {
    if (
      entry === null ||
      typeof entry !== 'object' ||
      Array.isArray(entry) ||
      typeof (entry as TraceStepRow).id !== 'string' ||
      typeof (entry as TraceStepRow).type !== 'string' ||
      typeof (entry as TraceStepRow).status !== 'string' ||
      typeof (entry as TraceStepRow).title !== 'string' ||
      !Number.isFinite((entry as TraceStepRow).timestamp)
    ) {
      throw new Error(`Branch trace history contains an invalid step at position ${index + 1}.`);
    }
    const row = entry as TraceStepRow;
    return {
      id: row.id,
      session_id: sessionId,
      type: row.type,
      status: row.status,
      title: row.title,
      content: typeof row.content === 'string' ? row.content : null,
      tool_name: typeof row.tool_name === 'string' ? row.tool_name : null,
      tool_input: typeof row.tool_input === 'string' ? row.tool_input : null,
      tool_output: typeof row.tool_output === 'string' ? row.tool_output : null,
      is_error: Number.isFinite(row.is_error) ? row.is_error : null,
      timestamp: row.timestamp,
      duration: Number.isFinite(row.duration) ? row.duration : null,
    };
  });
}

function normalizeName(name: string): string {
  const normalized = name.trim().replace(/\s+/g, ' ');
  if (!normalized) throw new Error('Branch name is required.');
  if (normalized.length > MAX_BRANCH_NAME_LENGTH) {
    throw new Error(`Branch name must be at most ${MAX_BRANCH_NAME_LENGTH} characters.`);
  }
  return normalized;
}

/**
 * SQLite-backed branch snapshots for Cowork conversations.
 *
 * `messages` and `trace_steps` remain the canonical active history consumed by
 * SessionManager. Before switching, both sets are snapshotted transactionally;
 * checkout then replaces them with the selected snapshots in one transaction.
 */
export class SqliteSessionBranchStore {
  private readonly database: Database.Database;

  constructor(db: Pick<DatabaseInstance, 'raw'>) {
    this.database = db.raw;
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS conversation_branches (
        session_id TEXT NOT NULL,
        id TEXT NOT NULL,
        name TEXT NOT NULL,
        parent_id TEXT,
        parent_message_id TEXT,
        parent_message_index INTEGER,
        snapshot TEXT NOT NULL DEFAULT '[]',
        trace_snapshot TEXT NOT NULL DEFAULT '[]',
        is_current INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0, 1)),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (session_id, id),
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_branches_current
        ON conversation_branches(session_id) WHERE is_current = 1;
      CREATE INDEX IF NOT EXISTS idx_conversation_branches_updated
        ON conversation_branches(session_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS conversation_branch_journal_fences (
        session_id TEXT PRIMARY KEY,
        byte_offset INTEGER NOT NULL CHECK (byte_offset >= 0),
        prefix_sha256 TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
    `);
    const columns = this.database
      .prepare('PRAGMA table_info(conversation_branches)')
      .all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === 'trace_snapshot')) {
      this.database.exec(
        "ALTER TABLE conversation_branches ADD COLUMN trace_snapshot TEXT NOT NULL DEFAULT '[]'",
      );
    }
  }

  list(sessionId: string): PersistedConversationBranch[] {
    return this.database.transaction(() => {
      this.ensureSessionAndMain(sessionId);
      this.syncCurrentSnapshot(sessionId);
      return this.getBranchRows(sessionId).map((row) => this.toSummary(row));
    })();
  }

  fork(
    sessionId: string,
    name: string,
    point: ConversationBranchForkPoint = {},
    beforeCommit?: () => TurnJournalFence | null,
  ): ConversationBranchMutation {
    return this.database.transaction(() => {
      this.ensureSessionAndMain(sessionId);
      this.syncCurrentSnapshot(sessionId);
      const parent = this.getCurrentRow(sessionId);
      const messages = this.getMessageRows(sessionId);
      const traceSteps = this.getTraceRows(sessionId);
      const hasPoint = point.messageId !== undefined || point.messageIndex !== undefined;
      let forkIndex = messages.length - 1;
      if (point.messageId !== undefined) {
        forkIndex = messages.findIndex((message) => message.id === point.messageId);
        if (forkIndex < 0) {
          throw new Error('The selected persisted message no longer exists in this branch.');
        }
      } else if (point.messageIndex !== undefined) {
        if (
          !Number.isInteger(point.messageIndex) ||
          point.messageIndex < 0 ||
          point.messageIndex >= messages.length
        ) {
          throw new Error('The selected message index is outside the persisted history.');
        }
        forkIndex = point.messageIndex;
      }

      const snapshot = hasPoint ? messages.slice(0, forkIndex + 1) : messages;
      // Trace steps do not currently carry a message foreign key. Timestamp
      // filtering is therefore the strict, fail-safe boundary for an earlier
      // fork: later steps are dropped instead of leaking future branch work.
      const traceSnapshot = hasPoint
        ? traceSteps.filter((step) => step.timestamp <= (messages[forkIndex]?.timestamp ?? -1))
        : traceSteps;
      const now = Date.now();
      const row: BranchRow = {
        id: `branch_${randomUUID()}`,
        session_id: sessionId,
        name: normalizeName(name),
        parent_id: parent.id,
        parent_message_id: hasPoint ? messages[forkIndex]?.id ?? null : messages.at(-1)?.id ?? null,
        parent_message_index: hasPoint ? forkIndex : messages.length > 0 ? messages.length - 1 : null,
        snapshot: JSON.stringify(snapshot),
        trace_snapshot: JSON.stringify(traceSnapshot),
        is_current: 1,
        created_at: now,
        updated_at: now,
      };

      this.database
        .prepare('UPDATE conversation_branches SET is_current = 0 WHERE session_id = ?')
        .run(sessionId);
      this.insertBranch(row);
      this.replaceActiveHistory(sessionId, snapshot, traceSnapshot);
      this.captureJournalFence(sessionId, beforeCommit);
      return { branch: this.toSummary(row), messages: snapshot };
    })();
  }

  checkout(
    sessionId: string,
    branchId: string,
    beforeCommit?: () => TurnJournalFence | null,
  ): ConversationBranchMutation {
    return this.database.transaction(() => {
      this.ensureSessionAndMain(sessionId);
      this.syncCurrentSnapshot(sessionId);
      const target = this.getBranchRow(sessionId, branchId);
      if (!target) throw new Error('Branch not found.');
      const messages = parseSnapshot(target.snapshot, sessionId);
      const traceSteps = parseTraceSnapshot(target.trace_snapshot, sessionId);

      if (!target.is_current) {
        this.database
          .prepare('UPDATE conversation_branches SET is_current = 0 WHERE session_id = ?')
          .run(sessionId);
        this.database
          .prepare(
            'UPDATE conversation_branches SET is_current = 1, updated_at = ? WHERE session_id = ? AND id = ?',
          )
          .run(Date.now(), sessionId, branchId);
        target.is_current = 1;
        target.updated_at = Date.now();
        this.replaceActiveHistory(sessionId, messages, traceSteps);
        this.captureJournalFence(sessionId, beforeCommit);
      }

      return { branch: this.toSummary(target), messages };
    })();
  }

  merge(
    sessionId: string,
    sourceBranchId: string,
    strategy: 'append' | 'replace',
    beforeCommit?: () => TurnJournalFence | null,
  ): ConversationBranchMutation {
    return this.database.transaction(() => {
      this.ensureSessionAndMain(sessionId);
      this.syncCurrentSnapshot(sessionId);
      const target = this.getCurrentRow(sessionId);
      const source = this.getBranchRow(sessionId, sourceBranchId);
      if (!source) throw new Error('Source branch not found.');
      if (source.id === target.id) throw new Error('Cannot merge a branch into itself.');

      const targetMessages = parseSnapshot(target.snapshot, sessionId);
      const sourceMessages = parseSnapshot(source.snapshot, sessionId);
      const targetTraceSteps = parseTraceSnapshot(target.trace_snapshot, sessionId);
      const sourceTraceSteps = parseTraceSnapshot(source.trace_snapshot, sessionId);
      let messages: MessageRow[];
      let traceSteps: TraceStepRow[];
      if (strategy === 'replace') {
        messages = sourceMessages;
        traceSteps = sourceTraceSteps;
      } else {
        let commonPrefix = 0;
        while (
          commonPrefix < targetMessages.length &&
          commonPrefix < sourceMessages.length &&
          targetMessages[commonPrefix]?.id === sourceMessages[commonPrefix]?.id
        ) {
          commonPrefix += 1;
        }
        const existingIds = new Set(targetMessages.map((message) => message.id));
        const uniqueSourceTail = sourceMessages
          .slice(commonPrefix)
          .filter((message) => !existingIds.has(message.id));
        messages = [
          ...targetMessages,
          ...rebaseMessageTimestamps(uniqueSourceTail, maxTimestamp(targetMessages)),
        ];
        const existingTraceIds = new Set(targetTraceSteps.map((step) => step.id));
        const uniqueSourceTraceSteps = sourceTraceSteps.filter(
          (step) => !existingTraceIds.has(step.id),
        );
        traceSteps = [
          ...targetTraceSteps,
          ...rebaseTraceTimestamps(uniqueSourceTraceSteps, maxTimestamp(targetTraceSteps)),
        ];
      }

      const now = Date.now();
      this.database
        .prepare(
          `UPDATE conversation_branches
              SET snapshot = ?, trace_snapshot = ?, updated_at = ?
            WHERE session_id = ? AND id = ?`,
        )
        .run(JSON.stringify(messages), JSON.stringify(traceSteps), now, sessionId, target.id);
      target.snapshot = JSON.stringify(messages);
      target.trace_snapshot = JSON.stringify(traceSteps);
      target.updated_at = now;
      this.replaceActiveHistory(sessionId, messages, traceSteps);
      this.captureJournalFence(sessionId, beforeCommit);
      return { branch: this.toSummary(target), messages };
    })();
  }

  delete(sessionId: string, branchId: string): void {
    this.database.transaction(() => {
      this.ensureSessionAndMain(sessionId);
      const target = this.getBranchRow(sessionId, branchId);
      if (!target) throw new Error('Branch not found.');
      if (target.id === 'main') throw new Error('The main branch cannot be deleted.');
      if (target.is_current === 1) throw new Error('Checkout another branch before deleting this one.');
      this.database
        .prepare('DELETE FROM conversation_branches WHERE session_id = ? AND id = ?')
        .run(sessionId, branchId);
    })();
  }

  rename(sessionId: string, branchId: string, name: string): void {
    const result = this.database
      .prepare(
        'UPDATE conversation_branches SET name = ?, updated_at = ? WHERE session_id = ? AND id = ?',
      )
      .run(normalizeName(name), Date.now(), sessionId, branchId);
    if (result.changes === 0) throw new Error('Branch not found.');
  }

  private ensureSessionAndMain(sessionId: string): void {
    const session = this.database.prepare('SELECT id FROM sessions WHERE id = ?').get(sessionId);
    if (!session) throw new Error('Session not found.');

    const count = this.database
      .prepare('SELECT COUNT(*) AS count FROM conversation_branches WHERE session_id = ?')
      .get(sessionId) as { count: number };
    if (count.count === 0) {
      const now = Date.now();
      this.insertBranch({
        id: 'main',
        session_id: sessionId,
        name: 'main',
        parent_id: null,
        parent_message_id: null,
        parent_message_index: null,
        snapshot: JSON.stringify(this.getMessageRows(sessionId)),
        trace_snapshot: JSON.stringify(this.getTraceRows(sessionId)),
        is_current: 1,
        created_at: now,
        updated_at: now,
      });
      return;
    }

    const current = this.database
      .prepare('SELECT id FROM conversation_branches WHERE session_id = ? AND is_current = 1')
      .get(sessionId);
    if (!current) {
      const fallback = this.database
        .prepare(
          `SELECT id FROM conversation_branches
             WHERE session_id = ?
             ORDER BY CASE WHEN id = 'main' THEN 0 ELSE 1 END, updated_at DESC
             LIMIT 1`,
        )
        .get(sessionId) as { id: string } | undefined;
      if (!fallback) throw new Error('Session branch state is invalid.');
      this.database
        .prepare('UPDATE conversation_branches SET is_current = 1 WHERE session_id = ? AND id = ?')
        .run(sessionId, fallback.id);
    }
  }

  private syncCurrentSnapshot(sessionId: string): void {
    const current = this.getCurrentRow(sessionId);
    const snapshot = JSON.stringify(this.getMessageRows(sessionId));
    const traceSnapshot = JSON.stringify(this.getTraceRows(sessionId));
    if (snapshot === current.snapshot && traceSnapshot === current.trace_snapshot) return;
    this.database
      .prepare(
        `UPDATE conversation_branches
            SET snapshot = ?, trace_snapshot = ?, updated_at = ?
          WHERE session_id = ? AND id = ?`,
      )
      .run(snapshot, traceSnapshot, Date.now(), sessionId, current.id);
  }

  private getMessageRows(sessionId: string): MessageRow[] {
    return this.database
      .prepare(
        `SELECT id, session_id, role, content, timestamp, token_usage,
                execution_time_ms, metadata
           FROM messages WHERE session_id = ? ORDER BY timestamp ASC, rowid ASC`,
      )
      .all(sessionId) as MessageRow[];
  }

  private getTraceRows(sessionId: string): TraceStepRow[] {
    return this.database
      .prepare(
        `SELECT id, session_id, type, status, title, content, tool_name,
                tool_input, tool_output, is_error, timestamp, duration
           FROM trace_steps WHERE session_id = ? ORDER BY timestamp ASC, rowid ASC`,
      )
      .all(sessionId) as TraceStepRow[];
  }

  private replaceActiveHistory(
    sessionId: string,
    messages: MessageRow[],
    traceSteps: TraceStepRow[],
  ): void {
    this.database.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId);
    const insert = this.database.prepare(`
      INSERT INTO messages
        (id, session_id, role, content, timestamp, token_usage, execution_time_ms, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const message of messages) {
      insert.run(
        message.id,
        sessionId,
        message.role,
        message.content,
        message.timestamp,
        message.token_usage,
        message.execution_time_ms,
        message.metadata ?? null,
      );
    }
    this.database.prepare('DELETE FROM trace_steps WHERE session_id = ?').run(sessionId);
    const insertTrace = this.database.prepare(`
      INSERT INTO trace_steps
        (id, session_id, type, status, title, content, tool_name, tool_input,
         tool_output, is_error, timestamp, duration)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const step of traceSteps) {
      insertTrace.run(
        step.id,
        sessionId,
        step.type,
        step.status,
        step.title,
        step.content,
        step.tool_name,
        step.tool_input,
        step.tool_output,
        step.is_error,
        step.timestamp,
        step.duration,
      );
    }
    // Provider-side thread/session IDs carry hidden history and must never be
    // reused after a branch checkout.
    this.database
      .prepare(
        'UPDATE sessions SET claude_session_id = NULL, openai_thread_id = NULL, updated_at = ? WHERE id = ?',
      )
      .run(Date.now(), sessionId);
  }

  private captureJournalFence(
    sessionId: string,
    capture?: () => TurnJournalFence | null,
  ): void {
    if (!capture) return;
    const fence = capture();
    if (!fence) {
      this.database
        .prepare('DELETE FROM conversation_branch_journal_fences WHERE session_id = ?')
        .run(sessionId);
      return;
    }
    if (
      !Number.isSafeInteger(fence.byteOffset) ||
      fence.byteOffset < 0 ||
      !/^[a-f0-9]{64}$/u.test(fence.prefixSha256)
    ) {
      throw new Error('Recovery journal fence is invalid; branch history was not changed.');
    }
    this.database
      .prepare(
        `INSERT INTO conversation_branch_journal_fences
           (session_id, byte_offset, prefix_sha256, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           byte_offset = excluded.byte_offset,
           prefix_sha256 = excluded.prefix_sha256,
           updated_at = excluded.updated_at`,
      )
      .run(sessionId, fence.byteOffset, fence.prefixSha256, Date.now());
  }

  private insertBranch(row: BranchRow): void {
    this.database
      .prepare(`
        INSERT INTO conversation_branches
          (session_id, id, name, parent_id, parent_message_id, parent_message_index,
           snapshot, trace_snapshot, is_current, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        row.session_id,
        row.id,
        row.name,
        row.parent_id,
        row.parent_message_id,
        row.parent_message_index,
        row.snapshot,
        row.trace_snapshot,
        row.is_current,
        row.created_at,
        row.updated_at,
      );
  }

  private getCurrentRow(sessionId: string): BranchRow {
    const row = this.database
      .prepare('SELECT * FROM conversation_branches WHERE session_id = ? AND is_current = 1')
      .get(sessionId) as BranchRow | undefined;
    if (!row) throw new Error('Current branch not found.');
    return row;
  }

  private getBranchRow(sessionId: string, branchId: string): BranchRow | undefined {
    return this.database
      .prepare('SELECT * FROM conversation_branches WHERE session_id = ? AND id = ?')
      .get(sessionId, branchId) as BranchRow | undefined;
  }

  private getBranchRows(sessionId: string): BranchRow[] {
    return this.database
      .prepare(
        'SELECT * FROM conversation_branches WHERE session_id = ? ORDER BY is_current DESC, updated_at DESC',
      )
      .all(sessionId) as BranchRow[];
  }

  private toSummary(row: BranchRow): PersistedConversationBranch {
    const messages = parseSnapshot(row.snapshot, row.session_id);
    return {
      id: row.id,
      sessionId: row.session_id,
      name: row.name,
      ...(row.parent_id ? { parentId: row.parent_id } : {}),
      ...(row.parent_message_id ? { parentMessageId: row.parent_message_id } : {}),
      ...(row.parent_message_index !== null
        ? { parentMessageIndex: row.parent_message_index }
        : {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      messageCount: messages.length,
      isCurrent: row.is_current === 1,
    };
  }
}
