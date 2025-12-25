/**
 * Circuit Breaker pattern implementation
 *
 * Prevents cascading failures by temporarily blocking requests
 * to a failing service until it recovers.
 *
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Failing, requests are blocked
 * - HALF_OPEN: Testing if service has recovered
 */

import { EventEmitter } from 'events';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  /** Number of failures before opening circuit (default: 5) */
  failureThreshold?: number;
  /** Time in ms before attempting recovery (default: 30000) */
  resetTimeout?: number;
  /** Number of successful calls in HALF_OPEN to close circuit (default: 2) */
  successThreshold?: number;
  /** Time window in ms for failure counting (default: 60000) */
  failureWindow?: number;
  /** Function to determine if error should trip the breaker */
  isFailure?: (error: unknown) => boolean;
  /** Called when circuit state changes */
  onStateChange?: (from: CircuitState, to: CircuitState) => void;
}

export interface CircuitBreakerStats {
  state: CircuitState;
  failures: number;
  successes: number;
  consecutiveSuccesses: number;
  lastFailure: Date | null;
  lastSuccess: Date | null;
  totalRequests: number;
  failedRequests: number;
}

const DEFAULT_OPTIONS: Required<Omit<CircuitBreakerOptions, 'onStateChange'>> = {
  failureThreshold: 5,
  resetTimeout: 30000,
  successThreshold: 2,
  failureWindow: 60000,
  isFailure: () => true,
};

/**
 * Circuit Breaker implementation
 */
export class CircuitBreaker extends EventEmitter {
  private options: Required<Omit<CircuitBreakerOptions, 'onStateChange'>>;
  private onStateChange?: (from: CircuitState, to: CircuitState) => void;
  private state: CircuitState = 'CLOSED';
  private failures: number[] = []; // Timestamps of failures
  private consecutiveSuccesses: number = 0;
  private lastFailure: Date | null = null;
  private lastSuccess: Date | null = null;
  private nextAttempt: number = 0;
  private totalRequests: number = 0;
  private failedRequests: number = 0;

  constructor(options: CircuitBreakerOptions = {}) {
    super();
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.onStateChange = options.onStateChange;
  }

  /**
   * Execute a function through the circuit breaker
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.totalRequests++;

    // Check if circuit allows request
    if (!this.canExecute()) {
      this.failedRequests++;
      throw new Error('Circuit breaker is OPEN - request blocked');
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      if (this.options.isFailure(error)) {
        this.onFailure();
      }
      throw error;
    }
  }

  /**
   * Check if request can be executed
   */
  private canExecute(): boolean {
    switch (this.state) {
      case 'CLOSED':
        return true;

      case 'OPEN':
        // Check if reset timeout has passed
        if (Date.now() >= this.nextAttempt) {
          this.transitionTo('HALF_OPEN');
          return true;
        }
        return false;

      case 'HALF_OPEN':
        // Allow limited requests in HALF_OPEN state
        return true;

      default:
        return false;
    }
  }

  /**
   * Handle successful execution
   */
  private onSuccess(): void {
    this.lastSuccess = new Date();
    this.consecutiveSuccesses++;

    if (this.state === 'HALF_OPEN') {
      if (this.consecutiveSuccesses >= this.options.successThreshold) {
        this.transitionTo('CLOSED');
      }
    }

    this.emit('success');
  }

  /**
   * Handle failed execution
   */
  private onFailure(): void {
    this.failedRequests++;
    this.lastFailure = new Date();
    this.consecutiveSuccesses = 0;

    // Add failure timestamp
    const now = Date.now();
    this.failures.push(now);

    // Remove old failures outside the window
    const windowStart = now - this.options.failureWindow;
    this.failures = this.failures.filter((t) => t > windowStart);

    // Check if we should open the circuit
    if (this.state === 'HALF_OPEN') {
      // Any failure in HALF_OPEN reopens the circuit
      this.transitionTo('OPEN');
    } else if (
      this.state === 'CLOSED' &&
      this.failures.length >= this.options.failureThreshold
    ) {
      this.transitionTo('OPEN');
    }

    this.emit('failure');
  }

