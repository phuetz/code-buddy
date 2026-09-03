/**
 * Map informal / curriculum labels onto Ultralytics COCO class names so
 * `object_detect` is not asked for a class it does not have (YOLO raises
 * `Unknown YOLO class: desk` and the scene is dropped from the benchmark).
 *
 * Pure + deterministic — the CLI perceive() path and unit tests share this.
 */

/** Informal name (lowercase) → COCO name used by YOLOv8n. */
const TO_COCO: Record<string, string> = {
  desk: 'dining table',
  table: 'dining table',
  diningtable: 'dining table',
  'dining-table': 'dining table',
  sofa: 'couch',
  television: 'tv',
  tvmonitor: 'tv',
  cellphone: 'cell phone',
  smartphone: 'cell phone',
  phone: 'cell phone',
  motorbike: 'motorcycle',
  aeroplane: 'airplane',
  human: 'person',
  people: 'person',
  man: 'person',
  woman: 'person',
};

export function cocoClassFor(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) return trimmed;
  return TO_COCO[trimmed.toLowerCase()] ?? trimmed;
}

/** Unique COCO class names to pass to YOLO for an expected count map. */
export function yoloClassesFromExpected(counts: Record<string, number>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const label of Object.keys(counts)) {
    const mapped = cocoClassFor(label);
    if (!mapped || seen.has(mapped)) continue;
    seen.add(mapped);
    out.push(mapped);
  }
  return out;
}

/** Prefer the ground-truth name when YOLO reported the COCO alias. */
export function expectedLabelForDetection(detected: string, expectedLabels: string[]): string {
  const d = detected.trim().toLowerCase();
  for (const exp of expectedLabels) {
    if (exp.trim().toLowerCase() === d) return exp;
    if (cocoClassFor(exp).toLowerCase() === d) return exp;
  }
  return detected;
}

export function remapCountsToExpected(
  detected: Record<string, number>,
  expected: Record<string, number>,
): Record<string, number> {
  const expectedLabels = Object.keys(expected);
  const out: Record<string, number> = {};
  for (const [label, n] of Object.entries(detected)) {
    const mapped = expectedLabelForDetection(label, expectedLabels);
    out[mapped] = (out[mapped] ?? 0) + n;
  }
  return out;
}
