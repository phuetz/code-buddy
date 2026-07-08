/**
 * Film producer — the end-to-end, resumable pipeline that turns a scene plan
 * into a finished long-form film: generate one clip per scene (with a fixed
 * seed and optional last-frame → next-scene continuity), then weld the clips
 * with transitions + music via the montage brick, and run the quality gate.
 *
 * It is the scripted orchestration on top of the pieces that already exist:
 *   generateVideo  (src/tools/media-generation-tool.ts)
 *   assembleFilm   (src/tools/video/film-assemble.ts)
 *   FilmProject +  (src/tools/video/film-project.ts)
 *   assessFilmQuality
 *
 * Resumable: state lives in the film.json manifest, saved after every scene,
 * so a crashed/failed run picks up where it left off and a single scene can be
 * regenerated without redoing the film. Every heavy dependency (clip
 * generation, assembly, quality, frame extraction) is INJECTED so the
 * orchestration is unit-testable without a provider or ffmpeg.
 *
 * @module agent/film/film-producer
 */

import { spawn as realSpawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../../utils/logger.js';
import { generateVideo } from '../../tools/media-generation-tool.js';
import { assembleFilm, type AssembleFilmResult } from '../../tools/video/film-assemble.js';
import {
  createFilmProject,
  loadFilmProject,
  saveFilmProject,
  logDecision,
  readyClips,
  filmProgress,
  filmSlug,
  assessFilmQuality,
  type FilmProject,
  type FilmScene,
  type FilmOutputConfig,
  type FilmAudioConfig,
  type FilmQualityReport,
  type FilmProgress,
} from '../../tools/video/film-project.js';
import {
  synthesizeNarration,
  muxNarration as muxNarrationDefault,
  type NarrationResult,
} from '../../tools/video/narration.js';

/** Silence padding (seconds) around a scene's narration inside its clip. */
const NARRATION_LEAD = 0.5;
const NARRATION_TRAIL = 0.9;

// ============================================================================
// Types
// ============================================================================

export interface ScenePlanEntry {
  prompt: string;
  seed?: number;
  duration?: number;
  /** Spoken narration for this scene (synthesized with Piper, laid over the clip). */
  narration?: string;
}

export interface ProduceFilmInput {
  name: string;
  pitch?: string;
  /** Scene plan (used when creating a new project). */
  scenes?: ScenePlanEntry[];
  output?: FilmOutputConfig;
  transition?: string;
  transitionDuration?: number;
  engine?: 'xfade' | 'gl';
  audio?: FilmAudioConfig;
  /** Base seed applied to scenes that do not set their own (visual consistency). */
  seed?: number;
  /** Chain the last frame of scene N as the reference image of scene N+1. */
  continuity?: boolean;
  /** Load an existing project and continue it (default true when one exists). */
  resume?: boolean;
  /** Recreate the project from `scenes` even if one exists. */
  overwrite?: boolean;
  /** Skip generation; just (re)assemble the already-ready clips. */
  assembleOnly?: boolean;
  /** Force one scene (by id) back to pending before running. */
  regenerateScene?: string;
  rootDir?: string;
}

export interface SceneGenContext {
  rootDir: string;
  output: FilmOutputConfig;
  baseSeed?: number;
}

export interface SceneGenResult {
  clipPath?: string;
  error?: string;
  provider?: string;
  model?: string;
}

export interface ProduceFilmDeps {
  /** Generate one clip for a scene (default: generateVideo). */
  generateClip?: (scene: FilmScene, ctx: SceneGenContext) => Promise<SceneGenResult>;
  /** Assemble ready clips into the film (default: assembleFilm). */
  assemble?: (input: Parameters<typeof assembleFilm>[0]) => Promise<AssembleFilmResult>;
  /** Post-render quality gate (default: assessFilmQuality). */
  assessQuality?: (filmPath: string, expectedDuration?: number) => Promise<FilmQualityReport>;
  /** Extract a clip's last frame for continuity (default: ffmpeg). */
  extractLastFrame?: (clipPath: string, outPath: string) => Promise<string | null>;
  /** Synthesize a scene's narration to a WAV (default: Piper). Null = skip. */
  narrate?: (text: string, outPath: string) => Promise<NarrationResult | null>;
  /** Bake a narration WAV into a clip's audio (default: ffmpeg). */
  muxNarration?: (
    clip: string,
    wav: string,
    out: string,
    duration: number,
    lead: number
  ) => Promise<boolean>;
  now?: () => Date;
  spawn?: typeof realSpawn;
}

export interface ProduceFilmResult {
  success: boolean;
  name: string;
  filmPath?: string;
  progress: FilmProgress;
  quality?: FilmQualityReport;
  scenes: Array<{ id: string; status: FilmScene['status']; clipPath?: string; error?: string }>;
  warnings: string[];
  error?: string;
}

// ============================================================================
// Default heavy deps
// ============================================================================

async function defaultGenerateClip(
  scene: FilmScene,
  ctx: SceneGenContext
): Promise<SceneGenResult> {
  const seed = scene.seed ?? ctx.baseSeed;
  const res = await generateVideo(
    {
      prompt: scene.prompt,
      ...(seed !== undefined ? { seed } : {}),
      ...(scene.duration !== undefined ? { duration: scene.duration } : {}),
      ...(scene.referenceImage !== undefined ? { imageUrl: scene.referenceImage } : {}),
      ...(ctx.output.aspectRatio !== undefined ? { aspectRatio: ctx.output.aspectRatio } : {}),
      ...(isPreset(ctx.output.resolution) ? { resolution: ctx.output.resolution } : {}),
    },
    { rootDir: ctx.rootDir }
  );
  if (res.success && res.outputPath) {
    return { clipPath: res.outputPath, provider: res.provider, model: res.model };
  }
  return { error: res.error ?? 'video generation failed' };
}

function isPreset(res?: string): res is string {
  return !!res && /^(360p|480p|540p|720p|1080p|1440p|2160p|4k)$/i.test(res);
}

function defaultExtractLastFrame(spawn: typeof realSpawn) {
  return (clipPath: string, outPath: string): Promise<string | null> =>
    new Promise((resolve) => {
      let settled = false;
      const done = (v: string | null): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(v);
      };
      let child: ReturnType<typeof realSpawn>;
      try {
        // -sseof seeks relative to EOF: grab a frame ~0.2s before the end.
        child = spawn(
          'ffmpeg',
          ['-y', '-sseof', '-0.2', '-i', clipPath, '-vframes', '1', '-q:v', '2', outPath],
          {
            stdio: ['ignore', 'ignore', 'ignore'],
          }
        );
      } catch {
        done(null);
        return;
      }
      const timer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* gone */
        }
        done(null);
      }, 30_000);
      child.on('error', () => done(null));
      child.on('close', (code) => done(code === 0 ? outPath : null));
    });
}

