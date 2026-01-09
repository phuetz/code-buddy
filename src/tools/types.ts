import { CodeBuddyTool } from "../codebuddy/client.js";

/**
 * Tool category for classification
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
 * Tool metadata with category and keywords
 */
export interface ToolMetadata {
  name: string;
  category: ToolCategory;
  keywords: string[];
  priority: number; // Higher = more likely to be selected
  description: string;
}

/**
 * Query classification result
 */
export interface QueryClassification {
  categories: ToolCategory[];
  confidence: number;
  keywords: string[];
  requiresMultipleTools: boolean;
}

/**
 * Tool selection result
 */
export interface ToolSelectionResult {
  selectedTools: CodeBuddyTool[];
  scores: Map<string, number>;
  classification: QueryClassification;
  reducedTokens: number;
  originalTokens: number;
}

/**
 * Metrics for tracking tool selection success
 */
export interface ToolSelectionMetrics {
  totalSelections: number;
  successfulSelections: number;  // Tool was in selected set
  missedTools: number;           // Tool requested but not selected
  missedToolNames: Map<string, number>; // Count per tool name
  successRate: number;           // successfulSelections / totalSelections
  lastUpdated: Date;
}

/**
 * Definition for a Tool in the registry
 */
export interface RegisteredTool {
  definition: CodeBuddyTool;
  metadata: ToolMetadata;
  isEnabled: () => boolean;
}
