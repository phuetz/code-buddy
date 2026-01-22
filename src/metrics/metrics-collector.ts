/**
 * Metrics Collector
 *
 * Centralized metrics collection system for Code Buddy.
 * Supports counters, gauges, histograms, and various exporters.
 *
 * Features:
 * - Counters: Track cumulative values (requests, errors, tokens)
 * - Gauges: Track current values (memory, connections)
 * - Histograms: Track distributions (latency, execution time)
 * - Multiple exporters: Console, File, OpenTelemetry
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { logger } from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface MetricLabels {
  [key: string]: string;
}

export interface CounterValue {
  value: number;
  labels: MetricLabels;
}

export interface GaugeValue {
  value: number;
  labels: MetricLabels;
  timestamp: number;
}

export interface HistogramValue {
  count: number;
  sum: number;
  min: number;
  max: number;
  buckets: Map<number, number>;
  labels: MetricLabels;
}

export interface MetricDefinition {
  name: string;
  help: string;
  type: 'counter' | 'gauge' | 'histogram';
  unit?: string;
}

export interface MetricsSnapshot {
  timestamp: number;
  counters: Record<string, CounterValue[]>;
  gauges: Record<string, GaugeValue[]>;
  histograms: Record<string, HistogramValue[]>;
  system: SystemMetrics;
}

export interface SystemMetrics {
  memory: {
    heapUsed: number;
    heapTotal: number;
    external: number;
    rss: number;
    arrayBuffers: number;
  };
  cpu: {
    user: number;
    system: number;
  };
  uptime: number;
  activeHandles: number;
  activeRequests: number;
}

export interface MetricsConfig {
  /** Enable console export (debug mode) */
  consoleExport?: boolean;
  /** Enable file export */
  fileExport?: boolean;
  /** File export path */
  filePath?: string;
  /** Export interval in milliseconds */
  exportInterval?: number;
  /** Enable OpenTelemetry export */
  otelExport?: boolean;
  /** Default histogram buckets */
  defaultBuckets?: number[];
  /** Max metrics history size */
  maxHistorySize?: number;
}

// ============================================================================
// Metric Classes
// ============================================================================

/**
 * Counter metric - monotonically increasing value
 */
export class Counter {
  private values: Map<string, number> = new Map();

  constructor(
    public readonly name: string,
    public readonly help: string,
    public readonly unit?: string
  ) {}

  /**
   * Increment counter
   */
  inc(labels: MetricLabels = {}, value: number = 1): void {
    const key = this.labelsToKey(labels);
    const current = this.values.get(key) || 0;
    this.values.set(key, current + value);
  }

  /**
   * Get all values
   */
  getValues(): CounterValue[] {
    return Array.from(this.values.entries()).map(([key, value]) => ({
      value,
      labels: this.keyToLabels(key),
    }));
  }

  /**
   * Reset counter
   */
  reset(): void {
    this.values.clear();
  }

  private labelsToKey(labels: MetricLabels): string {
    return Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
  }

  private keyToLabels(key: string): MetricLabels {
    if (!key) return {};
    const labels: MetricLabels = {};
    key.split(',').forEach((pair) => {
      const match = pair.match(/^(.+)="(.+)"$/);
      if (match) {
        labels[match[1]] = match[2];
      }
    });
    return labels;
  }
}

/**
 * Gauge metric - value that can go up and down
 */
export class Gauge {
  private values: Map<string, number> = new Map();
  private timestamps: Map<string, number> = new Map();

  constructor(
    public readonly name: string,
    public readonly help: string,
    public readonly unit?: string
  ) {}

  /**
   * Set gauge value
   */
  set(value: number, labels: MetricLabels = {}): void {
    const key = this.labelsToKey(labels);
    this.values.set(key, value);
    this.timestamps.set(key, Date.now());
  }

  /**
   * Increment gauge
   */
  inc(labels: MetricLabels = {}, value: number = 1): void {
    const key = this.labelsToKey(labels);
    const current = this.values.get(key) || 0;
    this.values.set(key, current + value);
    this.timestamps.set(key, Date.now());
  }

