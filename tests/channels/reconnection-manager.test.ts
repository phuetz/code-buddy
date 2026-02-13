/**
 * ReconnectionManager Tests
 *
 * Tests for the shared reconnection utility with exponential backoff.
 */

import { ReconnectionManager } from '../../src/channels/reconnection-manager.js';
import type { ReconnectionConfig } from '../../src/channels/reconnection-manager.js';

// Mock logger
jest.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('ReconnectionManager', () => {
  let manager: ReconnectionManager;

  beforeEach(() => {
    jest.useFakeTimers();
    manager = new ReconnectionManager('test-channel');
  });

  afterEach(() => {
    manager.cancel();
    jest.useRealTimers();
  });

  // ==========================================================================
  // Construction & Configuration
  // ==========================================================================

  describe('constructor', () => {
    it('should create with default config', () => {
      const config = manager.getConfig();
      expect(config.maxRetries).toBe(10);
      expect(config.initialDelayMs).toBe(1000);
      expect(config.maxDelayMs).toBe(60000);
      expect(config.backoffMultiplier).toBe(2);
      expect(config.jitterMs).toBe(500);
    });

    it('should accept partial config overrides', () => {
      const m = new ReconnectionManager('test', { maxRetries: 5, initialDelayMs: 500 });
      const config = m.getConfig();
      expect(config.maxRetries).toBe(5);
      expect(config.initialDelayMs).toBe(500);
      expect(config.maxDelayMs).toBe(60000); // default
      m.cancel();
    });

    it('should store the channel name', () => {
      expect(manager.getName()).toBe('test-channel');
    });
  });

  // ==========================================================================
  // Exponential Backoff
  // ==========================================================================

  describe('getCurrentDelay', () => {
    it('should return initialDelay + jitter for first retry', () => {
      // Mock random to return 0 for predictable testing
      jest.spyOn(Math, 'random').mockReturnValue(0);

      const m = new ReconnectionManager('test', { jitterMs: 0, initialDelayMs: 1000 });
      // Simulate being on retry 1
      (m as unknown as { retryCount: number }).retryCount = 1;
      const delay = m.getCurrentDelay();
      expect(delay).toBe(1000);
      m.cancel();

      jest.spyOn(Math, 'random').mockRestore();
    });

    it('should double delay on each retry with multiplier 2', () => {
      jest.spyOn(Math, 'random').mockReturnValue(0);

      const m = new ReconnectionManager('test', {
        initialDelayMs: 1000,
        backoffMultiplier: 2,
        jitterMs: 0,
        maxDelayMs: 100000,
      });

      (m as unknown as { retryCount: number }).retryCount = 1;
      expect(m.getCurrentDelay()).toBe(1000);

      (m as unknown as { retryCount: number }).retryCount = 2;
      expect(m.getCurrentDelay()).toBe(2000);

      (m as unknown as { retryCount: number }).retryCount = 3;
      expect(m.getCurrentDelay()).toBe(4000);

      (m as unknown as { retryCount: number }).retryCount = 4;
      expect(m.getCurrentDelay()).toBe(8000);

      m.cancel();
      jest.spyOn(Math, 'random').mockRestore();
    });

    it('should cap delay at maxDelayMs', () => {
      jest.spyOn(Math, 'random').mockReturnValue(0);

      const m = new ReconnectionManager('test', {
        initialDelayMs: 1000,
        backoffMultiplier: 2,
        jitterMs: 0,
        maxDelayMs: 5000,
      });

      (m as unknown as { retryCount: number }).retryCount = 10;
      expect(m.getCurrentDelay()).toBe(5000);

      m.cancel();
      jest.spyOn(Math, 'random').mockRestore();
    });

    it('should add jitter to delay', () => {
      jest.spyOn(Math, 'random').mockReturnValue(0.5);

      const m = new ReconnectionManager('test', {
        initialDelayMs: 1000,
        backoffMultiplier: 2,
        jitterMs: 1000,
        maxDelayMs: 100000,
      });

      (m as unknown as { retryCount: number }).retryCount = 1;
      const delay = m.getCurrentDelay();
      // 1000 (base) + 500 (jitter: floor(0.5 * 1000))
      expect(delay).toBe(1500);

      m.cancel();
      jest.spyOn(Math, 'random').mockRestore();
    });

    it('should handle zero jitter', () => {
      jest.spyOn(Math, 'random').mockReturnValue(0.99);

      const m = new ReconnectionManager('test', {
        initialDelayMs: 2000,
        jitterMs: 0,
      });

      (m as unknown as { retryCount: number }).retryCount = 1;
      expect(m.getCurrentDelay()).toBe(2000);

      m.cancel();
      jest.spyOn(Math, 'random').mockRestore();
    });
  });

  // ==========================================================================
  // scheduleReconnect
  // ==========================================================================

  describe('scheduleReconnect', () => {
    it('should call connectFn after delay', async () => {
      jest.spyOn(Math, 'random').mockReturnValue(0);

      const m = new ReconnectionManager('test', {
        initialDelayMs: 1000,
        jitterMs: 0,
      });

      const connectFn = jest.fn().mockResolvedValue(undefined);
      m.scheduleReconnect(connectFn);

      expect(connectFn).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1000);
      // Let the async callback execute
      await Promise.resolve();
      await Promise.resolve();

      expect(connectFn).toHaveBeenCalledTimes(1);

      m.cancel();
      jest.spyOn(Math, 'random').mockRestore();
    });

    it('should increment retry count', () => {
      jest.spyOn(Math, 'random').mockReturnValue(0);

      const m = new ReconnectionManager('test', {
        initialDelayMs: 100,
        jitterMs: 0,
      });

      expect(m.getRetryCount()).toBe(0);

      m.scheduleReconnect(jest.fn().mockResolvedValue(undefined));
      expect(m.getRetryCount()).toBe(1);

      m.cancel();
      jest.spyOn(Math, 'random').mockRestore();
    });

    it('should emit reconnecting event with attempt and delay', () => {
      jest.spyOn(Math, 'random').mockReturnValue(0);

      const m = new ReconnectionManager('test', {
        initialDelayMs: 1000,
        jitterMs: 0,
      });

      const handler = jest.fn();
      m.on('reconnecting', handler);

      m.scheduleReconnect(jest.fn().mockResolvedValue(undefined));

      expect(handler).toHaveBeenCalledWith(1, 1000);

      m.cancel();
      jest.spyOn(Math, 'random').mockRestore();
    });

    it('should emit reconnected event on success', async () => {
      jest.spyOn(Math, 'random').mockReturnValue(0);

      const m = new ReconnectionManager('test', {
        initialDelayMs: 100,
        jitterMs: 0,
      });

      const handler = jest.fn();
      m.on('reconnected', handler);

      m.scheduleReconnect(jest.fn().mockResolvedValue(undefined));

      jest.advanceTimersByTime(100);
      await Promise.resolve();
      await Promise.resolve();

      expect(handler).toHaveBeenCalledWith(1);

      m.cancel();
      jest.spyOn(Math, 'random').mockRestore();
    });

    it('should emit error event on failure', async () => {
      jest.spyOn(Math, 'random').mockReturnValue(0);

      const m = new ReconnectionManager('test', {
        initialDelayMs: 100,
        jitterMs: 0,
      });

      const handler = jest.fn();
      m.on('error', handler);

      const error = new Error('Connection failed');
      m.scheduleReconnect(jest.fn().mockRejectedValue(error));

      jest.advanceTimersByTime(100);
      await Promise.resolve();
      await Promise.resolve();

      expect(handler).toHaveBeenCalledWith(error, 1);

      m.cancel();
      jest.spyOn(Math, 'random').mockRestore();
    });

    it('should not schedule if already active', () => {
      jest.spyOn(Math, 'random').mockReturnValue(0);

      const m = new ReconnectionManager('test', {
        initialDelayMs: 5000,
        jitterMs: 0,
      });

      const fn1 = jest.fn().mockResolvedValue(undefined);
      const fn2 = jest.fn().mockResolvedValue(undefined);

      m.scheduleReconnect(fn1);
      m.scheduleReconnect(fn2); // Should be ignored

      expect(m.getRetryCount()).toBe(1); // Not 2

      m.cancel();
      jest.spyOn(Math, 'random').mockRestore();
    });

    it('should handle non-Error rejection', async () => {
      jest.spyOn(Math, 'random').mockReturnValue(0);

      const m = new ReconnectionManager('test', {
        initialDelayMs: 100,
        jitterMs: 0,
      });

      const handler = jest.fn();
      m.on('error', handler);

      m.scheduleReconnect(jest.fn().mockRejectedValue('string error'));

      jest.advanceTimersByTime(100);
      await Promise.resolve();
      await Promise.resolve();

      expect(handler).toHaveBeenCalled();
      const emittedError = handler.mock.calls[0][0];
      expect(emittedError).toBeInstanceOf(Error);
      expect(emittedError.message).toBe('string error');

      m.cancel();
      jest.spyOn(Math, 'random').mockRestore();
    });
  });

  // ==========================================================================
  // Max Retry Exhaustion
  // ==========================================================================

  describe('exhaustion', () => {
    it('should be exhausted after maxRetries', () => {
      const m = new ReconnectionManager('test', { maxRetries: 3, jitterMs: 0 });

      expect(m.isExhausted()).toBe(false);

      (m as unknown as { retryCount: number }).retryCount = 2;
      expect(m.isExhausted()).toBe(false);

      (m as unknown as { retryCount: number }).retryCount = 3;
      expect(m.isExhausted()).toBe(true);

      m.cancel();
    });

    it('should emit exhausted event when max retries exceeded', () => {
      jest.spyOn(Math, 'random').mockReturnValue(0);

      const m = new ReconnectionManager('test', {
        maxRetries: 2,
        initialDelayMs: 100,
        jitterMs: 0,
      });

      const handler = jest.fn();
      m.on('exhausted', handler);

      // Simulate exhaustion
      (m as unknown as { retryCount: number }).retryCount = 2;
      m.scheduleReconnect(jest.fn().mockResolvedValue(undefined));

      expect(handler).toHaveBeenCalledWith(2);

      m.cancel();
      jest.spyOn(Math, 'random').mockRestore();
    });

    it('should not call connectFn when exhausted', () => {
      jest.spyOn(Math, 'random').mockReturnValue(0);

      const m = new ReconnectionManager('test', {
        maxRetries: 1,
        initialDelayMs: 100,
        jitterMs: 0,
      });

      (m as unknown as { retryCount: number }).retryCount = 1;
      const connectFn = jest.fn();
      m.scheduleReconnect(connectFn);

      jest.advanceTimersByTime(10000);

      expect(connectFn).not.toHaveBeenCalled();

      m.cancel();
      jest.spyOn(Math, 'random').mockRestore();
    });
  });

  // ==========================================================================
  // onConnected / Reset
  // ==========================================================================

  describe('onConnected', () => {
    it('should reset retry count to 0', () => {
      (manager as unknown as { retryCount: number }).retryCount = 5;
      manager.onConnected();
      expect(manager.getRetryCount()).toBe(0);
    });

    it('should cancel pending timer', () => {
      jest.spyOn(Math, 'random').mockReturnValue(0);

      const m = new ReconnectionManager('test', {
        initialDelayMs: 5000,
        jitterMs: 0,
      });

      m.scheduleReconnect(jest.fn().mockResolvedValue(undefined));
      expect(m.isPending()).toBe(true);

      m.onConnected();
      expect(m.isPending()).toBe(false);
      expect(m.getRetryCount()).toBe(0);

      m.cancel();
      jest.spyOn(Math, 'random').mockRestore();
    });

    it('should allow new reconnection attempts after reset', async () => {
      jest.spyOn(Math, 'random').mockReturnValue(0);

      const m = new ReconnectionManager('test', {
        initialDelayMs: 100,
        jitterMs: 0,
        maxRetries: 3,
      });

      // Simulate 2 retries
      (m as unknown as { retryCount: number }).retryCount = 2;
      m.onConnected();

      expect(m.getRetryCount()).toBe(0);
      expect(m.isExhausted()).toBe(false);

      const connectFn = jest.fn().mockResolvedValue(undefined);
      m.scheduleReconnect(connectFn);

      jest.advanceTimersByTime(100);
      await Promise.resolve();
      await Promise.resolve();

      expect(connectFn).toHaveBeenCalled();

      m.cancel();
      jest.spyOn(Math, 'random').mockRestore();
    });
  });

  // ==========================================================================
  // Cancel
  // ==========================================================================

  describe('cancel', () => {
    it('should cancel pending reconnection timer', () => {
      jest.spyOn(Math, 'random').mockReturnValue(0);

      const m = new ReconnectionManager('test', {
        initialDelayMs: 5000,
        jitterMs: 0,
      });

      const connectFn = jest.fn();
      m.scheduleReconnect(connectFn);

      m.cancel();

      jest.advanceTimersByTime(10000);

      expect(connectFn).not.toHaveBeenCalled();
      expect(m.isPending()).toBe(false);

      jest.spyOn(Math, 'random').mockRestore();
    });

    it('should be safe to call cancel when nothing is pending', () => {
      expect(() => manager.cancel()).not.toThrow();
    });

    it('should be safe to call cancel multiple times', () => {
      jest.spyOn(Math, 'random').mockReturnValue(0);

      manager.scheduleReconnect(jest.fn().mockResolvedValue(undefined));
      manager.cancel();
      manager.cancel();

      expect(manager.isPending()).toBe(false);

      jest.spyOn(Math, 'random').mockRestore();
    });
  });

  // ==========================================================================
  // isPending
  // ==========================================================================

  describe('isPending', () => {
    it('should return false initially', () => {
      expect(manager.isPending()).toBe(false);
    });

    it('should return true after scheduling', () => {
      jest.spyOn(Math, 'random').mockReturnValue(0);

      manager.scheduleReconnect(jest.fn().mockResolvedValue(undefined));
      expect(manager.isPending()).toBe(true);

      jest.spyOn(Math, 'random').mockRestore();
    });

    it('should return false after cancel', () => {
      jest.spyOn(Math, 'random').mockReturnValue(0);

      manager.scheduleReconnect(jest.fn().mockResolvedValue(undefined));
      manager.cancel();
      expect(manager.isPending()).toBe(false);

      jest.spyOn(Math, 'random').mockRestore();
    });
  });

  // ==========================================================================
  // Event Emissions
  // ==========================================================================

  describe('events', () => {
    it('should emit reconnecting before the delay starts', () => {
      jest.spyOn(Math, 'random').mockReturnValue(0);

      const m = new ReconnectionManager('test', {
        initialDelayMs: 5000,
        jitterMs: 0,
      });

      const events: string[] = [];
      m.on('reconnecting', () => events.push('reconnecting'));
      m.on('reconnected', () => events.push('reconnected'));

      m.scheduleReconnect(jest.fn().mockResolvedValue(undefined));

      expect(events).toEqual(['reconnecting']);

      m.cancel();
      jest.spyOn(Math, 'random').mockRestore();
    });

    it('should emit events in correct order on success', async () => {
      jest.spyOn(Math, 'random').mockReturnValue(0);

      const m = new ReconnectionManager('test', {
        initialDelayMs: 100,
        jitterMs: 0,
      });

      const events: string[] = [];
      m.on('reconnecting', () => events.push('reconnecting'));
      m.on('reconnected', () => events.push('reconnected'));
      m.on('error', () => events.push('error'));

      m.scheduleReconnect(jest.fn().mockResolvedValue(undefined));

      jest.advanceTimersByTime(100);
      await Promise.resolve();
      await Promise.resolve();

      expect(events).toEqual(['reconnecting', 'reconnected']);

      m.cancel();
      jest.spyOn(Math, 'random').mockRestore();
    });

    it('should emit events in correct order on failure', async () => {
      jest.spyOn(Math, 'random').mockReturnValue(0);

      const m = new ReconnectionManager('test', {
        initialDelayMs: 100,
        jitterMs: 0,
      });

      const events: string[] = [];
      m.on('reconnecting', () => events.push('reconnecting'));
      m.on('reconnected', () => events.push('reconnected'));
      m.on('error', () => events.push('error'));

      m.scheduleReconnect(jest.fn().mockRejectedValue(new Error('fail')));

      jest.advanceTimersByTime(100);
      await Promise.resolve();
      await Promise.resolve();

      expect(events).toEqual(['reconnecting', 'error']);

      m.cancel();
      jest.spyOn(Math, 'random').mockRestore();
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('edge cases', () => {
    it('should handle maxRetries of 0', () => {
      const m = new ReconnectionManager('test', { maxRetries: 0 });
      expect(m.isExhausted()).toBe(true);

      const connectFn = jest.fn();
      m.scheduleReconnect(connectFn);
      expect(connectFn).not.toHaveBeenCalled();

      m.cancel();
    });

    it('should handle very large backoff multiplier', () => {
      jest.spyOn(Math, 'random').mockReturnValue(0);

      const m = new ReconnectionManager('test', {
        initialDelayMs: 1000,
        backoffMultiplier: 100,
        maxDelayMs: 60000,
        jitterMs: 0,
      });

      (m as unknown as { retryCount: number }).retryCount = 3;
      // 1000 * 100^2 = 10,000,000 but capped at 60000
      expect(m.getCurrentDelay()).toBe(60000);

      m.cancel();
      jest.spyOn(Math, 'random').mockRestore();
    });

    it('should handle retryCount of 0 for getCurrentDelay', () => {
      jest.spyOn(Math, 'random').mockReturnValue(0);

      const m = new ReconnectionManager('test', {
        initialDelayMs: 1000,
        jitterMs: 0,
      });

      (m as unknown as { retryCount: number }).retryCount = 0;
      expect(m.getCurrentDelay()).toBe(1000);

      m.cancel();
      jest.spyOn(Math, 'random').mockRestore();
    });

    it('should allow scheduling after a failed attempt completes', async () => {
      jest.spyOn(Math, 'random').mockReturnValue(0);

      const m = new ReconnectionManager('test', {
        initialDelayMs: 100,
        jitterMs: 0,
        maxRetries: 5,
      });

      const fn1 = jest.fn().mockRejectedValue(new Error('fail'));
      m.scheduleReconnect(fn1);

      jest.advanceTimersByTime(100);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      // Now should be able to schedule again
      const fn2 = jest.fn().mockResolvedValue(undefined);
      m.scheduleReconnect(fn2);
      expect(m.getRetryCount()).toBe(2);

      m.cancel();
      jest.spyOn(Math, 'random').mockRestore();
    });
  });
});
