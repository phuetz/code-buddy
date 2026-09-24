/**
 * Model Pricing — Single pricing source
 *
 * Sprint 2 of the Model Architecture refactor.
 *
 * Replaces 6+ duplicate pricing tables scattered across the codebase.
 * All modules should import from this file instead of defining their own
 * pricing maps.
 */

import { getModelRegistry, type ModelPricing } from './model-registry.js';

export type { ModelPricing };

const cataloguePrices = new Map<string, ModelPricing>();

/**
 * Prix écrits dans le TOML. `null` retire la surcharge.
 * Sans surcharge, le registre intégré est inchangé.
 */
export function installCataloguePriceOverlays(
  entries: Record<string, ModelPricing> | null,
): void {
  cataloguePrices.clear();
  if (!entries) return;
  for (const [name, price] of Object.entries(entries)) {
    const key = name.trim().toLowerCase();
    if (!key) continue;
    cataloguePrices.set(key, {
      inputPerMillion: price.inputPerMillion,
      outputPerMillion: price.outputPerMillion,
    });
  }
}

/**
 * Get model pricing in "per 1M tokens" format.
 * Un prix présent dans la configuration gagne sur le registre intégré.
 */
export function getModelPricing(model: string): ModelPricing {
  const overlay = cataloguePrices.get(model.trim().toLowerCase());
  if (overlay) return { ...overlay };
  return getModelRegistry().getPricing(model);
}

// ============================================================================
// Adapters for different unit formats used across the codebase
// ============================================================================

/**
 * Get pricing in "per 1K tokens" format (used by CostTracker, CostPredictor).
 */
export function getPricingPer1k(model: string): { inputPer1k: number; outputPer1k: number } {
  const p = getModelPricing(model);
  return {
    inputPer1k: p.inputPerMillion / 1000,
    outputPer1k: p.outputPerMillion / 1000,
  };
}

/**
 * Get pricing in "per 1M tokens" format with `input`/`output` keys
 * (used by AnalyticsDashboard, PersistentAnalytics, interpreter types).
 */
export function getPricingPer1M(model: string): { input: number; output: number } {
  const p = getModelPricing(model);
  return {
    input: p.inputPerMillion,
    output: p.outputPerMillion,
  };
}

/**
 * Get pricing in the TokenPricing array format (used by cost-indicator.ts).
 */
export function getPricingForIndicator(model: string): {
  model: string;
  inputPer1M: number;
  outputPer1M: number;
} {
  const p = getModelPricing(model);
  return {
    model,
    inputPer1M: p.inputPerMillion,
    outputPer1M: p.outputPerMillion,
  };
}
