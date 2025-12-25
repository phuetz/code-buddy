/**
 * Metrics Dashboard for Code Buddy
 *
 * Provides real-time and historical metrics visualization including:
 * - Token usage and costs
 * - Tool execution statistics
 * - Session analytics
 * - Performance metrics
 */

import { EventEmitter } from 'events';

export interface TokenMetrics {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens: number;
}

export interface CostMetrics {
  totalCost: number;
  sessionCost: number;
  averageCostPerRequest: number;
  costByModel: Record<string, number>;
}

export interface ToolMetrics {
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  executionsByTool: Record<string, { success: number; failed: number; avgTime: number }>;
  averageExecutionTime: number;
}

export interface SessionMetrics {
  sessionId: string;
  startTime: Date;
  duration: number;
  messageCount: number;
  toolRounds: number;
  userMessages: number;
  assistantMessages: number;
}

export interface PerformanceMetrics {
  averageLatency: number;
  p50Latency: number;
  p95Latency: number;
  p99Latency: number;
  requestsPerMinute: number;
  cacheHitRate: number;
}

export interface DashboardMetrics {
  tokens: TokenMetrics;
  costs: CostMetrics;
  tools: ToolMetrics;
  session: SessionMetrics;
  performance: PerformanceMetrics;
  timestamp: Date;
}

export interface MetricsEvent {
  type: 'token_usage' | 'tool_execution' | 'request_complete' | 'cache_hit' | 'cost_update';
  data: Record<string, unknown>;
  timestamp: Date;
}

/**
 * Metrics Dashboard class
 */
export class MetricsDashboard extends EventEmitter {
  private sessionId: string;
  private startTime: Date;
  private events: MetricsEvent[] = [];
  private latencies: number[] = [];
  private maxEvents: number = 10000;

