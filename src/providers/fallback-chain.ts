/**
 * Provider Fallback Chain
 *
 * Implements automatic provider fallback when primary provider fails.
 * Features:
 * - Circuit breaker pattern for unhealthy provider detection
 * - Automatic provider promotion when primary fails
 * - Health tracking (failure rate, response time)
 * - Graceful fallback to alternatives
 * - Auto-recovery after cooldown period
 */

import { EventEmitter } from 'events';
import type { ProviderType } from './types.js';

// ============================================================================
// Interfaces
// ============================================================================

/**
 * Configuration for the fallback chain behavior.
 */
export interface FallbackConfig {
  /** Maximum failures before marking provider as unhealthy (circuit breaker threshold). Default: 3 */
  maxFailures: number;
  /** Cooldown period in milliseconds before attempting recovery. Default: 60000 (1 minute) */
  cooldownMs: number;
  /** Time window in milliseconds for failure counting. Default: 300000 (5 minutes) */
  failureWindowMs: number;
  /** Response time threshold in ms - above this is considered slow. Default: 5000 */
  slowThresholdMs: number;
  /** Whether to auto-promote backup providers when primary fails. Default: true */
  autoPromote: boolean;
  /** Maximum number of consecutive slow responses before considering unhealthy. Default: 5 */
  maxSlowResponses: number;
}

/**
 * Health status for a single provider.
 */
export interface ProviderHealth {
  /** Provider identifier */
  provider: ProviderType;
  /** Whether the provider is currently healthy (circuit is closed) */
  healthy: boolean;
  /** Number of failures in the current window */
  failureCount: number;
  /** Number of successes in the current window */
  successCount: number;
  /** Total number of requests made */
  totalRequests: number;
  /** Average response time in milliseconds */
  avgResponseTimeMs: number;
  /** Timestamp of last successful request */
  lastSuccess: number | null;
  /** Timestamp of last failure */
  lastFailure: number | null;
  /** Timestamp when provider was marked unhealthy (circuit opened) */
  circuitOpenedAt: number | null;
  /** Failure rate (0-1) */
  failureRate: number;
  /** Number of consecutive slow responses */
  consecutiveSlowResponses: number;
}

/**
 * Internal tracking data for a provider.
 */
interface ProviderMetrics {
  failures: number[];        // Timestamps of failures within window
  successes: number[];       // Timestamps of successes within window
  responseTimes: number[];   // Recent response times
  totalRequests: number;
  lastSuccess: number | null;
  lastFailure: number | null;
  circuitOpenedAt: number | null;
  consecutiveSlowResponses: number;
}

/**
 * Events emitted by the fallback chain.
 */
export interface FallbackChainEvents {
  /** Emitted when switching to a fallback provider */
  'provider:fallback': { from: ProviderType; to: ProviderType; reason: string };
  /** Emitted when a provider becomes unhealthy (circuit opens) */
  'provider:unhealthy': { provider: ProviderType; failureCount: number; reason: string };
  /** Emitted when a provider recovers (circuit closes) */
  'provider:recovered': { provider: ProviderType };
  /** Emitted when a provider is promoted to primary */
  'provider:promoted': { provider: ProviderType; previousPrimary: ProviderType };
  /** Emitted on any failure */
  'provider:failure': { provider: ProviderType; error: string };
  /** Emitted on any success */
  'provider:success': { provider: ProviderType; responseTimeMs: number };
  /** Emitted when all providers are exhausted */
  'chain:exhausted': { attemptedProviders: ProviderType[] };
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: FallbackConfig = {
  maxFailures: 3,
  cooldownMs: 60000,           // 1 minute
  failureWindowMs: 300000,     // 5 minutes
  slowThresholdMs: 5000,       // 5 seconds
  autoPromote: true,
  maxSlowResponses: 5,
};

// ============================================================================
// ProviderFallbackChain Class
// ============================================================================

/**
 * Manages a fallback chain of AI providers with automatic failover,
 * health tracking, and circuit breaker functionality.
 */
export class ProviderFallbackChain extends EventEmitter {
  private chain: ProviderType[] = [];
  private config: FallbackConfig;
  private metrics: Map<ProviderType, ProviderMetrics> = new Map();
  private currentIndex = 0;

