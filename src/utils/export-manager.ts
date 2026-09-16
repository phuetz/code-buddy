/**
 * Export Manager
 *
 * Multi-format export utility for conversations, sessions, code, and data.
 * Supports JSON, Markdown, HTML, and plain text formats with customizable templates.
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { EventEmitter } from 'events';
import { getDataRedactionEngine } from '../security/data-redaction.js';
import { getSessionRepository } from '../database/repositories/session-repository.js';
import type { Session, Message } from '../database/schema.js';

// ============================================================================
// Types
// ============================================================================

export type ExportFormat = 'json' | 'markdown' | 'html' | 'text' | 'csv';

export interface ExportOptions {
  /** Output format */
  format: ExportFormat;
  /** Include metadata (timestamps, tokens, cost) */
  includeMetadata?: boolean;
  /** Include tool calls */
  includeToolCalls?: boolean;
  /** Include tool results */
  includeToolResults?: boolean;
  /** Include thinking/reasoning */
  includeThinking?: boolean;
  /** Include timestamps */
  includeTimestamps?: boolean;
  /** Redact sensitive data */
  redactSecrets?: boolean;
  /** Pretty print JSON */
  prettyPrint?: boolean;
  /** Max content length per message (0 for unlimited) */
  maxContentLength?: number;
  /** Max tool result length */
  maxToolResultLength?: number;
  /** Custom title */
  title?: string;
  /** Custom CSS for HTML export */
  customCss?: string;
  /** Custom template path */
  templatePath?: string;
  /** Include checkpoints */
  includeCheckpoints?: boolean;
  /** Syntax highlighting for code blocks */
  syntaxHighlight?: boolean;
}

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp?: Date;
  tokens?: number;
  toolName?: string;
  toolCallId?: string;
  thinking?: string;
}

export interface ConversationExport {
  title?: string;
  model?: string;
  startTime?: Date;
  endTime?: Date;
  totalCost?: number;
  totalTokens?: number;
  messages: ConversationMessage[];
  metadata?: Record<string, unknown>;
}

export interface CodeExport {
  path: string;
  language?: string;
  content: string;
  lineStart?: number;
  lineEnd?: number;
}

export interface TableExport {
  headers: string[];
  rows: (string | number | boolean | null)[][];
  title?: string;
}

// ============================================================================
// Default Options
// ============================================================================

const DEFAULT_OPTIONS: ExportOptions = {
  format: 'markdown',
  includeMetadata: true,
  includeToolCalls: true,
  includeToolResults: true,
  includeThinking: false,
  includeTimestamps: true,
  redactSecrets: true,
  prettyPrint: true,
  maxContentLength: 0,
  maxToolResultLength: 2000,
  title: 'Conversation Export',
  includeCheckpoints: false,
  syntaxHighlight: true,
};

// ============================================================================
// Format Helpers
// ============================================================================

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}


