/**
 * IDE Integration Protocol
 *
 * Provides a standardized protocol for IDE/editor integration:
 * - JSON-RPC based communication
 * - WebSocket and stdio transports
 * - LSP-compatible message format
 * - Bidirectional async communication
 */

import { EventEmitter } from 'events';
import * as net from 'net';
import * as readline from 'readline';

// ============================================================================
// Types
// ============================================================================

export interface JSONRPCMessage {
  jsonrpc: '2.0';
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: JSONRPCError;
}

export interface JSONRPCError {
  code: number;
  message: string;
  data?: unknown;
}

export interface IDECapabilities {
  fileOperations: boolean;
  diagnostics: boolean;
  codeActions: boolean;
  completion: boolean;
  hover: boolean;
  formatting: boolean;
  semanticTokens: boolean;
  inlineValues: boolean;
}

export interface IDEState {
  activeFile?: string;
  selection?: Selection;
  visibleFiles: string[];
  workspaceFolders: string[];
  languageId?: string;
}

export interface Selection {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export interface Diagnostic {
  file: string;
  range: Selection;
  severity: 'error' | 'warning' | 'info' | 'hint';
  message: string;
  code?: string;
  source: string;
}

export interface CodeAction {
  title: string;
  kind: string;
  edit?: WorkspaceEdit;
  command?: Command;
  isPreferred?: boolean;
}

export interface WorkspaceEdit {
  changes: Record<string, TextEdit[]>;
}

export interface TextEdit {
  range: Selection;
  newText: string;
}

export interface Command {
  title: string;
  command: string;
  arguments?: unknown[];
}

export interface CompletionItem {
  label: string;
  kind: CompletionItemKind;
  detail?: string;
  documentation?: string;
  insertText?: string;
  insertTextFormat?: 'plaintext' | 'snippet';
  additionalTextEdits?: TextEdit[];
}

export type CompletionItemKind =
  | 'text' | 'method' | 'function' | 'constructor' | 'field'
  | 'variable' | 'class' | 'interface' | 'module' | 'property'
  | 'unit' | 'value' | 'enum' | 'keyword' | 'snippet'
  | 'color' | 'file' | 'reference' | 'folder';

export interface HoverInfo {
  contents: string | MarkupContent;
  range?: Selection;
}

export interface MarkupContent {
  kind: 'plaintext' | 'markdown';
  value: string;
}

// ============================================================================
// Error Codes
// ============================================================================

export const ErrorCodes = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  ServerNotInitialized: -32002,
  UnknownErrorCode: -32001,
  RequestCancelled: -32800,
  ContentModified: -32801,
} as const;

// ============================================================================
// Method Handlers
// ============================================================================

type MethodHandler = (params: unknown) => Promise<unknown>;

// ============================================================================
// IDE Protocol Server
// ============================================================================

