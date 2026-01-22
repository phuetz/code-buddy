/**
 * Security Headers Middleware
 *
 * Adds essential security headers to all responses including:
 * - Content-Security-Policy (CSP)
 * - X-Content-Type-Options
 * - X-Frame-Options
 * - X-XSS-Protection
 * - Strict-Transport-Security (HSTS)
 * - Referrer-Policy
 * - Permissions-Policy
 *
 * Configuration options:
 * - Can be disabled entirely for development (SECURITY_HEADERS=false)
 * - Supports route-based exclusions (e.g., for static assets)
 * - CSP can be set to report-only mode for testing
 */

import { Request, Response, NextFunction } from 'express';
import type { ServerConfig, SecurityHeadersServerConfig } from '../types.js';

export interface SecurityHeadersConfig {
  /**
   * Enable security headers entirely
   * @default true in production, configurable in development
   */
  enabled?: boolean;

  /**
   * Enable Content-Security-Policy header
   * @default true
   */
  enableCSP?: boolean;

  /**
   * Custom CSP directives (merged with defaults)
   */
  cspDirectives?: Partial<CSPDirectives>;

  /**
   * Enable HSTS header (should only be enabled for HTTPS)
   * @default false (auto-enabled when NODE_ENV=production)
   */
  enableHSTS?: boolean;

  /**
   * HSTS max-age in seconds
   * @default 31536000 (1 year)
   */
  hstsMaxAge?: number;

  /**
   * Include subdomains in HSTS
   * @default true
   */
  hstsIncludeSubDomains?: boolean;

  /**
   * Enable HSTS preload
   * @default false
   */
  hstsPreload?: boolean;

  /**
   * X-Frame-Options value
   * @default 'DENY'
   */
  frameOptions?: 'DENY' | 'SAMEORIGIN';

  /**
   * Referrer-Policy value
   * @default 'strict-origin-when-cross-origin'
   */
  referrerPolicy?: string;

  /**
   * Routes to exclude from security headers (e.g., static assets)
   * Supports exact matches and prefix patterns (ending with *)
   * @example ['/static/*', '/assets/*', '/health']
   */
  excludeRoutes?: string[];

  /**
   * Use Content-Security-Policy-Report-Only instead of Content-Security-Policy
   * Useful for testing CSP without blocking content
   * @default false
   */
  cspReportOnly?: boolean;

  /**
   * URI for CSP violation reports
   * @example '/api/csp-report'
   */
  cspReportUri?: string;
}

export interface CSPDirectives {
  'default-src': string[];
  'script-src': string[];
  'style-src': string[];
  'img-src': string[];
  'font-src': string[];
  'connect-src': string[];
  'frame-ancestors': string[];
  'form-action': string[];
  'base-uri': string[];
  'object-src': string[];
  'upgrade-insecure-requests'?: boolean;
}

/**
 * Default CSP directives for a secure API server
 */
const DEFAULT_CSP_DIRECTIVES: CSPDirectives = {
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  'style-src': ["'self'", "'unsafe-inline'"], // unsafe-inline needed for some UI frameworks
  'img-src': ["'self'", 'data:', 'https:'],
  'font-src': ["'self'"],
  'connect-src': ["'self'"],
  'frame-ancestors': ["'none'"],
  'form-action': ["'self'"],
  'base-uri': ["'self'"],
  'object-src': ["'none'"],
  'upgrade-insecure-requests': true,
};

/**
 * Build CSP header string from directives
 */
function buildCSPHeader(directives: CSPDirectives): string {
  const parts: string[] = [];

  for (const [directive, value] of Object.entries(directives)) {
    if (directive === 'upgrade-insecure-requests') {
      if (value === true) {
        parts.push('upgrade-insecure-requests');
      }
    } else if (Array.isArray(value) && value.length > 0) {
      parts.push(`${directive} ${value.join(' ')}`);
    }
  }

  return parts.join('; ');
}

/**
 * Merge custom CSP directives with defaults
 */
