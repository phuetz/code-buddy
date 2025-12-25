/**
 * Real-Time Cost Indicator
 *
 * Tracks and displays API usage costs:
 * - Per-request tracking
 * - Session totals
 * - Budget limits
 * - Cost predictions
 */

export interface TokenPricing {
  model: string;
  inputPer1M: number;
  outputPer1M: number;
  cachedInputPer1M?: number;
}

export interface CostEntry {
  timestamp: Date;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  cost: number;
  requestType?: string;
}

export interface CostSummary {
  totalCost: number;
  inputCost: number;
  outputCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  requestCount: number;
  avgCostPerRequest: number;
  costByModel: Map<string, number>;
  entries: CostEntry[];
}

export interface CostBudget {
  limit: number;
  warningThreshold: number; // 0-1
  action: 'warn' | 'block' | 'confirm';
}

/**
 * Default pricing for common models ($ per 1M tokens)
 */
export const MODEL_PRICING: TokenPricing[] = [
  { model: 'grok-4-latest', inputPer1M: 3.00, outputPer1M: 15.00 },
  { model: 'grok-4', inputPer1M: 3.00, outputPer1M: 15.00 },
  { model: 'grok-3', inputPer1M: 1.00, outputPer1M: 5.00 },
  { model: 'grok-beta', inputPer1M: 5.00, outputPer1M: 15.00 },
  { model: 'grok-vision-beta', inputPer1M: 5.00, outputPer1M: 15.00 },
  { model: 'gpt-4o', inputPer1M: 2.50, outputPer1M: 10.00, cachedInputPer1M: 1.25 },
  { model: 'gpt-4o-mini', inputPer1M: 0.15, outputPer1M: 0.60, cachedInputPer1M: 0.075 },
  { model: 'claude-3-opus', inputPer1M: 15.00, outputPer1M: 75.00 },
  { model: 'claude-3-sonnet', inputPer1M: 3.00, outputPer1M: 15.00 },
  { model: 'claude-3-haiku', inputPer1M: 0.25, outputPer1M: 1.25 },
];

/**
 * Cost Tracker
 */
export class CostTracker {
  private entries: CostEntry[] = [];
  private budget?: CostBudget;
  private pricing: Map<string, TokenPricing> = new Map();
  private sessionStart: Date = new Date();

  constructor(customPricing?: TokenPricing[]) {
    // Load default pricing
    for (const p of MODEL_PRICING) {
      this.pricing.set(p.model, p);
    }

    // Add custom pricing
    if (customPricing) {
      for (const p of customPricing) {
        this.pricing.set(p.model, p);
      }
    }
  }

  /**
   * Set budget limit
   */
  setBudget(budget: CostBudget): void {
    this.budget = budget;
  }

  /**
   * Get current budget status
   */
  getBudgetStatus(): {
    hasLimit: boolean;
    limit: number;
    used: number;
    remaining: number;
    percentage: number;
    warningTriggered: boolean;
    blocked: boolean;
  } {
    const used = this.getTotalCost();

    if (!this.budget) {
      return {
        hasLimit: false,
        limit: Infinity,
        used,
        remaining: Infinity,
        percentage: 0,
        warningTriggered: false,
        blocked: false,
      };
    }

    const percentage = used / this.budget.limit;

    return {
      hasLimit: true,
      limit: this.budget.limit,
      used,
      remaining: Math.max(0, this.budget.limit - used),
      percentage: percentage * 100,
      warningTriggered: percentage >= this.budget.warningThreshold,
      blocked: percentage >= 1 && this.budget.action === 'block',
    };
  }

  /**
   * Record a request
   */
  recordRequest(
    model: string,
    inputTokens: number,
    outputTokens: number,
    cachedTokens: number = 0,
    requestType?: string
  ): CostEntry {
    const cost = this.calculateCost(model, inputTokens, outputTokens, cachedTokens);

    const entry: CostEntry = {
      timestamp: new Date(),
      model,
      inputTokens,
      outputTokens,
      cachedTokens,
      cost,
      requestType,
    };

    this.entries.push(entry);
    return entry;
  }

  /**
   * Calculate cost for tokens
   */
  calculateCost(
    model: string,
    inputTokens: number,
    outputTokens: number,
    cachedTokens: number = 0
  ): number {
    const pricing = this.getPricing(model);

    const inputCost = (inputTokens / 1_000_000) * pricing.inputPer1M;
    const outputCost = (outputTokens / 1_000_000) * pricing.outputPer1M;
    const cachedCost = pricing.cachedInputPer1M
      ? (cachedTokens / 1_000_000) * pricing.cachedInputPer1M
      : 0;

    return inputCost + outputCost + cachedCost;
  }

  /**
   * Get pricing for a model
   */
  getPricing(model: string): TokenPricing {
    // Try exact match
    if (this.pricing.has(model)) {
      return this.pricing.get(model)!;
    }

    // Try prefix match
    for (const [key, pricing] of this.pricing) {
      if (model.startsWith(key) || key.startsWith(model)) {
        return pricing;
      }
    }

    // Default fallback
    return { model, inputPer1M: 5.00, outputPer1M: 15.00 };
  }

  /**
   * Get total cost
   */
  getTotalCost(): number {
    return this.entries.reduce((sum, e) => sum + e.cost, 0);
  }

