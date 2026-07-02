/**
 * P3 — gatesForComplexity must be EXHAUSTIVE. Its result is merged over
 * ALL_BLOCKS (all-true), so any omitted key silently defaults to true and leaks
 * that block into a cheap tier. Previously `trivial` omitted
 * includeUserModelDirective and `simple` omitted it plus
 * includeExecutionDiscipline — defeating the classifier's token savings.
 */
import { describe, it, expect } from 'vitest';
import { gatesForComplexity } from '../../src/services/prompt-builder.js';

describe('gatesForComplexity exhaustiveness (P3)', () => {
  it('trivial disables the user-model directive (and heavy blocks)', () => {
    const g = gatesForComplexity('trivial');
    expect(g.includeUserModelDirective).toBe(false);
    expect(g.includeExecutionDiscipline).toBe(false);
    expect(g.includeBootstrap).toBe(false);
    expect(g.includeWritingRules).toBe(true); // the one thing trivial keeps
  });

  it('simple disables execution-discipline and user-model (cheap tier)', () => {
    const g = gatesForComplexity('simple');
    expect(g.includeExecutionDiscipline).toBe(false);
    expect(g.includeUserModelDirective).toBe(false);
    expect(g.includeWorkflowRules).toBe(false);
    expect(g.includeIdentity).toBe(true); // simple still gets identity/memory
    expect(g.includeMemoryDirective).toBe(true);
  });

  it('complex enables everything', () => {
    const g = gatesForComplexity('complex');
    expect(Object.values(g).every((v) => v === true)).toBe(true);
  });

  it('every tier returns an exhaustive object (no undefined keys)', () => {
    const complexKeys = Object.keys(gatesForComplexity('complex'));
    for (const tier of ['trivial', 'simple'] as const) {
      const g = gatesForComplexity(tier) as Record<string, unknown>;
      for (const key of complexKeys) {
        expect(typeof g[key], `${tier}.${key}`).toBe('boolean');
      }
    }
  });
});
