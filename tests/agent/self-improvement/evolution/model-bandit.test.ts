import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pickModelUCB, type BanditScoreboard } from '../../../../src/agent/self-improvement/evolution/model-bandit.js';
import { ModelScoreboard } from '../../../../src/fleet/model-scoreboard.js';
import type { LlmCandidate } from '../../../../src/fleet/model-selector.js';

/** A candidate LLM. `cost` is $/Mtok (0 = local/flat-fee → no cost penalty). */
function cand(model: string, cost = 0): LlmCandidate {
  return { provider: 'test', model, isLocal: cost === 0, costInputUsdPerMtok: cost, strengths: [] };
}

/** Feed real outcomes into a real scoreboard (no mocks) so runCount + smoothedWinRate are genuine. */
function record(sb: ModelScoreboard, model: string, wins: number, losses: number): void {
  for (let i = 0; i < wins; i++)
    sb.recordOutcome({ at: '2026-01-01T00:00:00.000Z', taskType: 'evolve', model, provider: 'test', won: true, quality: 1, costUsd: 0, latencyMs: 1 });
  for (let i = 0; i < losses; i++)
    sb.recordOutcome({ at: '2026-01-01T00:00:00.000Z', taskType: 'evolve', model, provider: 'test', won: false, quality: 0, costUsd: 0, latencyMs: 1 });
}

describe('pickModelUCB — cost-aware UCB model bandit', () => {
  let dir: string;
  let sb: ModelScoreboard;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bandit-'));
    sb = new ModelScoreboard(join(dir, 'ledger.jsonl'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('(a) explores a never-tried candidate first (runCount 0 = infinite UCB priority)', () => {
    record(sb, 'seen', 3, 0); // runCount 3
    // 'fresh' has no history → runCount 0 → must be picked to be explored.
    expect(pickModelUCB([cand('seen'), cand('fresh')], sb, {})).toBe('fresh');
  });

  it('(b) exploits the best reward when every arm has been tried equally', () => {
    record(sb, 'weak', 1, 2); // 1/3 → smoothed 0.4, n=3
    record(sb, 'strong', 3, 0); // 3/3 → smoothed 0.8, n=3 (equal n → exploration term cancels)
    expect(pickModelUCB([cand('weak'), cand('strong')], sb, {})).toBe('strong');
  });

  it('(c) the cost penalty flips the pick to a cheaper model', () => {
    record(sb, 'pricey', 3, 1); // 3/4 → smoothed 0.667, n=4
    record(sb, 'cheap', 2, 2); // 2/4 → smoothed 0.5, n=4  (equal n)
    // With no cost penalty, the higher-quality (but expensive) model wins…
    expect(pickModelUCB([cand('pricey', 10), cand('cheap', 1)], sb, { costAwareCoef: 0 })).toBe('pricey');
    // …but a real cost penalty makes the cheaper, slightly-weaker model the better bet.
    expect(pickModelUCB([cand('pricey', 10), cand('cheap', 1)], sb, { costAwareCoef: 1 })).toBe('cheap');
  });

  it('(d) the UCB exploration bonus brings back a rarely-observed candidate', () => {
    record(sb, 'veteran', 8, 0); // smoothed 0.9, n=8 (well observed)
    record(sb, 'rookie', 0, 1); // smoothed ~0.33, n=1 (barely observed)
    // c=0 → pure exploitation: the veteran's higher win rate wins.
    expect(pickModelUCB([cand('veteran'), cand('rookie')], sb, { explorationC: 0 })).toBe('veteran');
    // A strong exploration weight makes the under-sampled rookie worth another look.
    expect(pickModelUCB([cand('veteran'), cand('rookie')], sb, { explorationC: 3 })).toBe('rookie');
  });

  it('(e) no candidates → fallback, and it never throws', () => {
    expect(pickModelUCB([], sb, { fallbackModel: 'fb' })).toBe('fb');
    expect(pickModelUCB([], sb)).toBeUndefined();

    // A hostile scoreboard whose reads throw must not crash the bandit — it falls back to the first candidate.
    const hostile: BanditScoreboard = {
      smoothedWinRate: () => {
        throw new Error('boom');
      },
      runCount: () => {
        throw new Error('boom');
      },
    };
    expect(() => pickModelUCB([cand('a')], hostile, {})).not.toThrow();
    expect(pickModelUCB([cand('a')], hostile, {})).toBe('a');
  });

  it('all-$0 catalog applies no cost penalty (cheaper-tie-break still deterministic)', () => {
    // Two unseen, both $0 → equal reward + equal (infinite) exploration → lexical tie-break.
    expect(pickModelUCB([cand('zeta'), cand('alpha')], sb, {})).toBe('alpha');
  });
});
