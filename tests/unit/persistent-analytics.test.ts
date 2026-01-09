/**
 * Tests for Persistent Analytics
 */

import { EventEmitter } from 'events';

// Mock the analytics repository
const mockAnalyticsRepo = {
  recordAnalytics: jest.fn(),
  getAnalytics: jest.fn().mockReturnValue([]),
  getTotalCost: jest.fn().mockReturnValue(0),
  getDailySummary: jest.fn().mockReturnValue([]),
  deleteOldAnalytics: jest.fn().mockReturnValue(0),
};

jest.mock('../../src/database/repositories/analytics-repository', () => ({
  getAnalyticsRepository: () => mockAnalyticsRepo,
}));

import {
  PersistentAnalytics,
  getPersistentAnalytics,
  resetPersistentAnalytics,
  UsageEvent,
  CostBudget,
  AnalyticsSummary,
} from '../../src/analytics/persistent-analytics';

describe('PersistentAnalytics', () => {
  let analytics: PersistentAnalytics;

  beforeEach(() => {
    jest.clearAllMocks();
    resetPersistentAnalytics();
    analytics = new PersistentAnalytics();
  });

  describe('Constructor', () => {
    it('should create with default budget', () => {
      const instance = new PersistentAnalytics();
      expect(instance).toBeDefined();
      expect(instance).toBeInstanceOf(EventEmitter);
    });

    it('should accept custom budget', () => {
      const customBudget: CostBudget = {
        daily: 20,
        weekly: 100,
        monthly: 300,
        session: 10,
      };
      const instance = new PersistentAnalytics(customBudget);
      expect(instance).toBeDefined();
    });

    it('should merge custom budget with defaults', () => {
      const partialBudget = { daily: 25 };
      const instance = new PersistentAnalytics(partialBudget);

      const status = instance.getBudgetStatus();
      expect(status.daily.limit).toBe(25);
      expect(status.weekly.limit).toBe(50); // Default
    });
  });

  describe('record', () => {
    it('should record usage event', () => {
      const event: UsageEvent = {
        model: 'grok-2',
        tokensIn: 1000,
        tokensOut: 500,
        cost: 0.05,
        responseTimeMs: 200,
        cacheHit: false,
      };

      analytics.record(event);

      expect(mockAnalyticsRepo.recordAnalytics).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'grok-2',
          tokens_in: 1000,
          tokens_out: 500,
          cost: 0.05,
          requests: 1,
        })
      );
    });

    it('should track session cost', () => {
      analytics.record({
        model: 'grok-2',
        tokensIn: 1000,
        tokensOut: 500,
        cost: 0.05,
        responseTimeMs: 200,
        cacheHit: false,
      });

      analytics.record({
        model: 'grok-2',
        tokensIn: 500,
        tokensOut: 250,
        cost: 0.03,
        responseTimeMs: 150,
        cacheHit: false,
      });

      expect(analytics.getSessionCost()).toBe(0.08);
    });

    it('should record tool calls count', () => {
      analytics.record({
        model: 'grok-2',
        tokensIn: 1000,
        tokensOut: 500,
        cost: 0.05,
        responseTimeMs: 200,
        cacheHit: false,
        toolCalls: 3,
      });

      expect(mockAnalyticsRepo.recordAnalytics).toHaveBeenCalledWith(
        expect.objectContaining({
          tool_calls: 3,
        })
      );
    });

    it('should record errors', () => {
      analytics.record({
        model: 'grok-2',
        tokensIn: 1000,
        tokensOut: 0,
        cost: 0.01,
        responseTimeMs: 100,
        cacheHit: false,
        error: true,
      });

      expect(mockAnalyticsRepo.recordAnalytics).toHaveBeenCalledWith(
        expect.objectContaining({
          errors: 1,
        })
      );
    });

    it('should record project ID when provided', () => {
      analytics.record({
        model: 'grok-2',
        tokensIn: 1000,
        tokensOut: 500,
        cost: 0.05,
        responseTimeMs: 200,
        cacheHit: false,
        projectId: 'my-project',
      });

      expect(mockAnalyticsRepo.recordAnalytics).toHaveBeenCalledWith(
        expect.objectContaining({
          project_id: 'my-project',
        })
      );
    });

    it('should emit usage:recorded event', () => {
      const handler = jest.fn();
      analytics.on('usage:recorded', handler);

      const event: UsageEvent = {
        model: 'grok-2',
        tokensIn: 1000,
        tokensOut: 500,
        cost: 0.05,
        responseTimeMs: 200,
        cacheHit: false,
      };

      analytics.record(event);

      expect(handler).toHaveBeenCalledWith(event);
    });

    it('should emit budget:alert when approaching limit', () => {
      const handler = jest.fn();
      analytics.on('budget:alert', handler);

      // Set a low session budget
      analytics.setBudget({ session: 0.05 });

      // Record event that exceeds 80% of budget
      analytics.record({
        model: 'grok-2',
        tokensIn: 1000,
        tokensOut: 500,
        cost: 0.05, // 100% of session budget
        responseTimeMs: 200,
        cacheHit: false,
      });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'exceeded',
          budget: 'session',
        })
      );
    });
  });

  describe('recordSession', () => {
    it('should record new session', () => {
      analytics.recordSession();

      expect(mockAnalyticsRepo.recordAnalytics).toHaveBeenCalledWith(
        expect.objectContaining({
          session_count: 1,
          requests: 0,
          cost: 0,
        })
      );
    });

    it('should reset session cost', () => {
      analytics.record({
        model: 'grok-2',
        tokensIn: 1000,
        tokensOut: 500,
        cost: 0.05,
        responseTimeMs: 200,
        cacheHit: false,
      });

      expect(analytics.getSessionCost()).toBe(0.05);

      analytics.recordSession();

      expect(analytics.getSessionCost()).toBe(0);
    });

    it('should emit session:started event', () => {
      const handler = jest.fn();
      analytics.on('session:started', handler);

      analytics.recordSession();

      expect(handler).toHaveBeenCalled();
    });

    it('should record project ID with session', () => {
      analytics.recordSession('test-project');

      expect(mockAnalyticsRepo.recordAnalytics).toHaveBeenCalledWith(
        expect.objectContaining({
          project_id: 'test-project',
        })
      );
    });
  });

  describe('calculateCost', () => {
    it('should calculate cost for grok model', () => {
      const cost = analytics.calculateCost('grok', 1000000, 500000);
      // grok: input $5/M, output $15/M
      // (1M * 5 + 0.5M * 15) / 1M = 5 + 7.5 = $12.50
      expect(cost).toBeCloseTo(12.5);
    });

    it('should calculate cost for grok-2', () => {
      const cost = analytics.calculateCost('grok-2', 1000000, 500000);
      // grok-2: input $10/M, output $30/M
      expect(cost).toBeCloseTo(25);
    });

    it('should calculate cost for gpt-4o-mini', () => {
      const cost = analytics.calculateCost('gpt-4o-mini', 1000000, 1000000);
      // gpt-4o-mini: input $0.15/M, output $0.6/M
      expect(cost).toBeCloseTo(0.75);
    });

    it('should fall back to grok pricing for unknown models', () => {
      const cost = analytics.calculateCost('unknown-model', 1000000, 500000);
      expect(cost).toBeCloseTo(12.5); // Same as grok
    });
  });

  describe('Cost tracking', () => {
    describe('getSessionCost', () => {
      it('should return current session cost', () => {
        expect(analytics.getSessionCost()).toBe(0);

        analytics.record({
          model: 'grok-2',
          tokensIn: 1000,
          tokensOut: 500,
          cost: 0.05,
          responseTimeMs: 200,
          cacheHit: false,
        });

        expect(analytics.getSessionCost()).toBe(0.05);
      });
    });

    describe('getDailyCost', () => {
      it('should query repository for daily cost', () => {
        mockAnalyticsRepo.getTotalCost.mockReturnValue(5.50);

        const cost = analytics.getDailyCost();

        expect(mockAnalyticsRepo.getTotalCost).toHaveBeenCalled();
        expect(cost).toBe(5.50);
      });

      it('should accept specific date', () => {
        analytics.getDailyCost('2024-01-15');

        expect(mockAnalyticsRepo.getTotalCost).toHaveBeenCalledWith({
          startDate: '2024-01-15',
          endDate: '2024-01-15',
        });
      });
    });

    describe('getWeeklyCost', () => {
      it('should query repository for weekly cost', () => {
        mockAnalyticsRepo.getTotalCost.mockReturnValue(25.00);

        const cost = analytics.getWeeklyCost();

        expect(cost).toBe(25.00);
      });
    });

    describe('getMonthlyCost', () => {
      it('should query repository for monthly cost', () => {
        mockAnalyticsRepo.getTotalCost.mockReturnValue(100.00);

        const cost = analytics.getMonthlyCost();

        expect(cost).toBe(100.00);
      });
    });
  });

  describe('getSummary', () => {
    it('should return empty summary when no analytics', () => {
      mockAnalyticsRepo.getAnalytics.mockReturnValue([]);

      const summary = analytics.getSummary();

      expect(summary.totalCost).toBe(0);
      expect(summary.totalRequests).toBe(0);
      expect(summary.totalTokens).toEqual({ in: 0, out: 0 });
      expect(summary.trend).toBe('stable');
    });

    it('should aggregate analytics correctly', () => {
      mockAnalyticsRepo.getAnalytics.mockReturnValue([
        {
          date: '2024-01-15',
          model: 'grok-2',
          tokens_in: 1000,
          tokens_out: 500,
          cost: 0.05,
          requests: 5,
          tool_calls: 10,
          errors: 1,
          avg_response_time_ms: 200,
          cache_hit_rate: 0.5,
        },
        {
          date: '2024-01-16',
          model: 'grok-2',
          tokens_in: 2000,
          tokens_out: 1000,
          cost: 0.10,
          requests: 10,
          tool_calls: 20,
          errors: 0,
          avg_response_time_ms: 180,
          cache_hit_rate: 0.8,
        },
      ]);

      const summary = analytics.getSummary();

      expect(summary.totalCost).toBeCloseTo(0.15);
      expect(summary.totalRequests).toBe(15);
      expect(summary.totalTokens.in).toBe(3000);
      expect(summary.totalTokens.out).toBe(1500);
    });

    it('should calculate error rate', () => {
      mockAnalyticsRepo.getAnalytics.mockReturnValue([
        {
          date: '2024-01-15',
          model: 'grok-2',
          tokens_in: 1000,
          tokens_out: 500,
          cost: 0.05,
          requests: 10,
          tool_calls: 5,
          errors: 2,
          avg_response_time_ms: 200,
          cache_hit_rate: 0.5,
        },
      ]);

      const summary = analytics.getSummary();

      expect(summary.errorRate).toBeCloseTo(0.2); // 2/10
    });

    it('should break down by model', () => {
      mockAnalyticsRepo.getAnalytics.mockReturnValue([
        {
          date: '2024-01-15',
          model: 'grok-2',
          tokens_in: 1000,
          tokens_out: 500,
          cost: 0.05,
          requests: 5,
          tool_calls: 0,
          errors: 0,
          avg_response_time_ms: 200,
          cache_hit_rate: 0,
        },
        {
          date: '2024-01-15',
          model: 'grok-3',
          tokens_in: 2000,
          tokens_out: 1000,
          cost: 0.10,
          requests: 3,
          tool_calls: 0,
          errors: 0,
          avg_response_time_ms: 150,
          cache_hit_rate: 0,
        },
      ]);

      const summary = analytics.getSummary();

      expect(summary.byModel['grok-2']).toEqual({ cost: 0.05, requests: 5 });
      expect(summary.byModel['grok-3']).toEqual({ cost: 0.10, requests: 3 });
    });

    it('should calculate trend as increasing', () => {
      mockAnalyticsRepo.getAnalytics.mockReturnValue([
        { date: '2024-01-10', cost: 1, requests: 1, tokens_in: 0, tokens_out: 0, tool_calls: 0, errors: 0, avg_response_time_ms: 0, cache_hit_rate: 0 },
        { date: '2024-01-11', cost: 1.5, requests: 1, tokens_in: 0, tokens_out: 0, tool_calls: 0, errors: 0, avg_response_time_ms: 0, cache_hit_rate: 0 },
        { date: '2024-01-12', cost: 2, requests: 1, tokens_in: 0, tokens_out: 0, tool_calls: 0, errors: 0, avg_response_time_ms: 0, cache_hit_rate: 0 },
        { date: '2024-01-13', cost: 3, requests: 1, tokens_in: 0, tokens_out: 0, tool_calls: 0, errors: 0, avg_response_time_ms: 0, cache_hit_rate: 0 },
      ]);

      const summary = analytics.getSummary();

      expect(summary.trend).toBe('increasing');
    });

    it('should calculate trend as decreasing', () => {
      mockAnalyticsRepo.getAnalytics.mockReturnValue([
        { date: '2024-01-10', cost: 3, requests: 1, tokens_in: 0, tokens_out: 0, tool_calls: 0, errors: 0, avg_response_time_ms: 0, cache_hit_rate: 0 },
        { date: '2024-01-11', cost: 2, requests: 1, tokens_in: 0, tokens_out: 0, tool_calls: 0, errors: 0, avg_response_time_ms: 0, cache_hit_rate: 0 },
        { date: '2024-01-12', cost: 1.5, requests: 1, tokens_in: 0, tokens_out: 0, tool_calls: 0, errors: 0, avg_response_time_ms: 0, cache_hit_rate: 0 },
        { date: '2024-01-13', cost: 1, requests: 1, tokens_in: 0, tokens_out: 0, tool_calls: 0, errors: 0, avg_response_time_ms: 0, cache_hit_rate: 0 },
      ]);

      const summary = analytics.getSummary();

      expect(summary.trend).toBe('decreasing');
    });

    it('should filter by date range', () => {
      analytics.getSummary({
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      });

      expect(mockAnalyticsRepo.getAnalytics).toHaveBeenCalledWith({
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      });
    });
  });

  describe('getDailySummaries', () => {
    it('should return daily summaries', () => {
      mockAnalyticsRepo.getDailySummary.mockReturnValue([
        { date: '2024-01-15', totalCost: 5.00, totalRequests: 100, totalTokens: 50000 },
        { date: '2024-01-14', totalCost: 4.50, totalRequests: 90, totalTokens: 45000 },
      ]);

      const summaries = analytics.getDailySummaries(30);

      expect(mockAnalyticsRepo.getDailySummary).toHaveBeenCalledWith(30);
      expect(summaries.length).toBe(2);
      expect(summaries[0]).toEqual({
        date: '2024-01-15',
        cost: 5.00,
        requests: 100,
        tokens: 50000,
      });
    });
  });

  describe('getBudgetStatus', () => {
    it('should return budget status for all periods', () => {
      mockAnalyticsRepo.getTotalCost.mockReturnValue(5.00);

      const status = analytics.getBudgetStatus();

      expect(status.daily).toBeDefined();
      expect(status.weekly).toBeDefined();
      expect(status.monthly).toBeDefined();
      expect(status.session).toBeDefined();
    });

    it('should calculate percentage correctly', () => {
      mockAnalyticsRepo.getTotalCost.mockReturnValue(5.00);
      analytics.setBudget({ daily: 10 });

      const status = analytics.getBudgetStatus();

      expect(status.daily.percentage).toBe(50);
      expect(status.daily.remaining).toBe(5);
    });

    it('should handle session cost separately', () => {
      analytics.record({
        model: 'grok-2',
        tokensIn: 1000,
        tokensOut: 500,
        cost: 2.50,
        responseTimeMs: 200,
        cacheHit: false,
      });

      analytics.setBudget({ session: 5 });

      const status = analytics.getBudgetStatus();

      expect(status.session.used).toBe(2.50);
      expect(status.session.percentage).toBe(50);
    });
  });

  describe('setBudget', () => {
    it('should update budget limits', () => {
      analytics.setBudget({
        daily: 25,
        weekly: 100,
      });

      const status = analytics.getBudgetStatus();

      expect(status.daily.limit).toBe(25);
      expect(status.weekly.limit).toBe(100);
    });

    it('should emit budget:updated event', () => {
      const handler = jest.fn();
      analytics.on('budget:updated', handler);

      analytics.setBudget({ daily: 30 });

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('export', () => {
    it('should export analytics data', () => {
      mockAnalyticsRepo.getAnalytics.mockReturnValue([
        {
          date: '2024-01-15',
          model: 'grok-2',
          tokens_in: 1000,
          tokens_out: 500,
          cost: 0.05,
          requests: 5,
          tool_calls: 10,
          errors: 0,
          avg_response_time_ms: 200,
          cache_hit_rate: 0.5,
          session_count: 1,
        },
      ]);

      const data = analytics.export();

      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(1);
    });

    it('should accept filter options', () => {
      analytics.export({ startDate: '2024-01-01' });

      expect(mockAnalyticsRepo.getAnalytics).toHaveBeenCalledWith({
        startDate: '2024-01-01',
      });
    });
  });

  describe('exportCSV', () => {
    it('should export analytics as CSV', () => {
      mockAnalyticsRepo.getAnalytics.mockReturnValue([
        {
          date: '2024-01-15',
          project_id: 'test',
          model: 'grok-2',
          tokens_in: 1000,
          tokens_out: 500,
          cost: 0.0500,
          requests: 5,
          tool_calls: 10,
          errors: 0,
          avg_response_time_ms: 200,
          cache_hit_rate: 0.5,
          session_count: 1,
        },
      ]);

      const csv = analytics.exportCSV();

      expect(csv).toContain('date,project_id,model,tokens_in,tokens_out');
      expect(csv).toContain('2024-01-15');
      expect(csv).toContain('grok-2');
    });

    it('should handle empty project_id', () => {
      mockAnalyticsRepo.getAnalytics.mockReturnValue([
        {
          date: '2024-01-15',
          project_id: null,
          model: 'grok-2',
          tokens_in: 1000,
          tokens_out: 500,
          cost: 0.05,
          requests: 5,
          tool_calls: 10,
          errors: 0,
          avg_response_time_ms: 200,
          cache_hit_rate: 0.5,
          session_count: 1,
        },
      ]);

      const csv = analytics.exportCSV();

      expect(csv).toBeDefined();
      // Should handle null project_id gracefully
    });
  });

  describe('formatDashboard', () => {
    it('should format dashboard for display', () => {
      mockAnalyticsRepo.getTotalCost.mockReturnValue(5.00);
      mockAnalyticsRepo.getAnalytics.mockReturnValue([
        {
          date: '2024-01-15',
          model: 'grok-2',
          tokens_in: 1000,
          tokens_out: 500,
          cost: 5.00,
          requests: 50,
          tool_calls: 100,
          errors: 2,
          avg_response_time_ms: 200,
          cache_hit_rate: 0.8,
        },
      ]);

      const dashboard = analytics.formatDashboard();

      expect(dashboard).toContain('Analytics Dashboard');
      expect(dashboard).toContain('Budget Status');
      expect(dashboard).toContain('Last 30 Days');
    });

    it('should show budget percentages', () => {
      mockAnalyticsRepo.getTotalCost.mockReturnValue(5.00);
      analytics.setBudget({ session: 10 });

      analytics.record({
        model: 'grok-2',
        tokensIn: 1000,
        tokensOut: 500,
        cost: 2.00,
        responseTimeMs: 200,
        cacheHit: false,
      });

      const dashboard = analytics.formatDashboard();

      expect(dashboard).toContain('%');
    });

    it('should show model breakdown', () => {
      mockAnalyticsRepo.getAnalytics.mockReturnValue([
        {
          date: '2024-01-15',
          model: 'grok-2',
          tokens_in: 1000,
          tokens_out: 500,
          cost: 0.05,
          requests: 5,
          tool_calls: 0,
          errors: 0,
          avg_response_time_ms: 0,
          cache_hit_rate: 0,
        },
      ]);

      const dashboard = analytics.formatDashboard();

      expect(dashboard).toContain('By Model');
    });
  });

  describe('cleanup', () => {
    it('should delete old analytics', () => {
      mockAnalyticsRepo.deleteOldAnalytics.mockReturnValue(100);

      const deleted = analytics.cleanup(90);

      expect(mockAnalyticsRepo.deleteOldAnalytics).toHaveBeenCalledWith(90);
      expect(deleted).toBe(100);
    });

    it('should use default retention days', () => {
      analytics.cleanup();

      expect(mockAnalyticsRepo.deleteOldAnalytics).toHaveBeenCalledWith(90);
    });
  });

  describe('Singleton', () => {
    it('should return same instance with getPersistentAnalytics', () => {
      resetPersistentAnalytics();

      const instance1 = getPersistentAnalytics();
      const instance2 = getPersistentAnalytics();

      expect(instance1).toBe(instance2);
    });

    it('should create new instance after reset', () => {
      resetPersistentAnalytics();
      const instance1 = getPersistentAnalytics();

      resetPersistentAnalytics();
      const instance2 = getPersistentAnalytics();

      expect(instance1).not.toBe(instance2);
    });

    it('should accept budget on first call', () => {
      resetPersistentAnalytics();

      const instance = getPersistentAnalytics({ daily: 100 });

      const status = instance.getBudgetStatus();
      expect(status.daily.limit).toBe(100);
    });
  });

  describe('resetPersistentAnalytics', () => {
    it('should remove all listeners', () => {
      resetPersistentAnalytics();
      const instance = getPersistentAnalytics();

      const handler = jest.fn();
      instance.on('usage:recorded', handler);

      resetPersistentAnalytics();

      // After reset, old instance should not emit to handler
      instance.emit('usage:recorded', {});
      // The handler should not be called because listeners were removed
    });
  });

  describe('Edge cases', () => {
    it('should handle zero budget limit', () => {
      analytics.setBudget({ session: 0 });

      const status = analytics.getBudgetStatus();

      expect(status.session.percentage).toBe(0);
    });

    it('should handle analytics with no model', () => {
      mockAnalyticsRepo.getAnalytics.mockReturnValue([
        {
          date: '2024-01-15',
          model: null,
          tokens_in: 0,
          tokens_out: 0,
          cost: 0,
          requests: 0,
          tool_calls: 0,
          errors: 0,
          avg_response_time_ms: 0,
          cache_hit_rate: 0,
        },
      ]);

      const summary = analytics.getSummary();

      // Should not add null model to byModel
      expect(Object.keys(summary.byModel).length).toBe(0);
    });

    it('should format period correctly', () => {
      mockAnalyticsRepo.getAnalytics.mockReturnValue([]);

      // Test with start and end date
      let summary = analytics.getSummary({ startDate: '2024-01-01', endDate: '2024-01-31' });
      expect(summary.period).toContain('2024-01-01');
      expect(summary.period).toContain('2024-01-31');

      // Test with only start date
      summary = analytics.getSummary({ startDate: '2024-01-01' });
      expect(summary.period).toContain('From');

      // Test with only end date
      summary = analytics.getSummary({ endDate: '2024-01-31' });
      expect(summary.period).toContain('Until');

      // Test with no dates
      summary = analytics.getSummary({});
      expect(summary.period).toBe('All time');
    });

    it('should handle single analytics record for trend', () => {
      mockAnalyticsRepo.getAnalytics.mockReturnValue([
        {
          date: '2024-01-15',
          cost: 5,
          requests: 10,
          tokens_in: 1000,
          tokens_out: 500,
          tool_calls: 5,
          errors: 0,
          avg_response_time_ms: 200,
          cache_hit_rate: 0.5,
        },
      ]);

      const summary = analytics.getSummary();

      expect(summary.trend).toBe('stable');
    });

    it('should handle cache hit calculation', () => {
      mockAnalyticsRepo.getAnalytics.mockReturnValue([
        {
          date: '2024-01-15',
          model: 'grok-2',
          tokens_in: 1000,
          tokens_out: 500,
          cost: 0.05,
          requests: 10,
          tool_calls: 5,
          errors: 0,
          avg_response_time_ms: 200,
          cache_hit_rate: 0.8,
        },
      ]);

      const summary = analytics.getSummary();

      // Cache hit rate is weighted by requests
      expect(summary.cacheHitRate).toBeCloseTo(0.8);
    });
  });
});
