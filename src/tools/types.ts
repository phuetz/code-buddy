import { CodeBuddyTool } from "../codebuddy/client.js";

/**
 * Categorization of tools for semantic grouping and selection.
 * Used by the RAG system to filter relevant tools based on user intent.
 */
export type ToolCategory =
  | 'file_read'      // Reading files and directories
  | 'file_write'     // Creating and editing files
  | 'file_search'    // Searching for files or content
  | 'system'         // Bash commands, system operations
  | 'git'            // Version control operations
  | 'web'            // Web search and fetch
  | 'planning'       // Todo lists, task planning
  | 'media'          // Images, audio, video, screenshots
  | 'document'       // PDFs, Office docs, archives
  | 'utility'        // QR codes, diagrams, exports
  | 'codebase'       // Code analysis, refactoring
  | 'mcp';           // External MCP tools

/**
 * Side-effect class declared on each catalog tool (C5).
 *
 * - `read` — observation only (no durable mutation, no outbound send, no spawn/kill)
 * - `reversible` — mutation that CheckpointManager or a known inverse can undo
 * - `emission` — irreversible send: network, message, spawn, kill, clipboard overwrite
 *
 * Additive: missing at runtime is `unknown`, never claimed reversible.
 */
export type ToolEffectClass = 'read' | 'reversible' | 'emission';

export const TOOL_EFFECT_CLASSES: readonly ToolEffectClass[] = [
  'read',
  'reversible',
  'emission',
];

/**
 * Metadata associated with a tool for selection and display purposes.
 */
export interface ToolMetadata {
  /** Unique name of the tool (must match function name) */
  name: string;
  /** Primary category of the tool */
  category: ToolCategory;
  /** List of keywords for TF-IDF search and semantic matching */
  keywords: string[];
  /** Selection priority (higher = more likely to be selected) */
  priority: number;
  /** Human-readable description */
  description: string;
  /**
   * Declared side-effect class. Catalog tools must set this; MCP/authored
   * tools may omit it (`unknown` at resolve time, unique warning).
   */
  effect?: ToolEffectClass;
  /**
   * Whether this tool is safe to expose to remote peers via A2A / fleet.
   *
   * Default `false` (opt-in). A tool MUST satisfy ALL of:
   *   - read-only OR strictly bounded side effects (no arbitrary code exec,
   *     no host-side mutation that the local user hasn't explicitly authorized)
   *   - cannot exfiltrate secrets (env, ~/.ssh, ~/.aws, credentials)
   *   - cannot drive UI input (keyboard/mouse synthesis)
   *   - bounded resource usage (no unbounded loops, sub-process forks, etc.)
   *
   * The fleet event bus and A2A executor inspect this flag before allowing
   * a peer-originated invocation. Tools without `fleetSafe: true` are
   * silently filtered out from peer-visible tool lists.
   */
  fleetSafe?: boolean;
}

/**
 * Result of classifying a user query into tool categories.
 */
export interface QueryClassification {
  /** Top categories identified in the query */
  categories: ToolCategory[];
  /** Confidence score (0-1) of the classification */
  confidence: number;
  /** Keywords detected in the query */
  keywords: string[];
  /** Whether the query implies multiple tools might be needed */
  requiresMultipleTools: boolean;
}

/**
 * Result of the tool selection process.
 */
export interface ToolSelectionResult {
  /** The subset of tools selected for the query */
  selectedTools: CodeBuddyTool[];
  /** Relevance scores for each tool (name -> score) */
  scores: Map<string, number>;
  /** Classification details used for selection */
  classification: QueryClassification;
  /** Estimated token count of the selected tools */
  reducedTokens: number;
  /** Estimated token count if all tools were included */
  originalTokens: number;
  /** Overall confidence in tool selection (0-1), based on best match score ratio */
  confidence?: number;
}

/**
 * Metrics for tracking tool selection performance.
 */
export interface ToolSelectionMetrics {
  /** Total number of selection operations performed */
  totalSelections: number;
  /** Number of times the requested tool was in the selected set */
  successfulSelections: number;
  /** Number of times the requested tool was missing from the selected set */
  missedTools: number;
  /** Map of tool names to miss counts */
  missedToolNames: Map<string, number>;
  /** Current success rate (0-1) */
  successRate: number;
  /** Timestamp of the last update */
  lastUpdated: Date;
}

/**
 * Complete definition of a tool within the registry.
 */
export interface RegisteredTool {
  /** The tool definition for the LLM (OpenAI format) */
  definition: CodeBuddyTool;
  /** Metadata for internal use */
  metadata: ToolMetadata;
  /** Function to check if tool is currently enabled */
  isEnabled: () => boolean;
}
