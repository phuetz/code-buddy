/**
 * film-producer — end-to-end orchestration with every heavy dep injected.
 *
 * Proves: fresh generate → assemble → quality; resume skips ready scenes; a
 * failed scene degrades to a partial film; assembleOnly skips generation;
 * regenerateScene retries one scene; continuity chains last-frame → next ref;
 * and no-clips fails closed. Manifest is persisted throughout.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { produceFilm, type ProduceFilmDeps } from '../../src/agent/film/film-producer.js';
import { loadFilmProject } from '../../src/tools/video/film-project.js';
import type { AssembleFilmResult } from '../../src/tools/video/film-assemble.js';
import type { FilmQualityReport } from '../../src/tools/video/film-project.js';

const fixedNow = () => new Date('2026-07-07T10:00:00.000Z');

function okAssemble(clipCount: number, estimated = 13): AssembleFilmResult {
  return {
    kind: 'film_assemble_result',
    success: true,
    outputPath: '/out/film.mp4',
    mediaPath: 'MEDIA:/out/film.mp4',
    engine: 'xfade',
    clipCount,
    transitionCount: Math.max(0, clipCount - 1),
    targetWidth: 1920,
    targetHeight: 1080,
    fps: 30,
    estimatedDuration: estimated,
    probedDuration: estimated,
    hasAudio: true,
    transitions: [],
    warnings: [],
  };
}

const okQuality: FilmQualityReport = {
  pass: true,
  probedDuration: 13,
  expectedDuration: 13,
  durationOk: true,
  hasAudio: true,
  meanVolumeDb: -20,
  maxVolumeDb: -2,
  silent: false,
  blackIntervals: [],
  totalBlackSeconds: 0,
  warnings: [],
};

/** Deps that generate a deterministic clip path per scene + capture assemble input. */
function makeDeps(
  over: Partial<ProduceFilmDeps> = {}
): ProduceFilmDeps & { assembleInputs: unknown[] } {
  const assembleInputs: unknown[] = [];
  return {
    now: fixedNow,
    generateClip: vi.fn(async (scene) => ({
      clipPath: `/clips/${scene.id}.mp4`,
      provider: 'fake',
    })),
    assemble: vi.fn(async (input) => {
      assembleInputs.push(input);
      return okAssemble(input.clips.length);
    }),
    assessQuality: vi.fn(async () => okQuality),
    extractLastFrame: vi.fn(async (_clip, out) => out),
    assembleInputs,
    ...over,
  };
}

