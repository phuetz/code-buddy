/** Compatibility API for the central bounded retry policy. Generated output is never replayed. */
import { classifyProviderError } from './provider-error-classifier.js';
import { withLlmStreamRetry } from './llm-retry.js';

export interface StreamRetryOptions {
  /** Max retry attempts (the initial call counts as attempt 1; default 4 = 1 initial + 3 retries). */
  maxAttempts?: number;
  /** Initial delay in ms before the first retry (default 1000). */
  initialDelayMs?: number;
  /** Cap for exponential backoff (default 8000). */
  maxDelayMs?: number;
  /**
   * Predicate deciding whether an error is worth retrying. Default
   * heuristic: retry on network-ish errors (ECONNRESET, ETIMEDOUT,
   * fetch aborted by network, undici stream errors). Non-retryable
   * errors (auth failures, validation errors, 4xx semantic errors)
   * propagate immediately.
   */
  isRetryable?: (err: unknown) => boolean;
  /** Optional abort signal — cancels pending retry waits. */
  signal?: AbortSignal;
  /** Optional callback fired before each retry attempt (debug / metrics). */
  onRetry?: (attempt: number, delayMs: number, err: unknown) => void;
}

const DEFAULT_OPTIONS: Required<Omit<StreamRetryOptions, 'signal' | 'onRetry'>> = {
  maxAttempts: 4,
  initialDelayMs: 1000,
  maxDelayMs: 8000,
  isRetryable: defaultIsRetryable,
};

/**
 * Default heuristic for retryability. Delegates to the HTTP-aware
 * `classifyProviderError` so the predicate covers both the classic network
 * errors (ECONNRESET, socket hang up, undici stream terminated …) AND HTTP
 * status codes (408/425/429/5xx retryable; fatal 429/quota/auth/invalid fail
 * fast). A fatal error is, by construction, `retryable === false`.
 */
function defaultIsRetryable(err: unknown): boolean {
  return !(err as { retryHandled?: boolean } | null)?.retryHandled && classifyProviderError(err).retryable;
}

/**
 * Wrap an async generator factory with exponential-backoff retry.
 * On each retry, calls `factory()` to get a FRESH generator (the
 * caller is responsible for that factory being safe to re-invoke).
 *
 * Usage:
 *
 *   const factory = () => client.chatStream(messages, tools, opts);
 *   for await (const chunk of withStreamRetry(factory, { maxAttempts: 4 })) {
 *     // handle chunk
 *   }
 *
 * Yields every event from the (possibly retried) inner generator,
 * A failure after generated output preserves its cause and stops without restarting. Throws
 * synchronously when retries are exhausted OR when an error is not
 * retryable (per the predicate).
 */
export async function* withStreamRetry<T>(
  factory: () => AsyncGenerator<T> | AsyncIterable<T>,
  options: StreamRetryOptions = {},
): AsyncGenerator<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_OPTIONS.maxAttempts;
  if (maxAttempts < 1) throw new Error('withStreamRetry: maxAttempts must be >= 1');
  for await (const event of withLlmStreamRetry(factory, {
    maxRetries: maxAttempts - 1,
    baseDelayMs: options.initialDelayMs ?? DEFAULT_OPTIONS.initialDelayMs,
    maxDelayMs: options.maxDelayMs ?? DEFAULT_OPTIONS.maxDelayMs,
    isRetryable: options.isRetryable ?? DEFAULT_OPTIONS.isRetryable,
    signal: options.signal,
    onRetry: (attempt, _max, delay, error) => options.onRetry?.(attempt, delay, error),
  })) {
    if (event.type === 'value') yield event.value;
  }
}

/** Test-only: re-export the default isRetryable predicate for direct testing. */
export const _defaultIsRetryableForTests = defaultIsRetryable;

/**
 * Re-export the HTTP-aware classifier so callers wiring their own predicate
 * (or inspecting a fatal/quota verdict) can reach it from the stream-retry
 * module without a second import.
 */
export {
  classifyProviderError,
  parseRetryAfter,
  preserveProviderErrorMetadata,
  MAX_RETRY_AFTER_MS,
  type ProviderErrorClassification,
} from './provider-error-classifier.js';
