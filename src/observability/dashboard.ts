/**
 * Observability Dashboard
 *
 * Real-time monitoring and analytics for Grok CLI:
 * - Token usage and costs
 * - Tool execution metrics
 * - Response times and latency
 * - Error tracking
 * - Session analytics
 */

import { EventEmitter } from 'events';

// ============================================================================
// Types
// ============================================================================

export interface MetricPoint {
  timestamp: number;
  value: number;
  labels?: Record<string, string>;
}

export interface Metric {
  name: string;
  type: 'counter' | 'gauge' | 'histogram';
  description: string;
  unit?: string;
  points: MetricPoint[];
}

export interface ToolMetrics {
  name: string;
  totalCalls: number;
  successCount: number;
  errorCount: number;
  totalDuration: number;
  avgDuration: number;
  minDuration: number;
  maxDuration: number;
  lastExecuted?: number;
}

export interface ProviderMetrics {
  provider: string;
  model: string;
  totalRequests: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  totalCost: number;
  avgLatency: number;
  errorCount: number;
  lastRequest?: number;
}

export interface SessionMetrics {
  sessionId: string;
  startTime: number;
  duration: number;
  messageCount: number;
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  totalTokens: number;
  totalCost: number;
  errorCount: number;
}

export interface ErrorRecord {
  timestamp: number;
  type: string;
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
}

export interface DashboardState {
  uptime: number;
  activeSession: boolean;
  totalSessions: number;
  totalTokens: number;
  totalCost: number;
  totalToolCalls: number;
  avgResponseTime: number;
  errorRate: number;
  tokensPerMinute: number;
  costPerHour: number;
}

// ============================================================================
// Metrics Collector
// ============================================================================

export class MetricsCollector extends EventEmitter {
  private metrics: Map<string, Metric> = new Map();
  private toolMetrics: Map<string, ToolMetrics> = new Map();
  private providerMetrics: Map<string, ProviderMetrics> = new Map();
  private errors: ErrorRecord[] = [];
  private sessionMetrics: SessionMetrics | null = null;
  private startTime: number;
  private maxHistoryPoints = 1000;
  private maxErrors = 100;

  constructor() {
    super();
    this.startTime = Date.now();
    this.initializeDefaultMetrics();
  }

  /**
   * Initialize default metrics
   */
  private initializeDefaultMetrics(): void {
    this.registerMetric({
      name: 'tokens_total',
      type: 'counter',
      description: 'Total tokens used',
      unit: 'tokens',
      points: [],
    });

    this.registerMetric({
      name: 'cost_total',
      type: 'counter',
      description: 'Total cost in USD',
      unit: 'usd',
      points: [],
    });

    this.registerMetric({
      name: 'response_time',
      type: 'histogram',
      description: 'API response time',
      unit: 'ms',
      points: [],
    });

    this.registerMetric({
      name: 'tool_execution_time',
      type: 'histogram',
      description: 'Tool execution time',
      unit: 'ms',
      points: [],
    });

    this.registerMetric({
      name: 'messages_total',
      type: 'counter',
      description: 'Total messages',
      points: [],
    });

    this.registerMetric({
      name: 'errors_total',
      type: 'counter',
      description: 'Total errors',
      points: [],
    });
  }

  /**
   * Register a metric
   */
  registerMetric(metric: Metric): void {
    this.metrics.set(metric.name, metric);
  }

  /**
   * Record a metric point
   */
  record(name: string, value: number, labels?: Record<string, string>): void {
    const metric = this.metrics.get(name);
    if (!metric) {
      // Auto-create metric
      this.registerMetric({
        name,
        type: 'gauge',
        description: name,
        points: [],
      });
    }

    const m = this.metrics.get(name)!;
    m.points.push({ timestamp: Date.now(), value, labels });

    // Trim history
    if (m.points.length > this.maxHistoryPoints) {
      m.points = m.points.slice(-this.maxHistoryPoints);
    }

    this.emit('metric', { name, value, labels });
  }

