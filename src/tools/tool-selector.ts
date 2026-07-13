/**
 * RAG-based Tool Selection Module
 *
 * Implements semantic tool selection using TF-IDF and cosine similarity
 * to reduce prompt bloat and improve tool selection accuracy.
 *
 * Based on research from:
 * - RAG-MCP (arXiv:2505.03275)
 * - ToolLLM (ICLR'24)
 *
 * Key improvements:
 * - Reduces prompt tokens by ~50%
 * - Improves tool selection accuracy from ~13% to ~43%+ with many tools
 * - Adaptive thresholds based on success metrics
 * - LRU cache for repeated queries
 */

import { CodeBuddyTool } from "../codebuddy/client.js";
import {
  ToolCategory,
  ToolMetadata,
  QueryClassification,
  ToolSelectionResult,
  ToolSelectionMetrics
} from "./types.js";

// Re-export types for backwards compatibility
export type {
  ToolCategory,
  ToolMetadata,
  QueryClassification,
  ToolSelectionResult,
  ToolSelectionMetrics
};

/**
 * Event for when LLM requests a tool
 */
export interface ToolRequestEvent {
  requestedTool: string;
  selectedTools: string[];
  query: string;
  wasSelected: boolean;
}

export interface ToolSelectionOptions {
  /** Maximum number of tools to return (default: 10) */
  maxTools?: number;
  /** Minimum relevance score to include a tool */
  minScore?: number;
  /** Only include tools in these categories */
  includeCategories?: ToolCategory[];
  /** Exclude tools in these categories */
  excludeCategories?: ToolCategory[];
  /** Tool names to always include regardless of score */
  alwaysInclude?: string[];
  /** Whether to use dynamic thresholding based on success rate */
  useAdaptiveThreshold?: boolean;
}

/**
 * Cache entry for query classification
 */
interface CacheEntry<T> {
  value: T;
  timestamp: number;
  accessCount: number;
}

import { LRUCache } from '../utils/lru-cache.js';
import { TOOL_METADATA, CATEGORY_KEYWORDS } from "./metadata.js";

/**
 * RAG-based Tool Selector.
 * 
 * Selects the most relevant tools for a given query to reduce context window usage
 * and improve LLM adherence to tool definitions.
 * 
 * Uses a hybrid approach:
 * 1. **TF-IDF Scoring**: Matches query terms against tool keywords and descriptions.
 * 2. **Category Classification**: Classifies intent (e.g., "edit file" -> `file_write`) and boosts relevant tools.
 * 3. **Adaptive Thresholding**: Adjusts inclusion threshold based on success metrics to balance precision/recall.
 * 
 * Includes LRU caching for performance.
 */
export class ToolSelector {
  private toolIndex: Map<string, ToolMetadata>;
  private idfScores: Map<string, number>;
  private documentFrequency: Map<string, number>;
  private totalDocuments: number;

  // Metrics tracking
  private metrics: ToolSelectionMetrics;
  private requestHistory: ToolRequestEvent[] = [];
  private maxHistorySize: number = 1000;

  // Adaptive threshold
  private baseMinScore: number = 0.5;
  private adaptiveMinScore: number = 0.5;
  private adaptationRate: number = 0.1;

  // Classification cache
  private classificationCache: LRUCache<QueryClassification>;
  private selectionCache: LRUCache<ToolSelectionResult>;

  constructor() {
    this.toolIndex = new Map();
    this.idfScores = new Map();
    this.documentFrequency = new Map();
    this.totalDocuments = TOOL_METADATA.length;

    // Initialize metrics
    this.metrics = {
      totalSelections: 0,
      successfulSelections: 0,
      missedTools: 0,
      missedToolNames: new Map(),
      successRate: 1.0,
      lastUpdated: new Date()
    };

    // Initialize caches
    this.classificationCache = new LRUCache<QueryClassification>({ maxSize: 100, ttlMs: 5 * 60 * 1000 });
    this.selectionCache = new LRUCache<ToolSelectionResult>({ maxSize: 50, ttlMs: 2 * 60 * 1000 });

    this.buildIndex();
  }

