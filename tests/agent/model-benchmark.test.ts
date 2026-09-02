import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  BENCHMARK_PROMPT_SETS,
  benchmarkCandidates,
  benchmarkCandidateKey,
  defaultBenchmarkIndexPath,
  loadBenchmarkIndex,
  loadBenchmarkScoreMap,
  summarizeBenchmarkRuns,
  writeBenchmarkIndex,
} from '../../src/agent/model-benchmark.js';

function streamResponseFromOutput(output: string): Response {
  const encoder = new TextEncoder();
  const chunks = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: output } }] })}\n\n`,
    'data: [DONE]\n\n',
  ];
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
}

describe('model benchmark', () => {
  it('summarizes runs with correctness dominating latency', () => {
    const summary = summarizeBenchmarkRuns([
      { promptName: 'a', success: true, compliance: true, ttftMs: 10, totalMs: 40, outputChars: 2, outputTokensEstimate: 1 },
      { promptName: 'b', success: true, compliance: false, ttftMs: 20, totalMs: 50, outputChars: 2, outputTokensEstimate: 1 },
    ]);

    expect(summary.successes).toBe(2);
    expect(summary.complianceRate).toBe(0.5);
    expect(summary.avgTtftMs).toBe(15);
    expect(summary.avgTotalMs).toBe(45);
    expect(summary.score).toBeLessThan(1000);

    const failureSummary = summarizeBenchmarkRuns([
      { promptName: 'a', success: false, compliance: false, ttftMs: 10, totalMs: 10, outputChars: 0, outputTokensEstimate: 0 },
    ]);
    expect(failureSummary.score).toBeLessThan(-100000);
  });

  it('benchmarks candidates and persists a ranked index', async () => {
    const callCounts: Record<string, number> = { winner: 0, loser: 0 };
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { model?: string };
      const model = body.model ?? '';
      const responses: Record<string, string[]> = {
        winner: [
          'OK',
          '{"model":"gpuNode","status":"ok"}',
          'export function dedupeById(items: Array<{ id: string }>) { const seen = new Map<string, boolean>(); return items; }',
        ],
        loser: [
          'sure thing',
          '{"model":"gpuNode","status":"nope"}',
          'here is some text without the right shape',
        ],
      };
      const queue = responses[model] ?? ['fallback'];
      const index = callCounts[model] ?? 0;
      callCounts[model] = index + 1;
      const output = queue[Math.max(0, Math.min(index, queue.length - 1))] ?? 'fallback';
      return streamResponseFromOutput(output);
    });

    const candidates = [
      { model: 'loser', baseUrl: 'http://example.invalid/v1', label: 'test-peer' },
      { model: 'winner', baseUrl: 'http://example.invalid/v1', label: 'test-peer' },
    ];

    const reports = await benchmarkCandidates(candidates, {
      promptSet: 'balanced',
      runs: 1,
      timeoutMs: 5_000,
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(reports).toHaveLength(2);
    expect(reports[0]?.summary.complianceRate).toBeLessThan(reports[1]?.summary.complianceRate);

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codebuddy-model-bench-'));
    const indexPath = path.join(tempDir, 'model-benchmarks.json');
    const index = await writeBenchmarkIndex(reports, 'balanced', indexPath);
    expect(index.entries[0]?.model).toBe('winner');
    expect(await loadBenchmarkIndex(indexPath)).toMatchObject({
      suite: 'balanced',
      entries: expect.any(Array),
    });
    const scoreMap = await loadBenchmarkScoreMap(indexPath);
    expect(scoreMap.get(benchmarkCandidateKey(candidates[1]!))).toBeGreaterThan(scoreMap.get(benchmarkCandidateKey(candidates[0]!)) ?? -Infinity);
  });

  it('exposes the benchmark prompt sets', () => {
    expect(BENCHMARK_PROMPT_SETS.balanced.length).toBeGreaterThan(0);
    expect(defaultBenchmarkIndexPath()).toContain('.codebuddy');
  });
});