export class IDEProtocolServer extends EventEmitter {
  private handlers: Map<string, MethodHandler> = new Map();
  private transport: Transport | null = null;
  private nextId = 1;
  private pendingRequests: Map<number | string, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }> = new Map();
  private initialized = false;
  private capabilities: IDECapabilities = {
    fileOperations: true,
    diagnostics: true,
    codeActions: true,
    completion: true,
    hover: true,
    formatting: true,
    semanticTokens: false,
    inlineValues: false,
  };

  constructor() {
    super();
    this.registerBuiltinMethods();
  }

  /**
   * Register built-in methods
   */
  private registerBuiltinMethods(): void {
    // Initialize
    this.registerMethod('initialize', async (params) => {
      const initParams = params as { capabilities?: Partial<IDECapabilities> };
      if (initParams.capabilities) {
        this.capabilities = { ...this.capabilities, ...initParams.capabilities };
      }
      this.initialized = true;
      this.emit('initialized');
      return { capabilities: this.capabilities };
    });

    // Shutdown
    this.registerMethod('shutdown', async () => {
      this.emit('shutdown');
      return null;
    });

    // Exit
    this.registerMethod('exit', async () => {
      this.emit('exit');
      this.stop();
      return null;
    });

    // Ping
    this.registerMethod('ping', async () => {
      return { pong: Date.now() };
    });

    // Get capabilities
    this.registerMethod('getCapabilities', async () => {
      return this.capabilities;
    });
  }

  /**
   * Register a method handler
   */
  registerMethod(method: string, handler: MethodHandler): void {
    this.handlers.set(method, handler);
  }

  /**
   * Start with stdio transport
   */
  startStdio(): void {
    this.transport = new StdioTransport();
    this.setupTransport();
  }

  /**
   * Start with TCP transport
   */
  startTCP(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const transport = new TCPTransport(port);
      transport.on('listening', () => {
        this.transport = transport;
        this.setupTransport();
        resolve();
      });
      transport.on('error', reject);
      transport.start();
    });
  }

  /**
   * Setup transport handlers
   */
  private setupTransport(): void {
    if (!this.transport) return;

    this.transport.on('message', async (msg: JSONRPCMessage) => {
      try {
        await this.handleMessage(msg);
      } catch (error) {
        this.emit('error', error);
      }
    });

    this.transport.on('error', (error: Error) => {
      this.emit('error', error);
    });

    this.transport.on('close', () => {
      this.emit('close');
    });
  }

  /**
   * Handle incoming message
   */
  private async handleMessage(msg: JSONRPCMessage): Promise<void> {
    // Handle response
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const pending = this.pendingRequests.get(msg.id);
      if (pending) {
        this.pendingRequests.delete(msg.id);
        if (msg.error) {
          pending.reject(new Error(msg.error.message));
        } else {
          pending.resolve(msg.result);
        }
      }
      return;
    }

    // Handle request/notification
    if (msg.method) {
      this.emit('request', { method: msg.method, params: msg.params });

      const handler = this.handlers.get(msg.method);
      if (!handler) {
        if (msg.id !== undefined) {
          this.sendError(msg.id, ErrorCodes.MethodNotFound, `Method not found: ${msg.method}`);
        }
        return;
      }

      try {
        const result = await handler(msg.params);
        if (msg.id !== undefined) {
          this.sendResult(msg.id, result);
        }
      } catch (error) {
        if (msg.id !== undefined) {
          this.sendError(
            msg.id,
            ErrorCodes.InternalError,
            error instanceof Error ? error.message : String(error)
          );
        }
      }
    }
  }

  /**
   * Send a request
   */
  async request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (!this.transport) {
      throw new Error('Transport not initialized');
    }

    const id = this.nextId++;
    const msg: JSONRPCMessage = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.transport!.send(msg);
    });
  }

  /**
   * Send a notification
   */
  notify(method: string, params?: unknown): void {
    if (!this.transport) return;

    const msg: JSONRPCMessage = {
      jsonrpc: '2.0',
      method,
      params,
    };

    this.transport.send(msg);
  }

  /**
   * Send result
   */
  private sendResult(id: number | string, result: unknown): void {
    if (!this.transport) return;

    const msg: JSONRPCMessage = {
      jsonrpc: '2.0',
      id,
      result,
    };

    this.transport.send(msg);
  }

  /**
   * Send error
   */
  private sendError(id: number | string, code: number, message: string, data?: unknown): void {
    if (!this.transport) return;

    const msg: JSONRPCMessage = {
      jsonrpc: '2.0',
      id,
      error: { code, message, data },
    };

    this.transport.send(msg);
  }

  /**
   * Stop the server
   */
  stop(): void {
    if (this.transport) {
      this.transport.close();
      this.transport = null;
    }
    this.pendingRequests.clear();
    this.removeAllListeners();
  }

  // =========================================================================
  // IDE-specific methods
  // =========================================================================

  /**
   * Send diagnostics to IDE
   */
  publishDiagnostics(file: string, diagnostics: Diagnostic[]): void {
    this.notify('grok/publishDiagnostics', { file, diagnostics });
  }

  /**
   * Request code action from agent
   */
  async requestCodeAction(file: string, range: Selection, context: unknown): Promise<CodeAction[]> {
    return this.request<CodeAction[]>('grok/codeAction', { file, range, context });
  }

  /**
   * Apply workspace edit
   */
  async applyEdit(edit: WorkspaceEdit): Promise<boolean> {
    return this.request<boolean>('grok/applyEdit', { edit });
  }

  /**
   * Show message in IDE
   */
  showMessage(type: 'info' | 'warning' | 'error', message: string): void {
    this.notify('grok/showMessage', { type, message });
  }

  /**
   * Request input from user
   */
  async requestInput(prompt: string, placeholder?: string): Promise<string | null> {
    return this.request<string | null>('grok/requestInput', { prompt, placeholder });
  }

  /**
   * Open file in IDE
   */
  async openFile(file: string, line?: number, column?: number): Promise<boolean> {
    return this.request<boolean>('grok/openFile', { file, line, column });
  }

  /**
   * Get current IDE state
   */
  async getIDEState(): Promise<IDEState> {
    return this.request<IDEState>('grok/getState');
  }

  /**
   * Get file content from IDE
   */
  async getFileContent(file: string): Promise<string> {
    return this.request<string>('grok/getFileContent', { file });
  }
}

