import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  resetResearchWorkerFactory,
  setResearchWorkerFactory,
} from '../../src/agent/research-worker-provider.js';
import {
  WIDE_RESEARCH_CHECKPOINT_KIND,
  WIDE_RESEARCH_CHECKPOINT_VERSION,
  parseWideResearchCheckpoint,
  type WideResearchCheckpoint,
  type WideResearchCheckpointStore,
} from '../../src/agent/wide-research-checkpoint.js';
import {
  computeWideResearchDefaultOverallTimeoutMs,
  WideResearchOrchestrator,
} from '../../src/agent/wide-research.js';

const clientMocks = vi.hoisted(() => ({
  models: [] as Array<string | undefined>,
}));

vi.mock('../../src/codebuddy/client.js', () => ({
  CodeBuddyClient: class {
    constructor(_apiKey: string, model?: string) {
      clientMocks.models.push(model);
    }

    async chat(messages: Array<{ role: string; content: string }>) {
      const decomposing = messages.some((message) => message.content.includes('JSON array'));
      return {
        choices: [
          {
            message: {
              content: decomposing ? '["legacy aspect"]' : 'legacy aggregate',
            },
          },
        ],
      };
    }
  },
}));

class MemoryCheckpointStore implements WideResearchCheckpointStore {
  value: WideResearchCheckpoint | null = null;
  saves: WideResearchCheckpoint[] = [];
  assertCreatable?: (path: string) => Promise<void>;

  async load(): Promise<WideResearchCheckpoint> {
    if (!this.value) throw new Error('missing checkpoint');
    return parseWideResearchCheckpoint(JSON.stringify(this.value));
  }

  async save(_path: string, checkpoint: WideResearchCheckpoint): Promise<void> {
    const normalized = parseWideResearchCheckpoint(JSON.stringify(checkpoint));
    this.value = normalized;
    this.saves.push(normalized);
  }
}

afterEach(() => {
  clientMocks.models.length = 0;
  resetResearchWorkerFactory();
});

function durableDependencies(runWorker: (subtopic: string) => Promise<string>) {
  return {
    now: () => 1_700_000_000_000,
    decompose: vi.fn(async () => ['alpha', 'beta', 'gamma']),
    runWorker: vi.fn(async (subtopic: string) => runWorker(subtopic)),
    aggregate: vi.fn(async (_topic: string, results: Array<{ success: boolean }>) =>
      `aggregate:${results.filter((result) => result.success).length}`,
    ),
  };
}

