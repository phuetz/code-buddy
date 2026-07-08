/**
 * scene-render — premium scene clip: pure argv builders + a real ffmpeg render.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdtemp, rm, stat, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  escapeSubtitlesPath,
  buildSceneVideoArgs,
  buildHeroCardArgs,
  buildFallbackStillArgs,
  renderScene,
} from '../../../src/tools/video/scene-render.js';

describe('pure builders', () => {
  it('escapes subtitles path special chars', () => {
    expect(escapeSubtitlesPath("/a/b:c'd.ass")).toBe("/a/b\\:c\\'d.ass");
  });

  it('buildSceneVideoArgs (with narration + captions)', () => {
    const args = buildSceneVideoArgs({
      ffmpegBin: 'ffmpeg',
      still: '/s.png',
      outPath: '/o.mp4',
      duration: 8,
      width: 1920,
      height: 1080,
      narrationWav: '/n.wav',
      assPath: '/c.ass',
      lead: 0.6,
    });
    const s = args.join(' ');
    expect(s).toContain('zoompan=');
    expect(s).toContain('vignette=PI/4.5');
    expect(s).toContain('subtitles=/c.ass');
    expect(s).toContain('adelay=600:all=1');
    expect(s).toContain('atrim=0:8');
    expect(args).toEqual(expect.arrayContaining(['-map', '[v]', '-map', '[a]']));
    expect(args[args.length - 1]).toBe('/o.mp4');
  });

  it('buildSceneVideoArgs (no narration → video only, no audio map)', () => {
    const args = buildSceneVideoArgs({
      ffmpegBin: 'ffmpeg',
      still: '/s.png',
      outPath: '/o.mp4',
      duration: 4,
      width: 1280,
      height: 720,
      lead: 0.6,
    });
    expect(args.join(' ')).not.toContain('adelay');
    expect(args.filter((a) => a === '[a]')).toHaveLength(0);
    expect(args).toEqual(expect.arrayContaining(['-map', '[v]']));
  });

  it('buildHeroCardArgs / buildFallbackStillArgs', () => {
    const hero = buildHeroCardArgs({
      width: 1920,
      height: 1080,
      c0: '#000',
      c1: '#111',
      title: 'Hi',
      subtitle: 'sub',
      outPath: '/h.png',
      big: true,
    });
    expect(hero).toEqual(
      expect.arrayContaining(['gradient:#000-#111', '-annotate', '+0-40', 'Hi'])
    );
    const fb = buildFallbackStillArgs({
      ffmpegBin: 'ffmpeg',
      width: 1920,
      height: 1080,
      c0: '#0f2027',
      c1: '#2c5364',
      titleFile: '/t.txt',
      outPath: '/f.png',
    });
    expect(fb.join(' ')).toContain('gradients=s=1920x1080:c0=0x0f2027');
    expect(fb.join(' ')).toContain('textfile=/t.txt');
  });
});

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

describe.runIf(hasFfmpeg)('renderScene — real', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'buddy-scene-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('renders an animated text card (no narration) at 1080p', async () => {
    const out = join(dir, 'card.mp4');
    const res = await renderScene(
      {
        id: 'card',
        title: 'Bonjour',
        subtitle: 'un sous-titre',
        duration: 3,
        visual: { kind: 'text' },
        c0: '#0f2027',
        c1: '#2c5364',
        outPath: out,
      },
      { workDir: dir }
    );
    expect(res.ok, res.error).toBe(true);
    const st = await stat(out);
    expect(st.size).toBeGreaterThan(1000);
    const dim = spawnSync('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'v',
      '-show_entries',
      'stream=width,height',
      '-of',
      'csv=p=0',
      out,
    ]);
    expect(dim.stdout.toString().trim()).toBe('1920,1080');
  }, 60_000);

  it('renders a framed image scene with narration + captions (has audio)', async () => {
    // a fake "screenshot" and a short narration wav, both via ffmpeg
    const img = join(dir, 'shot.png');
    spawnSync('ffmpeg', [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=navy:s=900x560',
      '-frames:v',
      '1',
      img,
    ]);
    const wav = join(dir, 'nar.wav');
    spawnSync('ffmpeg', [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=300:duration=3',
      wav,
    ]);
    const out = join(dir, 'scene.mp4');
    const res = await renderScene(
      {
        id: 'scene',
        title: 'Une démo',
        subtitle: 'écran réel',
        narrationText: 'Voici une belle démonstration de Code Buddy en action.',
        narrationWav: wav,
        duration: 4.5,
        visual: { kind: 'image', imagePath: img },
        outPath: out,
      },
      { workDir: dir }
    );
    expect(res.ok, res.error).toBe(true);
    const hasAudio = spawnSync('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'a',
      '-show_entries',
      'stream=codec_type',
      '-of',
      'csv=p=0',
      out,
    ])
      .stdout.toString()
      .trim();
    expect(hasAudio).toBe('audio');
  }, 60_000);
});
