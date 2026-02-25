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
import { applyToolFilter } from "../utils/tool-filter.js";
import { TOOL_METADATA } from "../tools/metadata.js";
import { getPluginMarketplace } from "../plugins/marketplace.js";

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
  COMPUTER_CONTROL_TOOLS,
  BROWSER_TOOLS,
  CANVAS_TOOLS,
  AGENT_TOOLS,
} from "./tool-definitions/index.js";

/**
 * Plugin tool definition interface
 */
export interface PluginToolDefinition {
  description: string;
  parameters?: {
    type: "object";
    properties: Record<string, JsonSchemaProperty>;
    required?: string[];
  };
}

// Re-export types for backwards compatibility
export type { CodeBuddyTool, JsonSchemaProperty };

// Explicit re-exports from tool-definitions (no blanket export *)
export {
  CORE_TOOLS, MORPH_EDIT_TOOL, isMorphEnabled,
  SEARCH_TOOLS, TODO_TOOLS, WEB_TOOLS, ADVANCED_TOOLS, MULTIMODAL_TOOLS,
  COMPUTER_CONTROL_TOOLS, BROWSER_TOOLS, CANVAS_TOOLS, REASON_TOOL,
} from "./tool-definitions/index.js";

// ============================================================================
// Tool Registry Initialization
// ============================================================================

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

  registerGroup(SEARCH_TOOLS);
  registerGroup(TODO_TOOLS);
  registerGroup(WEB_TOOLS);
  registerGroup(ADVANCED_TOOLS);
  registerGroup(MULTIMODAL_TOOLS);
  registerGroup(COMPUTER_CONTROL_TOOLS);
  registerGroup(BROWSER_TOOLS);
  registerGroup(CANVAS_TOOLS);
  registerGroup(AGENT_TOOLS);

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

/**
 * Convert a plugin tool definition to CodeBuddy format
 */
export function convertPluginToolToCodeBuddyTool(name: string, tool: PluginToolDefinition): CodeBuddyTool {
  return {
    type: "function",
    function: {
      name: `plugin__${name}`,
      description: tool.description,
      parameters: {
        type: "object",
        properties: tool.parameters?.properties || {},
        required: tool.parameters?.required || []
      }
    }
  };
}

/** Marketplace tool definition type */
interface MarketplaceToolDefinition {
  description: string;
  parameters: Record<string, unknown>;
  execute: (params: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Convert marketplace tool definition to plugin tool definition
 */
function convertMarketplaceToolToPluginTool(tool: MarketplaceToolDefinition): PluginToolDefinition {
  // Marketplace tools use a simpler parameters format
  // Convert to JSON Schema format expected by PluginToolDefinition
  const parameters = tool.parameters as { type?: string; properties?: Record<string, JsonSchemaProperty>; required?: string[] } | undefined;
  return {
    description: tool.description,
    parameters: parameters?.type === 'object' ? {
      type: 'object',
      properties: (parameters.properties || {}) as Record<string, JsonSchemaProperty>,
      required: parameters.required
    } : undefined
  };
}

/**
 * Collect all tools from the plugin marketplace
 */
export function addPluginToolsToCodeBuddyTools(baseTools: CodeBuddyTool[]): CodeBuddyTool[] {
  const marketplace = getPluginMarketplace();
  const pluginTools = marketplace.getTools();

  const convertedTools = pluginTools.map(name => {
    const toolDef = marketplace.getToolDefinition(name);
    if (toolDef) {
      const pluginToolDef = convertMarketplaceToolToPluginTool(toolDef);
      return convertPluginToolToCodeBuddyTool(name, pluginToolDef);
    }
    return null;
  }).filter((t): t is CodeBuddyTool => t !== null);

  return [...baseTools, ...convertedTools];
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
  
  let allTools = addMCPToolsToCodeBuddyTools(builtInTools);
  allTools = addPluginToolsToCodeBuddyTools(allTools);

  // Register MCP and Plugin tools in the tool selector for better RAG matching
  const selector = getToolSelector();
  for (const tool of allTools) {
    if (tool.function.name.startsWith('mcp__') || tool.function.name.startsWith('plugin__')) {
      selector.registerMCPTool(tool); // Reusing registerMCPTool for external tools
    }
  }

  // Apply CLI tool filter (--enabled-tools, --disabled-tools, --allowed-tools)
  allTools = applyToolFilter(allTools);

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

// ============================================================================
// Skill-Augmented Tool Selection
// ============================================================================

import type { UnifiedSkill } from '../skills/types.js';

/**
 * Augment a set of tools based on a matched skill's requirements.
 *
 * When a skill specifies `requires.tools` or `tools`, this function ensures
 * those tools are present in the selection. Missing tools are pulled from
 * the full tool registry so the LLM has everything the skill needs.
 *
 * @param currentTools - The currently selected tools (e.g. from RAG)
 * @param skill - The matched UnifiedSkill whose tool requirements should be honoured
 * @returns The augmented tool list (may be unchanged if all required tools are present)
 */
export function getSkillAugmentedTools(
  currentTools: CodeBuddyTool[],
  skill: UnifiedSkill
): CodeBuddyTool[] {
  // Collect required tool names from the skill
  const requiredToolNames: string[] = [
    ...(skill.requires?.tools ?? []),
    ...(skill.tools ?? []),
  ];

  if (requiredToolNames.length === 0) {
    return currentTools;
  }

  // Determine which required tools are missing from the current selection
  const currentNames = new Set(currentTools.map(t => t.function.name));
  const missingNames = requiredToolNames.filter(name => !currentNames.has(name));

  if (missingNames.length === 0) {
    return currentTools;
  }

  // Pull missing tools from the registry
  initializeToolRegistry();
  const registry = getToolRegistry();
  const allRegistered = registry.getEnabledTools();

  const missingTools = allRegistered.filter(t => missingNames.includes(t.function.name));

  if (missingTools.length > 0) {
    logger.debug('Skill-augmented tools added', {
      skill: skill.name,
      added: missingTools.map(t => t.function.name),
    });
  }

  return [...currentTools, ...missingTools];
}

// Initialize registry on module load
initializeToolRegistry();
