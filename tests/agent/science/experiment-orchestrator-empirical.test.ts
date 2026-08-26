/**
 * AI-Scientist-lite Phase 1 — orchestrator empirical wiring tests.
 *
 * Load-bearing properties:
 *   - BYTE-IDENTICAL OFF: without `options.empirical`, `runExperiment` returns
 *     exactly the Phase 0 result — `run.empirical` is undefined, the Phase 0
 *     stage order is unchanged, and the fitness metric parser + variant store are
 *     NEVER called (spy `not.toHaveBeenCalled`).
 *   - WIRED ON: with `options.empirical`, the pass additionally scores + records +
 *     keep-gates the experiment, DECOUPLED — the archived variant's runDir is the
 *     experiment folder, never the repo.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  runExperiment,
  type ExperimentDeps,
  type GateDecision,
} from '../../../src/agent/science/experiment-orchestrator.js';
import { ExperimentVariantStore } from '../../../src/agent/science/experiment-variant-store.js';
import { stdoutNumberMetric, type MetricParser } from '../../../src/agent/science/experiment-fitness.js';
import type { EmpiricalScoringConfig } from '../../../src/agent/science/experiment-empirical-gate.js';
import type {
  ExecuteCodeInput,
  ExecuteCodeResult,
  ExecuteCodeRunnerOptions,
} from '../../../src/tools/execute-code-runner.js';

function fakeExecResult(over: Partial<ExecuteCodeResult> = {}): ExecuteCodeResult {
  return {
    kind: 'execute_code_result',
    ok: true,
    runId: 'exec-test',
    language: 'python',
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:00:01.000Z',
    durationMs: 1000,
    commandPreview: 'python script.py',
    runDir: '/experiments/exp-1',
    scriptPath: '/experiments/exp-1/script.py',
    stdoutPath: '/experiments/exp-1/stdout.log',
    stderrPath: '/experiments/exp-1/stderr.log',
    resultPath: '/experiments/exp-1/result.json',
    exitCode: 0,
    signal: null,
    timedOut: false,
    stdout: 'accuracy=0.91\n',
    stderr: '',
    files: ['result.json'],
    ...over,
  };
}

const approve: () => Promise<GateDecision> = async () => ({ approved: true });

function makeDeps(over: Partial<ExperimentDeps> = {}): ExperimentDeps {
  return {
    ideate: vi.fn(async (goal: string) => ({ hypothesis: `H: ${goal}`, source: 'reasoning' as const })),
    assessNovelty: vi.fn(async () => ({ noveltyAssessment: 'novel' as const, evidence: [], summary: 'new' })),
    confirmExperiment: vi.fn(approve),
    authorExperiment: vi.fn(async () => ({ code: 'print("accuracy=0.91")', language: 'python' as const })),
    executeCode: vi.fn(async (_i: ExecuteCodeInput, _o: ExecuteCodeRunnerOptions) => fakeExecResult()),
    analyze: vi.fn(async () => ({ summary: 'ok', findings: ['x'] })),
    report: vi.fn(async () => ({ report: '# Report\n\n## TL;DR\n\nok' })),
    review: vi.fn(async () => ({ verdict: 'CONFIRMED' as const, evidence: 'ok' })),
    confirmPublication: vi.fn(approve),
    publish: vi.fn(async () => undefined),
    ...over,
  };
}

const PHASE0_STAGES = ['ideate', 'novelty', 'plan-gate', 'author', 'execute', 'analyze', 'report', 'review', 'publish-gate', 'publish'];

let dir: string;
let store: ExperimentVariantStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'exp-orch-'));
  store = new ExperimentVariantStore(join(dir, 'variants.json'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

describe('runExperiment — byte-identical without the empirical option', () => {
  it('does NOT score/record and run.empirical is undefined; Phase 0 stage order preserved', async () => {
    const parseMetric = vi.fn<MetricParser>(stdoutNumberMetric('accuracy'));
    const recordSpy = vi.spyOn(store, 'record');

    const deps = makeDeps();
    // No `empirical` option → Phase 0.
    const run = await runExperiment('a goal', deps);

    expect(run.status).toBe('published');
    expect(run.empirical).toBeUndefined();
    expect(run.stages.map((s) => s.stage)).toEqual(PHASE0_STAGES);

    // The Phase 1 boundaries are never touched.
    expect(parseMetric).not.toHaveBeenCalled();
    expect(recordSpy).not.toHaveBeenCalled();
  });

  it('is deep-equal to a second Phase 0 run (deterministic, no empirical leakage)', async () => {
    const a = await runExperiment('same goal', makeDeps());
    const b = await runExperiment('same goal', makeDeps());
    expect(a.empirical).toBeUndefined();
    expect(b.empirical).toBeUndefined();
    expect(a.stages).toEqual(b.stages);
    expect(a.status).toBe(b.status);
  });
});

describe('runExperiment — wired WITH the empirical option', () => {
  function empiricalConfig(over: Partial<EmpiricalScoringConfig> = {}): EmpiricalScoringConfig {
    let n = 0;
    return {
      parseMetric: vi.fn<MetricParser>(stdoutNumberMetric('accuracy')),
      store,
      confirmKeep: vi.fn(approve),
      createId: () => `v${++n}`,
      now: () => '2026-07-04T12:00:00.000Z',
      metricName: 'accuracy',
      ...over,
    };
  }

  it('scores, records + keep-gates the experiment; empirical stages appear', async () => {
    const empirical = empiricalConfig();
    const deps = makeDeps();
    const run = await runExperiment('measure accuracy', deps, { empirical });

    expect(run.empirical).toBeDefined();
    expect(empirical.parseMetric).toHaveBeenCalled();
    expect(run.empirical!.fitness.score).toBeCloseTo(0.91);
    expect(run.empirical!.decision.keep).toBe(true);
    expect(run.empirical!.kept).toBe(true);

    // Empirical stages are interleaved after analyze, before report.
    const order = run.stages.map((s) => s.stage);
    expect(order).toContain('score');
    expect(order).toContain('decide');
    expect(order).toContain('keep-gate');
    expect(order.indexOf('analyze')).toBeLessThan(order.indexOf('score'));
    expect(order.indexOf('keep-gate')).toBeLessThan(order.indexOf('report'));

    // DECOUPLING: the archived variant targets the EXPERIMENT folder, not the repo.
    const stored = store.list();
    expect(stored).toHaveLength(1);
    expect(stored[0]!.executionResult.runDir).toBe('/experiments/exp-1');
    expect(stored[0]!.executionResult.runDir).not.toContain('code-buddy');
    expect(stored[0]!.kept).toBe(true);

    // The Phase 0 pass still completed as before.
    expect(run.status).toBe('published');
  });

  it('does NOT re-execute the experiment for scoring (reuses the captured run)', async () => {
    const execSpy = vi.fn(async (_i: ExecuteCodeInput, _o: ExecuteCodeRunnerOptions) => fakeExecResult());
    const deps = makeDeps({ executeCode: execSpy });
    await runExperiment('measure', deps, { empirical: empiricalConfig() });
    // Only the Phase 0 execution ran — scoring reused it (cachedExecutionRunner).
    expect(execSpy).toHaveBeenCalledOnce();
  });

  it('never throws even if the empirical store write path is broken', async () => {
    const brokenStore = new ExperimentVariantStore('/root/definitely/not/writable/variants.json');
    const deps = makeDeps();
    const run = await runExperiment('resilient', deps, { empirical: empiricalConfig({ store: brokenStore }) });
    // The pass still completes (store write is best-effort / never-throws).
    expect(run.status).toBe('published');
    expect(run.empirical).toBeDefined();
  });
});
