/**
 * CostBridge — Claude Cowork parity Phase 2
 *
 * Wraps Code Buddy's CostTracker so the Cowork Cost Dashboard can render
 * cumulative spend, daily trends, and per-model breakdown. Also tracks
 * a local history in SQLite for richer time-series queries independent
 * of the CostTracker's in-memory state.
 *
 * @module main/cost/cost-bridge
 */

import { log, logWarn } from '../utils/logger';
import { loadCoreModule } from '../utils/core-loader';
import type { DatabaseInstance } from '../db/database';

export interface TokenUsageEntry {
  inputTokens: number;
  outputTokens: number;
  model: string;
  cost: number;
  timestamp: number;
}

export interface CostSummary {
  sessionCost: number;
  dailyCost: number;
  weeklyCost: number;
  monthlyCost: number;
  totalCost: number;
  sessionTokens: { input: number; output: number };
  modelBreakdown: Record<string, { cost: number; calls: number }>;
  budgetLimit?: number;
  dailyLimit?: number;
}

export interface DailyCostPoint {
  date: string; // YYYY-MM-DD
  cost: number;
  inputTokens: number;
  outputTokens: number;
  calls: number;
}

export interface ModelBreakdownEntry {
  model: string;
  cost: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

type CoreCostTrackerModule = {
  getCostTracker: (config?: Record<string, unknown>) => {
    recordUsage: (inputTokens: number, outputTokens: number, model: string) => TokenUsageEntry;
    getReport: () => {
      sessionCost: number;
      dailyCost: number;
      weeklyCost: number;
      monthlyCost: number;
      totalCost: number;
      sessionTokens: { input: number; output: number };
      modelBreakdown: Record<string, { cost: number; calls: number }>;
      recentUsage: Array<{
        inputTokens: number;
        outputTokens: number;
        model: string;
        cost: number;
        timestamp: Date;
      }>;
      budgetLimit?: number;
      dailyLimit?: number;
    };
    setBudgetLimit: (limit: number) => void;
    setDailyLimit: (limit: number) => void;
  };
};

let cachedModule: CoreCostTrackerModule | null = null;

async function loadModule(): Promise<CoreCostTrackerModule | null> {
  if (cachedModule) return cachedModule;
  const mod = await loadCoreModule<CoreCostTrackerModule>('utils/cost-tracker.js');
  if (mod) {
    cachedModule = mod;
    log('[CostBridge] Core cost tracker loaded');
  } else {
    logWarn('[CostBridge] Core cost tracker unavailable');
  }
  return mod;
}

/**
 * Create the cost_history table + indices by running individual DDL
 * statements. We split them out so the migration is tolerant of older
 * SQLite bindings that don't expose a multi-statement `exec`.
 */
function ensureCostHistorySchema(database: {
  prepare: (sql: string) => { run: (...params: unknown[]) => unknown };
}): void {
  const statements = [
    `CREATE TABLE IF NOT EXISTS cost_history (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       model TEXT NOT NULL,
       input_tokens INTEGER NOT NULL DEFAULT 0,
       output_tokens INTEGER NOT NULL DEFAULT 0,
       cost REAL NOT NULL DEFAULT 0,
       timestamp INTEGER NOT NULL
     )`,
    `CREATE INDEX IF NOT EXISTS idx_cost_history_timestamp ON cost_history(timestamp)`,
    `CREATE INDEX IF NOT EXISTS idx_cost_history_model ON cost_history(model)`,
  ];
  for (const sql of statements) {
    try {
      database.prepare(sql).run();
    } catch (err) {
      logWarn('[CostBridge] schema statement failed:', err);
    }
  }
}

export class CostBridge {
  constructor(private readonly db: DatabaseInstance) {
    try {
      ensureCostHistorySchema(
        this.db.raw as unknown as {
          prepare: (sql: string) => { run: (...params: unknown[]) => unknown };
        }
      );
    } catch (err) {
      logWarn('[CostBridge] schema init failed:', err);
    }
  }

  /** Record a usage event and persist it to both CostTracker + local DB. */
  async record(
    inputTokens: number,
    outputTokens: number,
    model: string,
    cost?: number
  ): Promise<void> {
    try {
      const database = this.db.raw;
      let finalCost = cost;
      if (finalCost === undefined) {
        const mod = await loadModule();
        if (mod) {
          const tracker = mod.getCostTracker();
          const entry = tracker.recordUsage(inputTokens, outputTokens, model);
          finalCost = entry.cost;
        } else {
          finalCost = 0;
        }
      } else {
        const mod = await loadModule();
        if (mod) {
          mod.getCostTracker().recordUsage(inputTokens, outputTokens, model);
        }
      }
      const stmt = database.prepare(
        `INSERT INTO cost_history (model, input_tokens, output_tokens, cost, timestamp)
         VALUES (?, ?, ?, ?, ?)`
      );
      stmt.run(model, inputTokens, outputTokens, finalCost, Date.now());
    } catch (err) {
      logWarn('[CostBridge] record failed:', err);
    }
  }

