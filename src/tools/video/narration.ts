/**
 * Narration — Piper text-to-speech voiceover for the film producer.
 *
 * Turns a scene's narration TEXT into a spoken WAV via the local Piper binary
 * (offline, $0), then lets the producer bake it into that scene's clip. Design
 * mirrors the rest of `src/tools/video/`: pure argv builders + injectable spawn,
 * fail-open (no Piper / no voice / empty text ⇒ returns null, narration simply
 * skipped — never throws, never blocks a render).
 *
 * The voice model is a Piper `.onnx` (with its `.onnx.json` beside it), resolved
 * from `CODEBUDDY_TTS_VOICE` / `CODEBUDDY_TTS_PIPER_MODEL`. The binary is `piper`
 * on PATH, overridable via `CODEBUDDY_PIPER_BIN`.
 *
 * @module tools/video/narration
 */

import { spawn as realSpawn } from 'child_process';
import { logger } from '../../utils/logger.js';

export interface NarrationResult {
  /** Path to the synthesized WAV. */
  path: string;
  /** Duration in seconds (from ffprobe). */
  duration: number;
}

export interface NarrationDeps {
  spawn?: typeof realSpawn;
  piperBin?: string;
  ffprobeBin?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

const SAMPLE_RATE = 48_000;

/** Resolve the Piper voice model path from the environment (null if unset). */
export function resolvePiperVoice(env: NodeJS.ProcessEnv = process.env): string | null {
  const v = env.CODEBUDDY_TTS_VOICE ?? env.CODEBUDDY_TTS_PIPER_MODEL ?? '';
  return v.trim() ? v.trim() : null;
}

/** Piper argv (pure). Reads text from stdin, writes a WAV to `outPath`. */
export function buildPiperArgs(model: string, outPath: string): string[] {
  return ['--model', model, '--output_file', outPath];
}

/**
 * ffmpeg argv to bake a narration WAV into a clip's audio track (pure): the
 * narration is delayed by `leadSec`, padded with silence and trimmed to exactly
 * `duration` s, so it sits centered in the clip and adjacent-clip crossfades
 * only ever touch silence. Video is copied (no re-encode).
 */
export function buildMuxNarrationArgs(
  clipPath: string,
  wavPath: string,
  outPath: string,
  duration: number,
  leadSec: number
): string[] {
  const leadMs = Math.max(0, Math.round(leadSec * 1000));
  const dur = Math.round(duration * 100) / 100;
  return [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    clipPath,
    '-i',
    wavPath,
    '-filter_complex',
    `[1:a]adelay=${leadMs}:all=1,aformat=sample_rates=${SAMPLE_RATE}:channel_layouts=stereo,apad,atrim=0:${dur}[a]`,
    '-map',
    '0:v',
    '-map',
    '[a]',
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-shortest',
    outPath,
  ];
}

// ---------------------------------------------------------------------------
// I/O runners (injectable)
// ---------------------------------------------------------------------------

interface ProcOut {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Run a process, optionally writing `input` to its stdin. */
function run(
  spawn: typeof realSpawn,
  cmd: string,
  args: string[],
  timeoutMs: number,
  input?: string
): Promise<ProcOut> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (r: ProcOut): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    let child: ReturnType<typeof realSpawn>;
    try {
      child = spawn(cmd, args, {
        stdio: [input !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      });
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
      finish({ code: null, stdout, stderr: `${stderr}\n[timeout]` });
    }, timeoutMs);
    child.stdout?.on('data', (d) => (stdout = `${stdout}${String(d)}`.slice(-200_000)));
    child.stderr?.on('data', (d) => (stderr = `${stderr}${String(d)}`.slice(-200_000)));
    child.on('error', (err) => finish({ code: null, stdout, stderr: `${stderr}${err.message}` }));
    child.on('close', (code) => finish({ code, stdout, stderr }));
    if (input !== undefined) {
      try {
        child.stdin?.write(input);
        child.stdin?.end();
      } catch {
        /* stdin gone — process will error out */
      }
    }
  });
}

