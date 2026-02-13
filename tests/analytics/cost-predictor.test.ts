import { CostPredictor, CostPrediction } from '../../src/analytics/cost-predictor.js';
import type { CostTracker, CostReport, TokenUsage } from '../../src/utils/cost-tracker.js';

/**
 * Create a mock CostTracker with configurable report data.
 */
function createMockCostTracker(overrides: Partial<CostReport> = {}): CostTracker {
  const defaultReport: CostReport = {
    sessionCost: 0,
    dailyCost: 0,
    weeklyCost: 0,
    monthlyCost: 0,
    totalCost: 0,
    sessionTokens: { input: 0, output: 0 },
    modelBreakdown: {},
    recentUsage: [],
    ...overrides,
  };

  return {
    getReport: jest.fn().mockReturnValue(defaultReport),
    calculateCost: jest.fn().mockReturnValue(0),
    recordUsage: jest.fn(),
    resetSession: jest.fn(),
    clearHistory: jest.fn(),
    exportToCsv: jest.fn().mockReturnValue(''),
    formatDashboard: jest.fn().mockReturnValue(''),
    setBudgetLimit: jest.fn(),
    setDailyLimit: jest.fn(),
    dispose: jest.fn(),
    on: jest.fn(),
    emit: jest.fn(),
  } as unknown as CostTracker;
}

function makeUsage(overrides: Partial<TokenUsage> = {}): TokenUsage {
  return {
    inputTokens: 100,
    outputTokens: 200,
    model: 'grok-3-latest',
    timestamp: new Date(),
    cost: 0.005,
    ...overrides,
  };
}

