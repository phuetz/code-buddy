/**
 * Session Repository
 *
 * Repository for session and message storage.
 */

import type Database from 'better-sqlite3';
import type { Session, Message } from '../schema.js';
import { getDatabaseManager } from '../database-manager.js';

// ============================================================================
// Types
// ============================================================================

export interface SessionFilter {
  projectId?: string;
  isArchived?: boolean;
  model?: string;
  limit?: number;
  offset?: number;
  orderBy?: 'updated_at' | 'created_at' | 'total_cost';
  order?: 'ASC' | 'DESC';
}

export interface SessionWithMessages extends Session {
  messages: Message[];
}

// ============================================================================
// Session Repository
// ============================================================================

export class SessionRepository {
  private db: Database.Database;

  constructor(db?: Database.Database) {
    this.db = db || getDatabaseManager().getDatabase();
  }

  // ============================================================================
  // Session Methods
  // ============================================================================

  /**
   * Create a new session
   */
  createSession(session: Omit<Session, 'created_at' | 'updated_at' | 'total_tokens_in' | 'total_tokens_out' | 'total_cost' | 'message_count' | 'tool_calls_count' | 'is_archived'>): Session {
    const stmt = this.db.prepare(`
      INSERT INTO sessions (id, project_id, project_path, name, model, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
      RETURNING *
    `);

    const result = stmt.get(
      session.id,
      session.project_id || null,
      session.project_path || null,
      session.name || null,
      session.model || null,
      session.metadata ? JSON.stringify(session.metadata) : null
    ) as Session & { metadata: string | null };

    return this.deserializeSession(result);
  }

  /**
   * Get session by ID
   */
  getSessionById(id: string): Session | null {
    const stmt = this.db.prepare('SELECT * FROM sessions WHERE id = ?');
    const result = stmt.get(id) as (Session & { metadata: string | null }) | undefined;

    if (!result) return null;
    return this.deserializeSession(result);
  }

  /**
   * Get session with all messages
   */
  getSessionWithMessages(id: string): SessionWithMessages | null {
    const session = this.getSessionById(id);
    if (!session) return null;

    const messages = this.getMessages(id);
    return { ...session, messages };
  }

  /**
   * Find sessions by filter
   */
  findSessions(filter: SessionFilter = {}): Session[] {
    let sql = 'SELECT * FROM sessions WHERE 1=1';
    const params: unknown[] = [];

    if (filter.projectId) {
      sql += ' AND project_id = ?';
      params.push(filter.projectId);
    }

    if (filter.isArchived !== undefined) {
      sql += ' AND is_archived = ?';
      params.push(filter.isArchived ? 1 : 0);
    }

    if (filter.model) {
      sql += ' AND model = ?';
      params.push(filter.model);
    }

    const orderBy = filter.orderBy || 'updated_at';
    const order = filter.order || 'DESC';
    sql += ` ORDER BY ${orderBy} ${order}`;

    if (filter.limit) {
      sql += ' LIMIT ?';
      params.push(filter.limit);
    }

    if (filter.offset) {
      sql += ' OFFSET ?';
      params.push(filter.offset);
    }

    const stmt = this.db.prepare(sql);
    const results = stmt.all(...params) as (Session & { metadata: string | null })[];

    return results.map(r => this.deserializeSession(r));
  }

  /**
   * Update session statistics
   */
  updateSessionStats(
    id: string,
    stats: {
      tokensIn?: number;
      tokensOut?: number;
      cost?: number;
      toolCalls?: number;
    }
  ): boolean {
    const updates: string[] = ['updated_at = CURRENT_TIMESTAMP'];
    const params: unknown[] = [];

    if (stats.tokensIn) {
      updates.push('total_tokens_in = total_tokens_in + ?');
      params.push(stats.tokensIn);
    }
    if (stats.tokensOut) {
      updates.push('total_tokens_out = total_tokens_out + ?');
      params.push(stats.tokensOut);
    }
    if (stats.cost) {
      updates.push('total_cost = total_cost + ?');
      params.push(stats.cost);
    }
    if (stats.toolCalls) {
      updates.push('tool_calls_count = tool_calls_count + ?');
      params.push(stats.toolCalls);
    }

    params.push(id);
    const stmt = this.db.prepare(`UPDATE sessions SET ${updates.join(', ')} WHERE id = ?`);
    const result = stmt.run(...params);

    return result.changes > 0;
  }

