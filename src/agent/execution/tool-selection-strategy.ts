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
  getSkillAugmentedTools,
} from '../../codebuddy/tools.js';
import {
  getToolSelector,
  recordToolRequest,
  formatToolSelectionMetrics,
} from '../../tools/tool-selector.js';
import {
  filterToolsForModel,
  getModelToolConfig,
} from '../../config/model-tools.js';
import type {
  ToolCategory,
  QueryClassification,
  ToolSelectionResult,
  ToolSelectionMetrics,
} from '../../tools/types.js';
import { getPromptCacheManager } from '../../optimization/prompt-cache.js';
import { logger } from '../../utils/logger.js';
import type { UnifiedSkill } from '../../skills/types.js';
import { getSkillsHub } from '../../skills/hub.js';

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
  /**
   * Active model name. When present, model capability rules from
   * model-tools.ts are applied to the model-facing schemas before they are
   * cached or sent to the provider.
   */
  modelName?: string;
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
  /** Confidence score (0-1) based on best match score ratio */
  confidence?: number;
}

/**
 * Default configuration for tool selection
 */
const DEFAULT_CONFIG: ToolSelectionConfig = {
  useRAG: true,
  maxTools: 15,
  minScore: 0.5,
  // `remember` and `memory_propose` are force-included so the LLM can always
  // either persist explicit durable facts or queue inferred/ambiguous facts for
  // review, even on tasks where the RAG selector wouldn't otherwise surface the
  // memory tools. Paired with the auto-memory directive in `prompt-builder.ts`.
  //
  // `lessons_add`, `lessons_propose`, and `lessons_search` are force-included for
  // the same reason (Manus AI-inspired self-improvement loop) — paired with the
  // lessons directive in `prompt-builder.ts`. `lessons_propose` is the Hermes-style
  // "agent proposes, human approves" path, so the model must always see it (a
  // RAG-gated propose tool would rarely surface). `lessons_list` stays out
  // (admin-style, not needed per-turn). Wakes the dormant feature in lessons-tracker.ts.
  // `tool_search` is ALWAYS exposed so the model can discover & pull ANY tool
  // on demand when the per-query TF-IDF subset missed it (progressive disclosure,
  // like Codex/Claude). Without it, a tool outside the top-K is unreachable.
  // `create_file` pairs with `str_replace_editor`: without it an agent whose
  // RAG subset missed it can EDIT files but never CREATE one — proven live in
  // Cowork's App Studio generation ("l'outil create_file n'est pas disponible
  // dans cette session"). `apply_patch` likewise: WritePolicy strict blocks
  // direct editors and points at apply_patch, so a selection without it
  // re-opens the historical edit deadlock. `extension_forge` is the one safe,
  // confirmation-gated entry point for creating reusable runtime capabilities.
  alwaysInclude: ['view_file', 'create_file', 'str_replace_editor', 'apply_patch', 'bash', 'search', 'web_search', 'restore_context', 'remember', 'memory_propose', 'lessons_add', 'lessons_propose', 'lessons_search', 'tool_search', 'extension_forge'],
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
  private cacheModelName: string | null = null;
  private lastQuery: string = '';
  /** Query the cached tool set was selected FOR — cache hits require equality. */
  private cachedQuery: string = '';
  private lastSelection: ToolSelectionResult | null = null;
  private cacheTimestamp: number = 0;
  private activeSkill: UnifiedSkill | null = null;

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
    const mergedConfig = { ...this.config, ...options };
    // Recovery is part of the observation contract, not a relevance hint.
    // Keep it available even when a lite profile supplies a smaller
    // `alwaysInclude` override: once an earlier result was compacted, the
    // model must never be stranded without the exact callId recovery path.
    const effectiveConfig: ToolSelectionConfig = {
      ...mergedConfig,
      alwaysInclude: Array.from(new Set([...mergedConfig.alwaysInclude, 'restore_context'])),
    };
    const modelName = ToolSelectionStrategy.normalizeModelName(effectiveConfig.modelName);
    this.lastQuery = query;

    // Check if we should use cached tools. The cache exists for MULTI-ROUND
    // consistency within one turn (same query, rounds 2..N) — it must never
    // leak a PREVIOUS turn's selection into a new user query, or a turn that
    // needs text_to_speech inherits the tool set of the "pwd" turn before it
    // (observed live in Cowork: alwaysInclude apparently ignored, tools
    // "missing" at random depending on the prior turn).
    if (effectiveConfig.enableCaching && this.cachedQuery === query && this.isCacheValid(modelName)) {
      logger.debug('Using cached tools for query', { query: query.slice(0, 50), count: this.cachedTools!.length });
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

    // Augment with skill-required tools if a skill is active
    if (this.activeSkill) {
      tools = getSkillAugmentedTools(tools, this.activeSkill);
      this.cachedToolNames = tools.map(t => t.function.name);

      logger.debug('Tools augmented by active skill', {
        skill: this.activeSkill.name,
        toolCount: tools.length,
      });
    }

    tools = this.applyModelFacingSchemaFilter(tools, modelName);
    this.cachedToolNames = tools.map(t => t.function.name);
    if (selection) {
      selection = {
        ...selection,
        selectedTools: tools,
      };
      this.lastSelection = selection;
    }

    // Cache tools for prompt optimization
    const promptCacheManager = getPromptCacheManager();
    promptCacheManager.cacheTools(tools);

    // Compute confidence from selection scores
    let confidence: number | undefined;
    if (selection && selection.scores) {
      const scoreValues = Array.from(selection.scores.values());
      const maxScore = scoreValues.length > 0 ? Math.max(...scoreValues) : 0;
      confidence = Math.min(1, maxScore / 10);
    }

    return {
      tools,
      selection,
      fromCache: false,
      query,
      timestamp: new Date(),
      confidence,
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
  cacheTools(tools: CodeBuddyTool[], modelName?: string): void {
    if (!this.config.enableCaching) return;

    this.cachedTools = tools;
    this.cachedToolNames = tools.map(t => t.function.name);
    this.cacheModelName = ToolSelectionStrategy.normalizeModelName(modelName);
    this.cacheTimestamp = Date.now();
    // The executor calls this right after round 0's selection — the cache
    // belongs to the query that produced it (this turn's user message).
    this.cachedQuery = this.lastQuery;

    logger.debug('Tools cached for multi-round consistency', {
      toolCount: tools.length,
      modelName: this.cacheModelName,
    });
  }

  /**
   * Expand the CURRENT turn's cached selection with named tools — called by
   * the executor after a successful `tool_search` so a discovered tool is
   * actually invocable on the next round (the cache would otherwise re-serve
   * the same list for the rest of the turn). No-op for unknown names or when
   * no cache is active.
   */
  async expandCachedTools(names: string[]): Promise<number> {
    if (!this.config.enableCaching || !this.cachedTools || names.length === 0) return 0;
    const have = new Set(this.cachedTools.map((t) => t.function.name));
    const wanted = names.filter((n) => !have.has(n));
    if (wanted.length === 0) return 0;

    const { getAllCodeBuddyTools } = await import('../../codebuddy/tools.js');
    const all = await getAllCodeBuddyTools();
    const additions = all.filter((t) => wanted.includes(t.function.name));
    if (additions.length === 0) return 0;

    this.cachedTools = [...this.cachedTools, ...additions];
    this.cachedToolNames = this.cachedTools.map((t) => t.function.name);
    logger.debug('Tool selection cache expanded via tool_search', {
      added: additions.map((t) => t.function.name),
    });
    return additions.length;
  }

  /**
   * Get cached tools if available and valid
   *
   * @returns Cached tools or null if cache is invalid/empty
   */
  getCachedTools(modelName?: string): CodeBuddyTool[] | null {
    if (!this.config.enableCaching) return null;
    if (!this.isCacheValid(modelName)) return null;
    return this.cachedTools;
  }

  /**
   * Set the active skill for tool augmentation.
   *
   * When set, `selectToolsForQuery` will ensure all tools required by the
   * skill are included in the selection, even if RAG filtering would have
   * excluded them.
   *
   * @param skill - The matched UnifiedSkill, or null to clear
   */
  setActiveSkill(skill: UnifiedSkill | null): void {
    if (skill) {
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
        logger.warn(`Skill ${skill.name} is disabled. Skipping tool selection strategy active skill setting.`);
        this.activeSkill = null;
        return;
      }
    }
    this.activeSkill = skill;
    if (skill) {
      logger.debug('Active skill set for tool selection', { skill: skill.name });
    }
  }

  /**
   * Get the currently active skill
   */
  getActiveSkill(): UnifiedSkill | null {
    return this.activeSkill;
  }

  /**
   * Clear the tool cache
   *
   * Should be called at the start of a new conversation turn.
   */
  clearCache(): void {
    this.cachedTools = null;
    this.cachedToolNames = [];
    this.cacheModelName = null;
    this.cacheTimestamp = 0;
    this.activeSkill = null;
    logger.debug('Tool selection cache cleared');
  }

  /**
   * Check if the cache is still valid
   */
  private isCacheValid(modelName?: string | null): boolean {
    if (!this.cachedTools || this.cachedTools.length === 0) return false;
    if (this.cacheTimestamp === 0) return false;
    if (modelName !== undefined) {
      const normalizedModelName = ToolSelectionStrategy.normalizeModelName(modelName);
      if (this.cacheModelName !== normalizedModelName) return false;
    }

    const now = Date.now();
    const age = now - this.cacheTimestamp;
    return age < this.config.cacheTTLMs;
  }

  private static normalizeModelName(modelName?: string | null): string | null {
    const normalized = modelName?.trim();
    return normalized ? normalized : null;
  }

  private applyModelFacingSchemaFilter(
    tools: CodeBuddyTool[],
    modelName: string | null,
  ): CodeBuddyTool[] {
    if (!modelName || tools.length === 0) {
      return tools;
    }

    try {
      const modelConfig = getModelToolConfig(modelName);
      if (modelConfig.supportsToolCalls === false && process.env.GROK_FORCE_TOOLS !== 'true') {
        logger.debug('Model-facing tool schemas suppressed for chat-only model', {
          modelName,
          removed: tools.map(t => t.function.name),
        });
        return [];
      }

      const allowedNames = new Set(
        filterToolsForModel(
          tools.map(tool => tool.function.name),
          modelConfig,
        ),
      );
      const filtered = tools.filter(tool => allowedNames.has(tool.function.name));

      if (filtered.length !== tools.length) {
        logger.debug('Model-facing tool schemas filtered by model capabilities', {
          modelName,
          removed: tools
            .map(tool => tool.function.name)
            .filter(name => !allowedNames.has(name)),
        });
      }

      return filtered;
    } catch (error) {
      logger.debug('Model-facing tool schema filter skipped', {
        modelName,
        error: error instanceof Error ? error.message : String(error),
      });
      return tools;
    }
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
      'internet',
      'website',
      'site web',
      'documentation',
      'docs',
      'github.com',
      'http://',
      'https://',
      'stagehand',
      'browserbase',
      'mem0',
      'actualité',
      'actualite',
      'récent',
      'recent',
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
