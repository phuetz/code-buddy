/**
 * Comprehensive Unit Tests for Retry Utilities
 *
 * Tests cover:
 * 1. Basic retry functionality
 * 2. Exponential backoff
 * 3. Jitter
 * 4. Timeout handling
 * 5. Abort signal
 * 6. Retry predicates
 * 7. Callback events
 * 8. withRetry wrapper
 * 9. retryWithResult
 * 10. Retry strategies
 */

import {
  retry,
  retryWithResult,
  withRetry,
  RetryPredicates,
  RetryStrategies,
  RetryOptions,
} from '../../src/utils/retry';

describe('Retry Utilities', () => {
  describe('retry function', () => {
    it('should succeed on first attempt', async () => {
      const fn = jest.fn().mockResolvedValue('success');

      const result = await retry(fn);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure and succeed', async () => {
      const fn = jest.fn()
        .mockRejectedValueOnce(new Error('fail 1'))
        .mockRejectedValueOnce(new Error('fail 2'))
        .mockResolvedValue('success');

      const result = await retry(fn, { maxRetries: 3, baseDelay: 10, jitter: false });

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
    }, 10000);

    it('should throw after max retries exceeded', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('always fails'));

      await expect(
        retry(fn, { maxRetries: 2, baseDelay: 10, jitter: false })
      ).rejects.toThrow('always fails');

      expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
    }, 10000);

    it('should respect maxRetries option', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('fail'));

      await expect(
        retry(fn, { maxRetries: 1, baseDelay: 10, jitter: false })
      ).rejects.toThrow('fail');

      expect(fn).toHaveBeenCalledTimes(2); // initial + 1 retry
    }, 10000);

    it('should not retry when maxRetries is 0', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('fail'));

      await expect(retry(fn, { maxRetries: 0 })).rejects.toThrow('fail');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should call onRetry callback', async () => {
      const onRetry = jest.fn();
      const fn = jest.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('success');

      await retry(fn, {
        maxRetries: 3,
        baseDelay: 10,
        jitter: false,
        onRetry,
      });

      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 1, expect.any(Number));
    }, 10000);

    it('should call onSuccess callback', async () => {
      const onSuccess = jest.fn();
      const fn = jest.fn().mockResolvedValue('success');

      await retry(fn, { onSuccess });

      expect(onSuccess).toHaveBeenCalledWith('success', 1);
    });

    it('should call onFailed callback', async () => {
      const onFailed = jest.fn();
      const fn = jest.fn().mockRejectedValue(new Error('fail'));

      await expect(
        retry(fn, {
          maxRetries: 1,
          baseDelay: 10,
          jitter: false,
          onFailed,
        })
      ).rejects.toThrow();

      expect(onFailed).toHaveBeenCalledWith(expect.any(Error), 2);
    }, 10000);

    it('should respect isRetryable predicate', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('non-retryable'));

      await expect(
        retry(fn, {
          maxRetries: 3,
          isRetryable: () => false,
        })
      ).rejects.toThrow('non-retryable');

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should only retry for retryable errors', async () => {
      const fn = jest.fn()
        .mockRejectedValueOnce(new Error('network error'))
        .mockRejectedValueOnce(new Error('validation error'))
        .mockResolvedValue('success');

      await expect(
        retry(fn, {
          maxRetries: 3,
          baseDelay: 10,
          jitter: false,
          isRetryable: (err) => {
            const msg = err instanceof Error ? err.message : '';
            return msg.includes('network');
          },
        })
      ).rejects.toThrow('validation error');

      expect(fn).toHaveBeenCalledTimes(2);
    }, 10000);

    it('should handle abort signal', async () => {
      const controller = new AbortController();
      const fn = jest.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('success');

      const promise = retry(fn, {
        maxRetries: 3,
        baseDelay: 500,
        jitter: false,
        signal: controller.signal,
      });

      // Abort before retry delay completes
      setTimeout(() => controller.abort(), 100);

      await expect(promise).rejects.toThrow('Operation aborted');
    }, 10000);

    it('should handle pre-aborted signal', async () => {
      const controller = new AbortController();
      controller.abort();

      const fn = jest.fn().mockResolvedValue('success');

      await expect(
        retry(fn, { signal: controller.signal })
      ).rejects.toThrow('Operation aborted');

      expect(fn).not.toHaveBeenCalled();
    });
  });

  describe('Exponential Backoff', () => {
    it('should increase delay exponentially', async () => {
      const onRetry = jest.fn();
      const fn = jest.fn().mockRejectedValue(new Error('fail'));

      await expect(
        retry(fn, {
          maxRetries: 3,
          baseDelay: 10,
          backoffFactor: 2,
          jitter: false,
          onRetry,
        })
      ).rejects.toThrow();

      // Check delays: 10, 20, 40
      expect(onRetry).toHaveBeenNthCalledWith(1, expect.any(Error), 1, 10);
      expect(onRetry).toHaveBeenNthCalledWith(2, expect.any(Error), 2, 20);
      expect(onRetry).toHaveBeenNthCalledWith(3, expect.any(Error), 3, 40);
    }, 10000);

    it('should respect maxDelay', async () => {
      const onRetry = jest.fn();
      const fn = jest.fn().mockRejectedValue(new Error('fail'));

      await expect(
        retry(fn, {
          maxRetries: 5,
          baseDelay: 10,
          maxDelay: 20,
          backoffFactor: 2,
          jitter: false,
          onRetry,
        })
      ).rejects.toThrow();

      // Delays should be capped at 20
      for (let i = 0; i < 5; i++) {
        const call = onRetry.mock.calls[i];
        expect(call[2]).toBeLessThanOrEqual(20);
      }
    }, 10000);
  });

  describe('Jitter', () => {
    it('should add jitter when enabled', async () => {
      const delays: number[] = [];
      const fn = jest.fn().mockRejectedValue(new Error('fail'));

      // Run multiple times to check for variance
      for (let i = 0; i < 3; i++) {
        await retry(fn, {
          maxRetries: 1,
          baseDelay: 100,
          jitter: true,
          onRetry: (_, __, delay) => delays.push(delay),
        }).catch(() => {});
      }

      // With jitter, delays should be >= baseDelay
      const baseDelay = 100;
      const maxJitterDelay = baseDelay * 1.25;

      delays.forEach(delay => {
        expect(delay).toBeGreaterThanOrEqual(baseDelay);
        expect(delay).toBeLessThanOrEqual(maxJitterDelay);
      });
    }, 10000);

    it('should not add jitter when disabled', async () => {
      const onRetry = jest.fn();
      const fn = jest.fn().mockRejectedValue(new Error('fail'));

      await retry(fn, {
        maxRetries: 3,
        baseDelay: 10,
        backoffFactor: 2,
        jitter: false,
        onRetry,
      }).catch(() => {});

      // Delays should be exactly as expected
      expect(onRetry).toHaveBeenNthCalledWith(1, expect.any(Error), 1, 10);
      expect(onRetry).toHaveBeenNthCalledWith(2, expect.any(Error), 2, 20);
      expect(onRetry).toHaveBeenNthCalledWith(3, expect.any(Error), 3, 40);
    }, 10000);
  });

  describe('Timeout', () => {
    it('should timeout when retry delays exceed timeout', async () => {
      // The timeout is checked at the start of each attempt, not during fn execution
      // So we need baseDelay to cause the timeout to trigger on the next attempt
      const fn = jest.fn().mockRejectedValue(new Error('fail'));

      await expect(
        retry(fn, {
          maxRetries: 10,
          baseDelay: 100,
          timeout: 150, // Timeout after first retry delay (~100ms)
          jitter: false,
        })
      ).rejects.toThrow('Retry timeout exceeded');

      // Should have attempted once, then retry delay ~100ms, then timeout on 2nd or 3rd attempt
      expect(fn).toHaveBeenCalled();
    }, 10000);
  });

  describe('retryWithResult', () => {
    it('should return success result', async () => {
      const fn = jest.fn().mockResolvedValue('success');

      const result = await retryWithResult(fn);

      expect(result.success).toBe(true);
      expect(result.result).toBe('success');
      expect(result.attempts).toBeGreaterThan(0);
      expect(result.totalTime).toBeGreaterThanOrEqual(0);
    });

    it('should return failure result', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('fail'));

      const result = await retryWithResult(fn, {
        maxRetries: 1,
        baseDelay: 10,
        jitter: false,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error?.message).toBe('fail');
    }, 10000);

    it('should include attempts count', async () => {
      const fn = jest.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('success');

      const result = await retryWithResult(fn, {
        maxRetries: 3,
        baseDelay: 10,
        jitter: false,
      });

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(2);
    }, 10000);

    it('should convert non-Error exceptions', async () => {
      const fn = jest.fn().mockRejectedValue('string error');

      const result = await retryWithResult(fn, {
        maxRetries: 0,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error?.message).toBe('string error');
    });
  });

  describe('withRetry wrapper', () => {
    it('should create retryable version of function', async () => {
      const original = jest.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('success');

      const retryable = withRetry(original, {
        maxRetries: 3,
        baseDelay: 10,
        jitter: false,
      });

      const result = await retryable();

      expect(result).toBe('success');
      expect(original).toHaveBeenCalledTimes(2);
    }, 10000);

    it('should pass arguments to original function', async () => {
      const original = jest.fn().mockResolvedValue('success');

      const retryable = withRetry(original, { maxRetries: 1 });

      await retryable('arg1', 'arg2', 123);

      expect(original).toHaveBeenCalledWith('arg1', 'arg2', 123);
    });
  });

  describe('RetryPredicates', () => {
    describe('networkError', () => {
      it('should return true for network errors', () => {
        expect(RetryPredicates.networkError(new Error('network error'))).toBe(true);
        expect(RetryPredicates.networkError(new Error('timeout occurred'))).toBe(true);
        expect(RetryPredicates.networkError(new Error('ECONNRESET'))).toBe(true);
        expect(RetryPredicates.networkError(new Error('ECONNREFUSED'))).toBe(true);
        expect(RetryPredicates.networkError(new Error('socket hang up'))).toBe(true);
      });

      it('should return false for non-network errors', () => {
        expect(RetryPredicates.networkError(new Error('validation failed'))).toBe(false);
        expect(RetryPredicates.networkError(new Error('not found'))).toBe(false);
      });
    });

    describe('serverError', () => {
      it('should return true for server errors', () => {
        expect(RetryPredicates.serverError(new Error('500 Internal Server Error'))).toBe(true);
        expect(RetryPredicates.serverError(new Error('502 Bad Gateway'))).toBe(true);
        expect(RetryPredicates.serverError(new Error('503 Service Unavailable'))).toBe(true);
        expect(RetryPredicates.serverError(new Error('504 Gateway Timeout'))).toBe(true);
      });

      it('should return false for client errors', () => {
        expect(RetryPredicates.serverError(new Error('400 Bad Request'))).toBe(false);
        expect(RetryPredicates.serverError(new Error('404 Not Found'))).toBe(false);
      });
    });

    describe('rateLimitError', () => {
      it('should return true for rate limit errors', () => {
        expect(RetryPredicates.rateLimitError(new Error('429 Too Many Requests'))).toBe(true);
        expect(RetryPredicates.rateLimitError(new Error('rate limit exceeded'))).toBe(true);
        expect(RetryPredicates.rateLimitError(new Error('throttled'))).toBe(true);
      });

      it('should return false for other errors', () => {
        expect(RetryPredicates.rateLimitError(new Error('server error'))).toBe(false);
      });
    });

    describe('transientError', () => {
      it('should return true for any transient error', () => {
        expect(RetryPredicates.transientError(new Error('network error'))).toBe(true);
        expect(RetryPredicates.transientError(new Error('500 Internal Server Error'))).toBe(true);
        expect(RetryPredicates.transientError(new Error('429 Too Many Requests'))).toBe(true);
      });

      it('should return false for permanent errors', () => {
        expect(RetryPredicates.transientError(new Error('validation error'))).toBe(false);
      });
    });

    describe('never', () => {
      it('should always return false', () => {
        expect(RetryPredicates.never()).toBe(false);
      });
    });

    describe('always', () => {
      it('should always return true', () => {
        expect(RetryPredicates.always()).toBe(true);
      });
    });
  });

  describe('RetryStrategies', () => {
    it('should have fast strategy', () => {
      expect(RetryStrategies.fast.maxRetries).toBe(3);
      expect(RetryStrategies.fast.baseDelay).toBe(100);
      expect(RetryStrategies.fast.maxDelay).toBe(1000);
    });

    it('should have standard strategy', () => {
      expect(RetryStrategies.standard.maxRetries).toBe(3);
      expect(RetryStrategies.standard.baseDelay).toBe(1000);
      expect(RetryStrategies.standard.isRetryable).toBe(RetryPredicates.transientError);
    });

    it('should have aggressive strategy', () => {
      expect(RetryStrategies.aggressive.maxRetries).toBe(5);
      expect(RetryStrategies.aggressive.baseDelay).toBe(500);
    });

    it('should have patient strategy', () => {
      expect(RetryStrategies.patient.maxRetries).toBe(10);
      expect(RetryStrategies.patient.baseDelay).toBe(2000);
      expect(RetryStrategies.patient.isRetryable).toBe(RetryPredicates.rateLimitError);
    });

    it('should have none strategy', () => {
      expect(RetryStrategies.none.maxRetries).toBe(0);
    });

    it('should work with retry function', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('fail'));

      await expect(retry(fn, RetryStrategies.none)).rejects.toThrow('fail');
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('Edge Cases', () => {
    it('should handle non-Error exceptions', async () => {
      const fn = jest.fn().mockRejectedValue('string error');

      await expect(retry(fn, { maxRetries: 0 })).rejects.toBe('string error');
    });

    it('should handle undefined error', async () => {
      const fn = jest.fn().mockRejectedValue(undefined);

      await expect(retry(fn, { maxRetries: 0 })).rejects.toBeUndefined();
    });

    it('should handle null error', async () => {
      const fn = jest.fn().mockRejectedValue(null);

      await expect(retry(fn, { maxRetries: 0 })).rejects.toBeNull();
    });

    it('should handle very large maxRetries', async () => {
      const fn = jest.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('success');

      const result = await retry(fn, {
        maxRetries: 1000,
        baseDelay: 1,
        jitter: false,
      });

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    }, 10000);
  });
});
