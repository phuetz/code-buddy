/**
 * Networking module exports
 *
 * Advanced networking utilities for Code Buddy:
 * - Circuit breaker pattern for fault tolerance
 * - Health checking for endpoint monitoring
 * - Retry utilities (from utils/retry.ts)
 * - Rate limiting (from utils/rate-limiter.ts)
 */

export * from './circuit-breaker.js';
export * from './health-check.js';

// Re-export related utilities
export { retry, retryWithResult, withRetry, Retry, RetryPredicates, RetryStrategies } from '../utils/retry.js';
export { RateLimiter, getRateLimiter, rateLimited } from '../utils/rate-limiter.js';
