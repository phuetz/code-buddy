import { describe, expect, it } from 'vitest';

import {
  scoreBenchmark,
  findRegressions,
  selectNextScenario,
} from '../../../src/agent/self-improvement/capability-benchmark.js';
import { validateProposal, type LessonMutatorPort } from '../../../src/agent/self-improvement/empirical-gate.js';
import type { BenchmarkScenario, ImprovementProposal } from '../../../src/agent/self-improvement/types.js';

/** In-memory lessons store implementing the mutator port (deterministic). */
function fakePort(): LessonMutatorPort & { items: Array<{ id: string; content: string; context?: string }> } {
  const items: Array<{ id: string; content: string; context?: string }> = [];
  let n = 0;
  return {
    items,
    search(query: string) {
      const q = query.toLowerCase();
      return items.filter(
        (i) => i.content.toLowerCase().includes(q) || (i.context?.toLowerCase().includes(q) ?? false),
      );
    },
    add(_category, content, context) {
      const item = { id: `L${++n}`, content, context };
      items.push(item);
      return { id: item.id };
    },
    remove(id) {
      const before = items.length;
      const idx = items.findIndex((i) => i.id === id);
      if (idx >= 0) items.splice(idx, 1);
      return items.length < before;
    },
  };
}

const SCENARIOS: BenchmarkScenario[] = [
  { id: 's-npm', query: 'npm test', expectIncludes: ['path filter'], description: 'prefer a path filter' },
  { id: 's-esm', query: 'import', expectIncludes: ['.js extension'], description: 'esm needs .js extensions' },
];

function lessonProposal(over: Partial<ImprovementProposal['lesson']> & { targetScenarioId?: string } = {}): ImprovementProposal {
  return {
    id: 'p1',
    kind: 'lesson',
    targetScenarioId: over.targetScenarioId ?? 's-npm',
    lesson: {
      category: 'RULE',
      content: over.content ?? 'When running npm test, always pass a path filter to keep it fast.',
      context: over.context,
    },
  };
}

describe('self-improvement: capability benchmark (deterministic)', () => {
  it('scores zero coverage with no lessons and is reproducible', () => {
    const port = fakePort();
    const a = scoreBenchmark(SCENARIOS, port);
    const b = scoreBenchmark(SCENARIOS, port);
    expect(a).toEqual(b); // pure / reproducible
    expect(a.covered).toBe(0);
    expect(a.ratio).toBe(0);
  });

  it('picks the first uncovered scenario as the curriculum target', () => {
    const port = fakePort();
    const score = scoreBenchmark(SCENARIOS, port);
    expect(selectNextScenario(SCENARIOS, score)?.id).toBe('s-npm');
  });

  it('counts a scenario covered only when a retrieved lesson carries the expected guidance', () => {
    const port = fakePort();
    // Retrievable for "npm test" but missing the expected guidance → NOT covered.
    port.add('RULE', 'npm test runs the suite.', undefined);
    expect(scoreBenchmark(SCENARIOS, port).covered).toBe(0);
    // Now add the guidance.
    port.add('RULE', 'For npm test, pass a path filter to keep it fast.', undefined);
    expect(scoreBenchmark(SCENARIOS, port).covered).toBe(1);
  });
});

describe('self-improvement: empirical gate (DGM-style, snapshot/rollback)', () => {
  it('accepts and keeps a validated lesson under auto-apply; the number moves', () => {
    const port = fakePort();
    const before = scoreBenchmark(SCENARIOS, port).covered;
    const result = validateProposal(lessonProposal(), SCENARIOS, port, { keepOnAccept: true });
    expect(result.outcome.accepted).toBe(true);
    expect(result.outcome.delta).toBe(1);
    expect(result.outcome.rolledBack).toBe(false);
    expect(result.appliedRef).toBeTruthy();
    // Real, persisted improvement.
    expect(scoreBenchmark(SCENARIOS, port).covered).toBe(before + 1);
    expect(port.items).toHaveLength(1);
  });

  it('accepts but ROLLS BACK under propose-only; state is restored exactly', () => {
    const port = fakePort();
    const result = validateProposal(lessonProposal(), SCENARIOS, port, { keepOnAccept: false });
    expect(result.outcome.accepted).toBe(true);
    expect(result.outcome.delta).toBe(1);
    expect(result.outcome.rolledBack).toBe(true);
    expect(result.appliedRef).toBeUndefined();
    expect(port.items).toHaveLength(0); // nothing persisted
    expect(scoreBenchmark(SCENARIOS, port).covered).toBe(0);
  });

  it('rejects a useless proposal (no improvement) and rolls back', () => {
    const port = fakePort();
    const useless = lessonProposal({ content: 'Some unrelated note about coffee preferences here.' });
    const result = validateProposal(useless, SCENARIOS, port, { keepOnAccept: true });
    expect(result.outcome.accepted).toBe(false);
    expect(result.outcome.rejectionReason).toBe('no-improvement');
    expect(result.outcome.rolledBack).toBe(true);
    expect(port.items).toHaveLength(0);
  });

  it('rejects structurally-invalid proposals without applying them', () => {
    const port = fakePort();
    for (const bad of [
      lessonProposal({ content: 'too short' }),
      lessonProposal({ content: 'Use this api_key: sk-abcdef to keep npm test path filter fast and good' }),
      lessonProposal({ content: 'For npm test pass a path filter ... rest of the rules apply here too' }),
    ]) {
      const result = validateProposal(bad, SCENARIOS, port, { keepOnAccept: true });
      expect(result.outcome.accepted).toBe(false);
      expect(result.outcome.rejectionReason).toBe('structural-invalid');
      expect(result.outcome.rolledBack).toBe(false);
    }
    expect(port.items).toHaveLength(0);
  });

  it('rejects + rolls back a proposal that regresses an already-covered scenario', () => {
    const port = fakePort();
    // Pre-cover s-esm.
    port.add('RULE', 'For import, use the .js extension on relative paths.', undefined);
    const baseline = scoreBenchmark(SCENARIOS, port);
    expect(baseline.covered).toBe(1);
    // A pathological port where adding anything hides existing lessons → forces a regression.
    const regressingPort: LessonMutatorPort = {
      search: (q) => (port.items.length > 1 ? [] : port.search(q)),
      add: (c, content, ctx) => port.add(c, content, ctx),
      remove: (id) => port.remove(id),
    };
    const result = validateProposal(lessonProposal(), SCENARIOS, regressingPort, { keepOnAccept: true });
    expect(result.outcome.accepted).toBe(false);
    expect(result.outcome.rejectionReason).toBe('regression');
    expect(result.outcome.rolledBack).toBe(true);
    expect(findRegressions(baseline, scoreBenchmark(SCENARIOS, port))).toEqual([]); // restored
  });
});
