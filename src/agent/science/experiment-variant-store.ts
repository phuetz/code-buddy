/**
 * AI-Scientist-lite — Phase 1: the experiment variant store.
 *
 * A genuinely APPEND-ONLY record of SCORED experiment variants (JSONL — one
 * variant per line, appended with O_APPEND), calqued on
 * `CodeVariantStore`/`EvolutionaryArchive` but DECOUPLED from the repo: a record
 * carries the experiment's hypothesis + code + execution summary + measured
 * metric + fitness + lineage (`parentId`), NOT a git branch/sha of Code Buddy.
 *
 * JSONL append (like the CKG ledger) is why two `buddy science` runs in the same
 * cwd no longer clobber each other: `record()` appends a single line instead of
 * rewriting the whole file, so a concurrent writer can't erase another's variant
 * (the old full read-modify-write was last-writer-wins). A legacy single-object
 * store (`{schemaVersion,variants:[…]}`) is still read back and is migrated to
 * JSONL on the next append.
 *
 * It records and reads back; it NEVER "publishes" a variant. `kept` flips to true
 * ONLY after the human keep-gate approves (Phase 1 §4) — a rejected/ungated
 * variant stays archived (auditable) but is never marked kept. Timestamps are
 * INJECTED by the caller (no `Date.now()` here). never-throws.
 *
 * @module agent/science/experiment-variant-store
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { logger } from '../../utils/logger.js';
import { writeFileAtomicSync } from '../../utils/atomic-write.js';
import type { ExecuteCodeLanguage } from '../../tools/execute-code-runner.js';

/** A compact, faithful summary of an execution (not the full multi-KB blob). */
export interface ExperimentExecutionSummary {
  ok: boolean;
  exitCode: number | null;
  timedOut: boolean;
  runId: string;
  /** The experiment folder the run happened in (the sandbox run dir). */
  runDir: string;
  durationMs: number;
}

/** The measured metric a variant was scored on. */
export interface ExperimentVariantMetric {
  name: string;
  /** Raw measured value (null when the metric could not be parsed). */
  value: number | null;
  /** Normalised metric score in [0,1]. */
  score: number;
  detail: string;
}

export interface ExperimentVariantRecord {
  id: string;
  /** The hypothesis this variant tested. */
  hypothesis: string;
  /** The experiment program that was run. */
  code: string;
  language: ExecuteCodeLanguage;
  /** Compact execution outcome (the experiment folder + exit status). */
  executionResult: ExperimentExecutionSummary;
  /** The measured metric the variant was scored on. */
  metric: ExperimentVariantMetric;
  /** Aggregate fitness in [0,1] (from `computeFitness`). */
  score: number;
  passedAll: boolean;
  /** Component names that regressed vs the experiment baseline (empty = none). */
  regressions: string[];
  /** Genealogy: the parent variant this one was derived from (absent = root). */
  parentId?: string;
  /** True ONLY after the human keep-gate approved. Never set implicitly. */
  kept: boolean;
  /** Injected ISO-8601 timestamp (the store never calls Date.now()). */
  createdAt: string;
  detail?: string;
}

export interface ExperimentBestOptions {
  /** Only consider variants strictly above this score (e.g. a baseline). */
  baselineScore?: number;
  /** Require passedAll (default true). */
  requirePassedAll?: boolean;
  /** Reject variants with any regression (default true). */
  rejectRegressions?: boolean;
  /** Require the human keep-gate to have approved (default false). */
  requireKept?: boolean;
}

/** The legacy single-object store format, still read back for backward-compat. */
interface StoreFile {
  schemaVersion: number;
  variants: ExperimentVariantRecord[];
}

function defaultStorePath(): string {
  return join(process.cwd(), '.codebuddy', 'science', 'experiment-variants.json');
}

/**
 * Append-only JSONL store for scored experiment variants. Mirrors
 * `CodeVariantStore`: `record()` appends ONE line, `list()`/`get()` read back,
 * `best()` selects. never-throws. Concurrent-safe (O_APPEND, no full rewrite).
 */
export class ExperimentVariantStore {
  private readonly path: string;

  constructor(path?: string) {
    this.path = path ?? defaultStorePath();
  }

  getPath(): string {
    return this.path;
  }

  list(): ExperimentVariantRecord[] {
    if (!existsSync(this.path)) return [];
    let raw: string;
    try {
      raw = readFileSync(this.path, 'utf8');
    } catch (err) {
      logger.warn(`[science] experiment variant store unreadable: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
    const trimmed = raw.trim();
    if (!trimmed) return [];
    // Backward-compat: an older single-object store `{schemaVersion,variants:[…]}`.
    if (trimmed.startsWith('{') && trimmed.includes('"variants"')) {
      try {
        const data = JSON.parse(trimmed) as Partial<StoreFile>;
        if (Array.isArray(data?.variants)) return data.variants as ExperimentVariantRecord[];
      } catch {
        // Not parseable as a legacy object — fall through to best-effort JSONL.
      }
    }
    // JSONL: one variant per line. A torn/corrupt line is skipped (never-throws)
    // rather than nuking the whole store.
    const out: ExperimentVariantRecord[] = [];
    for (const line of trimmed.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try {
        out.push(JSON.parse(t) as ExperimentVariantRecord);
      } catch {
        /* skip a corrupt line */
      }
    }
    return out;
  }

  get(id: string): ExperimentVariantRecord | null {
    return this.list().find((v) => v.id === id) ?? null;
  }

  /**
   * Append a variant record as one JSONL line (best-effort, never throws). This
   * is a true append (O_APPEND), so concurrent `buddy science` runs in the same
   * cwd cannot clobber each other's variants.
   */
  record(rec: ExperimentVariantRecord): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      // One-time migration of a legacy single-object store to JSONL, so the
      // append below does not strand the pre-existing variants.
      this.migrateLegacyIfNeeded();
      appendFileSync(this.path, `${JSON.stringify(rec)}\n`);
    } catch (err) {
      logger.warn(`[science] experiment variant store write failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * If the store is still in the legacy `{schemaVersion,variants:[…]}` format,
   * rewrite it as JSONL ONCE so subsequent appends stay pure appends. A
   * non-parseable legacy blob is left untouched (never-throws; `list()` still
   * best-effort-parses lines). Called only from `record()`.
   */
  private migrateLegacyIfNeeded(): void {
    if (!existsSync(this.path)) return;
    const trimmed = readFileSync(this.path, 'utf8').trim();
    if (!(trimmed.startsWith('{') && trimmed.includes('"variants"'))) return;
    try {
      const data = JSON.parse(trimmed) as Partial<StoreFile>;
      const variants = Array.isArray(data?.variants) ? (data.variants as ExperimentVariantRecord[]) : [];
      writeFileAtomicSync(this.path, variants.map((v) => JSON.stringify(v)).join('\n') + (variants.length ? '\n' : ''));
    } catch {
      /* leave a non-parseable legacy file as-is */
    }
  }

  /**
   * The winner: highest-scoring variant that passed everything, has no
   * regression, and (if given) strictly beats the baseline score. Ties broken by
   * most recent. null if none qualify.
   */
  best(opts: ExperimentBestOptions = {}): ExperimentVariantRecord | null {
    const requirePassedAll = opts.requirePassedAll !== false;
    const rejectRegressions = opts.rejectRegressions !== false;
    const eligible = this.list().filter((v) => {
      if (requirePassedAll && !v.passedAll) return false;
      if (rejectRegressions && v.regressions.length > 0) return false;
      if (opts.requireKept && !v.kept) return false;
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
