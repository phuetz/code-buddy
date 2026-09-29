import { getPricingPer1M } from '../config/model-pricing.js';

/**
 * Persistent Analytics
 *
 * Comprehensive analytics and cost tracking system backed by SQLite.
 *
 * Features:
 * - Daily aggregated analytics
 * - Cost tracking with budgets
 * - Usage trends and forecasting
 * - Export capabilities
 */

import { EventEmitter } from 'events';
import { getAnalyticsRepository, AnalyticsFilter } from '../database/repositories/analytics-repository.js';
import type { Analytics } from '../database/schema.js';

// ============================================================================
// Types
// ============================================================================

export interface CostBudget {
  daily?: number;
  weekly?: number;
  monthly?: number;
  session?: number;
}

export interface UsageEvent {
  model: string;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  responseTimeMs: number;
  cacheHit: boolean;
  toolCalls?: number;
  error?: boolean;
  projectId?: string;
}

export interface AnalyticsSummary {
  period: string;
  totalCost: number;
  totalRequests: number;
  totalTokens: { in: number; out: number };
  avgResponseTime: number;
  cacheHitRate: number;
  errorRate: number;
  byModel: Record<string, { cost: number; requests: number }>;
  trend: 'increasing' | 'stable' | 'decreasing';
}

export interface CostAlert {
  type: 'warning' | 'exceeded';
  budget: 'daily' | 'weekly' | 'monthly' | 'session';
  limit: number;
  current: number;
  percentage: number;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_BUDGET: CostBudget = {
  daily: 10,
  weekly: 50,
  monthly: 150,
  session: 5,
};

// ============================================================================
// Persistent Analytics Class
// ============================================================================

export class PersistentAnalytics extends EventEmitter {
  private analyticsRepo = getAnalyticsRepository();
  private budget: CostBudget;
  private sessionCost: number = 0;
  private sessionStart: Date = new Date();

  constructor(budget: Partial<CostBudget> = {}) {
    super();
    this.budget = { ...DEFAULT_BUDGET, ...budget };
  }

  /**
   * Record a usage event
   */
  record(event: UsageEvent): void {
    // ISO string is YYYY-MM-DDTHH:mm:ss.sssZ; slice(0,10) yields the date part as a guaranteed string
    const today = new Date().toISOString().slice(0, 10);

    this.analyticsRepo.recordAnalytics({
      date: today,
      project_id: event.projectId,
      model: event.model,
      tokens_in: event.tokensIn,
      tokens_out: event.tokensOut,
      cost: event.cost,
      requests: 1,
      tool_calls: event.toolCalls || 0,
      errors: event.error ? 1 : 0,
      avg_response_time_ms: event.responseTimeMs,
      cache_hit_rate: event.cacheHit ? 1 : 0,
      session_count: 0,
    });

    // Update session cost
    this.sessionCost += event.cost;

    // Check budgets
    this.checkBudgets(event.cost);

    this.emit('usage:recorded', event);
  }

  /**
   * Record a new session
   */
  recordSession(projectId?: string): void {
    // ISO string is YYYY-MM-DDTHH:mm:ss.sssZ; slice(0,10) yields the date part as a guaranteed string
    const today = new Date().toISOString().slice(0, 10);

    this.analyticsRepo.recordAnalytics({
      date: today,
      project_id: projectId,
      model: undefined,
      tokens_in: 0,
      tokens_out: 0,
      cost: 0,
      requests: 0,
      tool_calls: 0,
      errors: 0,
      avg_response_time_ms: 0,
      cache_hit_rate: 0,
      session_count: 1,
    });

    // Reset session tracking
    this.sessionCost = 0;
    this.sessionStart = new Date();

    this.emit('session:started');
  }

  /**
   * Calculate cost for tokens
   */
  calculateCost(model: string, tokensIn: number, tokensOut: number): number {
    const costs = getPricingPer1M(model);
    return (tokensIn * costs.input + tokensOut * costs.output) / 1_000_000;
  }

  /**
   * Get current session cost
   */
  getSessionCost(): number {
    return this.sessionCost;
  }

  /**
   * Get daily cost
   */
  getDailyCost(date?: string): number {
    const targetDate = date || new Date().toISOString().split('T')[0];
    return this.analyticsRepo.getTotalCost({
      startDate: targetDate,
      endDate: targetDate,
    });
  }

  /**
   * Get weekly cost
   */
  getWeeklyCost(): number {
    const today = new Date();
    const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    return this.analyticsRepo.getTotalCost({
      startDate: weekAgo.toISOString().split('T')[0],
      endDate: today.toISOString().split('T')[0],
    });
  }

  /**
   * Get monthly cost
   */
  getMonthlyCost(): number {
    const today = new Date();
    const monthAgo = new Date(today.getFullYear(), today.getMonth(), 1);
    return this.analyticsRepo.getTotalCost({
      startDate: monthAgo.toISOString().split('T')[0],
      endDate: today.toISOString().split('T')[0],
    });
  }

