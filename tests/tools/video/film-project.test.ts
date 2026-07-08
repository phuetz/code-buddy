/**
 * film-project — resumable manifest + post-render quality gate.
 *
 * Pure: slug, project creation/decision-log, progress reducers, blackdetect/
 * volumedetect parsers, and the pass/fail reducer. I/O: save/load roundtrip.
 * Real: assessFilmQuality over lavfi-generated clips (skipped without ffmpeg).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  filmSlug,
  createFilmProject,
  logDecision,
  nextPendingScene,
  readyClips,
  allScenesReady,
  filmProgress,
  loadFilmProject,
  saveFilmProject,
  filmProjectPath,
  parseBlackIntervals,
  parseVolumeStats,
  reduceQuality,
  assessFilmQuality,
  type FilmProject,
} from '../../../src/tools/video/film-project.js';

const fixedNow = () => new Date('2026-07-07T10:00:00.000Z');

function project(): FilmProject {
  return createFilmProject({
    name: 'My Film!',
    pitch: 'a tiny demo',
    scenes: [
      { prompt: 'sunrise over a city', seed: 42, duration: 5 },
      { prompt: 'a cat walks in' },
    ],
    output: { resolution: '1080p', aspectRatio: '16:9' },
    now: fixedNow,
  });
}

// ---------------------------------------------------------------------------
// Manifest — pure
// ---------------------------------------------------------------------------

describe('film project manifest (pure)', () => {
  it('slugifies names to filesystem-safe components', () => {
    expect(filmSlug('My Film! 2026')).toBe('My-Film-2026');
    expect(filmSlug('   ')).toBe('film');
    expect(filmSlug('a'.repeat(100)).length).toBe(60);
  });

  it('creates a project with numbered pending scenes + a decision log', () => {
    const p = project();
    expect(p.version).toBe(1);
    expect(p.scenes.map((s) => s.id)).toEqual(['scene-1', 'scene-2']);
    expect(p.scenes[0]).toMatchObject({
      prompt: 'sunrise over a city',
      seed: 42,
      duration: 5,
      status: 'pending',
    });
    expect(p.scenes[1].seed).toBeUndefined();
    expect(p.transition).toBe('fade');
    expect(p.engine).toBe('xfade');
    expect(p.decisionLog[0]).toMatchObject({ event: 'created', detail: '2 scene(s)' });
  });

  it('appends decisions', () => {
    const p = project();
    logDecision(p, 'scene-ready', 'scene-1', fixedNow);
    expect(p.decisionLog.at(-1)).toEqual({
      at: '2026-07-07T10:00:00.000Z',
      event: 'scene-ready',
      detail: 'scene-1',
    });
  });

  it('tracks progress + the next scene to work on', () => {
    const p = project();
    expect(filmProgress(p)).toEqual({ total: 2, ready: 0, failed: 0, pending: 2 });
    expect(nextPendingScene(p)?.id).toBe('scene-1');

    p.scenes[0]!.status = 'ready';
    p.scenes[0]!.clipPath = '/clip1.mp4';
    expect(nextPendingScene(p)?.id).toBe('scene-2');
    expect(readyClips(p)).toEqual(['/clip1.mp4']);
    expect(allScenesReady(p)).toBe(false);

    p.scenes[1]!.status = 'ready';
    p.scenes[1]!.clipPath = '/clip2.mp4';
    expect(allScenesReady(p)).toBe(true);
    expect(filmProgress(p)).toEqual({ total: 2, ready: 2, failed: 0, pending: 0 });
  });

  it('re-picks a failed scene for a retry', () => {
    const p = project();
    p.scenes[0]!.status = 'ready';
    p.scenes[0]!.clipPath = '/c1.mp4';
    p.scenes[1]!.status = 'failed';
    expect(nextPendingScene(p)?.id).toBe('scene-2');
  });
});

// ---------------------------------------------------------------------------
// Manifest — persistence
// ---------------------------------------------------------------------------

describe('film project persistence', () => {
  let root: string;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'buddy-filmproj-'));
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('round-trips through save/load under the films dir', async () => {
    const p = project();
    await saveFilmProject(root, p, fixedNow);
    expect(filmProjectPath(root, 'My Film!')).toMatch(/films\/My-Film\/film\.json$/);

    const loaded = await loadFilmProject(root, 'My Film!');
    expect(loaded).not.toBeNull();
    expect(loaded!.name).toBe('My Film!');
    expect(loaded!.scenes).toHaveLength(2);
  });

  it('returns null for an unknown project', async () => {
    expect(await loadFilmProject(root, 'nope')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Quality gate — pure
// ---------------------------------------------------------------------------

describe('quality parsers', () => {
  it('parses blackdetect intervals', () => {
    const stderr =
      '[blackdetect @ 0x55] black_start:1.5 black_end:2.0 black_duration:0.5\n' +
      '[blackdetect @ 0x55] black_start:4.0 black_end:4.3 black_duration:0.3\n';
    expect(parseBlackIntervals(stderr)).toEqual([
      { start: 1.5, end: 2.0, duration: 0.5 },
      { start: 4.0, end: 4.3, duration: 0.3 },
    ]);
  });

  it('parses volumedetect mean/max dB', () => {
    const stderr =
      '[Parsed_volumedetect_0 @ 0x55] mean_volume: -23.5 dB\n' +
      '[Parsed_volumedetect_0 @ 0x55] max_volume: -3.0 dB\n';
    expect(parseVolumeStats(stderr)).toEqual({ meanDb: -23.5, maxDb: -3.0 });
  });

  it('tolerates missing volume stats', () => {
    expect(parseVolumeStats('nothing here')).toEqual({ meanDb: null, maxDb: null });
  });
});

describe('reduceQuality', () => {
  it('passes a healthy film', () => {
    const r = reduceQuality({
      probedDuration: 10,
      expectedDuration: 10,
      hasAudio: true,
      meanDb: -20,
      maxDb: -2,
      blackIntervals: [],
    });
    expect(r.pass).toBe(true);
    expect(r.warnings).toEqual([]);
  });

  it('fails on a drifted duration', () => {
    const r = reduceQuality({
      probedDuration: 6,
      expectedDuration: 10,
      hasAudio: true,
      meanDb: -20,
      maxDb: -2,
      blackIntervals: [],
    });
    expect(r.pass).toBe(false);
    expect(r.durationOk).toBe(false);
  });

  it('fails a silent film with an audio track', () => {
    const r = reduceQuality({
      probedDuration: 10,
      expectedDuration: 10,
      hasAudio: true,
      meanDb: -75,
      maxDb: -70,
      blackIntervals: [],
    });
    expect(r.silent).toBe(true);
    expect(r.pass).toBe(false);
  });

  it('fails a mostly-black film', () => {
    const r = reduceQuality({
      probedDuration: 10,
      expectedDuration: 10,
      hasAudio: true,
      meanDb: -20,
      maxDb: -2,
      blackIntervals: [{ start: 0, end: 3, duration: 3 }],
    });
    expect(r.pass).toBe(false);
    expect(r.totalBlackSeconds).toBe(3);
  });

  it('does not flag silence when there is no audio track', () => {
    const r = reduceQuality({
      probedDuration: 10,
      expectedDuration: 10,
      hasAudio: false,
      meanDb: null,
      maxDb: null,
      blackIntervals: [],
    });
    expect(r.silent).toBe(false);
    expect(r.pass).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Quality gate — real ffmpeg
// ---------------------------------------------------------------------------

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

describe.runIf(hasFfmpeg)('assessFilmQuality — real', () => {
  let root: string;
  const mk = (name: string, videoIn: string, audioIn: string): string => {
    const out = join(root, name);
    const r = spawnSync('ffmpeg', [
      '-y',
      '-hide_banner',
      '-f',
      'lavfi',
      '-i',
      videoIn,
      '-f',
      'lavfi',
      '-i',
      audioIn,
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-shortest',
      out,
    ]);
    expect(r.status).toBe(0);
    return out;
  };

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'buddy-quality-real-'));
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('passes a healthy color+tone clip', async () => {
    const good = mk(
      'good.mp4',
      'color=c=red:size=320x240:rate=30:duration=3',
      'sine=frequency=440:duration=3'
    );
    const r = await assessFilmQuality(good, { expectedDuration: 3 });
    expect(r.hasAudio).toBe(true);
    expect(r.silent).toBe(false);
    expect(r.totalBlackSeconds).toBe(0);
    expect(r.pass).toBe(true);
  }, 60_000);

  it('flags a black + silent clip', async () => {
    const bad = mk(
      'bad.mp4',
      'color=c=black:size=320x240:rate=30:duration=3',
      'anullsrc=r=48000:cl=stereo:d=3'
    );
    const r = await assessFilmQuality(bad, { expectedDuration: 3 });
    expect(r.totalBlackSeconds).toBeGreaterThan(1);
    expect(r.silent).toBe(true);
    expect(r.pass).toBe(false);
  }, 60_000);
});
