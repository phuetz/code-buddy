/**
 * `buddy science --loop` — Phase 3 budget resolution (pure, testable).
 *
 * Turns the CLI budget flags (`--max-generations`, `--max-experiments`,
 * `--budget`, `--parallel`, `--max-cost`, `--cost-per-experiment`) + the
 * `CODEBUDDY_SCIENCE_*` env vars into an {@link ExperimentBudget}. Without
 * `--cost-per-experiment` the accumulated cost stays 0, so `--max-cost` alone
 * never fires — both are needed to arm the cost cap. The loop itself CLAMPS every
 * value to a hard ceiling,
 * so this resolver only has to reject NON-NUMERIC / non-positive input (a typo
 * must abort loudly rather than silently fall back to a default that runs code).
 *
 * @module commands/science/loop-option
 */

import type { ExperimentBudget } from '../../agent/science/experiment-loop.js';

export type LoopBudgetResolution =
  | { kind: 'ok'; budget: ExperimentBudget }
  | { kind: 'invalid'; error: string };

export interface LoopCliInput {
  maxGenerations?: string | undefined;
  maxExperiments?: string | undefined;
  /** Wall-clock budget: a duration like `500`, `30s`, `10m`, `2h` (ms if unitless). */
  budget?: string | undefined;
  parallel?: string | undefined;
  /** HARD CAP: cost budget in arbitrary units (the loop stops when reached). */
  maxCost?: string | undefined;
  /** Cost charged per executed experiment — drives the cost cap. */
  costPerExperiment?: string | undefined;
}

/** Parse a positive integer, or return null on any non-integer / non-positive input. */
function parsePositiveInt(raw: string): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return null;
  return n;
}

/** Parse a positive (possibly fractional) number, or null on non-finite / non-positive input. */
function parsePositiveNumber(raw: string): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/** Parse a duration (`500`, `30s`, `10m`, `2h`) to milliseconds, or null if invalid. */
export function parseDuration(raw: string): number | null {
  const m = raw.trim().match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h)?$/i);
  if (!m || m[1] === undefined) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = (m[2] ?? 'ms').toLowerCase();
  const mult = unit === 'h' ? 3_600_000 : unit === 'm' ? 60_000 : unit === 's' ? 1000 : 1;
  return Math.round(value * mult);
}

/**
 * Resolve the Phase 3 budget from CLI flags + env. Pure: env is passed in so
 * tests need not mutate `process.env`. Flags win over env.
 */
export function resolveLoopBudget(
  opts: LoopCliInput,
  env: Record<string, string | undefined> = {},
): LoopBudgetResolution {
  const budget: ExperimentBudget = {};

  const genRaw = opts.maxGenerations ?? env.CODEBUDDY_SCIENCE_MAX_GENERATIONS;
  if (genRaw !== undefined && genRaw !== '') {
    const n = parsePositiveInt(genRaw);
    if (n === null) return { kind: 'invalid', error: `Invalid --max-generations "${genRaw}" (positive integer expected).` };
    budget.maxGenerations = n;
  }

  const expRaw = opts.maxExperiments ?? env.CODEBUDDY_SCIENCE_MAX_EXPERIMENTS;
  if (expRaw !== undefined && expRaw !== '') {
    const n = parsePositiveInt(expRaw);
    if (n === null) return { kind: 'invalid', error: `Invalid --max-experiments "${expRaw}" (positive integer expected).` };
    budget.maxExperiments = n;
  }

  const parRaw = opts.parallel ?? env.CODEBUDDY_SCIENCE_PARALLEL;
  if (parRaw !== undefined && parRaw !== '') {
    const n = parsePositiveInt(parRaw);
    if (n === null) return { kind: 'invalid', error: `Invalid --parallel "${parRaw}" (positive integer expected).` };
    budget.parallelism = n;
  }

  const budRaw = opts.budget ?? env.CODEBUDDY_SCIENCE_BUDGET;
  if (budRaw !== undefined && budRaw !== '') {
    const ms = parseDuration(budRaw);
    if (ms === null) return { kind: 'invalid', error: `Invalid --budget "${budRaw}" (duration expected, e.g. 500, 30s, 10m, 2h).` };
    budget.maxWallClockMs = ms;
  }

  const costRaw = opts.maxCost ?? env.CODEBUDDY_SCIENCE_MAX_COST;
  if (costRaw !== undefined && costRaw !== '') {
    const n = parsePositiveNumber(costRaw);
    if (n === null) return { kind: 'invalid', error: `Invalid --max-cost "${costRaw}" (positive number expected).` };
    budget.maxCost = n;
  }

  const cpeRaw = opts.costPerExperiment ?? env.CODEBUDDY_SCIENCE_COST_PER_EXPERIMENT;
  if (cpeRaw !== undefined && cpeRaw !== '') {
    const n = parsePositiveNumber(cpeRaw);
    if (n === null) return { kind: 'invalid', error: `Invalid --cost-per-experiment "${cpeRaw}" (positive number expected).` };
    budget.costPerExperiment = n;
  }

  return { kind: 'ok', budget };
}
