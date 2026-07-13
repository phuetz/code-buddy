/**
 * SkillImprovementEngine — the skill sibling of the tool engine. One cycle:
 *   pick an uncovered skill scenario → propose a SKILL.md → skill gate
 *   (static scan → firewall → coverage) → install+archive (auto-apply) or report.
 *
 * @module agent/self-improvement/skill-engine
 */

import { EvolutionaryArchive } from './evolutionary-archive.js';
import { resolveAutonomy, type Autonomy } from './engine.js';
import { coversScenario, validateSkillProposal } from './skill-gate.js';
import {
  LiveSkillMutator,
  safetyGateSkill,
  toAuthoredSkillName,
  type SkillMutatorPort,
} from './skill-mutator.js';
import type { SkillProposer } from './skill-proposer.js';
import type { SkillBenchmarkScenario, SkillGateOutcome } from './skill-types.js';

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
}

export class SkillImprovementEngine {
  private readonly scenarios: SkillBenchmarkScenario[];
  private readonly proposer: SkillProposer;
  private readonly mutator: SkillMutatorPort;
  private readonly archive: EvolutionaryArchive;
  private readonly autonomy: Autonomy;
  private readonly now: () => Date;
  private readonly covered = new Set<string>();

  constructor(options: SkillImprovementEngineOptions) {
    this.scenarios = options.scenarios;
    this.proposer = options.proposer;
    this.mutator = options.mutator ?? new LiveSkillMutator();
    this.archive = options.archive ?? new EvolutionaryArchive();
    this.autonomy = options.autonomy ?? resolveAutonomy();
    this.now = options.now ?? (() => new Date());
  }

  async runCycle(): Promise<SkillCycleResult> {
    const startedAt = this.now().toISOString();
    const base = { kind: 'skill_improvement_cycle' as const, startedAt, autonomy: this.autonomy };

    for (const scenario of this.scenarios) {
      if (this.covered.has(scenario.id)) continue;
      const proposed = await this.proposer.propose(scenario);
      if (!proposed) continue;
      let proposal = proposed;
      if (this.mutator.has(proposal.spec.name)) {
        const existing = this.mutator.getContent(proposal.spec.name);
        if (existing && safetyGateSkill(existing).ok && coversScenario(existing, scenario)) {
          this.covered.add(scenario.id);
          continue;
        }
        proposal = {
          ...proposal,
          spec: {
            ...proposal.spec,
            name: this.availableName(proposal.spec.name, scenario.id),
          },
        };
      }

      const gate = validateSkillProposal(proposal, scenario, this.mutator, {
        keepOnAccept: this.autonomy === 'auto-apply',
      });
      const applied = gate.accepted && !!gate.appliedRef;

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

    return {
      ...base,
      selectedScenarioId: null,
      proposalId: null,
      gate: null,
      applied: false,
      notes: ['no uncovered skill scenario with an available proposal'],
    };
  }

  private availableName(baseName: string, scenarioId: string): string {
    const candidate = toAuthoredSkillName(`${baseName}-${scenarioId}`);
    if (!this.mutator.has(candidate)) return candidate;
    let suffix = 2;
    while (this.mutator.has(`${candidate}-${suffix}`)) suffix += 1;
    return `${candidate}-${suffix}`;
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
}
