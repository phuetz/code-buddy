import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  withStreamRetry,
  _defaultIsRetryableForTests,
  type StreamRetryOptions,
} from '@/codebuddy/stream-retry.js';

/**
 * Tests for the stream-retry helper (audit Gemini CLI fix #1).
 * Pure module — no LLM client mocking, no provider setup, no executor instantiation.
 */
describe('withStreamRetry', () => {
  describe('happy path', () => {
    it('yields all events from a single successful generator (no retry)', async () => {
      let calls = 0;
      const factory = async function* () {
        calls++;
        yield 'a';
        yield 'b';
        yield 'c';
      };

      const out: string[] = [];
      for await (const v of withStreamRetry(factory)) out.push(v);

      expect(out).toEqual(['a', 'b', 'c']);
      expect(calls).toBe(1);
    });

    it('handles an empty generator', async () => {
      const factory = async function* () {
        // empty
      };
      const out: unknown[] = [];
      for await (const v of withStreamRetry(factory)) out.push(v);
      expect(out).toEqual([]);
    });
  });

  describe('retry on retryable errors', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('retries when factory throws ECONNRESET, then succeeds on attempt 2', async () => {
      let calls = 0;
      const factory = () => {
        calls++;
        if (calls === 1) {
          return (async function* () {
            const err = new Error('reset') as Error & { code?: string };
            err.code = 'ECONNRESET';
            throw err;
            // eslint-disable-next-line no-unreachable
            yield 'unused';
          })();
        }
        return (async function* () {
          yield 'ok';
        })();
      };

      const out: string[] = [];
      const promise = (async () => {
        for await (const v of withStreamRetry(factory, { initialDelayMs: 100 })) {
          out.push(v);
        }
      })();
      await vi.runAllTimersAsync();
      await promise;

      expect(out).toEqual(['ok']);
      expect(calls).toBe(2);
    });

    it('throws after maxAttempts is exhausted on always-failing retryable error', async () => {
      let calls = 0;
      const factory = () => {
        calls++;
        return (async function* () {
          const err = new Error('reset') as Error & { code?: string };
          err.code = 'ECONNRESET';
          throw err;
          // eslint-disable-next-line no-unreachable
          yield 'never';
        })();
      };

      const promise = (async () => {
        for await (const _ of withStreamRetry(factory, { maxAttempts: 3, initialDelayMs: 50 })) {
          // drain
        }
      })();
      const expectation = expect(promise).rejects.toMatchObject({ code: 'ECONNRESET' });
      await vi.runAllTimersAsync();
      await expectation;

      expect(calls).toBe(3);
    });

    it('preserves the partial prefix and cause without restarting', async () => {
      let calls = 0;
      const factory = () => {
        calls++;
        if (calls === 1) {
          return (async function* () {
            yield 'a';
            yield 'b';
            const err = new Error('socket hang up');
            throw err;
          })();
        }
        return (async function* () {
          yield 'a';
          yield 'b';
          yield 'c';
        })();
      };

      const out: string[] = [];
      const promise = (async () => {
        for await (const v of withStreamRetry(factory, { initialDelayMs: 10 })) {
          out.push(v);
        }
      })();
      const rejection = expect(promise).rejects.toMatchObject({ code: 'PARTIAL_STREAM', cause: expect.objectContaining({ message: 'socket hang up' }) });
      await vi.runAllTimersAsync();
      await rejection;

      expect(out).toEqual(['a', 'b']);
      expect(calls).toBe(1);
    });
  });

  describe('non-retryable errors', () => {
    it('throws immediately on a non-retryable error (no retry)', async () => {
      let calls = 0;
      const factory = () => {
        calls++;
        return (async function* () {
          throw new Error('Invalid API key');
          // eslint-disable-next-line no-unreachable
          yield 'unused';
        })();
      };

      await expect(async () => {
        for await (const _ of withStreamRetry(factory, { maxAttempts: 4 })) {
          // drain
        }
      }).rejects.toThrow('Invalid API key');
      expect(calls).toBe(1);
    });

    it('respects a custom isRetryable predicate', async () => {
      let calls = 0;
      const factory = () => {
        calls++;
        return (async function* () {
          throw new Error('custom-flag-error');
          // eslint-disable-next-line no-unreachable
          yield 'unused';
        })();
      };
      const isRetryable = (err: unknown) =>
        err instanceof Error && err.message === 'custom-flag-error';

      vi.useFakeTimers();
      try {
        const promise = (async () => {
          for await (const _ of withStreamRetry(factory, {
            maxAttempts: 2,
            initialDelayMs: 10,
            isRetryable,
          })) {
            // drain
          }
        })();
        const expectation = expect(promise).rejects.toThrow('custom-flag-error');
        await vi.runAllTimersAsync();
        await expectation;
        expect(calls).toBe(2);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('exponential backoff timing', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('records exponential delays between retries (capped by maxDelayMs)', async () => {
      const recordedDelays: number[] = [];
      const factory = () =>
        (async function* () {
          const err = new Error('reset') as Error & { code?: string };
          err.code = 'ECONNRESET';
          throw err;
          // eslint-disable-next-line no-unreachable
          yield 'unused';
        })();

      const opts: StreamRetryOptions = {
        maxAttempts: 5,
        initialDelayMs: 100,
        maxDelayMs: 500,
        onRetry: (_attempt, delay) => recordedDelays.push(delay),
      };

      const promise = (async () => {
        for await (const _ of withStreamRetry(factory, opts)) {
          // drain
        }
      })();
      const expectation = expect(promise).rejects.toMatchObject({ code: 'ECONNRESET' });
      await vi.runAllTimersAsync();
      await expectation;

      // Initial=100, then 100*2=200, 100*4=400, 100*8=800→capped 500. 4 retries between 5 attempts.
      expect(recordedDelays).toEqual([100, 200, 400, 500]);
    });
  });

  describe('abort signal', () => {
    it('throws AbortError when signal is already aborted before first wait', async () => {
      const ctrl = new AbortController();
      ctrl.abort();
      const factory = () =>
        (async function* () {
          const err = new Error('reset') as Error & { code?: string };
          err.code = 'ECONNRESET';
          throw err;
          // eslint-disable-next-line no-unreachable
          yield 'unused';
        })();

      await expect(async () => {
        for await (const _ of withStreamRetry(factory, {
          maxAttempts: 4,
          initialDelayMs: 100,
          signal: ctrl.signal,
        })) {
          // drain
        }
      }).rejects.toMatchObject({ name: 'AbortError' });
    });

    it('throws AbortError when signal aborts during retry wait', async () => {
      vi.useFakeTimers();
      try {
        const ctrl = new AbortController();
        let calls = 0;
        const factory = () => {
          calls++;
          return (async function* () {
            const err = new Error('reset') as Error & { code?: string };
            err.code = 'ECONNRESET';
            throw err;
            // eslint-disable-next-line no-unreachable
            yield 'unused';
          })();
        };

        const promise = (async () => {
          for await (const _ of withStreamRetry(factory, {
            maxAttempts: 5,
            initialDelayMs: 5000,
            signal: ctrl.signal,
          })) {
            // drain
          }
        })();
        const expectation = expect(promise).rejects.toMatchObject({ name: 'AbortError' });
        // First call fails synchronously, then waits 5000ms — abort during the wait.
        await vi.advanceTimersByTimeAsync(100);
        ctrl.abort();
        await vi.runAllTimersAsync();
        await expectation;
        expect(calls).toBe(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('input validation', () => {
    it('throws if maxAttempts is < 1', async () => {
      const factory = async function* () {
        yield 'unused';
      };
      await expect(async () => {
        for await (const _ of withStreamRetry(factory, { maxAttempts: 0 })) {
          // drain
        }
      }).rejects.toThrow('maxAttempts must be >= 1');
    });
  });
});

describe('defaultIsRetryable', () => {
  const isRetryable = _defaultIsRetryableForTests;

  it.each([
    ['ECONNRESET'],
    ['ECONNREFUSED'],
    ['ETIMEDOUT'],
    ['ENOTFOUND'],
    ['EAI_AGAIN'],
    ['EPIPE'],
    ['UND_ERR_SOCKET'],
  ])('retries on Node code %s', (code) => {
    const err = new Error('boom') as Error & { code?: string };
    err.code = code;
    expect(isRetryable(err)).toBe(true);
  });

  it('retries on FetchError name', () => {
    const err = new Error('network') as Error & { name?: string };
    err.name = 'FetchError';
    expect(isRetryable(err)).toBe(true);
  });

  it('retries on TimeoutError name', () => {
    const err = new Error('timed out') as Error & { name?: string };
    err.name = 'TimeoutError';
    expect(isRetryable(err)).toBe(true);
  });

  it('retries on AbortError when message mentions network', () => {
    const err = new Error('network connection aborted') as Error & { name?: string };
    err.name = 'AbortError';
    expect(isRetryable(err)).toBe(true);
  });

  it('does NOT retry on plain AbortError (user-initiated cancel)', () => {
    const err = new Error('user cancelled') as Error & { name?: string };
    err.name = 'AbortError';
    expect(isRetryable(err)).toBe(false);
  });

  it('retries on "socket hang up" message', () => {
    expect(isRetryable(new Error('socket hang up'))).toBe(true);
  });

  it('retries on "stream terminated" message', () => {
    expect(isRetryable(new Error('the stream was terminated unexpectedly'))).toBe(true);
  });

  it('does NOT retry on auth/validation errors', () => {
    expect(isRetryable(new Error('Invalid API key'))).toBe(false);
    expect(isRetryable(new Error('400 Bad Request: malformed payload'))).toBe(false);
    expect(isRetryable(new Error('quota exceeded'))).toBe(false);
  });

  it('returns false on null / undefined / empty', () => {
    expect(isRetryable(null)).toBe(false);
    expect(isRetryable(undefined)).toBe(false);
    expect(isRetryable({})).toBe(false);
  });
});
