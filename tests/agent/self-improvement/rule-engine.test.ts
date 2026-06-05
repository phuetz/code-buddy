import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  RuleLearningEngine,
  HeuristicRuleProposer,
} from '../../../src/agent/self-improvement/rule-engine.js';
import {
  RuleStore,
  CorpusStore,
  SEED_TRAJECTORY_CORPUS,
  loadTrajectoryCorpus,
} from '../../../src/agent/self-improvement/rule-store.js';
import { scoreCorpus } from '../../../src/agent/self-improvement/execution-gate.js';

let dir: string;
let stamp = 0;
const now = () => new Date(Date.UTC(2026, 0, 1, 0, 0, stamp++));

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rule-engine-'));
  stamp = 0;
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('RuleLearningEngine (execution-grounded loop)', () => {
  it('auto-apply learns correct forbid rules from the corpus until fully classified', () => {
    const ruleStore = new RuleStore({ workDir: dir, now });
    const accepted: string[] = [];
    const engine = new RuleLearningEngine({
      corpus: SEED_TRAJECTORY_CORPUS,
      proposer: new HeuristicRuleProposer(),
      ruleStore,
      autonomy: 'auto-apply',
      onAccept: (p) => accepted.push(p.statement),
      now,
    });

    expect(scoreCorpus([], SEED_TRAJECTORY_CORPUS).accuracy).toBe(0.5);
    const cycles = engine.runLoop();

    const applied = cycles.filter((c) => c.applied);
    expect(applied.length).toBe(2); // forbid bash, forbid write_file
    expect(engine.status().score.accuracy).toBe(1); // corpus fully + correctly classified
    expect(ruleStore.checks()).toHaveLength(2);
    expect(ruleStore.checks().every((c) => c.kind === 'forbid_tool')).toBe(true);
    // The accepted rules are grounded statements about real recorded behavior.
    expect(accepted.some((s) => /must not call bash/.test(s))).toBe(true);
    expect(accepted.some((s) => /must not call write_file/.test(s))).toBe(true);
  });

  it('never forbids an inherently read-only tool, even with a degenerate corpus', () => {
    // A single FAIL run, no good examples — naive "tool not in good set" would
    // forbid the FIRST tool (view_file). The read-only guard forbids bash instead.
    const corpus = [
      { id: 'real-run', shouldPass: false, trajectory: { toolNames: ['view_file', 'bash'], text: 'safe run shelled out', profile: 'safe' } },
    ];
    const ruleStore = new RuleStore({ workDir: dir, now });
    const engine = new RuleLearningEngine({
      corpus,
      proposer: new HeuristicRuleProposer(),
      ruleStore,
      autonomy: 'auto-apply',
      now,
    });
    engine.runLoop();
    const rules = ruleStore.list();
    expect(rules).toHaveLength(1);
    expect(rules[0]!.statement).toMatch(/must not call bash/);
    expect(rules[0]!.statement).not.toMatch(/view_file/);
  });

  it('propose-only validates but persists no rules', () => {
    const ruleStore = new RuleStore({ workDir: dir, now });
    const engine = new RuleLearningEngine({
      corpus: SEED_TRAJECTORY_CORPUS,
      proposer: new HeuristicRuleProposer(),
      ruleStore,
      autonomy: 'propose-only',
      now,
    });
    const result = engine.runCycle();
    expect(result.gate?.accepted).toBe(true); // would correctly reclassify
    expect(result.applied).toBe(false);
    expect(ruleStore.checks()).toHaveLength(0);
  });

  it('reports "nothing to learn" once the corpus is fully classified', () => {
    const ruleStore = new RuleStore({ workDir: dir, now });
    const engine = new RuleLearningEngine({
      corpus: SEED_TRAJECTORY_CORPUS,
      proposer: new HeuristicRuleProposer(),
      ruleStore,
      autonomy: 'auto-apply',
      now,
    });
    engine.runLoop();
    const result = engine.runCycle();
    expect(result.targetId).toBeNull();
    expect(result.notes[0]).toMatch(/nothing to learn/i);
  });

  it('loadTrajectoryCorpus falls back to the seed corpus, and reads corpus.json when present', () => {
    expect(loadTrajectoryCorpus(dir)).toBe(SEED_TRAJECTORY_CORPUS);
    const file = path.join(dir, '.codebuddy', 'self-improvement', 'corpus.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({ trajectories: [{ id: 'x', shouldPass: true, trajectory: { toolNames: ['view_file'], text: 'ok' } }] }),
    );
    const loaded = loadTrajectoryCorpus(dir);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.id).toBe('x');
  });

  it('CorpusStore adds (upsert by id), lists, and removes labeled trajectories', () => {
    const store = new CorpusStore({ workDir: dir });
    expect(store.list()).toHaveLength(0);
    store.add({ id: 'run-1', shouldPass: false, trajectory: { toolNames: ['bash'], text: 'ran a command' } });
    store.add({ id: 'run-2', shouldPass: true, trajectory: { toolNames: ['view_file'], text: 'ok' } });
    expect(store.list()).toHaveLength(2);
    // upsert: re-adding run-1 replaces, not duplicates.
    store.add({ id: 'run-1', shouldPass: true, trajectory: { toolNames: ['view_file'], text: 'reclassified' } });
    expect(store.list()).toHaveLength(2);
    expect(store.list().find((t) => t.id === 'run-1')?.shouldPass).toBe(true);
    // the curated corpus is what the loop uses (overrides the seed).
    expect(loadTrajectoryCorpus(dir)).toHaveLength(2);
    expect(store.remove('run-1')).toBe(true);
    expect(store.remove('nope')).toBe(false);
    expect(store.list()).toHaveLength(1);
  });
});
