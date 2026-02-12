/**
 * Session Pruning Manager
 *
 * Manages automatic pruning of sessions, messages, and memories
 * based on configurable rules.
 */

import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import type {
  PruningConfig,
  PruningRule,
  PruningCondition,
  PrunableItem,
  PruningCandidate,
  PruningResult,
  PrunedItem,
  SkippedItem,
  PruningError,
  PruningStats,
  PruningProgress,
  SessionPruningConfig,
  PruningThresholds,
} from './types.js';
import { DEFAULT_PRUNING_CONFIG } from './types.js';

// ============================================================================
// Condition Evaluators
// ============================================================================

export type ConditionEvaluator = (
  item: PrunableItem,
  condition: PruningCondition,
  context: EvaluationContext
) => boolean;

export interface EvaluationContext {
  now: Date;
  sessionStats: Map<string, SessionStats>;
  globalStats: GlobalStats;
  customEvaluators?: Map<string, ConditionEvaluator>;
}

export interface SessionStats {
  messageCount: number;
  totalTokens: number;
  totalBytes: number;
  oldestItem?: Date;
  newestItem?: Date;
}

export interface GlobalStats {
  totalSessions: number;
  totalItems: number;
  totalTokens: number;
  totalBytes: number;
}

const conditionEvaluators: Map<string, ConditionEvaluator> = new Map([
  ['age', (item, condition, context) => {
    if (condition.type !== 'age') return false;
    const age = context.now.getTime() - item.createdAt.getTime();
    return age > condition.maxAgeMs;
  }],
  ['count', (_item, condition, context) => {
    if (condition.type !== 'count') return false;
    // Count-based pruning is handled at the batch level
    // Here we just check if the session exceeds the count
    const sessionStats = context.sessionStats.get(_item.sessionId);
    return sessionStats ? sessionStats.messageCount > condition.maxCount : false;
  }],
  ['size', (item, condition) => {
    if (condition.type !== 'size') return false;
    return item.sizeBytes > condition.maxBytes;
  }],
  ['tokens', (item, condition) => {
    if (condition.type !== 'tokens') return false;
    return (item.tokens ?? 0) > condition.maxTokens;
  }],
  ['type', (item, condition) => {
    if (condition.type !== 'type') return false;
    const matches = condition.messageTypes.includes(item.type);
    return condition.include ? matches : !matches;
  }],
  ['custom', (item, condition, context) => {
    if (condition.type !== 'custom') return false;
    const evaluator = context.customEvaluators?.get(condition.fn);
    if (evaluator) {
      return evaluator(item, condition, context);
    }
    return false;
  }],
]);

// ============================================================================
// Pruning Manager
// ============================================================================

export class PruningManager extends EventEmitter {
  private config: PruningConfig;
  private checkInterval: NodeJS.Timeout | null = null;
  private lastPruneTime = 0;
  private customEvaluators: Map<string, ConditionEvaluator> = new Map();
  private sessionConfigs: Map<string, SessionPruningConfig> = new Map();
  private items: Map<string, PrunableItem> = new Map();
  private archivedItems: Map<string, PrunableItem> = new Map();

  constructor(config: Partial<PruningConfig> = {}) {
    super();
    this.config = { ...DEFAULT_PRUNING_CONFIG, ...config };

    // Load session configs
    if (config.sessionConfigs) {
      for (const [id, cfg] of Object.entries(config.sessionConfigs)) {
        this.sessionConfigs.set(id, cfg);
      }
    }
  }

  // ============================================================================
  // Configuration
  // ============================================================================

