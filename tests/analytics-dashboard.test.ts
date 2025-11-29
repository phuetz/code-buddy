/**
 * Tests for Analytics Dashboard
 */

import { AnalyticsDashboard, getAnalyticsDashboard, resetAnalyticsDashboard } from '../src/analytics/dashboard';

// Mock fs-extra
jest.mock('fs-extra', () => ({
  ensureDir: jest.fn().mockResolvedValue(undefined),
  pathExists: jest.fn().mockResolvedValue(false),
  readJSON: jest.fn().mockResolvedValue({}),
  writeJSON: jest.fn().mockResolvedValue(undefined),
  emptyDir: jest.fn().mockResolvedValue(undefined),
}));

describe('AnalyticsDashboard', () => {
  let dashboard: AnalyticsDashboard;

  beforeEach(() => {
    resetAnalyticsDashboard();
    dashboard = new AnalyticsDashboard({
      enabled: true,
      retentionDays: 30,
    });
  });

  afterEach(() => {
    dashboard.dispose();
  });

  describe('Constructor', () => {
    it('should create with default config', () => {
      const d = new AnalyticsDashboard();
      expect(d).toBeDefined();
      d.dispose();
    });

    it('should accept custom config', () => {
      const config = dashboard.getConfig();
      expect(config.enabled).toBe(true);
      expect(config.retentionDays).toBe(30);
    });
  });

  describe('Session tracking', () => {
    it('should start a session', () => {
      const sessionId = dashboard.startSession('grok-3');
      expect(sessionId).toBeDefined();
      expect(sessionId).toMatch(/^session_/);
    });

    it('should end a session', () => {
      dashboard.startSession('grok-3');
      dashboard.endSession();
      // No error thrown
    });
  });

  describe('Message tracking', () => {
    it('should track messages', () => {
      dashboard.startSession('grok-3');
      dashboard.trackMessage(100, 200);

      const metrics = dashboard.getUsageMetrics();
      expect(metrics.totalMessages).toBe(1);
      expect(metrics.totalTokensInput).toBe(100);
      expect(metrics.totalTokensOutput).toBe(200);
    });
  });

  describe('Tool tracking', () => {
    it('should track tool calls', () => {
      dashboard.startSession('grok-3');
      dashboard.trackToolCall('Edit', true, 150);
      dashboard.trackToolCall('Read', true, 50);
      dashboard.trackToolCall('Edit', false, 100);

      const tools = dashboard.getToolMetrics();
      expect(tools.length).toBeGreaterThan(0);

      const editTool = tools.find(t => t.name === 'Edit');
      expect(editTool?.callCount).toBe(2);
      expect(editTool?.successCount).toBe(1);
      expect(editTool?.errorCount).toBe(1);
    });
  });

  describe('getUsageMetrics', () => {
    it('should return usage metrics', () => {
      const metrics = dashboard.getUsageMetrics();

      expect(metrics).toHaveProperty('totalSessions');
      expect(metrics).toHaveProperty('totalMessages');
      expect(metrics).toHaveProperty('totalTokensInput');
      expect(metrics).toHaveProperty('totalTokensOutput');
      expect(metrics).toHaveProperty('totalToolCalls');
    });

    it('should accumulate across sessions', () => {
      dashboard.startSession('grok-3');
      dashboard.trackMessage(100, 200);
      dashboard.endSession();

      dashboard.startSession('grok-3');
      dashboard.trackMessage(150, 250);
      dashboard.endSession();

      const metrics = dashboard.getUsageMetrics();
      expect(metrics.totalMessages).toBe(2);
      expect(metrics.totalTokensInput).toBe(250);
    });
  });

  describe('getCostMetrics', () => {
    it('should return cost metrics', () => {
      dashboard.startSession('grok-3');
      dashboard.trackMessage(1000000, 500000); // 1M input, 0.5M output
      dashboard.endSession();

      const costs = dashboard.getCostMetrics();

      expect(costs.totalCost).toBeGreaterThan(0);
      expect(costs.costByModel).toBeDefined();
    });

    it('should calculate cost by model', () => {
      dashboard.startSession('grok-3');
      dashboard.trackMessage(1000000, 500000);
      dashboard.endSession();

      const costs = dashboard.getCostMetrics();
      expect(costs.costByModel['grok-3']).toBeDefined();
    });
  });

  describe('getPerformanceMetrics', () => {
    it('should return performance metrics', () => {
      const metrics = dashboard.getPerformanceMetrics();

      expect(metrics).toHaveProperty('averageResponseTime');
      expect(metrics).toHaveProperty('p50ResponseTime');
      expect(metrics).toHaveProperty('p90ResponseTime');
      expect(metrics).toHaveProperty('successRate');
    });
  });

  describe('setBudget', () => {
    it('should set budget limit', () => {
      dashboard.setBudget(100);

      const costs = dashboard.getCostMetrics();
      expect(costs.budgetRemaining).toBeDefined();
    });
  });

  describe('exportData', () => {
    it('should export as JSON', async () => {
      const data = await dashboard.exportData('json');
      const parsed = JSON.parse(data);

      expect(parsed).toHaveProperty('usage');
      expect(parsed).toHaveProperty('costs');
      expect(parsed).toHaveProperty('performance');
    });

    it('should export as CSV', async () => {
      const data = await dashboard.exportData('csv');

      expect(data).toContain('Daily Stats');
      expect(data).toContain('date,sessions,messages');
    });

    it('should export as markdown', async () => {
      const data = await dashboard.exportData('markdown');

      expect(data).toContain('# Grok CLI Analytics Report');
      expect(data).toContain('## Usage Summary');
    });
  });

  describe('renderDashboard', () => {
    it('should render dashboard', () => {
      const rendered = dashboard.renderDashboard();

      expect(rendered).toContain('ANALYTICS DASHBOARD');
      expect(rendered).toContain('USAGE');
      expect(rendered).toContain('COSTS');
      expect(rendered).toContain('PERFORMANCE');
    });
  });

  describe('reset', () => {
    it('should clear all data', async () => {
      dashboard.startSession('grok-3');
      dashboard.trackMessage(100, 200);
      dashboard.endSession();

      await dashboard.reset();

      const metrics = dashboard.getUsageMetrics();
      expect(metrics.totalMessages).toBe(0);
    });
  });

  describe('events', () => {
    it('should emit session:start event', () => {
      const handler = jest.fn();
      dashboard.on('session:start', handler);

      dashboard.startSession('grok-3');

      expect(handler).toHaveBeenCalled();
    });

    it('should emit budget:alert event', () => {
      const handler = jest.fn();
      dashboard.on('budget:alert', handler);

      dashboard.setBudget(0.0001); // Very low budget
      dashboard.startSession('grok-3');
      dashboard.trackMessage(1000000, 500000);

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('singleton', () => {
    it('should return same instance', () => {
      resetAnalyticsDashboard();
      const instance1 = getAnalyticsDashboard();
      const instance2 = getAnalyticsDashboard();
      expect(instance1).toBe(instance2);
    });
  });
});
