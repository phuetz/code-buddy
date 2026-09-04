/**
 * StrategyImprovementEngine — one cycle:
 *   parent = active strategy for the scope → proposer mutates it from the
 *   experiences → gate (schema → safety → lineage → inert → empirical) →
 *   install + activate + archive (auto-apply) or report (propose-only).
 * Bounded: one candidate per cycle, never throws past the gate.
 *
 * @module agent/self-improvement/strategy-engine
 */

import { resolveAutonomy, type Autonomy } from './engine.js';
import { EvolutionaryArchive } from './evolutionary-archive.js';
import { validateStrategyProposal, type StrategyEvaluator, type ValidateStrategyOptions } from './strategy-gate.js';
import type { StrategyProposer } from './strategy-proposer.js';
import { ReplayStrategyEvaluator } from './strategy-replay.js';
import { StrategyStore } from './strategy-store.js';
import type { StrategyGateOutcome, StrategyProposal, StrategyScope, StrategySpec } from './strategy-types.js';
import type { Experience } from './types.js';

export interface StrategyCycleResult {
  kind: 'strategy_improvement_cycle';
  startedAt: string;
  autonomy: Autonomy;
  scope: StrategyScope;
  parentId: string;
  proposalId: string | null;
  candidate: StrategySpec | null;
  rationale: string | null;
  gate: StrategyGateOutcome | null;
  applied: boolean;
  notes: string[];
}

export interface StrategyImprovementEngineOptions {
  proposer: StrategyProposer;
  scope?: StrategyScope;
  store?: StrategyStore;
  /** Default: replay evaluator over the cycle's experiences. */
  evaluator?: StrategyEvaluator | ((experiences: Experience[]) => StrategyEvaluator);
  archive?: EvolutionaryArchive;
  autonomy?: Autonomy;
  now?: () => Date;
  workDir?: string;
  gateOptions?: Omit<ValidateStrategyOptions, 'keepOnAccept'>;
}

export class StrategyImprovementEngine {
  private readonly proposer: StrategyProposer;
  private readonly scope: StrategyScope;
  private readonly store: StrategyStore;
  private readonly evaluatorFactory: (experiences: Experience[]) => StrategyEvaluator;
  private readonly archive: EvolutionaryArchive;
  private readonly autonomy: Autonomy;
  private readonly now: () => Date;
  private readonly gateOptions: Omit<ValidateStrategyOptions, 'keepOnAccept'>;

  constructor(options: StrategyImprovementEngineOptions) {
    this.proposer = options.proposer;
    this.scope = options.scope ?? 'default';
    this.store = options.store ?? new StrategyStore({ workDir: options.workDir });
    const ev = options.evaluator;
    this.evaluatorFactory =
      typeof ev === 'function' ? ev : ev ? () => ev : (experiences) => new ReplayStrategyEvaluator(experiences);
    this.archive = options.archive ?? new EvolutionaryArchive({ workDir: options.workDir });
    this.autonomy = options.autonomy ?? resolveAutonomy();
    this.now = options.now ?? (() => new Date());
    this.gateOptions = options.gateOptions ?? {};
  }

  get activeStrategy(): StrategySpec {
    return this.store.resolveActive(this.scope);
  }

  async runCycle(experiences: Experience[]): Promise<StrategyCycleResult> {
    const startedAt = this.now().toISOString();
    const parent = this.store.resolveActive(this.scope);
    const base = {
      kind: 'strategy_improvement_cycle' as const,
      startedAt,
      autonomy: this.autonomy,
      scope: this.scope,
      parentId: parent.id,
    };
    let proposal: StrategyProposal | null = null;
    try {
      proposal = await this.proposer.propose(parent, experiences);
    } catch (error) {
      return { ...base, proposalId: null, candidate: null, rationale: null, gate: null, applied: false, notes: [`proposer failed: ${error instanceof Error ? error.message : String(error)}`] };
    }
    if (!proposal) {
      return { ...base, proposalId: null, candidate: null, rationale: null, gate: null, applied: false, notes: ['no failure signal in the experiences — nothing to mutate'] };
    }
    const keepOnAccept = this.autonomy === 'auto-apply';
    const gate = await validateStrategyProposal(
      proposal,
      parent,
      this.evaluatorFactory(experiences),
      this.store,
      { ...this.gateOptions, keepOnAccept },
    );
    const applied = gate.accepted && !!gate.appliedRef;
    if (applied) {
      this.archive.append({
        proposalId: proposal.id,
        kind: 'strategy',
        targetScenarioId: `strategy:${this.scope}`,
        experienceId: proposal.experienceIds[0],
        delta: gate.paired ? gate.paired.wins - gate.paired.losses : 1,
        scoreAfter: gate.paired?.pImprove ?? 1,
        appliedRef: gate.appliedRef,
      });
    }
    const candidate = gate.accepted || gate.rejectionReason !== 'schema' ? (proposal.candidate as StrategySpec) : null;
    return {
      ...base,
      proposalId: proposal.id,
      candidate,
      rationale: proposal.rationale,
      gate,
      applied,
      notes: gate.reasons,
    };
  }
}
