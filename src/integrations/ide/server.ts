/**
 * IDE Extensions Server
 *
 * Core server for IDE integration that handles connections,
 * requests, and responses from various IDE clients.
 */

import { EventEmitter } from 'events';
import * as net from 'net';
import type {
  IDEType,
  IDEConnection,
  IDERequest,
  IDEResponse,
  IDEExtensionsConfig
} from './types.js';
import { DEFAULT_IDE_CONFIG } from './types.js';
import { generateVSCodeExtension } from './vscode-generator.js';
import { generateNeovimPlugin } from './neovim-generator.js';

export class IDEExtensionsServer extends EventEmitter {
  private config: IDEExtensionsConfig;
  private server: net.Server | null = null;
  private connections: Map<string, IDEConnection> = new Map();
  private handlers: Map<string, (request: IDERequest, connection: IDEConnection) => Promise<unknown>> = new Map();
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
          hover: true,
          codeAction: true,
          diagnostics: true,
        },
        serverVersion: '1.0.0',
      };
    });

    // Completion handler (stub - integrate with actual AI)
    this.registerHandler('completion', async (_request) => {
      // This would integrate with the actual Grok agent
      return {
        items: [],
      };
    });

    // Ask handler
    this.registerHandler('ask', async (request) => {
      // Integrate with Grok agent
      this.emit('request:ask', request.params);

      return {
        answer: 'AI integration pending - connect to Grok agent for actual responses',
      };
    });

    // Explain handler
    this.registerHandler('explain', async (request) => {
      this.emit('request:explain', request.params);

      return {
        explanation: 'Code explanation pending - connect to Grok agent',
      };
    });

    // Refactor handler
    this.registerHandler('refactor', async (request) => {
      this.emit('request:refactor', request.params);

      return {
        refactored: request.params.code,
      };
    });

    // Suggest fix handler
    this.registerHandler('suggestFix', async (request) => {
      this.emit('request:fix', request.params);

      return {
        fix: null,
        message: 'No fix available',
      };
    });
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