describe('produceFilm', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'buddy-producer-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('generates every scene, assembles, runs the quality gate, and persists the manifest', async () => {
    const deps = makeDeps();
    const res = await produceFilm(
      {
        name: 'demo',
        scenes: [{ prompt: 'a' }, { prompt: 'b' }, { prompt: 'c' }],
        rootDir: root,
        transition: 'fade',
      },
      deps
    );

    expect(res.success).toBe(true);
    expect(res.filmPath).toBe('/out/film.mp4');
    expect(res.progress).toEqual({ total: 3, ready: 3, failed: 0, pending: 0 });
    expect(res.quality?.pass).toBe(true);
    expect(deps.generateClip).toHaveBeenCalledTimes(3);

    const saved = await loadFilmProject(root, 'demo');
    expect(saved!.scenes.every((s) => s.status === 'ready')).toBe(true);
    expect(saved!.filmPath).toBe('/out/film.mp4');
    expect(saved!.decisionLog.some((d) => d.event === 'quality-pass')).toBe(true);
  });

  it('resumes an existing project and only generates the not-ready scenes', async () => {
    // First run generates scene-1 then "crashes" (scene-2 generator throws once).
    const deps1 = makeDeps({
      generateClip: vi.fn(async (scene) => {
        if (scene.id === 'scene-2') return { error: 'boom' };
        return { clipPath: `/clips/${scene.id}.mp4` };
      }),
    });
    const first = await produceFilm(
      { name: 'resume', scenes: [{ prompt: 'a' }, { prompt: 'b' }], rootDir: root },
      deps1
    );
    expect(first.success).toBe(true); // partial film from scene-1
    expect(first.progress).toEqual({ total: 2, ready: 1, failed: 1, pending: 0 });

    // Second run resumes: scene-1 is skipped, only scene-2 is retried (now succeeds).
    const gen2 = vi.fn(async (scene: { id: string }) => ({ clipPath: `/clips/${scene.id}.mp4` }));
    const deps2 = makeDeps({ generateClip: gen2 as ProduceFilmDeps['generateClip'] });
    const second = await produceFilm({ name: 'resume', rootDir: root }, deps2);

    expect(second.progress).toEqual({ total: 2, ready: 2, failed: 0, pending: 0 });
    expect(gen2).toHaveBeenCalledTimes(1);
    expect((gen2.mock.calls[0]![0] as { id: string }).id).toBe('scene-2');
  });

  it('assembles a partial film (in order) when a scene fails, with a warning', async () => {
    const deps = makeDeps({
      generateClip: vi.fn(async (scene) =>
        scene.id === 'scene-2' ? { error: 'provider 500' } : { clipPath: `/clips/${scene.id}.mp4` }
      ),
    });
    const res = await produceFilm(
      {
        name: 'partial',
        scenes: [{ prompt: 'a' }, { prompt: 'b' }, { prompt: 'c' }],
        rootDir: root,
      },
      deps
    );
    expect(res.success).toBe(true);
    const assembled = deps.assembleInputs[0] as { clips: string[] };
    expect(assembled.clips).toEqual(['/clips/scene-1.mp4', '/clips/scene-3.mp4']);
    expect(res.warnings.join(' ')).toMatch(/Assembling 2\/3/);
  });

  it('assembleOnly skips generation and welds the ready clips', async () => {
    // Seed a project with all scenes ready via a first full run.
    await produceFilm(
      { name: 'reuse', scenes: [{ prompt: 'a' }, { prompt: 'b' }], rootDir: root },
      makeDeps()
    );

    const gen = vi.fn(async () => ({ clipPath: '/never.mp4' }));
    const res = await produceFilm(
      { name: 'reuse', assembleOnly: true, rootDir: root },
      makeDeps({ generateClip: gen as ProduceFilmDeps['generateClip'] })
    );
    expect(res.success).toBe(true);
    expect(gen).not.toHaveBeenCalled();
  });

  it('regenerateScene forces exactly one scene to be produced again', async () => {
    await produceFilm(
      { name: 'regen', scenes: [{ prompt: 'a' }, { prompt: 'b' }], rootDir: root },
      makeDeps()
    );

    const gen = vi.fn(async (scene: { id: string }) => ({ clipPath: `/clips/${scene.id}-v2.mp4` }));
    const res = await produceFilm(
      { name: 'regen', regenerateScene: 'scene-2', rootDir: root },
      makeDeps({ generateClip: gen as ProduceFilmDeps['generateClip'] })
    );
    expect(res.success).toBe(true);
    expect(gen).toHaveBeenCalledTimes(1);
    expect((gen.mock.calls[0]![0] as { id: string }).id).toBe('scene-2');
  });

  it('chains the previous clip last-frame as the next scene reference under --continuity', async () => {
    const extract = vi.fn(async (_clip: string, out: string) => out);
    const gen = vi.fn(async (scene: { id: string; referenceImage?: string }) => ({
      clipPath: `/clips/${scene.id}.mp4`,
    }));
    const deps = makeDeps({
      extractLastFrame: extract as ProduceFilmDeps['extractLastFrame'],
      generateClip: gen as ProduceFilmDeps['generateClip'],
    });
    await produceFilm(
      { name: 'cont', scenes: [{ prompt: 'a' }, { prompt: 'b' }], rootDir: root, continuity: true },
      deps
    );
    // scene-2 got a reference image derived from scene-1's clip.
    expect(extract).toHaveBeenCalledTimes(1);
    const scene2 = gen.mock.calls[1]![0] as { id: string; referenceImage?: string };
    expect(scene2.id).toBe('scene-2');
    expect(scene2.referenceImage).toMatch(/ref-scene-2\.jpg$/);
  });

  it('fails closed when no scene produced a clip', async () => {
    const deps = makeDeps({ generateClip: vi.fn(async () => ({ error: 'no provider' })) });
    const res = await produceFilm(
      { name: 'empty', scenes: [{ prompt: 'a' }], rootDir: root },
      deps
    );
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/nothing to assemble/i);
    expect(deps.assemble).not.toHaveBeenCalled();
  });

  it('fails closed when there is neither a scene plan nor an existing project', async () => {
    const res = await produceFilm({ name: 'ghost', rootDir: root }, makeDeps());
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/no scene plan/i);
  });

  it('surfaces an assembly failure', async () => {
    const deps = makeDeps({
      assemble: vi.fn(async () => ({
        ...okAssemble(2),
        success: false,
        error: 'ffmpeg died',
        outputPath: undefined,
      })),
    });
    const res = await produceFilm(
      { name: 'boom', scenes: [{ prompt: 'a' }, { prompt: 'b' }], rootDir: root },
      deps
    );
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/ffmpeg died/);
  });

  it('sizes a scene to its Piper narration and bakes the voiceover into the clip', async () => {
    const narrate = vi.fn(async (_text: string, out: string) => ({ path: out, duration: 6 }));
    const mux = vi.fn(async () => true);
    const gen = vi.fn(async (scene: { id: string; duration?: number }) => ({
      clipPath: `/clips/${scene.id}.mp4`,
    }));
    const deps = makeDeps({
      narrate,
      muxNarration: mux as ProduceFilmDeps['muxNarration'],
      generateClip: gen as ProduceFilmDeps['generateClip'],
    });
    const res = await produceFilm(
      { name: 'narr', scenes: [{ prompt: 'a', narration: 'Bonjour', duration: 3 }], rootDir: root },
      deps
    );
    expect(res.success).toBe(true);
    expect(narrate).toHaveBeenCalledTimes(1);
    // duration bumped to narration(6) + lead(0.5) + trail(0.9) = 7.4, over the base 3.
    const genScene = gen.mock.calls[0]![0] as { duration?: number };
    expect(genScene.duration).toBeCloseTo(7.4, 1);
    expect(mux).toHaveBeenCalledTimes(1);
    // the ready clip is the muxed (narrated) one under film-work/.
    const saved = await loadFilmProject(root, 'narr');
    expect(saved!.scenes[0]!.clipPath).toMatch(/film-work\/.*\/clip-scene-1\.mp4$/);
  });

  it('proceeds without narration when Piper is unavailable (fail-open)', async () => {
    const narrate = vi.fn(async () => null);
    const mux = vi.fn(async () => true);
    const res = await produceFilm(
      { name: 'nofpiper', scenes: [{ prompt: 'a', narration: 'x' }], rootDir: root },
      makeDeps({ narrate, muxNarration: mux as ProduceFilmDeps['muxNarration'] })
    );
    expect(res.success).toBe(true);
    expect(mux).not.toHaveBeenCalled();
    expect(res.warnings.join(' ')).toMatch(/narration skipped/i);
  });
});
