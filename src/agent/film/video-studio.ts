/**
 * Video Studio — the end-to-end "prompt → premium presentation video" engine.
 *
 * Pipeline: plan scenes (LLM) → per scene: synthesize narration (Piper), render
 * the visual (Mermaid diagram → PNG when available, else an animated text card),
 * render the premium clip (framing + Ken Burns + vignette + karaoke captions +
 * voice) → assemble with transitions + a music bed (ducked) → quality gate →
 * save under the media library. 100% local/$0 by default. Every heavy dep is
 * injected, so the orchestration is unit-testable without an LLM or ffmpeg.
 *
 * @module agent/film/video-studio
 */

import { spawn as realSpawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../../utils/logger.js';
import {
  filmSlug,
  assessFilmQuality,
  type FilmQualityReport,
} from '../../tools/video/film-project.js';
import { assembleFilm, type AssembleFilmResult } from '../../tools/video/film-assemble.js';
import { synthesizeNarration } from '../../tools/video/narration.js';
import { renderScene } from '../../tools/video/scene-render.js';
import { planScenes, type PlannedScene } from './scene-planner.js';

const LEAD = 0.6;
const TRAIL = 1.0;
/** Rotating dark gradient palette so consecutive scenes feel distinct. */
const PALETTE: Array<[string, string]> = [
  ['#0f2027', '#2c5364'],
  ['#1a2a6c', '#2a5298'],
  ['#203a43', '#44a08d'],
  ['#42275a', '#734b6d'],
  ['#0b486b', '#3b8686'],
  ['#16222a', '#3a6073'],
];

export interface VideoStudioOptions {
  name?: string;
  count?: number;
  lang?: string;
  model?: string;
  /** 'WxH' or a preset via assembleFilm; default 1920x1080. */
  resolution?: string;
  music?: string;
  noMusic?: boolean;
  subtitles?: boolean;
  transition?: string;
  transitionDuration?: number;
  rootDir?: string;
  output?: string;
}

export interface VideoStudioProgress {
  phase: 'planning' | 'narration' | 'visual' | 'render' | 'assemble' | 'quality' | 'done';
  scene?: number;
  total?: number;
  message?: string;
}

export interface VideoStudioDeps {
  plan?: (
    pitch: string,
    opts: { count?: number; lang?: string; model?: string }
  ) => Promise<PlannedScene[]>;
  synthesize?: (
    text: string,
    outPath: string
  ) => Promise<{ path: string; duration: number } | null>;
  /** Render Mermaid → PNG; return the path or null (→ text card fallback). */
  renderMermaid?: (mermaid: string, outPath: string) => Promise<string | null>;
  renderSceneClip?: typeof renderScene;
  assemble?: (input: Parameters<typeof assembleFilm>[0]) => Promise<AssembleFilmResult>;
  assessQuality?: (film: string, expected?: number) => Promise<FilmQualityReport>;
  spawn?: typeof realSpawn;
  onProgress?: (p: VideoStudioProgress) => void;
}

export interface VideoStudioResult {
  success: boolean;
  filmPath?: string;
  sceneCount: number;
  probedDuration?: number;
  quality?: FilmQualityReport;
  plan?: PlannedScene[];
  warnings: string[];
  error?: string;
}

function parseWH(resolution: string | undefined): { w: number; h: number } {
  const m = (resolution ?? '').match(/^(\d{2,5})\s*[xX*]\s*(\d{2,5})$/);
  if (m) return { w: Number(m[1]), h: Number(m[2]) };
  return { w: 1920, h: 1080 };
}

/** Default Mermaid → PNG via mmdc (headless, auto Chromium). Null → text-card fallback. */
async function defaultRenderMermaid(mermaid: string, outPath: string): Promise<string | null> {
  const { renderMermaidPng } = await import('../../tools/video/mermaid-render.js');
  return renderMermaidPng(mermaid, outPath, {});
}

/** ffmpeg argv for a warm ambient music bed of `duration`s with baked in/out fades (pure). */
export function buildMusicBedArgs(ffmpegBin: string, duration: number, outPath: string): string[] {
  const fadeOut = Math.max(0.1, duration - 3);
  const freqs = [130.8, 196, 261.6, 329.6, 392];
  const inputs = freqs.flatMap((f) => [
    '-f',
    'lavfi',
    '-i',
    `sine=f=${f}:d=${Math.ceil(duration) + 1}`,
  ]);
  const mixLabels = freqs.map((_, i) => `[${i}]`).join('');
  const filter =
    `${mixLabels}amix=inputs=${freqs.length}:normalize=1,tremolo=f=0.14:d=0.35,lowpass=f=1150,` +
    `aecho=0.8:0.7:70:0.3,afade=t=in:d=2.5,afade=t=out:st=${round2(fadeOut)}:d=3,volume=0.9[a]`;
  return [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    ...inputs,
    '-filter_complex',
    filter,
    '-map',
    '[a]',
    '-t',
    String(round2(duration)),
    '-c:a',
    'aac',
    '-b:a',
    '160k',
    outPath,
  ];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function runOk(
  spawn: typeof realSpawn,
  cmd: string,
  args: string[],
  timeoutMs = 5 * 60 * 1000
): Promise<boolean> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof realSpawn>;
    let settled = false;
    const done = (v: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      resolve(v);
    };
    try {
      child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'ignore'] });
    } catch {
      done(false);
      return;
    }
    const t = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* gone */
      }
      done(false);
    }, timeoutMs);
    child.on('error', () => done(false));
    child.on('close', (code) => done(code === 0));
  });
}

