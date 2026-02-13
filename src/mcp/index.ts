/**
 * MCP Module - Model Context Protocol Integration
 *
 * This module provides:
 * - MCPManager (client.ts): SDK-based MCP client, supports multiple transport types
 * - MCPClient (mcp-client.ts): Manual client implementation with config file management
 * - CodeBuddyMCPServer (mcp-server.ts): MCP server exposing Code Buddy tools over stdio
 *
 * For new code, prefer MCPManager (client) and CodeBuddyMCPServer (server).
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

// MCP Server (Code Buddy as a tool provider)
export { CodeBuddyMCPServer } from "./mcp-server.js";
export type { MCPToolDefinition } from "./mcp-server.js";

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
