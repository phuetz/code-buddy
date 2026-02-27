/**
 * Rate Limiting Middleware
 *
 * Implements sliding window rate limiting with support for:
 * - Global rate limits
 * - Per-key rate limits
 * - Per-endpoint rate limits
 * - Route-based configuration
 */

import type { Request, Response, NextFunction } from 'express';
import type { ServerConfig, RouteRateLimitConfig as _RouteRateLimitConfig } from '../types.js';
import { API_ERRORS } from '../types.js';
import { TIMEOUT_CONFIG, LIMIT_CONFIG } from '../../config/constants.js';

interface RateLimitEntry {
  count: number;
  resetAt: number;
  requests: number[];
}

/**
 * Configuration for route-based rate limiting
 */
export interface RateLimitOptions {
  /** Maximum requests allowed in the window */
  maxRequests: number;
  /** Time window in milliseconds */
  windowMs: number;
  /** Optional key prefix for store isolation */
  keyPrefix?: string;
  /** Skip rate limiting for certain conditions */
  skip?: (req: Request) => boolean;
  /** Custom key generator */
  keyGenerator?: (req: Request) => string;
  /** Custom handler for rate limit exceeded */
  handler?: (req: Request, res: Response, next: NextFunction, retryAfter: number) => void;
}

/**
 * Default rate limit configurations by route prefix
 */
export const DEFAULT_ROUTE_LIMITS: Record<string, RateLimitOptions> = {
  '/api/': {
    maxRequests: LIMIT_CONFIG.DEFAULT_RATE_LIMIT_MAX,
    windowMs: TIMEOUT_CONFIG.DEFAULT_RATE_LIMIT_WINDOW,
    keyPrefix: 'api',
  },
  '/auth/': {
    maxRequests: LIMIT_CONFIG.AUTH_RATE_LIMIT_MAX,
    windowMs: TIMEOUT_CONFIG.DEFAULT_RATE_LIMIT_WINDOW,
    keyPrefix: 'auth',
  },
  '/v1/': {
    maxRequests: LIMIT_CONFIG.DEFAULT_RATE_LIMIT_MAX,
    windowMs: TIMEOUT_CONFIG.DEFAULT_RATE_LIMIT_WINDOW,
    keyPrefix: 'v1',
  },
};

// In-memory store for rate limits with max size to prevent unbounded growth
const MAX_RATE_LIMIT_ENTRIES = LIMIT_CONFIG.MAX_RATE_LIMIT_ENTRIES;
const rateLimitStore = new Map<string, RateLimitEntry>();

// Cleanup old entries periodically + evict oldest if over max size
const rateLimitCleanupTimer = setInterval(() => {
  const now = Date.now();
  const expiredKeys: string[] = [];
  for (const [key, entry] of rateLimitStore) {
    if (entry.resetAt < now) {
      expiredKeys.push(key);
    }
  }
  for (const key of expiredKeys) {
    rateLimitStore.delete(key);
  }
  // LRU eviction: if still over max, remove oldest entries (Map preserves insertion order)
  if (rateLimitStore.size > MAX_RATE_LIMIT_ENTRIES) {
    const excess = rateLimitStore.size - MAX_RATE_LIMIT_ENTRIES;
    const keysToRemove = Array.from(rateLimitStore.keys()).slice(0, excess);
    for (const key of keysToRemove) {
      rateLimitStore.delete(key);
    }
  }
}, TIMEOUT_CONFIG.RATE_LIMIT_CLEANUP_INTERVAL);
rateLimitCleanupTimer.unref();

/**
 * Get rate limit key for request
 */
function getRateLimitKey(req: Request, prefix?: string): string {
  let baseKey: string;

  // Use API key ID if authenticated
  if (req.auth?.keyId) {
    baseKey = `key:${req.auth.keyId}`;
  } else if (req.auth?.userId) {
    // Use user ID if authenticated
    baseKey = `user:${req.auth.userId}`;
  } else {
    // Fall back to IP address
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    baseKey = `ip:${ip}`;
  }

  return prefix ? `${prefix}:${baseKey}` : baseKey;
}

/**
 * Find matching route configuration for a request path
 */
function findRouteConfig(
  path: string,
  routeLimits: Record<string, RateLimitOptions>
): RateLimitOptions | null {
  // Sort by prefix length (longest first) for most specific match
  const sortedPrefixes = Object.keys(routeLimits).sort((a, b) => b.length - a.length);

  for (const prefix of sortedPrefixes) {
    if (path.startsWith(prefix)) {
      return routeLimits[prefix];
    }
  }

  return null;
}

