/**
 * Retry Policy Module
 *
 * Provides exponential backoff retry logic, circuit breaker pattern,
 * and comprehensive error recovery for streaming operations.
 */

import { EventEmitter } from 'events';

// ============================================================================
// Types
// ============================================================================

export interface RetryConfig {
  /** Maximum number of retry attempts */
  maxAttempts: number;
  /** Initial delay in milliseconds */
  initialDelayMs: number;
  /** Maximum delay in milliseconds */
  maxDelayMs: number;
  /** Backoff multiplier (exponential factor) */
  backoffMultiplier: number;
  /** Add jitter to prevent thundering herd */
  jitter: boolean;
  /** Jitter factor (0-1) */
  jitterFactor: number;
  /** Timeout for each attempt in milliseconds */
  attemptTimeoutMs?: number;
  /** Error types that should trigger retry */
  retryableErrors?: string[];
  /** Error types that should NOT trigger retry */
  nonRetryableErrors?: string[];
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitter: true,
  jitterFactor: 0.3,
  attemptTimeoutMs: 60000,
  retryableErrors: ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'RATE_LIMIT', 'SERVICE_UNAVAILABLE'],
  nonRetryableErrors: ['AUTH_FAILED', 'INVALID_REQUEST', 'NOT_FOUND'],
};

export interface RetryAttempt {
  attempt: number;
  startTime: number;
  endTime?: number;
  success: boolean;
  error?: Error;
  delayMs?: number;
}

export interface RetryResult<T> {
  success: boolean;
  value?: T;
  error?: Error;
  attempts: RetryAttempt[];
  totalDurationMs: number;
}

export interface CircuitBreakerConfig {
  /** Number of failures before opening circuit */
  failureThreshold: number;
  /** Time window for counting failures (ms) */
  failureWindowMs: number;
  /** Time to wait before half-opening circuit (ms) */
  resetTimeoutMs: number;
  /** Number of successes needed to close circuit from half-open */
  successThreshold: number;
  /** Timeout for probe requests in half-open state (ms) */
  probeTimeoutMs: number;
}

export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  failureWindowMs: 60000,
  resetTimeoutMs: 30000,
  successThreshold: 3,
  probeTimeoutMs: 10000,
};

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerStats {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailureTime?: number;
  lastSuccessTime?: number;
  openedAt?: number;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  rejectedRequests: number;
}

export interface CircuitBreakerEvents {
  'state-change': (from: CircuitState, to: CircuitState) => void;
  'failure': (error: Error) => void;
  'success': () => void;
  'rejected': () => void;
  'probe': () => void;
}

// ============================================================================
// Retry Utilities
// ============================================================================

/**
 * Calculate delay for a given attempt with exponential backoff
 */
export function calculateDelay(
  attempt: number,
  config: RetryConfig
): number {
  const baseDelay = config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt - 1);
  const delay = Math.min(baseDelay, config.maxDelayMs);

  if (config.jitter) {
    const jitterRange = delay * config.jitterFactor;
    const jitter = (Math.random() - 0.5) * 2 * jitterRange;
    return Math.max(0, Math.round(delay + jitter));
  }

  return Math.round(delay);
}

/**
 * Check if an error is retryable based on config
 */
export function isRetryable(error: Error, config: RetryConfig): boolean {
  const errorCode = (error as NodeJS.ErrnoException).code || error.name || '';
  const errorMessage = error.message || '';

  // Check non-retryable first
  if (config.nonRetryableErrors) {
    for (const pattern of config.nonRetryableErrors) {
      if (errorCode.includes(pattern) || errorMessage.includes(pattern)) {
        return false;
      }
    }
  }

  // Check retryable
  if (config.retryableErrors) {
    for (const pattern of config.retryableErrors) {
      if (errorCode.includes(pattern) || errorMessage.includes(pattern)) {
        return true;
      }
    }
  }

  // Default: retry network errors
  return errorCode.startsWith('E') || errorMessage.includes('timeout');
}

