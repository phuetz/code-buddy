/**
 * Long-format STT — wraps the short-utterance `transcribeWav()` for arbitrarily long
 * audio. The daemon's STT is calibrated for short utterances (20 s worker timeout,
 * VAD, FR filters), so feeding it a 40-minute file would truncate. Instead we let
 * ffmpeg split the audio into fixed-length WAV chunks (16 kHz mono, exactly what STT
 * wants), transcribe each chunk, and reassemble with cumulative, real (ffprobe-measured)
 * timestamp offsets so the output carries accurate `t_start`/`t_end`.
 *
 * The transcriber is injectable (`Transcriber` from speech-reaction) so the reassembly
 * is unit-testable on a REAL ffmpeg-generated WAV without a real STT engine.
 *
 * **Silent-drop hazard (fixed here):** the STT worker's per-request timeout
 * (`CODEBUDDY_SPEECH_WORKER_TIMEOUT_MS`, default 20 000 ms) does NOT throw on expiry —
 * it `resolve('')`. `transcribeLong` cannot distinguish that empty string from genuine
 * silence, so a chunk whose wall-clock decode overruns the timeout is treated as silence
 * (no segment emitted) while `offset` still advances → a gaping hole read as silence.
 * A fully-spoken chunk decodes in a time that scales with its audio length (faster-whisper
 * on CPU can approach real-time under load), so the DEFAULT chunk length is derived to sit
 * safely UNDER the worker's timeout budget (see `defaultChunkSec`). An explicit `chunkSec`
 * is still honoured (caller's choice); only the default is guaranteed budget-safe.
 *
 * @module tools/video/long-transcribe
 */

