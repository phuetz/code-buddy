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

import {
  SagaStore,
  deriveSagaStatus,
  type SagaRecord,
} from '../../src/fleet/saga-store';
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

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'saga-store-test-'));
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

  it('returns null when loading a non-existent saga', async () => {
    const store = new SagaStore({ storeDir: tmpDir });
    expect(await store.load('saga_nope')).toBeNull();
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
    expect(result).toContain('Aggregation unavailable; raw completed results follow.');
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

  it('falls back to explicit raw concat if the LLM returns empty content', async () => {
    const fakeClient = {
      chat: vi.fn(async () => ({
        choices: [{ message: { role: 'assistant', content: '   ' }, finish_reason: 'stop' }],
      })),
    };
    wireAggregatorClient(() => fakeClient as never);
    const saga = makeSagaWithResults(['x', 'y']);
    const result = await aggregateParallelResults(saga);
    expect(result).toContain('Aggregation unavailable; raw completed results follow.');
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
    expect(result).toContain('Aggregation unavailable; raw completed results follow.');
    expect(result).toContain('Source 1');
  });
});
