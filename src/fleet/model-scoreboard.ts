/**
 * Model Scoreboard — the learning layer for the multi-LLM council.
 *
 * Records, per (taskType × model), the outcome of each council run (won?,
 * optional role, judge quality 0-1, latency, cost) to an append-only JSONL
 * ledger under ~/.codebuddy/fleet-model-performance.jsonl (one record per
 * line — O(1) appends, and concurrent writers — CLI + voice loop + server —
 * interleave lines instead of overwriting each other). A legacy pretty-JSON
 * array ledger (the pre-v2 format) is migrated in place on first load.
 *
 * The council reads `selectionBias(taskType, model)` to bias model selection
 * toward the historically-best AI for that kind of task: it is Laplace-
 * smoothed and confidence-weighted so a model with 1 win in 1 run does NOT
 * outrank one with 9 wins in 10, and unseen models sit at a neutral 0 instead
 * of being locked out by early winners. `ranking(taskType)` shows what it has
 * learned (raw wins/runs, human-readable).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { logger } from '../utils/logger.js';
import { readJsonLinesAtomicSync, readTextAtomicSync, writeFileAtomicSync } from '../utils/atomic-write.js';
import {
  defaultTurnMetricsJournalPath,
  readTurnMetricsAggregates,
  type TurnMetricsAggregate,
} from '../observability/turn-metrics.js';
import type { TaskType } from '../council/task-types.js';

export interface OutcomeRecord {
  /** ISO timestamp of the run. */
  at: string;
  /** Inferred or supplied task category (e.g. 'code', 'reasoning', 'french'). */
  taskType: TaskType;
  /** Model id (e.g. 'gpt-5.5', 'grok-3'). */
  model: string;
  /** Provider id (e.g. 'chatgpt', 'grok'). */
  provider: string;
  /** Optional council role played by this answer (e.g. 'reviewer', 'verifier'). */
  role?: string;
  /** Did this model win the judge's vote this run? */
  won: boolean;
  /** Judge TASK-fit score for this answer, 0-1. */
  quality: number;
  /**
   * Judge ROLE-fit score, 0-1 — did the answer hold its council role? Feeds
   * `roleScore` so specialised roles (critic, verifier) are no longer punished
   * for doing their job instead of answering the task directly. Absent on
   * legacy records — `roleScore` falls back to `quality`.
   */
  roleQuality?: number;
  /** Wall-clock latency of this model's answer (ms). */
  latencyMs: number;
  /** Marginal cost of this answer in USD (0 for local / flat-fee). */
  costUsd: number;
  /**
   * True when the model FAILED to answer (timeout, 404, empty reply) rather
   * than losing on quality. Failed records count as losses in
   * `smoothedWinRate`/`runCount` (so `selectionBias` stops re-seating dead
   * models and ε-exploration stops treating them as unseen), but are EXCLUDED
   * from `winRate`/`ranking`/`print` — a 404 is not a quality defeat.
   */
  failed?: boolean;
}

export interface ModelStat {
  model: string;
  provider: string;
  runs: number;
  wins: number;
  /** wins / runs, 0 when never run. */
  winRate: number;
  avgQuality: number;
  avgLatencyMs: number;
  avgCostUsd: number;
}

export interface RoleModelStat {
  role: string;
  model: string;
  provider: string;
  runs: number;
  wins: number;
  winRate: number;
  avgQuality: number;
}

export interface MeasuredTurnLatency {
  latencyMs: number;
  samples: number;
  metric: 'ttfm-p50';
}

export interface ModelScoreboardOptions {
  turnMetricsJournalPath?: string;
}

export interface ScoreboardImportResult {
  imported: number;
  skippedDuplicates: number;
  rejected: number;
}

function defaultLedgerPath(): string {
  return path.join(os.homedir(), '.codebuddy', 'fleet-model-performance.jsonl');
}

/**
 * Conductor panels repeat roles on extra seats; historically those seats got
 * suffixed ids ('reviewer-4') that fragmented role history by panel position.
 * Normalising here also heals any such legacy records at query time.
 */
function normalizeRole(role: string): string {
  return role.replace(/-\d+$/, '');
}

