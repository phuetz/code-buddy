/**
 * video-studio — prompt→video orchestration with every heavy dep injected
 * (no LLM, no ffmpeg): plan → narration → visual (diagram/text) → render →
 * assemble → quality. Plus the pure music-bed argv.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  produceVideoFromPrompt,
  buildMusicBedArgs,
  type VideoStudioDeps,
} from '../../src/agent/film/video-studio.js';
import type { PlannedScene } from '../../src/agent/film/scene-planner.js';
import type { AssembleFilmResult } from '../../src/tools/video/film-assemble.js';

function okAssemble(n: number): AssembleFilmResult {
  return {
    kind: 'film_assemble_result',
    success: true,
    outputPath: '/out/film.mp4',
    mediaPath: 'MEDIA:/out/film.mp4',
    engine: 'xfade',
    clipCount: n,
    transitionCount: Math.max(0, n - 1),
    targetWidth: 1920,
    targetHeight: 1080,
    fps: 30,
    estimatedDuration: 20,
    probedDuration: 20,
    hasAudio: true,
    transitions: [],
    warnings: [],
  };
}

const PLAN: PlannedScene[] = [
  { title: 'Intro', narration: 'Bonjour', visual: { kind: 'text' } },
  {
    title: 'Archi',
    narration: 'Voici',
    visual: { kind: 'diagram', mermaid: 'flowchart LR\nA-->B' },
  },
];

function deps(
  over: Partial<VideoStudioDeps> = {}
): VideoStudioDeps & { assembleInputs: unknown[]; rendered: unknown[] } {
  const assembleInputs: unknown[] = [];
  const rendered: unknown[] = [];
  return {
    plan: vi.fn(async () => PLAN),
    synthesize: vi.fn(async (_t: string, out: string) => ({ path: out, duration: 4 })),
    renderMermaid: vi.fn(async (_m: string, out: string) => out),
    renderSceneClip: vi.fn(async (input) => {
      rendered.push(input);
      return { ok: true, outPath: input.outPath };
    }),
    assemble: vi.fn(async (input) => {
      assembleInputs.push(input);
      return okAssemble(input.clips.length);
    }),
    assessQuality: vi.fn(async () => ({
      pass: true,
      probedDuration: 20,
      durationOk: true,
      hasAudio: true,
      meanVolumeDb: -20,
      maxVolumeDb: -2,
      silent: false,
      blackIntervals: [],
      totalBlackSeconds: 0,
      warnings: [],
    })),
    noMusic: undefined,
    assembleInputs,
    rendered,
    ...over,
  };
}

describe('produceVideoFromPrompt', () => {
  it('plans, renders each scene, assembles and passes quality', async () => {
    const d = deps({ noMusic: true });
    const res = await produceVideoFromPrompt('un sujet', { count: 2 }, d);
    expect(res.success).toBe(true);
    expect(res.filmPath).toBe('/out/film.mp4');
    expect(res.sceneCount).toBe(2);
    expect(d.plan).toHaveBeenCalledOnce();
    expect(d.renderSceneClip).toHaveBeenCalledTimes(2);
    // diagram scene got a real image visual
    const scene2 = d.rendered[1] as { visual: { kind: string; imagePath?: string } };
    expect(scene2.visual.kind).toBe('image');
    // narration sized the clip (4s voice + lead + trail)
    const scene1 = d.rendered[0] as { duration: number; narrationWav?: string };
    expect(scene1.duration).toBeCloseTo(5.6, 1);
    expect(scene1.narrationWav).toBeDefined();
  });

  it('falls back to a text card when the diagram cannot be rendered (no mmdc)', async () => {
    const d = deps({ noMusic: true, renderMermaid: vi.fn(async () => null) });
    const res = await produceVideoFromPrompt('x', { count: 2 }, d);
    expect(res.success).toBe(true);
    const scene2 = d.rendered[1] as { visual: { kind: string } };
    expect(scene2.visual.kind).toBe('text');
    expect(res.warnings.join(' ')).toMatch(/diagramme indisponible/i);
  });

  it('emits progress through the phases', async () => {
    const phases: string[] = [];
    const d = deps({ noMusic: true, onProgress: (p) => phases.push(p.phase) });
    await produceVideoFromPrompt('x', { count: 2 }, d);
    expect(phases).toEqual(
      expect.arrayContaining(['planning', 'narration', 'render', 'assemble', 'quality', 'done'])
    );
  });

  it('proceeds without narration when Piper is unavailable', async () => {
    const d = deps({ noMusic: true, synthesize: vi.fn(async () => null) });
    const res = await produceVideoFromPrompt('x', { count: 2 }, d);
    expect(res.success).toBe(true);
    const scene1 = d.rendered[0] as { narrationWav?: string; duration: number };
    expect(scene1.narrationWav).toBeUndefined();
    expect(scene1.duration).toBeCloseTo(5.1, 1); // 3.5 default + lead + trail
  });

  it('fails closed when no scene could be rendered', async () => {
    const d = deps({
      noMusic: true,
      renderSceneClip: vi.fn(async (i) => ({ ok: false, outPath: i.outPath, error: 'boom' })),
    });
    const res = await produceVideoFromPrompt('x', { count: 2 }, d);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/aucune scène/i);
  });

  it('surfaces a planner failure', async () => {
    const d = deps({
      plan: vi.fn(async () => {
        throw new Error('no LLM');
      }),
    });
    const res = await produceVideoFromPrompt('x', {}, d);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/no LLM/);
  });
});

describe('buildMusicBedArgs', () => {
  it('mixes 5 tones with fades and a bounded duration', () => {
    const args = buildMusicBedArgs('ffmpeg', 20, '/m.m4a');
    const s = args.join(' ');
    expect(s).toContain('amix=inputs=5');
    expect(s).toContain('aecho=');
    expect(s).toContain('afade=t=out:st=17');
    expect(args).toEqual(expect.arrayContaining(['-t', '20']));
    expect(args[args.length - 1]).toBe('/m.m4a');
  });
});
