/**
 * Middleware Module
 *
 * Exports all middleware components.
 */

export {
  hasScope,
  createAuthMiddleware,
  requireLocalAnonymousAccess,
  isLoopbackRemoteAddress,
  hasProxyForwardingHeaders,
  isDirectLoopbackRequest,
  requireScope,
  optionalAuth,
} from './auth.js';

export {
  DEFAULT_ROUTE_LIMITS,
  createRateLimitMiddleware,
  endpointRateLimit,
  createRouteRateLimiter,
  rateLimiters,
  getRateLimitStats,
  resetRateLimit,
  getAllRateLimits,
  type RateLimitOptions,
} from './rate-limit.js';

export {
  ApiServerError,
  generateRequestId,
  requestIdMiddleware,
  notFoundHandler,
  errorHandler,
  asyncHandler,
  validateRequired,
  validateTypes,
} from './error-handler.js';

export {
  createLoggingMiddleware,
  getRequestStats,
  resetRequestStats,
  createJsonLoggingMiddleware,
} from './logging.js';

export {
  createSecurityHeadersMiddleware,
  STRICT_API_CONFIG,
  STATIC_ASSETS_CONFIG,
  DEVELOPMENT_CONFIG,
  getRecommendedConfig,
  type SecurityHeadersConfig,
  type CSPDirectives,
} from './security-headers.js';
