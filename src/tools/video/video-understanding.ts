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
import type { CloudUnderstandDeps, CloudUnderstandOutcome, CloudSourceKind } from './cloud-understand.js';
import { ingestVideoUnderstanding, getDefaultVideoCkgBridge, type VideoCkgBridge } from './video-ckg.js';

export type UnderstandMethod = 'youtube-captions' | 'youtube-audio' | 'local-file' | 'direct-url';

export interface UnderstandVideoInput {
  source: string;
  question?: string;
  language?: string;
  /** Phase 2: also analyze what is SHOWN on screen (frames → VLM/OCR). */
  visual?: boolean;
  /** With `visual`, also OCR each keyframe (best for reading code on screen). */
  ocr?: boolean;
  /**
   * Phase 3: OPT-IN cloud understanding (Gemini). Sends the video/URL to Google for a
   * joint audio+visual, timestamped answer. NEVER default; on any failure (no key, network,
   * quota) it degrades cleanly to the local transcript. Additive — the local transcript is
   * always produced alongside.
   */
  cloud?: boolean;
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

/** Cloud (Gemini) understanding result — present only when `cloud: true` was requested. */
export interface CloudResult {
  provider: 'gemini';
  /** Gemini's timestamped answer/summary — present on success. */
  answer?: string;
  model?: string;
  sourceKind?: CloudSourceKind;
  /** Privacy warning (video sent to Google) — present on success. */
  warning?: string;
  /** Present when cloud was requested but couldn't run (degraded to the local transcript). */
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
  /** Present only when `cloud: true` produced (or attempted) Gemini understanding. */
  cloud?: CloudResult;
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

  // --- Phase 3 (`cloud`) injectables — untouched unless `input.cloud` is set. ---
  /** Cloud (Gemini) understanding (default: `understandVideoCloud`). Never throws. */
  understandCloud?: (
    source: string,
    question: string | undefined,
    deps?: CloudUnderstandDeps,
  ) => Promise<CloudUnderstandOutcome>;
  /** Options handed to the default cloud understander (env/fetch/callGemini injection). */
  cloudDeps?: CloudUnderstandDeps;

