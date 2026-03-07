/**
 * ROI Tracker
 *
 * Track return on investment:
 * - Time saved estimation
 * - API cost tracking
 * - Productivity gains
 * - Value analysis
 */

import fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';

export interface TaskCompletion {
  id: string;
  type: 'code_generation' | 'bug_fix' | 'refactoring' | 'documentation' | 'testing' | 'research' | 'other';
  description: string;
  timestamp: Date;
  apiCost: number;
  tokensUsed: number;
  estimatedManualMinutes: number;
  actualMinutes: number;
  linesOfCode?: number;
  filesModified?: number;
  success: boolean;
}

export interface ROIMetrics {
  totalApiCost: number;
  totalTimeSavedMinutes: number;
  totalActualMinutes: number;
  totalManualMinutesEstimate: number;
  tasksCompleted: number;
  successRate: number;
  averageTimeSavings: number;
  costPerHourSaved: number;
  productivityMultiplier: number;
  netValue: number; // Based on hourly rate
}

export interface ROIReport {
  period: {
    from: Date;
    to: Date;
    days: number;
  };
  metrics: ROIMetrics;
  byType: Record<TaskCompletion['type'], ROIMetrics>;
  trends: {
    weeklyApiCost: number[];
    weeklyTimeSaved: number[];
    weeklyProductivity: number[];
  };
  recommendations: string[];
  generatedAt: Date;
}

export interface ROIConfig {
  /** Hourly rate for value calculations ($) */
  hourlyRate: number;
  /** Path to data storage */
  dataPath?: string;
}

const DEFAULT_CONFIG: Required<ROIConfig> = {
  hourlyRate: 50,
  dataPath: path.join(os.homedir(), '.codebuddy', 'roi-data.json'),
};

// Estimated time to complete tasks manually (in minutes)
const MANUAL_TIME_ESTIMATES: Record<TaskCompletion['type'], { min: number; perLine: number }> = {
  code_generation: { min: 15, perLine: 0.5 },
  bug_fix: { min: 30, perLine: 1 },
  refactoring: { min: 20, perLine: 0.3 },
  documentation: { min: 10, perLine: 0.2 },
  testing: { min: 20, perLine: 0.4 },
  research: { min: 20, perLine: 0 },
  other: { min: 15, perLine: 0.3 },
};

/**
 * ROI Tracker
 */
export class ROITracker {
  private config: Required<ROIConfig>;
  private tasks: TaskCompletion[] = [];

  constructor(config?: Partial<ROIConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.loadData();
  }

  /**
   * Record a completed task
   */
  recordTask(task: Omit<TaskCompletion, 'id' | 'timestamp' | 'estimatedManualMinutes'>): void {
    const estimate = this.estimateManualTime(task.type, task.linesOfCode);

    this.tasks.push({
      ...task,
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date(),
      estimatedManualMinutes: estimate,
    });

    this.saveData();
  }

  /**
   * Estimate manual completion time
   */
  estimateManualTime(type: TaskCompletion['type'], linesOfCode?: number): number {
    const estimate = MANUAL_TIME_ESTIMATES[type];
    const base = estimate.min;
    const perLine = linesOfCode ? linesOfCode * estimate.perLine : 0;
    return Math.round(base + perLine);
  }

  /**
   * Get ROI report
   */
  getReport(days: number = 30): ROIReport {
    const to = new Date();
    const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const periodTasks = this.tasks.filter(t =>
      t.timestamp >= from && t.timestamp <= to
    );

    const metrics = this.calculateMetrics(periodTasks);
    const byType = this.calculateByType(periodTasks);
    const trends = this.calculateTrends(periodTasks, days);
    const recommendations = this.generateRecommendations(metrics, byType);

    return {
      period: { from, to, days },
      metrics,
      byType,
      trends,
      recommendations,
      generatedAt: new Date(),
    };
  }

  /**
   * Calculate overall metrics
   */
  private calculateMetrics(tasks: TaskCompletion[]): ROIMetrics {
    const successfulTasks = tasks.filter(t => t.success);

    const totalApiCost = tasks.reduce((sum, t) => sum + t.apiCost, 0);
    const totalActualMinutes = tasks.reduce((sum, t) => sum + t.actualMinutes, 0);
    const totalManualMinutesEstimate = tasks.reduce((sum, t) => sum + t.estimatedManualMinutes, 0);
    const totalTimeSavedMinutes = totalManualMinutesEstimate - totalActualMinutes;

    const successRate = tasks.length > 0 ? successfulTasks.length / tasks.length : 0;
    const averageTimeSavings = tasks.length > 0 ? totalTimeSavedMinutes / tasks.length : 0;

    const hoursSaved = totalTimeSavedMinutes / 60;
    const costPerHourSaved = hoursSaved > 0 ? totalApiCost / hoursSaved : 0;
    const productivityMultiplier = totalActualMinutes > 0
      ? totalManualMinutesEstimate / totalActualMinutes
      : 1;

    const valueSaved = hoursSaved * this.config.hourlyRate;
    const netValue = valueSaved - totalApiCost;

    return {
      totalApiCost,
      totalTimeSavedMinutes,
      totalActualMinutes,
      totalManualMinutesEstimate,
      tasksCompleted: tasks.length,
      successRate,
      averageTimeSavings,
      costPerHourSaved,
      productivityMultiplier,
      netValue,
    };
  }

