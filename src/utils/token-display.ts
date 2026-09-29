/**
 * Token Usage Display
 *
 * Formats per-message token usage (input/output/cost) for display
 * after each LLM response in the agent loop.
 */

import { LOCAL_NO_COST_MODEL_IDS, SUBSCRIPTION_MODEL_IDS, UNKNOWN_MODEL_PRICE } from '../config/model-price-data.js';
import { getPricingPer1k } from '../config/model-pricing.js';

export interface TokenUsageInfo {
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

/**
 * Format token usage into a compact display string.
 *
 * @example
 * formatTokenUsage({ inputTokens: 1234, outputTokens: 567, cost: 0.003 })
 * // => "[tokens: 1,234 in / 567 out | cost: $0.0030]"
 */
export function formatTokenUsage(usage: TokenUsageInfo): string {
  const inStr = formatNumber(usage.inputTokens);
  const outStr = formatNumber(usage.outputTokens);
  const costStr = formatCost(usage.cost);
  return `[tokens: ${inStr} in / ${outStr} out | cost: ${costStr}]`;
}

/**
 * Format a number with comma separators.
 */
function formatNumber(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0';
  return n.toLocaleString('en-US');
}

/**
 * Format a cost value as a dollar amount.
 * Uses 4 decimal places for small amounts, 2 for larger ones.
 */
function formatCost(cost: number): string {
  if (!Number.isFinite(cost) || cost < 0) return '$0.0000';
  if (cost < 0.01) {
    return `$${cost.toFixed(4)}`;
  }
  return `$${cost.toFixed(2)}`;
}

/**
 * Estimate cost from token counts using approximate model pricing.
 * Uses the shared model price; for accurate cost tracking use CostTracker.
 *
 * Subscription and local models report zero USD spend.
 */
export function estimateCost(
  inputTokens: number,
  outputTokens: number,
  inputPricePer1k?: number,
  outputPricePer1k?: number,
  model?: string,
): number {
  if (model && (isChatGptSubscriptionModel(model) || isLocalNoCostModel(model))) return 0;
  const price = model ? getPricingPer1k(model) : {
    inputPer1k: UNKNOWN_MODEL_PRICE.inputPerMillion / 1000,
    outputPer1k: UNKNOWN_MODEL_PRICE.outputPerMillion / 1000,
  };
  return (inputTokens / 1000) * (inputPricePer1k ?? price.inputPer1k)
    + (outputTokens / 1000) * (outputPricePer1k ?? price.outputPer1k);
}

function isChatGptSubscriptionModel(model: string): boolean {
  const m = model.toLowerCase();
  return SUBSCRIPTION_MODEL_IDS.exact.includes(m)
    || SUBSCRIPTION_MODEL_IDS.prefixes.some(prefix => m.startsWith(prefix))
    || SUBSCRIPTION_MODEL_IDS.contains.some(part => m.includes(part));
}

function isLocalNoCostModel(model: string): boolean {
  const m = model.toLowerCase();
  return LOCAL_NO_COST_MODEL_IDS.exact.includes(m)
    || LOCAL_NO_COST_MODEL_IDS.prefixes.some(prefix => m.startsWith(prefix));
}
