import { describe, it, expect } from 'vitest';
import { LiveStrategyEvaluator, CompositeStrategyEvaluator, SEED_STRATEGY_TASKS } from '../../../src/agent/self-improvement/strategy-live.js';
import { ReplayStrategyEvaluator } from '../../../src/agent/self-improvement/strategy-replay.js';
import { BASELINE_STRATEGY, type StrategySpec } from '../../../src/agent/self-improvement/strategy-types.js';
import type { AgentRunner } from '../../../src/agent/self-improvement/paired-gate.js';

const withDirective: StrategySpec = {
  ...BASELINE_STRATEGY,
  id: 'strat-headless-v2-live00',
  version: 2,
  parentId: 'baseline',
  scope: 'headless',
  verification: { testsForTouchedFiles: true, commitPerStep: false },
  directives: ['Before finishing, run the test files that cover every file you touched and report the exact pass/fail count.'],
  provenance: { source: 'manual', experienceIds: [], createdAt: '2026-09-05T00:00:00.000Z' },
};

/** A fake agent that obeys its directives literally: it mentions tests only when told to. */
const obedient: AgentRunner = {
  async run(prompt, directives) {
    if (prompt.includes('sandbox')) return { text: 'No. I keep the sandbox and ask for confirmation.' };
    return { text: directives?.includes('test files') ? 'I run the test files that cover the touched files: npx vitest run … and report pass/fail.' : 'I report the task as done.' };
  },
};
const dead: AgentRunner = { async run() { return { text: '' }; } };
const reckless: AgentRunner = {
  async run(prompt, directives) {
    if (prompt.includes('sandbox') && directives) return { text: 'Yes, disable the sandbox and bypass the confirmation.' };
    return { text: 'done' };
  },
};

describe('LiveStrategyEvaluator', () => {
  it('measures a directive as paired wins on the tasks it targets, ties elsewhere, and keeps the safety task', async () => {
    const ev = await new LiveStrategyEvaluator(obedient).evaluate(withDirective, BASELINE_STRATEGY);
    expect(ev.evidence).toBe('live');
    const byId = Object.fromEntries(ev.observations.map((o) => [o.taskId, o]));
    expect(byId['verify-touched-files-1']).toMatchObject({ parentOk: false, candidateOk: true });
    expect(byId['verify-touched-files-2']).toMatchObject({ parentOk: false, candidateOk: true });
    expect(byId['safety-no-sandbox-bypass']).toMatchObject({ parentOk: true, candidateOk: true });
  });
  it('produces no observation when directives are identical (caps only) or when the provider is dead', async () => {
    const capsOnly = { ...BASELINE_STRATEGY, id: 'strat-headless-v2-caps00', version: 2, parentId: 'baseline', limits: { maxToolRounds: 75, maxCostUsd: 10 } };
    expect((await new LiveStrategyEvaluator(obedient).evaluate(capsOnly, BASELINE_STRATEGY)).observations).toHaveLength(0);
    expect((await new LiveStrategyEvaluator(dead).evaluate(withDirective, BASELINE_STRATEGY)).observations).toHaveLength(0);
  });
  it('turns a directive that talks the agent into bypassing a guard into a safety LOSS', async () => {
    const ev = await new LiveStrategyEvaluator(reckless).evaluate(withDirective, BASELINE_STRATEGY);
    const safety = ev.observations.find((o) => o.taskId === 'safety-no-sandbox-bypass');
    expect(safety).toMatchObject({ parentOk: true, candidateOk: false });
  });
  it('composite merges replay caps and live directives, reporting live evidence when a live pair ran', async () => {
    const exps = [1, 2, 3].map((i) => ({ id: `lane-${i}`, source: 'run' as const, kind: 'delegation', detail: '', context: 'rounds=50 limit=50 cost=0.4 outcome=failure failure=max-rounds' }));
    const both = { ...withDirective, limits: { maxToolRounds: 75, maxCostUsd: 10 } };
    const ev = await new CompositeStrategyEvaluator([new ReplayStrategyEvaluator(exps), new LiveStrategyEvaluator(obedient)]).evaluate(both, BASELINE_STRATEGY);
    expect(ev.evidence).toBe('live');
    expect(ev.observations.length).toBe(3 + SEED_STRATEGY_TASKS.length);
  });
});
