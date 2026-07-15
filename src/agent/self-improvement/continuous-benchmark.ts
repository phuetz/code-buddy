/**
 * Opt-in continuous capability benchmark for active LLM models.
 *
 * This module deliberately reuses the curated scenarios and scoring primitive
 * from `capability-benchmark.ts`. It has no scheduler: P0 is invoked only by
 * `buddy improve bench` (or an explicit programmatic call with the opt-in env).
 *
 * @module agent/self-improvement/continuous-benchmark
 */

import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { performance } from 'node:perf_hooks';

import { getModelScoreboard, type OutcomeRecord } from '../../fleet/model-scoreboard.js';
import {
  listActiveLlmModelPool,
  type ActiveLlmModelPoolEntry,
} from '../../providers/active-llm-model-pool.js';
import { logger } from '../../utils/logger.js';
import { scoreBenchmark, SEED_BENCHMARK_SCENARIOS } from './capability-benchmark.js';
import type { BenchmarkScenario } from './types.js';

export const CONTINUOUS_BENCHMARK_VERSION = '1';
export const DEFAULT_SELF_BENCH_TIMEOUT_MS = 60_000;
export const DEFAULT_SELF_BENCH_DROP = 0.15;
export const SELF_BENCH_MOVING_WINDOW = 5;

export interface BenchmarkHistoryEntry {
  /** Added by this runner; optional so older/minimal spec-shaped ledgers remain readable. */
  runId?: string;
  model: string;
  provider?: string;
  scenario: string;
  score: number;
  latencyMs: number;
  ts: string;
  benchVersion: string;
  status?: 'ok' | 'timeout' | 'error';
}

export interface BenchmarkRegression {
  model: string;
  before: number;
  after: number;
  /** Relative decrease: `(before - after) / before`. */
  drop: number;
}

export interface BenchmarkRunSummary {
  runId: string;
  model: string;
  provider: string;
  ts: string;
  score: number;
  latencyMs: number;
  scenarios: number;
}

export interface BenchmarkLlmRequest {
  candidate: ActiveLlmModelPoolEntry;
  scenario: BenchmarkScenario;
  prompt: string;
  signal: AbortSignal;
}

/** Minimal injectable seam: tests never need to construct a real provider client. */
export interface BenchmarkLlmClient {
  chat(request: BenchmarkLlmRequest): Promise<unknown>;
}

export type BenchmarkLlmClientFactory = (
  candidate: ActiveLlmModelPoolEntry
) => BenchmarkLlmClient | Promise<BenchmarkLlmClient>;

export interface BenchmarkScoreboardPort {
  recordOutcome(record: OutcomeRecord): void;
}

export interface RunBenchmarkOptions {
  models?: string | string[];
  provider?: string;
  scenarios?: number;
  env?: Record<string, string | undefined>;
  /** One injected client can dispatch on `request.candidate`. */
  client?: BenchmarkLlmClient;
  /** Or create a dedicated client per active provider/model. */
  clientFactory?: BenchmarkLlmClientFactory;
  /** Hermetic pool seam for tests; production always uses the active pool. */
  modelPool?: ActiveLlmModelPoolEntry[];
  scoreboard?: BenchmarkScoreboardPort;
  now?: () => Date;
  monotonicNow?: () => number;
  runId?: string;
}

export interface BenchmarkModelResult extends BenchmarkRunSummary {
  entries: BenchmarkHistoryEntry[];
}

export interface ContinuousBenchmarkResult {
  runId: string;
  historyPath: string;
  models: BenchmarkModelResult[];
  regressions: BenchmarkRegression[];
}

export interface BenchmarkReport {
  latest: BenchmarkRunSummary[];
  regressions: BenchmarkRegression[];
  recommendation: string;
}

class ScenarioTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Capability benchmark scenario timed out after ${timeoutMs}ms`);
    this.name = 'ScenarioTimeoutError';
  }
}

function historyPath(env: Record<string, string | undefined>): string {
  return env.CODEBUDDY_SELF_BENCH_HISTORY
    ? path.resolve(env.CODEBUDDY_SELF_BENCH_HISTORY)
    : path.join(os.homedir(), '.codebuddy', 'capability-history.jsonl');
}

function positiveNumber(raw: string | undefined, fallback: number): number {
  const parsed = raw === undefined ? Number.NaN : Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function dropThreshold(env: Record<string, string | undefined>): number {
  const parsed = Number(env.CODEBUDDY_SELF_BENCH_DROP);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_SELF_BENCH_DROP;
}

function selectedModelNames(models: string | string[] | undefined): Set<string> | null {
  if (models === undefined) return null;
  const raw = Array.isArray(models) ? models : [models];
  const names = raw
    .flatMap((value) => value.split(','))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return names.length > 0 ? new Set(names) : null;
}

function buildScenarioPrompt(scenario: BenchmarkScenario): string {
  return [
    'You are being evaluated on practical coding-agent guidance.',
    'Answer the situation directly and concisely. Do not discuss this benchmark.',
    `Situation: ${scenario.query}`,
  ].join('\n');
}

function extractText(response: unknown): string {
  if (typeof response === 'string') return response;
  if (!response || typeof response !== 'object') return '';
  const record = response as Record<string, unknown>;
  if (typeof record.content === 'string') return record.content;
  if (!Array.isArray(record.choices)) return '';
  const first = record.choices[0];
  if (!first || typeof first !== 'object') return '';
  const message = (first as Record<string, unknown>).message;
  if (!message || typeof message !== 'object') return '';
  const content = (message as Record<string, unknown>).content;
  return typeof content === 'string' ? content : '';
}

async function defaultClientFactory(
  candidate: ActiveLlmModelPoolEntry
): Promise<BenchmarkLlmClient> {
  const { CodeBuddyClient } = await import('../../codebuddy/client.js');
  const client = new CodeBuddyClient(candidate.apiKey ?? '', candidate.model, candidate.baseURL, {
    enableFallbacks: false,
    enableCredentialPool: false,
  });
  return {
    async chat(request) {
      return client.chat([{ role: 'user', content: request.prompt }], [], {
        signal: request.signal,
        disableProviderFallback: true,
      });
    },
  };
}

async function chatWithTimeout(
  client: BenchmarkLlmClient,
  request: Omit<BenchmarkLlmRequest, 'signal'>,
  timeoutMs: number
): Promise<unknown> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      client.chat({ ...request, signal: controller.signal }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new ScenarioTimeoutError(timeoutMs));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function scoreScenario(scenario: BenchmarkScenario, response: string): number {
  const score = scoreBenchmark([scenario], {
    search: () => (response ? [{ id: `model-response:${scenario.id}`, content: response }] : []),
  });
  return score.ratio;
}

async function appendHistory(file: string, entry: BenchmarkHistoryEntry): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, `${JSON.stringify(entry)}\n`, 'utf8');
}

function isHistoryEntry(value: unknown): value is BenchmarkHistoryEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return (
    (entry.runId === undefined || typeof entry.runId === 'string') &&
    typeof entry.model === 'string' &&
    (entry.provider === undefined || typeof entry.provider === 'string') &&
    typeof entry.scenario === 'string' &&
    typeof entry.score === 'number' &&
    Number.isFinite(entry.score) &&
    typeof entry.latencyMs === 'number' &&
    Number.isFinite(entry.latencyMs) &&
    typeof entry.ts === 'string' &&
    typeof entry.benchVersion === 'string' &&
    (entry.status === undefined ||
      entry.status === 'ok' ||
      entry.status === 'timeout' ||
      entry.status === 'error')
  );
}

/** Read the append-only history, ignoring a torn/corrupt final line. */
export async function readBenchmarkHistory(
  env: Record<string, string | undefined> = process.env
): Promise<BenchmarkHistoryEntry[]> {
  const file = historyPath(env);
  try {
    const raw = await fs.readFile(file, 'utf8');
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => {
        try {
          const parsed: unknown = JSON.parse(line);
          return isHistoryEntry(parsed) ? [parsed] : [];
        } catch {
          return [];
        }
      });
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? (error as { code?: unknown }).code
        : undefined;
    if (code !== 'ENOENT') {
      logger.warn('[continuous-benchmark] could not read capability history', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return [];
  }
}

/** Aggregate the per-scenario JSONL records into model runs. */
export function aggregateBenchmarkRuns(
  history: readonly BenchmarkHistoryEntry[]
): BenchmarkRunSummary[] {
  const grouped = new Map<string, BenchmarkHistoryEntry[]>();
  for (const entry of history) {
    const key = `${entry.model}\u0000${entry.runId ?? entry.ts}`;
    const entries = grouped.get(key) ?? [];
    entries.push(entry);
    grouped.set(key, entries);
  }

  return Array.from(grouped.values())
    .map((entries) => {
      const first = entries[0]!;
      const latestTs = entries.reduce(
        (latest, entry) => (entry.ts > latest ? entry.ts : latest),
        first.ts
      );
      return {
        runId: first.runId ?? first.ts,
        model: first.model,
        provider: first.provider ?? 'unknown',
        ts: latestTs,
        score: entries.reduce((sum, entry) => sum + entry.score, 0) / entries.length,
        latencyMs: entries.reduce((sum, entry) => sum + entry.latencyMs, 0),
        scenarios: entries.length,
      };
    })
    .sort((a, b) => a.ts.localeCompare(b.ts));
}

/**
 * Pure regression detector. For each model, compare its latest aggregate run
 * with the mean of up to five immediately preceding runs.
 */
export function detectRegressions(
  history: readonly BenchmarkHistoryEntry[],
  threshold: number = DEFAULT_SELF_BENCH_DROP
): BenchmarkRegression[] {
  const byModel = new Map<string, BenchmarkRunSummary[]>();
  for (const run of aggregateBenchmarkRuns(history)) {
    const runs = byModel.get(run.model) ?? [];
    runs.push(run);
    byModel.set(run.model, runs);
  }

  const regressions: BenchmarkRegression[] = [];
  for (const [model, runs] of byModel) {
    if (runs.length < 2) continue;
    const latest = runs[runs.length - 1]!;
    const baseline = runs.slice(
      Math.max(0, runs.length - 1 - SELF_BENCH_MOVING_WINDOW),
      runs.length - 1
    );
    const before = baseline.reduce((sum, run) => sum + run.score, 0) / baseline.length;
    if (before <= 0) continue;
    const drop = (before - latest.score) / before;
    if (drop > threshold) {
      regressions.push({ model, before, after: latest.score, drop });
    }
  }
  return regressions.sort((a, b) => b.drop - a.drop || a.model.localeCompare(b.model));
}

/** Build the latest state and a routing recommendation from history. */
export function createBenchmarkReport(
  history: readonly BenchmarkHistoryEntry[],
  threshold: number = DEFAULT_SELF_BENCH_DROP
): BenchmarkReport {
  const runs = aggregateBenchmarkRuns(history);
  const latestByModel = new Map<string, BenchmarkRunSummary>();
  for (const run of runs) latestByModel.set(run.model, run);
  const latest = Array.from(latestByModel.values()).sort(
    (a, b) => b.score - a.score || a.latencyMs - b.latencyMs || a.model.localeCompare(b.model)
  );
  const regressions = detectRegressions(history, threshold);
  const regressed = new Set(regressions.map((entry) => entry.model));
  const recommended = latest.find((run) => !regressed.has(run.model));
  const recommendation = recommended
    ? `Prefer ${recommended.model} (latest capability score ${(recommended.score * 100).toFixed(0)}%).`
    : latest.length > 0
      ? 'All measured models regressed; investigate provider health before routing new work.'
      : 'Run `buddy improve bench --run` to establish a capability baseline.';
  return { latest, regressions, recommendation };
}

/** Render one simple ASCII bar per model/run, suitable for `--history`. */
export function renderBenchmarkHistory(
  history: readonly BenchmarkHistoryEntry[],
  model?: string
): string {
  const wanted = model?.trim().toLowerCase();
  const runs = aggregateBenchmarkRuns(history).filter(
    (run) => !wanted || run.model.toLowerCase() === wanted
  );
  if (runs.length === 0) {
    return wanted ? `No capability history for ${model}.` : 'No capability history yet.';
  }
  return runs
    .map((run) => {
      const width = Math.round(run.score * 20);
      const bar = `${'#'.repeat(width)}${'.'.repeat(20 - width)}`;
      return `${run.ts}  ${run.model.padEnd(24)} [${bar}] ${(run.score * 100).toFixed(0)}%`;
    })
    .join('\n');
}

/** Execute the curated capability scenarios against every selected active model. */
export async function runBenchmark(
  options: RunBenchmarkOptions = {}
): Promise<ContinuousBenchmarkResult> {
  const env = options.env ?? process.env;
  if (env.CODEBUDDY_SELF_BENCH !== 'true') {
    throw new Error('Self-benchmark is opt-in. Set CODEBUDDY_SELF_BENCH=true to run.');
  }

  const timeoutMs = positiveNumber(
    env.CODEBUDDY_SELF_BENCH_TIMEOUT_MS,
    DEFAULT_SELF_BENCH_TIMEOUT_MS
  );
  const scenarioLimit =
    options.scenarios === undefined || !Number.isFinite(options.scenarios)
      ? SEED_BENCHMARK_SCENARIOS.length
      : Math.max(1, Math.floor(options.scenarios));
  const scenarios = SEED_BENCHMARK_SCENARIOS.slice(0, scenarioLimit);
  const names = selectedModelNames(options.models);
  const provider = options.provider?.trim().toLowerCase();
  const pool = options.modelPool ?? (await listActiveLlmModelPool({ env }));
  const candidates = pool.filter(
    (candidate) =>
      (!names || names.has(candidate.model.toLowerCase())) &&
      (!provider || candidate.provider.toLowerCase() === provider)
  );
  const file = historyPath(env);
  const runId = options.runId ?? randomUUID();
  const now = options.now ?? (() => new Date());
  const monotonicNow = options.monotonicNow ?? (() => performance.now());
  const factory = options.clientFactory ?? defaultClientFactory;
  const scoreboard = options.scoreboard ?? getModelScoreboard();
  const modelResults: BenchmarkModelResult[] = [];

  for (const candidate of candidates) {
    const client = options.client ?? (await factory(candidate));
    const entries: BenchmarkHistoryEntry[] = [];
    for (const scenario of scenarios) {
      const started = monotonicNow();
      let status: BenchmarkHistoryEntry['status'] = 'ok';
      let response = '';
      try {
        const raw = await chatWithTimeout(
          client,
          {
            candidate,
            scenario,
            prompt: buildScenarioPrompt(scenario),
          },
          timeoutMs
        );
        response = extractText(raw);
      } catch (error) {
        status = error instanceof ScenarioTimeoutError ? 'timeout' : 'error';
        logger.warn('[continuous-benchmark] scenario failed', {
          model: candidate.model,
          provider: candidate.provider,
          scenario: scenario.id,
          status,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      const latencyMs = Math.max(0, Math.round(monotonicNow() - started));
      const entry: BenchmarkHistoryEntry = {
        runId,
        model: candidate.model,
        provider: candidate.provider,
        scenario: scenario.id,
        score: status === 'ok' ? scoreScenario(scenario, response) : 0,
        latencyMs,
        ts: now().toISOString(),
        benchVersion: CONTINUOUS_BENCHMARK_VERSION,
        status,
      };
      await appendHistory(file, entry);
      entries.push(entry);
    }

    const score = entries.reduce((sum, entry) => sum + entry.score, 0) / entries.length;
    const latencyMs = entries.reduce((sum, entry) => sum + entry.latencyMs, 0);
    const summary: BenchmarkModelResult = {
      runId,
      model: candidate.model,
      provider: candidate.provider,
      ts: entries[entries.length - 1]!.ts,
      score,
      latencyMs,
      scenarios: entries.length,
      entries,
    };
    modelResults.push(summary);
    scoreboard.recordOutcome({
      at: summary.ts,
      taskType: 'benchmark',
      model: candidate.model,
      provider: candidate.provider,
      won: score >= 0.5,
      quality: score,
      latencyMs,
      costUsd: 0,
      ...(entries.every((entry) => entry.status !== 'ok') ? { failed: true } : {}),
    });
  }

  const fullHistory = await readBenchmarkHistory(env);
  return {
    runId,
    historyPath: file,
    models: modelResults,
    regressions: detectRegressions(fullHistory, dropThreshold(env)),
  };
}