  /**
   * Get current configuration
   */
  getConfig(): PruningConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<PruningConfig>): void {
    this.config = { ...this.config, ...config };

    // Restart interval if it changed
    if (config.checkIntervalMs !== undefined && this.checkInterval) {
      this.stop();
      this.start();
    }
  }

  /**
   * Add a pruning rule
   */
  addRule(rule: PruningRule): void {
    const existingIndex = this.config.rules.findIndex(r => r.id === rule.id);
    if (existingIndex >= 0) {
      this.config.rules[existingIndex] = rule;
    } else {
      this.config.rules.push(rule);
    }
    // Sort by priority
    this.config.rules.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Remove a pruning rule
   */
  removeRule(ruleId: string): boolean {
    const index = this.config.rules.findIndex(r => r.id === ruleId);
    if (index >= 0) {
      this.config.rules.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Enable/disable a rule
   */
  setRuleEnabled(ruleId: string, enabled: boolean): boolean {
    const rule = this.config.rules.find(r => r.id === ruleId);
    if (rule) {
      rule.enabled = enabled;
      return true;
    }
    return false;
  }

  /**
   * Set session-specific configuration
   */
  setSessionConfig(sessionId: string, config: Partial<SessionPruningConfig>): void {
    const existing = this.sessionConfigs.get(sessionId) || {
      sessionId,
      exempt: false,
    };
    this.sessionConfigs.set(sessionId, { ...existing, ...config });
  }

  /**
   * Remove session-specific configuration
   */
  removeSessionConfig(sessionId: string): boolean {
    return this.sessionConfigs.delete(sessionId);
  }

  /**
   * Register a custom condition evaluator
   */
  registerEvaluator(name: string, evaluator: ConditionEvaluator): void {
    this.customEvaluators.set(name, evaluator);
  }

  // ============================================================================
  // Item Management (for testing and integration)
  // ============================================================================

  /**
   * Add an item to be managed
   */
  addItem(item: PrunableItem): void {
    this.items.set(item.id, item);
  }

  /**
   * Remove an item
   */
  removeItem(id: string): boolean {
    return this.items.delete(id);
  }

  /**
   * Get an item
   */
  getItem(id: string): PrunableItem | undefined {
    return this.items.get(id);
  }

  /**
   * Get all items
   */
  getAllItems(): PrunableItem[] {
    return Array.from(this.items.values());
  }

  /**
   * Get items for a session
   */
  getSessionItems(sessionId: string): PrunableItem[] {
    return Array.from(this.items.values()).filter(i => i.sessionId === sessionId);
  }

  /**
   * Get archived items
   */
  getArchivedItems(): PrunableItem[] {
    return Array.from(this.archivedItems.values());
  }

  /**
   * Clear all items
   */
  clearItems(): void {
    this.items.clear();
  }

  // ============================================================================
  // Pruning Operations
  // ============================================================================

  /**
   * Start automatic pruning
   */
  start(): void {
    if (this.checkInterval) return;

    this.checkInterval = setInterval(() => {
      this.checkAndPrune().catch(error => {
        this.emit('error', {
          error: error.message,
          recoverable: true,
        });
      });
    }, this.config.checkIntervalMs);
  }

  /**
   * Stop automatic pruning
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * Check if pruning should run and execute if needed
   */
  async checkAndPrune(): Promise<PruningResult | null> {
    if (!this.config.enabled) return null;

    // Check minimum interval
    const now = Date.now();
    if (now - this.lastPruneTime < this.config.minPruneIntervalMs) {
      return null;
    }

    // Check if any thresholds are exceeded
    const shouldPrune = this.shouldPrune();
    if (!shouldPrune) return null;

    return this.prune();
  }

  /**
   * Check if pruning should occur
   */
  private shouldPrune(): boolean {
    const stats = this.calculateGlobalStats();

    for (const rule of this.config.rules) {
      if (!rule.enabled) continue;

      for (const condition of rule.conditions) {
        switch (condition.type) {
          case 'count':
            if (stats.totalItems > condition.maxCount) return true;
            break;
          case 'tokens':
            if (stats.totalTokens > condition.maxTokens) return true;
            break;
          case 'size':
            if (stats.totalBytes > condition.maxBytes) return true;
            break;
        }
      }
    }

    return false;
  }

  /**
   * Execute pruning operation
   */
  async prune(options?: { force?: boolean; sessionId?: string }): Promise<PruningResult> {
    const pruningId = crypto.randomUUID();
    const startedAt = new Date();
    const errors: PruningError[] = [];
    const prunedItems: PrunedItem[] = [];
    const skippedItems: SkippedItem[] = [];

    this.emit('start', this.config);

    try {
      // Get items to evaluate
      let items = this.getAllItems();
      if (options?.sessionId) {
        items = items.filter(i => i.sessionId === options.sessionId);
      }

      // Build context
      const context = this.buildEvaluationContext();

      // Find candidates
      const candidates = this.findCandidates(items, context);

      // Process candidates
      const total = candidates.length;
      let current = 0;

      for (const candidate of candidates) {
        current++;

        this.emit('progress', {
          current,
          total,
          percent: Math.round((current / total) * 100),
          currentItem: candidate.item,
        } as PruningProgress);

        // Check session exemption
        const sessionConfig = this.sessionConfigs.get(candidate.item.sessionId);
        if (sessionConfig?.exempt && !options?.force) {
          skippedItems.push({
            item: candidate.item,
            reason: 'Session is exempt from pruning',
          });
          this.emit('item-skipped', skippedItems[skippedItems.length - 1]);
          continue;
        }

        try {
          if (this.config.dryRun) {
            prunedItems.push({
              item: candidate.item,
              action: candidate.rule.action.type,
              reason: candidate.reason + ' (dry run)',
              savedBytes: candidate.item.sizeBytes,
              savedTokens: candidate.item.tokens,
            });
          } else {
            const result = await this.executeAction(candidate);
            prunedItems.push(result);
            this.emit('item-pruned', result);
          }
        } catch (error) {
          const pruningError: PruningError = {
            item: candidate.item,
            rule: candidate.rule,
            error: error instanceof Error ? error.message : String(error),
            recoverable: true,
          };
          errors.push(pruningError);
          this.emit('error', pruningError);
        }
      }

      this.lastPruneTime = Date.now();

      const result: PruningResult = {
        id: pruningId,
        startedAt,
        completedAt: new Date(),
        success: errors.length === 0,
        prunedItems,
        skippedItems,
        errors,
        stats: this.calculateStats(items.length, prunedItems, skippedItems, errors, startedAt),
      };

      this.emit('complete', result);
      return result;
    } catch (error) {
      const errorResult: PruningResult = {
        id: pruningId,
        startedAt,
        completedAt: new Date(),
        success: false,
        prunedItems,
        skippedItems,
        errors: [{
          error: error instanceof Error ? error.message : String(error),
          recoverable: false,
        }],
        stats: this.calculateStats(0, prunedItems, skippedItems, errors, startedAt),
      };

      this.emit('complete', errorResult);
      return errorResult;
    }
  }

  /**
   * Build evaluation context
   */
  private buildEvaluationContext(): EvaluationContext {
    const sessionStats = new Map<string, SessionStats>();

    // Calculate per-session stats
    for (const item of this.items.values()) {
      const stats = sessionStats.get(item.sessionId) || {
        messageCount: 0,
        totalTokens: 0,
        totalBytes: 0,
      };

      stats.messageCount++;
      stats.totalTokens += item.tokens ?? 0;
      stats.totalBytes += item.sizeBytes;

      if (!stats.oldestItem || item.createdAt < stats.oldestItem) {
        stats.oldestItem = item.createdAt;
      }
      if (!stats.newestItem || item.createdAt > stats.newestItem) {
        stats.newestItem = item.createdAt;
      }

      sessionStats.set(item.sessionId, stats);
    }

    const globalStats = this.calculateGlobalStats();

    return {
      now: new Date(),
      sessionStats,
      globalStats,
      customEvaluators: this.customEvaluators,
    };
  }

  /**
   * Calculate global stats
   */
  private calculateGlobalStats(): GlobalStats {
    const sessions = new Set<string>();
    let totalTokens = 0;
    let totalBytes = 0;

    for (const item of this.items.values()) {
      sessions.add(item.sessionId);
      totalTokens += item.tokens ?? 0;
      totalBytes += item.sizeBytes;
    }

    return {
      totalSessions: sessions.size,
      totalItems: this.items.size,
      totalTokens,
      totalBytes,
    };
  }

  /**
   * Find pruning candidates
   */
  private findCandidates(items: PrunableItem[], context: EvaluationContext): PruningCandidate[] {
    const candidates: PruningCandidate[] = [];

    for (const item of items) {
      for (const rule of this.config.rules) {
        if (!rule.enabled) continue;

        const matchResult = this.evaluateConditions(item, rule.conditions, context);
        if (matchResult.matches) {
          candidates.push({
            item,
            rule,
            reason: matchResult.reason,
          });
          break; // Item matches one rule, don't check others
        }
      }
    }

    // Sort by rule priority (higher priority first)
    candidates.sort((a, b) => b.rule.priority - a.rule.priority);

    return candidates;
  }

  /**
   * Evaluate all conditions for an item
   */
  private evaluateConditions(
    item: PrunableItem,
    conditions: PruningCondition[],
    context: EvaluationContext
  ): { matches: boolean; reason: string } {
    const matchedConditions: string[] = [];

    for (const condition of conditions) {
      const evaluator = conditionEvaluators.get(condition.type);
      if (evaluator && evaluator(item, condition, context)) {
        matchedConditions.push(this.describeCondition(condition));
      }
    }

    if (matchedConditions.length === conditions.length) {
      return {
        matches: true,
        reason: `Matched conditions: ${matchedConditions.join(', ')}`,
      };
    }

    return { matches: false, reason: '' };
  }

  /**
   * Describe a condition in human-readable format
   */
  private describeCondition(condition: PruningCondition): string {
    switch (condition.type) {
      case 'age':
        return `age > ${condition.maxAgeMs}ms`;
      case 'count':
        return `count > ${condition.maxCount}`;
      case 'size':
        return `size > ${condition.maxBytes} bytes`;
      case 'tokens':
        return `tokens > ${condition.maxTokens}`;
      case 'type':
        return `type ${condition.include ? 'in' : 'not in'} [${condition.messageTypes.join(', ')}]`;
      case 'custom':
        return `custom(${condition.fn})`;
      default:
        return 'unknown condition';
    }
  }

  /**
   * Execute pruning action
   */
  private async executeAction(candidate: PruningCandidate): Promise<PrunedItem> {
    const { item, rule, reason } = candidate;
    const action = rule.action;

    switch (action.type) {
      case 'delete':
        this.items.delete(item.id);
        break;

      case 'archive':
        this.items.delete(item.id);
        this.archivedItems.set(item.id, {
          ...item,
          metadata: {
            ...item.metadata,
            archivedAt: new Date(),
            archivedFrom: action.destination || 'default',
          },
        });
        break;

      case 'summarize':
        // In real implementation, this would call the summarization service
        // For now, we simulate by keeping a truncated version
        if (item.content) {
          const targetLength = Math.floor(item.content.length * 0.5);
          const summarized = item.content.substring(0, targetLength) + '... [summarized]';
          item.content = summarized;
          item.sizeBytes = summarized.length;
          item.tokens = Math.floor((item.tokens ?? 0) * 0.5);
        }
        break;

      case 'compact':
        // Reduce size by the specified ratio
        if (item.content) {
          const ratio = Math.max(0, Math.min(1, action.ratio));
          const targetLength = Math.max(1, Math.floor(item.content.length * ratio));
          item.content = item.content.substring(0, targetLength);
          item.sizeBytes = Math.max(1, Math.floor(item.sizeBytes * ratio));
          item.tokens = Math.max(0, Math.floor((item.tokens ?? 0) * ratio));
        }
        break;
    }

    return {
      item,
      action: action.type,
      reason,
      savedBytes: item.sizeBytes,
      savedTokens: item.tokens,
    };
  }

  /**
   * Calculate pruning statistics
   */
  private calculateStats(
    scannedCount: number,
    pruned: PrunedItem[],
    skipped: SkippedItem[],
    errors: PruningError[],
    startedAt: Date
  ): PruningStats {
    return {
      scannedCount,
      prunedCount: pruned.length,
      skippedCount: skipped.length,
      errorCount: errors.length,
      freedBytes: pruned.reduce((sum, p) => sum + p.savedBytes, 0),
      freedTokens: pruned.reduce((sum, p) => sum + (p.savedTokens ?? 0), 0),
      durationMs: Date.now() - startedAt.getTime(),
    };
  }

  // ============================================================================
  // Statistics
  // ============================================================================

  /**
   * Get current statistics
   */
  getStats(): {
    config: PruningConfig;
    globalStats: GlobalStats;
    sessionStats: Map<string, SessionStats>;
    lastPruneTime: number;
  } {
    const context = this.buildEvaluationContext();

    return {
      config: this.config,
      globalStats: context.globalStats,
      sessionStats: context.sessionStats,
      lastPruneTime: this.lastPruneTime,
    };
  }
}

// ============================================================================
// Singleton
// ============================================================================

let pruningManagerInstance: PruningManager | null = null;

export function getPruningManager(config?: Partial<PruningConfig>): PruningManager {
  if (!pruningManagerInstance) {
    pruningManagerInstance = new PruningManager(config);
  }
  return pruningManagerInstance;
}

export function resetPruningManager(): void {
  if (pruningManagerInstance) {
    pruningManagerInstance.stop();
    pruningManagerInstance = null;
  }
}
