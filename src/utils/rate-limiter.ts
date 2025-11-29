/**
 * Rate Limiter for API calls
 *
 * Implements token bucket algorithm with automatic retry and backoff.
 * Prevents API rate limit errors and provides queue management.
 */

import { EventEmitter } from 'events';

export interface RateLimitConfig {
  // Requests per minute
  requestsPerMinute: number;
  // Tokens per minute (for token-based limits)
  tokensPerMinute: number;
  // Maximum burst size
  maxBurst: number;
  // Retry configuration
  maxRetries: number;
  baseRetryDelay: number; // ms
  maxRetryDelay: number; // ms
  // Queue configuration
  maxQueueSize: number;
  queueTimeout: number; // ms
}

export interface RateLimitStatus {
  requestsRemaining: number;
  tokensRemaining: number;
  resetTime: Date;
  queueLength: number;
  isLimited: boolean;
}

export interface QueuedRequest<T> {
  id: string;
  execute: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  priority: number;
  timestamp: number;
  estimatedTokens: number;
  retries: number;
}

const DEFAULT_CONFIG: RateLimitConfig = {
  requestsPerMinute: 60,
  tokensPerMinute: 100000,
  maxBurst: 10,
  maxRetries: 3,
  baseRetryDelay: 1000,
  maxRetryDelay: 32000,
  maxQueueSize: 100,
  queueTimeout: 60000,
};

/**
 * Token Bucket Rate Limiter
 */
export class RateLimiter extends EventEmitter {
  private config: RateLimitConfig;
  private requestTokens: number;
  private apiTokens: number;
  private lastRefill: number;
  private queue: QueuedRequest<unknown>[] = [];
  private processing: boolean = false;
  private requestIdCounter: number = 0;

  constructor(config: Partial<RateLimitConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.requestTokens = this.config.maxBurst;
    this.apiTokens = this.config.tokensPerMinute;
    this.lastRefill = Date.now();
  }

  /**
   * Refill tokens based on elapsed time
   */
  private refillTokens(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const minutes = elapsed / 60000;

    // Refill request tokens
    const requestRefill = minutes * this.config.requestsPerMinute;
    this.requestTokens = Math.min(
      this.config.maxBurst,
      this.requestTokens + requestRefill
    );

    // Refill API tokens
    const tokenRefill = minutes * this.config.tokensPerMinute;
    this.apiTokens = Math.min(
      this.config.tokensPerMinute,
      this.apiTokens + tokenRefill
    );

    this.lastRefill = now;
  }

  /**
   * Check if request can proceed
   */
  private canProceed(estimatedTokens: number = 0): boolean {
    this.refillTokens();
    return this.requestTokens >= 1 && this.apiTokens >= estimatedTokens;
  }

  /**
   * Consume tokens for a request
   */
  private consumeTokens(estimatedTokens: number): void {
    this.requestTokens -= 1;
    this.apiTokens -= estimatedTokens;
  }

  /**
   * Calculate retry delay with exponential backoff
   */
  private calculateRetryDelay(retryCount: number): number {
    const delay = this.config.baseRetryDelay * Math.pow(2, retryCount);
    // Add jitter (0-25% of delay)
    const jitter = delay * 0.25 * Math.random();
    return Math.min(delay + jitter, this.config.maxRetryDelay);
  }

  /**
   * Execute a rate-limited request
   */
  async execute<T>(
    fn: () => Promise<T>,
    options: {
      priority?: number;
      estimatedTokens?: number;
      skipQueue?: boolean;
    } = {}
  ): Promise<T> {
    const { priority = 0, estimatedTokens = 100, skipQueue = false } = options;

    // Check if we can proceed immediately
    if (skipQueue && this.canProceed(estimatedTokens)) {
      this.consumeTokens(estimatedTokens);
      return this.executeWithRetry(fn, estimatedTokens);
    }

    // Add to queue
    return new Promise((resolve, reject) => {
      const request: QueuedRequest<T> = {
        id: `req_${++this.requestIdCounter}`,
        execute: fn,
        resolve: resolve as (value: unknown) => void,
        reject,
        priority,
        timestamp: Date.now(),
        estimatedTokens,
        retries: 0,
      };

      // Check queue size
      if (this.queue.length >= this.config.maxQueueSize) {
        reject(new Error('Rate limit queue is full'));
        return;
      }

      this.queue.push(request as QueuedRequest<unknown>);
      this.queue.sort((a, b) => b.priority - a.priority);

      this.emit('queued', { requestId: request.id, queueLength: this.queue.length });

      // Start processing if not already
      this.processQueue();

      // Set timeout
      setTimeout(() => {
        const index = this.queue.findIndex(r => r.id === request.id);
        if (index !== -1) {
          this.queue.splice(index, 1);
          reject(new Error('Rate limit queue timeout'));
        }
      }, this.config.queueTimeout);
    });
  }

