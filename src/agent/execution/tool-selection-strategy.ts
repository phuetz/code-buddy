/**
 * Tool Selection Strategy Module
 *
 * Encapsulates the logic for selecting relevant tools for a given query.
 * Extracted from CodeBuddyAgent to improve modularity and testability.
 *
 * Features:
 * - RAG-based semantic tool selection
 * - Fallback to full tool set when RAG is disabled
 * - Tool filtering based on query classification
 * - Tool caching for multi-round consistency
 * - Selection metrics and monitoring
 *
 * Based on research from:
 * - RAG-MCP (arXiv:2505.03275)
 * - ToolLLM (ICLR'24)
 */

import type { CodeBuddyTool } from '../../codebuddy/client.js';
import {
  getAllCodeBuddyTools,
  getRelevantTools,
  classifyQuery,
} from '../../codebuddy/tools.js';
import {
  getToolSelector,
  recordToolRequest,
  formatToolSelectionMetrics,
} from '../../tools/tool-selector.js';
import type {
  ToolCategory,
  QueryClassification,
  ToolSelectionResult,
  ToolSelectionMetrics,
} from '../../tools/types.js';
import { getPromptCacheManager } from '../../optimization/prompt-cache.js';
import { logger } from '../../utils/logger.js';

// Re-export types for convenience
export type {
  ToolCategory,
  QueryClassification,
  ToolSelectionResult,
  ToolSelectionMetrics,
};

/**
 * Configuration options for tool selection strategy
 */
export interface ToolSelectionConfig {
  /** Enable RAG-based tool selection (default: true) */
  useRAG: boolean;
  /** Maximum number of tools to select (default: 15) */
  maxTools: number;
  /** Minimum score threshold for tool inclusion (default: 0.5) */
  minScore: number;
  /** Tool names that should always be included (default: core tools) */
  alwaysInclude: string[];
  /** Enable adaptive threshold based on success metrics (default: true) */
  useAdaptiveThreshold: boolean;
  /** Enable caching of selected tools for multi-round consistency (default: true) */
  enableCaching: boolean;
  /** Cache TTL in milliseconds (default: 5 minutes) */
  cacheTTLMs: number;
}

/**
 * Result of a tool selection operation
 */
export interface SelectionResult {
  /** The selected tools */
  tools: CodeBuddyTool[];
  /** The detailed selection result (null if RAG disabled) */
  selection: ToolSelectionResult | null;
  /** Whether tools were served from cache */
  fromCache: boolean;
  /** The query used for selection */
  query: string;
  /** Selection timestamp */
  timestamp: Date;
}

/**
 * Default configuration for tool selection
 */
const DEFAULT_CONFIG: ToolSelectionConfig = {
  useRAG: true,
  maxTools: 15,
  minScore: 0.5,
  alwaysInclude: ['view_file', 'bash', 'search', 'str_replace_editor'],
  useAdaptiveThreshold: true,
  enableCaching: true,
  cacheTTLMs: 5 * 60 * 1000, // 5 minutes
};

/**
 * Tool Selection Strategy
 *
 * Manages the selection of relevant tools for user queries using
 * RAG-based semantic matching or fallback strategies.
 *
 * @example
 * ```typescript
 * const strategy = new ToolSelectionStrategy();
 *
 * // Select tools for a query
 * const result = await strategy.selectToolsForQuery('read package.json');
 * console.log(result.tools.map(t => t.function.name));
 *
 * // Cache tools for multi-round consistency
 * strategy.cacheTools(result.tools);
 *
 * // Get cached tools in subsequent rounds
 * const cached = strategy.getCachedTools();
 * ```
 */
export class ToolSelectionStrategy {
  private config: ToolSelectionConfig;
  private cachedTools: CodeBuddyTool[] | null = null;
  private cachedToolNames: string[] = [];
  private lastQuery: string = '';
  private lastSelection: ToolSelectionResult | null = null;
  private cacheTimestamp: number = 0;

