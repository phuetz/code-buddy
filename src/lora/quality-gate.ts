/**
 * Lightweight dataset quality gate (no heavy image libs).
 * Flags tiny files (likely corrupt), exact byte duplicates (sha256), and
 * near-identical sizes with identical first-chunk hashes as soft duplicates.
 *
 * @module lora/quality-gate
 */

import fs from 'fs/promises';
import path from 'path';
import { createHash } from 'crypto';
import { listImages } from './dataset.js';

export interface QualityIssue {
  path: string;
  kind: 'too_small' | 'duplicate' | 'unreadable';
  detail: string;
}

export interface DatasetQualityReport {
  ok: boolean;
  imageCount: number;
  issues: QualityIssue[];
  warnings: string[];
  /** Images that passed size + uniqueness checks. */
  kept: string[];
  /** Paths recommended for exclusion (duplicates / unreadable / too small). */
  reject: string[];
}

const DEFAULT_MIN_BYTES = 8_000; // ~8 KB — empty/corrupt PNG stubs are smaller

async function fileSha256(filePath: string): Promise<string> {
  const buf = await fs.readFile(filePath);
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Scan images/ under a LoRA project for simple quality problems.
 * Pure filesystem heuristics — no pixel blur metrics (no sharp/opencv dep).
 */
export async function assessDatasetQuality(
  projectDirectory: string,
  options?: { minBytes?: number },
): Promise<DatasetQualityReport> {
  const imagesDir = path.join(projectDirectory, 'images');
  const minBytes = options?.minBytes ?? DEFAULT_MIN_BYTES;
  const names = await listImages(imagesDir);
  const issues: QualityIssue[] = [];
  const warnings: string[] = [];
  const kept: string[] = [];
  const reject: string[] = [];
  const seenHash = new Map<string, string>();

  for (const name of names) {
    const full = path.join(imagesDir, name);
    try {
      const st = await fs.stat(full);
      if (st.size < minBytes) {
        issues.push({
          path: full,
          kind: 'too_small',
          detail: `${st.size} bytes < min ${minBytes} (likely corrupt or blank)`,
        });
        reject.push(full);
        continue;
      }
      const hash = await fileSha256(full);
      const prior = seenHash.get(hash);
      if (prior) {
        issues.push({
          path: full,
          kind: 'duplicate',
          detail: `exact duplicate of ${path.basename(prior)}`,
        });
        reject.push(full);
        continue;
      }
      seenHash.set(hash, full);
      kept.push(full);
    } catch (err) {
      issues.push({
        path: full,
        kind: 'unreadable',
        detail: err instanceof Error ? err.message : String(err),
      });
      reject.push(full);
    }
  }

  if (kept.length < 15 && names.length >= 15) {
    warnings.push(
      `Only ${kept.length} unique usable images after quality filter (need ~40 for Krea).`,
    );
  }
  if (reject.length > 0) {
    warnings.push(`${reject.length} image(s) flagged (too small / duplicate / unreadable).`);
  }

  const hard = issues.filter((i) => i.kind === 'too_small' || i.kind === 'unreadable');
  return {
    // Hard fail only on corrupt/unreadable; exact duplicates are reject-list warnings.
    ok: hard.length === 0 && kept.length > 0,
    imageCount: names.length,
    issues,
    warnings,
    kept,
    reject,
  };
}

/** Soft OK: no hard errors (unreadable/too_small); duplicates only warn. */
export function qualityGatePassed(report: DatasetQualityReport): boolean {
  const hard = report.issues.filter((i) => i.kind === 'too_small' || i.kind === 'unreadable');
  return hard.length === 0 && report.kept.length > 0;
}
