/**
 * Circuit Breaker Unit Tests
 *
 * Tests the circuit breaker pattern implementation for API provider resilience.
 */

import {
  CircuitBreaker,
  CircuitState,
  CircuitOpenError,
  getCircuitBreaker,
  resetCircuitBreaker,
  resetAllCircuitBreakers,
  getAllCircuitBreakerStats,
} from '../../src/providers/circuit-breaker.js';

describe('CircuitBreaker', () => {
  let cb: CircuitBreaker;

  beforeEach(() => {
    cb = new CircuitBreaker({
      failureThreshold: 3,
      resetTimeoutMs: 100,
      halfOpenMaxAttempts: 2,
      name: 'test-breaker',
    });
  });

  afterEach(() => {
    cb.dispose();
  });

  // ==========================================================================
  // Initial State
  // ==========================================================================

  describe('initial state', () => {
    it('should start in CLOSED state', () => {
      expect(cb.getState()).toBe(CircuitState.CLOSED);
    });

    it('should have zero stats initially', () => {
      const stats = cb.getStats();
      expect(stats.consecutiveFailures).toBe(0);
      expect(stats.totalSuccesses).toBe(0);
      expect(stats.totalFailures).toBe(0);
      expect(stats.lastFailureTime).toBeNull();
      expect(stats.lastSuccessTime).toBeNull();
      expect(stats.halfOpenAttempts).toBe(0);
    });
  });

  // ==========================================================================
  // CLOSED State
  // ==========================================================================

  describe('CLOSED state', () => {
    it('should pass through successful calls', async () => {
      const result = await cb.execute(async () => 'success');
      expect(result).toBe('success');
    });

    it('should track successful calls', async () => {
      await cb.execute(async () => 'ok');
      const stats = cb.getStats();
      expect(stats.totalSuccesses).toBe(1);
      expect(stats.lastSuccessTime).not.toBeNull();
    });

    it('should propagate errors from the wrapped function', async () => {
      await expect(
        cb.execute(async () => { throw new Error('test error'); })
      ).rejects.toThrow('test error');
    });

    it('should track failures', async () => {
      try { await cb.execute(async () => { throw new Error('fail'); }); } catch { /* ignore expected error */ }
      const stats = cb.getStats();
      expect(stats.totalFailures).toBe(1);
      expect(stats.consecutiveFailures).toBe(1);
      expect(stats.lastFailureTime).not.toBeNull();
    });

    it('should reset consecutive failures on success', async () => {
      try { await cb.execute(async () => { throw new Error('fail'); }); } catch { /* ignore expected error */ }
      try { await cb.execute(async () => { throw new Error('fail'); }); } catch { /* ignore expected error */ }
      expect(cb.getStats().consecutiveFailures).toBe(2);

      await cb.execute(async () => 'ok');
      expect(cb.getStats().consecutiveFailures).toBe(0);
    });

    it('should remain CLOSED below failure threshold', async () => {
      // 2 failures (threshold is 3)
      try { await cb.execute(async () => { throw new Error('f1'); }); } catch { /* ignore expected error */ }
      try { await cb.execute(async () => { throw new Error('f2'); }); } catch { /* ignore expected error */ }

      expect(cb.getState()).toBe(CircuitState.CLOSED);
    });
  });

  // ==========================================================================
  // CLOSED -> OPEN Transition
  // ==========================================================================

  describe('CLOSED -> OPEN transition', () => {
    it('should open after reaching failure threshold', async () => {
      for (let i = 0; i < 3; i++) {
        try { await cb.execute(async () => { throw new Error(`fail-${i}`); }); } catch { /* ignore expected error */ }
      }

      expect(cb.getState()).toBe(CircuitState.OPEN);
    });

    it('should emit "open" event on transition', async () => {
      const openHandler = jest.fn();
      cb.on('open', openHandler);

      for (let i = 0; i < 3; i++) {
        try { await cb.execute(async () => { throw new Error(`fail-${i}`); }); } catch { /* ignore expected error */ }
      }

      expect(openHandler).toHaveBeenCalledTimes(1);
      expect(openHandler).toHaveBeenCalledWith({
        name: 'test-breaker',
        consecutiveFailures: 3,
      });
    });
  });

  // ==========================================================================
  // OPEN State
  // ==========================================================================

  describe('OPEN state', () => {
    beforeEach(async () => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try { await cb.execute(async () => { throw new Error(`fail-${i}`); }); } catch { /* ignore expected error */ }
      }
      expect(cb.getState()).toBe(CircuitState.OPEN);
    });

    it('should reject calls immediately with CircuitOpenError', async () => {
      await expect(
        cb.execute(async () => 'should not run')
      ).rejects.toThrow(CircuitOpenError);
    });

    it('should include circuit name in error', async () => {
      try {
        await cb.execute(async () => 'nope');
      } catch (err) {
        expect(err).toBeInstanceOf(CircuitOpenError);
        expect((err as CircuitOpenError).circuitName).toBe('test-breaker');
      }
    });

    it('should include time until next attempt in error', async () => {
      try {
        await cb.execute(async () => 'nope');
      } catch (err) {
        expect(err).toBeInstanceOf(CircuitOpenError);
        expect((err as CircuitOpenError).nextAttemptMs).toBeGreaterThan(0);
        expect((err as CircuitOpenError).nextAttemptMs).toBeLessThanOrEqual(100);
      }
    });

    it('should not execute the wrapped function', async () => {
      const fn = jest.fn().mockResolvedValue('result');
      try { await cb.execute(fn); } catch { /* ignore expected error */ }
      expect(fn).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // OPEN -> HALF_OPEN Transition
  // ==========================================================================

  describe('OPEN -> HALF_OPEN transition', () => {
    beforeEach(async () => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try { await cb.execute(async () => { throw new Error(`fail-${i}`); }); } catch { /* ignore expected error */ }
      }
    });

    it('should transition to HALF_OPEN after resetTimeoutMs', async () => {
      // Wait for resetTimeoutMs (100ms)
      await new Promise(resolve => setTimeout(resolve, 120));

      expect(cb.getState()).toBe(CircuitState.HALF_OPEN);
    });

    it('should emit "half-open" event on transition', async () => {
      const halfOpenHandler = jest.fn();
      cb.on('half-open', halfOpenHandler);

      await new Promise(resolve => setTimeout(resolve, 120));

      // Trigger the transition by making a call
      try { await cb.execute(async () => 'test'); } catch { /* ignore expected error */ }

      expect(halfOpenHandler).toHaveBeenCalledTimes(1);
      expect(halfOpenHandler).toHaveBeenCalledWith({ name: 'test-breaker' });
    });

    it('should allow calls after timeout expires', async () => {
      await new Promise(resolve => setTimeout(resolve, 120));

      const result = await cb.execute(async () => 'recovered');
      expect(result).toBe('recovered');
    });
  });

  // ==========================================================================
  // HALF_OPEN -> CLOSED Transition
  // ==========================================================================

  describe('HALF_OPEN -> CLOSED transition', () => {
    beforeEach(async () => {
      // Open, then wait for half-open
      for (let i = 0; i < 3; i++) {
        try { await cb.execute(async () => { throw new Error(`fail-${i}`); }); } catch { /* ignore expected error */ }
      }
      await new Promise(resolve => setTimeout(resolve, 120));
    });

    it('should close on successful call in HALF_OPEN', async () => {
      await cb.execute(async () => 'success');
      expect(cb.getState()).toBe(CircuitState.CLOSED);
    });

    it('should emit "close" event on recovery', async () => {
      const closeHandler = jest.fn();
      cb.on('close', closeHandler);

      await cb.execute(async () => 'success');

      expect(closeHandler).toHaveBeenCalledTimes(1);
      expect(closeHandler).toHaveBeenCalledWith({ name: 'test-breaker' });
    });

    it('should reset consecutive failures on close', async () => {
      await cb.execute(async () => 'success');
      expect(cb.getStats().consecutiveFailures).toBe(0);
    });
  });

  // ==========================================================================
  // HALF_OPEN -> OPEN Transition (failure during recovery)
  // ==========================================================================

  describe('HALF_OPEN -> OPEN on failure', () => {
    beforeEach(async () => {
      // Open, then wait for half-open
      for (let i = 0; i < 3; i++) {
        try { await cb.execute(async () => { throw new Error(`fail-${i}`); }); } catch { /* ignore expected error */ }
      }
      await new Promise(resolve => setTimeout(resolve, 120));
    });

    it('should reopen on failure in HALF_OPEN', async () => {
      try {
        await cb.execute(async () => { throw new Error('recovery failed'); });
      } catch { /* ignore expected error */ }

      expect(cb.getState()).toBe(CircuitState.OPEN);
    });

    it('should emit "open" event again', async () => {
      const openHandler = jest.fn();
      cb.on('open', openHandler);

      try {
        await cb.execute(async () => { throw new Error('recovery failed'); });
      } catch { /* ignore expected error */ }

      expect(openHandler).toHaveBeenCalledTimes(1);
    });
  });

  // ==========================================================================
  // HALF_OPEN Max Attempts
  // ==========================================================================

  describe('HALF_OPEN max attempts', () => {
    it('should reopen after exceeding halfOpenMaxAttempts', async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 2,
        resetTimeoutMs: 50,
        halfOpenMaxAttempts: 2,
        name: 'max-attempts-test',
      });

      // Open the circuit
      try { await breaker.execute(async () => { throw new Error('f1'); }); } catch { /* ignore expected error */ }
      try { await breaker.execute(async () => { throw new Error('f2'); }); } catch { /* ignore expected error */ }
      expect(breaker.getState()).toBe(CircuitState.OPEN);

      // Wait for half-open
      await new Promise(resolve => setTimeout(resolve, 70));

      // Use up halfOpenMaxAttempts with failures
      try { await breaker.execute(async () => { throw new Error('ho1'); }); } catch { /* ignore expected error */ }
      // After first half-open failure, circuit reopens
      expect(breaker.getState()).toBe(CircuitState.OPEN);

      breaker.dispose();
    });
  });

  // ==========================================================================
  // Reset
  // ==========================================================================

  describe('reset', () => {
    it('should reset all state to initial', async () => {
      for (let i = 0; i < 3; i++) {
        try { await cb.execute(async () => { throw new Error(`fail-${i}`); }); } catch { /* ignore expected error */ }
      }

      cb.reset();

      expect(cb.getState()).toBe(CircuitState.CLOSED);
      const stats = cb.getStats();
      expect(stats.consecutiveFailures).toBe(0);
      expect(stats.totalSuccesses).toBe(0);
      expect(stats.totalFailures).toBe(0);
    });
  });

  // ==========================================================================
  // Events
  // ==========================================================================

  describe('events', () => {
    it('should emit all three state events in a full cycle', async () => {
      const events: string[] = [];
      cb.on('open', () => events.push('open'));
      cb.on('half-open', () => events.push('half-open'));
      cb.on('close', () => events.push('close'));

      // CLOSED -> OPEN
      for (let i = 0; i < 3; i++) {
        try { await cb.execute(async () => { throw new Error(`fail-${i}`); }); } catch { /* ignore expected error */ }
      }

      // Wait for OPEN -> HALF_OPEN
      await new Promise(resolve => setTimeout(resolve, 120));

      // HALF_OPEN -> CLOSED
      await cb.execute(async () => 'recovered');

      expect(events).toEqual(['open', 'half-open', 'close']);
    });
  });

  // ==========================================================================
  // CircuitOpenError
  // ==========================================================================

  describe('CircuitOpenError', () => {
    it('should have correct name', () => {
      const err = new CircuitOpenError('test', 5000);
      expect(err.name).toBe('CircuitOpenError');
    });

    it('should have correct circuitName', () => {
      const err = new CircuitOpenError('my-provider', 5000);
      expect(err.circuitName).toBe('my-provider');
    });

    it('should have correct nextAttemptMs', () => {
      const err = new CircuitOpenError('test', 3000);
      expect(err.nextAttemptMs).toBe(3000);
    });

    it('should be instanceof Error', () => {
      const err = new CircuitOpenError('test', 5000);
      expect(err).toBeInstanceOf(Error);
    });

    it('should have descriptive message', () => {
      const err = new CircuitOpenError('grok-api', 30000);
      expect(err.message).toContain('grok-api');
      expect(err.message).toContain('OPEN');
      expect(err.message).toContain('30s');
    });
  });
});

