/**
 * LSP Client — Real JSON-RPC over stdio
 *
 * Provides a client that spawns and communicates with LSP servers
 * using JSON-RPC 2.0 over stdio. Supports:
 * - textDocument/diagnostic (type errors)
 * - textDocument/definition (go-to-def)
 * - textDocument/references (find refs)
 * - textDocument/hover (type info)
 * - textDocument/documentSymbol (outline)
 *
 * Auto-detects language from file extension and spawns the
 * appropriate server (typescript-language-server, pyright, gopls, etc.).
 * Singleton lazy-init: server only starts when first tool is called.
 */

import { spawn, ChildProcess } from 'child_process';
import { logger } from '../utils/logger.js';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';

// ============================================================================
// Types
// ============================================================================

export type LSPOperation = 'goToDefinition' | 'findReferences' | 'hover' | 'documentSymbol' | 'getDiagnostics' | 'rename' | 'prepareRename' | 'codeAction';

export type LSPLanguage =
  | 'python' | 'typescript' | 'javascript' | 'go' | 'rust'
  | 'java' | 'c' | 'cpp' | 'csharp' | 'php'
  | 'kotlin' | 'ruby' | 'html' | 'css';

export interface LSPServerConfig {
  language: LSPLanguage;
  command: string;
  args: string[];
  initOptions?: Record<string, unknown>;
}

export interface LSPLocation {
  file: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
}

export interface LSPSymbol {
  name: string;
  kind: string;
  location: LSPLocation;
  children?: LSPSymbol[];
}

export interface LSPDiagnostic {
  file: string;
  line: number;
  column: number;
  severity: 'error' | 'warning' | 'info' | 'hint';
  message: string;
  source?: string;
}

export interface LSPHoverInfo {
  content: string;
  language?: string;
  range?: LSPLocation;
}

export interface LSPRange {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

export interface LSPTextEdit {
  range: LSPRange;
  newText: string;
}

export interface LSPWorkspaceEdit {
  changes?: Record<string, LSPTextEdit[]>;
  documentChanges?: Array<{
    textDocument: { uri: string; version?: number | null };
    edits: LSPTextEdit[];
  }>;
}

export interface LSPPrepareRenameResult {
  range: LSPRange;
  placeholder: string;
}

export interface LSPCodeAction {
  title: string;
  kind?: string;
  diagnostics?: LSPDiagnostic[];
  edit?: LSPWorkspaceEdit;
  command?: { title: string; command: string; arguments?: unknown[] };
}

// ============================================================================
// JSON-RPC Types
// ============================================================================

interface JsonRpcMessage {
  jsonrpc: '2.0';
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// ============================================================================
// Constants
// ============================================================================

const EXTENSION_MAP: Record<string, LSPLanguage> = {
  '.py': 'python',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.php': 'php',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.rb': 'ruby',
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.scss': 'css',
  '.less': 'css',
};

const DEFAULT_CONFIGS: Partial<Record<LSPLanguage, LSPServerConfig>> = {
  typescript: { language: 'typescript', command: 'typescript-language-server', args: ['--stdio'] },
  javascript: { language: 'javascript', command: 'typescript-language-server', args: ['--stdio'] },
  python: { language: 'python', command: 'pylsp', args: [] },
  go: { language: 'go', command: 'gopls', args: ['serve'] },
  rust: { language: 'rust', command: 'rust-analyzer', args: [] },
  java: { language: 'java', command: 'jdtls', args: [] },
  c: { language: 'c', command: 'clangd', args: [] },
  cpp: { language: 'cpp', command: 'clangd', args: [] },
  csharp: { language: 'csharp', command: 'omnisharp', args: ['-lsp'] },
  php: { language: 'php', command: 'phpactor', args: ['language-server'] },
  html: { language: 'html', command: 'vscode-html-language-server', args: ['--stdio'] },
  css: { language: 'css', command: 'vscode-css-language-server', args: ['--stdio'] },
  ruby: { language: 'ruby', command: 'solargraph', args: ['stdio'] },
  kotlin: { language: 'kotlin', command: 'kotlin-language-server', args: [] },
};

const SYMBOL_KIND_MAP: Record<number, string> = {
  1: 'File', 2: 'Module', 3: 'Namespace', 4: 'Package',
  5: 'Class', 6: 'Method', 7: 'Property', 8: 'Field',
  9: 'Constructor', 10: 'Enum', 11: 'Interface', 12: 'Function',
  13: 'Variable', 14: 'Constant', 15: 'String', 16: 'Number',
  17: 'Boolean', 18: 'Array', 19: 'Object', 20: 'Key',
  21: 'Null', 22: 'EnumMember', 23: 'Struct', 24: 'Event',
  25: 'Operator', 26: 'TypeParameter',
};

const SEVERITY_MAP: Record<number, LSPDiagnostic['severity']> = {
  1: 'error',
  2: 'warning',
  3: 'info',
  4: 'hint',
};

/** Request timeout (ms) */
const REQUEST_TIMEOUT = 30000;

// ============================================================================
// Server Connection
// ============================================================================

interface ServerConnection {
  process: ChildProcess;
  initialized: boolean;
  nextId: number;
  pending: Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>;
  buffer: string;
  openDocuments: Set<string>;
  diagnostics: Map<string, LSPDiagnostic[]>;
}

// ============================================================================
// LSP Client Implementation
// ============================================================================

export class LSPClient {
  private servers: Map<LSPLanguage, LSPServerConfig>;
  private connections: Map<LSPLanguage, ServerConnection>;
  private configPath: string;
  private rootUri: string;
  private stats: { queriesExecuted: number; totalResponseMs: number; cacheHits: number };