  /**
   * Get analytics summary
   */
  getSummary(filter: AnalyticsFilter = {}): AnalyticsSummary {
    const analytics = this.analyticsRepo.getAnalytics(filter);

    if (analytics.length === 0) {
      return {
        period: this.formatPeriod(filter),
        totalCost: 0,
        totalRequests: 0,
        totalTokens: { in: 0, out: 0 },
        avgResponseTime: 0,
        cacheHitRate: 0,
        errorRate: 0,
        byModel: {},
        trend: 'stable',
      };
    }

    // Aggregate stats
    let totalCost = 0;
    let totalRequests = 0;
    let totalTokensIn = 0;
    let totalTokensOut = 0;
    let totalErrors = 0;
    let totalResponseTime = 0;
    let totalCacheHits = 0;
    const byModel: Record<string, { cost: number; requests: number }> = {};

    for (const a of analytics) {
      totalCost += a.cost;
      totalRequests += a.requests;
      totalTokensIn += a.tokens_in;
      totalTokensOut += a.tokens_out;
      totalErrors += a.errors;
      totalResponseTime += a.avg_response_time_ms * a.requests;
      totalCacheHits += a.cache_hit_rate * a.requests;

      if (a.model) {
        const entry = byModel[a.model] ?? { cost: 0, requests: 0 };
        entry.cost += a.cost;
        entry.requests += a.requests;
        byModel[a.model] = entry;
      }
    }

    // Calculate trend
    const trend = this.calculateTrend(analytics);

    return {
      period: this.formatPeriod(filter),
      totalCost,
      totalRequests,
      totalTokens: { in: totalTokensIn, out: totalTokensOut },
      avgResponseTime: totalRequests > 0 ? totalResponseTime / totalRequests : 0,
      cacheHitRate: totalRequests > 0 ? totalCacheHits / totalRequests : 0,
      errorRate: totalRequests > 0 ? totalErrors / totalRequests : 0,
      byModel,
      trend,
    };
  }

  /**
   * Get daily summaries
   */
  getDailySummaries(days: number = 30): {
    date: string;
    cost: number;
    requests: number;
    tokens: number;
  }[] {
    return this.analyticsRepo.getDailySummary(days).map(d => ({
      date: d.date,
      cost: d.totalCost,
      requests: d.totalRequests,
      tokens: d.totalTokens,
    }));
  }

  /**
   * Get budget status
   */
  getBudgetStatus(): {
    daily: { limit: number; used: number; remaining: number; percentage: number };
    weekly: { limit: number; used: number; remaining: number; percentage: number };
    monthly: { limit: number; used: number; remaining: number; percentage: number };
    session: { limit: number; used: number; remaining: number; percentage: number };
  } {
    const dailyCost = this.getDailyCost();
    const weeklyCost = this.getWeeklyCost();
    const monthlyCost = this.getMonthlyCost();

    return {
      daily: this.formatBudgetStatus(this.budget.daily || 0, dailyCost),
      weekly: this.formatBudgetStatus(this.budget.weekly || 0, weeklyCost),
      monthly: this.formatBudgetStatus(this.budget.monthly || 0, monthlyCost),
      session: this.formatBudgetStatus(this.budget.session || 0, this.sessionCost),
    };
  }

  /**
   * Update budget limits
   */
  setBudget(budget: Partial<CostBudget>): void {
    this.budget = { ...this.budget, ...budget };
    this.emit('budget:updated', this.budget);
  }

  /**
   * Export analytics data
   */
  export(filter: AnalyticsFilter = {}): Analytics[] {
    return this.analyticsRepo.getAnalytics(filter);
  }

  /**
   * Export as CSV
   */
  exportCSV(filter: AnalyticsFilter = {}): string {
    const data = this.export(filter);

    const headers = [
      'date', 'project_id', 'model', 'tokens_in', 'tokens_out',
      'cost', 'requests', 'tool_calls', 'errors', 'avg_response_time_ms',
      'cache_hit_rate', 'session_count'
    ];

    const rows = data.map(d => [
      d.date,
      d.project_id || '',
      d.model || '',
      d.tokens_in,
      d.tokens_out,
      d.cost.toFixed(4),
      d.requests,
      d.tool_calls,
      d.errors,
      d.avg_response_time_ms.toFixed(2),
      d.cache_hit_rate.toFixed(4),
      d.session_count
    ].join(','));

    return [headers.join(','), ...rows].join('\n');
  }

