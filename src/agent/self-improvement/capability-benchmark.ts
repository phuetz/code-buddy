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
    expectIncludes: ['path filter', 'path/to'],
    description: 'Running the full test suite is slow; guidance should prefer a path filter.',
    source: 'CLAUDE.md:27',
  },
  {
    id: 'esm-js-extension-imports',
    query: 'import',
    expectIncludes: ['.js extension', 'esm'],
    description: 'ESM project needs .js extensions on relative imports even from .ts sources.',
    source: 'CLAUDE.md:40',
  },
  {
    id: 'logger-not-console',
    query: 'console.log',
    expectIncludes: ['logger', 'not console'],
    description: 'Production code should use logger, not console.*, because tests spy on logger.',
    source: 'CLAUDE.md:41',
  },
  {
    id: 'atomic-write-state',
    query: 'atomic-write',
    expectIncludes: ['o_append', 'state write'],
    description: 'State JSON and markdown files must use atomic-write.ts to prevent corrupt reads.',
    source: 'CLAUDE.md:39',
  },
  {
    id: 'git-add-named-files',
    query: 'git add',
    expectIncludes: ['nommément', 'jamais -a'],
    description: 'Always stage files by specific name, never using git add -A or git commit -a.',
    source: 'CLAUDE.md:11',
  },
  {
    id: 'subproc-bounded-timeout',
    query: 'wait_agent',
    expectIncludes: ['with timeout', 'completion'],
    description: 'Sub-agent processes and orchestrations must be bounded with an explicit timeout.',
    source: 'docs/agents.md:11',
  },
  {
    id: 'no-secrets-in-repo',
    query: 'jwt_secret',
    expectIncludes: ['secret in clair', 'secretref'],
    description: 'Never store plaintext secrets or tokens in tracked repository files.',
    source: 'CLAUDE.md:12',
  },
  {
    id: 'isolated-home-tests',
    query: '_qa/',
    expectIncludes: ['home isolé', 'gitignoré'],
    description: 'Integration and CLI tests must run with an isolated QA home directory.',
    source: 'CLAUDE.md:13',
  },
  {
    id: 'str-replace-omission-block',
    query: 'str_replace',
    expectIncludes: ['omission placeholder', 'rest of code'],
    description: 'Use str_replace with exact matching and never leave omission placeholders like rest of code.',
    source: 'CLAUDE.md:210',
  },
  {
    id: 'verify-before-finishing',
    query: 'verificationenforcement',
    expectIncludes: ['verify before finishing', 'file changes'],
    description: 'Always verify changes with targeted test runs before considering a task finished.',
    source: 'CLAUDE.md:99',
  },
  {
    id: 'report-before-inspection',
    query: 'docs/reports',
    expectIncludes: ['rapport créé avant', 'avant toute inspection'],
    description: 'Create the mission repair report before starting code inspection.',
    source: 'CLAUDE.md:10',
  },
  {
    id: 'tests-live-in-tests-only',
    query: 'vitest.config',
    expectIncludes: ['tests/ only', 'in-source'],
    description: 'All test files must reside under tests/ directory, never in-source inside src/.',
    source: 'CLAUDE.md:35',
  },
  {
    id: 'self-improvement-never-touch-src',
    query: 'self-improvement',
    expectIncludes: ['reversible learnable', 'never edits src'],
    description: 'Self-improvement engine operates strictly on reversible layers, never modifying src/ directly.',
    source: 'CLAUDE.md:119',
  },
  {
    id: 'peer-tool-fails-closed',
    query: 'peer.tool.invoke',
    expectIncludes: ['peer_workspace_not_configured', 'fails closed'],
    description: 'Peer tool invocation fails closed if peer tool workspace root is not configured.',
    source: 'CLAUDE.md:139',
  },
  {
    id: 'batch-anti-tautology-guard',
    query: '/batch',
    expectIncludes: ['anti-tautology', 'no files changed'],
    description: 'Batch execution enforces an anti-tautology guard rejecting write units that change no files.',
    source: 'docs/agents.md:119',
  },
];
