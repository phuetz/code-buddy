/**
 * Metrics Routes
 *
 * Provides comprehensive metrics endpoints for monitoring and observability.
 * Supports multiple output formats: Prometheus, JSON, and HTML dashboard.
 */

import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/index.js';
import { getMetrics, initMetrics, type MetricsSnapshot } from '../../metrics/metrics-collector.js';
import { getOpenTelemetry } from '../../integrations/opentelemetry-integration.js';

const router = Router();

// Ensure metrics collector is initialized
const ensureMetrics = () => {
  let metrics = getMetrics();
  if (!metrics) {
    metrics = initMetrics({
      consoleExport: process.env.METRICS_CONSOLE === 'true',
      fileExport: process.env.METRICS_FILE === 'true',
      filePath: process.env.METRICS_PATH,
    });
  }
  return metrics;
};

/**
 * GET /api/metrics
 * Prometheus-compatible metrics endpoint
 */
router.get(
  '/',
  asyncHandler(async (_req: Request, res: Response) => {
    const metrics = ensureMetrics();
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(metrics.toPrometheus());
  })
);

/**
 * GET /api/metrics/json
 * JSON format metrics
 */
router.get(
  '/json',
  asyncHandler(async (_req: Request, res: Response) => {
    const metrics = ensureMetrics();
    res.json(metrics.toJSON());
  })
);

/**
 * GET /api/metrics/snapshot
 * Current metrics snapshot with system info
 */
router.get(
  '/snapshot',
  asyncHandler(async (_req: Request, res: Response) => {
    const metrics = ensureMetrics();
    const snapshot = metrics.getSnapshot();

    res.json({
      timestamp: new Date(snapshot.timestamp).toISOString(),
      counters: formatCounters(snapshot),
      gauges: formatGauges(snapshot),
      histograms: formatHistograms(snapshot),
      system: {
        ...snapshot.system,
        memory: {
          heapUsedMB: Math.round(snapshot.system.memory.heapUsed / 1024 / 1024),
          heapTotalMB: Math.round(snapshot.system.memory.heapTotal / 1024 / 1024),
          rssMB: Math.round(snapshot.system.memory.rss / 1024 / 1024),
        },
      },
    });
  })
);

/**
 * GET /api/metrics/history
 * Historical metrics data
 */
router.get(
  '/history',
  asyncHandler(async (req: Request, res: Response) => {
    const metrics = ensureMetrics();
    const limit = parseInt(req.query.limit as string) || 100;
    const history = metrics.getHistory(limit);

    res.json({
      count: history.length,
      snapshots: history.map((s) => ({
        timestamp: new Date(s.timestamp).toISOString(),
        counters: Object.keys(s.counters).length,
        gauges: Object.keys(s.gauges).length,
        histograms: Object.keys(s.histograms).length,
        memory: Math.round(s.system.memory.heapUsed / 1024 / 1024),
        uptime: s.system.uptime,
      })),
    });
  })
);

/**
 * GET /api/metrics/dashboard
 * Simple HTML dashboard for metrics visualization
 */
router.get(
  '/dashboard',
  asyncHandler(async (_req: Request, res: Response) => {
    const metrics = ensureMetrics();
    const snapshot = metrics.getSnapshot();

    const html = generateDashboardHTML(snapshot);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  })
);

/**
 * GET /api/metrics/otel
 * OpenTelemetry status and trace info
 */
router.get(
  '/otel',
  asyncHandler(async (_req: Request, res: Response) => {
    const otel = getOpenTelemetry();

    if (!otel) {
      res.json({
        enabled: false,
        message: 'OpenTelemetry not initialized',
      });
      return;
    }

    const context = otel.getTraceContext();

    res.json({
      enabled: true,
      traceContext: context
        ? {
            traceId: context.traceId,
            spanId: context.spanId,
            traceparent: otel.injectContext(context),
          }
        : null,
    });
  })
);

/**
 * POST /api/metrics/reset
 * Reset all metrics (admin only)
 */
router.post(
  '/reset',
  asyncHandler(async (_req: Request, res: Response) => {
    const metrics = ensureMetrics();
    metrics.reset();

    res.json({
      success: true,
      message: 'All metrics have been reset',
      timestamp: new Date().toISOString(),
    });
  })
);

/**
 * GET /api/metrics/counters
 * List all counters
 */
router.get(
  '/counters',
  asyncHandler(async (_req: Request, res: Response) => {
    const metrics = ensureMetrics();
    const snapshot = metrics.getSnapshot();

    res.json({
      count: Object.keys(snapshot.counters).length,
      counters: formatCounters(snapshot),
    });
  })
);

