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
