/**
 * Health Routes
 *
 * Handles health checks, stats, and monitoring API endpoints.
 * Provides comprehensive health monitoring for Kubernetes, Docker, and other orchestrators.
 */

import { Router, Request, Response } from 'express';
import { createRequire } from 'module';
import { asyncHandler } from '../middleware/index.js';
import { getRequestStats } from '../middleware/logging.js';
import { getDatabaseManager } from '../../database/database-manager.js';
import { getConnectionStats } from '../websocket/handler.js';
import { detectProviderFromEnv } from '../../utils/provider-detector.js';
import type { ServerStats } from '../types.js';

const require = createRequire(import.meta.url);

const router = Router();

// Track server start time
const serverStartTime = Date.now();

// Track last API heartbeat
let lastApiHeartbeat: Date | null = null;
let lastApiLatency: number | null = null;

// Version info from package.json
let VERSION = '0.0.0';
try {
  const pkg = require('../../../package.json');
  VERSION = pkg.version || VERSION;
} catch {
  VERSION = process.env.npm_package_version || '0.0.0';
}

// Memory threshold (500MB)
const MEMORY_THRESHOLD = 500 * 1024 * 1024;

/**
 * Update API heartbeat timestamp
 * Called after successful API calls
 */
export function updateApiHeartbeat(latencyMs?: number): void {
  lastApiHeartbeat = new Date();
  if (latencyMs !== undefined) {
    lastApiLatency = latencyMs;
  }
}

/**
 * Get last API heartbeat info
 */
export function getApiHeartbeat(): { timestamp: Date | null; latencyMs: number | null } {
  return { timestamp: lastApiHeartbeat, latencyMs: lastApiLatency };
}

/**
 * Check if database is healthy
 */
function checkDatabase(): 'ok' | 'error' {
  try {
    const dbManager = getDatabaseManager();
    if (!dbManager.isInitialized()) {
      return 'error';
    }
    // Try a simple query to verify connection
    dbManager.getDatabase().prepare('SELECT 1').get();
    return 'ok';
  } catch {
    return 'error';
  }
}

/**
 * Check if at least one LLM provider is reachable. The original check
 * only looked at `GROK_API_KEY`, which falsely reported "error" for
 * users running Ollama/OpenAI/Anthropic/Gemini. We now accept any of:
 *  - GROK_API_KEY / XAI_API_KEY (xAI)
 *  - OPENAI_API_KEY (OpenAI)
 *  - ANTHROPIC_API_KEY (Anthropic)
 *  - GEMINI_API_KEY (Google)
 *  - OPENAI_BASE_URL pointing at a local Ollama / LM-Studio (no key needed)
 */
function checkApi(): 'ok' | 'error' {
  if (detectProviderFromEnv()) {
    return 'ok';
  }

  if (
    process.env.GROK_API_KEY ||
    process.env.XAI_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    process.env.GEMINI_API_KEY
  ) {
    return 'ok';
  }
  // Local provider (Ollama, LM Studio, …) — accept loopback baseUrls
  // even without an API key.
  const baseUrl = process.env.OPENAI_BASE_URL ?? '';
  if (/(127\.0\.0\.1|localhost|0\.0\.0\.0|::1)/i.test(baseUrl)) return 'ok';
  return 'error';
}

/**
 * Check memory usage
 */
function checkMemory(): 'ok' | 'error' {
  const memUsage = process.memoryUsage();
  return memUsage.heapUsed < MEMORY_THRESHOLD ? 'ok' : 'error';
}

function getConfiguredProviderStatus(): { ready: boolean; message: string } {
  const provider = detectProviderFromEnv();
  if (!provider) {
    return {
      ready: false,
      message: 'No LLM provider configured',
    };
  }

  return {
    ready: true,
    message: `Provider configured: ${provider.provider}`,
  };
}

function getGrokModelsUrl(baseURL: string): string {
  return `${baseURL.replace(/\/+$/, '')}/models`;
}

/**
 * Health check response type
 */
interface HealthCheckResponse {
  status: 'ok' | 'degraded' | 'error';
  version: string;
  uptime: number;
  uptimeFormatted: string;
  timestamp: string;
  checks: {
    database: 'ok' | 'error';
    api: 'ok' | 'error';
    memory: 'ok' | 'error';
    sensoryBridge?: 'ok' | 'error';
  };
  memory: {
    heapUsedMB: number;
    heapTotalMB: number;
    rssMB: number;
    externalMB: number;
    percentUsed: number;
  };
  connections: {
    websocket: {
      total: number;
      authenticated: number;
      streaming: number;
    };
  };
  apiHeartbeat: {
    lastCheck: string | null;
    latencyMs: number | null;
    status: 'ok' | 'stale' | 'unknown';
  };
}

