/**
 * Session Export & Replay
 *
 * Export conversation sessions in multiple formats:
 * - JSON (full fidelity, for replay)
 * - Markdown (human-readable)
 * - HTML (shareable)
 *
 * Replay sessions for debugging, demos, or continuation.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { EventEmitter } from 'events';
import { getDataRedactionEngine } from '../security/data-redaction.js';

// ============================================================================
// Types
// ============================================================================

export type ExportFormat = 'json' | 'markdown' | 'html';

export interface SessionMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: number;
  toolCalls?: ToolCallRecord[];
  toolResults?: ToolResultRecord[];
  metadata?: Record<string, unknown>;
}

export interface ToolCallRecord {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  timestamp: number;
}

export interface ToolResultRecord {
  toolCallId: string;
  result: string;
  success: boolean;
  duration: number;
}

export interface SessionMetadata {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  projectPath?: string;
  provider?: string;
  model?: string;
  totalTokens: number;
  totalCost: number;
  messageCount: number;
  toolCallCount: number;
  tags: string[];
  summary?: string;
}

export interface ExportedSession {
  version: string;
  exportedAt: number;
  metadata: SessionMetadata;
  messages: SessionMessage[];
  checkpoints?: SessionCheckpoint[];
}

export interface SessionCheckpoint {
  id: string;
  messageIndex: number;
  label: string;
  createdAt: number;
}

export interface ReplayOptions {
  /** Speed multiplier (1 = real-time, 0 = instant) */
  speed: number;
  /** Start from specific message index */
  startFrom: number;
  /** Stop at specific message index */
  stopAt?: number;
  /** Pause at each tool call */
  pauseAtToolCalls: boolean;
  /** Skip tool execution during replay */
  skipTools: boolean;
  /** Callback for each message */
  onMessage?: (message: SessionMessage, index: number) => void | Promise<void>;
  /** Callback for tool calls */
  onToolCall?: (toolCall: ToolCallRecord) => void | Promise<void>;
}

export interface ExportOptions {
  format: ExportFormat;
  /** Redact sensitive data */
  redactSecrets: boolean;
  /** Include tool results */
  includeToolResults: boolean;
  /** Include metadata */
  includeMetadata: boolean;
  /** Include checkpoints */
  includeCheckpoints: boolean;
  /** Custom title for export */
  title?: string;
  /** Add syntax highlighting for code blocks */
  syntaxHighlight: boolean;
}

// ============================================================================
// Session Recorder
// ============================================================================

export class SessionRecorder extends EventEmitter {
  private messages: SessionMessage[] = [];
  private metadata: SessionMetadata;
  private checkpoints: SessionCheckpoint[] = [];
  private isRecording = false;

  constructor(metadata: Partial<SessionMetadata> = {}) {
    super();
    this.metadata = {
      id: metadata.id || this.generateId(),
      name: metadata.name || `Session ${new Date().toISOString()}`,
      createdAt: metadata.createdAt || Date.now(),
      updatedAt: Date.now(),
      projectPath: metadata.projectPath,
      provider: metadata.provider,
      model: metadata.model,
      totalTokens: 0,
      totalCost: 0,
      messageCount: 0,
      toolCallCount: 0,
      tags: metadata.tags || [],
    };
  }

  /**
   * Start recording
   */
  start(): void {
    this.isRecording = true;
    this.emit('recording:started');
  }

  /**
   * Stop recording
   */
  stop(): void {
    this.isRecording = false;
    this.emit('recording:stopped');
  }

  /**
   * Add a message to the session
   */
  addMessage(message: Omit<SessionMessage, 'id' | 'timestamp'>): void {
    if (!this.isRecording) return;

    const fullMessage: SessionMessage = {
      ...message,
      id: this.generateId(),
      timestamp: Date.now(),
    };

    this.messages.push(fullMessage);
    this.metadata.messageCount++;
    this.metadata.updatedAt = Date.now();

    if (message.toolCalls) {
      this.metadata.toolCallCount += message.toolCalls.length;
    }

    this.emit('message:added', fullMessage);
  }

  /**
   * Add user message
   */
  addUserMessage(content: string): void {
    this.addMessage({ role: 'user', content });
  }

  /**
   * Add assistant message
   */
  addAssistantMessage(content: string, toolCalls?: ToolCallRecord[]): void {
    this.addMessage({ role: 'assistant', content, toolCalls });
  }

  /**
   * Add tool result
   */
  addToolResult(toolCallId: string, result: string, success: boolean, duration: number): void {
    const lastMessage = this.messages[this.messages.length - 1];
    if (lastMessage) {
      if (!lastMessage.toolResults) {
        lastMessage.toolResults = [];
      }
      lastMessage.toolResults.push({ toolCallId, result, success, duration });
    }
  }