  /**
   * Archive/unarchive session
   */
  setArchived(id: string, archived: boolean): boolean {
    const stmt = this.db.prepare('UPDATE sessions SET is_archived = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
    const result = stmt.run(archived ? 1 : 0, id);
    return result.changes > 0;
  }

  /**
   * Delete session (cascades to messages)
   */
  deleteSession(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM sessions WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  // ============================================================================
  // Message Methods
  // ============================================================================

  /**
   * Add message to session
   */
  addMessage(message: Omit<Message, 'id' | 'created_at'>): Message {
    const stmt = this.db.prepare(`
      INSERT INTO messages (session_id, role, content, tool_calls, tool_call_id, tokens, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `);

    const result = stmt.get(
      message.session_id,
      message.role,
      message.content || null,
      message.tool_calls ? JSON.stringify(message.tool_calls) : null,
      message.tool_call_id || null,
      message.tokens || 0,
      message.metadata ? JSON.stringify(message.metadata) : null
    ) as Message & { tool_calls: string | null; metadata: string | null };

    // Update session message count
    this.db.prepare('UPDATE sessions SET message_count = message_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(message.session_id);

    return this.deserializeMessage(result);
  }

  /**
   * Get messages for session
   */
  getMessages(sessionId: string, limit?: number): Message[] {
    let sql = 'SELECT * FROM messages WHERE session_id = ? ORDER BY id ASC';
    const params: unknown[] = [sessionId];

    if (limit) {
      sql += ' LIMIT ?';
      params.push(limit);
    }

    const stmt = this.db.prepare(sql);
    const results = stmt.all(...params) as (Message & { tool_calls: string | null; metadata: string | null })[];

    return results.map(r => this.deserializeMessage(r));
  }

  /**
   * Get recent messages (for context window)
   */
  getRecentMessages(sessionId: string, limit: number = 50): Message[] {
    const stmt = this.db.prepare(`
      SELECT * FROM (
        SELECT * FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT ?
      ) ORDER BY id ASC
    `);
    const results = stmt.all(sessionId, limit) as (Message & { tool_calls: string | null; metadata: string | null })[];

    return results.map(r => this.deserializeMessage(r));
  }

  /**
   * Delete messages from session
   */
  deleteMessages(sessionId: string, fromId?: number): number {
    let sql = 'DELETE FROM messages WHERE session_id = ?';
    const params: unknown[] = [sessionId];

    if (fromId !== undefined) {
      sql += ' AND id >= ?';
      params.push(fromId);
    }

    const stmt = this.db.prepare(sql);
    const result = stmt.run(...params);

    // Update message count
    const count = (this.db.prepare('SELECT COUNT(*) as count FROM messages WHERE session_id = ?').get(sessionId) as { count: number }).count;
    this.db.prepare('UPDATE sessions SET message_count = ? WHERE id = ?').run(count, sessionId);

    return result.changes;
  }

  // ============================================================================
  // Statistics Methods
  // ============================================================================

  /**
   * Get session statistics
   */
  getStats(projectId?: string): {
    totalSessions: number;
    activeSessions: number;
    archivedSessions: number;
    totalMessages: number;
    totalCost: number;
    totalTokensIn: number;
    totalTokensOut: number;
  } {
    let whereClause = '';
    const params: unknown[] = [];

    if (projectId) {
      whereClause = ' WHERE project_id = ?';
      params.push(projectId);
    }

    const sessionsStmt = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN is_archived = 0 THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN is_archived = 1 THEN 1 ELSE 0 END) as archived,
        SUM(message_count) as messages,
        SUM(total_cost) as cost,
        SUM(total_tokens_in) as tokens_in,
        SUM(total_tokens_out) as tokens_out
      FROM sessions${whereClause}
    `);

    const result = sessionsStmt.get(...params) as {
      total: number;
      active: number;
      archived: number;
      messages: number;
      cost: number;
      tokens_in: number;
      tokens_out: number;
    };

    return {
      totalSessions: result.total || 0,
      activeSessions: result.active || 0,
      archivedSessions: result.archived || 0,
      totalMessages: result.messages || 0,
      totalCost: result.cost || 0,
      totalTokensIn: result.tokens_in || 0,
      totalTokensOut: result.tokens_out || 0,
    };
  }

  /**
   * Get cost summary by model
   */
  getCostByModel(): { model: string; cost: number; sessions: number }[] {
    const stmt = this.db.prepare(`
      SELECT model, SUM(total_cost) as cost, COUNT(*) as sessions
      FROM sessions
      WHERE model IS NOT NULL
      GROUP BY model
      ORDER BY cost DESC
    `);

    return stmt.all() as { model: string; cost: number; sessions: number }[];
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private deserializeSession(row: Session & { metadata: string | null }): Session {
    let metadata: Record<string, unknown> | undefined;
    if (row.metadata) {
      try {
        metadata = JSON.parse(row.metadata);
      } catch {
        metadata = undefined;
      }
    }
    return {
      ...row,
      is_archived: Boolean(row.is_archived),
      metadata,
    };
  }

  private deserializeMessage(row: Message & { tool_calls: string | null; metadata: string | null }): Message {
    let toolCalls: unknown[] | undefined;
    let metadata: Record<string, unknown> | undefined;

    if (row.tool_calls) {
      try {
        toolCalls = JSON.parse(row.tool_calls);
      } catch {
        toolCalls = undefined;
      }
    }

    if (row.metadata) {
      try {
        metadata = JSON.parse(row.metadata);
      } catch {
        metadata = undefined;
      }
    }

    return {
      ...row,
      tool_calls: toolCalls,
      metadata,
    };
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let instance: SessionRepository | null = null;

export function getSessionRepository(): SessionRepository {
  if (!instance) {
    instance = new SessionRepository();
  }
  return instance;
}

export function resetSessionRepository(): void {
  instance = null;
}
