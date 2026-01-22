/**
 * OpenTelemetry Integration
 *
 * Distributed tracing and observability:
 * - Trace context propagation
 * - Span creation and management
 * - Metrics collection (integrated with MetricsCollector)
 * - Log correlation
 * - Multiple export targets (Console, File, OTLP)
 */

import { EventEmitter } from 'events';
import * as os from 'os';
import { logger } from '../utils/logger.js';
import { getMetrics, type MetricsCollector, type MetricLabels } from '../metrics/metrics-collector.js';

export interface OTelConfig {
  /** Service name */
  serviceName: string;
  /** Service version */
  serviceVersion?: string;
  /** Environment */
  environment?: string;
  /** OTLP endpoint */
  endpoint?: string;
  /** Export interval in ms */
  exportInterval?: number;
  /** Enable console exporter */
  consoleExport?: boolean;
  /** Additional resource attributes */
  resourceAttributes?: Record<string, string>;
  /** Sampling rate (0-1) */
  samplingRate?: number;
}

export interface TraceContext {
  traceId: string;
  spanId: string;
  traceFlags: number;
  traceState?: string;
}

export interface SpanContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: SpanKind;
  startTime: number;
  endTime?: number;
  status: SpanStatus;
  attributes: Record<string, AttributeValue>;
  events: SpanEvent[];
  links: SpanLink[];
}

export type SpanKind = 'internal' | 'server' | 'client' | 'producer' | 'consumer';

export interface SpanStatus {
  code: 'unset' | 'ok' | 'error';
  message?: string;
}

export interface SpanEvent {
  name: string;
  timestamp: number;
  attributes?: Record<string, AttributeValue>;
}

export interface SpanLink {
  traceId: string;
  spanId: string;
  attributes?: Record<string, AttributeValue>;
}

export type AttributeValue = string | number | boolean | string[] | number[] | boolean[];

export interface Metric {
  name: string;
  type: 'counter' | 'gauge' | 'histogram';
  description: string;
  unit?: string;
  value: number;
  attributes?: Record<string, string>;
  timestamp: number;
}

export interface Resource {
  attributes: Record<string, string>;
}

/**
 * OpenTelemetry Integration for Code Buddy
 */
export class OpenTelemetryIntegration extends EventEmitter {
  private config: Required<OTelConfig>;
  private resource: Resource;
  private activeSpans: Map<string, SpanContext> = new Map();
  private spanStack: string[] = [];
  private metrics: Metric[] = [];
  private exportInterval: NodeJS.Timeout | null = null;
  private initialized: boolean = false;
  private metricsCollector: MetricsCollector | null = null;

  constructor(config: OTelConfig) {
    super();
    this.config = {
      serviceName: config.serviceName,
      serviceVersion: config.serviceVersion || '1.0.0',
      environment: config.environment || process.env.NODE_ENV || 'development',
      endpoint: config.endpoint || 'http://localhost:4318',
      exportInterval: config.exportInterval || 30000,
      consoleExport: config.consoleExport ?? false,
      resourceAttributes: config.resourceAttributes || {},
      samplingRate: config.samplingRate ?? 1.0,
    };

    this.resource = this.createResource();
    this.metricsCollector = getMetrics();
  }

  /**
   * Initialize OpenTelemetry
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    // Start export interval
    this.exportInterval = setInterval(() => {
      this.exportMetrics().catch((err) => {
        logger.debug('Failed to export metrics', { error: err instanceof Error ? err.message : String(err) });
      });
    }, this.config.exportInterval);

    this.initialized = true;
    this.emit('initialized');

    logger.info('OpenTelemetry initialized', {
      serviceName: this.config.serviceName,
      endpoint: this.config.endpoint,
    });
  }

  /**
   * Create resource with service information
   */
  private createResource(): Resource {
    return {
      attributes: {
        'service.name': this.config.serviceName,
        'service.version': this.config.serviceVersion,
        'deployment.environment': this.config.environment,
        'host.name': os.hostname(),
        'host.arch': os.arch(),
        'os.type': os.type(),
        'os.version': os.release(),
        'process.runtime.name': 'node',
        'process.runtime.version': process.version,
        'process.pid': String(process.pid),
        ...this.config.resourceAttributes,
      },
    };
  }

