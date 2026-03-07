/**
 * IDE Extensions Server
 *
 * Core server for IDE integration that handles connections,
 * requests, and responses from various IDE clients.
 */

import { EventEmitter } from 'events';
import { readFile } from 'fs/promises';
import * as net from 'net';
import type {
  IDEType,
  IDEConnection,
  IDERequest,
  IDEResponse,
  IDEExtensionsConfig,
  CompletionItem,
  CompletionRequest,
} from './types.js';
import { DEFAULT_IDE_CONFIG } from './types.js';
import { generateVSCodeExtension } from './vscode-generator.js';
import { generateNeovimPlugin } from './neovim-generator.js';

type IDEChatMessage = {
  role: 'system' | 'user';
  content: string;
};

type IDEChatClient = {
  chat: (
    messages: IDEChatMessage[],
    tools?: unknown[]
  ) => Promise<{
    choices?: Array<{
      message?: {
        content?: string | null;
      };
    }>;
  }>;
};

type TextRange = {
  start: { line: number; character: number };
  end: { line: number; character: number };
};

export class IDEExtensionsServer extends EventEmitter {
  private config: IDEExtensionsConfig;
  private server: net.Server | null = null;
  private connections: Map<string, IDEConnection> = new Map();
  private handlers: Map<string, (request: IDERequest, connection: IDEConnection) => Promise<unknown>> = new Map();
  private completionCache: Map<string, CompletionItem[]> = new Map();
  private codebuddyClient: IDEChatClient | null = null;
  private running = false;

  constructor(config: Partial<IDEExtensionsConfig> = {}) {
    super();
    this.config = { ...DEFAULT_IDE_CONFIG, ...config };
    this.registerDefaultHandlers();
  }

  /**
   * Start the server
   */
  async start(): Promise<void> {
    if (this.running) return;

    await new Promise<void>((resolve, reject) => {
      this.server = net.createServer((socket) => this.handleConnection(socket));

      this.server.on('error', (err) => {
        this.emit('error', err);
        reject(err);
      });

      this.server.listen(this.config.port, this.config.host, () => {
        this.running = true;
        this.emit('started', { port: this.config.port, host: this.config.host });
        resolve();
      });
    });
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    if (!this.running || !this.server) return;

    // Close all connections
    for (const [id, conn] of this.connections) {
      if (conn.socket) {
        conn.socket.destroy();
      }
      this.connections.delete(id);
    }

    // Close server
    await new Promise<void>((resolve) => {
      this.server!.close(() => {
        this.running = false;
        this.emit('stopped');
        resolve();
      });
    });

    this.server = null;
  }

  /**
   * Check if server is running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get connected clients
   */
  getConnections(): IDEConnection[] {
    return Array.from(this.connections.values());
  }

  /**
   * Send notification to all connected clients
   */
  broadcast(method: string, params: unknown): void {
    const message = JSON.stringify({ method, params });

    for (const conn of this.connections.values()) {
      if (conn.socket && conn.connected) {
        conn.socket.write(message + '\n');
      }
    }
  }

  /**
   * Send notification to specific client
   */
  notify(connectionId: string, method: string, params: unknown): void {
    const conn = this.connections.get(connectionId);
    if (conn?.socket && conn.connected) {
      const message = JSON.stringify({ method, params });
      conn.socket.write(message + '\n');
    }
  }

  /**
   * Register request handler
   */
  registerHandler(method: string, handler: (request: IDERequest, connection: IDEConnection) => Promise<unknown>): void {
    this.handlers.set(method, handler);
  }

  /**
   * Generate VS Code extension manifest
   */
  generateVSCodeExtension(): { packageJson: string; extensionTs: string } {
    return generateVSCodeExtension(this.config);
  }

  /**
   * Generate Neovim plugin
   */
  generateNeovimPlugin(): string {
    return generateNeovimPlugin(this.config);
  }

