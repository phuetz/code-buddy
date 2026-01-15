/**
 * Health Routes
 *
 * Handles health checks, stats, and monitoring API endpoints.
 */

import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/index.js';
import { getRequestStats } from '../middleware/logging.js';
import type { HealthResponse, ServerStats } from '../types.js';

const router = Router();

// Track server start time
const serverStartTime = Date.now();

// Version info (would normally come from package.json)
const VERSION = process.env.npm_package_version || '1.0.0';

/**
 * GET /api/health
 * Basic health check (no auth required)
 */
router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const response: HealthResponse = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: VERSION,
      uptime: Math.floor((Date.now() - serverStartTime) / 1000),
    };

    res.json(response);
  })
);

/**
 * GET /api/health/ready
 * Readiness check (can accept traffic)
 */
router.get(
  '/ready',
  asyncHandler(async (req: Request, res: Response) => {
    // Check if critical services are available
    const checks: Record<string, boolean> = {};

    // Check API key configuration
    checks.apiKey = !!process.env.GROK_API_KEY;

    // Check memory (not exceeding threshold)
    const memUsage = process.memoryUsage();
    const memThreshold = 1024 * 1024 * 1024; // 1GB
    checks.memory = memUsage.heapUsed < memThreshold;

    const allPassing = Object.values(checks).every((v) => v);

    const response = {
      ready: allPassing,
      checks,
      timestamp: new Date().toISOString(),
    };

    res.status(allPassing ? 200 : 503).json(response);
  })
);

/**
 * GET /api/health/live
 * Liveness check (process is running)
 */
router.get(
  '/live',
  asyncHandler(async (req: Request, res: Response) => {
    res.json({
      alive: true,
      timestamp: new Date().toISOString(),
      pid: process.pid,
    });
  })
);

/**
 * GET /api/health/stats
 * Detailed server statistics
 */
router.get(
  '/stats',
  asyncHandler(async (req: Request, res: Response) => {
    const requestStats = getRequestStats();
    const memUsage = process.memoryUsage();

    const stats: ServerStats = {
      uptime: Math.floor((Date.now() - serverStartTime) / 1000),
      requests: {
        total: requestStats.total,
        errors: requestStats.errors,
        averageLatency: requestStats.averageLatency,
        byEndpoint: requestStats.byEndpoint,
        byStatus: requestStats.byStatus,
      },
      memory: {
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
        external: Math.round(memUsage.external / 1024 / 1024),
        rss: Math.round(memUsage.rss / 1024 / 1024),
      },
      process: {
        pid: process.pid,
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
      },
    };

    res.json(stats);
  })
);

/**
 * GET /api/health/metrics
 * Prometheus-compatible metrics
 */
