/**
 * Token Usage Display
 *
 * Formats per-message token usage (input/output/cost) for display
 * after each LLM response in the agent loop.
 */

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
 * Uses a simple heuristic; for accurate cost tracking use CostTracker.
 *
 * Special-case: returns 0 when `model` indicates a ChatGPT subscription
 * call (`gpt-5.2`, `gpt-5.5*`, `*-codex*`, `codex-1`). Those are billed against
 * the user's flat-fee Plus/Pro plan, NOT per token, so reporting USD
 * spend would be misleading. See `cost-tracker.ts:isChatGptSubscriptionModel`.
 */
export function estimateCost(
  inputTokens: number,
  outputTokens: number,
  inputPricePer1k: number = 0.003,
  outputPricePer1k: number = 0.015,
  model?: string,
): number {
  if (model && isChatGptSubscriptionModel(model)) return 0;
  return (inputTokens / 1000) * inputPricePer1k + (outputTokens / 1000) * outputPricePer1k;
}

function isChatGptSubscriptionModel(model: string): boolean {
  const m = model.toLowerCase();
  return (
    m === 'gpt-5.2' ||
    m === 'gpt-5.5' ||
    m.startsWith('gpt-5.5-') ||
    m.includes('-codex') ||
    m === 'codex-1' ||
    m.startsWith('codex-mini')
  );
}
