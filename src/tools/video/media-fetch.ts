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
import { lstat } from 'node:fs/promises';
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

/**
 * YouTube player clients tried, in order, when the default extraction yields media
 * URLs the server refuses (HTTP 403) or no downloadable format at all. Measured on
 * 2026-08-24: the default `android_vr` formats 403 while `android` serves the
 * progressive format 18 — which is all the visual pass needs (≤480p keyframes).
 * `tv_simply` is kept as a second net; it needs the EJS challenge solver but also
 * lands on format 18 when it works.
 */
export const YOUTUBE_CLIENT_FALLBACKS = ['android', 'tv_simply'] as const;

/** Signatures of a "the extraction worked but the media is unreachable" failure. */
const RETRYABLE_PATTERNS = [
  /HTTP Error 403/i,
  /403 Forbidden/i,
  /Requested format is not available/i,
  /Only images are available/i,
  /unable to download video data/i,
];

/** Is `source` a YouTube URL? Client fallbacks only mean something there. */
export function isYoutubeSource(source: string): boolean {
  return /(?:^|\/\/|\.)(?:youtube\.com|youtu\.be|youtube-nocookie\.com)(?:\/|$)/i.test(source);
}

/** Should we retry `stderr` with another player client? */
export function isRetryableYoutubeFailure(stderr: string): boolean {
  return RETRYABLE_PATTERNS.some((re) => re.test(stderr));
}

/**
 * The ordered list of player clients to try for `source`: `undefined` first (yt-dlp's
 * own default), then the fallbacks. `CODEBUDDY_YTDLP_PLAYER_CLIENTS` (csv) overrides
 * the fallback list; an empty value disables retries entirely.
 */
export function resolvePlayerClientChain(
  source: string,
  env: NodeJS.ProcessEnv = process.env,
): Array<string | undefined> {
  if (!isYoutubeSource(source)) return [undefined];
  const raw = env.CODEBUDDY_YTDLP_PLAYER_CLIENTS;
  if (raw !== undefined) {
    const custom = raw
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    return [undefined, ...custom];
  }
  return [undefined, ...YOUTUBE_CLIENT_FALLBACKS];
}

/** `--extractor-args youtube:player_client=<client>`, or nothing when unset. */
function playerClientArgs(playerClient?: string): string[] {
  return playerClient ? ['--extractor-args', `youtube:player_client=${playerClient}`] : [];
}

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
 * `outputTemplate` is a yt-dlp `-o` template ending in `.%(ext)s`. `playerClient`
 * pins the YouTube player client for a retry attempt (see `resolvePlayerClientChain`).
 */
