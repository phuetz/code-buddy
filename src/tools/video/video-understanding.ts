/**
 * Video understanding orchestrator (Phase 1: transcript-first, local-first).
 *
 * Resolves a source (YouTube URL / direct media URL / local file) to a timestamped
 * transcript via a gracefully-degrading cascade:
 *   YouTube  → free captions first, else yt-dlp audio download + local Whisper;
 *   direct URL → yt-dlp audio download + local Whisper;
 *   local file → ffmpeg audio extract + local Whisper.
 *
 * It NEVER calls an LLM — it returns the structured, persisted transcript plus a
 * bounded text rendering; the main agent does the summarizing / question-answering.
 * Every failure surfaces as `{ error }`; nothing throws.
 *
 * @module tools/video/video-understanding
 */

import { mkdir, writeFile } from 'fs/promises';
import { existsSync as realExistsSync } from 'fs';
import { basename, join, isAbsolute, resolve as resolvePath } from 'path';
import type { ToolResult } from '../../types/index.js';
import type { Transcriber } from '../../sensory/speech-reaction.js';
import { logger } from '../../utils/logger.js';
import {
  fetchYoutubeCaptions,
  extractYoutubeVideoId,
  isYoutubeUrl,
  type Segment,
} from './youtube-captions.js';
import {
  downloadAudioWav,
  downloadVideoFile,
  isDownloadOk,
  isVideoDownloadOk,
  type DownloadResult,
  type VideoDownloadResult,
} from './media-fetch.js';
import { transcribeLong, type TimedSegment, type LongTranscribeOptions } from './long-transcribe.js';
import type { SampledFrame, FrameSampleDeps } from './frame-sample.js';
import type { FrameDedupDeps } from './frame-dedup.js';
import type { DescribeFrameDeps } from './describe-frame.js';

export type UnderstandMethod = 'youtube-captions' | 'youtube-audio' | 'local-file' | 'direct-url';

export interface UnderstandVideoInput {
  source: string;
  question?: string;
  language?: string;
  /** Phase 2: also analyze what is SHOWN on screen (frames → VLM/OCR). */
  visual?: boolean;
  /** With `visual`, also OCR each keyframe (best for reading code on screen). */
  ocr?: boolean;
}

/** A transcript segment enriched with what was SHOWN during it (Phase 2). */
export interface VisualSegment extends TimedSegment {
  /** VLM/OCR description of the representative keyframe for this segment. */
  shown?: string;
  keyframePath?: string;
  keyframeT?: number;
}

export interface VisualResult {
  fused: VisualSegment[];
  framesSampled: number;
  framesDistinct: number;
  /** Present when visual was requested but couldn't run (degraded to transcript). */
  note?: string;
}

export interface UnderstandVideoSuccess {
  segments: TimedSegment[];
  transcriptPath: string;
  source: string;
  method: UnderstandMethod;
  output: string;
  /** Present only when `visual: true` produced (or attempted) frame analysis. */
  visual?: VisualResult;
}

export interface UnderstandVideoFailure {
  error: string;
}

export type UnderstandVideoResult = UnderstandVideoSuccess | UnderstandVideoFailure;

export interface UnderstandVideoDeps {
  cwd?: string;
  /** Directory for the downloaded audio + persisted transcript (default `<cwd>/.codebuddy/video`). */
  outDir?: string;
  fetchCaptions?: typeof fetchYoutubeCaptions;
  downloadAudio?: (source: string, outDir: string) => Promise<DownloadResult>;
  /** Local-file audio extraction (default: `VideoTool.extractAudio`). */
  extractAudio?: (filePath: string) => Promise<ToolResult>;
  transcribeLong?: (audioPath: string, options?: LongTranscribeOptions) => Promise<TimedSegment[]>;
  /** Injectable STT handed to the default `transcribeLong`. */
  transcriber?: Transcriber;
  existsSync?: (path: string) => boolean;
  now?: () => number;
  /** Max chars of transcript rendered inline before truncating with a pointer to the file. */
  maxOutputChars?: number;

  // --- Phase 2 (`visual`) injectables — untouched unless `input.visual` is set. ---
  /** Sample timestamped keyframes from a local video (default: `sampleFrames`). */
  sampleFrames?: (videoPath: string, opts?: FrameSampleDeps) => Promise<SampledFrame[]>;
  /** Options handed to the default frame sampler. */
  frameSampleOptions?: FrameSampleDeps;
  /** Dedup consecutive near-identical frames (default: `dedupConsecutiveFrames`). */
  dedupFrames?: (frames: SampledFrame[], opts?: FrameDedupDeps) => Promise<SampledFrame[]>;
  /** Describe one keyframe → text (default: `describeFrame`, local VLM + optional OCR). */
  describeFrame?: (imagePath: string, prompt?: string, opts?: DescribeFrameDeps) => Promise<string>;
  /** Options handed to the default describer (e.g. `withOcr`). */
  describeOptions?: DescribeFrameDeps;
  /** Download the picture track for a remote source (default: `downloadVideoFile`). */
  downloadVideo?: (source: string, outDir: string) => Promise<VideoDownloadResult>;
}

