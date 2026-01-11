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

import express, { Application } from 'express';
import cors from 'cors';
import { createServer, Server as HttpServer } from 'http';
import type { ServerConfig } from './types.js';
import {
  createAuthMiddleware,
  createRateLimitMiddleware,
  createLoggingMiddleware,
  requestIdMiddleware,
  errorHandler,
  notFoundHandler,
} from './middleware/index.js';
import { chatRoutes, toolsRoutes, sessionsRoutes, memoryRoutes, healthRoutes } from './routes/index.js';
import { setupWebSocket, closeAllConnections, getConnectionStats } from './websocket/index.js';
import { logger } from '../utils/logger.js';

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
  return require('crypto').randomBytes(64).toString('hex');
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

  // API routes
  app.use('/api/chat', chatRoutes);
  app.use('/api/tools', toolsRoutes);
  app.use('/api/sessions', sessionsRoutes);
  app.use('/api/memory', memoryRoutes);

  // OpenAI-compatible alias
  app.use('/v1/chat', chatRoutes);

  // Root endpoint
  app.get('/', (req, res) => {
    res.json({
      name: 'Code Buddy API',
      version: process.env.npm_package_version || '1.0.0',
      docs: '/api/docs',
      health: '/api/health',
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

  const app = createApp(config);
  const server = createServer(app);

  // Setup WebSocket if enabled
  if (config.websocketEnabled) {
    await setupWebSocket(server, config);
    logger.info('WebSocket server enabled at /ws');
  }

  return new Promise((resolve, reject) => {
    server.listen(config.port, config.host, () => {
      logger.info(`API Server started on http://${config.host}:${config.port}`);
      logger.info(`Health: http://${config.host}:${config.port}/api/health`);
      logger.info(`Docs: http://${config.host}:${config.port}/api/docs`);
      logger.info(`WebSocket: ${config.websocketEnabled ? 'Enabled (/ws)' : 'Disabled'}`);
      logger.info(`Auth: ${config.authEnabled ? 'Enabled' : 'Disabled'}`);
      logger.info(`Rate Limit: ${config.rateLimit ? `${config.rateLimitMax} req/${config.rateLimitWindow / 1000}s` : 'Disabled'}`);

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