export function buildYtdlpArgs(
  source: string,
  outputTemplate: string,
  playerClient?: string,
): string[] {
  return [
    // Recent YouTube extraction requires an explicit JavaScript runtime. Code Buddy
    // already runs on Node, so reuse the exact executable instead of depending on a
    // separately installed Deno runtime or on the caller's PATH.
    '--js-runtimes',
    `node:${process.execPath}`,
    ...playerClientArgs(playerClient),
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

/** Outcome of one yt-dlp spawn: success, or a message plus the raw stderr for triage. */
interface AttemptOutcome {
  ok: boolean;
  error?: string;
  stderr: string;
}

async function isRegularNonEmptyFile(file: string): Promise<boolean> {
  try {
    const metadata = await lstat(file);
    return metadata.isFile() && metadata.size > 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn(`[video] could not inspect downloaded artifact ${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
    return false;
  }
}

/**
 * Run yt-dlp once. Never throws, never rejects: spawn failures, non-zero exits and
 * timeouts all come back as `{ ok: false }`.
 */
function runYtdlpOnce(
  invocation: YtdlpInvocation,
  args: string[],
  spawn: typeof realSpawn,
  timeoutMs: number,
): Promise<AttemptOutcome> {
  return new Promise<AttemptOutcome>((resolve) => {
    let settled = false;
    const finish = (result: AttemptOutcome): void => {
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
      resolve({
        ok: false,
        error: `yt-dlp spawn failed: ${err instanceof Error ? err.message : String(err)}`,
        stderr: '',
      });
      return;
    }

    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
      finish({ ok: false, error: `yt-dlp timed out after ${timeoutMs}ms`, stderr });
    }, timeoutMs);

    child.stderr?.on('data', (d) => {
      stderr = `${stderr}${String(d)}`.slice(-4000);
    });

    child.on('error', (err) => {
      finish({
        ok: false,
        error: `yt-dlp failed to run (${invocation.label}): ${err instanceof Error ? err.message : String(err)}. ${YTDLP_HINT}`,
        stderr,
      });
    });

    child.on('close', (code) => {
      if (code === 0) {
        finish({ ok: true, stderr });
      } else {
        finish({
          ok: false,
          error: `yt-dlp exited with code ${code}${stderr.trim() ? `: ${stderr.trim().slice(-500)}` : ''}`,
          stderr,
        });
      }
    });
  });
}

/**
 * Walk the player-client chain until one attempt succeeds. Only retries when the
 * failure looks like YouTube refusing the media (403 / no usable format) — a genuine
 * error (bad URL, missing ffmpeg) fails on the first attempt as before.
 */
async function runWithClientFallbacks(
  source: string,
  invocation: YtdlpInvocation,
  buildArgs: (playerClient?: string) => string[],
  deps: MediaFetchDeps,
  expectedArtifact: { path: string; label: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const spawn = deps.spawn ?? realSpawn;
  const timeoutMs = deps.timeoutMs ?? 10 * 60 * 1000;
  const chain = resolvePlayerClientChain(source, deps.env ?? process.env);

  let lastError = 'yt-dlp failed';
  for (const [index, playerClient] of chain.entries()) {
    const args = [...invocation.baseArgs, ...buildArgs(playerClient)];
    if (playerClient) {
      logger.info(`[video] yt-dlp retry with player_client=${playerClient}: ${source}`);
    }
    const outcome = await runYtdlpOnce(invocation, args, spawn, timeoutMs);
    if (outcome.ok) {
      if (!(await isRegularNonEmptyFile(expectedArtifact.path))) {
        return {
          ok: false,
          error: `yt-dlp exited with code 0 but did not create a non-empty ${expectedArtifact.label}: ${expectedArtifact.path}`,
        };
      }
      return { ok: true };
    }
    lastError = outcome.error ?? 'yt-dlp failed';
    const isLast = index === chain.length - 1;
    if (isLast || !isRetryableYoutubeFailure(`${lastError}\n${outcome.stderr}`)) {
      return { ok: false, error: lastError };
    }
  }
  return { ok: false, error: lastError };
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

  // Deterministic base name so the resulting WAV path is known up front (yt-dlp
  // replaces %(ext)s with `wav` under `--audio-format wav`).
  const base = `ytdl-audio-${Date.now()}`;
  const outputTemplate = join(outDir, `${base}.%(ext)s`);
  const wavPath = join(outDir, `${base}.wav`);

  logger.info(`[video] downloading audio via ${invocation.label}: ${source}`);

  const result = await runWithClientFallbacks(
    source,
    invocation,
    (playerClient) => buildYtdlpArgs(source, outputTemplate, playerClient),
    deps,
    { path: wavPath, label: 'WAV artifact' },
  );
  return result.ok ? { wavPath } : { error: result.error };
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
export function buildVideoYtdlpArgs(
  source: string,
  outputTemplate: string,
  playerClient?: string,
): string[] {
  return [
    '--js-runtimes',
    `node:${process.execPath}`,
    ...playerClientArgs(playerClient),
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

  const base = `ytdl-video-${Date.now()}`;
  const outputTemplate = join(outDir, `${base}.%(ext)s`);
  const videoPath = join(outDir, `${base}.mp4`);

  logger.info(`[video] downloading video via ${invocation.label}: ${source}`);

  const result = await runWithClientFallbacks(
    source,
    invocation,
    (playerClient) => buildVideoYtdlpArgs(source, outputTemplate, playerClient),
    deps,
    { path: videoPath, label: 'MP4 artifact' },
  );
  return result.ok ? { videoPath } : { error: result.error };
}
