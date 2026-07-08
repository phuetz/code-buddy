/**
 * Film assembly — chain multiple video clips into ONE longer film with
 * transitions, then optionally lay a background-music track (with ducking)
 * and a voiceover over the whole thing.
 *
 * This is the montage brick that `video_generate` never had: it takes the
 * short clips produced by the media backend (or any local mp4s) and welds
 * them into a coherent long-form video via a single ffmpeg `filter_complex`
 * pass.
 *
 * Design (mirrors `frame-sample.ts`):
 *  - Every OS-touching bit (spawn / ffprobe / gl-filter probe) is injectable.
 *  - The argv/filter-graph builders are PURE and unit-testable — no ffmpeg
 *    needed to assert the cumulative xfade offsets or the normalize chain.
 *  - Fail-open: a missing ffmpeg, an unprobeable clip, or a dead render
 *    returns a structured `success:false` result — it never throws.
 *
 * Two transition engines, selectable at call time:
 *  - `xfade` (default): the native ffmpeg `xfade` (video) + `acrossfade`
 *    (audio) filters — ~50 built-in transitions, zero extra dependency.
 *  - `gl`: the `gltransition` filter (ffmpeg-gl-transition) IF the local
 *    ffmpeg was built with it — otherwise it falls back to `xfade` with a
 *    warning. We never build a custom ffmpeg or add a native dependency.
 *
 * The crossfade math (the heart, unit-tested): for normalized clip durations
 * d0..dn and per-boundary transition durations T0..T_{n-2},
 *   offset_k = (Σ_{i=0..k} d_i) − (Σ_{i=0..k} T_i)
 * and the final film duration ≈ Σ d_i − Σ T_k. Normalization (same
 * W×H / fps / SAR / pix_fmt / sample-rate) MUST run first or xfade errors.
 *
 * @module tools/video/film-assemble
 */

