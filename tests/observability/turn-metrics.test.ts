import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TurnMetricsRecorder,
  aggregateTurnMetrics,
  readTurnMetricsJournal,
  type TurnMetricsClock,
  type TurnMetricsRecord,
} from '../../src/observability/turn-metrics.js';

function fakeClock(values: number[]): TurnMetricsClock {
  return {
    now: vi.fn(() => {
      const value = values.shift();
      if (value === undefined) throw new Error('fake clock exhausted');
      return value;
    }),
    timestamp: () => '2026-09-03T12:00:00.000Z',
  };
}

function record(overrides: Partial<TurnMetricsRecord>): TurnMetricsRecord {
  return {
    version: 1,
    at: '2026-09-03T12:00:00.000Z',
    provider: 'ollama',
    model: 'qwen3:4b-instruct',
    totalMs: 100,
    inputTokens: 10,
    outputTokens: 5,
    totalTokens: 15,
    ...overrides,
  };
}

describe('turn metrics', () => {
  let directory: string;
  let journalPath: string;
  let aggregatePath: string;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'turn-metrics-'));
    journalPath = path.join(directory, 'turn-metrics.jsonl');
    aggregatePath = path.join(directory, 'turn-metrics-summary.json');
  });

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  it('measures TTFT, TTFM, and total duration with an injected clock', () => {
    const clock = fakeClock([100, 125, 170, 220]);
    const metrics = new TurnMetricsRecorder({ clock, persist: false });
    const turn = metrics.startTurn('ollama', 'qwen3:4b-instruct');

    metrics.markFirstChunk(turn);
    metrics.markFirstMessage(turn);
    const completed = metrics.endTurn(turn, { inputTokens: 20, outputTokens: 7 });

    expect(completed).toEqual(record({
      ttftMs: 25,
      ttfmMs: 70,
      totalMs: 120,
      inputTokens: 20,
      outputTokens: 7,
      totalTokens: 27,
    }));
  });

  it('does not invent TTFT when a failed turn receives no chunk', () => {
    const metrics = new TurnMetricsRecorder({
      clock: fakeClock([10, 40]),
      persist: false,
    });
    const turn = metrics.startTurn('openai', 'gpt-5');

    const completed = metrics.endTurn(turn);

    expect(completed.ttftMs).toBeUndefined();
    expect(completed.ttfmMs).toBeUndefined();
    expect(completed.totalMs).toBe(30);
  });

  it('aggregates p50/p95 independently for two providers', () => {
    const rows = [
      record({ provider: 'ollama', ttftMs: 10, ttfmMs: 50 }),
      record({ provider: 'ollama', ttftMs: 20, ttfmMs: 60 }),
      record({ provider: 'ollama', ttftMs: 30, ttfmMs: 70 }),
      record({ provider: 'openai', model: 'gpt-5', ttftMs: 100, ttfmMs: 200 }),
      record({ provider: 'openai', model: 'gpt-5', ttftMs: 120, ttfmMs: 240 }),
    ];

    expect(aggregateTurnMetrics(rows)).toEqual([
      expect.objectContaining({
        provider: 'ollama',
        model: 'qwen3:4b-instruct',
        turns: 3,
        ttftSamples: 3,
        ttftP50Ms: 20,
        ttftP95Ms: 30,
        ttfmSamples: 3,
        ttfmP50Ms: 60,
        ttfmP95Ms: 70,
      }),
      expect.objectContaining({
        provider: 'openai',
        model: 'gpt-5',
        turns: 2,
        ttftSamples: 2,
        ttfmSamples: 2,
      }),
    ]);
  });

  it('ignores a truncated journal line without throwing', async () => {
    await fs.writeFile(
      journalPath,
      `${JSON.stringify(record({ ttftMs: 12, ttfmMs: 34 }))}\n{"provider":"broken`,
      'utf8',
    );

    expect(readTurnMetricsJournal(journalPath)).toEqual([
      record({ ttftMs: 12, ttfmMs: 34 }),
    ]);
  });

  it('appends privacy-safe JSONL and atomically refreshes aggregate state', async () => {
    const metrics = new TurnMetricsRecorder({
      clock: fakeClock([0, 10, 20, 30, 100, 115, 130, 150]),
      journalPath,
      aggregatePath,
    });
    for (let index = 0; index < 2; index += 1) {
      const turn = metrics.startTurn('ollama', 'qwen3:4b-instruct');
      metrics.markFirstChunk(turn);
      metrics.markFirstMessage(turn);
      metrics.endTurn(turn, { inputTokens: 4, outputTokens: 2 });
    }
    await metrics.flush();

    const lines = (await fs.readFile(journalPath, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      const keys = Object.keys(JSON.parse(line) as Record<string, unknown>);
      expect(keys).not.toContain('prompt');
      expect(keys).not.toContain('response');
      expect(keys).not.toContain('content');
    }
    const summary = JSON.parse(await fs.readFile(aggregatePath, 'utf8')) as {
      aggregates: Array<{ turns: number }>;
    };
    expect(summary.aggregates[0]?.turns).toBe(2);
  });

  it('reads the clock only at lifecycle transitions, never per chunk', () => {
    const clock = fakeClock([0, 10, 20, 30]);
    const metrics = new TurnMetricsRecorder({ clock, persist: false });
    const turn = metrics.startTurn('ollama', 'qwen3:4b-instruct');

    for (let index = 0; index < 10_000; index += 1) metrics.markFirstChunk(turn);
    metrics.markFirstMessage(turn);
    metrics.markFirstMessage(turn);
    metrics.endTurn(turn);
    metrics.endTurn(turn);

    expect(clock.now).toHaveBeenCalledTimes(4);
  });
});
