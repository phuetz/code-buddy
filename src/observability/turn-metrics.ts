/** Privacy-safe latency measurements for one streamed LLM request. */

import { constants as fsConstants, promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { performance } from 'node:perf_hooks';
import { readJsonLinesAtomicSync, writeJsonAtomic } from '../utils/atomic-write.js';
import { logger } from '../utils/logger.js';

export interface TurnMetricsClock {
  /** Monotonic milliseconds used only for durations. */
  now(): number;
  /** Wall-clock timestamp used only to identify when the turn happened. */
  timestamp(): string;
}

export interface TurnTokenCounts {
  inputTokens?: number;
  outputTokens?: number;
}

export interface TurnMetricsRecord {
  version: 1;
  at: string;
  provider: string;
  model: string;
  ttftMs?: number;
  ttfmMs?: number;
  totalMs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface TurnMetricsAggregate {
  provider: string;
  model: string;
  turns: number;
  ttftSamples: number;
  ttftP50Ms?: number;
  ttftP95Ms?: number;
  ttfmSamples: number;
  ttfmP50Ms?: number;
  ttfmP95Ms?: number;
  totalTokens: number;
}

export interface TurnMetricsAggregateState {
  version: 1;
  updatedAt: string;
  aggregates: TurnMetricsAggregate[];
}

export interface TurnMetricsRecorderOptions {
  clock?: TurnMetricsClock;
  journalPath?: string;
  aggregatePath?: string;
  /** Disable filesystem writes for pure lifecycle tests. */
  persist?: boolean;
}

export interface ActiveTurnMetrics {
  readonly provider: string;
  readonly model: string;
  readonly at: string;
  readonly startedAt: number;
  firstChunkAt?: number;
  firstMessageAt?: number;
  completed?: TurnMetricsRecord;
}

const defaultClock: TurnMetricsClock = {
  now: () => performance.now(),
  timestamp: () => new Date().toISOString(),
};

export function defaultTurnMetricsJournalPath(): string {
  return path.join(os.homedir(), '.codebuddy', 'turn-metrics.jsonl');
}

export function defaultTurnMetricsAggregatePath(): string {
  return path.join(os.homedir(), '.codebuddy', 'turn-metrics-summary.json');
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isTurnMetricsRecord(value: unknown): value is TurnMetricsRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Partial<TurnMetricsRecord>;
  return item.version === 1
    && typeof item.at === 'string'
    && typeof item.provider === 'string'
    && item.provider.length > 0
    && typeof item.model === 'string'
    && item.model.length > 0
    && finiteNonNegative(item.totalMs)
    && finiteNonNegative(item.inputTokens)
    && finiteNonNegative(item.outputTokens)
    && finiteNonNegative(item.totalTokens)
    && (item.ttftMs === undefined || finiteNonNegative(item.ttftMs))
    && (item.ttfmMs === undefined || finiteNonNegative(item.ttfmMs));
}

function normalizedTokenCount(value: number | undefined): number {
  if (!Number.isFinite(value) || (value ?? 0) < 0) return 0;
  return Math.floor(value ?? 0);
}

function elapsed(startedAt: number, endedAt: number): number {
  return Math.max(0, endedAt - startedAt);
}

function percentile(values: readonly number[], quantile: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(quantile * sorted.length) - 1);
  return sorted[index];
}

/** Aggregate exact p50/p95 values by the full provider/model identity. */
export function aggregateTurnMetrics(
  records: readonly TurnMetricsRecord[],
): TurnMetricsAggregate[] {
  const groups = new Map<string, TurnMetricsRecord[]>();
  for (const record of records) {
    const key = `${record.provider}\0${record.model}`;
    const group = groups.get(key) ?? [];
    group.push(record);
    groups.set(key, group);
  }

  return [...groups.values()].map((group) => {
    const first = group[0]!;
    const ttft = group.flatMap((record) =>
      record.ttftMs === undefined ? [] : [record.ttftMs],
    );
    const ttfm = group.flatMap((record) =>
      record.ttfmMs === undefined ? [] : [record.ttfmMs],
    );
    const ttftP50Ms = percentile(ttft, 0.5);
    const ttftP95Ms = percentile(ttft, 0.95);
    const ttfmP50Ms = percentile(ttfm, 0.5);
    const ttfmP95Ms = percentile(ttfm, 0.95);
    return {
      provider: first.provider,
      model: first.model,
      turns: group.length,
      ttftSamples: ttft.length,
      ...(ttftP50Ms === undefined ? {} : { ttftP50Ms }),
      ...(ttftP95Ms === undefined ? {} : { ttftP95Ms }),
      ttfmSamples: ttfm.length,
      ...(ttfmP50Ms === undefined ? {} : { ttfmP50Ms }),
      ...(ttfmP95Ms === undefined ? {} : { ttfmP95Ms }),
      totalTokens: group.reduce((sum, record) => sum + record.totalTokens, 0),
    };
  });
}

/** The JSONL journal is authoritative; malformed/torn lines are ignored. */
export function readTurnMetricsJournal(
  journalPath: string = defaultTurnMetricsJournalPath(),
): TurnMetricsRecord[] {
  return readJsonLinesAtomicSync(journalPath, [], isTurnMetricsRecord);
}

export function readTurnMetricsAggregates(
  journalPath: string = defaultTurnMetricsJournalPath(),
): TurnMetricsAggregate[] {
  return aggregateTurnMetrics(readTurnMetricsJournal(journalPath));
}

export class TurnMetricsRecorder {
  private readonly clock: TurnMetricsClock;
  private readonly journalPath: string;
  private readonly aggregatePath: string;
  private readonly persist: boolean;
  private pendingPersistence: Promise<void> = Promise.resolve();

  constructor(options: TurnMetricsRecorderOptions = {}) {
    this.clock = options.clock ?? defaultClock;
    this.journalPath = options.journalPath ?? defaultTurnMetricsJournalPath();
    this.aggregatePath = options.aggregatePath ?? defaultTurnMetricsAggregatePath();
    this.persist = options.persist ?? true;
  }

  startTurn(provider: string, model: string): ActiveTurnMetrics {
    return {
      provider,
      model,
      at: this.clock.timestamp(),
      startedAt: this.clock.now(),
    };
  }

  markFirstChunk(turn: ActiveTurnMetrics): void {
    if (turn.completed || turn.firstChunkAt !== undefined) return;
    turn.firstChunkAt = this.clock.now();
  }

  markFirstMessage(turn: ActiveTurnMetrics): void {
    if (turn.completed || turn.firstMessageAt !== undefined) return;
    turn.firstMessageAt = this.clock.now();
  }

  endTurn(turn: ActiveTurnMetrics, tokens: TurnTokenCounts = {}): TurnMetricsRecord {
    if (turn.completed) return turn.completed;
    const endedAt = this.clock.now();
    const inputTokens = normalizedTokenCount(tokens.inputTokens);
    const outputTokens = normalizedTokenCount(tokens.outputTokens);
    const completed: TurnMetricsRecord = {
      version: 1,
      at: turn.at,
      provider: turn.provider,
      model: turn.model,
      ...(turn.firstChunkAt === undefined
        ? {}
        : { ttftMs: elapsed(turn.startedAt, turn.firstChunkAt) }),
      ...(turn.firstMessageAt === undefined
        ? {}
        : { ttfmMs: elapsed(turn.startedAt, turn.firstMessageAt) }),
      totalMs: elapsed(turn.startedAt, endedAt),
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
    };
    turn.completed = completed;
    if (this.persist) this.enqueuePersistence(completed);
    return completed;
  }

  async flush(): Promise<void> {
    await this.pendingPersistence;
  }

  private enqueuePersistence(record: TurnMetricsRecord): void {
    this.pendingPersistence = this.pendingPersistence
      .then(() => this.persistRecord(record))
      .catch((error: unknown) => {
        logger.warn('[turn-metrics] could not persist latency measurement', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }

  private async persistRecord(record: TurnMetricsRecord): Promise<void> {
    await fs.mkdir(path.dirname(this.journalPath), { recursive: true });
    const handle = await fs.open(
      this.journalPath,
      fsConstants.O_APPEND | fsConstants.O_CREAT | fsConstants.O_WRONLY,
      0o600,
    );
    try {
      await handle.writeFile(`${JSON.stringify(record)}\n`, 'utf8');
    } finally {
      await handle.close();
    }

    const state: TurnMetricsAggregateState = {
      version: 1,
      updatedAt: this.clock.timestamp(),
      aggregates: readTurnMetricsAggregates(this.journalPath),
    };
    await writeJsonAtomic(this.aggregatePath, state, { mode: 0o600 });
  }
}

let defaultRecorder: TurnMetricsRecorder | undefined;

export function getTurnMetricsRecorder(): TurnMetricsRecorder {
  defaultRecorder ??= new TurnMetricsRecorder();
  return defaultRecorder;
}

export function startTurn(provider: string, model: string): ActiveTurnMetrics {
  return getTurnMetricsRecorder().startTurn(provider, model);
}

export function markFirstChunk(turn: ActiveTurnMetrics): void {
  getTurnMetricsRecorder().markFirstChunk(turn);
}

export function markFirstMessage(turn: ActiveTurnMetrics): void {
  getTurnMetricsRecorder().markFirstMessage(turn);
}

export function endTurn(
  turn: ActiveTurnMetrics,
  tokens: TurnTokenCounts = {},
): TurnMetricsRecord {
  return getTurnMetricsRecorder().endTurn(turn, tokens);
}

export async function flushTurnMetrics(): Promise<void> {
  await getTurnMetricsRecorder().flush();
}

/** Test seam for HOME/path isolation. */
export function resetTurnMetricsRecorder(): void {
  defaultRecorder = undefined;
}
