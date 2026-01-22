import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import os from 'os';
import type { ChatEntry } from '../agent/types.js';
import { getSessionRepository, SessionRepository } from '../database/repositories/session-repository.js';
import type { Message as DBMessage } from '../database/schema.js';

/** Metadata for chat sessions */
export interface SessionMetadata {
  description?: string;
  tags?: string[];
  securityMode?: 'suggest' | 'auto-edit' | 'full-auto';
  agentMode?: 'plan' | 'code' | 'ask' | 'architect';
  tokenCount?: number;
  totalCost?: number;
  toolCallCount?: number;
  [key: string]: string | string[] | number | boolean | undefined;
}

export interface Session {
  id: string;
  name: string;
  workingDirectory: string;
  model: string;
  messages: SessionMessage[];
  createdAt: Date;
  lastAccessedAt: Date;
  metadata?: SessionMetadata;
}

export interface SessionMessage {
  type: 'user' | 'assistant' | 'tool_result' | 'tool_call';
  content: string;
  timestamp: string;
  toolCallName?: string;
  toolCallSuccess?: boolean;
}

const SESSIONS_DIR = path.join(os.homedir(), '.codebuddy', 'sessions');
const MAX_SESSIONS = 50;

export interface SessionStoreConfig {
  /** Use SQLite database instead of JSON files */
  useSQLite: boolean;
}

const DEFAULT_CONFIG: SessionStoreConfig = {
  useSQLite: true, // SQLite by default
};

/**
 * Session Store for persisting and restoring chat sessions
 */
export class SessionStore {
  private currentSessionId: string | null = null;
  private autoSave: boolean = true;
  private config: SessionStoreConfig;
  private dbRepository: SessionRepository | null = null;

  constructor(config: Partial<SessionStoreConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Initialize SQLite repository if enabled
    if (this.config.useSQLite) {
      try {
        this.dbRepository = getSessionRepository();
      } catch {
        // Fallback to JSON if SQLite fails
        this.config.useSQLite = false;
      }
    }
    // Directory will be ensured lazily on first file operation
  }

  /**
   * Ensure the sessions directory exists
   */
  private async ensureSessionsDirectory(): Promise<void> {
    try {
      await fsPromises.access(SESSIONS_DIR);
    } catch {
      await fsPromises.mkdir(SESSIONS_DIR, { recursive: true });
    }
  }

  /**
   * Create a new session
   */
  async createSession(name?: string, model?: string): Promise<Session> {
    const session: Session = {
      id: this.generateSessionId(),
      name: name || `Session ${new Date().toLocaleDateString()}`,
      workingDirectory: process.cwd(),
      model: model || 'grok-4-latest',
      messages: [],
      createdAt: new Date(),
      lastAccessedAt: new Date()
    };

    // Store in SQLite if enabled
    if (this.dbRepository) {
      this.dbRepository.createSession({
        id: session.id,
        project_path: session.workingDirectory,
        name: session.name,
        model: session.model,
      });
    }

    await this.saveSession(session);
    this.currentSessionId = session.id;

    return session;
  }

  /**
   * Save a session to disk
   */
  async saveSession(session: Session): Promise<void> {
    await this.ensureSessionsDirectory();
    const filePath = this.getSessionFilePath(session.id);

    const data = {
      ...session,
      createdAt: session.createdAt.toISOString(),
      lastAccessedAt: new Date().toISOString()
    };

    await fsPromises.writeFile(filePath, JSON.stringify(data, null, 2));
  }

  /**
   * Load a session from disk
   */
  async loadSession(sessionId: string): Promise<Session | null> {
    const filePath = this.getSessionFilePath(sessionId);

    try {
      await fsPromises.access(filePath);
      const content = await fsPromises.readFile(filePath, 'utf-8');
      const data = JSON.parse(content);
      return {
        ...data,
        createdAt: new Date(data.createdAt),
        lastAccessedAt: new Date(data.lastAccessedAt)
      };
    } catch (_error) {
      return null;
    }
  }

