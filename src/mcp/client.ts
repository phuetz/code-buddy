import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { EventEmitter } from "events";
import { createTransport, MCPTransport, TransportType } from "./transports.js";
import { logger } from "../utils/logger.js";
import type { MCPServerConfig, MCPTool, ServerStatus } from "./types.js";

// Re-export types for backwards compatibility
export type { MCPServerConfig, MCPTool, ServerStatus } from "./types.js";

export class MCPManager extends EventEmitter {
  private clients: Map<string, Client> = new Map();
  private transports: Map<string, MCPTransport> = new Map();
  private tools: Map<string, MCPTool> = new Map();
  private serverConfigs: Map<string, MCPServerConfig> = new Map();
  private serverStatuses: Map<string, ServerStatus> = new Map();
  private retryCounts: Map<string, number> = new Map();
  private healthCheckIntervals: Map<string, NodeJS.Timeout> = new Map();
  private serverAddPromises: Map<string, Promise<void>> = new Map();
  private initializationPromise: Promise<void> | null = null;

  async addServer(config: MCPServerConfig): Promise<void> {
    if (
      this.serverStatuses.get(config.name) === 'connected' &&
      this.clients.has(config.name) &&
      this.transports.has(config.name)
    ) {
      return;
    }
    const pending = this.serverAddPromises.get(config.name);
    if (pending) return pending;

    const addPromise = this.addServerInternal(config);
    this.serverAddPromises.set(config.name, addPromise);
    try {
      await addPromise;
    } finally {
      if (this.serverAddPromises.get(config.name) === addPromise) {
        this.serverAddPromises.delete(config.name);
      }
    }
  }

  private async addServerInternal(config: MCPServerConfig): Promise<void> {
    this.serverConfigs.set(config.name, config);
    this.serverStatuses.set(config.name, 'connecting');
    
    try {
      // Handle legacy stdio-only configuration
      let transportConfig = config.transport;
      if (!transportConfig && config.command) {
        transportConfig = {
          type: 'stdio',
          command: config.command,
          args: config.args,
          env: config.env
        };
      }

      if (!transportConfig) {
        throw new Error('Transport configuration is required');
      }

      // Create transport
      const transport = createTransport(transportConfig);
      this.transports.set(config.name, transport);

      // Create client
      const client = new Client(
        {
          name: "code-buddy",
          version: "1.0.0"
        },
        {
          capabilities: {}
        }
      );

      this.clients.set(config.name, client);

      // Connect
      const sdkTransport = await transport.connect();
      await client.connect(sdkTransport);

      // Drain the captured MCP stderr to the logger. The stream only exists
      // for stdio transports created with stderr:'pipe' (see StdioTransport);
      // without a consumer the PassThrough back-pressures the child once its
      // buffer fills, so this drain is load-bearing — not just cosmetic.
      const stderrStream = (sdkTransport as { stderr?: NodeJS.ReadableStream | null }).stderr;
      if (stderrStream) {
        stderrStream.on('data', (chunk: Buffer) => {
          const text = chunk.toString().trim();
          if (text) logger.debug(`[MCP:${config.name}] ${text}`);
        });
      }

      // List available tools
      const toolsResult = await client.listTools();
      
      // Register tools
      for (const tool of toolsResult.tools) {
        const mcpTool: MCPTool = {
          name: `mcp__${config.name}__${tool.name}`,
          description: tool.description || `Tool from ${config.name} server`,
          inputSchema: tool.inputSchema,
          serverName: config.name
        };
        this.tools.set(mcpTool.name, mcpTool);
      }

      this.serverStatuses.set(config.name, 'connected');
      this.retryCounts.set(config.name, 0);
      this.startHealthCheck(config.name);

      this.emit('serverAdded', config.name, toolsResult.tools.length);
    } catch (error) {
      this.serverStatuses.set(config.name, 'error');
      this.handleServerError(config.name, error);
      throw error;
    }
  }

  private startHealthCheck(serverName: string): void {
    // Clear existing interval if any
    if (this.healthCheckIntervals.has(serverName)) {
      clearInterval(this.healthCheckIntervals.get(serverName)!);
    }

    // Ping every 30 seconds
    const interval = setInterval(async () => {
      const client = this.clients.get(serverName);
      if (!client) {
        this.stopHealthCheck(serverName);
        return;
      }

      try {
        await client.listTools(); // Simple heartbeat
      } catch (error) {
        logger.debug(`Health check failed for ${serverName}`, { error });
        this.handleServerError(serverName, error);
      }
    }, 30000);
    interval.unref?.();

    this.healthCheckIntervals.set(serverName, interval);
  }

  private stopHealthCheck(serverName: string): void {
    const interval = this.healthCheckIntervals.get(serverName);
    if (interval) {
      clearInterval(interval);
      this.healthCheckIntervals.delete(serverName);
    }
  }

