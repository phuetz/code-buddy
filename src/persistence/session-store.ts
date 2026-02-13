import _fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import os from 'os';
import type { ChatEntry } from '../agent/types.js';
import { getSessionRepository, SessionRepository } from '../database/repositories/session-repository.js';
import type { Message as DBMessage } from '../database/schema.js';
import { withSessionLock } from './session-lock.js';

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
  type: 'user' | 'assistant' | 'tool_result' | 'tool_call' | 'reasoning' | 'plan_progress' | 'steer';
  content: string;
  timestamp: string;
  toolCallName?: string;
  toolCallSuccess?: boolean;
  /** Task state for cross-session continuity */
  taskState?: Record<string, unknown>;
}

const DEFAULT_SESSIONS_DIR = path.join(os.homedir(), '.codebuddy', 'sessions');
const FALLBACK_SESSIONS_DIR = path.join(os.tmpdir(), 'codebuddy', 'sessions');
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
  private sessionsDir: string;
  private sessionsDirVerified: boolean = false;

  constructor(config: Partial<SessionStoreConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.sessionsDir = path.resolve(process.env.CODEBUDDY_SESSIONS_DIR || DEFAULT_SESSIONS_DIR);

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
    if (this.sessionsDirVerified) {
      return;
    }

    const canUsePreferredDir = await this.ensureWritableDirectory(this.sessionsDir);
    if (canUsePreferredDir) {
      this.sessionsDirVerified = true;
      return;
    }

    if (this.sessionsDir !== FALLBACK_SESSIONS_DIR) {
      const canUseFallbackDir = await this.ensureWritableDirectory(FALLBACK_SESSIONS_DIR);
      if (canUseFallbackDir) {
        this.sessionsDir = FALLBACK_SESSIONS_DIR;
        this.sessionsDirVerified = true;
        return;
      }
    }

    throw new Error(`Unable to access writable sessions directory: ${this.sessionsDir}`);
  }

  /**
   * Ensure a directory exists and is writable.
   */
  private async ensureWritableDirectory(dir: string): Promise<boolean> {
    const probeFile = path.join(dir, `.codebuddy-write-test-${process.pid}-${Date.now()}`);

    try {
      await fsPromises.mkdir(dir, { recursive: true });
      // Validate actual write capability (sandbox policies may still block writes
      // even when access checks pass).
      await fsPromises.writeFile(probeFile, '');
      await fsPromises.unlink(probeFile);
      return true;
    } catch {
      await fsPromises.unlink(probeFile).catch(() => {});
      return false;
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
   * Save a session to disk (with file locking to prevent concurrent write corruption)
   */
  async saveSession(session: Session): Promise<void> {
    await this.ensureSessionsDirectory();
    const filePath = this.getSessionFilePath(session.id);

    const data = {
      ...session,
      createdAt: session.createdAt.toISOString(),
      lastAccessedAt: new Date().toISOString()
    };

    await withSessionLock(filePath, async () => {
      await fsPromises.writeFile(filePath, JSON.stringify(data, null, 2));
    });
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
        role: message.type === 'tool_result' ? 'tool' : message.type === 'tool_call' ? 'assistant' : message.type === 'reasoning' ? 'assistant' : message.type === 'plan_progress' ? 'assistant' : message.type === 'steer' ? 'user' : message.type,
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
    return messages.map((msg, idx) => ({
      type: msg.type,
      content: msg.content,
      timestamp: new Date(msg.timestamp),
      toolCall: msg.toolCallName ? {
        id: `restored_${Date.now()}_${idx}`,
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
  listSessions(): Session[] {
    return this.readSessionsFromDiskSync();
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
   * Export session to JSON format
   */
  async exportToJson(sessionId: string): Promise<string | null> {
    const session = await this.loadSession(sessionId);
    if (!session) return null;

    const exportData = {
      format: 'code-buddy-session',
      version: '1.0',
      exportedAt: new Date().toISOString(),
      session: {
        id: session.id,
        name: session.name,
        workingDirectory: session.workingDirectory,
        model: session.model,
        createdAt: session.createdAt.toISOString(),
        lastAccessedAt: session.lastAccessedAt.toISOString(),
        metadata: session.metadata,
      },
      messages: session.messages.map(msg => ({
        type: msg.type,
        content: msg.content,
        timestamp: msg.timestamp,
        toolCallName: msg.toolCallName,
        toolCallSuccess: msg.toolCallSuccess,
      })),
      statistics: {
        totalMessages: session.messages.length,
        userMessages: session.messages.filter(m => m.type === 'user').length,
        assistantMessages: session.messages.filter(m => m.type === 'assistant').length,
        toolCalls: session.messages.filter(m => m.type === 'tool_call' || m.type === 'tool_result').length,
        successfulToolCalls: session.messages.filter(m => m.toolCallSuccess === true).length,
        failedToolCalls: session.messages.filter(m => m.toolCallSuccess === false).length,
      },
    };

    return JSON.stringify(exportData, null, 2);
  }

  /**
   * Export session to HTML format with syntax highlighting
   */
  async exportToHtml(sessionId: string): Promise<string | null> {
    const session = await this.loadSession(sessionId);
    if (!session) return null;

    const escapeHtml = (text: string): string => {
      return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    };

    // Highlight code blocks in content
    const highlightCodeBlocks = (content: string): string => {
      // Match code blocks with language specification
      return content.replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) => {
        const language = lang || 'text';
        return `<pre class="code-block" data-language="${language}"><code class="language-${language}">${escapeHtml(code.trim())}</code></pre>`;
      });
    };

    const css = `
      :root {
        --bg-primary: #1a1a2e;
        --bg-secondary: #16213e;
        --bg-tertiary: #0f3460;
        --text-primary: #e4e4e4;
        --text-secondary: #a4a4a4;
        --accent-user: #00d9ff;
        --accent-assistant: #00ff88;
        --accent-tool: #ff9f43;
        --accent-error: #ff6b6b;
        --accent-success: #2ed573;
      }
      * { box-sizing: border-box; }
      body {
        font-family: 'SF Mono', 'Fira Code', Monaco, Consolas, monospace;
        background: var(--bg-primary);
        color: var(--text-primary);
        max-width: 900px;
        margin: 0 auto;
        padding: 20px;
        line-height: 1.6;
      }
      h1, h2, h3 { color: var(--accent-assistant); }
      .metadata {
        background: var(--bg-secondary);
        border-radius: 8px;
        padding: 16px;
        margin-bottom: 24px;
        border-left: 4px solid var(--accent-assistant);
      }
      .metadata p { margin: 8px 0; }
      .metadata strong { color: var(--accent-user); }
      .message {
        background: var(--bg-secondary);
        border-radius: 8px;
        padding: 16px;
        margin-bottom: 16px;
        position: relative;
      }
      .message.user { border-left: 4px solid var(--accent-user); }
      .message.assistant { border-left: 4px solid var(--accent-assistant); }
      .message.tool_call, .message.tool_result { border-left: 4px solid var(--accent-tool); }
      .message.tool_result.success { border-left-color: var(--accent-success); }
      .message.tool_result.failure { border-left-color: var(--accent-error); }
      .role-badge {
        display: inline-block;
        padding: 4px 12px;
        border-radius: 12px;
        font-size: 0.85em;
        font-weight: bold;
        margin-bottom: 8px;
      }
      .role-badge.user { background: var(--accent-user); color: var(--bg-primary); }
      .role-badge.assistant { background: var(--accent-assistant); color: var(--bg-primary); }
      .role-badge.tool { background: var(--accent-tool); color: var(--bg-primary); }
      .timestamp {
        position: absolute;
        top: 12px;
        right: 16px;
        font-size: 0.75em;
        color: var(--text-secondary);
      }
      .content {
        white-space: pre-wrap;
        word-wrap: break-word;
        margin-top: 8px;
      }
      .code-block {
        background: var(--bg-tertiary);
        border-radius: 6px;
        padding: 12px;
        overflow-x: auto;
        margin: 12px 0;
        position: relative;
      }
      .code-block::before {
        content: attr(data-language);
        position: absolute;
        top: 4px;
        right: 8px;
        font-size: 0.7em;
        color: var(--text-secondary);
        text-transform: uppercase;
      }
      .code-block code {
        font-family: inherit;
        font-size: 0.9em;
      }
      .statistics {
        background: var(--bg-tertiary);
        border-radius: 8px;
        padding: 16px;
        margin-top: 32px;
      }
      .statistics h3 { margin-top: 0; }
      .stat-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: 12px;
      }
      .stat-item {
        background: var(--bg-secondary);
        padding: 12px;
        border-radius: 6px;
        text-align: center;
      }
      .stat-value {
        font-size: 1.5em;
        font-weight: bold;
        color: var(--accent-user);
      }
      .stat-label { font-size: 0.85em; color: var(--text-secondary); }
      footer {
        text-align: center;
        margin-top: 32px;
        color: var(--text-secondary);
        font-size: 0.85em;
      }
    `;

    const lines: string[] = [];
    lines.push('<!DOCTYPE html>');
    lines.push('<html lang="en">');
    lines.push('<head>');
    lines.push('  <meta charset="UTF-8">');
    lines.push('  <meta name="viewport" content="width=device-width, initial-scale=1.0">');
    lines.push(`  <title>${escapeHtml(session.name)} - Code Buddy Session</title>`);
    lines.push(`  <style>${css}</style>`);
    lines.push('</head>');
    lines.push('<body>');

    // Header
    lines.push(`  <h1>${escapeHtml(session.name)}</h1>`);

    // Metadata
    lines.push('  <div class="metadata">');
    lines.push(`    <p><strong>Session ID:</strong> ${escapeHtml(session.id)}</p>`);
    lines.push(`    <p><strong>Created:</strong> ${session.createdAt.toLocaleString()}</p>`);
    lines.push(`    <p><strong>Last Accessed:</strong> ${session.lastAccessedAt.toLocaleString()}</p>`);
    lines.push(`    <p><strong>Working Directory:</strong> ${escapeHtml(session.workingDirectory)}</p>`);
    lines.push(`    <p><strong>Model:</strong> ${escapeHtml(session.model)}</p>`);
    lines.push('  </div>');

    // Messages
    lines.push('  <h2>Conversation</h2>');
    for (const message of session.messages) {
      const successClass = message.toolCallSuccess === true ? ' success' : message.toolCallSuccess === false ? ' failure' : '';
      lines.push(`  <div class="message ${message.type}${successClass}">`);

      // Timestamp
      const time = new Date(message.timestamp).toLocaleTimeString();
      lines.push(`    <span class="timestamp">${time}</span>`);

      // Role badge
      let roleText = message.type.charAt(0).toUpperCase() + message.type.slice(1).replace('_', ' ');
      let roleClass = message.type === 'tool_call' || message.type === 'tool_result' ? 'tool' : message.type;
      if (message.toolCallName) {
        roleText = `Tool: ${message.toolCallName}`;
      }
      lines.push(`    <span class="role-badge ${roleClass}">${roleText}</span>`);

      // Content with highlighted code blocks
      const processedContent = highlightCodeBlocks(escapeHtml(message.content));
      lines.push(`    <div class="content">${processedContent}</div>`);

      lines.push('  </div>');
    }

    // Statistics
    const stats = {
      total: session.messages.length,
      user: session.messages.filter(m => m.type === 'user').length,
      assistant: session.messages.filter(m => m.type === 'assistant').length,
      toolSuccess: session.messages.filter(m => m.toolCallSuccess === true).length,
      toolFail: session.messages.filter(m => m.toolCallSuccess === false).length,
    };

    lines.push('  <div class="statistics">');
    lines.push('    <h3>Session Statistics</h3>');
    lines.push('    <div class="stat-grid">');
    lines.push(`      <div class="stat-item"><div class="stat-value">${stats.total}</div><div class="stat-label">Total Messages</div></div>`);
    lines.push(`      <div class="stat-item"><div class="stat-value">${stats.user}</div><div class="stat-label">User Messages</div></div>`);
    lines.push(`      <div class="stat-item"><div class="stat-value">${stats.assistant}</div><div class="stat-label">Assistant Responses</div></div>`);
    lines.push(`      <div class="stat-item"><div class="stat-value">${stats.toolSuccess}</div><div class="stat-label">Successful Tools</div></div>`);
    lines.push(`      <div class="stat-item"><div class="stat-value">${stats.toolFail}</div><div class="stat-label">Failed Tools</div></div>`);
    lines.push('    </div>');
    lines.push('  </div>');

    // Footer
    lines.push('  <footer>');
    lines.push(`    <p>Exported from Code Buddy on ${new Date().toLocaleString()}</p>`);
    lines.push('  </footer>');
    lines.push('</body>');
    lines.push('</html>');

    return lines.join('\n');
  }

  /**
   * Export session to file with specified format
   */
  async exportSessionToFileWithFormat(
    sessionId: string,
    format: 'markdown' | 'json' | 'html',
    outputPath?: string
  ): Promise<string | null> {
    let content: string | null;
    let extension: string;

    switch (format) {
      case 'json':
        content = await this.exportToJson(sessionId);
        extension = 'json';
        break;
      case 'html':
        content = await this.exportToHtml(sessionId);
        extension = 'html';
        break;
      case 'markdown':
      default:
        content = await this.exportToMarkdown(sessionId);
        extension = 'md';
        break;
    }

    if (!content) return null;

    const session = await this.loadSession(sessionId);
    if (!session) return null;

    const fileName = outputPath || `codebuddy-session-${session.id.slice(0, 8)}.${extension}`;
    const fullPath = path.resolve(process.cwd(), fileName);

    await fsPromises.writeFile(fullPath, content);
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

  // =========================================================================
  // Task State Persistence (Phase 4 - Cross-session continuity)
  // =========================================================================

  /**
   * Save task state for cross-session continuity
   */
  async saveTaskState(taskState: Record<string, unknown>): Promise<void> {
    const session = await this.getCurrentSession();
    if (!session) return;

    const stateMessage: SessionMessage = {
      type: 'plan_progress',
      content: 'Task state checkpoint',
      timestamp: new Date().toISOString(),
      taskState,
    };

    session.messages.push(stateMessage);
    await this.saveSession(session);
  }

  /**
   * Load the most recent task state from the current session
   */
  async loadTaskState(): Promise<Record<string, unknown> | null> {
    const session = await this.getCurrentSession();
    if (!session) return null;

    // Find last message with taskState, scanning from end
    for (let i = session.messages.length - 1; i >= 0; i--) {
      if (session.messages[i].taskState) {
        return session.messages[i].taskState!;
      }
    }
    return null;
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
  formatSessionList(): string {
    const sessions = this.getRecentSessionsSync(10);

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
   * Synchronous recent session listing for legacy call sites that expect
   * immediate string output.
   */
  private getRecentSessionsSync(count: number): Session[] {
    return this.readSessionsFromDiskSync().slice(0, count);
  }

  /**
   * Synchronous session loading from disk.
   */
  private readSessionsFromDiskSync(): Session[] {
    const sessionsDir = this.sessionsDir;

    try {
      if (!_fs.existsSync(sessionsDir)) {
        _fs.mkdirSync(sessionsDir, { recursive: true });
        return [];
      }

      const fileNames = _fs.readdirSync(sessionsDir);
      const sessions: Session[] = [];

      for (const fileName of fileNames) {
        if (!fileName.endsWith('.json')) {
          continue;
        }

        const filePath = path.join(sessionsDir, fileName);

        try {
          const raw = _fs.readFileSync(filePath, 'utf-8');
          const data = JSON.parse(raw);
          sessions.push({
            ...data,
            createdAt: new Date(data.createdAt),
            lastAccessedAt: new Date(data.lastAccessedAt),
          });
        } catch {
          // Skip malformed or inaccessible session files
        }
      }

      return sessions.sort((a, b) => b.lastAccessedAt.getTime() - a.lastAccessedAt.getTime());
    } catch {
      return [];
    }
  }

  /**
   * Get session file path
   */
  private getSessionFilePath(sessionId: string): string {
    return path.join(this.sessionsDir, `${sessionId}.json`);
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
