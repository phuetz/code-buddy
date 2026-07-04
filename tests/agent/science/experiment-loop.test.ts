/**
 * AI-Scientist-lite — Phase 3: the bounded, human-bracketed BFTS loop.
 *
 * No mocks of the module under test: `runExperimentLoop` runs for real. Every
 * side-effecting boundary (ideation, mutation, authoring, execution, scoring
 * metric, the two gates, publication, and the clock/id/RNG) is INJECTED as a
 * deterministic fake, so there is zero real LLM / code execution / network /
 * wall-clock. The variant store is a REAL `ExperimentVariantStore` pointed at a
 * throwaway temp file (real disk, isolated per test — no cross-run bleed).
 *
 * Load-bearing properties proven here:
 *   - the loop chains N bounded generations with correct `parentId` lineage and
 *     `best()` surfaces the winner;
 *   - HARD CAPS stop the loop at `maxGenerations` / `maxExperiments` EVEN when
 *     the fake "always finds better" (no infinite loop);
 *   - the two human gates BRACKET the loop: no GATE #1 ⇒ nothing executed; no
 *     GATE #2 ⇒ nothing published (fail closed by default);
 *   - every execution passes through the injected sandbox boundary with
 *     `envMode:'isolate'`;
 *   - a throwing generation degrades to a floored node and the loop continues.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  runExperimentLoop,
  type ExperimentLoopDeps,
  type MutationContext,
} from '../../../src/agent/science/experiment-loop.js';
import { ExperimentVariantStore } from '../../../src/agent/science/experiment-variant-store.js';
import type {
  ExecuteCodeInput,
  ExecuteCodeResult,
  ExecuteCodeRunnerOptions,
} from '../../../src/tools/execute-code-runner.js';
import type { GateDecision, HumanGatePrompt } from '../../../src/agent/science/human-gate.js';
import type { ExperimentMetric } from '../../../src/agent/science/experiment-fitness.js';
import type { ScienceIdea } from '../../../src/agent/science/experiment-orchestrator.js';

// --------------------------------------------------------------------------
// Deterministic fakes
// --------------------------------------------------------------------------

let tmpDir: string;
let storePath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'sci-loop-'));
  storePath = join(tmpDir, 'variants.json');
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

function fakeExec(overrides: Partial<ExecuteCodeResult> = {}): ExecuteCodeResult {
  return {
    kind: 'execute_code_result',
    ok: true,
    runId: `run-${Math.random().toString(36).slice(2)}`,
    language: 'python',
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:00:01.000Z',
    durationMs: 1,
    commandPreview: 'python exp.py',
    runDir: join(tmpDir, 'exp-run'),
    scriptPath: '',
    stdoutPath: '',
    stderrPath: '',
    resultPath: '',
    exitCode: 0,
    signal: null,
    timedOut: false,
    stdout: 'accuracy=0.9',
    stderr: '',
    files: [],
    ...overrides,
  };
}

interface HarnessKnobs {
  gate1?: GateDecision;
  gate2?: GateDecision;
  /** Provide a custom executeCode; else an always-ok recorder. */
  executeCode?: (input: ExecuteCodeInput, options: ExecuteCodeRunnerOptions) => Promise<ExecuteCodeResult>;
  /** Metric score sequence generator (defaults to a strictly increasing score). */
  scoreFor?: (callIndex: number) => number;
  authorExperiment?: () => Promise<{ code: string; language: 'python' }>;
  mutate?: (ctx: MutationContext) => Promise<ScienceIdea>;
  clock?: () => number;
  random?: () => number;
}

interface Harness {
  deps: ExperimentLoopDeps;
  store: ExperimentVariantStore;
  execCalls: ExecuteCodeRunnerOptions[];
  publishCalls: number;
  gate1Prompts: HumanGatePrompt[];
  gate2Prompts: HumanGatePrompt[];
  get mutateCalls(): number;
}

