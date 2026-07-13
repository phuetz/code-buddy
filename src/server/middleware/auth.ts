/**
 * Authentication Middleware
 *
 * Handles API key and JWT authentication for incoming requests.
 */

import type { Request, Response, NextFunction } from 'express';
import type { IncomingHttpHeaders } from 'http';
import { validateApiKey, hasScope as _hasScope } from '../auth/api-keys.js';
import { verifyToken } from '../auth/jwt.js';
import type { ApiScope, AuthenticatedRequest, ServerConfig } from '../types.js';
import { API_ERRORS } from '../types.js';

// Re-export for external use
export const hasScope = _hasScope;

// Extend Express Request type
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthenticatedRequest['auth'];
    }
  }
}

/**
 * Extract token from request
 */
function extractToken(req: Request): string | null {
  // Check Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader) {
    // Bearer token
    if (authHeader.startsWith('Bearer ')) {
      return authHeader.slice(7);
    }
    // Basic auth with API key
    if (authHeader.startsWith('Basic ')) {
      const decoded = Buffer.from(authHeader.slice(6), 'base64').toString();
      const [, apiKey] = decoded.split(':');
      return apiKey || null;
    }
  }

  // Check X-API-Key header
  const apiKeyHeader = req.headers['x-api-key'];
  if (apiKeyHeader && typeof apiKeyHeader === 'string') {
    return apiKeyHeader;
  }

  // SECURITY: Query parameter authentication is intentionally NOT supported.
  // API keys in query strings are a security vulnerability because they:
  // - Get logged in server access logs and proxy logs
  // - Can be cached by intermediate proxies and CDNs
  // - Appear in browser history and can be leaked via Referer headers
  // - Are visible in network monitoring tools
  // Use Authorization header (Bearer or Basic) or X-API-Key header instead.

  return null;
}

/**
 * Create authentication middleware
 */
export function createAuthMiddleware(config: ServerConfig) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Skip auth if disabled
    if (!config.authEnabled) {
      req.auth = {
        scopes: ['admin'] as ApiScope[],
        type: 'api_key',
        anonymous: true,
      };
      return next();
    }

    const token = extractToken(req);

    if (!token) {
      return res.status(401).json({
        ...API_ERRORS.UNAUTHORIZED,
        message: 'No authentication token provided',
      });
    }

    // Try API key first (starts with cb_sk_)
    if (token.startsWith('cb_sk_')) {
      const apiKey = validateApiKey(token);
      if (!apiKey) {
        return res.status(401).json({
          ...API_ERRORS.UNAUTHORIZED,
          message: 'Invalid or expired API key',
        });
      }

      req.auth = {
        keyId: apiKey.id,
        userId: apiKey.userId,
        scopes: apiKey.scopes,
        type: 'api_key',
      };
      return next();
    }

    // Try JWT token
    const payload = verifyToken(token, config.jwtSecret);
    if (!payload) {
      return res.status(401).json({
        ...API_ERRORS.UNAUTHORIZED,
        message: 'Invalid or expired token',
      });
    }

    req.auth = {
      keyId: payload.type === 'api_key' ? payload.sub : undefined,
      userId: payload.sub,
      scopes: payload.scopes || ['chat'],
      type: payload.type || 'user',
    };

    return next();
  };
}

function normalizeRemoteAddress(value: string): string {
  return value.trim().replace(/^\[|\]$/g, '').replace(/^::ffff:/i, '');
}

/** True only for IPv4/IPv6 loopback addresses (not RFC1918/LAN addresses). */
export function isLoopbackRemoteAddress(value: string | undefined): boolean {
  if (!value) return false;
  const address = normalizeRemoteAddress(value.split('%')[0] ?? value);
  if (address === '::1' || address === '0:0:0:0:0:0:0:1') return true;
  const pieces = address.split('.');
  if (
    pieces.length !== 4 ||
    pieces.some((piece) => !/^\d{1,3}$/.test(piece) || Number(piece) > 255)
  ) {
    return false;
  }
  return pieces[0] === '127';
}

export function hasProxyForwardingHeaders(headers: IncomingHttpHeaders): boolean {
  return [
    'forwarded',
    'via',
    'x-forwarded-for',
    'x-forwarded-host',
    'x-forwarded-proto',
    'x-real-ip',
  ].some((header) => headers[header] !== undefined);
}

export function isDirectLoopbackRequest(
  remoteAddress: string | undefined,
  headers: IncomingHttpHeaders,
): boolean {
  return isLoopbackRemoteAddress(remoteAddress) && !hasProxyForwardingHeaders(headers);
}

/**
 * Fail closed for privileged routes when `--no-auth` synthesized an anonymous
 * admin. Direct loopback clients remain compatible; LAN/WAN clients and all
 * proxied requests are denied until authentication is enabled.
 */
export function requireLocalAnonymousAccess(req: Request, res: Response, next: NextFunction) {
  if (!req.auth?.anonymous) return next();

  // In anonymous-admin mode, do not trust *any* proxy assertion. A public
  // client can spoof a loopback X-Forwarded-For when a proxy appends/preserves
  // headers. Operators behind a reverse proxy must enable authentication.
  if (!isDirectLoopbackRequest(req.socket.remoteAddress, req.headers)) {
    return res.status(403).json({
      ...API_ERRORS.FORBIDDEN,
      message:
        'Anonymous tool access is local-only. Enable authentication for network clients.',
    });
  }
  return next();
}

/**
 * Create scope checking middleware
 */
export function requireScope(...scopes: ApiScope[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      return res.status(401).json(API_ERRORS.UNAUTHORIZED);
    }

    // Admin has all scopes
    if (req.auth.scopes?.includes('admin')) {
      return next();
    }

    // Check if user has any of the required scopes
    const hasRequired = scopes.some((scope) => req.auth!.scopes?.includes(scope));
    if (!hasRequired) {
      return res.status(403).json({
        ...API_ERRORS.FORBIDDEN,
        message: `Required scope(s): ${scopes.join(' or ')}`,
      });
    }

    return next();
  };
}

/**
 * Optional authentication middleware (sets auth if present, but doesn't require it)
 */
export function optionalAuth(config: ServerConfig) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const token = extractToken(req);

    if (!token) {
      return next();
    }

    // Try API key
    if (token.startsWith('cb_sk_')) {
      const apiKey = validateApiKey(token);
      if (apiKey) {
        req.auth = {
          keyId: apiKey.id,
          userId: apiKey.userId,
          scopes: apiKey.scopes,
          type: 'api_key',
        };
      }
      return next();
    }

    // Try JWT
    const payload = verifyToken(token, config.jwtSecret);
    if (payload) {
      req.auth = {
        keyId: payload.type === 'api_key' ? payload.sub : undefined,
        userId: payload.sub,
        scopes: payload.scopes || ['chat'],
        type: payload.type || 'user',
      };
    }

    return next();
  };
}