/**
 * Sleep for a given duration
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create a timeout promise
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message = 'Operation timed out'
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${message} after ${timeoutMs}ms`));
    }, timeoutMs);

    promise
      .then(result => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch(error => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

// ============================================================================
// Retry Executor
// ============================================================================

/**
 * Execute an operation with retry logic
 */
export async function retry<T>(
  operation: () => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<RetryResult<T>> {
  const fullConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  const attempts: RetryAttempt[] = [];
  const startTime = Date.now();

  for (let attempt = 1; attempt <= fullConfig.maxAttempts; attempt++) {
    const attemptRecord: RetryAttempt = {
      attempt,
      startTime: Date.now(),
      success: false,
    };

    try {
      let result: T;

      if (fullConfig.attemptTimeoutMs) {
        result = await withTimeout(operation(), fullConfig.attemptTimeoutMs);
      } else {
        result = await operation();
      }

      attemptRecord.success = true;
      attemptRecord.endTime = Date.now();
      attempts.push(attemptRecord);

      return {
        success: true,
        value: result,
        attempts,
        totalDurationMs: Date.now() - startTime,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      attemptRecord.error = err;
      attemptRecord.endTime = Date.now();
      attempts.push(attemptRecord);

      // Check if we should retry
      if (attempt < fullConfig.maxAttempts && isRetryable(err, fullConfig)) {
        const delay = calculateDelay(attempt, fullConfig);
        attemptRecord.delayMs = delay;
        await sleep(delay);
      } else {
        // No more retries
        return {
          success: false,
          error: err,
          attempts,
          totalDurationMs: Date.now() - startTime,
        };
      }
    }
  }

  // Should not reach here
  return {
    success: false,
    error: new Error('Max retry attempts exceeded'),
    attempts,
    totalDurationMs: Date.now() - startTime,
  };
}

/**
 * Execute with retry and return value or throw
 */
export async function retryOrThrow<T>(
  operation: () => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<T> {
  const result = await retry(operation, config);

  if (!result.success) {
    const error = result.error || new Error('Operation failed');
    (error as Error & { retryAttempts?: RetryAttempt[] }).retryAttempts = result.attempts;
    throw error;
  }

  return result.value!;
}

// ============================================================================
// Circuit Breaker
// ============================================================================

export class CircuitBreaker extends EventEmitter {
  private config: CircuitBreakerConfig;
  private state: CircuitState = 'closed';
  private failures: Array<{ time: number; error: Error }> = [];
  private successes: number = 0;
  private openedAt?: number;
  private stats = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    rejectedRequests: 0,
  };

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...config };
  }

  /**
   * Execute an operation through the circuit breaker
   */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    this.stats.totalRequests++;

    // Check circuit state
    if (this.state === 'open') {
      // Check if we should transition to half-open
      if (this.shouldProbe()) {
        this.transitionTo('half-open');
      } else {
        this.stats.rejectedRequests++;
        this.emit('rejected');
        throw new CircuitOpenError('Circuit breaker is open');
      }
    }

    try {
      let result: T;

      if (this.state === 'half-open') {
        this.emit('probe');
        result = await withTimeout(operation(), this.config.probeTimeoutMs);
      } else {
        result = await operation();
      }

      this.recordSuccess();
      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.recordFailure(err);
      throw err;
    }
  }

  /**
   * Record a successful operation
   */
  private recordSuccess(): void {
    this.stats.successfulRequests++;
    this.emit('success');

    if (this.state === 'half-open') {
      this.successes++;
      if (this.successes >= this.config.successThreshold) {
        this.transitionTo('closed');
      }
    }

    // Clear old failures
    this.cleanupFailures();
  }

  /**
   * Record a failed operation
   */
  private recordFailure(error: Error): void {
    this.stats.failedRequests++;
    this.emit('failure', error);

    const now = Date.now();
    this.failures.push({ time: now, error });
    this.cleanupFailures();

    if (this.state === 'half-open') {
      // Any failure in half-open goes back to open
      this.transitionTo('open');
    } else if (this.state === 'closed') {
      // Check if we need to open
      const recentFailures = this.failures.filter(
        f => f.time > now - this.config.failureWindowMs
      );

      if (recentFailures.length >= this.config.failureThreshold) {
        this.transitionTo('open');
      }
    }
  }

  /**
   * Check if we should probe (transition from open to half-open)
   */
  private shouldProbe(): boolean {
    if (!this.openedAt) return false;
    return Date.now() - this.openedAt >= this.config.resetTimeoutMs;
  }

  /**
   * Transition to a new state
   */
  private transitionTo(newState: CircuitState): void {
    const oldState = this.state;
    this.state = newState;

    if (newState === 'open') {
      this.openedAt = Date.now();
      this.successes = 0;
    } else if (newState === 'closed') {
      this.failures = [];
      this.successes = 0;
      this.openedAt = undefined;
    } else if (newState === 'half-open') {
      this.successes = 0;
    }

    this.emit('state-change', oldState, newState);
  }

  /**
   * Remove old failures outside the window
   */
  private cleanupFailures(): void {
    const cutoff = Date.now() - this.config.failureWindowMs;
    this.failures = this.failures.filter(f => f.time > cutoff);
  }

  /**
   * Get current state
   */
  getState(): CircuitState {
    // Check if we should auto-transition to half-open
    if (this.state === 'open' && this.shouldProbe()) {
      this.transitionTo('half-open');
    }
    return this.state;
  }

  /**
   * Get statistics
   */
  getStats(): CircuitBreakerStats {
    return {
      state: this.getState(),
      failures: this.failures.length,
      successes: this.successes,
      lastFailureTime: this.failures[this.failures.length - 1]?.time,
      lastSuccessTime: undefined, // Not tracked
      openedAt: this.openedAt,
      ...this.stats,
    };
  }

  /**
   * Manually reset the circuit breaker
   */
  reset(): void {
    this.transitionTo('closed');
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      rejectedRequests: 0,
    };
  }

  /**
   * Force open the circuit
   */
  trip(): void {
    if (this.state !== 'open') {
      this.transitionTo('open');
    }
  }
}