  /**
   * Start a new trace
   */
  startTrace(name: string, options?: { kind?: SpanKind; attributes?: Record<string, AttributeValue> }): string {
    // Sampling check
    if (Math.random() > this.config.samplingRate) {
      return '';
    }

    const traceId = this.generateTraceId();
    const spanId = this.generateSpanId();

    const span: SpanContext = {
      traceId,
      spanId,
      name,
      kind: options?.kind || 'internal',
      startTime: Date.now(),
      status: { code: 'unset' },
      attributes: options?.attributes || {},
      events: [],
      links: [],
    };

    this.activeSpans.set(spanId, span);
    this.spanStack.push(spanId);

    this.emit('span:start', { span });
    return spanId;
  }

  /**
   * Start a child span
   */
  startSpan(name: string, options?: { kind?: SpanKind; attributes?: Record<string, AttributeValue> }): string {
    const parentSpanId = this.spanStack[this.spanStack.length - 1];
    const parentSpan = parentSpanId ? this.activeSpans.get(parentSpanId) : null;

    if (!parentSpan) {
      return this.startTrace(name, options);
    }

    const spanId = this.generateSpanId();

    const span: SpanContext = {
      traceId: parentSpan.traceId,
      spanId,
      parentSpanId: parentSpan.spanId,
      name,
      kind: options?.kind || 'internal',
      startTime: Date.now(),
      status: { code: 'unset' },
      attributes: options?.attributes || {},
      events: [],
      links: [],
    };

    this.activeSpans.set(spanId, span);
    this.spanStack.push(spanId);

    this.emit('span:start', { span });
    return spanId;
  }

  /**
   * End a span
   */
  endSpan(spanId: string, status?: SpanStatus): void {
    const span = this.activeSpans.get(spanId);
    if (!span) return;

    span.endTime = Date.now();
    span.status = status || { code: 'ok' };

    // Remove from stack
    const stackIndex = this.spanStack.indexOf(spanId);
    if (stackIndex !== -1) {
      this.spanStack.splice(stackIndex, 1);
    }

    this.emit('span:end', { span });

    // Export span
    this.exportSpan(span).catch((err) => {
      logger.debug('Failed to export span', { spanId, error: err instanceof Error ? err.message : String(err) });
    });

    this.activeSpans.delete(spanId);
  }

  /**
   * Add event to current span
   */
  addEvent(name: string, attributes?: Record<string, AttributeValue>): void {
    const spanId = this.spanStack[this.spanStack.length - 1];
    const span = spanId ? this.activeSpans.get(spanId) : null;
    if (!span) return;

    span.events.push({
      name,
      timestamp: Date.now(),
      attributes,
    });
  }

  /**
   * Set attribute on current span
   */
  setAttribute(key: string, value: AttributeValue): void {
    const spanId = this.spanStack[this.spanStack.length - 1];
    const span = spanId ? this.activeSpans.get(spanId) : null;
    if (!span) return;

    span.attributes[key] = value;
  }

  /**
   * Set error on current span
   */
  recordException(error: Error): void {
    const spanId = this.spanStack[this.spanStack.length - 1];
    const span = spanId ? this.activeSpans.get(spanId) : null;
    if (!span) return;

    span.status = { code: 'error', message: error.message };
    span.events.push({
      name: 'exception',
      timestamp: Date.now(),
      attributes: {
        'exception.type': error.name,
        'exception.message': error.message,
        'exception.stacktrace': error.stack || '',
      },
    });
  }

  /**
   * Get current trace context
   */
  getTraceContext(): TraceContext | null {
    const spanId = this.spanStack[this.spanStack.length - 1];
    const span = spanId ? this.activeSpans.get(spanId) : null;
    if (!span) return null;

    return {
      traceId: span.traceId,
      spanId: span.spanId,
      traceFlags: 1,
    };
  }

  /**
   * Create a context from W3C traceparent header
   */
  extractContext(traceparent: string): TraceContext | null {
    const match = traceparent.match(/^00-([a-f0-9]{32})-([a-f0-9]{16})-([a-f0-9]{2})$/);
    if (!match) return null;

    return {
      traceId: match[1],
      spanId: match[2],
      traceFlags: parseInt(match[3], 16),
    };
  }

  /**
   * Create W3C traceparent header from context
   */
  injectContext(context: TraceContext): string {
    return `00-${context.traceId}-${context.spanId}-${context.traceFlags.toString(16).padStart(2, '0')}`;
  }

