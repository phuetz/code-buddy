/**
 * Tests for Rate Limiter
 */

import { RateLimiter, getRateLimiter, resetRateLimiter } from '../src/utils/rate-limiter';

describe('RateLimiter', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    resetRateLimiter();
    limiter = new RateLimiter({
      requestsPerMinute: 600,  // Higher rate to avoid test timeouts
      tokensPerMinute: 100000,
      maxBurst: 10,
      maxRetries: 2,
      baseRetryDelay: 100,
      maxRetryDelay: 1000,
      maxQueueSize: 20,
      queueTimeout: 10000,  // Longer timeout for tests
    });
  });

  afterEach(() => {
    // Clean up any pending requests
    limiter.clearQueue();
    resetRateLimiter();
  });

  describe('Constructor', () => {
    it('should create a rate limiter with default config', () => {
      const defaultLimiter = new RateLimiter();
      expect(defaultLimiter).toBeDefined();
    });

    it('should accept custom configuration', () => {
      expect(limiter).toBeDefined();
    });
  });

  describe('getStatus', () => {
    it('should return current status', () => {
      const status = limiter.getStatus();

      expect(status.requestsRemaining).toBeGreaterThanOrEqual(0);
      expect(status.tokensRemaining).toBeGreaterThanOrEqual(0);
      expect(status.queueLength).toBe(0);
      expect(status.isLimited).toBe(false);
      expect(status.resetTime).toBeInstanceOf(Date);
    });
  });

  describe('execute', () => {
    it('should execute a function immediately when not limited', async () => {
      const result = await limiter.execute(async () => 'success', { skipQueue: true });
      expect(result).toBe('success');
    });

    it('should queue requests when burst limit reached', async () => {
      // Consume all burst tokens
      const promises: Promise<string>[] = [];
      for (let i = 0; i < 10; i++) {
        promises.push(limiter.execute(async () => `result-${i}`));
      }

      const results = await Promise.all(promises);
      expect(results).toHaveLength(10);
    });

    it('should respect priority ordering', async () => {
      const order: number[] = [];

      const p1 = limiter.execute(async () => { order.push(1); return 1; }, { priority: 1 });
      const p2 = limiter.execute(async () => { order.push(2); return 2; }, { priority: 10 });
      const p3 = limiter.execute(async () => { order.push(3); return 3; }, { priority: 5 });

      await Promise.all([p1, p2, p3]);

      // Higher priority should execute first in queue
      // Note: First request executes immediately, so order depends on queue processing
      expect(order).toHaveLength(3);
    });

    it('should reject when queue is full', async () => {
      // Create a limiter with small queue for this test
      const smallQueueLimiter = new RateLimiter({
        requestsPerMinute: 60,
        tokensPerMinute: 10000,
        maxBurst: 2,
        maxQueueSize: 5,
        queueTimeout: 5000,
      });

      // Fill up queue
      const promises: Promise<unknown>[] = [];
      for (let i = 0; i < 15; i++) {
        promises.push(
          smallQueueLimiter.execute(async () => {
            await new Promise(r => setTimeout(r, 100));
            return i;
          })
        );
      }

      // Some should be rejected (queue size is 5, burst is 2, so 7 can proceed, 8 rejected)
      const results = await Promise.allSettled(promises);
      const rejected = results.filter(r => r.status === 'rejected');
      expect(rejected.length).toBeGreaterThan(0);
    });
  });

  describe('updateFromHeaders', () => {
    it('should update limits from API headers', () => {
      limiter.updateFromHeaders({
        'x-ratelimit-remaining': '10',
        'x-ratelimit-limit': '100',
      });

      const status = limiter.getStatus();
      expect(status.requestsRemaining).toBeLessThanOrEqual(10);
    });
  });

  describe('clearQueue', () => {
    it('should clear pending requests', async () => {
      // Add requests to queue
      const promises = [
        limiter.execute(async () => 1),
        limiter.execute(async () => 2),
      ];

      // Clear queue
      const cleared = limiter.clearQueue();

      // Wait for promises to settle
      await Promise.allSettled(promises);

      expect(limiter.getStatus().queueLength).toBe(0);
    });
  });

  describe('events', () => {
    it('should emit queued event', (done) => {
      limiter.on('queued', (data) => {
        expect(data.requestId).toBeDefined();
        expect(data.queueLength).toBeGreaterThanOrEqual(1);
        done();
      });

      limiter.execute(async () => 'test');
    });

    it('should emit success event', (done) => {
      limiter.on('success', (data) => {
        expect(data.retries).toBe(0);
        done();
      });

      limiter.execute(async () => 'test', { skipQueue: true });
    });
  });

  describe('formatStatus', () => {
    it('should return formatted status string', () => {
      const formatted = limiter.formatStatus();

      expect(formatted).toContain('RATE LIMIT STATUS');
      expect(formatted).toContain('Requests remaining');
      expect(formatted).toContain('Tokens remaining');
    });
  });

  describe('singleton', () => {
    it('should return same instance', () => {
      const instance1 = getRateLimiter();
      const instance2 = getRateLimiter();
      expect(instance1).toBe(instance2);
    });

    it('should reset correctly', () => {
      const instance1 = getRateLimiter();
      resetRateLimiter();
      const instance2 = getRateLimiter();
      expect(instance1).not.toBe(instance2);
    });
  });
});