export async function produceVideoFromPrompt(
  pitch: string,
  options: VideoStudioOptions = {},
  deps: VideoStudioDeps = {}
): Promise<VideoStudioResult> {
  const spawn = deps.spawn ?? realSpawn;
  const plan = deps.plan ?? ((p, o) => planScenes(p, o));
  const synthesize = deps.synthesize ?? ((t, o) => synthesizeNarration(t, o, {}));
  const renderMermaid = deps.renderMermaid ?? defaultRenderMermaid;
  const renderSceneClip = deps.renderSceneClip ?? renderScene;
  const assemble = deps.assemble ?? ((i: Parameters<typeof assembleFilm>[0]) => assembleFilm(i));
  const assessQuality =
    deps.assessQuality ??
    ((f: string, e?: number) =>
      assessFilmQuality(f, e !== undefined ? { expectedDuration: e } : {}));
  const emit = (p: VideoStudioProgress): void => deps.onProgress?.(p);
  const warnings: string[] = [];
  const { w, h } = parseWH(options.resolution);
  const name = options.name ?? pitch.slice(0, 40);
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const subtitles = options.subtitles ?? true;
  const transitionDuration = options.transitionDuration ?? 0.6;

  const fail = (error: string, plan?: PlannedScene[]): VideoStudioResult => ({
    success: false,
    sceneCount: plan?.length ?? 0,
    ...(plan ? { plan } : {}),
    warnings,
    error,
  });

  // 1. Plan.
  emit({ phase: 'planning', message: pitch });
  let scenes: PlannedScene[];
  try {
    scenes = await plan(pitch, {
      ...(options.count !== undefined ? { count: options.count } : {}),
      ...(options.lang ? { lang: options.lang } : {}),
      ...(options.model ? { model: options.model } : {}),
    });
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
  const total = scenes.length;

  const workDir = path.join(rootDir, '.codebuddy', 'film-work', filmSlug(name));
  const clipsDir = path.join(workDir, 'clips');
  await fs.mkdir(clipsDir, { recursive: true }).catch(() => undefined);

  // 2. Per-scene: narration → visual → clip.
  const clips: string[] = [];
  const durations: number[] = [];
  for (let i = 0; i < scenes.length; i++) {
    const sc = scenes[i]!;
    emit({ phase: 'narration', scene: i + 1, total, message: sc.title });
    const narr = await synthesize(sc.narration, path.join(workDir, `nar-${i + 1}.wav`));
    const duration = round2((narr ? narr.duration : 3.5) + LEAD + TRAIL);

    let imagePath: string | undefined;
    if (sc.visual.kind === 'diagram' && sc.visual.mermaid) {
      emit({ phase: 'visual', scene: i + 1, total, message: 'diagramme' });
      const png = await renderMermaid(sc.visual.mermaid, path.join(workDir, `diag-${i + 1}.png`));
      if (png) imagePath = png;
      else warnings.push(`scène ${i + 1}: diagramme indisponible (mmdc absent) → carte texte`);
    }

    emit({ phase: 'render', scene: i + 1, total, message: sc.title });
    const [c0, c1] = PALETTE[i % PALETTE.length]!;
    const clip = path.join(clipsDir, `scene-${i + 1}.mp4`);
    const res = await renderSceneClip(
      {
        id: `scene-${i + 1}`,
        title: sc.title,
        ...(sc.subtitle ? { subtitle: sc.subtitle } : {}),
        narrationText: sc.narration,
        ...(narr ? { narrationWav: narr.path } : {}),
        duration,
        visual: imagePath ? { kind: 'image', imagePath } : { kind: 'text' },
        c0,
        c1,
        outPath: clip,
        width: w,
        height: h,
        subtitles,
      },
      { spawn, workDir }
    );
    if (res.ok) {
      clips.push(clip);
      durations.push(duration);
    } else {
      warnings.push(`scène ${i + 1}: ${res.error ?? 'rendu échoué'}`);
    }
  }

  if (clips.length === 0) return fail("Aucune scène n'a pu être rendue.", scenes);

  // 3. Music bed (optional) sized to the film.
  let music = options.music;
  const estimated = round2(
    durations.reduce((a, b) => a + b, 0) - (clips.length - 1) * transitionDuration
  );
  if (!music && !options.noMusic) {
    const bed = path.join(workDir, 'music.m4a');
    if (await runOk(spawn, 'ffmpeg', buildMusicBedArgs('ffmpeg', Math.max(4, estimated), bed)))
      music = bed;
    else warnings.push('nappe musicale indisponible');
  }

  // 4. Assemble.
  emit({ phase: 'assemble', total, message: `${clips.length} scène(s)` });
  const assembleRes = await assemble({
    clips,
    transitions: options.transition ?? 'fade',
    transitionDuration,
    resolution: options.resolution ?? '1920x1080',
    fps: 30,
    ...(music ? { music, musicVolume: 0.16, ducking: true } : {}),
    name,
    rootDir,
    ...(options.output ? { output: options.output } : {}),
  });
  warnings.push(...assembleRes.warnings);
  if (!assembleRes.success || !assembleRes.outputPath)
    return fail(assembleRes.error ?? 'assemblage échoué', scenes);

  // 5. Quality gate.
  emit({ phase: 'quality', total });
  let quality: FilmQualityReport | undefined;
  try {
    quality = await assessQuality(assembleRes.outputPath, assembleRes.estimatedDuration);
    if (!quality.pass) warnings.push(...quality.warnings);
  } catch (e) {
    warnings.push(`porte qualité: ${e instanceof Error ? e.message : String(e)}`);
  }

  emit({ phase: 'done', total, message: assembleRes.outputPath });
  logger.info(`[video-studio] « ${name} » → ${assembleRes.outputPath} (${clips.length} scène(s))`);
  return {
    success: true,
    filmPath: assembleRes.outputPath,
    sceneCount: clips.length,
    ...(assembleRes.probedDuration !== undefined
      ? { probedDuration: assembleRes.probedDuration }
      : {}),
    ...(quality ? { quality } : {}),
    plan: scenes,
    warnings,
  };
}
