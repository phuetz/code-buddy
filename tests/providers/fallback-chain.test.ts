/**
 * Tests for Provider Fallback Chain
 *
 * Tests both the ProviderFallbackChain (circuit-breaker-based)
 * and ModelFailoverChain (simple failover) implementations.
 *
 * Covers: provider selection, failure recording, circuit breaker,
 * cooldown recovery, auto-promotion, rate limits, concurrent failover,
 * slow-response tracking, event emissions, and edge cases.
 */

// Mock logger before imports
jest.mock('../../src/utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import {
  ProviderFallbackChain,
  getFallbackChain,
  resetFallbackChain,
} from '../../src/providers/fallback-chain';
import {
  ModelFailoverChain,
} from '../../src/agents/model-failover';
import type { ProviderType } from '../../src/providers/types';

// ============================================================================
// ProviderFallbackChain (full circuit-breaker implementation)
// ============================================================================

describe('ProviderFallbackChain', () => {
  let chain: ProviderFallbackChain;

  beforeEach(() => {
    resetFallbackChain();
    chain = new ProviderFallbackChain({
      maxFailures: 3,
      cooldownMs: 1000,
      failureWindowMs: 5000,
      slowThresholdMs: 500,
      maxSlowResponses: 3,
      autoPromote: true,
    });
    chain.setFallbackChain(['grok', 'openai', 'claude']);
  });

  afterEach(() => {
    chain.dispose();
  });

  // ---------- Chain Setup ----------

  describe('setFallbackChain', () => {
    it('should set providers in order', () => {
      expect(chain.getFallbackChain()).toEqual(['grok', 'openai', 'claude']);
    });

    it('should throw if chain is empty', () => {
      expect(() => chain.setFallbackChain([])).toThrow('at least one provider');
    });

    it('should reset current index when chain is changed', () => {
      chain.setFallbackChain(['claude', 'grok']);
      expect(chain.getPrimaryProvider()).toBe('claude');
    });
  });

  // ---------- Provider Selection ----------

  describe('getNextProvider', () => {
    it('should return the first healthy provider', () => {
      expect(chain.getNextProvider()).toBe('grok');
    });

    it('should skip unhealthy providers', () => {
      // Mark grok as unhealthy
      chain.markUnhealthy('grok', 'down');

      const next = chain.getNextProvider();
      expect(next).toBe('openai');
    });

    it('should return null when all providers are exhausted', () => {
      chain.markUnhealthy('grok', 'down');
      chain.markUnhealthy('openai', 'down');
      chain.markUnhealthy('claude', 'down');

      const next = chain.getNextProvider();
      expect(next).toBeNull();
    });

    it('should emit chain:exhausted when all are down', () => {
      const listener = jest.fn();
      chain.on('chain:exhausted', listener);

      chain.markUnhealthy('grok', 'x');
      chain.markUnhealthy('openai', 'x');
      chain.markUnhealthy('claude', 'x');

      chain.getNextProvider();
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          attemptedProviders: expect.arrayContaining(['grok', 'openai', 'claude']),
        })
      );
    });

    it('should skip current when skipCurrent is true', () => {
      const next = chain.getNextProvider(true);
      expect(next).toBe('openai');
    });

    it('should emit provider:fallback when switching', () => {
      const listener = jest.fn();
      chain.on('provider:fallback', listener);

      chain.markUnhealthy('grok', 'down');
      chain.getNextProvider();

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'grok',
          to: 'openai',
        })
      );
    });
  });

  // ---------- Single Provider Success ----------

  describe('recordSuccess', () => {
    it('should keep provider healthy on success', () => {
      chain.recordSuccess('grok', 100);
      expect(chain.isProviderHealthy('grok')).toBe(true);
    });

    it('should emit provider:success event', () => {
      const listener = jest.fn();
      chain.on('provider:success', listener);

      chain.recordSuccess('grok', 200);
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'grok', responseTimeMs: 200 })
      );
    });

    it('should recover provider from unhealthy state on success', () => {
      chain.markUnhealthy('grok', 'temp error');
      expect(chain.isProviderHealthy('grok')).toBe(false);

      chain.recordSuccess('grok', 50);
      expect(chain.isProviderHealthy('grok')).toBe(true);
    });

    it('should emit provider:recovered when recovering from unhealthy', () => {
      const listener = jest.fn();
      chain.on('provider:recovered', listener);

      chain.markUnhealthy('grok', 'err');
      chain.recordSuccess('grok', 100);

      expect(listener).toHaveBeenCalledWith({ provider: 'grok' });
    });

    it('should reset consecutive slow count on fast response', () => {
      // Record some slow responses
      chain.recordSuccess('grok', 600);
      chain.recordSuccess('grok', 700);

      // Then a fast one
      chain.recordSuccess('grok', 100);

      const health = chain.getHealthStatus('grok');
      expect(health.consecutiveSlowResponses).toBe(0);
    });
  });

  // ---------- Failure & Circuit Breaker ----------

  describe('recordFailure', () => {
    it('should open circuit after maxFailures', () => {
      chain.recordFailure('grok', 'err1');
      chain.recordFailure('grok', 'err2');
      expect(chain.isProviderHealthy('grok')).toBe(true);

      chain.recordFailure('grok', 'err3');
      expect(chain.isProviderHealthy('grok')).toBe(false);
    });

    it('should emit provider:unhealthy when circuit opens', () => {
      const listener = jest.fn();
      chain.on('provider:unhealthy', listener);

      chain.recordFailure('grok', 'e1');
      chain.recordFailure('grok', 'e2');
      chain.recordFailure('grok', 'e3');

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'grok',
          failureCount: 3,
        })
      );
    });

    it('should emit provider:failure for each failure', () => {
      const listener = jest.fn();
      chain.on('provider:failure', listener);

      chain.recordFailure('openai', 'timeout');
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'openai', error: 'timeout' })
      );
    });

    it('should auto-promote backup when primary fails with autoPromote enabled', () => {
      const promoteListener = jest.fn();
      chain.on('provider:promoted', promoteListener);

      // Fail primary (grok) 3 times
      chain.recordFailure('grok', 'e1');
      chain.recordFailure('grok', 'e2');
      chain.recordFailure('grok', 'e3');

      expect(promoteListener).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'openai', previousPrimary: 'grok' })
      );
      expect(chain.getPrimaryProvider()).toBe('openai');
    });
  });

  // ---------- First Provider Fails -> Second Succeeds ----------

  describe('failover scenario', () => {
    it('should fall through to second provider when first is unhealthy', () => {
      // Mark grok as unhealthy
      chain.recordFailure('grok', 'e1');
      chain.recordFailure('grok', 'e2');
      chain.recordFailure('grok', 'e3');

      // Next should be openai
      const provider = chain.getNextProvider();
      expect(provider).toBe('openai');

      // Record success on openai
      chain.recordSuccess('openai', 100);
      expect(chain.isProviderHealthy('openai')).toBe(true);
    });
  });

  // ---------- All Providers Fail ----------

  describe('all providers fail', () => {
    it('should return null after all providers are marked unhealthy', () => {
      for (const p of ['grok', 'openai', 'claude'] as ProviderType[]) {
        chain.recordFailure(p, 'e1');
        chain.recordFailure(p, 'e2');
        chain.recordFailure(p, 'e3');
      }

      expect(chain.getNextProvider()).toBeNull();
    });
  });

  // ---------- Cooldown & Recovery ----------

  describe('cooldown recovery', () => {
    it('should attempt recovery after cooldown period', () => {
      jest.useFakeTimers();

      // Use a chain without autoPromote to simplify recovery testing
      const recoveryChain = new ProviderFallbackChain({
        maxFailures: 3,
        cooldownMs: 1000,
        failureWindowMs: 5000,
        autoPromote: false,
      });
      recoveryChain.setFallbackChain(['grok', 'openai', 'claude']);

      // Mark all providers unhealthy
      recoveryChain.markUnhealthy('grok', 'down');
      recoveryChain.markUnhealthy('openai', 'down');
      recoveryChain.markUnhealthy('claude', 'down');

      // Before cooldown, no provider is available
      expect(recoveryChain.getNextProvider()).toBeNull();

      // Advance past cooldown
      jest.advanceTimersByTime(1100);

      // Now grok (first in chain) should be eligible for recovery attempt
      const provider = recoveryChain.getNextProvider();
      expect(provider).toBe('grok');

      recoveryChain.dispose();
      jest.useRealTimers();
    });

    it('should not recover before cooldown expires', () => {
      jest.useFakeTimers();

      chain.recordFailure('grok', 'e1');
      chain.recordFailure('grok', 'e2');
      chain.recordFailure('grok', 'e3');

      chain.markUnhealthy('openai', 'x');
      chain.markUnhealthy('claude', 'x');

      // Advance less than cooldown
      jest.advanceTimersByTime(500);

      const provider = chain.getNextProvider();
      expect(provider).toBeNull();

      jest.useRealTimers();
    });
  });

  // ---------- Rate Limit Handling (429) ----------

  describe('rate limit handling (429 -> switch to next)', () => {
    it('should switch to next provider after rate limit failures', () => {
      chain.recordFailure('grok', '429 Too Many Requests');
      chain.recordFailure('grok', '429 Too Many Requests');
      chain.recordFailure('grok', '429 Too Many Requests');

      // grok is now unhealthy
      expect(chain.isProviderHealthy('grok')).toBe(false);

      // Next should be openai
      expect(chain.getNextProvider()).toBe('openai');
    });
  });

  // ---------- Concurrent Requests During Failover ----------

  describe('concurrent requests during failover', () => {
    it('should consistently return the same provider for concurrent callers', () => {
      // Multiple callers at the same time
      const p1 = chain.getNextProvider();
      const p2 = chain.getNextProvider();
      const p3 = chain.getNextProvider();

      expect(p1).toBe(p2);
      expect(p2).toBe(p3);
    });

    it('should handle mixed success/failure from concurrent flows', () => {
      // Simulate two concurrent streams using grok
      chain.recordSuccess('grok', 100);
      chain.recordFailure('grok', 'stream timeout');

      // Provider should still be healthy (only 1 failure < maxFailures)
      expect(chain.isProviderHealthy('grok')).toBe(true);
    });
  });

  // ---------- Slow Response Tracking ----------

  describe('slow response tracking', () => {
    it('should mark provider unhealthy after too many consecutive slow responses', () => {
      chain.recordSuccess('grok', 600); // slow (> 500ms threshold)
      chain.recordSuccess('grok', 700);
      chain.recordSuccess('grok', 800);

      expect(chain.isProviderHealthy('grok')).toBe(false);
    });

    it('should reset slow count on fast response', () => {
      chain.recordSuccess('grok', 600);
      chain.recordSuccess('grok', 700);
      chain.recordSuccess('grok', 100); // fast - resets counter

      expect(chain.isProviderHealthy('grok')).toBe(true);
    });
  });

  // ---------- Health Status ----------

  describe('getHealthStatus', () => {
    it('should return correct health stats', () => {
      chain.recordSuccess('grok', 100);
      chain.recordSuccess('grok', 200);
      chain.recordFailure('grok', 'err');

      const health = chain.getHealthStatus('grok');
      expect(health.provider).toBe('grok');
      expect(health.healthy).toBe(true);
      expect(health.successCount).toBe(2);
      expect(health.failureCount).toBe(1);
      expect(health.totalRequests).toBe(3);
      expect(health.avgResponseTimeMs).toBe(150);
      expect(health.lastSuccess).toBeDefined();
      expect(health.lastFailure).toBeDefined();
    });

    it('should return healthy status for unknown provider', () => {
      const health = chain.getHealthStatus('gemini' as ProviderType);
      expect(health.healthy).toBe(true);
      expect(health.totalRequests).toBe(0);
    });
  });

  describe('getAllHealthStatus', () => {
    it('should return status for all chain providers', () => {
      const statuses = chain.getAllHealthStatus();
      expect(statuses).toHaveLength(3);
      expect(statuses.map(s => s.provider)).toEqual(['grok', 'openai', 'claude']);
    });
  });

  // ---------- Provider Promotion ----------

  describe('promoteProvider', () => {
    it('should move provider to first position', () => {
      chain.promoteProvider('claude');
      expect(chain.getPrimaryProvider()).toBe('claude');
      expect(chain.getFallbackChain()).toEqual(['claude', 'grok', 'openai']);
    });

    it('should throw if provider is not in chain', () => {
      expect(() => chain.promoteProvider('gemini' as ProviderType)).toThrow('not in fallback chain');
    });

    it('should no-op if provider is already primary', () => {
      const listener = jest.fn();
      chain.on('provider:promoted', listener);

      chain.promoteProvider('grok');
      expect(listener).not.toHaveBeenCalled();
    });
  });

  // ---------- Manual Controls ----------

  describe('resetProvider', () => {
    it('should reset a provider health to clean state', () => {
      chain.recordFailure('grok', 'e1');
      chain.recordFailure('grok', 'e2');
      chain.recordFailure('grok', 'e3');
      expect(chain.isProviderHealthy('grok')).toBe(false);

      chain.resetProvider('grok');
      expect(chain.isProviderHealthy('grok')).toBe(true);

      const health = chain.getHealthStatus('grok');
      expect(health.failureCount).toBe(0);
    });
  });

  describe('markUnhealthy', () => {
    it('should immediately mark provider as unhealthy', () => {
      chain.markUnhealthy('openai', 'maintenance');
      expect(chain.isProviderHealthy('openai')).toBe(false);
    });
  });

  // ---------- Configuration ----------

  describe('updateConfig', () => {
    it('should update configuration', () => {
      chain.updateConfig({ maxFailures: 10 });
      expect(chain.getConfig().maxFailures).toBe(10);
    });
  });

  // ---------- Reset & Dispose ----------

  describe('reset', () => {
    it('should clear all metrics but keep chain', () => {
      chain.recordFailure('grok', 'err');
      chain.reset();

      const health = chain.getHealthStatus('grok');
      expect(health.failureCount).toBe(0);
      expect(chain.getFallbackChain()).toEqual(['grok', 'openai', 'claude']);
    });
  });

  describe('dispose', () => {
    it('should clear chain, metrics, and listeners', () => {
      chain.on('provider:failure', jest.fn());
      chain.dispose();

      expect(chain.getFallbackChain()).toEqual([]);
      expect(chain.listenerCount('provider:failure')).toBe(0);
    });
  });

  // ---------- Singleton ----------

  describe('getFallbackChain / resetFallbackChain', () => {
    it('should return same singleton', () => {
      resetFallbackChain();
      const a = getFallbackChain();
      const b = getFallbackChain();
      expect(a).toBe(b);
    });

    it('should create new instance after reset', () => {
      const before = getFallbackChain();
      resetFallbackChain();
      const after = getFallbackChain();
      expect(after).not.toBe(before);
    });
  });

  // ---------- Failure Window Cleanup ----------

  describe('failure window cleanup', () => {
    it('should expire old failures outside the window', () => {
      jest.useFakeTimers();

      chain.recordFailure('grok', 'e1');
      chain.recordFailure('grok', 'e2');

      // Advance past failure window (5000ms)
      jest.advanceTimersByTime(5100);

      // These old failures should be cleaned. Record one more - should NOT trip circuit.
      chain.recordFailure('grok', 'e3');

      const health = chain.getHealthStatus('grok');
      // Only the most recent failure should remain after cleanup
      expect(health.failureCount).toBe(1);
      expect(chain.isProviderHealthy('grok')).toBe(true);

      jest.useRealTimers();
    });
  });
});

