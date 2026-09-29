/**
 * Tests for src/utils/token-display.ts
 *
 * Token usage formatting for per-message display.
 */

import { describe, it, expect } from 'vitest';
import { formatTokenUsage, estimateCost } from '../../src/utils/token-display';

describe('formatTokenUsage', () => {
  it('formats basic token usage with cost', () => {
    const result = formatTokenUsage({ inputTokens: 1234, outputTokens: 567, cost: 0.003 });
    expect(result).toBe('[tokens: 1,234 in / 567 out | cost: $0.0030]');
  });

  it('formats zero tokens', () => {
    const result = formatTokenUsage({ inputTokens: 0, outputTokens: 0, cost: 0 });
    expect(result).toBe('[tokens: 0 in / 0 out | cost: $0.0000]');
  });

  it('formats large token counts with commas', () => {
    const result = formatTokenUsage({ inputTokens: 128000, outputTokens: 4096, cost: 0.45 });
    expect(result).toBe('[tokens: 128,000 in / 4,096 out | cost: $0.45]');
  });

  it('formats small cost with 4 decimal places', () => {
    const result = formatTokenUsage({ inputTokens: 100, outputTokens: 50, cost: 0.0001 });
    expect(result).toContain('$0.0001');
  });

  it('formats larger cost with 2 decimal places', () => {
    const result = formatTokenUsage({ inputTokens: 50000, outputTokens: 10000, cost: 1.25 });
    expect(result).toContain('$1.25');
  });

  it('handles negative or NaN values gracefully', () => {
    const result = formatTokenUsage({ inputTokens: -1, outputTokens: NaN, cost: -0.5 });
    expect(result).toContain('0 in');
    expect(result).toContain('0 out');
    expect(result).toContain('$0.0000');
  });
});

describe('estimateCost', () => {
  it('estimates cost with default pricing', () => {
    const cost = estimateCost(1000, 500);
    // 1000/1000 * 0.003 + 500/1000 * 0.015 = 0.003 + 0.0075 = 0.0105
    expect(cost).toBeCloseTo(0.0105, 4);
  });

  it('estimates zero cost for zero tokens', () => {
    const cost = estimateCost(0, 0);
    expect(cost).toBe(0);
  });

  it('uses the shared model price when a model is supplied', () => {
    expect(estimateCost(1_000_000, 1_000_000, undefined, undefined, 'grok-code-fast-1')).toBeCloseTo(1.7);
  });

  it('accepts custom pricing', () => {
    const cost = estimateCost(1000, 1000, 0.001, 0.002);
    // 1 * 0.001 + 1 * 0.002 = 0.003
    expect(cost).toBeCloseTo(0.003, 4);
  });

  it('scales linearly with token count', () => {
    const cost1 = estimateCost(1000, 500);
    const cost2 = estimateCost(2000, 1000);
    expect(cost2).toBeCloseTo(cost1 * 2, 4);
  });
});
