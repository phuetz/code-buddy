/**
 * Budget Alert Manager
 *
 * Monitors session and budget costs, emitting alerts when
 * spending approaches or exceeds configured thresholds.
 *
 * Default thresholds:
 * - Warning at 70% of budget
 * - Critical at 90% of budget
 * - Limit reached at 100%
 *
 * @module analytics
 */

import { EventEmitter } from 'events';

export interface BudgetAlert {
  /** Alert severity level */
  type: 'warning' | 'critical' | 'limit_reached';
  /** Human-readable alert message */
  message: string;
  /** Current accumulated cost in USD */
  currentCost: number;
  /** Budget limit in USD */
  limit: number;
  /** Percentage of budget consumed (0-100+) */
  percentage: number;
}

export interface BudgetAlertConfig {
  /** Percentage (0-1) at which to emit a warning alert. Default: 0.7 */
  warningThreshold: number;
  /** Percentage (0-1) at which to emit a critical alert. Default: 0.9 */
  criticalThreshold: number;
}

const DEFAULT_CONFIG: BudgetAlertConfig = {
  warningThreshold: 0.7,
  criticalThreshold: 0.9,
};

/**
 * Budget Alert Manager
 *
 * Tracks spending against a budget limit and emits alerts
 * when thresholds are crossed. Alerts are deduplicated so
 * the same threshold level is only emitted once per session
 * (until reset).
 *
 * Events:
 * - 'alert' - Emitted with a BudgetAlert when a threshold is crossed
 */
export class BudgetAlertManager extends EventEmitter {
  private config: BudgetAlertConfig;
  private alerts: BudgetAlert[] = [];
  private emittedTypes: Set<BudgetAlert['type']> = new Set();

  constructor(config?: Partial<BudgetAlertConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Check current cost against limits and return an alert if a threshold is crossed.
   *
   * Alerts are deduplicated: once an alert of a given type has been emitted,
   * it will not be emitted again until `reset()` is called.
   *
   * @param currentCost - Current accumulated cost in USD
   * @param limit - Budget limit in USD
   * @returns A BudgetAlert if a threshold was crossed, or null
   */
  check(currentCost: number, limit: number): BudgetAlert | null {
    if (limit <= 0) {
      return null;
    }

    const percentage = (currentCost / limit) * 100;

    // Check from most severe to least severe
    if (currentCost >= limit && !this.emittedTypes.has('limit_reached')) {
      const alert: BudgetAlert = {
        type: 'limit_reached',
        message: `Budget limit reached! Spent $${currentCost.toFixed(4)} of $${limit.toFixed(2)} budget (${percentage.toFixed(1)}%).`,
        currentCost,
        limit,
        percentage,
      };
      this.recordAlert(alert);
      return alert;
    }

    if (
      currentCost >= limit * this.config.criticalThreshold &&
      !this.emittedTypes.has('critical')
    ) {
      const alert: BudgetAlert = {
        type: 'critical',
        message: `Critical: Approaching budget limit! Spent $${currentCost.toFixed(4)} of $${limit.toFixed(2)} budget (${percentage.toFixed(1)}%).`,
        currentCost,
        limit,
        percentage,
      };
      this.recordAlert(alert);
      return alert;
    }

    if (
      currentCost >= limit * this.config.warningThreshold &&
      !this.emittedTypes.has('warning')
    ) {
      const alert: BudgetAlert = {
        type: 'warning',
        message: `Warning: Budget usage at ${percentage.toFixed(1)}%. Spent $${currentCost.toFixed(4)} of $${limit.toFixed(2)} budget.`,
        currentCost,
        limit,
        percentage,
      };
      this.recordAlert(alert);
      return alert;
    }

    return null;
  }

  /**
   * Get the history of all alerts emitted in this session.
   */
  getAlerts(): BudgetAlert[] {
    return [...this.alerts];
  }

  /**
   * Reset all alert state, clearing history and deduplication tracking.
   * This allows alerts to fire again for the same thresholds.
   */
  reset(): void {
    this.alerts = [];
    this.emittedTypes.clear();
  }

  /**
   * Get the current configuration.
   */
  getConfig(): BudgetAlertConfig {
    return { ...this.config };
  }

  /**
   * Update configuration thresholds.
   */
  updateConfig(config: Partial<BudgetAlertConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Record an alert and emit the 'alert' event.
   */
  private recordAlert(alert: BudgetAlert): void {
    this.alerts.push(alert);
    this.emittedTypes.add(alert.type);
    this.emit('alert', alert);
  }
}