  /**
   * Execute with retry logic
   */
  private async executeWithRetry<T>(
    fn: () => Promise<T>,
    estimatedTokens: number,
    retryCount: number = 0
  ): Promise<T> {
    try {
      const result = await fn();
      this.emit('success', { retries: retryCount });
      return result;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Check if rate limit error
      const isRateLimitError =
        errorMessage.includes('rate limit') ||
        errorMessage.includes('429') ||
        errorMessage.includes('too many requests');

      if (isRateLimitError && retryCount < this.config.maxRetries) {
        const delay = this.calculateRetryDelay(retryCount);

        this.emit('retry', {
          retryCount: retryCount + 1,
          delay,
          error: errorMessage,
        });

        await this.sleep(delay);

        // Refill some tokens after waiting
        this.refillTokens();

        return this.executeWithRetry(fn, estimatedTokens, retryCount + 1);
      }

      this.emit('error', { error: errorMessage, retries: retryCount });
      throw error;
    }
  }

  /**
   * Process queued requests
   */
  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const request = this.queue[0];

      // Wait until we can proceed
      while (!this.canProceed(request.estimatedTokens)) {
        await this.sleep(100);
        this.refillTokens();
      }

      // Remove from queue and execute
      this.queue.shift();
      this.consumeTokens(request.estimatedTokens);

      try {
        const result = await this.executeWithRetry(
          request.execute,
          request.estimatedTokens,
          request.retries
        );
        request.resolve(result);
      } catch (error) {
        request.reject(error as Error);
      }
    }

    this.processing = false;
  }

  /**
   * Get current rate limit status
   */
  getStatus(): RateLimitStatus {
    this.refillTokens();

    const now = Date.now();
    const timeToFullRefill = Math.max(0,
      60000 - (now - this.lastRefill)
    );

    return {
      requestsRemaining: Math.floor(this.requestTokens),
      tokensRemaining: Math.floor(this.apiTokens),
      resetTime: new Date(now + timeToFullRefill),
      queueLength: this.queue.length,
      isLimited: this.requestTokens < 1 || this.queue.length > 0,
    };
  }

  /**
   * Update rate limit from API response headers
   */
  updateFromHeaders(headers: {
    'x-ratelimit-remaining'?: string;
    'x-ratelimit-limit'?: string;
    'x-ratelimit-reset'?: string;
    'retry-after'?: string;
  }): void {
    if (headers['x-ratelimit-remaining']) {
      const remaining = parseInt(headers['x-ratelimit-remaining'], 10);
      if (!isNaN(remaining)) {
        this.requestTokens = Math.min(remaining, this.config.maxBurst);
      }
    }

    if (headers['retry-after']) {
      const retryAfter = parseInt(headers['retry-after'], 10);
      if (!isNaN(retryAfter)) {
        // Pause for the specified duration
        this.requestTokens = 0;
        setTimeout(() => {
          this.refillTokens();
        }, retryAfter * 1000);
      }
    }
  }

  /**
   * Clear the queue
   */
  clearQueue(): number {
    const count = this.queue.length;
    for (const request of this.queue) {
      request.reject(new Error('Queue cleared'));
    }
    this.queue = [];
    return count;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<RateLimitConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Format status for display
   */
  formatStatus(): string {
    const status = this.getStatus();
    const lines = [
      '╔══════════════════════════════════════╗',
      '║        RATE LIMIT STATUS             ║',
      '╠══════════════════════════════════════╣',
      `║ Requests remaining: ${status.requestsRemaining.toString().padStart(5)}          ║`,
      `║ Tokens remaining:   ${status.tokensRemaining.toString().padStart(5)}          ║`,
      `║ Queue length:       ${status.queueLength.toString().padStart(5)}          ║`,
      `║ Limited:            ${(status.isLimited ? 'YES' : 'NO').padStart(5)}          ║`,
      `║ Reset: ${status.resetTime.toLocaleTimeString().padEnd(20)}    ║`,
      '╚══════════════════════════════════════╝',
    ];
    return lines.join('\n');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Singleton instance
let rateLimiterInstance: RateLimiter | null = null;

export function getRateLimiter(config?: Partial<RateLimitConfig>): RateLimiter {
  if (!rateLimiterInstance) {
    rateLimiterInstance = new RateLimiter(config);
  }
  return rateLimiterInstance;
}

export function resetRateLimiter(): void {
  if (rateLimiterInstance) {
    rateLimiterInstance.clearQueue();
  }
  rateLimiterInstance = null;
}

/**
 * Decorator for rate-limited methods
 */
export function rateLimited(estimatedTokens: number = 100, priority: number = 0) {
  return function <T extends (...args: unknown[]) => Promise<unknown>>(
    _target: unknown,
    _propertyKey: string,
    descriptor: TypedPropertyDescriptor<T>
  ): TypedPropertyDescriptor<T> {
    const originalMethod = descriptor.value;
    if (!originalMethod) return descriptor;

    descriptor.value = async function (this: unknown, ...args: unknown[]) {
      const limiter = getRateLimiter();
      return limiter.execute(
        () => originalMethod.apply(this, args),
        { estimatedTokens, priority }
      );
    } as T;

    return descriptor;
  };
}