  /**
   * Format stats for display
   */
  formatDashboard(): string {
    const budget = this.getBudgetStatus();
    const summary = this.getSummary({
      startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    });

    const lines: string[] = [];

    lines.push('📊 Analytics Dashboard');
    lines.push('═'.repeat(40));

    // Budget Status
    lines.push('');
    lines.push('💰 Budget Status');
    lines.push(`  Session:  $${budget.session.used.toFixed(2)} / $${budget.session.limit.toFixed(2)} (${budget.session.percentage.toFixed(0)}%)`);
    lines.push(`  Daily:    $${budget.daily.used.toFixed(2)} / $${budget.daily.limit.toFixed(2)} (${budget.daily.percentage.toFixed(0)}%)`);
    lines.push(`  Weekly:   $${budget.weekly.used.toFixed(2)} / $${budget.weekly.limit.toFixed(2)} (${budget.weekly.percentage.toFixed(0)}%)`);
    lines.push(`  Monthly:  $${budget.monthly.used.toFixed(2)} / $${budget.monthly.limit.toFixed(2)} (${budget.monthly.percentage.toFixed(0)}%)`);

    // Usage Summary (30 days)
    lines.push('');
    lines.push('📈 Last 30 Days');
    lines.push(`  Total Cost: $${summary.totalCost.toFixed(2)}`);
    lines.push(`  Requests: ${summary.totalRequests.toLocaleString()}`);
    lines.push(`  Tokens: ${(summary.totalTokens.in + summary.totalTokens.out).toLocaleString()}`);
    lines.push(`  Avg Response: ${summary.avgResponseTime.toFixed(0)}ms`);
    lines.push(`  Cache Hit Rate: ${(summary.cacheHitRate * 100).toFixed(1)}%`);
    lines.push(`  Error Rate: ${(summary.errorRate * 100).toFixed(1)}%`);
    lines.push(`  Trend: ${summary.trend}`);

    // By Model
    const models = Object.entries(summary.byModel);
    if (models.length > 0) {
      lines.push('');
      lines.push('🤖 By Model');
      for (const [model, stats] of models.sort((a, b) => b[1].cost - a[1].cost)) {
        lines.push(`  ${model}: $${stats.cost.toFixed(2)} (${stats.requests} requests)`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Cleanup old data
   */
  cleanup(daysToKeep: number = 90): number {
    return this.analyticsRepo.deleteOldAnalytics(daysToKeep);
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private checkBudgets(_addedCost: number): void {
    const alerts: CostAlert[] = [];

    // Check session budget
    if (this.budget.session && this.sessionCost > this.budget.session * 0.8) {
      alerts.push({
        type: this.sessionCost >= this.budget.session ? 'exceeded' : 'warning',
        budget: 'session',
        limit: this.budget.session,
        current: this.sessionCost,
        percentage: (this.sessionCost / this.budget.session) * 100,
      });
    }

    // Check daily budget
    const dailyCost = this.getDailyCost();
    if (this.budget.daily && dailyCost > this.budget.daily * 0.8) {
      alerts.push({
        type: dailyCost >= this.budget.daily ? 'exceeded' : 'warning',
        budget: 'daily',
        limit: this.budget.daily,
        current: dailyCost,
        percentage: (dailyCost / this.budget.daily) * 100,
      });
    }

    // Emit alerts
    for (const alert of alerts) {
      this.emit('budget:alert', alert);
    }
  }

  private formatBudgetStatus(limit: number, used: number): {
    limit: number;
    used: number;
    remaining: number;
    percentage: number;
  } {
    return {
      limit,
      used,
      remaining: Math.max(0, limit - used),
      percentage: limit > 0 ? (used / limit) * 100 : 0,
    };
  }

  private formatPeriod(filter: AnalyticsFilter): string {
    if (filter.startDate && filter.endDate) {
      return `${filter.startDate} to ${filter.endDate}`;
    }
    if (filter.startDate) {
      return `From ${filter.startDate}`;
    }
    if (filter.endDate) {
      return `Until ${filter.endDate}`;
    }
    return 'All time';
  }

  private calculateTrend(analytics: Analytics[]): 'increasing' | 'stable' | 'decreasing' {
    if (analytics.length < 2) return 'stable';

    // Sort by date
    const sorted = [...analytics].sort((a, b) => a.date.localeCompare(b.date));

    // Split into halves
    const midpoint = Math.floor(sorted.length / 2);
    const firstHalf = sorted.slice(0, midpoint);
    const secondHalf = sorted.slice(midpoint);

    // Calculate average cost per day
    const avgFirst = firstHalf.reduce((sum, a) => sum + a.cost, 0) / firstHalf.length;
    const avgSecond = secondHalf.reduce((sum, a) => sum + a.cost, 0) / secondHalf.length;

    const changePercent = avgFirst > 0 ? ((avgSecond - avgFirst) / avgFirst) * 100 : 0;

    if (changePercent > 10) return 'increasing';
    if (changePercent < -10) return 'decreasing';
    return 'stable';
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let instance: PersistentAnalytics | null = null;

export function getPersistentAnalytics(budget?: Partial<CostBudget>): PersistentAnalytics {
  if (!instance) {
    instance = new PersistentAnalytics(budget);
  }
  return instance;
}

export function resetPersistentAnalytics(): void {
  if (instance) {
    instance.removeAllListeners();
  }
  instance = null;
}
