import { resolveToolPath, guardToolMutation } from '../../utils/tool-execution-context.js';
/**
 * Frame sampling — the visual leg (Phase 2) of the video-understanding cascade.
 *
 * Extracts a bounded, duration-scaled set of representative frames from a LOCAL
 * video file using ffmpeg scene detection (`select='gt(scene,<t>)'` + `-vsync vfr`,
 * the claude-watch technique). Frame *timestamps* are recovered from ffmpeg's
 * `showinfo` filter (`pts_time:`), zipped against the written files in order.
 *
 * Two robustness twists over vanilla scene-detect:
 *  - **Auto-scaled budget** by duration (≤30 s → 30, 3–10 min → 80, >10 min → 100),
 *    then the extracted list is **capped evenly** so token cost stays bounded no
 *    matter the length.
 *  - **Interval fallback**: a low-motion screencast (the target use case!) may have
 *    almost no scene cuts, which would yield 0–1 frames. When scene detection returns
 *    fewer than `minSceneFrames`, we fall back to an even `fps=budget/duration` pass
 *    so we still cover the video (the SSIM dedup then removes the near-identical ones).
 *
 * Every OS-touching bit (spawn / readdir / duration probe) is injectable, and any
 * hard failure (ffmpeg missing, no frames, bad video) returns `[]` — never throws.
 *
 * @module tools/video/frame-sample
 */

import { spawn as realSpawn } from '../../utils/tool-process.js';
import { mkdir, mkdtemp, readdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { logger } from '../../utils/logger.js';

/** A sampled frame: the on-disk image plus its real timestamp (seconds). */
export interface SampledFrame {
  path: string;
  /** Timestamp in seconds within the source video. */
  t: number;
}

export interface FrameSampleDeps {
  /** Injectable spawn (tests). */
  spawn?: typeof realSpawn;
  ffmpegBin?: string;
  ffprobeBin?: string;
  /** Scene-change sensitivity 0..1 (default 0.4, façon claude-watch). */
  sceneThreshold?: number;
  /** Directory for the extracted frames (default: a fresh mkdtemp). */
  outDir?: string;
  /** Override the auto duration→budget scaling (tests / callers). */
  budget?: number;
  /** Override the probed duration in seconds (tests). */
  durationSec?: number;
  /** Injectable duration probe (default: ffprobe). */
  probeDuration?: (path: string) => Promise<number | null>;
  /** Per-process wall-clock limit for ffmpeg/ffprobe. */
  timeoutMs?: number;
  /** Injectable directory read (default: fs `readdir`). */
  readdir?: (dir: string) => Promise<string[]>;
  /** Below this many scene frames, fall back to interval sampling (default 3). */
  minSceneFrames?: number;
}

const FRAME_RE = /^frame_\d+\.jpg$/;

/**
 * Auto-scale the frame budget by video duration (claude-watch heuristic), so a
 * long video never blows the token budget. Tiers: ≤30 s → 30; ≤3 min → 60;
 * ≤10 min → 80; otherwise a hard cap of 100.
 */
export function frameBudgetForDuration(durationSec: number): number {
  const d = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 0;
  if (d <= 30) return 30;
  if (d <= 180) return 60;
  if (d <= 600) return 80;
  return 100;
}

/** Build the ffmpeg argv for scene-detect frame extraction (pure, testable). */
export function buildSceneDetectArgs(
  videoPath: string,
  outTemplate: string,
  sceneThreshold: number,
): string[] {
  return [
    '-hide_banner',
    '-i',
    videoPath,
    '-vf',
    `select='gt(scene,${sceneThreshold})',showinfo`,
    '-vsync',
    'vfr',
    '-q:v',
    '3',
    outTemplate,
  ];
}

/** Build the ffmpeg argv for even interval extraction at `fps` (pure, testable). */
export function buildIntervalArgs(videoPath: string, outTemplate: string, fps: string): string[] {
  return [
    '-hide_banner',
    '-i',
    videoPath,
    '-vf',
    `fps=${fps},showinfo`,
    '-vsync',
    'vfr',
    '-q:v',
    '3',
    outTemplate,
  ];
}

/** Parse `pts_time:<sec>` timestamps out of ffmpeg's `showinfo` stderr, in order. */
export function parsePtsTimes(stderr: string): number[] {
  const times: number[] = [];
  const re = /pts_time:\s*([0-9]+(?:\.[0-9]+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stderr)) !== null) {
    const n = Number.parseFloat(m[1]!);
    if (Number.isFinite(n) && n >= 0) times.push(Math.round(n * 100) / 100);
  }
  return times;
}

