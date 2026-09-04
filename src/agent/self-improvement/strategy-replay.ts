/**
 * Replay evaluator — a deterministic, $0 COUNTERFACTUAL on past runs.
 *
 * Every experience that carries run facts (`rounds=`, `limit=`, `cost=`,
 * `cap=`, `outcome=`, `failure=`) is replayed under the parent and under the
 * candidate: would this run have ended differently? Only the facts decide, so
 * two engines produce the same verdict. It is NECESSARY evidence, not
 * sufficient — the outcome says `evidence: 'replay'` and the live paired runner
 * remains the stronger gate. Runs without facts are ignored (never guessed).
 *
 * Failure keys understood (as produced by the delegation-log experience source
 * and the paired runner): `max-rounds`, `cost-cap`, `unverified`,
 * `lost-uncommitted-work`.
 *
 * @module agent/self-improvement/strategy-replay
 */

import type { Experience } from './types.js';
import type { StrategyEvaluator } from './strategy-gate.js';
import type { StrategyEvaluation, StrategyPairedObservation, StrategySpec } from './strategy-types.js';

export interface RunFacts {
  rounds?: number;
  limit?: number;
  costUsd?: number;
  capUsd?: number;
  outcome?: 'success' | 'failure';
  failure?: string;
}

const FACT_RE = /\b(rounds|limit|cost|cap|outcome|failure)=([a-z0-9.-]+)/gi;

/**
 * The delegation-log experience source (DGM5) writes prose, not `key=value`:
 * `Échecs nommés : Maximum tool execution rounds, Turn limit.` and `Sortie : 0.`
 * Map its NAMED failures to replay keys; only explicit markers count.
 */
const NAMED_FAILURE_KEYS: ReadonlyArray<[RegExp, string]> = [
  [/Maximum tool execution rounds|Turn limit/i, 'max-rounds'],
  [/cost (?:limit|cap) (?:reached|exceeded)|Plafond de co[uû]t/i, 'cost-cap'],
];
const NAMED_FAILURES_RE = /(?:Échecs nommés|Named failures)\s*:\s*([^\n]+)/i;
const EXIT_CODE_RE = /(?:Sortie|Exit(?: code)?)\s*:\s*(\d+)\b/i;

const KNOWN_FAILURE_KEYS = new Set(['max-rounds', 'cost-cap', 'unverified', 'lost-uncommitted-work']);

/** Extract run facts from an experience's context/detail. Tolerant; free prose never invents a fact. */
export function parseRunFacts(experience: Pick<Experience, 'context' | 'detail'>): RunFacts {
  const facts: RunFacts = {};
  const rawContext = experience.context || '';
  // Strip quoted strings from detail to prevent free-text quotes from injecting facts
  const cleanDetail = (experience.detail || '').replace(/["'«][^"'»]*["'»]/g, ' ');
  const text = `${cleanDetail}\n${rawContext}`;
  const named = NAMED_FAILURES_RE.exec(text);
  if (named) {
    for (const [re, key] of NAMED_FAILURE_KEYS) {
      if (re.test(named[1] ?? '')) {
        facts.failure = key;
        facts.outcome = 'failure';
        break;
      }
    }
  }
  const exit = EXIT_CODE_RE.exec(text);
  if (exit && facts.failure === undefined) facts.outcome = exit[1] === '0' ? 'success' : 'failure';

  // Parse structured key=value tokens from lines that are structured (context or telemetry lines)
  const lines = [
    ...rawContext.split('\n'),
    ...cleanDetail.split('\n').filter((l) => {
      const words = l.trim().split(/\s+/).filter(Boolean);
      const factWords = words.filter((w) => w.includes('='));
      const plainWords = words.filter((w) => !w.includes('='));
      if (factWords.length <= 1 && plainWords.length > 3) return false;
      return true;
    }),
  ];

  for (const line of lines) {
    for (const m of line.matchAll(FACT_RE)) {
      const key = (m[1] ?? '').toLowerCase();
      const value = m[2] ?? '';
      const num = Number(value);
      if (key === 'rounds' && Number.isFinite(num) && num >= 1 && num <= 1000) facts.rounds = num;
      else if (key === 'limit' && Number.isFinite(num) && num >= 1 && num <= 1000) facts.limit = num;
      else if (key === 'cost' && Number.isFinite(num) && num >= 0 && num <= 10000) facts.costUsd = num;
      else if (key === 'cap' && Number.isFinite(num) && num >= 0 && num <= 10000) facts.capUsd = num;
      else if (key === 'outcome' && (value === 'success' || value === 'failure')) facts.outcome = value;
      else if (key === 'failure') {
        const lower = value.toLowerCase();
        if (KNOWN_FAILURE_KEYS.has(lower)) facts.failure = lower;
      }
    }
  }
  return facts;
}

