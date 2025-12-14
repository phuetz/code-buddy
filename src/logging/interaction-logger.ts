/**
 * Interaction Logger
 *
 * Comprehensive session logging with replay capability (mistral-vibe style).
 * Saves complete interaction history including messages, tool calls, metadata.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';

// ============================================================================
// Types
// ============================================================================

/**
 * Tool call entry in log
 */
export interface LoggedToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  timestamp: string;
  duration_ms?: number;
  success: boolean;
  output?: string;
  error?: string;
}

/**
 * Message entry in log
 */
export interface LoggedMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  timestamp: string;
  tool_calls?: LoggedToolCall[];
  tool_call_id?: string;
  tokens?: number;
}

/**
 * Session metadata
 */
export interface SessionMetadata {
  /** Unique session ID */
  id: string;
  /** Short ID for easy reference */
  short_id: string;
  /** Session start time */
  started_at: string;
  /** Session end time (if completed) */
  ended_at?: string;
  /** Total duration in milliseconds */
  duration_ms?: number;
  /** Model used */
  model: string;
  /** Provider used */
  provider: string;
  /** Working directory */
  cwd: string;
  /** Total input tokens */
  total_input_tokens: number;
  /** Total output tokens */
  total_output_tokens: number;
  /** Estimated cost (USD) */
  estimated_cost: number;
  /** Number of turns */
  turns: number;
  /** Number of tool calls */
  tool_calls: number;
  /** User-provided tags */
  tags?: string[];
  /** User-provided description */
  description?: string;
  /** Git branch (if in git repo) */
  git_branch?: string;
  /** Git commit (if in git repo) */
  git_commit?: string;
}

/**
 * Complete session data
 */
export interface SessionData {
  /** Version of the log format */
  version: string;
  /** Session metadata */
  metadata: SessionMetadata;
  /** Message history */
  messages: LoggedMessage[];
}

// ============================================================================
// Interaction Logger
// ============================================================================

const LOG_DIR = join(homedir(), '.grok', 'logs');
const LOG_VERSION = '1.0.0';

/**
 * Generate a short ID from UUID
 */
function generateShortId(uuid: string): string {
  return uuid.substring(0, 8);
}

/**
 * Get log file path for a session
 */
function getLogPath(sessionId: string): string {
  const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const dir = join(LOG_DIR, date);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return join(dir, `${sessionId}.json`);
}

/**
 * Interaction Logger for comprehensive session tracking
 */
export class InteractionLogger {
  private currentSession: SessionData | null = null;
  private logPath: string | null = null;
  private autoSave: boolean;
  private saveInterval: NodeJS.Timeout | null = null;

  constructor(options?: { autoSave?: boolean; saveIntervalMs?: number }) {
    this.autoSave = options?.autoSave ?? true;

    // Auto-save every 30 seconds if enabled
    if (this.autoSave && options?.saveIntervalMs) {
      this.saveInterval = setInterval(() => {
        if (this.currentSession) {
          this.save();
        }
      }, options.saveIntervalMs);
    }
  }

  /**
   * Start a new session
   */
  startSession(options: {
    model: string;
    provider: string;
    cwd?: string;
    tags?: string[];
    description?: string;
    gitInfo?: { branch?: string; commit?: string };
  }): string {
    const id = randomUUID();
    const shortId = generateShortId(id);

    this.currentSession = {
      version: LOG_VERSION,
      metadata: {
        id,
        short_id: shortId,
        started_at: new Date().toISOString(),
        model: options.model,
        provider: options.provider,
        cwd: options.cwd || process.cwd(),
        total_input_tokens: 0,
        total_output_tokens: 0,
        estimated_cost: 0,
        turns: 0,
        tool_calls: 0,
        tags: options.tags,
        description: options.description,
        git_branch: options.gitInfo?.branch,
        git_commit: options.gitInfo?.commit,
      },
      messages: [],
    };

    this.logPath = getLogPath(id);
    this.save();

    return id;
  }

  /**
   * End current session
   */
  endSession(): void {
    if (!this.currentSession) return;

    this.currentSession.metadata.ended_at = new Date().toISOString();
    this.currentSession.metadata.duration_ms =
      new Date().getTime() - new Date(this.currentSession.metadata.started_at).getTime();

    this.save();
    this.currentSession = null;
    this.logPath = null;
  }

  /**
   * Log a message
   */
  logMessage(message: {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | null;
    tool_call_id?: string;
    tokens?: number;
  }): void {
    if (!this.currentSession) return;

    const logged: LoggedMessage = {
      role: message.role,
      content: message.content,
      timestamp: new Date().toISOString(),
      tool_call_id: message.tool_call_id,
      tokens: message.tokens,
    };

    this.currentSession.messages.push(logged);

    // Update metadata
    if (message.role === 'user') {
      this.currentSession.metadata.turns++;
    }
    if (message.tokens) {
      if (message.role === 'user' || message.role === 'system') {
        this.currentSession.metadata.total_input_tokens += message.tokens;
      } else {
        this.currentSession.metadata.total_output_tokens += message.tokens;
      }
    }

    if (this.autoSave) {
      this.save();
    }
  }

