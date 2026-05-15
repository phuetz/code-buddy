import type Database from 'better-sqlite3';
import type { Message, MemoryEntry, ContentBlock } from '../../renderer/types';
import { v4 as uuidv4 } from 'uuid';
import { logError } from '../utils/logger';

interface ContextStrategy {
  type: 'full' | 'compressed' | 'rolling';
  messages: Message[];
  summary?: string;
}

/**
 * MemoryManager - Handles message history and context management
 *
 * Two main functions:
 * 1. Message storage and retrieval
 * 2. Intelligent context management for Claude API calls
 */
export class MemoryManager {
  private db: Database.Database;
  private maxContextTokens: number;

  constructor(db: Database.Database, maxContextTokens = 180000) {
    this.db = db;
    this.maxContextTokens = maxContextTokens;
  }

  /**
   * Save a message to the database
   */
  saveMessage(sessionId: string, message: Message): void {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO messages (id, session_id, role, content, timestamp, token_usage)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        message.id,
        sessionId,
        message.role,
        JSON.stringify(message.content),
        message.timestamp,
        message.tokenUsage ? JSON.stringify(message.tokenUsage) : null
      );
    } catch (error) {
      logError('[MemoryManager] Error saving message:', error);
    }
  }

  /**
   * Get message history for a session
   */
  getMessageHistory(sessionId: string, limit?: number): Message[] {
    let query = 'SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp ASC';
    const params: (string | number)[] = [sessionId];
    if (limit) {
      query += ' LIMIT ?';
      params.push(limit);
    }

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as Record<string, unknown>[];

    return rows.map((row) => {
      let content: ContentBlock[];
      try {
        content = JSON.parse(row.content as string) as ContentBlock[];
      } catch {
        content = [{ type: 'text', text: row.content as string } as ContentBlock];
      }

      let tokenUsage;
      try {
        tokenUsage = row.token_usage ? JSON.parse(row.token_usage as string) : undefined;
      } catch {
        tokenUsage = undefined;
      }

      return {
        id: row.id as string,
        sessionId: row.session_id as string,
        role: row.role as Message['role'],
        content,
        timestamp: row.timestamp as number,
        tokenUsage,
      };
    });
  }

  /**
   * Search messages using full-text search
   */
  searchMessages(sessionId: string, query: string): Message[] {
    // First get all messages for the session
    const messages = this.getMessageHistory(sessionId);

    // Simple text search (FTS5 would be more efficient for large datasets)
    const queryLower = query.toLowerCase();

    return messages.filter((message) => {
      return message.content.some((block) => {
        if (block.type === 'text') {
          return block.text.toLowerCase().includes(queryLower);
        }
        return false;
      });
    });
  }

  /**
   * Manage context for a session - determine best strategy based on token usage
   */
  manageContext(sessionId: string): ContextStrategy {
    const messages = this.getMessageHistory(sessionId);
    const tokenCount = this.estimateTokens(messages);

    // If within limits, return full context
    if (tokenCount < this.maxContextTokens * 0.9) {
      return {
        type: 'full',
        messages,
      };
    }

    // If approaching limit, compress
    return this.compressContext(messages);
  }

  /**
   * Compress context by summarizing older messages
   */
  compressContext(messages: Message[]): ContextStrategy {
    const recentCount = 20; // Keep last 20 messages

    if (messages.length <= recentCount) {
      return {
        type: 'full',
        messages,
      };
    }

    const recent = messages.slice(-recentCount);
    const older = messages.slice(0, -recentCount);

    // Generate summary of older messages
    const summary = this.generateSummary(older);

    return {
      type: 'compressed',
      messages: recent,
      summary,
    };
  }

  /**
   * Get relevant context based on current prompt (for retrieval)
   */
  getRelevantContext(sessionId: string, currentPrompt: string): Message[] {
    const messages = this.getMessageHistory(sessionId);

    // Simple relevance scoring based on keyword overlap
    const promptWords = new Set(
      currentPrompt
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 3)
    );

    const scoredMessages = messages.map((message) => {
      let score = 0;

      for (const block of message.content) {
        if (block.type === 'text') {
          const messageWords = block.text.toLowerCase().split(/\s+/);
          for (const word of messageWords) {
            if (promptWords.has(word)) {
              score++;
            }
          }
        }
      }

      return { message, score };
    });

    // Return messages sorted by relevance, limited to top 10
    return scoredMessages
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map(({ message }) => message);
  }

  /**
   * Estimate token count for messages (rough approximation)
   */
  private estimateTokens(messages: Message[]): number {
    let charCount = 0;

    for (const message of messages) {
      for (const block of message.content) {
        if (block.type === 'text') {
          charCount += block.text.length;
        } else if (block.type === 'tool_use') {
          charCount += JSON.stringify(block.input).length;
        } else if (block.type === 'tool_result') {
          charCount += block.content.length;
        }
      }
    }

    // Rough estimate: 1 token ≈ 4 characters for English
    return Math.ceil(charCount / 4);
  }

  /**
   * Build a deterministic extractive summary of older messages.
   *
   * This intentionally avoids claiming LLM-backed semantic compression in
   * Cowork's main process. Runtime model summarization should be injected as a
   * separate service so unavailable credentials cannot silently degrade into a
   * fake "Claude summary".
   */
  private generateSummary(messages: Message[]): string {
    if (messages.length === 0) {
      return 'Extractive context summary: no older messages.';
    }

    const roleCounts = new Map<string, number>();
    for (const message of messages) {
      roleCounts.set(message.role, (roleCounts.get(message.role) ?? 0) + 1);
    }

    const roleLine = Array.from(roleCounts.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([role, count]) => `${role}: ${count}`)
      .join(', ');

    const excerpts = this.selectSummaryExcerpts(messages, 8);
    const excerptLines = excerpts.map((message, index) => {
      const text = this.messageTextForSummary(message);
      const timestamp = Number.isFinite(message.timestamp)
        ? new Date(message.timestamp).toISOString()
        : 'unknown-time';
      return `${index + 1}. [${message.role} @ ${timestamp}] ${text}`;
    });

    return [
      'Extractive context summary:',
      `Messages summarized: ${messages.length}`,
      `Role counts: ${roleLine || 'none'}`,
      'Representative excerpts:',
      ...excerptLines,
    ].join('\n');
  }

  private selectSummaryExcerpts(messages: Message[], maxExcerpts: number): Message[] {
    if (messages.length <= maxExcerpts) {
      return messages.filter((message) => this.messageTextForSummary(message).length > 0);
    }

    const selected = new Map<number, Message>();
    const importantRoles = new Set(['system', 'user']);
    messages.forEach((message, index) => {
      if (importantRoles.has(message.role) && selected.size < maxExcerpts) {
        selected.set(index, message);
      }
    });

    const anchors = [0, 1, Math.floor(messages.length / 2), messages.length - 2, messages.length - 1];
    for (const index of anchors) {
      if (index >= 0 && index < messages.length && selected.size < maxExcerpts) {
        selected.set(index, messages[index]);
      }
    }

    for (let index = 0; index < messages.length && selected.size < maxExcerpts; index++) {
      selected.set(index, messages[index]);
    }

    return Array.from(selected.entries())
      .sort(([a], [b]) => a - b)
      .map(([, message]) => message)
      .filter((message) => this.messageTextForSummary(message).length > 0);
  }

  private messageTextForSummary(message: Message): string {
    const parts = message.content.flatMap((block) => {
      if (block.type === 'text') {
        return block.text;
      }
      if (block.type === 'tool_use') {
        return `Tool use: ${block.name}`;
      }
      if (block.type === 'tool_result') {
        return `Tool result: ${block.content}`;
      }
      return [];
    });

    return parts
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 240);
  }

  /**
   * Save a memory entry (for explicit memory storage)
   */
  saveMemoryEntry(
    sessionId: string,
    content: string,
    metadata: { source: string; tags: string[] }
  ): MemoryEntry {
    const entry: MemoryEntry = {
      id: uuidv4(),
      sessionId,
      content,
      metadata: {
        ...metadata,
        timestamp: Date.now(),
      },
      createdAt: Date.now(),
    };

    const stmt = this.db.prepare(`
      INSERT INTO memory_entries (id, session_id, content, metadata, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(
      entry.id,
      entry.sessionId,
      entry.content,
      JSON.stringify(entry.metadata),
      entry.createdAt
    );

    return entry;
  }

  /**
   * Search memory entries using LIKE-based text search
   */
  searchMemory(sessionId: string, query: string): MemoryEntry[] {
    const escapedQuery = query.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
    const stmt = this.db.prepare(`
      SELECT * FROM memory_entries
      WHERE session_id = ? AND content LIKE ? ESCAPE '\\'
      ORDER BY created_at DESC
      LIMIT 20
    `);

    const rows = stmt.all(sessionId, `%${escapedQuery}%`) as Record<string, unknown>[];

    return rows.map((row) => {
      let metadata;
      try {
        metadata = JSON.parse(row.metadata as string);
      } catch {
        metadata = row.metadata;
      }

      return {
        id: row.id as string,
        sessionId: row.session_id as string,
        content: row.content as string,
        metadata,
        createdAt: row.created_at as number,
      };
    });
  }

  /**
   * Delete messages for a session
   */
  deleteSessionMessages(sessionId: string): void {
    try {
      const stmt = this.db.prepare('DELETE FROM messages WHERE session_id = ?');
      stmt.run(sessionId);
    } catch (error) {
      logError('[MemoryManager] Error deleting session messages:', error);
    }
  }

  /**
   * Delete memory entries for a session
   */
  deleteSessionMemory(sessionId: string): void {
    try {
      const stmt = this.db.prepare('DELETE FROM memory_entries WHERE session_id = ?');
      stmt.run(sessionId);
    } catch (error) {
      logError('[MemoryManager] Error deleting session memory:', error);
    }
  }
}