  /**
   * Update token usage
   */
  updateUsage(tokens: number, cost: number): void {
    this.metadata.totalTokens += tokens;
    this.metadata.totalCost += cost;
    this.metadata.updatedAt = Date.now();
  }

  /**
   * Create a checkpoint
   */
  createCheckpoint(label: string): string {
    const checkpoint: SessionCheckpoint = {
      id: this.generateId(),
      messageIndex: this.messages.length,
      label,
      createdAt: Date.now(),
    };

    this.checkpoints.push(checkpoint);
    this.emit('checkpoint:created', checkpoint);

    return checkpoint.id;
  }

  /**
   * Add tags
   */
  addTags(...tags: string[]): void {
    for (const tag of tags) {
      if (!this.metadata.tags.includes(tag)) {
        this.metadata.tags.push(tag);
      }
    }
  }

  /**
   * Set session summary
   */
  setSummary(summary: string): void {
    this.metadata.summary = summary;
  }

  /**
   * Get current session data
   */
  getSession(): ExportedSession {
    return {
      version: '1.0.0',
      exportedAt: Date.now(),
      metadata: { ...this.metadata },
      messages: [...this.messages],
      checkpoints: [...this.checkpoints],
    };
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  /**
   * Dispose
   */
  dispose(): void {
    this.stop();
    this.messages = [];
    this.checkpoints = [];
    this.removeAllListeners();
  }
}

// ============================================================================
// Session Exporter
// ============================================================================

export class SessionExporter {
  /**
   * Export session to string
   */
  export(session: ExportedSession, options: Partial<ExportOptions> = {}): string {
    const opts: ExportOptions = {
      format: 'json',
      redactSecrets: true,
      includeToolResults: true,
      includeMetadata: true,
      includeCheckpoints: true,
      syntaxHighlight: true,
      ...options,
    };

    // Redact secrets if enabled
    const processedSession = opts.redactSecrets
      ? this.redactSession(session)
      : session;

    switch (opts.format) {
      case 'json':
        return this.exportJSON(processedSession, opts);
      case 'markdown':
        return this.exportMarkdown(processedSession, opts);
      case 'html':
        return this.exportHTML(processedSession, opts);
      default:
        throw new Error(`Unknown export format: ${opts.format}`);
    }
  }

  /**
   * Export to file
   */
  async exportToFile(
    session: ExportedSession,
    filePath: string,
    options: Partial<ExportOptions> = {}
  ): Promise<void> {
    // Infer format from extension
    const ext = path.extname(filePath).toLowerCase();
    const format: ExportFormat = ext === '.md' ? 'markdown'
      : ext === '.html' ? 'html'
      : 'json';

    const content = this.export(session, { ...options, format });
    await fs.writeFile(filePath, content, 'utf-8');
  }

  /**
   * Export as JSON
   */
  private exportJSON(session: ExportedSession, options: ExportOptions): string {
    const output: Partial<ExportedSession> = {
      version: session.version,
      exportedAt: session.exportedAt,
    };

    if (options.includeMetadata) {
      output.metadata = session.metadata;
    }

    output.messages = options.includeToolResults
      ? session.messages
      : session.messages.map(m => {
          const { toolResults, ...rest } = m;
          return rest;
        });

    if (options.includeCheckpoints && session.checkpoints) {
      output.checkpoints = session.checkpoints;
    }

    return JSON.stringify(output, null, 2);
  }

