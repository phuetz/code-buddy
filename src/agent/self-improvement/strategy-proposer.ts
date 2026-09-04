/**
 * Strategy proposers — mutation operators over a parent strategy, driven by
 * the failures the experiences actually show. Heuristic (deterministic, $0):
 * the dominant failure key selects ONE operator; the candidate moves one step
 * inside the schema envelope. An LLM proposer can implement the same port later
 * (it would still face the same gate).
 *
 * @module agent/self-improvement/strategy-proposer
 */

import { createHash } from 'crypto';
import { parseRunFacts } from './strategy-replay.js';
import { STRATEGY_LIMITS, type StrategyProposal, type StrategySpec } from './strategy-types.js';
import type { Experience } from './types.js';

export interface StrategyProposer {
  propose(parent: StrategySpec, experiences: Experience[]): Promise<StrategyProposal | null>;
}

export const DIRECTIVES = {
  testsForTouchedFiles:
    'Before finishing, run the test files that cover every file you touched and report the exact pass/fail count; a change without that proof is not done.',
  commitPerStep:
    'Commit after each completed step, naming the files, so a later rollback can never erase proven work.',
} as const;

interface Operator {
  name: string;
  applies: (parent: StrategySpec) => boolean;
  mutate: (parent: StrategySpec) => Partial<Pick<StrategySpec, 'limits' | 'verification' | 'directives' | 'reasoning'>>;
  rationale: string;
}

const OPERATORS: Record<string, Operator> = {
  'max-rounds': {
    name: 'raise-max-tool-rounds',
    applies: (p) => p.limits.maxToolRounds < STRATEGY_LIMITS.maxToolRounds.max,
    mutate: (p) => ({
      limits: { ...p.limits, maxToolRounds: Math.min(STRATEGY_LIMITS.maxToolRounds.max, Math.ceil(p.limits.maxToolRounds * 1.5)) },
    }),
    rationale: 'runs ended on the tool-round ceiling before finishing',
  },
  'cost-cap': {
    name: 'raise-max-cost',
    applies: (p) => p.limits.maxCostUsd < STRATEGY_LIMITS.maxCostUsd.max,
    mutate: (p) => ({
      limits: { ...p.limits, maxCostUsd: Math.min(STRATEGY_LIMITS.maxCostUsd.max, Math.round(p.limits.maxCostUsd * 1.5 * 100) / 100) },
    }),
    rationale: 'runs ended on the cost cap before finishing',
  },
  unverified: {
    name: 'require-tests-for-touched-files',
    applies: (p) => !p.verification.testsForTouchedFiles,
    mutate: (p) => ({
      verification: { ...p.verification, testsForTouchedFiles: true },
      directives: addDirective(p.directives, DIRECTIVES.testsForTouchedFiles),
    }),
    rationale: 'runs claimed success without running the tests of the files they touched',
  },
  'lost-uncommitted-work': {
    name: 'require-commit-per-step',
    applies: (p) => !p.verification.commitPerStep,
    mutate: (p) => ({
      verification: { ...p.verification, commitPerStep: true },
      directives: addDirective(p.directives, DIRECTIVES.commitPerStep),
    }),
    rationale: 'proven work was lost because it was never committed',
  },
};

function addDirective(current: readonly string[], directive: string): string[] {
  if (current.includes(directive)) return [...current];
  return [...current, directive].slice(-STRATEGY_LIMITS.maxDirectives);
}

/** Count failure keys across experiences (facts only — free text never counts). */
export function dominantFailure(experiences: Experience[]): { key: string; count: number; ids: string[] } | null {
  const counts = new Map<string, string[]>();
  for (const exp of experiences) {
    const f = parseRunFacts(exp).failure;
    if (!f || !(f in OPERATORS)) continue;
    counts.set(f, [...(counts.get(f) ?? []), exp.id]);
  }
  let best: { key: string; count: number; ids: string[] } | null = null;
  for (const [key, ids] of counts) {
    if (!best || ids.length > best.count) best = { key, count: ids.length, ids };
  }
  return best;
}

export class HeuristicStrategyProposer implements StrategyProposer {
  constructor(private readonly now: () => Date = () => new Date()) {}

  async propose(parent: StrategySpec, experiences: Experience[]): Promise<StrategyProposal | null> {
    const dominant = dominantFailure(experiences);
    if (!dominant) return null;
    const operator = OPERATORS[dominant.key];
    if (!operator || !operator.applies(parent)) return null;
    const version = parent.version + 1;
    const hash = createHash('sha256').update(`${parent.id}:${operator.name}:${version}`).digest('hex').slice(0, 6);
    const id = `strat-${parent.scope}-v${version}-${hash}`;
    const candidate: StrategySpec = {
      ...parent,
      ...operator.mutate(parent),
      id,
      version,
      parentId: parent.id,
      provenance: {
        source: 'heuristic',
        experienceIds: dominant.ids.slice(0, 50),
        createdAt: this.now().toISOString(),
        operator: operator.name,
      },
    };
    return {
      id: `proposal:${id}`,
      kind: 'strategy',
      parentId: parent.id,
      candidate,
      experienceIds: dominant.ids,
      rationale: `${operator.rationale} (${dominant.count} run(s) with failure=${dominant.key})`,
    };
  }
}