  /**
   * Decrement gauge
   */
  dec(labels: MetricLabels = {}, value: number = 1): void {
    const key = this.labelsToKey(labels);
    const current = this.values.get(key) || 0;
    this.values.set(key, current - value);
    this.timestamps.set(key, Date.now());
  }

  /**
   * Get all values
   */
  getValues(): GaugeValue[] {
    return Array.from(this.values.entries()).map(([key, value]) => ({
      value,
      labels: this.keyToLabels(key),
      timestamp: this.timestamps.get(key) || Date.now(),
    }));
  }

  /**
   * Reset gauge
   */
  reset(): void {
    this.values.clear();
    this.timestamps.clear();
  }

  private labelsToKey(labels: MetricLabels): string {
    return Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
  }

  private keyToLabels(key: string): MetricLabels {
    if (!key) return {};
    const labels: MetricLabels = {};
    key.split(',').forEach((pair) => {
      const match = pair.match(/^(.+)="(.+)"$/);
      if (match) {
        labels[match[1]] = match[2];
      }
    });
    return labels;
  }
}

/**
 * Histogram metric - distribution of values
 */
export class Histogram {
  private values: Map<string, HistogramData> = new Map();

  constructor(
    public readonly name: string,
    public readonly help: string,
    public readonly buckets: number[] = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    public readonly unit?: string
  ) {
    // Sort buckets
    this.buckets = [...buckets].sort((a, b) => a - b);
  }

  /**
   * Observe a value
   */
  observe(value: number, labels: MetricLabels = {}): void {
    const key = this.labelsToKey(labels);
    let data = this.values.get(key);

    if (!data) {
      data = {
        count: 0,
        sum: 0,
        min: Infinity,
        max: -Infinity,
        buckets: new Map(this.buckets.map((b) => [b, 0])),
      };
      this.values.set(key, data);
    }

    data.count++;
    data.sum += value;
    data.min = Math.min(data.min, value);
    data.max = Math.max(data.max, value);

    // Update buckets
    for (const bucket of this.buckets) {
      if (value <= bucket) {
        data.buckets.set(bucket, (data.buckets.get(bucket) || 0) + 1);
      }
    }
  }

  /**
   * Get all values
   */
  getValues(): HistogramValue[] {
    return Array.from(this.values.entries()).map(([key, data]) => ({
      count: data.count,
      sum: data.sum,
      min: data.min === Infinity ? 0 : data.min,
      max: data.max === -Infinity ? 0 : data.max,
      buckets: new Map(data.buckets),
      labels: this.keyToLabels(key),
    }));
  }

  /**
   * Start a timer
   */
  startTimer(labels: MetricLabels = {}): () => number {
    const start = process.hrtime.bigint();
    return () => {
      const elapsed = Number(process.hrtime.bigint() - start) / 1e9; // Convert to seconds
      this.observe(elapsed, labels);
      return elapsed;
    };
  }

  /**
   * Reset histogram
   */
  reset(): void {
    this.values.clear();
  }

  private labelsToKey(labels: MetricLabels): string {
    return Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
  }

  private keyToLabels(key: string): MetricLabels {
    if (!key) return {};
    const labels: MetricLabels = {};
    key.split(',').forEach((pair) => {
      const match = pair.match(/^(.+)="(.+)"$/);
      if (match) {
        labels[match[1]] = match[2];
      }
    });
    return labels;
  }
}

interface HistogramData {
  count: number;
  sum: number;
  min: number;
  max: number;
  buckets: Map<number, number>;
}

// ============================================================================
// Metrics Collector
// ============================================================================

/**
 * Main metrics collector class
 */
export class MetricsCollector extends EventEmitter {
  private config: Required<MetricsConfig>;
  private counters: Map<string, Counter> = new Map();
  private gauges: Map<string, Gauge> = new Map();
  private histograms: Map<string, Histogram> = new Map();
  private exportInterval: NodeJS.Timeout | null = null;
  private startTime: number = Date.now();
  private history: MetricsSnapshot[] = [];
  private initialized: boolean = false;

  // Pre-defined metrics
  public readonly requestsTotal: Counter;
  public readonly requestErrors: Counter;
  public readonly tokensUsed: Counter;
  public readonly toolExecutions: Counter;
  public readonly apiLatency: Histogram;
  public readonly toolDuration: Histogram;
  public readonly memoryUsage: Gauge;
  public readonly activeConnections: Gauge;
  public readonly activeSessions: Gauge;

