/**
 * RuleLearningEngine — wires the execution-grounded validator into a learning
 * loop. It learns behavioral RULES whose correctness is measured against real
 * recorded trajectories (does the rule flag the bad runs and pass the good ones),
 * not keyword retrievability. Accepted rules persist (structured + as a retrievable
 * RULE lesson) and are git-reversible like the rest of the learnable state.
 *
 * @module agent/self-improvement/rule-engine
 */

import {
  scoreCorpus,
  validateBehavioralRule,
  verdict,
  type BehavioralCheck,
  type BehavioralRuleProposal,
  type LabeledTrajectory,
  type ExecutionGateOutcome,
} from './execution-gate.js';
import type { RuleStore } from './rule-store.js';
import type { EvolutionaryArchive } from './evolutionary-archive.js';
import { resolveAutonomy, type Autonomy } from './engine.js';

export interface RuleProposer {
  propose(
    target: LabeledTrajectory,
    corpus: LabeledTrajectory[],
    currentRules: BehavioralCheck[],
  ): BehavioralRuleProposal | null;
}

/**
 * Tools that are inherently read-only — a rule about a read-only/safe run must
 * never forbid these (forbidding `view_file` in a "must stay read-only" rule is
 * self-evidently wrong). Guards against a degenerate corpus (e.g. a single bad
 * example with no good runs) producing an over-broad rule.
 */
const KNOWN_READ_ONLY_TOOLS = new Set([
  'view_file', 'read_file', 'list_directory', 'search', 'grep', 'glob', 'tool_search',
]);

/**
 * Deterministic proposer: for a bad run that currently slips through (should be
 * flagged but passes), forbid a tool it used that NO compliant run uses — and
 * that is not inherently read-only. A sound, minimal rule grounded in the
 * recorded behavior.
 */
export class HeuristicRuleProposer implements RuleProposer {
  propose(
    target: LabeledTrajectory,
    corpus: LabeledTrajectory[],
    currentRules: BehavioralCheck[],
  ): BehavioralRuleProposal | null {
    // Only act on a should-fail run that currently passes the rule set.
    if (target.shouldPass || !verdict(currentRules, target.trajectory)) return null;
    const goodTools = new Set(
      corpus.filter((c) => c.shouldPass).flatMap((c) => c.trajectory.toolNames),
    );
    const offending = target.trajectory.toolNames.find(
      (tool) => !goodTools.has(tool) && !KNOWN_READ_ONLY_TOOLS.has(tool),
    );
    if (!offending) return null;
    const profile = target.trajectory.profile ? `${target.trajectory.profile}-profile` : 'read-only';
    return {
      id: `rule-forbid-${offending}`,
      statement: `A ${profile} run must not call ${offending}.`,
      check: { kind: 'forbid_tool', pattern: `^${escapeRe(offending)}$` },
    };
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface RuleLearningResult {
  kind: 'rule_learning_cycle';
  startedAt: string;
  autonomy: Autonomy;
  targetId: string | null;
  proposalId: string | null;
  gate: ExecutionGateOutcome | null;
  accuracyBefore: number;
  accuracyAfter: number;
  applied: boolean;
  notes: string[];
}

export interface RuleLearningEngineOptions {
  corpus: LabeledTrajectory[];
  proposer: RuleProposer;
  ruleStore: RuleStore;
  archive?: EvolutionaryArchive;
  autonomy?: Autonomy;
  /** Side-effect on accept (e.g. also add a retrievable RULE lesson). */
  onAccept?: (proposal: BehavioralRuleProposal) => void;
  now?: () => Date;
}

export class RuleLearningEngine {
  private readonly corpus: LabeledTrajectory[];
  private readonly proposer: RuleProposer;
  private readonly ruleStore: RuleStore;
  private readonly archive?: EvolutionaryArchive;
  private readonly autonomy: Autonomy;
  private readonly onAccept?: (proposal: BehavioralRuleProposal) => void;
  private readonly now: () => Date;

  constructor(options: RuleLearningEngineOptions) {
    this.corpus = options.corpus;
    this.proposer = options.proposer;
    this.ruleStore = options.ruleStore;
    this.archive = options.archive;
    this.autonomy = options.autonomy ?? resolveAutonomy();
    this.onAccept = options.onAccept;
    this.now = options.now ?? (() => new Date());
  }

  /** First trajectory the rule set classifies wrong, preferring fixable should-fail runs. */
  private selectTarget(rules: BehavioralCheck[]): LabeledTrajectory | null {
    const misclassified = this.corpus.filter(
      (c) => verdict(rules, c.trajectory) !== c.shouldPass,
    );
    // A should-fail run that currently passes is fixable by adding a forbid rule.
    return misclassified.find((c) => !c.shouldPass) ?? misclassified[0] ?? null;
  }

  runCycle(): RuleLearningResult {
    const startedAt = this.now().toISOString();
    const rules = this.ruleStore.checks();
    const before = scoreCorpus(rules, this.corpus);
    const base = {
      kind: 'rule_learning_cycle' as const,
      startedAt,
      autonomy: this.autonomy,
      accuracyBefore: before.accuracy,
    };

    const target = this.selectTarget(rules);
    if (!target) {
      return { ...base, targetId: null, proposalId: null, gate: null, accuracyAfter: before.accuracy, applied: false, notes: ['corpus fully classified — nothing to learn'] };
    }
    const proposal = this.proposer.propose(target, this.corpus, rules);
    if (!proposal) {
      return { ...base, targetId: target.id, proposalId: null, gate: null, accuracyAfter: before.accuracy, applied: false, notes: [`no rule proposal for "${target.id}"`] };
    }
    const gate = validateBehavioralRule(proposal, rules, this.corpus);
    const applied = gate.accepted && this.autonomy === 'auto-apply';
    if (applied) {
      this.ruleStore.add(proposal.check, proposal.statement);
      this.onAccept?.(proposal);
      this.archive?.append({
        proposalId: proposal.id,
        kind: 'lesson',
        targetScenarioId: target.id,
        delta: gate.delta,
        scoreAfter: gate.accuracyAfter,
        reviewedBy: 'auto:self-improve:rule',
      });
    }
    const after = scoreCorpus(this.ruleStore.checks(), this.corpus);
    return {
      ...base,
      targetId: target.id,
      proposalId: proposal.id,
      gate,
      accuracyAfter: after.accuracy,
      applied,
      notes: gate.notes,
    };
  }

  runLoop(maxCycles = this.corpus.length + 1): RuleLearningResult[] {
    const results: RuleLearningResult[] = [];
    for (let i = 0; i < Math.max(1, maxCycles); i++) {
      const r = this.runCycle();
      results.push(r);
      if (!r.applied) break;
    }
    return results;
  }

  status(): { autonomy: Autonomy; score: ReturnType<typeof scoreCorpus>; rules: number } {
    return {
      autonomy: this.autonomy,
      score: scoreCorpus(this.ruleStore.checks(), this.corpus),
      rules: this.ruleStore.list().length,
    };
  }
}
