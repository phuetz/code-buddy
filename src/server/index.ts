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
import { createRequire } from 'module';
import express, { Application } from 'express';
import cors from 'cors';
import { createServer, Server as HttpServer } from 'http';

const _require = createRequire(import.meta.url);
let SERVER_VERSION = '0.0.0';
try {
  SERVER_VERSION = _require('../../package.json').version || SERVER_VERSION;
} catch { /* ignore */ }
import type { ServerConfig } from './types.js';
import {
  createAuthMiddleware,
  createRateLimitMiddleware,
  createLoggingMiddleware,
  createSecurityHeadersMiddleware,
  requestIdMiddleware,
  errorHandler,
  notFoundHandler,
} from './middleware/index.js';
import { chatRoutes, toolsRoutes, sessionsRoutes, memoryRoutes, healthRoutes, metricsRoutes } from './routes/index.js';
import { setupWebSocket, closeAllConnections, getConnectionStats } from './websocket/index.js';
import { logger } from '../utils/logger.js';
import { initMetrics, getMetrics as _getMetrics } from '../metrics/index.js';
import { CSRFProtection } from '../security/csrf-protection.js';
import type { InboundMessage } from '../channels/index.js';
import { SERVER_CONFIG, TIMEOUT_CONFIG, LIMIT_CONFIG } from '../config/constants.js';

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
function getJwtSecret(): string {
  if (process.env.JWT_SECRET) {
    return process.env.JWT_SECRET;
  }

  // In production, require explicit JWT_SECRET
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'SECURITY ERROR: JWT_SECRET environment variable must be set in production. ' +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"'
    );
  }

  // Development only: generate ephemeral secret (warning: tokens won't persist across restarts)
  logger.warn(
    'No JWT_SECRET set. Using ephemeral secret for development. ' +
    'Set JWT_SECRET environment variable for production use.'
  );
  return crypto.randomBytes(64).toString('hex');
}

