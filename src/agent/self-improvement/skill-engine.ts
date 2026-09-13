/**
 * SkillImprovementEngine — the skill sibling of the tool engine. One cycle:
 *   pick an uncovered skill scenario → propose a SKILL.md → skill gate
 *   (static scan → firewall → coverage) → install+archive (auto-apply) or report.
 *
 * @module agent/self-improvement/skill-engine
 */

import path from 'node:path';
import { createHash } from 'node:crypto';
import { evaluateSkillBehavior, type SkillBehaviorResult } from './skill-behavior-gate.js';
import { SKILL_BEHAVIOR_TASKS } from './skill-behavior-benchmark.js';
import { EvolutionaryArchive } from './evolutionary-archive.js';
import { resolveAutonomy, type Autonomy } from './engine.js';
import { PendingProposalStore } from './proposal-store.js';
import { SkillApplyJournal, type SkillApplyPhase, type SkillApplyRecord } from './skill-apply-journal.js';
import { validateSkillProposal } from './skill-gate.js';
import { ensureFrontmatter, isAuthoredSkillName, LiveSkillMutator, type SkillMutatorPort } from './skill-mutator.js';
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
  behavior?: SkillBehaviorResult;
  /** Skill is on disk; archive write has not been acknowledged. */
  proofPending?: boolean;
  applyPhase?: SkillApplyPhase | 'archived';
}

export interface SkillImprovementEngineOptions {
  scenarios: SkillBenchmarkScenario[];
  evaluateBehavior?: (content: string, scenarioId: string) => Promise<SkillBehaviorResult>;
  proposer: SkillProposer;
  mutator?: SkillMutatorPort;
  archive?: EvolutionaryArchive;
  autonomy?: Autonomy;
  now?: () => Date;
  /** Workspace root for pending propose-only candidates (default cwd). */
  workDir?: string;
  proposalStore?: PendingProposalStore;
  applyJournal?: SkillApplyJournal;
  /** Override on-disk read used to compare an already-installed artifact. */
  readInstalledSkill?: (name: string) => string | null;
}

export class SkillImprovementEngine {
  private readonly evaluateBehavior: (content: string, scenarioId: string) => Promise<SkillBehaviorResult>;
  private readonly scenarios: SkillBenchmarkScenario[];
  private readonly proposer: SkillProposer;
  private readonly mutator: SkillMutatorPort;
  private readonly archive: EvolutionaryArchive;
  private readonly autonomy: Autonomy;
  private readonly now: () => Date;
  private readonly proposals: PendingProposalStore;
  private readonly applyJournal: SkillApplyJournal;
  private readonly workDir: string;
  private readonly readInstalledSkill: (name: string) => string | null;
  private readonly covered = new Set<string>();
  private readonly attempted = new Set<string>();

  constructor(options: SkillImprovementEngineOptions) {
    this.scenarios = options.scenarios;
    this.evaluateBehavior = options.evaluateBehavior ?? ((content, id) => evaluateSkillBehavior(content, SKILL_BEHAVIOR_TASKS[id] ?? []));
    this.proposer = options.proposer;
    this.archive = options.archive ?? new EvolutionaryArchive({ workDir: options.workDir });
    this.workDir = options.workDir ?? this.archive.workDir;
    this.mutator = options.mutator ?? new LiveSkillMutator(path.join(this.workDir, '.codebuddy', 'skills'));
    this.autonomy = options.autonomy ?? resolveAutonomy();
    this.now = options.now ?? (() => new Date());
    this.proposals = options.proposalStore ?? new PendingProposalStore({ workDir: this.workDir });
    this.applyJournal = options.applyJournal ?? new SkillApplyJournal({ workDir: this.workDir, now: this.now });
    this.readInstalledSkill = options.readInstalledSkill ?? ((name) => this.mutator.readInstalled?.(name) ?? null);
  }