function makeHarness(knobs: HarnessKnobs = {}): Harness {
  const store = new ExperimentVariantStore(storePath);
  const execCalls: ExecuteCodeRunnerOptions[] = [];
  const gate1Prompts: HumanGatePrompt[] = [];
  const gate2Prompts: HumanGatePrompt[] = [];
  let publishCalls = 0;
  let mutateCalls = 0;
  let idCounter = 0;
  let nowCounter = 0;
  let metricCounter = 0;

  const scoreFor = knobs.scoreFor ?? ((i: number) => Math.min(0.99, 0.1 + i * 0.1));

  // The underlying executor (default: always-ok). The recorder wrapper below is
  // the SINGLE place that pushes to `execCalls`, so counts are exact.
  const execute =
    knobs.executeCode ?? (async (): Promise<ExecuteCodeResult> => fakeExec());

  const deps: ExperimentLoopDeps = {
    ideate: async (goal: string): Promise<ScienceIdea> => ({ hypothesis: `H0 for ${goal}`, source: 'user' }),
    assessNovelty: async () => ({ noveltyAssessment: 'novel', evidence: [], summary: 'fresh' }),
    confirmExperiment: async (p: HumanGatePrompt): Promise<GateDecision> => {
      gate1Prompts.push(p);
      return knobs.gate1 ?? { approved: true };
    },
    authorExperiment:
      knobs.authorExperiment ?? (async () => ({ code: 'print("accuracy=0.9")', language: 'python' as const })),
    // Recorder wrapper — records the isolate options the loop set, once per call.
    executeCode: (input: ExecuteCodeInput, options: ExecuteCodeRunnerOptions) => {
      execCalls.push(options);
      return execute(input, options);
    },
    analyze: async () => ({ summary: 'looks good', findings: ['metric parsed'] }),
    report: async () => ({ report: '# Winner report\n\naccuracy improved' }),
    review: async () => ({ verdict: 'CONFIRMED', evidence: 'internally consistent' }),
    confirmPublication: async (p: HumanGatePrompt): Promise<GateDecision> => {
      gate2Prompts.push(p);
      return knobs.gate2 ?? { approved: true };
    },
    publish: async () => {
      publishCalls += 1;
    },
    mutate:
      knobs.mutate ??
      (async (ctx: MutationContext): Promise<ScienceIdea> => {
        mutateCalls += 1;
        return { hypothesis: `child-of(${ctx.parent.id.slice(0, 6)})@gen${ctx.generation}`, source: 'reasoning' };
      }),
    parseMetric: (): ExperimentMetric => {
      const s = scoreFor(metricCounter);
      metricCounter += 1;
      return { name: 'accuracy', value: s, score: s, detail: `accuracy=${s}` };
    },
    store,
    createId: () => `v${(idCounter += 1)}`,
    now: () => `2026-01-01T00:00:${String(nowCounter++).padStart(2, '0')}.000Z`,
    clock: knobs.clock ?? (() => 0),
    random: knobs.random ?? (() => 0.5),
  };

  return {
    deps,
    store,
    execCalls,
    get mutateCalls() {
      return mutateCalls;
    },
    get publishCalls() {
      return publishCalls;
    },
    gate1Prompts,
    gate2Prompts,
  } as Harness;
}

// --------------------------------------------------------------------------
// 1. Bounded chaining + lineage + best()
// --------------------------------------------------------------------------

describe('runExperimentLoop — bounded BFTS chaining', () => {
  it('chains N generations, builds a parentId lineage, and best() surfaces the winner', async () => {
    const h = makeHarness();
    const result = await runExperimentLoop('does X beat Y?', h.deps, { maxGenerations: 3, parallelism: 1 });

    // Both gates approved ⇒ published.
    expect(result.status).toBe('published');
    expect(result.published).toBe(true);
    expect(h.publishCalls).toBe(1);

    // Exactly 3 generations / 3 experiments (parallelism 1), stopped by the cap.
    expect(result.generations).toHaveLength(3);
    expect(result.budget.experimentsRun).toBe(3);
    expect(result.stopReason).toBe('max-generations');
    expect(h.execCalls).toHaveLength(3);

    // Lineage: the seed is a root; each later variant descends from the prior best.
    const tree = result.tree;
    expect(tree).toHaveLength(3);
    expect(tree[0]?.parentId).toBeUndefined(); // root/seed
    expect(tree[1]?.parentId).toBe(tree[0]?.id); // child of seed
    expect(tree[2]?.parentId).toBe(tree[1]?.id); // child of the improved best

    // best() surfaces the highest-scoring variant (strictly increasing scores).
    expect(result.best?.id).toBe(tree[2]?.id);
    // The persistent store agrees with the run-scoped winner.
    expect(h.store.best()?.id).toBe(result.best?.id);
  });
});