function mergeCSPDirectives(
  defaults: CSPDirectives,
  custom?: Partial<CSPDirectives> | Record<string, string[]>
): CSPDirectives {
  if (!custom) return defaults;

  const merged: CSPDirectives = { ...defaults };

  for (const [key, value] of Object.entries(custom)) {
    if (key === 'upgrade-insecure-requests') {
      merged[key] = value as boolean;
    } else if (Array.isArray(value)) {
      merged[key as keyof Omit<CSPDirectives, 'upgrade-insecure-requests'>] = value;
    }
  }

  return merged;
}

/**
 * Check if a route should be excluded from security headers
 */
function shouldExcludeRoute(path: string, excludeRoutes?: string[]): boolean {
  if (!excludeRoutes || excludeRoutes.length === 0) return false;

  for (const pattern of excludeRoutes) {
    // Wildcard pattern (e.g., '/static/*')
    if (pattern.endsWith('*')) {
      const prefix = pattern.slice(0, -1);
      if (path.startsWith(prefix)) return true;
    }
    // Exact match
    else if (path === pattern) {
      return true;
    }
  }

  return false;
}

/**
 * Determine if security headers should be enabled based on environment
 */
function resolveEnabled(config?: SecurityHeadersServerConfig): boolean {
  // Explicit configuration takes precedence
  if (config?.enabled !== undefined) {
    return config.enabled;
  }

  // Check environment variable
  if (process.env.SECURITY_HEADERS === 'false') {
    return false;
  }

  // Default: enabled in production, enabled in development (but can be disabled)
  return true;
}

/**
 * Create security headers middleware
 *
 * @param serverConfig - Server configuration containing securityHeaders settings
 * @param securityConfig - Direct security headers configuration (optional, for backward compatibility)
 * @returns Express middleware function
 *
 * @example
 * // Basic usage with server config
 * app.use(createSecurityHeadersMiddleware(serverConfig));
 *
 * @example
 * // Disable in development
 * app.use(createSecurityHeadersMiddleware({ ...serverConfig, securityHeaders: { enabled: false } }));
 *
 * @example
 * // Custom CSP for specific needs
 * app.use(createSecurityHeadersMiddleware(serverConfig, {
 *   cspDirectives: {
 *     'script-src': ["'self'", 'cdn.example.com'],
 *   },
 *   excludeRoutes: ['/static/*'],
 * }));
 */
export function createSecurityHeadersMiddleware(
  serverConfig: ServerConfig,
  securityConfig: SecurityHeadersConfig = {}
): (req: Request, res: Response, next: NextFunction) => void {
  // Merge server config with direct config (direct config takes precedence)
  const serverSecurityConfig = serverConfig.securityHeaders || {};
  const mergedConfig: SecurityHeadersConfig = {
    ...serverSecurityConfig,
    ...securityConfig,
  };

  // Check if security headers are enabled
  const isEnabled = resolveEnabled(serverSecurityConfig);

  // Return no-op middleware if disabled
  if (!isEnabled) {
    return (_req: Request, _res: Response, next: NextFunction): void => {
      next();
    };
  }

  const {
    enableCSP = true,
    cspDirectives,
    enableHSTS = process.env.NODE_ENV === 'production',
    hstsMaxAge = 31536000, // 1 year
    hstsIncludeSubDomains = true,
    hstsPreload = false,
    frameOptions = 'DENY',
    referrerPolicy = 'strict-origin-when-cross-origin',
    excludeRoutes,
    cspReportOnly = false,
    cspReportUri,
  } = mergedConfig;

  // Pre-compute CSP header if enabled
  let cspHeader: string | null = null;
  if (enableCSP) {
    const directives = mergeCSPDirectives(DEFAULT_CSP_DIRECTIVES, cspDirectives);

    // Add report-uri directive if specified
    cspHeader = buildCSPHeader(directives);
    if (cspReportUri) {
      cspHeader += `; report-uri ${cspReportUri}`;
    }
  }

  // Determine CSP header name (report-only or enforcing)
  const cspHeaderName = cspReportOnly
    ? 'Content-Security-Policy-Report-Only'
    : 'Content-Security-Policy';

  // Pre-compute HSTS header if enabled
  let hstsHeader: string | null = null;
  if (enableHSTS) {
    hstsHeader = `max-age=${hstsMaxAge}`;
    if (hstsIncludeSubDomains) {
      hstsHeader += '; includeSubDomains';
    }
    if (hstsPreload) {
      hstsHeader += '; preload';
    }
  }

  return (req: Request, res: Response, next: NextFunction): void => {
    // Check if this route should be excluded
    if (shouldExcludeRoute(req.path, excludeRoutes)) {
      return next();
    }

    // Content-Security-Policy (or Content-Security-Policy-Report-Only)
    if (cspHeader) {
      res.setHeader(cspHeaderName, cspHeader);
    }

    // X-Content-Type-Options - Prevent MIME type sniffing
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // X-Frame-Options - Prevent clickjacking
    res.setHeader('X-Frame-Options', frameOptions);

    // X-XSS-Protection - Enable XSS filter in older browsers
    // Note: Modern browsers use CSP instead, but this helps legacy browsers
    res.setHeader('X-XSS-Protection', '1; mode=block');

    // Strict-Transport-Security - Force HTTPS
    if (hstsHeader) {
      res.setHeader('Strict-Transport-Security', hstsHeader);
    }

    // Referrer-Policy - Control referrer information
    res.setHeader('Referrer-Policy', referrerPolicy);

    // Permissions-Policy - Disable unnecessary browser features
    res.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), interest-cohort=()'
    );

    // X-Permitted-Cross-Domain-Policies - Restrict Adobe Flash/PDF
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');

    // Cache-Control for API responses (prevent caching of sensitive data)
    // Note: This can be overridden by individual routes if needed
    if (!res.getHeader('Cache-Control')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    }

    next();
  };
}