/**
 * Format uptime in human readable format
 */
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

  return parts.join(' ');
}

/**
 * Check API heartbeat status
 */
function getApiHeartbeatStatus(): 'ok' | 'stale' | 'unknown' {
  if (!lastApiHeartbeat) {
    return 'unknown';
  }
  // Consider stale if no heartbeat in last 5 minutes
  const staleThreshold = 5 * 60 * 1000;
  const timeSinceLastHeartbeat = Date.now() - lastApiHeartbeat.getTime();
  return timeSinceLastHeartbeat < staleThreshold ? 'ok' : 'stale';
}

/**
 * GET /api/health
 * Comprehensive health check (no auth required)
 */
router.get(
  '/',
  asyncHandler(async (_req: Request, res: Response) => {
    const checks: HealthCheckResponse['checks'] = {
      database: checkDatabase(),
      api: checkApi(),
      memory: checkMemory(),
    };
    if (process.env.CODEBUDDY_SENSORY === 'true') {
      const { getSensoryBridgeHealth } = await import('../../sensory/sensory-bridge.js');
      checks.sensoryBridge = getSensoryBridgeHealth().ready ? 'ok' : 'error';
    }

    const checksOk = Object.values(checks).filter((c) => c === 'ok').length;
    const totalChecks = Object.values(checks).length;

    // Determine overall status
    let status: 'ok' | 'degraded' | 'error';
    if (checksOk === totalChecks) {
      status = 'ok';
    } else if (checksOk > 0) {
      status = 'degraded';
    } else {
      status = 'error';
    }

    const uptimeSeconds = Math.floor((Date.now() - serverStartTime) / 1000);
    const memUsage = process.memoryUsage();
    const wsStats = getConnectionStats();
    const heartbeat = getApiHeartbeat();

    const response: HealthCheckResponse = {
      status,
      version: VERSION,
      uptime: uptimeSeconds,
      uptimeFormatted: formatUptime(uptimeSeconds),
      timestamp: new Date().toISOString(),
      checks,
      memory: {
        heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
        rssMB: Math.round(memUsage.rss / 1024 / 1024),
        externalMB: Math.round(memUsage.external / 1024 / 1024),
        percentUsed: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100),
      },
      connections: {
        websocket: wsStats,
      },
      apiHeartbeat: {
        lastCheck: heartbeat.timestamp?.toISOString() || null,
        latencyMs: heartbeat.latencyMs,
        status: getApiHeartbeatStatus(),
      },
    };

    // Return 200 for ok/degraded, 503 for error
    res.status(status === 'error' ? 503 : 200).json(response);
  })
);

/**
 * GET /api/health/ready
 * Readiness check - verifies the service can accept traffic
 * Checks all critical dependencies (DB, API, memory)
 */