describe('CostPredictor', () => {
  let predictor: CostPredictor;
  let mockTracker: CostTracker;

  beforeEach(() => {
    mockTracker = createMockCostTracker();
    predictor = new CostPredictor(mockTracker);
  });

  describe('predict()', () => {
    it('should return a valid CostPrediction with all required fields', () => {
      const messages = [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hello world' },
      ];

      const prediction = predictor.predict(messages, 'grok-3-latest');

      expect(prediction).toHaveProperty('estimatedInputTokens');
      expect(prediction).toHaveProperty('estimatedOutputTokens');
      expect(prediction).toHaveProperty('estimatedCost');
      expect(prediction).toHaveProperty('model');
      expect(prediction).toHaveProperty('confidence');
    });

    it('should estimate input tokens based on message content length', () => {
      const shortMessages = [
        { role: 'user', content: 'Hi' },
      ];
      const longMessages = [
        { role: 'user', content: 'A'.repeat(4000) },
      ];

      const shortPrediction = predictor.predict(shortMessages, 'grok-3-latest');
      const longPrediction = predictor.predict(longMessages, 'grok-3-latest');

      expect(longPrediction.estimatedInputTokens).toBeGreaterThan(
        shortPrediction.estimatedInputTokens
      );
    });

    it('should use the correct model in the prediction', () => {
      const messages = [{ role: 'user', content: 'test' }];

      const prediction = predictor.predict(messages, 'grok-code-fast-1');

      expect(prediction.model).toBe('grok-code-fast-1');
    });

    it('should use default pricing for unknown models', () => {
      const messages = [{ role: 'user', content: 'test' }];

      const prediction = predictor.predict(messages, 'unknown-model-xyz');

      expect(prediction.estimatedCost).toBeGreaterThan(0);
      expect(prediction.model).toBe('unknown-model-xyz');
    });

    it('should calculate cost using model-specific pricing', () => {
      const messages = [
        { role: 'user', content: 'A'.repeat(4000) },
      ];

      const expensivePrediction = predictor.predict(messages, 'grok-3-latest');
      const cheapPrediction = predictor.predict(messages, 'grok-code-fast-1');

      // grok-3-latest is more expensive than grok-code-fast-1
      expect(expensivePrediction.estimatedCost).toBeGreaterThan(
        cheapPrediction.estimatedCost
      );
    });

    it('should use historical average output tokens when history exists', () => {
      const usageHistory = [
        makeUsage({ outputTokens: 1000 }),
        makeUsage({ outputTokens: 1500 }),
        makeUsage({ outputTokens: 2000 }),
      ];

      mockTracker = createMockCostTracker({ recentUsage: usageHistory });
      predictor = new CostPredictor(mockTracker);

      const messages = [{ role: 'user', content: 'test' }];
      const prediction = predictor.predict(messages, 'grok-3-latest');

      // Average output tokens should be (1000+1500+2000)/3 = 1500
      expect(prediction.estimatedOutputTokens).toBe(1500);
    });

    it('should use default output tokens when no history exists', () => {
      const messages = [{ role: 'user', content: 'test' }];
      const prediction = predictor.predict(messages, 'grok-3-latest');

      // Default output tokens is 500
      expect(prediction.estimatedOutputTokens).toBe(500);
    });

    it('should return low confidence when no history exists', () => {
      const messages = [{ role: 'user', content: 'test' }];
      const prediction = predictor.predict(messages, 'grok-3-latest');

      expect(prediction.confidence).toBe('low');
    });

    it('should return medium confidence with 1-4 history entries', () => {
      const usageHistory = [
        makeUsage(),
        makeUsage(),
        makeUsage(),
      ];

      mockTracker = createMockCostTracker({ recentUsage: usageHistory });
      predictor = new CostPredictor(mockTracker);

      const messages = [{ role: 'user', content: 'test' }];
      const prediction = predictor.predict(messages, 'grok-3-latest');

      expect(prediction.confidence).toBe('medium');
    });

    it('should return high confidence with 5+ history entries', () => {
      const usageHistory = Array.from({ length: 6 }, () => makeUsage());

      mockTracker = createMockCostTracker({ recentUsage: usageHistory });
      predictor = new CostPredictor(mockTracker);

      const messages = [{ role: 'user', content: 'test' }];
      const prediction = predictor.predict(messages, 'grok-3-latest');

      expect(prediction.confidence).toBe('high');
    });

    it('should account for multiple messages in input token estimation', () => {
      const singleMessage = [
        { role: 'user', content: 'Hello' },
      ];
      const multipleMessages = [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
        { role: 'user', content: 'Thanks' },
      ];

      const singlePrediction = predictor.predict(singleMessage, 'grok-3-latest');
      const multiPrediction = predictor.predict(multipleMessages, 'grok-3-latest');

      expect(multiPrediction.estimatedInputTokens).toBeGreaterThan(
        singlePrediction.estimatedInputTokens
      );
    });

    it('should produce a positive estimated cost', () => {
      const messages = [{ role: 'user', content: 'Hello world' }];
      const prediction = predictor.predict(messages, 'grok-3-latest');

      expect(prediction.estimatedCost).toBeGreaterThan(0);
    });

    it('should handle empty messages array', () => {
      const prediction = predictor.predict([], 'grok-3-latest');

      expect(prediction.estimatedInputTokens).toBe(0);
      expect(prediction.estimatedCost).toBeGreaterThanOrEqual(0);
    });

    it('should handle messages with empty content', () => {
      const messages = [
        { role: 'user', content: '' },
        { role: 'system', content: '' },
      ];

      const prediction = predictor.predict(messages, 'grok-3-latest');

      // Should still count role overhead
      expect(prediction.estimatedInputTokens).toBeGreaterThan(0);
    });
  });

  describe('getAverageCostPerRequest()', () => {
    it('should return 0 when no history exists', () => {
      expect(predictor.getAverageCostPerRequest()).toBe(0);
    });

    it('should return average cost from recent usage', () => {
      const usageHistory = [
        makeUsage({ cost: 0.01 }),
        makeUsage({ cost: 0.02 }),
        makeUsage({ cost: 0.03 }),
      ];

      mockTracker = createMockCostTracker({ recentUsage: usageHistory });
      predictor = new CostPredictor(mockTracker);

      const avg = predictor.getAverageCostPerRequest();
      expect(avg).toBeCloseTo(0.02, 6);
    });

    it('should return exact cost when only one entry exists', () => {
      const usageHistory = [makeUsage({ cost: 0.015 })];

      mockTracker = createMockCostTracker({ recentUsage: usageHistory });
      predictor = new CostPredictor(mockTracker);

      expect(predictor.getAverageCostPerRequest()).toBeCloseTo(0.015, 6);
    });

    it('should handle zero-cost entries', () => {
      const usageHistory = [
        makeUsage({ cost: 0 }),
        makeUsage({ cost: 0 }),
      ];

      mockTracker = createMockCostTracker({ recentUsage: usageHistory });
      predictor = new CostPredictor(mockTracker);

      expect(predictor.getAverageCostPerRequest()).toBe(0);
    });
  });

  describe('getCostTrend()', () => {
    it('should return stable when fewer than 4 entries exist', () => {
      const usageHistory = [makeUsage(), makeUsage()];

      mockTracker = createMockCostTracker({ recentUsage: usageHistory });
      predictor = new CostPredictor(mockTracker);

      expect(predictor.getCostTrend()).toBe('stable');
    });

    it('should return stable when no history exists', () => {
      expect(predictor.getCostTrend()).toBe('stable');
    });

    it('should return increasing when costs are rising', () => {
      const usageHistory = [
        makeUsage({ cost: 0.001 }),
        makeUsage({ cost: 0.001 }),
        makeUsage({ cost: 0.005 }),
        makeUsage({ cost: 0.005 }),
      ];

      mockTracker = createMockCostTracker({ recentUsage: usageHistory });
      predictor = new CostPredictor(mockTracker);

      expect(predictor.getCostTrend()).toBe('increasing');
    });

    it('should return decreasing when costs are falling', () => {
      const usageHistory = [
        makeUsage({ cost: 0.010 }),
        makeUsage({ cost: 0.010 }),
        makeUsage({ cost: 0.002 }),
        makeUsage({ cost: 0.002 }),
      ];

      mockTracker = createMockCostTracker({ recentUsage: usageHistory });
      predictor = new CostPredictor(mockTracker);

      expect(predictor.getCostTrend()).toBe('decreasing');
    });

    it('should return stable when costs are within 20% variance', () => {
      const usageHistory = [
        makeUsage({ cost: 0.010 }),
        makeUsage({ cost: 0.010 }),
        makeUsage({ cost: 0.011 }),
        makeUsage({ cost: 0.011 }),
      ];

      mockTracker = createMockCostTracker({ recentUsage: usageHistory });
      predictor = new CostPredictor(mockTracker);

      expect(predictor.getCostTrend()).toBe('stable');
    });

    it('should handle first half with zero cost', () => {
      const usageHistory = [
        makeUsage({ cost: 0 }),
        makeUsage({ cost: 0 }),
        makeUsage({ cost: 0.01 }),
        makeUsage({ cost: 0.01 }),
      ];

      mockTracker = createMockCostTracker({ recentUsage: usageHistory });
      predictor = new CostPredictor(mockTracker);

      expect(predictor.getCostTrend()).toBe('increasing');
    });

    it('should handle both halves with zero cost', () => {
      const usageHistory = [
        makeUsage({ cost: 0 }),
        makeUsage({ cost: 0 }),
        makeUsage({ cost: 0 }),
        makeUsage({ cost: 0 }),
      ];

      mockTracker = createMockCostTracker({ recentUsage: usageHistory });
      predictor = new CostPredictor(mockTracker);

      expect(predictor.getCostTrend()).toBe('stable');
    });

    it('should handle odd number of entries', () => {
      const usageHistory = [
        makeUsage({ cost: 0.001 }),
        makeUsage({ cost: 0.001 }),
        makeUsage({ cost: 0.001 }),
        makeUsage({ cost: 0.010 }),
        makeUsage({ cost: 0.010 }),
      ];

      mockTracker = createMockCostTracker({ recentUsage: usageHistory });
      predictor = new CostPredictor(mockTracker);

      expect(predictor.getCostTrend()).toBe('increasing');
    });
  });
});