// ============================================================================
// Per-Provider Registry Tests
// ============================================================================

describe('Circuit Breaker Registry', () => {
  afterEach(() => {
    resetAllCircuitBreakers();
  });

  describe('getCircuitBreaker', () => {
    it('should create a new circuit breaker for unknown key', () => {
      const cb = getCircuitBreaker('provider-a');
      expect(cb).toBeInstanceOf(CircuitBreaker);
      expect(cb.getState()).toBe(CircuitState.CLOSED);
    });

    it('should return the same instance for the same key', () => {
      const cb1 = getCircuitBreaker('provider-a');
      const cb2 = getCircuitBreaker('provider-a');
      expect(cb1).toBe(cb2);
    });

    it('should return different instances for different keys', () => {
      const cb1 = getCircuitBreaker('provider-a');
      const cb2 = getCircuitBreaker('provider-b');
      expect(cb1).not.toBe(cb2);
    });

    it('should apply config on creation', () => {
      const cb = getCircuitBreaker('provider-c', { failureThreshold: 10 });
      // Config is internal, but we can verify it works by checking behavior
      expect(cb.getState()).toBe(CircuitState.CLOSED);
    });
  });

  describe('per-provider isolation', () => {
    it('should track failures independently per provider', async () => {
      const cbA = getCircuitBreaker('provider-a', { failureThreshold: 2, resetTimeoutMs: 1000 });
      const cbB = getCircuitBreaker('provider-b', { failureThreshold: 2, resetTimeoutMs: 1000 });

      // Fail provider A
      try { await cbA.execute(async () => { throw new Error('a1'); }); } catch { /* ignore expected error */ }
      try { await cbA.execute(async () => { throw new Error('a2'); }); } catch { /* ignore expected error */ }

      // Provider A should be OPEN
      expect(cbA.getState()).toBe(CircuitState.OPEN);

      // Provider B should still be CLOSED
      expect(cbB.getState()).toBe(CircuitState.CLOSED);

      // Provider B should still work
      const result = await cbB.execute(async () => 'b-ok');
      expect(result).toBe('b-ok');
    });
  });

  describe('resetCircuitBreaker', () => {
    it('should remove a specific circuit breaker', () => {
      const cb1 = getCircuitBreaker('provider-x');
      resetCircuitBreaker('provider-x');
      const cb2 = getCircuitBreaker('provider-x');
      expect(cb1).not.toBe(cb2);
    });

    it('should not affect other circuit breakers', () => {
      const cbA = getCircuitBreaker('provider-a');
      const cbB = getCircuitBreaker('provider-b');

      resetCircuitBreaker('provider-a');

      // B should still be the same instance
      const cbB2 = getCircuitBreaker('provider-b');
      expect(cbB).toBe(cbB2);
    });

    it('should handle resetting non-existent key gracefully', () => {
      expect(() => resetCircuitBreaker('non-existent')).not.toThrow();
    });
  });

  describe('resetAllCircuitBreakers', () => {
    it('should clear all circuit breakers', () => {
      const cb1 = getCircuitBreaker('p1');
      const cb2 = getCircuitBreaker('p2');

      resetAllCircuitBreakers();

      const cb1New = getCircuitBreaker('p1');
      const cb2New = getCircuitBreaker('p2');

      expect(cb1).not.toBe(cb1New);
      expect(cb2).not.toBe(cb2New);
    });
  });

  describe('getAllCircuitBreakerStats', () => {
    it('should return stats for all active breakers', async () => {
      const cbA = getCircuitBreaker('alpha');
      const cbB = getCircuitBreaker('beta');

      await cbA.execute(async () => 'ok');
      try { await cbB.execute(async () => { throw new Error('fail'); }); } catch { /* ignore expected error */ }

      const allStats = getAllCircuitBreakerStats();

      expect(allStats['alpha']).toBeDefined();
      expect(allStats['alpha'].totalSuccesses).toBe(1);
      expect(allStats['beta']).toBeDefined();
      expect(allStats['beta'].totalFailures).toBe(1);
    });

    it('should return empty object when no breakers exist', () => {
      const allStats = getAllCircuitBreakerStats();
      expect(Object.keys(allStats)).toHaveLength(0);
    });
  });
});
