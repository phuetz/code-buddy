/**
 * Grok Tools
 *
 * Main entry point for tool definitions and management.
 * Tools are now organized in modular files under tool-definitions/.
 */

import type { CodeBuddyTool, JsonSchemaProperty } from "./client.js";
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

import { getToolRegistry } from "../tools/registry.js";
import { TOOL_METADATA } from "../tools/metadata.js";

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
export type { CodeBuddyTool, JsonSchemaProperty };
export * from "./tool-definitions/index.js";

// ============================================================================
// Tool Registry Initialization
// ============================================================================

/**
 * Export dynamic tools array (lazy-initialized)
 * @deprecated Use getAllCodeBuddyTools() or ToolRegistry directly
 */
export const CODEBUDDY_TOOLS: CodeBuddyTool[] = [];

let isRegistryInitialized = false;

/**
 * Initialize the tool registry with all built-in tools
 */
export function initializeToolRegistry(): void {
  if (isRegistryInitialized) return;

  const registry = getToolRegistry();
  const metadataMap = new Map(TOOL_METADATA.map(m => [m.name, m]));

  const registerGroup = (tools: CodeBuddyTool[], isEnabled: () => boolean = () => true) => {
    for (const tool of tools) {
      const name = tool.function.name;
      const metadata = metadataMap.get(name) || {
        name,
        category: 'utility' as const,
        keywords: [name],
        priority: 5,
        description: tool.function.description || ''
      };
      registry.registerTool(tool, metadata, isEnabled);
      
      // Also add to the legacy array for compatibility
      if (!CODEBUDDY_TOOLS.some(t => t.function.name === name)) {
        CODEBUDDY_TOOLS.push(tool);
      }
    }
  };

  // Register all tool groups
  registerGroup(CORE_TOOLS);
  
  // Register Morph tool separately with its own enabled check
  const morphMetadata = metadataMap.get('edit_file') || {
    name: 'edit_file',
    category: 'file_write' as const,
    keywords: ['edit', 'modify', 'change', 'morph'],
    priority: 9,
    description: 'High-speed file editing with Morph'
  };
  registry.registerTool(MORPH_EDIT_TOOL, morphMetadata, isMorphEnabled);
  if (!CODEBUDDY_TOOLS.some(t => t.function.name === 'edit_file')) {
    CODEBUDDY_TOOLS.push(MORPH_EDIT_TOOL);
  }

  registerGroup(SEARCH_TOOLS);
  registerGroup(TODO_TOOLS);
  registerGroup(WEB_TOOLS);
  registerGroup(ADVANCED_TOOLS);
  registerGroup(MULTIMODAL_TOOLS);

  isRegistryInitialized = true;
  logger.debug('Tool registry initialized with built-in tools');
}

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

export function convertMCPToolToCodeBuddyTool(mcpTool: MCPTool): CodeBuddyTool {
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

export function addMCPToolsToCodeBuddyTools(baseTools: CodeBuddyTool[]): CodeBuddyTool[] {
  if (!mcpManager) {
    return baseTools;
  }

  const mcpTools = mcpManager.getTools();
  const codebuddyMCPTools = mcpTools.map(convertMCPToolToCodeBuddyTool);

  return [...baseTools, ...codebuddyMCPTools];
}

export async function getAllCodeBuddyTools(): Promise<CodeBuddyTool[]> {
  // Ensure registry is initialized with built-in tools
  initializeToolRegistry();

  const manager = getMCPManager();
  // Try to initialize servers if not already done, but don't block
  manager.ensureServersInitialized().catch((err) => {
    // Log but don't block - MCP servers are optional
    if (process.env.DEBUG) {
      logger.warn(`MCP initialization warning: ${err.message || String(err)}`);
    }
  });

  const registry = getToolRegistry();
  const builtInTools = registry.getEnabledTools();
  
  const allTools = addMCPToolsToCodeBuddyTools(builtInTools);

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

  // Ensure registry is initialized
  initializeToolRegistry();

  const allTools = await getAllCodeBuddyTools();

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

// Initialize registry on module load
initializeToolRegistry();
