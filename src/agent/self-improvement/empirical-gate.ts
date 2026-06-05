/**
 * Empirical gate — the safety + recursion core of the self-improvement engine.
 *
 * Inspired by the Darwin Gödel Machine: a self-modification is kept ONLY if it
 * empirically improves a benchmark and breaks nothing — but here the benchmark
 * is deterministic and cheap, so the signal is trustworthy on a small fixture
 * set. The gate snapshots state, applies the proposal, re-measures, and rolls
 * back on no-improvement / regression / policy violation. Nothing is ever kept
 * without a positive, reproducible score delta and zero regressions.
 *
 * @module agent/self-improvement/empirical-gate
 */

import { scoreBenchmark, findRegressions, type LessonSearchPort } from './capability-benchmark.js';
import type { BenchmarkScenario, GateOutcome, ImprovementProposal } from './types.js';

/** Mutator port: apply a lesson proposal and be able to revert it. */
export interface LessonMutatorPort extends LessonSearchPort {
  add(
    category: 'PATTERN' | 'RULE' | 'CONTEXT' | 'INSIGHT',
    content: string,
    context?: string,
  ): { id: string };
  remove(id: string): boolean;
}

/** Omission placeholders that must never enter a stored lesson. */
const OMISSION_RE = /\.\.\.\s*(rest|remaining|other|more|etc)\b/i;
/** Obvious secret shapes — refuse to persist these into the learnable layer. */
const SECRET_RE = /(sk-[a-z0-9]{16,}|api[_-]?key\s*[:=]\s*\S+|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i;

function structuralProblem(proposal: ImprovementProposal): string | null {
  const content = proposal.lesson.content?.trim() ?? '';
  if (content.length < 12) return 'lesson content too short to be useful';
  if (OMISSION_RE.test(content)) return 'lesson content contains an omission placeholder';
  if (SECRET_RE.test(content) || SECRET_RE.test(proposal.lesson.context ?? '')) {
    return 'lesson content looks like it contains a secret';
  }
  return null;
}

export interface GateResult {
  outcome: GateOutcome;
  /** Id of the lesson left applied (only when accepted and kept). */
  appliedRef?: string;
}

export interface ValidateOptions {
  /**
   * When true (auto-apply autonomy), an accepted proposal stays applied and its
   * lesson id is returned. When false (propose-only, the default), even an
   * accepted proposal is rolled back — the engine only REPORTS it would help.
   */
  keepOnAccept: boolean;
}

/**
 * Validate a proposal against the deterministic benchmark with snapshot/rollback.
 * Pure-ish: it mutates the lessons store transiently, but always restores it
 * unless the caller opted to keep an accepted change.
 */
export function validateProposal(
  proposal: ImprovementProposal,
  scenarios: BenchmarkScenario[],
  port: LessonMutatorPort,
  options: ValidateOptions,
): GateResult {
  const notes: string[] = [];
  const before = scoreBenchmark(scenarios, port);

  // Gate 1 — structural / policy validity (no apply on a malformed proposal).
  const structural = structuralProblem(proposal);
  if (structural) {
    return {
      outcome: {
        accepted: false,
        proposalId: proposal.id,
        scoreBefore: before.covered,
        scoreAfter: before.covered,
        delta: 0,
        regressions: [],
        rejectionReason: 'structural-invalid',
        rolledBack: false,
        notes: [structural],
      },
    };
  }

  // Apply transiently and re-measure.
  const applied = port.add(proposal.lesson.category, proposal.lesson.content, proposal.lesson.context);
  const after = scoreBenchmark(scenarios, port);
  const delta = after.covered - before.covered;
  const regressions = findRegressions(before, after);

  const rollback = (): boolean => port.remove(applied.id);

  // Gate 2 — no regression anywhere (a new lesson must not bury existing guidance).
  if (regressions.length > 0) {
    rollback();
    return {
      outcome: {
        accepted: false, proposalId: proposal.id,
        scoreBefore: before.covered, scoreAfter: after.covered, delta,
        regressions, rejectionReason: 'regression', rolledBack: true,
        notes: [`reverted: ${regressions.length} scenario(s) regressed`],
      },
    };
  }

  // Gate 3 — must empirically improve (strict positive delta).
  if (delta <= 0) {
    rollback();
    return {
      outcome: {
        accepted: false, proposalId: proposal.id,
        scoreBefore: before.covered, scoreAfter: after.covered, delta,
        regressions: [], rejectionReason: 'no-improvement', rolledBack: true,
        notes: ['reverted: no measurable improvement'],
      },
    };
  }

  // Accepted. Keep or revert based on autonomy.
  if (!options.keepOnAccept) {
    rollback();
    notes.push('accepted but reverted (propose-only): would improve, pending approval');
    return {
      outcome: {
        accepted: true, proposalId: proposal.id,
        scoreBefore: before.covered, scoreAfter: after.covered, delta,
        regressions: [], rolledBack: true, notes,
      },
    };
  }

  notes.push('accepted and kept (auto-apply): empirically validated, no regression');
  return {
    appliedRef: applied.id,
    outcome: {
      accepted: true, proposalId: proposal.id,
      scoreBefore: before.covered, scoreAfter: after.covered, delta,
      regressions: [], rolledBack: false, notes,
    },
  };
}
