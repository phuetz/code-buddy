/**
 * Grok Tools
 *
 * Main entry point for tool definitions and management.
 * Tools are now organized in modular files under tool-definitions/.
 */

import type { CodeBuddyTool, JsonSchemaProperty } from "./client.js";
import { setDeferredMCPSchemas } from "../tools/deferred-schema-state.js";
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
import { createRegisterToolTool } from "../tools/register-tool-handler.js";
import { loadAuthoredTools } from "../agent/self-improvement/tool-skill-mutator.js";
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
  KANBAN_TOOLS,
  MESSAGING_TOOLS,
  YUANBAO_TOOLS,
  HOMEASSISTANT_TOOLS,
  MOA_TOOLS,
  SPOTIFY_TOOLS,
  X_SEARCH_TOOLS,
  FEISHU_TOOLS,
  CRON_TOOLS,
  WEB_TOOLS,
  RESEARCH_TOOLS,
  CODE_EXEC_TOOLS,
  MEETING_TOOLS,
  COMFY_RECIPE_TOOLS,
  ADVANCED_TOOLS,
  MULTIMODAL_TOOLS,
  COMPUTER_CONTROL_TOOLS,
  BROWSER_TOOLS,
  CANVAS_TOOLS,
  AGENT_TOOLS,
  FIRECRAWL_TOOLS,
  LSP_TOOLS,
  SECRETS_TOOLS,
  ADVISOR_TOOLS,
  VERIFY_TOOLS,
  DELEGATE_AGENT_TOOLS,
  BUG_FINDER_TOOLS,
  DOCUMENT_GENERATOR_TOOLS,
  ASK_USER_QUESTION_TOOLS,
  EXIT_PLAN_MODE_TOOLS,
  CODEBASE_REPLACE_TOOLS,
  MERGE_CONFLICT_TOOLS,
  VULN_SCANNER_TOOLS,
  SESSION_TOOLS,
  CODE_EXPLORER_TOOLS,
  WINDOWS_TOOLS,
} from "./tool-definitions/index.js";
import { FLEET_TOOLS } from "./fleet-tool-defs.js";

// 20 pre-authored tool definitions (wired into the registry as AUTHORED_EXTRA_TOOLS).
// Loosely-typed literal definitions → cast the group to CodeBuddyTool[] below.
import { SCAFFOLD_APP_TOOL_DEFINITION } from "../tools/scaffold-app-tool.js";
import { PROJECT_MAP_TOOL_DEFINITION } from "../tools/project-map-tool.js";
import { DEP_INSPECT_TOOL_DEFINITION } from "../tools/dep-inspect-tool.js";
import { CODE_STATS_TOOL_DEFINITION } from "../tools/code-stats-tool.js";
import { GIT_SUMMARY_TOOL_DEFINITION } from "../tools/git-summary-tool.js";
import { TODO_SCAN_TOOL_DEFINITION } from "../tools/todo-scan-tool.js";
import { JSON_QUERY_TOOL_DEFINITION } from "../tools/json-query-tool.js";
import { CSV_PREVIEW_TOOL_DEFINITION } from "../tools/csv-preview-tool.js";
import { ENV_DOCTOR_TOOL_DEFINITION } from "../tools/env-doctor-tool.js";
import { PORT_CHECK_TOOL_DEFINITION } from "../tools/port-check-tool.js";
import { LINT_PROJECT_TOOL_DEFINITION } from "../tools/lint-project-tool.js";
import { TEST_RUNNER_TOOL_DEFINITION } from "../tools/test-runner-tool.js";
import { FORMAT_PROJECT_TOOL_DEFINITION } from "../tools/format-project-tool.js";
import { BUNDLE_ANALYZE_TOOL_DEFINITION } from "../tools/bundle-analyze-tool.js";
import { BUILD_PROJECT_TOOL_DEFINITION } from "../tools/build-project-tool.js";
import { LICENSE_CHECK_TOOL_DEFINITION } from "../tools/license-check-tool.js";
import { SBOM_GENERATE_TOOL_DEFINITION } from "../tools/sbom-generate-tool.js";
import { HTTP_PROBE_TOOL_DEFINITION } from "../tools/http-probe-tool.js";
import { FILE_SEARCH_TOOL_DEFINITION } from "../tools/file-search-tool.js";
import { DIFF_FILES_TOOL_DEFINITION } from "../tools/diff-files-tool.js";

