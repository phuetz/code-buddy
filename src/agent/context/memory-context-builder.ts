/**
 * Memory Context Builder Module
 *
 * Manages memory integration and context building for the agent.
 * Handles:
 * - Memory retrieval and relevance filtering
 * - Context window management
 * - Memory persistence and project context
 * - Cross-session context building
 *
 * @module agent/context
 */

import { EventEmitter } from "events";
import { logger } from "../../utils/logger.js";
import { getErrorMessage } from "../../types/errors.js";
import {
  EnhancedMemory,
  getEnhancedMemory,
  type MemoryEntry,
  type MemoryType,
  type MemoryConfig,
  type MemorySearchOptions,
} from "../../memory/index.js";

/**
 * Configuration for the MemoryContextBuilder
 */
export interface MemoryContextConfig {
  /** Whether memory system is enabled. Default: true */
  enabled: boolean;
  /** Maximum memories to include in context. Default: 10 */
  maxContextMemories: number;
  /** Minimum importance score for inclusion. Default: 0.5 */
  minImportanceScore: number;
  /** Whether to auto-save conversation to memory. Default: true */
  autoSave: boolean;
  /** Types of memories to include in context */
  includedTypes: MemoryType[];
  /** Project context path */
  projectPath?: string;
  /** Enhanced memory configuration */
  memoryConfig?: Partial<MemoryConfig>;
}

/**
 * Default configuration
 */
export const DEFAULT_MEMORY_CONTEXT_CONFIG: MemoryContextConfig = {
  enabled: true,
  maxContextMemories: 10,
  minImportanceScore: 0.5,
  autoSave: true,
  includedTypes: ["fact", "decision", "pattern", "error"],
};

/**
 * Context item built from memory
 */
export interface ContextItem {
  /** Unique identifier */
  id: string;
  /** Memory type */
  type: MemoryType;
  /** Content of the memory */
  content: string;
  /** Importance score (0-1) */
  importance: number;
  /** When the memory was created */
  createdAt: Date;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Built context result
 */
export interface BuiltContext {
  /** Context items to include */
  items: ContextItem[];
  /** Total token estimate for the context */
  estimatedTokens: number;
  /** Summary of context sources */
  sources: {
    type: MemoryType;
    count: number;
  }[];
  /** Whether context was truncated due to limits */
  truncated: boolean;
}

/**
 * Events emitted by MemoryContextBuilder
 */
export interface MemoryContextEvents {
  "context:built": { itemCount: number; estimatedTokens: number };
  "memory:saved": { type: MemoryType; id: string };
  "memory:retrieved": { count: number; query: string };
  "project:set": { path: string };
  "error": { operation: string; error: string };
}

/**
 * MemoryContextBuilder - Manages memory integration for agent context
 *
 * This class builds relevant context from the memory system for
 * inclusion in agent conversations. It handles:
 * - Semantic search across memories
 * - Importance filtering and ranking
 * - Token budget management
 * - Project-specific context
 *
 * @example
 * ```typescript
 * const builder = new MemoryContextBuilder({
 *   enabled: true,
 *   maxContextMemories: 10
 * });
 *
 * await builder.setProjectContext("/path/to/project");
 *
 * const context = await builder.buildContext("How do I fix authentication?");
 * console.log(context.items);
 * ```
 */
export class MemoryContextBuilder extends EventEmitter {
  private config: MemoryContextConfig;
  private memory: EnhancedMemory | null = null;
  private initialized: boolean = false;

  constructor(config: Partial<MemoryContextConfig> = {}) {
    super();
    this.config = { ...DEFAULT_MEMORY_CONTEXT_CONFIG, ...config };
  }

  /**
   * Initialize the memory system lazily
   */
  private getMemory(): EnhancedMemory {
    if (!this.memory) {
      this.memory = getEnhancedMemory({
        enabled: this.config.enabled,
        embeddingEnabled: true,
        useSQLite: true,
        maxMemories: 10000,
        autoSummarize: true,
        ...this.config.memoryConfig,
      });

      this.initialized = true;
    }
    return this.memory;
  }