/**
 * GET /api/metrics/gauges
 * List all gauges
 */
router.get(
  '/gauges',
  asyncHandler(async (_req: Request, res: Response) => {
    const metrics = ensureMetrics();
    const snapshot = metrics.getSnapshot();

    res.json({
      count: Object.keys(snapshot.gauges).length,
      gauges: formatGauges(snapshot),
    });
  })
);

/**
 * GET /api/metrics/histograms
 * List all histograms with statistics
 */
router.get(
  '/histograms',
  asyncHandler(async (_req: Request, res: Response) => {
    const metrics = ensureMetrics();
    const snapshot = metrics.getSnapshot();

    res.json({
      count: Object.keys(snapshot.histograms).length,
      histograms: formatHistograms(snapshot),
    });
  })
);

// ============================================================================
// Helper Functions
// ============================================================================

function formatCounters(snapshot: MetricsSnapshot): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [name, values] of Object.entries(snapshot.counters)) {
    if (values.length === 1 && Object.keys(values[0].labels).length === 0) {
      result[name] = values[0].value;
    } else {
      result[name] = values.map((v) => ({
        value: v.value,
        labels: v.labels,
      }));
    }
  }

  return result;
}

function formatGauges(snapshot: MetricsSnapshot): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [name, values] of Object.entries(snapshot.gauges)) {
    if (values.length === 1 && Object.keys(values[0].labels).length === 0) {
      result[name] = values[0].value;
    } else {
      result[name] = values.map((v) => ({
        value: v.value,
        labels: v.labels,
        timestamp: new Date(v.timestamp).toISOString(),
      }));
    }
  }

  return result;
}

function formatHistograms(snapshot: MetricsSnapshot): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [name, values] of Object.entries(snapshot.histograms)) {
    result[name] = values.map((v) => ({
      count: v.count,
      sum: v.sum,
      avg: v.count > 0 ? v.sum / v.count : 0,
      min: v.min,
      max: v.max,
      labels: v.labels,
      percentiles: calculatePercentiles(v),
    }));
  }

  return result;
}

function calculatePercentiles(histogram: {
  count: number;
  sum: number;
  buckets: Map<number, number>;
}): Record<string, number> {
  if (histogram.count === 0) {
    return { p50: 0, p90: 0, p95: 0, p99: 0 };
  }

  const sortedBuckets = Array.from(histogram.buckets.entries()).sort(
    ([a], [b]) => a - b
  );

  const getPercentile = (p: number): number => {
    const target = histogram.count * p;
    for (const [bound, count] of sortedBuckets) {
      if (count >= target) {
        return bound;
      }
    }
    return sortedBuckets[sortedBuckets.length - 1]?.[0] || 0;
  };

  return {
    p50: getPercentile(0.5),
    p90: getPercentile(0.9),
    p95: getPercentile(0.95),
    p99: getPercentile(0.99),
  };
}

