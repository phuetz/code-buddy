/**
 * Analytics Dashboard
 *
 * Features:
 * - Usage metrics tracking
 * - Cost estimation and monitoring
 * - Session analytics
 * - Performance metrics
 * - Export to various formats
 *
 * Provides insights into CLI usage patterns and AI costs.
 */

import { EventEmitter } from 'events';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';

export interface UsageMetrics {
  totalSessions: number;
  totalMessages: number;
  totalTokensInput: number;
  totalTokensOutput: number;
  totalToolCalls: number;
  totalFileEdits: number;
  totalCommands: number;
  averageSessionDuration: number;
  averageMessagesPerSession: number;
}

export interface CostMetrics {
  totalCost: number;
  costByModel: Record<string, number>;
  costByDay: Record<string, number>;
  costByWeek: Record<string, number>;
  costByMonth: Record<string, number>;
  estimatedMonthlyCost: number;
  budgetRemaining?: number;
}

export interface PerformanceMetrics {
  averageResponseTime: number;
  p50ResponseTime: number;
  p90ResponseTime: number;
  p99ResponseTime: number;
  successRate: number;
  errorRate: number;
  timeoutRate: number;
  cacheHitRate: number;
}

export interface SessionMetrics {
  id: string;
  startTime: Date;
  endTime?: Date;
  duration: number;
  messages: number;
  tokensInput: number;
  tokensOutput: number;
  toolCalls: number;
  fileEdits: number;
  cost: number;
  model: string;
  errors: number;
}

export interface ToolMetrics {
  name: string;
  callCount: number;
  successCount: number;
  errorCount: number;
  averageDuration: number;
  totalDuration: number;
}

export interface DailyStats {
  date: string;
  sessions: number;
  messages: number;
  tokensInput: number;
  tokensOutput: number;
  cost: number;
  errors: number;
  activeMinutes: number;
}

export interface AnalyticsEvent {
  type: string;
  timestamp: Date;
  sessionId: string;
  data: Record<string, unknown>;
}

export interface DashboardConfig {
  enabled: boolean;
  retentionDays: number;
  budgetLimit?: number;
  budgetAlertThreshold: number;
  aggregationInterval: 'hourly' | 'daily' | 'weekly';
  exportFormat: 'json' | 'csv' | 'markdown';
}

// Model pricing (per 1M tokens)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'grok-3': { input: 3.0, output: 15.0 },
  'grok-3-fast': { input: 5.0, output: 25.0 },
  'grok-3-mini': { input: 0.3, output: 0.5 },
  'grok-3-mini-fast': { input: 0.6, output: 4.0 },
  'grok-2': { input: 2.0, output: 10.0 },
  'grok-2-mini': { input: 0.1, output: 0.25 },
  'grok-3-latest': { input: 3.0, output: 15.0 },
  'default': { input: 3.0, output: 15.0 },
};

const DEFAULT_CONFIG: DashboardConfig = {
  enabled: true,
  retentionDays: 90,
  budgetAlertThreshold: 0.8,
  aggregationInterval: 'daily',
  exportFormat: 'json',
};

/**
 * Analytics Dashboard
 */
export class AnalyticsDashboard extends EventEmitter {
  private config: DashboardConfig;
  private dataDir: string;
  private sessions: Map<string, SessionMetrics> = new Map();
  private tools: Map<string, ToolMetrics> = new Map();
  private events: AnalyticsEvent[] = [];
  private dailyStats: Map<string, DailyStats> = new Map();
  private currentSessionId: string | null = null;

  constructor(config: Partial<DashboardConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.dataDir = path.join(os.homedir(), '.grok', 'analytics');
    this.initialize();
  }

  /**
   * Initialize analytics
   */
  private async initialize(): Promise<void> {
    await fs.ensureDir(this.dataDir);
    await this.loadData();
    this.startAutoSave();
  }