/**
 * The 20 pre-authored tools, exposed to the LLM. Their adapters are registered
 * for interactive dispatch in `ToolHandler.initializeRegistry()` via
 * `createAuthoredExtraTools()` — keep both in lockstep (dispatch ⊇ exposed).
 */
const AUTHORED_EXTRA_TOOLS: CodeBuddyTool[] = [
  SCAFFOLD_APP_TOOL_DEFINITION,
  PROJECT_MAP_TOOL_DEFINITION,
  DEP_INSPECT_TOOL_DEFINITION,
  CODE_STATS_TOOL_DEFINITION,
  GIT_SUMMARY_TOOL_DEFINITION,
  TODO_SCAN_TOOL_DEFINITION,
  JSON_QUERY_TOOL_DEFINITION,
  CSV_PREVIEW_TOOL_DEFINITION,
  ENV_DOCTOR_TOOL_DEFINITION,
  PORT_CHECK_TOOL_DEFINITION,
  LINT_PROJECT_TOOL_DEFINITION,
  TEST_RUNNER_TOOL_DEFINITION,
  FORMAT_PROJECT_TOOL_DEFINITION,
  BUNDLE_ANALYZE_TOOL_DEFINITION,
  BUILD_PROJECT_TOOL_DEFINITION,
  LICENSE_CHECK_TOOL_DEFINITION,
  SBOM_GENERATE_TOOL_DEFINITION,
  HTTP_PROBE_TOOL_DEFINITION,
  FILE_SEARCH_TOOL_DEFINITION,
  DIFF_FILES_TOOL_DEFINITION,
] as unknown as CodeBuddyTool[];

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
  CORE_TOOLS, MORPH_EDIT_TOOL, isMorphEnabled, CODE_EXEC_TOOLS,
  SEARCH_TOOLS, TODO_TOOLS, KANBAN_TOOLS, MESSAGING_TOOLS, YUANBAO_TOOLS, HOMEASSISTANT_TOOLS, MOA_TOOLS, SPOTIFY_TOOLS, X_SEARCH_TOOLS, FEISHU_TOOLS, CRON_TOOLS, WEB_TOOLS, RESEARCH_TOOLS, ADVANCED_TOOLS, MULTIMODAL_TOOLS,
  COMPUTER_CONTROL_TOOLS, BROWSER_TOOLS, CANVAS_TOOLS, REASON_TOOL, EXECUTE_CODE_TOOL,
  WINDOWS_TOOLS,
} from "./tool-definitions/index.js";

