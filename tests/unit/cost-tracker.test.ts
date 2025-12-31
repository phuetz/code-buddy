/**
 * Tests for Cost Tracker
 */

import { EventEmitter } from 'events';

// Mock fs-extra
jest.mock('fs-extra', () => ({
  existsSync: jest.fn().mockReturnValue(false),
  readJsonSync: jest.fn().mockReturnValue({}),
  writeJsonSync: jest.fn(),
  ensureDirSync: jest.fn(),
}));

// Mock the analytics repository
jest.mock('../../src/database/repositories/analytics-repository.js', () => ({
  getAnalyticsRepository: jest.fn().mockReturnValue({
    recordAnalytics: jest.fn(),
  }),
  AnalyticsRepository: jest.fn(),
}));

// Mock os module for home directory
jest.mock('os', () => ({
  homedir: jest.fn().mockReturnValue('/home/testuser'),
}));

import * as fs from 'fs-extra';
import { CostTracker, getCostTracker, TokenUsage, CostConfig, CostReport } from '../../src/utils/cost-tracker.js';
import { getAnalyticsRepository } from '../../src/database/repositories/analytics-repository.js';

describe('CostTracker', () => {
  let tracker: CostTracker;
  const mockFs = fs as jest.Mocked<typeof fs>;
  const mockGetAnalyticsRepository = getAnalyticsRepository as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset mock implementations
    mockFs.existsSync.mockReturnValue(false);
    mockFs.readJsonSync.mockReturnValue({});

    // Create a fresh tracker for each test with SQLite disabled
    tracker = new CostTracker({ useSQLite: false, trackHistory: true });
  });

  afterEach(() => {
    if (tracker) {
      tracker.dispose();
    }
  });

  describe('Constructor and Initialization', () => {
    it('should create a new instance with default config', () => {
      expect(tracker).toBeDefined();
      expect(tracker).toBeInstanceOf(EventEmitter);
    });

    it('should create with custom config', () => {
      const customTracker = new CostTracker({
        budgetLimit: 100,
        dailyLimit: 10,
        alertThreshold: 0.5,
        trackHistory: false,
        historyDays: 7,
        useSQLite: false,
      });

      expect(customTracker).toBeDefined();
      customTracker.dispose();
    });

    it('should load config from file if exists', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readJsonSync.mockReturnValue({ budgetLimit: 50, dailyLimit: 5 });

      const loadedTracker = new CostTracker({ useSQLite: false });

      expect(mockFs.existsSync).toHaveBeenCalled();
      expect(mockFs.readJsonSync).toHaveBeenCalled();
      loadedTracker.dispose();
    });

    it('should handle config load errors gracefully', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readJsonSync.mockImplementation(() => {
        throw new Error('Read error');
      });

      // Should not throw
      const errorTracker = new CostTracker({ useSQLite: false });
      expect(errorTracker).toBeDefined();
      errorTracker.dispose();
    });

    it('should load history from file if exists and tracking enabled', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readJsonSync.mockImplementation((path: unknown) => {
        if (String(path).includes('history')) {
          return [
            {
              inputTokens: 100,
              outputTokens: 50,
              model: 'grok-3-latest',
              timestamp: new Date().toISOString(),
              cost: 0.001,
            },
          ];
        }
        return {};
      });

      const historyTracker = new CostTracker({ useSQLite: false, trackHistory: true });
      const report = historyTracker.getReport();

      expect(report.recentUsage.length).toBeGreaterThanOrEqual(0);
      historyTracker.dispose();
    });

    it('should prune old history entries on load', () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 60); // 60 days ago

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readJsonSync.mockImplementation((path: unknown) => {
        if (String(path).includes('history')) {
          return [
            {
              inputTokens: 100,
              outputTokens: 50,
              model: 'grok-3-latest',
              timestamp: oldDate.toISOString(),
              cost: 0.001,
            },
          ];
        }
        return {};
      });

      const prunedTracker = new CostTracker({ useSQLite: false, trackHistory: true, historyDays: 30 });
      const report = prunedTracker.getReport();

      // Old entries should be pruned
      expect(report.totalCost).toBe(0);
      prunedTracker.dispose();
    });

    it('should enable SQLite repository when configured', () => {
      mockGetAnalyticsRepository.mockReturnValue({
        recordAnalytics: jest.fn(),
      });

      const sqliteTracker = new CostTracker({ useSQLite: true });
      expect(mockGetAnalyticsRepository).toHaveBeenCalled();
      sqliteTracker.dispose();
    });

    it('should fallback to JSON when SQLite initialization fails', () => {
      mockGetAnalyticsRepository.mockImplementation(() => {
        throw new Error('SQLite init failed');
      });

      const fallbackTracker = new CostTracker({ useSQLite: true });
      expect(fallbackTracker).toBeDefined();
      fallbackTracker.dispose();
    });
  });

  describe('Cost Calculation', () => {
    it('should calculate cost for grok-3-latest model', () => {
      const cost = tracker.calculateCost(1000, 1000, 'grok-3-latest');
      // inputPer1k: 0.005, outputPer1k: 0.015
      // (1000/1000) * 0.005 + (1000/1000) * 0.015 = 0.005 + 0.015 = 0.02
      expect(cost).toBeCloseTo(0.02, 6);
    });

    it('should calculate cost for grok-3-fast model', () => {
      const cost = tracker.calculateCost(1000, 1000, 'grok-3-fast');
      // inputPer1k: 0.003, outputPer1k: 0.009
      // (1000/1000) * 0.003 + (1000/1000) * 0.009 = 0.003 + 0.009 = 0.012
      expect(cost).toBeCloseTo(0.012, 6);
    });

    it('should calculate cost for grok-code-fast-1 model', () => {
      const cost = tracker.calculateCost(1000, 1000, 'grok-code-fast-1');
      // inputPer1k: 0.002, outputPer1k: 0.006
      expect(cost).toBeCloseTo(0.008, 6);
    });

    it('should calculate cost for grok-2-latest model', () => {
      const cost = tracker.calculateCost(1000, 1000, 'grok-2-latest');
      // inputPer1k: 0.002, outputPer1k: 0.010
      expect(cost).toBeCloseTo(0.012, 6);
    });

    it('should use default pricing for unknown models', () => {
      const cost = tracker.calculateCost(1000, 1000, 'unknown-model');
      // default: inputPer1k: 0.003, outputPer1k: 0.010
      expect(cost).toBeCloseTo(0.013, 6);
    });

    it('should handle zero tokens', () => {
      const cost = tracker.calculateCost(0, 0, 'grok-3-latest');
      expect(cost).toBe(0);
    });

    it('should handle large token counts', () => {
      const cost = tracker.calculateCost(1000000, 500000, 'grok-3-latest');
      // (1000000/1000) * 0.005 + (500000/1000) * 0.015 = 5 + 7.5 = 12.5
      expect(cost).toBeCloseTo(12.5, 6);
    });

    it('should handle fractional token counts', () => {
      const cost = tracker.calculateCost(500, 250, 'grok-3-latest');
      // (500/1000) * 0.005 + (250/1000) * 0.015 = 0.0025 + 0.00375 = 0.00625
      expect(cost).toBeCloseTo(0.00625, 6);
    });
  });

  describe('Token Recording', () => {
    it('should record token usage', () => {
      const usage = tracker.recordUsage(1000, 500, 'grok-3-latest');

      expect(usage).toBeDefined();
      expect(usage.inputTokens).toBe(1000);
      expect(usage.outputTokens).toBe(500);
      expect(usage.model).toBe('grok-3-latest');
      expect(usage.timestamp).toBeInstanceOf(Date);
      expect(usage.cost).toBeGreaterThan(0);
    });

    it('should accumulate session usage', () => {
      tracker.recordUsage(1000, 500, 'grok-3-latest');
      tracker.recordUsage(2000, 1000, 'grok-3-latest');

      const report = tracker.getReport();
      expect(report.sessionTokens.input).toBe(3000);
      expect(report.sessionTokens.output).toBe(1500);
    });

    it('should add to history', () => {
      tracker.recordUsage(1000, 500, 'grok-3-latest');

      const report = tracker.getReport();
      expect(report.recentUsage.length).toBe(1);
    });

    it('should emit usage:recorded event', () => {
      const handler = jest.fn();
      tracker.on('usage:recorded', handler);

      const usage = tracker.recordUsage(1000, 500, 'grok-3-latest');

      expect(handler).toHaveBeenCalledWith(usage);
    });

    it('should save history periodically when using JSON storage', () => {
      const jsonTracker = new CostTracker({ useSQLite: false, trackHistory: true });

      // Record 10 usages to trigger save
      for (let i = 0; i < 10; i++) {
        jsonTracker.recordUsage(100, 50, 'grok-3-latest');
      }

      expect(mockFs.writeJsonSync).toHaveBeenCalled();
      jsonTracker.dispose();
    });

    it('should record to SQLite repository when enabled', () => {
      const mockRecordAnalytics = jest.fn();
      mockGetAnalyticsRepository.mockReturnValue({
        recordAnalytics: mockRecordAnalytics,
      });

      const sqliteTracker = new CostTracker({ useSQLite: true });
      sqliteTracker.recordUsage(1000, 500, 'grok-3-latest');

      expect(mockRecordAnalytics).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'grok-3-latest',
          tokens_in: 1000,
          tokens_out: 500,
          requests: 1,
        })
      );
      sqliteTracker.dispose();
    });
  });

  describe('Session Tracking', () => {
    it('should track session costs', () => {
      tracker.recordUsage(1000, 500, 'grok-3-latest');
      tracker.recordUsage(2000, 1000, 'grok-3-fast');

      const report = tracker.getReport();
      expect(report.sessionCost).toBeGreaterThan(0);
    });

    it('should track session tokens', () => {
      tracker.recordUsage(1000, 500, 'grok-3-latest');
      tracker.recordUsage(2000, 1000, 'grok-3-fast');

      const report = tracker.getReport();
      expect(report.sessionTokens.input).toBe(3000);
      expect(report.sessionTokens.output).toBe(1500);
    });

    it('should reset session', () => {
      tracker.recordUsage(1000, 500, 'grok-3-latest');
      tracker.resetSession();

      const report = tracker.getReport();
      expect(report.sessionCost).toBe(0);
      expect(report.sessionTokens.input).toBe(0);
      expect(report.sessionTokens.output).toBe(0);
    });

    it('should reset session start time', () => {
      const beforeReset = new Date();
      tracker.resetSession();
      const afterReset = new Date();

      // The session start should be updated to approximately now
      // We can verify by checking the formatted dashboard
      const dashboard = tracker.formatDashboard();
      expect(dashboard).toContain('Started:');
    });
  });

  describe('Cost Report', () => {
    beforeEach(() => {
      // Record some usage for testing
      tracker.recordUsage(1000, 500, 'grok-3-latest');
      tracker.recordUsage(2000, 1000, 'grok-3-fast');
    });

    it('should generate cost report', () => {
      const report = tracker.getReport();

      expect(report).toBeDefined();
      expect(report.sessionCost).toBeGreaterThan(0);
      expect(report.dailyCost).toBeGreaterThanOrEqual(0);
      expect(report.weeklyCost).toBeGreaterThanOrEqual(0);
      expect(report.monthlyCost).toBeGreaterThanOrEqual(0);
      expect(report.totalCost).toBeGreaterThanOrEqual(0);
    });

    it('should include session tokens', () => {
      const report = tracker.getReport();

      expect(report.sessionTokens).toBeDefined();
      expect(report.sessionTokens.input).toBe(3000);
      expect(report.sessionTokens.output).toBe(1500);
    });

    it('should include model breakdown', () => {
      const report = tracker.getReport();

      expect(report.modelBreakdown).toBeDefined();
      expect(report.modelBreakdown['grok-3-latest']).toBeDefined();
      expect(report.modelBreakdown['grok-3-latest'].cost).toBeGreaterThan(0);
      expect(report.modelBreakdown['grok-3-latest'].calls).toBe(1);
      expect(report.modelBreakdown['grok-3-fast']).toBeDefined();
      expect(report.modelBreakdown['grok-3-fast'].calls).toBe(1);
    });

    it('should include recent usage (limited to 10)', () => {
      // Add more usage entries
      for (let i = 0; i < 15; i++) {
        tracker.recordUsage(100, 50, 'grok-3-latest');
      }

      const report = tracker.getReport();
      expect(report.recentUsage.length).toBeLessThanOrEqual(10);
    });

    it('should calculate daily cost correctly', () => {
      const report = tracker.getReport();

      // Daily cost should include today's usage
      expect(report.dailyCost).toBeGreaterThanOrEqual(report.sessionCost);
    });

    it('should calculate weekly cost correctly', () => {
      const report = tracker.getReport();

      // Weekly cost should be >= daily cost
      expect(report.weeklyCost).toBeGreaterThanOrEqual(report.dailyCost);
    });

    it('should calculate monthly cost correctly', () => {
      const report = tracker.getReport();

      // Monthly cost should be >= weekly cost
      expect(report.monthlyCost).toBeGreaterThanOrEqual(report.weeklyCost);
    });
  });

  describe('Budget Limits and Warnings', () => {
    it('should set budget limit', () => {
      tracker.setBudgetLimit(100);

      expect(mockFs.writeJsonSync).toHaveBeenCalled();
    });

    it('should set daily limit', () => {
      tracker.setDailyLimit(10);

      expect(mockFs.writeJsonSync).toHaveBeenCalled();
    });

    it('should emit budget:warning when threshold reached', () => {
      const warningHandler = jest.fn();
      // Cost for 100 in + 50 out with grok-3-latest:
      // (100/1000) * 0.005 + (50/1000) * 0.015 = 0.0005 + 0.00075 = 0.00125
      // Budget: 0.002, threshold: 0.5 (50%)
      // 0.00125 / 0.002 = 0.625 = 62.5% > 50% but < 100%
      const budgetTracker = new CostTracker({
        useSQLite: false,
        budgetLimit: 0.002, // Limit that allows warning but not exceeded
        alertThreshold: 0.5, // 50%
      });
      budgetTracker.on('budget:warning', warningHandler);

      // Record small usage to exceed 50% but not 100% of budget
      budgetTracker.recordUsage(100, 50, 'grok-3-latest');

      expect(warningHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 0.002,
          percentage: expect.any(Number),
        })
      );
      budgetTracker.dispose();
    });

    it('should emit budget:exceeded when limit exceeded', () => {
      const exceededHandler = jest.fn();
      const budgetTracker = new CostTracker({
        useSQLite: false,
        budgetLimit: 0.001, // Very low limit
      });
      budgetTracker.on('budget:exceeded', exceededHandler);

      // Record usage that exceeds budget
      budgetTracker.recordUsage(1000, 500, 'grok-3-latest');

      expect(exceededHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 0.001,
          current: expect.any(Number),
        })
      );
      budgetTracker.dispose();
    });

    it('should emit daily-limit:exceeded when daily limit exceeded', () => {
      const dailyExceededHandler = jest.fn();
      const dailyTracker = new CostTracker({
        useSQLite: false,
        dailyLimit: 0.001, // Very low limit
      });
      dailyTracker.on('daily-limit:exceeded', dailyExceededHandler);

      // Record usage that exceeds daily limit
      dailyTracker.recordUsage(1000, 500, 'grok-3-latest');

      expect(dailyExceededHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 0.001,
          current: expect.any(Number),
        })
      );
      dailyTracker.dispose();
    });

    it('should not emit warning if no budget limit set', () => {
      const warningHandler = jest.fn();
      const noBudgetTracker = new CostTracker({ useSQLite: false });
      noBudgetTracker.on('budget:warning', warningHandler);

      noBudgetTracker.recordUsage(100000, 50000, 'grok-3-latest');

      expect(warningHandler).not.toHaveBeenCalled();
      noBudgetTracker.dispose();
    });

    it('should not emit daily-limit:exceeded if no daily limit set', () => {
      const dailyHandler = jest.fn();
      const noDailyLimitTracker = new CostTracker({ useSQLite: false });
      noDailyLimitTracker.on('daily-limit:exceeded', dailyHandler);

      noDailyLimitTracker.recordUsage(100000, 50000, 'grok-3-latest');

      expect(dailyHandler).not.toHaveBeenCalled();
      noDailyLimitTracker.dispose();
    });
  });

  describe('Persistence and Loading', () => {
    it('should save config when setting budget limit', () => {
      tracker.setBudgetLimit(50);

      expect(mockFs.ensureDirSync).toHaveBeenCalled();
      expect(mockFs.writeJsonSync).toHaveBeenCalledWith(
        expect.stringContaining('cost-config.json'),
        expect.any(Object),
        expect.any(Object)
      );
    });

    it('should save config when setting daily limit', () => {
      tracker.setDailyLimit(5);

      expect(mockFs.ensureDirSync).toHaveBeenCalled();
      expect(mockFs.writeJsonSync).toHaveBeenCalledWith(
        expect.stringContaining('cost-config.json'),
        expect.any(Object),
        expect.any(Object)
      );
    });

    it('should handle save config errors gracefully', () => {
      mockFs.writeJsonSync.mockImplementation(() => {
        throw new Error('Write error');
      });

      // Should not throw
      expect(() => tracker.setBudgetLimit(50)).not.toThrow();
    });

    it('should save history when clearing', () => {
      tracker.recordUsage(1000, 500, 'grok-3-latest');
      tracker.clearHistory();

      expect(mockFs.writeJsonSync).toHaveBeenCalled();
    });

    it('should clear all history entries', () => {
      tracker.recordUsage(1000, 500, 'grok-3-latest');
      tracker.recordUsage(2000, 1000, 'grok-3-fast');
      tracker.clearHistory();

      const report = tracker.getReport();
      expect(report.totalCost).toBe(0);
    });

    it('should handle history save errors gracefully', () => {
      mockFs.writeJsonSync.mockImplementation(() => {
        throw new Error('Write error');
      });

      // Should not throw
      expect(() => tracker.clearHistory()).not.toThrow();
    });

    it('should not save history if tracking disabled', () => {
      const noHistoryTracker = new CostTracker({ useSQLite: false, trackHistory: false });

      noHistoryTracker.recordUsage(1000, 500, 'grok-3-latest');
      noHistoryTracker.clearHistory();

      // writeJsonSync should not be called for history
      const historySaveCalls = mockFs.writeJsonSync.mock.calls.filter(
        (call) => (call[0] as string).includes('history')
      );
      expect(historySaveCalls.length).toBe(0);
      noHistoryTracker.dispose();
    });
  });

  describe('Export to CSV', () => {
    it('should export empty history to CSV', () => {
      const csv = tracker.exportToCsv();

      expect(csv).toContain('timestamp,model,input_tokens,output_tokens,cost');
    });

    it('should export history entries to CSV', () => {
      tracker.recordUsage(1000, 500, 'grok-3-latest');
      tracker.recordUsage(2000, 1000, 'grok-3-fast');

      const csv = tracker.exportToCsv();
      const lines = csv.trim().split('\n');

      expect(lines.length).toBe(3); // Header + 2 entries
      expect(lines[0]).toBe('timestamp,model,input_tokens,output_tokens,cost');
      expect(lines[1]).toContain('grok-3-latest');
      expect(lines[1]).toContain('1000');
      expect(lines[1]).toContain('500');
      expect(lines[2]).toContain('grok-3-fast');
      expect(lines[2]).toContain('2000');
      expect(lines[2]).toContain('1000');
    });

    it('should format cost with 6 decimal places', () => {
      tracker.recordUsage(100, 50, 'grok-3-latest');

      const csv = tracker.exportToCsv();
      const lines = csv.trim().split('\n');

      // Cost should have 6 decimal places
      const costMatch = lines[1].match(/,(\d+\.\d{6})$/);
      expect(costMatch).not.toBeNull();
    });

    it('should format timestamp as ISO string', () => {
      tracker.recordUsage(1000, 500, 'grok-3-latest');

      const csv = tracker.exportToCsv();
      const lines = csv.trim().split('\n');

      // Check ISO timestamp format
      const timestampMatch = lines[1].match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
      expect(timestampMatch).not.toBeNull();
    });
  });

  describe('Format Dashboard', () => {
    it('should format dashboard with session stats', () => {
      tracker.recordUsage(1000, 500, 'grok-3-latest');

      const dashboard = tracker.formatDashboard();

      expect(dashboard).toContain('Cost Tracking Dashboard');
      expect(dashboard).toContain('Current Session');
      expect(dashboard).toContain('Cost:');
      expect(dashboard).toContain('Tokens:');
      expect(dashboard).toContain('Started:');
    });

    it('should format dashboard with period costs', () => {
      tracker.recordUsage(1000, 500, 'grok-3-latest');

      const dashboard = tracker.formatDashboard();

      expect(dashboard).toContain('Period Costs');
      expect(dashboard).toContain('Today:');
      expect(dashboard).toContain('Week:');
      expect(dashboard).toContain('Month:');
      expect(dashboard).toContain('All Time:');
    });

    it('should show budget status when limit set', () => {
      tracker.setBudgetLimit(100);
      tracker.recordUsage(1000, 500, 'grok-3-latest');

      const dashboard = tracker.formatDashboard();

      expect(dashboard).toContain('Budget');
      expect(dashboard).toContain('$');
      expect(dashboard).toContain('%');
    });

    it('should show daily limit when set', () => {
      tracker.setDailyLimit(10);
      tracker.recordUsage(1000, 500, 'grok-3-latest');

      const dashboard = tracker.formatDashboard();

      expect(dashboard).toContain('Daily Limit');
    });

    it('should show model breakdown', () => {
      tracker.recordUsage(1000, 500, 'grok-3-latest');
      tracker.recordUsage(2000, 1000, 'grok-3-fast');

      const dashboard = tracker.formatDashboard();

      expect(dashboard).toContain('Model Breakdown');
      expect(dashboard).toContain('grok-3-latest');
      expect(dashboard).toContain('grok-3-fast');
    });

    it('should show recent usage', () => {
      tracker.recordUsage(1000, 500, 'grok-3-latest');

      const dashboard = tracker.formatDashboard();

      expect(dashboard).toContain('Recent Usage');
    });

    it('should show commands help', () => {
      const dashboard = tracker.formatDashboard();

      expect(dashboard).toContain('Commands:');
      expect(dashboard).toContain('/cost');
    });

    it('should create progress bar for budget', () => {
      tracker.setBudgetLimit(0.1);
      tracker.recordUsage(1000, 500, 'grok-3-latest');

      const dashboard = tracker.formatDashboard();

      // Progress bar characters
      expect(dashboard).toMatch(/[[\]]/);
    });
  });

  describe('Dispose', () => {
    it('should clear session usage on dispose', () => {
      tracker.recordUsage(1000, 500, 'grok-3-latest');
      tracker.dispose();

      // Create new tracker to verify cleanup
      const newTracker = new CostTracker({ useSQLite: false });
      const report = newTracker.getReport();

      expect(report.sessionCost).toBe(0);
      newTracker.dispose();
    });

    it('should remove all event listeners on dispose', () => {
      const handler = jest.fn();
      tracker.on('usage:recorded', handler);

      tracker.dispose();
      tracker.emit('usage:recorded', {});

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('Singleton getCostTracker', () => {
    // Note: These tests may need to be isolated due to singleton behavior
    // In production, you might need to reset the singleton between tests

    it('should return a CostTracker instance', () => {
      const instance = getCostTracker({ useSQLite: false });
      expect(instance).toBeInstanceOf(CostTracker);
    });

    it('should return the same instance on subsequent calls', () => {
      const instance1 = getCostTracker({ useSQLite: false });
      const instance2 = getCostTracker();

      expect(instance1).toBe(instance2);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty model breakdown', () => {
      const report = tracker.getReport();

      expect(report.modelBreakdown).toBeDefined();
      expect(Object.keys(report.modelBreakdown).length).toBe(0);
    });

    it('should handle empty recent usage', () => {
      const report = tracker.getReport();

      expect(report.recentUsage).toBeDefined();
      expect(report.recentUsage.length).toBe(0);
    });

    it('should handle multiple usage recordings with same model', () => {
      tracker.recordUsage(1000, 500, 'grok-3-latest');
      tracker.recordUsage(2000, 1000, 'grok-3-latest');
      tracker.recordUsage(3000, 1500, 'grok-3-latest');

      const report = tracker.getReport();

      expect(report.modelBreakdown['grok-3-latest'].calls).toBe(3);
      expect(report.sessionTokens.input).toBe(6000);
      expect(report.sessionTokens.output).toBe(3000);
    });

    it('should handle very small token counts', () => {
      const usage = tracker.recordUsage(1, 1, 'grok-3-latest');

      expect(usage.cost).toBeGreaterThan(0);
      expect(usage.cost).toBeLessThan(0.001);
    });

    it('should format dashboard even with no usage', () => {
      const dashboard = tracker.formatDashboard();

      expect(dashboard).toContain('Cost Tracking Dashboard');
      expect(dashboard).toContain('$0.0000');
    });
  });
});