import { spawn as realSpawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { logger } from '../../utils/logger.js';
import { writeMediaSidecar } from '../media-generation-tool.js';

// ============================================================================
// Types
// ============================================================================

export type TransitionEngine = 'xfade' | 'gl';

/** ffprobe result for a single input clip. */
export interface ClipProbe {
  path: string;
  /** Duration in seconds (0 when unknown — the clip is then treated as absent). */
  duration: number;
  width: number | null;
  height: number | null;
  fps: number | null;
  hasAudio: boolean;
  sar: string | null;
  pixFmt: string | null;
}

/** A single transition between two adjacent clips. */
export interface TransitionSpec {
  /** xfade transition name (fade, wipeleft, slideup, circleopen, dissolve…) or 'cut'. */
  type: string;
  /** Transition duration in seconds (0 ⇒ hard cut). */
  duration: number;
}

export interface OutputProfile {
  width: number;
  height: number;
  fps: number;
}

export interface AssembleFilmInput {
  /** Ordered clip paths to weld together. */
  clips: string[];
  /** A single transition name applied at every boundary, or one spec per boundary. */
  transitions?: string | TransitionSpec[];
  /** Default per-boundary transition duration in seconds (default 1). */
  transitionDuration?: number;
  /** Transition engine (default 'xfade'). */
  engine?: TransitionEngine;
  /** Output short-side preset ('1080p', '720p', …) or explicit 'WxH'. */
  resolution?: string;
  /** Output aspect ratio ('16:9', '9:16', '1:1', …). */
  aspectRatio?: string;
  /** Output frame rate (default: first clip's fps, else 30). */
  fps?: number;
  /** Optional background music path (looped + trimmed to film length). */
  music?: string;
  /** Music volume 0..1 (default 0.25). */
  musicVolume?: number;
  /** Duck the music under dialogue/voiceover (default true when music present). */
  ducking?: boolean;
  /** Optional full-length voiceover/narration path (mixed at full volume). */
  voiceover?: string;
  /** Explicit output path; otherwise auto-generated under .codebuddy/media-generation/films/. */
  output?: string;
  /** Project root (default cwd). */
  rootDir?: string;
  /** Film name (used for the auto output filename + sidecar). */
  name?: string;
}

export interface AssembleFilmDeps {
  spawn?: typeof realSpawn;
  ffmpegBin?: string;
  ffprobeBin?: string;
  createId?: () => string;
  /** Injectable probe (tests) — bypasses ffprobe. */
  probeClips?: (paths: string[]) => Promise<ClipProbe[]>;
  /** Injectable gl-transition availability probe (tests). */
  detectGl?: () => Promise<boolean>;
  /** Render timeout in ms (default 30 min). */
  timeoutMs?: number;
}

export interface AssembleFilmResult {
  kind: 'film_assemble_result';
  success: boolean;
  outputPath?: string;
  /** `MEDIA:<path>` marker consumed by the media library, mirroring video_generate. */
  mediaPath?: string;
  engine: TransitionEngine;
  clipCount: number;
  transitionCount: number;
  targetWidth: number;
  targetHeight: number;
  fps: number;
  /** Σd − ΣT, computed from the probed clip durations. */
  estimatedDuration: number;
  /** ffprobe duration of the actual render (when it succeeded). */
  probedDuration?: number;
  hasAudio: boolean;
  transitions: TransitionSpec[];
  warnings: string[];
  error?: string;
}

/** A single ffmpeg input (its `-i`-including token list). */
interface FfInput {
  args: string[];
}

// ============================================================================
// Constants
// ============================================================================

/** The commonly-available ffmpeg `xfade` transitions (pass-through, for validation/hints). */
export const XFADE_TRANSITIONS: readonly string[] = [
  'fade',
  'fadeblack',
  'fadewhite',
  'fadegrays',
  'dissolve',
  'distance',
  'wipeleft',
  'wiperight',
  'wipeup',
  'wipedown',
  'slideleft',
  'slideright',
  'slideup',
  'slidedown',
  'smoothleft',
  'smoothright',
  'smoothup',
  'smoothdown',
  'circleopen',
  'circleclose',
  'circlecrop',
  'rectcrop',
  'radial',
  'hlslice',
  'hrslice',
  'vuslice',
  'vdslice',
  'pixelize',
  'diagtl',
  'diagtr',
  'diagbl',
  'diagbr',
  'hblur',
  'horzopen',
  'horzclose',
  'vertopen',
  'vertclose',
  'squeezev',
  'squeezeh',
  'zoomin',
  'coverleft',
  'coverright',
  'coverup',
  'coverdown',
  'revealleft',
  'revealright',
  'revealup',
  'revealdown',
  'wipetl',
  'wipetr',
  'wipebl',
  'wipebr',
];

const DEFAULT_TRANSITION = 'fade';
const DEFAULT_TRANSITION_DURATION = 1;
const DEFAULT_MUSIC_VOLUME = 0.25;
const SAMPLE_RATE = 48_000;

// ============================================================================
// Pure helpers (unit-tested)
// ============================================================================

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function even(n: number): number {
  const r = Math.round(n);
  return r % 2 === 0 ? r : r + 1;
}

/**
 * Cumulative xfade offsets — THE core formula.
 * `offset_k = Σ(d[0..k]) − Σ(T[0..k])`, one per boundary (n−1 total).
 */
export function computeXfadeOffsets(durations: number[], transitions: number[]): number[] {
  const offsets: number[] = [];
  let cumClip = 0;
  let cumTrans = 0;
  for (let k = 0; k < durations.length - 1; k++) {
    cumClip += durations[k] ?? 0;
    cumTrans += transitions[k] ?? 0;
    offsets.push(round2(cumClip - cumTrans));
  }
  return offsets;
}

/**
 * Normalize the `transitions` input into exactly `boundaries` specs, then clamp
 * each transition duration so it fits inside both adjacent clips (xfade requires
 * the crossfade region to live within both). Returns clamped specs + warnings.
 */
export function normalizeTransitions(
  transitions: string | TransitionSpec[] | undefined,
  boundaries: number,
  defaultDuration: number,
  durations: number[]
): { specs: TransitionSpec[]; warnings: string[] } {
  const warnings: string[] = [];
  if (boundaries <= 0) return { specs: [], warnings };

  const base: TransitionSpec[] = [];
  for (let i = 0; i < boundaries; i++) {
    if (Array.isArray(transitions)) {
      const t = transitions[i] ?? transitions[transitions.length - 1];
      base.push({
        type: (t?.type ?? DEFAULT_TRANSITION).trim() || DEFAULT_TRANSITION,
        duration: typeof t?.duration === 'number' ? t.duration : defaultDuration,
      });
    } else {
      base.push({
        type: (transitions ?? DEFAULT_TRANSITION).trim() || DEFAULT_TRANSITION,
        duration: defaultDuration,
      });
    }
  }

  // Clamp each transition so it fits within both neighbours (leave a 0.05s guard).
  const specs = base.map((spec, k) => {
    if (spec.type === 'cut' || spec.duration <= 0) {
      return { type: 'cut', duration: 0 };
    }
    const left = durations[k] ?? 0;
    const right = durations[k + 1] ?? 0;
    const ceiling = Math.max(0, Math.min(left, right) - 0.05);
    if (ceiling <= 0) {
      warnings.push(`Boundary ${k + 1}: clip too short for a transition — using a hard cut.`);
      return { type: 'cut', duration: 0 };
    }
    if (spec.duration > ceiling) {
      warnings.push(
        `Boundary ${k + 1}: transition ${spec.duration}s exceeds clip length — clamped to ${round2(ceiling)}s.`
      );
      return { type: spec.type, duration: round2(ceiling) };
    }
    return { type: spec.type, duration: round2(spec.duration) };
  });

  return { specs, warnings };
}

/** Parse '1080p' / '720p' / '4k' / 'WxH' + aspect ratio into an even-dimensioned target. */
export function resolveOutputProfile(
  input: Pick<AssembleFilmInput, 'resolution' | 'aspectRatio' | 'fps'>,
  probes: ClipProbe[]
): OutputProfile {
  const fps =
    input.fps && input.fps > 0
      ? Math.round(input.fps)
      : (probes.find((p) => p.fps && p.fps > 0)?.fps ?? 30);

  // Explicit WxH.
  const explicit = input.resolution?.match(/^(\d{2,5})\s*[xX*]\s*(\d{2,5})$/);
  if (explicit) {
    return { width: even(Number(explicit[1])), height: even(Number(explicit[2])), fps };
  }

  const presetMap: Record<string, number> = {
    '360p': 360,
    '480p': 480,
    '540p': 540,
    '720p': 720,
    '1080p': 1080,
    '1440p': 1440,
    '2160p': 2160,
    '4k': 2160,
  };
  const shortSide = input.resolution ? presetMap[input.resolution.toLowerCase()] : undefined;

  // No resolution asked for → inherit the first probed clip's dims (else 1920×1080).
  if (!shortSide) {
    const first = probes.find((p) => p.width && p.height);
    if (first?.width && first?.height) {
      return { width: even(first.width), height: even(first.height), fps };
    }
    return { width: 1920, height: 1080, fps };
  }

  const ar = parseAspectRatio(input.aspectRatio) ?? { a: 16, b: 9 };
  // shortSide is the smaller dimension for either orientation.
  if (ar.a >= ar.b) {
    // landscape/square: height is the short side
    return { width: even((shortSide * ar.a) / ar.b), height: even(shortSide), fps };
  }
  // portrait: width is the short side
  return { width: even(shortSide), height: even((shortSide * ar.b) / ar.a), fps };
}

function parseAspectRatio(ar: string | undefined): { a: number; b: number } | null {
  if (!ar) return null;
  const m = ar.match(/^(\d+)\s*[:/x]\s*(\d+)$/);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a > 0 && b > 0) return { a, b };
  return null;
}