  /**
   * Get cost summary
   */
  getSummary(): CostSummary {
    const costByModel = new Map<string, number>();
    let inputCost = 0;
    let outputCost = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCachedTokens = 0;

    for (const entry of this.entries) {
      const pricing = this.getPricing(entry.model);

      const entryInputCost = (entry.inputTokens / 1_000_000) * pricing.inputPer1M;
      const entryOutputCost = (entry.outputTokens / 1_000_000) * pricing.outputPer1M;

      inputCost += entryInputCost;
      outputCost += entryOutputCost;
      totalInputTokens += entry.inputTokens;
      totalOutputTokens += entry.outputTokens;
      totalCachedTokens += entry.cachedTokens;

      costByModel.set(
        entry.model,
        (costByModel.get(entry.model) || 0) + entry.cost
      );
    }

    const totalCost = this.getTotalCost();
    const requestCount = this.entries.length;

    return {
      totalCost,
      inputCost,
      outputCost,
      totalInputTokens,
      totalOutputTokens,
      totalCachedTokens,
      requestCount,
      avgCostPerRequest: requestCount > 0 ? totalCost / requestCount : 0,
      costByModel,
      entries: [...this.entries],
    };
  }

  /**
   * Estimate cost for future request
   */
  estimateCost(model: string, estimatedInputTokens: number, estimatedOutputTokens: number): number {
    return this.calculateCost(model, estimatedInputTokens, estimatedOutputTokens);
  }

  /**
   * Get session duration
   */
  getSessionDuration(): number {
    return Date.now() - this.sessionStart.getTime();
  }

  /**
   * Get cost rate (cost per hour)
   */
  getCostRate(): number {
    const durationHours = this.getSessionDuration() / (1000 * 60 * 60);
    if (durationHours < 0.01) return 0;
    return this.getTotalCost() / durationHours;
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.entries = [];
    this.sessionStart = new Date();
  }

  /**
   * Format cost display
   */
  formatCost(cost: number): string {
    if (cost < 0.01) {
      return `$${(cost * 100).toFixed(2)}¢`;
    }
    return `$${cost.toFixed(4)}`;
  }

  /**
   * Format current status for display
   */
  formatStatus(): string {
    const summary = this.getSummary();
    const budget = this.getBudgetStatus();

    let status = this.formatCost(summary.totalCost);

    if (budget.hasLimit) {
      status += ` / ${this.formatCost(budget.limit)}`;
      status += ` (${budget.percentage.toFixed(1)}%)`;
    }

    return status;
  }

  /**
   * Format detailed report
   */
  formatReport(): string {
    const summary = this.getSummary();
    const budget = this.getBudgetStatus();

    const lines: string[] = [
      '',
      '═══════════════════════════════════════',
      '          COST REPORT',
      '═══════════════════════════════════════',
      '',
      `Total Cost:     ${this.formatCost(summary.totalCost)}`,
      `  Input:        ${this.formatCost(summary.inputCost)}`,
      `  Output:       ${this.formatCost(summary.outputCost)}`,
      '',
      `Tokens Used:    ${formatNumber(summary.totalInputTokens + summary.totalOutputTokens)}`,
      `  Input:        ${formatNumber(summary.totalInputTokens)}`,
      `  Output:       ${formatNumber(summary.totalOutputTokens)}`,
      `  Cached:       ${formatNumber(summary.totalCachedTokens)}`,
      '',
      `Requests:       ${summary.requestCount}`,
      `Avg/Request:    ${this.formatCost(summary.avgCostPerRequest)}`,
      `Cost Rate:      ${this.formatCost(this.getCostRate())}/hour`,
      '',
    ];

    if (summary.costByModel.size > 0) {
      lines.push('By Model:');
      for (const [model, cost] of summary.costByModel) {
        lines.push(`  ${model}: ${this.formatCost(cost)}`);
      }
      lines.push('');
    }

    if (budget.hasLimit) {
      lines.push('Budget:');
      lines.push(`  Limit:        ${this.formatCost(budget.limit)}`);
      lines.push(`  Used:         ${budget.percentage.toFixed(1)}%`);
      lines.push(`  Remaining:    ${this.formatCost(budget.remaining)}`);

      if (budget.warningTriggered) {
        lines.push('  ⚠️  Warning threshold reached');
      }
      if (budget.blocked) {
        lines.push('  🛑 Budget limit reached');
      }
    }

    lines.push('═══════════════════════════════════════');

    return lines.join('\n');
  }

  /**
   * Format compact status line
   */
  formatStatusLine(): string {
    const summary = this.getSummary();
    const budget = this.getBudgetStatus();

    let line = `💰 ${this.formatCost(summary.totalCost)}`;

    if (budget.hasLimit) {
      const bar = createProgressBar(budget.percentage, 10);
      line += ` ${bar} ${budget.percentage.toFixed(0)}%`;

      if (budget.warningTriggered) {
        line += ' ⚠️';
      }
    }

    return line;
  }
}

/**
 * Format large numbers
 */
function formatNumber(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1000000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1000000).toFixed(2)}M`;
}

/**
 * Create ASCII progress bar
 */
function createProgressBar(percentage: number, width: number): string {
  const filled = Math.round((Math.min(percentage, 100) / 100) * width);
  const empty = width - filled;
  return '[' + '█'.repeat(filled) + '░'.repeat(empty) + ']';
}

// Singleton instance
let costTracker: CostTracker | null = null;

/**
 * Get or create cost tracker
 */
export function getCostTracker(): CostTracker {
  if (!costTracker) {
    costTracker = new CostTracker();
  }
  return costTracker;
}

/**
 * Reset cost tracker
 */
export function resetCostTracker(): void {
  costTracker = null;
}

export default CostTracker;
