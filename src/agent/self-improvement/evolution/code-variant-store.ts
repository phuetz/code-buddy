/**
 * Code variant store (Phase B): an append-only record of EVALUATED candidate variants (git branch
 * + sha + fitness + regressions). Mirrors the LearningStore/EvolutionaryArchive pattern, but for
 * whole-agent CODE variants. It records and ranks; it NEVER merges or checks out — keep/merge is
 * human-gated (Phase E). `best()` is the "la version qui marche mieux" selector.
 *
 * @module agent/self-improvement/evolution/code-variant-store
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { logger } from '../../../utils/logger.js';

export interface VariantRecord {
  id: string;
  branch: string;
  sha: string;
  /** Aggregate fitness in [0,1]. */
  score: number;
  passedAll: boolean;
  /** Component names that regressed vs the baseline (empty = none). */
  regressions: string[];
  createdAt: string;
  detail?: string;
  /** MAP-Elites niche descriptor (which area + how broad a change) — for diversity. */
  behavior?: string;
}

export interface BestOptions {
  /** Only consider variants strictly above this score (e.g. the baseline's score). */
  baselineScore?: number;
  /** Require passedAll (default true). */
  requirePassedAll?: boolean;
  /** Reject variants with any regression (default true). */
  rejectRegressions?: boolean;
}

function defaultStorePath(): string {
  return join(process.cwd(), '.codebuddy', 'self-improvement', 'evolution', 'variants.json');
}

/**
 * MAP-Elites niche descriptor for a variant, from the files it changed: dominant code area (first
 * two path segments) + a breadth bucket. Variants in the same niche compete; different niches are
 * preserved → diversity. e.g. "src/agent:single", "src/tools:broad".
 */
export function behaviorDescriptor(changedFiles: string[]): string {
  const files = changedFiles.filter((f) => f.trim().length > 0);
  if (files.length === 0) return 'none';
  const counts = new Map<string, number>();
  for (const f of files) {
    const area = f.split('/').slice(0, 2).join('/');
    counts.set(area, (counts.get(area) ?? 0) + 1);
  }
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]![0];
  const breadth = files.length === 1 ? 'single' : files.length <= 3 ? 'small' : 'broad';
  return `${dominant}:${breadth}`;
}

/**
 * MAP-Elites elite selection: the best passing, no-regression, above-baseline variant PER niche,
 * top-k niches by score. Diverse by construction — one elite per behavior cell, not k clones of the
 * single global best. Drives diverse inspirations (the AlphaEvolve program-database, niche-aware).
 */
export function diverseElites(records: VariantRecord[], k: number, baselineScore?: number): VariantRecord[] {
  if (k <= 0) return [];
  const eligible = records.filter(
    (v) => v.passedAll && v.regressions.length === 0 && (baselineScore === undefined || v.score > baselineScore),
  );
  const bestPerNiche = new Map<string, VariantRecord>();
  for (const v of eligible) {
    const niche = v.behavior ?? 'unknown';
    const cur = bestPerNiche.get(niche);
    if (!cur || v.score > cur.score || (v.score === cur.score && v.createdAt > cur.createdAt)) {
      bestPerNiche.set(niche, v);
    }
  }
  return [...bestPerNiche.values()].sort((a, b) => b.score - a.score).slice(0, k);
}

export class CodeVariantStore {
  private readonly path: string;

  constructor(path?: string) {
    this.path = path ?? defaultStorePath();
  }

  getPath(): string {
    return this.path;
  }

  list(): VariantRecord[] {
    if (!existsSync(this.path)) return [];
    try {
      const data = JSON.parse(readFileSync(this.path, 'utf8'));
      return Array.isArray(data?.variants) ? (data.variants as VariantRecord[]) : [];
    } catch (err) {
      logger.warn(`[evolve] variant store unreadable: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }

  /** Append a variant record (best-effort, never throws). */
  record(rec: VariantRecord): void {
    try {
      const variants = this.list();
      variants.push(rec);
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(this.path, JSON.stringify({ schemaVersion: 1, variants }, null, 2));
    } catch (err) {
      logger.warn(`[evolve] variant store write failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * The winner: highest-scoring variant that passed everything, has no regression, and (if given)
   * strictly beats the baseline score. Ties broken by most recent. null if none qualify.
   */
  best(opts: BestOptions = {}): VariantRecord | null {
    const requirePassedAll = opts.requirePassedAll !== false;
    const rejectRegressions = opts.rejectRegressions !== false;
    const eligible = this.list().filter((v) => {
      if (requirePassedAll && !v.passedAll) return false;
      if (rejectRegressions && v.regressions.length > 0) return false;
      if (opts.baselineScore !== undefined && !(v.score > opts.baselineScore)) return false;
      return true;
    });
    if (eligible.length === 0) return null;
    return eligible.reduce((best, v) => {
      if (v.score > best.score) return v;
      if (v.score === best.score && v.createdAt > best.createdAt) return v;
      return best;
    });
  }
}