async function probeDuration(
  spawn: typeof realSpawn,
  ffprobeBin: string,
  file: string
): Promise<number | null> {
  const { code, stdout } = await run(
    spawn,
    ffprobeBin,
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file],
    20_000
  );
  if (code !== 0) return null;
  const n = Number.parseFloat(stdout.trim());
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Synthesize `text` to a spoken WAV at `outPath` via Piper. Fail-open: returns
 * null when the text is empty, no voice is configured, Piper is missing, or the
 * render fails — the caller then simply proceeds without narration.
 */
export async function synthesizeNarration(
  text: string,
  outPath: string,
  deps: NarrationDeps = {}
): Promise<NarrationResult | null> {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return null;
  const spawn = deps.spawn ?? realSpawn;
  const env = deps.env ?? process.env;
  const piperBin = deps.piperBin ?? env.CODEBUDDY_PIPER_BIN ?? 'piper';
  const ffprobeBin = deps.ffprobeBin ?? 'ffprobe';

  // Active engine: Pocket TTS (Lisa's estelle) when selected, else Piper. Pocket
  // is fail-open too — a failure falls through to Piper below.
  if ((env.CODEBUDDY_TTS_ENGINE ?? '').trim().toLowerCase() === 'pocket') {
    const ok = await synthesizePocketNarration(trimmed, outPath, env, deps.timeoutMs ?? 180_000);
    if (ok) {
      const duration = await probeDuration(spawn, ffprobeBin, outPath);
      if (duration != null) return { path: outPath, duration };
    }
    logger.info('[narration] Pocket TTS unavailable/failed — falling back to Piper');
  }

  const voice = resolvePiperVoice(env);
  if (!voice) {
    logger.info('[narration] no Piper voice configured (CODEBUDDY_TTS_VOICE) — narration skipped');
    return null;
  }

  const { code, stderr } = await run(
    spawn,
    piperBin,
    buildPiperArgs(voice, outPath),
    deps.timeoutMs ?? 60_000,
    `${trimmed}\n`
  );
  if (code !== 0) {
    logger.warn(
      `[narration] Piper synthesis failed (exit ${code}): ${stderr.trim().split('\n').slice(-2).join(' ')}`
    );
    return null;
  }
  const duration = await probeDuration(spawn, ffprobeBin, outPath);
  if (duration == null) {
    logger.warn('[narration] could not probe synthesized narration duration');
    return null;
  }
  return { path: outPath, duration };
}

/**
 * Synthesize `text` to a WAV at `outPath` via Pocket TTS (Lisa's estelle voice).
 * Fail-open: returns false on any error so the caller falls back to Piper.
 * Voice/lang from `CODEBUDDY_POCKET_VOICE` (default estelle) / `CODEBUDDY_POCKET_LANG`
 * (default french).
 */
async function synthesizePocketNarration(
  text: string,
  outPath: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number
): Promise<boolean> {
  try {
    const { PocketTTSProvider } = await import('../../talk-mode/providers/pocket-tts.js');
    const provider = new PocketTTSProvider();
    await provider.initialize({
      provider: 'pocket',
      enabled: true,
      priority: 1,
      settings: {
        voice: env.CODEBUDDY_POCKET_VOICE ?? 'estelle',
        language: env.CODEBUDDY_POCKET_LANG ?? 'french',
        timeoutMs,
      },
    });
    if (!(await provider.isAvailable())) return false;
    const res = await provider.synthesize(text);
    if (!res?.audio?.length) return false;
    const { writeFileSync } = await import('node:fs');
    writeFileSync(outPath, res.audio);
    return true;
  } catch {
    return false;
  }
}

/** Bake a narration WAV into a clip's audio (silence-padded to `duration`). */
export async function muxNarration(
  clipPath: string,
  wavPath: string,
  outPath: string,
  duration: number,
  leadSec: number,
  deps: NarrationDeps = {}
): Promise<boolean> {
  const spawn = deps.spawn ?? realSpawn;
  const ffmpegBin = deps.env?.CODEBUDDY_FFMPEG_BIN ?? 'ffmpeg';
  const { code } = await run(
    spawn,
    ffmpegBin,
    buildMuxNarrationArgs(clipPath, wavPath, outPath, duration, leadSec),
    deps.timeoutMs ?? 5 * 60 * 1000
  );
  return code === 0;
}
