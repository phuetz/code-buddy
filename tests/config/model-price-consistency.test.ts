import { describe, expect, it } from 'vitest';
import { MODEL_PRICE_DATA, ROUTER_MODEL_DATA, TOML_MODEL_DATA } from '../../src/config/model-price-data.js';
import { getModelPricing, getPricingPer1k, installCataloguePriceOverlays } from '../../src/config/model-pricing.js';
import { getModelRegistry } from '../../src/config/model-registry.js';
import { DEFAULT_CONFIG } from '../../src/config/toml-config.js';
import { MODEL_PRICING as TRACKER_PRICING } from '../../src/utils/cost-tracker.js';
import { MODEL_PRICING as INDICATOR_PRICING } from '../../src/ui/cost-indicator.js';
import { GROK_MODELS as OPTIMIZATION_MODELS } from '../../src/optimization/model-routing.js';
import { ModelRouter } from '../../src/utils/model-router.js';
import { DEFAULT_SESSION_COST_USD, DEFAULT_YOLO_SESSION_COST_USD, YOLO_SESSION_COST_HARD_CAP_USD } from '../../src/config/session-cost-defaults.js';
import { resolveSessionLimits } from '../../src/config/middleware-limits.js';

const perMillion = (perThousand: number) => perThousand * 1000;

describe('shared model prices', () => {
  it('keeps every overlapping consumer on the same input and output rate', () => {
    const router = new ModelRouter('/tmp/model-price-consistency');
    for (const [model, price] of Object.entries(MODEL_PRICE_DATA)) {
      expect(price.source, model).toBeTruthy();
      expect(price.checkedAt, model).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof price.verified, model).toBe('boolean');
      const registry = getModelRegistry().getPricing(model);
      const adapter = getModelPricing(model);
      const tracker = TRACKER_PRICING[model];
      const indicator = INDICATOR_PRICING.find(entry => entry.model === model);
      expect(registry, model).toEqual({ inputPerMillion: price.inputPerMillion, outputPerMillion: price.outputPerMillion });
      expect(adapter, model).toEqual(registry);
      expect(tracker, model).toBeDefined();
      expect(perMillion(tracker!.inputPer1k), model).toBeCloseTo(price.inputPerMillion);
      expect(perMillion(tracker!.outputPer1k), model).toBeCloseTo(price.outputPerMillion);
      if (price.inputPerMillion > 0) {
        expect(indicator?.inputPer1M, model).toBe(price.inputPerMillion);
        expect(indicator?.outputPer1M, model).toBe(price.outputPerMillion);
      }
      const optimization = OPTIMIZATION_MODELS[model];
      if (optimization) expect(optimization.costPerMillionTokens, model).toBe(price.inputPerMillion);
      if (Object.hasOwn(ROUTER_MODEL_DATA, model)) {
        const routed = router.getModelInfo(model);
        expect(perMillion(routed!.costPer1kInput), model).toBeCloseTo(price.inputPerMillion);
        expect(perMillion(routed!.costPer1kOutput), model).toBeCloseTo(price.outputPerMillion);
      }
    }
    for (const [alias, data] of Object.entries(TOML_MODEL_DATA)) {
      const configured = DEFAULT_CONFIG.models[alias];
      const price = getModelPricing(data.model_id);
      expect(configured.price_per_m_input, alias).toBe(price.inputPerMillion);
      expect(configured.price_per_m_output, alias).toBe(price.outputPerMillion);
    }
    expect(getPricingPer1k('grok-code-fast-1')).toEqual({ inputPer1k: 0.0002, outputPer1k: 0.0015 });
    expect(MODEL_PRICE_DATA['grok-code-fast-1']).toMatchObject({
      verified: true, checkedAt: '2026-09-29', source: 'https://x.ai/news/grok-code-fast-1',
    });
  });

  it('uses documented CLI limits for Cowork and clamps explicit YOLO budgets', () => {
    expect(DEFAULT_SESSION_COST_USD).toBe(10);
    expect(DEFAULT_YOLO_SESSION_COST_USD).toBe(100);
    expect(resolveSessionLimits({ yolo: false }).sessionCostUsd).toBe(DEFAULT_SESSION_COST_USD);
    expect(resolveSessionLimits({ yolo: true }).sessionCostUsd).toBe(DEFAULT_YOLO_SESSION_COST_USD);
    expect(resolveSessionLimits({ yolo: true, cliMaxCost: 42 }).sessionCostUsd).toBe(42);
    expect(resolveSessionLimits({ yolo: true, cliMaxCost: 2000 }).sessionCostUsd).toBe(YOLO_SESSION_COST_HARD_CAP_USD);
  });

  it('propagates an explicit catalogue price to the registry and consumers', () => {
    const model = 'grok-code-fast-1';
    installCataloguePriceOverlays({ [model]: { inputPerMillion: 7, outputPerMillion: 8 } });
    try {
      const router = new ModelRouter('/tmp/model-price-overlay');
      expect(getModelRegistry().getPricing(model)).toEqual({ inputPerMillion: 7, outputPerMillion: 8 });
      expect(TRACKER_PRICING[model]!.inputPer1k).toBe(0.007);
      expect(INDICATOR_PRICING.find(entry => entry.model === model)?.outputPer1M).toBe(8);
      expect(router.getModelInfo(model)?.costPer1kInput).toBe(0.007);
      expect(router.recordUsage(1_000_000, 1_000_000)).toBe(15);
      expect(DEFAULT_CONFIG.models['grok-code-fast']?.price_per_m_output).toBe(8);
    } finally {
      installCataloguePriceOverlays(null);
    }
  });
});
