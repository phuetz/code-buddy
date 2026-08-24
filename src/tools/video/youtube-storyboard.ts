/**
 * YouTube storyboard fallback for local visual understanding.
 *
 * Some YouTube videos require a PO token for their media streams and therefore
 * return HTTP 403 to yt-dlp even though captions and public storyboard sheets are
 * available. This module downloads the highest-resolution storyboard (`sb0`),
 * extracts its JPEG MIME parts, crops the thumbnail grid into timestamped frames,
 * and keeps the whole operation local. It never calls a cloud vision provider.
 *
 * @module tools/video/youtube-storyboard
 */

import { spawn as realSpawn } from 'child_process';
import { mkdir, readFile } from 'fs/promises';
import { join } from 'path';
import { logger } from '../../utils/logger.js';
import type { SampledFrame } from './frame-sample.js';
import { resolveYtdlp, type MediaFetchDeps } from './media-fetch.js';

export interface StoryboardSampleOk {
  frames: SampledFrame[];
  /** Local yt-dlp MHTML artifact retained for diagnostics/reuse. */
  storyboardPath: string;
}

export interface StoryboardSampleErr {
  error: string;
}

export type StoryboardSampleResult = StoryboardSampleOk | StoryboardSampleErr;

export interface StoryboardSampleDeps extends MediaFetchDeps {
  /** Maximum number of cropped frames (default 100). */
  budget?: number;
  now?: () => number;
}

interface StoryboardFormat {
  format_id?: string;
  width?: number;
  height?: number;
  fps?: number;
  rows?: number;
  columns?: number;
}

interface YtdlpInfo {
  duration?: number;
  formats?: StoryboardFormat[];
}

interface ProcResult {
  code: number | null;
  stderr: string;
}

/** Build yt-dlp arguments for the public, low-bandwidth YouTube storyboard. */
export function buildStoryboardYtdlpArgs(source: string, outputTemplate: string): string[] {
  return [
    '--js-runtimes',
    `node:${process.execPath}`,
    '-f',
    'sb0',
    '--write-info-json',
    '--no-playlist',
    '-o',
    outputTemplate,
    source,
  ];
}

/**
 * Extract JPEG MIME bodies using their explicit Content-Length. Converting the
 * whole MHTML to latin1 preserves byte offsets one-for-one, unlike UTF-8.
 */
export function extractStoryboardJpegs(mhtml: Buffer): Buffer[] {
  const text = mhtml.toString('latin1');
  const images: Buffer[] = [];
  const contentType = /Content-Type:\s*image\/jpeg/gi;
  let match: RegExpExecArray | null;

  while ((match = contentType.exec(text)) !== null) {
    const crlfEnd = text.indexOf('\r\n\r\n', match.index);
    const lfEnd = text.indexOf('\n\n', match.index);
    const usesCrlf = crlfEnd >= 0 && (lfEnd < 0 || crlfEnd <= lfEnd);
    const headerEnd = usesCrlf ? crlfEnd : lfEnd;
    if (headerEnd < 0) break;

    const headers = text.slice(match.index, headerEnd);
    const lengthMatch = /Content-Length:\s*(\d+)/i.exec(headers);
    if (!lengthMatch) {
      contentType.lastIndex = headerEnd + (usesCrlf ? 4 : 2);
      continue;
    }

    const length = Number.parseInt(lengthMatch[1]!, 10);
    const bodyStart = headerEnd + (usesCrlf ? 4 : 2);
    const bodyEnd = bodyStart + length;
    if (!Number.isFinite(length) || length <= 0 || bodyEnd > mhtml.length) break;
    images.push(mhtml.subarray(bodyStart, bodyEnd));
    contentType.lastIndex = bodyEnd;
  }

  return images;
}

/** Evenly spread at most `budget` integer indices across `[0, total)`. */
export function storyboardFrameIndices(total: number, budget: number): number[] {
  if (total <= 0 || budget <= 0) return [];
  if (total <= budget) return Array.from({ length: total }, (_, i) => i);
  if (budget === 1) return [0];
  const indices = new Set<number>();
  for (let i = 0; i < budget; i++) {
    indices.add(Math.round((i * (total - 1)) / (budget - 1)));
  }
  return [...indices];
}

function runProcess(
  spawn: typeof realSpawn,
  cmd: string,
  args: string[],
  timeoutMs: number,
): Promise<ProcResult> {
  return new Promise((resolve) => {
    let settled = false;
    let stderr = '';
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (result: ProcResult): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };

    let child: ReturnType<typeof realSpawn>;
    try {
      child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (err) {
      finish({ code: null, stderr: err instanceof Error ? err.message : String(err) });
      return;
    }

    timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
      finish({ code: null, stderr: `${stderr}\n[timeout ${timeoutMs}ms]` });
    }, timeoutMs);
    child.stderr?.on('data', (data) => {
      stderr = `${stderr}${String(data)}`.slice(-4000);
    });
    child.on('error', (err) => finish({ code: null, stderr: `${stderr}${err.message}` }));
    child.on('close', (code) => finish({ code, stderr }));
  });
}

