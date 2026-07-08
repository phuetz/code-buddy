/**
 * Film project — the resumable state layer behind the end-to-end producer.
 *
 * A film project is a JSON manifest (`.codebuddy/media-generation/films/<name>/
 * film.json`, OpenMontage-style checkpoints + decision log) that ties a list of
 * SCENES to their generated clips and the assembly settings. It lets the
 * producer regenerate a single scene without redoing the whole film, and keeps
 * an audit trail of what happened.
 *
 * Plus the post-render QUALITY GATE (`assessFilmQuality`): a single ffmpeg pass
 * (blackdetect + volumedetect) and an ffprobe, with PURE parsers, that flags a
 * film whose duration drifted, that is silent, or that is mostly black frames.
 *
 * Everything OS-touching is injectable; the parsers/reducers are pure.
 *
 * @module tools/video/film-project
 */

import { spawn as realSpawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../../utils/logger.js';

// ============================================================================
// Manifest types
// ============================================================================

export type SceneStatus = 'pending' | 'generating' | 'ready' | 'failed';

export interface FilmScene {
  id: string;
  prompt: string;
  seed?: number;
  /** Optional reference image (for image-to-video / continuity). */
  referenceImage?: string;
  /** Desired clip duration in seconds. */
  duration?: number;
  /** Optional spoken narration for this scene (Piper voiceover). */
  narration?: string;
  /** Set once the clip has been generated. */
  clipPath?: string;
  status: SceneStatus;
  error?: string;
  updatedAt?: string;
}

export interface FilmAudioConfig {
  music?: string;
  musicVolume?: number;
  ducking?: boolean;
  voiceover?: string;
}

export interface FilmOutputConfig {
  resolution?: string;
  aspectRatio?: string;
  fps?: number;
}

export interface FilmDecision {
  at: string;
  event: string;
  detail?: string;
}

export interface FilmProject {
  version: 1;
  name: string;
  createdAt: string;
  updatedAt: string;
  pitch?: string;
  output: FilmOutputConfig;
  transition: string;
  transitionDuration: number;
  engine: 'xfade' | 'gl';
  scenes: FilmScene[];
  audio: FilmAudioConfig;
  /** Path of the last successfully assembled film. */
  filmPath?: string;
  decisionLog: FilmDecision[];
}

export interface CreateFilmProjectInput {
  name: string;
  pitch?: string;
  scenes: Array<Pick<FilmScene, 'prompt' | 'seed' | 'duration' | 'referenceImage' | 'narration'>>;
  output?: FilmOutputConfig;
  transition?: string;
  transitionDuration?: number;
  engine?: 'xfade' | 'gl';
  audio?: FilmAudioConfig;
  now?: () => Date;
}

// ============================================================================
// Manifest — pure helpers
// ============================================================================

/** Slugify a film name into a filesystem-safe directory component. */
export function filmSlug(name: string): string {
  return (
    (name || 'film')
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'film'
  );
}

export function filmProjectDir(rootDir: string, name: string): string {
  return path.join(
    path.resolve(rootDir),
    '.codebuddy',
    'media-generation',
    'films',
    filmSlug(name)
  );
}

export function filmProjectPath(rootDir: string, name: string): string {
  return path.join(filmProjectDir(rootDir, name), 'film.json');
}

/** Build a fresh project (pure). */
export function createFilmProject(input: CreateFilmProjectInput): FilmProject {
  const nowIso = (input.now ?? (() => new Date()))().toISOString();
  const scenes: FilmScene[] = input.scenes.map((s, i) => ({
    id: `scene-${i + 1}`,
    prompt: s.prompt,
    ...(s.seed !== undefined ? { seed: s.seed } : {}),
    ...(s.duration !== undefined ? { duration: s.duration } : {}),
    ...(s.referenceImage !== undefined ? { referenceImage: s.referenceImage } : {}),
    ...(s.narration !== undefined ? { narration: s.narration } : {}),
    status: 'pending',
  }));
  return {
    version: 1,
    name: input.name,
    createdAt: nowIso,
    updatedAt: nowIso,
    ...(input.pitch !== undefined ? { pitch: input.pitch } : {}),
    output: input.output ?? {},
    transition: input.transition ?? 'fade',
    transitionDuration: input.transitionDuration ?? 1,
    engine: input.engine ?? 'xfade',
    scenes,
    audio: input.audio ?? {},
    decisionLog: [{ at: nowIso, event: 'created', detail: `${scenes.length} scene(s)` }],
  };
}

/** Append a decision-log entry (pure, mutates + returns for chaining). */
export function logDecision(
  project: FilmProject,
  event: string,
  detail?: string,
  now?: () => Date
): FilmProject {
  const at = (now ?? (() => new Date()))().toISOString();
  project.decisionLog.push(detail !== undefined ? { at, event, detail } : { at, event });
  return project;
}

export function nextPendingScene(project: FilmProject): FilmScene | undefined {
  return project.scenes.find((s) => s.status === 'pending' || s.status === 'failed');
}

export function readyClips(project: FilmProject): string[] {
  return project.scenes
    .filter((s) => s.status === 'ready' && s.clipPath)
    .map((s) => s.clipPath!) as string[];
}

export function allScenesReady(project: FilmProject): boolean {
  return (
    project.scenes.length > 0 && project.scenes.every((s) => s.status === 'ready' && !!s.clipPath)
  );
}

export interface FilmProgress {
  total: number;
  ready: number;
  failed: number;
  pending: number;
}

export function filmProgress(project: FilmProject): FilmProgress {
  const total = project.scenes.length;
  const ready = project.scenes.filter((s) => s.status === 'ready').length;
  const failed = project.scenes.filter((s) => s.status === 'failed').length;
  return { total, ready, failed, pending: total - ready - failed };
}

// ============================================================================
// Manifest — persistence (I/O)
// ============================================================================

export async function loadFilmProject(rootDir: string, name: string): Promise<FilmProject | null> {
  try {
    const raw = await fs.readFile(filmProjectPath(rootDir, name), 'utf8');
    const parsed = JSON.parse(raw) as FilmProject;
    if (parsed && parsed.version === 1 && Array.isArray(parsed.scenes)) return parsed;
    return null;
  } catch {
    return null;
  }
}

export async function saveFilmProject(
  rootDir: string,
  project: FilmProject,
  now: () => Date = () => new Date()
): Promise<void> {
  project.updatedAt = now().toISOString();
  const dir = filmProjectDir(rootDir, project.name);
  await fs.mkdir(dir, { recursive: true });
  const file = filmProjectPath(rootDir, project.name);
  // Write-then-rename for atomicity (never leave a half-written manifest).
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(project, null, 2));
  await fs.rename(tmp, file);
}