export function getBuiltinToolNames(): string[] {
  const groups: CodeBuddyTool[][] = [
    CORE_TOOLS,
    [MORPH_EDIT_TOOL],
    SEARCH_TOOLS,
    TODO_TOOLS,
    KANBAN_TOOLS,
    MESSAGING_TOOLS,
    YUANBAO_TOOLS,
    HOMEASSISTANT_TOOLS,
    MOA_TOOLS,
    SPOTIFY_TOOLS,
    X_SEARCH_TOOLS,
    FEISHU_TOOLS,
    CRON_TOOLS,
    WEB_TOOLS,
    RESEARCH_TOOLS,
    CODE_EXEC_TOOLS,
    MEETING_TOOLS,
    COMFY_RECIPE_TOOLS,
    ADVANCED_TOOLS,
    MULTIMODAL_TOOLS,
    COMPUTER_CONTROL_TOOLS,
    BROWSER_TOOLS,
    CANVAS_TOOLS,
    AGENT_TOOLS,
    FIRECRAWL_TOOLS,
    LSP_TOOLS,
    SECRETS_TOOLS,
    ADVISOR_TOOLS,
    VERIFY_TOOLS,
    DELEGATE_AGENT_TOOLS,
    BUG_FINDER_TOOLS,
    DOCUMENT_GENERATOR_TOOLS,
    ASK_USER_QUESTION_TOOLS,
    EXIT_PLAN_MODE_TOOLS,
    CODEBASE_REPLACE_TOOLS,
    MERGE_CONFLICT_TOOLS,
    VULN_SCANNER_TOOLS,
    SESSION_TOOLS,
    FLEET_TOOLS,
    CODE_EXPLORER_TOOLS,
    WINDOWS_TOOLS,
    AUTHORED_EXTRA_TOOLS,
  ];

  return Array.from(new Set(
    groups.flatMap((tools) => tools.map((tool) => tool.function.name)),
  ));
}

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

  // The legacy `register_tool` shortcut remains opt-in. Persisted authored
  // tools are always re-gated and reloaded because `extension_forge` is a
  // default, confirmation-gated authoring surface.
  if (process.env.CODEBUDDY_SELF_IMPROVE === 'true') {
    const schema = createRegisterToolTool().getSchema();
    registry.registerTool(
      { type: 'function', function: { name: schema.name, description: schema.description, parameters: schema.parameters as unknown as CodeBuddyTool['function']['parameters'] } },
      { name: schema.name, category: 'system', keywords: ['authored', 'self-extension', 'register', 'tool'], priority: 6, description: schema.description },
    );
  }
  if (process.env.CODEBUDDY_LOAD_AUTHORED_TOOLS !== 'false') {
    try {
      const loaded = loadAuthoredTools();
      if (loaded.length > 0) logger.info(`[self-improve] reloaded ${loaded.length} authored tool(s): ${loaded.join(', ')}`);
    } catch { /* persisted store optional */ }
  }

  registerGroup(SEARCH_TOOLS);
  registerGroup(TODO_TOOLS);
  registerGroup(KANBAN_TOOLS);
  registerGroup(MESSAGING_TOOLS);
  registerGroup(YUANBAO_TOOLS);
  registerGroup(HOMEASSISTANT_TOOLS);
  registerGroup(MOA_TOOLS);
  registerGroup(SPOTIFY_TOOLS);
  registerGroup(X_SEARCH_TOOLS);
  registerGroup(FEISHU_TOOLS);
  registerGroup(CRON_TOOLS);
  registerGroup(WEB_TOOLS);
  registerGroup(RESEARCH_TOOLS);
  registerGroup(CODE_EXEC_TOOLS);
  registerGroup(MEETING_TOOLS);
  registerGroup(COMFY_RECIPE_TOOLS);
  registerGroup(ADVANCED_TOOLS);
  registerGroup(MULTIMODAL_TOOLS);
  registerGroup(COMPUTER_CONTROL_TOOLS);
  registerGroup(BROWSER_TOOLS);
  registerGroup(CANVAS_TOOLS);
  registerGroup(AGENT_TOOLS);

  // Firecrawl tools — gated by API key (Native Engine v2026.3.14)
  registerGroup(FIRECRAWL_TOOLS, () => !!process.env.FIRECRAWL_API_KEY);

  // LSP rename/refactor tools
  registerGroup(LSP_TOOLS);

  // Secrets detector tools
  registerGroup(SECRETS_TOOLS);

  // Advisor tool (second opinion from a stronger reviewer)
  registerGroup(ADVISOR_TOOLS);

  // Verify tool (explicit delegation to the independent Verifier agent)
  registerGroup(VERIFY_TOOLS);

  // delegate_agent — reaches the built-in specialized agents (pdf/excel/
  // data_analysis/sql/archive/swe) via AgentRegistry.executeOn(). DataAnalysis
  // and SQL have no covering single-shot tool, so this closes a real capability
  // gap; the LLM bridge for the SWE agent is wired at boot (setDelegateAgentProvider).
  registerGroup(DELEGATE_AGENT_TOOLS);

  // find_bugs (regex static analysis) + generate_document (PPTX/DOCX/XLSX/PDF).
  // Both are finished features with real implementations that were exported but
  // never added to any exposition group — dispatched by ToolHandler now, so
  // this makes them reachable. generate_document complements the read-only
  // `document` tool (whose own output references it).
  registerGroup(BUG_FINDER_TOOLS);
  registerGroup(DOCUMENT_GENERATOR_TOOLS);

  // AskUserQuestion tool (structured multi-option mid-task questions)
  registerGroup(ASK_USER_QUESTION_TOOLS);

  // ExitPlanMode tool (request approval to leave plan mode)
  registerGroup(EXIT_PLAN_MODE_TOOLS);

  // Windows OS-specific tools (Office VBA, etc.)
  registerGroup(WINDOWS_TOOLS, () => process.platform === 'win32');

  // Codebase replace tools
  registerGroup(CODEBASE_REPLACE_TOOLS);

  // Merge-conflict resolver (resolve_conflicts) + vulnerability scanner
  // (scan_vulnerabilities). Both are dispatched by ToolHandler.initializeRegistry()
  // (createMergeConflictTools / createVulnScannerTools) but were never exposed to
  // the LLM — this closes that gap so the finished features are reachable.
  registerGroup(MERGE_CONFLICT_TOOLS);
  registerGroup(VULN_SCANNER_TOOLS);

  // Session tools — multi-agent coordination (Phase E wake of SessionToolExecutor).
  // Always available; the SessionRegistry is lazy-instantiated by getSessionRegistry()
  // singleton on first use. Persistence + cleanup timer require [multi_agent_system.sessions].enabled
  // in TOML (cf. Phase F boot wiring).
  registerGroup(SESSION_TOOLS);

  // Fleet tools — peer_delegate, list_peers (Phase (d).17). Always available;
  // peer_delegate returns a clear error when no peers are connected.
  registerGroup(FLEET_TOOLS);

  // CodeExplorer tools
  registerGroup(CODE_EXPLORER_TOOLS);

  // 20 pre-authored tools (scaffold_app, project_map, git_summary, file_search, …).
  // Dispatch adapters registered in ToolHandler.initializeRegistry() via
  // createAuthoredExtraTools() so exposition and dispatch stay in lockstep.
  registerGroup(AUTHORED_EXTRA_TOOLS);

  // tool_search — the progressive-disclosure escape hatch. The class existed
  // (ToolSearchTool, dispatched via ToolHandler.initializeRegistry) but was
  // never EXPOSED here, so the model literally could not call it and the
  // alwaysInclude('tool_search') in tool selection silently added nothing.
  registerGroup([
    {
      type: 'function',
      function: {
        name: 'tool_search',
        description:
          'Search for available tools by keyword. Use this when the tool you need is not in your current tool list — it returns matching tool names and descriptions (and loads deferred schemas).',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query — keywords describing what you need to do.',
            },
            max_results: {
              type: 'number',
              description: 'Maximum number of results (default: 10).',
            },
          },
          required: ['query'],
        },
      },
    },
  ]);

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