/** Type guard for a successful storyboard sample. */
export function isStoryboardSampleOk(result: StoryboardSampleResult): result is StoryboardSampleOk {
  return 'frames' in result;
}

/**
 * Download and crop YouTube's public storyboard into timestamped local JPEGs.
 * Returns `{ error }` on every failure path; never throws.
 */
export async function sampleYoutubeStoryboardFrames(
  source: string,
  outDir: string,
  deps: StoryboardSampleDeps = {},
): Promise<StoryboardSampleResult> {
  const invocation = resolveYtdlp(deps);
  if (!invocation) return { error: 'yt-dlp introuvable pour le repli storyboard' };

  const stamp = (deps.now ?? Date.now)();
  const base = `ytdl-storyboard-${stamp}`;
  const outputTemplate = join(outDir, `${base}.%(ext)s`);
  const storyboardPath = join(outDir, `${base}.mhtml`);
  const infoPath = join(outDir, `${base}.info.json`);
  const args = [...invocation.baseArgs, ...buildStoryboardYtdlpArgs(source, outputTemplate)];
  const timeoutMs = deps.timeoutMs ?? 2 * 60 * 1000;

  logger.info(`[video] full stream unavailable — downloading YouTube storyboard via ${invocation.label}`);
  const proc = await runProcess(deps.spawn ?? realSpawn, invocation.cmd, args, timeoutMs);
  if (proc.code !== 0) {
    return {
      error: `yt-dlp storyboard exited with code ${proc.code ?? 'unknown'}${
        proc.stderr.trim() ? `: ${proc.stderr.trim().slice(-500)}` : ''
      }`,
    };
  }

  try {
    const [mhtml, rawInfo] = await Promise.all([readFile(storyboardPath), readFile(infoPath, 'utf8')]);
    const info = JSON.parse(rawInfo) as YtdlpInfo;
    const format = info.formats?.find((candidate) => candidate.format_id === 'sb0');
    const width = Math.floor(format?.width ?? 0);
    const height = Math.floor(format?.height ?? 0);
    const rows = Math.floor(format?.rows ?? 0);
    const columns = Math.floor(format?.columns ?? 0);
    const fps = format?.fps ?? 0;
    const duration = info.duration ?? 0;
    if (width <= 0 || height <= 0 || rows <= 0 || columns <= 0 || fps <= 0 || duration <= 0) {
      return { error: 'métadonnées storyboard sb0 incomplètes' };
    }

    const sheets = extractStoryboardJpegs(mhtml);
    if (sheets.length === 0) return { error: 'aucune planche JPEG trouvée dans le storyboard' };

    const tilesPerSheet = rows * columns;
    const available = sheets.length * tilesPerSheet;
    const total = Math.min(available, Math.max(1, Math.ceil(duration * fps)));
    const indices = storyboardFrameIndices(total, deps.budget ?? 100);
    const framesDir = join(outDir, `${base}-frames`);
    await mkdir(framesDir, { recursive: true });
    const sharp = (await import('sharp')).default;

    const produced = await Promise.all(
      indices.map(async (index): Promise<SampledFrame | null> => {
        const sheetIndex = Math.floor(index / tilesPerSheet);
        const tileIndex = index % tilesPerSheet;
        const sheet = sheets[sheetIndex];
        if (!sheet) return null;
        const row = Math.floor(tileIndex / columns);
        const column = tileIndex % columns;
        const framePath = join(framesDir, `frame_${String(index + 1).padStart(4, '0')}.jpg`);
        try {
          await sharp(sheet)
            .extract({ left: column * width, top: row * height, width, height })
            .jpeg({ quality: 88 })
            .toFile(framePath);
          return { path: framePath, t: Math.round((index / fps) * 100) / 100 };
        } catch (err) {
          logger.debug(`[video] storyboard crop ${index} failed: ${err instanceof Error ? err.message : String(err)}`);
          return null;
        }
      }),
    );
    const frames = produced.filter((frame): frame is SampledFrame => frame !== null);
    if (frames.length === 0) return { error: 'le storyboard n’a produit aucune frame exploitable' };
    logger.info(`[video] storyboard fallback: ${frames.length} frame(s) over ${duration}s`);
    return { frames, storyboardPath };
  } catch (err) {
    return { error: `repli storyboard illisible: ${err instanceof Error ? err.message : String(err)}` };
  }
}
