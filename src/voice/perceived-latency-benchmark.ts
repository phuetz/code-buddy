/**
 * End-to-end perceived voice latency benchmark.
 *
 * Unlike the whole-WAV renderer benchmark, this exercises the same instant
 * prefetch → hybrid stream → sentence assembler → progressive TTS boundary as
 * Lisa's resident voice loop. Audio is consumed into a null sink: no speakers,
 * Telegram message, or avatar event is produced, but first byte / first PCM and
 * full generation are measured from the real HTTP response.
 */
import {
  defaultPrefetchCachePath,
  loadPrefetchCache,
  matchPrefetchedDetailed,
} from '../companion/prefetch-engine.js';
import {
  defaultPrefetchItemsPath,
  loadPrefetchItems,
} from '../companion/prefetch-config.js';
import { makeHybridReply } from '../sensory/hybrid-reply.js';
import { DEFAULT_SENTENCE_CAP } from '../sensory/voice-stream.js';
import {
  makeVoiceReply,
  type StreamSpeakFn,
  type VoiceReplyTiming,
} from '../sensory/voice-loop.js';
import { openPocketAudioStream } from './local-tts.js';
import { openVoiceboxAudioStream } from './voicebox-tts.js';

export type PerceivedLatencyEngine = 'voicebox' | 'pocket';

export const DEFAULT_PERCEIVED_VOICE_QUERY =
  "Lisa, quelles sont les actualités importantes aujourd'hui ?";

export interface PerceivedLatencyAttempt {
  run: number;
  success: boolean;
  mode: VoiceReplyTiming['mode'];
  firstTextMs?: number;
  firstSegmentMs?: number;
  firstByteMs?: number;
  firstAudioMs?: number;
  totalMs: number;
  streamRequests: number;
  audioChunks: number;
  audioBytes: number;
  spokenSegments: number;
  error?: string;
}

export interface PerceivedLatencyResult {
  engine: PerceivedLatencyEngine;
  attempts: PerceivedLatencyAttempt[];
  successes: number;
  averageFirstAudioMs?: number;
  bestFirstAudioMs?: number;
  averageTotalMs?: number;
}

export interface PerceivedVoiceLatencyReport {
  generatedAt: string;
  query: string;
  cacheHit: boolean;
  cacheFreshness?: 'fresh' | 'stale';
  cacheAgeMs?: number;
  answerChars: number;
  sentenceCap: number;
  runs: number;
  results: PerceivedLatencyResult[];
}

export type BenchmarkAudioOpener = (
  text: string,
  env: NodeJS.ProcessEnv,
  options: { signal?: AbortSignal }
) => Promise<ReadableStream<Uint8Array> | null>;

export interface PerceivedVoiceLatencyOptions {
  runs?: number;
  engines?: PerceivedLatencyEngine[];
  /** Text characters per progressive TTS segment (32–240). */
  sentenceCap?: number;
  /** Deterministic test/diagnostic override. undefined loads the real prefetch cache. */
  prefetchAnswer?: string | null;
  pocketOpener?: BenchmarkAudioOpener;
  voiceboxOpener?: BenchmarkAudioOpener;
}

const MAX_BENCHMARK_AUDIO_BYTES = 128 * 1024 * 1024;