/**
 * Set standard rate limit response headers
 */
function setRateLimitHeaders(
  res: Response,
  limit: number,
  remaining: number,
  resetAt: number
): void {
  res.setHeader('X-RateLimit-Limit', limit.toString());
  res.setHeader('X-RateLimit-Remaining', Math.max(0, remaining).toString());
  res.setHeader('X-RateLimit-Reset', Math.ceil(resetAt / 1000).toString());
  res.setHeader('X-RateLimit-Reset-After', Math.ceil((resetAt - Date.now()) / 1000).toString());
}

/**
 * Apply rate limiting using sliding window algorithm
 */
function applyRateLimit(
  req: Request,
  res: Response,
  store: Map<string, RateLimitEntry>,
  options: RateLimitOptions
): { allowed: boolean; entry: RateLimitEntry; retryAfter: number } {
  const key = options.keyGenerator
    ? options.keyGenerator(req)
    : getRateLimitKey(req, options.keyPrefix);

  const now = Date.now();
  const windowStart = now - options.windowMs;

  let entry = store.get(key);

  if (!entry) {
    entry = {
      count: 0,
      resetAt: now + options.windowMs,
      requests: [],
    };
    store.set(key, entry);
  }

  // Sliding window: remove requests outside the window
  entry.requests = entry.requests.filter((t) => t > windowStart);
  entry.count = entry.requests.length;

  // Update reset time if window has passed
  if (entry.resetAt < now) {
    entry.resetAt = now + options.windowMs;
  }

  const retryAfter = Math.ceil((entry.resetAt - now) / 1000);

  // Check if limit exceeded
  if (entry.count >= options.maxRequests) {
    return { allowed: false, entry, retryAfter };
  }

  // Add current request
  entry.requests.push(now);
  entry.count++;

  return { allowed: true, entry, retryAfter };
}

/**
 * Create rate limiting middleware with route-based configuration
 */
export function createRateLimitMiddleware(config: ServerConfig) {
  // Merge default route limits with any custom configuration
  const routeLimits: Record<string, RateLimitOptions> = {
    ...DEFAULT_ROUTE_LIMITS,
    ...(config.routeRateLimits || {}),
  };

  return (req: Request, res: Response, next: NextFunction) => {
    // Skip if rate limiting disabled
    if (!config.rateLimit) {
      return next();
    }

    // Find route-specific configuration
    const routeConfig = findRouteConfig(req.path, routeLimits);

    // Use route-specific limits or fall back to global config
    const options: RateLimitOptions = routeConfig || {
      maxRequests: config.rateLimitMax,
      windowMs: config.rateLimitWindow,
      keyPrefix: 'global',
    };

    // Check if should skip
    if (options.skip && options.skip(req)) {
      return next();
    }

    const { allowed, entry, retryAfter } = applyRateLimit(
      req,
      res,
      rateLimitStore,
      options
    );

    // Set headers
    setRateLimitHeaders(
      res,
      options.maxRequests,
      options.maxRequests - entry.count,
      entry.resetAt
    );

    if (!allowed) {
      res.setHeader('Retry-After', retryAfter.toString());

      // Use custom handler if provided
      if (options.handler) {
        return options.handler(req, res, next, retryAfter);
      }

      return res.status(429).json({
        ...API_ERRORS.RATE_LIMITED,
        details: {
          limit: options.maxRequests,
          windowMs: options.windowMs,
          retryAfter,
          route: routeConfig ? req.path : 'global',
        },
      });
    }

    return next();
  };
}

/**
 * Create endpoint-specific rate limit middleware
 */
export function endpointRateLimit(maxRequests: number, windowMs: number) {
  const store = new Map<string, RateLimitEntry>();

  return (req: Request, res: Response, next: NextFunction) => {
    const options: RateLimitOptions = {
      maxRequests,
      windowMs,
      keyPrefix: `endpoint:${req.path}`,
    };

    const { allowed, entry, retryAfter } = applyRateLimit(req, res, store, options);

    // Set headers
    setRateLimitHeaders(res, maxRequests, maxRequests - entry.count, entry.resetAt);

    if (!allowed) {
      res.setHeader('Retry-After', retryAfter.toString());

      return res.status(429).json({
        ...API_ERRORS.RATE_LIMITED,
        message: `Endpoint rate limit exceeded. Try again in ${retryAfter}s`,
        details: {
          endpoint: req.path,
          limit: maxRequests,
          windowMs,
          retryAfter,
        },
      });
    }

    return next();
  };
}