  /**
   * Load persisted data
   */
  private async loadData(): Promise<void> {
    try {
      // Load sessions
      const sessionsPath = path.join(this.dataDir, 'sessions.json');
      if (await fs.pathExists(sessionsPath)) {
        const data = await fs.readJSON(sessionsPath);
        this.sessions = new Map(Object.entries(data));
      }

      // Load tools
      const toolsPath = path.join(this.dataDir, 'tools.json');
      if (await fs.pathExists(toolsPath)) {
        const data = await fs.readJSON(toolsPath);
        this.tools = new Map(Object.entries(data));
      }

      // Load daily stats
      const statsPath = path.join(this.dataDir, 'daily-stats.json');
      if (await fs.pathExists(statsPath)) {
        const data = await fs.readJSON(statsPath);
        this.dailyStats = new Map(Object.entries(data));
      }
    } catch {
      // Start fresh if loading fails
    }
  }

  /**
   * Save data to disk
   */
  private async saveData(): Promise<void> {
    try {
      await fs.writeJSON(
        path.join(this.dataDir, 'sessions.json'),
        Object.fromEntries(this.sessions),
        { spaces: 2 }
      );

      await fs.writeJSON(
        path.join(this.dataDir, 'tools.json'),
        Object.fromEntries(this.tools),
        { spaces: 2 }
      );

      await fs.writeJSON(
        path.join(this.dataDir, 'daily-stats.json'),
        Object.fromEntries(this.dailyStats),
        { spaces: 2 }
      );
    } catch {
      // Ignore save errors
    }
  }

  /**
   * Start auto-save interval
   */
  private startAutoSave(): void {
    setInterval(() => {
      this.saveData();
      this.cleanupOldData();
    }, 60000); // Every minute
  }

