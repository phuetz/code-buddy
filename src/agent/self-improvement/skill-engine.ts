/**
 * SkillImprovementEngine — the skill sibling of the tool engine. One cycle:
 *   pick an uncovered skill scenario → propose a SKILL.md → skill gate
 *   (static scan → firewall → coverage) → install+archive (auto-apply) or report.
 *
 * @module agent/self-improvement/skill-engine
 */

import { EvolutionaryArchive } from './evolutionary-archive.js';
import { resolveAutonomy, type Autonomy } from './engine.js';
import { PendingProposalStore } from './proposal-store.js';
import { validateSkillProposal } from './skill-gate.js';
import { LiveSkillMutator, type SkillMutatorPort } from './skill-mutator.js';
import type { SkillProposer } from './skill-proposer.js';
import type { SkillBenchmarkScenario, SkillGateOutcome, SkillProposal } from './skill-types.js';

export interface SkillCycleResult {
  kind: 'skill_improvement_cycle';
  startedAt: string;
  autonomy: Autonomy;
  selectedScenarioId: string | null;
  proposalId: string | null;
  gate: SkillGateOutcome | null;
  applied: boolean;
  notes: string[];
}

export interface SkillImprovementEngineOptions {
  scenarios: SkillBenchmarkScenario[];
  proposer: SkillProposer;
  mutator?: SkillMutatorPort;
  archive?: EvolutionaryArchive;
  autonomy?: Autonomy;
  now?: () => Date;
  /** Workspace root for pending propose-only candidates (default cwd). */
  workDir?: string;
  proposalStore?: PendingProposalStore;
}

export class SkillImprovementEngine {
  private readonly scenarios: SkillBenchmarkScenario[];
  private readonly proposer: SkillProposer;
  private readonly mutator: SkillMutatorPort;
  private readonly archive: EvolutionaryArchive;
  private readonly autonomy: Autonomy;
  private readonly now: () => Date;
  private readonly proposals: PendingProposalStore;
  private readonly covered = new Set<string>();

  constructor(options: SkillImprovementEngineOptions) {
    this.scenarios = options.scenarios;
    this.proposer = options.proposer;
    this.mutator = options.mutator ?? new LiveSkillMutator();
    this.archive = options.archive ?? new EvolutionaryArchive({ workDir: options.workDir });
    this.autonomy = options.autonomy ?? resolveAutonomy();
    this.now = options.now ?? (() => new Date());
    this.proposals = options.proposalStore ?? new PendingProposalStore({ workDir: options.workDir });
  }

  async runCycle(): Promise<SkillCycleResult> {
    const startedAt = this.now().toISOString();
    const base = { kind: 'skill_improvement_cycle' as const, startedAt, autonomy: this.autonomy };

    for (const scenario of this.scenarios) {
      if (this.covered.has(scenario.id)) continue;

      if (this.autonomy === 'auto-apply') {
        const pending = this.proposals.loadSkill(scenario.id);
        if (pending) {
          const appliedPending = this.finishCycle(base, scenario, pending.proposal, true);
          if (appliedPending.applied) this.proposals.remove('skill', scenario.id);
          return appliedPending;
        }
      }

      const proposal = await this.proposer.propose(scenario);
      if (!proposal) continue;
      if (this.mutator.has(proposal.spec.name)) {
        this.covered.add(scenario.id);
        continue;
      }

      return this.finishCycle(base, scenario, proposal, this.autonomy === 'auto-apply');
    }

    return {
      ...base,
      selectedScenarioId: null,
      proposalId: null,
      gate: null,
      applied: false,
      notes: ['no uncovered skill scenario with an available proposal'],
    };
  }

  async runLoop(maxCycles?: number): Promise<SkillCycleResult[]> {
    const cap = Math.max(1, maxCycles ?? this.scenarios.length + 1);
    const results: SkillCycleResult[] = [];
    for (let i = 0; i < cap; i++) {
      const r = await this.runCycle();
      results.push(r);
      if (!r.applied) break;
    }
    return results;
  }

  private finishCycle(
    base: { kind: 'skill_improvement_cycle'; startedAt: string; autonomy: Autonomy },
    scenario: SkillBenchmarkScenario,
    proposal: SkillProposal,
    keepOnAccept: boolean,
  ): SkillCycleResult {
    const gate = validateSkillProposal(proposal, scenario, this.mutator, { keepOnAccept });
    const applied = gate.accepted && !!gate.appliedRef;

    if (gate.accepted && !keepOnAccept) {
      this.proposals.saveSkill({
        scenarioId: scenario.id,
        acceptedAt: this.now().toISOString(),
        proposal,
        gate,
      });
    }

    if (applied) {
      this.covered.add(scenario.id);
      this.archive.append({
        proposalId: proposal.id,
        kind: 'skill',
        targetScenarioId: scenario.id,
        experienceId: proposal.experienceId,
        delta: 1,
        scoreAfter: 1,
        appliedRef: gate.appliedRef,
      });
    }

    return {
      ...base,
      selectedScenarioId: scenario.id,
      proposalId: proposal.id,
      gate,
      applied,
      notes: gate.reasons,
    };
  }
}
