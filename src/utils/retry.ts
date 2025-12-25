/**
 * Generic retry utility with exponential backoff
 *
 * Provides configurable retry logic for any async operation with:
 * - Exponential backoff
 * - Jitter to prevent thundering herd
 * - Customizable retry conditions
 * - Timeout support
 * - Event callbacks
 */

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Base delay in ms between retries (default: 1000) */
  baseDelay?: number;
  /** Maximum delay in ms (default: 30000) */
  maxDelay?: number;
  /** Backoff multiplier (default: 2) */
  backoffFactor?: number;
  /** Add random jitter 0-25% (default: true) */
  jitter?: boolean;
  /** Timeout for entire operation in ms (default: none) */
  timeout?: number;
  /** Function to determine if error is retryable */
  isRetryable?: (error: unknown) => boolean;
  /** Callback before each retry */
  onRetry?: (error: unknown, attempt: number, delay: number) => void;
  /** Callback on final failure */
  onFailed?: (error: unknown, attempts: number) => void;
  /** Callback on success */
  onSuccess?: (result: unknown, attempts: number) => void;
  /** Abort signal to cancel retries */
  signal?: AbortSignal;
}

export interface RetryResult<T> {
  success: boolean;
  result?: T;
  error?: Error;
  attempts: number;
  totalTime: number;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'timeout' | 'signal' | 'onRetry' | 'onFailed' | 'onSuccess'>> = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 30000,
  backoffFactor: 2,
  jitter: true,
  isRetryable: () => true,
};

/**
 * Calculate delay with exponential backoff and optional jitter
 */
function calculateDelay(
  attempt: number,
  baseDelay: number,
  maxDelay: number,
  backoffFactor: number,
  jitter: boolean
): number {
  const exponentialDelay = baseDelay * Math.pow(backoffFactor, attempt);
  const clampedDelay = Math.min(exponentialDelay, maxDelay);

  if (jitter) {
    // Add 0-25% random jitter
    const jitterAmount = clampedDelay * 0.25 * Math.random();
    return clampedDelay + jitterAmount;
  }

  return clampedDelay;
}

/**
 * Sleep utility that respects abort signal
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Operation aborted'));
      return;
    }

    const timeoutId = setTimeout(resolve, ms);

    signal?.addEventListener('abort', () => {
      clearTimeout(timeoutId);
      reject(new Error('Operation aborted'));
    });
  });
}

/**
 * Execute a function with retry logic
 *
 * @param fn - The async function to retry
 * @param options - Retry configuration options
 * @returns Promise with the function result
 *
 * @example
 * ```typescript
 * const result = await retry(
 *   async () => fetch('https://api.example.com/data'),
 *   {
 *     maxRetries: 5,
 *     baseDelay: 500,
 *     isRetryable: (err) => err.message.includes('timeout'),
 *     onRetry: (err, attempt, delay) => {
 *       console.log(`Retry ${attempt} after ${delay}ms`);
 *     }
 *   }
 * );
 * ```
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const startTime = Date.now();
  let lastError: unknown;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    // Check abort signal
    if (opts.signal?.aborted) {
      throw new Error('Operation aborted');
    }

    // Check timeout
    if (opts.timeout && Date.now() - startTime > opts.timeout) {
      throw new Error(`Retry timeout exceeded after ${opts.timeout}ms`);
    }

    try {
      const result = await fn();
      opts.onSuccess?.(result, attempt + 1);
      return result;
    } catch (error) {
      lastError = error;

      // Check if we should retry
      const isLastAttempt = attempt === opts.maxRetries;
      const isRetryable = opts.isRetryable(error);

      if (isLastAttempt || !isRetryable) {
        opts.onFailed?.(error, attempt + 1);
        throw error;
      }

      // Calculate delay and wait
      const delay = calculateDelay(
        attempt,
        opts.baseDelay,
        opts.maxDelay,
        opts.backoffFactor,
        opts.jitter
      );

      opts.onRetry?.(error, attempt + 1, delay);

      await sleep(delay, opts.signal);
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError;
}

/**
 * Execute with retry and return a result object instead of throwing
 */