  /**
   * Log tool calls
   */
  logToolCalls(
    toolCalls: Array<{
      id: string;
      name: string;
      arguments: Record<string, unknown>;
    }>
  ): void {
    if (!this.currentSession) return;

    // Find the last assistant message and add tool calls
    const lastAssistantIdx = this.currentSession.messages
      .map((m, i) => ({ m, i }))
      .filter(({ m }) => m.role === 'assistant')
      .pop()?.i;

    if (lastAssistantIdx !== undefined) {
      const msg = this.currentSession.messages[lastAssistantIdx];
      msg.tool_calls = toolCalls.map(tc => ({
        id: tc.id,
        name: tc.name,
        arguments: tc.arguments,
        timestamp: new Date().toISOString(),
        success: false, // Will be updated when result comes
      }));

      this.currentSession.metadata.tool_calls += toolCalls.length;
    }

    if (this.autoSave) {
      this.save();
    }
  }

  /**
   * Log tool result
   */
  logToolResult(
    toolCallId: string,
    result: {
      success: boolean;
      output?: string;
      error?: string;
      duration_ms?: number;
    }
  ): void {
    if (!this.currentSession) return;

    // Find the tool call and update it
    for (const msg of this.currentSession.messages) {
      if (msg.tool_calls) {
        const toolCall = msg.tool_calls.find(tc => tc.id === toolCallId);
        if (toolCall) {
          toolCall.success = result.success;
          toolCall.output = result.output;
          toolCall.error = result.error;
          toolCall.duration_ms = result.duration_ms;
          break;
        }
      }
    }

    if (this.autoSave) {
      this.save();
    }
  }

  /**
   * Update session cost
   */
  updateCost(cost: number): void {
    if (!this.currentSession) return;
    this.currentSession.metadata.estimated_cost = cost;
  }

