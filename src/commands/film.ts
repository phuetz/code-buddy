/**
 * `buddy film` — the end-to-end film producer CLI.
 *
 * Turns a scene plan into a finished long-form film: generate one clip per
 * scene → weld with transitions + music → quality gate. Resumable via the
 * film.json manifest under .codebuddy/media-generation/films/<name>/.
 *
 * Subcommands:
 *   generate <name> --scenes <file>   create/resume a project, generate + assemble
 *   assemble <name>                   (re)assemble the already-ready clips, no generation
 *   status   <name>                   show scene statuses, progress, recent decisions
 *
 * The scene plan (--scenes) is a JSON file: either an array of
 * {prompt, seed?, duration?} or an object { pitch?, scenes:[...], output?,
 * transition?, transitionDuration?, engine?, audio?{music,musicVolume,voiceover} }.
 */
import { Command } from 'commander';
import fs from 'fs/promises';

import { logger } from '../utils/logger.js';
import {
  produceFilm,
  type ProduceFilmInput,
  type ScenePlanEntry,
} from '../agent/film/film-producer.js';
import { loadFilmProject, filmProgress, filmProjectPath } from '../tools/video/film-project.js';

interface GenerateOpts {
  scenes?: string;
  pitch?: string;
  transition?: string;
  transitionDuration?: string;
  engine?: string;
  resolution?: string;
  aspect?: string;
  fps?: string;
  music?: string;
  musicVolume?: string;
  voiceover?: string;
  ducking?: boolean;
  seed?: string;
  continuity?: boolean;
  assembleOnly?: boolean;
  regenerate?: string;
  overwrite?: boolean;
}

interface ScenePlanFile {
  pitch?: string;
  scenes?: ScenePlanEntry[];
  output?: { resolution?: string; aspectRatio?: string; fps?: number };
  transition?: string;
  transitionDuration?: number;
  engine?: 'xfade' | 'gl';
  audio?: { music?: string; musicVolume?: number; ducking?: boolean; voiceover?: string };
}