describe('WideResearchOrchestrator durable research', () => {
  it('scales the default overall deadline with the number of worker waves', () => {
    const small = computeWideResearchDefaultOverallTimeoutMs({ items: 5, concurrency: 5 });
    const large = computeWideResearchDefaultOverallTimeoutMs({ items: 250, concurrency: 5 });

    expect(small).toBeGreaterThanOrEqual(300_000);
    expect(large).toBeGreaterThan(small);
    expect(large).toBeGreaterThan(50 * 90_000);
  });

  it('checkpoints decomposition, every settled worker, aggregation and partial failure', async () => {
    const apiKey = 'sk-never-in-checkpoint';
    const store = new MemoryCheckpointStore();
    const dependencies = durableDependencies(async (subtopic) => {
      if (subtopic === 'beta') throw new Error(`api_key=${apiKey}`);
      return `result:${subtopic}:${apiKey}`;
    });
    const orchestrator = new WideResearchOrchestrator({ workers: 3 }, dependencies);

    const result = await orchestrator.research(
      'durable topic',
      apiKey,
      { model: 'test-model', baseURL: 'https://provider.invalid/v1' },
      { checkpointPath: './run.json', checkpointStore: store },
    );

    expect(result.successCount).toBe(2);
    expect(store.saves.map((save) => save.state)).toEqual([
      'decomposed',
      'running',
      'running',
      'running',
      'running',
      'aggregating',
      'failed',
    ]);
    expect(
      store.saves
        .filter((save) => save.state === 'running')
        .map((save) => save.workerResults.length),
    ).toEqual([1, 2, 3, 3]);
    expect(store.value?.workerResults).toHaveLength(3);
    expect(JSON.stringify(store.saves)).not.toContain(apiKey);
    expect(JSON.stringify(store.saves)).not.toContain('provider.invalid');
    expect(store.value).toMatchObject({
      kind: WIDE_RESEARCH_CHECKPOINT_KIND,
      version: WIDE_RESEARCH_CHECKPOINT_VERSION,
      topic: 'durable topic',
      state: 'failed',
    });
    expect(JSON.stringify(result)).not.toContain(apiKey);
    expect(JSON.stringify(result)).toContain('[REDACTED]');
  });

  it('clamps constructor workers/rounds and pads empty decomposition to nonzero work', async () => {
    const store = new MemoryCheckpointStore();
    const dependencies = {
      ...durableDependencies(async (subtopic) => `result:${subtopic}`),
      decompose: vi.fn(async () => ['', '   ']),
    };
    const orchestrator = new WideResearchOrchestrator(
      { workers: 99.8, maxRoundsPerWorker: -4.2 },
      dependencies,
    );

    const result = await orchestrator.research('clamped topic', 'test-key', {}, {
      checkpointPath: './clamped.json',
      checkpointStore: store,
    });

    expect(result.subtopics).toHaveLength(20);
    expect(result.subtopics[0]).toBe('clamped topic - aspect 1');
    expect(result.successCount).toBe(20);
    expect(store.value?.options).toMatchObject({
      workers: 20,
      items: 20,
      concurrency: 20,
      maxRoundsPerWorker: 1,
    });
    expect(store.value?.state).toBe('completed');
  });

  it('pads short decomposition deterministically and never completes at zero workers', async () => {
    const store = new MemoryCheckpointStore();
    const dependencies = {
      ...durableDependencies(async (subtopic) => `result:${subtopic}`),
      decompose: vi.fn(async () => ['only aspect', '', '  ']),
    };

    const result = await new WideResearchOrchestrator({ workers: 3 }, dependencies).research(
      'short topic',
      'test-key',
      {},
      { checkpointPath: './short.json', checkpointStore: store },
    );

    expect(result.subtopics).toEqual([
      'only aspect',
      'short topic - aspect 1',
      'short topic - aspect 2',
    ]);
    expect(result.workerResults).toHaveLength(3);
    expect(result.successCount).toBe(3);
    expect(store.value?.state).toBe('completed');
  });

  it('separates up to 250 total items from bounded wave concurrency', async () => {
    const store = new MemoryCheckpointStore();
    let active = 0;
    let maxActive = 0;
    const dependencies = {
      now: () => 1_700_000_000_000,
      decompose: vi.fn(async () =>
        Array.from({ length: 53 }, (_, index) => `item-${index + 1}`),
      ),
      runWorker: vi.fn(async (subtopic: string) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await Promise.resolve();
        active -= 1;
        return `result:${subtopic}`;
      }),
      aggregate: vi.fn(async () => 'aggregate:53'),
    };
    const progress: Array<{ type: string; waveIndex?: number }> = [];
    const orchestrator = new WideResearchOrchestrator(
      { items: 53, concurrency: 7 },
      dependencies,
    );
    orchestrator.on('progress', (event) => progress.push(event));

    const result = await orchestrator.research('wave topic', 'test-key', {}, {
      checkpointPath: './waves.json',
      checkpointStore: store,
    });

    expect(result.subtopics).toHaveLength(53);
    expect(result.successCount).toBe(53);
    expect(maxActive).toBe(7);
    expect(progress.filter((event) => event.type === 'wave_start')).toHaveLength(8);
    expect(progress.filter((event) => event.type === 'wave_done')).toHaveLength(8);
    expect(store.value?.options).toMatchObject({ items: 53, concurrency: 7, workers: 7 });
    expect(store.value?.workerResults).toHaveLength(53);
  });

  it('synthesizes many raw reports through bounded hierarchical map/reduce prompts', async () => {
    const store = new MemoryCheckpointStore();
    const synthesisRequests: Array<{
      level: number;
      final: boolean;
      sections: Array<{ content: string; sourceIndexes: number[] }>;
    }> = [];
    let activeSyntheses = 0;
    let maxActiveSyntheses = 0;
    const rawOutput = 'complete-raw-output-' + 'x'.repeat(20_000);
    const dependencies = {
      now: () => 1_700_000_000_000,
      decompose: vi.fn(async () =>
        Array.from({ length: 25 }, (_, index) => `hierarchy-${index + 1}`),
      ),
      runWorker: vi.fn(async () => rawOutput),
      synthesize: vi.fn(async (request: {
        level: number;
        groupIndex: number;
        final: boolean;
        sections: Array<{ content: string; sourceIndexes: number[] }>;
      }) => {
        synthesisRequests.push(request);
        activeSyntheses += 1;
        maxActiveSyntheses = Math.max(maxActiveSyntheses, activeSyntheses);
        await Promise.resolve();
        activeSyntheses -= 1;
        return `summary-level-${request.level}-group-${request.groupIndex}`;
      }),
    };

    const result = await new WideResearchOrchestrator(
      { items: 25, concurrency: 3 },
      dependencies,
    ).research('hierarchical topic', 'test-key', {}, {
      checkpointPath: './hierarchical.json',
      checkpointStore: store,
    });

    expect(synthesisRequests.length).toBeGreaterThan(1);
    expect(new Set(synthesisRequests.map((request) => request.level)).size).toBeGreaterThan(1);
    expect(synthesisRequests.at(-1)?.final).toBe(true);
    expect(maxActiveSyntheses).toBeLessThanOrEqual(3);
    for (const request of synthesisRequests) {
      expect(request.sections.length).toBeGreaterThan(0);
      expect(request.sections.reduce((total, section) => total + section.content.length, 0))
        .toBeLessThanOrEqual(48_000);
    }
    expect(result.report).toContain('## Coverage manifest');
    expect(result.report).toContain('25. hierarchy-25');
    expect(result.report).toContain('synthesis input clipped');
    // Synthesis inputs may be explicitly clipped, but durable raw results are not.
    expect(store.value?.workerResults[0]?.output).toBe(rawOutput);
  });

  it('retains durable worker slots after timeout until provider work settles', async () => {
    vi.useFakeTimers();
    try {
      const store = new MemoryCheckpointStore();
      let active = 0;
      let maxActive = 0;
      const dependencies = {
        now: () => 1_700_000_000_000,
        decompose: vi.fn(async () =>
          Array.from({ length: 5 }, (_, index) => `late aspect ${index + 1}`),
        ),
        // Deliberately ignores AbortSignal to prove a timed-out Promise cannot
        // leak out of its slot or overlap a later wave.
        runWorker: vi.fn(async (subtopic: string) => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          try {
            await new Promise<void>((resolve) => setTimeout(resolve, 6_000));
            return `late:${subtopic}`;
          } finally {
            active -= 1;
          }
        }),
        aggregate: vi.fn(async () => 'fallback aggregate'),
      };
      const orchestrator = new WideResearchOrchestrator(
        { items: 5, concurrency: 2, workerTimeoutMs: 5_000 },
        dependencies,
      );
      const allSettled = vi.fn();
      orchestrator.on('timed_out_operations_settled', allSettled);

      const research = orchestrator.research('timeout topic', 'test-key', {}, {
        checkpointPath: './timeout.json',
        checkpointStore: store,
      });
      await vi.advanceTimersByTimeAsync(18_000);
      const result = await research;

      expect(result.successCount).toBe(0);
      expect(dependencies.runWorker).toHaveBeenCalledTimes(5);
      expect(maxActive).toBe(2);
      expect(active).toBe(0);
      expect(orchestrator.hasPendingTimedOutOperations()).toBe(false);
      expect(allSettled).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('drains non-durable timed-out workers before starting the next wave or returning', async () => {
    vi.useFakeTimers();
    try {
      let active = 0;
      let maxActive = 0;
      let completed = 0;
      setResearchWorkerFactory(() => ({
        async *processUserMessageStream() {
          active += 1;
          maxActive = Math.max(maxActive, active);
          try {
            await new Promise<void>((resolve) => setTimeout(resolve, 6_000));
            completed += 1;
            yield { type: 'content', content: 'late output' };
          } finally {
            active -= 1;
          }
        },
      }));
      const orchestrator = new WideResearchOrchestrator({
        items: 4,
        concurrency: 2,
        workerTimeoutMs: 5_000,
      });

      const research = orchestrator.research('non-durable timeout topic', 'test-key');
      await vi.advanceTimersByTimeAsync(12_000);
      const result = await research;

      expect(result.successCount).toBe(0);
      expect(completed).toBe(4);
      expect(maxActive).toBe(2);
      expect(active).toBe(0);
      expect(orchestrator.hasPendingTimedOutOperations()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('resumes only failed/missing workers, never successful ones, then reaggregates', async () => {
    const store = new MemoryCheckpointStore();
    const firstDependencies = durableDependencies(async (subtopic) => {
      if (subtopic === 'beta') throw new Error('temporary failure');
      return `first:${subtopic}`;
    });
    const providerConfig = { model: 'test-model', baseURL: 'http://127.0.0.1:11434/v1' };
    await new WideResearchOrchestrator({ workers: 3 }, firstDependencies).research(
      'resume topic',
      'test-key',
      providerConfig,
      { checkpointPath: './run.json', checkpointStore: store },
    );

    store.saves = [];
    const resumedWorkers: string[] = [];
    const resumeDependencies = durableDependencies(async (subtopic) => {
      resumedWorkers.push(subtopic);
      return `resumed:${subtopic}`;
    });
    const progress: string[] = [];
    const resumed = new WideResearchOrchestrator({ workers: 3 }, resumeDependencies);
    resumed.on('progress', (event: { type: string }) => progress.push(event.type));
    const result = await resumed.research('resume topic', 'test-key', providerConfig, {
      resumePath: './run.json',
      checkpointStore: store,
    });

    expect(resumedWorkers).toEqual(['beta']);
    expect(result.successCount).toBe(3);
    expect(result.report).toBe('aggregate:3');
    expect(progress[0]).toBe('resumed');
    expect(resumeDependencies.aggregate).toHaveBeenCalledTimes(1);
    expect(store.value?.workerResults.every((worker) => worker.success)).toBe(true);
  });

  it('rejects incompatible resume before any worker or aggregation runs', async () => {
    const store = new MemoryCheckpointStore();
    const dependencies = durableDependencies(async (subtopic) => `result:${subtopic}`);
    await new WideResearchOrchestrator({ workers: 3 }, dependencies).research(
      'original topic',
      'test-key',
      { model: 'test-model' },
      { checkpointPath: './run.json', checkpointStore: store },
    );

    const mismatchDependencies = durableDependencies(async () => 'must not run');
    const mismatch = new WideResearchOrchestrator({ workers: 4 }, mismatchDependencies);
    await expect(
      mismatch.research('different topic', 'test-key', { model: 'other-model' }, {
        resumePath: './run.json',
        checkpointStore: store,
      }),
    ).rejects.toMatchObject({ code: 'INCOMPATIBLE_CHECKPOINT' });
    expect(mismatchDependencies.runWorker).not.toHaveBeenCalled();
    expect(mismatchDependencies.aggregate).not.toHaveBeenCalled();
  });

  it('runs create-path preflight before decomposition or worker work', async () => {
    const dependencies = durableDependencies(async () => 'must not run');
    const store = new MemoryCheckpointStore();
    store.assertCreatable = vi.fn(async () => {
      throw new Error('checkpoint exists; use --resume');
    });
    const orchestrator = new WideResearchOrchestrator({ workers: 3 }, dependencies);

    await expect(
      orchestrator.research('topic', 'test-key', {}, {
        checkpointPath: './existing.json',
        checkpointStore: store,
      }),
    ).rejects.toThrow(/use --resume/);
    expect(dependencies.decompose).not.toHaveBeenCalled();
    expect(dependencies.runWorker).not.toHaveBeenCalled();
    expect(dependencies.aggregate).not.toHaveBeenCalled();
  });

  it('keeps the historical path isolated when durability options are absent', async () => {
    const durableOnlyDependencies = {
      decompose: vi.fn(async () => {
        throw new Error('durable decompose must not run');
      }),
      runWorker: vi.fn(async () => {
        throw new Error('durable worker must not run');
      }),
      aggregate: vi.fn(async () => {
        throw new Error('durable aggregate must not run');
      }),
    };
    setResearchWorkerFactory(() => ({
      async *processUserMessageStream() {
        yield { type: 'content', content: 'legacy worker output' };
      },
    }));
    const orchestrator = new WideResearchOrchestrator(
      { workers: 1, maxRoundsPerWorker: 1 },
      durableOnlyDependencies,
    );

    const result = await orchestrator.research('legacy topic', 'test-key');

    expect(result.subtopics).toEqual(['legacy aspect']);
    expect(result.report).toContain('legacy aggregate');
    expect(result.report).toContain('## Coverage manifest');
    expect(durableOnlyDependencies.decompose).not.toHaveBeenCalled();
    expect(durableOnlyDependencies.runWorker).not.toHaveBeenCalled();
    expect(durableOnlyDependencies.aggregate).not.toHaveBeenCalled();
  });

  it('injects additional context and gives the explicit option model priority', async () => {
    const workerConfigs: Array<{ model?: string; maxRounds: number }> = [];
    const workerQueries: string[] = [];
    setResearchWorkerFactory((config) => {
      workerConfigs.push({ model: config.model, maxRounds: config.maxRounds });
      return {
        async *processUserMessageStream(query: string) {
          workerQueries.push(query);
          yield { type: 'content', content: 'context-aware output' };
        },
      };
    });
    const orchestrator = new WideResearchOrchestrator({
      workers: 1,
      maxRoundsPerWorker: 2,
      context: 'Prioritize the private manuscript corpus.',
      model: 'option-model',
    });

    await orchestrator.research('model topic', 'test-key', {
      model: 'provider-model',
      baseURL: 'http://127.0.0.1:11434/v1',
    });

    expect(workerConfigs).toEqual([{ model: 'option-model', maxRounds: 2 }]);
    expect(workerQueries[0]).toContain('Additional research context:');
    expect(workerQueries[0]).toContain('Prioritize the private manuscript corpus.');
    expect(clientMocks.models).toEqual(['option-model', 'option-model']);
  });
});
