/**
 * Metrics Module
 *
 * Centralized metrics collection, export, and monitoring system.
 *
 * Features:
 * - Counters: Track cumulative values (requests, errors, tokens)
 * - Gauges: Track current values (memory, connections)
 * - Histograms: Track distributions (latency, execution time)
 * - File-based export for offline sessions
 * - Prometheus-compatible export format
 * - OpenTelemetry integration
 *
 * Usage:
 * ```typescript
 * import { initMetrics, getMetrics } from './metrics';
 *
 * // Initialize (once at startup)
 * const metrics = initMetrics({
 *   consoleExport: true,
 *   fileExport: true,
 * });
 *
 * // Use pre-defined metrics
 * metrics.requestsTotal.inc({ endpoint: '/api/chat' });
 * metrics.tokensUsed.inc({ type: 'prompt' }, 1500);
 *
 * // Use timer for latency
 * const end = metrics.apiLatency.startTimer({ endpoint: '/api/chat' });
 * await someApiCall();
 * end(); // Records duration automatically
 *
 * // Custom metrics
 * const myCounter = metrics.createCounter('my_custom_counter', 'Description');
 * myCounter.inc({ label: 'value' });
 * ```
 */

export {
  MetricsCollector,
  Counter,
  Gauge,
  Histogram,
  initMetrics,
  getMetrics,
  measureTime,
  incCounter,
  setGauge,
  type MetricsConfig,
  type MetricsSnapshot,
  type MetricLabels,
  type CounterValue,
  type GaugeValue,
  type HistogramValue,
  type SystemMetrics,
} from './metrics-collector.js';

// Re-export OpenTelemetry integration for convenience
export {
  OpenTelemetryIntegration,
  initOpenTelemetry,
  getOpenTelemetry,
  trace,
  type OTelConfig,
} from '../integrations/opentelemetry-integration.js';
