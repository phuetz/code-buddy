import { describe, it, expect } from 'vitest';
import {
  buildPlanningPrompt,
  parseVariantPlan,
  renderVariantPlan,
  planVariant,
  makeLlmVariantPlanner,
} from '../../../../src/agent/self-improvement/evolution/variant-planner.js';
import type { Weakness, Inspiration } from '../../../../src/agent/self-improvement/evolution/evolution-engine.js';

const weakness: Weakness = { id: 'w1', goal: 'reduce coupling in recall', kind: 'hotspot' };
const inspirations: Inspiration[] = [
  { id: 'evo-a', goal: 'index recall', score: 0.91, diff: 'diff --git a/x b/x' },
];

const goodJson = JSON.stringify({
  approach: 'build-on',
  basedOn: 'evo-a',
  summary: 'Extend the recall index',
  steps: [
    { title: 'Add cache', description: 'memoize hot lookups', rationale: 'cuts O(N) scans' },
    { title: 'Test', description: 'add a bench guard' },
  ],
});

describe('buildPlanningPrompt', () => {
  it('includes the goal and the inspiration id + score', () => {
    const p = buildPlanningPrompt(weakness, inspirations);
    expect(p).toContain('reduce coupling in recall');
    expect(p).toContain('evo-a');
    expect(p).toContain('0.910');
    expect(p).toMatch(/JSON/i);
  });
});

describe('parseVariantPlan', () => {
  it('parses a rich JSON plan', () => {
    const plan = parseVariantPlan(goodJson);
    expect(plan.approach).toBe('build-on');
    expect(plan.basedOn).toBe('evo-a');
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[0]!.rationale).toContain('O(N)');
  });

  it('tolerates markdown fences', () => {
    const plan = parseVariantPlan('```json\n' + goodJson + '\n```');
    expect(plan.steps).toHaveLength(2);
    expect(plan.approach).toBe('build-on');
  });

  it('falls back to a single-step plan on broken JSON', () => {
    const plan = parseVariantPlan('not json at all, just prose about a fix');
    expect(plan.approach).toBe('fresh');
    expect(plan.steps).toHaveLength(1);
    expect(plan.summary.length).toBeGreaterThan(0);
  });

  it('normalizes an invalid approach to fresh and drops malformed steps', () => {
    const plan = parseVariantPlan(JSON.stringify({ approach: 'nonsense', summary: 's', steps: [{ title: 'ok', description: 'd' }, { title: 42 }] }));
    expect(plan.approach).toBe('fresh');
    expect(plan.steps).toHaveLength(1);
  });
});

describe('renderVariantPlan', () => {
  it('renders approach + numbered titled steps + rationale', () => {
    const out = renderVariantPlan(parseVariantPlan(goodJson));
    expect(out).toContain('Approche : build-on');
    expect(out).toContain('1. Add cache — memoize hot lookups');
    expect(out).toContain('pourquoi : cuts O(N) scans');
  });
});

describe('planVariant / makeLlmVariantPlanner (injected chat)', () => {
  it('plans via an injected chat returning JSON', async () => {
    const plan = await planVariant({ weakness, inspirations }, async () => goodJson);
    expect(plan?.approach).toBe('build-on');
  });

  it('returns null when the chat yields nothing (→ engine falls back to ad-hoc)', async () => {
    expect(await planVariant({ weakness, inspirations }, async () => null)).toBeNull();
    expect(await planVariant({ weakness, inspirations }, async () => '')).toBeNull();
  });

  it('never throws — a chat that throws → null', async () => {
    const planner = makeLlmVariantPlanner({ chat: async () => { throw new Error('provider down'); } });
    await expect(planner({ weakness, inspirations })).resolves.toBeNull();
  });
});
