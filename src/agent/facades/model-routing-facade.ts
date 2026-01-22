/**
 * Model Routing Facade
 *
 * Encapsulates model routing and cost tracking operations.
 * This facade handles:
 * - Model selection and routing decisions
 * - Cost tracking and limits
 * - Routing statistics and savings calculation
 */

import type { ModelRouter, RoutingDecision } from '../../optimization/model-routing.js';
import type { CostTracker } from '../../utils/cost-tracker.js';

/**
 * Statistics about model routing usage
 */
export interface ModelRoutingStats {
  enabled: boolean;
  totalCost: number;
  savings: {
    saved: number;
    percentage: number;
  };
  usageByModel: Record<string, unknown>;
  lastDecision: RoutingDecision | null;
}

/**
 * Dependencies required by ModelRoutingFacade
 */
export interface ModelRoutingFacadeDeps {
  modelRouter: ModelRouter;
  costTracker: CostTracker;
}

/**
 * Facade for model routing and cost management in agents.
 *
 * Responsibilities:
 * - Enabling/disabling model routing
 * - Tracking routing decisions
 * - Calculating costs and savings
 * - Providing routing statistics
 */
export class ModelRoutingFacade {
  private readonly modelRouter: ModelRouter;
  private readonly costTracker: CostTracker;

  private useModelRouting: boolean = false;
  private lastRoutingDecision: RoutingDecision | null = null;
  private sessionCostLimit: number = 10;
  private sessionCost: number = 0;

  constructor(deps: ModelRoutingFacadeDeps) {
    this.modelRouter = deps.modelRouter;
    this.costTracker = deps.costTracker;
  }

  // ============================================================================
  // Model Routing
  // ============================================================================

  /**
   * Enable or disable model routing
   */
  setModelRouting(enabled: boolean): void {
    this.useModelRouting = enabled;
  }

  /**
   * Check if model routing is enabled
   */
  isModelRoutingEnabled(): boolean {
    return this.useModelRouting;
  }

  /**
   * Get the model router instance (for advanced operations)
   */
  getModelRouter(): ModelRouter {
    return this.modelRouter;
  }

  /**
   * Get the last routing decision
   */
  getLastRoutingDecision(): RoutingDecision | null {
    return this.lastRoutingDecision;
  }

  /**
   * Set the last routing decision (called after routing)
   */
  setLastRoutingDecision(decision: RoutingDecision): void {
    this.lastRoutingDecision = decision;
  }

  /**
   * Get comprehensive model routing statistics
   */
  getStats(): ModelRoutingStats {
    return {
      enabled: this.useModelRouting,
      totalCost: this.modelRouter.getTotalCost(),
      savings: this.modelRouter.getEstimatedSavings(),
      usageByModel: Object.fromEntries(this.modelRouter.getUsageStats()),
      lastDecision: this.lastRoutingDecision,
    };
  }

  /**
   * Format routing statistics as a human-readable string
   */
  formatStats(): string {
    const stats = this.getStats();
    const lines = [
      'Model Routing Statistics',
      `|- Enabled: ${stats.enabled ? 'Yes' : 'No'}`,
      `|- Total Cost: $${stats.totalCost.toFixed(4)}`,
      `|- Savings: $${stats.savings.saved.toFixed(4)} (${stats.savings.percentage.toFixed(1)}%)`,
    ];

    if (stats.lastDecision) {
      lines.push(`|- Last Model: ${stats.lastDecision.recommendedModel}`);
      lines.push(`\\- Reason: ${stats.lastDecision.reason}`);
    } else {
      lines.push('\\- No routing decisions yet');
    }

    return lines.join('\n');
  }

  // ============================================================================
  // Cost Management
  // ============================================================================

  /**
   * Get current session cost
   */
  getSessionCost(): number {
    return this.sessionCost;
  }

  /**
   * Add to session cost
   */
  addSessionCost(cost: number): void {
    this.sessionCost += cost;
  }

  /**
   * Set session cost directly
   */
  setSessionCost(cost: number): void {
    this.sessionCost = cost;
  }

  /**
   * Get session cost limit
   */
  getSessionCostLimit(): number {
    return this.sessionCostLimit;
  }

  /**
   * Set session cost limit
   */
  setSessionCostLimit(limit: number): void {
    this.sessionCostLimit = limit;
  }

  /**
   * Check if session cost limit has been reached
   */
  isSessionCostLimitReached(): boolean {
    return this.sessionCost >= this.sessionCostLimit;
  }

  /**
   * Get the cost tracker instance (for advanced operations)
   */
  getCostTracker(): CostTracker {
    return this.costTracker;
  }
}
