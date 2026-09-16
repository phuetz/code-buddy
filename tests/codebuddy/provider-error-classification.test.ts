import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  classifyProviderError,
  parseRetryAfter,
  preserveProviderErrorMetadata,
  MAX_RETRY_AFTER_MS,
} from '@/codebuddy/provider-error-classifier.js';
import { withStreamRetry, _defaultIsRetryableForTests } from '@/codebuddy/stream-retry.js';

/**
 * HTTP-aware provider error classification (quota-fatal vs transient) +
 * Retry-After parsing + stream-retry wiring. Fully deterministic — every
 * error is fabricated, no network, no real sleeps.
 */

/** Fabricate an OpenAI-SDK-shaped error (status + Headers + code/type). */
function sdkError(opts: {
  status?: number;
  code?: string;
  type?: string;
  message?: string;
  headers?: Record<string, string>;
}): Error {
  const err = new Error(opts.message ?? `HTTP ${opts.status ?? ''}`) as Error & {
    status?: number;
    code?: string;
    type?: string;
    headers?: Headers;
  };
  if (opts.status !== undefined) err.status = opts.status;
  if (opts.code !== undefined) err.code = opts.code;
  if (opts.type !== undefined) err.type = opts.type;
  if (opts.headers) err.headers = new Headers(opts.headers);
  return err;
}

describe('classifyProviderError — transient (retryable)', () => {
  it.each([503, 502, 504, 408, 425, 500])('status %s → retryable, not fatal', (status) => {
    const c = classifyProviderError(sdkError({ status }));
    expect(c.retryable).toBe(true);
    expect(c.fatal).toBe(false);
  });

  it('429 with no quota signal → retryable (congestion, not quota)', () => {
    const c = classifyProviderError(
      sdkError({ status: 429, message: 'Rate limit reached, please try again' }),
    );
    expect(c.retryable).toBe(true);
    expect(c.fatal).toBe(false);
    expect(c.reason).toBe('rate_limited');
  });

  it('rate_limit_exceeded code (no status) → retryable', () => {
    const c = classifyProviderError(sdkError({ code: 'rate_limit_exceeded' }));
    expect(c.retryable).toBe(true);
    expect(c.fatal).toBe(false);
  });

  it('Anthropic overloaded_error → retryable', () => {
    const c = classifyProviderError(sdkError({ status: 529, type: 'overloaded_error' }));
    expect(c.retryable).toBe(true);
    expect(c.fatal).toBe(false);
  });
});

describe('classifyProviderError — quota fatal (the case that matters)', () => {
  it('429 + code insufficient_quota → FATAL, not retryable', () => {
    const c = classifyProviderError(
      sdkError({
        status: 429,
        code: 'insufficient_quota',
        message: 'You exceeded your current quota, please check your plan and billing details.',
      }),
    );
    expect(c.fatal).toBe(true);
    expect(c.retryable).toBe(false);
    expect(c.reason).toBe('quota_exhausted');
  });

  it('429 + "exceeded your current quota" message only → FATAL', () => {
    const c = classifyProviderError(
      sdkError({ status: 429, message: 'You exceeded your current quota' }),
    );
    expect(c.fatal).toBe(true);
    expect(c.retryable).toBe(false);
  });

  it('message-only "quota exceeded" (re-wrapped, no status) → FATAL', () => {
    // This is what survives the provider re-wrap when status was stripped.
    const c = classifyProviderError(new Error('CodeBuddy API error: quota exceeded'));
    expect(c.fatal).toBe(true);
    expect(c.retryable).toBe(false);
  });

  it('DeepSeek "Insufficient Balance" → FATAL', () => {
    const c = classifyProviderError(
      sdkError({ status: 402, code: 'insufficient_balance', message: 'Insufficient Balance' }),
    );
    expect(c.fatal).toBe(true);
    expect(c.retryable).toBe(false);
  });

  it('Anthropic 400 credit balance too low → FATAL quota_exhausted (not invalid_request)', () => {
    const c = classifyProviderError(
      sdkError({
        status: 400,
        type: 'invalid_request_error',
        message:
          'Your credit balance is too low to access the Claude API. Please go to Plans & Billing to upgrade or purchase credits.',
      }),
    );
    expect(c.fatal).toBe(true);
    expect(c.retryable).toBe(false);
    expect(c.reason).toBe('quota_exhausted');
  });

  it('Anthropic 429 monthly limit → FATAL quota_exhausted (not rate_limited)', () => {
    const c = classifyProviderError(
      sdkError({ status: 429, message: 'You have exceeded your monthly limit' }),
    );
    expect(c.fatal).toBe(true);
    expect(c.retryable).toBe(false);
    expect(c.reason).toBe('quota_exhausted');
  });

  it('Gemini 429 RESOURCE_EXHAUSTED "check quota" → FATAL quota_exhausted', () => {
    const err = sdkError({
      status: 429,
      message: 'Resource has been exhausted (e.g. check quota).',
    }) as Error & { statusText?: string };
    err.statusText = 'RESOURCE_EXHAUSTED';
    const c = classifyProviderError(err);
    expect(c.fatal).toBe(true);
    expect(c.retryable).toBe(false);
    expect(c.reason).toBe('quota_exhausted');
  });

  it('xAI 403 out_of_credits → FATAL quota_exhausted (not auth_failed)', () => {
    const c = classifyProviderError(
      sdkError({ status: 403, type: 'out_of_credits', message: 'out_of_credits' }),
    );
    expect(c.fatal).toBe(true);
    expect(c.retryable).toBe(false);
    expect(c.reason).toBe('quota_exhausted');
  });
});

