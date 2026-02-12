import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { getErrorMessage } from '../types/index.js';
import { logger } from '../utils/logger.js';

/**
 * MCP (Model Context Protocol) Client
 *
 * Implements a client for the Model Context Protocol specification.
 * Supports stdio transport for local MCP servers.
 */

export interface MCPServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled?: boolean;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: object;
}

export interface MCPResource {
  uri: string;
  name: string;
  mimeType?: string;
  description?: string;
}

interface JSONRPCRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: object;
}

interface JSONRPCResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export class MCPClient extends EventEmitter {
  private servers: Map<string, MCPServerConnection> = new Map();
  private configPath: string;

  constructor() {
    super();
    this.configPath = path.join(process.cwd(), '.codebuddy', 'mcp-servers.json');
  }

  /**
   * Load MCP server configurations from file
   */
  loadConfig(): MCPServerConfig[] {
    // Check project-level config first
    if (fs.existsSync(this.configPath)) {
      try {
        const content = fs.readFileSync(this.configPath, 'utf-8');
        const config = JSON.parse(content);
        if (!Array.isArray(config.servers)) {
          logger.warn(`Invalid MCP config in ${this.configPath}: 'servers' must be an array, returning empty list`);
          return [];
        }
        return config.servers;
      } catch (error) {
        logger.error(`Failed to load project MCP config from ${this.configPath}: ${getErrorMessage(error)}`);
        return [];
      }
    }

    // Check user-level config
    const userConfigPath = path.join(os.homedir(), '.codebuddy', 'mcp-servers.json');
    if (fs.existsSync(userConfigPath)) {
      try {
        const content = fs.readFileSync(userConfigPath, 'utf-8');
        const config = JSON.parse(content);
        if (!Array.isArray(config.servers)) {
          logger.warn(`Invalid MCP config in ${userConfigPath}: 'servers' must be an array, returning empty list`);
          return [];
        }
        return config.servers;
      } catch (error) {
        logger.error(`Failed to load user MCP config from ${userConfigPath}: ${getErrorMessage(error)}`);
        return [];
      }
    }

    return [];
  }