/** The Code Explorer engine ships under two MCP server names — `code-explorer` (user config)
 *  and `gitnexus` (the committed repo template). Match BOTH so detection/steering work
 *  regardless of which name the user wired (previously only `code-explorer` was recognized,
 *  silently un-steering anyone using the committed `gitnexus` entry). */
const CODE_EXPLORER_TOOL_RE = /^(mcp__(?:code-explorer|gitnexus)__)/;

/** Pure: the Code Explorer tool prefix present in a list of tool names, or null. Testable
 *  without a live MCP manager. */
export function matchCodeExplorerPrefix(toolNames: string[]): string | null {
  for (const name of toolNames) {
    const m = name.match(CODE_EXPLORER_TOOL_RE);
    if (m) return m[1]!;
  }
  return null;
}

/**
 * True when the Code Explorer MCP tools are connected (server named `code-explorer` OR
 * `gitnexus`). Used to conditionally steer the agent toward Code Explorer for
 * relationship/impact questions. Returns false (no behavior change) when not installed.
 */
export function isCodeExplorerAvailable(): boolean {
  try {
    return matchCodeExplorerPrefix(getMCPManager().getTools().map((t) => t.name)) !== null;
  } catch {
    return false;
  }
}

/** The live Code Explorer tool prefix (`mcp__code-explorer__` or `mcp__gitnexus__`), or null
 *  when not connected. Lets callers build the right `mcp__<server>__<op>` tool name. */