router.get(
  '/metrics',
  asyncHandler(async (req: Request, res: Response) => {
    const requestStats = getRequestStats();
    const memUsage = process.memoryUsage();
    const uptime = Math.floor((Date.now() - serverStartTime) / 1000);

    const metrics: string[] = [
      '# HELP codebuddy_uptime_seconds Server uptime in seconds',
      '# TYPE codebuddy_uptime_seconds gauge',
      `codebuddy_uptime_seconds ${uptime}`,
      '',
      '# HELP codebuddy_requests_total Total number of requests',
      '# TYPE codebuddy_requests_total counter',
      `codebuddy_requests_total ${requestStats.total}`,
      '',
      '# HELP codebuddy_errors_total Total number of errors',
      '# TYPE codebuddy_errors_total counter',
      `codebuddy_errors_total ${requestStats.errors}`,
      '',
      '# HELP codebuddy_request_latency_avg Average request latency in ms',
      '# TYPE codebuddy_request_latency_avg gauge',
      `codebuddy_request_latency_avg ${requestStats.averageLatency}`,
      '',
      '# HELP codebuddy_memory_heap_used_bytes Heap memory used',
      '# TYPE codebuddy_memory_heap_used_bytes gauge',
      `codebuddy_memory_heap_used_bytes ${memUsage.heapUsed}`,
      '',
      '# HELP codebuddy_memory_heap_total_bytes Total heap memory',
      '# TYPE codebuddy_memory_heap_total_bytes gauge',
      `codebuddy_memory_heap_total_bytes ${memUsage.heapTotal}`,
      '',
      '# HELP codebuddy_memory_rss_bytes Resident set size',
      '# TYPE codebuddy_memory_rss_bytes gauge',
      `codebuddy_memory_rss_bytes ${memUsage.rss}`,
    ];

    // Add per-endpoint metrics
    metrics.push('');
    metrics.push('# HELP codebuddy_requests_by_endpoint Requests by endpoint');
    metrics.push('# TYPE codebuddy_requests_by_endpoint counter');
    for (const [endpoint, count] of Object.entries(requestStats.byEndpoint)) {
      const sanitized = endpoint.replace(/"/g, '\\"');
      metrics.push(`codebuddy_requests_by_endpoint{endpoint="${sanitized}"} ${count}`);
    }

    // Add per-status metrics
    metrics.push('');
    metrics.push('# HELP codebuddy_requests_by_status Requests by HTTP status');
    metrics.push('# TYPE codebuddy_requests_by_status counter');
    for (const [status, count] of Object.entries(requestStats.byStatus)) {
      metrics.push(`codebuddy_requests_by_status{status="${status}"} ${count}`);
    }

    res.setHeader('Content-Type', 'text/plain');
    res.send(metrics.join('\n'));
  })
);

/**
 * GET /api/health/version
 * Version information
 */
router.get(
  '/version',
  asyncHandler(async (req: Request, res: Response) => {
    res.json({
      version: VERSION,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      env: process.env.NODE_ENV || 'development',
    });
  })
);

/**
 * GET /api/health/config
 * Non-sensitive configuration info
 */
router.get(
  '/config',
  asyncHandler(async (req: Request, res: Response) => {
    res.json({
      model: process.env.GROK_MODEL || 'grok-3-latest',
      baseUrl: process.env.GROK_BASE_URL ? '(custom)' : 'https://api.x.ai',
      features: {
        yoloMode: process.env.YOLO_MODE === 'true',
        maxCost: process.env.MAX_COST ? parseFloat(process.env.MAX_COST) : 10,
        morphEnabled: !!process.env.MORPH_API_KEY,
      },
    });
  })
);

/**
 * POST /api/health/gc
 * Trigger garbage collection (if exposed)
 */
router.post(
  '/gc',
  asyncHandler(async (req: Request, res: Response) => {
    const beforeMem = process.memoryUsage();

    if (global.gc) {
      global.gc();
      const afterMem = process.memoryUsage();

      res.json({
        success: true,
        memoryBefore: {
          heapUsed: Math.round(beforeMem.heapUsed / 1024 / 1024),
        },
        memoryAfter: {
          heapUsed: Math.round(afterMem.heapUsed / 1024 / 1024),
        },
        freed: Math.round((beforeMem.heapUsed - afterMem.heapUsed) / 1024 / 1024),
      });
    } else {
      res.json({
        success: false,
        message: 'Garbage collection not exposed. Run with --expose-gc flag.',
        memory: {
          heapUsed: Math.round(beforeMem.heapUsed / 1024 / 1024),
        },
      });
    }
  })
);

/**
 * GET /api/health/dependencies
 * Check external dependencies
 */
router.get(
  '/dependencies',
  asyncHandler(async (req: Request, res: Response) => {
    const checks: Record<string, { status: string; latency?: number; error?: string }> = {};

    // Check Grok API
    const grokStart = Date.now();
    try {
      const response = await fetch('https://api.x.ai/v1/models', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${process.env.GROK_API_KEY || ''}`,
        },
        signal: AbortSignal.timeout(5000),
      });
      checks.grokApi = {
        status: response.ok ? 'healthy' : 'degraded',
        latency: Date.now() - grokStart,
      };
    } catch (error) {
      checks.grokApi = {
        status: 'unhealthy',
        latency: Date.now() - grokStart,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    // Overall status
    const allHealthy = Object.values(checks).every((c) => c.status === 'healthy');
    const anyUnhealthy = Object.values(checks).some((c) => c.status === 'unhealthy');

    res.status(anyUnhealthy ? 503 : 200).json({
      status: allHealthy ? 'healthy' : anyUnhealthy ? 'unhealthy' : 'degraded',
      checks,
      timestamp: new Date().toISOString(),
    });
  })
);

export default router;
