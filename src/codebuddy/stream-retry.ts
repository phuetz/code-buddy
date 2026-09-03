/**
 * Stream retry helper — wraps an async generator factory with
 * exponential-backoff retry on retryable errors.
 *
 * Derived from the comparative audit Gemini CLI vs Code Buddy
 * (private-handover-repo/propositions/AUDIT-GEMINI-CLI-AGENTIC-LOOP-2026-05-04.md,
 * recommendation #1 — vrai gap, M scope).
 *
 * Problem
 * -------
 * Gemini CLI's `geminiChat.ts` has `MID_STREAM_RETRY_OPTIONS` (4 max
 * attempts, 1s initial delay, exponential backoff) for mid-stream
 * network failures. Code Buddy's `CodeBuddyClient.chatStream()` has
 * NO equivalent — if the network drops between two chunks, the
 * caller sees the error directly, has to handle it themselves, and
 * loses all the chunks already streamed.
 *
 * Solution
 * --------
 * A pure higher-order async generator that takes a `factory` (produces
 * the generator to retry) plus retry options, and re-yields all events.
 * On a retryable error, it waits with exponential backoff and re-calls
 * the factory (which produces a fresh stream from the start). The
 * caller decides what's retryable via a predicate.
 *
 * Trade-off: a retried stream restarts from the beginning. The caller
 * sees duplicate chunks across the retry boundary. This matches Gemini
 * CLI's behavior — true delta-resume requires LLM-level support that
 * doesn't exist today.
 *
 * Standalone module: pure function, easily testable, opt-in at the
 * call site. Does NOT modify `CodeBuddyClient.chatStream()` itself —
 * zero risk to existing callers.
 *
 * HTTP-aware classification (2026-07)
 * -----------------------------------
 * Retryability now delegates to `classifyProviderError` (see
 * `provider-error-classifier.ts`), so the predicate is no longer blind to
 * HTTP status codes: 408/425/429/5xx are retryable, while a *fatal* 429
 * (`insufficient_quota` / auth / invalid request) fails fast instead of
 * re-knocking on a closed door. When the error carries a `Retry-After`, the
 * back-off waits exactly that (bounded) instead of the blind exponential.
 */

/**
 * Options controlling the retry behavior. Mirrors Gemini CLI's
 * `MID_STREAM_RETRY_OPTIONS` shape with sensible defaults.
 */
import { classifyProviderError } from './provider-error-classifier.js';

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
  return classifyProviderError(err).retryable;
}

/**
 * Server-instructed back-off (ms) for this error, if any, already bounded to
 * a sane max by the classifier. Used to override the blind exponential delay
 * when the provider sent a `Retry-After`.
 */
function retryAfterDelayMs(err: unknown): number | undefined {
  return classifyProviderError(err).retryAfterMs;
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
 * including the duplicated prefix when a retry happens. Throws
 * synchronously when retries are exhausted OR when an error is not
 * retryable (per the predicate).
 */
export async function* withStreamRetry<T>(
  factory: () => AsyncGenerator<T> | AsyncIterable<T>,
  options: StreamRetryOptions = {},
): AsyncGenerator<T> {
  const opts = {
    maxAttempts: options.maxAttempts ?? DEFAULT_OPTIONS.maxAttempts,
    initialDelayMs: options.initialDelayMs ?? DEFAULT_OPTIONS.initialDelayMs,
    maxDelayMs: options.maxDelayMs ?? DEFAULT_OPTIONS.maxDelayMs,
    isRetryable: options.isRetryable ?? DEFAULT_OPTIONS.isRetryable,
    signal: options.signal,
    onRetry: options.onRetry,
  };

  if (opts.maxAttempts < 1) {
    throw new Error('withStreamRetry: maxAttempts must be >= 1');
  }

  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    attempt++;
    try {
      const gen = factory();
      yield* gen as AsyncIterable<T>;
      return;
    } catch (err) {
      if (attempt >= opts.maxAttempts) {
        throw err;
      }
      if (!opts.isRetryable(err)) {
        throw err;
      }
      // Honour a server-sent Retry-After (already bounded to MAX_RETRY_AFTER_MS
      // by the classifier) — it overrides the blind exponential back-off,
      // including opts.maxDelayMs, since the server told us exactly how long to
      // wait. Otherwise fall back to exponential: initial * 2^(attempt-1),
      // capped at max.
      const serverDelay = retryAfterDelayMs(err);
      const delay = serverDelay !== undefined
        ? serverDelay
        : Math.min(
            opts.initialDelayMs * Math.pow(2, attempt - 1),
            opts.maxDelayMs,
          );
      opts.onRetry?.(attempt, delay, err);
      await waitWithAbort(delay, opts.signal);
    }
  }
}

/**
 * Sleep for `ms` milliseconds, but bail out early if the signal aborts.
 * Throws an `AbortError`-shaped error if aborted (matching node fetch
 * convention so callers can handle uniformly).
 */
async function waitWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    const err = new Error('Stream retry aborted by signal');
    (err as Error & { name?: string }).name = 'AbortError';
    throw err;
  }
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    timer.unref?.();
    const onAbort = () => {
      cleanup();
      const err = new Error('Stream retry aborted by signal');
      (err as Error & { name?: string }).name = 'AbortError';
      reject(err);
    };
    function cleanup() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
    if (signal) signal.addEventListener('abort', onAbort);
  });
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
