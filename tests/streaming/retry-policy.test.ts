/**
 * Retry Policy Tests
 */

import {
  calculateDelay,
  isRetryable,
  sleep,
  withTimeout,
  retry,
  retryOrThrow,
  CircuitBreaker,
  CircuitOpenError,
  RetryManager,
  getRetryManager,
  resetRetryManager,
  withRetry,
  withCircuitBreaker,
  DEFAULT_RETRY_CONFIG,
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
} from '../../src/streaming/retry-policy.js';

describe('Retry Policy', () => {
  describe('calculateDelay', () => {
    it('should calculate exponential backoff', () => {
      const config = { ...DEFAULT_RETRY_CONFIG, jitter: false };

      expect(calculateDelay(1, config)).toBe(1000);
      expect(calculateDelay(2, config)).toBe(2000);
      expect(calculateDelay(3, config)).toBe(4000);
      expect(calculateDelay(4, config)).toBe(8000);
    });

    it('should respect max delay', () => {
      const config = { ...DEFAULT_RETRY_CONFIG, jitter: false, maxDelayMs: 5000 };

      expect(calculateDelay(1, config)).toBe(1000);
      expect(calculateDelay(5, config)).toBe(5000);
      expect(calculateDelay(10, config)).toBe(5000);
    });

    it('should add jitter when enabled', () => {
      const config = { ...DEFAULT_RETRY_CONFIG, jitter: true, jitterFactor: 0.5 };
      const delays = new Set<number>();

      // Run multiple times to get different values
      for (let i = 0; i < 10; i++) {
        delays.add(calculateDelay(1, config));
      }

      // Should have some variation due to jitter
      expect(delays.size).toBeGreaterThan(1);
    });
  });

  describe('isRetryable', () => {
    it('should identify retryable errors', () => {
      const config = DEFAULT_RETRY_CONFIG;

      expect(isRetryable(new Error('ECONNRESET'), config)).toBe(true);
      expect(isRetryable(new Error('ETIMEDOUT'), config)).toBe(true);
      expect(isRetryable(new Error('RATE_LIMIT exceeded'), config)).toBe(true);
    });

    it('should identify non-retryable errors', () => {
      const config = DEFAULT_RETRY_CONFIG;

      expect(isRetryable(new Error('AUTH_FAILED'), config)).toBe(false);
      expect(isRetryable(new Error('INVALID_REQUEST'), config)).toBe(false);
      expect(isRetryable(new Error('NOT_FOUND'), config)).toBe(false);
    });

    it('should use error code if available', () => {
      const config = DEFAULT_RETRY_CONFIG;
      const error = new Error('Connection reset') as NodeJS.ErrnoException;
      error.code = 'ECONNRESET';

      expect(isRetryable(error, config)).toBe(true);
    });
  });

  describe('sleep', () => {
    it('should sleep for specified duration', async () => {
      const start = Date.now();
      await sleep(50);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThanOrEqual(40);
      expect(elapsed).toBeLessThan(100);
    });
  });

  describe('withTimeout', () => {
    it('should resolve when operation completes in time', async () => {
      const result = await withTimeout(
        Promise.resolve('success'),
        1000
      );

      expect(result).toBe('success');
    });

    it('should reject when operation times out', async () => {
      await expect(
        withTimeout(
          new Promise(resolve => setTimeout(resolve, 200)),
          50
        )
      ).rejects.toThrow('timed out');
    });

    it('should propagate operation errors', async () => {
      await expect(
        withTimeout(
          Promise.reject(new Error('operation error')),
          1000
        )
      ).rejects.toThrow('operation error');
    });
  });

  describe('retry', () => {
    it('should succeed on first attempt', async () => {
      let attempts = 0;
      const result = await retry(async () => {
        attempts++;
        return 'success';
      });

      expect(result.success).toBe(true);
      expect(result.value).toBe('success');
      expect(result.attempts.length).toBe(1);
      expect(attempts).toBe(1);
    });

    it('should retry on failure', async () => {
      let attempts = 0;
      const result = await retry(
        async () => {
          attempts++;
          if (attempts < 3) {
            throw new Error('ECONNRESET');
          }
          return 'success';
        },
        { maxAttempts: 5, initialDelayMs: 10 }
      );

      expect(result.success).toBe(true);
      expect(result.value).toBe('success');
      expect(result.attempts.length).toBe(3);
      expect(attempts).toBe(3);
    });

    it('should respect max attempts', async () => {
      let attempts = 0;
      const result = await retry(
        async () => {
          attempts++;
          throw new Error('ECONNRESET');
        },
        { maxAttempts: 3, initialDelayMs: 10 }
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.attempts.length).toBe(3);
      expect(attempts).toBe(3);
    });

    it('should not retry non-retryable errors', async () => {
      let attempts = 0;
      const result = await retry(
        async () => {
          attempts++;
          throw new Error('AUTH_FAILED');
        },
        { maxAttempts: 5, initialDelayMs: 10 }
      );

      expect(result.success).toBe(false);
      expect(result.attempts.length).toBe(1);
      expect(attempts).toBe(1);
    });

    it('should track attempt details', async () => {
      let attempts = 0;
      const result = await retry(
        async () => {
          attempts++;
          if (attempts < 2) {
            throw new Error('ECONNRESET');
          }
          return 'success';
        },
        { maxAttempts: 3, initialDelayMs: 10 }
      );

      expect(result.attempts[0].success).toBe(false);
      expect(result.attempts[0].error).toBeDefined();
      expect(result.attempts[0].delayMs).toBeDefined();
      expect(result.attempts[1].success).toBe(true);
      expect(result.totalDurationMs).toBeGreaterThan(0);
    });
  });

  describe('retryOrThrow', () => {
    it('should return value on success', async () => {
      const result = await retryOrThrow(async () => 'success');
      expect(result).toBe('success');
    });

    it('should throw on failure', async () => {
      await expect(
        retryOrThrow(
          async () => { throw new Error('AUTH_FAILED'); },
          { maxAttempts: 1 }
        )
      ).rejects.toThrow('AUTH_FAILED');
    });

    it('should attach retry attempts to error', async () => {
      try {
        await retryOrThrow(
          async () => { throw new Error('ECONNRESET'); },
          { maxAttempts: 2, initialDelayMs: 10 }
        );
      } catch (error) {
        expect((error as Error & { retryAttempts?: unknown[] }).retryAttempts).toHaveLength(2);
      }
    });
  });
});

