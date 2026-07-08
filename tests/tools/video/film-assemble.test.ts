/**
 * film-assemble — the montage brick.
 *
 * Two layers, both deterministic:
 *  1. PURE builders — the cumulative xfade offset math, transition
 *     normalization/clamping, output-profile resolution, and the exact ffmpeg
 *     filter-graph / argv construction. No ffmpeg needed.
 *  2. `assembleFilm` orchestration with an INJECTED spawn + probe so the
 *     success path, the gl→xfade fallback, and the fail-open guards are
 *     provable without touching the real binary.
 *
 * A final describe runs the REAL ffmpeg (lavfi testsrc clips → assembleFilm →
 * ffprobe the render) and is skipped when ffmpeg is absent.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { EventEmitter } from 'events';
import { spawn, spawnSync } from 'child_process';
import { mkdtemp, rm, stat, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  computeXfadeOffsets,
  normalizeTransitions,
  resolveOutputProfile,
  buildVideoNormalizeSegment,
  buildAudioNormalizeSegment,
  buildVideoGraph,
  buildClipAudioGraph,
  buildAudioMixGraph,
  buildFilmArgs,
  assembleFilm,
  type ClipProbe,
  type TransitionSpec,
} from '../../../src/tools/video/film-assemble.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function clip(path: string, duration: number, over: Partial<ClipProbe> = {}): ClipProbe {
  return {
    path,
    duration,
    width: 1920,
    height: 1080,
    fps: 30,
    hasAudio: true,
    sar: '1:1',
    pixFmt: 'yuv420p',
    ...over,
  };
}

const DEFAULT_PROBE_JSON = {
  format: { duration: '14' },
  streams: [
    {
      codec_type: 'video',
      width: 1920,
      height: 1080,
      r_frame_rate: '30/1',
      pix_fmt: 'yuv420p',
      sample_aspect_ratio: '1:1',
    },
    { codec_type: 'audio' },
  ],
};

/** A fake `spawn` that answers ffmpeg/-version/-filters/render + ffprobe deterministically. */
function makeFakeSpawn(
  opts: {
    glAvailable?: boolean;
    versionCode?: number;
    renderCode?: number;
    seen?: string[][];
  } = {}
): typeof spawn {
  return ((cmd: string, args: string[]) => {
    opts.seen?.push([cmd, ...args]);
    const child = new EventEmitter() as unknown as ReturnType<typeof spawn> & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: () => void;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => undefined;

    const isFfprobe = cmd.includes('ffprobe');
    const isVersion = args.includes('-version');
    const isFilters = args.includes('-filters');
    const isRender = args.includes('-filter_complex');

    // Defer events (pre-spawn logic runs first) — the BashTool gotcha applies here too.
    setImmediate(() => {
      if (isFfprobe) {
        child.stdout.emit('data', Buffer.from(JSON.stringify(DEFAULT_PROBE_JSON)));
        child.emit('close', 0);
      } else if (isVersion) {
        child.emit('close', opts.versionCode ?? 0);
      } else if (isFilters) {
        if (opts.glAvailable) {
          child.stdout.emit(
            'data',
            Buffer.from(' T.. gltransition       V->V       OpenGL transition\n')
          );
        }
        child.emit('close', 0);
      } else if (isRender) {
        child.stderr.emit('data', Buffer.from('frame=  100 fps= 30'));
        child.emit('close', opts.renderCode ?? 0);
      } else {
        child.emit('close', 0);
      }
    });
    return child;
  }) as unknown as typeof spawn;
}

// ---------------------------------------------------------------------------
// 1. Pure: the crossfade offset math
// ---------------------------------------------------------------------------

describe('computeXfadeOffsets', () => {
  it('is Σd − ΣT per boundary (equal clips)', () => {
    expect(computeXfadeOffsets([5, 5, 5], [1, 1])).toEqual([4, 8]);
  });

  it('handles unequal clips and per-boundary transitions', () => {
    // offset0 = 4 − 1 = 3 ; offset1 = (4+6) − (1+2) = 7
    expect(computeXfadeOffsets([4, 6, 5], [1, 2])).toEqual([3, 7]);
  });

  it('returns no offset for a single clip', () => {
    expect(computeXfadeOffsets([5], [])).toEqual([]);
  });

  it('rounds to 2 decimals', () => {
    expect(computeXfadeOffsets([2.333, 2.333], [0.5])).toEqual([1.83]);
  });
});

