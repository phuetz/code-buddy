/**
 * ToolImprovementEngine — the tool sibling of SelfImprovementEngine. One cycle:
 *   pick an uncovered tool scenario → propose (redacted view) → tool gate
 *   (static scan → visible → held-out) → keep+archive (auto-apply) or report.
 *
 * Autonomy is the same fail-safe toggle: 'propose-only' (default) validates and
 * reports; 'auto-apply' (CODEBUDDY_SELF_IMPROVE=true) keeps only tools that pass
 * the behavioural held-out gate, and archives them (reversible — un-registerable).
 *
 * @module agent/self-improvement/tool-engine
 */

import { EvolutionaryArchive } from './evolutionary-archive.js';
import { toAuthoredName } from './authored-tool-runtime.js';
import { resolveAutonomy, type Autonomy } from './engine.js';
import { validateToolProposal } from './tool-gate.js';
import { LiveToolMutator, type ToolMutatorPort } from './tool-skill-mutator.js';
import { toProposerView, type ToolProposer } from './tool-proposer.js';
import type { ToolBenchmarkScenario, ToolGateOutcome } from './tool-types.js';

export interface ToolCycleResult {
  kind: 'tool_improvement_cycle';
  startedAt: string;
  autonomy: Autonomy;
  selectedScenarioId: string | null;
  proposalId: string | null;
  gate: ToolGateOutcome | null;
  applied: boolean;
  notes: string[];
}

export interface ToolImprovementEngineOptions {
  scenarios: ToolBenchmarkScenario[];
  proposer: ToolProposer;
  mutator?: ToolMutatorPort;
  archive?: EvolutionaryArchive;
  autonomy?: Autonomy;
  now?: () => Date;
}

export class ToolImprovementEngine {
  private readonly scenarios: ToolBenchmarkScenario[];
  private readonly proposer: ToolProposer;
  private readonly mutator: ToolMutatorPort;
  private readonly archive: EvolutionaryArchive;
  private readonly autonomy: Autonomy;
  private readonly now: () => Date;
  /** Scenario ids already satisfied this run (coverage is per-scenario, not per tool name). */
  private readonly covered = new Set<string>();

  constructor(options: ToolImprovementEngineOptions) {
    this.scenarios = options.scenarios;
    this.proposer = options.proposer;
    this.mutator = options.mutator ?? new LiveToolMutator();
    this.archive = options.archive ?? new EvolutionaryArchive();
    this.autonomy = options.autonomy ?? resolveAutonomy();
    this.now = options.now ?? (() => new Date());
  }

  /** Run exactly one tool-improvement cycle. */
  async runCycle(): Promise<ToolCycleResult> {
    const startedAt = this.now().toISOString();
    const base = { kind: 'tool_improvement_cycle' as const, startedAt, autonomy: this.autonomy };

    for (const scenario of this.scenarios) {
      // Coverage is per-scenario: once a tool has satisfied this scenario's gate,
      // don't re-author it (even if the model would pick a different name).
      if (this.covered.has(scenario.id)) continue;
      const proposed = await this.proposer.propose(toProposerView(scenario));
      if (!proposed) continue;
      let proposal = proposed;
      if (this.mutator.has(proposal.spec.name)) {
        const existing = this.mutator.getSpec(proposal.spec.name);
        if (existing) {
          const existingGate = await validateToolProposal(
            { ...proposal, spec: existing },
            scenario,
            this.mutator,
            { keepOnAccept: false },
          );
          if (existingGate.accepted) {
            this.covered.add(scenario.id);
            continue;
          }
        }
        proposal = {
          ...proposal,
          spec: {
            ...proposal.spec,
            name: this.availableName(proposal.spec.name, scenario.id),
          },
        };
      }

      const gate = await validateToolProposal(proposal, scenario, this.mutator, {
        keepOnAccept: this.autonomy === 'auto-apply',
      });
      const applied = gate.accepted && !!gate.appliedRef;

      if (applied) {
        this.covered.add(scenario.id);
        this.archive.append({
          proposalId: proposal.id,
          kind: 'tool',
          targetScenarioId: scenario.id,
          experienceId: proposal.experienceId,
          delta: 1,
          scoreAfter: gate.visiblePassed + gate.heldOutPassed,
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
      notes: ['no uncovered tool scenario with an available proposal'],
    };
  }

  private availableName(baseName: string, scenarioId: string): string {
    const candidate = toAuthoredName(`${baseName}_${scenarioId}`);
    if (!this.mutator.has(candidate)) return candidate;
    let suffix = 2;
    while (this.mutator.has(`${candidate}_${suffix}`)) suffix += 1;
    return `${candidate}_${suffix}`;
  }

  /** Run cycles until nothing new is applied (or maxCycles). */
  async runLoop(maxCycles?: number): Promise<ToolCycleResult[]> {
    const cap = Math.max(1, maxCycles ?? this.scenarios.length + 1);
    const results: ToolCycleResult[] = [];
    for (let i = 0; i < cap; i++) {
      const r = await this.runCycle();
      results.push(r);
      if (!r.applied) break;
    }
    return results;
  }

  status(): { autonomy: Autonomy; scenarios: number; archive: ReturnType<EvolutionaryArchive['summary']> } {
    return { autonomy: this.autonomy, scenarios: this.scenarios.length, archive: this.archive.summary() };
  }
}
