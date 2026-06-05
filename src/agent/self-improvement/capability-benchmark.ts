/**
 * Deterministic capability benchmark for the self-improvement engine.
 *
 * The benchmark measures a single, REPRODUCIBLE behavioural primitive: for a
 * given situation (`query`), does the agent's learnable state surface relevant
 * guidance? It is a pure function of (scenarios, lessons) — no LLM, no network,
 * no clock — so a before/after score delta reflects the CHANGE, not run-to-run
 * noise. This is what makes the empirical gate trustworthy on a small fixture
 * set (unlike live-agent benchmarks, which need hundreds of tasks to denoise).
 *
 * @module agent/self-improvement/capability-benchmark
 */

import type { BenchmarkScenario, BenchmarkScore, BenchmarkScenarioResult } from './types.js';

/**
 * Minimal port over the lessons store. The real `LessonsTracker.search` (pure,
 * offline substring match over in-memory lessons) satisfies this, and tests can
 * supply a fake.
 */
export interface LessonSearchPort {
  search(query: string, category?: string): Array<{ id: string; content: string; context?: string }>;
}

function scenarioCovered(
  scenario: BenchmarkScenario,
  port: LessonSearchPort,
): BenchmarkScenarioResult {
  const expect = scenario.expectIncludes.map((s) => s.toLowerCase()).filter(Boolean);
  const matchedLessonIds: string[] = [];
  // Retrieval (search by the situation query) ∧ relevance (lesson carries the
  // expected guidance). A scenario is covered when at least one retrieved
  // lesson contains an expected substring.
  for (const lesson of port.search(scenario.query)) {
    const hay = `${lesson.content} ${lesson.context ?? ''}`.toLowerCase();
    if (expect.length === 0 || expect.some((term) => hay.includes(term))) {
      matchedLessonIds.push(lesson.id);
    }
  }
  return {
    scenarioId: scenario.id,
    covered: matchedLessonIds.length > 0,
    matchedLessonIds,
  };
}

/** Score the full scenario set against the current lessons state. Deterministic. */
export function scoreBenchmark(
  scenarios: BenchmarkScenario[],
  port: LessonSearchPort,
): BenchmarkScore {
  const results = scenarios.map((scenario) => scenarioCovered(scenario, port));
  const covered = results.filter((r) => r.covered).length;
  const total = scenarios.length;
  return {
    total,
    covered,
    ratio: total === 0 ? 1 : covered / total,
    results,
  };
}

/** Scenario ids that went from covered → uncovered between two scores. */
export function findRegressions(before: BenchmarkScore, after: BenchmarkScore): string[] {
  const afterCovered = new Map(after.results.map((r) => [r.scenarioId, r.covered]));
  return before.results
    .filter((r) => r.covered && afterCovered.get(r.scenarioId) === false)
    .map((r) => r.scenarioId);
}

/** Scenario the curriculum should work on next: first uncovered, else null. */
export function selectNextScenario(
  scenarios: BenchmarkScenario[],
  score: BenchmarkScore,
): BenchmarkScenario | null {
  const uncovered = new Set(score.results.filter((r) => !r.covered).map((r) => r.scenarioId));
  return scenarios.find((s) => uncovered.has(s.id)) ?? null;
}

/**
 * Seed scenarios — CURATED, and structurally separate from the proposer (the
 * engine must never author the evals that bless its own changes). Each encodes
 * a recurring friction the agent should have retrievable guidance for. This set
 * is meant to grow via a human-reviewed process, never auto-written by the loop.
 */
export const SEED_BENCHMARK_SCENARIOS: BenchmarkScenario[] = [
  {
    id: 'npm-test-path-filter',
    query: 'npm test',
    expectIncludes: ['path filter', 'path/to', '--'],
    description: 'Running the full test suite is slow; guidance should prefer a path filter.',
  },
  {
    id: 'esm-js-extension-imports',
    query: 'import',
    expectIncludes: ['.js extension', 'esm', 'extension'],
    description: 'ESM project needs .js extensions on relative imports even from .ts sources.',
  },
  {
    id: 'logger-not-console',
    query: 'console.log',
    expectIncludes: ['logger', 'not console'],
    description: 'Production code should use logger, not console.*, because tests spy on logger.',
  },
];