// ============================================================================
// Quality gate — pure parsers
// ============================================================================

export interface BlackInterval {
  start: number;
  end: number;
  duration: number;
}

/** Parse ffmpeg `blackdetect` stderr into black intervals (pure). */
export function parseBlackIntervals(stderr: string): BlackInterval[] {
  const out: BlackInterval[] = [];
  const re = /black_start:([0-9.]+)\s+black_end:([0-9.]+)\s+black_duration:([0-9.]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stderr)) !== null) {
    out.push({ start: Number(m[1]), end: Number(m[2]), duration: Number(m[3]) });
  }
  return out;
}

/** Parse ffmpeg `volumedetect` stderr into mean/max dB (pure). */
export function parseVolumeStats(stderr: string): { meanDb: number | null; maxDb: number | null } {
  const mean = stderr.match(/mean_volume:\s*(-?[0-9.]+)\s*dB/);
  const max = stderr.match(/max_volume:\s*(-?[0-9.]+)\s*dB/);
  return {
    meanDb: mean ? Number(mean[1]) : null,
    maxDb: max ? Number(max[1]) : null,
  };
}

// ============================================================================
// Quality gate — assessment
// ============================================================================

export interface FilmQualityReport {
  pass: boolean;
  probedDuration: number | null;
  expectedDuration?: number;
  durationOk: boolean;
  hasAudio: boolean;
  meanVolumeDb: number | null;
  maxVolumeDb: number | null;
  silent: boolean;
  blackIntervals: BlackInterval[];
  totalBlackSeconds: number;
  warnings: string[];
}

export interface AssessFilmQualityDeps {
  spawn?: typeof realSpawn;
  ffmpegBin?: string;
  ffprobeBin?: string;
  timeoutMs?: number;
}

interface ProcOut {
  code: number | null;
  stdout: string;
  stderr: string;
}

function run(
  spawn: typeof realSpawn,
  cmd: string,
  args: string[],
  timeoutMs: number
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
      finish({ code: null, stdout, stderr: `${stderr}\n[timeout]` });
    }, timeoutMs);
    child.stdout?.on('data', (d) => (stdout = `${stdout}${String(d)}`.slice(-500_000)));
    child.stderr?.on('data', (d) => (stderr = `${stderr}${String(d)}`.slice(-500_000)));
    child.on('error', (err) => finish({ code: null, stdout, stderr: `${stderr}${err.message}` }));
    child.on('close', (code) => finish({ code, stdout, stderr }));
  });
}

