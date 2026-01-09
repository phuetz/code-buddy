/**
 * Tests for Metrics Dashboard
 */

import { EventEmitter } from 'events';

import {
  MetricsDashboard,
  getMetricsDashboard,
  resetMetricsDashboard,
  DashboardMetrics,
} from '../../src/analytics/metrics-dashboard';

describe('MetricsDashboard', () => {
  let dashboard: MetricsDashboard;

  beforeEach(() => {
    resetMetricsDashboard();
    dashboard = new MetricsDashboard();
  });

  afterEach(() => {
    dashboard.dispose();
  });

  describe('Constructor', () => {
    it('should create with generated session ID', () => {
      const metrics = dashboard.getMetrics();
      expect(metrics.session.sessionId).toBeDefined();
      expect(metrics.session.sessionId).toMatch(/^session_/);
    });

    it('should create with custom session ID', () => {
      const customDashboard = new MetricsDashboard('custom_session_123');
      const metrics = customDashboard.getMetrics();
      expect(metrics.session.sessionId).toBe('custom_session_123');
      customDashboard.dispose();
    });

    it('should initialize with start time', () => {
      const metrics = dashboard.getMetrics();
      expect(metrics.session.startTime).toBeInstanceOf(Date);
    });

    it('should extend EventEmitter', () => {
      expect(dashboard).toBeInstanceOf(EventEmitter);
    });
  });

  describe('recordTokenUsage', () => {
    it('should record token usage', () => {
      dashboard.recordTokenUsage({
        promptTokens: 100,
        completionTokens: 50,
      });

      const metrics = dashboard.getMetrics();
      expect(metrics.tokens.promptTokens).toBe(100);
      expect(metrics.tokens.completionTokens).toBe(50);
      expect(metrics.tokens.totalTokens).toBe(150);
    });

    it('should accumulate token usage', () => {
      dashboard.recordTokenUsage({
        promptTokens: 100,
        completionTokens: 50,
      });
      dashboard.recordTokenUsage({
        promptTokens: 200,
        completionTokens: 100,
      });

      const metrics = dashboard.getMetrics();
      expect(metrics.tokens.promptTokens).toBe(300);
      expect(metrics.tokens.completionTokens).toBe(150);
      expect(metrics.tokens.totalTokens).toBe(450);
    });

    it('should record cached tokens', () => {
      dashboard.recordTokenUsage({
        promptTokens: 100,
        completionTokens: 50,
        cachedTokens: 30,
      });

      const metrics = dashboard.getMetrics();
      expect(metrics.tokens.cachedTokens).toBe(30);
    });

    it('should emit tokenUsage event', () => {
      const handler = jest.fn();
      dashboard.on('tokenUsage', handler);

      dashboard.recordTokenUsage({
        promptTokens: 100,
        completionTokens: 50,
      });

      expect(handler).toHaveBeenCalledWith({
        promptTokens: 100,
        completionTokens: 50,
      });
    });
  });

  describe('recordToolExecution', () => {
    it('should record successful tool execution', () => {
      dashboard.recordToolExecution({
        toolName: 'Read',
        success: true,
        duration: 150,
      });

      const metrics = dashboard.getMetrics();
      expect(metrics.tools.totalExecutions).toBe(1);
      expect(metrics.tools.successfulExecutions).toBe(1);
      expect(metrics.tools.failedExecutions).toBe(0);
    });

    it('should record failed tool execution', () => {
      dashboard.recordToolExecution({
        toolName: 'Edit',
        success: false,
        duration: 100,
        error: 'File not found',
      });

      const metrics = dashboard.getMetrics();
      expect(metrics.tools.totalExecutions).toBe(1);
      expect(metrics.tools.successfulExecutions).toBe(0);
      expect(metrics.tools.failedExecutions).toBe(1);
    });

    it('should track per-tool statistics', () => {
      dashboard.recordToolExecution({
        toolName: 'Read',
        success: true,
        duration: 100,
      });
      dashboard.recordToolExecution({
        toolName: 'Read',
        success: true,
        duration: 200,
      });
      dashboard.recordToolExecution({
        toolName: 'Edit',
        success: false,
        duration: 50,
      });

      const metrics = dashboard.getMetrics();
      expect(metrics.tools.executionsByTool['Read'].success).toBe(2);
      expect(metrics.tools.executionsByTool['Read'].failed).toBe(0);
      expect(metrics.tools.executionsByTool['Edit'].success).toBe(0);
      expect(metrics.tools.executionsByTool['Edit'].failed).toBe(1);
    });

    it('should calculate average execution time', () => {
      dashboard.recordToolExecution({
        toolName: 'Read',
        success: true,
        duration: 100,
      });
      dashboard.recordToolExecution({
        toolName: 'Read',
        success: true,
        duration: 200,
      });

      const metrics = dashboard.getMetrics();
      expect(metrics.tools.averageExecutionTime).toBe(150);
    });

    it('should calculate per-tool average time', () => {
      dashboard.recordToolExecution({
        toolName: 'Read',
        success: true,
        duration: 100,
      });
      dashboard.recordToolExecution({
        toolName: 'Read',
        success: true,
        duration: 200,
      });

      const metrics = dashboard.getMetrics();
      expect(metrics.tools.executionsByTool['Read'].avgTime).toBe(150);
    });

    it('should emit toolExecution event', () => {
      const handler = jest.fn();
      dashboard.on('toolExecution', handler);

      const execution = {
        toolName: 'Read',
        success: true,
        duration: 150,
      };
      dashboard.recordToolExecution(execution);

      expect(handler).toHaveBeenCalledWith(execution);
    });
  });

  describe('recordRequestComplete', () => {
    it('should record request latency', () => {
      dashboard.recordRequestComplete({
        latency: 500,
        model: 'grok-2',
      });

      const metrics = dashboard.getMetrics();
      expect(metrics.performance.averageLatency).toBe(500);
    });

    it('should update cost tracking', () => {
      dashboard.recordRequestComplete({
        latency: 500,
        model: 'grok-2',
        cost: 0.01,
      });

      const metrics = dashboard.getMetrics();
      expect(metrics.costs.totalCost).toBe(0.01);
      expect(metrics.costs.sessionCost).toBe(0.01);
    });

    it('should track cost by model', () => {
      dashboard.recordRequestComplete({
        latency: 500,
        model: 'grok-2',
        cost: 0.01,
      });
      dashboard.recordRequestComplete({
        latency: 300,
        model: 'grok-3',
        cost: 0.02,
      });

      const metrics = dashboard.getMetrics();
      expect(metrics.costs.costByModel['grok-2']).toBe(0.01);
      expect(metrics.costs.costByModel['grok-3']).toBe(0.02);
    });

    it('should calculate average cost per request', () => {
      dashboard.recordRequestComplete({
        latency: 500,
        model: 'grok-2',
        cost: 0.01,
      });
      dashboard.recordRequestComplete({
        latency: 300,
        model: 'grok-2',
        cost: 0.03,
      });

      const metrics = dashboard.getMetrics();
      expect(metrics.costs.averageCostPerRequest).toBe(0.02);
    });

    it('should emit requestComplete event', () => {
      const handler = jest.fn();
      dashboard.on('requestComplete', handler);

      const request = {
        latency: 500,
        model: 'grok-2',
        cost: 0.01,
      };
      dashboard.recordRequestComplete(request);

      expect(handler).toHaveBeenCalledWith(request);
    });

    it('should limit latencies array size', () => {
      // Record more than 1000 requests
      for (let i = 0; i < 1100; i++) {
        dashboard.recordRequestComplete({
          latency: i,
          model: 'grok-2',
        });
      }

      const metrics = dashboard.getMetrics();
      // Performance metrics should still work
      expect(metrics.performance.averageLatency).toBeGreaterThan(0);
    });
  });

  describe('recordCacheHit', () => {
    it('should record cache hits', () => {
      dashboard.recordCacheHit();
      dashboard.recordCacheHit();

      // Record a request to calculate cache hit rate
      dashboard.recordRequestComplete({
        latency: 100,
        model: 'grok-2',
      });
      dashboard.recordRequestComplete({
        latency: 100,
        model: 'grok-2',
      });

      const metrics = dashboard.getMetrics();
      expect(metrics.performance.cacheHitRate).toBe(100); // 2 cache hits / 2 requests
    });
  });

  describe('recordMessage', () => {
    it('should record user messages', () => {
      dashboard.recordMessage('user');

      const metrics = dashboard.getMetrics();
      expect(metrics.session.messageCount).toBe(1);
      expect(metrics.session.userMessages).toBe(1);
      expect(metrics.session.assistantMessages).toBe(0);
    });

    it('should record assistant messages', () => {
      dashboard.recordMessage('assistant');

      const metrics = dashboard.getMetrics();
      expect(metrics.session.messageCount).toBe(1);
      expect(metrics.session.userMessages).toBe(0);
      expect(metrics.session.assistantMessages).toBe(1);
    });

    it('should track total message count', () => {
      dashboard.recordMessage('user');
      dashboard.recordMessage('assistant');
      dashboard.recordMessage('user');

      const metrics = dashboard.getMetrics();
      expect(metrics.session.messageCount).toBe(3);
      expect(metrics.session.userMessages).toBe(2);
      expect(metrics.session.assistantMessages).toBe(1);
    });
  });

  describe('recordToolRound', () => {
    it('should record tool rounds', () => {
      dashboard.recordToolRound();
      dashboard.recordToolRound();
      dashboard.recordToolRound();

      const metrics = dashboard.getMetrics();
      expect(metrics.session.toolRounds).toBe(3);
    });
  });

  describe('getMetrics', () => {
    it('should return all metrics', () => {
      const metrics = dashboard.getMetrics();

      expect(metrics.tokens).toBeDefined();
      expect(metrics.costs).toBeDefined();
      expect(metrics.tools).toBeDefined();
      expect(metrics.session).toBeDefined();
      expect(metrics.performance).toBeDefined();
      expect(metrics.timestamp).toBeInstanceOf(Date);
    });

    it('should calculate session duration', () => {
      // Wait a bit to ensure duration > 0
      const start = Date.now();
      const metrics = dashboard.getMetrics();

      expect(metrics.session.duration).toBeGreaterThanOrEqual(0);
    });

    it('should calculate requests per minute', () => {
      for (let i = 0; i < 10; i++) {
        dashboard.recordRequestComplete({
          latency: 100,
          model: 'grok-2',
        });
      }

      const metrics = dashboard.getMetrics();
      expect(metrics.performance.requestsPerMinute).toBeGreaterThanOrEqual(0);
    });

    it('should calculate percentile latencies', () => {
      for (let i = 1; i <= 100; i++) {
        dashboard.recordRequestComplete({
          latency: i * 10,
          model: 'grok-2',
        });
      }

      const metrics = dashboard.getMetrics();
      expect(metrics.performance.p50Latency).toBeGreaterThan(0);
      expect(metrics.performance.p95Latency).toBeGreaterThan(metrics.performance.p50Latency);
      expect(metrics.performance.p99Latency).toBeGreaterThanOrEqual(metrics.performance.p95Latency);
    });

    it('should handle empty latencies for percentiles', () => {
      const metrics = dashboard.getMetrics();

      expect(metrics.performance.p50Latency).toBe(0);
      expect(metrics.performance.p95Latency).toBe(0);
      expect(metrics.performance.p99Latency).toBe(0);
    });
  });

  describe('formatMetrics', () => {
    it('should format metrics for terminal display', () => {
      dashboard.recordTokenUsage({
        promptTokens: 1000,
        completionTokens: 500,
        cachedTokens: 100,
      });
      dashboard.recordToolExecution({
        toolName: 'Read',
        success: true,
        duration: 150,
      });

      const output = dashboard.formatMetrics();

      expect(output).toContain('CODE BUDDY METRICS');
      expect(output).toContain('SESSION');
      expect(output).toContain('TOKENS');
      expect(output).toContain('COSTS');
      expect(output).toContain('TOOLS');
      expect(output).toContain('PERFORMANCE');
    });

    it('should display duration in minutes and seconds', () => {
      const output = dashboard.formatMetrics();

      expect(output).toContain('Duration:');
      expect(output).toMatch(/\d+m \d+s/);
    });
  });

  describe('exportMetrics', () => {
    it('should export metrics as JSON', () => {
      dashboard.recordTokenUsage({
        promptTokens: 100,
        completionTokens: 50,
      });

      const json = dashboard.exportMetrics();
      const parsed = JSON.parse(json);

      expect(parsed.tokens).toBeDefined();
      expect(parsed.tokens.promptTokens).toBe(100);
    });
  });

  describe('getToolLeaderboard', () => {
    it('should return tool leaderboard sorted by executions', () => {
      dashboard.recordToolExecution({ toolName: 'Read', success: true, duration: 100 });
      dashboard.recordToolExecution({ toolName: 'Read', success: true, duration: 100 });
      dashboard.recordToolExecution({ toolName: 'Read', success: true, duration: 100 });
      dashboard.recordToolExecution({ toolName: 'Edit', success: true, duration: 100 });
      dashboard.recordToolExecution({ toolName: 'Edit', success: false, duration: 100 });

      const leaderboard = dashboard.getToolLeaderboard();

      expect(leaderboard.length).toBe(2);
      expect(leaderboard[0].tool).toBe('Read');
      expect(leaderboard[0].executions).toBe(3);
      expect(leaderboard[0].successRate).toBe(100);
      expect(leaderboard[1].tool).toBe('Edit');
      expect(leaderboard[1].executions).toBe(2);
      expect(leaderboard[1].successRate).toBe(50);
    });

    it('should return empty array when no tools executed', () => {
      const leaderboard = dashboard.getToolLeaderboard();
      expect(leaderboard).toEqual([]);
    });
  });

  describe('getEventsInRange', () => {
    it('should return events within date range', () => {
      const now = new Date();
      const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      dashboard.recordTokenUsage({ promptTokens: 100, completionTokens: 50 });

      const events = dashboard.getEventsInRange(hourAgo, now);

      expect(events.length).toBeGreaterThan(0);

      // Events from before the range should not be included
      const oldEvents = dashboard.getEventsInRange(twoHoursAgo, hourAgo);
      expect(oldEvents.length).toBe(0);
    });
  });

  describe('resetSession', () => {
    it('should reset session metrics', () => {
      dashboard.recordMessage('user');
      dashboard.recordMessage('assistant');
      dashboard.recordToolRound();
      dashboard.recordRequestComplete({
        latency: 100,
        model: 'grok-2',
        cost: 0.01,
      });

      const oldSessionId = dashboard.getMetrics().session.sessionId;
      dashboard.resetSession();
      const metrics = dashboard.getMetrics();

      expect(metrics.session.sessionId).not.toBe(oldSessionId);
      expect(metrics.session.messageCount).toBe(0);
      expect(metrics.session.userMessages).toBe(0);
      expect(metrics.session.assistantMessages).toBe(0);
      expect(metrics.session.toolRounds).toBe(0);
      expect(metrics.costs.sessionCost).toBe(0);
    });

    it('should emit sessionReset event', () => {
      const handler = jest.fn();
      dashboard.on('sessionReset', handler);

      dashboard.resetSession();

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('dispose', () => {
    it('should clear events and latencies', () => {
      dashboard.recordTokenUsage({ promptTokens: 100, completionTokens: 50 });
      dashboard.recordRequestComplete({ latency: 100, model: 'grok-2' });

      dashboard.dispose();

      // After dispose, getting events should return empty
      const events = dashboard.getEventsInRange(
        new Date(0),
        new Date()
      );
      expect(events.length).toBe(0);
    });

    it('should remove all listeners', () => {
      const handler = jest.fn();
      dashboard.on('tokenUsage', handler);

      dashboard.dispose();

      // Emitting after dispose should not call handler
      dashboard.emit('tokenUsage', { promptTokens: 100, completionTokens: 50 });
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('Singleton', () => {
    it('should return same instance with getMetricsDashboard', () => {
      resetMetricsDashboard();
      const instance1 = getMetricsDashboard();
      const instance2 = getMetricsDashboard();

      expect(instance1).toBe(instance2);
    });

    it('should create new instance after reset', () => {
      resetMetricsDashboard();
      const instance1 = getMetricsDashboard();
      resetMetricsDashboard();
      const instance2 = getMetricsDashboard();

      expect(instance1).not.toBe(instance2);
    });
  });

  describe('Edge cases', () => {
    it('should handle zero requests for cache hit rate', () => {
      const metrics = dashboard.getMetrics();
      expect(metrics.performance.cacheHitRate).toBe(0);
    });

    it('should handle zero latencies for average', () => {
      const metrics = dashboard.getMetrics();
      expect(metrics.performance.averageLatency).toBe(0);
    });

    it('should handle zero requests for average cost', () => {
      const metrics = dashboard.getMetrics();
      expect(metrics.costs.averageCostPerRequest).toBe(0);
    });

    it('should handle request without cost', () => {
      dashboard.recordRequestComplete({
        latency: 100,
        model: 'grok-2',
      });

      const metrics = dashboard.getMetrics();
      expect(metrics.costs.totalCost).toBe(0);
    });
  });
});