/** Stable append/import identity required by the SCORE1 bench importer. */
export function outcomeKey(record: Pick<OutcomeRecord, 'at' | 'model' | 'taskType'>): string {
  return `${record.at}\u0000${record.model}\u0000${record.taskType}`;
}

export function isOutcomeRecord(value: unknown): value is OutcomeRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Partial<OutcomeRecord>;
  return Boolean(
    typeof record.at === 'string' && record.at.length > 0
      && typeof record.taskType === 'string' && record.taskType.length > 0
      && typeof record.model === 'string' && record.model.length > 0
      && typeof record.provider === 'string' && record.provider.length > 0
      && typeof record.won === 'boolean'
      && typeof record.quality === 'number' && Number.isFinite(record.quality)
      && record.quality >= 0 && record.quality <= 1
      && typeof record.latencyMs === 'number' && Number.isFinite(record.latencyMs)
      && record.latencyMs >= 0
      && typeof record.costUsd === 'number' && Number.isFinite(record.costUsd)
      && record.costUsd >= 0
      && (record.role === undefined || typeof record.role === 'string')
      && (record.roleQuality === undefined
        || (typeof record.roleQuality === 'number'
          && Number.isFinite(record.roleQuality)
          && record.roleQuality >= 0
          && record.roleQuality <= 1))
      && (record.failed === undefined || typeof record.failed === 'boolean'),
  );
}

/** History weight saturation: with K=5, 5 runs ≈ half-trust, 20 runs ≈ 0.8. */
const HISTORY_WEIGHT_K = 5;

export class ModelScoreboard {
  private records: OutcomeRecord[] = [];
  private cachedMtimeMs = -1;
  private readonly file: string;
  private readonly turnMetricsJournalPath: string;
  private turnMetricsMtimeMs = -1;
  private turnMetricsAggregates: TurnMetricsAggregate[] = [];

  constructor(
    file: string = defaultLedgerPath(),
    options: ModelScoreboardOptions = {},
  ) {
    this.file = file;
    this.turnMetricsJournalPath = options.turnMetricsJournalPath ?? defaultTurnMetricsJournalPath();
    this.load();
  }

  /** The pre-v2 array ledger sits next to the JSONL one, `.jsonl` → `.json`. */
  private legacyFile(): string | null {
    return this.file.endsWith('.jsonl') ? this.file.slice(0, -1) : null;
  }

  private statMtimeMs(): number {
    try {
      return fs.statSync(this.file).mtimeMs;
    } catch {
      return -1;
    }
  }

  private measuredTurnAggregates(): TurnMetricsAggregate[] {
    let mtimeMs = -1;
    try {
      mtimeMs = fs.statSync(this.turnMetricsJournalPath).mtimeMs;
    } catch {
      // A missing journal is the normal cold-start state.
    }
    if (mtimeMs !== this.turnMetricsMtimeMs) {
      this.turnMetricsAggregates = readTurnMetricsAggregates(this.turnMetricsJournalPath);
      this.turnMetricsMtimeMs = mtimeMs;
    }
    return this.turnMetricsAggregates;
  }

  /**
   * Precise streamed-turn latency for routing. TTFM p50 is used only after
   * enough complete messages exist; failed/no-message turns cannot create a
   * deceptively fast routing signal.
   */
  measuredTurnLatency(
    provider: string,
    model: string,
    minimumSamples = 3,
  ): MeasuredTurnLatency | null {
    const wantedProvider = provider.toLowerCase();
    const wantedModel = model.toLowerCase();
    const aggregate = this.measuredTurnAggregates().find(
      (item) =>
        item.provider.toLowerCase() === wantedProvider
        && item.model.toLowerCase() === wantedModel,
    );
    if (
      !aggregate
      || aggregate.ttfmSamples < minimumSamples
      || aggregate.ttfmP50Ms === undefined
    ) {
      return null;
    }
    return {
      latencyMs: aggregate.ttfmP50Ms,
      samples: aggregate.ttfmSamples,
      metric: 'ttfm-p50',
    };
  }

  /** Pick up records appended by OTHER processes since our last read. */
  private maybeReload(): void {
    const mtime = this.statMtimeMs();
    if (mtime !== this.cachedMtimeMs) this.load();
  }