const DEFAULT_MAX_OUTPUT_CHARS = 6000;

/** Type guard: did understanding succeed? */
export function isUnderstandOk(result: UnderstandVideoResult): result is UnderstandVideoSuccess {
  return 'segments' in result;
}

function formatTimestamp(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number): string => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${m}:${pad(ss)}`;
}

/** Captions carry (start, duration); fold into the shared (t_start, t_end, said) shape. */
function captionsToSegments(captions: Segment[]): TimedSegment[] {
  return captions.map((cue) => ({
    t_start: Math.round(cue.start * 100) / 100,
    t_end: Math.round((cue.start + cue.duration) * 100) / 100,
    said: cue.text,
  }));
}

function renderTranscript(segments: TimedSegment[]): string {
  return segments
    .map((seg) => `[${formatTimestamp(seg.t_start)} - ${formatTimestamp(seg.t_end)}] ${seg.said}`)
    .join('\n');
}

function safeSlug(source: string): string {
  const id = extractYoutubeVideoId(source);
  if (id) return `yt-${id}`;
  const base = basename(source.split(/[?#]/)[0] ?? source).replace(/\.[^.]+$/, '');
  const cleaned = base.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return cleaned || `video-${Date.now()}`;
}

interface ResolvedSegments {
  segments: TimedSegment[];
  method: UnderstandMethod;
  /** Set when a local video file is available for Phase 2 frame sampling. */
  videoPath?: string;
}

async function resolveSegments(
  input: UnderstandVideoInput,
  deps: UnderstandVideoDeps,
  outDir: string,
): Promise<ResolvedSegments | UnderstandVideoFailure> {
  const source = input.source;
  const fetchCaptions = deps.fetchCaptions ?? fetchYoutubeCaptions;
  const downloadAudio = deps.downloadAudio ?? ((s: string, d: string) => downloadAudioWav(s, d));
  const runTranscribe = deps.transcribeLong
    ?? ((audioPath: string, opts?: LongTranscribeOptions) => transcribeLong(audioPath, opts));
  const existsSync = deps.existsSync ?? realExistsSync;
  const transcribeOpts: LongTranscribeOptions = deps.transcriber ? { transcriber: deps.transcriber } : {};

  const langs = [input.language, 'en', 'fr'].filter((l): l is string => !!l && l.trim().length > 0);
  const uniqueLangs = [...new Set(langs)];

  // --- YouTube: captions first, then audio download + local STT ---
  if (isYoutubeUrl(source)) {
    const captions = await fetchCaptions(source, uniqueLangs);
    if (captions && captions.length > 0) {
      return { segments: captionsToSegments(captions), method: 'youtube-captions' };
    }
    logger.info('[video] no captions — falling back to yt-dlp + local STT');
    const dl = await downloadAudio(source, outDir);
    if (!isDownloadOk(dl)) return { error: dl.error };
    return { segments: await runTranscribe(dl.wavPath, transcribeOpts), method: 'youtube-audio' };
  }

  // --- Local file: ffmpeg audio extract + local STT ---
  const localPath = isAbsolute(source) ? source : resolvePath(deps.cwd ?? process.cwd(), source);
  if (existsSync(source) || existsSync(localPath)) {
    const filePath = existsSync(source) ? source : localPath;
    const extract = deps.extractAudio ?? (await defaultExtractAudio());
    const extracted = await extract(filePath);
    if (!extracted.success) {
      return { error: extracted.error ?? 'audio extraction failed' };
    }
    const audioPath = (extracted.data as { path?: string } | undefined)?.path;
    if (!audioPath) return { error: 'audio extraction produced no output path' };
    // The local file IS the video → available for Phase 2 frame sampling.
    return { segments: await runTranscribe(audioPath, transcribeOpts), method: 'local-file', videoPath: filePath };
  }

  // --- Direct media URL: yt-dlp handles generic URLs too ---
  if (/^https?:\/\//i.test(source)) {
    const dl = await downloadAudio(source, outDir);
    if (!isDownloadOk(dl)) return { error: dl.error };
    return { segments: await runTranscribe(dl.wavPath, transcribeOpts), method: 'direct-url' };
  }

  return { error: `source introuvable (ni fichier local, ni URL): ${source}` };
}

async function defaultExtractAudio(): Promise<(filePath: string) => Promise<ToolResult>> {
  const { VideoTool } = await import('../video-tool.js');
  const tool = new VideoTool();
  return (filePath: string) => tool.extractAudio(filePath);
}

/** Pick the ONE distinct frame that best represents a transcript segment: the frame
 *  whose timestamp falls inside `[t_start, t_end]` (closest to the midpoint), else
 *  the globally nearest frame by |t − midpoint|. Returns `null` for no frames. */
function pickKeyframe(seg: TimedSegment, frames: SampledFrame[]): SampledFrame | null {
  if (frames.length === 0) return null;
  const mid = (seg.t_start + seg.t_end) / 2;
  let best: SampledFrame | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const f of frames) {
    const inside = f.t >= seg.t_start && f.t <= seg.t_end;
    // Prefer in-range frames (score = |t-mid|); out-of-range penalized heavily.
    const score = Math.abs(f.t - mid) + (inside ? 0 : 1e6);
    if (score < bestScore) {
      bestScore = score;
      best = f;
    }
  }
  return best;
}

/**
 * Fuse the transcript with the sampled keyframes: attach ONE representative keyframe
 * per segment and describe each DISTINCT chosen frame exactly once (cached by path,
 * so a static screencast shared across many segments costs one VLM call). Returns the
 * enriched `{ t_start, t_end, said, shown }` tuples. Never throws.
 */
export async function fuseTranscriptWithFrames(
  segments: TimedSegment[],
  frames: SampledFrame[],
  describe: (imagePath: string) => Promise<string>,
): Promise<VisualSegment[]> {
  const chosen = segments.map((seg) => pickKeyframe(seg, frames));

  // Describe each distinct chosen frame once.
  const cache = new Map<string, string>();
  const uniquePaths = [...new Set(chosen.filter((f): f is SampledFrame => f !== null).map((f) => f.path))];
  for (const path of uniquePaths) {
    let shown = '';
    try {
      shown = await describe(path);
    } catch (err) {
      logger.warn(`[video] describe failed for ${path}: ${err instanceof Error ? err.message : String(err)}`);
    }
    cache.set(path, shown);
  }

  return segments.map((seg, i) => {
    const frame = chosen[i];
    if (!frame) return { ...seg };
    const shown = cache.get(frame.path) ?? '';
    const out: VisualSegment = { ...seg, keyframePath: frame.path, keyframeT: frame.t };
    if (shown) out.shown = shown;
    return out;
  });
}

/** Resolve a local video path for Phase 2: the local source file if available, else
 *  download the picture track for a remote source. Returns `null` (with a note) when
 *  the visual analysis can't run — the caller degrades to transcript-only. */
async function resolveVideoPath(
  input: UnderstandVideoInput,
  deps: UnderstandVideoDeps,
  outDir: string,
  localVideoPath: string | undefined,
): Promise<{ videoPath: string } | { note: string }> {
  if (localVideoPath) return { videoPath: localVideoPath };

  // Remote source (YouTube / direct URL): download the picture track.
  if (/^https?:\/\//i.test(input.source) || isYoutubeUrl(input.source)) {
    const download = deps.downloadVideo ?? ((s: string, d: string) => downloadVideoFile(s, d));
    const dl = await download(input.source, outDir);
    if (isVideoDownloadOk(dl)) return { videoPath: dl.videoPath };
    return { note: `visuel indisponible (téléchargement vidéo échoué: ${dl.error})` };
  }

  return { note: 'visuel indisponible (aucune vidéo locale ni URL téléchargeable)' };
}

/** The Phase 2 visual pipeline: sample frames → dedup → fuse with the transcript.
 *  Fully injectable, never throws; on any failure returns a degraded VisualResult
 *  (transcript untouched). */
async function runVisualPipeline(
  input: UnderstandVideoInput,
  deps: UnderstandVideoDeps,
  outDir: string,
  segments: TimedSegment[],
  localVideoPath: string | undefined,
): Promise<VisualResult> {
  const resolved = await resolveVideoPath(input, deps, outDir, localVideoPath);
  if ('note' in resolved) {
    logger.warn(`[video] ${resolved.note}`);
    return { fused: segments.map((s) => ({ ...s })), framesSampled: 0, framesDistinct: 0, note: resolved.note };
  }

  const sampleFramesFn =
    deps.sampleFrames ??
    (async (v: string, o?: FrameSampleDeps) => (await import('./frame-sample.js')).sampleFrames(v, o));
  const dedupFramesFn =
    deps.dedupFrames ??
    (async (f: SampledFrame[], o?: FrameDedupDeps) => (await import('./frame-dedup.js')).dedupConsecutiveFrames(f, o));
  const describeFrameFn =
    deps.describeFrame ??
    (async (p: string, prompt?: string, o?: DescribeFrameDeps) => (await import('./describe-frame.js')).describeFrame(p, prompt, o));

  const describeOptions: DescribeFrameDeps = {
    ...(deps.describeOptions ?? {}),
    ...(input.ocr ? { withOcr: true } : {}),
  };

  const frames = await sampleFramesFn(resolved.videoPath, deps.frameSampleOptions);
  if (frames.length === 0) {
    return { fused: segments.map((s) => ({ ...s })), framesSampled: 0, framesDistinct: 0, note: 'aucune frame échantillonnée' };
  }
  const distinct = await dedupFramesFn(frames);
  const fused = await fuseTranscriptWithFrames(segments, distinct, (imagePath) =>
    describeFrameFn(imagePath, undefined, describeOptions),
  );
  return { fused, framesSampled: frames.length, framesDistinct: distinct.length };
}

/**
 * Understand a video → a normalized, persisted, timestamped transcript. Phase 1:
 * no LLM, transcript-first, never-throws.
 */
export async function understandVideo(
  input: UnderstandVideoInput,
  deps: UnderstandVideoDeps = {},
): Promise<UnderstandVideoResult> {
  const source = input.source?.trim();
  if (!source) return { error: 'source is required' };

  const cwd = deps.cwd ?? process.cwd();
  const outDir = deps.outDir ?? join(cwd, '.codebuddy', 'video');
  const maxChars = deps.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;

  try {
    await mkdir(outDir, { recursive: true });
  } catch (err) {
    return { error: `could not create output dir ${outDir}: ${err instanceof Error ? err.message : String(err)}` };
  }

  const resolved = await resolveSegments({ ...input, source }, deps, outDir);
  if ('error' in resolved) return resolved;

  const { segments, method } = resolved;
  const transcriptPath = join(outDir, `transcript-${safeSlug(source)}.txt`);
  const rendered = renderTranscript(segments);

  // --- Phase 2: visual analysis (opt-in). Phase 1 is STRICTLY untouched otherwise. ---
  let visual: VisualResult | undefined;
  if (input.visual) {
    try {
      visual = await runVisualPipeline({ ...input, source }, deps, outDir, segments, resolved.videoPath);
    } catch (err) {
      // Fail-soft: a broken visual pipeline degrades to the transcript, never crashes.
      logger.warn(`[video] visual pipeline error: ${err instanceof Error ? err.message : String(err)}`);
      visual = { fused: segments.map((s) => ({ ...s })), framesSampled: 0, framesDistinct: 0, note: 'visuel en erreur (dégradé au transcript)' };
    }
  }

  const visualRendered = visual ? renderVisual(visual) : '';
  const header = `# Transcript\nsource: ${source}\nmethod: ${method}\nsegments: ${segments.length}\n${visual ? `visual: ${visual.framesDistinct}/${visual.framesSampled} frames\n` : ''}${input.question ? `question: ${input.question}\n` : ''}`;
  try {
    const body = visualRendered ? `${rendered}\n\n## Visuel (ce qui est montré)\n${visualRendered}\n` : `${rendered}\n`;
    await writeFile(transcriptPath, `${header}\n${body}`, 'utf8');
  } catch (err) {
    logger.warn(`[video] could not persist transcript to ${transcriptPath}: ${err instanceof Error ? err.message : String(err)}`);
  }

  let output: string;
  const bodyForOutput = visualRendered ? `${rendered}\n\n## Visuel (ce qui est montré)\n${visualRendered}` : rendered;
  if (segments.length === 0 && !visualRendered) {
    output = `Aucune parole détectée dans la vidéo (méthode: ${method}). Transcript vide écrit dans ${transcriptPath}.`;
  } else if (bodyForOutput.length <= maxChars) {
    output = `Transcript horodaté (${segments.length} segments, méthode: ${method}${visual ? `, visuel: ${visual.framesDistinct} frames distinctes` : ''}) — sauvegardé dans ${transcriptPath}:\n\n${bodyForOutput}`;
  } else {
    output = `Transcript horodaté tronqué (${segments.length} segments, méthode: ${method}${visual ? `, visuel: ${visual.framesDistinct} frames distinctes` : ''}). Complet dans ${transcriptPath}:\n\n${bodyForOutput.slice(0, maxChars)}\n\n… [tronqué — transcript complet dans ${transcriptPath}]`;
  }

  const result: UnderstandVideoSuccess = { segments, transcriptPath, source, method, output };
  if (visual) result.visual = visual;
  return result;
}

/** Render the fused visual segments as timestamped `SAID … | SHOWN …` lines. */
function renderVisual(visual: VisualResult): string {
  const lines = visual.fused
    .filter((seg) => seg.shown)
    .map((seg) => `[${formatTimestamp(seg.t_start)} - ${formatTimestamp(seg.t_end)}] MONTRÉ: ${seg.shown}`);
  if (lines.length === 0) {
    return visual.note ? `(${visual.note})` : '(aucune description visuelle produite)';
  }
  return lines.join('\n');
}