/** Would a run with these facts succeed under `spec`? null = the facts do not say. */
export function replayUnder(facts: RunFacts, spec: StrategySpec): { ok: boolean; costUsd?: number; note: string } | null {
  const rounds = facts.rounds;
  const cost = facts.costUsd;
  // A run that hit its round ceiling: it succeeds under a spec whose ceiling is higher.
  if (facts.failure === 'max-rounds' && typeof rounds === 'number') {
    const ok = spec.limits.maxToolRounds > rounds;
    const scaled = typeof cost === 'number' && rounds > 0 ? cost * Math.min(spec.limits.maxToolRounds, rounds * 2) / rounds : cost;
    return { ok, ...(typeof scaled === 'number' ? { costUsd: scaled } : {}), note: ok ? `ceiling ${spec.limits.maxToolRounds} > ${rounds} rounds used` : `ceiling ${spec.limits.maxToolRounds} ≤ ${rounds}` };
  }
  if (facts.failure === 'cost-cap' && typeof cost === 'number') {
    const ok = spec.limits.maxCostUsd > cost;
    return { ok, costUsd: ok ? Math.min(cost * 1.5, spec.limits.maxCostUsd) : cost, note: ok ? `cap ${spec.limits.maxCostUsd} > ${cost}` : `cap ${spec.limits.maxCostUsd} ≤ ${cost}` };
  }
  if (facts.failure === 'unverified') {
    const ok = spec.verification.testsForTouchedFiles;
    return { ok, ...(typeof cost === 'number' ? { costUsd: ok ? cost * 1.15 : cost } : {}), note: ok ? 'tests of touched files required' : 'no verification requirement' };
  }
  if (facts.failure === 'lost-uncommitted-work') {
    const ok = spec.verification.commitPerStep;
    return { ok, ...(typeof cost === 'number' ? { costUsd: cost } : {}), note: ok ? 'commit per step required' : 'no commit-per-step requirement' };
  }
  // A successful run: it still succeeds unless the spec would have cut it short.
  if (facts.outcome === 'success') {
    if (typeof rounds === 'number' && spec.limits.maxToolRounds < rounds) {
      return { ok: false, ...(typeof cost === 'number' ? { costUsd: cost } : {}), note: `ceiling ${spec.limits.maxToolRounds} < ${rounds} rounds needed` };
    }
    if (typeof cost === 'number' && spec.limits.maxCostUsd < cost) {
      return { ok: false, costUsd: cost, note: `cap ${spec.limits.maxCostUsd} < ${cost} spent` };
    }
    return { ok: true, ...(typeof cost === 'number' ? { costUsd: cost } : {}), note: 'unchanged' };
  }
  return null;
}

export class ReplayStrategyEvaluator implements StrategyEvaluator {
  constructor(private readonly experiences: Experience[]) {}

  async evaluate(candidate: StrategySpec, parent: StrategySpec): Promise<StrategyEvaluation> {
    const observations: StrategyPairedObservation[] = [];
    for (const exp of this.experiences) {
      const facts = parseRunFacts(exp);
      // A run cut by the round ceiling without a measured count used the ceiling IN FORCE
      // (the parent's) — the only value consistent with the failure it reports.
      if (facts.failure === 'max-rounds' && facts.rounds === undefined) {
        facts.rounds = facts.limit ?? parent.limits.maxToolRounds;
      }
      const p = replayUnder(facts, parent);
      const c = replayUnder(facts, candidate);
      if (!p || !c) continue;
      observations.push({
        taskId: exp.id,
        parentOk: p.ok,
        candidateOk: c.ok,
        ...(typeof p.costUsd === 'number' ? { parentCostUsd: p.costUsd } : {}),
        ...(typeof c.costUsd === 'number' ? { candidateCostUsd: c.costUsd } : {}),
        note: `parent: ${p.note}; candidate: ${c.note}`,
      });
    }
    return { evidence: 'replay', observations };
  }
}
