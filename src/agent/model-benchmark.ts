/**
 * Live model benchmarking for Tailnet Ollama peers.
 *
 * Measures actual request latency and simple compliance signals so the router
 * can prefer the best network model instead of relying on a static ordering.
 * The benchmark is intentionally lightweight: a few objective prompts, temp=0,
 * streamed completions, and a persisted score cache that the model-tier ladder
 * can use to rank candidates.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { normalizeBaseURL } from '../utils/base-url.js';

export interface ModelBenchmarkCandidate {
  model: string;
  baseUrl: string;
  label?: string;
}

export interface ModelBenchmarkPrompt {
  name: string;
  prompt: string;
  maxTokens: number;
  validate: (output: string) => boolean;
}

export interface ModelBenchmarkRun {
  promptName: string;
  success: boolean;
  compliance: boolean;
  ttftMs: number;
  totalMs: number;
  outputChars: number;
  outputTokensEstimate: number;
  error?: string;
  outputPreview?: string;
}

export interface ModelBenchmarkSummary {
  runs: number;
  successes: number;
  complianceRate: number;
  avgTtftMs: number;
  avgTotalMs: number;
  avgOutputTokensEstimate: number;
  score: number;
}

export interface ModelBenchmarkReport {
  candidate: ModelBenchmarkCandidate;
  runs: ModelBenchmarkRun[];
  summary: ModelBenchmarkSummary;
}

export interface ModelBenchmarkIndexEntry {
  model: string;
  baseUrl: string;
  label?: string;
  score: number;
  complianceRate: number;
  avgTtftMs: number;
  avgTotalMs: number;
  updatedAt: string;
}

export interface ModelBenchmarkIndex {
  updatedAt: string;
  suite: string;
  entries: ModelBenchmarkIndexEntry[];
}

export interface BenchmarkExecutionOptions {
  runs?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface BenchmarkSuiteOptions extends BenchmarkExecutionOptions {
  promptSet?: BenchmarkPromptSetName;
}

export type BenchmarkPromptSetName = 'balanced' | 'coding' | 'latency';

export const BENCHMARK_PROMPT_SETS: Record<BenchmarkPromptSetName, ModelBenchmarkPrompt[]> = {
  balanced: [
    {
      name: 'exact-ok',
      prompt: 'Reply with exactly OK and nothing else.',
      maxTokens: 8,
      validate: (output) => output.trim() === 'OK',
    },
    {
      name: 'json-object',
      prompt: 'Return exactly this JSON object and nothing else: {"model":"gpuNode","status":"ok"}',
      maxTokens: 32,
      validate: (output) => {
        try {
          const parsed = JSON.parse(stripCodeFences(output));
          return parsed?.model === 'gpuNode' && parsed?.status === 'ok';
        } catch {
          return false;
        }
      },
    },
    {
      name: 'code-dedupe',
      prompt: 'Write a TypeScript function named dedupeById that removes duplicate objects by id using a Map. Output only the function.',
      maxTokens: 96,
      validate: (output) => /dedupeById/.test(output) && /Map/.test(output) && /return/.test(output),
    },
  ],
  coding: [
    {
      name: 'json-object',
      prompt: 'Return exactly this JSON object and nothing else: {"model":"gpuNode","status":"ok"}',
      maxTokens: 32,
      validate: (output) => {
        try {
          const parsed = JSON.parse(stripCodeFences(output));
          return parsed?.model === 'gpuNode' && parsed?.status === 'ok';
        } catch {
          return false;
        }
      },
    },
    {
      name: 'code-dedupe',
      prompt: 'Write a TypeScript function named dedupeById that removes duplicate objects by id using a Map. Output only the function.',
      maxTokens: 96,
      validate: (output) => /dedupeById/.test(output) && /Map/.test(output) && /return/.test(output),
    },
  ],
  latency: [
    {
      name: 'exact-ok',
      prompt: 'Reply with exactly OK and nothing else.',
      maxTokens: 8,
      validate: (output) => output.trim() === 'OK',
    },
    {
      name: 'short-json',
      prompt: 'Return exactly {"ok":true} and nothing else.',
      maxTokens: 16,
      validate: (output) => {
        try {
          const parsed = JSON.parse(stripCodeFences(output));
          return parsed?.ok === true;
        } catch {
          return false;
        }
      },
    },
  ],
};

export function defaultBenchmarkIndexPath(homeDir = os.homedir()): string {
  return path.join(homeDir, '.codebuddy', 'model-benchmarks.json');
}

export function benchmarkCandidateKey(candidate: ModelBenchmarkCandidate): string {
  return `${normalizeBaseURL(candidate.baseUrl)}::${candidate.model}`;
}

export async function benchmarkCandidates(
  candidates: ModelBenchmarkCandidate[],
  options: BenchmarkSuiteOptions = {},
): Promise<ModelBenchmarkReport[]> {
  const promptSet = options.promptSet ?? 'balanced';
  const prompts = BENCHMARK_PROMPT_SETS[promptSet];
  const runs = Math.max(1, options.runs ?? 1);
  const fetchImpl = options.fetchImpl ?? fetch;

  const reports: ModelBenchmarkReport[] = [];
  for (const candidate of candidates) {
    const candidateRuns: ModelBenchmarkRun[] = [];
    for (let runIndex = 0; runIndex < runs; runIndex += 1) {
      for (const prompt of prompts) {
        candidateRuns.push(await runSinglePrompt(candidate, prompt, fetchImpl, options.timeoutMs));
      }
    }
    reports.push({
      candidate,
      runs: candidateRuns,
      summary: summarizeBenchmarkRuns(candidateRuns),
    });
  }
  return reports;
}

export function summarizeBenchmarkRuns(runs: ModelBenchmarkRun[]): ModelBenchmarkSummary {
  const runsCount = runs.length;
  const successes = runs.filter((run) => run.success).length;
  const complianceRuns = runs.filter((run) => run.success && run.compliance).length;
  const successfulRuns = runs.filter((run) => run.success);
  const avgTtftMs = average(successfulRuns.map((run) => run.ttftMs));
  const avgTotalMs = average(successfulRuns.map((run) => run.totalMs));
  const avgOutputTokensEstimate = average(successfulRuns.map((run) => run.outputTokensEstimate));
  const complianceRate = runsCount > 0 ? complianceRuns / runsCount : 0;

  // Weighted score: correctness dominates, then speed. Higher is better.
  const failurePenalty = (runsCount - successes) * 1000;
  const score = successes === 0
    ? -1_000_000 - failurePenalty
    : (complianceRate * 1000)
      - avgTtftMs
      - (avgTotalMs * 0.5)
      + (successes / Math.max(1, runsCount)) * 100
      - failurePenalty;

  return {
    runs: runsCount,
    successes,
    complianceRate,
    avgTtftMs,
    avgTotalMs,
    avgOutputTokensEstimate,
    score,
  };
}

export async function writeBenchmarkIndex(
  reports: ModelBenchmarkReport[],
  suite: string,
  indexPath = defaultBenchmarkIndexPath(),
): Promise<ModelBenchmarkIndex> {
  const entries: ModelBenchmarkIndexEntry[] = reports
    .map((report) => ({
      model: report.candidate.model,
      baseUrl: normalizeBaseURL(report.candidate.baseUrl),
      ...(report.candidate.label ? { label: report.candidate.label } : {}),
      score: report.summary.score,
      complianceRate: report.summary.complianceRate,
      avgTtftMs: report.summary.avgTtftMs,
      avgTotalMs: report.summary.avgTotalMs,
      updatedAt: new Date().toISOString(),
    }))
    .sort((a, b) => b.score - a.score);

  const index: ModelBenchmarkIndex = {
    updatedAt: new Date().toISOString(),
    suite,
    entries,
  };

  await fs.mkdir(path.dirname(indexPath), { recursive: true });
  await fs.writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
  return index;
}

export async function loadBenchmarkIndex(
  indexPath = defaultBenchmarkIndexPath(),
): Promise<ModelBenchmarkIndex | null> {
  try {
    const raw = await fs.readFile(indexPath, 'utf8');
    const parsed = JSON.parse(raw) as ModelBenchmarkIndex;
    if (!parsed || !Array.isArray(parsed.entries)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function loadBenchmarkScoreMap(
  indexPath = defaultBenchmarkIndexPath(),
): Promise<Map<string, number>> {
  const index = await loadBenchmarkIndex(indexPath);
  const map = new Map<string, number>();
  for (const entry of index?.entries ?? []) {
    map.set(`${normalizeBaseURL(entry.baseUrl)}::${entry.model}`, entry.score);
  }
  return map;
}

async function runSinglePrompt(
  candidate: ModelBenchmarkCandidate,
  prompt: ModelBenchmarkPrompt,
  fetchImpl: typeof fetch,
  timeoutMs?: number,
): Promise<ModelBenchmarkRun> {
  const endpoint = `${normalizeBaseURL(candidate.baseUrl)}/chat/completions`;
  const startedAt = performance.now();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: candidate.model,
        messages: [{ role: 'user', content: prompt.prompt }],
        temperature: 0,
        max_tokens: prompt.maxTokens,
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal: AbortSignal.timeout(timeoutMs ?? 60_000),
    });

    if (!response.ok || !response.body) {
      const body = await safeText(response);
      return failureRun(prompt.name, startedAt, `HTTP ${response.status}: ${body.slice(0, 200)}`);
    }

    const streamed = await readOpenAIChatStream(response, startedAt);
    const totalMs = performance.now() - startedAt;
    const compliance = prompt.validate(streamed.output);
    return {
      promptName: prompt.name,
      success: true,
      compliance,
      ttftMs: streamed.ttftMs ?? totalMs,
      totalMs,
      outputChars: streamed.output.length,
      outputTokensEstimate: streamed.outputTokensEstimate ?? estimateTokens(streamed.output),
      ...(streamed.output.length ? { outputPreview: trimPreview(streamed.output) } : {}),
    };
  } catch (error) {
    return failureRun(
      prompt.name,
      startedAt,
      error instanceof Error ? error.message : String(error),
    );
  }
}

async function readOpenAIChatStream(response: Response, startedAt: number): Promise<{
  output: string;
  ttftMs: number | null;
  outputTokensEstimate: number | null;
}> {
  const reader = response.body?.getReader();
  if (!reader) {
    return { output: '', ttftMs: null, outputTokensEstimate: null };
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let output = '';
  let ttftMs: number | null = null;
  let firstContentSeen = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const rawLine = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      const line = rawLine.trim();
      if (line.startsWith('data:')) {
        const payload = line.slice(5).trim();
        if (payload && payload !== '[DONE]') {
          try {
            const parsed = JSON.parse(payload) as {
              choices?: Array<{ delta?: { content?: string } }>;
              usage?: { completion_tokens?: number };
            };
            const delta = parsed.choices?.[0]?.delta?.content ?? '';
            if (delta) {
              output += delta;
              if (!firstContentSeen) {
                ttftMs = performance.now() - startedAt;
                firstContentSeen = true;
              }
            }
          } catch {
            // Ignore malformed SSE frames and continue reading the stream.
          }
        }
      }
      newlineIndex = buffer.indexOf('\n');
    }
  }

  return {
    output,
    ttftMs,
    outputTokensEstimate: estimateTokens(output),
  };
}

function failureRun(promptName: string, startedAt: number, error: string): ModelBenchmarkRun {
  const totalMs = performance.now() - startedAt;
  return {
    promptName,
    success: false,
    compliance: false,
    ttftMs: totalMs,
    totalMs,
    outputChars: 0,
    outputTokensEstimate: 0,
    error,
  };
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.trim().length / 4));
}

function trimPreview(text: string, maxChars = 200): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  return trimmed.length > maxChars ? `${trimmed.slice(0, maxChars)}...` : trimmed;
}

function stripCodeFences(text: string): string {
  return text.trim().replace(/^```(?:json|ts|typescript)?\s*/i, '').replace(/\s*```$/i, '');
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}
