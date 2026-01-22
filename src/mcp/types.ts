/**
 * Shared types for MCP module
 * This file breaks circular dependencies between client.ts and config.ts
 */

import { TransportConfig } from "./transports.js";

export interface MCPServerConfig {
  name: string;
  transport: TransportConfig;
  // Legacy support for stdio-only configs
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  /** Optional: Auto-reconnect if connection is lost */
  autoReconnect?: boolean;
  /** Optional: Max reconnection attempts */
  maxRetries?: number;
}

export type ServerStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  serverName: string;
}

export interface MCPConfig {
  servers: MCPServerConfig[];
}