function generateDashboardHTML(snapshot: MetricsSnapshot): string {
  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  };

  const formatUptime = (seconds: number) => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (mins > 0) parts.push(`${mins}m`);
    parts.push(`${secs}s`);

    return parts.join(' ');
  };

  const countersHtml = Object.entries(snapshot.counters)
    .map(([name, values]) => {
      const total = values.reduce((sum, v) => sum + v.value, 0);
      return `
        <div class="metric-card">
          <div class="metric-name">${name}</div>
          <div class="metric-value">${total.toLocaleString()}</div>
          <div class="metric-type">counter</div>
        </div>
      `;
    })
    .join('');

  const gaugesHtml = Object.entries(snapshot.gauges)
    .map(([name, values]) => {
      const latest = values[values.length - 1];
      const value = latest?.value || 0;
      const displayValue = name.includes('bytes') || name.includes('memory')
        ? formatBytes(value)
        : value.toLocaleString();
      return `
        <div class="metric-card">
          <div class="metric-name">${name}</div>
          <div class="metric-value">${displayValue}</div>
          <div class="metric-type">gauge</div>
        </div>
      `;
    })
    .join('');

  const histogramsHtml = Object.entries(snapshot.histograms)
    .map(([name, values]) => {
      const stats = values[0];
      if (!stats) return '';
      const avg = stats.count > 0 ? (stats.sum / stats.count).toFixed(3) : '0';
      return `
        <div class="metric-card histogram">
          <div class="metric-name">${name}</div>
          <div class="metric-stats">
            <span>Count: ${stats.count}</span>
            <span>Avg: ${avg}s</span>
            <span>Min: ${stats.min.toFixed(3)}s</span>
            <span>Max: ${stats.max.toFixed(3)}s</span>
          </div>
          <div class="metric-type">histogram</div>
        </div>
      `;
    })
    .join('');

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="refresh" content="30">
  <title>Code Buddy Metrics Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      min-height: 100vh;
      padding: 2rem;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 2rem;
      padding-bottom: 1rem;
      border-bottom: 1px solid #334155;
    }
    .header h1 {
      font-size: 1.5rem;
      font-weight: 600;
      color: #f1f5f9;
    }
    .header .status {
      display: flex;
      gap: 1rem;
      font-size: 0.875rem;
      color: #94a3b8;
    }
    .header .status span {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .header .status .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #22c55e;
    }
    .system-info {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }
    .system-card {
      background: #1e293b;
      border-radius: 8px;
      padding: 1rem;
    }
    .system-card .label {
      font-size: 0.75rem;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.25rem;
    }
    .system-card .value {
      font-size: 1.5rem;
      font-weight: 600;
      color: #f1f5f9;
    }
    .section {
      margin-bottom: 2rem;
    }
    .section h2 {
      font-size: 1rem;
      font-weight: 600;
      color: #cbd5e1;
      margin-bottom: 1rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .section h2::before {
      content: '';
      width: 3px;
      height: 1rem;
      border-radius: 2px;
    }
    .section.counters h2::before { background: #3b82f6; }
    .section.gauges h2::before { background: #22c55e; }
    .section.histograms h2::before { background: #f59e0b; }
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
      gap: 1rem;
    }
    .metric-card {
      background: #1e293b;
      border-radius: 8px;
      padding: 1rem;
      position: relative;
    }
    .metric-card.histogram {
      grid-column: span 2;
    }
    .metric-name {
      font-size: 0.75rem;
      color: #94a3b8;
      word-break: break-all;
      margin-bottom: 0.5rem;
    }
    .metric-value {
      font-size: 1.75rem;
      font-weight: 600;
      color: #f1f5f9;
    }
    .metric-stats {
      display: flex;
      flex-wrap: wrap;
      gap: 1rem;
      font-size: 0.875rem;
      color: #cbd5e1;
    }
    .metric-type {
      position: absolute;
      top: 0.75rem;
      right: 0.75rem;
      font-size: 0.625rem;
      text-transform: uppercase;
      padding: 0.125rem 0.5rem;
      border-radius: 4px;
      background: #334155;
      color: #94a3b8;
    }
    .footer {
      margin-top: 2rem;
      padding-top: 1rem;
      border-top: 1px solid #334155;
      font-size: 0.75rem;
      color: #64748b;
      display: flex;
      justify-content: space-between;
    }
    .no-data {
      color: #64748b;
      font-style: italic;
    }
    @media (max-width: 640px) {
      body { padding: 1rem; }
      .metric-card.histogram { grid-column: span 1; }
      .metric-stats { flex-direction: column; gap: 0.5rem; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Code Buddy Metrics</h1>
    <div class="status">
      <span><span class="dot"></span> Live</span>
      <span>Uptime: ${formatUptime(snapshot.system.uptime)}</span>
    </div>
  </div>

  <div class="system-info">
    <div class="system-card">
      <div class="label">Heap Used</div>
      <div class="value">${formatBytes(snapshot.system.memory.heapUsed)}</div>
    </div>
    <div class="system-card">
      <div class="label">Heap Total</div>
      <div class="value">${formatBytes(snapshot.system.memory.heapTotal)}</div>
    </div>
    <div class="system-card">
      <div class="label">RSS Memory</div>
      <div class="value">${formatBytes(snapshot.system.memory.rss)}</div>
    </div>
    <div class="system-card">
      <div class="label">CPU User</div>
      <div class="value">${(snapshot.system.cpu.user / 1e6).toFixed(2)}s</div>
    </div>
  </div>

  <div class="section counters">
    <h2>Counters</h2>
    <div class="metrics-grid">
      ${countersHtml || '<p class="no-data">No counters recorded yet</p>'}
    </div>
  </div>

  <div class="section gauges">
    <h2>Gauges</h2>
    <div class="metrics-grid">
      ${gaugesHtml || '<p class="no-data">No gauges recorded yet</p>'}
    </div>
  </div>

  <div class="section histograms">
    <h2>Histograms</h2>
    <div class="metrics-grid">
      ${histogramsHtml || '<p class="no-data">No histograms recorded yet</p>'}
    </div>
  </div>

  <div class="footer">
    <span>Last updated: ${new Date(snapshot.timestamp).toISOString()}</span>
    <span>Auto-refresh: 30s</span>
  </div>
</body>
</html>
  `.trim();
}

export default router;
