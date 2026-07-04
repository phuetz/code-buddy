/**
 * Media fetch — the yt-dlp fallback leg of the video-understanding cascade. Downloads
 * a source's audio track as a 16 kHz mono WAV (exactly what the local Whisper STT
 * wants) into `.codebuddy/video/`.
 *
 * yt-dlp is an optional, user-installed binary. Resolution order:
 *   1. `CODEBUDDY_YTDLP_BIN` (explicit path, `~` expanded) if it exists,
 *   2. `yt-dlp` on `PATH` (`which`),
 *   3. `python3 -m yt_dlp` (the pip install exposes the module even without a shim).
 * When none resolve we return a clear, actionable error — we NEVER throw or crash the
 * agent. All the OS-touching bits (env / existsSync / which / spawn) are injectable so
 * the resolution and the built command line are unit-testable without a real yt-dlp.
 *
 * @module tools/video/media-fetch
 */

import { spawn as realSpawn } from 'child_process';
import { existsSync as realExistsSync } from 'fs';
import { execFileSync } from 'child_process';
import { homedir } from 'os';
import { join } from 'path';
import { logger } from '../../utils/logger.js';

export interface DownloadOk {
  wavPath: string;
}

export interface DownloadErr {
  error: string;
}

export type DownloadResult = DownloadOk | DownloadErr;

/** A resolved yt-dlp invocation: the base command plus any leading args (`-m yt_dlp`). */
export interface YtdlpInvocation {
  cmd: string;
  baseArgs: string[];
  /** Human label for logs/errors. */
  label: string;
}

export interface MediaFetchDeps {
  spawn?: typeof realSpawn;
  existsSync?: (path: string) => boolean;
  /** Resolve a binary on PATH → absolute path, or null. Default: `which`/`where`. */
  which?: (bin: string) => string | null;
  env?: NodeJS.ProcessEnv;
  /** Timeout for the download in ms (default 10 min). */
  timeoutMs?: number;
}

const YTDLP_HINT = 'yt-dlp introuvable — installe-le (pip install -U yt-dlp) puis réessaie.';

function expandHome(value: string): string {
  if (value === '~') return homedir();
  if (value.startsWith('~/')) return join(homedir(), value.slice(2));
  return value;
}

