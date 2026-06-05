/**
 * Self-improvement engine — public surface + workspace wiring.
 *
 * @module agent/self-improvement
 */

import { getLessonsTracker } from '../lessons-tracker.js';
import { SEED_BENCHMARK_SCENARIOS } from './capability-benchmark.js';
import type { LessonMutatorPort } from './empirical-gate.js';
import { EvolutionaryArchive } from './evolutionary-archive.js';
import { SelfImprovementEngine, resolveAutonomy, type Autonomy } from './engine.js';
import { StaticProposer, SEED_LESSON_DRAFTS } from './proposer.js';

export * from './types.js';
export * from './capability-benchmark.js';
export * from './empirical-gate.js';
export * from './evolutionary-archive.js';
export * from './proposer.js';
export * from './experience-source.js';
export { SelfImprovementEngine, resolveAutonomy, type Autonomy } from './engine.js';

/** Adapt the real (offline, deterministic) LessonsTracker to the mutator port. */
export function createLessonMutatorPort(workDir: string = process.cwd()): LessonMutatorPort {
  const tracker = getLessonsTracker(workDir);
  return {
    search: (query) =>
      tracker.search(query).map((l) => ({ id: l.id, content: l.content, context: l.context })),
    add: (category, content, context) => {
      const item = tracker.add(category, content, 'manual', context);
      return { id: item.id };
    },
    remove: (id) => tracker.remove(id),
  };
}

/**
 * Build a SelfImprovementEngine wired to the workspace: the real lessons store,
 * the curated seed benchmark + bootstrap proposer, and a persisted evolutionary
 * archive. Autonomy resolves from CODEBUDDY_SELF_IMPROVE unless overridden.
 */
export function createWorkspaceEngine(
  options: { workDir?: string; autonomy?: Autonomy } = {},
): SelfImprovementEngine {
  const workDir = options.workDir ?? process.cwd();
  return new SelfImprovementEngine({
    scenarios: SEED_BENCHMARK_SCENARIOS,
    port: createLessonMutatorPort(workDir),
    proposer: new StaticProposer(SEED_LESSON_DRAFTS),
    archive: new EvolutionaryArchive({ workDir }),
    autonomy: options.autonomy ?? resolveAutonomy(),
  });
}