/** Per-input video normalization filter → label `[v{i}]` (pure). */
export function buildVideoNormalizeSegment(index: number, profile: OutputProfile): string {
  const { width: w, height: h, fps } = profile;
  return (
    `[${index}:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,` +
    `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${fps},` +
    `format=yuv420p,setpts=PTS-STARTPTS[v${index}]`
  );
}

/** Per-input audio normalization filter → label `[a{i}]` (pure). `audioRef` is `<inputIdx>:a`. */
export function buildAudioNormalizeSegment(index: number, audioRef: string): string {
  return (
    `[${audioRef}]aformat=sample_rates=${SAMPLE_RATE}:channel_layouts=stereo,` +
    `asetpts=PTS-STARTPTS[a${index}]`
  );
}

/**
 * Build the video half of the filter graph after normalization: an xfade chain
 * (engine xfade/gl) or a hard-cut concat. Returns the segments + the final label.
 */
export function buildVideoGraph(
  n: number,
  specs: TransitionSpec[],
  offsets: number[],
  glFilter: string | null
): { segments: string[]; finalLabel: string } {
  if (n <= 1) return { segments: [], finalLabel: 'v0' };

  // If every boundary is a hard cut, use a single concat.
  if (specs.every((s) => s.type === 'cut' || s.duration <= 0)) {
    const ins = Array.from({ length: n }, (_, i) => `[v${i}]`).join('');
    return { segments: [`${ins}concat=n=${n}:v=1:a=0[vout]`], finalLabel: 'vout' };
  }

  const segments: string[] = [];
  let prev = 'v0';
  for (let k = 0; k < n - 1; k++) {
    const spec = specs[k]!;
    const out = k === n - 2 ? 'vout' : `vx${k}`;
    if (spec.type === 'cut' || spec.duration <= 0) {
      // Degenerate hard cut inside an otherwise-transitioned film: xfade with a
      // tiny duration keeps timing consistent with the offset math.
      segments.push(
        `[${prev}][v${k + 1}]xfade=transition=fade:duration=0.04:offset=${offsets[k]}[${out}]`
      );
    } else if (glFilter) {
      segments.push(
        `[${prev}][v${k + 1}]${glFilter}=duration=${spec.duration}:offset=${offsets[k]}[${out}]`
      );
    } else {
      segments.push(
        `[${prev}][v${k + 1}]xfade=transition=${spec.type}:duration=${spec.duration}:offset=${offsets[k]}[${out}]`
      );
    }
    prev = out;
  }
  return { segments, finalLabel: 'vout' };
}