  /**
   * Save MCP server configuration
   */
  saveConfig(servers: MCPServerConfig[]): void {
    const dir = path.dirname(this.configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    try {
      fs.writeFileSync(this.configPath, JSON.stringify({ servers }, null, 2));
    } catch (error) {
      logger.error(`Failed to save MCP config to ${this.configPath}: ${getErrorMessage(error)}`);
      throw new Error(`Failed to save MCP configuration. Error: ${getErrorMessage(error)}`);
    }
  }

  /**
   * Connect to all configured servers
   */
  async connectAll(): Promise<void> {
    const configs = this.loadConfig();

    // Connect to all enabled servers in parallel for faster startup
    const enabledConfigs = configs.filter(config => config.enabled !== false);
    const results = await Promise.allSettled(
      enabledConfigs.map(config => this.connect(config))
    );

    // Log connection failures
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        logger.error(`Failed to connect to MCP server ${enabledConfigs[index].name}: ${getErrorMessage(result.reason)}`);
      }
    });
  }

  /**
   * Connect to a specific MCP server
   */
  async connect(config: MCPServerConfig): Promise<void> {
    if (this.servers.has(config.name)) {
      throw new Error(`MCP server "${config.name}" is already connected. Disconnect it first with disconnect("${config.name}") before reconnecting.`);
    }

    const connection = new MCPServerConnection(config);
    await connection.start();

    this.servers.set(config.name, connection);
    this.emit('server-connected', config.name);
  }

  /**
   * Disconnect from a server
   */
  async disconnect(serverName: string): Promise<void> {
    const server = this.servers.get(serverName);
    if (server) {
      await server.stop();
      this.servers.delete(serverName);
      this.emit('server-disconnected', serverName);
    }
  }

  /**
   * Disconnect from all servers
   */
  async disconnectAll(): Promise<void> {
    // Disconnect from all servers in parallel for faster shutdown
    const serverNames = Array.from(this.servers.keys());
    await Promise.allSettled(
      serverNames.map(name => this.disconnect(name))
    );
  }

  /**
   * Dispose and cleanup all resources
   */
  async dispose(): Promise<void> {
    await this.disconnectAll();
    this.removeAllListeners();
  }

  /**
   * Get all available tools from connected servers
   */
  async getAllTools(): Promise<Map<string, MCPTool[]>> {
    const allTools = new Map<string, MCPTool[]>();
    const serverEntries = Array.from(this.servers.entries());

    // Fetch tools from all servers in parallel for better performance
    const results = await Promise.allSettled(
      serverEntries.map(async ([name, server]) => {
        const tools = await server.listTools();
        return { name, tools };
      })
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        allTools.set(result.value.name, result.value.tools);
      } else {
        // Find the server name for error logging
        const index = results.indexOf(result);
        const serverName = serverEntries[index]?.[0] || 'unknown';
        logger.error(`Failed to get tools from ${serverName}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
      }
    }

    return allTools;
  }

  /**
   * Get all available resources from connected servers
   */
  async getAllResources(): Promise<Map<string, MCPResource[]>> {
    const allResources = new Map<string, MCPResource[]>();
    const serverEntries = Array.from(this.servers.entries());

    // Fetch resources from all servers in parallel for better performance
    const results = await Promise.allSettled(
      serverEntries.map(async ([name, server]) => {
        const resources = await server.listResources();
        return { name, resources };
      })
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        allResources.set(result.value.name, result.value.resources);
      } else {
        // Find the server name for error logging
        const index = results.indexOf(result);
        const serverName = serverEntries[index]?.[0] || 'unknown';
        logger.error(`Failed to get resources from ${serverName}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
      }
    }

    return allResources;
  }

  /**
   * Call a tool on a specific server
   */
  async callTool(serverName: string, toolName: string, args: object): Promise<unknown> {
    const server = this.servers.get(serverName);
    if (!server) {
      throw new Error(`MCP server "${serverName}" is not connected. Use connect() to establish a connection first, or check getConnectedServers() for available servers.`);
    }

    return server.callTool(toolName, args);
  }

  /**
   * Read a resource from a specific server
   */
  async readResource(serverName: string, uri: string): Promise<unknown> {
    const server = this.servers.get(serverName);
    if (!server) {
      throw new Error(`MCP server "${serverName}" is not connected. Use connect() to establish a connection first, or check getConnectedServers() for available servers.`);
    }

    return server.readResource(uri);
  }

  /**
   * Get list of connected servers
   */
  getConnectedServers(): string[] {
    return Array.from(this.servers.keys());
  }

  /**
   * Check if a server is connected
   */
  isConnected(serverName: string): boolean {
    return this.servers.has(serverName);
  }

  /**
   * Format status for display
   */
  formatStatus(): string {
    const servers = this.getConnectedServers();
    if (servers.length === 0) {
      return 'No MCP servers connected.\nConfigure servers in .codebuddy/mcp-servers.json';
    }

    return `Connected MCP Servers:\n${servers.map(s => `  • ${s}`).join('\n')}`;
  }
}

/**
 * Connection to a single MCP server
 */
class MCPServerConnection extends EventEmitter {
  private config: MCPServerConfig;
  private process: ChildProcess | null = null;
  private requestId = 0;
  private pendingRequests: Map<number, { resolve: (value: unknown) => void; reject: (error: unknown) => void }> = new Map();
  private buffer = '';
  private isInitializing = false; // Add flag to track initialization state

  constructor(config: MCPServerConfig) {
    super();
    this.config = config;
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.isInitializing = true;
      let settled = false;

      const settle = (error?: Error) => {
        if (settled) return;
        settled = true;
        this.isInitializing = false;
        if (error) reject(error);
        else resolve();
      };

      const env = { ...process.env, ...this.config.env };

      this.process = spawn(this.config.command, this.config.args || [], {
        env,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      this.process.on('error', (error) => {
        logger.error(`[MCP:${this.config.name}] Process error: ${getErrorMessage(error)}`);
        const err = new Error(`Failed to start MCP server "${this.config.name}": ${getErrorMessage(error)}`);
        if (this.isInitializing) {
          settle(err);
        } else {
          this.emit('error', err);
        }
      });

      this.process.on('close', (code) => {
        logger.debug(`[MCP:${this.config.name}] Process closed with code: ${code}`);
        if (this.isInitializing) {
          settle(new Error(`MCP server "${this.config.name}" exited prematurely with code ${code} during startup.`));
        }
        this.emit('close', code);
      });

      this.process.stdout?.on('data', (data) => {
        this.handleData(data.toString());
      });

      this.process.stderr?.on('data', (data) => {
        logger.debug(`[MCP:${this.config.name}] ${data.toString().trim()}`);
      });

      this.initialize()
        .then(() => settle())
        .catch((error) => settle(error));
    });
  }