function escapeCsv(text: string): string {
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function formatDate(date: Date | undefined): string {
  if (!date) return '';
  return date.toISOString().replace('T', ' ').split('.')[0] ?? '';
}

function truncate(text: string, maxLength: number): string {
  if (maxLength === 0 || text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

// ============================================================================
// JSON Export
// ============================================================================

function exportToJson(data: ConversationExport, options: ExportOptions): string {
  const exportData = {
    ...data,
    messages: data.messages.map((msg) => ({
      ...msg,
      content: truncate(msg.content, options.maxContentLength || 0),
      thinking: options.includeThinking ? msg.thinking : undefined,
    })),
    exportedAt: new Date().toISOString(),
    format: 'code-buddy-export',
    version: '1.0',
  };

  // Remove tool messages if not included
  if (!options.includeToolCalls) {
    exportData.messages = exportData.messages.filter((m) => m.role !== 'tool');
  }

  return options.prettyPrint ? JSON.stringify(exportData, null, 2) : JSON.stringify(exportData);
}

// ============================================================================
// Markdown Export
// ============================================================================

function exportToMarkdown(data: ConversationExport, options: ExportOptions): string {
  const lines: string[] = [];

  // Title
  lines.push(`# ${options.title || data.title || 'Conversation Export'}`);
  lines.push('');

  // Metadata
  if (options.includeMetadata) {
    lines.push('## Metadata');
    lines.push('');
    if (data.model) lines.push(`- **Model**: ${data.model}`);
    if (data.startTime) lines.push(`- **Started**: ${formatDate(data.startTime)}`);
    if (data.endTime) lines.push(`- **Ended**: ${formatDate(data.endTime)}`);
    if (data.totalTokens) lines.push(`- **Total Tokens**: ${data.totalTokens.toLocaleString()}`);
    if (data.totalCost) lines.push(`- **Total Cost**: $${data.totalCost.toFixed(4)}`);
    lines.push('');
  }

  // Messages
  lines.push('## Conversation');
  lines.push('');

  for (const msg of data.messages) {
    // Skip tool messages if not included
    if (msg.role === 'tool' && !options.includeToolCalls) continue;

    // Role header
    const roleEmoji = {
      user: '👤',
      assistant: '🤖',
      system: '⚙️',
      tool: '🔧',
    }[msg.role];

    const roleName = msg.role === 'tool' ? `Tool: ${msg.toolName}` : msg.role.charAt(0).toUpperCase() + msg.role.slice(1);

    lines.push(`### ${roleEmoji} ${roleName}`);

    // Timestamp
    if (options.includeMetadata && msg.timestamp) {
      lines.push(`*${formatDate(msg.timestamp)}*`);
    }

    lines.push('');

    // Thinking
    if (options.includeThinking && msg.thinking) {
      lines.push('<details>');
      lines.push('<summary>💭 Thinking</summary>');
      lines.push('');
      lines.push('```');
      lines.push(truncate(msg.thinking, options.maxContentLength || 0));
      lines.push('```');
      lines.push('');
      lines.push('</details>');
      lines.push('');
    }

    // Content
    const content = truncate(msg.content, options.maxContentLength || 0);
    lines.push(content);
    lines.push('');

    // Token count
    if (options.includeMetadata && msg.tokens) {
      lines.push(`*${msg.tokens.toLocaleString()} tokens*`);
      lines.push('');
    }

    lines.push('---');
    lines.push('');
  }

  // Footer
  lines.push('');
  lines.push(`*Exported from Code Buddy on ${formatDate(new Date())}*`);

  return lines.join('\n');
}

// ============================================================================
// HTML Export
// ============================================================================

const DEFAULT_CSS = `
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
    max-width: 800px;
    margin: 0 auto;
    padding: 20px;
    background: #f5f5f5;
    color: #333;
  }
  .message {
    background: white;
    border-radius: 8px;
    padding: 16px;
    margin-bottom: 16px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.1);
  }
  .message.user { border-left: 4px solid #007bff; }
  .message.assistant { border-left: 4px solid #28a745; }
  .message.system { border-left: 4px solid #6c757d; }
  .message.tool { border-left: 4px solid #ffc107; }
  .role { font-weight: bold; margin-bottom: 8px; }
  .timestamp { color: #6c757d; font-size: 0.85em; }
  .content { white-space: pre-wrap; word-wrap: break-word; }
  .thinking { background: #f8f9fa; padding: 12px; border-radius: 4px; margin-top: 8px; }
  .metadata { background: #e9ecef; padding: 16px; border-radius: 8px; margin-bottom: 24px; }
  pre { background: #272822; color: #f8f8f2; padding: 12px; border-radius: 4px; overflow-x: auto; }
  code { background: #e9ecef; padding: 2px 6px; border-radius: 3px; }
`;

function exportToHtml(data: ConversationExport, options: ExportOptions): string {
  const title = options.title || data.title || 'Conversation Export';
  const css = options.customCss || DEFAULT_CSS;

  const lines: string[] = [];

  lines.push('<!DOCTYPE html>');
  lines.push('<html lang="en">');
  lines.push('<head>');
  lines.push('  <meta charset="UTF-8">');
  lines.push('  <meta name="viewport" content="width=device-width, initial-scale=1.0">');
  lines.push(`  <title>${escapeHtml(title)}</title>`);
  lines.push(`  <style>${css}</style>`);
  lines.push('</head>');
  lines.push('<body>');

  // Title
  lines.push(`  <h1>${escapeHtml(title)}</h1>`);

  // Metadata
  if (options.includeMetadata) {
    lines.push('  <div class="metadata">');
    if (data.model) lines.push(`    <p><strong>Model:</strong> ${escapeHtml(data.model)}</p>`);
    if (data.startTime) lines.push(`    <p><strong>Started:</strong> ${formatDate(data.startTime)}</p>`);
    if (data.endTime) lines.push(`    <p><strong>Ended:</strong> ${formatDate(data.endTime)}</p>`);
    if (data.totalTokens) lines.push(`    <p><strong>Total Tokens:</strong> ${data.totalTokens.toLocaleString()}</p>`);
    if (data.totalCost) lines.push(`    <p><strong>Total Cost:</strong> $${data.totalCost.toFixed(4)}</p>`);
    lines.push('  </div>');
  }

  // Messages
  for (const msg of data.messages) {
    if (msg.role === 'tool' && !options.includeToolCalls) continue;

    const roleEmoji = { user: '👤', assistant: '🤖', system: '⚙️', tool: '🔧' }[msg.role];
    const roleName = msg.role === 'tool' ? `Tool: ${msg.toolName}` : msg.role.charAt(0).toUpperCase() + msg.role.slice(1);

    lines.push(`  <div class="message ${msg.role}">`);
    lines.push(`    <div class="role">${roleEmoji} ${escapeHtml(roleName)}</div>`);

    if (options.includeMetadata && msg.timestamp) {
      lines.push(`    <div class="timestamp">${formatDate(msg.timestamp)}</div>`);
    }

    const content = truncate(msg.content, options.maxContentLength || 0);
    lines.push(`    <div class="content">${escapeHtml(content)}</div>`);

    if (options.includeThinking && msg.thinking) {
      lines.push('    <details class="thinking">');
      lines.push('      <summary>💭 Thinking</summary>');
      lines.push(`      <pre>${escapeHtml(truncate(msg.thinking, options.maxContentLength || 0))}</pre>`);
      lines.push('    </details>');
    }

    if (options.includeMetadata && msg.tokens) {
      lines.push(`    <div class="timestamp">${msg.tokens.toLocaleString()} tokens</div>`);
    }

    lines.push('  </div>');
  }

  // Footer
  lines.push(`  <footer><p><em>Exported from Code Buddy on ${formatDate(new Date())}</em></p></footer>`);
  lines.push('</body>');
  lines.push('</html>');

  return lines.join('\n');
}

// ============================================================================
// Plain Text Export
// ============================================================================

function exportToText(data: ConversationExport, options: ExportOptions): string {
  const lines: string[] = [];
  const separator = '='.repeat(60);
  const subseparator = '-'.repeat(40);

  // Title
  lines.push(separator);
  lines.push(options.title || data.title || 'Conversation Export');
  lines.push(separator);
  lines.push('');

  // Metadata
  if (options.includeMetadata) {
    if (data.model) lines.push(`Model: ${data.model}`);
    if (data.startTime) lines.push(`Started: ${formatDate(data.startTime)}`);
    if (data.endTime) lines.push(`Ended: ${formatDate(data.endTime)}`);
    if (data.totalTokens) lines.push(`Total Tokens: ${data.totalTokens.toLocaleString()}`);
    if (data.totalCost) lines.push(`Total Cost: $${data.totalCost.toFixed(4)}`);
    lines.push('');
    lines.push(separator);
    lines.push('');
  }

  // Messages
  for (const msg of data.messages) {
    if (msg.role === 'tool' && !options.includeToolCalls) continue;

    const roleName = msg.role === 'tool' ? `[TOOL: ${msg.toolName}]` : `[${msg.role.toUpperCase()}]`;

    lines.push(roleName);

    if (options.includeMetadata && msg.timestamp) {
      lines.push(`Time: ${formatDate(msg.timestamp)}`);
    }

    lines.push('');
    lines.push(truncate(msg.content, options.maxContentLength || 0));
    lines.push('');

    if (options.includeThinking && msg.thinking) {
      lines.push('[THINKING]');
      lines.push(truncate(msg.thinking, options.maxContentLength || 0));
      lines.push('[/THINKING]');
      lines.push('');
    }

    lines.push(subseparator);
    lines.push('');
  }

  // Footer
  lines.push('');
  lines.push(`Exported from Code Buddy on ${formatDate(new Date())}`);

  return lines.join('\n');
}

// ============================================================================
// CSV Export
// ============================================================================

function exportToCsv(data: ConversationExport, options: ExportOptions): string {
  const lines: string[] = [];

  // Header
  const headers = ['Role', 'Content'];
  if (options.includeMetadata) {
    headers.push('Timestamp', 'Tokens');
  }
  if (options.includeToolCalls) {
    headers.push('Tool Name');
  }
  lines.push(headers.join(','));

  // Rows
  for (const msg of data.messages) {
    if (msg.role === 'tool' && !options.includeToolCalls) continue;

    const row: string[] = [
      escapeCsv(msg.role),
      escapeCsv(truncate(msg.content, options.maxContentLength || 0)),
    ];

    if (options.includeMetadata) {
      row.push(escapeCsv(formatDate(msg.timestamp)));
      row.push(String(msg.tokens || ''));
    }

    if (options.includeToolCalls) {
      row.push(escapeCsv(msg.toolName || ''));
    }

    lines.push(row.join(','));
  }

  return lines.join('\n');
}

// ============================================================================
// Main Export Function
// ============================================================================

export function exportConversation(data: ConversationExport, options: Partial<ExportOptions> = {}): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  switch (opts.format) {
    case 'json':
      return exportToJson(data, opts);
    case 'markdown':
      return exportToMarkdown(data, opts);
    case 'html':
      return exportToHtml(data, opts);
    case 'text':
      return exportToText(data, opts);
    case 'csv':
      return exportToCsv(data, opts);
    default:
      throw new Error(`Unknown export format: ${opts.format}`);
  }
}

// ============================================================================
// File Export
// ============================================================================

export async function exportToFile(
  data: ConversationExport,
  filePath: string,
  options: Partial<ExportOptions> = {}
): Promise<void> {
  // Auto-detect format from extension if not specified
  if (!options.format) {
    const ext = path.extname(filePath).toLowerCase().slice(1);
    if (['json', 'markdown', 'md', 'html', 'txt', 'text', 'csv'].includes(ext)) {
      options.format = ext === 'md' ? 'markdown' : ext === 'txt' ? 'text' : (ext as ExportFormat);
    }
  }

  const content = exportConversation(data, options);

  // Ensure directory exists
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  // Write file
  await fs.writeFile(filePath, content, 'utf-8');
}

// ============================================================================
// Code Export
// ============================================================================

export function exportCode(code: CodeExport, format: 'markdown' | 'html' | 'text' = 'markdown'): string {
  const lang = code.language || 'text';
  const lineInfo = code.lineStart ? ` (lines ${code.lineStart}-${code.lineEnd || code.lineStart})` : '';

  switch (format) {
    case 'markdown':
      return `## ${code.path}${lineInfo}\n\n\`\`\`${lang}\n${code.content}\n\`\`\``;

    case 'html':
      return `<h2>${escapeHtml(code.path)}${lineInfo}</h2>\n<pre><code class="language-${lang}">${escapeHtml(code.content)}</code></pre>`;

    case 'text':
      return `=== ${code.path}${lineInfo} ===\n\n${code.content}\n`;

    default:
      return code.content;
  }
}

// ============================================================================
// Table Export
// ============================================================================

export function exportTable(table: TableExport, format: 'markdown' | 'html' | 'csv' | 'text' = 'markdown'): string {
  switch (format) {
    case 'markdown': {
      const lines: string[] = [];
      if (table.title) lines.push(`### ${table.title}\n`);

      // Header
      lines.push('| ' + table.headers.join(' | ') + ' |');
      lines.push('| ' + table.headers.map(() => '---').join(' | ') + ' |');

      // Rows
      for (const row of table.rows) {
        lines.push('| ' + row.map((cell) => String(cell ?? '')).join(' | ') + ' |');
      }

      return lines.join('\n');
    }

    case 'html': {
      const lines: string[] = [];
      if (table.title) lines.push(`<h3>${escapeHtml(table.title)}</h3>`);

      lines.push('<table>');
      lines.push('  <thead><tr>');
      for (const header of table.headers) {
        lines.push(`    <th>${escapeHtml(header)}</th>`);
      }
      lines.push('  </tr></thead>');
      lines.push('  <tbody>');
      for (const row of table.rows) {
        lines.push('    <tr>');
        for (const cell of row) {
          lines.push(`      <td>${escapeHtml(String(cell ?? ''))}</td>`);
        }
        lines.push('    </tr>');
      }
      lines.push('  </tbody>');
      lines.push('</table>');

      return lines.join('\n');
    }

    case 'csv': {
      const lines: string[] = [];
      lines.push(table.headers.map(escapeCsv).join(','));
      for (const row of table.rows) {
        lines.push(row.map((cell) => escapeCsv(String(cell ?? ''))).join(','));
      }
      return lines.join('\n');
    }

    case 'text': {
      const lines: string[] = [];
      if (table.title) lines.push(`${table.title}\n${'='.repeat(table.title.length)}\n`);

      // Calculate column widths
      const widths = table.headers.map((h, i) => {
        const cellWidths = table.rows.map((r) => String(r[i] ?? '').length);
        return Math.max(h.length, ...cellWidths);
      });

      // Header
      lines.push(table.headers.map((h, i) => h.padEnd(widths[i] ?? 0)).join(' | '));
      lines.push(widths.map((w) => '-'.repeat(w)).join('-+-'));

      // Rows
      for (const row of table.rows) {
        lines.push(row.map((cell, i) => String(cell ?? '').padEnd(widths[i] ?? 0)).join(' | '));
      }

      return lines.join('\n');
    }

    default:
      return '';
  }
}

// ============================================================================
// Export Manager Class
// ============================================================================

export class ExportManager extends EventEmitter {
  private defaultOptions: ExportOptions;
  private outputDir: string;
  private redactor = getDataRedactionEngine();

  constructor(options: Partial<ExportOptions> = {}, outputDir?: string) {
    super();
    this.defaultOptions = { ...DEFAULT_OPTIONS, ...options };
    this.outputDir = outputDir || path.join(os.homedir(), '.codebuddy', 'exports');
  }

  /**
   * Ensure output directory exists
   */
  private async ensureOutputDir(): Promise<void> {
    try {
      await fs.mkdir(this.outputDir, { recursive: true });
    } catch (error) {
      this.emit('error', error);
    }
  }

  /**
   * Generate filename based on format and timestamp
   */
  private generateFilename(prefix: string, format: ExportFormat): string {
    const timestamp = new Date().toISOString()
      .replace(/[:.]/g, '-')
      .replace('T', '_')
      .slice(0, 19);
    const ext = format === 'json' ? 'json' : format === 'html' ? 'html' : format === 'csv' ? 'csv' : 'md';
    return `${prefix}_${timestamp}.${ext}`;
  }

  /**
   * Export session by ID
   */
  async exportSession(
    sessionId: string,
    format: ExportFormat,
    options: Partial<ExportOptions> = {}
  ): Promise<{ success: boolean; filePath?: string; error?: string }> {
    try {
      const repo = getSessionRepository();
      const session = repo.getSessionWithMessages(sessionId);

      if (!session) {
        return { success: false, error: 'Session not found' };
      }

      const exportData = this.sessionToExportData(session);
      const content = this.formatExport(exportData, format, options);

      const filename = this.generateFilename(`session_${sessionId.slice(0, 8)}`, format);
      const filePath = path.join(this.outputDir, filename);

      await this.ensureOutputDir();
      await fs.writeFile(filePath, content, 'utf-8');

      this.emit('session:exported', { sessionId, filePath, format });

      return { success: true, filePath };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.emit('error', error);
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Export an in-memory conversation (e.g. the live CLI transcript) to a file,
   * with the same redaction and formatting as session exports.
   */
  async exportConversationData(
    data: ConversationExport,
    format: ExportFormat,
    options: Partial<ExportOptions> = {},
    prefix = 'conversation'
  ): Promise<{ success: boolean; filePath?: string; error?: string }> {
    try {
      const content = this.formatExport(data, format, options);
      const filePath = path.join(this.outputDir, this.generateFilename(prefix, format));
      await this.ensureOutputDir();
      await fs.writeFile(filePath, content, 'utf-8');
      this.emit('conversation:exported', { filePath, format });
      return { success: true, filePath };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.emit('error', error);
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Export session to string
   */
  async exportSessionToString(
    sessionId: string,
    format: ExportFormat,
    options: Partial<ExportOptions> = {}
  ): Promise<string> {
    const repo = getSessionRepository();
    const session = repo.getSessionWithMessages(sessionId);

    if (!session) {
      throw new Error('Session not found');
    }

    const exportData = this.sessionToExportData(session);
    return this.formatExport(exportData, format, options);
  }

  /**
   * Export tool results
   */
  async exportToolResults(
    toolName: string,
    results: Array<{ timestamp: Date; success: boolean; duration?: number; output: string }>,
    format: ExportFormat,
    options: Partial<ExportOptions> = {}
  ): Promise<{ success: boolean; filePath?: string; error?: string }> {
    try {
      const exportData: ConversationExport = {
        title: `Tool Results: ${toolName}`,
        messages: results.map(r => ({
          role: 'tool',
          content: r.output,
          timestamp: r.timestamp,
          toolName,
        })),
        metadata: {
          toolName,
          totalResults: results.length,
          successCount: results.filter(r => r.success).length,
          failureCount: results.filter(r => !r.success).length,
        },
      };

      const content = this.formatExport(exportData, format, options);
      const filename = this.generateFilename(`tool_${toolName}`, format);
      const filePath = path.join(this.outputDir, filename);

      await this.ensureOutputDir();
      await fs.writeFile(filePath, content, 'utf-8');

      this.emit('toolresults:exported', { toolName, filePath, format });

      return { success: true, filePath };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.emit('error', error);
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Convert session to export data
   */
  private sessionToExportData(session: Session & { messages: Message[] }): ConversationExport {
    return {
      title: session.name || 'Untitled Session',
      model: session.model,
      startTime: new Date(session.created_at),
      endTime: new Date(session.updated_at),
      totalCost: session.total_cost,
      totalTokens: session.total_tokens_in + session.total_tokens_out,
      messages: session.messages.map(m => this.messageToConversationMessage(m)),
      metadata: {
        sessionId: session.id,
        projectPath: session.project_path,
        messageCount: session.message_count,
        toolCallsCount: session.tool_calls_count,
        tokensIn: session.total_tokens_in,
        tokensOut: session.total_tokens_out,
        ...session.metadata,
      },
    };
  }

  /**
   * Convert database message to conversation message
   */
  private messageToConversationMessage(message: Message): ConversationMessage {
    return {
      role: message.role,
      content: message.content || '',
      timestamp: message.created_at ? new Date(message.created_at) : undefined,
      tokens: message.tokens,
      toolCallId: message.tool_call_id,
    };
  }

  /**
   * Format export data
   */
  private formatExport(
    data: ConversationExport,
    format: ExportFormat,
    options: Partial<ExportOptions> = {}
  ): string {
    const opts = { ...this.defaultOptions, ...options, format };

    // Redact secrets if needed
    if (opts.redactSecrets) {
      data = this.redactData(data);
    }

    return exportConversation(data, opts);
  }

  /**
   * Redact sensitive data
   */
  private redactData(data: ConversationExport): ConversationExport {
    return {
      ...data,
      messages: data.messages.map(m => ({
        ...m,
        content: this.redactor.redact(m.content).redacted,
      })),
    };
  }

  /**
   * List exported files
   */
  async listExports(): Promise<Array<{
    filename: string;
    path: string;
    size: number;
    created: Date;
  }>> {
    await this.ensureOutputDir();
    const files = await fs.readdir(this.outputDir);
    const exports = [];

    for (const file of files) {
      const filePath = path.join(this.outputDir, file);
      const stats = await fs.stat(filePath);
      if (stats.isFile()) {
        exports.push({
          filename: file,
          path: filePath,
          size: stats.size,
          created: stats.birthtime,
        });
      }
    }

    return exports.sort((a, b) => b.created.getTime() - a.created.getTime());
  }

  conversation(data: ConversationExport, options?: Partial<ExportOptions>): string {
    return exportConversation(data, { ...this.defaultOptions, ...options });
  }

  async toFile(data: ConversationExport, filePath: string, options?: Partial<ExportOptions>): Promise<void> {
    return exportToFile(data, filePath, { ...this.defaultOptions, ...options });
  }

  code(code: CodeExport, format?: 'markdown' | 'html' | 'text'): string {
    return exportCode(code, format);
  }

  table(table: TableExport, format?: 'markdown' | 'html' | 'csv' | 'text'): string {
    return exportTable(table, format);
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let instance: ExportManager | null = null;

export function getExportManager(): ExportManager {
  if (!instance) {
    instance = new ExportManager();
  }
  return instance;
}

export function resetExportManager(): void {
  instance?.removeAllListeners();
  instance = null;
}

export default ExportManager;