  /**
   * Set the project context for memory operations
   */
  async setProjectContext(projectPath: string): Promise<void> {
    try {
      const memory = this.getMemory();
      await memory.setProjectContext(projectPath);
      this.config.projectPath = projectPath;
      this.emit("project:set", { path: projectPath });
      logger.debug("Project context set for memory", { path: projectPath });
    } catch (error) {
      logger.warn("Failed to set project context for memory", {
        error: getErrorMessage(error),
      });
      this.emit("error", {
        operation: "setProjectContext",
        error: getErrorMessage(error),
      });
    }
  }

  /**
   * Build context from memory for a given query
   *
   * @param query - The user's query or message
   * @param tokenBudget - Optional token budget to respect
   * @returns Built context with relevant memories
   */
  async buildContext(
    query: string,
    tokenBudget?: number
  ): Promise<BuiltContext> {
    if (!this.config.enabled) {
      return {
        items: [],
        estimatedTokens: 0,
        sources: [],
        truncated: false,
      };
    }

    try {
      const memory = this.getMemory();

      // Search for relevant memories using recall with query
      const searchOptions: MemorySearchOptions = {
        query,
        limit: this.config.maxContextMemories * 2, // Get extra for filtering
        types: this.config.includedTypes,
        minImportance: this.config.minImportanceScore,
      };

      const results = await memory.recall(searchOptions);

      this.emit("memory:retrieved", { count: results.length, query });

      // Convert to context items
      const items: ContextItem[] = results.map((entry: MemoryEntry) => ({
        id: entry.id,
        type: entry.type,
        content: entry.content,
        importance: entry.importance,
        createdAt: entry.createdAt,
        metadata: entry.metadata,
      }));

      // Sort by importance
      items.sort((a, b) => b.importance - a.importance);

      // Apply token budget if specified
      let truncated = false;
      let estimatedTokens = 0;
      const selectedItems: ContextItem[] = [];
      const sourceCount = new Map<MemoryType, number>();

      for (const item of items) {
        if (selectedItems.length >= this.config.maxContextMemories) {
          truncated = true;
          break;
        }

        // Rough token estimate (4 chars per token)
        const itemTokens = Math.ceil(item.content.length / 4);

        if (tokenBudget && estimatedTokens + itemTokens > tokenBudget) {
          truncated = true;
          break;
        }

        selectedItems.push(item);
        estimatedTokens += itemTokens;

        // Track source types
        const count = sourceCount.get(item.type) || 0;
        sourceCount.set(item.type, count + 1);
      }

      // Build sources summary
      const sources = Array.from(sourceCount.entries()).map(([type, count]) => ({
        type,
        count,
      }));

      this.emit("context:built", {
        itemCount: selectedItems.length,
        estimatedTokens,
      });

      return {
        items: selectedItems,
        estimatedTokens,
        sources,
        truncated,
      };
    } catch (error) {
      logger.warn("Failed to build memory context", {
        error: getErrorMessage(error),
      });
      this.emit("error", {
        operation: "buildContext",
        error: getErrorMessage(error),
      });

      return {
        items: [],
        estimatedTokens: 0,
        sources: [],
        truncated: false,
      };
    }
  }

  /**
   * Format context items for inclusion in system prompt
   */
  formatContextForPrompt(context: BuiltContext): string {
    if (context.items.length === 0) {
      return "";
    }

    const lines: string[] = [
      "## Relevant Context from Memory",
      "",
    ];

    for (const item of context.items) {
      const typeEmoji = this.getTypeEmoji(item.type);
      lines.push(`${typeEmoji} **${item.type}** (importance: ${(item.importance * 100).toFixed(0)}%)`);
      lines.push(item.content);
      lines.push("");
    }

    return lines.join("\n");
  }

  /**
   * Get emoji for memory type
   */
  private getTypeEmoji(type: MemoryType): string {
    const emojis: Record<MemoryType, string> = {
      fact: "📌",
      decision: "🎯",
      pattern: "🔄",
      error: "🔧",
      preference: "⚙️",
      context: "📎",
      summary: "📝",
      instruction: "📋",
      definition: "📖",
    };
    return emojis[type] || "📝";
  }