  /**
   * Build the TF-IDF index from tool metadata
   */
  private buildIndex(): void {
    // Register tools
    for (const metadata of TOOL_METADATA) {
      this.toolIndex.set(metadata.name, metadata);
    }

    // Calculate document frequency for each keyword (folded, so IDF lookups
    // from folded query tokens hit the same keys)
    for (const metadata of TOOL_METADATA) {
      const uniqueKeywords = new Set(metadata.keywords.map(k => ToolSelector.foldDiacritics(k.toLowerCase())));
      for (const keyword of uniqueKeywords) {
        this.documentFrequency.set(
          keyword,
          (this.documentFrequency.get(keyword) || 0) + 1
        );
      }
    }

    // Calculate IDF scores
    for (const [keyword, df] of this.documentFrequency) {
      const idf = Math.log(this.totalDocuments / (df + 1)) + 1;
      this.idfScores.set(keyword, idf);
    }
  }

  /** Normalize a tool's keyword set exactly like query scoring does. */
  private normalizeKeywords(keywords: string[]): Set<string> {
    return new Set(keywords.map(keyword =>
      ToolSelector.foldDiacritics(keyword.toLowerCase())
    ));
  }

  /** Recompute IDF after the indexed corpus or document frequencies change. */
  private recalculateIdfScores(): void {
    this.idfScores.clear();
    for (const [keyword, df] of this.documentFrequency) {
      const idf = Math.log(this.totalDocuments / (df + 1)) + 1;
      this.idfScores.set(keyword, idf);
    }
  }

  private cloneSelectionResult(result: ToolSelectionResult): ToolSelectionResult {
    return {
      ...result,
      selectedTools: [...result.selectedTools],
      scores: new Map(result.scores),
      classification: {
        ...result.classification,
        categories: [...result.classification.categories],
        keywords: [...result.classification.keywords],
      },
    };
  }

  private getToolSetSignature(allTools: CodeBuddyTool[]): string {
    let hash = 0x811c9dc5;
    for (const tool of allTools) {
      const definition = [
        tool.function.name,
        tool.function.description,
        JSON.stringify(tool.function.parameters),
      ].join('\u0001');
      for (let index = 0; index < definition.length; index++) {
        hash ^= definition.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
      }
    }
    return `${allTools.length}:${(hash >>> 0).toString(36)}`;
  }

  private getSelectionCacheKey(
    query: string,
    allTools: CodeBuddyTool[],
    options: Required<Pick<ToolSelectionOptions,
      'maxTools' | 'minScore' | 'alwaysInclude' | 'useAdaptiveThreshold'>> &
      Pick<ToolSelectionOptions, 'includeCategories' | 'excludeCategories'>,
    effectiveMinScore: number,
  ): string {
    return JSON.stringify({
      query: query.toLowerCase().trim(),
      toolSignature: this.getToolSetSignature(allTools),
      maxTools: options.maxTools,
      minScore: options.minScore,
      effectiveMinScore,
      includeCategories: options.includeCategories ?? [],
      excludeCategories: options.excludeCategories ?? [],
      alwaysInclude: options.alwaysInclude,
      useAdaptiveThreshold: options.useAdaptiveThreshold,
    });
  }