// ============================================================================
// Transport Interface
// ============================================================================

interface Transport extends EventEmitter {
  send(message: JSONRPCMessage): void;
  close(): void;
}

// ============================================================================
// Stdio Transport
// ============================================================================

class StdioTransport extends EventEmitter implements Transport {
  private reader: readline.Interface;
  private contentLength = 0;
  private buffer = '';

  constructor() {
    super();

    this.reader = readline.createInterface({
      input: process.stdin,
      terminal: false,
    });

    this.reader.on('line', (line) => {
      this.handleLine(line);
    });

    this.reader.on('close', () => {
      this.emit('close');
    });

    process.stdin.on('error', (error) => {
      this.emit('error', error);
    });
  }

  private handleLine(line: string): void {
    // Parse LSP-style headers
    if (line.startsWith('Content-Length:')) {
      this.contentLength = parseInt(line.slice(15).trim(), 10);
    } else if (line === '') {
      // Empty line means headers done, read body
      if (this.contentLength > 0) {
        // Read content from stdin
        process.stdin.once('data', (data: Buffer) => {
          try {
            const msg = JSON.parse(data.toString()) as JSONRPCMessage;
            this.emit('message', msg);
          } catch (error) {
            this.emit('error', new Error(`Failed to parse message: ${error}`));
          }
          this.contentLength = 0;
        });
      }
    } else {
      // Try to parse as plain JSON
      try {
        const msg = JSON.parse(line) as JSONRPCMessage;
        this.emit('message', msg);
      } catch {
        // Ignore non-JSON lines
      }
    }
  }

  send(message: JSONRPCMessage): void {
    const content = JSON.stringify(message);
    const header = `Content-Length: ${Buffer.byteLength(content)}\r\n\r\n`;
    process.stdout.write(header + content);
  }

  close(): void {
    this.reader.close();
  }
}

// ============================================================================
// TCP Transport
// ============================================================================

class TCPTransport extends EventEmitter implements Transport {
  private server: net.Server | null = null;
  private socket: net.Socket | null = null;
  private port: number;
  private buffer = '';

  constructor(port: number) {
    super();
    this.port = port;
  }

