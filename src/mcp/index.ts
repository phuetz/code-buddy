/**
 * MCP Module - Model Context Protocol Integration
 *
 * This module provides two client implementations:
 * - MCPManager (client.ts): Uses the official MCP SDK, supports multiple transport types
 * - MCPClient (mcp-client.ts): Manual implementation with config file management
 *
 * For new code, prefer MCPManager as it uses the official SDK.
 */

// Shared types (no circular dependencies)
export type {
  MCPServerConfig,
  MCPTool,
  ServerStatus,
  MCPConfig,
} from "./types.js";

// SDK-based client (recommended)
export { MCPManager } from "./client.js";

// Legacy manual client (used by codebuddy-agent)
export {
  MCPClient,
  MCPResource,
  getMCPClient,
  resetMCPClient,
} from "./mcp-client.js";

// Transport implementations
export {
  TransportType,
  TransportConfig,
  MCPTransport,
  StdioTransport,
  HttpTransport,
  SSETransport,
  StreamableHttpTransport,
  createTransport,
} from "./transports.js";

// Configuration management
export {
  loadMCPConfig,
  saveMCPConfig,
  addMCPServer,
  removeMCPServer,
  getMCPServer,
  PREDEFINED_SERVERS,
  saveProjectMCPConfig,
  createMCPConfigTemplate,
  hasProjectMCPConfig,
  getMCPConfigPaths,
} from "./config.js";