  /**
   * Format server status
   */
  formatStatus(): string {
    const connections = this.getConnections();
    const lines: string[] = [
      '🔌 IDE Extensions Server',
      '═'.repeat(40),
      '',
      `Status: ${this.running ? '✅ Running' : '❌ Stopped'}`,
      `Port: ${this.config.port}`,
      `Host: ${this.config.host}`,
      '',
      `Connected Clients: ${connections.length}`,
    ];

    if (connections.length > 0) {
      lines.push('');
      for (const conn of connections) {
        const idle = Math.round((Date.now() - conn.lastActivity) / 1000);
        lines.push(`  • ${conn.name} (${conn.type}) - idle ${idle}s`);
      }
    }

    lines.push('', 'Supported IDEs:');
    lines.push(`  • VS Code: ${this.config.vscodeEnabled ? '✓' : '✗'}`);
    lines.push(`  • JetBrains: ${this.config.jetbrainsEnabled ? '✓' : '✗'}`);
    lines.push(`  • Neovim: ${this.config.neovimEnabled ? '✓' : '✗'}`);
    lines.push(`  • Sublime: ${this.config.sublimeEnabled ? '✓' : '✗'}`);

    return lines.join('\n');
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private handleConnection(socket: net.Socket): void {
    const connectionId = `conn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const connection: IDEConnection = {
      id: connectionId,
      type: 'unknown',
      name: 'Unknown IDE',
      socket,
      connected: true,
      lastActivity: Date.now(),
    };

    this.connections.set(connectionId, connection);
    this.emit('connection', connection);

    let buffer = '';

    socket.on('data', async (data) => {
      connection.lastActivity = Date.now();
      buffer += data.toString();

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const request = JSON.parse(line) as IDERequest;
          const response = await this.handleRequest(request, connection);

          if (response && socket.writable) {
            socket.write(JSON.stringify(response) + '\n');
          }
        } catch (error) {
          const errorResponse: IDEResponse = {
            id: 'error',
            error: {
              code: -32700,
              message: 'Parse error',
              data: error instanceof Error ? error.message : String(error),
            },
          };

          if (socket.writable) {
            socket.write(JSON.stringify(errorResponse) + '\n');
          }
        }
      }
    });

    socket.on('close', () => {
      connection.connected = false;
      this.connections.delete(connectionId);
      this.emit('disconnection', connection);
    });

    socket.on('error', (err) => {
      this.emit('client-error', { connection, error: err });
    });
  }

  private async handleRequest(request: IDERequest, connection: IDEConnection): Promise<IDEResponse | null> {
    const handler = this.handlers.get(request.method);

    if (!handler) {
      return {
        id: request.id,
        error: {
          code: -32601,
          message: `Method not found: ${request.method}`,
        },
      };
    }

    try {
      const result = await handler(request, connection);
      return {
        id: request.id,
        result,
      };
    } catch (error) {
      return {
        id: request.id,
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  private registerDefaultHandlers(): void {
    // Initialize handler
    this.registerHandler('initialize', async (request, connection) => {
      const params = request.params;

      connection.type = this.detectIDEType(params.ide as string);
      connection.name = (params.ide as string) || 'Unknown';
      connection.version = params.version as string | undefined;

      return {
        capabilities: {
          completion: true,
          hover: false,
          codeAction: false,
          diagnostics: false,
        },
        serverVersion: '1.0.0',
      };
    });

    this.registerHandler('completion', async (request) => {
      const params = request.params as Partial<CompletionRequest>;
      const context = await this.buildCompletionContext(params);
      const cacheKey = `${params.file || 'unknown'}:${params.line ?? 0}:${params.column ?? 0}:${context.prefix.slice(-80)}`;

      if (this.completionCache.has(cacheKey)) {
        return {
          items: this.completionCache.get(cacheKey) ?? [],
        };
      }

      const aiItems = await this.generateAICompletions(params, context);
      const items = aiItems.length > 0 ? aiItems : this.generateLexicalCompletions(context.prefix, context.suffix);

      this.completionCache.set(cacheKey, items);
      const cacheTimer = setTimeout(() => this.completionCache.delete(cacheKey), 30000);
      cacheTimer.unref?.();

      return {
        items,
      };
    });

    // Ask handler
    this.registerHandler('ask', async (request) => {
      this.emit('request:ask', request.params);
      const question = this.requireStringField(request.params, 'question', 'ask');
      const answer = await this.runPrompt([
        {
          role: 'system',
          content: 'You are Code Buddy inside an IDE. Answer concisely and focus on actionable engineering guidance.',
        },
        {
          role: 'user',
          content: question,
        },
      ]);

      return {
        answer,
      };
    });

    // Explain handler
    this.registerHandler('explain', async (request) => {
      this.emit('request:explain', request.params);
      const code = this.requireStringField(request.params, 'code', 'explain');
      const language = this.optionalStringField(request.params, 'language') || 'code';
      const explanation = await this.runPrompt([
        {
          role: 'system',
          content: 'You explain code clearly for developers. Keep the answer concise and practical.',
        },
        {
          role: 'user',
          content: `Explain this ${language} code:\n\`\`\`${language}\n${code}\n\`\`\``,
        },
      ]);

      return {
        explanation,
      };
    });

    // Refactor handler
    this.registerHandler('refactor', async (request) => {
      this.emit('request:refactor', request.params);
      const code = this.requireStringField(request.params, 'code', 'refactor');
      const instruction = this.requireStringField(request.params, 'instruction', 'refactor');
      const language = this.optionalStringField(request.params, 'language') || 'code';
      const refactored = await this.runPrompt([
        {
          role: 'system',
          content: 'You refactor code. Return only the updated code with no markdown fences or explanation.',
        },
        {
          role: 'user',
          content: `Refactor this ${language} code.\nInstruction: ${instruction}\n\nCode:\n\`\`\`${language}\n${code}\n\`\`\``,
        },
      ]);

      return {
        refactored: this.extractCodeBlock(refactored),
      };
    });

    // Suggest fix handler
    this.registerHandler('suggestFix', async (request) => {
      this.emit('request:fix', request.params);
      const diagnostics = Array.isArray(request.params.diagnostics) ? request.params.diagnostics : [];
      const context = this.requireStringField(request.params, 'context', 'suggestFix');
      const file = this.optionalStringField(request.params, 'file') || 'current file';
      const fallbackRange = this.extractFallbackRange(diagnostics);
      const fixResponse = await this.runPrompt([
        {
          role: 'system',
          content: 'You suggest minimal code fixes. Return strict JSON: {"fix":"<replacement code>","range":{"start":{"line":0,"character":0},"end":{"line":0,"character":0}},"message":"<short explanation>"}',
        },
        {
          role: 'user',
          content: `File: ${file}
Diagnostics:
${JSON.stringify(diagnostics, null, 2)}

Context:
\`\`\`
${context.slice(0, 12000)}
\`\`\`

Return a focused replacement for the problematic range only.`,
        },
      ]);

      const parsed = this.parseJsonObject(fixResponse);
      const fix = typeof parsed?.fix === 'string' ? parsed.fix : this.extractCodeBlock(fixResponse);
      const range = this.isTextRange(parsed?.range) ? parsed.range : fallbackRange;
      const message = typeof parsed?.message === 'string' ? parsed.message : 'Suggested fix generated by Code Buddy';

      return {
        fix,
        range,
        message,
      };
    });
  }

  private requireStringField(params: Record<string, unknown>, field: string, method: string): string {
    const value = params[field];
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`${method}: '${field}' is required and must be a non-empty string`);
    }
    return value;
  }

  private optionalStringField(params: Record<string, unknown>, field: string): string | undefined {
    const value = params[field];
    return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
  }

  private async getCodeBuddyClient(): Promise<IDEChatClient | null> {
    if (this.codebuddyClient) {
      return this.codebuddyClient;
    }

    const apiKey = process.env.GROK_API_KEY?.trim();
    if (!apiKey) {
      return null;
    }

    const { CodeBuddyClient } = await import('../../codebuddy/client.js');
    this.codebuddyClient = new CodeBuddyClient(apiKey, process.env.GROK_MODEL || 'grok-code-fast-1') as IDEChatClient;
    return this.codebuddyClient;
  }

  private async requireCodeBuddyClient(): Promise<IDEChatClient> {
    const client = await this.getCodeBuddyClient();
    if (!client) {
      throw new Error('GROK_API_KEY is required for IDE AI features');
    }
    return client;
  }

  private async runPrompt(messages: IDEChatMessage[]): Promise<string> {
    const client = await this.requireCodeBuddyClient();
    const response = await client.chat(messages, []);
    return response.choices?.[0]?.message?.content?.trim() || '';
  }

  private async buildCompletionContext(params: Partial<CompletionRequest>): Promise<{ prefix: string; suffix: string; language: string }> {
    const fallbackPrefix = typeof params.prefix === 'string' ? params.prefix : '';
    const fallbackSuffix = typeof params.context === 'string' ? params.context : '';
    const language = typeof params.language === 'string' && params.language.trim().length > 0
      ? params.language
      : 'code';

    if (typeof params.file !== 'string' || params.file.trim().length === 0) {
      return {
        prefix: fallbackPrefix.slice(-1000),
        suffix: fallbackSuffix.slice(0, 400),
        language,
      };
    }

    try {
      const content = await readFile(params.file, 'utf8');
      const lines = content.split(/\r?\n/);
      const requestedLine = typeof params.line === 'number' ? params.line : 0;
      const requestedColumn = typeof params.column === 'number' ? params.column : fallbackPrefix.length;
      const lineIndex = Math.min(Math.max(0, requestedLine), Math.max(0, lines.length - 1));
      const currentLine = lines[lineIndex] || '';
      const columnIndex = Math.min(Math.max(0, requestedColumn), currentLine.length);
      const before = [...lines.slice(0, lineIndex), currentLine.slice(0, columnIndex)].join('\n');
      const after = [currentLine.slice(columnIndex), ...lines.slice(lineIndex + 1)].join('\n');

      return {
        prefix: before.slice(-1000),
        suffix: after.slice(0, 400),
        language,
      };
    } catch {
      return {
        prefix: fallbackPrefix.slice(-1000),
        suffix: fallbackSuffix.slice(0, 400),
        language,
      };
    }
  }

  private async generateAICompletions(
    params: Partial<CompletionRequest>,
    context: { prefix: string; suffix: string; language: string }
  ): Promise<CompletionItem[]> {
    const client = await this.getCodeBuddyClient();
    if (!client) {
      return [];
    }

    const response = await client.chat([
      {
        role: 'system',
        content: `You are a ${context.language} code completion engine. Return strict JSON only.`,
      },
      {
        role: 'user',
        content: `Suggest 3 to 5 completions for this ${context.language} code.
File: ${params.file || 'unknown'}
Prefix:
${context.prefix}
<CURSOR>
Suffix:
${context.suffix}

Return JSON:
[{"label":"<display text>","insertText":"<text to insert>","detail":"<short description>","documentation":"<optional docs>","kind":"function|variable|class|method|property|snippet|text"}]`,
      },
    ], []);

    const rawItems = this.parseJsonArray(response.choices?.[0]?.message?.content || '');
    if (!rawItems) {
      return [];
    }

    return rawItems
      .map((item, index) => this.normalizeCompletionItem(item, index))
      .filter((item): item is CompletionItem => item !== null);
  }

  private normalizeCompletionItem(value: unknown, index: number): CompletionItem | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const item = value as Record<string, unknown>;
    const label = typeof item.label === 'string' ? item.label.trim() : '';
    if (!label) {
      return null;
    }

    const insertText = typeof item.insertText === 'string' && item.insertText.trim().length > 0
      ? item.insertText
      : label;

    return {
      label,
      insertText,
      detail: typeof item.detail === 'string' ? item.detail : undefined,
      documentation: typeof item.documentation === 'string' ? item.documentation : undefined,
      kind: this.mapCompletionKind(item.kind),
      sortText: String(index).padStart(3, '0'),
    };
  }

  private mapCompletionKind(kind: unknown): CompletionItem['kind'] {
    switch (typeof kind === 'string' ? kind.toLowerCase() : '') {
      case 'function':
      case 'method':
        return 'function';
      case 'class':
        return 'class';
      case 'variable':
      case 'property':
        return 'variable';
      case 'snippet':
        return 'snippet';
      default:
        return 'text';
    }
  }

  private generateLexicalCompletions(prefix: string, suffix: string): CompletionItem[] {
    const fragmentMatch = prefix.match(/[A-Za-z_$][\w$]*$/);
    const fragment = fragmentMatch?.[0] || '';
    if (fragment.length < 2) {
      return [];
    }

    const seen = new Set<string>();
    const suggestions: CompletionItem[] = [];
    const tokens = `${prefix}\n${suffix}`.match(/[A-Za-z_$][\w$]{2,}/g) || [];

    for (const token of tokens) {
      if (token === fragment || !token.startsWith(fragment) || seen.has(token)) {
        continue;
      }

      seen.add(token);
      suggestions.push({
        label: token,
        insertText: token,
        detail: 'Local lexical completion',
        kind: 'text',
        sortText: token,
      });

      if (suggestions.length >= 8) {
        break;
      }
    }

    return suggestions;
  }

  private parseJsonArray(content: string): unknown[] | null {
    const normalized = this.stripMarkdownFence(content);
    const direct = this.tryParseJson(normalized);
    if (Array.isArray(direct)) {
      return direct;
    }

    const match = normalized.match(/\[[\s\S]*\]/);
    if (!match) {
      return null;
    }

    const parsed = this.tryParseJson(match[0]);
    return Array.isArray(parsed) ? parsed : null;
  }

  private parseJsonObject(content: string): Record<string, unknown> | null {
    const normalized = this.stripMarkdownFence(content);
    const direct = this.tryParseJson(normalized);
    if (direct && typeof direct === 'object' && !Array.isArray(direct)) {
      return direct as Record<string, unknown>;
    }

    const match = normalized.match(/\{[\s\S]*\}/);
    if (!match) {
      return null;
    }

    const parsed = this.tryParseJson(match[0]);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  }

  private tryParseJson(content: string): unknown {
    try {
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  private stripMarkdownFence(content: string): string {
    const trimmed = content.trim();
    const fenced = trimmed.match(/^```(?:[\w-]+)?\s*([\s\S]*?)\s*```$/);
    return fenced ? fenced[1].trim() : trimmed;
  }

  private extractCodeBlock(content: string): string {
    const fenced = content.match(/```(?:[\w-]+)?\s*([\s\S]*?)```/);
    return (fenced?.[1] ?? content).trim();
  }

  private extractFallbackRange(diagnostics: unknown[]): TextRange | null {
    for (const diagnostic of diagnostics) {
      if (diagnostic && typeof diagnostic === 'object' && !Array.isArray(diagnostic)) {
        const range = (diagnostic as Record<string, unknown>).range;
        if (this.isTextRange(range)) {
          return range;
        }
      }
    }
    return null;
  }

  private isTextRange(value: unknown): value is TextRange {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return false;
    }

    const range = value as Record<string, unknown>;
    return this.isPosition(range.start) && this.isPosition(range.end);
  }

  private isPosition(value: unknown): value is { line: number; character: number } {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return false;
    }

    const position = value as Record<string, unknown>;
    return typeof position.line === 'number' && typeof position.character === 'number';
  }

  private detectIDEType(ide: string): IDEType {
    const lower = (ide || '').toLowerCase();

    if (lower.includes('vscode') || lower.includes('code')) return 'vscode';
    if (lower.includes('jetbrains') || lower.includes('idea') || lower.includes('pycharm')) return 'jetbrains';
    if (lower.includes('nvim') || lower.includes('neovim')) return 'neovim';
    if (lower.includes('sublime')) return 'sublime';

    return 'unknown';
  }
}

// ============================================================================
// Singleton
// ============================================================================

let serverInstance: IDEExtensionsServer | null = null;

export function getIDEExtensionsServer(config?: Partial<IDEExtensionsConfig>): IDEExtensionsServer {
  if (!serverInstance) {
    serverInstance = new IDEExtensionsServer(config);
  }
  return serverInstance;
}

export function resetIDEExtensionsServer(): void {
  if (serverInstance) {
    serverInstance.stop();
  }
  serverInstance = null;
}