  private load(): void {
    try {
      let raw = '';
      let sourcePath = this.file;
      if (fs.existsSync(this.file)) {
        raw = readTextAtomicSync(this.file, '').trim();
      } else {
        const legacy = this.legacyFile();
        if (legacy && fs.existsSync(legacy)) {
          sourcePath = legacy;
          raw = readTextAtomicSync(legacy, '').trim();
        }
      }
      if (!raw) {
        this.records = [];
        this.cachedMtimeMs = this.statMtimeMs();
        return;
      }
      if (raw.startsWith('[')) {
        // Legacy pretty-JSON array (or a legacy .json ledger) — migrate to JSONL.
        const parsed = JSON.parse(raw);
        this.records = Array.isArray(parsed) ? (parsed as OutcomeRecord[]) : [];
        this.rewriteAsJsonl();
      } else {
      this.records = readJsonLinesAtomicSync<OutcomeRecord>(sourcePath, [], isOutcomeRecord);
      }
      this.cachedMtimeMs = this.statMtimeMs();
    } catch (err) {
      logger.warn?.('[model-scoreboard] could not read ledger, starting empty', {
        err: err instanceof Error ? err.message : String(err),
      });
      this.records = [];
    }
  }

  private rewriteAsJsonl(): void {
    try {
      writeFileAtomicSync(
        this.file,
        this.records.map((r) => JSON.stringify(r)).join('\n') + (this.records.length ? '\n' : ''),
        { mode: 0o600 },
      );
      this.cachedMtimeMs = this.statMtimeMs();
    } catch (err) {
      logger.warn?.('[model-scoreboard] could not migrate ledger to JSONL', {
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Append one model's outcome for a run and persist (O(1), concurrent-safe append). */
  recordOutcome(rec: OutcomeRecord): void {
    const normalized: OutcomeRecord = rec.role ? { ...rec, role: normalizeRole(rec.role) } : rec;
    this.maybeReload();
    this.records.push(normalized);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.appendFileSync(this.file, JSON.stringify(normalized) + '\n', { encoding: 'utf8', mode: 0o600 });
      this.cachedMtimeMs = this.statMtimeMs();
    } catch (err) {
      logger.warn?.('[model-scoreboard] could not write ledger', {
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Append validated records while ignoring an already-known
   * `(at, model, taskType)` identity. Existing council writes remain untouched;
   * this stricter path is used by external benchmark imports.
   */
  importRecords(records: readonly OutcomeRecord[]): ScoreboardImportResult {
    this.maybeReload();
    const known = new Set(this.records.map(outcomeKey));
    const pending: OutcomeRecord[] = [];
    let skippedDuplicates = 0;

    for (const record of records) {
      const normalized = record.role ? { ...record, role: normalizeRole(record.role) } : record;
      const key = outcomeKey(normalized);
      if (known.has(key)) {
        skippedDuplicates++;
        continue;
      }
      known.add(key);
      pending.push(normalized);
    }

    if (pending.length === 0) {
      return { imported: 0, skippedDuplicates, rejected: 0 };
    }

    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.appendFileSync(
        this.file,
        pending.map((record) => JSON.stringify(record)).join('\n') + '\n',
        { encoding: 'utf8', mode: 0o600 },
      );
      this.records.push(...pending);
      this.cachedMtimeMs = this.statMtimeMs();
      return { imported: pending.length, skippedDuplicates, rejected: 0 };
    } catch (err) {
      logger.warn?.('[model-scoreboard] could not import ledger records', {
        err: err instanceof Error ? err.message : String(err),
      });
      return { imported: 0, skippedDuplicates, rejected: 0 };
    }
  }

  /** Read a JSONL benchmark file and append only valid, unseen records. */
  importJsonl(sourceFile: string): ScoreboardImportResult {
    if (!fs.existsSync(sourceFile)) {
      throw new Error(`Benchmark file not found: ${sourceFile}`);
    }
    const raw = fs.readFileSync(sourceFile, 'utf8');
    const records: OutcomeRecord[] = [];
    let rejected = 0;
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const parsed: unknown = JSON.parse(line);
        if (!isOutcomeRecord(parsed)) {
          rejected++;
          continue;
        }
        records.push(parsed);
      } catch {
        rejected++;
      }
    }
    const result = this.importRecords(records);
    return { ...result, rejected };
  }

  /** Best measured model for a task, optionally restricted to active models. */
  best(taskType: string, candidates?: readonly string[]): ModelStat | null {
    const allowed = candidates ? new Set(candidates) : null;
    return this.ranking(taskType).find((stat) => !allowed || allowed.has(stat.model)) ?? null;
  }

  private runsFor(taskType: string, model: string): OutcomeRecord[] {
    this.maybeReload();
    return this.records.filter((r) => r.taskType === taskType && r.model === model);
  }

  /** Raw historical win rate (0-1) of a model for a task type. 0 when never seen. Display only. */
  winRate(taskType: string, model: string): number {
    const runs = this.runsFor(taskType, model).filter((r) => !r.failed);
    if (runs.length === 0) return 0;
    const wins = runs.filter((r) => r.won).length;
    return wins / runs.length;
  }

  /** How many council runs this (taskType × model) has been observed in. */
  runCount(taskType: string, model: string): number {
    return this.runsFor(taskType, model).length;
  }

  /** Laplace-smoothed win rate: (wins + 1) / (runs + 2). 0.5 when never seen. */
  smoothedWinRate(taskType: string, model: string): number {
    const runs = this.runsFor(taskType, model);
    const wins = runs.filter((r) => r.won).length;
    return (wins + 1) / (runs.length + 2);
  }

  /** How much to trust this model's history: runs / (runs + K). 0 when never seen. */
  historyWeight(taskType: string, model: string): number {
    const runs = this.runCount(taskType, model);
    return runs / (runs + HISTORY_WEIGHT_K);
  }

  /**
   * Selection bias for routing, in [-1, 1]: smoothed win rate re-centred on 0
   * and weighted by history confidence. Unseen models sit at 0 (neutral); a
   * 1/1 model gets a small nudge (~+0.06), a 9/10 one a strong one (~+0.44),
   * and consistent losers go negative. Replaces the raw `(1 + winRate)`
   * multiplier that locked in the first-ever winner.
   */
  selectionBias(taskType: string, model: string): number {
    const centred = (this.smoothedWinRate(taskType, model) - 0.5) * 2;
    const bias = centred * this.historyWeight(taskType, model);
    return Math.max(-1, Math.min(1, bias));
  }

  /**
   * Historical role-specific score for assigning future council roles. 0 when
   * never seen. Weighted toward the judge's ROLE-fit quality (not the task
   * win): a critic that consistently holds its role must rank high for the
   * critic seat even though critics rarely win the task vote — the old
   * win-rate-dominant formula was training role erosion.
   */
  roleScore(taskType: string, role: string, model: string): number {
    const wanted = normalizeRole(role);
    this.maybeReload();
    const runs = this.records.filter(
      (r) =>
        !r.failed && r.taskType === taskType && r.role !== undefined && normalizeRole(r.role) === wanted && r.model === model,
    );
    if (runs.length === 0) return 0;
    const wins = runs.filter((r) => r.won).length;
    const winRate = wins / runs.length;
    const avgRoleQuality = runs.reduce((acc, r) => acc + (r.roleQuality ?? r.quality), 0) / runs.length;
    return 0.7 * avgRoleQuality + 0.3 * winRate;
  }

  /**
   * Trailing consecutive failures for a model ACROSS task types (most recent
   * records first). Used to exclude dead models from the judge seat — a
   * retired catalog model kept being re-picked as judge, aborting every
   * deliberation, because failure penalties only applied to panel seats.
   */
  consecutiveRecentFailures(model: string): number {
    this.maybeReload();
    let count = 0;
    for (let i = this.records.length - 1; i >= 0; i--) {
      const r = this.records[i]!;
      if (r.model !== model) continue;
      if (!r.failed) break;
      count++;
    }
    return count;
  }

  roleRanking(taskType?: string, role?: string): RoleModelStat[] {
    this.maybeReload();
    const wanted = role ? normalizeRole(role) : undefined;
    const scoped = this.records.filter((r) =>
      !r.failed &&
      Boolean(r.role) &&
      (!taskType || r.taskType === taskType) &&
      (!wanted || normalizeRole(r.role!) === wanted),
    );
    const byRoleModel = new Map<string, OutcomeRecord[]>();
    for (const r of scoped) {
      const key = `${normalizeRole(r.role!)} ${r.model}`;
      const arr = byRoleModel.get(key) ?? [];
      arr.push(r);
      byRoleModel.set(key, arr);
    }

    const stats: RoleModelStat[] = [];
    for (const runs of byRoleModel.values()) {
      const first = runs[0]!;
      const wins = runs.filter((r) => r.won).length;
      const n = runs.length;
      stats.push({
        role: normalizeRole(first.role!),
        model: first.model,
        provider: first.provider,
        runs: n,
        wins,
        winRate: wins / n,
        avgQuality: runs.reduce((acc, r) => acc + r.quality, 0) / n,
      });
    }
    return stats.sort(
      (a, b) => a.role.localeCompare(b.role) || b.winRate - a.winRate || b.avgQuality - a.avgQuality,
    );
  }

  /**
   * Per-model aggregate stats, optionally scoped to one task type, sorted by
   * win rate desc then avg quality desc.
   */
  ranking(taskType?: string): ModelStat[] {
    this.maybeReload();
    const scoped = (taskType
      ? this.records.filter((r) => r.taskType === taskType)
      : this.records
    ).filter((r) => !r.failed);
    const byModel = new Map<string, OutcomeRecord[]>();
    for (const r of scoped) {
      const arr = byModel.get(r.model) ?? [];
      arr.push(r);
      byModel.set(r.model, arr);
    }
    const stats: ModelStat[] = [];
    for (const [model, runs] of byModel) {
      const wins = runs.filter((r) => r.won).length;
      const n = runs.length;
      stats.push({
        model,
        provider: runs[0]!.provider,
        runs: n,
        wins,
        winRate: wins / n,
        avgQuality: runs.reduce((a, r) => a + r.quality, 0) / n,
        avgLatencyMs: runs.reduce((a, r) => a + r.latencyMs, 0) / n,
        avgCostUsd: runs.reduce((a, r) => a + r.costUsd, 0) / n,
      });
    }
    return stats.sort(
      (a, b) => b.winRate - a.winRate || b.avgQuality - a.avgQuality,
    );
  }

  /** Human-readable learned ranking, for `buddy council --scoreboard`. */
  print(taskType?: string): string {
    const rows = this.ranking(taskType);
    if (rows.length === 0) {
      return taskType
        ? `No council history yet for task type "${taskType}".`
        : 'No council history yet. Run `buddy council "<task>"` a few times.';
    }
    const header = taskType
      ? `Learned model ranking for "${taskType}" tasks:`
      : 'Learned model ranking (all task types):';
    const lines = rows.map((s, i) => {
      const wr = `${Math.round(s.winRate * 100)}%`;
      const q = s.avgQuality.toFixed(2);
      const lat = `${Math.round(s.avgLatencyMs)}ms`;
      const cost = s.avgCostUsd === 0 ? '$0' : `$${s.avgCostUsd.toFixed(4)}`;
      return `  ${i + 1}. ${s.model.padEnd(22)} win ${wr.padStart(4)} (${s.wins}/${s.runs})  q${q}  ${lat}  ${cost}`;
    });
    const roleRows = this.roleRanking(taskType);
    if (roleRows.length === 0) return [header, ...lines].join('\n');

    const bestByRole = new Map<string, RoleModelStat>();
    for (const row of roleRows) {
      if (!bestByRole.has(row.role)) bestByRole.set(row.role, row);
    }
    const roleLines = Array.from(bestByRole.values()).map((s) => {
      const wr = `${Math.round(s.winRate * 100)}%`;
      return `  ${s.role.padEnd(14)} ${s.model.padEnd(22)} win ${wr.padStart(4)} (${s.wins}/${s.runs})  q${s.avgQuality.toFixed(2)}`;
    });
    return [header, ...lines, '', 'Role specialists:', ...roleLines].join('\n');
  }
}

let singleton: ModelScoreboard | null = null;

export function getModelScoreboard(): ModelScoreboard {
  if (!singleton) singleton = new ModelScoreboard();
  return singleton;
}

/** Test seam — reset the cached singleton. */
export function resetModelScoreboard(): void {
  singleton = null;
}
