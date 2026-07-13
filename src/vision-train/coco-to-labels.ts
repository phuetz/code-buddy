/**
 * COCO → vision-train labels bridge.
 *
 * A simulator (BlenderProc2, Kubric, or any renderer that knows its scene
 * geometry) writes a standard COCO `annotations.json` — images/annotations/
 * categories, `bbox` in absolute pixels. The vision-train "folder" mode wants a
 * flat `{filename: {label: count}}` ground truth (see `src/commands/vision-train.ts`).
 *
 * This converts the former to the latter by counting annotations per
 * (image, category). The point of the whole "simulate to perceive" loop: a
 * SIMULATED scene whose 3D layout is known yields EXACT, self-labeled ground
 * truth — a mathematical fact projected from the world, not a prompt we hoped
 * an image generator honored. That ground truth then scores the robot's REAL
 * perception (YOLO), surfacing where it is weak.
 *
 * Pure + deterministic (no IO) so it's unit-testable; the CLI reads the file
 * and calls `cocoToVisionTrainLabels` on the parsed object.
 */

/** Minimal COCO subset we depend on (extra fields are ignored). */
export interface CocoImage {
  id: number;
  file_name: string;
}
export interface CocoAnnotation {
  image_id: number;
  category_id: number;
}
export interface CocoCategory {
  id: number;
  name: string;
}
export interface CocoDataset {
  images?: CocoImage[];
  annotations?: CocoAnnotation[];
  categories?: CocoCategory[];
}

export interface CocoToLabelsOptions {
  /**
   * Rename COCO category names to match the perceiver's class names before
   * counting (e.g. a sim category "human" → YOLO/COCO "person"). Applied to the
   * `categories[].name`; both `keep` and the output labels use the renamed name.
   */
  rename?: Record<string, string>;
  /** Keep only these (post-rename) category names; all others are dropped. */
  keep?: string[];
  /**
   * Key the output by the basename of `file_name` (default true) — matches how
   * vision-train enumerates a directory with `fs.readdir` (basenames only).
   */
  basename?: boolean;
}

/** `{ filename: { label: count } }` — the shape `buddy vision-train --labels` expects. */
export type VisionTrainLabels = Record<string, Record<string, number>>;

/** Basename without importing `path` (keeps this module IO/host-free). */
function baseName(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

/**
 * Convert a parsed COCO dataset into vision-train ground-truth labels.
 *
 * - Every image is emitted (even with zero annotations) so an "empty room"
 *   scene becomes an explicit `{}` — that's the false-positive test the
 *   curriculum's person-count-0 scenes rely on.
 * - Annotations whose `image_id`/`category_id` don't resolve are skipped
 *   (defensive: a malformed sim export never throws, it just under-counts).
 */
export function cocoToVisionTrainLabels(
  coco: CocoDataset,
  opts: CocoToLabelsOptions = {},
): VisionTrainLabels {
  const useBasename = opts.basename ?? true;
  const keep = opts.keep ? new Set(opts.keep) : null;
  const rename = opts.rename ?? {};

  const catName = new Map<number, string>();
  for (const c of coco.categories ?? []) {
    catName.set(c.id, rename[c.name] ?? c.name);
  }

  const imgFile = new Map<number, string>();
  for (const im of coco.images ?? []) {
    imgFile.set(im.id, useBasename ? baseName(im.file_name) : im.file_name);
  }

  const labels: VisionTrainLabels = {};
  // Seed every image so zero-annotation scenes appear as {} (empty-room GT).
  for (const file of imgFile.values()) {
    if (!labels[file]) labels[file] = {};
  }

  for (const a of coco.annotations ?? []) {
    const file = imgFile.get(a.image_id);
    const label = catName.get(a.category_id);
    if (!file || !label) continue;
    if (keep && !keep.has(label)) continue;
    const bucket = labels[file] ?? (labels[file] = {});
    bucket[label] = (bucket[label] ?? 0) + 1;
  }

  return labels;
}
