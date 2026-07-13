/**
 * Wide Research Mode (Manus AI-inspired)
 *
 * Spawns N parallel sub-agent workers, each handling an independent
 * sub-topic, then aggregates results into a comprehensive report.
 *
 * Architecture:
 *   WideResearchOrchestrator
 *       |
 *       +-- decompose(topic) → string[]   (subtopics via LLM)
 *       |
 *       +-- worker[0..N-1]                (CodeBuddyAgent instances)
 *       |       each: "Research: <subtopic>"
 *       |
 *       +-- aggregate(results) → string   (synthesize via LLM)
 *
 * Each worker gets its own fresh message history and runs concurrently.
 * Results are streamed back via an AsyncGenerator for live progress.
 *
 * Unlike the full multi-agent orchestrator, Wide Research is intentionally
 * flat: workers cannot spawn their own sub-workers. All decomposition
 * happens at the orchestrator level (same pattern as Native Engine's current
 * flat subagent design).
 */

import { EventEmitter } from 'events';
import type { ToolResult } from '../types/index.js';
import { getResearchWorkerFactory } from './research-worker-provider.js';
import type {
  DeepResearchLoopOptions,
  DeepResearchLoopResult,
  DeepResearchResult,
  DeepResearchBoundaries,
  DeepResearchStage,
  DeepLlmMessage,
  SearchHit,
} from './deep-research.js';
import type {
  StormBoundaries,
  StormResearchOptions,
  StormResearchResult,
  StormStage,
  StormProgress,
} from './deep-research-storm.js';
import type { CkgBridge, CkgRunOptions } from './deep-research-ckg.js';
import {
  assertWideResearchCheckpointCompatible,
  createWideResearchExecutionFingerprint,
  FileWideResearchCheckpointStore,
  redactWideResearchCheckpointResults,
  redactWideResearchResult,
  resolveWideResearchCheckpointPath,
  WIDE_RESEARCH_CHECKPOINT_KIND,
  WIDE_RESEARCH_CHECKPOINT_VERSION,
  WideResearchCheckpointError,
  type WideResearchCheckpoint,
  type WideResearchCheckpointOptions,
  type WideResearchCheckpointStore,
} from './wide-research-checkpoint.js';

// ============================================================================
// Types
// ============================================================================

export interface WideResearchOptions {
  /**
   * Backward-compatible shorthand. When `items`/`concurrency` are absent it
   * sets both (historical max: 20). Prefer the two explicit options below.
   */
  workers?: number;
  /** Total independent research items to cover (default: 5, max: 250). */
  items?: number;
  /** Maximum items executed simultaneously (default: 5, max: 20). */
  concurrency?: number;
  /** Max tool rounds per worker (default: 15) */
  maxRoundsPerWorker?: number;
  /** Whether to stream partial results as workers finish */
  stream?: boolean;
  /** Additional context injected into each worker's system prompt */
  context?: string;
  /** LLM model for workers (defaults to current agent model) */
  model?: string;
  /** Per-worker timeout in milliseconds (default: 90000) */
  workerTimeoutMs?: number;
  /** Overall research timeout in milliseconds (default: 300000) */
  overallTimeoutMs?: number;
  /** Timeout for decomposition phase in milliseconds (default: 45000) */
  decomposeTimeoutMs?: number;
  /** Timeout for aggregation phase in milliseconds (default: 60000) */
  aggregateTimeoutMs?: number;
}

export interface ResearchWorkerResult {
  subtopic: string;
  workerIndex: number;
  /** Raw research output from the worker */
  output: string;
  /** Whether the worker completed successfully */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Duration in ms */
  durationMs: number;
}

export interface WideResearchResult {
  topic: string;
  subtopics: string[];
  workerResults: ResearchWorkerResult[];
  /** Synthesized final report */
  report: string;
  /** Total wall-clock duration */
  durationMs: number;
  /** Number of workers that succeeded */
  successCount: number;
}

export interface WideResearchDurabilityOptions {
  /** Create/update this checkpoint during a new research run. */
  checkpointPath?: string;
  /** Resume this checkpoint and update it in place. */
  resumePath?: string;
  /** Injectable persistence boundary for deterministic tests. */
  checkpointStore?: WideResearchCheckpointStore;
}