  constructor(config: MetricsConfig = {}) {
    super();
    this.config = {
      consoleExport: config.consoleExport ?? false,
      fileExport: config.fileExport ?? false,
      filePath: config.filePath ?? path.join(os.homedir(), '.codebuddy', 'metrics'),
      exportInterval: config.exportInterval ?? 60000, // 1 minute
      otelExport: config.otelExport ?? false,
      defaultBuckets: config.defaultBuckets ?? [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      maxHistorySize: config.maxHistorySize ?? 1000,
    };

    // Initialize pre-defined metrics
    this.requestsTotal = this.createCounter(
      'codebuddy_requests_total',
      'Total number of requests processed'
    );

    this.requestErrors = this.createCounter(
      'codebuddy_request_errors_total',
      'Total number of request errors'
    );

    this.tokensUsed = this.createCounter(
      'codebuddy_tokens_total',
      'Total tokens used',
      'tokens'
    );

    this.toolExecutions = this.createCounter(
      'codebuddy_tool_executions_total',
      'Total tool executions'
    );

    this.apiLatency = this.createHistogram(
      'codebuddy_api_latency_seconds',
      'API request latency in seconds',
      [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
      'seconds'
    );

    this.toolDuration = this.createHistogram(
      'codebuddy_tool_duration_seconds',
      'Tool execution duration in seconds',
      [0.01, 0.05, 0.1, 0.5, 1, 5, 10, 30, 60],
      'seconds'
    );

    this.memoryUsage = this.createGauge(
      'codebuddy_memory_bytes',
      'Memory usage in bytes',
      'bytes'
    );

    this.activeConnections = this.createGauge(
      'codebuddy_active_connections',
      'Number of active connections'
    );

    this.activeSessions = this.createGauge(
      'codebuddy_active_sessions',
      'Number of active sessions'
    );
  }

  /**
   * Initialize metrics collector
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    // Ensure metrics directory exists
    if (this.config.fileExport) {
      await fs.promises.mkdir(this.config.filePath, { recursive: true });
    }

    // Start export interval
    this.exportInterval = setInterval(() => {
      this.export().catch((err) => {
        logger.debug('Failed to export metrics', { error: err instanceof Error ? err.message : String(err) });
      });
    }, this.config.exportInterval);

    // Collect system metrics periodically
    setInterval(() => {
      this.collectSystemMetrics();
    }, 10000); // Every 10 seconds

    this.initialized = true;
    this.emit('initialized');
    logger.info('Metrics collector initialized');
  }

  /**
   * Create a counter metric
   */
  createCounter(name: string, help: string, unit?: string): Counter {
    const counter = new Counter(name, help, unit);
    this.counters.set(name, counter);
    return counter;
  }

  /**
   * Create a gauge metric
   */
  createGauge(name: string, help: string, unit?: string): Gauge {
    const gauge = new Gauge(name, help, unit);
    this.gauges.set(name, gauge);
    return gauge;
  }

  /**
   * Create a histogram metric
   */
  createHistogram(name: string, help: string, buckets?: number[], unit?: string): Histogram {
    const histogram = new Histogram(name, help, buckets || this.config.defaultBuckets, unit);
    this.histograms.set(name, histogram);
    return histogram;
  }

  /**
   * Get a counter by name
   */
  getCounter(name: string): Counter | undefined {
    return this.counters.get(name);
  }

  /**
   * Get a gauge by name
   */
  getGauge(name: string): Gauge | undefined {
    return this.gauges.get(name);
  }

  /**
   * Get a histogram by name
   */
  getHistogram(name: string): Histogram | undefined {
    return this.histograms.get(name);
  }

  /**
   * Collect system metrics
   */
  private collectSystemMetrics(): void {
    const mem = process.memoryUsage();

    this.memoryUsage.set(mem.heapUsed, { type: 'heap_used' });
    this.memoryUsage.set(mem.heapTotal, { type: 'heap_total' });
    this.memoryUsage.set(mem.external, { type: 'external' });
    this.memoryUsage.set(mem.rss, { type: 'rss' });
    this.memoryUsage.set(mem.arrayBuffers || 0, { type: 'array_buffers' });
  }

  /**
   * Get system metrics
   */
  getSystemMetrics(): SystemMetrics {
    const mem = process.memoryUsage();
    const cpu = process.cpuUsage();

    return {
      memory: {
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        external: mem.external,
        rss: mem.rss,
        arrayBuffers: mem.arrayBuffers || 0,
      },
      cpu: {
        user: cpu.user,
        system: cpu.system,
      },
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      activeHandles: (process as NodeJS.Process & { _getActiveHandles?: () => unknown[] })._getActiveHandles?.()?.length || 0,
      activeRequests: (process as NodeJS.Process & { _getActiveRequests?: () => unknown[] })._getActiveRequests?.()?.length || 0,
    };
  }

  /**
   * Get current metrics snapshot
   */
  getSnapshot(): MetricsSnapshot {
    const counters: Record<string, CounterValue[]> = {};
    const gauges: Record<string, GaugeValue[]> = {};
    const histograms: Record<string, HistogramValue[]> = {};

    Array.from(this.counters.entries()).forEach(([name, counter]) => {
      counters[name] = counter.getValues();
    });

    Array.from(this.gauges.entries()).forEach(([name, gauge]) => {
      gauges[name] = gauge.getValues();
    });

    Array.from(this.histograms.entries()).forEach(([name, histogram]) => {
      histograms[name] = histogram.getValues();
    });

    return {
      timestamp: Date.now(),
      counters,
      gauges,
      histograms,
      system: this.getSystemMetrics(),
    };
  }

  /**
   * Export metrics in Prometheus format
   */
  toPrometheus(): string {
    const lines: string[] = [];

    // Export counters
    Array.from(this.counters.entries()).forEach(([name, counter]) => {
      lines.push(`# HELP ${name} ${counter.help}`);
      lines.push(`# TYPE ${name} counter`);
      counter.getValues().forEach((value) => {
        const labels = this.formatLabels(value.labels);
        lines.push(`${name}${labels} ${value.value}`);
      });
      lines.push('');
    });

    // Export gauges
    Array.from(this.gauges.entries()).forEach(([name, gauge]) => {
      lines.push(`# HELP ${name} ${gauge.help}`);
      lines.push(`# TYPE ${name} gauge`);
      gauge.getValues().forEach((value) => {
        const labels = this.formatLabels(value.labels);
        lines.push(`${name}${labels} ${value.value}`);
      });
      lines.push('');
    });

    // Export histograms
    Array.from(this.histograms.entries()).forEach(([name, histogram]) => {
      lines.push(`# HELP ${name} ${histogram.help}`);
      lines.push(`# TYPE ${name} histogram`);
      histogram.getValues().forEach((value) => {
        const labels = this.formatLabels(value.labels);

        // Export buckets
        Array.from(value.buckets.entries()).forEach(([bucket, count]) => {
          const bucketLabels = { ...value.labels, le: String(bucket) };
          lines.push(`${name}_bucket${this.formatLabels(bucketLabels)} ${count}`);
        });

        // +Inf bucket
        const infLabels = { ...value.labels, le: '+Inf' };
        lines.push(`${name}_bucket${this.formatLabels(infLabels)} ${value.count}`);

        // Sum and count
        lines.push(`${name}_sum${labels} ${value.sum}`);
        lines.push(`${name}_count${labels} ${value.count}`);
      });
      lines.push('');
    });

    // System metrics
    const system = this.getSystemMetrics();

    lines.push('# HELP codebuddy_process_uptime_seconds Process uptime in seconds');
    lines.push('# TYPE codebuddy_process_uptime_seconds gauge');
    lines.push(`codebuddy_process_uptime_seconds ${system.uptime}`);
    lines.push('');

    lines.push('# HELP codebuddy_process_cpu_user_seconds_total CPU user time');
    lines.push('# TYPE codebuddy_process_cpu_user_seconds_total counter');
    lines.push(`codebuddy_process_cpu_user_seconds_total ${system.cpu.user / 1e6}`);
    lines.push('');

    lines.push('# HELP codebuddy_process_cpu_system_seconds_total CPU system time');
    lines.push('# TYPE codebuddy_process_cpu_system_seconds_total counter');
    lines.push(`codebuddy_process_cpu_system_seconds_total ${system.cpu.system / 1e6}`);
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Export metrics in JSON format
   */
  toJSON(): MetricsSnapshot {
    return this.getSnapshot();
  }

  /**
   * Format labels for Prometheus
   */
  private formatLabels(labels: MetricLabels): string {
    const entries = Object.entries(labels);
    if (entries.length === 0) return '';

    const formatted = entries
      .map(([k, v]) => `${k}="${v.replace(/"/g, '\\"')}"`)
      .join(',');

    return `{${formatted}}`;
  }

  /**
   * Export metrics to configured destinations
   */
  async export(): Promise<void> {
    const snapshot = this.getSnapshot();

    // Add to history
    this.history.push(snapshot);
    if (this.history.length > this.config.maxHistorySize) {
      this.history.shift();
    }

    // Console export
    if (this.config.consoleExport) {
      logger.debug('[METRICS]', {
        counters: Object.keys(snapshot.counters).length,
        gauges: Object.keys(snapshot.gauges).length,
        histograms: Object.keys(snapshot.histograms).length,
        uptime: snapshot.system.uptime,
      });
    }

    // File export
    if (this.config.fileExport) {
      await this.exportToFile(snapshot);
    }

    this.emit('export', snapshot);
  }

  /**
   * Export metrics to file
   */
  private async exportToFile(snapshot: MetricsSnapshot): Promise<void> {
    const filename = `metrics-${new Date().toISOString().split('T')[0]}.jsonl`;
    const filepath = path.join(this.config.filePath, filename);

    try {
      await fs.promises.appendFile(
        filepath,
        JSON.stringify(snapshot) + '\n',
        'utf-8'
      );
    } catch (err) {
      logger.debug('Failed to write metrics to file', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Get metrics history
   */
  getHistory(limit?: number): MetricsSnapshot[] {
    if (limit) {
      return this.history.slice(-limit);
    }
    return [...this.history];
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    Array.from(this.counters.values()).forEach((counter) => {
      counter.reset();
    });
    Array.from(this.gauges.values()).forEach((gauge) => {
      gauge.reset();
    });
    Array.from(this.histograms.values()).forEach((histogram) => {
      histogram.reset();
    });
    this.history = [];
    this.emit('reset');
  }

  /**
   * Shutdown metrics collector
   */
  async shutdown(): Promise<void> {
    if (this.exportInterval) {
      clearInterval(this.exportInterval);
      this.exportInterval = null;
    }

    // Final export
    await this.export();

    this.initialized = false;
    this.emit('shutdown');
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let metricsInstance: MetricsCollector | null = null;

/**
 * Initialize metrics collector
 */
export function initMetrics(config?: MetricsConfig): MetricsCollector {
  if (!metricsInstance) {
    metricsInstance = new MetricsCollector(config);
    metricsInstance.init().catch((err) => {
      logger.warn('Failed to initialize metrics collector', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }
  return metricsInstance;
}

/**
 * Get metrics collector instance
 */
export function getMetrics(): MetricsCollector | null {
  return metricsInstance;
}

/**
 * Helper: Measure function execution time
 */
export async function measureTime<T>(
  histogramName: string,
  labels: MetricLabels,
  fn: () => Promise<T>
): Promise<T> {
  if (!metricsInstance) return fn();

  const histogram = metricsInstance.getHistogram(histogramName);
  if (!histogram) return fn();

  const end = histogram.startTimer(labels);
  try {
    return await fn();
  } finally {
    end();
  }
}

/**
 * Helper: Increment counter
 */
export function incCounter(name: string, labels: MetricLabels = {}, value: number = 1): void {
  if (!metricsInstance) return;
  const counter = metricsInstance.getCounter(name);
  if (counter) {
    counter.inc(labels, value);
  }
}

/**
 * Helper: Set gauge value
 */
export function setGauge(name: string, value: number, labels: MetricLabels = {}): void {
  if (!metricsInstance) return;
  const gauge = metricsInstance.getGauge(name);
  if (gauge) {
    gauge.set(value, labels);
  }
}

export default MetricsCollector;
