/**
 * Context Window Guard Tests
 */

import {
  ContextWindowGuard,
  getContextWindowGuard,
  resetContextWindowGuard,
  resolveContextWindowInfo,
  evaluateContextWindowGuard,
  normalizePositiveInt,
  CONTEXT_WINDOW_HARD_MIN_TOKENS,
  CONTEXT_WINDOW_WARN_BELOW_TOKENS,
  DEFAULT_CONTEXT_WINDOW_TOKENS,
} from '../../src/context/guard/index.js';

describe('Context Window Guard', () => {
  describe('normalizePositiveInt', () => {
    it('should accept positive numbers', () => {
      expect(normalizePositiveInt(100)).toBe(100);
      expect(normalizePositiveInt(1.5)).toBe(1);
      expect(normalizePositiveInt(128000)).toBe(128000);
    });

    it('should reject zero and negative numbers', () => {
      expect(normalizePositiveInt(0)).toBeNull();
      expect(normalizePositiveInt(-100)).toBeNull();
    });

    it('should parse valid strings', () => {
      expect(normalizePositiveInt('100')).toBe(100);
      expect(normalizePositiveInt('128000')).toBe(128000);
    });

    it('should reject invalid strings', () => {
      expect(normalizePositiveInt('abc')).toBeNull();
      expect(normalizePositiveInt('')).toBeNull();
      expect(normalizePositiveInt('-100')).toBeNull();
    });

    it('should reject non-finite values', () => {
      expect(normalizePositiveInt(Infinity)).toBeNull();
      expect(normalizePositiveInt(NaN)).toBeNull();
    });
  });

  describe('resolveContextWindowInfo', () => {
    it('should use session tokens first', () => {
      const info = resolveContextWindowInfo({
        sessionTokens: 50000,
        agentTokens: 100000,
        modelTokens: 128000,
      });

      expect(info.tokens).toBe(50000);
      expect(info.source).toBe('sessionConfig');
    });

    it('should fall back to agent tokens', () => {
      const info = resolveContextWindowInfo({
        agentTokens: 100000,
        modelTokens: 128000,
      });

      expect(info.tokens).toBe(100000);
      expect(info.source).toBe('agentConfig');
    });

    it('should fall back to config tokens', () => {
      const info = resolveContextWindowInfo({
        configTokens: 64000,
        modelTokens: 128000,
      });

      expect(info.tokens).toBe(64000);
      expect(info.source).toBe('modelsConfig');
    });

    it('should fall back to model tokens', () => {
      const info = resolveContextWindowInfo({
        modelTokens: 128000,
      });

      expect(info.tokens).toBe(128000);
      expect(info.source).toBe('model');
    });

    it('should use default when no sources provided', () => {
      const info = resolveContextWindowInfo({});

      expect(info.tokens).toBe(DEFAULT_CONTEXT_WINDOW_TOKENS);
      expect(info.source).toBe('default');
    });

    it('should include model ID', () => {
      const info = resolveContextWindowInfo({
        modelTokens: 128000,
        modelId: 'grok-2',
      });

      expect(info.modelId).toBe('grok-2');
    });
  });

  describe('evaluateContextWindowGuard', () => {
    const info = { tokens: 100000, source: 'model' as const };

    it('should not warn or block when usage is low', () => {
      const result = evaluateContextWindowGuard(info, 10000);

      expect(result.shouldWarn).toBe(false);
      expect(result.shouldBlock).toBe(false);
      expect(result.remaining).toBe(90000);
      expect(result.usagePercent).toBe(10);
    });

    it('should warn when below warning threshold', () => {
      const usage = info.tokens - CONTEXT_WINDOW_WARN_BELOW_TOKENS + 1000;
      const result = evaluateContextWindowGuard(info, usage);

      expect(result.shouldWarn).toBe(true);
      expect(result.shouldBlock).toBe(false);
      expect(result.warningMessage).toBeDefined();
    });

    it('should block when below hard minimum', () => {
      const usage = info.tokens - CONTEXT_WINDOW_HARD_MIN_TOKENS + 1000;
      const result = evaluateContextWindowGuard(info, usage);

      expect(result.shouldWarn).toBe(false);
      expect(result.shouldBlock).toBe(true);
      expect(result.blockMessage).toBeDefined();
    });

    it('should respect enableWarnings config', () => {
      const usage = info.tokens - CONTEXT_WINDOW_WARN_BELOW_TOKENS + 1000;
      const result = evaluateContextWindowGuard(info, usage, { enableWarnings: false });

      expect(result.shouldWarn).toBe(false);
    });

    it('should respect enableBlocking config', () => {
      const usage = info.tokens - CONTEXT_WINDOW_HARD_MIN_TOKENS + 1000;
      const result = evaluateContextWindowGuard(info, usage, { enableBlocking: false });

      expect(result.shouldBlock).toBe(false);
    });

    it('should calculate usage percent correctly', () => {
      const result = evaluateContextWindowGuard(info, 50000);

      expect(result.usagePercent).toBe(50);
    });
  });

  describe('ContextWindowGuard class', () => {
    let guard: ContextWindowGuard;

    beforeEach(() => {
      guard = new ContextWindowGuard();
    });

    it('should set context window', () => {
      guard.setContextWindow({ tokens: 64000, source: 'model' });

      expect(guard.getContextInfo()?.tokens).toBe(64000);
    });

    it('should resolve context window', () => {
      const info = guard.resolveContextWindow({
        modelTokens: 128000,
        modelId: 'test-model',
      });

      expect(info.tokens).toBe(128000);
      expect(guard.getContextInfo()).toEqual(info);
    });

    it('should check usage', () => {
      guard.setContextWindow({ tokens: 100000, source: 'model' });

      const result = guard.check(50000);

      expect(result.currentUsage).toBe(50000);
      expect(result.remaining).toBe(50000);
    });

    it('should emit warning event', () => {
      guard.setContextWindow({ tokens: 100000, source: 'model' });

      const warnings: unknown[] = [];
      guard.on('warning', (result) => warnings.push(result));

      // Trigger warning
      guard.check(100000 - CONTEXT_WINDOW_WARN_BELOW_TOKENS + 1000);

      expect(warnings.length).toBe(1);
    });

    it('should emit blocked event', () => {
      guard.setContextWindow({ tokens: 100000, source: 'model' });

      const blocked: unknown[] = [];
      guard.on('blocked', (result) => blocked.push(result));

      // Trigger block
      guard.check(100000 - CONTEXT_WINDOW_HARD_MIN_TOKENS + 1000);

      expect(blocked.length).toBe(1);
    });

    it('should emit threshold-crossed event', () => {
      guard.setContextWindow({ tokens: 100000, source: 'model' });

      const crossed: unknown[] = [];
      guard.on('threshold-crossed', (result) => crossed.push(result));

      // First check above threshold
      guard.check(50000);

      // Second check below threshold
      guard.check(100000 - CONTEXT_WINDOW_WARN_BELOW_TOKENS + 1000);

      expect(crossed.length).toBe(1);
    });

    it('should only emit warning once', () => {
      guard.setContextWindow({ tokens: 100000, source: 'model' });

      const warnings: unknown[] = [];
      guard.on('warning', (result) => warnings.push(result));

      const usage = 100000 - CONTEXT_WINDOW_WARN_BELOW_TOKENS + 1000;
      guard.check(usage);
      guard.check(usage);
      guard.check(usage);

      expect(warnings.length).toBe(1);
    });

    it('should reset warning state', () => {
      guard.setContextWindow({ tokens: 100000, source: 'model' });

      const warnings: unknown[] = [];
      guard.on('warning', (result) => warnings.push(result));

      const usage = 100000 - CONTEXT_WINDOW_WARN_BELOW_TOKENS + 1000;
      guard.check(usage);
      guard.resetWarning();
      guard.check(usage);

      expect(warnings.length).toBe(2);
    });

    it('should get last result', () => {
      guard.setContextWindow({ tokens: 100000, source: 'model' });

      guard.check(50000);

      const last = guard.getLastResult();
      expect(last?.currentUsage).toBe(50000);
    });

    it('should update configuration', () => {
      guard.updateConfig({ enableBlocking: false });

      expect(guard.getConfig().enableBlocking).toBe(false);
    });

    it('should calculate safe token budget', () => {
      guard.setContextWindow({ tokens: 128000, source: 'model' });

      const budget = guard.getSafeTokenBudget();

      // 128000 / 1.2 = 106666
      expect(budget).toBeLessThan(128000);
      expect(budget).toBeGreaterThan(100000);
    });

    it('should determine when compaction is needed', () => {
      guard.setContextWindow({ tokens: 100000, source: 'model' });

      expect(guard.shouldCompact(50000)).toBe(false);
      expect(guard.shouldCompact(70000)).toBe(true);
      expect(guard.shouldCompact(80000, 0.8)).toBe(true);
      expect(guard.shouldCompact(70000, 0.8)).toBe(false);
    });
  });

  describe('Singleton', () => {
    beforeEach(() => {
      resetContextWindowGuard();
    });

    afterEach(() => {
      resetContextWindowGuard();
    });

    it('should return same instance', () => {
      const guard1 = getContextWindowGuard();
      const guard2 = getContextWindowGuard();

      expect(guard1).toBe(guard2);
    });

    it('should reset instance', () => {
      const guard1 = getContextWindowGuard();
      resetContextWindowGuard();
      const guard2 = getContextWindowGuard();

      expect(guard1).not.toBe(guard2);
    });

    it('should accept config on first call', () => {
      const guard = getContextWindowGuard({ enableBlocking: false });

      expect(guard.getConfig().enableBlocking).toBe(false);
    });
  });

  describe('Constants', () => {
    it('should have valid thresholds', () => {
      expect(CONTEXT_WINDOW_HARD_MIN_TOKENS).toBe(16000);
      expect(CONTEXT_WINDOW_WARN_BELOW_TOKENS).toBe(32000);
      expect(DEFAULT_CONTEXT_WINDOW_TOKENS).toBe(128000);
    });

    it('should have warn threshold greater than hard min', () => {
      expect(CONTEXT_WINDOW_WARN_BELOW_TOKENS).toBeGreaterThan(CONTEXT_WINDOW_HARD_MIN_TOKENS);
    });
  });
});