  /**
   * Fold diacritics so accented queries match ASCII keywords: « vidéo » →
   * "video", « génère » → "genere". Without this, the \W tokenizer split
   * accented words apart ("vidéo" → "vid o") and French queries never
   * matched any media/tool keyword.
   */
  private static foldDiacritics(text: string): string {
    return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  /**
   * Tokenize and normalize a query string
   */
  private tokenize(text: string): string[] {
    return ToolSelector.foldDiacritics(text.toLowerCase())
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(token => token.length > 1);
  }

  /**
   * Calculate TF-IDF score for a query against a tool
   */
  private calculateTFIDF(queryTokens: string[], metadata: ToolMetadata): number {
    const toolKeywords = new Set(metadata.keywords.map(k => ToolSelector.foldDiacritics(k.toLowerCase())));
    let score = 0;

    // Calculate term frequency in query
    const queryTF = new Map<string, number>();
    for (const token of queryTokens) {
      queryTF.set(token, (queryTF.get(token) || 0) + 1);
    }

    // Calculate TF-IDF score
    for (const [token, tf] of queryTF) {
      // Check exact match
      if (toolKeywords.has(token)) {
        const idf = this.idfScores.get(token) || 1;
        score += tf * idf * 2; // Boost exact matches
      }

      // Check partial match (substring)
      for (const keyword of toolKeywords) {
        if (keyword.includes(token) || token.includes(keyword)) {
          const idf = this.idfScores.get(keyword) || 1;
          score += tf * idf * 0.5; // Lower weight for partial matches
        }
      }
    }

    // Apply priority boost
    score *= (1 + metadata.priority * 0.1);

    return score;
  }

  /**
   * Classify a user query into tool categories (with caching)
   */
  classifyQuery(query: string): QueryClassification {
    // Check cache first
    const cacheKey = query.toLowerCase().trim();
    const cached = this.classificationCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const tokens = this.tokenize(query);
    const queryLower = ToolSelector.foldDiacritics(query.toLowerCase());

    const categoryScores = new Map<ToolCategory, number>();
    const detectedKeywords: string[] = [];

    // Score each category
    for (const [category, rawKeywords] of Object.entries(CATEGORY_KEYWORDS) as [ToolCategory, string[]][]) {
      let score = 0;
      const keywords = rawKeywords.map((k) => ToolSelector.foldDiacritics(k));

      for (const keyword of keywords) {
        if (queryLower.includes(keyword)) {
          score += 2; // Phrase match
          detectedKeywords.push(keyword);
        }

        // Check token overlap
        const keywordTokens = keyword.split(' ');
        for (const kt of keywordTokens) {
          if (tokens.includes(kt)) {
            score += 1;
          }
        }
      }

      if (score > 0) {
        categoryScores.set(category, score);
      }
    }

    // Sort categories by score
    const sortedCategories = Array.from(categoryScores.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([cat]) => cat);

    // Calculate confidence (based on score distribution)
    const maxScore = Math.max(...categoryScores.values(), 1);
    const confidence = Math.min(maxScore / 10, 1);

    // Detect if multiple tools might be needed
    const requiresMultipleTools =
      sortedCategories.length > 1 ||
      queryLower.includes(' and ') ||
      queryLower.includes(' then ') ||
      queryLower.includes(' after ');

    // If no categories detected, return defaults
    if (sortedCategories.length === 0) {
      const defaultResult: QueryClassification = {
        categories: ['file_read', 'file_search', 'system'],
        confidence: 0.3,
        keywords: tokens,
        requiresMultipleTools: false
      };
      // Cache the default result too
      this.classificationCache.set(cacheKey, defaultResult);
      return defaultResult;
    }

    const result: QueryClassification = {
      categories: sortedCategories.slice(0, 3), // Top 3 categories
      confidence,
      keywords: [...new Set(detectedKeywords)],
      requiresMultipleTools
    };

    // Cache the result
    this.classificationCache.set(cacheKey, result);

    return result;
  }

  /**
   * Select the most relevant tools for a given query.
   * 
   * @param query - The user's natural language query
   * @param allTools - List of all available tools
   * @param options - Configuration options
   * @returns Selection result containing the filtered list of tools
   */
  selectTools(
    query: string,
    allTools: CodeBuddyTool[],
    options: ToolSelectionOptions = {}
  ): ToolSelectionResult {
    const {
      maxTools = 10,
      minScore = this.baseMinScore,
      includeCategories,
      excludeCategories,
      alwaysInclude = ['view_file', 'bash'], // Core tools always included
      useAdaptiveThreshold = true
    } = options;

    // Use adaptive threshold if enabled and we have enough data
    const effectiveMinScore = useAdaptiveThreshold && this.metrics.totalSelections > 10
      ? this.adaptiveMinScore
      : minScore;

    const cacheOptions = {
      maxTools,
      minScore,
      includeCategories,
      excludeCategories,
      alwaysInclude,
      useAdaptiveThreshold,
    };
    const cacheKey = this.getSelectionCacheKey(
      query,
      allTools,
      cacheOptions,
      effectiveMinScore,
    );
    const cachedSelection = this.selectionCache.get(cacheKey);
    if (cachedSelection) {
      return this.cloneSelectionResult(cachedSelection);
    }

    const classification = this.classifyQuery(query);
    const queryTokens = this.tokenize(query);
    const scores = new Map<string, number>();

    // Create a map of tool name to CodeBuddyTool for quick lookup
    const toolMap = new Map<string, CodeBuddyTool>();
    for (const tool of allTools) {
      toolMap.set(tool.function.name, tool);
    }

    // Score each tool
    for (const tool of allTools) {
      const toolName = tool.function.name;
      const metadata = this.toolIndex.get(toolName);

      if (metadata) {
        // Check category filters
        if (includeCategories && !includeCategories.includes(metadata.category)) {
          continue;
        }
        if (excludeCategories && excludeCategories.includes(metadata.category)) {
          continue;
        }

        // Calculate TF-IDF score
        let score = this.calculateTFIDF(queryTokens, metadata);

        // Boost if category matches classification
        if (classification.categories.includes(metadata.category)) {
          const categoryRank = classification.categories.indexOf(metadata.category);
          score *= (1 + (3 - categoryRank) * 0.3); // Higher boost for top categories
        }

        // Additional boost for always-include tools
        if (alwaysInclude.includes(toolName)) {
          score = Math.max(score, effectiveMinScore + 0.1);
        }

        scores.set(toolName, score);
      } else {
        // MCP or unknown tool - use description-based scoring
        const descTokens = this.tokenize(tool.function.description);
        let score = 0;

        for (const token of queryTokens) {
          if (descTokens.includes(token)) {
            score += 1;
          }
        }

        scores.set(toolName, score);
      }
    }

    // Sort tools by score
    const sortedTools = Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1]);