/**
 * Build the audio half: crossfade (acrossfade) chain mirroring the video xfade,
 * or a concat for the all-hard-cut case. Returns segments + final label.
 */
export function buildClipAudioGraph(
  n: number,
  specs: TransitionSpec[]
): { segments: string[]; finalLabel: string } {
  if (n <= 1) return { segments: [], finalLabel: 'a0' };

  if (specs.every((s) => s.type === 'cut' || s.duration <= 0)) {
    const ins = Array.from({ length: n }, (_, i) => `[a${i}]`).join('');
    return { segments: [`${ins}concat=n=${n}:v=0:a=1[filmA]`], finalLabel: 'filmA' };
  }

  const segments: string[] = [];
  let prev = 'a0';
  for (let k = 0; k < n - 1; k++) {
    const spec = specs[k]!;
    const out = k === n - 2 ? 'filmA' : `ax${k}`;
    const d = spec.type === 'cut' || spec.duration <= 0 ? 0.04 : spec.duration;
    segments.push(`[${prev}][a${k + 1}]acrossfade=d=${d}[${out}]`);
    prev = out;
  }
  return { segments, finalLabel: 'filmA' };
}

/**
 * Layer voiceover + ducked background music over the assembled clip audio.
 * `baseLabel` is the crossfaded clip audio; `voiceRef`/`musicRef` are `<idx>:a`.
 * Returns the extra segments + the final audio label.
 */
export function buildAudioMixGraph(
  baseLabel: string,
  opts: {
    voiceRef?: string;
    musicRef?: string;
    musicVolume: number;
    ducking: boolean;
    totalDuration: number;
  }
): { segments: string[]; finalLabel: string } {
  const segments: string[] = [];

  // Fold the voiceover into the "program" audio (clip audio + narration).
  let progLabel = baseLabel;
  if (opts.voiceRef) {
    segments.push(
      `[${opts.voiceRef}]aformat=sample_rates=${SAMPLE_RATE}:channel_layouts=stereo,` +
        `asetpts=PTS-STARTPTS[vo]`
    );
    segments.push(`[${progLabel}][vo]amix=inputs=2:duration=first:normalize=0[prog]`);
    progLabel = 'prog';
  }

  if (!opts.musicRef) {
    return { segments, finalLabel: progLabel };
  }

  // Bound the (possibly looped) music to the film length, then set its volume.
  segments.push(
    `[${opts.musicRef}]atrim=0:${round2(opts.totalDuration)},` +
      `aformat=sample_rates=${SAMPLE_RATE}:channel_layouts=stereo,` +
      `volume=${opts.musicVolume}[music0]`
  );

  if (opts.ducking) {
    // Split the program so one copy drives the sidechain, the other stays in the mix.
    segments.push(`[${progLabel}]asplit=2[prog_a][prog_b]`);
    segments.push(
      `[music0][prog_b]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=400[music_d]`
    );
    segments.push(`[prog_a][music_d]amix=inputs=2:duration=first:normalize=0[aout]`);
  } else {
    segments.push(`[${progLabel}][music0]amix=inputs=2:duration=first:normalize=0[aout]`);
  }
  return { segments, finalLabel: 'aout' };
}