export function codeExplorerToolPrefix(): string | null {
  try {
    return matchCodeExplorerPrefix(getMCPManager().getTools().map((t) => t.name));
  } catch {
    return null;
  }
}

let mcpServersInitPromise: Promise<void> | null = null;

export function initializeMCPServers(): Promise<void> {
  if (mcpServersInitPromise) return mcpServersInitPromise;
  const run = initializeMCPServersOnce();
  const tracked = run.finally(() => {
    if (mcpServersInitPromise === tracked) mcpServersInitPromise = null;
  });
  mcpServersInitPromise = tracked;
  return tracked;
}

async function initializeMCPServersOnce(): Promise<void> {
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
    await manager.ensureServersInitialized(config);
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

/** Threshold: defer MCP schemas when there are more than this many MCP tools.
 *  Deferred tools become param-less stubs that REQUIRE a `tool_search` round
 *  before they can be called — many models skip that and fall back to `bash`,
 *  so for moderate tool counts it's better to keep full schemas and let RAG
 *  tool-selection pick the relevant ~15. Override with CODEBUDDY_MCP_DEFER_THRESHOLD. */
const DEFERRED_SCHEMA_THRESHOLD = Number(process.env.CODEBUDDY_MCP_DEFER_THRESHOLD) || 30;

// The deferred-schema STATE lives in tools/deferred-schema-state.ts so that
// tool_search reads it without importing this module (cycle break). These are
// re-exported for the existing importers of tools.ts.
export {
  getDeferredMCPSchemas,
  isDeferredSchemaMode,
  resolveDeferredSchemas,
} from '../tools/deferred-schema-state.js';

export function addMCPToolsToCodeBuddyTools(baseTools: CodeBuddyTool[]): CodeBuddyTool[] {
  if (!mcpManager) {
    return baseTools;
  }

  const mcpTools = mcpManager.getTools();

  // If below threshold, include full schemas as before
  if (mcpTools.length <= DEFERRED_SCHEMA_THRESHOLD) {
    setDeferredMCPSchemas(null);
    const codebuddyMCPTools = mcpTools.map(convertMCPToolToCodeBuddyTool);
    return [...baseTools, ...codebuddyMCPTools];
  }

  // Deferred mode: store full schemas, only send stubs to LLM
  logger.debug(`Deferred MCP schema loading active: ${mcpTools.length} tools exceed threshold ${DEFERRED_SCHEMA_THRESHOLD}`);
  const deferred = new Map<string, CodeBuddyTool>();

  const stubs: CodeBuddyTool[] = [];
  for (const mcpTool of mcpTools) {
    const full = convertMCPToolToCodeBuddyTool(mcpTool);
    deferred.set(full.function.name, full);

    // Stub: name + description only, no parameters (forces tool_search)
    stubs.push({
      type: 'function',
      function: {
        name: full.function.name,
        description: `[Deferred] ${full.function.description} — Use tool_search to get the full schema before calling this tool.`,
        parameters: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
    });
  }

  setDeferredMCPSchemas(deferred);
  return [...baseTools, ...stubs];
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
  const mcpDisabled =
    process.env.CODEBUDDY_DISABLE_MCP === 'true' ||
    process.env.CODEBUDDY_DISABLE_MCP === '1';

  if (!mcpDisabled) {
    // Initialize MCP servers if not already done.
    //
    // In interactive mode this stays fire-and-forget: a hung/slow MCP server
    // must never block a turn, and the agent self-heals across turns (a missed
    // server simply shows up on the next round).
    //
    // In headless / one-shot mode (`buddy --print`) there is no "next round" to
    // recover in, and RAG tool selection is cached after the first round — so if
    // the lazy connection loses the race against the first selection, MCP tools
    // are cached out for the entire run. We therefore await initialization here
    // unless MCP has explicitly been disabled for the process.
    const initPromise = manager.ensureServersInitialized().catch((err) => {
      // Log but don't fail - MCP servers are optional
      if (process.env.DEBUG) {
        logger.warn(`MCP initialization warning: ${err.message || String(err)}`);
      }
    });
    if (process.env.CODEBUDDY_HEADLESS === 'true') {
      await initPromise;
    }
  }

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

  // When Code Explorer (code-explorer) is connected, make the built-in graph tools
  // defer to it at the decision point — its graph is broader / more complete.
  // Conditional & non-mutating: returns fresh objects only for code_graph /
  // codebase_map, and only when a code-explorer tool is present (no change otherwise).
  const cexPrefix = codeExplorerToolPrefix(); // 'mcp__code-explorer__' | 'mcp__gitnexus__' | null
  if (cexPrefix) {
    const DEFER =
      ` NOTE: Code Explorer is available — for code-relationship, blast-radius/impact, ` +
      `dead-code and cycle questions PREFER its MCP tools (\`${cexPrefix}impact\` / \`${cexPrefix}context\` / ` +
      `\`${cexPrefix}query\` / \`${cexPrefix}find_cycles\`); use this built-in only as a fallback if it errors.`;
    allTools = allTools.map((t) =>
      t.function.name === 'code_graph' || t.function.name === 'codebase_map'
        ? { ...t, function: { ...t.function, description: (t.function.description ?? '') + DEFER } }
        : t,
    );
  }

  // Populate the `tool_search` BM25 index so the model can DISCOVER any tool on
  // demand (progressive disclosure, like Codex/Claude). It was never
  // initialized, leaving tool_search blind ("No tools found"). Index the full
  // set (built-in + MCP + plugin) so a tool outside the per-query TF-IDF subset
  // is still reachable when the model calls tool_search.
  try {
    const { initToolSearchIndex } = await import('../tools/tool-search.js');
    initToolSearchIndex(
      allTools.map((t) => ({
        name: t.function.name,
        description: t.function.description ?? '',
      })),
    );
  } catch {
    // tool-search is optional — never block tool assembly.
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

  return selectRelevantTools(query, allTools, maxTools, options.alwaysInclude);
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
import { getSkillsHub } from '../skills/hub.js';

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
  // Check if skill is disabled
  let isDisabled = false;
  try {
    const disabledSkills = new Set(
      getSkillsHub()
        .list()
        .filter((s) => s.enabled === false)
        .map((s) => s.name)
    );
    if (disabledSkills.has(skill.name)) {
      isDisabled = true;
    }
  } catch {
    // Ignored
  }
  if (skill.enabled === false) {
    isDisabled = true;
  }
  if (isDisabled) {
    return currentTools;
  }

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

  // Skill requirements must not bypass CLI/custom-agent/Fleet profile
  // filters. Re-apply the active schema filter after augmentation so a
  // disabled tool cannot reappear in the model-facing tool schema.
  return applyToolFilter([...currentTools, ...missingTools]);
}

// Initialize registry on module load
initializeToolRegistry();
