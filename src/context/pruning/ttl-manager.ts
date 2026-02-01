/**
 * TTL Manager
 *
 * Tracks timestamps of tool calls for TTL-based pruning.
 * Tool call results are pruned after their TTL expires.
 */

import type { ToolCallTimestamp, PruningConfig } from './config.js';
import { DEFAULT_PRUNING_CONFIG } from './config.js';

// ============================================================================
// TTL Manager
// ============================================================================

/**
 * Manages TTL tracking for tool calls
 */
export class TTLManager {
  private config: PruningConfig;
  private toolCalls: Map<string, ToolCallTimestamp> = new Map();

  constructor(config: Partial<PruningConfig> = {}) {
    this.config = { ...DEFAULT_PRUNING_CONFIG, ...config };
  }

  /**
   * Register a tool call with current timestamp
   */
  registerToolCall(
    toolCallId: string,
    toolName: string,
    messageIndex: number
  ): void {
    this.toolCalls.set(toolCallId, {
      toolCallId,
      toolName,
      calledAt: Date.now(),
      messageIndex,
      pruned: false,
    });
  }

  /**
   * Get all tool calls
   */
  getToolCalls(): ToolCallTimestamp[] {
    return Array.from(this.toolCalls.values());
  }

  /**
   * Get tool call by ID
   */
  getToolCall(toolCallId: string): ToolCallTimestamp | undefined {
    return this.toolCalls.get(toolCallId);
  }

  /**
   * Check if a tool call has expired
   */
  isExpired(toolCallId: string, now: number = Date.now()): boolean {
    const toolCall = this.toolCalls.get(toolCallId);
    if (!toolCall) return false;

    return now - toolCall.calledAt > this.config.ttlMs;
  }

  /**
   * Get all expired tool calls
   */
  getExpiredToolCalls(now: number = Date.now()): ToolCallTimestamp[] {
    return Array.from(this.toolCalls.values()).filter(tc => {
      if (tc.pruned) return false;
      return now - tc.calledAt > this.config.ttlMs;
    });
  }

  /**
   * Get tool calls that are about to expire (within threshold)
   */
  getExpiringToolCalls(
    thresholdMs: number = 60000,
    now: number = Date.now()
  ): ToolCallTimestamp[] {
    return Array.from(this.toolCalls.values()).filter(tc => {
      if (tc.pruned) return false;
      const age = now - tc.calledAt;
      return age > this.config.ttlMs - thresholdMs && age <= this.config.ttlMs;
    });
  }

  /**
   * Mark a tool call as pruned
   */
  markPruned(toolCallId: string): void {
    const toolCall = this.toolCalls.get(toolCallId);
    if (toolCall) {
      toolCall.pruned = true;
    }
  }

  /**
   * Mark multiple tool calls as pruned
   */
  markManyPruned(toolCallIds: string[]): void {
    for (const id of toolCallIds) {
      this.markPruned(id);
    }
  }

  /**
   * Get time remaining until expiry
   */
  getTimeRemaining(toolCallId: string, now: number = Date.now()): number {
    const toolCall = this.toolCalls.get(toolCallId);
    if (!toolCall) return 0;

    return Math.max(0, this.config.ttlMs - (now - toolCall.calledAt));
  }

  /**
   * Get tool calls for a specific message
   */
  getToolCallsForMessage(messageIndex: number): ToolCallTimestamp[] {
    return Array.from(this.toolCalls.values()).filter(
      tc => tc.messageIndex === messageIndex
    );
  }

  /**
   * Get message indices that have expired tool calls
   */
  getExpiredMessageIndices(now: number = Date.now()): number[] {
    const expired = this.getExpiredToolCalls(now);
    const indices = new Set(expired.map(tc => tc.messageIndex));
    return Array.from(indices).sort((a, b) => a - b);
  }

  /**
   * Clean up old pruned entries
   */
  cleanup(maxAge: number = 30 * 60 * 1000): void {
    const now = Date.now();
    const toDelete: string[] = [];

    for (const [id, tc] of this.toolCalls) {
      if (tc.pruned && now - tc.calledAt > maxAge) {
        toDelete.push(id);
      }
    }

    for (const id of toDelete) {
      this.toolCalls.delete(id);
    }
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<PruningConfig>): void {
    Object.assign(this.config, config);
  }

  /**
   * Get current TTL setting
   */
  getTTL(): number {
    return this.config.ttlMs;
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalToolCalls: number;
    prunedCount: number;
    expiredCount: number;
    activeCount: number;
  } {
    const all = Array.from(this.toolCalls.values());
    const now = Date.now();

    const prunedCount = all.filter(tc => tc.pruned).length;
    const expiredCount = all.filter(tc => !tc.pruned && now - tc.calledAt > this.config.ttlMs).length;

    return {
      totalToolCalls: all.length,
      prunedCount,
      expiredCount,
      activeCount: all.length - prunedCount - expiredCount,
    };
  }

  /**
   * Clear all tool calls
   */
  clear(): void {
    this.toolCalls.clear();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let ttlManagerInstance: TTLManager | null = null;

/**
 * Get or create the TTLManager singleton
 */
export function getTTLManager(config?: Partial<PruningConfig>): TTLManager {
  if (!ttlManagerInstance) {
    ttlManagerInstance = new TTLManager(config);
  }
  return ttlManagerInstance;
}

/**
 * Reset the TTLManager singleton
 */
export function resetTTLManager(): void {
  if (ttlManagerInstance) {
    ttlManagerInstance.clear();
  }
  ttlManagerInstance = null;
}