  constructor(configPath?: string) {
    this.servers = new Map();
    this.connections = new Map();
    this.configPath = configPath || '.codebuddy/lsp-config.json';
    this.rootUri = pathToFileURL(process.cwd()).href;
    this.stats = { queriesExecuted: 0, totalResponseMs: 0, cacheHits: 0 };
    logger.debug('LSPClient initialized', { configPath: this.configPath });
  }

  registerServer(config: LSPServerConfig): void {
    if (!config.language || !config.command) {
      throw new Error('Language and command are required for LSP server config');
    }
    this.servers.set(config.language, { ...config });
    logger.info('LSP server registered', { language: config.language, command: config.command });
  }

  getRegisteredLanguages(): LSPLanguage[] {
    return Array.from(this.servers.keys());
  }

  isLanguageSupported(lang: LSPLanguage): boolean {
    return this.servers.has(lang) || DEFAULT_CONFIGS[lang] !== undefined;
  }

  /**
   * Return the effective server configuration for a language.
   * Explicit registrations take precedence over the built-in defaults.
   */
  getServerConfig(language: LSPLanguage): LSPServerConfig | null {
    const config = this.servers.get(language) ?? DEFAULT_CONFIGS[language];
    if (!config) return null;
    return {
      ...config,
      args: [...config.args],
      initOptions: config.initOptions ? { ...config.initOptions } : undefined,
    };
  }

  static getDefaultConfig(language: LSPLanguage): LSPServerConfig | null {
    const config = DEFAULT_CONFIGS[language];
    return config ? {
      ...config,
      args: [...config.args],
      initOptions: config.initOptions ? { ...config.initOptions } : undefined,
    } : null;
  }

  static getSupportedLanguages(): LSPLanguage[] {
    return Object.keys(DEFAULT_CONFIGS) as LSPLanguage[];
  }

  detectLanguage(filePath: string): LSPLanguage | null {
    const ext = path.extname(filePath).toLowerCase();
    return EXTENSION_MAP[ext] || null;
  }

  // ==========================================================================
  // Server Lifecycle
  // ==========================================================================

  /**
   * Ensure a server is running for the given language.
   * Auto-registers default config if not explicitly registered.
   */
  private async ensureServer(language: LSPLanguage): Promise<ServerConnection | null> {
    // Return existing connection
    const existing = this.connections.get(language);
    if (existing?.initialized) return existing;

    // Auto-register default config if needed
    if (!this.servers.has(language)) {
      const defaultConfig = DEFAULT_CONFIGS[language];
      if (!defaultConfig) return null;
      this.servers.set(language, { ...defaultConfig });
    }

    const started = await this.startServer(language);
    return started ? (this.connections.get(language) ?? null) : null;
  }