// --------------------------------------------------------------------------
// 2. HARD CAPS — the loop STOPS even when the fake "always finds better"
// --------------------------------------------------------------------------

describe('runExperimentLoop — hard caps stop the loop (no infinite loop)', () => {
  it('stops at maxExperiments even though every generation improves', async () => {
    const h = makeHarness(); // strictly increasing score ⇒ never converges
    const result = await runExperimentLoop('unbounded?', h.deps, {
      maxGenerations: 999,
      maxExperiments: 2,
      parallelism: 1,
    });
    expect(result.budget.experimentsRun).toBe(2);
    expect(h.execCalls).toHaveLength(2);
    expect(h.execCalls.length).toBeLessThanOrEqual(2);
    expect(result.stopReason).toBe('max-experiments');
  });

  it('stops at maxGenerations even though every generation improves', async () => {
    const h = makeHarness();
    const result = await runExperimentLoop('unbounded?', h.deps, {
      maxGenerations: 4,
      maxExperiments: 999,
      parallelism: 1,
    });
    expect(result.generations).toHaveLength(4);
    expect(h.execCalls.length).toBeLessThanOrEqual(4);
    expect(result.stopReason).toBe('max-generations');
  });

  it('caller cannot exceed the internal hard ceiling on generations', async () => {
    // Ask for 10_000 generations but the fake converges immediately would end it;
    // use always-improve + a tiny experiment cap to prove the clamp is a ceiling,
    // not that it runs 10k times.
    const h = makeHarness();
    const result = await runExperimentLoop('x', h.deps, { maxGenerations: 10_000, maxExperiments: 3 });
    expect(result.budget.maxGenerations).toBeLessThanOrEqual(100); // clamped ceiling
    expect(h.execCalls.length).toBeLessThanOrEqual(3);
  });

  it('a bounded probabilistic debug retry never exceeds maxExperiments', async () => {
    // Execution always fails; debug retries with probability 1 — must still stop
    // at the hard experiment cap (attempts count against it).
    const h = makeHarness({
      executeCode: async () => fakeExec({ ok: false, exitCode: 1 }),
      random: () => 0, // always below debugProbability
    });
    const result = await runExperimentLoop('flaky', h.deps, {
      maxGenerations: 999,
      maxExperiments: 3,
      debugProbability: 1,
      maxDebugRetries: 5,
      parallelism: 1,
    });
    expect(h.execCalls.length).toBe(3); // exactly the cap, retries included
    expect(result.budget.experimentsRun).toBe(3);
    // Nothing eligible was produced (all failed) ⇒ nothing published.
    expect(result.status).toBe('no-viable-variant');
    expect(h.publishCalls).toBe(0);
  });
});

// --------------------------------------------------------------------------
// 3. The two gates bracket the loop (fail closed)
// --------------------------------------------------------------------------

describe('runExperimentLoop — the human gates bracket the loop', () => {
  it('GATE #1 declined ⇒ the loop NEVER starts (no execution, no publication)', async () => {
    const h = makeHarness({ gate1: { approved: false, reason: 'non' } });
    const result = await runExperimentLoop('x', h.deps, { maxGenerations: 5 });

    expect(result.status).toBe('declined-at-plan-gate');
    expect(result.stopReason).toBe('plan-declined');
    // CRITICAL: no generated code was ever executed.
    expect(h.execCalls).toHaveLength(0);
    expect(h.publishCalls).toBe(0);
    expect(result.tree).toHaveLength(0);
    expect(result.generations).toHaveLength(0);
  });

  it('GATE #1 that throws fails closed ⇒ still no execution', async () => {
    const h = makeHarness();
    // Override with a throwing gate to prove resolveGate is fail-closed in the loop.
    h.deps.confirmExperiment = async () => {
      throw new Error('boom');
    };
    const result = await runExperimentLoop('x', h.deps, { maxGenerations: 5 });
    expect(result.status).toBe('declined-at-plan-gate');
    expect(h.execCalls).toHaveLength(0);
    expect(h.publishCalls).toBe(0);
  });

  it('GATE #2 declined ⇒ the loop RAN but NOTHING is published', async () => {
    const h = makeHarness({ gate2: { approved: false, reason: 'non' } });
    const result = await runExperimentLoop('x', h.deps, { maxGenerations: 2, parallelism: 1 });

    expect(result.status).toBe('declined-at-publish-gate');
    // The loop executed experiments…
    expect(h.execCalls.length).toBeGreaterThan(0);
    // …but publication was refused.
    expect(h.publishCalls).toBe(0);
    expect(result.published).toBe(false);
    // A best was still found + a report + review produced for the human to judge.
    expect(result.best).not.toBeNull();
    expect(result.report).not.toBeNull();
    expect(result.publishGate?.approved).toBe(false);
  });
});

