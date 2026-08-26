/**
 * Concurrent-round model diversity (Fix: bandit cycles collapsing onto one model).
 *
 * `runEvolutionRound` fans out `concurrency` cycles in PARALLEL. Every cycle resolves its mutator
 * model via the UCB bandit by reading the SAME scoreboard BEFORE any cycle records its first outcome
 * (recording happens only after scoring). With an empty scoreboard every arm is `n===0`, so
 * `pickModelUCB`'s deterministic tie-break hands the SAME (cheapest) model to ALL of them — the UCB
 * "try each arm once" is defeated while cycles overlap → zero diversity across a round's candidates.
 *
 * The fix wraps the selector with a round-level in-flight tracker (`makeInFlightAwareSelector`) so the
 * concurrent batch round-robins DISTINCT models. This suite proves the bug and the fix on the exact
 * decision path `runEvolutionRound` now wires — with a REAL (empty) `ModelScoreboard`, no mocks, no
 * git — by invoking the shared selector N times exactly as the round's N synchronous `select` calls do.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  defaultEvolveSelector,
  makeInFlightAwareSelector,
} from '../../../../src/agent/self-improvement/evolution/evolution-engine.js';
import { ModelScoreboard } from '../../../../src/fleet/model-scoreboard.js';
import type { LlmCandidate } from '../../../../src/fleet/model-selector.js';

function cand(model: string, cost: number): LlmCandidate {
  return { provider: 'testprov', model, isLocal: cost === 0, costInputUsdPerMtok: cost, strengths: [] };
}

/** Distinct costs ⇒ a deterministic UCB ordering (cheapest first) on an empty scoreboard. */
const CANDS = [cand('alpha', 1), cand('bravo', 2), cand('charlie', 3)];

describe('bandit concurrency — distinct models per concurrent round', () => {
  let dir: string;
  let sb: ModelScoreboard;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bandit-conc-'));
    sb = new ModelScoreboard(join(dir, 'ledger.jsonl')); // EMPTY: every arm n===0
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

  it('THE BUG: the raw UCB selector hands the SAME model to every concurrent cycle (empty scoreboard)', () => {
    const picks = Array.from({ length: 3 }, () => defaultEvolveSelector(CANDS, sb));
    // All three "cycles" collapse onto the single cheapest unseen arm.
    expect(new Set(picks).size).toBe(1);
    expect(picks.every((p) => p === 'alpha')).toBe(true);
  });

  it('THE FIX: the in-flight-aware selector round-robins DISTINCT models across the batch', () => {
    // One shared in-flight set per round (exactly what runEvolutionRound creates), invoked once per
    // concurrent cycle — the wrapper body is synchronous, matching the round's non-interleaving selects.
    const select = makeInFlightAwareSelector(defaultEvolveSelector, new Set<string>());
    const picks = Array.from({ length: 3 }, () => select(CANDS, sb));
    expect(new Set(picks).size).toBe(3); // all distinct
    expect(new Set(picks)).toEqual(new Set(['alpha', 'bravo', 'charlie']));
  });

  it('wraps around for a fresh pass once every arm has been dispensed', () => {
    const select = makeInFlightAwareSelector(defaultEvolveSelector, new Set<string>());
    const picks = Array.from({ length: 4 }, () => select(CANDS, sb));
    expect(picks.slice(0, 3).sort()).toEqual(['alpha', 'bravo', 'charlie']); // full round
    expect(picks[3]).toBe('alpha'); // exhausted → cleared → cheapest again
  });

  it('a batch larger than the catalog cycles through all arms before repeating (2 arms, 4 cycles)', () => {
    const two = [cand('alpha', 1), cand('bravo', 2)];
    const select = makeInFlightAwareSelector(defaultEvolveSelector, new Set<string>());
    const picks = Array.from({ length: 4 }, () => select(two, sb));
    expect(picks).toEqual(['alpha', 'bravo', 'alpha', 'bravo']);
  });

  it('degrades to the base selector for an empty catalog (never throws, no phantom pick)', () => {
    const select = makeInFlightAwareSelector(defaultEvolveSelector, new Set<string>());
    expect(select([], sb)).toBeUndefined();
  });

  it('honours an injected base selector while still enforcing distinctness', () => {
    // A base that would always pick the last candidate; the in-flight wrapper still diversifies.
    const base = (cands: readonly LlmCandidate[]): string | undefined => cands[cands.length - 1]?.model;
    const select = makeInFlightAwareSelector(base, new Set<string>());
    const picks = Array.from({ length: 3 }, () => select(CANDS, sb));
    expect(new Set(picks).size).toBe(3);
  });
});
