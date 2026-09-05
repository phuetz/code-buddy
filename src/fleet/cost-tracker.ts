/**
 * Fleet — cost tracker (Fleet P8).
 *
 * Aggregates LLM cost across the fleet by peer × provider × day.
 * Provides hard budget caps that the dispatcher consults before
 * firing a saga.
 *
 * Storage: `~/.codebuddy/fleet-cost-ledger.json` — flat JSON file
 * (one entry per saga step charge) so it's easy to inspect and back
 * up. The ledger is append-only; aggregations are computed on read.
 *
 * @module fleet/cost-tracker
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { logger } from '../utils/logger.js';
import { readJsonAtomic, writeJsonAtomic } from '../utils/atomic-write.js';

export interface CostEntry {
  /** ISO timestamp. */
  at: string;
  /** Peer that ran the call. */
  peerId: string;
  /** Provider family — for aggregation by family. */
  provider: string;
  /** Model id. */
  model: string;
  /** USD cost — pre-computed by the caller from token usage × rates. */
  usd: number;
  /** Optional saga id this entry belongs to. */
  sagaId?: string;
  /** Optional dispatch / run id within the saga. */
  runId?: string;
  /** Token usage snapshot. Optional — kept for replay/debug. */
  tokensIn?: number;
  tokensOut?: number;
}

export interface CostBudget {
  /** Cap for total fleet spend per day. Default $5. */
  maxDailyUsd: number;
  /** Cap per-saga. Default $1. */
  maxSagaUsd: number;
}

export const DEFAULT_BUDGET: CostBudget = {
  maxDailyUsd: 5,
  maxSagaUsd: 1,
};

export interface CostSummary {
  /** Total spend today (UTC day boundary). */
  todayUsd: number;
  /** Spend grouped by provider for today. */
  todayByProvider: Record<string, number>;
  /** Spend grouped by peer for today. */
  todayByPeer: Record<string, number>;
  /** Last 7 days total. */
  weekUsd: number;
}

export interface BudgetCheck {
  ok: boolean;
  reason?: string;
  /** Remaining headroom in USD if ok=true. */
  remainingUsd?: number;
}

export interface BudgetDecision {
  allowed: boolean;
  reason?: string;
  /** Remaining headroom across the applicable daily and saga caps. */
  remainingUsd?: number;
}

export class CostTracker {
  private readonly file: string;
  private cached: CostEntry[] | null = null;

  constructor(options: { file?: string } = {}) {
    this.file = options.file ?? this.defaultFile();
    this.ensureDir();
  }

  /** Append a new charge to the ledger and refresh the cache. */
  async charge(entry: CostEntry): Promise<void> {
    if (!isCostEntry(entry)) {
      throw new Error('FLEET_COST_INVALID_ENTRY: refusing to persist an invalid charge');
    }
    const ledger = await this.load();
    ledger.push(entry);
    this.cached = ledger;
    await this.persist(ledger);
  }

  /** Read full ledger (cached after first call). */
  async load(): Promise<CostEntry[]> {
    if (this.cached) return this.cached;
    if (!fs.existsSync(this.file)) {
      this.cached = [];
      return this.cached;
    }
    const parsed = await readJsonAtomic<CostEntry[] | null>(this.file, null, {
      mode: 0o600,
      isValid: (value): value is CostEntry[] => Array.isArray(value) && value.every(isCostEntry),
    });
    if (!parsed) {
      throw new Error('FLEET_COST_LEDGER_UNAVAILABLE: ledger is empty, unreadable, or malformed');
    }
    this.cached = parsed;
    return this.cached;
  }

  /** Aggregate today's spend + 7-day total + per-provider/peer. */
  async summary(): Promise<CostSummary> {
    const ledger = await this.load();
    const now = Date.now();
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);
    const todayCutoff = startOfToday.getTime();
    const weekCutoff = now - 7 * 24 * 60 * 60 * 1000;

    const today = ledger.filter((e) => Date.parse(e.at) >= todayCutoff);
    const week = ledger.filter((e) => Date.parse(e.at) >= weekCutoff);

    const todayByProvider: Record<string, number> = {};
    const todayByPeer: Record<string, number> = {};
    for (const entry of today) {
      todayByProvider[entry.provider] =
        (todayByProvider[entry.provider] ?? 0) + entry.usd;
      todayByPeer[entry.peerId] = (todayByPeer[entry.peerId] ?? 0) + entry.usd;
    }
    const todayUsd = today.reduce((sum, e) => sum + e.usd, 0);
    const weekUsd = week.reduce((sum, e) => sum + e.usd, 0);

