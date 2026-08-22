/**
 * Phase 2 (`visual`) WALL-CLOCK BUDGET tests — deterministic, no real Ollama/yt-dlp.
 *
 * The visual leg (download the picture track + sample frames + describe each keyframe at a
 * local VLM ~1–10 s/frame + OCR) is unbounded per se, so a long video blows any timeout and
 * the tool fails. These tests prove the budget makes it time-bounded and gracefully
 * degrading (never a hard timeout), using an INJECTED clock (`deps.now`) that a describe
 * cost advances, so the budget cutoff is provable without real time:
 *
 *   - budget reached mid-describe → describes K frames, stops, output carries a truncation
 *     note, describe is NOT called after the budget;
 *   - the "won't start one that won't finish" estimate guard stops even earlier;
 *   - a download that exceeds the budget / fails → degrades to transcript + "visuel ignoré";
 *   - `visual:false` is BYTE-IDENTICAL and never touches the budget machinery;
 *   - a throwing visual pipeline never throws — it degrades to the transcript.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { understandVideo, isUnderstandOk } from '../../../src/tools/video/video-understanding.js';
import type { SampledFrame } from '../../../src/tools/video/frame-sample.js';

/** A monotonic injected clock a describe-cost can advance — models "describing takes time". */
function makeClock(startMs = 0): { now: () => number; advance: (ms: number) => void } {
  let t = startMs;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

const okExtract = async (): Promise<{ success: true; output: string; data: { path: string } }> => ({
  success: true,
  output: 'ok',
  data: { path: '/tmp/audio.wav' },
});

describe('understandVideo — visual wall-clock budget', () => {
  let outDir: string;
  beforeAll(async () => {
    outDir = await mkdtemp(join(tmpdir(), 'buddy-visual-budget-'));
    await mkdir(outDir, { recursive: true });
  });
  afterAll(async () => {
    if (outDir) await rm(outDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(() => {});
  });

  it('describes K frames then STOPS at the budget, with a truncation note (K < total)', async () => {
    const clock = makeClock(0);
    const budgetMs = 120_000; // deadline = 120 s
    const describeCostMs = 40_000; // each describe "takes" 40 s of wall-clock

    // 5 segments, one distinct frame inside each → 5 unique keyframes to describe.
    const segments = Array.from({ length: 5 }, (_, i) => ({
      t_start: i * 10,
      t_end: i * 10 + 10,
      said: `seg ${i}`,
    }));
    const frames: SampledFrame[] = Array.from({ length: 5 }, (_, i) => ({
      path: `/f${i}.jpg`,
      t: i * 10 + 5,
    }));

    const describeFrame = vi.fn(async (p: string) => {
      clock.advance(describeCostMs);
      return `SHOWN(${p})`;
    });

    const result = await understandVideo(
      { source: '/videos/long.mp4', visual: true },
      {
        outDir,
        now: clock.now,
        visualBudgetMs: budgetMs,
        visualPerFrameEstimateMs: 100, // tiny → only the deadline itself stops us
        existsSync: (p) => p === '/videos/long.mp4',
        extractAudio: okExtract,
        transcribeLong: async () => segments,
        sampleFrames: async () => frames,
        dedupFrames: async (f) => f,
        describeFrame,
      },
    );

    expect(isUnderstandOk(result)).toBe(true);
    if (!isUnderstandOk(result)) return;

    // Only 3 of 5 frames fit the budget (0 s, 40 s, 80 s → 4th would start at 120 s = deadline).
    expect(describeFrame).toHaveBeenCalledTimes(3);
    expect(result.visual).toBeDefined();
    expect(result.visual!.note).toBeTruthy();
    expect(result.visual!.note).toContain('visuel partiel');
    expect(result.visual!.note).toContain('3/5');
    expect(result.visual!.note).toContain('budget de 120 s');
    // The truncation note surfaces in the human output.
    expect(result.output).toContain('visuel partiel');
    expect(result.output).toContain('3/5');
    // Transcript is always rendered in full (the visual is an enrichment).
    expect(result.segments).toHaveLength(5);
    expect(result.output).toContain('seg 0');
    // Exactly the first 3 frames were described; nothing after the budget.
    expect(result.visual!.fused.filter((s) => s.shown)).toHaveLength(3);
  });

  it('does NOT start a describe the remaining budget can\'t cover (estimate guard)', async () => {
    const clock = makeClock(0);
    const describeFrame = vi.fn(async (p: string) => {
      clock.advance(40_000);
      return `SHOWN(${p})`;
    });
    const segments = Array.from({ length: 5 }, (_, i) => ({ t_start: i * 10, t_end: i * 10 + 10, said: `s${i}` }));
    const frames: SampledFrame[] = Array.from({ length: 5 }, (_, i) => ({ path: `/g${i}.jpg`, t: i * 10 + 5 }));

    const result = await understandVideo(
      { source: '/videos/long2.mp4', visual: true },
      {
        outDir,
        now: clock.now,
        visualBudgetMs: 120_000,
        visualPerFrameEstimateMs: 50_000, // remaining < 50 s → don't start another
        existsSync: (p) => p === '/videos/long2.mp4',
        extractAudio: okExtract,
        transcribeLong: async () => segments,
        sampleFrames: async () => frames,
        dedupFrames: async (f) => f,
        describeFrame,
      },
    );

    expect(isUnderstandOk(result)).toBe(true);
    if (!isUnderstandOk(result)) return;
    // 0 s (rem 120s), 40 s (rem 80s) start; at 80 s remaining=40s < 50s estimate → stop.
    expect(describeFrame).toHaveBeenCalledTimes(2);
    expect(result.visual!.note).toContain('2/5');
  });

  it('degrades to transcript + "visuel ignoré" when the download exceeds the budget (never throws)', async () => {
    const clock = makeClock(0);
    const describeFrame = vi.fn(async () => 'never');
    const sampleFrames = vi.fn(async () => [] as SampledFrame[]);

    // Injected downloadVideo simulates yt-dlp hitting the (budget-derived) timeout on a huge file.
    const downloadVideo = vi.fn(async () => ({ error: 'yt-dlp timed out after 30000ms' }));

    const result = await understandVideo(
      { source: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', visual: true },
      {
        outDir,
        now: clock.now,
        visualBudgetMs: 30_000,
        fetchCaptions: async () => [
          { text: 'bonjour', start: 0, duration: 3 },
          { text: 'la suite', start: 3, duration: 3 },
        ],
        downloadVideo,
        sampleFrames,
        dedupFrames: async (f) => f,
        describeFrame,
      },
    );

    expect(isUnderstandOk(result)).toBe(true);
    if (!isUnderstandOk(result)) return;
    // Transcript is intact.
    expect(result.method).toBe('youtube-captions');
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0].said).toBe('bonjour');
    // Visual degraded with a clear "ignoré" note.
    expect(result.visual).toBeDefined();
    expect(result.visual!.framesSampled).toBe(0);
    expect(result.visual!.note).toContain('visuel ignoré');
    expect(result.output).toContain('visuel ignoré');
    // We never sampled/described anything.
    expect(sampleFrames).not.toHaveBeenCalled();
    expect(describeFrame).not.toHaveBeenCalled();
  });

  it('visual:false is BYTE-IDENTICAL and never touches the budget machinery', async () => {
    const source = '/videos/plain.mp4';
    const baseDeps = {
      outDir,
      existsSync: (p: string) => p === source,
      extractAudio: okExtract,
      transcribeLong: async () => [
        { t_start: 0, t_end: 10, said: 'only speech' },
        { t_start: 10, t_end: 20, said: 'more speech' },
      ],
    };

    // Baseline: NO visual deps at all.
    const baseline = await understandVideo({ source }, baseDeps);

    // Same input, but the full budget/visual machinery is WIRED into deps — it must be
    // untouched and the output byte-identical when visual is off.
    const clock = makeClock(0);
    const now = vi.fn(clock.now);
    const sampleFrames = vi.fn(async () => [] as SampledFrame[]);
    const dedupFrames = vi.fn(async (f: SampledFrame[]) => f);
    const describeFrame = vi.fn(async () => 'never');
    const downloadVideo = vi.fn(async () => ({ videoPath: '/never.mp4' }));

    const withBudgetDeps = await understandVideo(
      { source, visual: false },
      {
        ...baseDeps,
        now,
        visualBudgetMs: 5_000,
        visualPerFrameEstimateMs: 1_000,
        sampleFrames,
        dedupFrames,
        describeFrame,
        downloadVideo,
      },
    );

    expect(isUnderstandOk(baseline)).toBe(true);
    expect(isUnderstandOk(withBudgetDeps)).toBe(true);
    if (!isUnderstandOk(baseline) || !isUnderstandOk(withBudgetDeps)) return;

    // Byte-identical output + no visual field at all.
    expect(withBudgetDeps.output).toBe(baseline.output);
    expect(baseline.visual).toBeUndefined();
    expect(withBudgetDeps.visual).toBeUndefined();

    // NONE of the budget/visual machinery ran (no clock reads, no download/sample/describe).
    expect(now).not.toHaveBeenCalled();
    expect(downloadVideo).not.toHaveBeenCalled();
    expect(sampleFrames).not.toHaveBeenCalled();
    expect(dedupFrames).not.toHaveBeenCalled();
    expect(describeFrame).not.toHaveBeenCalled();
  });

  it('never throws — a throwing visual pipeline degrades to the transcript', async () => {
    const result = await understandVideo(
      { source: '/videos/boom.mp4', visual: true },
      {
        outDir,
        visualBudgetMs: 60_000,
        existsSync: (p) => p === '/videos/boom.mp4',
        extractAudio: okExtract,
        transcribeLong: async () => [{ t_start: 0, t_end: 5, said: 'still here' }],
        sampleFrames: async () => {
          throw new Error('ffmpeg exploded');
        },
        dedupFrames: async (f) => f,
        describeFrame: async () => 'never',
      },
    );

    expect(isUnderstandOk(result)).toBe(true);
    if (!isUnderstandOk(result)) return;
    // Transcript survives; the visual note reports the degrade.
    expect(result.segments[0].said).toBe('still here');
    expect(result.visual).toBeDefined();
    expect(result.visual!.note).toBeTruthy();
  });
});