export interface WideResearchDependencies {
  now?: () => number;
  decompose?: (
    topic: string,
    apiKey: string,
    providerConfig?: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<string[]>;
  runWorker?: (
    subtopic: string,
    parentTopic: string,
    workerIndex: number,
    apiKey: string,
    providerConfig?: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<string>;
  aggregate?: (
    topic: string,
    results: ResearchWorkerResult[],
    apiKey: string,
    providerConfig?: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<string>;
  /** Injectable map/reduce synthesis boundary used by focused tests/providers. */
  synthesize?: (
    request: WideResearchSynthesisRequest,
    apiKey: string,
    providerConfig?: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<string>;
}

export interface WideResearchSynthesisSection {
  label: string;
  content: string;
  sourceIndexes: number[];
}

export interface WideResearchSynthesisRequest {
  topic: string;
  level: number;
  groupIndex: number;
  groupCount: number;
  final: boolean;
  sections: WideResearchSynthesisSection[];
}

export type WideResearchProgress =
  | { type: 'decomposed'; subtopics: string[] }
  | { type: 'resumed'; checkpointPath: string; successCount: number; pendingCount: number }
  | { type: 'wave_start'; waveIndex: number; waveCount: number; itemCount: number }
  | { type: 'wave_done'; waveIndex: number; waveCount: number; completedCount: number }
  | { type: 'worker_start'; workerIndex: number; subtopic: string }
  | { type: 'worker_done'; workerIndex: number; subtopic: string; success: boolean }
  | { type: 'aggregating' }
  | { type: 'done'; result: WideResearchResult };

/** Progress events emitted by the opt-in Deep Research path (distinct channel). */
export type DeepResearchProgress = { type: 'deep' } & DeepResearchStage;

function clampInteger(value: number | undefined, fallback: number, minimum: number, maximum?: number): number {
  const normalized = Number.isFinite(value) ? Math.floor(value as number) : fallback;
  return Math.max(minimum, maximum === undefined ? normalized : Math.min(maximum, normalized));
}

const SYNTHESIS_FAN_IN = 8;
const SYNTHESIS_GROUP_CHAR_BUDGET = 48_000;
const SYNTHESIS_NODE_CHAR_BUDGET = 16_000;

export function estimateWideResearchSynthesisWaves(
  items: number,
  concurrency: number,
): number {
  let nodes = clampInteger(items, 1, 1, 250);
  const width = Math.min(nodes, clampInteger(concurrency, 1, 1, 20));
  let waves = 0;
  do {
    const groups = Math.ceil(nodes / SYNTHESIS_FAN_IN);
    waves += Math.ceil(groups / width);
    nodes = groups;
  } while (nodes > 1);
  return waves;
}

export function computeWideResearchDefaultOverallTimeoutMs(input: {
  items: number;
  concurrency: number;
  workerTimeoutMs?: number;
  decomposeTimeoutMs?: number;
  aggregateTimeoutMs?: number;
}): number {
  const items = clampInteger(input.items, 5, 1, 250);
  const concurrency = Math.min(items, clampInteger(input.concurrency, 5, 1, 20));
  const workerTimeoutMs = Math.max(5_000, input.workerTimeoutMs ?? 90_000);
  const decomposeTimeoutMs = Math.max(5_000, input.decomposeTimeoutMs ?? 45_000);
  const aggregateTimeoutMs = Math.max(
    5_000,
    input.aggregateTimeoutMs ?? estimateWideResearchSynthesisWaves(items, concurrency) * 60_000,
  );
  const workerWaves = Math.ceil(items / concurrency);
  return Math.max(
    300_000,
    30_000 + decomposeTimeoutMs + workerWaves * workerTimeoutMs + aggregateTimeoutMs,
  );
}

// ============================================================================
// Orchestrator
// ============================================================================

export class WideResearchOrchestrator extends EventEmitter {
  private options: Required<Omit<WideResearchOptions, 'workers'>>;
  private readonly dependencies: WideResearchDependencies;
  private pendingTimedOutOperations = 0;

  constructor(options: WideResearchOptions = {}, dependencies: WideResearchDependencies = {}) {
    super();
    this.dependencies = dependencies;
    const legacyWorkers = clampInteger(options.workers, 5, 1, 20);
    const items = clampInteger(options.items, legacyWorkers, 1, 250);
    const concurrency = Math.min(
      items,
      clampInteger(options.concurrency, legacyWorkers, 1, 20),
    );
    const workerTimeoutMs = Math.max(5_000, options.workerTimeoutMs ?? 90_000);
    const decomposeTimeoutMs = Math.max(5_000, options.decomposeTimeoutMs ?? 45_000);
    const aggregateTimeoutMs = Math.max(
      5_000,
      options.aggregateTimeoutMs ??
        estimateWideResearchSynthesisWaves(items, concurrency) * 60_000,
    );
    this.options = {
      items,
      concurrency,
      maxRoundsPerWorker: clampInteger(options.maxRoundsPerWorker, 15, 1),
      stream: options.stream ?? true,
      context: options.context ?? '',
      model: options.model ?? '',
      workerTimeoutMs,
      overallTimeoutMs: Math.max(
        30_000,
        options.overallTimeoutMs ?? computeWideResearchDefaultOverallTimeoutMs({
          items,
          concurrency,
          workerTimeoutMs,
          decomposeTimeoutMs,
          aggregateTimeoutMs,
        }),
      ),
      decomposeTimeoutMs,
      aggregateTimeoutMs,
    };
  }

  /** True while a timed-out operation is being cooperatively cancelled and drained. */
  hasPendingTimedOutOperations(): boolean {
    return this.pendingTimedOutOperations > 0;
  }

  /**
   * Run wide research on a topic.
   * Emits WideResearchProgress events throughout execution.
   */
  async research(
    topic: string,
    apiKey: string,
    providerConfig?: Record<string, unknown>,
    ...durabilityArgs: [durability?: WideResearchDurabilityOptions]
  ): Promise<WideResearchResult> {
    const durability = durabilityArgs[0];
    if (durability?.checkpointPath || durability?.resumePath) {
      return this.researchDurable(topic, apiKey, providerConfig, durability);
    }
    const startTime = Date.now();
    const deadline = startTime + this.options.overallTimeoutMs;

    // Step 1: Decompose into subtopics
    const decomposedSubtopics = await this.withTimeout(
      (signal) => this.decompose(topic, apiKey, providerConfig, signal),
      this.options.decomposeTimeoutMs,
      'decompose phase timed out'
    ).catch(() => [] as string[]);
    const subtopics = this.normalizeSubtopics(topic, decomposedSubtopics);
    this.emit('progress', { type: 'decomposed', subtopics } satisfies WideResearchProgress);

    // Step 2: process the requested item set in bounded parallel waves.
    const workerResults: ResearchWorkerResult[] = [];
    const chunks = this.chunk(subtopics, this.options.concurrency);

    for (const [waveOffset, batch] of chunks.entries()) {
      this.emit('progress', {
        type: 'wave_start',
        waveIndex: waveOffset + 1,
        waveCount: chunks.length,
        itemCount: batch.length,
      } satisfies WideResearchProgress);
      const batchPromises = batch.map(async (subtopic, batchIdx) => {
        const workerIndex = workerResults.length + batchIdx;
        this.emit('progress', { type: 'worker_start', workerIndex, subtopic } satisfies WideResearchProgress);

        const workerStart = Date.now();
        const remainingOverallMs = Math.max(1_000, deadline - Date.now());
        if (remainingOverallMs <= 1_000) {
          const result: ResearchWorkerResult = {
            subtopic,
            workerIndex,
            output: '',
            success: false,
            error: 'Skipped: overall research timeout reached',
            durationMs: 0,
          };
          this.emit('progress', { type: 'worker_done', workerIndex, subtopic, success: false } satisfies WideResearchProgress);
          return result;
        }

        try {
          const output = await this.withTimeout(
            (signal) => this.runWorker(subtopic, topic, apiKey, providerConfig, signal),
            Math.min(this.options.workerTimeoutMs, remainingOverallMs),
            `worker timed out after ${Math.min(this.options.workerTimeoutMs, remainingOverallMs)}ms`
          );
          const result: ResearchWorkerResult = {
            subtopic,
            workerIndex,
            output,
            success: true,
            durationMs: Date.now() - workerStart,
          };
          this.emit('progress', { type: 'worker_done', workerIndex, subtopic, success: true } satisfies WideResearchProgress);
          return result;
        } catch (err) {
          const result: ResearchWorkerResult = {
            subtopic,
            workerIndex,
            output: '',
            success: false,
            error: err instanceof Error ? err.message : String(err),
            durationMs: Date.now() - workerStart,
          };
          this.emit('progress', { type: 'worker_done', workerIndex, subtopic, success: false } satisfies WideResearchProgress);
          return result;
        }
      });

      const batchResults = await Promise.all(batchPromises);
      workerResults.push(...batchResults);
      this.emit('progress', {
        type: 'wave_done',
        waveIndex: waveOffset + 1,
        waveCount: chunks.length,
        completedCount: workerResults.length,
      } satisfies WideResearchProgress);
    }

    // Step 3: Aggregate
    this.emit('progress', { type: 'aggregating' } satisfies WideResearchProgress);
    const remainingOverallMs = Math.max(5_000, deadline - Date.now());
    const report = await this.withTimeout(
      (signal) => this.aggregate(topic, workerResults, apiKey, providerConfig, signal),
      Math.min(this.options.aggregateTimeoutMs, remainingOverallMs),
      'aggregate phase timed out'
    ).catch(() => this.buildFallbackReport(topic, workerResults));

    const finalResult: WideResearchResult = {
      topic,
      subtopics,
      workerResults,
      report,
      durationMs: Date.now() - startTime,
      successCount: workerResults.filter(r => r.success).length,
    };

    this.emit('progress', { type: 'done', result: finalResult } satisfies WideResearchProgress);
    return finalResult;
  }

  /**
   * Durable Wide Research path. It is entered only when checkpoint/resume is
   * explicit, leaving the historical `research()` path above unchanged.
   */
  private async researchDurable(
    topic: string,
    apiKey: string,
    providerConfig: Record<string, unknown> | undefined,
    durability: WideResearchDurabilityOptions,
  ): Promise<WideResearchResult> {
    if (durability.checkpointPath && durability.resumePath) {
      throw new WideResearchCheckpointError(
        'INVALID_PATH',
        'Use either checkpointPath or resumePath, not both.',
      );
    }

    const requestedPath = durability.resumePath ?? durability.checkpointPath;
    if (!requestedPath) {
      throw new WideResearchCheckpointError('INVALID_PATH', 'A checkpoint path is required.');
    }
    const checkpointPath = resolveWideResearchCheckpointPath(requestedPath);
    const store = durability.checkpointStore ?? new FileWideResearchCheckpointStore();
    const now = this.dependencies.now ?? Date.now;
    const startTime = now();
    const deadline = startTime + this.options.overallTimeoutMs;
    const checkpointOptions = this.getCheckpointOptions();
    const fingerprintContext = {
      context: this.options.context,
      model: this.resolveModel(providerConfig) ?? null,
      providerBaseURL:
        typeof providerConfig?.baseURL === 'string' ? providerConfig.baseURL : null,
    };
    const executionFingerprint = createWideResearchExecutionFingerprint({
      options: checkpointOptions,
      ...fingerprintContext,
    });
    const legacyExecutionFingerprint = createWideResearchExecutionFingerprint({
      options: {
        workers: checkpointOptions.workers,
        maxRoundsPerWorker: checkpointOptions.maxRoundsPerWorker,
        workerTimeoutMs: checkpointOptions.workerTimeoutMs,
        overallTimeoutMs: checkpointOptions.overallTimeoutMs,
        decomposeTimeoutMs: checkpointOptions.decomposeTimeoutMs,
        aggregateTimeoutMs: checkpointOptions.aggregateTimeoutMs,
      },
      ...fingerprintContext,
    });
    const compatibility = {
      topic,
      options: checkpointOptions,
      executionFingerprint,
      ...(checkpointOptions.items === checkpointOptions.concurrency
        ? { acceptedExecutionFingerprints: [legacyExecutionFingerprint] }
        : {}),
    };

    let checkpoint: WideResearchCheckpoint;
    let subtopics: string[];
    let workerResults: ResearchWorkerResult[];

    if (durability.resumePath) {
      checkpoint = await store.load(checkpointPath);
      assertWideResearchCheckpointCompatible(checkpoint, compatibility);
      subtopics = this.normalizeSubtopics(topic, checkpoint.subtopics);
      workerResults = checkpoint.workerResults.map((result) => ({ ...result }));
      if (subtopics.length !== checkpoint.subtopics.length) {
        checkpoint = {
          ...checkpoint,
          state: 'running',
          subtopics: [...subtopics],
          updatedAt: new Date(now()).toISOString(),
        };
        await store.save(checkpointPath, checkpoint);
      }
      const successCount = workerResults.filter((result) => result.success).length;
      this.emit('progress', {
        type: 'resumed',
        checkpointPath,
        successCount,
        pendingCount: subtopics.length - successCount,
      } satisfies WideResearchProgress);
      this.emit('progress', { type: 'decomposed', subtopics } satisfies WideResearchProgress);
    } else {
      await store.assertCreatable?.(checkpointPath);
      const decomposedSubtopics = await this.withTimeout(
        (signal) => this.dependencies.decompose
          ? this.dependencies.decompose(topic, apiKey, providerConfig, signal)
          : this.decompose(topic, apiKey, providerConfig, signal),
        this.options.decomposeTimeoutMs,
        'decompose phase timed out',
      ).catch(() => [] as string[]);
      subtopics = this.normalizeSubtopics(topic, decomposedSubtopics);
      workerResults = [];
      const timestamp = new Date(now()).toISOString();
      checkpoint = {
        kind: WIDE_RESEARCH_CHECKPOINT_KIND,
        version: WIDE_RESEARCH_CHECKPOINT_VERSION,
        state: 'decomposed',
        topic,
        options: checkpointOptions,
        executionFingerprint,
        subtopics: [...subtopics],
        workerResults: [],
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      await store.save(checkpointPath, checkpoint);
      this.emit('progress', { type: 'decomposed', subtopics } satisfies WideResearchProgress);
    }

    const successfulIndexes = new Set(
      workerResults.filter((result) => result.success).map((result) => result.workerIndex),
    );
    const pendingWorkers = subtopics
      .map((subtopic, workerIndex) => ({ subtopic, workerIndex }))
      .filter(({ workerIndex }) => !successfulIndexes.has(workerIndex));
    let persistQueue = Promise.resolve();

    const persistWorkerResult = async (result: ResearchWorkerResult): Promise<void> => {
      const operation = persistQueue.then(async () => {
        const existingIndex = workerResults.findIndex(
          (candidate) => candidate.workerIndex === result.workerIndex,
        );
        if (existingIndex >= 0) workerResults[existingIndex] = result;
        else workerResults.push(result);
        workerResults.sort((left, right) => left.workerIndex - right.workerIndex);
        checkpoint = {
          ...checkpoint,
          state: 'running',
          workerResults: redactWideResearchCheckpointResults(workerResults, [apiKey]),
          updatedAt: new Date(now()).toISOString(),
        };
        await store.save(checkpointPath, checkpoint);
      });
      persistQueue = operation;
      await operation;
    };

    const waves = this.chunk(pendingWorkers, this.options.concurrency);
    for (const [waveOffset, batch] of waves.entries()) {
      this.emit('progress', {
        type: 'wave_start',
        waveIndex: waveOffset + 1,
        waveCount: waves.length,
        itemCount: batch.length,
      } satisfies WideResearchProgress);
      await Promise.all(
        batch.map(async ({ subtopic, workerIndex }) => {
          this.emit('progress', {
            type: 'worker_start',
            workerIndex,
            subtopic,
          } satisfies WideResearchProgress);
          const workerStart = now();
          const remainingOverallMs = Math.max(1_000, deadline - now());
          let result: ResearchWorkerResult;
          if (remainingOverallMs <= 1_000) {
            result = {
              subtopic,
              workerIndex,
              output: '',
              success: false,
              error: 'Skipped: overall research timeout reached',
              durationMs: 0,
            };
          } else {
            try {
              const workerTimeoutMs = Math.min(
                this.options.workerTimeoutMs,
                remainingOverallMs,
              );
              const output = await this.withTimeout(
                (signal) => this.dependencies.runWorker
                  ? this.dependencies.runWorker(
                      subtopic,
                      topic,
                      workerIndex,
                      apiKey,
                      providerConfig,
                      signal,
                    )
                  : this.runWorker(subtopic, topic, apiKey, providerConfig, signal),
                workerTimeoutMs,
                `worker timed out after ${workerTimeoutMs}ms`,
              );
              result = {
                subtopic,
                workerIndex,
                output,
                success: true,
                durationMs: now() - workerStart,
              };
            } catch (error) {
              result = {
                subtopic,
                workerIndex,
                output: '',
                success: false,
                error: error instanceof Error ? error.message : String(error),
                durationMs: now() - workerStart,
              };
            }
          }

          this.emit('progress', {
            type: 'worker_done',
            workerIndex,
            subtopic,
            success: result.success,
          } satisfies WideResearchProgress);
          await persistWorkerResult(result);
        }),
      );

      // Every settled wave gets an explicit durable boundary in addition to
      // the finer-grained per-item saves. A crash can therefore resume without
      // replaying any successful item, including a partially completed wave.
      checkpoint = {
        ...checkpoint,
        state: 'running',
        workerResults: redactWideResearchCheckpointResults(workerResults, [apiKey]),
        updatedAt: new Date(now()).toISOString(),
      };
      await store.save(checkpointPath, checkpoint);
      this.emit('progress', {
        type: 'wave_done',
        waveIndex: waveOffset + 1,
        waveCount: waves.length,
        completedCount: workerResults.filter((result) => result.success).length,
      } satisfies WideResearchProgress);
    }

    this.emit('progress', { type: 'aggregating' } satisfies WideResearchProgress);
    checkpoint = {
      ...checkpoint,
      state: 'aggregating',
      workerResults: redactWideResearchCheckpointResults(workerResults, [apiKey]),
      updatedAt: new Date(now()).toISOString(),
    };
    await store.save(checkpointPath, checkpoint);

    const remainingOverallMs = Math.max(5_000, deadline - now());
    const report = await this.withTimeout(
      (signal) => this.dependencies.aggregate
        ? this.dependencies.aggregate(topic, workerResults, apiKey, providerConfig, signal)
        : this.aggregate(topic, workerResults, apiKey, providerConfig, signal),
      Math.min(this.options.aggregateTimeoutMs, remainingOverallMs),
      'aggregate phase timed out',
    ).catch(() => this.buildFallbackReport(topic, workerResults));

    const rawFinalResult: WideResearchResult = {
      topic,
      subtopics,
      workerResults,
      report,
      durationMs: now() - startTime,
      successCount: workerResults.filter((result) => result.success).length,
    };
    const finalResult = redactWideResearchResult(rawFinalResult, [apiKey]);
    checkpoint = {
      ...checkpoint,
      state: finalResult.successCount === subtopics.length ? 'completed' : 'failed',
      workerResults: redactWideResearchCheckpointResults(workerResults, [apiKey]),
      updatedAt: new Date(now()).toISOString(),
    };
    await store.save(checkpointPath, checkpoint);

    this.emit('progress', { type: 'done', result: finalResult } satisfies WideResearchProgress);
    return finalResult;
  }

  private getCheckpointOptions(): WideResearchCheckpointOptions {
    return {
      // Keep `workers` as a serialized compatibility mirror for checkpoints
      // created before total-item count and concurrency became independent.
      workers: this.options.concurrency,
      items: this.options.items,
      concurrency: this.options.concurrency,
      maxRoundsPerWorker: this.options.maxRoundsPerWorker,
      workerTimeoutMs: this.options.workerTimeoutMs,
      overallTimeoutMs: this.options.overallTimeoutMs,
      decomposeTimeoutMs: this.options.decomposeTimeoutMs,
      aggregateTimeoutMs: this.options.aggregateTimeoutMs,
    };
  }

  private normalizeSubtopics(topic: string, candidates: string[]): string[] {
    const subtopics = candidates
      .filter((candidate) => typeof candidate === 'string' && candidate.trim().length > 0)
      .slice(0, this.options.items);
    let aspect = 1;
    while (subtopics.length < this.options.items) {
      let fallback = `${topic || 'Research topic'} - aspect ${aspect}`;
      while (subtopics.includes(fallback)) {
        aspect += 1;
        fallback = `${topic || 'Research topic'} - aspect ${aspect}`;
      }
      subtopics.push(fallback);
      aspect += 1;
    }
    return subtopics;
  }

  private resolveModel(providerConfig?: Record<string, unknown>): string | undefined {
    if (this.options.model) return this.options.model;
    return typeof providerConfig?.model === 'string' ? providerConfig.model : undefined;
  }

  // --------------------------------------------------------------------------
  // Decompose topic → subtopics via a single LLM call
  // --------------------------------------------------------------------------

  private async decompose(
    topic: string,
    apiKey: string,
    providerConfig?: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<string[]> {
    const { CodeBuddyClient } = await import('../codebuddy/client.js');
    const client = new CodeBuddyClient(
      apiKey,
      this.resolveModel(providerConfig),
      providerConfig?.baseURL as string | undefined
    );

    const response = await client.chat(
      [
        {
          role: 'system',
          content: `You are a research coordinator. When given a topic, break it into ${this.options.items} independent, non-overlapping subtopics that together provide comprehensive coverage. Return ONLY a JSON array of strings, no explanation.`,
        },
        {
          role: 'user',
          content: `Topic: ${topic}\n\nReturn exactly ${this.options.items} subtopics as a JSON array.`,
        },
      ],
      undefined,
      { signal },
    );

    try {
      const content = response.choices[0]?.message?.content ?? '';
      // Extract JSON array from response
      const match = content.match(/\[[\s\S]*\]/);
      if (match) {
        const parsed = JSON.parse(match[0]) as unknown[];
        if (Array.isArray(parsed)) {
          return parsed
            .filter((s): s is string => typeof s === 'string')
            .slice(0, this.options.items);
        }
      }
    } catch {
      // Fall back to splitting the topic
    }

    // Fallback: create generic subtopics
    return Array.from({ length: this.options.items }, (_, i) =>
      `${topic} - aspect ${i + 1}`
    );
  }

  // --------------------------------------------------------------------------
  // Run a single research worker
  // --------------------------------------------------------------------------

  private async runWorker(
    subtopic: string,
    parentTopic: string,
    apiKey: string,
    providerConfig?: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<string> {
    // The worker sub-agent is built by an INJECTED factory (research-worker-
    // provider), not by importing CodeBuddyAgent here — that import closed the
    // agent↔tool-registry cycle. The agent's constructor and the research CLI
    // both wire the factory at startup.
    const factory = getResearchWorkerFactory();
    if (!factory) {
      throw new Error(
        'WideResearch: no research-worker factory wired. Call setResearchWorkerFactory() ' +
          '(done automatically by the agent constructor and by `buddy research`).',
      );
    }
    const agent = factory({
      apiKey,
      baseURL: providerConfig?.baseURL as string | undefined,
      model: this.resolveModel(providerConfig),
      maxRounds: this.options.maxRoundsPerWorker,
    });

    let output = '';

    const query = [
      `Research this subtopic thoroughly: "${subtopic}"`,
      `Parent topic: "${parentTopic}"`,
      '',
      'Use web search, browser, and any available tools.',
      'Produce a comprehensive summary with key facts, insights, and sources.',
      ...(this.options.context.trim()
        ? ['', 'Additional research context:', this.options.context.trim()]
        : []),
      'Return only the research report, no meta-commentary.',
    ].join('\n');

    const abortWorker = (): void => agent.abortCurrentOperation?.();
    if (signal?.aborted) {
      abortWorker();
      throw this.abortReason(signal);
    }
    signal?.addEventListener('abort', abortWorker, { once: true });
    try {
      for await (const chunk of agent.processUserMessageStream(query)) {
        if (signal?.aborted) break;
        if (chunk.type === 'content' && chunk.content) {
          output += chunk.content;
        }
      }
    } finally {
      signal?.removeEventListener('abort', abortWorker);
    }

    return output || '(no output from worker)';
  }

  // --------------------------------------------------------------------------
  // Aggregate worker results into a final report
  // --------------------------------------------------------------------------

  private async aggregate(
    topic: string,
    results: ResearchWorkerResult[],
    apiKey: string,
    providerConfig?: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<string> {
    const successful = results.filter(r => r.success);
    if (successful.length === 0) {
      return this.appendCoverageManifest(
        'All research workers failed. No synthesized report is available.',
        results,
      );
    }

    let client: {
      chat(
        messages: Array<{ role: 'system' | 'user'; content: string }>,
        tools?: undefined,
        options?: { signal?: AbortSignal },
      ): Promise<{ choices: Array<{ message?: { content?: string | null } }> }>;
    } | null = null;
    const synthesize = async (request: WideResearchSynthesisRequest): Promise<string> => {
      if (signal?.aborted) throw this.abortReason(signal);
      if (this.dependencies.synthesize) {
        return this.dependencies.synthesize(request, apiKey, providerConfig, signal);
      }
      if (!client) {
        const { CodeBuddyClient } = await import('../codebuddy/client.js');
        client = new CodeBuddyClient(
          apiKey,
          this.resolveModel(providerConfig),
          providerConfig?.baseURL as string | undefined,
        );
      }
      const sections = request.sections
        .map((section) =>
          `## ${section.label}\n\n${section.content}\n\n` +
          `_Coverage: items ${section.sourceIndexes.map((index) => index + 1).join(', ')}_`,
        )
        .join('\n\n---\n\n');
      const response = await client.chat(
        [
          {
            role: 'system',
            content: request.final
              ? 'You are the final research synthesizer. Produce one coherent Markdown report with an executive summary, preserve every represented finding, resolve contradictions, and state uncertainties.'
              : 'You are an intermediate research reducer. Compress the sections faithfully, preserve distinct findings and uncertainties, and retain explicit item coverage. Use concise Markdown.',
          },
          {
            role: 'user',
            content:
              `Topic: ${request.topic}\nSynthesis level: ${request.level}\n` +
              `Group: ${request.groupIndex + 1}/${request.groupCount}\n\n${sections}`,
          },
        ],
        undefined,
        { signal },
      );
      const content = response.choices[0]?.message?.content;
      if (typeof content !== 'string' || content.trim().length === 0) {
        throw new Error('Synthesis returned no content.');
      }
      return content;
    };

    const synthesisTruncatedIndexes = new Set<number>();
    let nodes: WideResearchSynthesisSection[] = successful.map((result) => {
      if (result.output.length > SYNTHESIS_NODE_CHAR_BUDGET) {
        synthesisTruncatedIndexes.add(result.workerIndex);
      }
      return {
        label: result.subtopic,
        content: this.boundSynthesisContent(result.output, result.workerIndex),
        sourceIndexes: [result.workerIndex],
      };
    });
    let level = 1;

    while (nodes.length > 0) {
      if (signal?.aborted) throw this.abortReason(signal);
      const groups = this.groupSynthesisNodes(nodes);
      const reduced: WideResearchSynthesisSection[] = [];
      for (const wave of this.chunk(groups, this.options.concurrency)) {
        const settledWave = await Promise.allSettled(
          wave.map(async (sections, waveIndex) => {
            const groupIndex = groups.indexOf(sections);
            const request: WideResearchSynthesisRequest = {
              topic,
              level,
              groupIndex: groupIndex >= 0 ? groupIndex : waveIndex,
              groupCount: groups.length,
              final: groups.length === 1,
              sections,
            };
            let content: string;
            try {
              content = await synthesize(request);
            } catch (error) {
              content = this.buildSynthesisGroupFallback(request, error);
            }
            if (!request.final && content.length > SYNTHESIS_NODE_CHAR_BUDGET) {
              for (const sourceIndex of sections.flatMap((section) => section.sourceIndexes)) {
                synthesisTruncatedIndexes.add(sourceIndex);
              }
            }
            return {
              label: request.final
                ? `Final synthesis for ${topic}`
                : `Synthesis level ${level}, group ${request.groupIndex + 1}`,
              content: request.final ? content : this.boundSynthesisContent(content),
              sourceIndexes: [...new Set(sections.flatMap((section) => section.sourceIndexes))]
                .sort((left, right) => left - right),
            } satisfies WideResearchSynthesisSection;
          }),
        );
        // `Promise.allSettled` is intentional: after an aggregate timeout every
        // in-flight reducer must drain before this wave can release its slots.
        if (signal?.aborted) throw this.abortReason(signal);
        const rejected = settledWave.find(
          (entry): entry is PromiseRejectedResult => entry.status === 'rejected',
        );
        if (rejected) throw rejected.reason;
        const waveResults = settledWave.map(
          (entry) => (entry as PromiseFulfilledResult<WideResearchSynthesisSection>).value,
        );
        reduced.push(...waveResults);
      }
      if (reduced.length === 1) {
        return this.appendCoverageManifest(
          reduced[0]!.content,
          results,
          synthesisTruncatedIndexes,
        );
      }
      nodes = reduced;
      level += 1;
    }

    return this.buildFallbackReport(topic, results);
  }

  private boundSynthesisContent(content: string, sourceIndex?: number): string {
    if (content.length <= SYNTHESIS_NODE_CHAR_BUDGET) return content;
    const omitted = content.length - SYNTHESIS_NODE_CHAR_BUDGET;
    return (
      content.slice(0, SYNTHESIS_NODE_CHAR_BUDGET) +
      `\n\n[${omitted} characters omitted from synthesis input` +
      `${sourceIndex === undefined ? '' : ` for item ${sourceIndex + 1}`}; ` +
      'the complete raw result remains in the Wide Research checkpoint.]'
    );
  }

  private groupSynthesisNodes(
    nodes: WideResearchSynthesisSection[],
  ): WideResearchSynthesisSection[][] {
    const groups: WideResearchSynthesisSection[][] = [];
    let group: WideResearchSynthesisSection[] = [];
    let chars = 0;
    for (const node of nodes) {
      const size = node.label.length + node.content.length + 128;
      if (
        group.length > 0 &&
        (group.length >= SYNTHESIS_FAN_IN || chars + size > SYNTHESIS_GROUP_CHAR_BUDGET)
      ) {
        groups.push(group);
        group = [];
        chars = 0;
      }
      group.push(node);
      chars += size;
    }
    if (group.length > 0) groups.push(group);
    return groups;
  }

  private buildSynthesisGroupFallback(
    request: WideResearchSynthesisRequest,
    error: unknown,
  ): string {
    const failureKind = error instanceof Error && error.name ? error.name : 'provider error';
    return [
      `# Deterministic synthesis fallback (level ${request.level})`,
      '',
      `The synthesis provider failed (${failureKind}). No represented item was silently dropped.`,
      '',
      ...request.sections.flatMap((section) => [
        `## ${section.label}`,
        '',
        section.content,
        '',
        `_Coverage: items ${section.sourceIndexes.map((index) => index + 1).join(', ')}_`,
        '',
      ]),
    ].join('\n');
  }

  private appendCoverageManifest(
    report: string,
    results: ResearchWorkerResult[],
    synthesisTruncatedIndexes: ReadonlySet<number> = new Set<number>(),
  ): string {
    const manifest = results.map((result) =>
      `- ${result.success ? '✅' : '❌'} ${result.workerIndex + 1}. ${result.subtopic}` +
      `${result.success ? '' : ' — worker failed; resume can retry this item'}` +
      `${synthesisTruncatedIndexes.has(result.workerIndex)
        ? ' — synthesis input clipped; complete raw result preserved in checkpoint'
        : ''}`,
    );
    return [report, '', '## Coverage manifest', '', ...manifest].join('\n');
  }

  // --------------------------------------------------------------------------
  // Deep Research (Phase A) — opt-in, deterministic, cited pipeline.
  //
  // Additive to `research()`: nothing here runs unless `deepResearch()` is
  // explicitly called. It reuses this orchestrator's parallel batching
  // (`batchMap`) and event channel, and delegates the pure planning/collection/
  // dedup/citation/synthesis logic to `deep-research.ts` (fully injectable).
  // --------------------------------------------------------------------------

  /**
   * Run the GPT-Researcher-style Deep Research pipeline. Wires the real LLM,
   * web-search, and scrape boundaries; every one degrades gracefully. Emits
   * `{ type: 'deep', ... }` progress events. Never throws.
   *
   * Phase B: when `deepOptions.rounds > 1`, this runs the BOUNDED iterative gap
   * loop (research → draft → gap analysis → re-search → convergence). With the
   * default (`rounds` absent / 1) it delegates to the Phase-A single round —
   * byte-identical. The gap-analysis boundary defaults to the `llm` boundary and
   * is only exercised when `rounds > 1`.
   *
   * @param boundariesOverride injected fakes for tests (no network).
   */
  async deepResearch(
    question: string,
    apiKey: string,
    providerConfig?: Record<string, unknown>,
    deepOptions?: DeepResearchLoopOptions,
    boundariesOverride?: Partial<DeepResearchBoundaries>,
    ckg?: CkgRunOptions,
  ): Promise<DeepResearchLoopResult> {
    const { runDeepResearchLoop } = await import('./deep-research.js');

    const real = await this.buildDeepBoundaries(apiKey, providerConfig);
    const boundaries: DeepResearchBoundaries = { ...real, ...boundariesOverride };
    const emit = (stage: DeepResearchStage): void => {
      this.emit('progress', { type: 'deep', ...stage } satisfies DeepResearchProgress);
    };

    // Phase D (CKG bridge) — opt-in, additive. OFF ⇒ the exact Phase-A/B path
    // runs, byte-identically (no recall, no ingest, an untouched report).
    if (!ckg?.enabled) {
      return runDeepResearchLoop(question, boundaries, deepOptions ?? {}, emit);
    }
    return this.runWithCkgBridge(question, boundaries, ckg, (teed) =>
      runDeepResearchLoop(question, teed, deepOptions ?? {}, emit),
    );
  }

  // --------------------------------------------------------------------------
  // Deep Research (Phase C) — STORM multi-perspective, opt-in.
  //
  // Additive to `deepResearch()`: nothing here runs unless `stormResearch()` is
  // explicitly called (the CLI only calls it when `--perspectives`/`--storm` is
  // present). It reuses the SAME real boundaries as Deep Research (LLM / search /
  // scrape / batching) plus the three STORM seams (perspectives / outline /
  // section), all injectable, and delegates the pure pipeline to
  // `deep-research-storm.ts`. Emits `{ type: 'storm', ... }` progress. Never throws.
  // --------------------------------------------------------------------------

  /**
   * Run the STORM multi-perspective Deep Research pipeline: N diversified
   * perspectives research the topic in parallel, their sources merge into a
   * shared citation registry, then an outline-first article is co-written with
   * per-section citations. Wires the real boundaries; every one degrades
   * gracefully. Never throws.
   *
   * @param boundariesOverride injected fakes for tests (no network).
   */
  async stormResearch(
    question: string,
    apiKey: string,
    providerConfig?: Record<string, unknown>,
    stormOptions?: StormResearchOptions,
    boundariesOverride?: Partial<StormBoundaries>,
    ckg?: CkgRunOptions,
  ): Promise<StormResearchResult> {
    const { runStormResearch } = await import('./deep-research-storm.js');

    const real = await this.buildDeepBoundaries(apiKey, providerConfig);
    const boundaries: StormBoundaries = { ...real, ...boundariesOverride };
    const emit = (stage: StormStage): void => {
      this.emit('progress', { type: 'storm', ...stage } satisfies StormProgress);
    };

    // Phase D (CKG bridge) — opt-in, additive. OFF ⇒ the exact Phase-C path runs,
    // byte-identically (no recall, no ingest, an untouched article).
    if (!ckg?.enabled) {
      return runStormResearch(question, boundaries, stormOptions ?? {}, emit);
    }
    return this.runWithCkgBridge(question, boundaries, ckg, (teed) =>
      runStormResearch(question, teed, stormOptions ?? {}, emit),
    );
  }

  /**
   * Phase D (CKG) shared plumbing for both Deep (A/B) and STORM (C): tee the
   * scrape boundary to capture per-source content, resolve the CKG bridge (the
   * injected one, else the default over the process-wide collective graph), and
   * run the base pipeline under the Phase-D wrapper (recall → run → ingest →
   * augment). Never throws — the wrapper degrades silently on any CKG failure.
   */
  private async runWithCkgBridge<TResult extends DeepResearchResult, B extends DeepResearchBoundaries>(
    question: string,
    boundaries: B,
    ckg: CkgRunOptions,
    runBase: (teed: B) => Promise<TResult>,
  ): Promise<TResult> {
    const { runDeepResearchWithCkg, teeScrapeBoundary } = await import('./deep-research-ckg.js');
    const contentByUrl = new Map<string, string>();
    const teed = teeScrapeBoundary(boundaries, contentByUrl);
    const bridge = ckg.bridge ?? (await this.buildCkgBridge());
    return runDeepResearchWithCkg<TResult>({
      question,
      options: { ...ckg, enabled: true, bridge },
      runBase: () => runBase(teed),
      collectSourcesForIngest: (result) =>
        result.sources.map((s) => ({
          url: s.url,
          title: s.title,
          content: contentByUrl.get(s.url) ?? '',
        })),
    });
  }

  /**
   * Default CKG bridge over the process-wide collective graph — used when Phase D
   * is enabled and no bridge is injected. `recall` maps `recallHybrid` hits to
   * memory sources; `ingest` stores each deduped web source as a `discovery` node
   * (url as stable name ⇒ the CKG's contentHash reinforces/supersedes instead of
   * duplicating). Both legs never throw.
   */
  private async buildCkgBridge(): Promise<CkgBridge> {
    const { getCollectiveKnowledgeGraph } = await import('../memory/collective-knowledge-graph.js');
    const ckg = getCollectiveKnowledgeGraph();
    return {
      recall: async (query, k) => {
        try {
          const hits = await ckg.recallHybrid(query, { limit: k });
          return hits.map((h) => ({
            id: h.id,
            text: h.text,
            type: h.type,
            ...(h.agentId ? { agentId: h.agentId } : {}),
            ...(h.source ? { source: h.source } : {}),
            ...(h.similarity !== undefined ? { similarity: h.similarity } : {}),
          }));
        } catch {
          return [];
        }
      },
      ingest: async (sources, meta) => {
        let n = 0;
        for (const s of sources) {
          try {
            const res = await ckg.ingest({
              type: 'discovery',
              name: s.url,
              text: `${s.title}. ${s.content}`.trim(),
              source: meta.source,
              ...(meta.agentId ? { agentId: meta.agentId } : {}),
            });
            if (res) n++;
          } catch {
            /* skip this source, keep going */
          }
        }
        return n;
      },
    };
  }

  /** Construct the real Deep Research boundaries (LLM / search / scrape / batching). */
  private async buildDeepBoundaries(
    apiKey: string,
    providerConfig?: Record<string, unknown>,
  ): Promise<DeepResearchBoundaries> {
    const model = providerConfig?.model as string | undefined;
    const baseURL = providerConfig?.baseURL as string | undefined;

    const { WebSearchTool } = await import('../tools/web-search.js');
    const webSearch = new WebSearchTool();

    const { isFirecrawlEnabled, firecrawlScrape } = await import('../tools/firecrawl-tool.js');
    const firecrawlReady = (() => {
      try {
        return isFirecrawlEnabled();
      } catch {
        return false;
      }
    })();

    return {
      llm: async (messages: DeepLlmMessage[]): Promise<string> => {
        const { CodeBuddyClient } = await import('../codebuddy/client.js');
        const client = new CodeBuddyClient(apiKey, model, baseURL);
        const response = await client.chat(
          messages.map((m) => ({ role: m.role, content: m.content })),
        );
        return response.choices[0]?.message?.content ?? '';
      },
      search: async (query: string, k: number): Promise<SearchHit[]> => {
        const results = await webSearch.searchStructured(query, { maxResults: k });
        return results
          .filter((r) => typeof r.url === 'string' && r.url.length > 0)
          .map((r) => ({ title: r.title || r.url, url: r.url, snippet: r.snippet || '' }));
      },
      scrape: async (url: string): Promise<string> => {
        try {
          if (firecrawlReady) {
            const r = await firecrawlScrape({ url });
            if (r.success && r.output && r.output.trim().length > 0) return r.output;
          }
        } catch {
          /* fall through to cheap fetch */
        }
        try {
          const r = await webSearch.fetchPage(url);
          if (r.success && r.output && r.output.trim().length > 0) return r.output;
        } catch {
          /* dropped by the pipeline */
        }
        return '';
      },
      mapBatched: <T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> =>
        this.batchMap(items, size, fn),
    };
  }

  /**
   * Parallel batched map — the same batching mechanic `research()` uses
   * (`chunk` + `Promise.all`), exposed for the Deep Research fan-out.
   */
  private async batchMap<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
    const out: R[] = [];
    for (const batch of this.chunk(items, Math.max(1, size))) {
      out.push(...(await Promise.all(batch.map(fn))));
    }
    return out;
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private chunk<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Request cooperative cancellation at the deadline, then drain the operation
   * before rejecting. This is deliberately different from `Promise.race`: a
   * dependency that ignores AbortSignal keeps its concurrency slot, and neither
   * the next wave nor the public result can run ahead of hidden provider work.
   */
  private async withTimeout<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    timeoutMs: number,
    timeoutMessage: string,
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutError = new Error(timeoutMessage);
    let timedOut = false;
    let settled = false;
    const pending = Promise.resolve()
      .then(() => operation(controller.signal))
      .then(
        (value) => {
          settled = true;
          return value;
        },
        (error: unknown) => {
          settled = true;
          throw error;
        },
      );
    const timer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      this.pendingTimedOutOperations += 1;
      controller.abort(timeoutError);
    }, timeoutMs);

    try {
      const value = await pending;
      if (timedOut) throw timeoutError;
      return value;
    } catch (error) {
      if (timedOut) throw timeoutError;
      throw error;
    } finally {
      clearTimeout(timer);
      if (timedOut) {
        this.pendingTimedOutOperations = Math.max(0, this.pendingTimedOutOperations - 1);
        if (this.pendingTimedOutOperations === 0) {
          this.emit('timed_out_operations_settled');
        }
      }
    }
  }

  private abortReason(signal: AbortSignal): Error {
    return signal.reason instanceof Error
      ? signal.reason
      : new Error('Wide Research operation aborted');
  }

  private buildFallbackReport(topic: string, results: ResearchWorkerResult[]): string {
    const successful = results.filter(r => r.success && r.output.trim().length > 0);
    if (successful.length === 0) {
      return this.appendCoverageManifest(
        `# ${topic}\n\nNo successful worker output was available before timeout.`,
        results,
      );
    }

    const sections = successful
      .map(r => `## ${r.subtopic}\n\n${r.output}`)
      .join('\n\n---\n\n');

    return this.appendCoverageManifest([
      `# Research Report (Fallback Synthesis): ${topic}`,
      '',
      'Aggregation timed out, returning concatenated worker outputs.',
      '',
      sections,
    ].join('\n'), results);
  }
}

// ============================================================================
// Convenience function for tool use
// ============================================================================

export async function runWideResearch(
  topic: string,
  apiKey: string,
  options?: WideResearchOptions,
  providerConfig?: Record<string, unknown>
): Promise<ToolResult> {
  const orchestrator = new WideResearchOrchestrator(options);

  try {
    const result = await orchestrator.research(topic, apiKey, providerConfig);

    const summary = [
      `# Wide Research: ${topic}`,
      ``,
      `**Workers:** ${result.successCount}/${result.subtopics.length} succeeded`,
      `**Duration:** ${(result.durationMs / 1000).toFixed(1)}s`,
      ``,
      `## Subtopics Researched`,
      ...result.subtopics.map((s, i) => {
        const r = result.workerResults[i];
        return `- ${s} ${r?.success ? '✅' : '❌'}`;
      }),
      ``,
      `---`,
      ``,
      result.report,
    ].join('\n');

    return { success: true, output: summary };
  } catch (err) {
    return {
      success: false,
      error: `Wide Research failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Convenience wrapper for the opt-in Deep Research (Phase A) path, symmetric to
 * `runWideResearch`. Returns the cited report (already carrying inline [n]
 * markers and a "## Références" section). Never throws.
 */
export async function runDeepResearch(
  topic: string,
  apiKey: string,
  options?: WideResearchOptions & { deep?: DeepResearchLoopOptions },
  providerConfig?: Record<string, unknown>,
): Promise<ToolResult> {
  const orchestrator = new WideResearchOrchestrator(options);
  try {
    const result = await orchestrator.deepResearch(topic, apiKey, providerConfig, options?.deep);
    const summary = [
      `# Deep Research: ${topic}`,
      '',
      `**Sources:** ${result.sources.length} (deduped, ${result.duplicatesDropped} near-duplicate(s) dropped)`,
      `**Planner:** ${result.plannerLlmUsed ? 'LLM' : 'deterministic fallback'} | ` +
        `**Synthesis:** ${result.synthesisLlmUsed ? 'LLM' : 'deterministic fallback'}`,
      `**Duration:** ${(result.durationMs / 1000).toFixed(1)}s`,
      '',
      '---',
      '',
      result.report,
    ].join('\n');
    return { success: true, output: summary };
  } catch (err) {
    return {
      success: false,
      error: `Deep Research failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
