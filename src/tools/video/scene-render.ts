/**
 * Scene render — turns one planned scene into a premium 1080p clip: a framed
 * visual (rounded corners + drop shadow on a gradient) or an animated text card,
 * with a slow Ken Burns push, a cinematic vignette, burned karaoke captions and
 * the scene's narration muxed in. This is the "wow" recipe, native (spawn ffmpeg
 * + optional ImageMagick `convert`), fail-open, argv-testable — the productized
 * form of the earlier build_wow.py prototype.
 *
 * @module tools/video/scene-render
 */

import { spawn as realSpawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../../utils/logger.js';
import { buildKaraokeAss } from './subtitles.js';

export interface RenderSceneInput {
  id: string;
  title: string;
  subtitle?: string;
  /** Narration text (for captions). */
  narrationText?: string;
  /** Synthesized narration WAV to mux (from narration.ts). */
  narrationWav?: string;
  /** Final clip duration in seconds. */
  duration: number;
  /** 'image' → framed still (imagePath required); else an animated text card. */
  visual: { kind: 'text' | 'image'; imagePath?: string };
  /** Gradient endpoints (hex like '#0f2027') for text cards / framing backdrop. */
  c0?: string;
  c1?: string;
  outPath: string;
  width?: number;
  height?: number;
  /** Silence before the narration inside the clip (default 0.6). */
  lead?: number;
  /** Burn karaoke captions (default true when there's narration text). */
  subtitles?: boolean;
}

export interface RenderSceneDeps {
  spawn?: typeof realSpawn;
  ffmpegBin?: string;
  convertBin?: string;
  identifyBin?: string;
  /** Working dir for intermediate stills / ass (default: alongside outPath). */
  workDir?: string;
  /** Force-disable ImageMagick (tests / degraded mode). */
  noImageMagick?: boolean;
}

const FB = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
const FR = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';

// ============================================================================
// Pure argv builders (unit-tested)
// ============================================================================

/** Escape a filename for the ffmpeg `subtitles=` filter value. */
export function escapeSubtitlesPath(p: string): string {
  return p.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

/**
 * The ffmpeg argv for a scene clip: Ken Burns + vignette + optional burned
 * captions on the still, with the narration delayed/padded to fill the clip.
 * Pure — the main test seam.
 */
export function buildSceneVideoArgs(opts: {
  ffmpegBin: string;
  still: string;
  outPath: string;
  duration: number;
  width: number;
  height: number;
  narrationWav?: string;
  assPath?: string;
  lead: number;
}): string[] {
  const { width: w, height: h, duration: D } = opts;
  const vfParts = [
    `zoompan=z='min(zoom+0.00035,1.06)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${w}x${h}:fps=30`,
    'vignette=PI/4.5',
  ];
  if (opts.assPath) vfParts.push(`subtitles=${escapeSubtitlesPath(opts.assPath)}`);
  vfParts.push(`fade=t=in:st=0:d=0.4`, `fade=t=out:st=${round2(D - 0.5)}:d=0.5`, 'format=yuv420p');
  const vf = vfParts.join(',');

  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-loop', '1', '-i', opts.still];
  if (opts.narrationWav) args.push('-i', opts.narrationWav);

  const filter = opts.narrationWav
    ? `[0:v]${vf}[v];[1:a]adelay=${Math.round(opts.lead * 1000)}:all=1,` +
      `aformat=sample_rates=48000:channel_layouts=stereo,apad,atrim=0:${round2(D)}[a]`
    : `[0:v]${vf}[v]`;
  args.push('-filter_complex', filter, '-map', '[v]');
  if (opts.narrationWav) args.push('-map', '[a]');
  args.push(
    '-t',
    String(round2(D)),
    '-r',
    '30',
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '18',
    '-pix_fmt',
    'yuv420p'
  );
  if (opts.narrationWav) args.push('-c:a', 'aac', '-b:a', '192k');
  args.push(opts.outPath);
  return args;
}

/** ImageMagick argv for a centered "hero" text card on a gradient (pure). */
export function buildHeroCardArgs(opts: {
  width: number;
  height: number;
  c0: string;
  c1: string;
  title: string;
  subtitle?: string;
  outPath: string;
  big: boolean;
}): string[] {
  const args = [
    '-size',
    `${opts.width}x${opts.height}`,
    '-define',
    'gradient:angle=135',
    `gradient:${opts.c0}-${opts.c1}`,
    '-gravity',
    'center',
    '-font',
    FB,
    '-pointsize',
    String(opts.big ? 128 : 80),
    '-fill',
    'white',
    '-annotate',
    '+0-40',
    opts.title,
  ];
  if (opts.subtitle) {
    args.push(
      '-font',
      FR,
      '-pointsize',
      String(opts.big ? 44 : 36),
      '-fill',
      '#e6ecff',
      '-annotate',
      '+0+70',
      opts.subtitle
    );
  }
  args.push(opts.outPath);
  return args;
}

/** ffmpeg fallback argv to make a still (gradient + title via textfile) when ImageMagick is absent (pure). */
export function buildFallbackStillArgs(opts: {
  ffmpegBin: string;
  width: number;
  height: number;
  c0: string;
  c1: string;
  titleFile: string;
  outPath: string;
}): string[] {
  const { width: w, height: h } = opts;
  const vf =
    `gradients=s=${w}x${h}:c0=0x${hex(opts.c0)}:c1=0x${hex(opts.c1)}:x0=0:y0=0:x1=${w}:y1=${h}:nb_colors=2,` +
    `drawtext=fontfile=${FB}:textfile=${opts.titleFile}:fontcolor=white:fontsize=76:x=(w-text_w)/2:y=(h-text_h)/2:` +
    `shadowcolor=black@0.5:shadowx=3:shadowy=3`;
  return [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    `color=black:s=${w}x${h}`,
    '-vf',
    vf,
    '-frames:v',
    '1',
    opts.outPath,
  ];
}

function hex(c: string): string {
  return c.replace(/^#/, '').replace(/^0x/i, '');
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ============================================================================
// Spawn helpers (injectable)
// ============================================================================

function run(
  spawn: typeof realSpawn,
  cmd: string,
  args: string[],
  timeoutMs = 5 * 60 * 1000
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
      finish({ code: null, stdout, stderr: `${stderr}\n[timeout]` });
    }, timeoutMs);
    child.stdout?.on('data', (d) => (stdout = `${stdout}${String(d)}`.slice(-200_000)));
    child.stderr?.on('data', (d) => (stderr = `${stderr}${String(d)}`.slice(-200_000)));
    child.on('error', (err) => finish({ code: null, stdout, stderr: `${stderr}${err.message}` }));
    child.on('close', (code) => finish({ code, stdout, stderr }));
  });
}

