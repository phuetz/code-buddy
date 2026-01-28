/**
 * Stream Helpers
 *
 * Standardized utilities for handling async iterables and stream operations
 * with proper error handling, timeouts, and iteration limits.
 */

import { TimeoutError } from './errors.js';
import { logger } from './logger.js';

// ============================================================================
// Types
// ============================================================================

export interface StreamTimeoutOptions {
  /** Timeout in milliseconds between iterations */
  timeoutMs: number;
  /** Custom error message for timeout */
  errorMessage?: string;
}

export interface SafeStreamReadOptions {
  /** Context for error logging */
  context?: string;
  /** Whether to release the lock on error */
  releaseLockOnError?: boolean;
  /** Maximum number of retry attempts for transient errors */
  maxRetries?: number;
}

export interface SafeStreamReadResult<T> {
  /** Whether the read was successful */
  success: boolean;
  /** The value read from the stream (if successful and not done) */
  value?: T;
  /** Whether the stream is done */
  done: boolean;
  /** Error if the read failed */
  error?: Error;
}

export interface StreamErrorContext {
  /** Source of the stream error */
  source: string;
  /** Operation being performed when error occurred */
  operation?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

// ============================================================================
// withTimeout for Async Iterables
// ============================================================================

/**
 * Wraps an async iterable with a timeout between iterations.
 *
 * If no value is yielded within the timeout period, throws a TimeoutError.
 * This is useful for preventing infinite waits on streaming responses.
 *
 * @example
 * ```typescript
 * // Add 30 second timeout between chunks
 * for await (const chunk of withStreamTimeout(stream, { timeoutMs: 30000 })) {
 *   process.stdout.write(chunk);
 * }
 * ```
 */
export async function* withStreamTimeout<T>(
  asyncIterable: AsyncIterable<T>,
  options: StreamTimeoutOptions
): AsyncGenerator<T, void, undefined> {
  const { timeoutMs, errorMessage = 'Stream iteration timed out' } = options;
  const iterator = asyncIterable[Symbol.asyncIterator]();

  try {
    while (true) {
      const result = await Promise.race([
        iterator.next(),
        new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(new TimeoutError(errorMessage, timeoutMs));
          }, timeoutMs);
        }),
      ]);

      if (result.done) {
        return;
      }

      yield result.value;
    }
  } finally {
    // Clean up the iterator if it has a return method
    if (iterator.return) {
      await iterator.return(undefined);
    }
  }
}

// ============================================================================
// Safe Stream Read
// ============================================================================

/**
 * Safely reads from a ReadableStreamDefaultReader with error handling.
 *
 * Wraps the read operation with proper error catching and optional retry logic.
 * Returns a result object instead of throwing, making it easier to handle errors.
 *
 * @example
 * ```typescript
 * const reader = response.body?.getReader();
 * if (!reader) throw new Error('No body');
 *
 * while (true) {
 *   const result = await safeStreamRead(reader, { context: 'OllamaStream' });
 *   if (!result.success) {
 *     handleStreamError(result.error!, { source: 'OllamaProvider' });
 *     break;
 *   }
 *   if (result.done) break;
 *   processChunk(result.value);
 * }
 * ```
 */
