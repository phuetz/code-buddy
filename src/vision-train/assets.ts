/**
 * 3D asset fetch for the simulate→perceive loop (Poly Haven, CC0).
 *
 * Poly Haven's public API (https://api.polyhaven.com, no key) lists CC0 models
 * and, per slug, a nested files object. We fetch a curated set and lay them out
 * as `<assets>/<coco_class>/<slug>.<ext>` — the convention `scripts/blenderproc/
 * scene.py` expects (immediate parent dir = the COCO class label). CC0 = the
 * safest licence (no attribution, commercial OK), unlike ShapeNet/3D-FUTURE
 * which forbid commercial use of even the derived model.
 *
 * Pure parsing (list, url pick, categorisation) is separated from IO (fetch is
 * injected) so it's unit-testable offline and never throws on a bad response.
 *
 * @module vision-train/assets
 */
import { logger } from '../utils/logger.js';

export const POLYHAVEN_API = 'https://api.polyhaven.com';

/** One asset the caller wants: a Poly Haven slug mapped to a COCO class dir. */
export interface AssetRequest {
  slug: string;
  /** COCO class name → becomes the parent directory (must match the perceiver's classes). */
  cocoClass: string;
}

export type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown>; arrayBuffer: () => Promise<ArrayBuffer> }>;

/**
 * Depth-first search for the first downloadable file URL of a given extension
 * inside Poly Haven's nested `/files/<slug>` object (which nests by
 * format → resolution → filename → { url }). Returns null if none.
 */
export function firstFileUrl(files: unknown, ext: string): string | null {
  const want = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
  const seen = new Set<unknown>();
  const stack: unknown[] = [files];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object' || seen.has(node)) continue;
    seen.add(node);
    const rec = node as Record<string, unknown>;
    const url = rec.url;
    if (typeof url === 'string' && url.toLowerCase().split('?')[0]!.endsWith(want)) {
      return url;
    }
    for (const v of Object.values(rec)) {
      if (v && typeof v === 'object') stack.push(v);
    }
  }
  return null;
}

/**
 * List Poly Haven model slugs, optionally filtered to those whose categories or
 * tags intersect `matchAny` (case-insensitive). Returns [] on any failure.
 */
export async function listPolyHavenModels(
  fetchFn: FetchLike,
  opts: { matchAny?: string[]; apiBase?: string } = {},
): Promise<string[]> {
  const base = opts.apiBase ?? POLYHAVEN_API;
  try {
    const res = await fetchFn(`${base}/assets?type=models`);
    if (!res.ok) return [];
    const data = (await res.json()) as Record<string, { categories?: string[]; tags?: string[] }>;
    const match = opts.matchAny?.map((s) => s.toLowerCase());
    const slugs = Object.entries(data)
      .filter(([, meta]) => {
        if (!match || match.length === 0) return true;
        const hay = [...(meta.categories ?? []), ...(meta.tags ?? [])].map((s) => s.toLowerCase());
        return hay.some((h) => match.some((m) => h.includes(m)));
      })
      .map(([slug]) => slug);
    return slugs;
  } catch (err) {
    logger.warn(`Poly Haven list failed: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

/**
 * Resolve the download URL for a slug in the preferred format. Defaults to
 * SELF-CONTAINED formats first (`blend` then `glb`) — a bare Poly Haven `.gltf`
 * is only the JSON descriptor (its `.bin` + textures are separate files), so it
 * would import empty. Returns null if none. Never throws.
 */
export async function resolveAssetUrl(
  fetchFn: FetchLike,
  slug: string,
  opts: { apiBase?: string; formats?: string[] } = {},
): Promise<string | null> {
  const base = opts.apiBase ?? POLYHAVEN_API;
  const formats = opts.formats ?? ['blend', 'glb', 'gltf'];
  try {
    const res = await fetchFn(`${base}/files/${encodeURIComponent(slug)}`);
    if (!res.ok) return null;
    const files = await res.json();
    for (const fmt of formats) {
      const url = firstFileUrl(files, fmt);
      if (url) return url;
    }
    return null;
  } catch (err) {
    logger.warn(`Poly Haven files(${slug}) failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