function defaultWhich(bin: string): string | null {
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    const out = execFileSync(cmd, [bin], { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    return out || null;
  } catch {
    return null;
  }
}

/**
 * Resolve how to invoke yt-dlp, or `null` when it can't be found. Pure + injectable.
 */
export function resolveYtdlp(deps: MediaFetchDeps = {}): YtdlpInvocation | null {
  const env = deps.env ?? process.env;
  const existsSync = deps.existsSync ?? realExistsSync;
  const which = deps.which ?? defaultWhich;

  const explicit = env.CODEBUDDY_YTDLP_BIN?.trim();
  if (explicit) {
    const expanded = expandHome(explicit);
    if (existsSync(expanded)) {
      return { cmd: expanded, baseArgs: [], label: expanded };
    }
    logger.warn(`[video] CODEBUDDY_YTDLP_BIN="${explicit}" does not exist — falling back to PATH resolution`);
  }

  const onPath = which('yt-dlp');
  if (onPath) {
    return { cmd: onPath, baseArgs: [], label: onPath };
  }

  // Last resort: the pip-installed module, invoked through python.
  const python = which('python3') ?? which('python');
  if (python) {
    return { cmd: python, baseArgs: ['-m', 'yt_dlp'], label: `${python} -m yt_dlp` };
  }

  return null;
}

/**
 * Build the argv (excluding the base command) for a 16 kHz mono WAV extraction.
 * `outputTemplate` is a yt-dlp `-o` template ending in `.%(ext)s`.
 */
export function buildYtdlpArgs(source: string, outputTemplate: string): string[] {
  return [
    '-x',
    '--audio-format',
    'wav',
    '--postprocessor-args',
    '-ar 16000 -ac 1',
    '--no-playlist',
    '-o',
    outputTemplate,
    source,
  ];
}

/**
 * Download `source`'s audio as a 16 kHz mono WAV into `outDir`. Returns `{ wavPath }`
 * on success or `{ error }` (yt-dlp missing, non-zero exit, spawn failure, timeout).
 * Never throws.
 */
export async function downloadAudioWav(
  source: string,
  outDir: string,
  deps: MediaFetchDeps = {},
): Promise<DownloadResult> {
  const invocation = resolveYtdlp(deps);
  if (!invocation) {
    return { error: YTDLP_HINT };
  }

  const spawn = deps.spawn ?? realSpawn;
  const timeoutMs = deps.timeoutMs ?? 10 * 60 * 1000;

  // Deterministic base name so the resulting WAV path is known up front (yt-dlp
  // replaces %(ext)s with `wav` under `--audio-format wav`).
  const base = `ytdl-audio-${Date.now()}`;
  const outputTemplate = join(outDir, `${base}.%(ext)s`);
  const wavPath = join(outDir, `${base}.wav`);
  const args = [...invocation.baseArgs, ...buildYtdlpArgs(source, outputTemplate)];

  logger.info(`[video] downloading audio via ${invocation.label}: ${source}`);

  return new Promise<DownloadResult>((resolve) => {
    let settled = false;
    const finish = (result: DownloadResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    let stderr = '';
    let child: ReturnType<typeof realSpawn>;
    try {
      child = spawn(invocation.cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      finish({ error: `yt-dlp spawn failed: ${err instanceof Error ? err.message : String(err)}` });
      return;
    }

    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
      finish({ error: `yt-dlp timed out after ${timeoutMs}ms` });
    }, timeoutMs);

    child.stderr?.on('data', (d) => {
      stderr = `${stderr}${String(d)}`.slice(-4000);
    });

    child.on('error', (err) => {
      finish({ error: `yt-dlp failed to run (${invocation.label}): ${err instanceof Error ? err.message : String(err)}. ${YTDLP_HINT}` });
    });

    child.on('close', (code) => {
      if (code === 0) {
        finish({ wavPath });
      } else {
        finish({ error: `yt-dlp exited with code ${code}${stderr.trim() ? `: ${stderr.trim().slice(-500)}` : ''}` });
      }
    });
  });
}

/** Type guard: did the download succeed? */
export function isDownloadOk(result: DownloadResult): result is DownloadOk {
  return 'wavPath' in result;
}

// ---------------------------------------------------------------------------
// Video download (Phase 2 `--visual`): fetch the picture track for frame sampling.
// ---------------------------------------------------------------------------

export interface VideoDownloadOk {
  videoPath: string;
}
export type VideoDownloadResult = VideoDownloadOk | DownloadErr;

/** Type guard: did the video download succeed? */
export function isVideoDownloadOk(result: VideoDownloadResult): result is VideoDownloadOk {
  return 'videoPath' in result;
}

/**
 * Build the yt-dlp argv (excluding the base command) for a bounded-resolution mp4
 * download. Capped at 480p and recoded to mp4 so the output extension is known up
 * front and the file stays small — we only need it for grayscale keyframe hashing.
 */
export function buildVideoYtdlpArgs(source: string, outputTemplate: string): string[] {
  return [
    '-f',
    'bv*[height<=480]+ba/b[height<=480]/b',
    '--recode-video',
    'mp4',
    '--no-playlist',
    '-o',
    outputTemplate,
    source,
  ];
}

/**
 * Download `source`'s video as a bounded-resolution mp4 into `outDir`. Returns
 * `{ videoPath }` on success or `{ error }` (yt-dlp missing, non-zero exit, spawn
 * failure, timeout). Never throws. Used only by the opt-in `--visual` path.
 */
export async function downloadVideoFile(
  source: string,
  outDir: string,
  deps: MediaFetchDeps = {},
): Promise<VideoDownloadResult> {
  const invocation = resolveYtdlp(deps);
  if (!invocation) {
    return { error: YTDLP_HINT };
  }

  const spawn = deps.spawn ?? realSpawn;
  const timeoutMs = deps.timeoutMs ?? 10 * 60 * 1000;

  const base = `ytdl-video-${Date.now()}`;
  const outputTemplate = join(outDir, `${base}.%(ext)s`);
  const videoPath = join(outDir, `${base}.mp4`);
  const args = [...invocation.baseArgs, ...buildVideoYtdlpArgs(source, outputTemplate)];

  logger.info(`[video] downloading video via ${invocation.label}: ${source}`);

  return new Promise<VideoDownloadResult>((resolve) => {
    let settled = false;
    const finish = (result: VideoDownloadResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    let stderr = '';
    let child: ReturnType<typeof realSpawn>;
    try {
      child = spawn(invocation.cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      finish({ error: `yt-dlp spawn failed: ${err instanceof Error ? err.message : String(err)}` });
      return;
    }

    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
      finish({ error: `yt-dlp timed out after ${timeoutMs}ms` });
    }, timeoutMs);

    child.stderr?.on('data', (d) => {
      stderr = `${stderr}${String(d)}`.slice(-4000);
    });

    child.on('error', (err) => {
      finish({ error: `yt-dlp failed to run (${invocation.label}): ${err instanceof Error ? err.message : String(err)}. ${YTDLP_HINT}` });
    });

    child.on('close', (code) => {
      if (code === 0) {
        finish({ videoPath });
      } else {
        finish({ error: `yt-dlp exited with code ${code}${stderr.trim() ? `: ${stderr.trim().slice(-500)}` : ''}` });
      }
    });
  });
}