  /**
   * Ensure that the server required by a file is running and initialized.
   * This exposes the existing lifecycle without exposing the connection itself,
   * allowing callers to distinguish an unavailable server from an empty result.
   */
  async ensureServerForFile(filePath: string): Promise<boolean> {
    const language = this.detectLanguage(filePath);
    if (!language) return false;
    return (await this.ensureServer(language)) !== null;
  }

  async startServer(language: LSPLanguage): Promise<boolean> {
    if (this.connections.has(language) && this.connections.get(language)!.initialized) {
      return true;
    }

    const config = this.servers.get(language);
    if (!config) {
      logger.warn('Cannot start server: not registered', { language });
      return false;
    }

    logger.info('Starting LSP server', { language, command: config.command });

    try {
      const child = spawn(config.command, config.args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: process.cwd(),
      });

      const conn: ServerConnection = {
        process: child,
        initialized: false,
        nextId: 1,
        pending: new Map(),
        buffer: '',
        openDocuments: new Set(),
        diagnostics: new Map(),
      };

      // Handle incoming data (JSON-RPC responses + notifications)
      child.stdout!.on('data', (data: Buffer) => {
        conn.buffer += data.toString();
        this.processBuffer(conn);
      });

      child.stderr!.on('data', (data: Buffer) => {
        logger.debug(`LSP ${language} stderr: ${data.toString().trim()}`);
      });

      child.on('error', (err) => {
        logger.warn(`LSP ${language} process error: ${err.message}`);
        this.connections.delete(language);
      });

      child.on('close', (code) => {
        logger.debug(`LSP ${language} exited with code ${code}`);
        // Reject all pending requests
        for (const [, pending] of conn.pending) {
          clearTimeout(pending.timer);
          pending.reject(new Error(`LSP server exited with code ${code}`));
        }
        conn.pending.clear();
        this.connections.delete(language);
      });

      this.connections.set(language, conn);

      // Send initialize request
      const initResult = await this.sendRequest(conn, 'initialize', {
        processId: process.pid,
        rootUri: this.rootUri,
        capabilities: {
          textDocument: {
            synchronization: { openClose: true, change: 1 }, // Full sync
            completion: { completionItem: { snippetSupport: false } },
            hover: { contentFormat: ['plaintext', 'markdown'] },
            definition: { linkSupport: false },
            references: {},
            documentSymbol: { hierarchicalDocumentSymbolSupport: true },
            rename: { prepareSupport: true },
            codeAction: { codeActionLiteralSupport: { codeActionKind: { valueSet: ['quickfix', 'refactor', 'refactor.extract', 'refactor.inline', 'refactor.rewrite', 'source', 'source.organizeImports'] } } },
            diagnostic: {},
            publishDiagnostics: { relatedInformation: true },
          },
          workspace: {
            workspaceFolders: true,
          },
        },
        initializationOptions: config.initOptions || {},
        workspaceFolders: [{ uri: this.rootUri, name: path.basename(process.cwd()) }],
      });

      if (!initResult) {
        logger.warn('LSP initialize returned null', { language });
        return false;
      }

      // Send initialized notification
      this.sendNotification(conn, 'initialized', {});
      conn.initialized = true;

      logger.info('LSP server initialized', { language });
      return true;
    } catch (err) {
      logger.warn(`Failed to start LSP server: ${err}`, { language });
      this.connections.delete(language);
      return false;
    }
  }

  async stopServer(language: LSPLanguage): Promise<void> {
    const conn = this.connections.get(language);
    if (!conn) return;

    logger.info('Stopping LSP server', { language });

    try {
      // Send shutdown request
      await this.sendRequest(conn, 'shutdown', null);
      // Send exit notification
      this.sendNotification(conn, 'exit', null);
    } catch {
      // Server may already be dead
    }

    conn.process.kill('SIGTERM');
    this.connections.delete(language);
  }

  async stopAll(): Promise<void> {
    const languages = Array.from(this.connections.keys());
    for (const lang of languages) {
      await this.stopServer(lang);
    }
    logger.info('All LSP servers stopped');
  }

  getActiveServerCount(): number {
    return this.connections.size;
  }