  /**
   * Update the current session with new messages
   */
  async updateCurrentSession(chatHistory: ChatEntry[]): Promise<void> {
    if (!this.currentSessionId || !this.autoSave) return;

    const session = await this.loadSession(this.currentSessionId);
    if (!session) return;

    session.messages = this.convertChatEntriesToMessages(chatHistory);
    session.lastAccessedAt = new Date();

    await this.saveSession(session);
  }

  /**
   * Add a message to the current session
   */
  async addMessageToCurrentSession(entry: ChatEntry): Promise<void> {
    if (!this.currentSessionId || !this.autoSave) return;

    const session = await this.loadSession(this.currentSessionId);
    if (!session) return;

    const message = this.convertChatEntryToMessage(entry);
    session.messages.push(message);
    session.lastAccessedAt = new Date();

    // Store in SQLite if enabled
    if (this.dbRepository) {
      const dbMessage: Omit<DBMessage, 'id' | 'created_at'> = {
        session_id: this.currentSessionId,
        role: message.type === 'tool_result' ? 'tool' : message.type === 'tool_call' ? 'assistant' : message.type,
        content: message.content,
        tool_calls: message.toolCallName ? [{ name: message.toolCallName }] : undefined,
        metadata: message.toolCallSuccess !== undefined ? { success: message.toolCallSuccess } : undefined,
      };
      this.dbRepository.addMessage(dbMessage);
    }

    await this.saveSession(session);
  }

  /**
   * Convert ChatEntry to SessionMessage
   */
  private convertChatEntryToMessage(entry: ChatEntry): SessionMessage {
    return {
      type: entry.type,
      content: entry.content,
      timestamp: entry.timestamp.toISOString(),
      toolCallName: entry.toolCall?.function?.name,
      toolCallSuccess: entry.toolResult?.success
    };
  }

  /**
   * Convert ChatEntry array to SessionMessage array
   */
  private convertChatEntriesToMessages(entries: ChatEntry[]): SessionMessage[] {
    return entries.map(entry => this.convertChatEntryToMessage(entry));
  }

  /**
   * Convert SessionMessage array back to ChatEntry array
   */
  convertMessagesToChatEntries(messages: SessionMessage[]): ChatEntry[] {
    return messages.map(msg => ({
      type: msg.type,
      content: msg.content,
      timestamp: new Date(msg.timestamp),
      toolCall: msg.toolCallName ? {
        id: `restored_${Date.now()}`,
        type: 'function' as const,
        function: {
          name: msg.toolCallName,
          arguments: '{}'
        }
      } : undefined,
      toolResult: msg.toolCallSuccess !== undefined ? {
        success: msg.toolCallSuccess
      } : undefined
    }));
  }

  /**
   * List all saved sessions
   */
  async listSessions(): Promise<Session[]> {
    await this.ensureSessionsDirectory();

    const fileNames = await fsPromises.readdir(SESSIONS_DIR);
    const jsonFiles = fileNames.filter(f => f.endsWith('.json'));

    const sessions: Session[] = [];
    for (const f of jsonFiles) {
      const sessionId = f.replace('.json', '');
      const session = await this.loadSession(sessionId);
      if (session) {
        sessions.push(session);
      }
    }

    return sessions.sort((a, b) => b.lastAccessedAt.getTime() - a.lastAccessedAt.getTime());
  }

  /**
   * Get recent sessions
   */
  async getRecentSessions(count: number = 10): Promise<Session[]> {
    const sessions = await this.listSessions();
    return sessions.slice(0, count);
  }