// ============================================================================
// ModelFailoverChain (simple failover from model-failover.ts)
// ============================================================================

describe('ModelFailoverChain', () => {
  let chain: ModelFailoverChain;

  beforeEach(() => {
    chain = new ModelFailoverChain(
      [
        { provider: 'grok', model: 'grok-3', apiKey: 'KEY1' },
        { provider: 'claude', model: 'claude-3-sonnet', apiKey: 'KEY2' },
        { provider: 'chatgpt', model: 'gpt-4o', apiKey: 'KEY3' },
      ],
      { maxRetries: 3, cooldownMs: 1000 }
    );
  });

  describe('constructor', () => {
    it('should initialize all providers as healthy', () => {
      const status = chain.getStatus();
      expect(status).toHaveLength(3);
      expect(status.every(s => s.healthy)).toBe(true);
    });

    it('should handle empty chain', () => {
      const emptyChain = new ModelFailoverChain();
      expect(emptyChain.getNextProvider()).toBeNull();
    });
  });

  describe('addProvider', () => {
    it('should add a new healthy provider', () => {
      chain.addProvider({ provider: 'gemini', model: 'gemini-2.0-flash' });
      const status = chain.getStatus();
      expect(status).toHaveLength(4);
      expect(status[3].provider).toBe('gemini');
      expect(status[3].healthy).toBe(true);
    });
  });

  describe('getNextProvider', () => {
    it('should return first healthy provider', () => {
      const provider = chain.getNextProvider();
      expect(provider).not.toBeNull();
      expect(provider!.provider).toBe('grok');
      expect(provider!.model).toBe('grok-3');
    });

    it('should skip unhealthy providers', () => {
      chain.markFailed('grok', 'down');
      const provider = chain.getNextProvider();
      expect(provider!.provider).toBe('claude');
    });

    it('should return null when all are failed and within cooldown', () => {
      chain.markFailed('grok', 'e');
      chain.markFailed('claude', 'e');
      chain.markFailed('chatgpt', 'e');

      expect(chain.getNextProvider()).toBeNull();
    });

    it('should recover provider after cooldown', () => {
      jest.useFakeTimers();

      chain.markFailed('grok', 'temp');
      chain.markFailed('claude', 'temp');
      chain.markFailed('chatgpt', 'temp');

      // Advance past cooldown
      jest.advanceTimersByTime(1100);

      const provider = chain.getNextProvider();
      expect(provider).not.toBeNull();
      expect(provider!.provider).toBe('grok');
      expect(provider!.healthy).toBe(true);

      jest.useRealTimers();
    });
  });

  describe('markFailed', () => {
    it('should mark provider as unhealthy', () => {
      chain.markFailed('grok', 'timeout');

      const status = chain.getStatus();
      const grok = status.find(s => s.provider === 'grok');
      expect(grok!.healthy).toBe(false);
      expect(grok!.failures).toBe(1);
    });

    it('should increment failure count', () => {
      chain.markFailed('grok', 'e1');
      chain.markFailed('grok', 'e2');

      const status = chain.getStatus();
      const grok = status.find(s => s.provider === 'grok');
      expect(grok!.failures).toBe(2);
    });

    it('should handle marking non-existent provider (no-op)', () => {
      expect(() => chain.markFailed('nonexistent', 'err')).not.toThrow();
    });
  });

  describe('markHealthy', () => {
    it('should restore provider to healthy', () => {
      chain.markFailed('grok', 'err');
      chain.markHealthy('grok');

      const status = chain.getStatus();
      const grok = status.find(s => s.provider === 'grok');
      expect(grok!.healthy).toBe(true);
      expect(grok!.failures).toBe(0);
    });
  });

  describe('resetAll', () => {
    it('should reset all providers to healthy', () => {
      chain.markFailed('grok', 'e');
      chain.markFailed('claude', 'e');
      chain.resetAll();

      const status = chain.getStatus();
      expect(status.every(s => s.healthy && s.failures === 0)).toBe(true);
    });
  });

  describe('getStatus', () => {
    it('should return status for all providers', () => {
      const status = chain.getStatus();
      expect(status).toHaveLength(3);
      expect(status[0]).toEqual(
        expect.objectContaining({ provider: 'grok', model: 'grok-3', healthy: true, failures: 0 })
      );
    });
  });

  describe('fromEnvironment', () => {
    it('should create chain from environment variables', () => {
      const originalEnv = { ...process.env };

      process.env.GROK_API_KEY = 'test-grok';
      process.env.ANTHROPIC_API_KEY = 'test-claude';
      delete process.env.OPENAI_API_KEY;
      delete process.env.GOOGLE_API_KEY;

      const envChain = ModelFailoverChain.fromEnvironment();
      const status = envChain.getStatus();

      expect(status).toHaveLength(2);
      expect(status[0].provider).toBe('grok');
      expect(status[1].provider).toBe('claude');

      // Restore environment
      process.env = originalEnv;
    });

    it('should create empty chain when no API keys are set', () => {
      const originalEnv = { ...process.env };

      delete process.env.GROK_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.OPENAI_API_KEY;
      delete process.env.GOOGLE_API_KEY;

      const envChain = ModelFailoverChain.fromEnvironment();
      expect(envChain.getNextProvider()).toBeNull();

      process.env = originalEnv;
    });
  });

  // ---------- Failover Scenario: First fails -> Second succeeds ----------

  describe('first provider fails, second succeeds', () => {
    it('should skip failed provider and return next healthy one', () => {
      chain.markFailed('grok', 'API error');

      const provider = chain.getNextProvider();
      expect(provider!.provider).toBe('claude');

      // Mark claude as healthy (success)
      chain.markHealthy('claude');
      expect(chain.getNextProvider()!.provider).toBe('claude');
    });
  });
});
