/**
 * API Server
 *
 * Main entry point for the Code Buddy REST API and WebSocket server.
 *
 * Usage:
 *   npm run server
 *   # or
 *   codebuddy server --port 3000
 */

import crypto from 'crypto';
import os from 'os';
import { createRequire } from 'module';
import express, { Application } from 'express';
import cors from 'cors';
import { createServer, Server as HttpServer } from 'http';
import { createServer as createHttpsServer, Server as HttpsServer } from 'https';
import { resolveServerTlsOptions } from './tls-config.js';

const _require = createRequire(import.meta.url);
let SERVER_VERSION = '0.0.0';
try {
  SERVER_VERSION = _require('../../package.json').version || SERVER_VERSION;
} catch {
  /* ignore */
}
import type { ServerConfig } from './types.js';
import { isOriginAllowed, isLoopbackHost, DEFAULT_LOCALHOST_ORIGINS } from './origin-check.js';
import {
  createAuthMiddleware,
  requireScope,
  createRateLimitMiddleware,
  createLoggingMiddleware,
  createSecurityHeadersMiddleware,
  requestIdMiddleware,
  errorHandler,
  notFoundHandler,
} from './middleware/index.js';
import {
  chatRoutes,
  toolsRoutes,
  sessionsRoutes,
  memoryRoutes,
  lessonsRoutes,
  healthRoutes,
  metricsRoutes,
  createWorkflowApiRouter,
  createA2AProtocolRoutes,
  createACPRoutes,
  createK8sHealthAliases,
  createDashboardRouter,
  createCloudTaskRoutes,
  createWebhookRoutes,
  mobileRoutes,
} from './routes/index.js';
import { setupWebSocket, closeAllConnections, getConnectionStats } from './websocket/index.js';
import { setupDesktopWebSocket, closeDesktopWebSocket } from './websocket/desktop-handler.js';
import { startFleetHeartbeat, stopFleetHeartbeat } from '../fleet/heartbeat-broadcaster.js';
import { startAutonomousTick, stopAutonomousTick } from '../fleet/autonomous-tick-broadcaster.js';
import { startApiHeartbeatMonitor, stopApiHeartbeatMonitor } from './heartbeat-monitor.js';
import { wireCompactionBridge, unwireCompactionBridge } from '../fleet/compaction-bridge.js';
import { wirePeerChatBridge, unwirePeerChatBridge } from '../fleet/peer-chat-bridge.js';
import { wirePeerSessionBridge, unwirePeerSessionBridge } from '../fleet/peer-session-bridge.js';
import { wirePeerToolBridge, unwirePeerToolBridge } from '../fleet/peer-tool-bridge.js';
import { logger } from '../utils/logger.js';
import { initMetrics, getMetrics as _getMetrics } from '../metrics/index.js';
import { CSRFProtection } from '../security/csrf-protection.js';
import { initializeDatabase } from '../database/database-manager.js';
import type { InboundMessage } from '../channels/index.js';
import { SERVER_CONFIG, TIMEOUT_CONFIG, LIMIT_CONFIG } from '../config/constants.js';
import { listServerModels } from './agent-adapter.js';

// Lazy import to avoid circular dependency: channels/index.ts re-exports
// TelegramChannel/DiscordChannel which import BaseChannel from channels/index.ts
// before it's fully initialized.
let _getPeerRouter: typeof import('../channels/peer-routing.js').getPeerRouter;
async function getPeerRouter() {
  if (!_getPeerRouter) {
    const mod = await import('../channels/peer-routing.js');
    _getPeerRouter = mod.getPeerRouter;
  }
  return _getPeerRouter();
}

/**
 * Generate a secure random secret for development use only
 * In production, JWT_SECRET environment variable MUST be set
 */
function getJwtSecret(authEnabled: boolean): string {
  if (process.env.JWT_SECRET) {
    return process.env.JWT_SECRET;
  }

  if (!authEnabled) {
    return '';
  }

  // In production, require explicit JWT_SECRET
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'SECURITY ERROR: JWT_SECRET environment variable must be set in production. ' +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(64).toString('hex'))\""
    );
  }

  // Development only: generate ephemeral secret (warning: tokens won't persist across restarts)
  logger.warn(
    'No JWT_SECRET set. Using ephemeral secret for development. ' +
      'Set JWT_SECRET environment variable for production use.'
  );
  return crypto.randomBytes(64).toString('hex');
}

export function getServerBaseUrl(server: HttpServer, config: ServerConfig): string {
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : config.port;
  const publicHost = config.host === '0.0.0.0' || config.host === '::' ? '127.0.0.1' : config.host;
  const host =
    publicHost.includes(':') && !publicHost.startsWith('[') ? `[${publicHost}]` : publicHost;
  // Report https:// when the server was constructed with TLS so the logged URL
  // isn't a lie. Default (plain http.Server) stays http://.
  const scheme = server instanceof HttpsServer ? 'https' : 'http';
  return `${scheme}://${host}:${port}`;
}

// Default configuration
const DEFAULT_CONFIG: ServerConfig = {
  port: parseInt(process.env.PORT || String(SERVER_CONFIG.DEFAULT_PORT), 10),
  host: process.env.HOST || SERVER_CONFIG.DEFAULT_HOST,
  cors: true,
  // Secure-by-default: localhost only. Server-to-server callers (e.g. the fleet hub)
  // ignore CORS, so this does not affect the mesh; set CORS_ORIGINS (or '*') to widen.
  corsOrigins: process.env.CORS_ORIGINS?.split(',') || DEFAULT_LOCALHOST_ORIGINS,
  rateLimit: true,
  rateLimitMax: parseInt(
    process.env.RATE_LIMIT_MAX || String(LIMIT_CONFIG.DEFAULT_RATE_LIMIT_MAX),
    10
  ),
  rateLimitWindow: parseInt(
    process.env.RATE_LIMIT_WINDOW || String(TIMEOUT_CONFIG.DEFAULT_RATE_LIMIT_WINDOW),
    10
  ),
  authEnabled:
    process.env.NODE_ENV === 'production'
      ? true // Auth is always enabled in production (fail-closed)
      : process.env.AUTH_ENABLED !== 'false',
  jwtSecret: process.env.JWT_SECRET || '',
  jwtExpiration: process.env.JWT_EXPIRATION || SERVER_CONFIG.DEFAULT_JWT_EXPIRATION,
  websocketEnabled: process.env.WS_ENABLED !== 'false',
  channelIntakeEnabled: process.env.CODEBUDDY_SERVER_CHANNEL_INTAKE === 'true',
  logging: process.env.LOGGING !== 'false',
  maxRequestSize: process.env.MAX_REQUEST_SIZE || SERVER_CONFIG.DEFAULT_MAX_REQUEST_SIZE,
  // Security headers: enabled by default, can be disabled via SECURITY_HEADERS=false
  securityHeaders: {
    enabled: process.env.SECURITY_HEADERS !== 'false',
    enableCSP: true,
    enableHSTS: process.env.NODE_ENV === 'production',
    frameOptions: 'DENY',
    referrerPolicy: 'strict-origin-when-cross-origin',
  },
};

function getFirstQueryValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const first = value[0];
    return typeof first === 'string' ? first : undefined;
  }
  return undefined;
}

function wantsStatusReport(query: Record<string, unknown>): boolean {
  const format = getFirstQueryValue(query.format)?.toLowerCase();
  const report = getFirstQueryValue(query.report)?.toLowerCase();
  return format === 'report' || report === '1' || report === 'true' || report === 'yes';
}

/**
 * Create and configure the Express application
 */