    return { todayUsd, todayByProvider, todayByPeer, weekUsd };
  }

  /**
   * Check whether a new dispatch costing `estimatedUsd` would breach
   * either cap. Pure function — does NOT charge.
   */
  async canSpend(
    estimatedUsd: number,
    sagaId: string | undefined,
    budget: CostBudget = DEFAULT_BUDGET,
  ): Promise<BudgetCheck> {
    if (!isNonNegativeFinite(estimatedUsd)) {
      return { ok: false, reason: 'Invalid estimated fleet cost' };
    }
    if (!isValidBudget(budget)) {
      return { ok: false, reason: 'Invalid fleet cost budget' };
    }
    const summary = await this.summary();
    if (summary.todayUsd + estimatedUsd > budget.maxDailyUsd) {
      return {
        ok: false,
        reason: `Daily cap reached: today ${summary.todayUsd.toFixed(2)}$ + ${estimatedUsd.toFixed(
          2,
        )}$ > cap ${budget.maxDailyUsd}$`,
      };
    }
    let sagaRemainingUsd = Number.POSITIVE_INFINITY;
    if (sagaId) {
      const ledger = await this.load();
      const sagaSpend = ledger
        .filter((e) => e.sagaId === sagaId)
        .reduce((s, e) => s + e.usd, 0);
      if (sagaSpend + estimatedUsd > budget.maxSagaUsd) {
        return {
          ok: false,
          reason: `Per-saga cap reached: saga ${sagaSpend.toFixed(
            2,
          )}$ + ${estimatedUsd.toFixed(2)}$ > cap ${budget.maxSagaUsd}$`,
        };
      }
      sagaRemainingUsd = budget.maxSagaUsd - sagaSpend - estimatedUsd;
    }
    return {
      ok: true,
      remainingUsd: Math.max(
        0,
        Math.min(
          budget.maxDailyUsd - summary.todayUsd - estimatedUsd,
          sagaRemainingUsd,
        ),
      ),
    };
  }

  /**
   * Incoming-call budget API. Keeps the historical `canSpend` method intact
   * while exposing the allow/deny vocabulary used by fleet bridges.
   */
  async isWithinBudget(
    estimatedUsd: number,
    budget: CostBudget = DEFAULT_BUDGET,
    sagaId?: string,
  ): Promise<BudgetDecision> {
    const check = await this.canSpend(estimatedUsd, sagaId, budget);
    return {
      allowed: check.ok,
      ...(check.reason ? { reason: check.reason } : {}),
      ...(check.remainingUsd !== undefined ? { remainingUsd: check.remainingUsd } : {}),
    };
  }

  /** Drop entries older than `retentionDays`. Defaults to 30 days. */
  async vacuum(retentionDays = 30): Promise<number> {
    const ledger = await this.load();
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const kept = ledger.filter((e) => Date.parse(e.at) >= cutoff);
    const dropped = ledger.length - kept.length;
    if (dropped > 0) {
      this.cached = kept;
      await this.persist(kept);
    }
    return dropped;
  }

  /** Test-only — resets cached + on-disk ledger. */
  async _resetForTests(): Promise<void> {
    this.cached = [];
    if (fs.existsSync(this.file)) {
      await fs.promises.unlink(this.file);
    }
  }

  // ─────── internals ───────

  private defaultFile(): string {
    // Bridge tests exercise the real budget gate. Keep those charges active
    // and persistent for the worker lifetime without polluting the developer's
    // real fleet ledger in ~/.codebuddy.
    if (process.env.NODE_ENV === 'test') {
      return path.join(os.tmpdir(), `codebuddy-fleet-cost-ledger-${process.pid}.json`);
    }
    const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
    return path.join(home, '.codebuddy', 'fleet-cost-ledger.json');
  }

  private ensureDir(): void {
    const dir = path.dirname(this.file);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private async persist(ledger: CostEntry[]): Promise<void> {
    await writeJsonAtomic(this.file, ledger, { mode: 0o600 });
  }
}

function isNonNegativeFinite(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function isValidBudget(value: CostBudget): boolean {
  return isNonNegativeFinite(value.maxDailyUsd) && isNonNegativeFinite(value.maxSagaUsd);
}

function isCostEntry(value: unknown): value is CostEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.at === 'string' &&
    Number.isFinite(Date.parse(entry.at)) &&
    typeof entry.peerId === 'string' &&
    typeof entry.provider === 'string' &&
    typeof entry.model === 'string' &&
    typeof entry.usd === 'number' &&
    isNonNegativeFinite(entry.usd) &&
    (entry.sagaId === undefined || typeof entry.sagaId === 'string') &&
    (entry.runId === undefined || typeof entry.runId === 'string') &&
    (entry.tokensIn === undefined ||
      (typeof entry.tokensIn === 'number' && isNonNegativeFinite(entry.tokensIn))) &&
    (entry.tokensOut === undefined ||
      (typeof entry.tokensOut === 'number' && isNonNegativeFinite(entry.tokensOut)))
  );
}

let cachedTracker: CostTracker | null = null;

export function getCostTracker(): CostTracker {
  if (!cachedTracker) cachedTracker = new CostTracker();
  return cachedTracker;
}

export function resetCostTracker(): void {
  cachedTracker = null;
}
