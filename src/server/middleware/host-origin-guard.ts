/**
 * Fail-closed Host + Origin guards for the HTTP API.
 */
import type { Request, Response, NextFunction } from 'express';
import { isOriginAllowed } from '../origin-check.js';
import {
  buildDefaultAllowedHosts,
  isHostAllowed,
  isSameOriginAsHost,
  isOriginExemptPublicPath,
} from '../host-check.js';
import type { ServerConfig } from '../types.js';
import { API_ERRORS } from '../types.js';

function resolveAllowedOrigins(config: ServerConfig): string[] {
  if (Array.isArray(config.corsOrigins)) return config.corsOrigins;
  if (typeof config.corsOrigins === 'string') return config.corsOrigins.split(',');
  return ['http://localhost:*', 'http://127.0.0.1:*'];
}

function resolveAllowedHosts(config: ServerConfig): string[] {
  const fromEnv = (process.env.CODEBUDDY_ALLOWED_HOSTS || process.env.ALLOWED_HOSTS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const fromConfig = Array.isArray(config.allowedHosts) ? config.allowedHosts : [];
  return buildDefaultAllowedHosts({
    bindHost: config.host,
    extra: [...fromConfig, ...fromEnv],
  });
}

/**
 * Reject requests whose Host header is outside the allowlist (DNS rebinding).
 * Applied to every HTTP request, including public health endpoints.
 */
export function createHostAllowlistMiddleware(
  config: ServerConfig,
  resolveListenPort: () => number = () => config.port,
) {
  const allowedHosts = resolveAllowedHosts(config);
  return (req: Request, res: Response, next: NextFunction) => {
    const hostHeader = req.headers.host;
    if (!isHostAllowed(hostHeader, allowedHosts, resolveListenPort())) {
      return res.status(403).json({
        ...API_ERRORS.FORBIDDEN,
        message: 'Forbidden Host header',
      });
    }
    return next();
  };
}

/**
 * When a browser sends Origin, require it to match the CORS allowlist for
 * non-public routes. Clients without Origin (curl, CLI, fleet peers) pass.
 * Public discovery/health routes stay CORS-only (documented SERV2 contract).
 */
export function createOriginAccessMiddleware(config: ServerConfig) {
  const allowedOrigins = resolveAllowedOrigins(config);
  const wildcard = allowedOrigins.includes('*');
  return (req: Request, res: Response, next: NextFunction) => {
    const pathForOrigin = (req.originalUrl || req.url || req.path || '').split('?')[0] || req.path;
    if (isOriginExemptPublicPath(pathForOrigin)) return next();
    const origin = req.headers.origin;
    if (!origin) return next();
    if (wildcard) return next();
    if (isOriginAllowed(origin, allowedOrigins)) return next();
    // Same origin: the page was served by this server under a Host that already
    // passed the allowlist (e.g. the PWA opened on a tailnet name). A foreign
    // site cannot forge an Origin equal to the Host it is talking to.
    if (isSameOriginAsHost(origin, req.headers.host)) return next();
    return res.status(403).json({
      ...API_ERRORS.FORBIDDEN,
      message: 'Forbidden Origin',
    });
  };
}

export function getHostAllowlistForConfig(config: ServerConfig): string[] {
  return resolveAllowedHosts(config);
}