describe('classifyProviderError — auth / invalid fatal', () => {
  it('401 unauthorized → FATAL', () => {
    const c = classifyProviderError(sdkError({ status: 401, message: '401 Unauthorized' }));
    expect(c.fatal).toBe(true);
    expect(c.retryable).toBe(false);
    expect(c.reason).toBe('auth_failed');
  });

  it('403 forbidden → FATAL auth (not a billing outage)', () => {
    const c = classifyProviderError(sdkError({ status: 403, message: 'Forbidden' }));
    expect(c.fatal).toBe(true);
    expect(c.retryable).toBe(false);
    expect(c.reason).toBe('auth_failed');
  });

  it('invalid_api_key code → FATAL', () => {
    const c = classifyProviderError(sdkError({ code: 'invalid_api_key', message: 'Incorrect API key provided' }));
    expect(c.fatal).toBe(true);
    expect(c.retryable).toBe(false);
  });

  it('400 bad request → FATAL', () => {
    const c = classifyProviderError(sdkError({ status: 400, message: '400 Bad Request: malformed payload' }));
    expect(c.fatal).toBe(true);
    expect(c.retryable).toBe(false);
    expect(c.reason).toBe('invalid_request');
  });

  it('model_not_found → FATAL', () => {
    const c = classifyProviderError(
      sdkError({ status: 404, code: 'model_not_found', message: 'The model does not exist' }),
    );
    expect(c.fatal).toBe(true);
    expect(c.retryable).toBe(false);
    expect(c.reason).toBe('model_not_found');
  });
});

describe('parseRetryAfter', () => {
  it('delta-seconds "30" → 30000ms', () => {
    expect(parseRetryAfter('30')).toBe(30_000);
  });

  it('numeric 5 → 5000ms', () => {
    expect(parseRetryAfter(5)).toBe(5_000);
  });

  it('HTTP-date ~20s in the future → ≈20000ms', () => {
    const now = 1_000_000_000_000;
    const when = new Date(now + 20_000).toUTCString(); // second-resolution date
    const parsed = parseRetryAfter(when, now);
    expect(parsed).toBeGreaterThanOrEqual(19_000);
    expect(parsed).toBeLessThanOrEqual(20_000);
  });

  it('bounds a huge Retry-After to MAX_RETRY_AFTER_MS', () => {
    expect(parseRetryAfter('86400')).toBe(MAX_RETRY_AFTER_MS);
  });

  it('past HTTP-date clamps to 0', () => {
    const now = 1_000_000_000_000;
    const when = new Date(now - 10_000).toUTCString();
    expect(parseRetryAfter(when, now)).toBe(0);
  });

  it('undefined / garbage → undefined', () => {
    expect(parseRetryAfter(undefined)).toBeUndefined();
    expect(parseRetryAfter('')).toBeUndefined();
    expect(parseRetryAfter('not-a-date')).toBeUndefined();
  });
});

describe('classifyProviderError — Retry-After extraction', () => {
  it('reads Retry-After (seconds) header → retryAfterMs', () => {
    const c = classifyProviderError(sdkError({ status: 429, headers: { 'retry-after': '30' } }));
    expect(c.retryable).toBe(true);
    expect(c.retryAfterMs).toBe(30_000);
  });

  it('prefers retry-after-ms (milliseconds) header', () => {
    const c = classifyProviderError(
      sdkError({ status: 429, headers: { 'retry-after-ms': '1500' } }),
    );
    expect(c.retryAfterMs).toBe(1_500);
  });

  it('reads a pre-parsed retryAfterMs field (throw-site enrichment)', () => {
    const err = new Error('CodeBuddy API error: rate limited') as Error & { retryAfterMs?: number };
    err.retryAfterMs = 2_000;
    const c = classifyProviderError(err);
    expect(c.retryAfterMs).toBe(2_000);
  });
});

