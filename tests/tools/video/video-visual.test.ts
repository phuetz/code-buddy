/**
 * Phase 2 (`visual`) video-understanding tests — deterministic, no real Ollama/tesseract.
 *
 * The frame budget + even-cap are pure functions. Dedup runs with an INJECTED hasher
 * so the "strictly consecutive" behaviour is provable without real images. The
 * orchestrator's fusion runs with an INJECTED describer + injected sampler/dedup so
 * the {said, shown} merge and one-keyframe-per-segment rule are asserted without a
 * VLM. And `visual:false` is proven to touch NONE of the visual machinery.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtemp, rm, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  frameBudgetForDuration,
  capEvenly,
  parsePtsTimes,
  buildSceneDetectArgs,
  buildIntervalArgs,
  sampleFrames,
  type SampledFrame,
} from '../../../src/tools/video/frame-sample.js';
import {
  dedupConsecutiveFrames,
  hashSimilarity,
} from '../../../src/tools/video/frame-dedup.js';
import { describeFrame } from '../../../src/tools/video/describe-frame.js';
import {
  understandVideo,
  fuseTranscriptWithFrames,
  isUnderstandOk,
} from '../../../src/tools/video/video-understanding.js';
import { buildVideoYtdlpArgs } from '../../../src/tools/video/media-fetch.js';

function hasBinary(bin: string): boolean {
  try {
    execFileSync(bin, ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
const FFMPEG = hasBinary('ffmpeg') && hasBinary('ffprobe');

// ---------------------------------------------------------------------------
// frame budget + cap (pure)
// ---------------------------------------------------------------------------
describe('frame budget (auto-scaled by duration)', () => {
  it('respects the 30 / 80 / 100 tiers by duration', () => {
    expect(frameBudgetForDuration(20)).toBe(30); // ≤30 s
    expect(frameBudgetForDuration(30)).toBe(30); // boundary
    expect(frameBudgetForDuration(300)).toBe(80); // 5 min (3–10 min)
    expect(frameBudgetForDuration(600)).toBe(80); // 10 min boundary
    expect(frameBudgetForDuration(1200)).toBe(100); // 20 min → hard cap
    expect(frameBudgetForDuration(0)).toBe(30); // unknown/zero → smallest tier
  });

  it('caps a long list evenly, keeping first and last', () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    const capped = capEvenly(items, 3);
    expect(capped).toHaveLength(3);
    expect(capped[0]).toBe(0);
    expect(capped[capped.length - 1]).toBe(9);
    // returns everything when already within budget
    expect(capEvenly(items, 20)).toEqual(items);
  });

  it('parses showinfo pts_time values in order', () => {
    const stderr =
      '[Parsed_showinfo_1 @ 0x1] n:0 pts:0 pts_time:0.0 x\n' +
      '[Parsed_showinfo_1 @ 0x1] n:1 pts:120 pts_time:12.34 x\n' +
      '[Parsed_showinfo_1 @ 0x1] n:2 pts:250 pts_time:25.6 x\n';
    expect(parsePtsTimes(stderr)).toEqual([0, 12.34, 25.6]);
  });

  it('builds scene-detect and interval ffmpeg args with -vsync vfr', () => {
    const scene = buildSceneDetectArgs('/v.mp4', '/out/frame_%04d.jpg', 0.4);
    expect(scene).toContain('-vsync');
    expect(scene[scene.indexOf('-vsync') + 1]).toBe('vfr');
    expect(scene.some((a) => a.includes("select='gt(scene,0.4)'"))).toBe(true);
    expect(scene.some((a) => a.includes('showinfo'))).toBe(true);

    const interval = buildIntervalArgs('/v.mp4', '/out/frame_%04d.jpg', '100/1200');
    expect(interval.some((a) => a.includes('fps=100/1200'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// dedup (injected hasher → strictly consecutive)
// ---------------------------------------------------------------------------
describe('dedupConsecutiveFrames (injected perceptual hash)', () => {
  const F = (path: string, t: number): SampledFrame => ({ path, t });

  it('drops a near-identical consecutive frame, keeps distinct ones', async () => {
    // A ≈ A' (consecutive dupes), B distinct.
    const hashes: Record<string, string> = {
      A: '1111111100000000',
      "A'": '1111111100000001', // 1 bit off from A → very similar
      B: '0000000011111111', // opposite → distinct
    };
    const frames = [F('A', 0), F("A'", 1), F('B', 2)];
    const kept = await dedupConsecutiveFrames(frames, {
      computeHash: async (p) => hashes[p]!,
      threshold: 0.9,
    });
    expect(kept.map((f) => f.path)).toEqual(['A', 'B']); // A' dropped
  });

  it('dedups ONLY consecutively — an identical frame far from its twin is kept', async () => {
    // A, A' (dupe of A), B, A'' (identical to A but NOT adjacent to an A twin).
    const hashes: Record<string, string> = {
      A: '1111111100000000',
      "A'": '1111111100000000', // identical → dropped (adjacent to A)
      B: '0000000011111111', // distinct
      "A''": '1111111100000000', // identical to A, but its predecessor is B → kept
    };
    const frames = [F('A', 0), F("A'", 1), F('B', 2), F("A''", 3)];
    const kept = await dedupConsecutiveFrames(frames, {
      computeHash: async (p) => hashes[p]!,
      threshold: 0.9,
    });
    expect(kept.map((f) => f.path)).toEqual(['A', 'B', "A''"]);
  });

  it('keeps a frame when hashing fails (fail-open, never wrongly drops)', async () => {
    const frames = [F('A', 0), F('B', 1)];
    const kept = await dedupConsecutiveFrames(frames, { computeHash: async () => '' });
    expect(kept).toHaveLength(2);
  });

  it('hashSimilarity: identical → 1, opposite → 0, mismatched length → 0', () => {
    expect(hashSimilarity('1010', '1010')).toBe(1);
    expect(hashSimilarity('1010', '0101')).toBe(0);
    expect(hashSimilarity('1010', '101')).toBe(0);
    expect(hashSimilarity('', '1010')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// describeFrame (injected VLM + OCR)
// ---------------------------------------------------------------------------
describe('describeFrame (injected analyzers)', () => {
  it('returns the VLM description alone when OCR is off', async () => {
    const analyze = vi.fn(async () => 'an editor with a function');
    const ocr = vi.fn(async () => 'should not run');
    const out = await describeFrame('/f.jpg', 'p', { analyze, ocr });
    expect(out).toBe('an editor with a function');
    expect(ocr).not.toHaveBeenCalled();
  });

  it('prepends OCR text when withOcr is on', async () => {
    const analyze = vi.fn(async () => 'VS Code editor');
    const ocr = vi.fn(async () => 'const x = 1;');
    const out = await describeFrame('/f.jpg', 'p', { analyze, ocr, withOcr: true });
    expect(out).toContain('const x = 1;');
    expect(out).toContain('VS Code editor');
    expect(ocr).toHaveBeenCalledWith('/f.jpg', 'eng');
  });

  it('never throws — a failing analyzer yields empty text', async () => {
    const analyze = vi.fn(async () => {
      throw new Error('ollama down');
    });
    const out = await describeFrame('/f.jpg', 'p', { analyze });
    expect(out).toBe('');
  });
});

// ---------------------------------------------------------------------------
// fusion (transcript × frames → {said, shown}, one keyframe / segment)
// ---------------------------------------------------------------------------
describe('fuseTranscriptWithFrames', () => {
  it('attaches one representative keyframe per segment and describes each once', async () => {
    const segments = [
      { t_start: 0, t_end: 10, said: 'intro' },
      { t_start: 10, t_end: 20, said: 'the code' },
    ];
    const frames: SampledFrame[] = [
      { path: '/f0.jpg', t: 3 }, // inside segment 0
      { path: '/f1.jpg', t: 15 }, // inside segment 1
    ];
    const describe = vi.fn(async (p: string) => `shown@${p}`);
    const fused = await fuseTranscriptWithFrames(segments, frames, describe);

    expect(fused[0]).toMatchObject({ said: 'intro', shown: 'shown@/f0.jpg', keyframeT: 3 });
    expect(fused[1]).toMatchObject({ said: 'the code', shown: 'shown@/f1.jpg', keyframeT: 15 });
    expect(describe).toHaveBeenCalledTimes(2);
  });

  it('describes a shared static keyframe only ONCE across segments', async () => {
    const segments = [
      { t_start: 0, t_end: 10, said: 'a' },
      { t_start: 10, t_end: 20, said: 'b' },
    ];
    // Only one frame → both segments pick it (static screencast).
    const frames: SampledFrame[] = [{ path: '/only.jpg', t: 5 }];
    const describe = vi.fn(async (p: string) => `desc@${p}`);
    const fused = await fuseTranscriptWithFrames(segments, frames, describe);

    expect(fused[0].shown).toBe('desc@/only.jpg');
    expect(fused[1].shown).toBe('desc@/only.jpg');
    expect(describe).toHaveBeenCalledTimes(1); // cached by path
  });

  it('leaves shown undefined when there are no frames', async () => {
    const segments = [{ t_start: 0, t_end: 10, said: 'x' }];
    const fused = await fuseTranscriptWithFrames(segments, [], vi.fn(async () => 'never'));
    expect(fused[0].shown).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// orchestrator: visual:true fuses said+shown; visual:false = Phase 1 untouched
// ---------------------------------------------------------------------------
describe('understandVideo — visual path (injected pipeline)', () => {
  let outDir: string;
  beforeAll(async () => {
    outDir = await mkdtemp(join(tmpdir(), 'buddy-visual-'));
    await mkdir(outDir, { recursive: true });
  });
  afterAll(async () => {
    if (outDir) await rm(outDir, { recursive: true, force: true }).catch(() => {});
  });

  it('visual:true fuses {said, shown} per segment with one keyframe each', async () => {
    const extractAudio = vi.fn(async () => ({ success: true, output: 'ok', data: { path: '/tmp/x.mp3' } }));
    const transcribeLongFn = vi.fn(async () => [
      { t_start: 0, t_end: 10, said: 'intro words' },
      { t_start: 10, t_end: 20, said: 'code words' },
    ]);
    const sampleFramesFn = vi.fn(async () => [
      { path: '/f0.jpg', t: 4 },
      { path: '/f1.jpg', t: 14 },
    ]);
    const dedupFrames = vi.fn(async (frames: SampledFrame[]) => frames);
    const describeFrameFn = vi.fn(async (p: string) => `SHOWN(${p})`);

    const result = await understandVideo(
      { source: '/videos/screencast.mp4', visual: true },
      {
        outDir,
        existsSync: (p) => p === '/videos/screencast.mp4',
        extractAudio,
        transcribeLong: transcribeLongFn,
        sampleFrames: sampleFramesFn,
        dedupFrames,
        describeFrame: describeFrameFn,
      },
    );

    expect(isUnderstandOk(result)).toBe(true);
    if (isUnderstandOk(result)) {
      expect(result.method).toBe('local-file');
      expect(result.visual).toBeDefined();
      expect(result.visual!.framesSampled).toBe(2);
      expect(result.visual!.framesDistinct).toBe(2);
      expect(result.visual!.fused).toHaveLength(2);
      expect(result.visual!.fused[0]).toMatchObject({ said: 'intro words', shown: 'SHOWN(/f0.jpg)' });
      expect(result.visual!.fused[1]).toMatchObject({ said: 'code words', shown: 'SHOWN(/f1.jpg)' });
      // The visual descriptions surface in the human output.
      expect(result.output).toContain('SHOWN(/f0.jpg)');
      expect(result.output).toContain('MONTRÉ');
    }
    expect(sampleFramesFn).toHaveBeenCalledWith('/videos/screencast.mp4', undefined);
    expect(describeFrameFn).toHaveBeenCalledTimes(2);
  });

  it('visual:true passes ocr:true through to the describer', async () => {
    const capturedOpts: Array<Record<string, unknown> | undefined> = [];
    const describeFrameFn = vi.fn(async (_p: string, _prompt?: string, opts?: Record<string, unknown>) => {
      capturedOpts.push(opts);
      return 'desc';
    });
    const result = await understandVideo(
      { source: '/videos/demo.mp4', visual: true, ocr: true },
      {
        outDir,
        existsSync: (p) => p === '/videos/demo.mp4',
        extractAudio: async () => ({ success: true, output: 'ok', data: { path: '/tmp/x.mp3' } }),
        transcribeLong: async () => [{ t_start: 0, t_end: 5, said: 'hi' }],
        sampleFrames: async () => [{ path: '/f.jpg', t: 2 }],
        dedupFrames: async (f) => f,
        describeFrame: describeFrameFn,
      },
    );
    expect(isUnderstandOk(result)).toBe(true);
    expect(capturedOpts[0]).toMatchObject({ withOcr: true });
  });

  it('visual:false leaves Phase 1 STRICTLY unchanged (no frames, no VLM)', async () => {
    const sampleFramesFn = vi.fn();
    const dedupFrames = vi.fn();
    const describeFrameFn = vi.fn();
    const result = await understandVideo(
      { source: '/videos/demo.mp4' }, // no visual flag
      {
        outDir,
        existsSync: (p) => p === '/videos/demo.mp4',
        extractAudio: async () => ({ success: true, output: 'ok', data: { path: '/tmp/x.mp3' } }),
        transcribeLong: async () => [{ t_start: 0, t_end: 10, said: 'only speech' }],
        sampleFrames: sampleFramesFn as never,
        dedupFrames: dedupFrames as never,
        describeFrame: describeFrameFn as never,
      },
    );
    expect(isUnderstandOk(result)).toBe(true);
    if (isUnderstandOk(result)) {
      expect(result.visual).toBeUndefined();
      expect(result.output).not.toContain('MONTRÉ');
      expect(result.segments[0].said).toBe('only speech');
    }
    // The visual machinery must not have been touched.
    expect(sampleFramesFn).not.toHaveBeenCalled();
    expect(dedupFrames).not.toHaveBeenCalled();
    expect(describeFrameFn).not.toHaveBeenCalled();
  });

  it('visual degrades to transcript-only (never throws) when frame sampling yields nothing', async () => {
    const describeFrameFn = vi.fn();
    const result = await understandVideo(
      { source: '/videos/demo.mp4', visual: true },
      {
        outDir,
        existsSync: (p) => p === '/videos/demo.mp4',
        extractAudio: async () => ({ success: true, output: 'ok', data: { path: '/tmp/x.mp3' } }),
        transcribeLong: async () => [{ t_start: 0, t_end: 10, said: 'speech' }],
        sampleFrames: async () => [], // ffmpeg produced nothing
        dedupFrames: async (f) => f,
        describeFrame: describeFrameFn as never,
      },
    );
    expect(isUnderstandOk(result)).toBe(true);
    if (isUnderstandOk(result)) {
      expect(result.visual).toBeDefined();
      expect(result.visual!.framesSampled).toBe(0);
      expect(result.visual!.note).toBeTruthy();
      // Transcript still intact.
      expect(result.segments[0].said).toBe('speech');
    }
    expect(describeFrameFn).not.toHaveBeenCalled();
  });

  it('visual on a remote source downloads the picture track (injected)', async () => {
    const downloadVideo = vi.fn(async () => ({ videoPath: '/dl/video.mp4' }));
    const sampleFramesFn = vi.fn(async () => [{ path: '/f0.jpg', t: 1 }]);
    const result = await understandVideo(
      { source: 'https://youtu.be/dQw4w9WgXcQ', visual: true },
      {
        outDir,
        fetchCaptions: async () => [{ text: 'hello', start: 0, duration: 5 }],
        downloadVideo,
        sampleFrames: sampleFramesFn,
        dedupFrames: async (f) => f,
        describeFrame: async () => 'a terminal',
      },
    );
    expect(isUnderstandOk(result)).toBe(true);
    expect(downloadVideo).toHaveBeenCalledWith('https://youtu.be/dQw4w9WgXcQ', outDir);
    expect(sampleFramesFn).toHaveBeenCalledWith('/dl/video.mp4', undefined);
  });
});

// ---------------------------------------------------------------------------
// media-fetch video download args
// ---------------------------------------------------------------------------
describe('buildVideoYtdlpArgs', () => {
  it('caps resolution and recodes to mp4', () => {
    const args = buildVideoYtdlpArgs('https://youtu.be/x', '/out/v.%(ext)s');
    expect(args.some((a) => a.includes('height<=480'))).toBe(true);
    expect(args).toContain('--recode-video');
    expect(args[args.indexOf('--recode-video') + 1]).toBe('mp4');
    expect(args).toContain('https://youtu.be/x');
  });
});

// ---------------------------------------------------------------------------
// Optional real smoke: extract frames from a tiny synthetic video (no VLM).
// ---------------------------------------------------------------------------
describe('sampleFrames (real ffmpeg smoke)', () => {
  it.skipIf(!FFMPEG)('samples timestamped frames from a short generated clip', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'buddy-frames-smoke-'));
    try {
      const clip = join(dir, 'clip.mp4');
      // 6 s testsrc (a moving pattern → scene changes), 10 fps, small.
      execFileSync('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'lavfi', '-i', 'testsrc=duration=6:size=160x120:rate=10',
        '-pix_fmt', 'yuv420p', clip,
      ]);
      const frames = await sampleFrames(clip, { outDir: dir, minSceneFrames: 1 });
      expect(frames.length).toBeGreaterThan(0);
      expect(frames.length).toBeLessThanOrEqual(30); // ≤30 s → budget 30
      for (const f of frames) {
        expect(typeof f.t).toBe('number');
        expect(f.path.endsWith('.jpg')).toBe(true);
      }
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }, 60_000);
});
