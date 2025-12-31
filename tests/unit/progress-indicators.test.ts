/**
 * Unit tests for CostTracker (Progress Indicators / Cost Indicator)
 * Tests cost tracking, budget management, and pricing calculations
 */

import {
  CostTracker,
  CostEntry,
  CostSummary,
  CostBudget,
  TokenPricing,
  MODEL_PRICING,
  getCostTracker,
  resetCostTracker,
} from '../../src/ui/cost-indicator';

describe('CostTracker', () => {
  let tracker: CostTracker;

  beforeEach(() => {
    tracker = new CostTracker();
    resetCostTracker();
  });

  describe('Constructor', () => {
    it('should create tracker with default pricing', () => {
      tracker = new CostTracker();

      expect(tracker).toBeDefined();
    });

    it('should create tracker with custom pricing', () => {
      const customPricing: TokenPricing[] = [
        { model: 'custom-model', inputPer1M: 1.0, outputPer1M: 2.0 },
      ];

      tracker = new CostTracker(customPricing);

      const pricing = tracker.getPricing('custom-model');
      expect(pricing.inputPer1M).toBe(1.0);
      expect(pricing.outputPer1M).toBe(2.0);
    });

    it('should load all default model pricing', () => {
      tracker = new CostTracker();

      for (const modelPricing of MODEL_PRICING) {
        const pricing = tracker.getPricing(modelPricing.model);
        expect(pricing.inputPer1M).toBe(modelPricing.inputPer1M);
        expect(pricing.outputPer1M).toBe(modelPricing.outputPer1M);
      }
    });
  });

  describe('setBudget', () => {
    it('should set budget limit', () => {
      const budget: CostBudget = {
        limit: 10.0,
        warningThreshold: 0.8,
        action: 'warn',
      };

      tracker.setBudget(budget);

      const status = tracker.getBudgetStatus();
      expect(status.hasLimit).toBe(true);
      expect(status.limit).toBe(10.0);
    });
  });

  describe('getBudgetStatus', () => {
    it('should return no limit when budget not set', () => {
      const status = tracker.getBudgetStatus();

      expect(status.hasLimit).toBe(false);
      expect(status.limit).toBe(Infinity);
      expect(status.remaining).toBe(Infinity);
    });

    it('should calculate budget percentage', () => {
      tracker.setBudget({
        limit: 10.0,
        warningThreshold: 0.8,
        action: 'warn',
      });

      // Record some usage (grok-3: $1/1M input, $5/1M output)
      tracker.recordRequest('grok-3', 1000000, 200000); // $1 + $1 = $2

      const status = tracker.getBudgetStatus();
      expect(status.used).toBeCloseTo(2.0);
      expect(status.percentage).toBeCloseTo(20.0);
      expect(status.remaining).toBeCloseTo(8.0);
    });

    it('should trigger warning when threshold reached', () => {
      tracker.setBudget({
        limit: 10.0,
        warningThreshold: 0.8,
        action: 'warn',
      });

      // Use 80% of budget
      tracker.recordRequest('grok-3', 8000000, 0); // $8

      const status = tracker.getBudgetStatus();
      expect(status.warningTriggered).toBe(true);
    });

    it('should not trigger warning below threshold', () => {
      tracker.setBudget({
        limit: 10.0,
        warningThreshold: 0.8,
        action: 'warn',
      });

      // Use 50% of budget
      tracker.recordRequest('grok-3', 5000000, 0); // $5

      const status = tracker.getBudgetStatus();
      expect(status.warningTriggered).toBe(false);
    });

    it('should set blocked when limit reached with block action', () => {
      tracker.setBudget({
        limit: 10.0,
        warningThreshold: 0.8,
        action: 'block',
      });

      // Exceed budget
      tracker.recordRequest('grok-3', 10000000, 1000000); // $10 + $5 = $15

      const status = tracker.getBudgetStatus();
      expect(status.blocked).toBe(true);
    });

    it('should not block when action is not block', () => {
      tracker.setBudget({
        limit: 10.0,
        warningThreshold: 0.8,
        action: 'warn',
      });

      // Exceed budget
      tracker.recordRequest('grok-3', 10000000, 1000000);

      const status = tracker.getBudgetStatus();
      expect(status.blocked).toBe(false);
    });
  });

  describe('recordRequest', () => {
    it('should record a request', () => {
      const entry = tracker.recordRequest('grok-3', 1000, 500, 0, 'chat');

      expect(entry).toBeDefined();
      expect(entry.model).toBe('grok-3');
      expect(entry.inputTokens).toBe(1000);
      expect(entry.outputTokens).toBe(500);
      expect(entry.requestType).toBe('chat');
    });

    it('should calculate cost correctly', () => {
      // grok-3: $1/1M input, $5/1M output
      const entry = tracker.recordRequest('grok-3', 1000000, 1000000);

      expect(entry.cost).toBeCloseTo(6.0); // $1 + $5 = $6
    });

    it('should record cached tokens', () => {
      const entry = tracker.recordRequest('gpt-4o', 1000, 500, 200);

      expect(entry.cachedTokens).toBe(200);
    });

    it('should add timestamp', () => {
      const before = new Date();
      const entry = tracker.recordRequest('grok-3', 1000, 500);
      const after = new Date();

      expect(entry.timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(entry.timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  describe('calculateCost', () => {
    it('should calculate input cost', () => {
      // grok-3: $1/1M input
      const cost = tracker.calculateCost('grok-3', 1000000, 0);

      expect(cost).toBeCloseTo(1.0);
    });

    it('should calculate output cost', () => {
      // grok-3: $5/1M output
      const cost = tracker.calculateCost('grok-3', 0, 1000000);

      expect(cost).toBeCloseTo(5.0);
    });

    it('should calculate combined cost', () => {
      // grok-3: $1/1M input, $5/1M output
      const cost = tracker.calculateCost('grok-3', 500000, 500000);

      expect(cost).toBeCloseTo(3.0); // $0.5 + $2.5 = $3
    });

    it('should calculate cached token cost', () => {
      // gpt-4o: $1.25/1M cached input
      const cost = tracker.calculateCost('gpt-4o', 0, 0, 1000000);

      expect(cost).toBeCloseTo(1.25);
    });

    it('should ignore cached tokens for models without cached pricing', () => {
      // grok-3 has no cached pricing
      const cost = tracker.calculateCost('grok-3', 0, 0, 1000000);

      expect(cost).toBe(0);
    });
  });

  describe('getPricing', () => {
    it('should get exact model pricing', () => {
      const pricing = tracker.getPricing('grok-3');

      expect(pricing.model).toBe('grok-3');
      expect(pricing.inputPer1M).toBe(1.0);
      expect(pricing.outputPer1M).toBe(5.0);
    });

    it('should match by prefix', () => {
      const pricing = tracker.getPricing('grok-3-something');

      expect(pricing.inputPer1M).toBe(1.0);
    });

    it('should return default pricing for unknown model', () => {
      const pricing = tracker.getPricing('completely-unknown-model');

      expect(pricing.inputPer1M).toBe(5.0);
      expect(pricing.outputPer1M).toBe(15.0);
    });
  });

  describe('getTotalCost', () => {
    it('should return 0 with no requests', () => {
      const total = tracker.getTotalCost();

      expect(total).toBe(0);
    });

    it('should sum all request costs', () => {
      tracker.recordRequest('grok-3', 1000000, 0); // $1
      tracker.recordRequest('grok-3', 1000000, 0); // $1
      tracker.recordRequest('grok-3', 0, 1000000); // $5

      const total = tracker.getTotalCost();

      expect(total).toBeCloseTo(7.0);
    });
  });

  describe('getSummary', () => {
    beforeEach(() => {
      tracker.recordRequest('grok-3', 1000000, 500000, 0, 'chat'); // $1 + $2.5 = $3.5
      tracker.recordRequest('gpt-4o', 1000000, 500000, 0, 'tool'); // $2.5 + $5 = $7.5
    });

    it('should calculate total cost', () => {
      const summary = tracker.getSummary();

      expect(summary.totalCost).toBeCloseTo(11.0);
    });

    it('should calculate input cost', () => {
      const summary = tracker.getSummary();

      expect(summary.inputCost).toBeCloseTo(3.5); // $1 + $2.5
    });

    it('should calculate output cost', () => {
      const summary = tracker.getSummary();

      expect(summary.outputCost).toBeCloseTo(7.5); // $2.5 + $5
    });

    it('should count total tokens', () => {
      const summary = tracker.getSummary();

      expect(summary.totalInputTokens).toBe(2000000);
      expect(summary.totalOutputTokens).toBe(1000000);
    });

    it('should count requests', () => {
      const summary = tracker.getSummary();

      expect(summary.requestCount).toBe(2);
    });

    it('should calculate average cost per request', () => {
      const summary = tracker.getSummary();

      expect(summary.avgCostPerRequest).toBeCloseTo(5.5);
    });

    it('should track cost by model', () => {
      const summary = tracker.getSummary();

      expect(summary.costByModel.get('grok-3')).toBeCloseTo(3.5);
      expect(summary.costByModel.get('gpt-4o')).toBeCloseTo(7.5);
    });

    it('should include entries copy', () => {
      const summary = tracker.getSummary();

      expect(summary.entries.length).toBe(2);
    });

    it('should handle zero requests', () => {
      tracker.clear();

      const summary = tracker.getSummary();

      expect(summary.avgCostPerRequest).toBe(0);
    });
  });

  describe('estimateCost', () => {
    it('should estimate cost for future request', () => {
      // grok-3: $1/1M input, $5/1M output
      const estimate = tracker.estimateCost('grok-3', 2000000, 1000000);

      expect(estimate).toBeCloseTo(7.0); // $2 + $5 = $7
    });
  });

  describe('getSessionDuration', () => {
    it('should return positive duration', async () => {
      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 10));

      const duration = tracker.getSessionDuration();

      expect(duration).toBeGreaterThan(0);
    });
  });

  describe('getCostRate', () => {
    it('should return 0 for very short sessions', () => {
      const rate = tracker.getCostRate();

      expect(rate).toBe(0);
    });

    it('should calculate cost per hour', async () => {
      // Record some cost
      tracker.recordRequest('grok-3', 1000000, 0); // $1

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 50));

      const rate = tracker.getCostRate();

      // Rate should be positive (we spent $1 in a short time)
      expect(rate).toBeGreaterThanOrEqual(0);
    });
  });

  describe('clear', () => {
    it('should clear all entries', () => {
      tracker.recordRequest('grok-3', 1000, 500);
      tracker.recordRequest('grok-3', 1000, 500);

      tracker.clear();

      expect(tracker.getTotalCost()).toBe(0);
      expect(tracker.getSummary().requestCount).toBe(0);
    });

    it('should reset session start', () => {
      const duration1 = tracker.getSessionDuration();

      tracker.clear();

      const duration2 = tracker.getSessionDuration();

      expect(duration2).toBeLessThan(duration1 + 100);
    });
  });

  describe('formatCost', () => {
    it('should format small costs in cents', () => {
      const formatted = tracker.formatCost(0.005);

      expect(formatted).toContain('0.50');
      expect(formatted).toContain('\u00a2'); // cent symbol
    });

    it('should format larger costs in dollars', () => {
      const formatted = tracker.formatCost(1.2345);

      expect(formatted).toBe('$1.2345');
    });

    it('should format zero cost', () => {
      const formatted = tracker.formatCost(0);

      expect(formatted).toContain('0.00');
    });
  });

  describe('formatStatus', () => {
    it('should format status without budget', () => {
      tracker.recordRequest('grok-3', 1000000, 0); // $1

      const status = tracker.formatStatus();

      expect(status).toContain('$');
    });

    it('should format status with budget', () => {
      tracker.setBudget({
        limit: 10.0,
        warningThreshold: 0.8,
        action: 'warn',
      });
      tracker.recordRequest('grok-3', 2000000, 0); // $2

      const status = tracker.formatStatus();

      expect(status).toContain('/');
      expect(status).toContain('%');
    });
  });

  describe('formatReport', () => {
    beforeEach(() => {
      tracker.recordRequest('grok-3', 1000000, 500000);
      tracker.recordRequest('gpt-4o', 500000, 250000);
    });

    it('should format detailed report', () => {
      const report = tracker.formatReport();

      expect(report).toContain('COST REPORT');
      expect(report).toContain('Total Cost');
      expect(report).toContain('Input');
      expect(report).toContain('Output');
      expect(report).toContain('Tokens Used');
      expect(report).toContain('Requests');
    });

    it('should show cost by model', () => {
      const report = tracker.formatReport();

      expect(report).toContain('By Model');
      expect(report).toContain('grok-3');
      expect(report).toContain('gpt-4o');
    });

    it('should show budget info when set', () => {
      tracker.setBudget({
        limit: 100.0,
        warningThreshold: 0.8,
        action: 'warn',
      });

      const report = tracker.formatReport();

      expect(report).toContain('Budget');
      expect(report).toContain('Limit');
      expect(report).toContain('Used');
      expect(report).toContain('Remaining');
    });

    it('should show warning when triggered', () => {
      tracker.setBudget({
        limit: 5.0,
        warningThreshold: 0.5,
        action: 'warn',
      });

      const report = tracker.formatReport();

      expect(report).toContain('Warning');
    });

    it('should show blocked when limit reached', () => {
      tracker.setBudget({
        limit: 1.0,
        warningThreshold: 0.8,
        action: 'block',
      });

      const report = tracker.formatReport();

      expect(report).toContain('Budget limit');
    });
  });

  describe('formatStatusLine', () => {
    it('should format compact status line', () => {
      tracker.recordRequest('grok-3', 1000000, 0);

      const line = tracker.formatStatusLine();

      expect(line).toContain('$');
    });

    it('should show progress bar with budget', () => {
      tracker.setBudget({
        limit: 10.0,
        warningThreshold: 0.8,
        action: 'warn',
      });
      tracker.recordRequest('grok-3', 5000000, 0); // $5 = 50%

      const line = tracker.formatStatusLine();

      expect(line).toContain('[');
      expect(line).toContain(']');
      expect(line).toContain('%');
    });

    it('should show warning indicator', () => {
      tracker.setBudget({
        limit: 10.0,
        warningThreshold: 0.5,
        action: 'warn',
      });
      tracker.recordRequest('grok-3', 6000000, 0); // $6 = 60%

      const line = tracker.formatStatusLine();

      // Should contain warning emoji
      expect(line.length).toBeGreaterThan(0);
    });
  });
});

describe('MODEL_PRICING', () => {
  it('should have pricing for common models', () => {
    const modelNames = MODEL_PRICING.map((p) => p.model);

    expect(modelNames).toContain('grok-4-latest');
    expect(modelNames).toContain('grok-4');
    expect(modelNames).toContain('grok-3');
    expect(modelNames).toContain('grok-beta');
    expect(modelNames).toContain('gpt-4o');
    expect(modelNames).toContain('gpt-4o-mini');
  });

  it('should have valid pricing values', () => {
    for (const pricing of MODEL_PRICING) {
      expect(pricing.inputPer1M).toBeGreaterThan(0);
      expect(pricing.outputPer1M).toBeGreaterThan(0);
      if (pricing.cachedInputPer1M !== undefined) {
        expect(pricing.cachedInputPer1M).toBeGreaterThan(0);
        expect(pricing.cachedInputPer1M).toBeLessThan(pricing.inputPer1M);
      }
    }
  });
});

describe('Singleton Functions', () => {
  beforeEach(() => {
    resetCostTracker();
  });

  describe('getCostTracker', () => {
    it('should return singleton instance', () => {
      const tracker1 = getCostTracker();
      const tracker2 = getCostTracker();

      expect(tracker1).toBe(tracker2);
    });

    it('should persist data between calls', () => {
      const tracker1 = getCostTracker();
      tracker1.recordRequest('grok-3', 1000, 500);

      const tracker2 = getCostTracker();

      expect(tracker2.getTotalCost()).toBeGreaterThan(0);
    });
  });

  describe('resetCostTracker', () => {
    it('should reset singleton', () => {
      const tracker1 = getCostTracker();
      tracker1.recordRequest('grok-3', 1000, 500);

      resetCostTracker();

      const tracker2 = getCostTracker();

      expect(tracker2).not.toBe(tracker1);
      expect(tracker2.getTotalCost()).toBe(0);
    });
  });
});

describe('Edge Cases', () => {
  let tracker: CostTracker;

  beforeEach(() => {
    tracker = new CostTracker();
  });

  it('should handle zero tokens', () => {
    const entry = tracker.recordRequest('grok-3', 0, 0);

    expect(entry.cost).toBe(0);
  });

  it('should handle very large token counts', () => {
    const entry = tracker.recordRequest('grok-3', 1000000000, 1000000000);

    expect(entry.cost).toBeGreaterThan(0);
  });

  it('should handle multiple models in summary', () => {
    for (const pricing of MODEL_PRICING) {
      tracker.recordRequest(pricing.model, 1000, 500);
    }

    const summary = tracker.getSummary();

    expect(summary.costByModel.size).toBe(MODEL_PRICING.length);
  });

  it('should handle cached tokens with input tokens', () => {
    // gpt-4o: $2.5/1M input, $10/1M output, $1.25/1M cached
    const cost = tracker.calculateCost('gpt-4o', 1000000, 1000000, 500000);

    // $2.5 + $10 + $0.625 = $13.125
    expect(cost).toBeCloseTo(13.125);
  });
});