// --------------------------------------------------------------------------
// 4. Sandbox — every execution goes through the injected boundary as 'isolate'
// --------------------------------------------------------------------------

describe('runExperimentLoop — sandboxed execution', () => {
  it('routes every experiment through executeCode with envMode:isolate', async () => {
    const h = makeHarness();
    await runExperimentLoop('x', h.deps, { maxGenerations: 3, parallelism: 1 });
    expect(h.execCalls.length).toBe(3);
    for (const opts of h.execCalls) {
      expect(opts.envMode).toBe('isolate');
      expect(typeof opts.rootDir).toBe('string');
    }
  });
});

// --------------------------------------------------------------------------
// 5. never-throws — a failing generation degrades and the loop continues
// --------------------------------------------------------------------------

describe('runExperimentLoop — never throws', () => {
  it('authoring that always throws floors every node; loop continues, no crash', async () => {
    const h = makeHarness({
      authorExperiment: async () => {
        throw new Error('authoring blew up');
      },
    });
    const result = await runExperimentLoop('x', h.deps, { maxGenerations: 3, parallelism: 1 });
    // No crash — a terminal status is returned.
    expect(['no-viable-variant', 'declined-at-publish-gate']).toContain(result.status);
    // Every recorded variant is a floored (failed) node ⇒ no eligible best.
    expect(result.best).toBeNull();
    expect(h.publishCalls).toBe(0);
    // The tree still records the attempts (honest audit).
    expect(result.tree.length).toBeGreaterThan(0);
    for (const v of result.tree) {
      expect(v.passedAll).toBe(false);
    }
  });

  it('execution that always throws is caught; loop yields a partial result', async () => {
    const h = makeHarness({
      executeCode: async () => {
        throw new Error('sandbox exploded');
      },
    });
    const result = await runExperimentLoop('x', h.deps, { maxGenerations: 2, parallelism: 1 });
    expect(result.status).toBe('no-viable-variant');
    expect(result.best).toBeNull();
    expect(h.publishCalls).toBe(0);
  });

  it('a mix where the seed fails but a later generation succeeds still yields a winner', async () => {
    let call = 0;
    const h = makeHarness({
      executeCode: async () => {
        call += 1;
        // First execution fails, subsequent succeed.
        return call === 1 ? fakeExec({ ok: false, exitCode: 1 }) : fakeExec();
      },
    });
    const result = await runExperimentLoop('x', h.deps, { maxGenerations: 3, parallelism: 1 });
    // A viable variant emerged from a later generation and was published.
    expect(result.best).not.toBeNull();
    expect(result.status).toBe('published');
    expect(h.publishCalls).toBe(1);
  });
});

// --------------------------------------------------------------------------
// 6. Parallel workers stay bounded by the caps
// --------------------------------------------------------------------------

describe('runExperimentLoop — bounded parallel workers', () => {
  it('parallelism > 1 never runs more experiments than the cap', async () => {
    const h = makeHarness();
    const result = await runExperimentLoop('x', h.deps, {
      maxGenerations: 999,
      maxExperiments: 5,
      parallelism: 3,
    });
    expect(h.execCalls.length).toBeLessThanOrEqual(5);
    expect(result.budget.experimentsRun).toBeLessThanOrEqual(5);
    expect(result.stopReason).toBe('max-experiments');
  });
});