  constructor(config: Partial<FallbackConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ==========================================================================
  // Chain Management
  // ==========================================================================

  /**
   * Sets the fallback chain order.
   * The first provider is the primary, subsequent providers are fallbacks.
   *
   * @param providers - Ordered list of providers (primary first)
   */
  setFallbackChain(providers: ProviderType[]): void {
    if (providers.length === 0) {
      throw new Error('Fallback chain must have at least one provider');
    }

    this.chain = [...providers];
    this.currentIndex = 0;

    // Initialize metrics for any new providers
    for (const provider of providers) {
      if (!this.metrics.has(provider)) {
        this.initializeMetrics(provider);
      }
    }
  }

  /**
   * Gets the current fallback chain.
   */
  getFallbackChain(): ProviderType[] {
    return [...this.chain];
  }

  /**
   * Gets the current primary provider.
   */
  getPrimaryProvider(): ProviderType | null {
    return this.chain[0] ?? null;
  }

  // ==========================================================================
  // Provider Selection
  // ==========================================================================

  /**
   * Gets the next healthy provider in the chain.
   * Implements circuit breaker pattern - skips unhealthy providers.
   *
   * @param skipCurrent - Whether to skip the current provider
   * @returns The next available provider, or null if all are exhausted
   */
  getNextProvider(skipCurrent = false): ProviderType | null {
    if (this.chain.length === 0) {
      return null;
    }

    const startIndex = skipCurrent ? this.currentIndex + 1 : this.currentIndex;
    const attemptedProviders: ProviderType[] = [];

    for (let i = 0; i < this.chain.length; i++) {
      const index = (startIndex + i) % this.chain.length;
      const provider = this.chain[index];
      attemptedProviders.push(provider);

      if (this.isProviderHealthy(provider)) {
        if (index !== this.currentIndex) {
          const previousProvider = this.chain[this.currentIndex];
          this.currentIndex = index;
          this.emit('provider:fallback', {
            from: previousProvider,
            to: provider,
            reason: skipCurrent ? 'explicit_skip' : 'health_check',
          });
        }
        return provider;
      }

      // Check if we should attempt recovery
      if (this.shouldAttemptRecovery(provider)) {
        this.currentIndex = index;
        return provider;
      }
    }

    // All providers exhausted
    this.emit('chain:exhausted', { attemptedProviders });
    return null;
  }

  /**
   * Gets the current active provider (may be unhealthy).
   */
  getCurrentProvider(): ProviderType | null {
    return this.chain[this.currentIndex] ?? null;
  }

  // ==========================================================================
  // Health Tracking
  // ==========================================================================

  /**
   * Records a successful request for a provider.
   *
   * @param provider - The provider that succeeded
   * @param responseTimeMs - Response time in milliseconds
   */
  recordSuccess(provider: ProviderType, responseTimeMs: number): void {
    const metrics = this.getOrCreateMetrics(provider);
    const now = Date.now();

    // Clean old entries
    this.cleanOldEntries(metrics);

    metrics.successes.push(now);
    metrics.totalRequests++;
    metrics.lastSuccess = now;
    metrics.responseTimes.push(responseTimeMs);

    // Keep only last 100 response times
    if (metrics.responseTimes.length > 100) {
      metrics.responseTimes.shift();
    }

    // Track slow responses
    if (responseTimeMs > this.config.slowThresholdMs) {
      metrics.consecutiveSlowResponses++;
    } else {
      metrics.consecutiveSlowResponses = 0;
    }

    // Check for recovery from unhealthy state
    if (metrics.circuitOpenedAt !== null) {
      metrics.circuitOpenedAt = null;
      this.emit('provider:recovered', { provider });
    }

    this.emit('provider:success', { provider, responseTimeMs });
  }

  /**
   * Records a failed request for a provider.
   *
   * @param provider - The provider that failed
   * @param error - Error message or description
   */
  recordFailure(provider: ProviderType, error: string): void {
    const metrics = this.getOrCreateMetrics(provider);
    const now = Date.now();

    // Clean old entries
    this.cleanOldEntries(metrics);

    metrics.failures.push(now);
    metrics.totalRequests++;
    metrics.lastFailure = now;
    metrics.consecutiveSlowResponses = 0;

    this.emit('provider:failure', { provider, error });

    // Check if we should open the circuit
    if (metrics.failures.length >= this.config.maxFailures && metrics.circuitOpenedAt === null) {
      metrics.circuitOpenedAt = now;
      this.emit('provider:unhealthy', {
        provider,
        failureCount: metrics.failures.length,
        reason: `Exceeded ${this.config.maxFailures} failures within window`,
      });

      // Auto-promote if enabled and this is the primary
      if (this.config.autoPromote && this.chain[0] === provider) {
        this.promoteNextHealthyProvider();
      }
    }
  }

  /**
   * Gets the health status for a specific provider.
   *
   * @param provider - The provider to check
   * @returns Health status object
   */
  getHealthStatus(provider: ProviderType): ProviderHealth {
    const metrics = this.getOrCreateMetrics(provider);
    this.cleanOldEntries(metrics);

    const totalInWindow = metrics.failures.length + metrics.successes.length;
    const failureRate = totalInWindow > 0 ? metrics.failures.length / totalInWindow : 0;
    const avgResponseTime = metrics.responseTimes.length > 0
      ? metrics.responseTimes.reduce((a, b) => a + b, 0) / metrics.responseTimes.length
      : 0;

    return {
      provider,
      healthy: this.isProviderHealthy(provider),
      failureCount: metrics.failures.length,
      successCount: metrics.successes.length,
      totalRequests: metrics.totalRequests,
      avgResponseTimeMs: Math.round(avgResponseTime),
      lastSuccess: metrics.lastSuccess,
      lastFailure: metrics.lastFailure,
      circuitOpenedAt: metrics.circuitOpenedAt,
      failureRate: Math.round(failureRate * 100) / 100,
      consecutiveSlowResponses: metrics.consecutiveSlowResponses,
    };
  }

  /**
   * Gets health status for all providers in the chain.
   */
  getAllHealthStatus(): ProviderHealth[] {
    return this.chain.map(provider => this.getHealthStatus(provider));
  }

  /**
   * Checks if a provider is currently healthy.
   * A provider is healthy if:
   * - Circuit is closed (not in cooldown)
   * - Not exceeding slow response threshold
   */
  isProviderHealthy(provider: ProviderType): boolean {
    const metrics = this.metrics.get(provider);
    if (!metrics) {
      return true; // Unknown provider is assumed healthy
    }

    // Check if circuit is open
    if (metrics.circuitOpenedAt !== null) {
      return false;
    }

    // Check consecutive slow responses
    if (metrics.consecutiveSlowResponses >= this.config.maxSlowResponses) {
      return false;
    }

    return true;
  }

  // ==========================================================================
  // Circuit Breaker
  // ==========================================================================

  /**
   * Checks if we should attempt recovery for an unhealthy provider.
   * Recovery is attempted after the cooldown period.
   */
  private shouldAttemptRecovery(provider: ProviderType): boolean {
    const metrics = this.metrics.get(provider);
    if (!metrics || metrics.circuitOpenedAt === null) {
      return false;
    }

    const now = Date.now();
    const timeSinceOpen = now - metrics.circuitOpenedAt;

    return timeSinceOpen >= this.config.cooldownMs;
  }

  /**
   * Manually reset a provider's health status.
   * Use with caution - bypasses the circuit breaker.
   */
  resetProvider(provider: ProviderType): void {
    this.initializeMetrics(provider);
    this.emit('provider:recovered', { provider });
  }

  /**
   * Manually mark a provider as unhealthy.
   * Opens the circuit breaker for this provider.
   */
  markUnhealthy(provider: ProviderType, reason: string): void {
    const metrics = this.getOrCreateMetrics(provider);
    metrics.circuitOpenedAt = Date.now();
    this.emit('provider:unhealthy', {
      provider,
      failureCount: metrics.failures.length,
      reason,
    });
  }

  // ==========================================================================
  // Provider Promotion
  // ==========================================================================

  /**
   * Promotes a specific provider to primary position.
   */
  promoteProvider(provider: ProviderType): void {
    const index = this.chain.indexOf(provider);
    if (index === -1) {
      throw new Error(`Provider ${provider} not in fallback chain`);
    }

    if (index === 0) {
      return; // Already primary
    }

    const previousPrimary = this.chain[0];
    this.chain.splice(index, 1);
    this.chain.unshift(provider);
    this.currentIndex = 0;

    this.emit('provider:promoted', { provider, previousPrimary });
  }

  /**
   * Promotes the next healthy provider to primary position.
   */
  private promoteNextHealthyProvider(): void {
    for (let i = 1; i < this.chain.length; i++) {
      const provider = this.chain[i];
      if (this.isProviderHealthy(provider)) {
        this.promoteProvider(provider);
        return;
      }
    }
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  /**
   * Initializes metrics for a provider.
   */
  private initializeMetrics(provider: ProviderType): void {
    this.metrics.set(provider, {
      failures: [],
      successes: [],
      responseTimes: [],
      totalRequests: 0,
      lastSuccess: null,
      lastFailure: null,
      circuitOpenedAt: null,
      consecutiveSlowResponses: 0,
    });
  }

  /**
   * Gets or creates metrics for a provider.
   */
  private getOrCreateMetrics(provider: ProviderType): ProviderMetrics {
    if (!this.metrics.has(provider)) {
      this.initializeMetrics(provider);
    }
    return this.metrics.get(provider)!;
  }

  /**
   * Cleans old entries outside the failure window.
   */
  private cleanOldEntries(metrics: ProviderMetrics): void {
    const now = Date.now();
    const cutoff = now - this.config.failureWindowMs;

    metrics.failures = metrics.failures.filter(t => t > cutoff);
    metrics.successes = metrics.successes.filter(t => t > cutoff);
  }

  /**
   * Updates the configuration.
   */
  updateConfig(config: Partial<FallbackConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Gets the current configuration.
   */
  getConfig(): FallbackConfig {
    return { ...this.config };
  }

  /**
   * Resets all metrics and state.
   */
  reset(): void {
    this.metrics.clear();
    this.currentIndex = 0;
    for (const provider of this.chain) {
      this.initializeMetrics(provider);
    }
  }

  /**
   * Disposes of the fallback chain and clears all listeners.
   */
  dispose(): void {
    this.chain = [];
    this.metrics.clear();
    this.currentIndex = 0;
    this.removeAllListeners();
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let fallbackChainInstance: ProviderFallbackChain | null = null;

/**
 * Gets the singleton instance of the ProviderFallbackChain.
 */
export function getFallbackChain(): ProviderFallbackChain {
  if (!fallbackChainInstance) {
    fallbackChainInstance = new ProviderFallbackChain();
  }
  return fallbackChainInstance;
}

/**
 * Resets the singleton instance (useful for testing).
 */
export function resetFallbackChain(): void {
  if (fallbackChainInstance) {
    fallbackChainInstance.dispose();
  }
  fallbackChainInstance = null;
}