    // Select top tools
    const selectedToolNames: string[] = [];

    // First, add always-include tools if they have any relevance
    for (const name of alwaysInclude) {
      if (toolMap.has(name)) {
        selectedToolNames.push(name);
      }
    }

    // Then add high-scoring tools
    for (const [name, score] of sortedTools) {
      if (selectedToolNames.length >= maxTools) break;
      if (score < effectiveMinScore && !alwaysInclude.includes(name)) continue;
      if (!selectedToolNames.includes(name)) {
        selectedToolNames.push(name);
      }
    }

    // If we have very few tools, add some based on category
    if (selectedToolNames.length < 5) {
      for (const category of classification.categories) {
        const categoryTools = TOOL_METADATA
          .filter(m => m.category === category)
          .map(m => m.name);

        for (const toolName of categoryTools) {
          if (selectedToolNames.length >= maxTools) break;
          const score = scores.get(toolName);
          if (
            toolMap.has(toolName)
            && score !== undefined
            && score >= effectiveMinScore
            && !selectedToolNames.includes(toolName)
          ) {
            selectedToolNames.push(toolName);
          }
        }
      }
    }

    // Build selected tools array
    const selectedTools = selectedToolNames
      .map(name => toolMap.get(name))
      .filter((t): t is CodeBuddyTool => t !== undefined);

    // Calculate token savings (rough estimate)
    const originalTokens = this.estimateTokens(allTools);
    const reducedTokens = this.estimateTokens(selectedTools);

    // Compute confidence based on best match score ratio
    const maxScore = sortedTools[0]?.[1] ?? 0;
    const confidence = Math.min(1, maxScore / 10);