/**
 * Error thrown when circuit is open
 */
export class CircuitOpenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CircuitOpenError';
  }
}

// ============================================================================
// Retry Manager (combines retry + circuit breaker)
// ============================================================================

export interface RetryManagerConfig {
  retry: Partial<RetryConfig>;
  circuitBreaker: Partial<CircuitBreakerConfig>;
  useCircuitBreaker: boolean;
}

export const DEFAULT_RETRY_MANAGER_CONFIG: RetryManagerConfig = {
  retry: {},
  circuitBreaker: {},
  useCircuitBreaker: true,
};

export class RetryManager extends EventEmitter {
  private config: RetryManagerConfig;
  private circuitBreakers: Map<string, CircuitBreaker> = new Map();

  constructor(config: Partial<RetryManagerConfig> = {}) {
    super();
    this.config = {
      retry: { ...DEFAULT_RETRY_CONFIG, ...config.retry },
      circuitBreaker: { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...config.circuitBreaker },
      useCircuitBreaker: config.useCircuitBreaker ?? true,
    };
  }

  /**
   * Get or create a circuit breaker for a service
   */
  private getCircuitBreaker(serviceId: string): CircuitBreaker {
    let breaker = this.circuitBreakers.get(serviceId);

    if (!breaker) {
      breaker = new CircuitBreaker(this.config.circuitBreaker);

      // Forward events
      breaker.on('state-change', (from, to) => {
        this.emit('circuit-state-change', serviceId, from, to);
      });
      breaker.on('failure', (error) => {
        this.emit('circuit-failure', serviceId, error);
      });
      breaker.on('rejected', () => {
        this.emit('circuit-rejected', serviceId);
      });

      this.circuitBreakers.set(serviceId, breaker);
    }

    return breaker;
  }