// ============================================================================
// Argv assembly (pure)
// ============================================================================

export interface FilmArgvPlan {
  args: string[];
  videoLabel: string;
  audioLabel: string;
  filterComplex: string;
}

/**
 * Build the complete ffmpeg argv for a film assembly. Pure: given the probes +
 * resolved options it returns the exact command, with no I/O. This is the main
 * unit-test seam.
 */
export function buildFilmArgs(
  probes: ClipProbe[],
  profile: OutputProfile,
  specs: TransitionSpec[],
  opts: {
    ffmpegBin: string;
    outputPath: string;
    engine: TransitionEngine;
    glFilter: string | null;
    music?: string;
    musicVolume: number;
    ducking: boolean;
    voiceover?: string;
  }
): FilmArgvPlan {
  const n = probes.length;
  const durations = probes.map((p) => p.duration);
  const offsets = computeXfadeOffsets(
    durations,
    specs.map((s) => s.duration)
  );
  const usingXfade = specs.some((s) => s.type !== 'cut' && s.duration > 0);
  const estimated = usingXfade
    ? durations.reduce((a, b) => a + b, 0) - specs.reduce((a, s) => a + s.duration, 0)
    : durations.reduce((a, b) => a + b, 0);

  // --- Inputs ---
  const inputs: FfInput[] = probes.map((p) => ({ args: ['-i', p.path] }));
  let nextIdx = n;

  // Silent audio for clips with no audio track (so acrossfade/concat align).
  const audioRefForClip: string[] = probes.map((p, i) => {
    if (p.hasAudio) return `${i}:a`;
    const dur = round2(Math.max(p.duration, 0.1));
    inputs.push({
      args: [
        '-f',
        'lavfi',
        '-t',
        String(dur),
        '-i',
        `anullsrc=channel_layout=stereo:sample_rate=${SAMPLE_RATE}`,
      ],
    });
    return `${nextIdx++}:a`;
  });

  let musicRef: string | undefined;
  if (opts.music) {
    inputs.push({ args: ['-stream_loop', '-1', '-i', opts.music] });
    musicRef = `${nextIdx++}:a`;
  }
  let voiceRef: string | undefined;
  if (opts.voiceover) {
    inputs.push({ args: ['-i', opts.voiceover] });
    voiceRef = `${nextIdx++}:a`;
  }

  // --- Filter graph ---
  const segments: string[] = [];
  for (let i = 0; i < n; i++) segments.push(buildVideoNormalizeSegment(i, profile));
  for (let i = 0; i < n; i++) segments.push(buildAudioNormalizeSegment(i, audioRefForClip[i]!));

  const glFilter = opts.engine === 'gl' ? opts.glFilter : null;
  const video = buildVideoGraph(n, specs, offsets, glFilter);
  const clipAudio = buildClipAudioGraph(n, specs);
  segments.push(...video.segments, ...clipAudio.segments);

  const mix = buildAudioMixGraph(clipAudio.finalLabel, {
    voiceRef,
    musicRef,
    musicVolume: opts.musicVolume,
    ducking: opts.ducking,
    totalDuration: Math.max(estimated, 0.1),
  });
  segments.push(...mix.segments);

  const filterComplex = segments.join(';');

  const args: string[] = ['-y', '-hide_banner'];
  for (const inp of inputs) args.push(...inp.args);
  args.push(
    '-filter_complex',
    filterComplex,
    '-map',
    `[${video.finalLabel}]`,
    '-map',
    `[${mix.finalLabel}]`,
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '20',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-movflags',
    '+faststart',
    opts.outputPath
  );

  return { args, videoLabel: video.finalLabel, audioLabel: mix.finalLabel, filterComplex };
}

// ============================================================================
// I/O runners (injectable)
// ============================================================================

interface ProcResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runProcess(
  spawn: typeof realSpawn,
  cmd: string,
  args: string[],
  timeoutMs: number
): Promise<ProcResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (r: ProcResult): void => {
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
    child.stdout?.on('data', (d) => {
      stdout = `${stdout}${String(d)}`.slice(-500_000);
    });
    child.stderr?.on('data', (d) => {
      stderr = `${stderr}${String(d)}`.slice(-500_000);
    });
    child.on('error', (err) => finish({ code: null, stdout, stderr: `${stderr}${err.message}` }));
    child.on('close', (code) => finish({ code, stdout, stderr }));
  });
}

