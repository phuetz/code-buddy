/** Read-only latency comparison for Lisa's local expressive and realtime TTS lanes. */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { synthesizePocketWav } from './local-tts.js';
import { synthesizeVoiceboxWav } from './voicebox-tts.js';

export const DEFAULT_TTS_BENCHMARK_TEXT =
  'Bonjour Patrice. Je peux être à la fois douce, naturelle et précise dans mes explications.';

export interface TtsLatencyAttempt {
  run: number;
  success: boolean;
  latencyMs: number;
  audioBytes?: number;
  error?: string;
}

export interface TtsLatencyResult {
  engine: 'voicebox' | 'pocket';
  attempts: TtsLatencyAttempt[];
  successes: number;
  averageMs?: number;
  bestMs?: number;
}

export interface TtsLatencyBenchmarkReport {
  generatedAt: string;
  text: string;
  runs: number;
  results: TtsLatencyResult[];
}

interface BenchmarkOptions {
  runs?: number;
  timeoutMs?: number;
  voiceboxSynthesizer?: typeof synthesizeVoiceboxWav;
  pocketSynthesizer?: typeof synthesizePocketWav;
  now?: () => number;
}

function summarize(
  engine: TtsLatencyResult['engine'],
  attempts: TtsLatencyAttempt[]
): TtsLatencyResult {
  const successful = attempts.filter((attempt) => attempt.success);
  const times = successful.map((attempt) => attempt.latencyMs);
  return {
    engine,
    attempts,
    successes: successful.length,
    ...(times.length > 0
      ? {
          averageMs: Math.round(times.reduce((sum, value) => sum + value, 0) / times.length),
          bestMs: Math.min(...times),
        }
      : {}),
  };
}

/**
 * Run bounded, sequential attempts. Sequential execution avoids making a CPU
 * Pocket render contend with Darkstar/network traffic and corrupting the comparison.
 */
export async function runTtsLatencyBenchmark(
  env: NodeJS.ProcessEnv = process.env,
  text = DEFAULT_TTS_BENCHMARK_TEXT,
  options: BenchmarkOptions = {}
): Promise<TtsLatencyBenchmarkReport> {
  const runs = Math.max(1, Math.min(5, Math.round(options.runs ?? 2)));
  const timeoutMs = Math.max(1_000, Math.min(600_000, options.timeoutMs ?? 180_000));
  const voicebox = options.voiceboxSynthesizer ?? synthesizeVoiceboxWav;
  const pocket = options.pocketSynthesizer ?? synthesizePocketWav;
  const now = options.now ?? (() => Date.now());
  const clean = text.trim().slice(0, 2_000) || DEFAULT_TTS_BENCHMARK_TEXT;
  const dir = await mkdtemp(join(tmpdir(), 'codebuddy-tts-benchmark-'));

  const execute = async (
    engine: TtsLatencyResult['engine'],
    run: number
  ): Promise<TtsLatencyAttempt> => {
    const wavPath = join(dir, `${engine}-${run}.wav`);
    const startedAt = now();
    try {
      const success = engine === 'voicebox'
        ? await voicebox(clean, wavPath, env, { timeoutMs })
        : await pocket(clean, wavPath, env, timeoutMs);
      const latencyMs = Math.max(0, Math.round(now() - startedAt));
      if (!success) return { run, success: false, latencyMs };
      const bytes = await readFile(wavPath);
      return { run, success: true, latencyMs, audioBytes: bytes.byteLength };
    } catch (error) {
      return {
        run,
        success: false,
        latencyMs: Math.max(0, Math.round(now() - startedAt)),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };

  try {
    const results: TtsLatencyResult[] = [];
    for (const engine of ['voicebox', 'pocket'] as const) {
      const attempts: TtsLatencyAttempt[] = [];
      for (let run = 1; run <= runs; run += 1) attempts.push(await execute(engine, run));
      results.push(summarize(engine, attempts));
    }
    return {
      generatedAt: new Date().toISOString(),
      text: clean,
      runs,
      results,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
