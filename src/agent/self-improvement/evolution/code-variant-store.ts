/**
 * Code variant store (Phase B): an append-only record of EVALUATED candidate variants (git branch
 * + sha + fitness + regressions). Mirrors the LearningStore/EvolutionaryArchive pattern, but for
 * whole-agent CODE variants. It records and ranks; it NEVER merges or checks out — keep/merge is
 * human-gated (Phase E). `best()` is the "la version qui marche mieux" selector.
 *
 * @module agent/self-improvement/evolution/code-variant-store
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { logger } from '../../../utils/logger.js';
import { readJsonAtomicSync, writeJsonAtomicSync } from '../../../utils/atomic-write.js';

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
  /**
   * The mutation plan that produced this version: the exact instruction the mutator followed
   * (goal + the prior elite approaches it was told to build on / diverge from). Stored so a
   * generation is auditable — you can see WHY/HOW it came to be, not just its score.
   */
  plan?: string;
  /** MAP-Elites niche descriptor (which area + how broad a change) — for diversity. */
  behavior?: string;
  /**
   * Genealogy (recursive self-improvement lineage): ids of the prior elite variants that inspired
   * this one (the AlphaEvolve program-database seed shown to the mutator). Empty/absent = derived
   * from the baseline alone. Optional for backward-compat with pre-genealogy records.
   */
  parents?: string[];
  /** Generation depth: 0 for a direct child of the baseline, else 1 + max(parent generation). */
  generation?: number;
  /** Number of offspring selected from this variant as a parent. Persisted for the penalty. */
  childrenCount?: number;
}

export interface VariantStoreStats {
  evaluationsAvoided: number;
}

interface VariantStoreData {
  variants?: VariantRecord[];
  stats?: Partial<VariantStoreStats>;
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

/** Generation of a record (0 if unset — pre-genealogy or baseline child). */
export function variantGeneration(v: VariantRecord): number {
  return typeof v.generation === 'number' && v.generation >= 0 ? v.generation : 0;
}

/** Compute a new variant's generation from its parents: 1 + max(parent generation), else 0. */
export function computeGeneration(parents: string[], records: VariantRecord[]): number {
  if (parents.length === 0) return 0;
  const byId = new Map(records.map((r) => [r.id, r]));
  let maxParent = -1;
  for (const p of parents) {
    const rec = byId.get(p);
    if (rec) maxParent = Math.max(maxParent, variantGeneration(rec));
  }
  return maxParent + 1;
}

/** Direct children of a variant (records that list `id` among their parents). */
export function childrenOf(records: readonly VariantRecord[], id: string): VariantRecord[] {
  return records.filter((r) => (r.parents ?? []).includes(id));
}

function persistedChildrenCount(record: VariantRecord, records: readonly VariantRecord[]): number {
  const declared = Number.isFinite(record.childrenCount) ? Math.max(0, Math.floor(record.childrenCount!)) : 0;
  return Math.max(declared, childrenOf(records, record.id).length);
}

/**
 * Weighted parent selection for the DGM offspring penalty. Only complete, no-regression variants
 * enter the draw. The random source is injectable so a rotation can be tested without flakiness.
 */
export function selectParentWithPenalty(
  records: readonly VariantRecord[],
  lambda = 0.5,
  random: () => number = Math.random,
): VariantRecord | null {
  const eligible = records.filter((record) => record.passedAll && record.regressions.length === 0);
  if (eligible.length === 0) return null;

  const penalty = Number.isFinite(lambda) && lambda >= 0 ? lambda : 0.5;
  const weighted = eligible.map((record) => ({
    record,
    weight: Math.max(0, record.score) * Math.exp(-penalty * persistedChildrenCount(record, records)),
  }));
  const total = weighted.reduce((sum, item) => sum + item.weight, 0);
  if (!(total > 0)) return null;

  const draw = Number(random());
  const threshold = (Number.isFinite(draw) ? Math.max(0, draw) : 0) * total;
  let cumulative = 0;
  for (const item of weighted) {
    cumulative += item.weight;
    if (threshold < cumulative) return item.record;
  }
  return weighted[weighted.length - 1]!.record;
}

/**
 * Genealogy rows for display (CLI tree + GUI): every record with its generation, ordered by
 * generation ascending then score descending. A flat, DAG-safe projection (a variant can have
 * several inspiring parents, so we band by generation rather than force a single-parent tree).
 */
export function genealogyRows(records: VariantRecord[]): Array<{ record: VariantRecord; generation: number }> {
  return records
    .map((record) => ({ record, generation: variantGeneration(record) }))
    .sort((a, b) => a.generation - b.generation || b.record.score - a.record.score);
}

export class CodeVariantStore {
  private readonly path: string;

