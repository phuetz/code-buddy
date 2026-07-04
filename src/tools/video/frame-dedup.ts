/**
 * Temporal frame dedup — drops near-identical CONSECUTIVE frames so a low-motion
 * screencast (dozens of visually-distinct frames over 20 minutes) doesn't get
 * described dozens of redundant times.
 *
 * SSIM choice (pragmatic, no new heavy dep): rather than pull in a full SSIM
 * library, we compute a **dHash (difference perceptual hash)** with `sharp`
 * (already a dependency): downscale each frame to 9×8 grayscale and encode whether
 * each pixel is brighter than its right neighbour → a 64-bit fingerprint. Two frames
 * are "the same" when their Hamming similarity ≥ threshold. This is the standard
 * cheap perceptual-diff used for screencasts and needs zero extra install. The pixel
 * hasher is injectable so the dedup logic is unit-testable without real images.
 *
 * Dedup is **strictly consecutive**: each frame is compared only to the frame
 * immediately before it, so an identical frame that reappears far later (not adjacent
 * to a twin) is KEPT. Any hashing failure yields an empty hash, treated as distinct
 * (fail-open → we keep the frame rather than wrongly drop it). Never throws.
 *
 * @module tools/video/frame-dedup
 */

import { logger } from '../../utils/logger.js';
import type { SampledFrame } from './frame-sample.js';

export interface FrameDedupDeps {
  /** Injectable perceptual hasher → a fixed-length bit string ('' on failure). */
  computeHash?: (imagePath: string) => Promise<string>;
  /** Similarity ≥ threshold ⇒ duplicate (default 0.92). */
  threshold?: number;
}

/** dHash width/height: 9×8 grayscale → 8 comparisons per row × 8 rows = 64 bits. */
const DHASH_W = 9;
const DHASH_H = 8;

/**
 * Default perceptual hash (dHash) via sharp. Returns a 64-char bit string, or `''`
 * on any failure (missing file, decode error, sharp unavailable) — never throws.
 */
export async function perceptualHash(imagePath: string): Promise<string> {
  try {
    const sharp = (await import('sharp')).default;
    const data = await sharp(imagePath)
      .grayscale()
      .resize(DHASH_W, DHASH_H, { fit: 'fill' })
      .raw()
      .toBuffer();
    let bits = '';
    for (let row = 0; row < DHASH_H; row++) {
      for (let col = 0; col < DHASH_W - 1; col++) {
        const left = data[row * DHASH_W + col] ?? 0;
        const right = data[row * DHASH_W + col + 1] ?? 0;
        bits += left < right ? '1' : '0';
      }
    }
    return bits;
  } catch (err) {
    logger.debug(`[video] perceptualHash failed for ${imagePath}: ${err instanceof Error ? err.message : String(err)}`);
    return '';
  }
}

/**
 * Hamming similarity of two equal-length bit strings, 0..1. Returns 0 (treat as
 * distinct) when either is empty or lengths differ — so a hashing failure never
 * causes a wrongful drop.
 */
export function hashSimilarity(a: string, b: string): number {
  if (!a || !b || a.length !== b.length) return 0;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) diff++;
  }
  return 1 - diff / a.length;
}

/**
 * Drop near-identical CONSECUTIVE frames. Keeps the first frame, then keeps a frame
 * only when it differs enough (similarity < threshold) from the frame immediately
 * before it. Returns the kept subset (order preserved). Never throws.
 */
export async function dedupConsecutiveFrames(
  frames: SampledFrame[],
  deps: FrameDedupDeps = {},
): Promise<SampledFrame[]> {
  if (frames.length <= 1) return frames.slice();
  const computeHash = deps.computeHash ?? perceptualHash;
  const threshold = deps.threshold ?? 0.92;

  const kept: SampledFrame[] = [];
  let prevHash: string | null = null;

  for (const frame of frames) {
    let hash = '';
    try {
      hash = await computeHash(frame.path);
    } catch (err) {
      logger.debug(`[video] hash error for ${frame.path}: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (prevHash === null) {
      kept.push(frame);
      prevHash = hash;
      continue;
    }
    const sim = hashSimilarity(hash, prevHash);
    if (sim < threshold) kept.push(frame);
    // Compare strictly against the previous ORIGINAL frame (consecutive only).
    prevHash = hash;
  }

  logger.info(`[video] dedup: kept ${kept.length}/${frames.length} distinct frame(s)`);
  return kept;
}