export async function safeStreamRead<T>(
  reader: ReadableStreamDefaultReader<T>,
  options: SafeStreamReadOptions = {}
): Promise<SafeStreamReadResult<T>> {
  const { context = 'Stream', maxRetries = 0 } = options;
  let lastError: Error | undefined;
  let attempts = 0;

  while (attempts <= maxRetries) {
    try {
      const { done, value } = await reader.read();
      return {
        success: true,
        done,
        value: done ? undefined : value,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      attempts++;

      if (attempts <= maxRetries) {
        logger.debug(`[${context}] Read failed, retrying (attempt ${attempts}/${maxRetries})`, {
          source: 'stream-helpers',
          error: lastError.message,
        });
        // Small delay before retry
        await new Promise(resolve => setTimeout(resolve, 100 * attempts));
      }
    }
  }

  return {
    success: false,
    done: true,
    error: lastError,
  };
}

// ============================================================================
// withMaxIterations
// ============================================================================

/**
 * Limits the number of iterations on an async iterator to prevent infinite loops.
 *
 * This is a safety mechanism for streams that might not terminate properly.
 * When the max is reached, the iterator is gracefully terminated.
 *
 * @example
 * ```typescript
 * // Limit to 1000 chunks maximum
 * for await (const chunk of withMaxIterations(stream, 1000)) {
 *   processChunk(chunk);
 * }
 * ```
 */
export async function* withMaxIterations<T>(
  asyncIterable: AsyncIterable<T>,
  maxIterations: number,
  options: {
    /** Callback when max iterations reached */
    onMaxReached?: (count: number) => void;
    /** Context for logging */
    context?: string;
  } = {}
): AsyncGenerator<T, void, undefined> {
  const { onMaxReached, context = 'Stream' } = options;
  const iterator = asyncIterable[Symbol.asyncIterator]();
  let count = 0;

  try {
    while (count < maxIterations) {
      const result = await iterator.next();

      if (result.done) {
        return;
      }

      count++;
      yield result.value;
    }

    // Max iterations reached
    logger.warn(`[${context}] Max iterations reached: ${maxIterations}`, {
      source: 'stream-helpers',
    });
    onMaxReached?.(count);
  } finally {
    // Clean up the iterator
    if (iterator.return) {
      await iterator.return(undefined);
    }
  }
}

// ============================================================================
// handleStreamError
// ============================================================================

/**
 * Standardized error logging for stream operations.
 *
 * Provides consistent error formatting and logging for all stream-related errors.
 * Also categorizes errors to help with debugging and monitoring.
 *
 * @example
 * ```typescript
 * try {
 *   for await (const chunk of stream) {
 *     processChunk(chunk);
 *   }
 * } catch (error) {
 *   handleStreamError(error, {
 *     source: 'OllamaProvider',
 *     operation: 'streaming response',
 *     metadata: { model: 'llama3.1' }
 *   });
 * }
 * ```
 */
export function handleStreamError(
  error: unknown,
  context: StreamErrorContext
): {
  message: string;
  category: 'timeout' | 'network' | 'parse' | 'abort' | 'unknown';
  isRetryable: boolean;
} {
  const { source, operation = 'stream operation', metadata } = context;
  const errorMessage = error instanceof Error ? error.message : String(error);

  // Categorize the error
  let category: 'timeout' | 'network' | 'parse' | 'abort' | 'unknown' = 'unknown';
  let isRetryable = false;

  if (error instanceof TimeoutError) {
    category = 'timeout';
    isRetryable = true;
  } else if (errorMessage.includes('network') || errorMessage.includes('ECONNREFUSED') ||
             errorMessage.includes('ECONNRESET') || errorMessage.includes('ETIMEDOUT') ||
             errorMessage.includes('fetch failed')) {
    category = 'network';
    isRetryable = true;
  } else if (errorMessage.includes('JSON') || errorMessage.includes('parse') ||
             errorMessage.includes('Unexpected token')) {
    category = 'parse';
    isRetryable = false;
  } else if (errorMessage.includes('abort') || errorMessage.includes('cancel') ||
             error instanceof DOMException) {
    category = 'abort';
    isRetryable = false;
  }

  // Log the error with context
  const logMessage = `[${source}] Stream error during ${operation}: ${errorMessage}`;
  const logContext = {
    source,
    category,
    isRetryable,
    ...metadata,
  };

  if (category === 'abort') {
    // Aborts are often intentional, log at debug level
    logger.debug(logMessage, logContext);
  } else if (isRetryable) {
    logger.warn(logMessage, logContext);
  } else {
    logger.error(logMessage, logContext);
  }

  return {
    message: errorMessage,
    category,
    isRetryable,
  };
}

// ============================================================================
// Utility Helpers
// ============================================================================

/**
 * Creates an AbortController with automatic timeout.
 *
 * Returns both the controller and a cleanup function to cancel the timeout.
 *
 * @example
 * ```typescript
 * const { controller, cleanup } = createTimeoutController(30000);
 * try {
 *   const response = await fetch(url, { signal: controller.signal });
 *   // process response
 * } finally {
 *   cleanup();
 * }
 * ```
 */
export function createTimeoutController(timeoutMs: number): {
  controller: AbortController;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(new TimeoutError('Request timed out', timeoutMs));
  }, timeoutMs);

  return {
    controller,
    cleanup: () => clearTimeout(timeoutId),
  };
}

/**
 * Combines multiple AsyncIterables into one, yielding values as they arrive.
 *
 * Useful for merging multiple streams into a single stream.
 *
 * @example
 * ```typescript
 * const combined = mergeAsyncIterables([stream1, stream2, stream3]);
 * for await (const value of combined) {
 *   console.log(value);
 * }
 * ```
 */
export async function* mergeAsyncIterables<T>(
  iterables: AsyncIterable<T>[]
): AsyncGenerator<T, void, undefined> {
  const iterators = iterables.map(it => it[Symbol.asyncIterator]());
  const pending = new Map<number, Promise<{ index: number; result: IteratorResult<T> }>>();

  // Initialize all pending promises
  for (let i = 0; i < iterators.length; i++) {
    pending.set(
      i,
      iterators[i].next().then(result => ({ index: i, result }))
    );
  }

  try {
    while (pending.size > 0) {
      // Wait for any iterator to yield
      const { index, result } = await Promise.race(pending.values());

      if (result.done) {
        pending.delete(index);
      } else {
        yield result.value;
        // Queue next read from this iterator
        pending.set(
          index,
          iterators[index].next().then(r => ({ index, result: r }))
        );
      }
    }
  } finally {
    // Clean up all iterators
    for (const iterator of iterators) {
      if (iterator.return) {
        await iterator.return(undefined);
      }
    }
  }
}

/**
 * Drains an async iterable, consuming all values without processing.
 *
 * Useful for ensuring a stream is fully consumed (e.g., for cleanup).
 *
 * @example
 * ```typescript
 * // Ensure stream is fully consumed even if we don't need all values
 * await drainAsyncIterable(response.body);
 * ```
 */
export async function drainAsyncIterable<T>(
  asyncIterable: AsyncIterable<T>,
  options: { maxIterations?: number } = {}
): Promise<number> {
  const { maxIterations = Infinity } = options;
  let count = 0;

  for await (const _value of asyncIterable) {
    count++;
    if (count >= maxIterations) break;
  }

  return count;
}