async function readScenePlan(file: string): Promise<ScenePlanFile> {
  const raw = await fs.readFile(file, 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  if (Array.isArray(parsed)) return { scenes: parsed as ScenePlanEntry[] };
  if (parsed && typeof parsed === 'object') return parsed as ScenePlanFile;
  throw new Error('scene plan must be a JSON array of scenes or an object with a "scenes" array');
}

function num(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function printResult(res: Awaited<ReturnType<typeof produceFilm>>): void {
  const { total, ready, failed } = res.progress;
  console.log('');
  console.log(
    `🎬  ${res.name} — ${ready}/${total} scene(s) ready${failed ? `, ${failed} failed` : ''}`
  );
  for (const s of res.scenes) {
    const icon = s.status === 'ready' ? '✓' : s.status === 'failed' ? '✗' : '·';
    console.log(`   ${icon} ${s.id.padEnd(10)} ${s.status}${s.error ? ` — ${s.error}` : ''}`);
  }
  if (res.filmPath) console.log(`\n   film: ${res.filmPath}`);
  if (res.quality) {
    const q = res.quality;
    console.log(
      `   quality: ${q.pass ? 'PASS' : 'REVIEW'} — ${q.probedDuration}s` +
        `${q.hasAudio ? `, audio ${q.meanVolumeDb}dB` : ', no audio'}` +
        `${q.totalBlackSeconds ? `, ${q.totalBlackSeconds}s black` : ''}`
    );
  }
  for (const w of res.warnings) console.log(`   ⚠ ${w}`);
  if (!res.success) console.log(`\n   ✗ ${res.error ?? 'failed'}`);
}

function buildInput(name: string, plan: ScenePlanFile, opts: GenerateOpts): ProduceFilmInput {
  const output = {
    ...((opts.resolution ?? plan.output?.resolution)
      ? { resolution: opts.resolution ?? plan.output?.resolution }
      : {}),
    ...((opts.aspect ?? plan.output?.aspectRatio)
      ? { aspectRatio: opts.aspect ?? plan.output?.aspectRatio }
      : {}),
    ...((num(opts.fps) ?? plan.output?.fps) ? { fps: num(opts.fps) ?? plan.output?.fps } : {}),
  };
  const audio = {
    ...((opts.music ?? plan.audio?.music) ? { music: opts.music ?? plan.audio?.music } : {}),
    ...((num(opts.musicVolume) ?? plan.audio?.musicVolume)
      ? { musicVolume: num(opts.musicVolume) ?? plan.audio?.musicVolume }
      : {}),
    ...((opts.voiceover ?? plan.audio?.voiceover)
      ? { voiceover: opts.voiceover ?? plan.audio?.voiceover }
      : {}),
    ...(opts.ducking === false
      ? { ducking: false }
      : plan.audio?.ducking !== undefined
        ? { ducking: plan.audio.ducking }
        : {}),
  };
  const engineRaw = opts.engine ?? plan.engine;
  const engine = engineRaw === 'gl' ? 'gl' : engineRaw === 'xfade' ? 'xfade' : undefined;

  return {
    name,
    ...(plan.pitch !== undefined ? { pitch: plan.pitch } : {}),
    ...(plan.scenes ? { scenes: plan.scenes } : {}),
    ...(Object.keys(output).length ? { output } : {}),
    ...((opts.transition ?? plan.transition)
      ? { transition: opts.transition ?? plan.transition }
      : {}),
    ...((num(opts.transitionDuration) ?? plan.transitionDuration)
      ? { transitionDuration: num(opts.transitionDuration) ?? plan.transitionDuration }
      : {}),
    ...(engine ? { engine } : {}),
    ...(Object.keys(audio).length ? { audio } : {}),
    ...(num(opts.seed) !== undefined ? { seed: num(opts.seed) } : {}),
    ...(opts.continuity ? { continuity: true } : {}),
    ...(opts.assembleOnly ? { assembleOnly: true } : {}),
    ...(opts.regenerate ? { regenerateScene: opts.regenerate } : {}),
    ...(opts.overwrite ? { overwrite: true } : {}),
  };
}

export function createFilmCommand(): Command {
  const cmd = new Command('film');
  cmd.description(
    'Produce a long-form film from a scene plan: generate clips → montage with transitions + music → quality gate'
  );

  cmd
    .command('generate <name>')
    .description('Create/resume a film project, generate a clip per scene, then assemble it')
    .option(
      '--scenes <file>',
      'JSON scene plan (array of {prompt,seed?,duration?} or an object with a scenes array)'
    )
    .option(
      '--transition <name>',
      "transition at every boundary (fade, wipeleft, dissolve, 'cut'…)"
    )
    .option('--transition-duration <s>', 'default transition duration in seconds')
    .option('--engine <xfade|gl>', 'transition engine (xfade default; gl falls back to xfade)')
    .option('--resolution <preset|WxH>', "output resolution ('1080p','720p'… or '1920x1080')")
    .option('--aspect <ratio>', "aspect ratio for a preset ('16:9','9:16'…)")
    .option('--fps <n>', 'output frame rate')
    .option('--music <file>', 'background music file (looped, ducked)')
    .option('--music-volume <0..1>', 'music volume')
    .option('--voiceover <file>', 'full-length narration audio file')
    .option('--no-ducking', 'do not duck music under dialogue/voiceover')
    .option('--seed <n>', 'base seed for scenes that do not set their own (visual consistency)')
    .option('--continuity', "chain each scene's last frame as the next scene's reference image")
    .option('--assemble-only', 'skip generation; just assemble already-ready clips')
    .option(
      '--regenerate <sceneId>',
      'force one scene (e.g. scene-3) back to pending before running'
    )
    .option('--overwrite', 'recreate the project from --scenes even if one exists')
    .action(async (name: string, opts: GenerateOpts) => {
      let plan: ScenePlanFile = {};
      if (opts.scenes) {
        try {
          plan = await readScenePlan(opts.scenes);
        } catch (err) {
          logger.error(
            `Could not read scene plan: ${err instanceof Error ? err.message : String(err)}`
          );
          process.exitCode = 1;
          return;
        }
      }
      if (!plan.scenes && !opts.assembleOnly) {
        // No new scenes: only valid if resuming an existing project.
        const existing = await loadFilmProject(process.cwd(), name);
        if (!existing) {
          logger.error(
            'Provide --scenes <file> to create a project, or --assemble-only to (re)assemble an existing one.'
          );
          process.exitCode = 1;
          return;
        }
      }
      if (!opts.assembleOnly) {
        console.log(
          'ℹ  generate mode calls the configured video backend (video_generate) — this may incur API cost.'
        );
      }
      const res = await produceFilm(buildInput(name, plan, opts));
      printResult(res);
      if (!res.success) process.exitCode = 1;
    });

  cmd
    .command('assemble <name>')
    .description('(Re)assemble the already-generated clips into the film — no generation, no cost')
    .action(async (name: string) => {
      const res = await produceFilm({ name, assembleOnly: true });
      printResult(res);
      if (!res.success) process.exitCode = 1;
    });

  cmd
    .command('status <name>')
    .description('Show a film project: scene statuses, progress, and recent decisions')
    .action(async (name: string) => {
      const project = await loadFilmProject(process.cwd(), name);
      if (!project) {
        logger.error(
          `No film project '${name}' (looked in ${filmProjectPath(process.cwd(), name)}).`
        );
        process.exitCode = 1;
        return;
      }
      const { total, ready, failed, pending } = filmProgress(project);
      console.log(`\n🎬  ${project.name}${project.pitch ? ` — ${project.pitch}` : ''}`);
      console.log(
        `   ${ready}/${total} ready, ${failed} failed, ${pending} pending · engine ${project.engine}, transition '${project.transition}'`
      );
      for (const s of project.scenes) {
        const icon = s.status === 'ready' ? '✓' : s.status === 'failed' ? '✗' : '·';
        console.log(
          `   ${icon} ${s.id.padEnd(10)} ${s.status.padEnd(11)} ${s.prompt.slice(0, 60)}${s.error ? ` — ${s.error}` : ''}`
        );
      }
      if (project.filmPath) console.log(`\n   last film: ${project.filmPath}`);
      const recent = project.decisionLog.slice(-6);
      if (recent.length) {
        console.log('   recent:');
        for (const d of recent)
          console.log(`     ${d.at.slice(11, 19)} ${d.event}${d.detail ? ` — ${d.detail}` : ''}`);
      }
    });

  cmd
    .command('from-prompt <pitch>')
    .description(
      'Génère une vidéo de présentation narrée depuis un simple sujet (le LLM planifie les scènes → narration Piper → rendu premium + sous-titres karaoké). $0 via ChatGPT.'
    )
    .option('--scenes <n>', 'nombre de scènes visé', '6')
    .option('--resolution <WxH>', "résolution de sortie (défaut '1920x1080')")
    .option('--music <file>', 'musique de fond (défaut : une nappe générée)')
    .option('--no-music', 'pas de musique de fond')
    .option('--no-subtitles', 'pas de sous-titres karaoké')
    .option('--lang <lang>', 'langue de la narration', 'français')
    .option('--model <id>', 'modèle du planner (sinon le modèle courant)')
    .option('--name <name>', 'nom du film')
    .option('--out <file>', 'chemin de sortie explicite')
    .action(async (pitch: string, opts: Record<string, unknown>) => {
      const { produceVideoFromPrompt } = await import('../agent/film/video-studio.js');
      console.log(`🎬  Production vidéo depuis le prompt : « ${pitch} »`);
      const music = typeof opts.music === 'string' ? opts.music : undefined;
      const res = await produceVideoFromPrompt(
        pitch,
        {
          count: num(typeof opts.scenes === 'string' ? opts.scenes : undefined) ?? 6,
          resolution: typeof opts.resolution === 'string' ? opts.resolution : undefined,
          music,
          noMusic: opts.music === false,
          subtitles: opts.subtitles !== false,
          lang: typeof opts.lang === 'string' ? opts.lang : undefined,
          model: typeof opts.model === 'string' ? opts.model : undefined,
          name: typeof opts.name === 'string' ? opts.name : undefined,
          output: typeof opts.out === 'string' ? opts.out : undefined,
        },
        {
          onProgress: (p) => {
            const scene = p.scene ? `[${p.scene}/${p.total ?? '?'}] ` : '';
            console.log(`   ${scene}${p.phase}${p.message ? ` — ${p.message.slice(0, 60)}` : ''}`);
          },
        }
      );
      if (res.success) {
        console.log(
          `\n✓ ${res.sceneCount} scène(s) · ${res.probedDuration ?? '?'}s · qualité ${res.quality?.pass ? 'PASS' : 'REVIEW'}`
        );
        console.log(`   film: ${res.filmPath}`);
      } else {
        console.log(`\n✗ ${res.error ?? 'échec'}`);
        process.exitCode = 1;
      }
      for (const w of res.warnings) console.log(`   ⚠ ${w}`);
    });

  return cmd;
}