  /**
   * Delete a session
   */
  async deleteSession(sessionId: string): Promise<boolean> {
    const filePath = this.getSessionFilePath(sessionId);

    try {
      await fsPromises.access(filePath);
      await fsPromises.unlink(filePath);

      if (this.currentSessionId === sessionId) {
        this.currentSessionId = null;
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Clean up old sessions (keep only MAX_SESSIONS most recent)
   */
  async cleanupOldSessions(): Promise<number> {
    const sessions = await this.listSessions();
    let deleted = 0;

    if (sessions.length > MAX_SESSIONS) {
      const sessionsToDelete = sessions.slice(MAX_SESSIONS);

      for (const session of sessionsToDelete) {
        if (await this.deleteSession(session.id)) {
          deleted++;
        }
      }
    }

    return deleted;
  }

  /**
   * Export session to Markdown
   */
  async exportToMarkdown(sessionId: string): Promise<string | null> {
    const session = await this.loadSession(sessionId);
    if (!session) return null;

    const lines: string[] = [
      `# ${session.name}`,
      '',
      `**Created:** ${session.createdAt.toLocaleString()}`,
      `**Last Accessed:** ${session.lastAccessedAt.toLocaleString()}`,
      `**Working Directory:** ${session.workingDirectory}`,
      `**Model:** ${session.model}`,
      '',
      '---',
      ''
    ];

    for (const message of session.messages) {
      const time = new Date(message.timestamp).toLocaleTimeString();

      if (message.type === 'user') {
        lines.push(`## User (${time})`);
        lines.push('');
        lines.push(message.content);
        lines.push('');
      } else if (message.type === 'assistant') {
        lines.push(`## Assistant (${time})`);
        lines.push('');
        lines.push(message.content);
        lines.push('');
      } else if (message.type === 'tool_result') {
        const status = message.toolCallSuccess ? '✅' : '❌';
        lines.push(`### Tool: ${message.toolCallName || 'unknown'} ${status}`);
        lines.push('');
        lines.push('```');
        lines.push(message.content.slice(0, 500));
        if (message.content.length > 500) {
          lines.push('... [truncated]');
        }
        lines.push('```');
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  /**
   * Save session export to file
   */
  async exportSessionToFile(sessionId: string, outputPath?: string): Promise<string | null> {
    const markdown = await this.exportToMarkdown(sessionId);
    if (!markdown) return null;

    const session = await this.loadSession(sessionId);
    if (!session) return null;

    const fileName = outputPath || `codebuddy-session-${session.id.slice(0, 8)}.md`;
    const fullPath = path.resolve(process.cwd(), fileName);

    await fsPromises.writeFile(fullPath, markdown);
    return fullPath;
  }

  /**
   * Resume a session (set as current)
   */
  async resumeSession(sessionId: string): Promise<Session | null> {
    const session = await this.loadSession(sessionId);
    if (session) {
      this.currentSessionId = sessionId;
      session.lastAccessedAt = new Date();
      await this.saveSession(session);
    }
    return session;
  }

  /**
   * Get the current session ID
   */
  getCurrentSessionId(): string | null {
    return this.currentSessionId;
  }

  /**
   * Get the current session
   */
  async getCurrentSession(): Promise<Session | null> {
    if (!this.currentSessionId) return null;
    return this.loadSession(this.currentSessionId);
  }

  /**
   * Set auto-save mode
   */
  setAutoSave(enabled: boolean): void {
    this.autoSave = enabled;
  }

  /**
   * Check if auto-save is enabled
   */
  isAutoSaveEnabled(): boolean {
    return this.autoSave;
  }

  /**
   * Format session for display
   */
  formatSession(session: Session): string {
    const messageCount = session.messages.length;
    const date = session.lastAccessedAt.toLocaleDateString();
    const time = session.lastAccessedAt.toLocaleTimeString();
    return `[${session.id.slice(0, 8)}] ${session.name} - ${messageCount} messages - ${date} ${time}`;
  }

  /**
   * Format session list for display
   */
  async formatSessionList(): Promise<string> {
    const sessions = await this.getRecentSessions(10);

    if (sessions.length === 0) {
      return 'No saved sessions.';
    }

    const header = 'Recent Sessions:\n' + '─'.repeat(50) + '\n';
    const list = sessions
      .map((s, index) => `${index + 1}. ${this.formatSession(s)}`)
      .join('\n');

    return header + list;
  }

  /**
   * Get session file path
   */
  private getSessionFilePath(sessionId: string): string {
    return path.join(SESSIONS_DIR, `${sessionId}.json`);
  }

  /**
   * Generate a unique session ID
   */
  private generateSessionId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `session_${timestamp}_${random}`;
  }

  /**
   * Search sessions by content
   */
  async searchSessions(query: string): Promise<Session[]> {
    const sessions = await this.listSessions();
    const lowerQuery = query.toLowerCase();

    return sessions.filter(session => {
      // Search in name
      if (session.name.toLowerCase().includes(lowerQuery)) return true;

      // Search in messages
      return session.messages.some(msg =>
        msg.content.toLowerCase().includes(lowerQuery)
      );
    });
  }

  /**
   * Get the most recent session
   */
  async getLastSession(): Promise<Session | null> {
    const sessions = await this.listSessions();
    return sessions.length > 0 ? sessions[0] : null;
  }

  /**
   * Resume the last session
   */
  async resumeLastSession(): Promise<Session | null> {
    const lastSession = await this.getLastSession();
    if (lastSession) {
      return this.resumeSession(lastSession.id);
    }
    return null;
  }

  /**
   * Continue from last response (get last session and last message)
   */
  async continueLastSession(): Promise<{ session: Session; lastUserMessage: string } | null> {
    const session = await this.resumeLastSession();
    if (!session) return null;

    // Find the last user message
    const lastUserMessage = [...session.messages]
      .reverse()
      .find(m => m.type === 'user');

    return {
      session,
      lastUserMessage: lastUserMessage?.content || ''
    };
  }

  /**
   * Get session by partial ID match
   */
  async getSessionByPartialId(partialId: string): Promise<Session | null> {
    const sessions = await this.listSessions();
    const match = sessions.find(s =>
      s.id.includes(partialId) || s.id.startsWith(partialId)
    );
    return match || null;
  }

  /**
   * Clone a session (for branching conversations)
   */
  async cloneSession(sessionId: string, newName?: string): Promise<Session | null> {
    const original = await this.loadSession(sessionId);
    if (!original) return null;

    const cloned: Session = {
      ...original,
      id: this.generateSessionId(),
      name: newName || `${original.name} (copy)`,
      createdAt: new Date(),
      lastAccessedAt: new Date(),
      messages: [...original.messages]
    };

    await this.saveSession(cloned);
    return cloned;
  }

  /**
   * Branch session at a specific message index
   */
  async branchSession(sessionId: string, atMessageIndex: number, newName?: string): Promise<Session | null> {
    const original = await this.loadSession(sessionId);
    if (!original) return null;

    const branchedMessages = original.messages.slice(0, atMessageIndex + 1);

    const branched: Session = {
      ...original,
      id: this.generateSessionId(),
      name: newName || `${original.name} (branch)`,
      createdAt: new Date(),
      lastAccessedAt: new Date(),
      messages: branchedMessages,
      metadata: {
        ...original.metadata,
        branchedFrom: sessionId,
        branchedAt: atMessageIndex
      }
    };

    await this.saveSession(branched);
    return branched;
  }

  /**
   * Format help for session commands
   */
  formatHelp(): string {
    return `
Session Management Commands:

  /sessions           List recent sessions
  /session <id>       Resume a specific session
  /session last       Resume the last session
  /session continue   Continue from last response
  /session export     Export current session to markdown
  /session delete <id> Delete a session
  /session clone <id> Clone a session
  /session branch <n> Branch at message index n
  /session search <q> Search sessions by content

CLI Flags:
  --resume            Resume the last session
  --continue          Continue from last response
  --session <id>      Load a specific session

Examples:
  codebuddy --resume
  codebuddy --session abc123
  /session clone abc123 "My experiment"
`;
  }
}

// Singleton instance
let sessionStoreInstance: SessionStore | null = null;

export function getSessionStore(): SessionStore {
  if (!sessionStoreInstance) {
    sessionStoreInstance = new SessionStore();
  }
  return sessionStoreInstance;
}

export function resetSessionStore(): void {
  sessionStoreInstance = null;
}