  start(): void {
    this.server = net.createServer((socket) => {
      this.socket = socket;

      socket.on('data', (data: Buffer) => {
        this.buffer += data.toString();
        this.processBuffer();
      });

      socket.on('close', () => {
        this.socket = null;
        this.emit('clientDisconnected');
      });

      socket.on('error', (error) => {
        this.emit('error', error);
      });

      this.emit('clientConnected');
    });

    this.server.on('error', (error) => {
      this.emit('error', error);
    });

    this.server.listen(this.port, () => {
      this.emit('listening', this.port);
    });
  }

  private processBuffer(): void {
    while (true) {
      // Look for Content-Length header
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) break;

      const header = this.buffer.slice(0, headerEnd);
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        // Try to parse as plain JSON
        const lineEnd = this.buffer.indexOf('\n');
        if (lineEnd !== -1) {
          const line = this.buffer.slice(0, lineEnd);
          this.buffer = this.buffer.slice(lineEnd + 1);
          try {
            const msg = JSON.parse(line) as JSONRPCMessage;
            this.emit('message', msg);
          } catch {
            // Ignore
          }
        }
        break;
      }

      const contentLength = parseInt(match[1], 10);
      const contentStart = headerEnd + 4;
      const contentEnd = contentStart + contentLength;

      if (this.buffer.length < contentEnd) break;

      const content = this.buffer.slice(contentStart, contentEnd);
      this.buffer = this.buffer.slice(contentEnd);

      try {
        const msg = JSON.parse(content) as JSONRPCMessage;
        this.emit('message', msg);
      } catch (error) {
        this.emit('error', new Error(`Failed to parse message: ${error}`));
      }
    }
  }

  send(message: JSONRPCMessage): void {
    if (!this.socket) return;

    const content = JSON.stringify(message);
    const header = `Content-Length: ${Buffer.byteLength(content)}\r\n\r\n`;
    this.socket.write(header + content);
  }

  close(): void {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    this.emit('close');
  }
}

// ============================================================================
// IDE Client (for testing)
// ============================================================================

export class IDEProtocolClient extends EventEmitter {
  private socket: net.Socket | null = null;
  private buffer = '';
  private nextId = 1;
  private pendingRequests: Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }> = new Map();

  /**
   * Connect to server
   */
  connect(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = net.createConnection({ port }, () => {
        resolve();
      });

      this.socket.on('data', (data: Buffer) => {
        this.buffer += data.toString();
        this.processBuffer();
      });

      this.socket.on('error', (error) => {
        reject(error);
        this.emit('error', error);
      });

      this.socket.on('close', () => {
        this.emit('close');
      });
    });
  }

  private processBuffer(): void {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line) as JSONRPCMessage;
        this.handleMessage(msg);
      } catch {
        // Ignore
      }
    }
  }

  private handleMessage(msg: JSONRPCMessage): void {
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const pending = this.pendingRequests.get(msg.id as number);
      if (pending) {
        this.pendingRequests.delete(msg.id as number);
        if (msg.error) {
          pending.reject(new Error(msg.error.message));
        } else {
          pending.resolve(msg.result);
        }
      }
    } else if (msg.method) {
      this.emit('notification', { method: msg.method, params: msg.params });
    }
  }

  /**
   * Send request
   */
  async request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (!this.socket) {
      throw new Error('Not connected');
    }

    const id = this.nextId++;
    const msg: JSONRPCMessage = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.socket!.write(JSON.stringify(msg) + '\n');
    });
  }

  /**
   * Send notification
   */
  notify(method: string, params?: unknown): void {
    if (!this.socket) return;

    const msg: JSONRPCMessage = {
      jsonrpc: '2.0',
      method,
      params,
    };

    this.socket.write(JSON.stringify(msg) + '\n');
  }

  /**
   * Disconnect
   */
  disconnect(): void {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create IDE protocol server
 */
export function createIDEServer(): IDEProtocolServer {
  return new IDEProtocolServer();
}

/**
 * Create IDE protocol client
 */
export function createIDEClient(): IDEProtocolClient {
  return new IDEProtocolClient();
}