/**
 * Create a rate limiter for a specific route prefix
 * Useful for applying different limits to different route groups
 *
 * @example
 * // 10 requests per minute for auth routes
 * app.use('/auth', createRouteRateLimiter({ maxRequests: 10, windowMs: 60000 }));
 *
 * // 100 requests per minute for API routes
 * app.use('/api', createRouteRateLimiter({ maxRequests: 100, windowMs: 60000 }));
 */
export function createRouteRateLimiter(options: RateLimitOptions) {
  const store = new Map<string, RateLimitEntry>();

  return (req: Request, res: Response, next: NextFunction) => {
    // Check if should skip
    if (options.skip && options.skip(req)) {
      return next();
    }

    const { allowed, entry, retryAfter } = applyRateLimit(req, res, store, options);

    // Set headers
    setRateLimitHeaders(
      res,
      options.maxRequests,
      options.maxRequests - entry.count,
      entry.resetAt
    );

    if (!allowed) {
      res.setHeader('Retry-After', retryAfter.toString());

      // Use custom handler if provided
      if (options.handler) {
        return options.handler(req, res, next, retryAfter);
      }

      return res.status(429).json({
        ...API_ERRORS.RATE_LIMITED,
        message: `Rate limit exceeded. Try again in ${retryAfter}s`,
        details: {
          limit: options.maxRequests,
          windowMs: options.windowMs,
          retryAfter,
        },
      });
    }

    return next();
  };
}

/**
 * Predefined rate limiters for common use cases
 */
export const rateLimiters = {
  /** Strict limiter for auth endpoints: 10 req/min */
  auth: createRouteRateLimiter({
    maxRequests: LIMIT_CONFIG.AUTH_RATE_LIMIT_MAX,
    windowMs: TIMEOUT_CONFIG.DEFAULT_RATE_LIMIT_WINDOW,
    keyPrefix: 'auth',
  }),

  /** Standard API limiter: 100 req/min */
  api: createRouteRateLimiter({
    maxRequests: LIMIT_CONFIG.DEFAULT_RATE_LIMIT_MAX,
    windowMs: TIMEOUT_CONFIG.DEFAULT_RATE_LIMIT_WINDOW,
    keyPrefix: 'api',
  }),

  /** Relaxed limiter for read-only endpoints: 200 req/min */
  readonly: createRouteRateLimiter({
    maxRequests: LIMIT_CONFIG.READONLY_RATE_LIMIT_MAX,
    windowMs: TIMEOUT_CONFIG.DEFAULT_RATE_LIMIT_WINDOW,
    keyPrefix: 'readonly',
  }),

  /** Very strict limiter for sensitive operations: 5 req/min */
  sensitive: createRouteRateLimiter({
    maxRequests: LIMIT_CONFIG.SENSITIVE_RATE_LIMIT_MAX,
    windowMs: TIMEOUT_CONFIG.DEFAULT_RATE_LIMIT_WINDOW,
    keyPrefix: 'sensitive',
  }),
};

/**
 * Get current rate limit stats for a key
 */
export function getRateLimitStats(keyId: string): {
  used: number;
  remaining: number;
  resetAt: number;
} | null {
  const entry = rateLimitStore.get(`key:${keyId}`);
  if (!entry) {
    return null;
  }

  const now = Date.now();
  const windowStart = now - TIMEOUT_CONFIG.DEFAULT_RATE_LIMIT_WINDOW;
  const validRequests = entry.requests.filter((t) => t > windowStart);

  return {
    used: validRequests.length,
    remaining: Math.max(0, LIMIT_CONFIG.DEFAULT_RATE_LIMIT_MAX - validRequests.length),
    resetAt: entry.resetAt,
  };
}

/**
 * Reset rate limit for a key (admin function)
 */
export function resetRateLimit(keyId: string): boolean {
  return rateLimitStore.delete(`key:${keyId}`);
}

/**
 * Get all rate limit entries (admin function)
 */
export function getAllRateLimits(): Map<string, RateLimitEntry> {
  return new Map(rateLimitStore);
}