// ============================================================================
// Orchestrator
// ============================================================================

export async function produceFilm(
  input: ProduceFilmInput,
  deps: ProduceFilmDeps = {}
): Promise<ProduceFilmResult> {
  const rootDir = path.resolve(input.rootDir ?? process.cwd());
  const now = deps.now ?? (() => new Date());
  const generateClip = deps.generateClip ?? defaultGenerateClip;
  const assemble = deps.assemble ?? ((i: Parameters<typeof assembleFilm>[0]) => assembleFilm(i));
  const assessQuality =
    deps.assessQuality ??
    ((f: string, expected?: number) =>
      assessFilmQuality(f, expected !== undefined ? { expectedDuration: expected } : {}));
  const extractLastFrame =
    deps.extractLastFrame ?? defaultExtractLastFrame(deps.spawn ?? realSpawn);
  const narrate =
    deps.narrate ?? ((text: string, out: string) => synthesizeNarration(text, out, {}));
  const muxNarrationFn =
    deps.muxNarration ??
    ((clip: string, wav: string, out: string, dur: number, lead: number) =>
      muxNarrationDefault(clip, wav, out, dur, lead, {}));
  const warnings: string[] = [];

  const fail = (error: string, project?: FilmProject): ProduceFilmResult => ({
    success: false,
    name: input.name,
    progress: project ? filmProgress(project) : { total: 0, ready: 0, failed: 0, pending: 0 },
    scenes: project ? summarize(project) : [],
    warnings,
    error,
  });

  // 1. Load or create the project.
  const existing = await loadFilmProject(rootDir, input.name);
  let project: FilmProject;
  if (existing && !input.overwrite && (input.resume ?? true)) {
    project = existing;
  } else if (input.scenes && input.scenes.length > 0) {
    project = createFilmProject({
      name: input.name,
      ...(input.pitch !== undefined ? { pitch: input.pitch } : {}),
      scenes: input.scenes,
      ...(input.output !== undefined ? { output: input.output } : {}),
      ...(input.transition !== undefined ? { transition: input.transition } : {}),
      ...(input.transitionDuration !== undefined
        ? { transitionDuration: input.transitionDuration }
        : {}),
      ...(input.engine !== undefined ? { engine: input.engine } : {}),
      ...(input.audio !== undefined ? { audio: input.audio } : {}),
      now,
    });
  } else if (existing) {
    project = existing;
  } else {
    return fail('No scene plan provided and no existing project to resume.');
  }

  // 2. Force-regenerate one scene if asked.
  if (input.regenerateScene) {
    const scene = project.scenes.find((s) => s.id === input.regenerateScene);
    if (scene) {
      scene.status = 'pending';
      delete scene.clipPath;
      delete scene.error;
      logDecision(project, 'regenerate-requested', scene.id, now);
    } else {
      warnings.push(`regenerateScene: no scene '${input.regenerateScene}'.`);
    }
  }

  await saveFilmProject(rootDir, project, now);

  // 3. Generation phase (in scene order, so continuity can chain frames).
  if (!input.assembleOnly) {
    for (let i = 0; i < project.scenes.length; i++) {
      const scene = project.scenes[i]!;
      if (scene.status === 'ready' && scene.clipPath) continue;

      scene.status = 'generating';
      scene.updatedAt = now().toISOString();
      await saveFilmProject(rootDir, project, now);

      // Narration (Piper): synthesize FIRST so the scene is sized to fit the
      // voiceover (the clip is then rendered at that duration, then the narration
      // is baked in silence-padded so boundary crossfades only touch silence).
      let narrationWav: string | null = null;
      if (scene.narration) {
        const workDir = path.join(rootDir, '.codebuddy', 'film-work', filmSlug(project.name));
        await fs.mkdir(workDir, { recursive: true }).catch(() => undefined);
        const nr = await narrate(scene.narration, path.join(workDir, `nar-${scene.id}.wav`));
        if (nr) {
          narrationWav = nr.path;
          const needed = Math.round((nr.duration + NARRATION_LEAD + NARRATION_TRAIL) * 100) / 100;
          scene.duration = Math.max(scene.duration ?? 0, needed);
        } else {
          warnings.push(`${scene.id}: narration skipped (Piper unavailable)`);
        }
      }

      // Continuity: use the previous ready clip's last frame as this scene's ref.
      // Written under .codebuddy/film-work/ (NOT the scanned media-generation tree)
      // so these internal reference frames never pollute the media library.
      if (input.continuity && i > 0) {
        const prev = project.scenes[i - 1]!;
        if (prev.status === 'ready' && prev.clipPath) {
          const workDir = path.join(rootDir, '.codebuddy', 'film-work', filmSlug(project.name));
          await fs.mkdir(workDir, { recursive: true }).catch(() => undefined);
          const framePath = path.join(workDir, `ref-${scene.id}.jpg`);
          const frame = await extractLastFrame(prev.clipPath, framePath);
          if (frame) scene.referenceImage = frame;
        }
      }

      const res = await generateClip(scene, {
        rootDir,
        output: project.output,
        ...(input.seed !== undefined ? { baseSeed: input.seed } : {}),
      });

      if (res.clipPath) {
        let clipPath = res.clipPath;
        // Bake the narration into the freshly-rendered clip.
        if (narrationWav) {
          const workDir = path.join(rootDir, '.codebuddy', 'film-work', filmSlug(project.name));
          const muxed = path.join(workDir, `clip-${scene.id}.mp4`);
          const ok = await muxNarrationFn(
            clipPath,
            narrationWav,
            muxed,
            scene.duration ?? 4,
            NARRATION_LEAD
          );
          if (ok) clipPath = muxed;
          else warnings.push(`${scene.id}: narration mux failed`);
        }
        scene.clipPath = clipPath;
        scene.status = 'ready';
        delete scene.error;
        logDecision(
          project,
          'scene-ready',
          `${scene.id}${res.provider ? ` (${res.provider})` : ''}${narrationWav ? ' +voix' : ''}`,
          now
        );
      } else {
        scene.status = 'failed';
        scene.error = res.error ?? 'generation failed';
        warnings.push(`${scene.id}: ${scene.error}`);
        logDecision(project, 'scene-failed', `${scene.id}: ${scene.error}`, now);
      }
      scene.updatedAt = now().toISOString();
      await saveFilmProject(rootDir, project, now);
    }
  }

  // 4. Assemble ready clips (in order).
  const clips = readyClips(project);
  if (clips.length === 0) {
    logDecision(project, 'assemble-skipped', 'no ready clips', now);
    await saveFilmProject(rootDir, project, now);
    return fail('No scene produced a usable clip — nothing to assemble.', project);
  }
  if (clips.length < project.scenes.length) {
    warnings.push(`Assembling ${clips.length}/${project.scenes.length} scenes (some failed).`);
  }

  const assembleRes = await assemble({
    clips,
    transitions: project.transition,
    transitionDuration: project.transitionDuration,
    engine: project.engine,
    ...(project.output.resolution !== undefined ? { resolution: project.output.resolution } : {}),
    ...(project.output.aspectRatio !== undefined
      ? { aspectRatio: project.output.aspectRatio }
      : {}),
    ...(project.output.fps !== undefined ? { fps: project.output.fps } : {}),
    ...(project.audio.music !== undefined ? { music: project.audio.music } : {}),
    ...(project.audio.musicVolume !== undefined ? { musicVolume: project.audio.musicVolume } : {}),
    ...(project.audio.ducking !== undefined ? { ducking: project.audio.ducking } : {}),
    ...(project.audio.voiceover !== undefined ? { voiceover: project.audio.voiceover } : {}),
    name: project.name,
    rootDir,
  });
  warnings.push(...assembleRes.warnings);

  if (!assembleRes.success || !assembleRes.outputPath) {
    logDecision(project, 'assemble-failed', assembleRes.error, now);
    await saveFilmProject(rootDir, project, now);
    return fail(assembleRes.error ?? 'film assembly failed', project);
  }

  project.filmPath = assembleRes.outputPath;
  logDecision(project, 'assembled', `${clips.length} clip(s) → ${assembleRes.outputPath}`, now);

  // 5. Quality gate.
  let quality: FilmQualityReport | undefined;
  try {
    quality = await assessQuality(assembleRes.outputPath, assembleRes.estimatedDuration);
    logDecision(
      project,
      quality.pass ? 'quality-pass' : 'quality-review',
      quality.warnings.join('; ') || 'ok',
      now
    );
    if (!quality.pass) warnings.push(...quality.warnings);
  } catch (err) {
    warnings.push(
      `Quality gate could not run: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  await saveFilmProject(rootDir, project, now);

  logger.info(
    `[film-producer] '${project.name}' → ${assembleRes.outputPath} (${clips.length} scene(s))`
  );

  return {
    success: true,
    name: project.name,
    filmPath: assembleRes.outputPath,
    progress: filmProgress(project),
    ...(quality !== undefined ? { quality } : {}),
    scenes: summarize(project),
    warnings,
  };
}

function summarize(project: FilmProject): ProduceFilmResult['scenes'] {
  return project.scenes.map((s) => ({
    id: s.id,
    status: s.status,
    ...(s.clipPath !== undefined ? { clipPath: s.clipPath } : {}),
    ...(s.error !== undefined ? { error: s.error } : {}),
  }));
}