  /**
   * Increment a counter
   */
  increment(name: string, amount = 1, labels?: Record<string, string>): void {
    const metric = this.metrics.get(name);
    const lastValue = metric?.points[metric.points.length - 1]?.value || 0;
    this.record(name, lastValue + amount, labels);
  }

  /**
   * Record API request
   */
  recordAPIRequest(data: {
    provider: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
    cost: number;
    latency: number;
    success: boolean;
  }): void {
    const key = `${data.provider}:${data.model}`;
    const existing = this.providerMetrics.get(key) || {
      provider: data.provider,
      model: data.model,
      totalRequests: 0,
      totalTokens: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalCost: 0,
      avgLatency: 0,
      errorCount: 0,
    };

    existing.totalRequests++;
    existing.totalTokens += data.promptTokens + data.completionTokens;
    existing.promptTokens += data.promptTokens;
    existing.completionTokens += data.completionTokens;
    existing.totalCost += data.cost;
    existing.avgLatency = (existing.avgLatency * (existing.totalRequests - 1) + data.latency) / existing.totalRequests;
    existing.lastRequest = Date.now();

    if (!data.success) {
      existing.errorCount++;
    }

    this.providerMetrics.set(key, existing);

    // Update metrics
    this.increment('tokens_total', data.promptTokens + data.completionTokens);
    this.record('cost_total', this.getTotalCost());
    this.record('response_time', data.latency, { provider: data.provider });

    this.emit('api:request', data);
  }

  /**
   * Record tool execution
   */
  recordToolExecution(data: {
    name: string;
    duration: number;
    success: boolean;
    error?: string;
  }): void {
    const existing = this.toolMetrics.get(data.name) || {
      name: data.name,
      totalCalls: 0,
      successCount: 0,
      errorCount: 0,
      totalDuration: 0,
      avgDuration: 0,
      minDuration: Infinity,
      maxDuration: 0,
    };

    existing.totalCalls++;
    existing.totalDuration += data.duration;
    existing.avgDuration = existing.totalDuration / existing.totalCalls;
    existing.minDuration = Math.min(existing.minDuration, data.duration);
    existing.maxDuration = Math.max(existing.maxDuration, data.duration);
    existing.lastExecuted = Date.now();

    if (data.success) {
      existing.successCount++;
    } else {
      existing.errorCount++;
      if (data.error) {
        this.recordError('tool_error', data.error, { tool: data.name });
      }
    }

    this.toolMetrics.set(data.name, existing);
    this.record('tool_execution_time', data.duration, { tool: data.name });

    this.emit('tool:executed', data);
  }

  /**
   * Record error
   */
  recordError(type: string, message: string, context?: Record<string, unknown>): void {
    const error: ErrorRecord = {
      timestamp: Date.now(),
      type,
      message,
      context,
    };

    this.errors.push(error);

    // Trim errors
    if (this.errors.length > this.maxErrors) {
      this.errors = this.errors.slice(-this.maxErrors);
    }

    this.increment('errors_total');
    this.emit('error', error);
  }

  /**
   * Start session tracking
   */
  startSession(sessionId: string): void {
    this.sessionMetrics = {
      sessionId,
      startTime: Date.now(),
      duration: 0,
      messageCount: 0,
      userMessages: 0,
      assistantMessages: 0,
      toolCalls: 0,
      totalTokens: 0,
      totalCost: 0,
      errorCount: 0,
    };
    this.emit('session:started', { sessionId });
  }

  /**
   * Record message in session
   */
  recordMessage(role: 'user' | 'assistant' | 'system' | 'tool'): void {
    if (this.sessionMetrics) {
      this.sessionMetrics.messageCount++;
      if (role === 'user') this.sessionMetrics.userMessages++;
      if (role === 'assistant') this.sessionMetrics.assistantMessages++;
    }
    this.increment('messages_total', 1, { role });
  }

  /**
   * End session
   */
  endSession(): SessionMetrics | null {
    if (this.sessionMetrics) {
      this.sessionMetrics.duration = Date.now() - this.sessionMetrics.startTime;
      const metrics = { ...this.sessionMetrics };
      this.emit('session:ended', metrics);
      this.sessionMetrics = null;
      return metrics;
    }
    return null;
  }

