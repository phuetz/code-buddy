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
import express, { Application } from 'express';
import cors from 'cors';
import { createServer, Server as HttpServer } from 'http';
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
import type { InboundMessage } from '../channels/index.js';

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
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  cors: true,
  corsOrigins: process.env.CORS_ORIGINS?.split(',') || ['*'],
  rateLimit: true,
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
  rateLimitWindow: parseInt(process.env.RATE_LIMIT_WINDOW || '60000', 10),
  authEnabled: process.env.AUTH_ENABLED !== 'false',
  jwtSecret: getJwtSecret(),
  jwtExpiration: process.env.JWT_EXPIRATION || '24h',
  websocketEnabled: process.env.WS_ENABLED !== 'false',
  logging: process.env.LOGGING !== 'false',
  maxRequestSize: process.env.MAX_REQUEST_SIZE || '10mb',
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
    app.use(cors({
      origin: config.corsOrigins?.includes('*') ? true : config.corsOrigins,
      credentials: true,
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
    const router = await getPeerRouter();
    res.json(router.getStats());
  });

  // Peer route resolution endpoint (for testing/debugging)
  app.post('/api/routing/resolve', async (req, res) => {
    const message = req.body.message as InboundMessage | undefined;
    const accountId = req.body.accountId as string | undefined;

    if (!message) {
      res.status(400).json({ error: 'message is required in request body' });
      return;
    }

    const router = await getPeerRouter();
    const resolved = router.resolve(message, accountId);
    res.json({ resolved });
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
      if (!name || !agentMessage) {
        res.status(400).json({ error: 'name and agentMessage are required' });
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

  // Root endpoint
  app.get('/', (_req, res) => {
    res.json({
      name: 'Code Buddy API',
      version: process.env.npm_package_version || '1.0.0',
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
        version: '1.0.0',
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
    exportInterval: parseInt(process.env.METRICS_INTERVAL || '60000', 10),
  });

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