async function hasBinary(spawn: typeof realSpawn, bin: string): Promise<boolean> {
  const { code } = await run(spawn, bin, ['-version'], 10_000);
  return code === 0;
}

// ============================================================================
// Still composition
// ============================================================================

/** Compose a premium framed still (rounded image + shadow on a gradient + title). Requires ImageMagick. */
async function composeFramedStill(
  input: RenderSceneInput,
  stillPath: string,
  deps: Required<Pick<RenderSceneDeps, 'spawn' | 'convertBin' | 'identifyBin'>>,
  w: number,
  h: number
): Promise<boolean> {
  const c0 = input.c0 ?? '#0f2027';
  const c1 = input.c1 ?? '#243b55';
  const resized = `${stillPath}.rs.png`;
  const rounded = `${stillPath}.rnd.png`;
  const bg = `${stillPath}.bg.png`;
  const cleanup = async (): Promise<void> => {
    await Promise.all(
      [resized, rounded, bg].map((f) => fs.rm(f, { force: true }).catch(() => undefined))
    );
  };
  try {
    if (
      (
        await run(deps.spawn, deps.convertBin, [
          input.visual.imagePath!,
          '-resize',
          '1480x740',
          resized,
        ])
      ).code !== 0
    )
      return false;
    const dim = await run(deps.spawn, deps.identifyBin, ['-format', '%w %h', resized]);
    const [iw, ih] = dim.stdout.trim().split(/\s+/).map(Number);
    if (!iw || !ih) return false;
    const roundArgs = [
      resized,
      '(',
      '-size',
      `${iw}x${ih}`,
      'xc:black',
      '-fill',
      'white',
      '-draw',
      `roundrectangle 0,0,${iw - 1},${ih - 1},20,20`,
      ')',
      '-alpha',
      'off',
      '-compose',
      'CopyOpacity',
      '-composite',
      rounded,
    ];
    if ((await run(deps.spawn, deps.convertBin, roundArgs)).code !== 0) return false;
    if (
      (
        await run(deps.spawn, deps.convertBin, [
          '-size',
          `${w}x${h}`,
          '-define',
          'gradient:angle=135',
          `gradient:${c0}-${c1}`,
          bg,
        ])
      ).code !== 0
    )
      return false;
    const composeArgs = [
      bg,
      '(',
      rounded,
      '(',
      '+clone',
      '-background',
      'black',
      '-shadow',
      '55x30+0+24',
      ')',
      '+swap',
      '-background',
      'none',
      '-layers',
      'merge',
      '+repage',
      ')',
      '-gravity',
      'north',
      '-geometry',
      '+0+184',
      '-composite',
      '-gravity',
      'northwest',
      '-font',
      FB,
      '-pointsize',
      '30',
      '-fill',
      '#9fb4ff',
      '-annotate',
      '+92+56',
      '● code-buddy',
      '-font',
      FB,
      '-pointsize',
      '56',
      '-fill',
      'white',
      '-annotate',
      '+92+102',
      input.title,
    ];
    if (input.subtitle)
      composeArgs.push(
        '-font',
        FR,
        '-pointsize',
        '30',
        '-fill',
        '#cdd6f4',
        '-annotate',
        '+92+170',
        input.subtitle
      );
    composeArgs.push(stillPath);
    return (await run(deps.spawn, deps.convertBin, composeArgs)).code === 0;
  } finally {
    await cleanup();
  }
}