  /**
   * Get dashboard state
   */
  getDashboardState(): DashboardState {
    const uptime = Date.now() - this.startTime;
    const totalTokens = this.getTotalTokens();
    const totalCost = this.getTotalCost();
    const totalToolCalls = this.getTotalToolCalls();
    const avgResponseTime = this.getAverageResponseTime();
    const errorRate = this.getErrorRate();

    // Calculate rates
    const uptimeMinutes = uptime / 60000;
    const uptimeHours = uptime / 3600000;

    return {
      uptime,
      activeSession: this.sessionMetrics !== null,
      totalSessions: 0, // Would need session history
      totalTokens,
      totalCost,
      totalToolCalls,
      avgResponseTime,
      errorRate,
      tokensPerMinute: uptimeMinutes > 0 ? totalTokens / uptimeMinutes : 0,
      costPerHour: uptimeHours > 0 ? totalCost / uptimeHours : 0,
    };
  }

  /**
   * Get total tokens
   */
  getTotalTokens(): number {
    let total = 0;
    for (const pm of this.providerMetrics.values()) {
      total += pm.totalTokens;
    }
    return total;
  }

  /**
   * Get total cost
   */
  getTotalCost(): number {
    let total = 0;
    for (const pm of this.providerMetrics.values()) {
      total += pm.totalCost;
    }
    return total;
  }

  /**
   * Get total tool calls
   */
  getTotalToolCalls(): number {
    let total = 0;
    for (const tm of this.toolMetrics.values()) {
      total += tm.totalCalls;
    }
    return total;
  }

  /**
   * Get average response time
   */
  getAverageResponseTime(): number {
    const metric = this.metrics.get('response_time');
    if (!metric || metric.points.length === 0) return 0;

    const sum = metric.points.reduce((acc, p) => acc + p.value, 0);
    return sum / metric.points.length;
  }

  /**
   * Get error rate
   */
  getErrorRate(): number {
    const totalRequests = Array.from(this.providerMetrics.values())
      .reduce((acc, pm) => acc + pm.totalRequests, 0);
    const totalErrors = Array.from(this.providerMetrics.values())
      .reduce((acc, pm) => acc + pm.errorCount, 0);

    return totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0;
  }

  /**
   * Get tool metrics
   */
  getToolMetrics(): ToolMetrics[] {
    return Array.from(this.toolMetrics.values());
  }

  /**
   * Get provider metrics
   */
  getProviderMetrics(): ProviderMetrics[] {
    return Array.from(this.providerMetrics.values());
  }

  /**
   * Get recent errors
   */
  getRecentErrors(limit = 10): ErrorRecord[] {
    return this.errors.slice(-limit);
  }

  /**
   * Get metric history
   */
  getMetricHistory(name: string, since?: number): MetricPoint[] {
    const metric = this.metrics.get(name);
    if (!metric) return [];

    if (since) {
      return metric.points.filter(p => p.timestamp >= since);
    }
    return [...metric.points];
  }

  /**
   * Clear all metrics
   */
  reset(): void {
    for (const metric of this.metrics.values()) {
      metric.points = [];
    }
    this.toolMetrics.clear();
    this.providerMetrics.clear();
    this.errors = [];
    this.sessionMetrics = null;
    this.startTime = Date.now();
    this.emit('reset');
  }

  /**
   * Export metrics
   */
  export(): {
    uptime: number;
    metrics: Record<string, Metric>;
    tools: ToolMetrics[];
    providers: ProviderMetrics[];
    errors: ErrorRecord[];
    session: SessionMetrics | null;
  } {
    return {
      uptime: Date.now() - this.startTime,
      metrics: Object.fromEntries(this.metrics),
      tools: this.getToolMetrics(),
      providers: this.getProviderMetrics(),
      errors: [...this.errors],
      session: this.sessionMetrics,
    };
  }

  /**
   * Dispose
   */
  dispose(): void {
    this.reset();
    this.removeAllListeners();
  }
}