    const result: ToolSelectionResult = {
      selectedTools,
      scores,
      classification,
      reducedTokens,
      originalTokens,
      confidence,
    };
    this.selectionCache.set(cacheKey, this.cloneSelectionResult(result));
    return result;
  }

  /**
   * Estimate token count for tools (rough approximation)
   */
  private estimateTokens(tools: CodeBuddyTool[]): number {
    let tokens = 0;
    for (const tool of tools) {
      // Rough estimate: name + description + parameters
      tokens += tool.function.name.length / 4;
      tokens += tool.function.description.length / 4;
      tokens += JSON.stringify(tool.function.parameters).length / 4;
    }
    return Math.round(tokens);
  }

  /**
   * Get tool metadata by name
   */
  getToolMetadata(name: string): ToolMetadata | undefined {
    return this.toolIndex.get(name);
  }

  /**
   * Register a new tool (for MCP tools)
   */
  registerTool(
    name: string,
    category: ToolCategory,
    keywords: string[],
    description: string,
    priority: number = 5
  ): void {
    const metadata: ToolMetadata = {
      name,
      category,
      keywords,
      priority,
      description
    };

    const existing = this.toolIndex.get(name);
    const nextKeywords = this.normalizeKeywords(keywords);
    if (existing) {
      const previousKeywords = this.normalizeKeywords(existing.keywords);
      const metadataChanged =
        existing.category !== metadata.category ||
        existing.priority !== metadata.priority ||
        existing.description !== metadata.description ||
        previousKeywords.size !== nextKeywords.size ||
        [...previousKeywords].some(keyword => !nextKeywords.has(keyword));

      if (!metadataChanged) return;

      this.toolIndex.set(name, metadata);
      for (const keyword of previousKeywords) {
        if (nextKeywords.has(keyword)) continue;
        const nextDf = (this.documentFrequency.get(keyword) ?? 1) - 1;
        if (nextDf <= 0) this.documentFrequency.delete(keyword);
        else this.documentFrequency.set(keyword, nextDf);
      }
      for (const keyword of nextKeywords) {
        if (previousKeywords.has(keyword)) continue;
        this.documentFrequency.set(keyword, (this.documentFrequency.get(keyword) ?? 0) + 1);
      }
      this.recalculateIdfScores();
      this.selectionCache.clear();
      return;
    }

    this.toolIndex.set(name, metadata);
    this.totalDocuments++;
    for (const keyword of nextKeywords) {
      this.documentFrequency.set(keyword, (this.documentFrequency.get(keyword) ?? 0) + 1);
    }
    this.recalculateIdfScores();
    this.selectionCache.clear();
  }

  /**
   * Auto-register MCP tools by parsing their names and descriptions
   */
  registerMCPTool(tool: CodeBuddyTool): void {
    const name = tool.function.name;
    const description = tool.function.description;

    // Extract keywords from name and description
    const keywords = [
      ...this.tokenize(name.replace(/^mcp__\w+__/, '')),
      ...this.tokenize(description).slice(0, 10)
    ];

    this.registerTool(name, 'mcp', keywords, description, 4);
  }

  // ============== METRICS TRACKING ==============

  /**
   * Record a tool request from the LLM
   *
   * Call this when the LLM requests a tool to track whether
   * our RAG selection correctly included it.
   *
   * @param requestedTool - The tool name requested by LLM
   * @param selectedTools - The tools that were selected by RAG
   * @param query - The original user query
   */
  recordToolRequest(
    requestedTool: string,
    selectedTools: string[],
    query: string
  ): void {
    const wasSelected = selectedTools.includes(requestedTool);

    // Record the event
    const event: ToolRequestEvent = {
      requestedTool,
      selectedTools,
      query,
      wasSelected
    };

    // Add to history (bounded)
    this.requestHistory.push(event);
    if (this.requestHistory.length > this.maxHistorySize) {
      this.requestHistory.shift();
    }

    // Update metrics
    this.metrics.totalSelections++;
    if (wasSelected) {
      this.metrics.successfulSelections++;
    } else {
      this.metrics.missedTools++;
      const currentCount = this.metrics.missedToolNames.get(requestedTool) || 0;
      this.metrics.missedToolNames.set(requestedTool, currentCount + 1);

      // Adaptive threshold adjustment: lower threshold when we miss tools
      this.adaptiveMinScore = Math.max(
        0.1,
        this.adaptiveMinScore - this.adaptationRate
      );
    }

    // Recalculate success rate
    this.metrics.successRate = this.metrics.totalSelections > 0
      ? this.metrics.successfulSelections / this.metrics.totalSelections
      : 1.0;
    this.metrics.lastUpdated = new Date();

    // Adaptive threshold adjustment based on success rate
    if (this.metrics.totalSelections > 0 && this.metrics.totalSelections % 10 === 0) {
      this.adjustAdaptiveThreshold();
    }
  }

  /**
   * Adjust adaptive threshold based on recent performance
   */
  private adjustAdaptiveThreshold(): void {
    const targetSuccessRate = 0.95; // Target 95% success rate

    if (this.metrics.successRate < targetSuccessRate) {
      // Lower threshold to include more tools
      this.adaptiveMinScore = Math.max(0.1, this.adaptiveMinScore - this.adaptationRate);
    } else if (this.metrics.successRate > 0.99 && this.adaptiveMinScore < this.baseMinScore) {
      // Raise threshold back towards base if we're doing very well
      this.adaptiveMinScore = Math.min(
        this.baseMinScore,
        this.adaptiveMinScore + this.adaptationRate * 0.5
      );
    }
  }

  /**
   * Get current metrics
   */
  getMetrics(): ToolSelectionMetrics {
    return { ...this.metrics };
  }

  /**
   * Get most frequently missed tools
   */
  getMostMissedTools(limit: number = 10): Array<{ tool: string; count: number }> {
    return Array.from(this.metrics.missedToolNames.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([tool, count]) => ({ tool, count }));
  }

  /**
   * Get recent request history
   */
  getRequestHistory(limit: number = 50): ToolRequestEvent[] {
    return this.requestHistory.slice(-limit);
  }

  /**
   * Get current adaptive threshold
   */
  getAdaptiveThreshold(): number {
    return this.adaptiveMinScore;
  }

  /**
   * Manually set the adaptive threshold
   */
  setAdaptiveThreshold(threshold: number): void {
    this.adaptiveMinScore = Math.max(0.1, Math.min(1.0, threshold));
    this.selectionCache.clear();
  }

  /**
   * Reset metrics to initial state
   */
  resetMetrics(): void {
    this.metrics = {
      totalSelections: 0,
      successfulSelections: 0,
      missedTools: 0,
      missedToolNames: new Map(),
      successRate: 1.0,
      lastUpdated: new Date()
    };
    this.requestHistory = [];
    this.adaptiveMinScore = this.baseMinScore;
    this.selectionCache.clear();
  }

  /**
   * Format metrics as a readable string
   */
  formatMetrics(): string {
    const metrics = this.metrics;
    const missedTools = this.getMostMissedTools(5);

    const lines = [
      '📈 Tool Selection Metrics',
      '─'.repeat(30),
      `Total Selections: ${metrics.totalSelections}`,
      `Successful: ${metrics.successfulSelections} (${(metrics.successRate * 100).toFixed(1)}%)`,
      `Missed: ${metrics.missedTools}`,
      `Adaptive Threshold: ${this.adaptiveMinScore.toFixed(2)} (base: ${this.baseMinScore})`,
      `Last Updated: ${metrics.lastUpdated.toLocaleString()}`,
    ];

    if (missedTools.length > 0) {
      lines.push('', 'Most Missed Tools:');
      missedTools.forEach(({ tool, count }) => {
        lines.push(`  • ${tool}: ${count} times`);
      });
    }

    return lines.join('\n');
  }

  // ============== CACHE MANAGEMENT ==============

  /**
   * Clear classification cache
   */
  clearClassificationCache(): void {
    this.classificationCache.clear();
    this.selectionCache.clear();
  }

  /**
   * Clear selection cache
   */
  clearSelectionCache(): void {
    this.selectionCache.clear();
  }

  /**
   * Clear all caches
   */
  clearAllCaches(): void {
    this.classificationCache.clear();
    this.selectionCache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    classificationCache: { size: number };
    selectionCache: { size: number };
  } {
    return {
      classificationCache: { size: this.classificationCache.size },
      selectionCache: { size: this.selectionCache.size }
    };
  }
}