function roundAverage(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function summarize(
  engine: PerceivedLatencyEngine,
  attempts: PerceivedLatencyAttempt[]
): PerceivedLatencyResult {
  const successful = attempts.filter((attempt) => attempt.success);
  const firstAudio = successful.flatMap((attempt) =>
    attempt.firstAudioMs === undefined ? [] : [attempt.firstAudioMs]
  );
  const averageFirstAudioMs = roundAverage(firstAudio);
  const averageTotalMs = roundAverage(successful.map((attempt) => attempt.totalMs));
  return {
    engine,
    attempts,
    successes: successful.length,
    ...(averageFirstAudioMs === undefined ? {} : { averageFirstAudioMs }),
    ...(firstAudio.length === 0 ? {} : { bestFirstAudioMs: Math.min(...firstAudio) }),
    ...(averageTotalMs === undefined ? {} : { averageTotalMs }),
  };
}

function cachedAnswerFor(
  env: NodeJS.ProcessEnv,
  query: string,
  override: string | null | undefined,
  hasOverride: boolean
): { answer: string | null; freshness?: 'fresh' | 'stale'; ageMs?: number } {
  if (hasOverride) return { answer: override?.trim() || null };
  const items = loadPrefetchItems(defaultPrefetchItemsPath(env));
  const cache = loadPrefetchCache(defaultPrefetchCachePath(env));
  const match = matchPrefetchedDetailed(query, {
    items,
    cache,
    now: Date.now(),
    allowStale: true,
  });
  if (!match) return { answer: null };
  return {
    answer: match.answer,
    freshness: match.freshness,
    ageMs: match.ageMs,
  };
}

function streamSpeakIntoNull(
  opener: BenchmarkAudioOpener,
  env: NodeJS.ProcessEnv,
  startedAt: number,
  metrics: {
    firstByteMs?: number;
    streamRequests: number;
    audioChunks: number;
    audioBytes: number;
    error?: string;
  }
): StreamSpeakFn {
  return async (text, options = {}): Promise<boolean> => {
    metrics.streamRequests += 1;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let requestBytes = 0;
    let firstPcm = false;
    try {
      const stream = await opener(text, env, { signal: options.signal });
      if (!stream || options.signal?.aborted) return false;
      reader = stream.getReader();
      while (!options.signal?.aborted) {
        const { done, value } = await reader.read();
        if (done) break;
        if (metrics.firstByteMs === undefined) {
          metrics.firstByteMs = Math.max(0, Date.now() - startedAt);
        }
        metrics.audioChunks += 1;
        metrics.audioBytes += value.byteLength;
        requestBytes += value.byteLength;
        if (metrics.audioBytes > MAX_BENCHMARK_AUDIO_BYTES) {
          metrics.error = 'audio-size-limit';
          await reader.cancel('benchmark audio size limit');
          return false;
        }
        options.onAudioChunk?.(value);
        // A canonical WAV header occupies 44 bytes. Voicebox may deliver the
        // whole file in one chunk; Pocket normally crosses this threshold while
        // the HTTP body is still being generated.
        if (!firstPcm && requestBytes > 44) {
          firstPcm = true;
          options.onFirstAudio?.();
        }
      }
      return firstPcm && !options.signal?.aborted;
    } catch (error) {
      if (!options.signal?.aborted) {
        metrics.error = error instanceof Error ? error.message : String(error);
      }
      return false;
    } finally {
      if (reader) {
        try {
          await reader.cancel();
        } catch {
          /* already consumed/cancelled */
        }
        reader.releaseLock();
      }
    }
  };
}

/**
 * Measure the real cached-answer voice path sequentially for each renderer.
 * Sequential runs avoid GPU/CPU contention and make cold-vs-warm attempts easy
 * to interpret. This function never opens an audio device and never publishes.
 */
export async function runPerceivedVoiceLatencyBenchmark(
  env: NodeJS.ProcessEnv = process.env,
  query = DEFAULT_PERCEIVED_VOICE_QUERY,
  options: PerceivedVoiceLatencyOptions = {}
): Promise<PerceivedVoiceLatencyReport> {
  const cleanQuery = query.trim().slice(0, 1_000) || DEFAULT_PERCEIVED_VOICE_QUERY;
  const runs = Math.max(1, Math.min(5, Math.round(options.runs ?? 2)));
  const configuredCap = Number(options.sentenceCap ?? env.CODEBUDDY_VOICE_SENTENCE_CAP);
  const sentenceCap = Number.isFinite(configuredCap)
    ? Math.max(32, Math.min(240, Math.floor(configuredCap)))
    : DEFAULT_SENTENCE_CAP;
  const engines = [...new Set(options.engines ?? ['voicebox', 'pocket'])]
    .filter((engine): engine is PerceivedLatencyEngine =>
      engine === 'voicebox' || engine === 'pocket'
    );
  const selectedEngines = engines.length > 0 ? engines : ['pocket'] as PerceivedLatencyEngine[];
  const cache = cachedAnswerFor(
    env,
    cleanQuery,
    options.prefetchAnswer,
    Object.prototype.hasOwnProperty.call(options, 'prefetchAnswer')
  );
  const answer = cache.answer;
  const results: PerceivedLatencyResult[] = [];

  for (const engine of selectedEngines) {
    const attempts: PerceivedLatencyAttempt[] = [];
    for (let run = 1; run <= runs; run += 1) {
      if (!answer) {
        attempts.push({
          run,
          success: false,
          mode: 'silent',
          totalMs: 0,
          streamRequests: 0,
          audioChunks: 0,
          audioBytes: 0,
          spokenSegments: 0,
          error: 'prefetch-cache-miss',
        });
        continue;
      }

      const startedAt = Date.now();
      const metrics: {
        firstByteMs?: number;
        streamRequests: number;
        audioChunks: number;
        audioBytes: number;
        error?: string;
      } = { streamRequests: 0, audioChunks: 0, audioBytes: 0 };
      const opener = engine === 'voicebox'
        ? options.voiceboxOpener ?? ((text, activeEnv, requestOptions) =>
            openVoiceboxAudioStream(text, activeEnv, requestOptions))
        : options.pocketOpener ?? ((text, activeEnv, requestOptions) =>
            openPocketAudioStream(text, activeEnv, requestOptions));
      let timing: VoiceReplyTiming | undefined;
      const hybrid = makeHybridReply({
        fastReply: () => null,
        prefetch: () => answer,
        jokes: () => null,
        classify: () => false,
        chitchat: async () => '',
        // eslint-disable-next-line require-yield -- the prefetch route must make this unreachable
        chitchatStream: async function* () {
          // The prefetch route must make this unreachable.
        },
        agentReply: async () => '',
      });
      const voiceReply = makeVoiceReply({
        replyFn: hybrid,
        streamSpeak: streamSpeakIntoNull(opener, env, startedAt, metrics),
        // Empty deterministic fallbacks ensure the benchmark reports a failed
        // progressive renderer rather than writing or playing temporary audio.
        synth: async () => '',
        play: async () => undefined,
        sentenceCap,
        avatarEnabled: false,
        onTiming: (value) => {
          timing = value;
        },
      });

      try {
        await voiceReply(cleanQuery);
      } catch (error) {
        metrics.error = error instanceof Error ? error.message : String(error);
      }
      const measured = timing ?? voiceReply.lastTiming;
      attempts.push({
        run,
        success: measured?.spoke === true && measured.firstAudioMs !== undefined,
        mode: measured?.mode ?? 'failed',
        ...(measured?.firstTextMs === undefined ? {} : { firstTextMs: measured.firstTextMs }),
        ...(measured?.firstSegmentMs === undefined
          ? {}
          : { firstSegmentMs: measured.firstSegmentMs }),
        ...(metrics.firstByteMs === undefined ? {} : { firstByteMs: metrics.firstByteMs }),
        ...(measured?.firstAudioMs === undefined ? {} : { firstAudioMs: measured.firstAudioMs }),
        totalMs: measured?.totalMs ?? Math.max(0, Date.now() - startedAt),
        streamRequests: metrics.streamRequests,
        audioChunks: metrics.audioChunks,
        audioBytes: metrics.audioBytes,
        spokenSegments: measured?.spoke ? metrics.streamRequests : 0,
        ...(metrics.error ? { error: metrics.error } : {}),
      });
    }
    results.push(summarize(engine, attempts));
  }

  return {
    generatedAt: new Date().toISOString(),
    query: cleanQuery,
    cacheHit: Boolean(answer),
    ...(cache.freshness ? { cacheFreshness: cache.freshness } : {}),
    ...(cache.ageMs === undefined ? {} : { cacheAgeMs: cache.ageMs }),
    answerChars: answer?.length ?? 0,
    sentenceCap,
    runs,
    results,
  };
}