// ============================================================================
// Dashboard Renderer (Terminal)
// ============================================================================

export class TerminalDashboard {
  private collector: MetricsCollector;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;

  constructor(collector: MetricsCollector) {
    this.collector = collector;
  }

  /**
   * Render dashboard to string
   */
  render(): string {
    const state = this.collector.getDashboardState();
    const tools = this.collector.getToolMetrics();
    const providers = this.collector.getProviderMetrics();
    const errors = this.collector.getRecentErrors(5);

    const lines: string[] = [];

    // Header
    lines.push('╔══════════════════════════════════════════════════════════════════╗');
    lines.push('║                    GROK CLI OBSERVABILITY                        ║');
    lines.push('╚══════════════════════════════════════════════════════════════════╝');
    lines.push('');

    // Overview
    lines.push('┌─ Overview ────────────────────────────────────────────────────────┐');
    lines.push(`│ Uptime: ${this.formatDuration(state.uptime).padEnd(20)} Active Session: ${state.activeSession ? '✓' : '✗'}        │`);
    lines.push(`│ Total Tokens: ${state.totalTokens.toLocaleString().padEnd(15)} Total Cost: $${state.totalCost.toFixed(4).padEnd(10)}     │`);
    lines.push(`│ Tool Calls: ${state.totalToolCalls.toString().padEnd(17)} Avg Response: ${state.avgResponseTime.toFixed(0)}ms       │`);
    lines.push(`│ Error Rate: ${state.errorRate.toFixed(2)}%                                              │`);
    lines.push('└───────────────────────────────────────────────────────────────────┘');
    lines.push('');

    // Rates
    lines.push('┌─ Rates ───────────────────────────────────────────────────────────┐');
    lines.push(`│ Tokens/min: ${state.tokensPerMinute.toFixed(1).padEnd(15)} Cost/hour: $${state.costPerHour.toFixed(4).padEnd(12)}   │`);
    lines.push('└───────────────────────────────────────────────────────────────────┘');
    lines.push('');

    // Provider Metrics
    if (providers.length > 0) {
      lines.push('┌─ Providers ──────────────────────────────────────────────────────┐');
      for (const p of providers) {
        lines.push(`│ ${(p.provider + '/' + p.model).padEnd(30)} Requests: ${p.totalRequests.toString().padEnd(8)} │`);
        lines.push(`│   Tokens: ${p.totalTokens.toLocaleString().padEnd(15)} Cost: $${p.totalCost.toFixed(4).padEnd(10)}       │`);
        lines.push(`│   Avg Latency: ${p.avgLatency.toFixed(0)}ms         Errors: ${p.errorCount.toString().padEnd(10)}       │`);
      }
      lines.push('└───────────────────────────────────────────────────────────────────┘');
      lines.push('');
    }

    // Tool Metrics (top 5)
    const topTools = tools.sort((a, b) => b.totalCalls - a.totalCalls).slice(0, 5);
    if (topTools.length > 0) {
      lines.push('┌─ Top Tools ──────────────────────────────────────────────────────┐');
      for (const t of topTools) {
        const successRate = t.totalCalls > 0 ? (t.successCount / t.totalCalls * 100).toFixed(0) : '0';
        lines.push(`│ ${t.name.padEnd(25)} Calls: ${t.totalCalls.toString().padEnd(8)} Success: ${successRate}%  │`);
        lines.push(`│   Avg: ${t.avgDuration.toFixed(0)}ms  Min: ${t.minDuration === Infinity ? 'N/A' : t.minDuration.toFixed(0) + 'ms'}  Max: ${t.maxDuration.toFixed(0)}ms                   │`);
      }
      lines.push('└───────────────────────────────────────────────────────────────────┘');
      lines.push('');
    }

    // Recent Errors
    if (errors.length > 0) {
      lines.push('┌─ Recent Errors ──────────────────────────────────────────────────┐');
      for (const e of errors) {
        const time = new Date(e.timestamp).toLocaleTimeString();
        lines.push(`│ [${time}] ${e.type}: ${e.message.slice(0, 45).padEnd(45)} │`);
      }
      lines.push('└───────────────────────────────────────────────────────────────────┘');
    }

    return lines.join('\n');
  }