/**
 * Singleton instance
 */
let toolSelectorInstance: ToolSelector | null = null;

export function getToolSelector(): ToolSelector {
  if (!toolSelectorInstance) {
    toolSelectorInstance = new ToolSelector();
  }
  return toolSelectorInstance;
}

/**
 * Convenience function for tool selection.
 *
 * `alwaysInclude` is propagated to the underlying selector so that callers
 * (e.g. ToolSelectionStrategy) can guarantee specific tools survive RAG
 * filtering — without it, the option silently dropped on the way through
 * `getRelevantTools`.
 */
export function selectRelevantTools(
  query: string,
  allTools: CodeBuddyTool[],
  options?: ToolSelectionOptions,
): ToolSelectionResult;
export function selectRelevantTools(
  query: string,
  allTools: CodeBuddyTool[],
  maxTools?: number,
  alwaysInclude?: string[],
): ToolSelectionResult;
export function selectRelevantTools(
  query: string,
  allTools: CodeBuddyTool[],
  optionsOrMaxTools: ToolSelectionOptions | number = {},
  legacyAlwaysInclude?: string[],
): ToolSelectionResult {
  const options = typeof optionsOrMaxTools === 'number' || legacyAlwaysInclude !== undefined
    ? {
        maxTools: typeof optionsOrMaxTools === 'number' ? optionsOrMaxTools : 10,
        alwaysInclude: legacyAlwaysInclude,
      }
    : optionsOrMaxTools;
  return getToolSelector().selectTools(query, allTools, options);
}

/**
 * Record a tool request for metrics tracking
 */
export function recordToolRequest(
  requestedTool: string,
  selectedTools: string[],
  query: string
): void {
  getToolSelector().recordToolRequest(requestedTool, selectedTools, query);
}

/**
 * Get tool selection metrics
 */
export function getToolSelectionMetrics(): ToolSelectionMetrics {
  return getToolSelector().getMetrics();
}

/**
 * Format metrics as string
 */
export function formatToolSelectionMetrics(): string {
  return getToolSelector().formatMetrics();
}