describe('Circuit Breaker', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker({
      failureThreshold: 3,
      failureWindowMs: 1000,
      resetTimeoutMs: 100,
      successThreshold: 2,
      probeTimeoutMs: 1000,
    });
  });

  describe('state transitions', () => {
    it('should start in closed state', () => {
      expect(breaker.getState()).toBe('closed');
    });

    it('should open after failure threshold', async () => {
      const states: string[] = [];
      breaker.on('state-change', (_from, to) => states.push(to));

      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => { throw new Error('fail'); });
        } catch {
          // Expected
        }
      }

      expect(breaker.getState()).toBe('open');
      expect(states).toContain('open');
    });

    it('should reject requests when open', async () => {
      // Force open
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => { throw new Error('fail'); });
        } catch {
          // Expected
        }
      }

      let rejected = false;
      breaker.on('rejected', () => { rejected = true; });

      await expect(
        breaker.execute(async () => 'success')
      ).rejects.toThrow(CircuitOpenError);

      expect(rejected).toBe(true);
    });

    it('should transition to half-open after reset timeout', async () => {
      // Force open
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => { throw new Error('fail'); });
        } catch {
          // Expected
        }
      }

      expect(breaker.getState()).toBe('open');

      // Wait for reset timeout
      await sleep(150);

      expect(breaker.getState()).toBe('half-open');
    });

    it('should close after success threshold in half-open', async () => {
      // Force open
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => { throw new Error('fail'); });
        } catch {
          // Expected
        }
      }

      // Wait for half-open
      await sleep(150);

      // Succeed twice
      await breaker.execute(async () => 'success');
      await breaker.execute(async () => 'success');

      expect(breaker.getState()).toBe('closed');
    });

    it('should reopen on failure in half-open', async () => {
      // Force open
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => { throw new Error('fail'); });
        } catch {
          // Expected
        }
      }

      // Wait for half-open
      await sleep(150);

      // Fail in half-open
      try {
        await breaker.execute(async () => { throw new Error('fail'); });
      } catch {
        // Expected
      }

      expect(breaker.getState()).toBe('open');
    });
  });

  describe('statistics', () => {
    it('should track statistics', async () => {
      await breaker.execute(async () => 'success');

      try {
        await breaker.execute(async () => { throw new Error('fail'); });
      } catch {
        // Expected
      }

      const stats = breaker.getStats();
      expect(stats.totalRequests).toBe(2);
      expect(stats.successfulRequests).toBe(1);
      expect(stats.failedRequests).toBe(1);
    });

    it('should track rejected requests', async () => {
      // Force open
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => { throw new Error('fail'); });
        } catch {
          // Expected
        }
      }

      // Try when open
      try {
        await breaker.execute(async () => 'success');
      } catch {
        // Expected
      }

      const stats = breaker.getStats();
      expect(stats.rejectedRequests).toBe(1);
    });
  });

  describe('manual controls', () => {
    it('should reset circuit', async () => {
      // Force open
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => { throw new Error('fail'); });
        } catch {
          // Expected
        }
      }

      expect(breaker.getState()).toBe('open');

      breaker.reset();

      expect(breaker.getState()).toBe('closed');
      expect(breaker.getStats().totalRequests).toBe(0);
    });

    it('should manually trip circuit', () => {
      expect(breaker.getState()).toBe('closed');

      breaker.trip();

      expect(breaker.getState()).toBe('open');
    });
  });
});