import { spawn as realSpawn } from 'child_process';
import { mkdtemp, readdir, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { logger } from '../../utils/logger.js';
import type { Transcriber, SpeechRecognitionEngine } from '../../sensory/speech-reaction.js';

/** A transcribed span of audio with real timestamps. */
export interface TimedSegment {
  t_start: number;
  t_end: number;
  said: string;
}

export interface LongTranscribeOptions {
  /** Injectable STT (default: `transcribeWav` from speech-reaction, lazy-loaded). */
  transcriber?: Transcriber;
  /**
   * STT engine PREFERENCE for the DEFAULT transcriber (ignored when `transcriber` is supplied).
   * Default: `resolveVideoSttEngine()` — `auto` (which resolves to the in-process Rust sherpa-rs
   * engine when its binary is built: ~ms/chunk vs faster-whisper's ~500 ms+, and the real fix for
   * the >20 s-chunk silent-drop) UNLESS the user pinned `CODEBUDDY_SPEECH_ENGINE`, which is
   * honoured verbatim. Fallback to faster-whisper is automatic inside `auto`.
   */
  engine?: SpeechRecognitionEngine;
  /**
   * Target chunk length in seconds. Default: derived from the STT worker timeout budget
   * (`defaultChunkSec()`, ~15 s for the 20 s default) so a spoken chunk never overruns the
   * worker timeout and gets silently dropped. An explicit value is honoured verbatim.
   */
  chunkSec?: number;
  /** ffmpeg binary (default 'ffmpeg'). */
  ffmpegBin?: string;
  /** ffprobe binary (default 'ffprobe'). */
  ffprobeBin?: string;
  /** Directory for the temporary chunks (default: a fresh mkdtemp). */
  workDir?: string;
  /** Injectable spawn (tests). */
  spawn?: typeof realSpawn;
}

/**
 * Mirror of speech-reaction's `CODEBUDDY_SPEECH_WORKER_TIMEOUT_MS` default. A chunk whose
 * STT decode exceeds this wall-clock budget is silently resolved as `''` (dropped), so the
 * default chunk duration is kept well under it.
 */
const DEFAULT_WORKER_TIMEOUT_MS = 20_000;
/** Fraction of the worker timeout budget we allow a chunk's decode to consume (25 % margin). */
const CHUNK_BUDGET_FRACTION = 0.75;
/** Clamp the derived default chunk to a sane range regardless of the configured timeout. */
const MIN_DEFAULT_CHUNK_SEC = 8;
const MAX_DEFAULT_CHUNK_SEC = 30;

/**
 * Derive a default chunk length (seconds) that keeps a fully-spoken chunk's STT decode
 * inside the worker timeout budget, so it is never silently dropped as timed-out-⇒-empty.
 * Reads the SAME env var the worker uses (`CODEBUDDY_SPEECH_WORKER_TIMEOUT_MS`) so a tuned
 * timeout scales the chunk with it. Clamped to `[MIN, MAX]`. Pure.
 */
export function defaultChunkSec(): number {
  const raw = Number.parseInt(process.env.CODEBUDDY_SPEECH_WORKER_TIMEOUT_MS ?? '', 10);
  const budgetMs = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_WORKER_TIMEOUT_MS;
  const sec = Math.floor((budgetMs / 1000) * CHUNK_BUDGET_FRACTION);
  return Math.max(MIN_DEFAULT_CHUNK_SEC, Math.min(MAX_DEFAULT_CHUNK_SEC, sec));
}

/**
 * Resolve the STT engine PREFERENCE for the long/video transcription path.
 *
 * When the user has NOT pinned `CODEBUDDY_SPEECH_ENGINE`, the video path prefers `auto`, which
 * resolves (inside `transcribeWav`/`transcribeWavRaw`) to the in-process Rust sherpa-rs engine
 * when its binary is built — ~ms per chunk vs the python faster-whisper's ~500 ms+ and heavy
 * model load. sherpa-rs decodes a chunk in a handful of ms, which is the true fix for the
 * silent-drop hazard (a chunk whose decode overran the 20 s worker timeout was dropped as empty).
 *
 * When the user DID pin the engine, `undefined` is returned so `transcribeWav` honours the env
 * verbatim (the user commands). This does NOT change the GLOBAL STT default: the companion/sensory
 * hot paths keep reading `CODEBUDDY_SPEECH_ENGINE` (faster-whisper unless opted in) — only this
 * batch/video path leans on the faster engine. Fallback to faster-whisper is automatic inside
 * `auto` (sherpa-rs binary/model absent → next engine), so the path never hard-fails. Pure.
 */
export function resolveVideoSttEngine(): SpeechRecognitionEngine | undefined {
  const pinned = process.env.CODEBUDDY_SPEECH_ENGINE?.trim();
  return pinned ? undefined : 'auto';
}

/**
 * Human-readable label of the STT engine PREFERENCE the video path applies (for the debug
 * header of `understandVideo`). Reflects `resolveVideoSttEngine()`: the pinned
 * `CODEBUDDY_SPEECH_ENGINE` when set, else `auto` (sherpa-rs when built, else faster-whisper).
 * Describes the DEFAULT transcriber's choice; an injected transcriber bypasses it.
 */
export function describeVideoSttEngine(): string {
  const pinned = process.env.CODEBUDDY_SPEECH_ENGINE?.trim();
  return pinned || 'auto (sherpa-rs si buildé, sinon faster-whisper)';
}

function runProcess(
  spawn: typeof realSpawn,
  cmd: string,
  args: string[],
  timeoutMs = 5 * 60 * 1000,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (r: { code: number | null; stdout: string; stderr: string }): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    let child: ReturnType<typeof realSpawn>;
    try {
      child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      finish({ code: null, stdout: '', stderr: err instanceof Error ? err.message : String(err) });
      return;
    }
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* gone */
      }
      finish({ code: null, stdout, stderr: `${stderr}\n[timeout ${timeoutMs}ms]` });
    }, timeoutMs);
    child.stdout?.on('data', (d) => (stdout += String(d)));
    child.stderr?.on('data', (d) => (stderr += String(d)));
    child.on('error', (err) => finish({ code: null, stdout, stderr: `${stderr}${err.message}` }));
    child.on('close', (code) => finish({ code, stdout, stderr }));
  });
}

