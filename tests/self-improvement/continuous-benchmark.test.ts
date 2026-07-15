import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { loggerError } = vi.hoisted(() => ({ loggerError: vi.fn() }));
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    error: loggerError,
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import {
  CONTINUOUS_BENCHMARK_VERSION,
  detectRegressions,
  runBenchmark,
  type BenchmarkHistoryEntry,
  type BenchmarkLlmClient,
} from '../../src/agent/self-improvement/continuous-benchmark.js';
import { registerImproveCommands } from '../../src/commands/cli/improve-command.js';
import { ModelScoreboard } from '../../src/fleet/model-scoreboard.js';
import type { ActiveLlmModelPoolEntry } from '../../src/providers/active-llm-model-pool.js';

const tempDirs: string[] = [];
let previousOptIn: string | undefined;
let previousExitCode: number | string | undefined;

function historyEntry(
  run: number,
  score: number,
  model = 'model-a',
  scenario = 'scenario-a'
): BenchmarkHistoryEntry {
  return {
    runId: `run-${run}`,
    model,
    provider: 'test-provider',
    scenario,
    score,
    latencyMs: 10,
    ts: new Date(Date.UTC(2026, 0, run + 1)).toISOString(),
    benchVersion: CONTINUOUS_BENCHMARK_VERSION,
    status: 'ok',
  };
}

function candidate(model: string, provider = 'test-provider'): ActiveLlmModelPoolEntry {
  return {
    provider,
    model,
    apiKey: 'test-key',
    baseURL: 'https://example.test/v1',
    egress: 'cloud',
    costInputUsdPerMtok: 0,
  };
}

async function tempPath(file: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'continuous-benchmark-'));
  tempDirs.push(dir);
  return join(dir, file);
}

beforeEach(() => {
  previousOptIn = process.env.CODEBUDDY_SELF_BENCH;
  previousExitCode = process.exitCode;
  process.exitCode = 0;
  loggerError.mockReset();
});

