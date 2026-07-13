/**
 * Fleet P4 — saga store + result aggregator tests.
 *
 * The store writes JSON files to disk; tests use a tmp dir per
 * suite so they're hermetic. The aggregator is mocked at the
 * client level — we don't make real LLM calls.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock persistent-memory so finalise()'s skill writeback hook doesn't
// touch the real user memory files during tests. Tests that exercise
// the writeback path read these mocks to assert behaviour.
type FakeMemory = {
  key: string;
  value: string;
  category?: string;
  accessCount?: number;
};
const rememberMock = vi.fn(async () => {});
const initializeMock = vi.fn(async () => {});
const getRelevantMemoriesMock = vi.fn<(query: string, limit: number) => FakeMemory[]>(
  () => [],
);
vi.mock('../../src/memory/persistent-memory.js', () => ({
  getMemoryManager: () => ({
    initialize: initializeMock,
    remember: rememberMock,
    getRelevantMemories: getRelevantMemoriesMock,
  }),
}));

import {
  SagaStore,
  deriveSagaStatus,
  loadRelevantSagaLessons,
  type SagaRecord,
} from '../../src/fleet/saga-store';
import { logger } from '../../src/utils/logger.js';
import {
  aggregateParallelResults,
  finaliseFromSingle,
  wireAggregatorClient,
  _unwireAggregatorClient,
} from '../../src/fleet/result-aggregator';
import type { DispatchPlan } from '../../src/fleet/task-router';

let tmpDir: string;

function makePlan(parallel = false): DispatchPlan {
  if (parallel) {
    return {
      primary: {
        peerId: 'p1',
        model: 'm1',
        score: 0.9,
        breakdown: { match: 1, cost: 1, load: 1, latency: 1 },
      },
      parallel: [
        {
          peerId: 'p1',
          model: 'm1',
          score: 0.9,
          breakdown: { match: 1, cost: 1, load: 1, latency: 1 },
        },
        {
          peerId: 'p2',
          model: 'm2',
          score: 0.8,
          breakdown: { match: 1, cost: 0.8, load: 1, latency: 0.8 },
        },
      ],
      rationale: 'parallel test',
    };
  }
  return {
    primary: {
      peerId: 'p1',
      model: 'm1',
      score: 0.9,
      breakdown: { match: 1, cost: 1, load: 1, latency: 1 },
    },
    fallback: {
      peerId: 'p2',
      model: 'm2',
      score: 0.7,
      breakdown: { match: 0.7, cost: 1, load: 1, latency: 0.7 },
    },
    rationale: 'sequential test',
  };
}

function makeChainPlan(): DispatchPlan {
  return {
    primary: {
      peerId: 'drafter',
      model: 'm-draft',
      score: 0.9,
      breakdown: { match: 1, cost: 1, load: 1, latency: 1 },
      role: 'code',
    },
    chain: [
      {
        peerId: 'drafter',
        model: 'm-draft',
        score: 0.9,
        breakdown: { match: 1, cost: 1, load: 1, latency: 1 },
        role: 'code',
      },
      {
        peerId: 'reviewer',
        model: 'm-review',
        score: 0.85,
        breakdown: { match: 1, cost: 0.9, load: 1, latency: 0.8 },
        role: 'review',
      },
      {
        peerId: 'tester',
        model: 'm-test',
        score: 0.8,
        breakdown: { match: 1, cost: 0.9, load: 1, latency: 0.7 },
        role: 'safe',
      },
    ],
    rationale: 'chain test',
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'saga-store-test-'));
  rememberMock.mockClear();
  initializeMock.mockClear();
  getRelevantMemoriesMock.mockClear();
  rememberMock.mockImplementation(async () => {});
  initializeMock.mockImplementation(async () => {});
  getRelevantMemoriesMock.mockImplementation(() => []);
});

afterEach(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  _unwireAggregatorClient();
});

describe('SagaStore — create + load', () => {
  it('persists a fresh saga to disk', async () => {
    const store = new SagaStore({ storeDir: tmpDir });
    const saga = await store.create({
      goal: 'test goal',
      plan: makePlan(false),
    });
    expect(saga.id).toMatch(/^saga_/);
    expect(saga.steps).toHaveLength(2); // primary + fallback
    expect(fs.existsSync(path.join(tmpDir, `${saga.id}.json`))).toBe(true);

    const reloaded = await store.load(saga.id);
    expect(reloaded?.goal).toBe('test goal');
    expect(reloaded?.steps).toHaveLength(2);
  });

  it('builds N steps for a parallel plan', async () => {
    const store = new SagaStore({ storeDir: tmpDir });
    const saga = await store.create({ goal: 'parallel', plan: makePlan(true) });
    expect(saga.steps).toHaveLength(2);
    expect(saga.steps.every((s) => s.lane === 'parallel')).toBe(true);
  });

  it('copies providers into every lane while legacy plans remain provider-less', async () => {
    const store = new SagaStore({ storeDir: tmpDir });

    const sequentialPlan = makePlan(false);
    sequentialPlan.primary.provider = 'openai';
    sequentialPlan.fallback!.provider = 'anthropic';
    const sequential = await store.create({ goal: 'sequential providers', plan: sequentialPlan });
    expect(sequential.steps.map((step) => step.provider)).toEqual(['openai', 'anthropic']);

    const parallelPlan = makePlan(true);
    parallelPlan.parallel![0]!.provider = 'ollama';
    parallelPlan.parallel![1]!.provider = 'openrouter';
    const parallel = await store.create({ goal: 'parallel providers', plan: parallelPlan });
    expect(parallel.steps.map((step) => step.provider)).toEqual(['ollama', 'openrouter']);

    const chainPlan = makeChainPlan();
    chainPlan.chain![0]!.provider = 'chatgpt-oauth';
    chainPlan.chain![1]!.provider = 'gemini';
    chainPlan.chain![2]!.provider = 'lm-studio';
    const chain = await store.create({ goal: 'chain providers', plan: chainPlan });
    expect(chain.steps.map((step) => step.provider)).toEqual([
      'chatgpt-oauth',
      'gemini',
      'lm-studio',
    ]);

    const legacy = await store.create({ goal: 'legacy provider', plan: makePlan(false) });
    expect(legacy.steps.every((step) => step.provider === undefined)).toBe(true);
    expect((await store.load(legacy.id))?.steps.every(
      (step) => step.provider === undefined,
    )).toBe(true);
  });

  it('persists secret-free attempt provenance and loads legacy JSON without attempts', async () => {
    const store = new SagaStore({ storeDir: tmpDir });
    const plan = makePlan(false);
    plan.primary.provider = 'openrouter';
    const saga = await store.create({ goal: 'durable failover', plan });

    expect(saga.steps[0]?.attempts).toEqual([]);
    await store.update(saga.id, (current) => {
      current.steps[0]?.attempts?.push({
        peerId: 'robot-brain',
        model: 'openrouter/free',
        providerRequested: 'openrouter',
        providerResolved: 'openrouter',
        runId: 'run-safe-id',
        status: 'failed',
        failureDomain: 'provider',
        startedAt: 100,
        completedAt: 125,
        error: 'HTTP 429 quota exhausted',
      });
      return current;
    });

    const reloaded = await store.load(saga.id);
    expect(reloaded?.steps[0]?.attempts).toEqual([
      expect.objectContaining({
        providerRequested: 'openrouter',
        providerResolved: 'openrouter',
        failureDomain: 'provider',
        status: 'failed',
      }),
    ]);
    expect(JSON.stringify(reloaded)).not.toContain('apiKey');

    const file = path.join(tmpDir, `${saga.id}.json`);
    const legacy = JSON.parse(fs.readFileSync(file, 'utf-8')) as SagaRecord;
    delete legacy.steps[0]!.attempts;
    fs.writeFileSync(file, JSON.stringify(legacy));
    expect((await store.load(saga.id))?.steps[0]?.attempts).toBeUndefined();
  });

  it('returns null when loading a non-existent saga', async () => {
    const store = new SagaStore({ storeDir: tmpDir });
    expect(await store.load('saga_nope')).toBeNull();
  });

  it('uses CODEBUDDY_HOME for the default saga directory', async () => {
    const previousCodeBuddyHome = process.env.CODEBUDDY_HOME;
    process.env.CODEBUDDY_HOME = tmpDir;

    try {
      const store = new SagaStore();
      const saga = await store.create({ goal: 'home scoped', plan: makePlan(false) });

      expect(fs.existsSync(path.join(tmpDir, 'sagas', `${saga.id}.json`))).toBe(true);
    } finally {
      if (previousCodeBuddyHome === undefined) {
        delete process.env.CODEBUDDY_HOME;
      } else {
        process.env.CODEBUDDY_HOME = previousCodeBuddyHome;
      }
    }
  });
});

describe('SagaStore — update + completeStep + finalise', () => {
  it('mutates and persists', async () => {
    const store = new SagaStore({ storeDir: tmpDir });
    const saga = await store.create({ goal: 'g', plan: makePlan(false) });
    const updated = await store.completeStep(saga.id, 0, 'primary result');
    expect(updated?.steps[0].status).toBe('completed');
    expect(updated?.steps[0].result).toBe('primary result');
    expect(updated?.status).toBe('completed');
  });

  it('marks saga failed when every step failed', async () => {
    const store = new SagaStore({ storeDir: tmpDir });
    const saga = await store.create({ goal: 'g', plan: makePlan(false) });
    await store.failStep(saga.id, 0, 'boom');
    const after = await store.failStep(saga.id, 1, 'also boom');
    expect(after?.status).toBe('failed');
  });

  it('marks saga completed if at least one parallel step succeeded', async () => {
    const store = new SagaStore({ storeDir: tmpDir });
    const saga = await store.create({ goal: 'g', plan: makePlan(true) });
    await store.failStep(saga.id, 0, 'boom');
    const after = await store.completeStep(saga.id, 1, 'survived');
    expect(after?.status).toBe('completed');
  });

  it('finalise() sets finalResult and completedAt', async () => {
    const store = new SagaStore({ storeDir: tmpDir });
    const saga = await store.create({ goal: 'g', plan: makePlan(true) });
    await store.completeStep(saga.id, 0, 'r1');
    await store.completeStep(saga.id, 1, 'r2');
    const finalised = await store.finalise(saga.id, 'synthesised');
    expect(finalised?.finalResult).toBe('synthesised');
    expect(finalised?.status).toBe('completed');
    expect(finalised?.completedAt).toBeTypeOf('number');
  });
});

describe('SagaStore — list + findResumable', () => {
  it('lists sagas sorted by updatedAt desc', async () => {
    const store = new SagaStore({ storeDir: tmpDir });
    const a = await store.create({ goal: 'a', plan: makePlan(false) });
    await new Promise((r) => setTimeout(r, 5));
    const b = await store.create({ goal: 'b', plan: makePlan(false) });
    const list = await store.list();
    expect(list[0].id).toBe(b.id);
    expect(list[1].id).toBe(a.id);
  });

  it('findResumable returns sagas with at least one pending step', async () => {
    const store = new SagaStore({ storeDir: tmpDir });
    const a = await store.create({ goal: 'a', plan: makePlan(false) });
    const b = await store.create({ goal: 'b', plan: makePlan(false) });
    // Fully complete b.
    await store.completeStep(b.id, 0, 'r');
    await store.completeStep(b.id, 1, 'r2');
    const resumable = await store.findResumable();
    expect(resumable.map((s) => s.id)).toEqual([a.id]);
  });
});

describe('SagaStore — delete', () => {
  it('removes the json + lock', async () => {
    const store = new SagaStore({ storeDir: tmpDir });
    const saga = await store.create({ goal: 'g', plan: makePlan(false) });
    expect(await store.delete(saga.id)).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, `${saga.id}.json`))).toBe(false);
    expect(await store.delete(saga.id)).toBe(false); // already gone
  });
});

describe('deriveSagaStatus', () => {
  it('returns running when any step is running', () => {
    const saga: SagaRecord = {
      id: 's',
      goal: '',
      plan: makePlan(false),
      steps: [
        { peerId: 'p1', model: 'm', lane: 'primary', status: 'running' },
        { peerId: 'p2', model: 'm', lane: 'fallback', status: 'pending' },
      ],
      status: 'pending',
      metadata: {},
      createdAt: 0,
      updatedAt: 0,
    };
    expect(deriveSagaStatus(saga)).toBe('running');
  });

  it('returns pending when all steps are pending', () => {
    const saga: SagaRecord = {
      id: 's',
      goal: '',
      plan: makePlan(false),
      steps: [
        { peerId: 'p1', model: 'm', lane: 'primary', status: 'pending' },
      ],
      status: 'pending',
      metadata: {},
      createdAt: 0,
      updatedAt: 0,
    };
    expect(deriveSagaStatus(saga)).toBe('pending');
  });
});

describe('loadRelevantSagaLessons (Phase F — skill recall)', () => {
  it('returns formatted lessons for fleet-saga memory entries matching the query', async () => {
    getRelevantMemoriesMock.mockImplementation(() => [
      {
        key: 'fleet-saga-saga_a1',
        value: 'Goal: fix off-by-one\n\nOutcome: added bounds check in parser',
      },
      {
        key: 'fleet-saga-saga_b2',
        value: 'Goal: refactor router\n\nOutcome: split monolith into 3 modules',
      },
    ]);
    const lessons = await loadRelevantSagaLessons('fix bug');
    expect(lessons).toHaveLength(2);
    expect(lessons[0]).toContain('off-by-one');
    expect(lessons[0]).toMatch(/^- /);
    expect(initializeMock).toHaveBeenCalled();
  });

  it('filters out non-fleet memory entries', async () => {
    getRelevantMemoriesMock.mockImplementation(() => [
      { key: 'user-preference-style', value: 'two-space indent' },
      {
        key: 'fleet-saga-only-one',
        value: 'Goal: doc update\n\nOutcome: rewrote README',
      },
      { key: 'project-decision-auth', value: 'use JWT' },
    ]);
    const lessons = await loadRelevantSagaLessons('update docs');
    expect(lessons).toHaveLength(1);
    expect(lessons[0]).toContain('doc update');
  });

  it('respects the limit option (default 3, configurable)', async () => {
    getRelevantMemoriesMock.mockImplementation(() =>
      Array.from({ length: 6 }, (_, i) => ({
        key: `fleet-saga-${i}`,
        value: `Goal: g${i}\n\nOutcome: o${i}`,
      })),
    );
    const lessons = await loadRelevantSagaLessons('anything');
    expect(lessons).toHaveLength(3);
    const fewer = await loadRelevantSagaLessons('anything', { limit: 1 });
    expect(fewer).toHaveLength(1);
  });

  it('truncates long values to 300 chars with ellipsis', async () => {
    const longValue = `Goal: x\n\nOutcome: ${'A'.repeat(1000)}`;
    getRelevantMemoriesMock.mockImplementation(() => [
      { key: 'fleet-saga-long', value: longValue },
    ]);
    const [lesson] = await loadRelevantSagaLessons('x');
    expect(lesson.length).toBeLessThanOrEqual('- '.length + 300);
    expect(lesson.endsWith('...')).toBe(true);
  });

  it('returns [] (no throw) when memory module rejects', async () => {
    getRelevantMemoriesMock.mockImplementation(() => {
      throw new Error('memory file corrupt');
    });
    const lessons = await loadRelevantSagaLessons('anything');
    expect(lessons).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('loadRelevantSagaLessons failed'),
      expect.any(Object),
    );
  });

  it('returns [] when initialize rejects', async () => {
    initializeMock.mockImplementation(async () => {
      throw new Error('init blocked');
    });
    const lessons = await loadRelevantSagaLessons('anything');
    expect(lessons).toEqual([]);
  });
});

describe('SagaStore — finalise() skill writeback (Phase E)', () => {
  it('appends a lesson to persistent memory on successful finalise', async () => {
    const store = new SagaStore({ storeDir: tmpDir });
    const saga = await store.create({ goal: 'g', plan: makePlan(true) });
    await store.completeStep(saga.id, 0, 'r1');
    await store.completeStep(saga.id, 1, 'r2');
    await store.finalise(saga.id, 'synthesised answer');
    expect(initializeMock).toHaveBeenCalled();
    expect(rememberMock).toHaveBeenCalledWith(
      `fleet-saga-${saga.id}`,
      expect.stringContaining('synthesised answer'),
      expect.objectContaining({ scope: 'project', category: 'context' }),
    );
  });

  it('warning-only: saga still finalises when memory writeback throws', async () => {
    rememberMock.mockImplementationOnce(async () => {
      throw new Error('memory file locked');
    });
    const store = new SagaStore({ storeDir: tmpDir });
    const saga = await store.create({ goal: 'g', plan: makePlan(true) });
    await store.completeStep(saga.id, 0, 'r1');
    await store.completeStep(saga.id, 1, 'r2');
    const finalised = await store.finalise(saga.id, 'still works');
    expect(finalised?.status).toBe('completed');
    expect(finalised?.finalResult).toBe('still works');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('skill writeback failed'),
      expect.objectContaining({ sagaId: saga.id }),
    );
  });

  it('truncates the outcome to 500 chars to keep memory entries scannable', async () => {
    const store = new SagaStore({ storeDir: tmpDir });
    const saga = await store.create({ goal: 'g', plan: makePlan(true) });
    await store.completeStep(saga.id, 0, 'r1');
    await store.completeStep(saga.id, 1, 'r2');
    const longResult = 'X'.repeat(2000);
    await store.finalise(saga.id, longResult);
    const captured = rememberMock.mock.calls[0]?.[1] as string;
    // Goal + "Outcome: " prefix + up to 500 chars of result.
    expect(captured.length).toBeLessThanOrEqual('Goal: g\n\nOutcome: '.length + 500);
    expect(captured).toContain('X'.repeat(500));
    expect(captured).not.toContain('X'.repeat(501));
  });
});

describe('SagaStore — chain mode (Hermes-style sequential collab)', () => {
  it('builds chain steps with role + dependsOn metadata', async () => {
    const store = new SagaStore({ storeDir: tmpDir });
    const saga = await store.create({ goal: 'chain', plan: makeChainPlan() });
    expect(saga.steps).toHaveLength(3);
    expect(saga.steps.every((s) => s.lane === 'chain')).toBe(true);
    expect(saga.steps[0].role).toBe('code');
    expect(saga.steps[1].role).toBe('review');
    expect(saga.steps[2].role).toBe('safe');
    expect(saga.steps[0].dependsOn).toBeUndefined();
    expect(saga.steps[1].dependsOn).toBe(0);
    expect(saga.steps[2].dependsOn).toBe(1);
    expect(saga.steps.every((s) => s.status === 'pending')).toBe(true);
  });

  it('advanceChain flips step 0 to running when no predecessor', async () => {
    const store = new SagaStore({ storeDir: tmpDir });
    const saga = await store.create({ goal: 'chain', plan: makeChainPlan() });
    const advanced = await store.advanceChain(saga.id);
    expect(advanced?.steps[0].status).toBe('running');
    expect(advanced?.steps[0].startedAt).toBeTypeOf('number');
    expect(advanced?.steps[1].status).toBe('pending');
    expect(advanced?.status).toBe('running');
  });

  it('advanceChain refuses to flip step 1 until step 0 completes', async () => {
    const store = new SagaStore({ storeDir: tmpDir });
    const saga = await store.create({ goal: 'chain', plan: makeChainPlan() });
    await store.advanceChain(saga.id); // step 0 → running
    const stillPending = await store.advanceChain(saga.id);
    // Step 0 already running, step 1 still blocked.
    expect(stillPending?.steps[0].status).toBe('running');
    expect(stillPending?.steps[1].status).toBe('pending');
  });

  it('advanceChain promotes step 1 once step 0 is completed', async () => {
    const store = new SagaStore({ storeDir: tmpDir });
    const saga = await store.create({ goal: 'chain', plan: makeChainPlan() });
    await store.advanceChain(saga.id);
    await store.completeStep(saga.id, 0, 'drafted');
    const advanced = await store.advanceChain(saga.id);
    expect(advanced?.steps[1].status).toBe('running');
    expect(advanced?.steps[0].result).toBe('drafted');
    expect(advanced?.status).toBe('running');
  });

  it('chain saga is completed only when the LAST step finishes', async () => {
    const store = new SagaStore({ storeDir: tmpDir });
    const saga = await store.create({ goal: 'chain', plan: makeChainPlan() });
    await store.advanceChain(saga.id);
    await store.completeStep(saga.id, 0, 'r0');
    // After step 0 completes, status should still be running (chain advancing).
    const mid = await store.load(saga.id);
    expect(mid?.status).toBe('running');
    await store.advanceChain(saga.id);
    await store.completeStep(saga.id, 1, 'r1');
    await store.advanceChain(saga.id);
    const final = await store.completeStep(saga.id, 2, 'r2');
    expect(final?.status).toBe('completed');
  });

  it('chain saga fails when any step fails (chain breaks)', async () => {
    const store = new SagaStore({ storeDir: tmpDir });
    const saga = await store.create({ goal: 'chain', plan: makeChainPlan() });
    await store.advanceChain(saga.id);
    const failed = await store.failStep(saga.id, 0, 'review-rejected');
    expect(failed?.status).toBe('failed');
    // advanceChain after a failure finds no eligible step.
    const after = await store.advanceChain(saga.id);
    expect(after?.steps[1].status).toBe('pending');
    expect(after?.status).toBe('failed');
  });
});

describe('Aggregator — finaliseFromSingle', () => {
  it('returns primary result when primary completed', () => {
    const saga: SagaRecord = {
      id: 's',
      goal: '',
      plan: makePlan(false),
      steps: [
        { peerId: 'p1', model: 'm', lane: 'primary', status: 'completed', result: 'r1' },
      ],
      status: 'completed',
      metadata: {},
      createdAt: 0,
      updatedAt: 0,
    };
    expect(finaliseFromSingle(saga)).toBe('r1');
  });

  it('falls back to fallback when primary failed', () => {
    const saga: SagaRecord = {
      id: 's',
      goal: '',
      plan: makePlan(false),
      steps: [
        { peerId: 'p1', model: 'm', lane: 'primary', status: 'failed', error: 'boom' },
        { peerId: 'p2', model: 'm', lane: 'fallback', status: 'completed', result: 'r2' },
      ],
      status: 'completed',
      metadata: {},
      createdAt: 0,
      updatedAt: 0,
    };
    expect(finaliseFromSingle(saga)).toBe('r2');
  });

  it('returns null when nothing succeeded', () => {
    const saga: SagaRecord = {
      id: 's',
      goal: '',
      plan: makePlan(false),
      steps: [
        { peerId: 'p1', model: 'm', lane: 'primary', status: 'failed', error: 'b' },
      ],
      status: 'failed',
      metadata: {},
      createdAt: 0,
      updatedAt: 0,
    };
    expect(finaliseFromSingle(saga)).toBeNull();
  });
});

describe('Aggregator — aggregateParallelResults', () => {
  function makeSagaWithResults(results: string[]): SagaRecord {
    const steps = results.map((r, i) => ({
      peerId: `p${i + 1}`,
      model: `m${i + 1}`,
      lane: 'parallel' as const,
      status: 'completed' as const,
      result: r,
    }));
    return {
      id: 's',
      goal: 'test goal',
      plan: makePlan(true),
      steps,
      status: 'completed',
      metadata: {},
      createdAt: 0,
      updatedAt: 0,
    };
  }

  it('returns single result when only one step completed', async () => {
    const saga = makeSagaWithResults(['only one']);
    const result = await aggregateParallelResults(saga);
    expect(result).toBe('only one');
  });

  it('throws when no completed steps', async () => {
    const saga = makeSagaWithResults([]);
    saga.steps = [];
    await expect(aggregateParallelResults(saga)).rejects.toThrow(/no completed/);
  });

  it('falls back to concatenation when no client is wired', async () => {
    const saga = makeSagaWithResults(['answer A', 'answer B']);
    const result = await aggregateParallelResults(saga);
    expect(result).toContain('answer A');
    expect(result).toContain('answer B');
    expect(result).toContain('Source 1');
  });

  it('uses the wired LLM client to synthesise', async () => {
    const fakeClient = {
      chat: vi.fn(async () => ({
        choices: [
          {
            message: { role: 'assistant', content: 'synthesised answer' },
            finish_reason: 'stop',
          },
        ],
      })),
    } as unknown as Parameters<typeof wireAggregatorClient>[0] extends () => infer R
      ? R
      : never;
    wireAggregatorClient(() => fakeClient);
    const saga = makeSagaWithResults(['A', 'B', 'C']);
    const result = await aggregateParallelResults(saga);
    expect(result).toBe('synthesised answer');
    expect((fakeClient as unknown as { chat: ReturnType<typeof vi.fn> }).chat).toHaveBeenCalledTimes(1);
  });

  it('falls back to concat if the LLM returns empty content', async () => {
    const fakeClient = {
      chat: vi.fn(async () => ({
        choices: [{ message: { role: 'assistant', content: '' }, finish_reason: 'stop' }],
      })),
    };
    wireAggregatorClient(() => fakeClient as never);
    const saga = makeSagaWithResults(['x', 'y']);
    const result = await aggregateParallelResults(saga);
    expect(result).toContain('Source 1');
  });

  it('falls back to concat if the LLM throws', async () => {
    const fakeClient = {
      chat: vi.fn(async () => {
        throw new Error('rate limit');
      }),
    };
    wireAggregatorClient(() => fakeClient as never);
    const saga = makeSagaWithResults(['x', 'y']);
    const result = await aggregateParallelResults(saga);
    expect(result).toContain('Source 1');
  });
});

describe('SagaStore — crash-leaked staging temp files', () => {
  it('atomic write leaves no .tmp file behind on success', async () => {
    const store = new SagaStore({ storeDir: tmpDir });
    const saga = await store.create({ goal: 'g', plan: makePlan(false) });
    await store.completeStep(saga.id, 0, 'done');
    const leftovers = fs.readdirSync(tmpDir).filter((f) => f.includes('.tmp.'));
    expect(leftovers).toEqual([]);
  });

  it('list() sweeps orphaned .tmp.* files (crash between write and rename) and ignores them as sagas', async () => {
    const store = new SagaStore({ storeDir: tmpDir });
    const saga = await store.create({ goal: 'g', plan: makePlan(false) });
    // Simulate a crash-leaked staging file (both the legacy pid-only and the
    // new pid.random shapes).
    const orphanA = path.join(tmpDir, `${saga.id}.json.tmp.99999`);
    const orphanB = path.join(tmpDir, `${saga.id}.json.tmp.99999.deadbeef`);
    fs.writeFileSync(orphanA, '{"partial":');
    fs.writeFileSync(orphanB, '{"partial":');

    const listed = await store.list();

    expect(listed.map((s) => s.id)).toEqual([saga.id]); // the temp files are NOT parsed as sagas
    expect(fs.existsSync(orphanA)).toBe(false); // swept
    expect(fs.existsSync(orphanB)).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, `${saga.id}.json`))).toBe(true); // real saga untouched
  });

  it('delete() removes the saga, its lock, and any leaked temps for that id', async () => {
    const store = new SagaStore({ storeDir: tmpDir });
    const saga = await store.create({ goal: 'g', plan: makePlan(false) });
    const orphan = path.join(tmpDir, `${saga.id}.json.tmp.12345.cafebabe`);
    fs.writeFileSync(orphan, '{"partial":');

    const deleted = await store.delete(saga.id);

    expect(deleted).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, `${saga.id}.json`))).toBe(false);
    expect(fs.existsSync(orphan)).toBe(false);
  });
});
