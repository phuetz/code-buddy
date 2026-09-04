import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { StrategyImprovementEngine } from '../../../src/agent/self-improvement/strategy-engine.js';
import { HeuristicStrategyProposer, dominantFailure } from '../../../src/agent/self-improvement/strategy-proposer.js';
import { parseRunFacts, replayUnder, ReplayStrategyEvaluator } from '../../../src/agent/self-improvement/strategy-replay.js';
import { StrategyStore } from '../../../src/agent/self-improvement/strategy-store.js';
import { EvolutionaryArchive } from '../../../src/agent/self-improvement/evolutionary-archive.js';
import { BASELINE_STRATEGY } from '../../../src/agent/self-improvement/strategy-types.js';
import type { Experience } from '../../../src/agent/self-improvement/types.js';

let work: string;
beforeEach(() => {
  work = path.join(os.tmpdir(), `strat-engine-${randomUUID()}`);
  fs.mkdirSync(path.join(work, '.codebuddy'), { recursive: true });
});
afterEach(() => fs.rmSync(work, { recursive: true, force: true }));

function exp(id: string, context: string, detail = 'lane run'): Experience {
  return { id, source: 'run', kind: 'delegation', detail, context };
}
/** Five lanes cut by the 50-round ceiling (as measured on 2026-09-04) + two clean successes. */
const ROUNDS_CEILING: Experience[] = [
  ...[1, 2, 3, 4, 5].map((i) => exp(`lane-${i}`, `engine=mistral rounds=50 limit=50 cost=0.4 outcome=failure failure=max-rounds`)),
  exp('lane-ok-1', 'rounds=12 cost=0.1 outcome=success'),
  exp('lane-ok-2', 'rounds=48 cost=0.3 outcome=success'),
];

describe('replay evaluator (deterministic counterfactual)', () => {
  it('parses run facts and ignores free text', () => {
    expect(parseRunFacts(exp('x', 'rounds=50 limit=50 cost=0.4 outcome=failure failure=max-rounds'))).toEqual({ rounds: 50, limit: 50, costUsd: 0.4, outcome: 'failure', failure: 'max-rounds' });
    expect(parseRunFacts(exp('y', 'the run failed because of the maximum rounds'))).toEqual({});
  });
  it('replays a max-rounds failure as a win under a higher ceiling and a success as unchanged', () => {
    const higher = { ...BASELINE_STRATEGY, limits: { maxToolRounds: 75, maxCostUsd: 10 } };
    expect(replayUnder(parseRunFacts(ROUNDS_CEILING[0]!), BASELINE_STRATEGY)?.ok).toBe(false);
    expect(replayUnder(parseRunFacts(ROUNDS_CEILING[0]!), higher)?.ok).toBe(true);
    expect(replayUnder(parseRunFacts(ROUNDS_CEILING[6]!), higher)?.ok).toBe(true);
    expect(replayUnder({}, higher)).toBeNull();
  });
  it('replays a success as a LOSS under a ceiling that would have cut it', async () => {
    const lower = { ...BASELINE_STRATEGY, limits: { maxToolRounds: 20, maxCostUsd: 10 } };
    const ev = await new ReplayStrategyEvaluator(ROUNDS_CEILING).evaluate(lower, BASELINE_STRATEGY);
    const cut = ev.observations.find((o) => o.taskId === 'lane-ok-2');
    expect(cut?.parentOk).toBe(true);
    expect(cut?.candidateOk).toBe(false);
  });
});

describe('heuristic proposer', () => {
  it('finds the dominant failure from facts only and mutates one step inside the envelope', async () => {
    expect(dominantFailure(ROUNDS_CEILING)?.key).toBe('max-rounds');
    const p = await new HeuristicStrategyProposer(() => new Date('2026-09-04T12:00:00Z')).propose(BASELINE_STRATEGY, ROUNDS_CEILING);
    expect(p).not.toBeNull();
    const c = p!.candidate as typeof BASELINE_STRATEGY;
    expect(c.limits.maxToolRounds).toBe(75);
    expect(c.version).toBe(2);
    expect(c.parentId).toBe('baseline');
    expect(c.provenance.operator).toBe('raise-max-tool-rounds');
  });
  it('proposes nothing without a failure signal', async () => {
    expect(await new HeuristicStrategyProposer().propose(BASELINE_STRATEGY, [exp('a', 'rounds=3 outcome=success')])).toBeNull();
  });
  it('adds the verification directive for unverified runs, without exceeding five directives', async () => {
    const unverified = [1, 2, 3].map((i) => exp(`u${i}`, `outcome=failure failure=unverified cost=0.2`));
    const p = await new HeuristicStrategyProposer().propose(BASELINE_STRATEGY, unverified);
    const c = p!.candidate as typeof BASELINE_STRATEGY;
    expect(c.verification.testsForTouchedFiles).toBe(true);
    expect(c.directives).toHaveLength(1);
    expect(c.directives[0]).toMatch(/tests? .*touched/i);
  });
});

describe('StrategyImprovementEngine', () => {
  it('propose-only: accepts the raise-rounds candidate on replay evidence but installs nothing', async () => {
    const store = new StrategyStore({ workDir: work });
    const engine = new StrategyImprovementEngine({ proposer: new HeuristicStrategyProposer(), store, workDir: work, autonomy: 'propose-only' });
    const r = await engine.runCycle(ROUNDS_CEILING);
    expect(r.gate?.accepted).toBe(true);
    expect(r.gate?.paired).toMatchObject({ wins: 5, losses: 0, ties: 2, evidence: 'replay' });
    expect(r.applied).toBe(false);
    expect(store.list()).toHaveLength(0);
    expect(engine.activeStrategy.id).toBe('baseline');
  });
  it('auto-apply: installs, activates, archives as kind strategy, and the next cycle descends from the child', async () => {
    const store = new StrategyStore({ workDir: work });
    const archive = new EvolutionaryArchive({ workDir: work });
    const engine = new StrategyImprovementEngine({ proposer: new HeuristicStrategyProposer(), store, archive, workDir: work, autonomy: 'auto-apply' });
    const r1 = await engine.runCycle(ROUNDS_CEILING);
    expect(r1.applied).toBe(true);
    expect(engine.activeStrategy.limits.maxToolRounds).toBe(75);
    expect(archive.list().map((e) => e.kind)).toContain('strategy');
    // Same evidence again: the lanes used 50 rounds, 75 already covers them ⇒ 113 vs 75 changes no replay ⇒ ties only ⇒ undecided.
    const r2 = await engine.runCycle(ROUNDS_CEILING);
    expect(r2.parentId).toBe(r1.gate?.appliedRef);
    expect(r2.applied).toBe(false);
    expect(r2.gate?.rejectionReason).toBe('undecided');
  });
  it('never throws when the proposer throws', async () => {
    const engine = new StrategyImprovementEngine({ proposer: { propose: async () => { throw new Error('boom'); } }, workDir: work });
    const r = await engine.runCycle(ROUNDS_CEILING);
    expect(r.applied).toBe(false);
    expect(r.notes[0]).toMatch(/proposer failed: boom/);
  });
});