export async function retryWithResult<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<RetryResult<T>> {
  const startTime = Date.now();
  let attempts = 0;

  try {
    const modifiedOptions: RetryOptions = {
      ...options,
      onRetry: (error, attempt, delay) => {
        attempts = attempt;
        options.onRetry?.(error, attempt, delay);
      },
      onSuccess: (result, attemptCount) => {
        attempts = attemptCount;
        options.onSuccess?.(result, attemptCount);
      },
    };

    const result = await retry(fn, modifiedOptions);

    return {
      success: true,
      result,
      attempts,
      totalTime: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
      attempts,
      totalTime: Date.now() - startTime,
    };
  }
}

/**
 * Create a retryable version of a function
 */
export function withRetry<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  options: RetryOptions = {}
): (...args: TArgs) => Promise<TResult> {
  return (...args: TArgs) => retry(() => fn(...args), options);
}

/**
 * Retry decorator for class methods
 */
export function Retry(options: RetryOptions = {}) {
  return function <T extends (...args: unknown[]) => Promise<unknown>>(
    _target: unknown,
    _propertyKey: string,
    descriptor: TypedPropertyDescriptor<T>
  ): TypedPropertyDescriptor<T> {
    const originalMethod = descriptor.value;
    if (!originalMethod) return descriptor;

    descriptor.value = async function (this: unknown, ...args: unknown[]) {
      return retry(() => originalMethod.apply(this, args), options);
    } as T;

    return descriptor;
  };
}

/**
 * Common retry predicates for specific error types
 */
export const RetryPredicates = {
  /** Retry on network errors */
  networkError: (error: unknown): boolean => {
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    return (
      message.includes('network') ||
      message.includes('timeout') ||
      message.includes('econnreset') ||
      message.includes('econnrefused') ||
      message.includes('socket')
    );
  },

  /** Retry on HTTP 5xx errors */
  serverError: (error: unknown): boolean => {
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    return (
      message.includes('500') ||
      message.includes('502') ||
      message.includes('503') ||
      message.includes('504') ||
      message.includes('internal server error') ||
      message.includes('bad gateway') ||
      message.includes('service unavailable') ||
      message.includes('gateway timeout')
    );
  },

  /** Retry on rate limit errors (429) */
  rateLimitError: (error: unknown): boolean => {
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    return (
      message.includes('429') ||
      message.includes('rate limit') ||
      message.includes('too many requests') ||
      message.includes('throttl')
    );
  },

  /** Retry on any transient error */
  transientError: (error: unknown): boolean => {
    return (
      RetryPredicates.networkError(error) ||
      RetryPredicates.serverError(error) ||
      RetryPredicates.rateLimitError(error)
    );
  },

  /** Never retry (for explicit no-retry scenarios) */
  never: (): boolean => false,

  /** Always retry (default behavior) */
  always: (): boolean => true,
};

/**
 * Pre-configured retry strategies
 */
export const RetryStrategies = {
  /** Fast retries for local operations */
  fast: {
    maxRetries: 3,
    baseDelay: 100,
    maxDelay: 1000,
    backoffFactor: 2,
  } as RetryOptions,

  /** Standard retries for API calls */
  standard: {
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 10000,
    backoffFactor: 2,
    isRetryable: RetryPredicates.transientError,
  } as RetryOptions,

  /** Aggressive retries for critical operations */
  aggressive: {
    maxRetries: 5,
    baseDelay: 500,
    maxDelay: 30000,
    backoffFactor: 2,
    isRetryable: RetryPredicates.transientError,
  } as RetryOptions,

  /** Patient retries for rate-limited APIs */
  patient: {
    maxRetries: 10,
    baseDelay: 2000,
    maxDelay: 60000,
    backoffFactor: 2,
    isRetryable: RetryPredicates.rateLimitError,
  } as RetryOptions,

  /** No retries */
  none: {
    maxRetries: 0,
  } as RetryOptions,
};