  /**
   * Transition to a new state
   */
  private transitionTo(newState: CircuitState): void {
    const oldState = this.state;
    if (oldState === newState) return;

    this.state = newState;

    switch (newState) {
      case 'OPEN':
        this.nextAttempt = Date.now() + this.options.resetTimeout;
        this.consecutiveSuccesses = 0;
        break;

      case 'CLOSED':
        this.failures = [];
        this.consecutiveSuccesses = 0;
        break;

      case 'HALF_OPEN':
        this.consecutiveSuccesses = 0;
        break;
    }

    this.onStateChange?.(oldState, newState);
    this.emit('stateChange', { from: oldState, to: newState });
  }

  /**
   * Get current state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Get circuit breaker statistics
   */
  getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      failures: this.failures.length,
      successes: this.consecutiveSuccesses,
      consecutiveSuccesses: this.consecutiveSuccesses,
      lastFailure: this.lastFailure,
      lastSuccess: this.lastSuccess,
      totalRequests: this.totalRequests,
      failedRequests: this.failedRequests,
    };
  }

  /**
   * Manually reset the circuit breaker
   */
  reset(): void {
    this.transitionTo('CLOSED');
    this.failures = [];
    this.consecutiveSuccesses = 0;
    this.emit('reset');
  }

  /**
   * Manually trip the circuit breaker
   */
  trip(): void {
    this.transitionTo('OPEN');
    this.emit('trip');
  }

  /**
   * Check if circuit is healthy
   */
  isHealthy(): boolean {
    return this.state === 'CLOSED';
  }

  /**
   * Get time until next retry attempt (for OPEN state)
   */
  getTimeUntilRetry(): number {
    if (this.state !== 'OPEN') return 0;
    return Math.max(0, this.nextAttempt - Date.now());
  }

  /**
   * Format stats for display
   */
  formatStats(): string {
    const stats = this.getStats();
    const stateColor =
      stats.state === 'CLOSED' ? 'green' : stats.state === 'OPEN' ? 'red' : 'yellow';

    const lines = [
      `Circuit Breaker Status: ${stats.state}`,
      `  Total Requests: ${stats.totalRequests}`,
      `  Failed Requests: ${stats.failedRequests}`,
      `  Recent Failures: ${stats.failures}`,
      `  Consecutive Successes: ${stats.consecutiveSuccesses}`,
      `  Last Failure: ${stats.lastFailure?.toISOString() || 'Never'}`,
      `  Last Success: ${stats.lastSuccess?.toISOString() || 'Never'}`,
    ];

    if (this.state === 'OPEN') {
      const retryIn = Math.ceil(this.getTimeUntilRetry() / 1000);
      lines.push(`  Retry In: ${retryIn}s`);
    }

    return lines.join('\n');
  }

  /**
   * Dispose and cleanup
   */
  dispose(): void {
    this.removeAllListeners();
  }
}

// Named circuit breakers registry
const circuitBreakers: Map<string, CircuitBreaker> = new Map();

/**
 * Get or create a named circuit breaker
 */
export function getCircuitBreaker(
  name: string,
  options?: CircuitBreakerOptions
): CircuitBreaker {
  let breaker = circuitBreakers.get(name);
  if (!breaker) {
    breaker = new CircuitBreaker(options);
    circuitBreakers.set(name, breaker);
  }
  return breaker;
}

/**
 * Get all circuit breaker stats
 */
export function getAllCircuitBreakerStats(): Record<string, CircuitBreakerStats> {
  const stats: Record<string, CircuitBreakerStats> = {};
  for (const [name, breaker] of circuitBreakers) {
    stats[name] = breaker.getStats();
  }
  return stats;
}

/**
 * Reset all circuit breakers
 */
export function resetAllCircuitBreakers(): void {
  for (const breaker of circuitBreakers.values()) {
    breaker.reset();
  }
}