/**
 * Reduce raw probe values into a pass/fail report (pure — the testable core of
 * the gate). `pass` requires: duration within 12%/±0.6s of expected (when
 * given), not silent when there is an audio track, and < 15% black frames.
 */
export function reduceQuality(params: {
  probedDuration: number | null;
  expectedDuration?: number;
  hasAudio: boolean;
  meanDb: number | null;
  maxDb: number | null;
  blackIntervals: BlackInterval[];
}): FilmQualityReport {
  const warnings: string[] = [];
  const { probedDuration, expectedDuration, hasAudio, meanDb, maxDb, blackIntervals } = params;

  let durationOk = true;
  if (expectedDuration && probedDuration != null) {
    const tol = Math.max(0.6, expectedDuration * 0.12);
    durationOk = Math.abs(probedDuration - expectedDuration) <= tol;
    if (!durationOk) {
      warnings.push(
        `Duration ${probedDuration}s drifted from the expected ${expectedDuration}s (>${Math.round(tol * 100) / 100}s).`
      );
    }
  } else if (probedDuration == null) {
    durationOk = false;
    warnings.push('Could not probe the rendered film duration.');
  }

  // "silent" = has an audio track but the mean level is essentially inaudible.
  const silent = hasAudio && meanDb != null && meanDb <= -60;
  if (silent) warnings.push(`Audio track present but effectively silent (mean ${meanDb} dB).`);
  if (hasAudio && maxDb != null && maxDb >= -0.1) {
    warnings.push(`Audio may be clipping (max ${maxDb} dB).`);
  }

  const totalBlackSeconds =
    Math.round(blackIntervals.reduce((a, b) => a + b.duration, 0) * 100) / 100;
  const blackRatio = probedDuration && probedDuration > 0 ? totalBlackSeconds / probedDuration : 0;
  if (blackRatio > 0.15) {
    warnings.push(
      `${totalBlackSeconds}s of black frames (${Math.round(blackRatio * 100)}% of the film).`
    );
  }

  const pass = durationOk && !silent && blackRatio <= 0.15;
  return {
    pass,
    probedDuration,
    ...(expectedDuration !== undefined ? { expectedDuration } : {}),
    durationOk,
    hasAudio,
    meanVolumeDb: meanDb,
    maxVolumeDb: maxDb,
    silent,
    blackIntervals,
    totalBlackSeconds,
    warnings,
  };
}

/** Run the quality gate on a rendered film (blackdetect + volumedetect + ffprobe). */
export async function assessFilmQuality(
  filmPath: string,
  opts: { expectedDuration?: number } = {},
  deps: AssessFilmQualityDeps = {}
): Promise<FilmQualityReport> {
  const spawn = deps.spawn ?? realSpawn;
  const ffmpegBin = deps.ffmpegBin ?? 'ffmpeg';
  const ffprobeBin = deps.ffprobeBin ?? 'ffprobe';
  const timeoutMs = deps.timeoutMs ?? 5 * 60 * 1000;

  // ffprobe: duration + audio presence.
  const probe = await run(
    spawn,
    ffprobeBin,
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filmPath],
    60_000
  );
  let probedDuration: number | null = null;
  let hasAudio = false;
  try {
    const json = JSON.parse(probe.stdout) as {
      format?: { duration?: string };
      streams?: Array<{ codec_type?: string }>;
    };
    probedDuration = json.format?.duration
      ? Math.round(Number(json.format.duration) * 100) / 100
      : null;
    hasAudio = !!json.streams?.some((s) => s.codec_type === 'audio');
  } catch {
    /* leave defaults */
  }

  // Single ffmpeg analysis pass: blackdetect (video) + volumedetect (audio) → stderr.
  const analysis = await run(
    spawn,
    ffmpegBin,
    [
      '-hide_banner',
      '-i',
      filmPath,
      '-vf',
      'blackdetect=d=0.1:pic_th=0.98',
      '-af',
      'volumedetect',
      '-f',
      'null',
      '-',
    ],
    timeoutMs
  );
  const blackIntervals = parseBlackIntervals(analysis.stderr);
  const { meanDb, maxDb } = parseVolumeStats(analysis.stderr);

  const report = reduceQuality({
    probedDuration,
    ...(opts.expectedDuration !== undefined ? { expectedDuration: opts.expectedDuration } : {}),
    hasAudio,
    meanDb,
    maxDb,
    blackIntervals,
  });

  logger.info(
    `[film-quality] ${report.pass ? 'PASS' : 'REVIEW'} — ${report.probedDuration}s, ` +
      `audio=${hasAudio ? `${meanDb}dB` : 'none'}, black=${report.totalBlackSeconds}s`
  );
  return report;
}
