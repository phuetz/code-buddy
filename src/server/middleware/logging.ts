/**
 * Logging Middleware
 *
 * Request/response logging for the API server.
 */

import type { Request, Response, NextFunction } from 'express';
import type { ServerConfig } from '../types.js';
import { logger } from '../../utils/logger.js';

interface LogEntry {
  timestamp: string;
  requestId: string;
  method: string;
  path: string;
  query: Record<string, unknown>;
  ip: string;
  userAgent: string;
  authType?: string;
  userId?: string;
  statusCode: number;
  responseTime: number;
  contentLength?: number;
  error?: string;
}

// Request stats tracking
const requestStats = {
  total: 0,
  byEndpoint: new Map<string, number>(),
  byStatus: new Map<number, number>(),
  errors: 0,
  totalLatency: 0,
  startTime: Date.now(),
};

/**
 * Format log entry for console output
 */
function formatLogEntry(entry: LogEntry): string {
  const statusColor = entry.statusCode >= 500
    ? '\x1b[31m' // Red
    : entry.statusCode >= 400
    ? '\x1b[33m' // Yellow
    : '\x1b[32m'; // Green

  const reset = '\x1b[0m';

  const parts = [
    `[${entry.timestamp}]`,
    `[${entry.requestId}]`,
    entry.method.padEnd(7),
    entry.path,
    `${statusColor}${entry.statusCode}${reset}`,
    `${entry.responseTime}ms`,
  ];

  if (entry.userId) {
    parts.push(`user:${entry.userId}`);
  }

  if (entry.error) {
    parts.push(`error:${entry.error}`);
  }

  return parts.join(' ');
}

/**
 * Create logging middleware
 */
export function createLoggingMiddleware(config: ServerConfig) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!config.logging) {
      return next();
    }

    const startTime = Date.now();
    const requestId = req.headers['x-request-id'] as string || 'unknown';

    // Log on response finish
    res.on('finish', () => {
      const responseTime = Date.now() - startTime;
      const contentLength = res.getHeader('content-length');

      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        requestId,
        method: req.method,
        path: req.path,
        query: req.query as Record<string, unknown>,
        ip: req.ip || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
        authType: req.auth?.type,
        userId: req.auth?.userId || req.auth?.keyId,
        statusCode: res.statusCode,
        responseTime,
        contentLength: contentLength ? parseInt(contentLength as string, 10) : undefined,
      };

      // Track error if present
      if (res.statusCode >= 400) {
        entry.error = res.statusMessage;
      }

      // Update stats
      requestStats.total++;
      requestStats.totalLatency += responseTime;

      const endpoint = `${req.method} ${req.route?.path || req.path}`;
      requestStats.byEndpoint.set(
        endpoint,
        (requestStats.byEndpoint.get(endpoint) || 0) + 1
      );
      requestStats.byStatus.set(
        res.statusCode,
        (requestStats.byStatus.get(res.statusCode) || 0) + 1
      );

      if (res.statusCode >= 500) {
        requestStats.errors++;
      }

      // Log to console
      logger.info(formatLogEntry(entry));
    });

    next();
  };
}

/**
 * Get request statistics
 */
export function getRequestStats(): {
  total: number;
  errors: number;
  averageLatency: number;
  uptime: number;
  byEndpoint: Record<string, number>;
  byStatus: Record<string, number>;
} {
  return {
    total: requestStats.total,
    errors: requestStats.errors,
    averageLatency: requestStats.total > 0
      ? Math.round(requestStats.totalLatency / requestStats.total)
      : 0,
    uptime: Math.floor((Date.now() - requestStats.startTime) / 1000),
    byEndpoint: Object.fromEntries(requestStats.byEndpoint),
    byStatus: Object.fromEntries(
      Array.from(requestStats.byStatus.entries()).map(([k, v]) => [k.toString(), v])
    ),
  };
}

/**
 * Reset request statistics
 */
export function resetRequestStats(): void {
  requestStats.total = 0;
  requestStats.errors = 0;
  requestStats.totalLatency = 0;
  requestStats.byEndpoint.clear();
  requestStats.byStatus.clear();
  requestStats.startTime = Date.now();
}

/**
 * JSON logging format (for production)
 */
export function createJsonLoggingMiddleware(config: ServerConfig) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!config.logging) {
      return next();
    }

    const startTime = Date.now();

    res.on('finish', () => {
      const entry = {
        timestamp: new Date().toISOString(),
        level: res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
        request: {
          id: req.headers['x-request-id'],
          method: req.method,
          path: req.path,
          query: Object.keys(req.query).length > 0 ? req.query : undefined,
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        },
        response: {
          statusCode: res.statusCode,
          responseTime: Date.now() - startTime,
          contentLength: res.getHeader('content-length'),
        },
        auth: req.auth ? {
          type: req.auth.type,
          userId: req.auth.userId || req.auth.keyId,
        } : undefined,
      };

      logger.debug('API Request', entry);
    });

    next();
  };
}