  /**
   * Create a new ToolSelectionStrategy instance
   *
   * @param config - Optional configuration overrides
   */
  constructor(config: Partial<ToolSelectionConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Select relevant tools for a given query
   *
   * Uses RAG-based selection when enabled, otherwise returns all tools.
   * Results are cached for prompt optimization.
   *
   * @param query - The user's query
   * @param options - Optional overrides for this selection
   * @returns Selection result with tools and metadata
   */
  async selectToolsForQuery(
    query: string,
    options: Partial<ToolSelectionConfig> = {}
  ): Promise<SelectionResult> {
    const effectiveConfig = { ...this.config, ...options };
    this.lastQuery = query;

    // Check if we should use cached tools
    if (effectiveConfig.enableCaching && this.isCacheValid()) {
      logger.debug('Using cached tools for query', { query: query.slice(0, 50) });
      return {
        tools: this.cachedTools!,
        selection: this.lastSelection,
        fromCache: true,
        query,
        timestamp: new Date(this.cacheTimestamp),
      };
    }

    let tools: CodeBuddyTool[];
    let selection: ToolSelectionResult | null = null;

    if (effectiveConfig.useRAG) {
      // Use RAG-based selection
      const result = await getRelevantTools(query, {
        maxTools: effectiveConfig.maxTools,
        useRAG: true,
        alwaysInclude: effectiveConfig.alwaysInclude,
      });

      tools = result.selectedTools;
      selection = result;
      this.lastSelection = result;
      this.cachedToolNames = result.selectedTools.map(t => t.function.name);

      logger.debug('RAG tool selection completed', {
        query: query.slice(0, 50),
        selectedCount: tools.length,
        categories: result.classification.categories,
        tokenSavings: result.originalTokens - result.reducedTokens,
      });
    } else {
      // Fallback: return all tools
      tools = await getAllCodeBuddyTools();
      this.cachedToolNames = tools.map(t => t.function.name);

      logger.debug('Using all tools (RAG disabled)', {
        query: query.slice(0, 50),
        toolCount: tools.length,
      });
    }

    // Cache tools for prompt optimization
    const promptCacheManager = getPromptCacheManager();
    promptCacheManager.cacheTools(tools);

    return {
      tools,
      selection,
      fromCache: false,
      query,
      timestamp: new Date(),
    };
  }

  /**
   * Cache tools for multi-round consistency
   *
   * Caching tools after the first round ensures consistent tool availability
   * throughout a conversation, saving ~9000 tokens on multi-round queries.
   *
   * @param tools - Tools to cache
   */
  cacheTools(tools: CodeBuddyTool[]): void {
    if (!this.config.enableCaching) return;

    this.cachedTools = tools;
    this.cachedToolNames = tools.map(t => t.function.name);
    this.cacheTimestamp = Date.now();

    logger.debug('Tools cached for multi-round consistency', {
      toolCount: tools.length,
    });
  }

  /**
   * Get cached tools if available and valid
   *
   * @returns Cached tools or null if cache is invalid/empty
   */
  getCachedTools(): CodeBuddyTool[] | null {
    if (!this.config.enableCaching) return null;
    if (!this.isCacheValid()) return null;
    return this.cachedTools;
  }

  /**
   * Clear the tool cache
   *
   * Should be called at the start of a new conversation turn.
   */
  clearCache(): void {
    this.cachedTools = null;
    this.cachedToolNames = [];
    this.cacheTimestamp = 0;
    logger.debug('Tool selection cache cleared');
  }

  /**
   * Check if the cache is still valid
   */
  private isCacheValid(): boolean {
    if (!this.cachedTools || this.cachedTools.length === 0) return false;
    if (this.cacheTimestamp === 0) return false;

    const now = Date.now();
    const age = now - this.cacheTimestamp;
    return age < this.config.cacheTTLMs;
  }

  /**
   * Record a tool request for metrics tracking
   *
   * Call this when the LLM requests a tool to track whether
   * our selection correctly included it.
   *
   * @param toolName - The tool name requested by LLM
   */
  recordToolRequest(toolName: string): void {
    if (!this.config.useRAG || !this.lastQuery) return;

    recordToolRequest(toolName, this.cachedToolNames, this.lastQuery);
  }

  /**
   * Get selection metrics for monitoring and debugging
   */
  getSelectionMetrics(): ToolSelectionMetrics {
    return getToolSelector().getMetrics();
  }

  /**
   * Format metrics as a readable string
   */
  formatSelectionMetrics(): string {
    return formatToolSelectionMetrics();
  }

  /**
   * Get the last tool selection result
   */
  getLastSelection(): ToolSelectionResult | null {
    return this.lastSelection;
  }

  /**
   * Get the last query used for tool selection
   */
  getLastQuery(): string {
    return this.lastQuery;
  }

  /**
   * Get the names of currently cached tools
   */
  getCachedToolNames(): string[] {
    return [...this.cachedToolNames];
  }

  /**
   * Check if a query should use web search
   *
   * Heuristic: enable web search only when likely needed based on
   * keywords indicating recency, current events, or external data.
   *
   * @param message - The user's message
   * @returns Whether web search should be enabled
   */
  shouldUseSearchFor(message: string): boolean {
    const q = message.toLowerCase();
    const keywords = [
      'today',
      'latest',
      'news',
      'trending',
      'breaking',
      'current',
      'now',
      'recent',
      'x.com',
      'twitter',
      'tweet',
      'what happened',
      'as of',
      'update on',
      'release notes',
      'changelog',
      'price',
    ];

    if (keywords.some((k) => q.includes(k))) return true;

    // Crude date pattern (e.g., 2024/2025) may imply recency
    if (/(20\d{2})/.test(q)) return true;

    return false;
  }

  /**
   * Classify a query to understand what types of tools might be needed
   *
   * @param query - The user's query
   * @returns Classification result with categories and confidence
   */
  classifyQuery(query: string): QueryClassification {
    return classifyQuery(query);
  }

  /**
   * Get most frequently missed tools for debugging
   *
   * @param limit - Maximum number of tools to return
   */
  getMostMissedTools(limit: number = 10): Array<{ tool: string; count: number }> {
    return getToolSelector().getMostMissedTools(limit);
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    hasCachedTools: boolean;
    cachedToolCount: number;
    cacheAge: number;
    isValid: boolean;
    classificationCache: { size: number };
    selectionCache: { size: number };
  } {
    const toolSelectorStats = getToolSelector().getCacheStats();
    const cacheAge = this.cacheTimestamp ? Date.now() - this.cacheTimestamp : 0;

    return {
      hasCachedTools: this.cachedTools !== null,
      cachedToolCount: this.cachedTools?.length ?? 0,
      cacheAge,
      isValid: this.isCacheValid(),
      ...toolSelectorStats,
    };
  }

  /**
   * Reset metrics to initial state
   */
  resetMetrics(): void {
    getToolSelector().resetMetrics();
  }

  /**
   * Clear all caches (both local and selector caches)
   */
  clearAllCaches(): void {
    this.clearCache();
    getToolSelector().clearAllCaches();
  }

  /**
   * Update configuration
   *
   * @param config - Partial configuration to merge
   */
  updateConfig(config: Partial<ToolSelectionConfig>): void {
    this.config = { ...this.config, ...config };

    // Clear cache if caching was disabled
    if (config.enableCaching === false) {
      this.clearCache();
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): Readonly<ToolSelectionConfig> {
    return { ...this.config };
  }

  /**
   * Format a summary of the last tool selection
   */
  formatLastSelectionStats(): string {
    const selection = this.lastSelection;
    if (!selection) {
      return 'No tool selection data available';
    }

    const { selectedTools, classification, reducedTokens, originalTokens } = selection;
    const tokenSavings = originalTokens > 0
      ? Math.round((1 - reducedTokens / originalTokens) * 100)
      : 0;

    const lines = [
      'Tool Selection Statistics',
      '-'.repeat(30),
      `RAG Enabled: ${this.config.useRAG ? 'Yes' : 'No'}`,
      `Selected Tools: ${selectedTools.length}`,
      `Categories: ${classification.categories.join(', ')}`,
      `Confidence: ${Math.round(classification.confidence * 100)}%`,
      `Token Savings: ~${tokenSavings}% (${originalTokens} -> ${reducedTokens})`,
      '',
      'Selected Tools:',
      ...selectedTools.map(t => `  - ${t.function.name}`),
    ];

    return lines.join('\n');
  }
}

/**
 * Singleton instance for global access
 */
let strategyInstance: ToolSelectionStrategy | null = null;

/**
 * Get the global ToolSelectionStrategy instance
 *
 * @param config - Optional configuration for first initialization
 * @returns The singleton instance
 */
export function getToolSelectionStrategy(
  config?: Partial<ToolSelectionConfig>
): ToolSelectionStrategy {
  if (!strategyInstance) {
    strategyInstance = new ToolSelectionStrategy(config);
  } else if (config) {
    strategyInstance.updateConfig(config);
  }
  return strategyInstance;
}

/**
 * Reset the singleton instance (useful for testing)
 */
export function resetToolSelectionStrategy(): void {
  if (strategyInstance) {
    strategyInstance.clearAllCaches();
  }
  strategyInstance = null;
}