afterEach(async () => {
  if (previousOptIn === undefined) delete process.env.CODEBUDDY_SELF_BENCH;
  else process.env.CODEBUDDY_SELF_BENCH = previousOptIn;
  process.exitCode = previousExitCode;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('detectRegressions', () => {
  it('returns no regression for a stable nominal history and aggregates scenarios per run', () => {
    const history = [
      historyEntry(0, 1, 'model-a', 'a'),
      historyEntry(0, 0.8, 'model-a', 'b'),
      historyEntry(1, 0.9, 'model-a', 'a'),
      historyEntry(1, 0.9, 'model-a', 'b'),
    ];

    expect(detectRegressions(history)).toEqual([]);
  });

  it('detects a sharp relative score drop against the preceding moving average', () => {
    const history = [0.9, 1, 0.8, 0.9, 1, 0.5].map((score, run) => historyEntry(run, score));

    const regressions = detectRegressions(history);

    expect(regressions).toHaveLength(1);
    expect(regressions[0]!.model).toBe('model-a');
    expect(regressions[0]!.before).toBeCloseTo(0.92);
    expect(regressions[0]!.after).toBe(0.5);
    expect(regressions[0]!.drop).toBeCloseTo((0.92 - 0.5) / 0.92);
  });

  it('ignores noise below the relative drop threshold', () => {
    expect(detectRegressions([historyEntry(0, 1), historyEntry(1, 0.86)])).toEqual([]);
  });

  it('does not issue a verdict with fewer than two aggregate runs', () => {
    expect(
      detectRegressions([
        historyEntry(0, 0.2, 'model-a', 'a'),
        historyEntry(0, 0.1, 'model-a', 'b'),
      ])
    ).toEqual([]);
  });
});

describe('runBenchmark', () => {
  it('filters --models, writes one valid JSONL record per scenario, and feeds the existing scoreboard API', async () => {
    const historyFile = await tempPath('history.jsonl');
    const scoreboardFile = await tempPath('scoreboard.jsonl');
    const scoreboard = new ModelScoreboard(scoreboardFile);
    const recordOutcome = vi.spyOn(scoreboard, 'recordOutcome');
    const client: BenchmarkLlmClient = {
      chat: vi.fn(async ({ scenario }) => scenario.expectIncludes[0] ?? ''),
    };

    const result = await runBenchmark({
      env: {
        CODEBUDDY_SELF_BENCH: 'true',
        CODEBUDDY_SELF_BENCH_HISTORY: historyFile,
      },
      models: 'model-b',
      scenarios: 2,
      modelPool: [candidate('model-a'), candidate('model-b')],
      client,
      scoreboard,
      runId: 'fixed-run',
      now: () => new Date('2026-07-15T12:00:00.000Z'),
    });

    expect(result.models.map((entry) => entry.model)).toEqual(['model-b']);
    expect(result.models[0]!.score).toBe(1);
    expect(client.chat).toHaveBeenCalledTimes(2);

    const lines = (await readFile(historyFile, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(2);
    const parsed = lines.map((line) => JSON.parse(line) as BenchmarkHistoryEntry);
    expect(parsed).toEqual([
      expect.objectContaining({
        runId: 'fixed-run',
        model: 'model-b',
        scenario: 'npm-test-path-filter',
        score: 1,
        benchVersion: CONTINUOUS_BENCHMARK_VERSION,
      }),
      expect.objectContaining({
        runId: 'fixed-run',
        model: 'model-b',
        scenario: 'esm-js-extension-imports',
        score: 1,
        benchVersion: CONTINUOUS_BENCHMARK_VERSION,
      }),
    ]);

    expect(recordOutcome).toHaveBeenCalledOnce();
    expect(recordOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        taskType: 'benchmark',
        model: 'model-b',
        provider: 'test-provider',
        quality: 1,
        won: true,
      })
    );
    const parsedByExistingScoreboard = new ModelScoreboard(scoreboardFile);
    expect(parsedByExistingScoreboard.runCount('benchmark', 'model-b')).toBe(1);
    expect(parsedByExistingScoreboard.ranking('benchmark')[0]).toEqual(
      expect.objectContaining({
        model: 'model-b',
        avgQuality: 1,
      })
    );
  });

  it('times out each scenario using CODEBUDDY_SELF_BENCH_TIMEOUT_MS and records a zero', async () => {
    const historyFile = await tempPath('timeout-history.jsonl');
    const neverResolvingClient: BenchmarkLlmClient = {
      chat: vi.fn(() => new Promise(() => {})),
    };
    const recordOutcome = vi.fn();

    const result = await runBenchmark({
      env: {
        CODEBUDDY_SELF_BENCH: 'true',
        CODEBUDDY_SELF_BENCH_HISTORY: historyFile,
        CODEBUDDY_SELF_BENCH_TIMEOUT_MS: '5',
      },
      scenarios: 1,
      modelPool: [candidate('slow-model')],
      client: neverResolvingClient,
      scoreboard: { recordOutcome },
    });

    expect(result.models[0]!.entries[0]).toEqual(
      expect.objectContaining({
        model: 'slow-model',
        score: 0,
        status: 'timeout',
      })
    );
    expect(recordOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'slow-model',
        quality: 0,
        failed: true,
      })
    );
  });
});

describe('buddy improve bench CLI', () => {
  it('fails closed with exit 1 and an actionable message without the opt-in env var', async () => {
    delete process.env.CODEBUDDY_SELF_BENCH;
    const program = new Command();
    program.exitOverride();
    program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
    registerImproveCommands(program);

    await program.parseAsync(['node', 'buddy', 'improve', 'bench', '--report']);

    expect(process.exitCode).toBe(1);
    expect(loggerError).toHaveBeenCalledWith(expect.stringContaining('CODEBUDDY_SELF_BENCH=true'));
  });
});