  /**
   * Record a counter metric
   * Uses MetricsCollector if available, falls back to internal storage
   */
  recordCounter(name: string, value: number = 1, attributes?: Record<string, string>): void {
    // Try to use MetricsCollector first
    if (this.metricsCollector) {
      const counter = this.metricsCollector.getCounter(name);
      if (counter) {
        counter.inc(attributes as MetricLabels || {}, value);
        return;
      }
    }

    // Fallback to internal metrics
    this.metrics.push({
      name,
      type: 'counter',
      description: '',
      value,
      attributes,
      timestamp: Date.now(),
    });
  }

  /**
   * Record a gauge metric
   * Uses MetricsCollector if available, falls back to internal storage
   */
  recordGauge(name: string, value: number, attributes?: Record<string, string>): void {
    // Try to use MetricsCollector first
    if (this.metricsCollector) {
      const gauge = this.metricsCollector.getGauge(name);
      if (gauge) {
        gauge.set(value, attributes as MetricLabels || {});
        return;
      }
    }

    // Fallback to internal metrics
    this.metrics.push({
      name,
      type: 'gauge',
      description: '',
      value,
      attributes,
      timestamp: Date.now(),
    });
  }

  /**
   * Record a histogram metric
   * Uses MetricsCollector if available, falls back to internal storage
   */
  recordHistogram(name: string, value: number, attributes?: Record<string, string>): void {
    // Try to use MetricsCollector first
    if (this.metricsCollector) {
      const histogram = this.metricsCollector.getHistogram(name);
      if (histogram) {
        histogram.observe(value, attributes as MetricLabels || {});
        return;
      }
    }

    // Fallback to internal metrics
    this.metrics.push({
      name,
      type: 'histogram',
      description: '',
      value,
      attributes,
      timestamp: Date.now(),
    });
  }

  /**
   * Measure function execution time
   */
  async measure<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const spanId = this.startSpan(name);