function createApp(config: ServerConfig): Application {
  const app = express();

  // Trust proxy (for rate limiting behind reverse proxy)
  app.set('trust proxy', 1);

  // Request ID middleware
  app.use(requestIdMiddleware);

  // Security headers middleware (CSP, X-Frame-Options, HSTS, etc.)
  app.use(createSecurityHeadersMiddleware(config));

  // Logging middleware
  if (config.logging) {
    app.use(createLoggingMiddleware(config));
  }

  // CORS
  if (config.cors) {
    const isWildcard = config.corsOrigins?.includes('*');
    const allowedOrigins: string[] = Array.isArray(config.corsOrigins)
      ? config.corsOrigins
      : typeof config.corsOrigins === 'string'
        ? config.corsOrigins.split(',')
        : DEFAULT_LOCALHOST_ORIGINS;
    app.use(
      cors({
        // Function form so wildcard-port patterns (e.g. http://localhost:*) match and
        // non-browser clients (no Origin header) are allowed. '*' keeps legacy open behavior.
        origin: isWildcard
          ? true
          : (origin, cb) => cb(null, !origin || isOriginAllowed(origin, allowedOrigins)),
        credentials: !isWildcard,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: [
          'Content-Type',
          'Authorization',
          'X-API-Key',
          'X-Request-ID',
          'X-CSRF-Token',
        ],
      })
    );
  }

  // Body parsing
  app.use(express.json({ limit: config.maxRequestSize }));
  app.use(express.urlencoded({ extended: true, limit: config.maxRequestSize }));

  // Rate limiting
  if (config.rateLimit) {
    app.use(createRateLimitMiddleware(config));
  }

  // Health routes (no auth required)
  app.use('/api/health', healthRoutes);

  // Kubernetes-standard health aliases (no auth required)
  app.use(createK8sHealthAliases());

  // Metrics routes (no auth required for monitoring)
  app.use('/api/metrics', metricsRoutes);

  // Also expose at /metrics for Prometheus compatibility
  app.use('/metrics', metricsRoutes);

  // Mobile remote-supervision routes (custom pairing-token auth)
  app.use('/api/mobile', mobileRoutes);

  // Authentication (applied after public health/metrics/mobile endpoints)
  app.use(createAuthMiddleware(config));

  // A2A routes (auth-based, exempt from CSRF) — must be mounted BEFORE CSRF middleware
  app.use('/api/a2a', createA2AProtocolRoutes());

  // CSRF protection for state-changing endpoints (POST/PUT/DELETE)
  // Applied AFTER A2A routes so they are never touched by CSRF middleware
  if (config.authEnabled && process.env.CSRF_PROTECTION !== 'false') {
    const csrfProtection = new CSRFProtection({
      secure: process.env.NODE_ENV === 'production',
    });

    // Provide CSRF token endpoint
    app.get('/api/csrf-token', (req, res) => {
      const sessionId = (req as unknown as Record<string, unknown>).sessionId as string | undefined;
      const token = csrfProtection.generateToken(sessionId);
      res.json({ token: token.token });
    });

    // Apply CSRF middleware for state-changing requests (now applied after A2A)
    app.use(csrfProtection.middleware() as express.RequestHandler);
  }

  // API routes
  app.use('/api/chat', chatRoutes);
  app.use('/api/tools', toolsRoutes);
  app.use('/api/sessions', sessionsRoutes);
  app.use('/api/memory', memoryRoutes);
  app.use('/api/lessons', lessonsRoutes);
  app.use('/api/workflows', createWorkflowApiRouter());
  app.use('/api/acp', createACPRoutes());
  app.use('/api/cloud/tasks', createCloudTaskRoutes());
  app.use('/api/webhooks', createWebhookRoutes());

  // OpenAI-compatible alias
  app.use('/v1/chat', chatRoutes);
  app.get('/v1/models', requireScope('chat'), (_req, res) => {
    res.json({
      object: 'list',
      data: listServerModels(),
    });
  });

  // Peer routing stats endpoint
  app.get('/api/routing/stats', async (_req, res) => {
    try {
      const router = await getPeerRouter();
      res.json(router.getStats());
    } catch (error) {
      logger.error('GET /api/routing/stats failed', { error: String(error) });
      res.status(500).json({ error: 'Peer router unavailable' });
    }
  });

  // Peer route resolution endpoint (for testing/debugging)
  app.post('/api/routing/resolve', async (req, res) => {
    const message = req.body.message as InboundMessage | undefined;
    const accountId = req.body.accountId as string | undefined;

    if (!message) {
      res.status(400).json({ error: 'message is required in request body' });
      return;
    }

    try {
      const router = await getPeerRouter();
      const resolved = router.resolve(message, accountId);
      res.json({ resolved });
    } catch (error) {
      logger.error('POST /api/routing/resolve failed', { error: String(error) });
      res.status(500).json({ error: 'Peer router unavailable' });
    }
  });

  // Daemon status endpoint
  app.get('/api/daemon/status', async (req, res) => {
    const report = wantsStatusReport(req.query as Record<string, unknown>);
    try {
      const { getDaemonManager } = await import('../daemon/index.js');
      const manager = getDaemonManager();
      const status = await manager.status();
      if (report) {
        const { buildDaemonStatusReport } = await import('../daemon/status-reports.js');
        res.json(buildDaemonStatusReport(status));
        return;
      }
      res.json(status);
    } catch (_error) {
      const status = { running: false, services: [], restartCount: 0 };
      if (report) {
        const { buildDaemonStatusReport } = await import('../daemon/status-reports.js');
        res.json(buildDaemonStatusReport(status));
        return;
      }
      res.json(status);
    }
  });

  // Daemon health endpoint
  app.get('/api/daemon/health', async (_req, res) => {
    try {
      const { getHealthMonitor } = await import('../daemon/index.js');
      const monitor = getHealthMonitor();
      res.json(monitor.getHealthSummary());
    } catch (_error) {
      res.json({ status: 'unknown', uptime: 0, memory: { percentage: 0, rss: 0 }, services: [] });
    }
  });

  // Cron jobs endpoints
  app.get('/api/cron/jobs', async (_req, res) => {
    try {
      const { getCronScheduler } = await import('../scheduler/cron-scheduler.js');
      const scheduler = getCronScheduler();
      await scheduler.loadFromDisk();
      const jobs = scheduler.listJobs();
      res.json({ jobs, stats: scheduler.getStats() });
    } catch (_error) {
      res.json({ jobs: [], stats: {} });
    }
  });

  app.post('/api/cron/jobs/:id/trigger', async (req, res) => {
    try {
      const { getCronScheduler } = await import('../scheduler/cron-scheduler.js');
      const scheduler = getCronScheduler();
      await scheduler.loadFromDisk();
      const run = await scheduler.runJobNow(req.params.id);
      if (run) {
        res.json({ success: true, run });
      } else {
        res.status(404).json({ error: 'Job not found' });
      }
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // Notification preferences endpoints
  app.get('/api/notifications/preferences', async (_req, res) => {
    try {
      const { getNotificationManager } = await import('../agent/proactive/index.js');
      const manager = getNotificationManager();
      res.json(manager.getPreferences());
    } catch (_error) {
      res.json({});
    }
  });

  app.post('/api/notifications/preferences', async (req, res) => {
    try {
      if (!req.body || typeof req.body !== 'object') {
        res.status(400).json({ error: 'Request body must be a JSON object' });
        return;
      }
      const { getNotificationManager } = await import('../agent/proactive/index.js');
      const manager = getNotificationManager();
      manager.setPreferences(req.body);
      res.json(manager.getPreferences());
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // Webhook endpoints
  app.get('/api/webhooks', async (_req, res) => {
    try {
      const { WebhookManager } = await import('../webhooks/webhook-manager.js');
      const mgr = new WebhookManager();
      res.json(mgr.list());
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/webhooks', async (req, res) => {
    try {
      const { name, agentMessage, secret } = req.body;
      if (!name || typeof name !== 'string' || !agentMessage || typeof agentMessage !== 'string') {
        res.status(400).json({ error: 'name (string) and agentMessage (string) are required' });
        return;
      }
      if (name.length > 256 || agentMessage.length > 4096) {
        res.status(400).json({ error: 'name max 256 chars, agentMessage max 4096 chars' });
        return;
      }
      const { WebhookManager } = await import('../webhooks/webhook-manager.js');
      const mgr = new WebhookManager();
      const hook = mgr.register(name, agentMessage, secret);
      res.status(201).json(hook);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.delete('/api/webhooks/:id', async (req, res) => {
    try {
      const { WebhookManager } = await import('../webhooks/webhook-manager.js');
      const mgr = new WebhookManager();
      if (mgr.remove(req.params.id)) {
        res.json({ success: true });
      } else {
        res.status(404).json({ error: 'Webhook not found' });
      }
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/webhooks/:id/trigger', async (req, res) => {
    try {
      const { WebhookManager } = await import('../webhooks/webhook-manager.js');
      const mgr = new WebhookManager();
      const signature = req.headers['x-webhook-signature'] as string | undefined;
      const result = mgr.processPayload(req.params.id, req.body, signature);
      if ('error' in result) {
        const status = result.error === 'Webhook not found' ? 404 : 400;
        res.status(status).json(result);
      } else {
        res.json(result);
      }
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // Heartbeat endpoints
  app.get('/api/heartbeat/status', async (req, res) => {
    const report = wantsStatusReport(req.query as Record<string, unknown>);
    try {
      const { getHeartbeatEngine } = await import('../daemon/heartbeat.js');
      const engine = getHeartbeatEngine();
      const status = engine.getStatus();
      if (report) {
        const { buildHeartbeatStatusReport } = await import('../daemon/status-reports.js');
        res.json(buildHeartbeatStatusReport(status, engine.getConfig()));
        return;
      }
      res.json(status);
    } catch (_error) {
      const status = {
        running: false,
        enabled: false,
        lastRunTime: null,
        nextRunTime: null,
        consecutiveSuppressions: 0,
        totalTicks: 0,
        totalSuppressions: 0,
        lastResult: null,
      };
      if (report) {
        const { buildHeartbeatStatusReport } = await import('../daemon/status-reports.js');
        res.json(buildHeartbeatStatusReport(status, {
          intervalMs: 0,
          activeHoursStart: 0,
          activeHoursEnd: 0,
          timezone: 'unknown',
          heartbeatFilePath: '',
          suppressionKeyword: 'HEARTBEAT_OK',
          maxConsecutiveSuppressions: 0,
          enabled: false,
        }));
        return;
      }
      res.json({ running: false, enabled: false, totalTicks: 0 });
    }
  });

  app.post('/api/heartbeat/start', async (_req, res) => {
    try {
      const { getHeartbeatEngine } = await import('../daemon/heartbeat.js');
      const engine = getHeartbeatEngine();
      engine.start();
      res.json({ success: true, status: engine.getStatus() });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/heartbeat/stop', async (_req, res) => {
    try {
      const { getHeartbeatEngine } = await import('../daemon/heartbeat.js');
      const engine = getHeartbeatEngine();
      engine.stop();
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/heartbeat/tick', async (_req, res) => {
    try {
      const { getHeartbeatEngine } = await import('../daemon/heartbeat.js');
      const engine = getHeartbeatEngine();
      const result = await engine.tick();
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // Skills Hub endpoints
  app.get('/api/hub/search', async (req, res) => {
    try {
      const { getSkillsHub } = await import('../skills/hub.js');
      const hub = getSkillsHub();
      const query = (req.query.q as string) || '';
      const tags = req.query.tags ? (req.query.tags as string).split(',') : undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
      const result = await hub.search(query, { tags, limit });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get('/api/hub/installed', async (_req, res) => {
    try {
      const { getSkillsHub } = await import('../skills/hub.js');
      const hub = getSkillsHub();
      res.json(hub.list());
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/hub/install', async (req, res) => {
    try {
      const { name, version } = req.body;
      if (!name || typeof name !== 'string') {
        res.status(400).json({ error: 'name (string) is required' });
        return;
      }
      if (version && typeof version !== 'string') {
        res.status(400).json({ error: 'version must be a string' });
        return;
      }
      const { getSkillsHub } = await import('../skills/hub.js');
      const hub = getSkillsHub();
      const installed = await hub.install(name, version);
      res.json(installed);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.delete('/api/hub/:name', async (req, res) => {
    try {
      const { getSkillsHub } = await import('../skills/hub.js');
      const hub = getSkillsHub();
      const removed = await hub.uninstall(req.params.name);
      if (removed) {
        res.json({ success: true });
      } else {
        res.status(404).json({ error: 'Skill not found' });
      }
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // Identity endpoints
  app.get('/api/identity', async (_req, res) => {
    try {
      const { getIdentityManager } = await import('../identity/identity-manager.js');
      const mgr = getIdentityManager();
      await mgr.load(process.cwd());
      res.json(mgr.getAll());
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get('/api/identity/prompt', async (_req, res) => {
    try {
      const { getIdentityManager } = await import('../identity/identity-manager.js');
      const mgr = getIdentityManager();
      await mgr.load(process.cwd());
      res.json({ prompt: mgr.getPromptInjection() });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.put('/api/identity/:name', async (req, res) => {
    try {
      const { content } = req.body;
      if (!content || typeof content !== 'string') {
        res.status(400).json({ error: 'content (string) is required' });
        return;
      }
      if (content.length > 65536) {
        res.status(400).json({ error: 'content exceeds maximum length (64KB)' });
        return;
      }
      const { getIdentityManager } = await import('../identity/identity-manager.js');
      const mgr = getIdentityManager();
      await mgr.load(process.cwd());
      await mgr.set(req.params.name, content);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // Group security endpoints
  app.get('/api/groups/status', async (_req, res) => {
    try {
      const { getGroupSecurity } = await import('../channels/group-security.js');
      const mgr = getGroupSecurity();
      res.json(mgr.getStats());
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get('/api/groups/list', async (_req, res) => {
    try {
      const { getGroupSecurity } = await import('../channels/group-security.js');
      const mgr = getGroupSecurity();
      res.json(mgr.listGroups());
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/groups/block', async (req, res) => {
    try {
      const { userId } = req.body;
      if (!userId || typeof userId !== 'string') {
        res.status(400).json({ error: 'userId (string) is required' });
        return;
      }
      const { getGroupSecurity } = await import('../channels/group-security.js');
      const mgr = getGroupSecurity();
      mgr.addToBlocklist(userId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.delete('/api/groups/block/:userId', async (req, res) => {
    try {
      const { getGroupSecurity } = await import('../channels/group-security.js');
      const mgr = getGroupSecurity();
      if (mgr.removeFromBlocklist(req.params.userId)) {
        res.json({ success: true });
      } else {
        res.status(404).json({ error: 'User not in blocklist' });
      }
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // Auth profile endpoints
  app.get('/api/auth-profiles', async (_req, res) => {
    try {
      const { getAuthProfileManager } = await import('../auth/profile-manager.js');
      const mgr = getAuthProfileManager();
      res.json(mgr.getStatus());
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/auth-profiles', async (req, res) => {
    try {
      const profile = req.body;
      if (!profile || typeof profile !== 'object') {
        res.status(400).json({ error: 'Request body must be a JSON object' });
        return;
      }
      if (
        !profile.id ||
        typeof profile.id !== 'string' ||
        !profile.provider ||
        typeof profile.provider !== 'string'
      ) {
        res.status(400).json({ error: 'id (string) and provider (string) are required' });
        return;
      }
      const { getAuthProfileManager } = await import('../auth/profile-manager.js');
      const mgr = getAuthProfileManager();
      mgr.addProfile({
        type: 'api-key',
        credentials: {},
        priority: 0,
        metadata: {},
        ...profile,
      });
      res.status(201).json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.delete('/api/auth-profiles/:id', async (req, res) => {
    try {
      const { getAuthProfileManager } = await import('../auth/profile-manager.js');
      const mgr = getAuthProfileManager();
      if (mgr.removeProfile(req.params.id)) {
        res.json({ success: true });
      } else {
        res.status(404).json({ error: 'Profile not found' });
      }
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/auth-profiles/reset', async (_req, res) => {
    try {
      const { resetAuthProfileManager, getAuthProfileManager } =
        await import('../auth/profile-manager.js');
      resetAuthProfileManager();
      const mgr = getAuthProfileManager();
      res.json({ success: true, profiles: mgr.getStatus() });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // Root endpoint
  app.get('/', (_req, res) => {
    res.json({
      name: 'Code Buddy API',
      version: SERVER_VERSION,
      docs: '/api/docs',
      health: '/api/health',
      metrics: '/api/metrics',
      cloud: '/api/cloud/tasks',
      dashboard: '/__codebuddy__/dashboard/',
      metricsDashboard: '/api/metrics/dashboard',
    });
  });

  // API docs placeholder
  app.get('/api/docs', (req, res) => {
    res.json({
      openapi: '3.0.0',
      info: {
        title: 'Code Buddy API',
        version: SERVER_VERSION,
        description: 'REST API for Code Buddy AI agent',
      },
      servers: [
        {
          url: `http://${config.host}:${config.port}`,
          description: 'Local server',
        },
      ],
      paths: {
        '/api/health': {
          get: { summary: 'Health check', tags: ['Health'] },
        },
        '/api/metrics': {
          get: { summary: 'Prometheus-compatible metrics', tags: ['Metrics'] },
        },
        '/api/metrics/json': {
          get: { summary: 'JSON format metrics', tags: ['Metrics'] },
        },
        '/api/metrics/dashboard': {
          get: { summary: 'HTML metrics dashboard', tags: ['Metrics'] },
        },
        '/api/metrics/snapshot': {
          get: { summary: 'Current metrics snapshot', tags: ['Metrics'] },
        },
        '/api/metrics/history': {
          get: { summary: 'Historical metrics data', tags: ['Metrics'] },
        },
        '/api/chat': {
          post: { summary: 'Send chat message', tags: ['Chat'] },
        },
        '/api/chat/completions': {
          post: { summary: 'OpenAI-compatible chat completions', tags: ['Chat'] },
        },
        '/api/tools': {
          get: { summary: 'List available tools', tags: ['Tools'] },
        },
        '/api/tools/{name}/execute': {
          post: { summary: 'Execute a tool', tags: ['Tools'] },
        },
        '/api/sessions': {
          get: { summary: 'List sessions', tags: ['Sessions'] },
          post: { summary: 'Create session', tags: ['Sessions'] },
        },
        '/api/memory': {
          get: { summary: 'List memory entries', tags: ['Memory'] },
          post: { summary: 'Create memory entry', tags: ['Memory'] },
        },
        '/api/workflows': {
          get: { summary: 'List all workflows', tags: ['Workflows'] },
          post: { summary: 'Create a workflow', tags: ['Workflows'] },
        },
        '/api/workflows/{id}': {
          get: { summary: 'Get workflow details', tags: ['Workflows'] },
          put: { summary: 'Update a workflow', tags: ['Workflows'] },
          delete: { summary: 'Delete a workflow', tags: ['Workflows'] },
        },
        '/api/workflows/{id}/run': {
          post: { summary: 'Execute a workflow', tags: ['Workflows'] },
        },
        '/api/workflows/{id}/status': {
          get: { summary: 'Get execution status', tags: ['Workflows'] },
        },
        '/api/workflows/validate': {
          post: { summary: 'Validate a workflow DAG (cycles, missing deps)', tags: ['Workflows'] },
        },
        '/api/workflows/{id}/optimize': {
          get: { summary: 'Run AFlow optimization on a workflow', tags: ['Workflows'] },
        },
        '/api/acp/send': {
          post: { summary: 'Send a message to an agent', tags: ['ACP'] },
        },
        '/api/acp/agents': {
          get: { summary: 'List available agents', tags: ['ACP'] },
        },
        '/api/acp/request': {
          post: { summary: 'Submit a task to an agent', tags: ['ACP'] },
        },
        '/api/acp/tasks/{id}': {
          get: { summary: 'Get task status', tags: ['ACP'] },
        },
        '/api/acp/tasks/{id}/yield': {
          post: { summary: 'Yield (pause) a task', tags: ['ACP'] },
        },
        '/api/acp/tasks/{id}/resume': {
          post: { summary: 'Resume a yielded task', tags: ['ACP'] },
        },
        '/api/acp/sessions': {
          get: { summary: 'List named sessions', tags: ['ACP'] },
          post: { summary: 'Create a named session', tags: ['ACP'] },
        },
        '/api/acp/sessions/{name}': {
          get: { summary: 'Get session with tasks', tags: ['ACP'] },
          delete: { summary: 'Delete a session', tags: ['ACP'] },
        },
        '/api/cloud/tasks': {
          get: { summary: 'List cloud background tasks', tags: ['Cloud'] },
          post: { summary: 'Submit a new cloud background task', tags: ['Cloud'] },
        },
        '/api/cloud/tasks/{id}': {
          get: { summary: 'Get cloud task status and result', tags: ['Cloud'] },
          delete: { summary: 'Delete a cloud task record', tags: ['Cloud'] },
        },
        '/api/cloud/tasks/{id}/stream': {
          get: { summary: 'SSE stream of cloud task progress', tags: ['Cloud'] },
        },
        '/api/cloud/tasks/{id}/cancel': {
          post: { summary: 'Cancel a running cloud task', tags: ['Cloud'] },
        },
        '/api/cloud/tasks/{id}/logs': {
          get: { summary: 'Get cloud task execution logs', tags: ['Cloud'] },
        },
      },
    });
  });

  // Dashboard SPA
  app.use('/__codebuddy__/dashboard', createDashboardRouter());

  // 404 handler
  app.use(notFoundHandler);

  // Error handler
  app.use(errorHandler);

  return app;
}

/** Guards the sensory layer against double-wiring on a second in-process start. */
let sensoryWired = false;
/** Teardown fns for the sensory layer (bridge close, listener unsubscribes, scheduler stop). */
let sensoryTeardown: Array<() => void | Promise<void>> = [];

/**
 * Start the server
 */
export async function startServer(userConfig: Partial<ServerConfig> = {}): Promise<{
  app: Application;
  server: HttpServer;
  config: ServerConfig;
}> {
  const mergedConfig = { ...DEFAULT_CONFIG, ...userConfig };
  const config: ServerConfig = {
    ...mergedConfig,
    jwtSecret: userConfig.jwtSecret ?? getJwtSecret(mergedConfig.authEnabled),
  };

  try {
    await initializeDatabase();
    logger.debug('Database initialized for API server');
  } catch (error) {
    logger.warn('Database initialization failed; API server will start with degraded health', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Initialize metrics collector
  initMetrics({
    consoleExport: process.env.METRICS_CONSOLE === 'true',
    fileExport: process.env.METRICS_FILE === 'true',
    filePath: process.env.METRICS_PATH,
    exportInterval: parseInt(
      process.env.METRICS_INTERVAL || String(TIMEOUT_CONFIG.DEFAULT_METRICS_INTERVAL),
      10
    ),
  });

  // Initialize Prometheus exporter for advanced analytics metrics
  try {
    const { getPrometheusExporter, createMetricsCollector } =
      await import('../analytics/prometheus-exporter.js');
    const promExporter = getPrometheusExporter({
      prefix: 'codebuddy_',
      defaultLabels: { service: 'codebuddy-server' },
    });
    createMetricsCollector(promExporter);
    logger.debug('Prometheus exporter initialized');
  } catch {
    /* prometheus exporter optional */
  }

  const app = createApp(config);
  // Optional TLS: serve the API (including /api/mobile) over HTTPS when
  // CODEBUDDY_HTTPS / CODEBUDDY_MOBILE_TLS is set so the mobile-supervision
  // endpoint can be exposed off-device securely. Default (no env) is plain HTTP,
  // byte-for-byte unchanged. resolveServerTlsOptions() throws (never silently
  // downgrades) if TLS is requested but cannot be satisfied. The https.Server
  // surface (listen/address/on('upgrade')/close) matches http.Server at runtime,
  // so we keep the `HttpServer` type to avoid widening downstream signatures.
  const tlsOptions = resolveServerTlsOptions();
  const server: HttpServer = tlsOptions
    ? (createHttpsServer(tlsOptions, app) as unknown as HttpServer)
    : createServer(app);

  const startChannelBridge = async (baseUrl: string): Promise<void> => {
    try {
      const { getChannelManager } = await import('../channels/index.js');
      const { loadChannelConfig, instantiateChannel } =
        await import('../commands/handlers/channel-handlers.js');
      const { startChannelA2ABridge } = await import('./channel-a2a-bridge.js');

      const manager = getChannelManager();
      const cfg = loadChannelConfig();
      if (!cfg || cfg.channels.length === 0) {
        logger.info(
          '[channel-a2a-bridge] no .codebuddy/channels.json found, skipping channel boot'
        );
      } else {
        for (const chCfg of cfg.channels) {
          if (!chCfg.enabled) continue;
          try {
            const channel = await instantiateChannel(chCfg);
            if (channel) {
              manager.registerChannel(channel);
              await channel.connect();
              logger.info(`[channel-a2a-bridge] ${chCfg.type} channel started`);
            }
          } catch (err) {
            logger.warn(`[channel-a2a-bridge] ${chCfg.type} failed to start`, {
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }

      const bridge = startChannelA2ABridge({
        hubBaseUrl: baseUrl,
        channelManager: manager,
        defaultSkill: process.env.A2A_BRIDGE_DEFAULT_SKILL || 'ollama-qwen3-4b',
        defaultModel: process.env.A2A_BRIDGE_DEFAULT_MODEL || 'qwen3:4b',
        defaultAgent: process.env.A2A_BRIDGE_DEFAULT_AGENT,
      });
      // Stash on the http server for graceful shutdown.
      (server as unknown as { _channelA2ABridge?: { stop: () => void } })._channelA2ABridge =
        bridge;
    } catch (err) {
      logger.warn('[channel-a2a-bridge] init failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  // Setup WebSocket if enabled
  if (config.websocketEnabled) {
    await setupWebSocket(server, config);
    logger.info('WebSocket server enabled at /ws');
    // Dedicated desktop (Cowork) endpoint for the conversational core only
    // (chat / sessions / live stream events). Speaks the Cowork ClientEvent
    // /ServerEvent protocol, auth at handshake (JWT), origin-hardened. Mounted
    // additively via a prepended `upgrade` listener so /ws stays untouched.
    await setupDesktopWebSocket(server, config);
    logger.info(`Desktop WebSocket endpoint enabled at /desktop`);
    // Phase (d).9 — start the fleet presence beacon. Periodic
    // fleet:peer:heartbeat events let remote FleetListener clients flag
    // a peer as stale when they stop arriving. Idempotent + unref'd.
    startFleetHeartbeat();
    // Hermes-style autonomous tick daemon. Wakes the proven
    // `fleet-tick-handler.runFleetTick()` (Phase (d).18) as an
    // in-process timer when `CODEBUDDY_FLEET_REPO_PATH` is set —
    // otherwise it logs `daemon inactive` and stays opt-in.
    startAutonomousTick({
      repoPath: process.env.CODEBUDDY_FLEET_REPO_PATH,
      host:
        process.env.CODEBUDDY_FLEET_HOSTNAME ||
        process.env.CODEBUDDY_FLEET_MACHINE_LABEL ||
        os.hostname(),
      intervalMs: Number(process.env.CODEBUDDY_FLEET_TICK_INTERVAL_MS) || undefined,
    });
    // /api/health apiHeartbeat — periodically pings the configured LLM
    // base URL so the dashboard shows a live latency + reachability
    // status instead of `lastCheck: null`.
    startApiHeartbeatMonitor();
    // Phase (d).10 — bridge SmartCompactionEngine lifecycle events to
    // fleet:peer:compacting:* so remote Claudes know when this peer is
    // briefly indisposed by a summarization pass.
    wireCompactionBridge();
    // Phase (d).23 — peer.tool.invoke read-only bridge. No factory
    // needed: the bridge wraps standalone executors and runs gates
    // (allowlist + fleetSafe + workspace root) per invocation.
    wirePeerToolBridge();
    // Phase (d).16a — auto-detect the peer.chat client from env
    // (priority order: ollama > grok > anthropic > gemini > openai).
    // When no key is detected, peer.chat still wires but answers
    // CLIENT_UNAVAILABLE. The providerInfo is surfaced via peer.describe
    // so remote Claudes know what they're talking to.
    (async () => {
      try {
        const { createPeerChatClientFromEnv } =
          await import('../fleet/peer-chat-client-factory.js');
        const factory = createPeerChatClientFromEnv();
        if (factory) {
          wirePeerChatBridge(() => factory.client, factory.info);
          await wirePeerSessionBridge(() => factory.client);
          logger.info(
            `[fleet] peer.chat wired: ${factory.info.provider} (${factory.info.model}${factory.info.isLocal ? ', local' : ''})`
          );
        } else {
          wirePeerChatBridge(() => null);
          await wirePeerSessionBridge(() => null);
          logger.info(
            '[fleet] peer.chat wired without provider — set GOOGLE_API_KEY / GROK_API_KEY / ... or OLLAMA_HOST to activate'
          );
        }
      } catch (err) {
        logger.warn('[fleet] peer.chat factory failed, falling back to null client', {
          error: err instanceof Error ? err.message : String(err),
        });
        wirePeerChatBridge(() => null);
        await wirePeerSessionBridge(() => null);
      }
    })().catch(() => {
      /* unhandled-rejection guard */
    });
  }

  return new Promise((resolve, reject) => {
    server.listen(config.port, config.host, async () => {
      const baseUrl = getServerBaseUrl(server, config);

      logger.info(`API Server started on ${baseUrl}`);
      logger.info(`Health: ${baseUrl}/api/health`);
      logger.info(`Metrics: ${baseUrl}/api/metrics`);
      logger.info(`Dashboard: ${baseUrl}/__codebuddy__/dashboard/`);
      logger.info(`Metrics Dashboard: ${baseUrl}/api/metrics/dashboard`);
      logger.info(`Docs: ${baseUrl}/api/docs`);
      logger.info(`WebSocket: ${config.websocketEnabled ? 'Enabled (/ws)' : 'Disabled'}`);
      // Sensory nervous-system bridge (opt-in): ingress for the Rust buddy-sense
      // daemon → internal event bus → reactions. Loopback-only.
      if (process.env.CODEBUDDY_SENSORY === 'true' && !sensoryWired) {
        sensoryWired = true; // wire once per process (a 2nd start would double listeners + re-bind the port)
        try {
          const { startSensoryBridge } = await import('../sensory/sensory-bridge.js');
          const { wireSensoryReactions } = await import('../sensory/reactions.js');
          const { getHeartbeatScheduler } = await import('../sensory/heartbeat-scheduler.js');
          const sensoryBridgeHandle = startSensoryBridge();
          const unwireReactions = wireSensoryReactions();
          sensoryTeardown.push(() => sensoryBridgeHandle.close(), unwireReactions);
          // Vision reaction (opt-in) — vision/motion → camera_analyze (local gemma).
          // Requires a shared token: a frame can trigger the webcam, so refuse to
          // wire it on an unauthenticated bridge.
          const sensoryToken = process.env.CODEBUDDY_SENSORY_TOKEN;
          // One shared response decider for the whole sensory session: the vision
          // arrival greeting opens the engagement window (markEngaged) that the
          // speech reaction's gate reads, so a greeted visitor's natural reply is
          // treated as addressed — no wake-word needed. Without this shared wiring
          // the greeting played but never opened a conversation.
          const { createResponseDecider } = await import('../sensory/respond-decider.js');
          const responseDecider = createResponseDecider();
          {
            const { shouldWireVisionReaction, wireVisionReaction } = await import('../sensory/vision-reaction.js');
            if (shouldWireVisionReaction({ camera: process.env.CODEBUDDY_SENSORY_CAMERA, token: sensoryToken })) {
              sensoryTeardown.push(wireVisionReaction());
              logger.info('Sensory vision reaction: Enabled (vision/motion → camera_analyze)');
            } else if (process.env.CODEBUDDY_SENSORY_CAMERA === 'true') {
              logger.warn('Sensory vision reaction NOT enabled: set CODEBUDDY_SENSORY_TOKEN to allow camera triggering.');
            }
            // Semantic vision events (person_entered/left, drowsy) from the vision sidecar.
            if (shouldWireVisionReaction({ camera: process.env.CODEBUDDY_SENSORY_CAMERA, token: sensoryToken })) {
              const { wireSemanticVisionReaction } = await import('../sensory/semantic-vision-reaction.js');
              sensoryTeardown.push(
                wireSemanticVisionReaction({ onEngage: () => responseDecider.markEngaged() }),
              );
              logger.info('Sensory semantic-vision reaction: Enabled (person/drowsy → alert + greet→engage)');
            }
            // Event→action rules engine (a camera event triggers code) — opt-in + token-gated,
            // since rules can run shell. Safety lives in sensory-action-executor (env-only context,
            // destructive-block). Off unless CODEBUDDY_SENSORY_RULES=true AND a token is set.
            if (process.env.CODEBUDDY_SENSORY_RULES === 'true' && sensoryToken) {
              const { wireSensoryRules } = await import('../sensory/sensory-rules-engine.js');
              sensoryTeardown.push(wireSensoryRules());
              logger.info('Sensory rules engine: Enabled (event → shell/webhook/alert/agent)');
            } else if (process.env.CODEBUDDY_SENSORY_RULES === 'true') {
              logger.warn('Sensory rules NOT enabled: set CODEBUDDY_SENSORY_TOKEN (rules can run shell).');
            }
          }
          // Screen reaction (opt-in) — also token-gated (an injected analyzer could capture the desktop).
          if (process.env.CODEBUDDY_SENSORY_SCREEN === 'true') {
            if (sensoryToken) {
              const { wireScreenReaction } = await import('../sensory/screen-reaction.js');
              sensoryTeardown.push(wireScreenReaction());
              logger.info('Sensory screen reaction: Enabled (screen/change → percept)');
            } else {
              logger.warn('Sensory screen reaction NOT enabled: set CODEBUDDY_SENSORY_TOKEN.');
            }
          }
          // Speech reaction (opt-in) — speech_end → STT → 'hearing' percept (+ onHeard hook).
          // With CODEBUDDY_SENSORY_SPEAK=true the loop closes: STT → think (local $0) → speak (Piper).
          if (process.env.CODEBUDDY_SENSORY_SPEECH === 'true') {
            const { wireSpeechReaction } = await import('../sensory/speech-reaction.js');
            if (process.env.CODEBUDDY_SENSORY_SPEAK === 'true') {
              const { makeVoiceReply, describeVoiceReadiness } = await import('../sensory/voice-loop.js');
              const readiness = describeVoiceReadiness();
              // Fail LOUD: a wired-but-silent robot looks broken. Name what to set.
              for (const w of readiness.warnings) logger.warn(`[voice] ${w}`);
              // ACT (opt-in): a spoken command drives a REAL agent turn (can edit/run) under a
              // permission posture. Default off → today's chatty companion reply.
              // Both paths use the hybrid for conversational MEMORY + persona warmth + phatic
              // short-circuit. With ACT on, a real question/command escalates to a GROUNDED agent
              // turn (reads/searches under the posture); with ACT off, everything stays a fast warm
              // reply (no heavy agent) — the same memory, none of the latency.
              const { makeHybridReply } = await import('../sensory/hybrid-reply.js');
              let replyFn;
              if (readiness.act) {
                // Grounded turn can take a few seconds → speak a short ack first so a real
                // question isn't met with silence. Optional repo cwd so it grounds on real files.
                const { sayNow } = await import('../sensory/voice-loop.js');
                const speakCwd = process.env.CODEBUDDY_SENSORY_SPEAK_CWD;
                replyFn = makeHybridReply({
                  permissionMode: (readiness.permissionMode as
                    | 'plan'
                    | 'dontAsk'
                    | 'bypassPermissions') || 'plan',
                  ...(speakCwd ? { cwd: speakCwd } : {}),
                  ack: async () => {
                    await sayNow("D'accord, je regarde ça.");
                  },
                });
              } else {
                replyFn = makeHybridReply({ classify: () => false, agentReply: async () => '' });
              }
              const reply = makeVoiceReply({ replyFn });
              // Human-like response gate: listen to everything, speak only when addressed or
              // (opt-in) when the conversation warrants it. ALWAYS_RESPOND reverts to replying
              // to every utterance. The engagement window is anchored to the last ADDRESS (the
              // decider handles it) — we deliberately do NOT refresh it per reply, or ambient
              // cross-talk after one address would make the robot answer the whole room.
              const alwaysRespond = process.env.CODEBUDDY_SENSORY_ALWAYS_RESPOND === 'true';
              const chimeIn = process.env.CODEBUDDY_SENSORY_CHIME_IN === 'true';

              // Reminder voice-ack: a spoken "c'est fait" marks a PENDING reminder done. It binds
              // only to a reminder fired in its window (safety: never from ambient speech / the
              // chime-in LLM), bypasses the silence gate, reads the bind back, and short-circuits
              // the normal reply so the robot doesn't both confirm AND chat.
              // `reply` is a VoiceReplyHandler (callable + `.interrupt()`); the wrappers below
              // replace it with plain handlers, so type onHeard by the call contract they share.
              let onHeard: (t: string) => Promise<void> = reply;
              let reminderShortcut: ((t: string) => boolean) | undefined;
              if (process.env.CODEBUDDY_REMINDERS === 'true') {
                const rem = await import('../companion/reminders.js');
                const { sayNow } = await import('../sensory/voice-loop.js');
                // A reminder voice-ack OR a voice-creation both bypass the silence gate and
                // short-circuit the normal reply (the robot confirms instead of chatting).
                reminderShortcut = (t: string) =>
                  rem.matchAck(t, Date.now()) !== null ||
                  rem.isSnoozeCommand(t, Date.now()) ||
                  rem.isUndoCommand(t, Date.now()) ||
                  rem.isReminderVoiceCommand(t) ||
                  rem.parseVoiceReminder(t) !== null;
                onHeard = async (t: string) => {
                  // Spoken undo FIRST: a bare "annule" right after a creation reverts it (the
                  // confirm-and-await flow, ambient-style — the confirmation read the cadence
                  // back, the correction stays natural speech). Window-bounded, so it never
                  // hijacks an "annule" said minutes later in conversation.
                  const undone = rem.undoPending(t, Date.now());
                  if (undone) {
                    await rem.removeReminder(undone.id);
                    await sayNow(`OK, j'annule le rappel : ${undone.label}.`);
                    return;
                  }
                  // Snooze a pending reminder ("dans 10 minutes" / "plus tard") before anything else.
                  const snoozed = rem.snoozePending(t, Date.now());
                  if (snoozed) {
                    const mins = Math.max(1, Math.round(snoozed.delayMs / 60_000));
                    await sayNow(`D'accord, je te le rappelle dans ${mins} minute${mins > 1 ? 's' : ''}.`);
                    return;
                  }
                  const id = rem.matchAck(t, Date.now());
                  if (id) {
                    const done = await rem.markDone(id, 'voice');
                    if (done) await sayNow(rem.reminderReadback(done.label));
                    return;
                  }
                  // Manage reminders by voice (list / remove / disable) BEFORE create, so
                  // "supprime le rappel du train" isn't misread as a new reminder.
                  if (await rem.handleReminderVoiceCommand(t, { speak: sayNow })) return;
                  const created = rem.parseVoiceReminder(t);
                  if (created) {
                    try {
                      const r = await rem.addReminder(created);
                      // Arm the spoken undo: a bare "annule" within the window reverts THIS creation.
                      rem.noteCreatedForUndo(r, Date.now());
                      // Read back the CADENCE ("demain" / "tous les jours") so a mis-captured
                      // recurrence is audible on the spot (the train-bug class of confusion).
                      await sayNow(`C'est noté : ${r.label}, ${rem.reminderCadencePhrase(r)} à ${r.time}.`);
                    } catch (err) {
                      logger.warn(`[reminders] voice create failed: ${err instanceof Error ? err.message : String(err)}`);
                    }
                    return;
                  }
                  await reply(t);
                };
              }

              // Event follow-ups (opt-in): when Patrice mentions a dated future event IN a real
              // conversation with Lisa, capture it and confirm aloud so a mis-hear is corrected on
              // the spot; the presence loop later asks how it went. Capture runs AFTER the reply and
              // fire-and-forget so it never adds reply latency, and is skipped for reminder commands
              // (those are handled above and would otherwise double as a "future event").
              if (process.env.CODEBUDDY_COMPANION_EVENT_FOLLOWUPS === 'true') {
                const ef = await import('../companion/event-followups.js');
                const { sayNow } = await import('../sensory/voice-loop.js');
                const extractor = ef.makeLLMEventExtractor();
                const inner = onHeard;
                onHeard = async (t: string) => {
                  await inner(t);
                  if (reminderShortcut?.(t)) return;
                  void (async () => {
                    try {
                      const captured = await ef.captureEventFollowUp(t, Date.now(), { extractor });
                      if (captured) {
                        await sayNow(ef.confirmationLine(captured, Date.now()));
                        logger.info(`[event-followup] captured "${captured.event}" → due ${new Date(captured.dueAt).toISOString()}`);
                      }
                    } catch (err) {
                      logger.warn(`[event-followup] capture failed: ${err instanceof Error ? err.message : String(err)}`);
                    }
                  })();
                };
                logger.info('Event follow-ups: Enabled (CODEBUDDY_COMPANION_EVENT_FOLLOWUPS) — capture dated events from conversation, ask how they went');
              }

              const wireOpts: Parameters<typeof wireSpeechReaction>[0] = { onHeard };
              if (!alwaysRespond) {
                // Reuse the session decider shared with the vision greeting above, so a
                // person-arrival greeting's open engagement window carries into this gate.
                wireOpts.shouldRespond = (t) =>
                  reminderShortcut?.(t)
                    ? Promise.resolve({ respond: true, reason: 'reminder' })
                    : responseDecider.decide(t);
              }
              sensoryTeardown.push(wireSpeechReaction(wireOpts));
              const gateLabel = alwaysRespond
                ? 'always-respond'
                : chimeIn
                  ? 'gate[addressed+greeting+chime-in]'
                  : 'gate[addressed+greeting]';
              logger.info(
                `Sensory speech reaction: Enabled (speech_end → STT → ${
                  gateLabel
                } → ${readiness.act ? `agent[${readiness.permissionMode}]` : `think[${readiness.model}]`} → speak` +
                  `${readiness.speakReady ? `[${readiness.voice}]` : ' — SILENT until CODEBUDDY_TTS_VOICE is set'})`,
              );
            } else {
              sensoryTeardown.push(wireSpeechReaction());
              logger.info('Sensory speech reaction: Enabled (speech_end → STT → percept)');
            }
          }
          // Privacy: camera/screen descriptions land in percepts.jsonl — warn if not encrypted at rest.
          if (
            (process.env.CODEBUDDY_SENSORY_CAMERA === 'true' || process.env.CODEBUDDY_SENSORY_SCREEN === 'true') &&
            !process.env.CODEBUDDY_COMPANION_ENCRYPTION_KEY &&
            !process.env.CODEBUDDY_MEMORY_KEY
          ) {
            logger.warn('Sensory camera/screen percepts are written UNENCRYPTED — set CODEBUDDY_COMPANION_ENCRYPTION_KEY to encrypt scene/screen descriptions at rest.');
          }
          // Heartbeat pacemaker — heartbeats trigger periodic processing (every N beats).
          const heart = getHeartbeatScheduler();
          const everyBeats = Math.max(1, Number(process.env.CODEBUDDY_HEARTBEAT_EVERY ?? 10));
          heart.register({
            name: 'pacemaker-tick',
            everyBeats,
            handler: (ctx) => logger.info(`[heartbeat] pacemaker tick — beat ${ctx.beat} (load ${ctx.load1 ?? '?'})`),
          });
          // Dreaming — consolidate short-term sensory memory every N beats.
          const dreamEvery = Math.max(1, Number(process.env.CODEBUDDY_DREAM_EVERY ?? 30));
          heart.register({
            name: 'dreaming',
            everyBeats: dreamEvery,
            handler: async () => {
              const { runDreamingPass } = await import('../sensory/dreaming.js');
              await runDreamingPass();
            },
          });
          // Episodic journal (opt-in) — consolidate the heard DIALOGUE into "what we talked about"
          // so the arrival opener / follow-ups can reference it. Distinct from dreaming (sensor stats).
          if (process.env.CODEBUDDY_EPISODE_JOURNAL === 'true') {
            const episodeEvery = Math.max(1, Number(process.env.CODEBUDDY_EPISODE_EVERY ?? 40));
            heart.register({
              name: 'episodic-journal',
              everyBeats: episodeEvery,
              handler: async () => {
                const { runEpisodeConsolidation } = await import('../sensory/episodic-journal.js');
                await runEpisodeConsolidation();
              },
            });
            logger.info(`Episodic journal: Enabled (CODEBUDDY_EPISODE_JOURNAL) — dialogue consolidation every ${episodeEvery} beats`);
          }
          // Voice-assistant improvement loop (opt-in, MySoulmate-inspired) — reflect on recent
          // dialogue and adapt over time: learned reply-guidance + bounded trait drift (behavioral
          // mode; never auto-accepts personal facts — those stay pending for `buddy assistant improve --apply`).
          if (process.env.CODEBUDDY_VOICE_IMPROVE === 'true') {
            const improveEvery = Math.max(1, Number(process.env.CODEBUDDY_VOICE_IMPROVE_EVERY ?? 60));
            heart.register({
              name: 'voice-improvement',
              everyBeats: improveEvery,
              handler: async () => {
                const { runVoiceImprovementCycle } = await import('../companion/voice-improvement-loop.js');
                await runVoiceImprovementCycle({ mode: 'behavioral' });
              },
            });
            logger.info(`Voice improvement loop: Enabled (CODEBUDDY_VOICE_IMPROVE) — reflect + adapt every ${improveEvery} beats (behavioral; facts stay pending)`);
          }
          heart.start();
          sensoryTeardown.push(() => heart.stop());
          logger.info(`Sensory bridge: Enabled (buddy-sense → event bus; heartbeat treatments every ${everyBeats} beats)`);
        } catch (err) {
          logger.warn(`Sensory bridge failed to start: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      // Reminders (opt-in, independent of the sensory daemon so Telegram delivery works without a
      // mic/camera): a tick loop announces due reminders (voice + Telegram) and escalates a missed
      // dose to Telegram. Voice acknowledgement ("c'est fait") is wired in the speech block above.
      if (process.env.CODEBUDDY_REMINDERS === 'true') {
        try {
          const { wireReminderRunner } = await import('../companion/reminder-runner.js');
          sensoryTeardown.push(wireReminderRunner());
          logger.info(
            'Reminders: Enabled (CODEBUDDY_REMINDERS) — due reminders announced (voice + Telegram); no-ack → re-nag then Telegram',
          );
        } catch (err) {
          logger.warn(`Reminders failed to start: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      // Companion presence (opt-in): the conductor that occasionally says one small warm thing when
      // the moment warrants (check-in / debrief / encouragement / break) and is otherwise silent.
      // Hard-gated (quiet hours, presence-aware, hourly cap) — see presence-loop.ts.
      if (process.env.CODEBUDDY_COMPANION_PRESENCE === 'true') {
        try {
          const { wirePresenceLoop } = await import('../companion/presence-loop.js');
          sensoryTeardown.push(wirePresenceLoop());
          logger.info('Companion presence: Enabled (CODEBUDDY_COMPANION_PRESENCE) — gentle proactive presence, default-silent');
        } catch (err) {
          logger.warn(`Companion presence failed to start: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      // Companion proactive (opt-in): Lisa reaches out FIRST — morning/evening, after an absence, on
      // a tenure milestone or a due follow-up — INDEPENDENT of the camera (Telegram voice note when
      // away, spoken when present). Priority-scored, single winner, 12h cooldown. See proactive-engine.ts.
      if (process.env.CODEBUDDY_COMPANION_PROACTIVE === 'true') {
        try {
          const { wireProactiveLoop } = await import('../companion/proactive-engine.js');
          sensoryTeardown.push(wireProactiveLoop());
          logger.info('Companion proactive: Enabled (CODEBUDDY_COMPANION_PROACTIVE) — reaches out first, camera-independent (spoken/Telegram)');
        } catch (err) {
          logger.warn(`Companion proactive failed to start: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      // Companion idle (opt-in): when ALONE, it does useful safe work ($0, read-only/reversible) and
      // leaves reviewable artifacts in the idle log — never acts on your repos/prod. See idle-loop.ts.
      if (process.env.CODEBUDDY_COMPANION_IDLE === 'true') {
        try {
          const { wireIdleLoop } = await import('../companion/idle-loop.js');
          sensoryTeardown.push(wireIdleLoop());
          logger.info('Companion idle: Enabled (CODEBUDDY_COMPANION_IDLE) — alone-only useful work, $0, artifacts only');
        } catch (err) {
          logger.warn(`Companion idle failed to start: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      logger.info(`Auth: ${config.authEnabled ? 'Enabled' : 'Disabled'}`);
      if (!isLoopbackHost(config.host)) {
        logger.warn(
          `Server is bound to ${config.host} (non-loopback) and is reachable from the network. ` +
            `Auth is ${config.authEnabled ? 'ENABLED' : 'DISABLED'}; CORS origins: ${[config.corsOrigins ?? []].flat().join(', ') || '(none)'}. ` +
            `Bind to localhost with HOST=127.0.0.1 if remote access is not intended.`,
        );
      }
      logger.info(
        `Rate Limit: ${config.rateLimit ? `${config.rateLimitMax} req/${config.rateLimitWindow / 1000}s` : 'Disabled'}`
      );
      logger.info(
        `Security Headers: ${config.securityHeaders?.enabled !== false ? 'Enabled (CSP, X-Frame-Options, HSTS, etc.)' : 'Disabled'}`
      );

      if (config.websocketEnabled) {
        // Channel -> A2A bridge needs the actual bound port when callers use
        // port 0 for ephemeral smoke/integration servers.
        startChannelBridge(baseUrl).catch(() => {
          /* unhandled-rejection guard */
        });
      }

      // Inbound channel intake (GAP-7): start enabled channels + wire the AI
      // receiver loop so two-way messaging works without `buddy channels start`.
      // Opt-in via CODEBUDDY_SERVER_CHANNEL_INTAKE to avoid surprise connections.
      if (config.channelIntakeEnabled) {
        try {
          const { startConfiguredChannels } =
            await import('../commands/handlers/channel-handlers.js');
          const result = await startConfiguredChannels();
          if (result.noConfig) {
            logger.info('Channel intake: enabled but no channels.json found — nothing started');
          } else {
            logger.info(
              `Channel intake: started ${result.registered.length} channel(s)` +
                `${result.registered.length ? ` (${result.registered.join(', ')})` : ''}` +
                `${result.skipped.length ? `; skipped disabled: ${result.skipped.join(', ')}` : ''}` +
                `${result.failed.length ? `; failed: ${result.failed.map((f) => f.type).join(', ')}` : ''}`
            );
          }
        } catch (err) {
          logger.error('Channel intake failed to start', err as Error);
        }
      }

      // Log peer routing stats
      try {
        const peerRouter = await getPeerRouter();
        const routeStats = peerRouter.getStats();
        logger.info(
          `Peer Routing: ${routeStats.totalRoutes} routes (${routeStats.activeRoutes} active)`
        );
      } catch {
        logger.info('Peer Routing: not initialized');
      }

      resolve({ app, server, config });
    });

    server.on('error', reject);
  });
}

/**
 * Stop the server gracefully
 */
export async function stopServer(server: HttpServer): Promise<void> {
  // Tear down the sensory layer (WS bridge, bus listeners, heartbeat scheduler) so
  // an in-process restart doesn't leak listeners or EADDRINUSE the bridge port.
  for (const teardown of sensoryTeardown.splice(0)) {
    try {
      await teardown();
    } catch {
      /* never throw on shutdown */
    }
  }
  sensoryWired = false;
  return new Promise((resolve, reject) => {
    // Phase (d).9 — cancel the heartbeat timer so it doesn't keep
    // emitting against a half-shut server. Idempotent.
    stopFleetHeartbeat();
    // Stop the autonomous tick daemon (no-op when never started).
    stopAutonomousTick();
    stopApiHeartbeatMonitor();
    // Phase (d).10 — detach the compaction-event bridge so the
    // SmartCompactionEngine doesn't retain dangling listener refs.
    unwireCompactionBridge();
    // Phase (d).15 — un-register peer.chat method.
    unwirePeerChatBridge();
    // Phase (d).20 — un-register peer.chat-session.* methods.
    unwirePeerSessionBridge();
    // Phase (d).23 — un-register peer.tool.invoke + .stream.
    unwirePeerToolBridge();

    // Detach the channel-A2A bridge handler + shut down the
    // ChannelManager so polling loops (Telegram, Discord, ...) stop.
    const bridgeStop = (server as unknown as { _channelA2ABridge?: { stop: () => void } })
      ._channelA2ABridge;
    if (bridgeStop) {
      try {
        bridgeStop.stop();
      } catch {
        /* ignore */
      }
    }
    void (async () => {
      try {
        const { getChannelManager } = await import('../channels/index.js');
        await getChannelManager().shutdown();
      } catch {
        /* shutdown is best-effort */
      }
    })();

    // Close WebSocket connections
    closeAllConnections();
    // Tear down the desktop endpoint (detaches its upgrade listener + closes sockets).
    closeDesktopWebSocket();

    // Close HTTP server
    server.close((err) => {
      if (err) {
        reject(err);
      } else {
        logger.info('Server stopped');
        resolve();
      }
    });
  });
}

/**
 * Get server stats
 */
export function getServerStats(server: HttpServer): {
  connections: ReturnType<typeof getConnectionStats>;
  listening: boolean;
} {
  return {
    connections: getConnectionStats(),
    listening: server.listening,
  };
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  startServer().catch((error) => {
    logger.error('Failed to start server', error as Error);
    process.exit(1);
  });
}

export { DEFAULT_CONFIG };
export type { ServerConfig };
