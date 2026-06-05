/**
 * Improvement proposers — turn a curriculum target (+ experiences) into a
 * candidate improvement. The interface is the injection seam: the production
 * path is an LLM-backed proposer that drafts a lesson from real run friction,
 * but V1 ships a DETERMINISTIC static proposer so the engine and its empirical
 * gate stay fully reproducible and testable. Crucially, proposers are kept
 * structurally separate from the benchmark scenarios (the evals) — the engine
 * must never author the checks that bless its own changes.
 *
 * @module agent/self-improvement/proposer
 */

import type { BenchmarkScenario, Experience, ImprovementProposal } from './types.js';

export interface ImprovementProposer {
  propose(scenario: BenchmarkScenario, experiences: Experience[]): ImprovementProposal | null;
}

export interface LessonDraft {
  category: 'PATTERN' | 'RULE' | 'CONTEXT' | 'INSIGHT';
  content: string;
  context?: string;
}

/** Deterministic proposer backed by a fixed scenarioId → draft map. */
export class StaticProposer implements ImprovementProposer {
  constructor(private readonly drafts: Map<string, LessonDraft>) {}

  propose(scenario: BenchmarkScenario, experiences: Experience[]): ImprovementProposal | null {
    const draft = this.drafts.get(scenario.id);
    if (!draft) return null;
    return {
      id: `prop-${scenario.id}`,
      kind: 'lesson',
      targetScenarioId: scenario.id,
      experienceId: experiences[0]?.id,
      lesson: { category: draft.category, content: draft.content, context: draft.context },
    };
  }
}

/**
 * A curated knowledge pack the static proposer can use to BOOTSTRAP the agent's
 * lesson library — each draft is then empirically validated by the gate before
 * it is kept. This is deliberately SEPARATE from SEED_BENCHMARK_SCENARIOS so the
 * proposer never co-authors its own evals.
 */
export const SEED_LESSON_DRAFTS = new Map<string, LessonDraft>([
  [
    'npm-test-path-filter',
    {
      category: 'RULE',
      content:
        'When running npm test, always pass a path filter (e.g. `npm test -- path/to/file.test.ts`); the full suite is slow.',
    },
  ],
  [
    'esm-js-extension-imports',
    {
      category: 'RULE',
      content:
        'This is an ESM project: relative import statements need a .js extension even when importing a .ts source file.',
    },
  ],
  [
    'logger-not-console',
    {
      category: 'RULE',
      content:
        'Use the logger (src/utils/logger) in production code, not console.log — tests spy on logger and console output is not captured.',
    },
  ],
]);