  /**
   * Execute an operation with retry and circuit breaker
   */
  async execute<T>(
    serviceId: string,
    operation: () => Promise<T>,
    config?: Partial<RetryConfig>
  ): Promise<RetryResult<T>> {
    const retryConfig = { ...this.config.retry, ...config };

    if (!this.config.useCircuitBreaker) {
      return retry(operation, retryConfig);
    }

    const breaker = this.getCircuitBreaker(serviceId);

    return retry(async () => {
      return breaker.execute(operation);
    }, retryConfig);
  }

  /**
   * Execute and return value or throw
   */
  async executeOrThrow<T>(
    serviceId: string,
    operation: () => Promise<T>,
    config?: Partial<RetryConfig>
  ): Promise<T> {
    const result = await this.execute(serviceId, operation, config);

    if (!result.success) {
      throw result.error;
    }

    return result.value!;
  }

  /**
   * Get circuit breaker state for a service
   */
  getCircuitState(serviceId: string): CircuitState | undefined {
    return this.circuitBreakers.get(serviceId)?.getState();
  }

  /**
   * Get circuit breaker stats for a service
   */
  getCircuitStats(serviceId: string): CircuitBreakerStats | undefined {
    return this.circuitBreakers.get(serviceId)?.getStats();
  }

  /**
   * Get all circuit breaker stats
   */
  getAllStats(): Map<string, CircuitBreakerStats> {
    const stats = new Map<string, CircuitBreakerStats>();

    for (const [id, breaker] of this.circuitBreakers) {
      stats.set(id, breaker.getStats());
    }

    return stats;
  }

  /**
   * Reset a specific circuit breaker
   */
  resetCircuit(serviceId: string): boolean {
    const breaker = this.circuitBreakers.get(serviceId);
    if (breaker) {
      breaker.reset();
      return true;
    }
    return false;
  }

  /**
   * Reset all circuit breakers
   */
  resetAllCircuits(): void {
    for (const breaker of this.circuitBreakers.values()) {
      breaker.reset();
    }
  }

  /**
   * Clear a circuit breaker
   */
  clearCircuit(serviceId: string): boolean {
    return this.circuitBreakers.delete(serviceId);
  }

  /**
   * Clear all circuit breakers
   */
  clearAllCircuits(): void {
    this.circuitBreakers.clear();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let retryManagerInstance: RetryManager | null = null;

export function getRetryManager(config?: Partial<RetryManagerConfig>): RetryManager {
  if (!retryManagerInstance) {
    retryManagerInstance = new RetryManager(config);
  }
  return retryManagerInstance;
}

export function resetRetryManager(): void {
  if (retryManagerInstance) {
    retryManagerInstance.clearAllCircuits();
    retryManagerInstance = null;
  }
}

// ============================================================================
// Convenience Decorators
// ============================================================================

/**
 * Create a retryable version of a function
 */
export function withRetry<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  config?: Partial<RetryConfig>
): T {
  return (async (...args: Parameters<T>) => {
    return retryOrThrow(() => fn(...args), config);
  }) as T;
}

/**
 * Create a function protected by circuit breaker
 */
export function withCircuitBreaker<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  serviceId: string,
  config?: Partial<CircuitBreakerConfig>
): T {
  const breaker = new CircuitBreaker(config);

  return (async (...args: Parameters<T>) => {
    return breaker.execute(() => fn(...args));
  }) as T;
}

/**
 * Create a function with both retry and circuit breaker
 */
export function withRetryAndCircuitBreaker<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  serviceId: string,
  config?: Partial<RetryManagerConfig>
): T {
  const manager = new RetryManager(config);

  return (async (...args: Parameters<T>) => {
    return manager.executeOrThrow(serviceId, () => fn(...args));
  }) as T;
}