  /**
   * Export as Markdown
   */
  private exportMarkdown(session: ExportedSession, options: ExportOptions): string {
    const lines: string[] = [];

    // Title
    const title = options.title || session.metadata.name || 'Session Export';
    lines.push(`# ${title}`);
    lines.push('');

    // Metadata
    if (options.includeMetadata) {
      lines.push('## Session Info');
      lines.push('');
      lines.push(`- **ID**: ${session.metadata.id}`);
      lines.push(`- **Created**: ${new Date(session.metadata.createdAt).toISOString()}`);
      if (session.metadata.projectPath) {
        lines.push(`- **Project**: ${session.metadata.projectPath}`);
      }
      if (session.metadata.provider) {
        lines.push(`- **Provider**: ${session.metadata.provider}`);
      }
      if (session.metadata.model) {
        lines.push(`- **Model**: ${session.metadata.model}`);
      }
      lines.push(`- **Messages**: ${session.metadata.messageCount}`);
      lines.push(`- **Tool Calls**: ${session.metadata.toolCallCount}`);
      lines.push(`- **Total Tokens**: ${session.metadata.totalTokens.toLocaleString()}`);
      lines.push(`- **Total Cost**: $${session.metadata.totalCost.toFixed(4)}`);
      if (session.metadata.tags.length > 0) {
        lines.push(`- **Tags**: ${session.metadata.tags.join(', ')}`);
      }
      if (session.metadata.summary) {
        lines.push('');
        lines.push('### Summary');
        lines.push(session.metadata.summary);
      }
      lines.push('');
    }

    // Messages
    lines.push('## Conversation');
    lines.push('');

    for (const message of session.messages) {
      const time = new Date(message.timestamp).toLocaleTimeString();

      switch (message.role) {
        case 'user':
          lines.push(`### 👤 User (${time})`);
          break;
        case 'assistant':
          lines.push(`### 🤖 Assistant (${time})`);
          break;
        case 'system':
          lines.push(`### ⚙️ System (${time})`);
          break;
        case 'tool':
          lines.push(`### 🔧 Tool (${time})`);
          break;
      }

      lines.push('');
      lines.push(message.content);
      lines.push('');

      // Tool calls
      if (message.toolCalls && message.toolCalls.length > 0) {
        lines.push('#### Tool Calls');
        lines.push('');
        for (const tc of message.toolCalls) {
          lines.push(`- **${tc.name}**`);
          lines.push('  ```json');
          lines.push('  ' + JSON.stringify(tc.arguments, null, 2).split('\n').join('\n  '));
          lines.push('  ```');
        }
        lines.push('');
      }

      // Tool results
      if (options.includeToolResults && message.toolResults) {
        lines.push('#### Tool Results');
        lines.push('');
        for (const tr of message.toolResults) {
          const status = tr.success ? '✅' : '❌';
          lines.push(`${status} (${tr.duration}ms)`);
          lines.push('```');
          lines.push(tr.result.slice(0, 500) + (tr.result.length > 500 ? '...' : ''));
          lines.push('```');
        }
        lines.push('');
      }

      lines.push('---');
      lines.push('');
    }

    // Checkpoints
    if (options.includeCheckpoints && session.checkpoints && session.checkpoints.length > 0) {
      lines.push('## Checkpoints');
      lines.push('');
      for (const cp of session.checkpoints) {
        lines.push(`- **${cp.label}** at message #${cp.messageIndex + 1} (${new Date(cp.createdAt).toLocaleTimeString()})`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Export as HTML
   */
  private exportHTML(session: ExportedSession, options: ExportOptions): string {
    const title = options.title || session.metadata.name || 'Session Export';

    const messageHTML = session.messages.map(m => {
      const roleClass = m.role;
      const roleIcon = m.role === 'user' ? '👤'
        : m.role === 'assistant' ? '🤖'
        : m.role === 'system' ? '⚙️'
        : '🔧';

      let toolCallsHTML = '';
      if (m.toolCalls && m.toolCalls.length > 0) {
        toolCallsHTML = `
          <div class="tool-calls">
            <h4>Tool Calls</h4>
            ${m.toolCalls.map(tc => `
              <div class="tool-call">
                <strong>${this.escapeHTML(tc.name)}</strong>
                <pre><code>${this.escapeHTML(JSON.stringify(tc.arguments, null, 2))}</code></pre>
              </div>
            `).join('')}
          </div>
        `;
      }

      let toolResultsHTML = '';
      if (options.includeToolResults && m.toolResults && m.toolResults.length > 0) {
        toolResultsHTML = `
          <div class="tool-results">
            <h4>Tool Results</h4>
            ${m.toolResults.map(tr => `
              <div class="tool-result ${tr.success ? 'success' : 'error'}">
                <span class="status">${tr.success ? '✅' : '❌'}</span>
                <span class="duration">${tr.duration}ms</span>
                <pre><code>${this.escapeHTML(tr.result.slice(0, 500))}</code></pre>
              </div>
            `).join('')}
          </div>
        `;
      }

      return `
        <div class="message ${roleClass}">
          <div class="header">
            <span class="icon">${roleIcon}</span>
            <span class="role">${m.role}</span>
            <span class="time">${new Date(m.timestamp).toLocaleTimeString()}</span>
          </div>
          <div class="content">${this.formatContent(m.content)}</div>
          ${toolCallsHTML}
          ${toolResultsHTML}
        </div>
      `;
    }).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.escapeHTML(title)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 900px;
      margin: 0 auto;
      padding: 20px;
      background: #f5f5f5;
      color: #333;
    }
    h1 { color: #1a1a1a; border-bottom: 2px solid #ddd; padding-bottom: 10px; }
    .metadata { background: #fff; padding: 15px; border-radius: 8px; margin-bottom: 20px; }
    .metadata dt { font-weight: bold; margin-top: 10px; }
    .metadata dd { margin-left: 0; color: #666; }
    .message {
      background: #fff;
      padding: 15px;
      margin-bottom: 15px;
      border-radius: 8px;
      border-left: 4px solid #ddd;
    }
    .message.user { border-left-color: #007AFF; }
    .message.assistant { border-left-color: #34C759; }
    .message.system { border-left-color: #FF9500; }
    .message.tool { border-left-color: #AF52DE; }
    .header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 10px;
      font-size: 0.9em;
      color: #666;
    }
    .icon { font-size: 1.2em; }
    .role { font-weight: bold; text-transform: capitalize; }
    .time { margin-left: auto; }
    .content { white-space: pre-wrap; line-height: 1.6; }
    .content code {
      background: #f0f0f0;
      padding: 2px 6px;
      border-radius: 4px;
      font-family: 'SF Mono', Monaco, monospace;
    }
    .content pre {
      background: #1e1e1e;
      color: #d4d4d4;
      padding: 15px;
      border-radius: 8px;
      overflow-x: auto;
    }
    .content pre code { background: none; padding: 0; }
    .tool-calls, .tool-results {
      margin-top: 15px;
      padding-top: 15px;
      border-top: 1px solid #eee;
    }
    .tool-calls h4, .tool-results h4 { margin: 0 0 10px 0; font-size: 0.9em; color: #666; }
    .tool-call, .tool-result { margin-bottom: 10px; }
    .tool-result.success { color: #34C759; }
    .tool-result.error { color: #FF3B30; }
    .duration { color: #999; font-size: 0.85em; }
  </style>
</head>
<body>
  <h1>${this.escapeHTML(title)}</h1>

  ${options.includeMetadata ? `
  <div class="metadata">
    <dl>
      <dt>Session ID</dt><dd>${session.metadata.id}</dd>
      <dt>Created</dt><dd>${new Date(session.metadata.createdAt).toISOString()}</dd>
      ${session.metadata.provider ? `<dt>Provider</dt><dd>${session.metadata.provider}</dd>` : ''}
      ${session.metadata.model ? `<dt>Model</dt><dd>${session.metadata.model}</dd>` : ''}
      <dt>Messages</dt><dd>${session.metadata.messageCount}</dd>
      <dt>Tool Calls</dt><dd>${session.metadata.toolCallCount}</dd>
      <dt>Total Tokens</dt><dd>${session.metadata.totalTokens.toLocaleString()}</dd>
      <dt>Total Cost</dt><dd>$${session.metadata.totalCost.toFixed(4)}</dd>
    </dl>
  </div>
  ` : ''}

  <div class="messages">
    ${messageHTML}
  </div>
</body>
</html>`;
  }

  /**
   * Redact secrets from session
   */
  private redactSession(session: ExportedSession): ExportedSession {
    const redactor = getDataRedactionEngine();

    return {
      ...session,
      messages: session.messages.map(m => ({
        ...m,
        content: redactor.redact(m.content).redacted,
        toolResults: m.toolResults?.map(tr => ({
          ...tr,
          result: redactor.redact(tr.result).redacted,
        })),
      })),
    };
  }

  /**
   * Escape HTML special characters
   */
  private escapeHTML(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Format content with code blocks
   */
  private formatContent(content: string): string {
    // Escape HTML first
    let html = this.escapeHTML(content);

    // Convert code blocks
    html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (_match, lang, code) => {
      return `<pre><code class="language-${lang || 'text'}">${code.trim()}</code></pre>`;
    });

    // Convert inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    return html;
  }
}

// ============================================================================
// Session Replay
// ============================================================================

export class SessionPlayer extends EventEmitter {
  private session: ExportedSession | null = null;
  private currentIndex = 0;
  private isPlaying = false;
  private isPaused = false;

  /**
   * Load session from file
   */
  async loadFromFile(filePath: string): Promise<void> {
    const content = await fs.readFile(filePath, 'utf-8');
    this.session = JSON.parse(content) as ExportedSession;
    this.currentIndex = 0;
    this.emit('loaded', { session: this.session });
  }

  /**
   * Load session directly
   */
  load(session: ExportedSession): void {
    this.session = session;
    this.currentIndex = 0;
    this.emit('loaded', { session: this.session });
  }

  /**
   * Replay the session
   */
  async replay(options: Partial<ReplayOptions> = {}): Promise<void> {
    if (!this.session) {
      throw new Error('No session loaded');
    }

    const opts: ReplayOptions = {
      speed: 1,
      startFrom: 0,
      pauseAtToolCalls: false,
      skipTools: false,
      ...options,
    };

    this.currentIndex = opts.startFrom;
    this.isPlaying = true;
    this.isPaused = false;

    this.emit('replay:started');

    const messages = this.session.messages;
    const stopAt = opts.stopAt ?? messages.length;

    while (this.currentIndex < stopAt && this.isPlaying) {
      if (this.isPaused) {
        await this.waitForResume();
      }

      const message = messages[this.currentIndex];
      const prevMessage = messages[this.currentIndex - 1];

      // Calculate delay based on real time difference
      if (opts.speed > 0 && prevMessage) {
        const delay = (message.timestamp - prevMessage.timestamp) / opts.speed;
        await this.delay(Math.min(delay, 5000)); // Cap at 5 seconds
      }

      // Emit message
      if (opts.onMessage) {
        await opts.onMessage(message, this.currentIndex);
      }
      this.emit('message', { message, index: this.currentIndex });

      // Handle tool calls
      if (message.toolCalls && !opts.skipTools) {
        for (const toolCall of message.toolCalls) {
          if (opts.pauseAtToolCalls) {
            this.isPaused = true;
            this.emit('paused:toolcall', { toolCall });
            await this.waitForResume();
          }

          if (opts.onToolCall) {
            await opts.onToolCall(toolCall);
          }
          this.emit('toolcall', { toolCall });
        }
      }

      this.currentIndex++;
    }

    this.isPlaying = false;
    this.emit('replay:ended');
  }

  /**
   * Pause replay
   */
  pause(): void {
    this.isPaused = true;
    this.emit('paused');
  }

  /**
   * Resume replay
   */
  resume(): void {
    this.isPaused = false;
    this.emit('resumed');
  }

  /**
   * Stop replay
   */
  stop(): void {
    this.isPlaying = false;
    this.isPaused = false;
    this.emit('stopped');
  }

  /**
   * Jump to checkpoint
   */
  jumpToCheckpoint(checkpointId: string): boolean {
    if (!this.session?.checkpoints) return false;

    const checkpoint = this.session.checkpoints.find(cp => cp.id === checkpointId);
    if (!checkpoint) return false;

    this.currentIndex = checkpoint.messageIndex;
    this.emit('jumped', { checkpoint });
    return true;
  }

  /**
   * Jump to message index
   */
  jumpToIndex(index: number): void {
    if (!this.session) return;
    this.currentIndex = Math.max(0, Math.min(index, this.session.messages.length - 1));
    this.emit('jumped', { index: this.currentIndex });
  }

  /**
   * Get current state
   */
  getState(): {
    loaded: boolean;
    playing: boolean;
    paused: boolean;
    currentIndex: number;
    totalMessages: number;
    progress: number;
  } {
    return {
      loaded: this.session !== null,
      playing: this.isPlaying,
      paused: this.isPaused,
      currentIndex: this.currentIndex,
      totalMessages: this.session?.messages.length || 0,
      progress: this.session
        ? (this.currentIndex / this.session.messages.length) * 100
        : 0,
    };
  }

  /**
   * Get messages up to current point
   */
  getMessagesUpToCurrent(): SessionMessage[] {
    if (!this.session) return [];
    return this.session.messages.slice(0, this.currentIndex + 1);
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Wait for resume
   */
  private waitForResume(): Promise<void> {
    return new Promise(resolve => {
      const check = () => {
        if (!this.isPaused || !this.isPlaying) {
          resolve();
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });
  }

  /**
   * Dispose
   */
  dispose(): void {
    this.stop();
    this.session = null;
    this.removeAllListeners();
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Quick export session to file
 */
export async function exportSession(
  session: ExportedSession,
  filePath: string,
  options: Partial<ExportOptions> = {}
): Promise<void> {
  const exporter = new SessionExporter();
  await exporter.exportToFile(session, filePath, options);
}

/**
 * Quick load and replay session
 */
export async function replaySession(
  filePath: string,
  options: Partial<ReplayOptions> = {}
): Promise<void> {
  const player = new SessionPlayer();
  await player.loadFromFile(filePath);
  await player.replay(options);
  player.dispose();
}

// ============================================================================
// Singleton Recorder
// ============================================================================

let globalRecorder: SessionRecorder | null = null;

export function getSessionRecorder(): SessionRecorder {
  if (!globalRecorder) {
    globalRecorder = new SessionRecorder();
    globalRecorder.start();
  }
  return globalRecorder;
}

export function resetSessionRecorder(): void {
  if (globalRecorder) {
    globalRecorder.dispose();
  }
  globalRecorder = null;
}
