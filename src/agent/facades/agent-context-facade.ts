/**
 * Agent Context Facade
 *
 * Encapsulates all context and memory management operations for agents.
 * This facade handles:
 * - Token counting and context window management
 * - Memory system (cross-session persistence)
 * - Context statistics and compression
 */

import type { TokenCounter } from '../../utils/token-counter.js';
import type { ContextManagerV2 } from '../../context/context-manager-v2.js';
import type { CodeBuddyMessage } from '../../codebuddy/client.js';
import { getEnhancedMemory, EnhancedMemory, type MemoryEntry, type MemoryType } from '../../memory/index.js';
import { getErrorMessage } from '../../errors/index.js';
import { logger } from '../../utils/logger.js';

/**
 * Configuration for context management
 */
export interface ContextConfig {
  maxContextTokens?: number;
  responseReserveTokens?: number;
  recentMessagesCount?: number;
  enableSummarization?: boolean;
  compressionRatio?: number;
}

/**
 * Statistics about context usage
 */
export interface ContextStats {
  totalTokens: number;
  maxTokens: number;
  usagePercent: number;
  isCritical: boolean;
  isNearLimit: boolean;
  messageCount: number;
  summarizedSessions: number;
}

/**
 * Memory statistics
 */
export interface MemoryStats {
  totalMemories: number;
  byType: Record<string, number>;
  projects: number;
  summaries: number;
}

/**
 * Dependencies required by AgentContextFacade
 */
export interface AgentContextFacadeDeps {
  tokenCounter: TokenCounter;
  contextManager: ContextManagerV2;
  getSessionId: () => string | undefined;
}

/**
 * Facade for context and memory management in agents.
 *
 * Responsibilities:
 * - Token counting and context window monitoring
 * - Memory storage, retrieval, and summarization
 * - Context statistics and configuration
 */
export class AgentContextFacade {
  private readonly tokenCounter: TokenCounter;
  private readonly contextManager: ContextManagerV2;
  private readonly getSessionId: () => string | undefined;

  private _memory: EnhancedMemory | null = null;
  private memoryEnabled = true;

  constructor(deps: AgentContextFacadeDeps) {
    this.tokenCounter = deps.tokenCounter;
    this.contextManager = deps.contextManager;
    this.getSessionId = deps.getSessionId;
  }

  // ============================================================================
  // Memory System (Lazy-loaded)
  // ============================================================================

  /**
   * Get or initialize the memory system
   */
  private get memory(): EnhancedMemory {
    if (!this._memory) {
      this._memory = getEnhancedMemory({
        enabled: this.memoryEnabled,
        embeddingEnabled: true,
        useSQLite: true,
        maxMemories: 10000,
        autoSummarize: true,
      });

      const cwd = process.cwd();
      if (cwd) {
        this._memory.setProjectContext(cwd).catch(err => {
          logger.warn('Failed to set project context for memory', { error: getErrorMessage(err) });
        });
      }
    }
    return this._memory;
  }

  // ============================================================================
  // Context Management
  // ============================================================================

  /**
   * Get context statistics for the current messages
   */
  getStats(messages: CodeBuddyMessage[]): ContextStats {
    return this.contextManager.getStats(messages);
  }

  /**
   * Format context statistics as a human-readable string
   */
  formatStats(messages: CodeBuddyMessage[]): string {
    const stats = this.contextManager.getStats(messages);
    const status =
      stats.isCritical ? '🔴 Critical' : stats.isNearLimit ? '🟡 Warning' : '🟢 Normal';
    return `Context: ${stats.totalTokens}/${stats.maxTokens} tokens (${stats.usagePercent.toFixed(1)}%) ${status} | Messages: ${stats.messageCount} | Summaries: ${stats.summarizedSessions}`;
  }

  /**
   * Update context manager configuration
   */
  updateConfig(config: ContextConfig): void {
    this.contextManager.updateConfig(config);
  }

  /**
   * Get the context manager instance (for advanced operations)
   */
  getContextManager(): ContextManagerV2 {
    return this.contextManager;
  }

  /**
   * Get the token counter instance (for advanced operations)
   */
  getTokenCounter(): TokenCounter {
    return this.tokenCounter;
  }

  // ============================================================================
  // Memory Operations
  // ============================================================================

  /**
   * Store a memory entry
   */
  async remember(
    type: MemoryType,
    content: string,
    options: {
      summary?: string;
      importance?: number;
      tags?: string[];
      metadata?: Record<string, unknown>;
    } = {}
  ): Promise<MemoryEntry> {
    if (!this.memoryEnabled) {
      throw new Error('Memory system is disabled');
    }
    return this.memory.store({ type, content, ...options });
  }

  /**
   * Recall memories matching the query
   */
  async recall(
    query?: string,
    options: {
      types?: MemoryType[];
      tags?: string[];
      limit?: number;
      minImportance?: number;
    } = {}
  ): Promise<MemoryEntry[]> {
    if (!this.memoryEnabled) return [];
    return this.memory.recall({ query, ...options });
  }

  /**
   * Build context string from relevant memories
   */
  async getMemoryContext(query?: string): Promise<string> {
    if (!this.memoryEnabled) return '';
    return this.memory.buildContext({
      query,
      includePreferences: true,
      includeProject: true,
      includeRecentSummaries: true,
    });
  }

  /**
   * Store a conversation summary for long-term memory
   */
  async storeConversationSummary(
    summary: string,
    topics: string[],
    decisions: string[] | undefined,
    messageCount: number
  ): Promise<void> {
    if (!this.memoryEnabled) return;
    const sessionId = this.getSessionId() || `session-${Date.now()}`;
    await this.memory.storeSummary({
      sessionId,
      summary,
      topics,
      decisions,
      messageCount,
    });
  }

  // ============================================================================
  // Memory Configuration
  // ============================================================================

  /**
   * Enable or disable the memory system
   */
  setMemoryEnabled(enabled: boolean): void {
    this.memoryEnabled = enabled;
    if (!enabled && this._memory) {
      this._memory.dispose();
      this._memory = null;
    }
  }

  /**
   * Check if memory is enabled
   */
  isMemoryEnabled(): boolean {
    return this.memoryEnabled;
  }

  /**
   * Get memory statistics
   */
  getMemoryStats(): MemoryStats | null {
    if (!this.memoryEnabled) return null;
    return this.memory.getStats();
  }

  /**
   * Format memory status as a human-readable string
   */
  formatMemoryStatus(): string {
    if (!this.memoryEnabled) return '🧠 Memory: Disabled';
    return this.memory.formatStatus();
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  /**
   * Dispose of all resources
   */
  dispose(): void {
    if (this.tokenCounter) this.tokenCounter.dispose();
    if (this.contextManager) this.contextManager.dispose();
    if (this._memory) {
      this._memory.dispose();
      this._memory = null;
    }
  }
}