interface FfprobeFormat {
  duration?: string;
}
interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  sample_aspect_ratio?: string;
  pix_fmt?: string;
}
interface FfprobeJson {
  streams?: FfprobeStream[];
  format?: FfprobeFormat;
}

async function probeOne(
  spawn: typeof realSpawn,
  ffprobeBin: string,
  file: string
): Promise<ClipProbe> {
  const empty: ClipProbe = {
    path: file,
    duration: 0,
    width: null,
    height: null,
    fps: null,
    hasAudio: false,
    sar: null,
    pixFmt: null,
  };
  const { code, stdout } = await runProcess(
    spawn,
    ffprobeBin,
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file],
    30_000
  );
  if (code !== 0 || !stdout) return empty;
  try {
    const json = JSON.parse(stdout) as FfprobeJson;
    const v = json.streams?.find((s) => s.codec_type === 'video');
    const hasAudio = !!json.streams?.some((s) => s.codec_type === 'audio');
    let fps: number | null = null;
    if (v?.r_frame_rate) {
      const [num, den] = v.r_frame_rate.split('/');
      const nn = Number(num);
      const dd = Number(den);
      if (nn > 0 && dd > 0) fps = Math.round(nn / dd);
    }
    return {
      path: file,
      duration: json.format?.duration ? Number(json.format.duration) : 0,
      width: v?.width ?? null,
      height: v?.height ?? null,
      fps,
      hasAudio,
      sar: v?.sample_aspect_ratio ?? null,
      pixFmt: v?.pix_fmt ?? null,
    };
  } catch {
    return empty;
  }
}

async function ffmpegAvailable(spawn: typeof realSpawn, ffmpegBin: string): Promise<boolean> {
  const { code } = await runProcess(spawn, ffmpegBin, ['-version'], 10_000);
  return code === 0;
}

/** Probe the local ffmpeg for a gl-transition filter; returns its name or null. */
async function detectGlFilter(spawn: typeof realSpawn, ffmpegBin: string): Promise<string | null> {
  const { code, stdout } = await runProcess(spawn, ffmpegBin, ['-hide_banner', '-filters'], 10_000);
  if (code !== 0) return null;
  if (/\bgltransition\b/.test(stdout)) return 'gltransition';
  if (/\bgl-transition\b/.test(stdout)) return 'gl-transition';
  return null;
}

// ============================================================================
// Orchestrator
// ============================================================================

