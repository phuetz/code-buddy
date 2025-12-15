/**
 * Grok Tools
 *
 * Main entry point for tool definitions and management.
 * Tools are now organized in modular files under tool-definitions/.
 */

import type { GrokTool, JsonSchemaProperty } from "./client.js";
import { MCPManager, MCPTool } from "../mcp/client.js";
import { loadMCPConfig } from "../mcp/config.js";
import {
  getToolSelector,
  selectRelevantTools,
  ToolSelectionResult,
  QueryClassification,
  ToolCategory
} from "../tools/tool-selector.js";
import { logger } from "../utils/logger.js";

// Import modular tool definitions
import {
  CORE_TOOLS,
  MORPH_EDIT_TOOL,
  isMorphEnabled,
  SEARCH_TOOLS,
  TODO_TOOLS,
  WEB_TOOLS,
  ADVANCED_TOOLS,
  MULTIMODAL_TOOLS,
} from "./tool-definitions/index.js";

// Re-export types and individual tools for backwards compatibility
export type { GrokTool, JsonSchemaProperty };
export * from "./tool-definitions/index.js";

// ============================================================================
// Tool Assembly
// ============================================================================

/**
 * Build the complete tools array with all enabled tools
 */
function buildGrokTools(): GrokTool[] {
  // Start with core tools
  const tools = [...CORE_TOOLS];

  // Add Morph Fast Apply tool if API key is available
  if (isMorphEnabled()) {
    tools.splice(3, 0, MORPH_EDIT_TOOL); // Insert after str_replace_editor
  }

  // Add search tools
  tools.push(...SEARCH_TOOLS);

  // Add todo tools
  tools.push(...TODO_TOOLS);

  // Add web tools
  tools.push(...WEB_TOOLS);

  // Add advanced tools
  tools.push(...ADVANCED_TOOLS);

  // Add multimodal tools
  tools.push(...MULTIMODAL_TOOLS);

  return tools;
}

/**
 * Export dynamic tools array
 */
export const GROK_TOOLS: GrokTool[] = buildGrokTools();

// ============================================================================
// MCP Integration
// ============================================================================

// Global MCP manager instance
let mcpManager: MCPManager | null = null;

export function getMCPManager(): MCPManager {
  if (!mcpManager) {
    mcpManager = new MCPManager();
  }
  return mcpManager;
}

export async function initializeMCPServers(): Promise<void> {
  const manager = getMCPManager();
  const config = loadMCPConfig();

  // Store original stderr.write
  const originalStderrWrite = process.stderr.write.bind(process.stderr);

  // Temporarily suppress stderr to hide verbose MCP connection logs
  process.stderr.write = ((chunk: string | Uint8Array, encoding?: BufferEncoding | ((err?: Error | null) => void), callback?: (err?: Error | null) => void): boolean => {
    // Handle overloaded signature
    const enc = typeof encoding === 'function' ? undefined : encoding;
    const cb = typeof encoding === 'function' ? encoding : callback;

    // Filter out mcp-remote verbose logs
    const chunkStr = chunk.toString();
    if (chunkStr.includes('[') && (
        chunkStr.includes('Using existing client port') ||
        chunkStr.includes('Connecting to remote server') ||
        chunkStr.includes('Using transport strategy') ||
        chunkStr.includes('Connected to remote server') ||
        chunkStr.includes('Local STDIO server running') ||
        chunkStr.includes('Proxy established successfully') ||
        chunkStr.includes('Local→Remote') ||
        chunkStr.includes('Remote→Local')
      )) {
      // Suppress these verbose logs
      if (cb) cb();
      return true;
    }

    // Allow other stderr output
    if (enc) {
      return originalStderrWrite(chunk, enc, cb);
    } else {
      return originalStderrWrite(chunk, cb);
    }
  }) as typeof process.stderr.write;

  try {
    for (const serverConfig of config.servers) {
      try {
        await manager.addServer(serverConfig);
      } catch (error) {
        logger.warn(`Failed to initialize MCP server ${serverConfig.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } finally {
    // Restore original stderr.write
    process.stderr.write = originalStderrWrite;
  }
}

export function convertMCPToolToGrokTool(mcpTool: MCPTool): GrokTool {
  return {
    type: "function",
    function: {
      name: mcpTool.name,
      description: mcpTool.description,
      parameters: (mcpTool.inputSchema as { type: "object"; properties: Record<string, JsonSchemaProperty>; required: string[] }) || {
        type: "object",
        properties: {},
        required: []
      }
    }
  };
}

export function addMCPToolsToGrokTools(baseTools: GrokTool[]): GrokTool[] {
  if (!mcpManager) {
    return baseTools;
  }

  const mcpTools = mcpManager.getTools();
  const grokMCPTools = mcpTools.map(convertMCPToolToGrokTool);

  return [...baseTools, ...grokMCPTools];
}

export async function getAllGrokTools(): Promise<GrokTool[]> {
  const manager = getMCPManager();
  // Try to initialize servers if not already done, but don't block
  manager.ensureServersInitialized().catch((err) => {
    // Log but don't block - MCP servers are optional
    if (process.env.DEBUG) {
      logger.warn(`MCP initialization warning: ${err.message || String(err)}`);
    }
  });

  const allTools = addMCPToolsToGrokTools(GROK_TOOLS);

  // Register MCP tools in the tool selector for better RAG matching
  const selector = getToolSelector();
  for (const tool of allTools) {
    if (tool.function.name.startsWith('mcp__')) {
      selector.registerMCPTool(tool);
    }
  }

  return allTools;
}

// ============================================================================
// Tool Selection (RAG-based)
// ============================================================================

/**
 * Get relevant tools for a specific query using RAG-based selection
 *
 * This reduces prompt bloat and improves tool selection accuracy
 * by only including tools that are semantically relevant to the query.
 *
 * @param query - The user's query
 * @param options - Selection options
 * @returns Selected tools and metadata
 */
export async function getRelevantTools(
  query: string,
  options: {
    maxTools?: number;
    minScore?: number;
    includeCategories?: ToolCategory[];
    excludeCategories?: ToolCategory[];
    alwaysInclude?: string[];
    useRAG?: boolean;
  } = {}
): Promise<ToolSelectionResult> {
  const { useRAG = true, maxTools = 15 } = options;

  const allTools = await getAllGrokTools();

  // If RAG is disabled, return all tools
  if (!useRAG) {
    return {
      selectedTools: allTools,
      scores: new Map(allTools.map(t => [t.function.name, 1])),
      classification: {
        categories: ['file_read', 'file_write', 'system'] as ToolCategory[],
        confidence: 1,
        keywords: [],
        requiresMultipleTools: true
      },
      reducedTokens: 0,
      originalTokens: 0
    };
  }

  return selectRelevantTools(query, allTools, maxTools);
}

/**
 * Classify a query to understand what types of tools are needed
 */
export function classifyQuery(query: string): QueryClassification {
  return getToolSelector().classifyQuery(query);
}

/**
 * Get the tool selector instance for advanced usage
 */
export { getToolSelector };

/**
 * Re-export types for convenience
 */
export type { ToolSelectionResult, QueryClassification, ToolCategory };