  private async handleServerError(serverName: string, error: unknown): Promise<void> {
    this.emit('serverError', serverName, error);
    
    const config = this.serverConfigs.get(serverName);
    if (!config || !config.autoReconnect) return;

    const retryCount = this.retryCounts.get(serverName) || 0;
    const maxRetries = config.maxRetries ?? 5;

    if (retryCount < maxRetries) {
      this.retryCounts.set(serverName, retryCount + 1);
      const delay = Math.min(1000 * Math.pow(2, retryCount), 30000);
      
      logger.info(`Attempting to reconnect to ${serverName} in ${delay}ms (attempt ${retryCount + 1}/${maxRetries})`);
      
      setTimeout(async () => {
        try {
          await this.removeServer(serverName);
          await this.addServer(config);
        } catch (reconnectError) {
          logger.debug(`Reconnection attempt failed for ${serverName}`, { reconnectError });
        }
      }, delay);
    } else {
      logger.error(`Max reconnection attempts reached for ${serverName}`);
      this.serverStatuses.set(serverName, 'error');
    }
  }

  getServerStatus(serverName: string): ServerStatus | undefined {
    return this.serverStatuses.get(serverName);
  }

  async removeServer(serverName: string): Promise<void> {
    this.stopHealthCheck(serverName);
    this.serverStatuses.set(serverName, 'disconnected');

    // Remove tools
    for (const [toolName, tool] of this.tools.entries()) {
      if (tool.serverName === serverName) {
        this.tools.delete(toolName);
      }
    }

    // Disconnect client
    const client = this.clients.get(serverName);
    if (client) {
      try {
        await client.close();
      } catch {
        // Ignore close errors
      }
      this.clients.delete(serverName);
    }

    // Close transport
    const transport = this.transports.get(serverName);
    if (transport) {
      try {
        await transport.disconnect();
      } catch {
        // Ignore disconnect errors
      }
      this.transports.delete(serverName);
    }

    this.emit('serverRemoved', serverName);
  }

  async callTool(toolName: string, arguments_: Record<string, unknown>): Promise<CallToolResult> {
    const tool = this.tools.get(toolName);
    if (!tool) {
      throw new Error(`Tool ${toolName} not found`);
    }

    const client = this.clients.get(tool.serverName);
    if (!client) {
      throw new Error(`Server ${tool.serverName} not connected`);
    }

    // Extract the original tool name (remove mcp__servername__ prefix)
    const originalToolName = toolName.replace(`mcp__${tool.serverName}__`, '');

    return await client.callTool({
      name: originalToolName,
      arguments: arguments_
    }) as CallToolResult;
  }

  getTools(): MCPTool[] {
    return Array.from(this.tools.values());
  }

  getServers(): string[] {
    return Array.from(this.clients.keys());
  }

  async shutdown(): Promise<void> {
    const serverNames = Array.from(this.clients.keys());
    await Promise.all(serverNames.map(name => this.removeServer(name)));
  }

  /**
   * Dispose and cleanup all resources
   */
  async dispose(): Promise<void> {
    await this.shutdown();
    this.removeAllListeners();
  }

  getTransportType(serverName: string): TransportType | undefined {
    const transport = this.transports.get(serverName);
    return transport?.getType();
  }

  async ensureServersInitialized(configOverride?: { servers: MCPServerConfig[] }): Promise<void> {
    if (this.initializationPromise) return this.initializationPromise;
    const initialize = async (): Promise<void> => {
      const config = configOverride ?? (await import('./config.js')).loadMCPConfig();
      const enabledServers = config.servers.filter((server) =>
        server.enabled !== false && this.serverStatuses.get(server.name) !== 'connected'
      );
      if (enabledServers.length === 0) return;

      // Initialize servers in parallel. Each server gets its OWN timeout so a
      // hanging/unresponsive server can't block every healthy MCP server.
      const INIT_TIMEOUT_MS = Number(process.env.CODEBUDDY_MCP_INIT_TIMEOUT_MS) || 15_000;
      const initPromises = enabledServers.map(async (serverConfig) => {
        let timer: NodeJS.Timeout | undefined;
        try {
          await Promise.race([
            this.addServer(serverConfig),
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => reject(new Error(
                  `MCP server "${serverConfig.name}" init timed out after ${INIT_TIMEOUT_MS}ms — skipped so other servers still load`,
                )),
                INIT_TIMEOUT_MS,
              );
              timer.unref?.();
            }),
          ]);
        } catch (error) {
          logger.warn(`Failed to initialize MCP server ${serverConfig.name}`, { error });
        } finally {
          if (timer) clearTimeout(timer);
        }
      });

      await Promise.all(initPromises);
    };

    const run = initialize();
    this.initializationPromise = run;
    try {
      await run;
    } finally {
      if (this.initializationPromise === run) this.initializationPromise = null;
    }
  }
}