export async function assembleFilm(
  input: AssembleFilmInput,
  deps: AssembleFilmDeps = {}
): Promise<AssembleFilmResult> {
  const spawn = deps.spawn ?? realSpawn;
  const ffmpegBin = deps.ffmpegBin ?? 'ffmpeg';
  const ffprobeBin = deps.ffprobeBin ?? 'ffprobe';
  const engine: TransitionEngine = input.engine ?? 'xfade';
  const warnings: string[] = [];

  const fail = (error: string, extra: Partial<AssembleFilmResult> = {}): AssembleFilmResult => ({
    kind: 'film_assemble_result',
    success: false,
    engine,
    clipCount: input.clips?.length ?? 0,
    transitionCount: 0,
    targetWidth: 0,
    targetHeight: 0,
    fps: 0,
    estimatedDuration: 0,
    hasAudio: false,
    transitions: [],
    warnings,
    error,
    ...extra,
  });

  if (!input.clips || input.clips.length === 0) {
    return fail('At least one clip is required to assemble a film.');
  }
  if (!(await ffmpegAvailable(spawn, ffmpegBin))) {
    return fail('ffmpeg is required for film assembly but was not found on PATH.');
  }

  // 1. Probe clips.
  const probes = deps.probeClips
    ? await deps.probeClips(input.clips)
    : await Promise.all(input.clips.map((c) => probeOne(spawn, ffprobeBin, c)));

  const usable = probes.filter((p) => p.duration > 0);
  if (usable.length === 0) {
    return fail('None of the provided clips could be probed (missing, empty, or unreadable).');
  }
  if (usable.length < probes.length) {
    warnings.push(`${probes.length - usable.length} clip(s) skipped (unreadable or zero-length).`);
  }
  if (usable.length === 1 && input.clips.length === 1) {
    warnings.push('Only one usable clip — the film is a normalized re-encode of that clip.');
  }

  // 2. Resolve output profile + transitions.
  const profile = resolveOutputProfile(input, usable);
  const durations = usable.map((p) => p.duration);
  const { specs, warnings: tWarnings } = normalizeTransitions(
    input.transitions,
    usable.length - 1,
    input.transitionDuration ?? DEFAULT_TRANSITION_DURATION,
    durations
  );
  warnings.push(...tWarnings);

  // 3. gl engine: detect or fall back to xfade.
  let glFilter: string | null = null;
  if (engine === 'gl') {
    glFilter = deps.detectGl
      ? (await deps.detectGl())
        ? 'gltransition'
        : null
      : await detectGlFilter(spawn, ffmpegBin);
    if (!glFilter) {
      warnings.push(
        'gl engine requested but no gl-transition filter in this ffmpeg — falling back to xfade.'
      );
    }
  }

  // 4. Resolve output path.
  const rootDir = path.resolve(input.rootDir ?? process.cwd());
  const id = deps.createId?.() ?? `${Date.now()}-${randomUUID()}`;
  const safeName = (input.name ?? 'film').replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 60) || 'film';
  let outputPath = input.output ? path.resolve(rootDir, input.output) : '';
  if (!outputPath) {
    const dir = path.join(rootDir, '.codebuddy', 'media-generation', 'films');
    await fs.mkdir(dir, { recursive: true }).catch(() => undefined);
    outputPath = path.join(dir, `${safeName}-${id}.mp4`);
  } else {
    await fs.mkdir(path.dirname(outputPath), { recursive: true }).catch(() => undefined);
  }

  const usingXfade = specs.some((s) => s.type !== 'cut' && s.duration > 0);
  const estimatedDuration = round2(
    usingXfade
      ? durations.reduce((a, b) => a + b, 0) - specs.reduce((a, s) => a + s.duration, 0)
      : durations.reduce((a, b) => a + b, 0)
  );

  // 5. Build argv + render.
  const plan = buildFilmArgs(usable, profile, specs, {
    ffmpegBin,
    outputPath,
    engine,
    glFilter,
    music: input.music,
    musicVolume: input.musicVolume ?? DEFAULT_MUSIC_VOLUME,
    ducking: input.ducking ?? true,
    voiceover: input.voiceover,
  });

  logger.info(
    `[film-assemble] ${usable.length} clip(s), engine=${engine}${glFilter ? '/gl' : ''}, ` +
      `${profile.width}x${profile.height}@${profile.fps}, ~${estimatedDuration}s`
  );

  const render = await runProcess(spawn, ffmpegBin, plan.args, deps.timeoutMs ?? 30 * 60 * 1000);
  if (render.code !== 0) {
    const tail = render.stderr.trim().split('\n').slice(-6).join('\n');
    return fail(`ffmpeg film render failed (exit ${render.code}).\n${tail}`, {
      transitionCount: specs.length,
      targetWidth: profile.width,
      targetHeight: profile.height,
      fps: profile.fps,
      estimatedDuration,
      transitions: specs,
    });
  }

  // 6. Verify + sidecar. `prompt`/`provider`/`model` mirror the video_generate
  // sidecar shape so the media library shows a meaningful card for the film.
  const outProbe = await probeOne(spawn, ffprobeBin, outputPath);
  const effectiveEngine = glFilter ? 'gl' : 'xfade';
  await writeMediaSidecar(outputPath, {
    kind: 'film',
    name: safeName,
    prompt: `${input.name ?? 'Film'} — ${usable.length} clips enchaînés (${effectiveEngine}, ~${estimatedDuration}s)`,
    provider: 'film',
    model: effectiveEngine,
    engine: effectiveEngine,
    clips: input.clips,
    transitions: specs,
    resolution: `${profile.width}x${profile.height}`,
    fps: profile.fps,
    estimatedDuration,
    music: input.music ?? null,
    voiceover: input.voiceover ?? null,
    generatedAt: new Date().toISOString(),
  });

  return {
    kind: 'film_assemble_result',
    success: true,
    outputPath,
    mediaPath: `MEDIA:${outputPath}`,
    engine,
    clipCount: usable.length,
    transitionCount: specs.length,
    targetWidth: profile.width,
    targetHeight: profile.height,
    fps: profile.fps,
    estimatedDuration,
    probedDuration: outProbe.duration > 0 ? round2(outProbe.duration) : undefined,
    hasAudio: outProbe.hasAudio,
    transitions: specs,
    warnings,
  };
}
