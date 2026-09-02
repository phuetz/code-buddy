/**
 * ToolImprovementEngine — the tool sibling of SelfImprovementEngine. One cycle:
 *   pick an uncovered tool scenario → propose (redacted view) → tool gate
 *   (static scan → visible → held-out) → keep+archive (auto-apply) or report.
 *
 * Autonomy is the same fail-safe toggle: 'propose-only' (default, including
 * CODEBUDDY_SELF_IMPROVE=true) validates and reports; 'auto-apply'
 * (CODEBUDDY_SELF_IMPROVE=auto-apply or `--apply`) keeps only tools that pass
 * the behavioural held-out gate, and archives them (reversible — un-registerable).
 *
 * @module agent/self-improvement/tool-engine
 */

import { EvolutionaryArchive } from './evolutionary-archive.js';
import { resolveAutonomy, type Autonomy } from './engine.js';
import { PendingProposalStore } from './proposal-store.js';
import { validateToolProposal } from './tool-gate.js';
import { LiveToolMutator, type ToolMutatorPort } from './tool-skill-mutator.js';
import { toProposerView, type ToolProposer } from './tool-proposer.js';
import type { ToolBenchmarkScenario, ToolGateOutcome, ToolProposal } from './tool-types.js';

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
  /** Workspace root for pending propose-only candidates (default cwd). */
  workDir?: string;
  proposalStore?: PendingProposalStore;
}

export class ToolImprovementEngine {
  private readonly scenarios: ToolBenchmarkScenario[];
  private readonly proposer: ToolProposer;
  private readonly mutator: ToolMutatorPort;
  private readonly archive: EvolutionaryArchive;
  private readonly autonomy: Autonomy;
  private readonly now: () => Date;
  private readonly proposals: PendingProposalStore;
  /** Scenario ids already satisfied this run (coverage is per-scenario, not per tool name). */
  private readonly covered = new Set<string>();

  constructor(options: ToolImprovementEngineOptions) {
    this.scenarios = options.scenarios;
    this.proposer = options.proposer;
    this.mutator = options.mutator ?? new LiveToolMutator();
    this.archive = options.archive ?? new EvolutionaryArchive({ workDir: options.workDir });
    this.autonomy = options.autonomy ?? resolveAutonomy();
    this.now = options.now ?? (() => new Date());
    this.proposals = options.proposalStore ?? new PendingProposalStore({ workDir: options.workDir });
  }

  /** Run exactly one tool-improvement cycle. */
  async runCycle(): Promise<ToolCycleResult> {
    const startedAt = this.now().toISOString();
    const base = { kind: 'tool_improvement_cycle' as const, startedAt, autonomy: this.autonomy };

    for (const scenario of this.scenarios) {
      // Coverage is per-scenario: once a tool has satisfied this scenario's gate,
      // don't re-author it (even if the model would pick a different name).
      if (this.covered.has(scenario.id)) continue;

      if (this.autonomy === 'auto-apply') {
        const pending = this.proposals.loadTool(scenario.id);
        if (pending) {
          const appliedPending = await this.finishCycle(base, scenario, pending.proposal, true);
          if (appliedPending.applied) this.proposals.remove('tool', scenario.id);
          return appliedPending;
        }
      }

      const proposal = await this.proposer.propose(toProposerView(scenario));
      if (!proposal) continue;
      // A tool with this exact name already exists — skip (avoid dup-register).
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
      notes: ['no uncovered tool scenario with an available proposal'],
    };
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

  private async finishCycle(
    base: { kind: 'tool_improvement_cycle'; startedAt: string; autonomy: Autonomy },
    scenario: ToolBenchmarkScenario,
    proposal: ToolProposal,
    keepOnAccept: boolean,
  ): Promise<ToolCycleResult> {
    const gate = await validateToolProposal(proposal, scenario, this.mutator, { keepOnAccept });
    const applied = gate.accepted && !!gate.appliedRef;

    if (gate.accepted && !keepOnAccept) {
      this.proposals.saveTool({
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
}