  async runCycle(): Promise<SkillCycleResult> {
    const startedAt = this.now().toISOString();
    const base = { kind: 'skill_improvement_cycle' as const, startedAt, autonomy: this.autonomy };

    const pendingPeek = this.peekPendingRecords();
    if (!pendingPeek.ok) {
      return {
        ...base,
        selectedScenarioId: null,
        proposalId: null,
        gate: null,
        applied: false,
        notes: ['apply journal unreadable; refusing to install', pendingPeek.error],
      };
    }
    if (this.autonomy !== 'auto-apply') {
      const pending = pendingPeek.records[0];
      if (pending) {
        return {
          ...base,
          selectedScenarioId: pending.scenarioId,
          proposalId: pending.proposalId,
          gate: null,
          applied: false,
          applyPhase: pending.phase,
          notes: ['pending skill apply requires auto-apply; not installed'],
        };
      }
    } else {
      const resumed = this.resumePending(base, pendingPeek.records);
      if (resumed) return resumed;
    }

    for (const scenario of this.scenarios) {
      if (this.covered.has(scenario.id) || this.attempted.has(scenario.id)) continue;

      if (this.autonomy === 'auto-apply') {
        const pending = this.proposals.loadSkill(scenario.id);
        if (pending) {
          const appliedPending = await this.finishCycle(base, scenario, pending.proposal, true);
          if (appliedPending.applied) this.proposals.remove('skill', scenario.id);
          return appliedPending;
        }
      }

      const proposal = await this.proposer.propose(scenario);
      if (!proposal) {
        this.attempted.add(scenario.id);
        continue;
      }
      if (this.mutator.has(proposal.spec.name)) {
        this.covered.add(scenario.id);
        this.attempted.add(scenario.id);
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
      if (!r.selectedScenarioId) break;
    }
    return results;
  }

  private async finishCycle(
    base: { kind: 'skill_improvement_cycle'; startedAt: string; autonomy: Autonomy },
    scenario: SkillBenchmarkScenario,
    proposal: SkillProposal,
    keepOnAccept: boolean,
  ): Promise<SkillCycleResult> {
    let gate = validateSkillProposal(proposal, scenario, this.mutator, { keepOnAccept: false });
    let behavior: SkillBehaviorResult | undefined;
    if (gate.accepted && keepOnAccept) {
      const content = proposal.spec.content;
      try { behavior = await this.evaluateBehavior(content, scenario.id); }
      catch (error) { behavior = { accepted: false, wins: 0, losses: 0, tested: 0, cases: [], error: error instanceof Error ? error.message : String(error) }; }
      if (content !== proposal.spec.content) behavior = { ...behavior, accepted: false, error: 'Proposal changed during behavioral validation' };
      if (!behavior.accepted) {
        this.attempted.add(scenario.id);
        return { ...base, selectedScenarioId: scenario.id, proposalId: proposal.id, gate: { ...gate, accepted: false, reasons: ['Behavioral validation did not demonstrate a gain without regression'] }, behavior, applied: false, notes: [behavior.error ?? 'No verified behavioral improvement; proposal not installed'] };
      }
      return this.settleApplication(base, scenario, proposal, behavior, gate);
    }

    this.attempted.add(scenario.id);

    if (gate.accepted && !keepOnAccept) {
      this.proposals.saveSkill({
        scenarioId: scenario.id,
        acceptedAt: this.now().toISOString(),
        proposal,
        gate,
      });
    }

    return {
      ...base,
      selectedScenarioId: scenario.id,
      proposalId: proposal.id,
      gate,
      applied: false,
      notes: gate.reasons,
      ...(behavior ? { behavior } : {}),
    };
  }

  private peekPendingRecords(): { ok: true; records: SkillApplyRecord[] } | { ok: false; error: string } {
    try {
      return { ok: true, records: this.applyJournal.listPending() };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private resumePending(
    base: { kind: 'skill_improvement_cycle'; startedAt: string; autonomy: Autonomy },
    pending: SkillApplyRecord[],
  ): SkillCycleResult | null {
    const record = pending.find((item) => !this.attempted.has(item.scenarioId));
    if (!record) return null;

    const scenario = this.scenarios.find((item) => item.id === record.scenarioId);
    if (!scenario) {
      return {
        ...base,
        selectedScenarioId: record.scenarioId,
        proposalId: record.proposalId,
        gate: null,
        applied: false,
        notes: ['pending apply scenario is missing; not installed'],
      };
    }

    const identityError = savedIdentityMismatch(record, scenario, record.proposal);
    if (identityError) {
      this.attempted.add(scenario.id);
      return {
        ...base,
        selectedScenarioId: scenario.id,
        proposalId: record.proposalId,
        gate: null,
        applied: false,
        applyPhase: 'conflict',
        notes: [identityError],
      };
    }

    const coverage = validateSkillProposal(record.proposal, scenario, this.mutator, { keepOnAccept: false });
    if (!coverage.accepted) {
      this.attempted.add(scenario.id);
      return {
        ...base,
        selectedScenarioId: scenario.id,
        proposalId: record.proposal.id,
        gate: coverage,
        applied: false,
        notes: coverage.reasons,
      };
    }

    if (!record.behavior) {
      this.attempted.add(scenario.id);
      return {
        ...base,
        selectedScenarioId: scenario.id,
        proposalId: record.proposal.id,
        gate: {
          ...coverage,
          accepted: false,
          rejectionReason: 'behavior-required',
          reasons: ['pending apply is missing a behavioral receipt'],
        },
        applied: false,
        notes: ['pending apply is missing a behavioral receipt'],
      };
    }

    return this.settleApplication(base, scenario, record.proposal, record.behavior, coverage, record);
  }

  private settleApplication(
    base: { kind: 'skill_improvement_cycle'; startedAt: string; autonomy: Autonomy },
    scenario: SkillBenchmarkScenario,
    proposal: SkillProposal,
    behavior: SkillBehaviorResult,
    coverageGate: SkillGateOutcome,
    existing?: SkillApplyRecord,
  ): SkillCycleResult {
    const name = proposal.spec.name;
    let record = existing ?? this.applyJournal.get(scenario.id);
    const computedSha = sha256Hex(intendedSkillBody(proposal));
    if (record) {
      const identityError = savedIdentityMismatch(record, scenario, proposal);
      if (identityError) {
        this.attempted.add(scenario.id);
        return {
          ...base,
          selectedScenarioId: scenario.id,
          proposalId: proposal.id,
          gate: coverageGate,
          applied: false,
          applyPhase: 'conflict',
          notes: [identityError],
          behavior,
        };
      }
    }
    const intendedSha256 = record?.intendedSha256 ?? computedSha;
    let gate = coverageGate;

    if (!record) {
      try {
        record = this.applyJournal.upsert({
          scenarioId: scenario.id,
          proposalId: proposal.id,
          proposal,
          intendedSha256,
          phase: 'intent',
          behavior,
        });
      } catch (error) {
        return {
          ...base,
          selectedScenarioId: scenario.id,
          proposalId: proposal.id,
          gate: coverageGate,
          applied: false,
          applyPhase: 'intent',
          notes: [
            'apply journal write failed before installation; skill not installed',
            error instanceof Error ? error.message : String(error),
          ],
          behavior,
        };
      }
    }

    const installed = this.ensureInstalled(proposal, scenario, behavior, intendedSha256);
    if (installed.kind === 'conflict') {
      this.markConflict(scenario.id, proposal, intendedSha256, behavior);
      this.attempted.add(scenario.id);
      return this.conflictResult(base, scenario, proposal, coverageGate, behavior, name);
    }
    if (installed.kind === 'failed') {
      return {
        ...base,
        selectedScenarioId: scenario.id,
        proposalId: proposal.id,
        gate: coverageGate,
        applied: false,
        applyPhase: 'intent',
        notes: ['installation pending', installed.error],
        behavior,
      };
    }
    if (installed.kind === 'rejected') {
      this.attempted.add(scenario.id);
      if (record.phase === 'intent' && this.peekInstalled(name) === null) {
        this.applyJournal.remove(scenario.id);
      }
      return {
        ...base,
        selectedScenarioId: scenario.id,
        proposalId: proposal.id,
        gate: installed.gate,
        applied: false,
        notes: installed.gate.reasons,
        behavior,
      };
    }

    try {
      record = this.applyJournal.upsert({
        scenarioId: scenario.id,
        proposalId: proposal.id,
        proposal,
        intendedSha256,
        phase: 'installed',
        appliedRef: installed.appliedRef,
        behavior,
      });
    } catch {
      /* disk has the skill; retry still sees identical content + intent/installed */
    }
    gate = installed.gate;

    const appliedRef = record?.appliedRef ?? gate.appliedRef ?? name;

    try {
      this.archive.append({
        proposalId: proposal.id,
        kind: 'skill',
        targetScenarioId: scenario.id,
        experienceId: proposal.experienceId,
        delta: 1,
        scoreAfter: 1,
        appliedRef,
        evidence: {
          artifactSha256: intendedSha256,
          benchmarkSha256: sha256Hex(JSON.stringify(SKILL_BEHAVIOR_TASKS[scenario.id] ?? [])),
          wins: behavior.wins,
          losses: behavior.losses,
          cases: behavior.cases,
        },
      });
    } catch (error) {
      return {
        ...base,
        selectedScenarioId: scenario.id,
        proposalId: proposal.id,
        gate: { ...gate, accepted: true, appliedRef },
        applied: false,
        proofPending: true,
        applyPhase: 'installed',
        notes: ['installed, proof pending', error instanceof Error ? error.message : String(error)],
        behavior,
      };
    }

    this.applyJournal.remove(scenario.id);
    this.proposals.remove('skill', scenario.id);
    this.covered.add(scenario.id);
    this.attempted.add(scenario.id);
    return {
      ...base,
      selectedScenarioId: scenario.id,
      proposalId: proposal.id,
      gate: {
        ...gate,
        accepted: true,
        validationLevel: 'behavioral',
        appliedRef,
        reasons: gate.appliedRef
          ? gate.reasons
          : ['accepted and installed (auto-apply): firewall-clean + covers the scenario'],
      },
      applied: true,
      applyPhase: 'archived',
      notes: gate.appliedRef
        ? gate.reasons
        : ['accepted and installed (auto-apply): firewall-clean + covers the scenario'],
      behavior,
    };
  }

  private ensureInstalled(
    proposal: SkillProposal,
    scenario: SkillBenchmarkScenario,
    behavior: SkillBehaviorResult,
    intendedSha256: string,
  ):
    | { kind: 'ready'; appliedRef: string; gate: SkillGateOutcome }
    | { kind: 'conflict' }
    | { kind: 'failed'; error: string }
    | { kind: 'rejected'; gate: SkillGateOutcome } {
    const name = proposal.spec.name;
    if (!isAuthoredSkillName(name)) {
      return {
        kind: 'rejected',
        gate: {
          proposalId: proposal.id,
          scenarioId: scenario.id,
          accepted: false,
          reasons: ['not an authored skill name'],
        },
      };
    }

    const disk = this.peekInstalled(name);
    if (disk !== null && sha256Hex(disk) !== intendedSha256) {
      return { kind: 'conflict' };
    }

    const dryGate = validateSkillProposal(proposal, scenario, this.dryMutator(), {
      keepOnAccept: true,
      behavior,
    });
    if (!dryGate.accepted) {
      return { kind: 'rejected', gate: dryGate };
    }

    if (disk !== null && sha256Hex(disk) === intendedSha256) {
      return { kind: 'ready', appliedRef: dryGate.appliedRef ?? name, gate: dryGate };
    }
    if (this.mutator.has(name)) return { kind: 'conflict' };

    try {
      const gate = validateSkillProposal(proposal, scenario, this.mutator, { keepOnAccept: true, behavior });
      if (!gate.accepted || !gate.appliedRef) return { kind: 'rejected', gate };
      return { kind: 'ready', appliedRef: gate.appliedRef, gate };
    } catch (error) {
      return { kind: 'failed', error: error instanceof Error ? error.message : String(error) };
    }
  }

  private dryMutator(): SkillMutatorPort {
    const port: SkillMutatorPort = {
      create: (spec) => ({ name: spec.name }),
      remove: () => false,
      has: (name) => this.mutator.has(name),
    };
    if (this.mutator.readInstalled) {
      port.readInstalled = (name) => this.mutator.readInstalled!(name);
    }
    return port;
  }

  private peekInstalled(name: string): string | null {
    if (!isAuthoredSkillName(name)) return null;
    return this.readInstalledSkill(name);
  }

  private markConflict(
    scenarioId: string,
    proposal: SkillProposal,
    intendedSha256: string,
    behavior: SkillBehaviorResult,
    appliedRef?: string,
  ): void {
    try {
      this.applyJournal.upsert({
        scenarioId,
        proposalId: proposal.id,
        proposal,
        intendedSha256,
        phase: 'conflict',
        behavior,
        ...(appliedRef ? { appliedRef } : {}),
      });
    } catch {
      /* conflict is also represented by the on-disk mismatch */
    }
  }

  private conflictResult(
    base: { kind: 'skill_improvement_cycle'; startedAt: string; autonomy: Autonomy },
    scenario: SkillBenchmarkScenario,
    proposal: SkillProposal,
    gate: SkillGateOutcome,
    behavior: SkillBehaviorResult,
    name: string,
  ): SkillCycleResult {
    return {
      ...base,
      selectedScenarioId: scenario.id,
      proposalId: proposal.id,
      gate: { ...gate, appliedRef: gate.appliedRef ?? (this.mutator.has(name) ? name : undefined) },
      applied: false,
      applyPhase: 'conflict',
      notes: ['installed artifact differs from intended; not archived'],
      behavior,
    };
  }

}

function intendedSkillBody(proposal: SkillProposal): string {
  return ensureFrontmatter(proposal.spec.name, proposal.spec.description, proposal.spec.content);
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function savedIdentityMismatch(
  record: SkillApplyRecord,
  scenario: SkillBenchmarkScenario,
  proposal: SkillProposal,
): string | null {
  if (record.proposalId !== proposal.id) return 'pending apply proposalId does not match proposal.id';
  if (record.scenarioId !== scenario.id) return 'pending apply scenarioId does not match scenario';
  if (proposal.targetScenarioId !== scenario.id) return 'pending apply targetScenarioId does not match scenario';
  if (record.scenarioId !== proposal.targetScenarioId) {
    return 'pending apply scenarioId does not match targetScenarioId';
  }
  if (record.intendedSha256 !== sha256Hex(intendedSkillBody(proposal))) {
    return 'pending apply intendedSha256 does not match proposal artifact';
  }
  return null;
}