router.get(
  '/ready',
  asyncHandler(async (_req: Request, res: Response) => {
    const checks: Record<string, { ready: boolean; message?: string; latencyMs?: number }> = {};

    const provider = detectProviderFromEnv();
    checks.provider = getConfiguredProviderStatus();

    // Check database connection
    const dbStart = Date.now();
    const dbStatus = checkDatabase();
    checks.database = {
      ready: dbStatus === 'ok',
      message: dbStatus === 'ok' ? 'Database connected' : 'Database connection failed',
      latencyMs: Date.now() - dbStart,
    };

    // Check memory (not exceeding threshold)
    const memUsage = process.memoryUsage();
    const memThreshold = 1024 * 1024 * 1024; // 1GB
    const memoryOk = memUsage.heapUsed < memThreshold;
    checks.memory = {
      ready: memoryOk,
      message: memoryOk
        ? `Memory OK (${Math.round(memUsage.heapUsed / 1024 / 1024)}MB used)`
        : `Memory pressure (${Math.round(memUsage.heapUsed / 1024 / 1024)}MB exceeds threshold)`,
    };

    if (process.env.CODEBUDDY_SENSORY === 'true') {
      const { getSensoryBridgeHealth } = await import('../../sensory/sensory-bridge.js');
      const health = getSensoryBridgeHealth();
      checks.sensoryBridge = {
        ready: health.ready,
        message:
          health.status === 'error'
            ? `Sensory bridge failed: ${health.error ?? 'unknown error'}`
            : `Sensory bridge ${health.status}`,
      };
    }

    if (provider?.provider === 'grok') {
      const apiStart = Date.now();
      try {
        const response = await fetch(getGrokModelsUrl(provider.baseURL), {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${provider.apiKey}`,
          },
          signal: AbortSignal.timeout(3000),
        });
        const apiLatency = Date.now() - apiStart;

        if (response.ok) {
          updateApiHeartbeat(apiLatency);
        }

        checks.grokApi = {
          ready: response.ok,
          message: response.ok ? 'Grok API reachable' : `Grok API returned ${response.status}`,
          latencyMs: apiLatency,
        };
      } catch (error) {
        checks.grokApi = {
          ready: false,
          message: `Grok API unreachable: ${error instanceof Error ? error.message : String(error)}`,
          latencyMs: Date.now() - apiStart,
        };
      }
    }

    const allPassing = Object.values(checks).every((c) => c.ready);
    const criticalPassing =
      checks.provider.ready &&
      checks.database.ready &&
      checks.memory.ready &&
      (checks.sensoryBridge?.ready ?? true);

    const response = {
      ready: criticalPassing,
      status: allPassing ? 'ready' : criticalPassing ? 'degraded' : 'not_ready',
      checks,
      timestamp: new Date().toISOString(),
    };

    res.status(criticalPassing ? 200 : 503).json(response);
  })
);

/**
 * GET /api/health/live
 * Liveness probe - simple check that the process is running
 * Used by Kubernetes/Docker for container health
 */
router.get(
  '/live',
  asyncHandler(async (_req: Request, res: Response) => {
    const uptimeSeconds = Math.floor((Date.now() - serverStartTime) / 1000);

    res.json({
      alive: true,
      status: 'ok',
      timestamp: new Date().toISOString(),
      pid: process.pid,
      uptime: uptimeSeconds,
      uptimeFormatted: formatUptime(uptimeSeconds),
    });
  })
);

/**
 * GET /api/health/stats
 * Detailed server statistics
 */
router.get(
  '/stats',
  asyncHandler(async (_req: Request, res: Response) => {
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
  asyncHandler(async (_req: Request, res: Response) => {
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
  asyncHandler(async (_req: Request, res: Response) => {
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
  asyncHandler(async (_req: Request, res: Response) => {
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
  asyncHandler(async (_req: Request, res: Response) => {
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
  asyncHandler(async (_req: Request, res: Response) => {
    const checks: Record<string, { status: string; latency?: number; error?: string }> = {};

    // Check Grok API
    const grokStart = Date.now();
    try {
      const response = await fetch('https://api.x.ai/v1/models', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${process.env.GROK_API_KEY || ''}`,
        },
        signal: AbortSignal.timeout(5000),
      });
      const grokLatency = Date.now() - grokStart;

      if (response.ok) {
        updateApiHeartbeat(grokLatency);
      }

      checks.grokApi = {
        status: response.ok ? 'healthy' : 'degraded',
        latency: grokLatency,
      };
    } catch (error) {
      checks.grokApi = {
        status: 'unhealthy',
        latency: Date.now() - grokStart,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    // Check database
    const dbStart = Date.now();
    const dbStatus = checkDatabase();
    checks.database = {
      status: dbStatus === 'ok' ? 'healthy' : 'unhealthy',
      latency: Date.now() - dbStart,
    };

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

// ============================================================================
// Kubernetes-standard aliases (/healthz, /readyz, /livez)
// These are registered at the top-level in server/index.ts
// ============================================================================

/**
 * Create a separate router with K8s-standard health aliases.
 * Mount at root level: app.use(k8sHealthAliases)
 */
export function createK8sHealthAliases(): Router {
  const k8s = Router();

  // /healthz → same as GET /api/health
  k8s.get('/healthz', asyncHandler(async (req: Request, res: Response) => {
    const checks = {
      database: checkDatabase(),
      api: checkApi(),
      memory: checkMemory(),
    };
    const checksOk = Object.values(checks).filter((c) => c === 'ok').length;
    const totalChecks = Object.values(checks).length;
    const status = checksOk === totalChecks ? 'ok' : checksOk > 0 ? 'degraded' : 'error';
    res.status(status === 'error' ? 503 : 200).json({ status, checks });
  }));

  // /readyz → same as GET /api/health/ready (lightweight)
  k8s.get('/readyz', asyncHandler(async (_req: Request, res: Response) => {
    const providerOk = getConfiguredProviderStatus().ready;
    const databaseOk = checkDatabase() === 'ok';
    const memOk = process.memoryUsage().heapUsed < 1024 * 1024 * 1024;
    const ready = providerOk && databaseOk && memOk;
    res.status(ready ? 200 : 503).json({
      ready,
      checks: { provider: providerOk, database: databaseOk, memory: memOk },
    });
  }));

  // /livez → same as GET /api/health/live
  k8s.get('/livez', asyncHandler(async (_req: Request, res: Response) => {
    res.json({
      alive: true,
      status: 'ok',
      pid: process.pid,
      uptime: Math.floor((Date.now() - serverStartTime) / 1000),
    });
  }));

  return k8s;
}

export default router;