  /**
   * Calculate metrics by type
   */
  private calculateByType(tasks: TaskCompletion[]): Record<TaskCompletion['type'], ROIMetrics> {
    const types: TaskCompletion['type'][] = [
      'code_generation', 'bug_fix', 'refactoring', 'documentation', 'testing', 'research', 'other'
    ];

    const result = {} as Record<TaskCompletion['type'], ROIMetrics>;

    for (const type of types) {
      const typeTasks = tasks.filter(t => t.type === type);
      result[type] = this.calculateMetrics(typeTasks);
    }

    return result;
  }

  /**
   * Calculate weekly trends
   */
  private calculateTrends(tasks: TaskCompletion[], days: number): ROIReport['trends'] {
    const weeks = Math.ceil(days / 7);
    const weeklyApiCost: number[] = [];
    const weeklyTimeSaved: number[] = [];
    const weeklyProductivity: number[] = [];

    for (let w = 0; w < weeks; w++) {
      const weekStart = new Date(Date.now() - (w + 1) * 7 * 24 * 60 * 60 * 1000);
      const weekEnd = new Date(Date.now() - w * 7 * 24 * 60 * 60 * 1000);

      const weekTasks = tasks.filter(t =>
        t.timestamp >= weekStart && t.timestamp < weekEnd
      );

      const metrics = this.calculateMetrics(weekTasks);

      weeklyApiCost.unshift(metrics.totalApiCost);
      weeklyTimeSaved.unshift(metrics.totalTimeSavedMinutes);
      weeklyProductivity.unshift(metrics.productivityMultiplier);
    }

    return { weeklyApiCost, weeklyTimeSaved, weeklyProductivity };
  }

  /**
   * Generate recommendations
   */
  private generateRecommendations(
    metrics: ROIMetrics,
    byType: Record<TaskCompletion['type'], ROIMetrics>
  ): string[] {
    const recommendations: string[] = [];

    // Check overall ROI
    if (metrics.netValue > 0) {
      recommendations.push(
        `Great ROI! You've saved $${metrics.netValue.toFixed(2)} net value.`
      );
    } else if (metrics.netValue < -50) {
      recommendations.push(
        'Consider using AI assistance for more complex tasks to improve ROI.'
      );
    }

    // Check productivity
    if (metrics.productivityMultiplier < 2) {
      recommendations.push(
        'Productivity gain is below 2x. Try using more specific prompts.'
      );
    } else if (metrics.productivityMultiplier > 5) {
      recommendations.push(
        `Excellent ${metrics.productivityMultiplier.toFixed(1)}x productivity! Keep it up.`
      );
    }

    // Check success rate
    if (metrics.successRate < 0.8) {
      recommendations.push(
        'Success rate is below 80%. Consider breaking complex tasks into smaller ones.'
      );
    }

    // Find best performing task type
    let bestType: TaskCompletion['type'] = 'code_generation';
    let bestMultiplier = 0;

    for (const [type, typeMetrics] of Object.entries(byType)) {
      if (typeMetrics.productivityMultiplier > bestMultiplier && typeMetrics.tasksCompleted > 0) {
        bestMultiplier = typeMetrics.productivityMultiplier;
        bestType = type as TaskCompletion['type'];
      }
    }

    if (bestMultiplier > 0) {
      recommendations.push(
        `Best ROI on ${bestType.replace('_', ' ')} tasks (${bestMultiplier.toFixed(1)}x productivity).`
      );
    }

    // Check cost efficiency
    if (metrics.costPerHourSaved > 20) {
      recommendations.push(
        'Cost per hour saved is high. Consider batching similar tasks together.'
      );
    }

    return recommendations;
  }

