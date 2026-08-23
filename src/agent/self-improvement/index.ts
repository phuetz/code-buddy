/**
 * Self-improvement engine — public surface + workspace wiring.
 *
 * @module agent/self-improvement
 */

import { getLessonsTracker } from '../lessons-tracker.js';
import { SEED_BENCHMARK_SCENARIOS, scoreBenchmark } from './capability-benchmark.js';
import type { LessonMutatorPort } from './empirical-gate.js';
import { EvolutionaryArchive } from './evolutionary-archive.js';
import { LearningStore, type LearnableStatePort } from './learning-store.js';
import { RuleLearningEngine, HeuristicRuleProposer } from './rule-engine.js';
import { RuleStore, loadTrajectoryCorpus } from './rule-store.js';
import { SelfImprovementEngine, resolveAutonomy, type Autonomy } from './engine.js';
import { StaticProposer, LlmProposer, SEED_LESSON_DRAFTS, type ImprovementProposer } from './proposer.js';
import { createLlmDrafter } from './llm-drafter.js';

export * from './types.js';
export * from './capability-benchmark.js';
export * from './empirical-gate.js';
export * from './evolutionary-archive.js';
export * from './proposer.js';
export * from './experience-source.js';
export * from './learning-store.js';
export * from './execution-gate.js';
export * from './paired-gate.js';
export * from './paired-runner.js';
export * from './rule-store.js';
export * from './digest.js';
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
  options: { workDir?: string; autonomy?: Autonomy; useLlm?: boolean; proposer?: ImprovementProposer } = {},
): SelfImprovementEngine {
  const workDir = options.workDir ?? process.cwd();
  // Default proposer is the deterministic, offline bootstrap pack. `useLlm`
  // swaps in the model-backed proposer that discovers novel lessons from
  // friction — still gated by the same deterministic empirical validator.
  const proposer =
    options.proposer ??
    (options.useLlm ? new LlmProposer(createLlmDrafter()) : new StaticProposer(SEED_LESSON_DRAFTS));
  return new SelfImprovementEngine({
    scenarios: SEED_BENCHMARK_SCENARIOS,
    port: createLessonMutatorPort(workDir),
    proposer,
    archive: new EvolutionaryArchive({ workDir }),
    autonomy: options.autonomy ?? resolveAutonomy(),
  });
}

/**
 * Build a git-backed LearningStore wired to the workspace: it versions the live
 * lessons + archive + benchmark score so any applied improvement is reversible
 * (restore to the best-scoring version). Snapshot/restore go through the real
 * LessonsTracker API so in-memory state and `.codebuddy/lessons.md` stay
 * consistent.
 */
export function createWorkspaceLearningStore(options: { workDir?: string } = {}): LearningStore {
  const workDir = options.workDir ?? process.cwd();
  const tracker = getLessonsTracker(workDir);
  const ruleStore = new RuleStore({ workDir });
  const port: LearnableStatePort = {
    listLessons: () =>
      tracker.search('').map((l) => ({
        category: l.category,
        content: l.content,
        ...(l.context ? { context: l.context } : {}),
      })),
    setLessons: (lessons) => {
      tracker.clearByCategory(); // clear all
      for (const l of lessons) tracker.add(l.category, l.content, 'manual', l.context);
    },
    archive: () => new EvolutionaryArchive({ workDir }).list(),
    score: () => scoreBenchmark(SEED_BENCHMARK_SCENARIOS, createLessonMutatorPort(workDir)),
    listRules: () => ruleStore.list(),
    setRules: (rules) => ruleStore.setAll(rules as ReturnType<RuleStore['list']>),
  };
  return new LearningStore({ workDir, port });
}

/**
 * Build the execution-grounded RuleLearningEngine wired to the workspace: it
 * learns behavioral rules validated against a labeled trajectory corpus
 * (corpus.json or seed). Each accepted rule is also written as a retrievable RULE
 * lesson, so it influences the agent's context AND is captured in the git-versioned
 * lessons snapshot (reversible like everything else).
 */
export function createWorkspaceRuleEngine(
  options: { workDir?: string; autonomy?: Autonomy } = {},
): RuleLearningEngine {
  const workDir = options.workDir ?? process.cwd();
  const tracker = getLessonsTracker(workDir);
  return new RuleLearningEngine({
    corpus: loadTrajectoryCorpus(workDir),
    proposer: new HeuristicRuleProposer(),
    ruleStore: new RuleStore({ workDir }),
    archive: new EvolutionaryArchive({ workDir }),
    autonomy: options.autonomy ?? resolveAutonomy(),
    onAccept: (proposal) => tracker.add('RULE', proposal.statement, 'manual'),
  });
}