  /**
   * Format duration
   */
  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * Start live refresh
   */
  startLiveRefresh(intervalMs = 1000, render: (output: string) => void): void {
    this.refreshInterval = setInterval(() => {
      render(this.render());
    }, intervalMs);
  }

  /**
   * Stop live refresh
   */
  stopLiveRefresh(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }
}

// ============================================================================
// Prometheus-Compatible Export
// ============================================================================

export class PrometheusExporter {
  private collector: MetricsCollector;

  constructor(collector: MetricsCollector) {
    this.collector = collector;
  }

  /**
   * Export metrics in Prometheus format
   */
  export(): string {
    const lines: string[] = [];
    const data = this.collector.export();

    // Basic metrics
    lines.push('# HELP grok_tokens_total Total tokens used');
    lines.push('# TYPE grok_tokens_total counter');
    lines.push(`grok_tokens_total ${this.collector.getTotalTokens()}`);
    lines.push('');

    lines.push('# HELP grok_cost_usd_total Total cost in USD');
    lines.push('# TYPE grok_cost_usd_total counter');
    lines.push(`grok_cost_usd_total ${this.collector.getTotalCost()}`);
    lines.push('');

    lines.push('# HELP grok_tool_calls_total Total tool calls');
    lines.push('# TYPE grok_tool_calls_total counter');
    lines.push(`grok_tool_calls_total ${this.collector.getTotalToolCalls()}`);
    lines.push('');

    // Provider metrics
    lines.push('# HELP grok_provider_requests_total Total requests per provider');
    lines.push('# TYPE grok_provider_requests_total counter');
    for (const p of data.providers) {
      lines.push(`grok_provider_requests_total{provider="${p.provider}",model="${p.model}"} ${p.totalRequests}`);
    }
    lines.push('');

    lines.push('# HELP grok_provider_latency_ms Average latency per provider');
    lines.push('# TYPE grok_provider_latency_ms gauge');
    for (const p of data.providers) {
      lines.push(`grok_provider_latency_ms{provider="${p.provider}",model="${p.model}"} ${p.avgLatency}`);
    }
    lines.push('');

    // Tool metrics
    lines.push('# HELP grok_tool_calls_total Total calls per tool');
    lines.push('# TYPE grok_tool_calls_total counter');
    for (const t of data.tools) {
      lines.push(`grok_tool_duration_ms{tool="${t.name}",stat="avg"} ${t.avgDuration}`);
      lines.push(`grok_tool_duration_ms{tool="${t.name}",stat="max"} ${t.maxDuration}`);
    }
    lines.push('');

    // Error rate
    lines.push('# HELP grok_error_rate_percent Error rate percentage');
    lines.push('# TYPE grok_error_rate_percent gauge');
    lines.push(`grok_error_rate_percent ${this.collector.getErrorRate()}`);
    lines.push('');

    // Uptime
    lines.push('# HELP grok_uptime_seconds Uptime in seconds');
    lines.push('# TYPE grok_uptime_seconds counter');
    lines.push(`grok_uptime_seconds ${Math.floor(data.uptime / 1000)}`);

    return lines.join('\n');
  }
}

// ============================================================================
// Singleton
// ============================================================================

let metricsCollectorInstance: MetricsCollector | null = null;

export function getMetricsCollector(): MetricsCollector {
  if (!metricsCollectorInstance) {
    metricsCollectorInstance = new MetricsCollector();
  }
  return metricsCollectorInstance;
}

export function resetMetricsCollector(): void {
  if (metricsCollectorInstance) {
    metricsCollectorInstance.dispose();
  }
  metricsCollectorInstance = null;
}

/**
 * Get terminal dashboard
 */
export function getTerminalDashboard(): TerminalDashboard {
  return new TerminalDashboard(getMetricsCollector());
}

/**
 * Get Prometheus exporter
 */
export function getPrometheusExporter(): PrometheusExporter {
  return new PrometheusExporter(getMetricsCollector());
}