  constructor(path?: string) {
    this.path = path ?? defaultStorePath();
  }

  getPath(): string {
    return this.path;
  }

  private readData(): VariantStoreData {
    if (!existsSync(this.path)) return { variants: [] };
    try {
      const data = readJsonAtomicSync<VariantStoreData>(this.path, {}, { mode: 0o600 });
      return {
        variants: Array.isArray(data?.variants) ? data.variants : [],
        stats: data?.stats,
      };
    } catch (err) {
      logger.warn(`[evolve] variant store unreadable: ${err instanceof Error ? err.message : String(err)}`);
      return { variants: [] };
    }
  }

  private writeData(variants: VariantRecord[], stats: VariantStoreStats): void {
    writeJsonAtomicSync(this.path, { schemaVersion: 1, variants, stats }, { mode: 0o600 });
  }

  list(): VariantRecord[] {
    return this.readData().variants ?? [];
  }

  getEvaluationStats(): VariantStoreStats {
    const stats = this.readData().stats;
    return {
      evaluationsAvoided:
        Number.isFinite(stats?.evaluationsAvoided) && (stats?.evaluationsAvoided ?? 0) >= 0
          ? Math.floor(stats!.evaluationsAvoided!)
          : 0,
    };
  }

  /** Persist one or more candidates rejected before the expensive fitness evaluation. */
  recordEvaluationAvoided(count = 1): void {
    const increment = Math.max(0, Math.floor(count));
    if (increment === 0) return;
    try {
      const data = this.readData();
      const current = this.getEvaluationStats().evaluationsAvoided;
      this.writeData(data.variants ?? [], { evaluationsAvoided: current + increment });
    } catch (err) {
      logger.warn(`[evolve] variant store evaluation counter write failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Append a variant record (best-effort, never throws). */
  record(rec: VariantRecord): void {
    try {
      const data = this.readData();
      const variants = data.variants ?? [];
      const parentIds = new Set(rec.parents ?? []);
      const updated = variants.map((variant) =>
        parentIds.has(variant.id)
          ? { ...variant, childrenCount: persistedChildrenCount(variant, variants) + 1 }
          : variant,
      );
      updated.push({ ...rec, childrenCount: persistedChildrenCount(rec, variants) });
      this.writeData(updated, {
        evaluationsAvoided: this.getEvaluationStats().evaluationsAvoided,
      });
    } catch (err) {
      logger.warn(`[evolve] variant store write failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Select and persist one parent-use count for callers that do not append a child record yet. */
  selectParentWithPenalty(lambda = 0.5, random: () => number = Math.random): VariantRecord | null {
    try {
      const data = this.readData();
      const variants = data.variants ?? [];
      const selected = selectParentWithPenalty(variants, lambda, random);
      if (!selected) return null;
      const updated = variants.map((variant) =>
        variant.id === selected.id
          ? { ...variant, childrenCount: persistedChildrenCount(variant, variants) + 1 }
          : variant,
      );
      this.writeData(updated, { evaluationsAvoided: this.getEvaluationStats().evaluationsAvoided });
      return updated.find((variant) => variant.id === selected.id) ?? null;
    } catch (err) {
      logger.warn(`[evolve] parent selection failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
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