  /**
   * Save current session to disk
   */
  save(): void {
    if (!this.currentSession || !this.logPath) return;

    const dir = dirname(this.logPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(this.logPath, JSON.stringify(this.currentSession, null, 2));
  }

  /**
   * Get current session data
   */
  getCurrentSession(): SessionData | null {
    return this.currentSession;
  }

  /**
   * Get current session ID
   */
  getCurrentSessionId(): string | null {
    return this.currentSession?.metadata.id || null;
  }

  /**
   * Load a session by ID (full or short)
   */
  static loadSession(sessionId: string): SessionData | null {
    // Try to find the session file
    const files = InteractionLogger.findSessionFiles(sessionId);
    if (files.length === 0) return null;

    // If multiple matches, return the most recent
    const path = files[0];
    try {
      const content = readFileSync(path, 'utf-8');
      return JSON.parse(content) as SessionData;
    } catch {
      return null;
    }
  }

  /**
   * Search sessions by partial ID
   */
  static searchSessions(partialId: string): SessionData[] {
    const files = InteractionLogger.findSessionFiles(partialId);
    const sessions: SessionData[] = [];

    for (const file of files) {
      try {
        const content = readFileSync(file, 'utf-8');
        sessions.push(JSON.parse(content) as SessionData);
      } catch {
        // Skip invalid files
      }
    }

    return sessions;
  }

  /**
   * Find session files matching an ID
   */
  private static findSessionFiles(idPattern: string): string[] {
    if (!existsSync(LOG_DIR)) return [];

    const results: string[] = [];
    const dateDirs = readdirSync(LOG_DIR).filter(d =>
      statSync(join(LOG_DIR, d)).isDirectory()
    );

    for (const dateDir of dateDirs) {
      const dir = join(LOG_DIR, dateDir);
      const files = readdirSync(dir).filter(f => f.endsWith('.json'));

      for (const file of files) {
        const sessionId = file.replace('.json', '');
        // Match full ID or short ID (first 8 chars)
        if (sessionId.startsWith(idPattern) || sessionId.substring(0, 8) === idPattern) {
          results.push(join(dir, file));
        }
      }
    }

    // Sort by modification time (most recent first)
    return results.sort((a, b) => {
      const statA = statSync(a);
      const statB = statSync(b);
      return statB.mtime.getTime() - statA.mtime.getTime();
    });
  }

  /**
   * Get the latest session
   */
  static getLatestSession(): SessionData | null {
    if (!existsSync(LOG_DIR)) return null;

    // Get all date directories
    const dateDirs = readdirSync(LOG_DIR)
      .filter(d => statSync(join(LOG_DIR, d)).isDirectory())
      .sort()
      .reverse();

    for (const dateDir of dateDirs) {
      const dir = join(LOG_DIR, dateDir);
      const files = readdirSync(dir)
        .filter(f => f.endsWith('.json'))
        .map(f => ({
          path: join(dir, f),
          mtime: statSync(join(dir, f)).mtime.getTime(),
        }))
        .sort((a, b) => b.mtime - a.mtime);

      if (files.length > 0) {
        try {
          const content = readFileSync(files[0].path, 'utf-8');
          return JSON.parse(content) as SessionData;
        } catch {
          continue;
        }
      }
    }

    return null;
  }

  /**
   * List all sessions (with pagination)
   */
  static listSessions(options?: {
    limit?: number;
    offset?: number;
    tags?: string[];
    model?: string;
    startDate?: Date;
    endDate?: Date;
  }): { sessions: SessionMetadata[]; total: number } {
    if (!existsSync(LOG_DIR)) return { sessions: [], total: 0 };

    const allSessions: SessionMetadata[] = [];

    // Get all date directories
    const dateDirs = readdirSync(LOG_DIR)
      .filter(d => statSync(join(LOG_DIR, d)).isDirectory())
      .sort()
      .reverse();

    for (const dateDir of dateDirs) {
      const dir = join(LOG_DIR, dateDir);
      const files = readdirSync(dir).filter(f => f.endsWith('.json'));

      for (const file of files) {
        try {
          const content = readFileSync(join(dir, file), 'utf-8');
          const session = JSON.parse(content) as SessionData;

          // Apply filters
          if (options?.tags?.length) {
            const hasTag = options.tags.some(t => session.metadata.tags?.includes(t));
            if (!hasTag) continue;
          }
          if (options?.model && session.metadata.model !== options.model) continue;
          if (options?.startDate) {
            const sessionDate = new Date(session.metadata.started_at);
            if (sessionDate < options.startDate) continue;
          }
          if (options?.endDate) {
            const sessionDate = new Date(session.metadata.started_at);
            if (sessionDate > options.endDate) continue;
          }

          allSessions.push(session.metadata);
        } catch {
          // Skip invalid files
        }
      }
    }

    // Sort by start time (most recent first)
    allSessions.sort((a, b) =>
      new Date(b.started_at).getTime() - new Date(a.started_at).getTime()
    );

    // Apply pagination
    const offset = options?.offset || 0;
    const limit = options?.limit || 20;
    const paginated = allSessions.slice(offset, offset + limit);

    return { sessions: paginated, total: allSessions.length };
  }

  /**
   * Delete a session
   */
  static deleteSession(sessionId: string): boolean {
    const files = InteractionLogger.findSessionFiles(sessionId);
    if (files.length === 0) return false;

    const { unlinkSync } = require('fs');
    for (const file of files) {
      try {
        unlinkSync(file);
      } catch {
        return false;
      }
    }
    return true;
  }

  /**
   * Format session for display
   */
  static formatSession(session: SessionData): string {
    const lines: string[] = [];
    const meta = session.metadata;

    lines.push(`Session: ${meta.short_id} (${meta.id})`);
    lines.push(`Started: ${meta.started_at}`);
    if (meta.ended_at) lines.push(`Ended: ${meta.ended_at}`);
    lines.push(`Model: ${meta.model} (${meta.provider})`);
    lines.push(`Directory: ${meta.cwd}`);
    lines.push(`Turns: ${meta.turns} | Tool calls: ${meta.tool_calls}`);
    lines.push(`Tokens: ${meta.total_input_tokens} in / ${meta.total_output_tokens} out`);
    lines.push(`Cost: $${meta.estimated_cost.toFixed(4)}`);
    if (meta.tags?.length) lines.push(`Tags: ${meta.tags.join(', ')}`);
    if (meta.description) lines.push(`Description: ${meta.description}`);
    lines.push('');
    lines.push('Messages:');
    lines.push('-'.repeat(40));

    for (const msg of session.messages) {
      const prefix = `[${msg.timestamp.split('T')[1].split('.')[0]}]`;
      const role = msg.role.toUpperCase().padEnd(10);
      const content = msg.content || '(no content)';
      lines.push(`${prefix} ${role}: ${content.substring(0, 100)}${content.length > 100 ? '...' : ''}`);

      if (msg.tool_calls?.length) {
        for (const tc of msg.tool_calls) {
          const status = tc.success ? '✓' : '✗';
          lines.push(`           ${status} Tool: ${tc.name}(${JSON.stringify(tc.arguments).substring(0, 50)}...)`);
        }
      }
    }

    return lines.join('\n');
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
      this.saveInterval = null;
    }
    if (this.currentSession) {
      this.endSession();
    }
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

let loggerInstance: InteractionLogger | null = null;

export function getInteractionLogger(): InteractionLogger {
  if (!loggerInstance) {
    loggerInstance = new InteractionLogger({ autoSave: true });
  }
  return loggerInstance;
}

/**
 * Create a new logger instance (for testing)
 */
export function createInteractionLogger(options?: {
  autoSave?: boolean;
  saveIntervalMs?: number;
}): InteractionLogger {
  return new InteractionLogger(options);
}