describe('classifyProviderError — network non-regression', () => {
  it.each(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE', 'UND_ERR_SOCKET'])(
    'Node code %s → retryable',
    (code) => {
      const err = new Error('boom') as Error & { code?: string };
      err.code = code;
      const c = classifyProviderError(err);
      expect(c.retryable).toBe(true);
      expect(c.fatal).toBe(false);
    },
  );

  it('"socket hang up" → retryable', () => {
    expect(classifyProviderError(new Error('socket hang up')).retryable).toBe(true);
  });

  it('OpenAI SDK "Connection error." (no errno) → retryable network', () => {
    const c = classifyProviderError(new Error('CodeBuddy API error: Connection error.'));
    expect(c.retryable).toBe(true);
    expect(c.fatal).toBe(false);
    expect(c.reason).toBe('network');
  });

  it('APIConnectionError name → retryable network', () => {
    const err = new Error('Connection error.') as Error & { name?: string };
    err.name = 'APIConnectionError';
    expect(classifyProviderError(err).reason).toBe('network');
  });

  it('"stream terminated" → retryable', () => {
    expect(classifyProviderError(new Error('the stream was terminated unexpectedly')).retryable).toBe(true);
  });

  it('plain AbortError (user cancel) → not retryable, not fatal', () => {
    const err = new Error('user cancelled') as Error & { name?: string };
    err.name = 'AbortError';
    const c = classifyProviderError(err);
    expect(c.retryable).toBe(false);
    expect(c.fatal).toBe(false);
  });

  it('null / undefined / empty object → not retryable, not fatal', () => {
    expect(classifyProviderError(null)).toMatchObject({ retryable: false, fatal: false });
    expect(classifyProviderError(undefined)).toMatchObject({ retryable: false, fatal: false });
    expect(classifyProviderError({})).toMatchObject({ retryable: false, fatal: false });
  });

  it('_defaultIsRetryableForTests stays consistent with the classifier', () => {
    expect(_defaultIsRetryableForTests(new Error('socket hang up'))).toBe(true);
    expect(_defaultIsRetryableForTests(new Error('Invalid API key'))).toBe(false);
    expect(_defaultIsRetryableForTests(sdkError({ status: 503 }))).toBe(true);
    expect(_defaultIsRetryableForTests(sdkError({ status: 429, code: 'insufficient_quota' }))).toBe(false);
  });
});

describe('preserveProviderErrorMetadata (throw-site enrichment)', () => {
  it('copies status/code/type/retryAfterMs from a raw SDK error onto the wrapper', () => {
    const raw = sdkError({ status: 429, code: 'insufficient_quota', type: 'insufficient_quota', headers: { 'retry-after': '12' } });
    const wrapped = preserveProviderErrorMetadata(new Error('CodeBuddy API error: ...'), raw) as Error & {
      status?: number;
      code?: string;
      retryAfterMs?: number;
    };
    expect(wrapped.status).toBe(429);
    expect(wrapped.code).toBe('insufficient_quota');
    expect(wrapped.retryAfterMs).toBe(12_000);
    // And the enriched wrapper now classifies as fatal, even though its
    // message alone might not have.
    expect(classifyProviderError(wrapped).fatal).toBe(true);
  });

  it('never throws on non-object sources', () => {
    expect(() => preserveProviderErrorMetadata(new Error('x'), 'string-error')).not.toThrow();
    expect(() => preserveProviderErrorMetadata(new Error('x'), null)).not.toThrow();
  });
});

describe('withStreamRetry — fatal fails fast, Retry-After honoured', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a fatal quota error triggers ZERO retries (factory called once)', async () => {
    let calls = 0;
    const factory = () => {
      calls++;
      return (async function* () {
        throw sdkError({
          status: 429,
          code: 'insufficient_quota',
          message: 'You exceeded your current quota',
        });
        // eslint-disable-next-line no-unreachable
        yield 'never';
      })();
    };

    await expect(async () => {
      for await (const _ of withStreamRetry(factory, { maxAttempts: 4, initialDelayMs: 10 })) {
        // drain
      }
    }).rejects.toMatchObject({ code: 'insufficient_quota' });

    expect(calls).toBe(1);
  });

  it('a transient error with Retry-After waits exactly that delay (not exponential)', async () => {
    vi.useFakeTimers();
    const recordedDelays: number[] = [];
    let calls = 0;
    const factory = () => {
      calls++;
      if (calls === 1) {
        return (async function* () {
          throw sdkError({ status: 429, headers: { 'retry-after': '2' } });
          // eslint-disable-next-line no-unreachable
          yield 'x';
        })();
      }
      return (async function* () {
        yield 'ok';
      })();
    };

    const out: string[] = [];
    const promise = (async () => {
      for await (const v of withStreamRetry(factory, {
        maxAttempts: 3,
        initialDelayMs: 100, // exponential would be 100 — Retry-After must win with 2000
        maxDelayMs: 500,
        onRetry: (_a, delay) => recordedDelays.push(delay),
      })) {
        out.push(v as string);
      }
    })();
    await vi.runAllTimersAsync();
    await promise;

    expect(out).toEqual(['ok']);
    expect(calls).toBe(2);
    expect(recordedDelays).toEqual([2_000]);
  });
});
