/**
 * SelfImprovementEngine — orchestrates one recursive-improvement cycle:
 *   curriculum (pick the weakest capability) → propose → empirical gate
 *   (snapshot/apply/re-score) → keep or roll back → archive → audit.
 *
 * Autonomy is tiered and fail-safe: 'propose-only' (default) validates and
 * REPORTS what would help but persists nothing; 'auto-apply'
 * (CODEBUDDY_SELF_IMPROVE=true) keeps only changes that empirically improve the
 * deterministic benchmark with zero regressions. Even then, every kept change
 * is reversible (a lesson that can be removed) and archived for audit — code
 * self-modification is out of scope.
 *
 * @module agent/self-improvement/engine
 */

import {
  scoreBenchmark,
  selectNextScenario,
} from './capability-benchmark.js';
import { validateProposal, type LessonMutatorPort } from './empirical-gate.js';
import { EvolutionaryArchive } from './evolutionary-archive.js';
import type { ImprovementProposer } from './proposer.js';
import {
  SELF_IMPROVEMENT_SCHEMA_VERSION,
  type BenchmarkScenario,
  type Experience,
  type SelfImprovementCycleResult,
} from './types.js';

export type Autonomy = 'propose-only' | 'auto-apply';

/** Resolve autonomy from the environment (fail-safe to propose-only). */
export function resolveAutonomy(env: NodeJS.ProcessEnv = process.env): Autonomy {
  return env.CODEBUDDY_SELF_IMPROVE === 'true' ? 'auto-apply' : 'propose-only';
}

export interface SelfImprovementEngineOptions {
  scenarios: BenchmarkScenario[];
  port: LessonMutatorPort;
  proposer: ImprovementProposer;
  archive?: EvolutionaryArchive;
  autonomy?: Autonomy;
  now?: () => Date;
}

export class SelfImprovementEngine {
  private readonly scenarios: BenchmarkScenario[];
  private readonly port: LessonMutatorPort;
  private readonly proposer: ImprovementProposer;
  private readonly archive: EvolutionaryArchive;
  private readonly autonomy: Autonomy;
  private readonly now: () => Date;

  constructor(options: SelfImprovementEngineOptions) {
    this.scenarios = options.scenarios;
    this.port = options.port;
    this.proposer = options.proposer;
    this.archive = options.archive ?? new EvolutionaryArchive();
    this.autonomy = options.autonomy ?? resolveAutonomy();
    this.now = options.now ?? (() => new Date());
  }

  /** Run exactly one improvement cycle. */
  runCycle(experiences: Experience[] = []): SelfImprovementCycleResult {
    const startedAt = this.now().toISOString();
    const scoreBefore = scoreBenchmark(this.scenarios, this.port);
    const base = {
      schemaVersion: SELF_IMPROVEMENT_SCHEMA_VERSION as typeof SELF_IMPROVEMENT_SCHEMA_VERSION,
      kind: 'self_improvement_cycle' as const,
      startedAt,
      autonomy: this.autonomy,
      scoreBefore,
    };

    const target = selectNextScenario(this.scenarios, scoreBefore);
    if (!target) {
      return {
        ...base, selectedScenarioId: null, proposalId: null, gate: null,
        scoreAfter: scoreBefore, applied: false,
        notes: ['all benchmark scenarios are already covered — nothing to improve'],
      };
    }

    const proposal = this.proposer.propose(target, experiences);
    if (!proposal) {
      return {
        ...base, selectedScenarioId: target.id, proposalId: null, gate: null,
        scoreAfter: scoreBefore, applied: false,
        notes: [`no proposal available for scenario "${target.id}"`],
      };
    }

    const gate = validateProposal(proposal, this.scenarios, this.port, {
      keepOnAccept: this.autonomy === 'auto-apply',
    }).outcome;

    // We must re-read appliedRef from a fresh validate call? No — validateProposal
    // already left the change applied (auto-apply + accepted). Re-derive applied.
    const applied = gate.accepted && !gate.rolledBack;

    if (applied) {
      // Find the lesson we just kept so we can store a rollback reference.
      const kept = this.port
        .search(target.query)
        .find((l) => l.content === proposal.lesson.content);
      this.archive.append({
        proposalId: proposal.id,
        kind: proposal.kind,
        targetScenarioId: target.id,
        experienceId: proposal.experienceId,
        delta: gate.delta,
        scoreAfter: gate.scoreAfter,
        appliedRef: kept?.id,
      });
    }

    const scoreAfter = scoreBenchmark(this.scenarios, this.port);
    return {
      ...base,
      selectedScenarioId: target.id,
      proposalId: proposal.id,
      gate,
      scoreAfter,
      applied,
      notes: gate.notes,
    };
  }

  /**
   * Run cycles until no further PERSISTED progress is made (the score stops
   * rising) or maxCycles is reached. In propose-only mode this performs a single
   * cycle, since nothing is persisted to uncover the next target.
   */
  runLoop(options: { maxCycles?: number; experiences?: Experience[] } = {}): SelfImprovementCycleResult[] {
    const maxCycles = Math.max(1, options.maxCycles ?? this.scenarios.length + 1);
    const results: SelfImprovementCycleResult[] = [];
    for (let i = 0; i < maxCycles; i++) {
      const result = this.runCycle(options.experiences ?? []);
      results.push(result);
      // Stop unless this cycle made real, persisted progress.
      if (!result.applied) break;
    }
    return results;
  }

  /** Read-only status snapshot for `improve status`. */
  status(): {
    autonomy: Autonomy;
    score: ReturnType<typeof scoreBenchmark>;
    archive: ReturnType<EvolutionaryArchive['summary']>;
  } {
    return {
      autonomy: this.autonomy,
      score: scoreBenchmark(this.scenarios, this.port),
      archive: this.archive.summary(),
    };
  }
}