    try {
      const result = await fn();
      this.endSpan(spanId, { code: 'ok' });
      return result;
    } catch (error) {
      if (error instanceof Error) {
        this.recordException(error);
      }
      this.endSpan(spanId, { code: 'error', message: String(error) });
      throw error;
    }
  }

  /**
   * Export span to OTLP endpoint
   */
  private async exportSpan(span: SpanContext): Promise<void> {
    if (this.config.consoleExport) {
      logger.debug('[OTEL SPAN]', { span });
    }

    const payload = {
      resourceSpans: [{
        resource: this.resource,
        scopeSpans: [{
          scope: {
            name: this.config.serviceName,
            version: this.config.serviceVersion,
          },
          spans: [this.formatSpan(span)],
        }],
      }],
    };

    try {
      const response = await fetch(`${this.config.endpoint}/v1/traces`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        logger.debug('Failed to export span', { status: response.status });
      }
    } catch {
      // Silently fail if endpoint is not available
    }
  }

  /**
   * Format span for OTLP
   */
  private formatSpan(span: SpanContext): object {
    return {
      traceId: span.traceId,
      spanId: span.spanId,
      parentSpanId: span.parentSpanId,
      name: span.name,
      kind: this.getSpanKindNumber(span.kind),
      startTimeUnixNano: span.startTime * 1000000,
      endTimeUnixNano: (span.endTime || Date.now()) * 1000000,
      attributes: Object.entries(span.attributes).map(([key, value]) => ({
        key,
        value: this.formatAttributeValue(value),
      })),
      events: span.events.map(event => ({
        name: event.name,
        timeUnixNano: event.timestamp * 1000000,
        attributes: Object.entries(event.attributes || {}).map(([key, value]) => ({
          key,
          value: this.formatAttributeValue(value),
        })),
      })),
      status: {
        code: span.status.code === 'error' ? 2 : span.status.code === 'ok' ? 1 : 0,
        message: span.status.message,
      },
    };
  }

  /**
   * Get span kind number
   */
  private getSpanKindNumber(kind: SpanKind): number {
    const kinds: Record<SpanKind, number> = {
      internal: 1,
      server: 2,
      client: 3,
      producer: 4,
      consumer: 5,
    };
    return kinds[kind] || 1;
  }

  /**
   * Format attribute value for OTLP
   */
  private formatAttributeValue(value: AttributeValue): object {
    if (typeof value === 'string') {
      return { stringValue: value };
    } else if (typeof value === 'number') {
      return Number.isInteger(value) ? { intValue: value } : { doubleValue: value };
    } else if (typeof value === 'boolean') {
      return { boolValue: value };
    } else if (Array.isArray(value)) {
      return {
        arrayValue: {
          values: value.map(v => this.formatAttributeValue(v)),
        },
      };
    }
    return { stringValue: String(value) };
  }

  /**
   * Export metrics to OTLP endpoint
   */
  private async exportMetrics(): Promise<void> {
    if (this.metrics.length === 0) return;

    const metricsToExport = [...this.metrics];
    this.metrics = [];

    if (this.config.consoleExport) {
      logger.debug('[OTEL METRICS]', { metrics: metricsToExport });
    }

    // Group metrics by name
    const grouped = new Map<string, Metric[]>();
    for (const metric of metricsToExport) {
      const existing = grouped.get(metric.name) || [];
      existing.push(metric);
      grouped.set(metric.name, existing);
    }

    const payload = {
      resourceMetrics: [{
        resource: this.resource,
        scopeMetrics: [{
          scope: {
            name: this.config.serviceName,
            version: this.config.serviceVersion,
          },
          metrics: Array.from(grouped.entries()).map(([name, metrics]) =>
            this.formatMetricGroup(name, metrics)
          ),
        }],
      }],
    };

    try {
      const response = await fetch(`${this.config.endpoint}/v1/metrics`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        logger.debug('Failed to export metrics', { status: response.status });
      }
    } catch {
      // Silently fail if endpoint is not available
    }
  }

  /**
   * Format metric group for OTLP
   */
  private formatMetricGroup(name: string, metrics: Metric[]): object {
    const first = metrics[0];
    const dataPoints = metrics.map(m => ({
      attributes: Object.entries(m.attributes || {}).map(([key, value]) => ({
        key,
        value: { stringValue: value },
      })),
      timeUnixNano: m.timestamp * 1000000,
      asDouble: m.value,
    }));

    if (first.type === 'counter') {
      return {
        name,
        description: first.description,
        unit: first.unit,
        sum: {
          dataPoints,
          aggregationTemporality: 2, // Cumulative
          isMonotonic: true,
        },
      };
    } else if (first.type === 'gauge') {
      return {
        name,
        description: first.description,
        unit: first.unit,
        gauge: { dataPoints },
      };
    } else {
      return {
        name,
        description: first.description,
        unit: first.unit,
        histogram: {
          dataPoints: dataPoints.map(dp => ({
            ...dp,
            count: 1,
            sum: dp.asDouble,
          })),
          aggregationTemporality: 2,
        },
      };
    }
  }

  /**
   * Generate trace ID (32 hex chars)
   */
  private generateTraceId(): string {
    return 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'.replace(/x/g, () =>
      Math.floor(Math.random() * 16).toString(16)
    );
  }

  /**
   * Generate span ID (16 hex chars)
   */
  private generateSpanId(): string {
    return 'xxxxxxxxxxxxxxxx'.replace(/x/g, () =>
      Math.floor(Math.random() * 16).toString(16)
    );
  }

  /**
   * Shutdown OpenTelemetry
   */
  async shutdown(): Promise<void> {
    if (this.exportInterval) {
      clearInterval(this.exportInterval);
      this.exportInterval = null;
    }

    // Export remaining spans and metrics
    for (const span of this.activeSpans.values()) {
      await this.exportSpan(span);
    }
    await this.exportMetrics();

    this.activeSpans.clear();
    this.spanStack = [];
    this.initialized = false;

    this.emit('shutdown');
  }
}

// Singleton instance
let otelInstance: OpenTelemetryIntegration | null = null;

/**
 * Initialize OpenTelemetry
 */
export function initOpenTelemetry(config: OTelConfig): OpenTelemetryIntegration {
  if (!otelInstance) {
    otelInstance = new OpenTelemetryIntegration(config);
    otelInstance.init().catch((err) => {
      logger.warn('Failed to initialize OpenTelemetry', { error: err instanceof Error ? err.message : String(err) });
    });
  }
  return otelInstance;
}

/**
 * Get OpenTelemetry instance
 */
export function getOpenTelemetry(): OpenTelemetryIntegration | null {
  return otelInstance;
}

/**
 * Trace a function
 */
export async function trace<T>(name: string, fn: () => Promise<T>): Promise<T> {
  if (!otelInstance) return fn();
  return otelInstance.measure(name, fn);
}

export default OpenTelemetryIntegration;