  // ==========================================================================
  // JSON-RPC Transport
  // ==========================================================================

  private sendRequest(conn: ServerConnection, method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = conn.nextId++;
      const message: JsonRpcMessage = { jsonrpc: '2.0', id, method, params };
      const content = JSON.stringify(message);
      const header = `Content-Length: ${Buffer.byteLength(content)}\r\n\r\n`;

      const timer = setTimeout(() => {
        conn.pending.delete(id);
        reject(new Error(`LSP request ${method} timed out after ${REQUEST_TIMEOUT}ms`));
      }, REQUEST_TIMEOUT);

      conn.pending.set(id, { resolve, reject, timer });
      conn.process.stdin!.write(header + content);
    });
  }

  private sendNotification(conn: ServerConnection, method: string, params: unknown): void {
    const message: JsonRpcMessage = { jsonrpc: '2.0', method, params };
    const content = JSON.stringify(message);
    const header = `Content-Length: ${Buffer.byteLength(content)}\r\n\r\n`;
    conn.process.stdin!.write(header + content);
  }

  private processBuffer(conn: ServerConnection): void {
    while (true) {
      // Look for Content-Length header
      const headerEnd = conn.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) break;

      const header = conn.buffer.slice(0, headerEnd);
      const match = header.match(/Content-Length:\s*(\d+)/i);
      const lengthStr = match?.[1];
      if (lengthStr === undefined) {
        // Skip malformed header
        conn.buffer = conn.buffer.slice(headerEnd + 4);
        continue;
      }

      const contentLength = parseInt(lengthStr, 10);
      const contentStart = headerEnd + 4;

      if (conn.buffer.length < contentStart + contentLength) {
        break; // Not enough data yet
      }

      const content = conn.buffer.slice(contentStart, contentStart + contentLength);
      conn.buffer = conn.buffer.slice(contentStart + contentLength);

      try {
        const msg: JsonRpcMessage = JSON.parse(content);
        this.handleMessage(conn, msg);
      } catch (err) {
        logger.debug(`Failed to parse LSP message: ${err}`);
      }
    }
  }

  private handleMessage(conn: ServerConnection, msg: JsonRpcMessage): void {
    // Response to a request
    if (msg.id !== undefined && conn.pending.has(msg.id)) {
      const pending = conn.pending.get(msg.id)!;
      conn.pending.delete(msg.id);
      clearTimeout(pending.timer);

      if (msg.error) {
        pending.reject(new Error(`LSP error: ${msg.error.message} (code ${msg.error.code})`));
      } else {
        pending.resolve(msg.result);
      }
      return;
    }

    // Server notification
    if (msg.method === 'textDocument/publishDiagnostics') {
      const params = msg.params as { uri: string; diagnostics: Array<{ range: { start: { line: number; character: number }; end: { line: number; character: number } }; severity?: number; message: string; source?: string }> };
      const filePath = this.uriToPath(params.uri);
      conn.diagnostics.set(filePath, params.diagnostics.map(d => ({
        file: filePath,
        line: d.range.start.line + 1,
        column: d.range.start.character + 1,
        severity: SEVERITY_MAP[d.severity ?? 1] || 'error',
        message: d.message,
        source: d.source,
      })));
    }
  }

  // ==========================================================================
  // Document Management
  // ==========================================================================

  private async openDocument(conn: ServerConnection, filePath: string, languageId: string): Promise<void> {
    const uri = this.pathToUri(filePath);
    if (conn.openDocuments.has(uri)) return;

    try {
      const text = fs.readFileSync(filePath, 'utf-8');
      this.sendNotification(conn, 'textDocument/didOpen', {
        textDocument: { uri, languageId, version: 1, text },
      });
      conn.openDocuments.add(uri);
    } catch (err) {
      logger.debug(`Failed to open document ${filePath}: ${err}`);
    }
  }

  private pathToUri(filePath: string): string {
    return pathToFileURL(path.resolve(filePath)).href;
  }

  private uriToPath(uri: string): string {
    try {
      return fileURLToPath(uri);
    } catch {
      return decodeURIComponent(uri.replace(/^file:\/\/\//, '/').replace(/^file:\/\//, ''));
    }
  }

  // ==========================================================================
  // LSP Operations
  // ==========================================================================

  async goToDefinition(file: string, line: number, column: number): Promise<LSPLocation[]> {
    const lang = this.detectLanguage(file);
    if (!lang) return [];

    const start = Date.now();
    const conn = await this.ensureServer(lang);
    if (!conn) return [];

    await this.openDocument(conn, file, lang);
    this.stats.queriesExecuted++;

    try {
      const result = await this.sendRequest(conn, 'textDocument/definition', {
        textDocument: { uri: this.pathToUri(file) },
        position: { line: line - 1, character: column - 1 },
      }) as { uri: string; range: { start: { line: number; character: number }; end: { line: number; character: number } } } | Array<{ uri: string; range: { start: { line: number; character: number }; end: { line: number; character: number } } }> | null;

      this.stats.totalResponseMs += Date.now() - start;

      if (!result) return [];
      const locations = Array.isArray(result) ? result : [result];
      return locations.map(loc => ({
        file: this.uriToPath(loc.uri),
        line: loc.range.start.line + 1,
        column: loc.range.start.character + 1,
        endLine: loc.range.end.line + 1,
        endColumn: loc.range.end.character + 1,
      }));
    } catch (err) {
      logger.debug(`goToDefinition failed: ${err}`);
      return [];
    }
  }

  async findReferences(file: string, line: number, column: number): Promise<LSPLocation[]> {
    const lang = this.detectLanguage(file);
    if (!lang) return [];

    const start = Date.now();
    const conn = await this.ensureServer(lang);
    if (!conn) return [];

    await this.openDocument(conn, file, lang);
    this.stats.queriesExecuted++;

    try {
      const result = await this.sendRequest(conn, 'textDocument/references', {
        textDocument: { uri: this.pathToUri(file) },
        position: { line: line - 1, character: column - 1 },
        context: { includeDeclaration: true },
      }) as Array<{ uri: string; range: { start: { line: number; character: number }; end: { line: number; character: number } } }> | null;

      this.stats.totalResponseMs += Date.now() - start;

      if (!result) return [];
      return result.map(loc => ({
        file: this.uriToPath(loc.uri),
        line: loc.range.start.line + 1,
        column: loc.range.start.character + 1,
        endLine: loc.range.end.line + 1,
        endColumn: loc.range.end.character + 1,
      }));
    } catch (err) {
      logger.debug(`findReferences failed: ${err}`);
      return [];
    }
  }

  async hover(file: string, line: number, column: number): Promise<LSPHoverInfo | null> {
    const lang = this.detectLanguage(file);
    if (!lang) return null;

    const start = Date.now();
    const conn = await this.ensureServer(lang);
    if (!conn) return null;

    await this.openDocument(conn, file, lang);
    this.stats.queriesExecuted++;

    try {
      const result = await this.sendRequest(conn, 'textDocument/hover', {
        textDocument: { uri: this.pathToUri(file) },
        position: { line: line - 1, character: column - 1 },
      }) as { contents: string | { kind: string; value: string } | Array<string | { language: string; value: string }>; range?: { start: { line: number; character: number }; end: { line: number; character: number } } } | null;

      this.stats.totalResponseMs += Date.now() - start;

      if (!result) return null;

      let content: string;
      let language: string | undefined;

      if (typeof result.contents === 'string') {
        content = result.contents;
      } else if ('kind' in result.contents) {
        content = result.contents.value;
        language = result.contents.kind === 'markdown' ? undefined : 'text';
      } else if (Array.isArray(result.contents)) {
        content = result.contents.map(c =>
          typeof c === 'string' ? c : c.value
        ).join('\n');
      } else {
        content = String(result.contents);
      }

      return {
        content,
        language,
        range: result.range ? {
          file,
          line: result.range.start.line + 1,
          column: result.range.start.character + 1,
          endLine: result.range.end.line + 1,
          endColumn: result.range.end.character + 1,
        } : undefined,
      };
    } catch (err) {
      logger.debug(`hover failed: ${err}`);
      return null;
    }
  }

  async getDocumentSymbols(file: string): Promise<LSPSymbol[]> {
    const lang = this.detectLanguage(file);
    if (!lang) return [];

    const start = Date.now();
    const conn = await this.ensureServer(lang);
    if (!conn) return [];

    await this.openDocument(conn, file, lang);
    this.stats.queriesExecuted++;

    try {
      const result = await this.sendRequest(conn, 'textDocument/documentSymbol', {
        textDocument: { uri: this.pathToUri(file) },
      }) as Array<{ name: string; kind: number; range: { start: { line: number; character: number }; end: { line: number; character: number } }; children?: unknown[] }> | null;

      this.stats.totalResponseMs += Date.now() - start;

      if (!result) return [];
      return this.convertSymbols(result, file);
    } catch (err) {
      logger.debug(`getDocumentSymbols failed: ${err}`);
      return [];
    }
  }

  async getDiagnostics(file: string): Promise<LSPDiagnostic[]> {
    const lang = this.detectLanguage(file);
    if (!lang) return [];

    const start = Date.now();
    const conn = await this.ensureServer(lang);
    if (!conn) return [];

    await this.openDocument(conn, file, lang);
    this.stats.queriesExecuted++;

    // Wait briefly for diagnostics to arrive via notification
    await new Promise(resolve => setTimeout(resolve, 2000));

    this.stats.totalResponseMs += Date.now() - start;

    // Check cached diagnostics from publishDiagnostics notification
    const normalized = path.resolve(file);
    return conn.diagnostics.get(normalized) || [];
  }

  // ==========================================================================
  // Rename / Refactor Operations
  // ==========================================================================

  /**
   * Prepare rename — checks if the symbol at the given position can be renamed.
   * Returns the range and placeholder text if rename is possible.
   */
  async prepareRename(filePath: string, line: number, character: number): Promise<LSPPrepareRenameResult | null> {
    const lang = this.detectLanguage(filePath);
    if (!lang) return null;

    const start = Date.now();
    const conn = await this.ensureServer(lang);
    if (!conn) return null;

    await this.openDocument(conn, filePath, lang);
    this.stats.queriesExecuted++;

    try {
      const result = await this.sendRequest(conn, 'textDocument/prepareRename', {
        textDocument: { uri: this.pathToUri(filePath) },
        position: { line: line - 1, character: character - 1 },
      }) as { range: LSPRange; placeholder: string } | LSPRange | null;

      this.stats.totalResponseMs += Date.now() - start;

      if (!result) return null;

      // Handle two possible response formats
      if ('placeholder' in result) {
        return { range: result.range, placeholder: result.placeholder };
      }
      // Simple range result (no placeholder)
      return { range: result as LSPRange, placeholder: '' };
    } catch (err) {
      logger.debug(`prepareRename failed: ${err}`);
      return null;
    }
  }

  /**
   * Rename a symbol at the given position.
   * Returns a WorkspaceEdit describing all changes across files.
   */
  async rename(filePath: string, line: number, character: number, newName: string): Promise<LSPWorkspaceEdit | null> {
    const lang = this.detectLanguage(filePath);
    if (!lang) return null;

    const start = Date.now();
    const conn = await this.ensureServer(lang);
    if (!conn) return null;

    await this.openDocument(conn, filePath, lang);
    this.stats.queriesExecuted++;

    try {
      const result = await this.sendRequest(conn, 'textDocument/rename', {
        textDocument: { uri: this.pathToUri(filePath) },
        position: { line: line - 1, character: character - 1 },
        newName,
      }) as LSPWorkspaceEdit | null;

      this.stats.totalResponseMs += Date.now() - start;

      return result || null;
    } catch (err) {
      logger.debug(`rename failed: ${err}`);
      return null;
    }
  }

  /**
   * Get code actions for a given range and diagnostics.
   * Returns available refactoring and quick-fix actions.
   */
  async codeAction(filePath: string, range: LSPRange, diagnostics: LSPDiagnostic[]): Promise<LSPCodeAction[]> {
    const lang = this.detectLanguage(filePath);
    if (!lang) return [];

    const start = Date.now();
    const conn = await this.ensureServer(lang);
    if (!conn) return [];

    await this.openDocument(conn, filePath, lang);
    this.stats.queriesExecuted++;

    try {
      const lspDiagnostics = diagnostics.map(d => ({
        range: {
          start: { line: d.line - 1, character: d.column - 1 },
          end: { line: d.line - 1, character: d.column - 1 },
        },
        severity: d.severity === 'error' ? 1 : d.severity === 'warning' ? 2 : d.severity === 'info' ? 3 : 4,
        message: d.message,
        source: d.source,
      }));

      const result = await this.sendRequest(conn, 'textDocument/codeAction', {
        textDocument: { uri: this.pathToUri(filePath) },
        range,
        context: { diagnostics: lspDiagnostics },
      }) as LSPCodeAction[] | null;

      this.stats.totalResponseMs += Date.now() - start;

      return result || [];
    } catch (err) {
      logger.debug(`codeAction failed: ${err}`);
      return [];
    }
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  private convertSymbols(
    symbols: Array<{ name: string; kind: number; range: { start: { line: number; character: number }; end: { line: number; character: number } }; children?: unknown[] }>,
    file: string,
  ): LSPSymbol[] {
    return symbols.map(s => ({
      name: s.name,
      kind: SYMBOL_KIND_MAP[s.kind] || `Kind(${s.kind})`,
      location: {
        file,
        line: s.range.start.line + 1,
        column: s.range.start.character + 1,
        endLine: s.range.end.line + 1,
        endColumn: s.range.end.character + 1,
      },
      children: s.children
        ? this.convertSymbols(s.children as typeof symbols, file)
        : undefined,
    }));
  }

  getStats(): { queriesExecuted: number; avgResponseMs: number; cacheHits: number } {
    return {
      queriesExecuted: this.stats.queriesExecuted,
      avgResponseMs: this.stats.queriesExecuted > 0
        ? this.stats.totalResponseMs / this.stats.queriesExecuted
        : 0,
      cacheHits: this.stats.cacheHits,
    };
  }
}

// ============================================================================
// LSP Tool Definitions
// ============================================================================

export const LSP_CHECK_TOOL = {
  type: 'function' as const,
  function: {
    name: 'lsp_check',
    description: 'Get type errors and diagnostics for a file using the Language Server Protocol. Requires the appropriate LSP server installed (e.g. typescript-language-server for TS/JS).',
    parameters: {
      type: 'object' as const,
      properties: {
        file_path: {
          type: 'string' as const,
          description: 'Path to the file to check',
        },
      },
      required: ['file_path'],
    },
  },
};

export const LSP_GOTO_DEF_TOOL = {
  type: 'function' as const,
  function: {
    name: 'lsp_goto_def',
    description: 'Go to the definition of a symbol at a specific position in a file. Returns the file path and line number of the definition.',
    parameters: {
      type: 'object' as const,
      properties: {
        file_path: {
          type: 'string' as const,
          description: 'Path to the file',
        },
        line: {
          type: 'number' as const,
          description: 'Line number (1-based)',
        },
        column: {
          type: 'number' as const,
          description: 'Column number (1-based)',
        },
      },
      required: ['file_path', 'line', 'column'],
    },
  },
};

export const LSP_FIND_REFS_TOOL = {
  type: 'function' as const,
  function: {
    name: 'lsp_find_refs',
    description: 'Find all references to a symbol at a specific position. Returns a list of locations where the symbol is used.',
    parameters: {
      type: 'object' as const,
      properties: {
        file_path: {
          type: 'string' as const,
          description: 'Path to the file',
        },
        line: {
          type: 'number' as const,
          description: 'Line number (1-based)',
        },
        column: {
          type: 'number' as const,
          description: 'Column number (1-based)',
        },
      },
      required: ['file_path', 'line', 'column'],
    },
  },
};

// ============================================================================
// Singleton
// ============================================================================

let _lspClient: LSPClient | null = null;

/**
 * Get the singleton LSP client (lazy-init).
 */
export function getLSPClient(): LSPClient {
  if (!_lspClient) {
    _lspClient = new LSPClient();
  }
  return _lspClient;
}

/**
 * Reset LSP client (for testing or cleanup).
 */
export async function resetLSPClient(): Promise<void> {
  if (_lspClient) {
    await _lspClient.stopAll();
  }
  _lspClient = null;
}
