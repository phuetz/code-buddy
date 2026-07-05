/**
 * credits — pure USD <-> "credits" conversion helpers (Genspark-style usage display).
 *
 * Convention: 1 credit = $0.01 (`USD_PER_CREDIT`). No React, no imports, no
 * side effects — deterministic pure functions only, safe to unit test
 * standalone and safe to import from any layer without pulling in
 * Electron/React.
 *
 * @module renderer/components/credits
 */

/** USD value of a single credit. 1 credit = $0.01 by convention. */
export const USD_PER_CREDIT = 0.01;

/**
 * Convert a USD amount to whole credits, floored down.
 * Negative amounts clamp to 0 credits.
 */
export function costToCredits(usd: number): number {
  return Math.max(0, Math.floor(usd / USD_PER_CREDIT));
}

/**
 * Whole credits remaining given usage and a total budget, both in USD.
 * Never negative — a budget already exceeded reads as 0 credits left.
 */
export function creditsRemaining(usedUsd: number, budgetUsd: number): number {
  return costToCredits(budgetUsd - usedUsd);
}

/**
 * Percentage of the budget consumed so far, as an integer 0..100.
 * A non-positive budget is treated as 0% (nothing to divide by).
 */
export function budgetPct(usedUsd: number, budgetUsd: number): number {
  if (budgetUsd <= 0) return 0;
  const pct = Math.round((usedUsd / budgetUsd) * 100);
  return Math.min(100, Math.max(0, pct));
}

/**
 * Format a whole-credit count with thousands separators, e.g. 1234 -> '1,234'.
 */
export function formatCredits(n: number): string {
  return new Intl.NumberFormat('en-US').format(n);
}