  // Aggregated metrics
  private tokens: TokenMetrics = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cachedTokens: 0,
  };

  private costs: CostMetrics = {
    totalCost: 0,
    sessionCost: 0,
    averageCostPerRequest: 0,
    costByModel: {},
  };

  private tools: ToolMetrics = {
    totalExecutions: 0,
    successfulExecutions: 0,
    failedExecutions: 0,
    executionsByTool: {},
    averageExecutionTime: 0,
  };

  private requestCount: number = 0;
  private cacheHits: number = 0;
  private messageCount: number = 0;
  private userMessages: number = 0;
  private assistantMessages: number = 0;
  private toolRounds: number = 0;

  constructor(sessionId?: string) {
    super();
    this.sessionId = sessionId || this.generateSessionId();
    this.startTime = new Date();
  }

  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * Record token usage
   */
  recordTokenUsage(usage: {
    promptTokens: number;
    completionTokens: number;
    cachedTokens?: number;
  }): void {
    this.tokens.promptTokens += usage.promptTokens;
    this.tokens.completionTokens += usage.completionTokens;
    this.tokens.totalTokens += usage.promptTokens + usage.completionTokens;
    this.tokens.cachedTokens += usage.cachedTokens || 0;

    this.addEvent({
      type: 'token_usage',
      data: usage,
      timestamp: new Date(),
    });

    this.emit('tokenUsage', usage);
  }

  /**
   * Record tool execution
   */
  recordToolExecution(execution: {
    toolName: string;
    success: boolean;
    duration: number;
    error?: string;
  }): void {
    this.tools.totalExecutions++;

    if (execution.success) {
      this.tools.successfulExecutions++;
    } else {
      this.tools.failedExecutions++;
    }

    // Update per-tool stats
    if (!this.tools.executionsByTool[execution.toolName]) {
      this.tools.executionsByTool[execution.toolName] = {
        success: 0,
        failed: 0,
        avgTime: 0,
      };
    }

    const toolStats = this.tools.executionsByTool[execution.toolName];
    if (toolStats) {
      if (execution.success) {
        toolStats.success++;
      } else {
        toolStats.failed++;
      }

      // Update average time
      const totalExecutions = toolStats.success + toolStats.failed;
      toolStats.avgTime =
        (toolStats.avgTime * (totalExecutions - 1) + execution.duration) / totalExecutions;
    }

    // Update overall average
    this.tools.averageExecutionTime =
      (this.tools.averageExecutionTime * (this.tools.totalExecutions - 1) +
        execution.duration) /
      this.tools.totalExecutions;

    this.addEvent({
      type: 'tool_execution',
      data: execution,
      timestamp: new Date(),
    });

    this.emit('toolExecution', execution);
  }

  /**
   * Record request completion
   */
  recordRequestComplete(request: {
    latency: number;
    model: string;
    cost?: number;
  }): void {
    this.requestCount++;
    this.latencies.push(request.latency);

    // Keep latencies array bounded
    if (this.latencies.length > 1000) {
      this.latencies = this.latencies.slice(-1000);
    }

    // Update cost
    if (request.cost) {
      this.costs.totalCost += request.cost;
      this.costs.sessionCost += request.cost;
      this.costs.averageCostPerRequest = this.costs.totalCost / this.requestCount;

      if (!this.costs.costByModel[request.model]) {
        this.costs.costByModel[request.model] = 0;
      }
      this.costs.costByModel[request.model] += request.cost;
    }

    this.addEvent({
      type: 'request_complete',
      data: request,
      timestamp: new Date(),
    });

    this.emit('requestComplete', request);
  }

  /**
   * Record cache hit
   */
  recordCacheHit(): void {
    this.cacheHits++;

    this.addEvent({
      type: 'cache_hit',
      data: { count: this.cacheHits },
      timestamp: new Date(),
    });
  }

  /**
   * Record message
   */
  recordMessage(type: 'user' | 'assistant'): void {
    this.messageCount++;
    if (type === 'user') {
      this.userMessages++;
    } else {
      this.assistantMessages++;
    }
  }

  /**
   * Record tool round
   */
  recordToolRound(): void {
    this.toolRounds++;
  }

  /**
   * Add event to history
   */
  private addEvent(event: MetricsEvent): void {
    this.events.push(event);
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }
  }

  /**
   * Calculate percentile from sorted array
   */
  private percentile(arr: number[], p: number): number {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)] || 0;
  }

  /**
   * Get current metrics snapshot
   */
  getMetrics(): DashboardMetrics {
    const now = new Date();
    const durationMs = now.getTime() - this.startTime.getTime();
    const durationMinutes = durationMs / 60000;

    // Calculate performance metrics
    const avgLatency =
      this.latencies.length > 0
        ? this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length
        : 0;

    return {
      tokens: { ...this.tokens },
      costs: { ...this.costs },
      tools: { ...this.tools },
      session: {
        sessionId: this.sessionId,
        startTime: this.startTime,
        duration: durationMs,
        messageCount: this.messageCount,
        toolRounds: this.toolRounds,
        userMessages: this.userMessages,
        assistantMessages: this.assistantMessages,
      },
      performance: {
        averageLatency: avgLatency,
        p50Latency: this.percentile(this.latencies, 50),
        p95Latency: this.percentile(this.latencies, 95),
        p99Latency: this.percentile(this.latencies, 99),
        requestsPerMinute: durationMinutes > 0 ? this.requestCount / durationMinutes : 0,
        cacheHitRate:
          this.requestCount > 0 ? (this.cacheHits / this.requestCount) * 100 : 0,
      },
      timestamp: now,
    };
  }

  /**
   * Format metrics for terminal display
   */
  formatMetrics(): string {
    const m = this.getMetrics();
    const duration = Math.floor(m.session.duration / 1000);
    const minutes = Math.floor(duration / 60);
    const seconds = duration % 60;

    const lines = [
      '╔══════════════════════════════════════════════════════════════╗',
      '║                   CODE BUDDY METRICS                         ║',
      '╠══════════════════════════════════════════════════════════════╣',
      '║  SESSION                                                     ║',
      `║    Duration: ${minutes}m ${seconds}s                                        ║`.slice(0, 67) + '║',
      `║    Messages: ${m.session.userMessages} user / ${m.session.assistantMessages} assistant                         ║`.slice(0, 67) + '║',
      `║    Tool Rounds: ${m.session.toolRounds}                                          ║`.slice(0, 67) + '║',
      '╠══════════════════════════════════════════════════════════════╣',
      '║  TOKENS                                                      ║',
      `║    Prompt: ${m.tokens.promptTokens.toLocaleString()}                                          ║`.slice(0, 67) + '║',
      `║    Completion: ${m.tokens.completionTokens.toLocaleString()}                                      ║`.slice(0, 67) + '║',
      `║    Cached: ${m.tokens.cachedTokens.toLocaleString()}                                           ║`.slice(0, 67) + '║',
      `║    Total: ${m.tokens.totalTokens.toLocaleString()}                                            ║`.slice(0, 67) + '║',
      '╠══════════════════════════════════════════════════════════════╣',
      '║  COSTS                                                       ║',
      `║    Session: $${m.costs.sessionCost.toFixed(4)}                                         ║`.slice(0, 67) + '║',
      `║    Avg/Request: $${m.costs.averageCostPerRequest.toFixed(6)}                                   ║`.slice(0, 67) + '║',
      '╠══════════════════════════════════════════════════════════════╣',
      '║  TOOLS                                                       ║',
      `║    Total: ${m.tools.totalExecutions} (${m.tools.successfulExecutions} ok, ${m.tools.failedExecutions} failed)                        ║`.slice(0, 67) + '║',
      `║    Avg Time: ${m.tools.averageExecutionTime.toFixed(0)}ms                                        ║`.slice(0, 67) + '║',
      '╠══════════════════════════════════════════════════════════════╣',
      '║  PERFORMANCE                                                 ║',
      `║    Avg Latency: ${m.performance.averageLatency.toFixed(0)}ms                                     ║`.slice(0, 67) + '║',
      `║    P95 Latency: ${m.performance.p95Latency.toFixed(0)}ms                                      ║`.slice(0, 67) + '║',
      `║    Cache Hit Rate: ${m.performance.cacheHitRate.toFixed(1)}%                                    ║`.slice(0, 67) + '║',
      '╚══════════════════════════════════════════════════════════════╝',
    ];

    return lines.join('\n');
  }

  /**
   * Export metrics to JSON
   */
  exportMetrics(): string {
    return JSON.stringify(this.getMetrics(), null, 2);
  }

  /**
   * Get tool leaderboard (most used tools)
   */
  getToolLeaderboard(): Array<{ tool: string; executions: number; successRate: number }> {
    return Object.entries(this.tools.executionsByTool)
      .map(([tool, stats]) => ({
        tool,
        executions: stats.success + stats.failed,
        successRate: stats.success / (stats.success + stats.failed) * 100,
      }))
      .sort((a, b) => b.executions - a.executions);
  }

  /**
   * Get events in time range
   */
  getEventsInRange(start: Date, end: Date): MetricsEvent[] {
    return this.events.filter(
      (e) => e.timestamp >= start && e.timestamp <= end
    );
  }

  /**
   * Reset session metrics
   */
  resetSession(): void {
    this.costs.sessionCost = 0;
    this.messageCount = 0;
    this.userMessages = 0;
    this.assistantMessages = 0;
    this.toolRounds = 0;
    this.startTime = new Date();
    this.sessionId = this.generateSessionId();
    this.emit('sessionReset');
  }

  /**
   * Dispose and cleanup
   */
  dispose(): void {
    this.events = [];
    this.latencies = [];
    this.removeAllListeners();
  }
}

// Singleton instance
let dashboardInstance: MetricsDashboard | null = null;

/**
 * Get or create the metrics dashboard
 */
export function getMetricsDashboard(): MetricsDashboard {
  if (!dashboardInstance) {
    dashboardInstance = new MetricsDashboard();
  }
  return dashboardInstance;
}

/**
 * Reset the metrics dashboard
 */
export function resetMetricsDashboard(): void {
  if (dashboardInstance) {
    dashboardInstance.dispose();
    dashboardInstance = null;
  }
}