  /**
   * Format ROI report for display
   */
  formatReport(report: ROIReport): string {
    const lines: string[] = [];

    lines.push('');
    lines.push('═══════════════════════════════════════════════════════════════════════════════');
    lines.push('                              ROI ANALYSIS REPORT');
    lines.push('═══════════════════════════════════════════════════════════════════════════════');
    lines.push(`Period: ${report.period.from.toLocaleDateString()} - ${report.period.to.toLocaleDateString()} (${report.period.days} days)`);
    lines.push('');

    // Overall Metrics
    lines.push('OVERALL METRICS');
    lines.push('───────────────────────────────────────────────────────────────────────────────');
    lines.push(`  Tasks Completed:      ${report.metrics.tasksCompleted}`);
    lines.push(`  Success Rate:         ${(report.metrics.successRate * 100).toFixed(0)}%`);
    lines.push(`  Total API Cost:       $${report.metrics.totalApiCost.toFixed(4)}`);
    lines.push(`  Time with AI:         ${report.metrics.totalActualMinutes} min`);
    lines.push(`  Est. Manual Time:     ${report.metrics.totalManualMinutesEstimate} min`);
    lines.push(`  Time Saved:           ${report.metrics.totalTimeSavedMinutes} min (${(report.metrics.totalTimeSavedMinutes / 60).toFixed(1)} hours)`);
    lines.push('');

    // Value Analysis
    lines.push('VALUE ANALYSIS');
    lines.push('───────────────────────────────────────────────────────────────────────────────');
    lines.push(`  Hourly Rate:          $${this.config.hourlyRate}/hr`);
    lines.push(`  Value of Time Saved:  $${((report.metrics.totalTimeSavedMinutes / 60) * this.config.hourlyRate).toFixed(2)}`);
    lines.push(`  Net Value:            $${report.metrics.netValue.toFixed(2)} ${report.metrics.netValue >= 0 ? '✓' : '✗'}`);
    lines.push(`  Productivity:         ${report.metrics.productivityMultiplier.toFixed(1)}x faster`);
    lines.push(`  Cost per Hour Saved:  $${report.metrics.costPerHourSaved.toFixed(2)}`);
    lines.push('');

    // By Type breakdown
    lines.push('BY TASK TYPE');
    lines.push('───────────────────────────────────────────────────────────────────────────────');
    for (const [type, metrics] of Object.entries(report.byType)) {
      if (metrics.tasksCompleted > 0) {
        const typeName = type.replace('_', ' ').padEnd(15);
        lines.push(`  ${typeName} ${metrics.tasksCompleted} tasks  ${metrics.productivityMultiplier.toFixed(1)}x  $${metrics.totalApiCost.toFixed(4)}`);
      }
    }
    lines.push('');

    // Trends
    if (report.trends.weeklyProductivity.length > 1) {
      lines.push('WEEKLY PRODUCTIVITY TREND');
      lines.push('───────────────────────────────────────────────────────────────────────────────');
      for (let i = 0; i < report.trends.weeklyProductivity.length; i++) {
        const week = report.trends.weeklyProductivity.length - i;
        const prod = report.trends.weeklyProductivity[i];
        const bar = '█'.repeat(Math.min(40, Math.round(prod * 10)));
        lines.push(`  Week -${week}: ${bar} ${prod.toFixed(1)}x`);
      }
      lines.push('');
    }

    // Recommendations
    if (report.recommendations.length > 0) {
      lines.push('RECOMMENDATIONS');
      lines.push('───────────────────────────────────────────────────────────────────────────────');
      for (const rec of report.recommendations) {
        lines.push(`  • ${rec}`);
      }
      lines.push('');
    }

    lines.push('═══════════════════════════════════════════════════════════════════════════════');

    return lines.join('\n');
  }

  /**
   * Export data as JSON
   */
  exportData(): string {
    return JSON.stringify(this.tasks, null, 2);
  }

  /**
   * Set hourly rate
   */
  setHourlyRate(rate: number): void {
    this.config.hourlyRate = rate;
  }

  /**
   * Clear all data
   */
  clear(): void {
    this.tasks = [];
    this.saveData();
  }

  /**
   * Load data from file
   */
  private loadData(): void {
    try {
      if (fs.existsSync(this.config.dataPath)) {
        const data = fs.readJsonSync(this.config.dataPath);
        if (Array.isArray(data)) {
          this.tasks = data.map(t => ({
            ...t,
            timestamp: new Date(t.timestamp),
          }));
        }
      }
    } catch (_error) {
      this.tasks = [];
    }
  }

  /**
   * Save data to file
   */
  private saveData(): void {
    try {
      fs.ensureDirSync(path.dirname(this.config.dataPath));
      fs.writeJsonSync(this.config.dataPath, this.tasks, { spaces: 2 });
    } catch (_error) {
      // Ignore save errors
    }
  }
}

// Singleton instance
let roiTracker: ROITracker | null = null;

/**
 * Get or create ROI tracker
 */
export function getROITracker(config?: Partial<ROIConfig>): ROITracker {
  if (!roiTracker) {
    roiTracker = new ROITracker(config);
  }
  return roiTracker;
}

export default ROITracker;