  /** Current cumulative cost summary for header badges / quick widgets. */
  async getSummary(): Promise<CostSummary> {
    const mod = await loadModule();
    if (!mod) {
      return {
        sessionCost: 0,
        dailyCost: 0,
        weeklyCost: 0,
        monthlyCost: 0,
        totalCost: 0,
        sessionTokens: { input: 0, output: 0 },
        modelBreakdown: {},
      };
    }
    try {
      const report = mod.getCostTracker().getReport();
      return {
        sessionCost: report.sessionCost,
        dailyCost: report.dailyCost,
        weeklyCost: report.weeklyCost,
        monthlyCost: report.monthlyCost,
        totalCost: report.totalCost,
        sessionTokens: report.sessionTokens,
        modelBreakdown: report.modelBreakdown,
        budgetLimit: report.budgetLimit,
        dailyLimit: report.dailyLimit,
      };
    } catch (err) {
      logWarn('[CostBridge] getSummary failed:', err);
      return {
        sessionCost: 0,
        dailyCost: 0,
        weeklyCost: 0,
        monthlyCost: 0,
        totalCost: 0,
        sessionTokens: { input: 0, output: 0 },
        modelBreakdown: {},
      };
    }
  }

  /** Daily cost time series from the local DB for charts. */
  getDailyHistory(days = 30): DailyCostPoint[] {
    try {
      const database = this.db.raw;
      const since = Date.now() - days * 24 * 60 * 60 * 1000;
      const rows = database
        .prepare(
          `SELECT
             strftime('%Y-%m-%d', timestamp / 1000, 'unixepoch') AS date,
             SUM(cost) AS cost,
             SUM(input_tokens) AS input_tokens,
             SUM(output_tokens) AS output_tokens,
             COUNT(*) AS calls
           FROM cost_history
           WHERE timestamp >= ?
           GROUP BY date
           ORDER BY date ASC`
        )
        .all(since) as Array<{
        date: string;
        cost: number | null;
        input_tokens: number | null;
        output_tokens: number | null;
        calls: number;
      }>;
      return rows.map((row) => ({
        date: row.date,
        cost: row.cost ?? 0,
        inputTokens: row.input_tokens ?? 0,
        outputTokens: row.output_tokens ?? 0,
        calls: row.calls,
      }));
    } catch (err) {
      logWarn('[CostBridge] getDailyHistory failed:', err);
      return [];
    }
  }

  /** Per-model breakdown from local DB (for pie chart). */
  getModelBreakdown(days = 30): ModelBreakdownEntry[] {
    try {
      const database = this.db.raw;
      const since = Date.now() - days * 24 * 60 * 60 * 1000;
      const rows = database
        .prepare(
          `SELECT
             model,
             SUM(cost) AS cost,
             COUNT(*) AS calls,
             SUM(input_tokens) AS input_tokens,
             SUM(output_tokens) AS output_tokens
           FROM cost_history
           WHERE timestamp >= ?
           GROUP BY model
           ORDER BY cost DESC`
        )
        .all(since) as Array<{
        model: string;
        cost: number | null;
        calls: number;
        input_tokens: number | null;
        output_tokens: number | null;
      }>;
      return rows.map((row) => ({
        model: row.model,
        cost: row.cost ?? 0,
        calls: row.calls,
        inputTokens: row.input_tokens ?? 0,
        outputTokens: row.output_tokens ?? 0,
      }));
    } catch (err) {
      logWarn('[CostBridge] getModelBreakdown failed:', err);
      return [];
    }
  }

  /** Set a monthly budget limit (persisted by CostTracker). */
  async setBudget(monthlyLimit: number): Promise<boolean> {
    const mod = await loadModule();
    if (!mod) return false;
    try {
      mod.getCostTracker().setBudgetLimit(monthlyLimit);
      return true;
    } catch (err) {
      logWarn('[CostBridge] setBudget failed:', err);
      return false;
    }
  }

  /** Set a daily limit (persisted by CostTracker). */
  async setDailyLimit(limit: number): Promise<boolean> {
    const mod = await loadModule();
    if (!mod) return false;
    try {
      mod.getCostTracker().setDailyLimit(limit);
      return true;
    } catch (err) {
      logWarn('[CostBridge] setDailyLimit failed:', err);
      return false;
    }
  }
}