// ---------------------------------------------------------------------------
// 2. Pure: transition normalization + clamping
// ---------------------------------------------------------------------------

describe('normalizeTransitions', () => {
  it('broadcasts a single transition name to every boundary', () => {
    const { specs } = normalizeTransitions('wipeleft', 2, 1, [5, 5, 5]);
    expect(specs).toEqual([
      { type: 'wipeleft', duration: 1 },
      { type: 'wipeleft', duration: 1 },
    ]);
  });

  it('accepts one spec per boundary', () => {
    const { specs } = normalizeTransitions(
      [
        { type: 'slideup', duration: 0.5 },
        { type: 'circleopen', duration: 2 },
      ],
      2,
      1,
      [5, 5, 5]
    );
    expect(specs).toEqual([
      { type: 'slideup', duration: 0.5 },
      { type: 'circleopen', duration: 2 },
    ]);
  });

  it('clamps a transition that is longer than the shortest adjacent clip and warns', () => {
    const { specs, warnings } = normalizeTransitions('fade', 2, 1, [5, 0.3, 5]);
    expect(specs[0]).toEqual({ type: 'fade', duration: 0.25 });
    expect(specs[1]).toEqual({ type: 'fade', duration: 0.25 });
    expect(warnings.length).toBe(2);
  });

  it('turns a too-short clip boundary into a hard cut', () => {
    const { specs } = normalizeTransitions('fade', 1, 1, [5, 0.02]);
    expect(specs[0]).toEqual({ type: 'cut', duration: 0 });
  });

  it("passes 'cut' through as a zero-duration hard cut", () => {
    const { specs } = normalizeTransitions('cut', 1, 1, [5, 5]);
    expect(specs[0]).toEqual({ type: 'cut', duration: 0 });
  });

  it('returns nothing for zero boundaries (single clip)', () => {
    expect(normalizeTransitions('fade', 0, 1, [5]).specs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. Pure: output profile resolution
// ---------------------------------------------------------------------------

describe('resolveOutputProfile', () => {
  it('resolves a landscape preset from the short side', () => {
    expect(resolveOutputProfile({ resolution: '1080p', aspectRatio: '16:9' }, [])).toEqual({
      width: 1920,
      height: 1080,
      fps: 30,
    });
  });

  it('resolves a portrait preset (short side is the width)', () => {
    expect(resolveOutputProfile({ resolution: '720p', aspectRatio: '9:16' }, [])).toEqual({
      width: 720,
      height: 1280,
      fps: 30,
    });
  });

  it('parses an explicit WxH', () => {
    expect(resolveOutputProfile({ resolution: '1280x720' }, [])).toEqual({
      width: 1280,
      height: 720,
      fps: 30,
    });
  });

  it('inherits dims + fps from the first clip when no resolution is asked for', () => {
    const probes = [clip('/a.mp4', 5, { width: 640, height: 480, fps: 24 })];
    expect(resolveOutputProfile({}, probes)).toEqual({ width: 640, height: 480, fps: 24 });
  });

  it('forces even dimensions (h264 requirement)', () => {
    const p = resolveOutputProfile({ resolution: '1080p', aspectRatio: '3:2' }, []);
    expect(p.width % 2).toBe(0);
    expect(p.height % 2).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 4. Pure: normalization segments
// ---------------------------------------------------------------------------

describe('normalize segments', () => {
  it('builds the per-input video normalize chain to a [v{i}] label', () => {
    const seg = buildVideoNormalizeSegment(2, { width: 1920, height: 1080, fps: 30 });
    expect(seg).toBe(
      '[2:v]scale=1920:1080:force_original_aspect_ratio=decrease,' +
        'pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30,' +
        'format=yuv420p,setpts=PTS-STARTPTS[v2]'
    );
  });

  it('builds the per-input audio normalize chain to an [a{i}] label', () => {
    expect(buildAudioNormalizeSegment(1, '1:a')).toBe(
      '[1:a]aformat=sample_rates=48000:channel_layouts=stereo,asetpts=PTS-STARTPTS[a1]'
    );
  });
});

// ---------------------------------------------------------------------------
// 5. Pure: video graph (xfade / concat / gl)
// ---------------------------------------------------------------------------

describe('buildVideoGraph', () => {
  const fade = (d: number): TransitionSpec => ({ type: 'fade', duration: d });

  it('chains xfade with cumulative offsets and a final [vout]', () => {
    const { segments, finalLabel } = buildVideoGraph(3, [fade(1), fade(1)], [4, 8], null);
    expect(segments).toEqual([
      '[v0][v1]xfade=transition=fade:duration=1:offset=4[vx0]',
      '[vx0][v2]xfade=transition=fade:duration=1:offset=8[vout]',
    ]);
    expect(finalLabel).toBe('vout');
  });

  it('single clip needs no chaining', () => {
    expect(buildVideoGraph(1, [], [], null)).toEqual({ segments: [], finalLabel: 'v0' });
  });

  it('all-cut boundaries collapse to a single concat', () => {
    const { segments } = buildVideoGraph(
      3,
      [
        { type: 'cut', duration: 0 },
        { type: 'cut', duration: 0 },
      ],
      [4, 8],
      null
    );
    expect(segments).toEqual(['[v0][v1][v2]concat=n=3:v=1:a=0[vout]']);
  });

  it('uses the gl filter name when the gl engine resolved a filter', () => {
    const { segments } = buildVideoGraph(2, [fade(1)], [4], 'gltransition');
    expect(segments).toEqual(['[v0][v1]gltransition=duration=1:offset=4[vout]']);
  });
});

// ---------------------------------------------------------------------------
// 6. Pure: clip audio graph
// ---------------------------------------------------------------------------

describe('buildClipAudioGraph', () => {
  it('mirrors the xfade with an acrossfade chain', () => {
    const { segments, finalLabel } = buildClipAudioGraph(3, [
      { type: 'fade', duration: 1 },
      { type: 'fade', duration: 1 },
    ]);
    expect(segments).toEqual(['[a0][a1]acrossfade=d=1[ax0]', '[ax0][a2]acrossfade=d=1[filmA]']);
    expect(finalLabel).toBe('filmA');
  });

  it('concats audio for the all-cut case', () => {
    const { segments } = buildClipAudioGraph(2, [{ type: 'cut', duration: 0 }]);
    expect(segments).toEqual(['[a0][a1]concat=n=2:v=0:a=1[filmA]']);
  });
});

// ---------------------------------------------------------------------------
// 7. Pure: audio mix (music ducking + voiceover)
// ---------------------------------------------------------------------------

describe('buildAudioMixGraph', () => {
  it('passes the clip audio straight through when there is no music/voice', () => {
    expect(
      buildAudioMixGraph('filmA', { musicVolume: 0.25, ducking: true, totalDuration: 10 })
    ).toEqual({
      segments: [],
      finalLabel: 'filmA',
    });
  });

  it('ducks the music under the program (asplit → sidechaincompress → amix)', () => {
    const { segments, finalLabel } = buildAudioMixGraph('filmA', {
      musicRef: '4:a',
      musicVolume: 0.3,
      ducking: true,
      totalDuration: 12.5,
    });
    expect(finalLabel).toBe('aout');
    expect(segments[0]).toBe(
      '[4:a]atrim=0:12.5,aformat=sample_rates=48000:channel_layouts=stereo,volume=0.3[music0]'
    );
    expect(segments).toContain('[filmA]asplit=2[prog_a][prog_b]');
    expect(segments).toContain(
      '[music0][prog_b]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=400[music_d]'
    );
    expect(segments).toContain('[prog_a][music_d]amix=inputs=2:duration=first:normalize=0[aout]');
  });

  it('folds a voiceover into the program before mixing music', () => {
    const { segments } = buildAudioMixGraph('filmA', {
      voiceRef: '5:a',
      musicRef: '4:a',
      musicVolume: 0.25,
      ducking: false,
      totalDuration: 8,
    });
    expect(segments[0]).toContain('[5:a]aformat=');
    expect(segments).toContain('[filmA][vo]amix=inputs=2:duration=first:normalize=0[prog]');
    expect(segments).toContain('[prog][music0]amix=inputs=2:duration=first:normalize=0[aout]');
  });
});

// ---------------------------------------------------------------------------
// 8. Pure: full argv assembly
// ---------------------------------------------------------------------------

describe('buildFilmArgs', () => {
  it('synthesizes a silent input for a clip without audio and wires its label', () => {
    const probes = [clip('/a.mp4', 5), clip('/b.mp4', 5, { hasAudio: false }), clip('/c.mp4', 5)];
    const specs: TransitionSpec[] = [
      { type: 'fade', duration: 1 },
      { type: 'fade', duration: 1 },
    ];
    const plan = buildFilmArgs(probes, { width: 1920, height: 1080, fps: 30 }, specs, {
      ffmpegBin: 'ffmpeg',
      outputPath: '/out/film.mp4',
      engine: 'xfade',
      glFilter: null,
      musicVolume: 0.25,
      ducking: true,
    });
    // anullsrc lavfi input appended for the middle (audio-less) clip.
    expect(plan.args).toContain('anullsrc=channel_layout=stereo:sample_rate=48000');
    // Its audio is normalized from input index 3 (after the 3 clip files).
    expect(plan.filterComplex).toContain('[3:a]aformat=');
    // Cumulative offsets show up in the graph.
    expect(plan.filterComplex).toContain('offset=4');
    expect(plan.filterComplex).toContain('offset=8');
    expect(plan.args).toEqual(expect.arrayContaining(['-map', '[vout]']));
    expect(plan.args[plan.args.length - 1]).toBe('/out/film.mp4');
  });

  it('loops a background music input and maps the ducked mix', () => {
    const probes = [clip('/a.mp4', 4), clip('/b.mp4', 4)];
    const plan = buildFilmArgs(
      probes,
      { width: 1280, height: 720, fps: 30 },
      [{ type: 'fade', duration: 1 }],
      {
        ffmpegBin: 'ffmpeg',
        outputPath: '/out/film.mp4',
        engine: 'xfade',
        glFilter: null,
        music: '/music.mp3',
        musicVolume: 0.2,
        ducking: true,
      }
    );
    expect(plan.args).toEqual(expect.arrayContaining(['-stream_loop', '-1', '-i', '/music.mp3']));
    expect(plan.filterComplex).toContain('sidechaincompress');
    expect(plan.audioLabel).toBe('aout');
  });
});

// ---------------------------------------------------------------------------
// 9. Orchestration with injected spawn/probe
// ---------------------------------------------------------------------------

describe('assembleFilm — orchestration (injected)', () => {
  let root: string;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'buddy-film-'));
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('assembles a 3-clip film and reports the estimated duration Σd − ΣT', async () => {
    const res = await assembleFilm(
      {
        clips: ['/a.mp4', '/b.mp4', '/c.mp4'],
        transitions: 'fade',
        transitionDuration: 1,
        rootDir: root,
        name: 'My Demo',
      },
      {
        spawn: makeFakeSpawn(),
        probeClips: async (paths) => paths.map((p) => clip(p, 5)),
      }
    );
    expect(res.success).toBe(true);
    expect(res.clipCount).toBe(3);
    expect(res.transitionCount).toBe(2);
    expect(res.estimatedDuration).toBe(13); // 15 − 2×1
    expect(res.probedDuration).toBe(14); // from the fake output ffprobe
    expect(res.targetWidth).toBe(1920);
    expect(res.hasAudio).toBe(true);
    expect(res.outputPath).toMatch(/\.codebuddy\/media-generation\/films\/.*\.mp4$/);
    expect(res.mediaPath).toBe(`MEDIA:${res.outputPath}`);

    // Media-library sidecar: prompt/provider/model so the film shows a real card.
    const sidecar = JSON.parse(await readFile(`${res.outputPath}.meta.json`, 'utf8'));
    expect(sidecar.provider).toBe('film');
    expect(sidecar.model).toBe('xfade');
    expect(sidecar.prompt).toContain('My Demo');
    expect(sidecar.kind).toBe('film');
  });

  it('falls back to xfade with a warning when the gl engine has no filter', async () => {
    const res = await assembleFilm(
      { clips: ['/a.mp4', '/b.mp4'], engine: 'gl', rootDir: root },
      {
        spawn: makeFakeSpawn({ glAvailable: false }),
        probeClips: async (p) => p.map((x) => clip(x, 4)),
      }
    );
    expect(res.success).toBe(true);
    expect(res.warnings.join(' ')).toMatch(/falling back to xfade/i);
  });

  it('uses the gl filter when available', async () => {
    const seen: string[][] = [];
    const res = await assembleFilm(
      { clips: ['/a.mp4', '/b.mp4'], engine: 'gl', rootDir: root },
      {
        spawn: makeFakeSpawn({ glAvailable: true, seen }),
        probeClips: async (p) => p.map((x) => clip(x, 4)),
      }
    );
    expect(res.success).toBe(true);
    const render = seen.find((a) => a.includes('-filter_complex'));
    expect(render?.join(' ')).toContain('gltransition=');
  });

  it('fails closed with a clear error when no clips are given', async () => {
    const res = await assembleFilm({ clips: [] }, { spawn: makeFakeSpawn() });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/at least one clip/i);
  });

  it('fails closed when ffmpeg is not installed', async () => {
    const res = await assembleFilm(
      { clips: ['/a.mp4'], rootDir: root },
      {
        spawn: makeFakeSpawn({ versionCode: 1 }),
        probeClips: async (p) => p.map((x) => clip(x, 4)),
      }
    );
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/ffmpeg is required/i);
  });

  it('surfaces the ffmpeg stderr tail on a render failure', async () => {
    const res = await assembleFilm(
      { clips: ['/a.mp4', '/b.mp4'], rootDir: root },
      { spawn: makeFakeSpawn({ renderCode: 1 }), probeClips: async (p) => p.map((x) => clip(x, 4)) }
    );
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/film render failed/i);
  });
});

// ---------------------------------------------------------------------------
// 10. REAL ffmpeg integration (skipped when ffmpeg is absent)
// ---------------------------------------------------------------------------

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

describe.runIf(hasFfmpeg)('assembleFilm — real ffmpeg render', () => {
  let root: string;
  const clips: string[] = [];

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'buddy-film-real-'));
    // Three 2s lavfi clips (color + sine tone), distinct so a transition is visible.
    const colors = ['red', 'green', 'blue'];
    for (let i = 0; i < 3; i++) {
      const out = join(root, `clip${i}.mp4`);
      const r = spawnSync('ffmpeg', [
        '-y',
        '-hide_banner',
        '-f',
        'lavfi',
        '-i',
        `color=c=${colors[i]}:size=320x240:rate=30:duration=2`,
        '-f',
        'lavfi',
        '-i',
        `sine=frequency=${300 + i * 100}:duration=2`,
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
      clips.push(out);
    }
  }, 60_000);

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('welds 3 clips with a 0.5s xfade into one film of ≈ 5s', async () => {
    const res = await assembleFilm({
      clips,
      transitions: 'fade',
      transitionDuration: 0.5,
      resolution: '480x360',
      rootDir: root,
      name: 'real-test',
    });
    expect(res.success, res.error).toBe(true);
    expect(res.outputPath).toBeDefined();
    const st = await stat(res.outputPath!);
    expect(st.size).toBeGreaterThan(1000);
    // 6s of clips − 2×0.5s transitions = 5s.
    expect(res.estimatedDuration).toBe(5);
    expect(res.probedDuration).toBeGreaterThan(4.5);
    expect(res.probedDuration).toBeLessThan(5.6);
    expect(res.targetWidth).toBe(480);
    expect(res.hasAudio).toBe(true);
  }, 120_000);

  it('hard-cut concat (transition 0) yields the full summed duration ≈ 6s', async () => {
    const res = await assembleFilm({
      clips,
      transitions: 'cut',
      resolution: '480x360',
      rootDir: root,
      name: 'real-cut',
    });
    expect(res.success, res.error).toBe(true);
    expect(res.estimatedDuration).toBe(6);
    expect(res.probedDuration).toBeGreaterThan(5.5);
    expect(res.probedDuration).toBeLessThan(6.6);
  }, 120_000);
});