// Default configuration
const DEFAULT_CONFIG: ServerConfig = {
  port: parseInt(process.env.PORT || String(SERVER_CONFIG.DEFAULT_PORT), 10),
  host: process.env.HOST || SERVER_CONFIG.DEFAULT_HOST,
  cors: true,
  corsOrigins: process.env.CORS_ORIGINS?.split(',') || ['*'],
  rateLimit: true,
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || String(LIMIT_CONFIG.DEFAULT_RATE_LIMIT_MAX), 10),
  rateLimitWindow: parseInt(process.env.RATE_LIMIT_WINDOW || String(TIMEOUT_CONFIG.DEFAULT_RATE_LIMIT_WINDOW), 10),
  authEnabled: process.env.NODE_ENV === 'production'
    ? true  // Auth is always enabled in production (fail-closed)
    : process.env.AUTH_ENABLED !== 'false',
  jwtSecret: getJwtSecret(),
  jwtExpiration: process.env.JWT_EXPIRATION || SERVER_CONFIG.DEFAULT_JWT_EXPIRATION,
  websocketEnabled: process.env.WS_ENABLED !== 'false',
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
    app.use(cors({
      origin: isWildcard ? true : config.corsOrigins,
      credentials: !isWildcard,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Request-ID'],
    }));
  }

  // Body parsing
  app.use(express.json({ limit: config.maxRequestSize }));
  app.use(express.urlencoded({ extended: true, limit: config.maxRequestSize }));

  // Rate limiting
  if (config.rateLimit) {
    app.use(createRateLimitMiddleware(config));
  }

  // Authentication
  if (config.authEnabled) {
    app.use(createAuthMiddleware(config));
  }

  // CSRF protection for state-changing endpoints (POST/PUT/DELETE)
  if (process.env.CSRF_PROTECTION !== 'false') {
    const csrfProtection = new CSRFProtection({
      secure: process.env.NODE_ENV === 'production',
    });

    // Provide CSRF token endpoint
    app.get('/api/csrf-token', (req, res) => {
      const sessionId = (req as unknown as Record<string, unknown>).sessionId as string | undefined;
      const token = csrfProtection.generateToken(sessionId);
      res.json({ token: token.token });
    });

    // Apply CSRF middleware for state-changing requests
    app.use(csrfProtection.middleware() as express.RequestHandler);
  }

  // Health routes (no auth required)
  app.use('/api/health', healthRoutes);

  // Metrics routes (no auth required for monitoring)
  app.use('/api/metrics', metricsRoutes);

  // Also expose at /metrics for Prometheus compatibility
  app.use('/metrics', metricsRoutes);

  // API routes
  app.use('/api/chat', chatRoutes);
  app.use('/api/tools', toolsRoutes);
  app.use('/api/sessions', sessionsRoutes);
  app.use('/api/memory', memoryRoutes);

  // OpenAI-compatible alias
  app.use('/v1/chat', chatRoutes);

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
  app.get('/api/daemon/status', async (_req, res) => {
    try {
      const { getDaemonManager } = await import('../daemon/index.js');
      const manager = getDaemonManager();
      const status = await manager.status();
      res.json(status);
    } catch (error) {
      res.json({ running: false, services: [], restartCount: 0 });
    }
  });

  // Daemon health endpoint
  app.get('/api/daemon/health', async (_req, res) => {
    try {
      const { getHealthMonitor } = await import('../daemon/index.js');
      const monitor = getHealthMonitor();
      res.json(monitor.getHealthSummary());
    } catch (error) {
      res.json({ status: 'unknown', uptime: 0, memory: { percentage: 0, rss: 0 }, services: [] });
    }
  });

  // Cron jobs endpoints
  app.get('/api/cron/jobs', async (_req, res) => {
    try {
      const { getCronScheduler } = await import('../scheduler/cron-scheduler.js');
      const scheduler = getCronScheduler();
      const jobs = scheduler.listJobs();
      res.json({ jobs, stats: scheduler.getStats() });
    } catch (error) {
      res.json({ jobs: [], stats: {} });
    }
  });

  app.post('/api/cron/jobs/:id/trigger', async (req, res) => {
    try {
      const { getCronScheduler } = await import('../scheduler/cron-scheduler.js');
      const scheduler = getCronScheduler();
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
    } catch (error) {
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
  app.get('/api/heartbeat/status', async (_req, res) => {
    try {
      const { getHeartbeatEngine } = await import('../daemon/heartbeat.js');
      const engine = getHeartbeatEngine();
      res.json(engine.getStatus());
    } catch (error) {
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
      if (!profile.id || typeof profile.id !== 'string' ||
          !profile.provider || typeof profile.provider !== 'string') {
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
      const { resetAuthProfileManager, getAuthProfileManager } = await import('../auth/profile-manager.js');
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
      dashboard: '/api/metrics/dashboard',
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
      },
    });
  });

  // 404 handler
  app.use(notFoundHandler);

  // Error handler
  app.use(errorHandler);

  return app;
}

/**
 * Start the server
 */
export async function startServer(userConfig: Partial<ServerConfig> = {}): Promise<{
  app: Application;
  server: HttpServer;
  config: ServerConfig;
}> {
  const config: ServerConfig = { ...DEFAULT_CONFIG, ...userConfig };

  // Initialize metrics collector
  initMetrics({
    consoleExport: process.env.METRICS_CONSOLE === 'true',
    fileExport: process.env.METRICS_FILE === 'true',
    filePath: process.env.METRICS_PATH,
    exportInterval: parseInt(process.env.METRICS_INTERVAL || String(TIMEOUT_CONFIG.DEFAULT_METRICS_INTERVAL), 10),
  });

  // Initialize Prometheus exporter for advanced analytics metrics
  try {
    const { getPrometheusExporter, createMetricsCollector } = await import('../analytics/prometheus-exporter.js');
    const promExporter = getPrometheusExporter({
      prefix: 'codebuddy_',
      defaultLabels: { service: 'codebuddy-server' },
    });
    createMetricsCollector(promExporter);
    logger.debug('Prometheus exporter initialized');
  } catch { /* prometheus exporter optional */ }

  const app = createApp(config);
  const server = createServer(app);

  // Setup WebSocket if enabled
  if (config.websocketEnabled) {
    await setupWebSocket(server, config);
    logger.info('WebSocket server enabled at /ws');
  }

  return new Promise((resolve, reject) => {
    server.listen(config.port, config.host, async () => {
      logger.info(`API Server started on http://${config.host}:${config.port}`);
      logger.info(`Health: http://${config.host}:${config.port}/api/health`);
      logger.info(`Metrics: http://${config.host}:${config.port}/api/metrics`);
      logger.info(`Dashboard: http://${config.host}:${config.port}/api/metrics/dashboard`);
      logger.info(`Docs: http://${config.host}:${config.port}/api/docs`);
      logger.info(`WebSocket: ${config.websocketEnabled ? 'Enabled (/ws)' : 'Disabled'}`);
      logger.info(`Auth: ${config.authEnabled ? 'Enabled' : 'Disabled'}`);
      logger.info(`Rate Limit: ${config.rateLimit ? `${config.rateLimitMax} req/${config.rateLimitWindow / 1000}s` : 'Disabled'}`);
      logger.info(`Security Headers: ${config.securityHeaders?.enabled !== false ? 'Enabled (CSP, X-Frame-Options, HSTS, etc.)' : 'Disabled'}`);

      // Log peer routing stats
      try {
        const peerRouter = await getPeerRouter();
        const routeStats = peerRouter.getStats();
        logger.info(`Peer Routing: ${routeStats.totalRoutes} routes (${routeStats.activeRoutes} active)`);
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
  return new Promise((resolve, reject) => {
    // Close WebSocket connections
    closeAllConnections();

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