async function probeDuration(spawn: typeof realSpawn, ffprobeBin: string, file: string): Promise<number | null> {
  const { code, stdout } = await runProcess(spawn, ffprobeBin, [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=nw=1:nk=1',
    file,
  ], 30_000);
  if (code !== 0) return null;
  const n = Number.parseFloat(stdout.trim());
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Transcribe a (possibly long) audio/video file into timestamped segments.
 * Splits with ffmpeg into `chunkSec`-long 16 kHz mono WAVs, transcribes each, and
 * accumulates real ffprobe-measured offsets. Returns `[]` on any hard failure
 * (ffmpeg missing, no chunks) — never throws.
 */
export async function transcribeLong(
  audioPath: string,
  options: LongTranscribeOptions = {},
): Promise<TimedSegment[]> {
  const chunkSec = options.chunkSec && options.chunkSec > 0 ? options.chunkSec : defaultChunkSec();
  const ffmpegBin = options.ffmpegBin ?? 'ffmpeg';
  const ffprobeBin = options.ffprobeBin ?? 'ffprobe';
  const spawn = options.spawn ?? realSpawn;

  // Default transcriber: the daemon's `transcribeWav`, but with a video-path engine PREFERENCE
  // (`resolveVideoSttEngine()` → `auto`, i.e. the fast in-process Rust sherpa-rs when built, else
  // faster-whisper) so long transcription runs on the fast engine unless the user pinned
  // `CODEBUDDY_SPEECH_ENGINE`. An injected transcriber (tests / callers) bypasses this entirely.
  // Kept as a lazy import so the STT module only loads when we actually need the default engine.
  let transcriber = options.transcriber;
  if (!transcriber) {
    const { transcribeWav } = await import('../../sensory/speech-reaction.js');
    const engine = options.engine ?? resolveVideoSttEngine();
    transcriber = (wav: string): Promise<string> => transcribeWav(wav, engine);
  }

  let workDir = options.workDir;
  let ownWorkDir = false;
  if (!workDir) {
    workDir = await mkdtemp(join(tmpdir(), 'buddy-longtx-'));
    ownWorkDir = true;
  }

  try {
    // One ffmpeg pass: normalize to 16 kHz mono AND split into chunkSec segments.
    const chunkTemplate = join(workDir, 'chunk_%04d.wav');
    const seg = await runProcess(spawn, ffmpegBin, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', audioPath,
      '-ar', '16000', '-ac', '1',
      '-f', 'segment', '-segment_time', String(chunkSec), '-reset_timestamps', '1',
      chunkTemplate,
    ]);
    if (seg.code !== 0) {
      logger.warn(`[video] ffmpeg segmentation failed (code=${seg.code}): ${seg.stderr.trim().slice(-300)}`);
      return [];
    }

    const chunks = (await readdir(workDir))
      .filter((f) => /^chunk_\d+\.wav$/.test(f))
      .sort();
    if (chunks.length === 0) {
      logger.warn('[video] ffmpeg produced no chunks');
      return [];
    }

    const segments: TimedSegment[] = [];
    let offset = 0;
    for (const chunk of chunks) {
      const chunkPath = join(workDir, chunk);
      let said = '';
      try {
        said = (await transcriber(chunkPath))?.trim() ?? '';
      } catch (err) {
        logger.warn(`[video] transcription failed for ${chunk}: ${err instanceof Error ? err.message : String(err)}`);
      }
      const dur = (await probeDuration(spawn, ffprobeBin, chunkPath)) ?? chunkSec;
      if (said) {
        segments.push({ t_start: round2(offset), t_end: round2(offset + dur), said });
      }
      offset += dur;
    }

    logger.info(`[video] long transcript: ${segments.length} spoken segment(s) across ${chunks.length} chunk(s)`);
    return segments;
  } finally {
    if (ownWorkDir && workDir) {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