  // --- Collective Knowledge Graph injectable — untouched unless the shared
  //     `CODEBUDDY_COLLECTIVE_MEMORY=true` env gate is on (see `ingestVideoCkg` below). ---
  /** Override the CKG bridge (tests / alternative engines). Default (gate on, no
   *  override): the real bridge over `getCollectiveKnowledgeGraph()`. */
  ckgBridge?: VideoCkgBridge;
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

/**
 * Minimum distance (seconds) a frame may sit OUTSIDE a segment's span and still be
 * attributed as "shown" during it. Acts as a floor under the per-segment tolerance
 * (`max(halfDuration, this)`) so short segments aren't over-strict, while a frame far
 * outside the span is never wrongly credited. Screencasts can dedup down to 2–3 distinct
 * frames, so without this bound a t=5 s frame gets attributed to a t=600 s segment.
 */
const MIN_KEYFRAME_ATTACH_TOLERANCE_SEC = 15;

/** Pick the ONE distinct frame that best represents a transcript segment: the frame
 *  whose timestamp falls inside `[t_start, t_end]` (closest to the midpoint), else
 *  the globally nearest frame by |t − midpoint| — but ONLY if it sits within a bounded
 *  distance of the segment span (else no frame is attached, so we never mis-attribute a
 *  far-away frame as "shown"). Returns `null` for no frames / no in-range candidate. */
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
  if (!best) return null;
  // In-range frames always attach; an out-of-range best attaches only within tolerance.
  const inRange = best.t >= seg.t_start && best.t <= seg.t_end;
  if (!inRange) {
    const gap = best.t < seg.t_start ? seg.t_start - best.t : best.t - seg.t_end;
    const tolerance = Math.max((seg.t_end - seg.t_start) / 2, MIN_KEYFRAME_ATTACH_TOLERANCE_SEC);
    if (gap > tolerance) return null;
  }
  return best;
}

/**
 * Fuse the transcript with the sampled keyframes: attach ONE representative keyframe
 * per segment and describe each DISTINCT chosen frame exactly once (cached by path,
 * so a static screencast shared across many segments costs one VLM call). Returns the
 * enriched `{ t_start, t_end, said, shown }` tuples. Never throws.
 *
 * **Muted video / silent screencast (the target use case):** when there are NO transcript
 * segments to anchor on but distinct frames DO exist, the frames are described directly as
 * synthetic per-frame segments (one anchor per frame timestamp) instead of returning nothing
 * — so a screencast with no speech still yields visual descriptions.
 */
export async function fuseTranscriptWithFrames(
  segments: TimedSegment[],
  frames: SampledFrame[],
  describe: (imagePath: string) => Promise<string>,
): Promise<VisualSegment[]> {
  // No transcript to anchor on, but frames exist → describe them by their own timestamps.
  const anchors: TimedSegment[] =
    segments.length > 0 ? segments : frames.map((f) => ({ t_start: f.t, t_end: f.t, said: '' }));

  const chosen = anchors.map((seg) => pickKeyframe(seg, frames));

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

  return anchors.map((seg, i) => {
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

  // --- Phase 3: cloud (Gemini) understanding (opt-in). Phase 1/2 STRICTLY untouched otherwise.
  //     Additive: the local transcript above is always produced; cloud failure degrades to it. ---
  let cloud: CloudResult | undefined;
  if (input.cloud) {
    cloud = await runCloudUnderstanding({ ...input, source }, deps);
  }

  const visualRendered = visual ? renderVisual(visual) : '';
  const cloudRendered = cloud ? renderCloud(cloud) : '';
  const header = `# Transcript\nsource: ${source}\nmethod: ${method}\nsegments: ${segments.length}\n${visual ? `visual: ${visual.framesDistinct}/${visual.framesSampled} frames\n` : ''}${cloud ? `cloud: gemini${cloud.answer ? '' : ' (dégradé)'}\n` : ''}${input.question ? `question: ${input.question}\n` : ''}`;
  try {
    const visualBody = visualRendered ? `${rendered}\n\n## Visuel (ce qui est montré)\n${visualRendered}\n` : `${rendered}\n`;
    const body = cloudRendered ? `${cloudRendered}\n\n${visualBody}` : visualBody;
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
  // Cloud answer (when present) leads the output — it's the richest, and carries the privacy warning.
  if (cloudRendered) output = `${cloudRendered}\n\n${output}`;

  const result: UnderstandVideoSuccess = { segments, transcriptPath, source, method, output };
  if (visual) result.visual = visual;
  if (cloud) result.cloud = cloud;

  // --- Collective Knowledge Graph ingestion (perception → memory, opt-in, additive). ---
  // Gate: the SAME shared env flag Deep Research's Phase D and `context-pipeline.ts` use
  // (CODEBUDDY_COLLECTIVE_MEMORY=true) — no new tool parameter, consistent activation
  // across the app. This is a pure side effect: `result` above is already final and is
  // returned UNCHANGED below regardless of what happens here.
  if (process.env.CODEBUDDY_COLLECTIVE_MEMORY === 'true') {
    await ingestVideoCkg({ source, method, segments, answer: cloud?.answer, question: input.question }, deps);
  }

  return result;
}

/**
 * Deposit a bounded summary of this video's understanding into the Collective Knowledge
 * Graph — best-effort, NEVER throws (any failure, including bridge construction, is
 * caught here so it can never affect `understandVideo`'s return value or control flow).
 */
async function ingestVideoCkg(
  info: { source: string; method: UnderstandMethod; segments: TimedSegment[]; answer?: string; question?: string },
  deps: UnderstandVideoDeps,
): Promise<void> {
  try {
    const bridge = deps.ckgBridge ?? (await getDefaultVideoCkgBridge());
    await ingestVideoUnderstanding(info, bridge);
  } catch (err) {
    logger.debug(`[video] ckg ingestion skipped: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Run the opt-in cloud (Gemini) understanding. Fully injectable, NEVER throws: any failure
 * (no API key, network, quota, oversized file) returns a degraded `CloudResult` carrying a
 * `note` so the caller falls back to the local transcript.
 */
async function runCloudUnderstanding(
  input: UnderstandVideoInput,
  deps: UnderstandVideoDeps,
): Promise<CloudResult> {
  const run =
    deps.understandCloud ??
    (async (s: string, q: string | undefined, d?: CloudUnderstandDeps) =>
      (await import('./cloud-understand.js')).understandVideoCloud(s, q, d));
  try {
    const outcome = await run(input.source, input.question, deps.cloudDeps);
    if (outcome.ok) {
      return {
        provider: 'gemini',
        answer: outcome.result.answer,
        model: outcome.result.model,
        sourceKind: outcome.result.sourceKind,
        warning: outcome.result.warning,
      };
    }
    return { provider: 'gemini', note: `${outcome.reason} — dégradé au transcript local` };
  } catch (err) {
    // Defensive: even an injected understander that throws must not crash the tool.
    logger.warn(`[video] cloud understanding error: ${err instanceof Error ? err.message : String(err)}`);
    return { provider: 'gemini', note: 'cloud en erreur (dégradé au transcript local)' };
  }
}

/** Render the cloud (Gemini) result: the timestamped answer + privacy warning, or a degrade note. */
function renderCloud(cloud: CloudResult): string {
  if (cloud.answer) {
    const head = `## Compréhension cloud (Gemini${cloud.model ? ` — ${cloud.model}` : ''})`;
    const warn = cloud.warning ? `${cloud.warning}\n\n` : '';
    return `${head}\n${warn}${cloud.answer}`;
  }
  return `## Compréhension cloud (Gemini)\n(${cloud.note ?? 'indisponible'})`;
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