/** Build the still for a scene (premium via ImageMagick, else an ffmpeg fallback). */
async function composeStill(
  input: RenderSceneInput,
  stillPath: string,
  deps: RenderSceneDeps,
  w: number,
  h: number,
  useIM: boolean
): Promise<boolean> {
  const spawn = deps.spawn ?? realSpawn;
  const convertBin = deps.convertBin ?? 'convert';
  const identifyBin = deps.identifyBin ?? 'identify';
  const c0 = input.c0 ?? (input.visual.kind === 'image' ? '#0f2027' : '#0f2027');
  const c1 = input.c1 ?? '#2c5364';

  if (useIM && input.visual.kind === 'image' && input.visual.imagePath) {
    return composeFramedStill(input, stillPath, { spawn, convertBin, identifyBin }, w, h);
  }
  if (useIM) {
    const args = buildHeroCardArgs({
      width: w,
      height: h,
      c0,
      c1,
      title: input.title,
      ...(input.subtitle ? { subtitle: input.subtitle } : {}),
      outPath: stillPath,
      big: true,
    });
    return (await run(spawn, convertBin, args)).code === 0;
  }
  // ffmpeg fallback: gradient + title (via textfile to dodge drawtext escaping)
  const titleFile = `${stillPath}.txt`;
  await fs.writeFile(titleFile, input.title).catch(() => undefined);
  const ok =
    (
      await run(
        spawn,
        deps.ffmpegBin ?? 'ffmpeg',
        buildFallbackStillArgs({
          ffmpegBin: deps.ffmpegBin ?? 'ffmpeg',
          width: w,
          height: h,
          c0,
          c1,
          titleFile,
          outPath: stillPath,
        })
      ).catch(() => ({ code: 1 }) as never)
    ).code === 0;
  await fs.rm(titleFile, { force: true }).catch(() => undefined);
  return ok;
}

// ============================================================================
// Public: render one scene
// ============================================================================

export interface RenderSceneResult {
  ok: boolean;
  outPath: string;
  error?: string;
}

export async function renderScene(
  input: RenderSceneInput,
  deps: RenderSceneDeps = {}
): Promise<RenderSceneResult> {
  const spawn = deps.spawn ?? realSpawn;
  const ffmpegBin = deps.ffmpegBin ?? 'ffmpeg';
  const w = input.width ?? 1920;
  const h = input.height ?? 1080;
  const lead = input.lead ?? 0.6;
  const workDir = deps.workDir ?? path.dirname(input.outPath);
  await fs.mkdir(workDir, { recursive: true }).catch(() => undefined);

  const useIM = !deps.noImageMagick && (await hasBinary(spawn, deps.convertBin ?? 'convert'));
  const stillPath = path.join(workDir, `${input.id}.still.png`);
  if (!(await composeStill(input, stillPath, deps, w, h, useIM))) {
    return { ok: false, outPath: input.outPath, error: 'still composition failed' };
  }

  let assPath: string | undefined;
  const wantSubs = input.subtitles ?? !!input.narrationText;
  if (wantSubs && input.narrationText && input.narrationWav) {
    assPath = path.join(workDir, `${input.id}.ass`);
    // Captions are timed to the narration span; leave LEAD of silence before them.
    const narrSpan = round2(input.duration - lead - 0.9);
    await fs
      .writeFile(
        assPath,
        buildKaraokeAss(input.narrationText, Math.max(1, narrSpan), lead, {
          playResX: w,
          playResY: h,
        })
      )
      .catch(() => {
        assPath = undefined;
      });
  }

  const args = buildSceneVideoArgs({
    ffmpegBin,
    still: stillPath,
    outPath: input.outPath,
    duration: input.duration,
    width: w,
    height: h,
    ...(input.narrationWav ? { narrationWav: input.narrationWav } : {}),
    ...(assPath ? { assPath } : {}),
    lead,
  });
  const { code, stderr } = await run(spawn, ffmpegBin, args, 10 * 60 * 1000);
  await fs.rm(stillPath, { force: true }).catch(() => undefined);
  if (code !== 0) {
    logger.warn(
      `[scene-render] ${input.id} ffmpeg failed: ${stderr.trim().split('\n').slice(-3).join(' ')}`
    );
    return { ok: false, outPath: input.outPath, error: `ffmpeg render failed (exit ${code})` };
  }
  return { ok: true, outPath: input.outPath };
}