/**
 * Cap an ordered list to at most `budget` items, spread evenly across the timeline
 * (always keeps the first and last). Pure + testable.
 */
export function capEvenly<T>(items: T[], budget: number): T[] {
  if (budget <= 0) return [];
  if (items.length <= budget) return items;
  if (budget === 1) return [items[0]!];
  const out: T[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < budget; i++) {
    const idx = Math.round((i * (items.length - 1)) / (budget - 1));
    if (!seen.has(idx)) {
      seen.add(idx);
      out.push(items[idx]!);
    }
  }
  return out;
}

interface ProcResult {
  code: number | null;
  stderr: string;
}

function runFfmpeg(
  spawn: typeof realSpawn,
  cmd: string,
  args: string[],
  timeoutMs = 5 * 60 * 1000,
): Promise<ProcResult> {
  return new Promise((resolve) => {
    let stderr = '';
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (r: ProcResult): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(r);
    };
    let child: ReturnType<typeof realSpawn>;
    try {
      child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (err) {
      finish({ code: null, stderr: err instanceof Error ? err.message : String(err) });
      return;
    }
    timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* gone */
      }
      stderr = `${stderr}\n[timeout ${timeoutMs}ms]`;
    }, timeoutMs);
    child.stderr?.on('data', (d) => {
      stderr = `${stderr}${String(d)}`.slice(-200_000);
    });
    child.on('error', (err) => finish({ code: null, stderr: `${stderr}${err.message}` }));
    child.on('close', (code) => finish({ code, stderr }));
  });
}

async function defaultProbeDuration(
  spawn: typeof realSpawn,
  ffprobeBin: string,
  file: string,
  timeoutMs = 30_000,
): Promise<number | null> {
  const { code, stderr } = await new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolve) => {
      let stdout = '';
      let err = '';
      let child: ReturnType<typeof realSpawn>;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let timedOut = false;
      try {
        child = spawn(
          ffprobeBin,
          ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file],
          { stdio: ['ignore', 'pipe', 'pipe'] },
        );
      } catch (e) {
        resolve({ code: null, stdout: '', stderr: e instanceof Error ? e.message : String(e) });
        return;
      }
      child.stdout?.on('data', (d) => (stdout += String(d)));
      child.stderr?.on('data', (d) => (err += String(d)));
      timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
      child.on('error', () => { if (timer) clearTimeout(timer); resolve({ code: null, stdout, stderr: err }); });
      child.on('close', (c) => {
        if (timer) clearTimeout(timer);
        resolve({ code: timedOut ? null : c, stdout, stderr: err });
      });
    },
  ).then((r) => ({ code: r.code, stderr: r.stdout }));
  if (code !== 0) return null;
  const n = Number.parseFloat(stderr.trim());
  return Number.isFinite(n) && n >= 0 ? n : null;
}