  /**
   * Cleanup old data based on retention policy
   */
  private async cleanupOldData(): Promise<void> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - this.config.retentionDays);

    // Cleanup old sessions
    for (const [id, session] of this.sessions) {
      if (new Date(session.startTime) < cutoff) {
        this.sessions.delete(id);
      }
    }

    // Cleanup old daily stats
    const cutoffStr = cutoff.toISOString().split('T')[0];
    for (const [date] of this.dailyStats) {
      if (date < cutoffStr) {
        this.dailyStats.delete(date);
      }
    }
  }

  /**
   * Start a new session
   */
  startSession(model: string = 'grok-3-latest'): string {
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const session: SessionMetrics = {
      id: sessionId,
      startTime: new Date(),
      duration: 0,
      messages: 0,
      tokensInput: 0,
      tokensOutput: 0,
      toolCalls: 0,
      fileEdits: 0,
      cost: 0,
      model,
      errors: 0,
    };

    this.sessions.set(sessionId, session);
    this.currentSessionId = sessionId;

    this.trackEvent('session_start', { model });
    this.emit('session:start', { sessionId });

    return sessionId;
  }

  /**
   * End current session
   */
  endSession(): void {
    if (!this.currentSessionId) return;

    const session = this.sessions.get(this.currentSessionId);
    if (session) {
      session.endTime = new Date();
      session.duration = session.endTime.getTime() - new Date(session.startTime).getTime();

      // Update daily stats
      this.updateDailyStats(session);

      this.trackEvent('session_end', {
        duration: session.duration,
        messages: session.messages,
        cost: session.cost,
      });

      this.emit('session:end', { session });
    }

    this.currentSessionId = null;
    this.saveData();
  }

  /**
   * Track a message
   */
  trackMessage(tokensInput: number, tokensOutput: number, model?: string): void {
    if (!this.currentSessionId) return;

    const session = this.sessions.get(this.currentSessionId);
    if (session) {
      session.messages++;
      session.tokensInput += tokensInput;
      session.tokensOutput += tokensOutput;

      // Calculate cost
      const pricing = MODEL_PRICING[model || session.model] || MODEL_PRICING.default;
      const cost = (tokensInput * pricing.input + tokensOutput * pricing.output) / 1_000_000;
      session.cost += cost;

      this.trackEvent('message', { tokensInput, tokensOutput, cost });
      this.checkBudgetAlert();
    }
  }

  /**
   * Track a tool call
   */
  trackToolCall(
    toolName: string,
    success: boolean,
    duration: number,
    details?: Record<string, unknown>
  ): void {
    if (!this.currentSessionId) return;

    const session = this.sessions.get(this.currentSessionId);
    if (session) {
      session.toolCalls++;
      if (!success) session.errors++;
    }

    // Update tool metrics
    let tool = this.tools.get(toolName);
    if (!tool) {
      tool = {
        name: toolName,
        callCount: 0,
        successCount: 0,
        errorCount: 0,
        averageDuration: 0,
        totalDuration: 0,
      };
      this.tools.set(toolName, tool);
    }

    tool.callCount++;
    if (success) {
      tool.successCount++;
    } else {
      tool.errorCount++;
    }
    tool.totalDuration += duration;
    tool.averageDuration = tool.totalDuration / tool.callCount;

    // Track file edits
    if (toolName === 'Edit' || toolName === 'Write') {
      if (session) session.fileEdits++;
    }

    this.trackEvent('tool_call', { toolName, success, duration, ...details });
  }

  /**
   * Track an event
   */
  trackEvent(type: string, data: Record<string, unknown>): void {
    const event: AnalyticsEvent = {
      type,
      timestamp: new Date(),
      sessionId: this.currentSessionId || 'unknown',
      data,
    };

    this.events.push(event);

    // Keep only recent events in memory
    if (this.events.length > 10000) {
      this.events = this.events.slice(-5000);
    }

    this.emit('event', event);
  }

  /**
   * Update daily stats
   */
  private updateDailyStats(session: SessionMetrics): void {
    const date = new Date(session.startTime).toISOString().split('T')[0];

    let stats = this.dailyStats.get(date);
    if (!stats) {
      stats = {
        date,
        sessions: 0,
        messages: 0,
        tokensInput: 0,
        tokensOutput: 0,
        cost: 0,
        errors: 0,
        activeMinutes: 0,
      };
      this.dailyStats.set(date, stats);
    }

    stats.sessions++;
    stats.messages += session.messages;
    stats.tokensInput += session.tokensInput;
    stats.tokensOutput += session.tokensOutput;
    stats.cost += session.cost;
    stats.errors += session.errors;
    stats.activeMinutes += Math.round(session.duration / 60000);
  }

  /**
   * Check budget and emit alert if needed
   */
  private checkBudgetAlert(): void {
    if (!this.config.budgetLimit) return;

    const totalCost = this.getTotalCost();
    const threshold = this.config.budgetLimit * this.config.budgetAlertThreshold;

    if (totalCost >= threshold) {
      this.emit('budget:alert', {
        current: totalCost,
        limit: this.config.budgetLimit,
        percentage: (totalCost / this.config.budgetLimit) * 100,
      });
    }
  }

  /**
   * Get total cost
   */
  getTotalCost(): number {
    let total = 0;
    for (const session of this.sessions.values()) {
      total += session.cost;
    }
    return total;
  }

  /**
   * Get usage metrics
   */
  getUsageMetrics(): UsageMetrics {
    let totalMessages = 0;
    let totalTokensInput = 0;
    let totalTokensOutput = 0;
    let totalToolCalls = 0;
    let totalFileEdits = 0;
    let totalDuration = 0;
    let sessionCount = 0;

    for (const session of this.sessions.values()) {
      totalMessages += session.messages;
      totalTokensInput += session.tokensInput;
      totalTokensOutput += session.tokensOutput;
      totalToolCalls += session.toolCalls;
      totalFileEdits += session.fileEdits;
      totalDuration += session.duration;
      sessionCount++;
    }

    return {
      totalSessions: sessionCount,
      totalMessages,
      totalTokensInput,
      totalTokensOutput,
      totalToolCalls,
      totalFileEdits,
      totalCommands: totalToolCalls,
      averageSessionDuration: sessionCount > 0 ? totalDuration / sessionCount : 0,
      averageMessagesPerSession: sessionCount > 0 ? totalMessages / sessionCount : 0,
    };
  }

  /**
   * Get cost metrics
   */
  getCostMetrics(): CostMetrics {
    const costByModel: Record<string, number> = {};
    const costByDay: Record<string, number> = {};
    const costByWeek: Record<string, number> = {};
    const costByMonth: Record<string, number> = {};

    for (const session of this.sessions.values()) {
      // By model
      costByModel[session.model] = (costByModel[session.model] || 0) + session.cost;

      // By day
      const day = new Date(session.startTime).toISOString().split('T')[0];
      costByDay[day] = (costByDay[day] || 0) + session.cost;

      // By week
      const weekStart = this.getWeekStart(new Date(session.startTime));
      costByWeek[weekStart] = (costByWeek[weekStart] || 0) + session.cost;

      // By month
      const month = new Date(session.startTime).toISOString().slice(0, 7);
      costByMonth[month] = (costByMonth[month] || 0) + session.cost;
    }

    const totalCost = this.getTotalCost();
    const currentMonth = new Date().toISOString().slice(0, 7);
    const monthCost = costByMonth[currentMonth] || 0;
    const daysInMonth = new Date().getDate();
    const estimatedMonthlyCost = daysInMonth > 0 ? (monthCost / daysInMonth) * 30 : 0;

    return {
      totalCost,
      costByModel,
      costByDay,
      costByWeek,
      costByMonth,
      estimatedMonthlyCost,
      budgetRemaining: this.config.budgetLimit
        ? this.config.budgetLimit - totalCost
        : undefined,
    };
  }

  /**
   * Get week start date string
   */
  private getWeekStart(date: Date): string {
    const d = new Date(date);
    d.setDate(d.getDate() - d.getDay());
    return d.toISOString().split('T')[0];
  }

  /**
   * Get performance metrics
   */
  getPerformanceMetrics(): PerformanceMetrics {
    const responseTimes: number[] = [];
    let successCount = 0;
    let errorCount = 0;
    let timeoutCount = 0;
    let cacheHits = 0;
    let totalRequests = 0;

    for (const tool of this.tools.values()) {
      totalRequests += tool.callCount;
      successCount += tool.successCount;
      errorCount += tool.errorCount;

      // Estimate response times from tool durations
      for (let i = 0; i < tool.callCount; i++) {
        responseTimes.push(tool.averageDuration);
      }
    }

    // Sort for percentiles
    responseTimes.sort((a, b) => a - b);

    const getPercentile = (arr: number[], p: number): number => {
      if (arr.length === 0) return 0;
      const index = Math.ceil((p / 100) * arr.length) - 1;
      return arr[Math.max(0, index)];
    };

    return {
      averageResponseTime:
        responseTimes.length > 0
          ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
          : 0,
      p50ResponseTime: getPercentile(responseTimes, 50),
      p90ResponseTime: getPercentile(responseTimes, 90),
      p99ResponseTime: getPercentile(responseTimes, 99),
      successRate: totalRequests > 0 ? (successCount / totalRequests) * 100 : 100,
      errorRate: totalRequests > 0 ? (errorCount / totalRequests) * 100 : 0,
      timeoutRate: totalRequests > 0 ? (timeoutCount / totalRequests) * 100 : 0,
      cacheHitRate: totalRequests > 0 ? (cacheHits / totalRequests) * 100 : 0,
    };
  }

  /**
   * Get tool metrics
   */
  getToolMetrics(): ToolMetrics[] {
    return Array.from(this.tools.values()).sort((a, b) => b.callCount - a.callCount);
  }

  /**
   * Get daily stats for a date range
   */
  getDailyStats(startDate?: Date, endDate?: Date): DailyStats[] {
    const stats: DailyStats[] = [];
    const start = startDate?.toISOString().split('T')[0] || '0000-00-00';
    const end = endDate?.toISOString().split('T')[0] || '9999-99-99';

    for (const [date, data] of this.dailyStats) {
      if (date >= start && date <= end) {
        stats.push(data);
      }
    }

    return stats.sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Get recent sessions
   */
  getRecentSessions(limit: number = 10): SessionMetrics[] {
    return Array.from(this.sessions.values())
      .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
      .slice(0, limit);
  }

  /**
   * Export analytics data
   */
  async exportData(format: 'json' | 'csv' | 'markdown' = 'json'): Promise<string> {
    const data = {
      exportedAt: new Date().toISOString(),
      usage: this.getUsageMetrics(),
      costs: this.getCostMetrics(),
      performance: this.getPerformanceMetrics(),
      tools: this.getToolMetrics(),
      dailyStats: this.getDailyStats(),
      recentSessions: this.getRecentSessions(50),
    };

    switch (format) {
      case 'json':
        return JSON.stringify(data, null, 2);

      case 'csv':
        return this.toCSV(data);

      case 'markdown':
        return this.toMarkdown(data);

      default:
        return JSON.stringify(data, null, 2);
    }
  }

  /**
   * Convert to CSV
   */
  private toCSV(data: any): string {
    let csv = '';

    // Daily stats
    csv += 'Daily Stats\n';
    csv += 'date,sessions,messages,tokensInput,tokensOutput,cost,errors,activeMinutes\n';
    for (const day of data.dailyStats) {
      csv += `${day.date},${day.sessions},${day.messages},${day.tokensInput},${day.tokensOutput},${day.cost.toFixed(4)},${day.errors},${day.activeMinutes}\n`;
    }

    csv += '\nTool Metrics\n';
    csv += 'name,callCount,successCount,errorCount,averageDuration\n';
    for (const tool of data.tools) {
      csv += `${tool.name},${tool.callCount},${tool.successCount},${tool.errorCount},${tool.averageDuration.toFixed(2)}\n`;
    }

    return csv;
  }

  /**
   * Convert to Markdown
   */
  private toMarkdown(data: any): string {
    let md = '# Grok CLI Analytics Report\n\n';
    md += `**Generated:** ${data.exportedAt}\n\n`;

    md += '## Usage Summary\n\n';
    md += `| Metric | Value |\n|--------|-------|\n`;
    md += `| Total Sessions | ${data.usage.totalSessions} |\n`;
    md += `| Total Messages | ${data.usage.totalMessages} |\n`;
    md += `| Total Tokens (Input) | ${data.usage.totalTokensInput.toLocaleString()} |\n`;
    md += `| Total Tokens (Output) | ${data.usage.totalTokensOutput.toLocaleString()} |\n`;
    md += `| Total Tool Calls | ${data.usage.totalToolCalls} |\n`;
    md += `| File Edits | ${data.usage.totalFileEdits} |\n`;

    md += '\n## Cost Summary\n\n';
    md += `| Metric | Value |\n|--------|-------|\n`;
    md += `| Total Cost | $${data.costs.totalCost.toFixed(2)} |\n`;
    md += `| Est. Monthly Cost | $${data.costs.estimatedMonthlyCost.toFixed(2)} |\n`;

    if (data.costs.budgetRemaining !== undefined) {
      md += `| Budget Remaining | $${data.costs.budgetRemaining.toFixed(2)} |\n`;
    }

    md += '\n### Cost by Model\n\n';
    md += `| Model | Cost |\n|-------|------|\n`;
    for (const [model, cost] of Object.entries(data.costs.costByModel)) {
      md += `| ${model} | $${(cost as number).toFixed(2)} |\n`;
    }

    md += '\n## Performance\n\n';
    md += `| Metric | Value |\n|--------|-------|\n`;
    md += `| Avg Response Time | ${data.performance.averageResponseTime.toFixed(0)}ms |\n`;
    md += `| P50 Response Time | ${data.performance.p50ResponseTime.toFixed(0)}ms |\n`;
    md += `| P90 Response Time | ${data.performance.p90ResponseTime.toFixed(0)}ms |\n`;
    md += `| Success Rate | ${data.performance.successRate.toFixed(1)}% |\n`;
    md += `| Error Rate | ${data.performance.errorRate.toFixed(1)}% |\n`;

    md += '\n## Top Tools\n\n';
    md += `| Tool | Calls | Success Rate |\n|------|-------|-------------|\n`;
    for (const tool of data.tools.slice(0, 10)) {
      const rate = tool.callCount > 0 ? ((tool.successCount / tool.callCount) * 100).toFixed(1) : '100';
      md += `| ${tool.name} | ${tool.callCount} | ${rate}% |\n`;
    }

    return md;
  }

  /**
   * Render dashboard in terminal
   */
  renderDashboard(): string {
    const usage = this.getUsageMetrics();
    const costs = this.getCostMetrics();
    const perf = this.getPerformanceMetrics();

    const lines = [
      '╔══════════════════════════════════════════════════════════════════════════════╗',
      '║                           📊 ANALYTICS DASHBOARD                             ║',
      '╠══════════════════════════════════════════════════════════════════════════════╣',
      '║                                                                              ║',
      '║  📈 USAGE                          💰 COSTS                                  ║',
      '║  ─────────────────────             ─────────────────────                     ║',
      `║  Sessions:    ${String(usage.totalSessions).padEnd(10)}          Total:        $${costs.totalCost.toFixed(2).padEnd(10)}             ║`,
      `║  Messages:    ${String(usage.totalMessages).padEnd(10)}          Est. Monthly: $${costs.estimatedMonthlyCost.toFixed(2).padEnd(10)}             ║`,
      `║  Tokens In:   ${usage.totalTokensInput.toLocaleString().padEnd(10)}          ${costs.budgetRemaining !== undefined ? `Remaining:    $${costs.budgetRemaining.toFixed(2).padEnd(10)}` : '                           '}             ║`,
      `║  Tokens Out:  ${usage.totalTokensOutput.toLocaleString().padEnd(10)}                                                ║`,
      `║  Tool Calls:  ${String(usage.totalToolCalls).padEnd(10)}                                                ║`,
      '║                                                                              ║',
      '╠══════════════════════════════════════════════════════════════════════════════╣',
      '║                                                                              ║',
      '║  ⚡ PERFORMANCE                                                               ║',
      '║  ─────────────────────                                                       ║',
      `║  Avg Response:  ${perf.averageResponseTime.toFixed(0).padEnd(6)}ms     Success Rate: ${perf.successRate.toFixed(1)}%                        ║`,
      `║  P90 Response:  ${perf.p90ResponseTime.toFixed(0).padEnd(6)}ms     Error Rate:   ${perf.errorRate.toFixed(1)}%                        ║`,
      '║                                                                              ║',
      '╠══════════════════════════════════════════════════════════════════════════════╣',
      '║  Commands: /analytics export | /analytics reset | /analytics budget <amount> ║',
      '╚══════════════════════════════════════════════════════════════════════════════╝',
    ];

    return lines.join('\n');
  }

  /**
   * Set budget limit
   */
  setBudget(amount: number): void {
    this.config.budgetLimit = amount;
    this.saveConfig();
    this.emit('budget:set', { amount });
  }

  /**
   * Save config
   */
  private async saveConfig(): Promise<void> {
    const configPath = path.join(this.dataDir, 'config.json');
    await fs.writeJSON(configPath, this.config, { spaces: 2 });
  }

  /**
   * Reset all analytics
   */
  async reset(): Promise<void> {
    this.sessions.clear();
    this.tools.clear();
    this.dailyStats.clear();
    this.events = [];

    await fs.emptyDir(this.dataDir);
    this.emit('reset');
  }

  /**
   * Get config
   */
  getConfig(): DashboardConfig {
    return { ...this.config };
  }

  /**
   * Update config
   */
  updateConfig(config: Partial<DashboardConfig>): void {
    this.config = { ...this.config, ...config };
    this.saveConfig();
  }

  /**
   * Dispose
   */
  dispose(): void {
    this.saveData();
    this.removeAllListeners();
  }
}

// Singleton
let dashboardInstance: AnalyticsDashboard | null = null;

export function getAnalyticsDashboard(config?: Partial<DashboardConfig>): AnalyticsDashboard {
  if (!dashboardInstance) {
    dashboardInstance = new AnalyticsDashboard(config);
  }
  return dashboardInstance;
}

export function resetAnalyticsDashboard(): void {
  if (dashboardInstance) {
    dashboardInstance.dispose();
  }
  dashboardInstance = null;
}