/**
 * Export default CSP directives for customization
 */
export { DEFAULT_CSP_DIRECTIVES };

// ============================================================================
// Preset Configurations
// ============================================================================

/**
 * Strict CSP configuration for API-only servers
 * - No inline scripts or styles
 * - Self-only sources
 * - Blocks all frames
 */
export const STRICT_API_CONFIG: SecurityHeadersConfig = {
  enabled: true,
  enableCSP: true,
  enableHSTS: true,
  frameOptions: 'DENY',
  referrerPolicy: 'strict-origin-when-cross-origin',
  cspDirectives: {
    'default-src': ["'self'"],
    'script-src': ["'self'"],
    'style-src': ["'self'"],
    'img-src': ["'self'"],
    'connect-src': ["'self'"],
    'frame-ancestors': ["'none'"],
    'form-action': ["'self'"],
    'object-src': ["'none'"],
  },
};

/**
 * Relaxed CSP configuration for servers serving static assets
 * - Allows inline styles (for UI frameworks)
 * - Allows data: URIs for images
 * - Allows HTTPS sources for images
 */
export const STATIC_ASSETS_CONFIG: SecurityHeadersConfig = {
  enabled: true,
  enableCSP: true,
  enableHSTS: true,
  frameOptions: 'SAMEORIGIN',
  referrerPolicy: 'strict-origin-when-cross-origin',
  cspDirectives: {
    'default-src': ["'self'"],
    'script-src': ["'self'"],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'https:'],
    'font-src': ["'self'", 'https:'],
    'connect-src': ["'self'"],
    'frame-ancestors': ["'self'"],
    'form-action': ["'self'"],
    'object-src': ["'none'"],
  },
};

/**
 * Development configuration - minimal security headers
 * - CSP in report-only mode
 * - HSTS disabled
 * - Useful for local development
 */
export const DEVELOPMENT_CONFIG: SecurityHeadersConfig = {
  enabled: true,
  enableCSP: true,
  cspReportOnly: true, // Report violations but don't block
  enableHSTS: false, // Don't force HTTPS in development
  frameOptions: 'SAMEORIGIN',
  referrerPolicy: 'no-referrer-when-downgrade',
  cspDirectives: {
    'default-src': ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
    'script-src': ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'https:', 'http:'],
    'connect-src': ["'self'", 'ws:', 'wss:', 'http:', 'https:'],
    'frame-ancestors': ["'self'"],
    'form-action': ["'self'"],
    'object-src': ["'none'"],
  },
};

/**
 * Get recommended security config based on environment
 */
export function getRecommendedConfig(): SecurityHeadersConfig {
  if (process.env.NODE_ENV === 'production') {
    return STRICT_API_CONFIG;
  }
  return DEVELOPMENT_CONFIG;
}
