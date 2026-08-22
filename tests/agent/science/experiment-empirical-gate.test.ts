/**
 * AI-Scientist-lite Phase 1 — empirical gate tests.
 *
 * Wires score → decide → keep-gate → archive. Load-bearing properties:
 *   - KEEP-GATE FAIL CLOSED: a keep decision that the human declines (or a gate
 *     that throws) leaves the variant ARCHIVED but NOT kept (spy: never kept).
 *   - a reject decision never even asks the keep-gate.
 *   - the variant is ALWAYS archived (auditable), kept reflects the gate.
 *   - never-throws.
 * All boundaries injected; zero LLM / execution / clock.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { applyEmpiricalScoring, type EmpiricalScoringConfig } from '../../../src/agent/science/experiment-empirical-gate.js';
import { ExperimentVariantStore } from '../../../src/agent/science/experiment-variant-store.js';
import { stdoutNumberMetric } from '../../../src/agent/science/experiment-fitness.js';
import type { ExecuteCodeResult } from '../../../src/tools/execute-code-runner.js';
import type { FitnessReport } from '../../../src/agent/self-improvement/evolution/variant-fitness.js';
import type { GateDecision } from '../../../src/agent/science/human-gate.js';

function fakeExec(stdout: string): ExecuteCodeResult {
  return {
    kind: 'execute_code_result',
    ok: true,
    runId: 'run-abc',
    language: 'python',
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:00:01.000Z',
    durationMs: 1000,
    commandPreview: 'python script.py',
    runDir: '/experiments/exp-abc',
    scriptPath: '/experiments/exp-abc/script.py',
    stdoutPath: '/experiments/exp-abc/stdout.log',
    stderrPath: '/experiments/exp-abc/stderr.log',
    resultPath: '/experiments/exp-abc/result.json',
    exitCode: 0,
    signal: null,
    timedOut: false,
    stdout,
    stderr: '',
    files: [],
  };
}

function baselineReport(score: number): FitnessReport {
  return {
    score,
    passedAll: true,
    components: [{ name: 'accuracy', weight: 1, score, passed: true, detail: `baseline ${score}` }],
    regressions: [],
  };
}

const approve = async (): Promise<GateDecision> => ({ approved: true });
const decline = async (): Promise<GateDecision> => ({ approved: false, reason: 'not now' });

let dir: string;
let store: ExperimentVariantStore;

function makeConfig(over: Partial<EmpiricalScoringConfig> = {}): EmpiricalScoringConfig {
  let counter = 0;
  return {
    parseMetric: stdoutNumberMetric('accuracy'),
    store,
    confirmKeep: vi.fn(approve),
    createId: () => `v${++counter}`,
    now: () => '2026-07-04T12:00:00.000Z',
    metricName: 'accuracy',
    ...over,
  };
}

const input = {
  hypothesis: 'focal loss improves accuracy',
  code: 'print("accuracy=0.9")',
  language: 'python' as const,
};

describe('applyEmpiricalScoring — keep path', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'exp-gate-'));
    store = new ExperimentVariantStore(join(dir, 'variants.json'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

  it('KEEPS a beating variant when the keep-gate approves + archives it kept', async () => {
    const config = makeConfig({ baseline: baselineReport(0.5), confirmKeep: vi.fn(approve) });
    const outcome = await applyEmpiricalScoring({ ...input, execution: fakeExec('accuracy=0.9') }, config);

    expect(outcome.decision.keep).toBe(true);
    expect(outcome.kept).toBe(true);
    expect(config.confirmKeep).toHaveBeenCalledOnce();
    const stored = store.list();
    expect(stored).toHaveLength(1);
    expect(stored[0]!.kept).toBe(true);
    expect(stored[0]!.metric.value).toBeCloseTo(0.9);
    expect(stored[0]!.createdAt).toBe('2026-07-04T12:00:00.000Z');
    // Stage trace.
    expect(outcome.stages.map((s) => s.stage)).toEqual(['score', 'decide', 'keep-gate']);
  });
});

describe('applyEmpiricalScoring — KEEP-GATE FAIL CLOSED', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'exp-gate-'));
    store = new ExperimentVariantStore(join(dir, 'variants.json'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

  it('a declined keep-gate leaves the variant ARCHIVED but NOT kept', async () => {
    const config = makeConfig({ baseline: baselineReport(0.5), confirmKeep: vi.fn(decline) });
    const outcome = await applyEmpiricalScoring({ ...input, execution: fakeExec('accuracy=0.9') }, config);

    expect(outcome.decision.keep).toBe(true); // the metric DID beat the baseline
    expect(outcome.kept).toBe(false); // …but the human declined → NOT kept
    const stored = store.list();
    expect(stored).toHaveLength(1); // still archived (auditable)
    expect(stored[0]!.kept).toBe(false);
  });

  it('a throwing keep-gate fails closed (not kept, still archived)', async () => {
    const config = makeConfig({
      baseline: baselineReport(0.5),
      confirmKeep: vi.fn(async () => {
        throw new Error('tty exploded');
      }),
    });
    const outcome = await applyEmpiricalScoring({ ...input, execution: fakeExec('accuracy=0.9') }, config);
    expect(outcome.kept).toBe(false);
    expect(store.list()[0]!.kept).toBe(false);
  });
});

describe('applyEmpiricalScoring — reject path', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'exp-gate-'));
    store = new ExperimentVariantStore(join(dir, 'variants.json'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

  it('a worse variant is rejected — keep-gate NEVER asked, archived not kept', async () => {
    const confirmKeep = vi.fn(approve);
    const config = makeConfig({ baseline: baselineReport(0.9), confirmKeep });
    const outcome = await applyEmpiricalScoring({ ...input, code: 'print("accuracy=0.6")', execution: fakeExec('accuracy=0.6') }, config);

    expect(outcome.decision.keep).toBe(false);
    expect(outcome.kept).toBe(false);
    // The keep-gate is the human confirmation; it must not even be shown for a reject.
    expect(confirmKeep).not.toHaveBeenCalled();
    const stored = store.list();
    expect(stored).toHaveLength(1);
    expect(stored[0]!.kept).toBe(false);
    expect(stored[0]!.regressions).toContain('accuracy');
  });
});

describe('applyEmpiricalScoring — never-throws', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'exp-gate-'));
    store = new ExperimentVariantStore(join(dir, 'variants.json'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

  it('degrades to a floor outcome when the metric parser throws', async () => {
    const config = makeConfig({
      parseMetric: () => {
        throw new Error('bad parser');
      },
    });
    const outcome = await applyEmpiricalScoring({ ...input, execution: fakeExec('accuracy=0.9') }, config);
    expect(outcome.kept).toBe(false);
    expect(outcome.fitness.score).toBe(0);
  });
});