  /**
   * Save a memory entry
   */
  async saveMemory(
    content: string,
    type: MemoryType,
    metadata?: Record<string, unknown>
  ): Promise<string | null> {
    if (!this.config.enabled || !this.config.autoSave) {
      return null;
    }

    try {
      const memory = this.getMemory();
      const entry = await memory.store({
        content,
        type,
        metadata,
      });

      this.emit("memory:saved", { type, id: entry.id });
      logger.debug("Memory saved", { type, id: entry.id });

      return entry.id;
    } catch (error) {
      logger.warn("Failed to save memory", {
        error: getErrorMessage(error),
      });
      this.emit("error", {
        operation: "saveMemory",
        error: getErrorMessage(error),
      });
      return null;
    }
  }

  /**
   * Save a conversation exchange to memory
   */
  async saveConversation(
    userMessage: string,
    assistantResponse: string
  ): Promise<string | null> {
    const content = `User: ${userMessage}\nAssistant: ${assistantResponse}`;
    return this.saveMemory(content, "summary", {
      userMessage,
      assistantResponse,
    });
  }

  /**
   * Save a code pattern to memory
   */
  async saveCodePattern(
    code: string,
    language: string,
    description?: string
  ): Promise<string | null> {
    const content = description
      ? `${description}\n\`\`\`${language}\n${code}\n\`\`\``
      : `\`\`\`${language}\n${code}\n\`\`\``;

    return this.saveMemory(content, "pattern", {
      language,
      description,
    });
  }

  /**
   * Save an error solution to memory
   */
  async saveErrorSolution(
    error: string,
    solution: string,
    context?: string
  ): Promise<string | null> {
    const content = `Error: ${error}\nSolution: ${solution}${
      context ? `\nContext: ${context}` : ""
    }`;

    return this.saveMemory(content, "error", {
      error,
      solution,
      context,
    });
  }

  /**
   * Save a decision to memory
   */
  async saveDecision(
    decision: string,
    reasoning?: string
  ): Promise<string | null> {
    const content = reasoning
      ? `Decision: ${decision}\nReasoning: ${reasoning}`
      : `Decision: ${decision}`;

    return this.saveMemory(content, "decision", { reasoning });
  }

  /**
   * Get memory statistics
   */
  getStatistics(): {
    totalMemories: number;
    byType: Record<string, number>;
    projects: number;
    summaries: number;
  } | null {
    if (!this.config.enabled) {
      return null;
    }

    try {
      const memory = this.getMemory();
      return memory.getStats();
    } catch (error) {
      logger.warn("Failed to get memory statistics", {
        error: getErrorMessage(error),
      });
      return null;
    }
  }

  /**
   * Clear all memories
   */
  async clearMemories(): Promise<boolean> {
    if (!this.config.enabled) {
      return false;
    }

    try {
      const memory = this.getMemory();
      await memory.clear();
      logger.info("All memories cleared");
      return true;
    } catch (error) {
      logger.warn("Failed to clear memories", {
        error: getErrorMessage(error),
      });
      return false;
    }
  }

  /**
   * Get configuration
   */
  getConfig(): MemoryContextConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<MemoryContextConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Check if memory is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Enable or disable memory
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Dispose and cleanup
   */
  dispose(): void {
    this.removeAllListeners();
    if (this.memory) {
      this.memory.dispose();
      this.memory = null;
    }
    this.initialized = false;
  }
}

/**
 * Create a MemoryContextBuilder instance
 */
export function createMemoryContextBuilder(
  config?: Partial<MemoryContextConfig>
): MemoryContextBuilder {
  return new MemoryContextBuilder(config);
}

// Singleton instance
let builderInstance: MemoryContextBuilder | null = null;

/**
 * Get global MemoryContextBuilder instance
 */
export function getMemoryContextBuilder(
  config?: Partial<MemoryContextConfig>
): MemoryContextBuilder {
  if (!builderInstance) {
    builderInstance = createMemoryContextBuilder(config);
  }
  return builderInstance;
}

/**
 * Reset global MemoryContextBuilder
 */
export function resetMemoryContextBuilder(): void {
  if (builderInstance) {
    builderInstance.dispose();
  }
  builderInstance = null;
}