  async stop(): Promise<void> {
    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests) {
      pending.reject(new Error('MCP server connection closed'));
    }
    this.pendingRequests.clear();

    if (this.process) {
      this.process.removeAllListeners();
      this.process.stdout?.removeAllListeners();
      this.process.stderr?.removeAllListeners();
      this.process.kill();
      this.process = null;
    }
  }

  private async initialize(): Promise<void> {
    await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {},
        resources: {}
      },
      clientInfo: {
        name: 'code-buddy',
        version: '1.0.0'
      }
    });

    await this.sendNotification('notifications/initialized', {});
  }

  private handleData(data: string): void {
    this.buffer += data;

    // Try to parse complete JSON-RPC messages
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.trim()) {
        try {
          const message = JSON.parse(line) as JSONRPCResponse;
          this.handleMessage(message);
        } catch (error) {
          logger.error(`Failed to parse MCP message: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  }

  private handleMessage(message: JSONRPCResponse): void {
    if (message.id === undefined) {
      logger.debug(`[MCP:${this.config.name}] Received JSON-RPC message without an ID: ${JSON.stringify(message)}`);
      return; // Ignore notifications or malformed responses without an ID
    }

    const pending = this.pendingRequests.get(message.id);
    if (pending) {
      this.pendingRequests.delete(message.id);

      if (message.error) {
        pending.reject(new Error(message.error.message));
      } else {
        pending.resolve(message.result);
      }
    }
  }

  private async sendRequest(method: string, params?: object): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;

      const request: JSONRPCRequest = {
        jsonrpc: '2.0',
        id,
        method,
        params
      };

      this.pendingRequests.set(id, { resolve, reject });

      if (this.process?.stdin) {
        this.process.stdin.write(JSON.stringify(request) + '\n');
      } else {
        reject(new Error('MCP server process not started. The server command may have failed to launch or exited unexpectedly.'));
      }

      // Timeout after 30 seconds
      const timeoutId = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('MCP request timed out after 30 seconds. The server may be unresponsive or processing a long operation.'));
        }
      }, 30000);

      // Wrap resolve/reject to clear timeout when response arrives
      const originalEntry = this.pendingRequests.get(id);
      if (originalEntry) {
        const origResolve = originalEntry.resolve;
        const origReject = originalEntry.reject;
        this.pendingRequests.set(id, {
          resolve: (value: unknown) => { clearTimeout(timeoutId); origResolve(value); },
          reject: (err: unknown) => { clearTimeout(timeoutId); origReject(err); },
        });
      }
    });
  }

  private sendNotification(method: string, params?: object): void {
    const notification = {
      jsonrpc: '2.0',
      method,
      params
    };

    if (this.process?.stdin) {
      this.process.stdin.write(JSON.stringify(notification) + '\n');
    }
  }

  async listTools(): Promise<MCPTool[]> {
    const result = await this.sendRequest('tools/list', {}) as { tools?: MCPTool[] };
    return result.tools || [];
  }

  async listResources(): Promise<MCPResource[]> {
    const result = await this.sendRequest('resources/list', {}) as { resources?: MCPResource[] };
    return result.resources || [];
  }

  async callTool(name: string, args: object): Promise<unknown> {
    const result = await this.sendRequest('tools/call', {
      name,
      arguments: args
    });
    return result;
  }

  async readResource(uri: string): Promise<unknown> {
    const result = await this.sendRequest('resources/read', { uri });
    return result;
  }
}

// Singleton instance
let mcpClientInstance: MCPClient | null = null;

export function getMCPClient(): MCPClient {
  if (!mcpClientInstance) {
    mcpClientInstance = new MCPClient();
  }
  return mcpClientInstance;
}

export async function resetMCPClient(): Promise<void> {
  if (mcpClientInstance) {
    await mcpClientInstance.dispose();
  }
  mcpClientInstance = null;
}