async function extractWithArgs(
  spawn: typeof realSpawn,
  ffmpegBin: string,
  args: string[],
  dir: string,
  readdirFn: (dir: string) => Promise<string[]>,
  timeoutMs?: number,
): Promise<SampledFrame[]> {
  const { code, stderr } = await runFfmpeg(spawn, ffmpegBin, args, timeoutMs);
  if (code !== 0) {
    logger.warn(`[video] ffmpeg frame extraction failed (code=${code}): ${stderr.trim().slice(-300)}`);
    return [];
  }
  const files = (await readdirFn(dir)).filter((f) => FRAME_RE.test(f)).sort();
  if (files.length === 0) return [];
  const times = parsePtsTimes(stderr);
  return files.map((f, i) => ({
    path: join(dir, f),
    t: times[i] ?? (i > 0 ? (times[i - 1] ?? 0) : 0),
  }));
}

/**
 * Sample a bounded, duration-scaled set of timestamped frames from a LOCAL video
 * file. Scene detection first; interval fallback for low-motion screencasts; capped
 * evenly to the budget. Returns `[]` on any hard failure — never throws.
 */
export async function sampleFrames(
  videoPath: string,
  deps: FrameSampleDeps = {},
): Promise<SampledFrame[]> {
  const spawn = deps.spawn ?? realSpawn;
  const ffmpegBin = deps.ffmpegBin ?? 'ffmpeg';
  const ffprobeBin = deps.ffprobeBin ?? 'ffprobe';
  const sceneThreshold = deps.sceneThreshold ?? 0.4;
  const readdirFn = deps.readdir ?? ((dir: string) => readdir(resolveToolPath(dir)));
  const minSceneFrames = deps.minSceneFrames ?? 3;

  let outDir = deps.outDir;
  if (!outDir) {
    try {
      outDir = await guardToolMutation(() => mkdtemp(resolveToolPath(join(tmpdir(), 'buddy-frames-'))));
    } catch (err) {
      logger.warn(`[video] could not create frame dir: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }

  try {
    const duration =
      deps.durationSec ??
      (await (deps.probeDuration ?? ((p: string) => defaultProbeDuration(spawn, ffprobeBin, p, deps.timeoutMs)))(videoPath)) ??
      0;
    const budget = deps.budget ?? frameBudgetForDuration(duration);

    // 1) Scene detection — into its OWN subdir so a later interval pass can't collide
    //    with (or leave stale) its files (both passes use the same frame_%04d template).
    const sceneDir = join(outDir, 'scene');
    await guardToolMutation(() => mkdir(resolveToolPath(sceneDir), { recursive: true }));
    const sceneTemplate = join(sceneDir, 'frame_%04d.jpg');
    let frames = await extractWithArgs(
      spawn,
      ffmpegBin,
      buildSceneDetectArgs(videoPath, sceneTemplate, sceneThreshold),
      sceneDir,
      readdirFn,
      deps.timeoutMs,
    );

    // 2) Fallback: low-motion screencast → too few scene cuts → even interval pass, into a
    //    SEPARATE subdir. Distinct dirs guarantee interval timestamps never get zipped
    //    against residual scene frames (and scene frames are never overwritten in place).
    if (frames.length < minSceneFrames && duration > 0) {
      const intervalDir = join(outDir, 'interval');
      await guardToolMutation(() => mkdir(resolveToolPath(intervalDir), { recursive: true }));
      const intervalTemplate = join(intervalDir, 'frame_%04d.jpg');
      const rate = `${budget}/${Math.max(1, Math.ceil(duration))}`;
      const intervalFrames = await extractWithArgs(
        spawn,
        ffmpegBin,
        buildIntervalArgs(videoPath, intervalTemplate, rate),
        intervalDir,
        readdirFn,
        deps.timeoutMs,
      );
      if (intervalFrames.length > frames.length) frames = intervalFrames;
    }

    if (frames.length === 0) {
      logger.warn('[video] no frames sampled from video');
      return [];
    }

    const capped = capEvenly(frames, budget);
    logger.info(`[video] sampled ${capped.length} frame(s) (from ${frames.length}, budget ${budget}, dur ${Math.round(duration)}s)`);
    return capped;
  } catch (err) {
    logger.warn(`[video] frame sampling error: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}