describe('RetryManager', () => {
  let manager: RetryManager;

  beforeEach(() => {
    resetRetryManager();
    manager = new RetryManager({
      retry: { maxAttempts: 3, initialDelayMs: 10 },
      circuitBreaker: {
        failureThreshold: 2,
        resetTimeoutMs: 50,
        successThreshold: 1,
      },
    });
  });

  afterEach(() => {
    resetRetryManager();
  });

  describe('execute', () => {
    it('should execute successfully', async () => {
      const result = await manager.execute('test-service', async () => 'success');

      expect(result.success).toBe(true);
      expect(result.value).toBe('success');
    });

    it('should retry on failure', async () => {
      let attempts = 0;
      const result = await manager.execute('test-service', async () => {
        attempts++;
        if (attempts < 2) {
          throw new Error('ECONNRESET');
        }
        return 'success';
      });

      expect(result.success).toBe(true);
      expect(attempts).toBe(2);
    });

    it('should open circuit after failures', async () => {
      // Fail enough to open circuit
      for (let i = 0; i < 3; i++) {
        await manager.execute('failing-service', async () => {
          throw new Error('ECONNRESET');
        });
      }

      const state = manager.getCircuitState('failing-service');
      expect(state).toBe('open');
    });
  });

  describe('executeOrThrow', () => {
    it('should return value on success', async () => {
      const result = await manager.executeOrThrow('test-service', async () => 'success');
      expect(result).toBe('success');
    });

    it('should throw on failure', async () => {
      await expect(
        manager.executeOrThrow('test-service', async () => {
          throw new Error('AUTH_FAILED');
        })
      ).rejects.toThrow('AUTH_FAILED');
    });
  });

  describe('circuit management', () => {
    it('should get circuit stats', async () => {
      await manager.execute('test-service', async () => 'success');

      const stats = manager.getCircuitStats('test-service');
      expect(stats).toBeDefined();
      expect(stats?.successfulRequests).toBe(1);
    });

    it('should get all stats', async () => {
      await manager.execute('service-1', async () => 'success');
      await manager.execute('service-2', async () => 'success');

      const allStats = manager.getAllStats();
      expect(allStats.size).toBe(2);
    });

    it('should reset specific circuit', async () => {
      // Fail to open circuit
      for (let i = 0; i < 3; i++) {
        await manager.execute('test-service', async () => {
          throw new Error('ECONNRESET');
        });
      }

      expect(manager.getCircuitState('test-service')).toBe('open');

      manager.resetCircuit('test-service');

      expect(manager.getCircuitState('test-service')).toBe('closed');
    });

    it('should clear circuit', async () => {
      await manager.execute('test-service', async () => 'success');
      expect(manager.getCircuitStats('test-service')).toBeDefined();

      manager.clearCircuit('test-service');
      expect(manager.getCircuitStats('test-service')).toBeUndefined();
    });
  });

  describe('events', () => {
    it('should emit circuit events', async () => {
      const events: string[] = [];

      manager.on('circuit-state-change', (serviceId, from, to) => {
        events.push(`${serviceId}: ${from} -> ${to}`);
      });

      // Fail enough to open
      for (let i = 0; i < 3; i++) {
        await manager.execute('test-service', async () => {
          throw new Error('ECONNRESET');
        });
      }

      expect(events.some(e => e.includes('open'))).toBe(true);
    });
  });
});

describe('Singleton', () => {
  beforeEach(() => {
    resetRetryManager();
  });

  afterEach(() => {
    resetRetryManager();
  });

  it('should return same instance', () => {
    const manager1 = getRetryManager();
    const manager2 = getRetryManager();

    expect(manager1).toBe(manager2);
  });

  it('should reset instance', () => {
    const manager1 = getRetryManager();
    resetRetryManager();
    const manager2 = getRetryManager();

    expect(manager1).not.toBe(manager2);
  });
});

describe('Decorators', () => {
  describe('withRetry', () => {
    it('should make function retryable', async () => {
      let attempts = 0;
      const fn = withRetry(
        async () => {
          attempts++;
          if (attempts < 2) {
            throw new Error('ECONNRESET');
          }
          return 'success';
        },
        { maxAttempts: 3, initialDelayMs: 10 }
      );

      const result = await fn();
      expect(result).toBe('success');
      expect(attempts).toBe(2);
    });
  });

  describe('withCircuitBreaker', () => {
    it('should protect function with circuit breaker', async () => {
      let calls = 0;
      const fn = withCircuitBreaker(
        async () => {
          calls++;
          throw new Error('fail');
        },
        'test-service',
        { failureThreshold: 2, resetTimeoutMs: 100 }
      );

      // Fail enough to open
      for (let i = 0; i < 3; i++) {
        try {
          await fn();
        } catch {
          // Expected
        }
      }

      // Circuit should be open, calls should be blocked
      expect(calls).toBe(2); // Only 2 calls should go through
    });
  });
});
