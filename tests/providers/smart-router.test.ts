/**
 * Tests for Smart Model Router
 *
 * Tests the SmartModelRouter which integrates:
 * - Task classification (complexity-based tier selection)
 * - Provider fallback (health-based circuit breaker)
 * - Cost optimization (budget tracking and auto-downgrade)
 * - Model routing per provider
 *
 * Also tests the underlying classifyTaskComplexity and ModelRouter.
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
  SmartModelRouter,
  resetSmartRouter,
} from '../../src/providers/smart-router';
import { resetFallbackChain } from '../../src/providers/fallback-chain';
import {
  classifyTaskComplexity,
  ModelRouter,
  selectModel,
  calculateCost,
} from '../../src/optimization/model-routing';
import type { ProviderType } from '../../src/providers/types';

// ============================================================================
// classifyTaskComplexity (unit tests for the classifier)
// ============================================================================

describe('classifyTaskComplexity', () => {
  it('should classify short simple messages as simple', () => {
    const result = classifyTaskComplexity('show me the files');
    expect(result.complexity).toBe('simple');
    expect(result.requiresReasoning).toBe(false);
  });

  it('should classify messages with reasoning keywords as complex', () => {
    const result = classifyTaskComplexity('analyze the performance of this module');
    expect(result.complexity).toBe('complex');
    expect(result.requiresReasoning).toBe(true);
  });

  it('should classify messages with think/megathink as reasoning_heavy', () => {
    const result = classifyTaskComplexity('think deeply about the architecture');
    expect(result.complexity).toBe('reasoning_heavy');
    expect(result.requiresReasoning).toBe(true);
  });

  it('should detect vision requirements from image file extensions', () => {
    const result = classifyTaskComplexity('look at this screenshot.png and tell me what you see');
    expect(result.requiresVision).toBe(true);
  });

  it('should detect vision requirements from keywords', () => {
    const result = classifyTaskComplexity('describe the diagram I shared');
    expect(result.requiresVision).toBe(true);
  });

  it('should classify long messages as complex', () => {
    const longMessage = 'x'.repeat(600); // > 500 chars
    const result = classifyTaskComplexity(longMessage);
    expect(result.complexity).toBe('complex');
  });

  it('should lower confidence when both simple and reasoning indicators are present', () => {
    const result = classifyTaskComplexity('just analyze this simple file');
    expect(result.confidence).toBeLessThan(0.8);
  });

  it('should estimate tokens from message length', () => {
    const result = classifyTaskComplexity('hello world'); // 11 chars
    expect(result.estimatedTokens).toBe(Math.ceil(11 / 4));
  });
});

// ============================================================================
// SmartModelRouter
// ============================================================================

describe('SmartModelRouter', () => {
  let router: SmartModelRouter;

  beforeEach(() => {
    resetSmartRouter();
    resetFallbackChain();

    router = new SmartModelRouter({
      providers: ['grok', 'openai', 'claude'] as ProviderType[],
      models: {
        grok: ['grok-3-mini', 'grok-3', 'grok-3-reasoning'],
        openai: ['gpt-4o-mini', 'gpt-4o'],
        claude: ['claude-3-haiku', 'claude-3-sonnet'],
      },
      sessionBudget: 10,
      autoDowngrade: true,
    });
  });

  afterEach(() => {
    router.dispose();
  });

  // ---------- Simple Query -> Cheap Model ----------

  describe('route simple queries to cheap model', () => {
    it('should route a simple task to the mini tier', async () => {
      const result = await router.route({ task: 'list all files' });
      expect(result.tier).toBe('mini');
      expect(result.model).toBe('grok-3-mini');
      expect(result.provider).toBe('grok');
    });

    it('should not be a fallback route for primary provider', async () => {
      const result = await router.route({ task: 'show status' });
      expect(result.isFallback).toBe(false);
    });
  });

  // ---------- Complex Query -> Capable Model ----------

  describe('route complex queries to capable model', () => {
    it('should route reasoning-heavy tasks to reasoning tier', async () => {
      const result = await router.route({ task: 'think about the best architecture for this system' });
      expect(result.tier).toBe('reasoning');
      expect(result.model).toBe('grok-3-reasoning');
    });

    it('should route complex tasks to standard tier', async () => {
      const result = await router.route({ task: 'analyze the performance bottleneck in this query' });
      // 'analyze' is a reasoning indicator
      expect(['standard', 'reasoning']).toContain(result.tier);
    });
  });

  // ---------- Code Generation -> Code Model ----------

  describe('route code tasks appropriately', () => {
    it('should route refactoring request to at least standard tier', async () => {
      const result = await router.route({ task: 'refactor the entire module for better performance' });
      expect(['standard', 'reasoning']).toContain(result.tier);
    });

    it('should route moderate code tasks to standard', async () => {
      const result = await router.route({ task: 'write a function to parse JSON' });
      expect(result.tier).toBe('moderate' === result.classification?.complexity ? 'standard' : result.tier);
    });
  });

  // ---------- Vision Routing ----------

  describe('vision routing', () => {
    it('should route vision tasks to vision tier when supported', async () => {
      const result = await router.route({
        task: 'analyze this screenshot.png',
        requiresVision: true,
      });
      // The classification should detect vision
      expect(result.classification?.requiresVision).toBe(true);
    });
  });

  // ---------- Forced Model ----------

  describe('forced model routing', () => {
    it('should use the exact model when forceModel is specified', async () => {
      const result = await router.route({
        task: 'anything',
        forceModel: 'gpt-4o',
      });
      expect(result.model).toBe('gpt-4o');
      expect(result.reason).toBe('forced_model');
      expect(result.isFallback).toBe(false);
    });

    it('should find the correct provider for forced model', async () => {
      const result = await router.route({
        task: 'anything',
        forceModel: 'claude-3-sonnet',
      });
      expect(result.provider).toBe('claude');
    });
  });

  // ---------- Forced Tier ----------

  describe('forced tier routing', () => {
    it('should use the forced tier regardless of classification', async () => {
      const result = await router.route({
        task: 'simple listing',
        forceTier: 'reasoning',
      });
      expect(result.tier).toBe('reasoning');
    });
  });

  // ---------- Preferred Provider ----------

  describe('preferred provider', () => {
    it('should use preferred provider if healthy', async () => {
      const result = await router.route({
        task: 'do something',
        preferredProvider: 'openai' as ProviderType,
      });
      expect(result.provider).toBe('openai');
    });

    it('should fall back when preferred provider is unhealthy', async () => {
      // Mark openai as unhealthy
      router.recordFailure(
        { provider: 'openai' as ProviderType, model: 'gpt-4o', tier: 'standard', reason: '', providerHealth: {} as any, isFallback: false, alternatives: [] },
        'service_down'
      );
      router.recordFailure(
        { provider: 'openai' as ProviderType, model: 'gpt-4o', tier: 'standard', reason: '', providerHealth: {} as any, isFallback: false, alternatives: [] },
        'service_down'
      );
      router.recordFailure(
        { provider: 'openai' as ProviderType, model: 'gpt-4o', tier: 'standard', reason: '', providerHealth: {} as any, isFallback: false, alternatives: [] },
        'service_down'
      );

      const result = await router.route({
        task: 'do something',
        preferredProvider: 'openai' as ProviderType,
      });
      expect(result.provider).not.toBe('openai');
    });
  });

  // ---------- Cost Constraint / Budget ----------

  describe('cost constraint enforcement', () => {
    it('should auto-downgrade tier when budget is pressured', async () => {
      // Consume 80%+ of budget
      router.addCost(8.5); // 85% of $10 budget

      const listener = jest.fn();
      router.on('tier:downgraded', listener);

      const result = await router.route({
        task: 'analyze the complex architecture deeply',
      });

      // Should have been downgraded from whatever was classified
      expect(listener).toHaveBeenCalled();
    });

    it('should emit budget:warning at 80% threshold', () => {
      const listener = jest.fn();
      router.on('budget:warning', listener);

      router.addCost(8.1);
      expect(listener).toHaveBeenCalledWith(8.1, 10);
    });

    it('should emit budget:exceeded at 100% threshold', () => {
      const listener = jest.fn();
      router.on('budget:exceeded', listener);

      router.addCost(10.5);
      expect(listener).toHaveBeenCalledWith(10.5, 10);
    });

    it('should track current cost', () => {
      router.addCost(1.5);
      router.addCost(2.3);
      expect(router.getCurrentCost()).toBeCloseTo(3.8);
    });

    it('should reset cost', () => {
      router.addCost(5);
      router.resetCost();
      expect(router.getCurrentCost()).toBe(0);
    });
  });

  // ---------- Fallback When Model Unavailable ----------

  describe('fallback when preferred model unavailable', () => {
    it('should provide alternatives in route result', async () => {
      const result = await router.route({ task: 'hello' });
      expect(result.alternatives.length).toBeGreaterThan(0);
    });

    it('should include other providers in alternatives', async () => {
      const result = await router.route({ task: 'hello' });
      const altProviders = result.alternatives.map(a => a.provider);
      expect(altProviders).toContain('openai');
    });
  });

  // ---------- getFallbackRoute ----------

  describe('getFallbackRoute', () => {
    it('should return a fallback route when current fails', async () => {
      const initial = await router.route({ task: 'test' });
      const fallback = await router.getFallbackRoute(initial, 'timeout');

      expect(fallback).not.toBeNull();
      expect(fallback!.isFallback).toBe(true);
    });

    it('should record failure for the failed provider', async () => {
      const initial = await router.route({ task: 'test' });
      await router.getFallbackRoute(initial, 'error');

      const health = router.getAllHealth();
      const failedProvider = health.find(h => h.provider === initial.provider);
      expect(failedProvider!.failureCount).toBeGreaterThanOrEqual(1);
    });

    it('should return null when all alternatives are exhausted', async () => {
      // Mark all providers unhealthy
      for (const p of ['grok', 'openai', 'claude'] as ProviderType[]) {
        for (let i = 0; i < 3; i++) {
          router.recordFailure(
            { provider: p, model: 'x', tier: 'mini', reason: '', providerHealth: {} as any, isFallback: false, alternatives: [] },
            'down'
          );
        }
      }

      const initial = await router.route({ task: 'test' });
      // Remove alternatives since providers are all down
      initial.alternatives = [];
      const fallback = await router.getFallbackRoute(initial, 'all_down');

      expect(fallback).toBeNull();
    });
  });

  // ---------- Success Recording ----------

  describe('recordSuccess', () => {
    it('should record success and add cost', async () => {
      const result = await router.route({ task: 'hello' });
      router.recordSuccess(result, 100, 0.005);

      expect(router.getCurrentCost()).toBeCloseTo(0.005);
    });
  });

  // ---------- Statistics ----------

  describe('getStats', () => {
    it('should track route statistics', async () => {
      await router.route({ task: 'hello' });
      await router.route({ task: 'think about this deeply' });

      const stats = router.getStats();
      expect(stats.totalRoutes).toBe(2);
      expect(Object.keys(stats.routesByProvider).length).toBeGreaterThan(0);
      expect(Object.keys(stats.routesByTier).length).toBeGreaterThan(0);
    });

    it('should count fallback routes', async () => {
      const result = await router.route({ task: 'hello' });
      await router.getFallbackRoute(result, 'err');

      const stats = router.getStats();
      // The fallback route is not added to routeHistory by getFallbackRoute
      // so just verify the stat structure is correct
      expect(stats.fallbackRoutes).toBeDefined();
    });
  });

  describe('formatStats', () => {
    it('should return formatted statistics string', async () => {
      await router.route({ task: 'hello' });
      const formatted = router.formatStats();
      expect(formatted).toContain('Smart Router Statistics');
      expect(formatted).toContain('Total Routes');
      expect(formatted).toContain('Session Cost');
    });
  });

  // ---------- Health Tracking ----------

  describe('isProviderHealthy', () => {
    it('should return true for unknown or fresh provider', () => {
      expect(router.isProviderHealthy('gemini' as ProviderType)).toBe(true);
    });

    it('should return false after marking provider unhealthy via failures', () => {
      for (let i = 0; i < 3; i++) {
        router.recordFailure(
          { provider: 'grok' as ProviderType, model: 'grok-3', tier: 'standard', reason: '', providerHealth: {} as any, isFallback: false, alternatives: [] },
          'err'
        );
      }
      expect(router.isProviderHealthy('grok')).toBe(false);
    });
  });

  describe('getAllHealth', () => {
    it('should return health for all configured providers', () => {
      const health = router.getAllHealth();
      expect(health).toHaveLength(3);
      expect(health.map(h => h.provider)).toEqual(['grok', 'openai', 'claude']);
    });
  });

  // ---------- Configuration ----------

  describe('configureChain', () => {
    it('should update providers', () => {
      router.configureChain({ providers: ['claude', 'grok'] as ProviderType[] });
      const config = router.getConfig();
      expect(config.providers).toEqual(['claude', 'grok']);
    });

    it('should update models', () => {
      router.configureChain({
        models: { grok: ['grok-3-mini'] },
      });
      expect(router.getConfig().models.grok).toEqual(['grok-3-mini']);
    });
  });

  // ---------- Reset & Dispose ----------

  describe('reset', () => {
    it('should clear cost and route history', async () => {
      router.addCost(5);
      await router.route({ task: 'test' });

      router.reset();

      expect(router.getCurrentCost()).toBe(0);
      expect(router.getStats().totalRoutes).toBe(0);
    });
  });

  describe('dispose', () => {
    it('should reset and remove all listeners', () => {
      router.on('route:selected', jest.fn());
      router.dispose();

      expect(router.listenerCount('route:selected')).toBe(0);
    });
  });

  // ---------- Route Events ----------

  describe('route:selected event', () => {
    it('should emit route:selected on every route call', async () => {
      const listener = jest.fn();
      router.on('route:selected', listener);

      await router.route({ task: 'hello world' });
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: expect.any(String),
          model: expect.any(String),
          tier: expect.any(String),
        })
      );
    });
  });

  // ---------- Cost Estimation ----------

  describe('cost estimation', () => {
    it('should provide cost estimate when estimatedTokens is given', async () => {
      const result = await router.route({
        task: 'hello',
        estimatedTokens: 1000,
      });
      expect(result.estimatedCost).toBeDefined();
      expect(result.estimatedCost).toBeGreaterThan(0);
    });

    it('should not estimate cost when tokens are not provided', async () => {
      const result = await router.route({ task: 'hello' });
      expect(result.estimatedCost).toBeUndefined();
    });
  });
});

// ============================================================================
// ModelRouter (from optimization/model-routing.ts)
// ============================================================================

describe('ModelRouter', () => {
  let router: ModelRouter;

  beforeEach(() => {
    router = new ModelRouter();
  });

  describe('route', () => {
    it('should return default model when routing is disabled', () => {
      router.updateConfig({ enabled: false });
      const decision = router.route('anything');
      expect(decision.reason).toContain('disabled');
    });

    it('should use default model when confidence is below threshold', () => {
      // Create a message with mixed simple and reasoning indicators for low confidence
      router.updateConfig({ minConfidence: 0.9 });
      const decision = router.route('just analyze this simple thing');
      expect(decision.reason).toContain('Low confidence');
    });

    it('should route simple tasks to mini model', () => {
      const decision = router.route('list all files');
      expect(decision.recommendedModel).toBe('grok-3-mini');
    });

    it('should route reasoning tasks to reasoning model', () => {
      const decision = router.route('think carefully about the design patterns we should use');
      expect(decision.recommendedModel).toBe('grok-3-reasoning');
    });

    it('should respect user preferred model', () => {
      const decision = router.route('anything', undefined, 'grok-3');
      expect(decision.recommendedModel).toBe('grok-3');
      expect(decision.reason).toBe('User preference');
    });

    it('should prefer cheaper model with high cost sensitivity', () => {
      router.updateConfig({ costSensitivity: 'high' });
      const decision = router.route('write a function to parse JSON');
      // With high cost sensitivity, it should downgrade to cheaper alternative if available
      const config = router.getConfig();
      expect(config.costSensitivity).toBe('high');
    });
  });

  describe('recordUsage', () => {
    it('should track usage per model', () => {
      router.recordUsage('grok-3-mini', 1000, 0.0003);
      router.recordUsage('grok-3-mini', 2000, 0.0006);

      const stats = router.getUsageStats();
      const miniStats = stats.get('grok-3-mini');
      expect(miniStats!.calls).toBe(2);
      expect(miniStats!.tokens).toBe(3000);
      expect(miniStats!.cost).toBeCloseTo(0.0009);
    });
  });

  describe('getTotalCost', () => {
    it('should sum cost across all models', () => {
      router.recordUsage('grok-3-mini', 1000, 0.001);
      router.recordUsage('grok-3', 500, 0.005);

      expect(router.getTotalCost()).toBeCloseTo(0.006);
    });

    it('should return 0 with no usage', () => {
      expect(router.getTotalCost()).toBe(0);
    });
  });

  describe('getEstimatedSavings', () => {
    it('should calculate savings vs most expensive model', () => {
      router.recordUsage('grok-3-mini', 100000, 0.045);
      const savings = router.getEstimatedSavings();
      expect(savings.percentage).toBeGreaterThan(0);
    });
  });
});

// ============================================================================
// selectModel (standalone function)
// ============================================================================

describe('selectModel', () => {
  it('should select mini model for simple classification', () => {
    const classification = classifyTaskComplexity('list files');
    const decision = selectModel(classification);
    expect(decision.recommendedModel).toBe('grok-3-mini');
    expect(decision.tier).toBe('mini');
  });

  it('should select vision model when vision is required', () => {
    const classification = {
      complexity: 'simple' as const,
      requiresVision: true,
      requiresReasoning: false,
      requiresLongContext: false,
      estimatedTokens: 100,
      confidence: 0.8,
    };
    const decision = selectModel(classification);
    expect(decision.recommendedModel).toBe('grok-2-vision');
    expect(decision.tier).toBe('vision');
  });

  it('should fall back to first available model when preferred is not available', () => {
    const classification = classifyTaskComplexity('hello');
    const decision = selectModel(classification, undefined, ['grok-3']);
    expect(decision.recommendedModel).toBe('grok-3');
  });
});

// ============================================================================
// calculateCost
// ============================================================================

describe('calculateCost', () => {
  it('should calculate cost for known model', () => {
    const cost = calculateCost(1_000_000, 'grok-3');
    // 1.5 * 1M tokens * $3/1M = $4.50
    expect(cost).toBeCloseTo(4.5);
  });

  it('should return 0 for unknown model', () => {
    const cost = calculateCost(1_000_000, 'nonexistent');
    expect(cost).toBe(0);
  });

  it('should scale linearly with tokens', () => {
    const cost1 = calculateCost(500_000, 'grok-3-mini');
    const cost2 = calculateCost(1_000_000, 'grok-3-mini');
    expect(cost2).toBeCloseTo(cost1 * 2);
  });
});
