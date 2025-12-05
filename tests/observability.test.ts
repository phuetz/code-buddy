/**
 * Observability Dashboard Tests
 */

import {
  MetricsCollector,
  TerminalDashboard,
  PrometheusExporter,
  getMetricsCollector,
  resetMetricsCollector,
  getTerminalDashboard,
  getPrometheusExporter,
  type ToolMetrics,
  type ProviderMetrics,
} from '../src/observability/dashboard.js';

describe('MetricsCollector', () => {
  let collector: MetricsCollector;

  beforeEach(() => {
    resetMetricsCollector();
    collector = new MetricsCollector();
  });

  afterEach(() => {
    collector.dispose();
  });

  describe('Basic Metrics', () => {
    it('should record metric points', () => {
      collector.record('test_metric', 100);
      collector.record('test_metric', 200);

      const history = collector.getMetricHistory('test_metric');
      expect(history).toHaveLength(2);
      expect(history[0].value).toBe(100);
      expect(history[1].value).toBe(200);
    });

    it('should record metrics with labels', () => {
      collector.record('requests', 1, { endpoint: '/api/test' });

      const history = collector.getMetricHistory('requests');
      expect(history[0].labels).toEqual({ endpoint: '/api/test' });
    });

    it('should increment counters', () => {
      collector.increment('counter');
      collector.increment('counter');
      collector.increment('counter', 5);

      const history = collector.getMetricHistory('counter');
      expect(history[history.length - 1].value).toBe(7);
    });

    it('should auto-create metrics on record', () => {
      collector.record('new_metric', 42);
      const history = collector.getMetricHistory('new_metric');
      expect(history).toHaveLength(1);
    });
  });

  describe('API Request Tracking', () => {
    it('should record API requests', () => {
      collector.recordAPIRequest({
        provider: 'grok',
        model: 'grok-3-latest',
        promptTokens: 100,
        completionTokens: 200,
        cost: 0.001,
        latency: 500,
        success: true,
      });

      const metrics = collector.getProviderMetrics();
      expect(metrics).toHaveLength(1);
      expect(metrics[0].provider).toBe('grok');
      expect(metrics[0].totalRequests).toBe(1);
      expect(metrics[0].totalTokens).toBe(300);
    });

    it('should aggregate multiple requests', () => {
      collector.recordAPIRequest({
        provider: 'grok',
        model: 'grok-3-latest',
        promptTokens: 100,
        completionTokens: 200,
        cost: 0.001,
        latency: 500,
        success: true,
      });

      collector.recordAPIRequest({
        provider: 'grok',
        model: 'grok-3-latest',
        promptTokens: 150,
        completionTokens: 250,
        cost: 0.002,
        latency: 600,
        success: true,
      });

      const metrics = collector.getProviderMetrics();
      expect(metrics[0].totalRequests).toBe(2);
      expect(metrics[0].totalTokens).toBe(700);
      expect(metrics[0].totalCost).toBeCloseTo(0.003);
    });

    it('should track errors', () => {
      collector.recordAPIRequest({
        provider: 'grok',
        model: 'grok-3-latest',
        promptTokens: 100,
        completionTokens: 0,
        cost: 0,
        latency: 100,
        success: false,
      });

      const metrics = collector.getProviderMetrics();
      expect(metrics[0].errorCount).toBe(1);
    });

    it('should calculate average latency', () => {
      collector.recordAPIRequest({
        provider: 'grok',
        model: 'grok-3-latest',
        promptTokens: 100,
        completionTokens: 100,
        cost: 0.001,
        latency: 400,
        success: true,
      });

      collector.recordAPIRequest({
        provider: 'grok',
        model: 'grok-3-latest',
        promptTokens: 100,
        completionTokens: 100,
        cost: 0.001,
        latency: 600,
        success: true,
      });

      const metrics = collector.getProviderMetrics();
      expect(metrics[0].avgLatency).toBe(500);
    });
  });

  describe('Tool Execution Tracking', () => {
    it('should record tool executions', () => {
      collector.recordToolExecution({
        name: 'read_file',
        duration: 50,
        success: true,
      });

      const metrics = collector.getToolMetrics();
      expect(metrics).toHaveLength(1);
      expect(metrics[0].name).toBe('read_file');
      expect(metrics[0].totalCalls).toBe(1);
      expect(metrics[0].successCount).toBe(1);
    });

    it('should track tool statistics', () => {
      // Add error handler to prevent unhandled error
      collector.on('error', () => {});

      collector.recordToolExecution({ name: 'search', duration: 100, success: true });
      collector.recordToolExecution({ name: 'search', duration: 200, success: true });
      collector.recordToolExecution({ name: 'search', duration: 150, success: false, error: 'Failed' });

      const metrics = collector.getToolMetrics();
      const searchMetrics = metrics.find(m => m.name === 'search')!;

      expect(searchMetrics.totalCalls).toBe(3);
      expect(searchMetrics.successCount).toBe(2);
      expect(searchMetrics.errorCount).toBe(1);
      expect(searchMetrics.avgDuration).toBe(150);
      expect(searchMetrics.minDuration).toBe(100);
      expect(searchMetrics.maxDuration).toBe(200);
    });
  });

  describe('Error Tracking', () => {
    beforeEach(() => {
      // Add error handler to prevent unhandled error
      collector.on('error', () => {});
    });

    it('should record errors', () => {
      collector.recordError('api_error', 'Connection timeout');
      collector.recordError('tool_error', 'File not found', { file: '/test.txt' });

      const errors = collector.getRecentErrors();
      expect(errors).toHaveLength(2);
      expect(errors[0].type).toBe('api_error');
      expect(errors[1].context).toEqual({ file: '/test.txt' });
    });

    it('should limit error history', () => {
      for (let i = 0; i < 150; i++) {
        collector.recordError('test', `Error ${i}`);
      }

      const errors = collector.getRecentErrors(200);
      expect(errors.length).toBeLessThanOrEqual(100);
    });
  });

  describe('Session Tracking', () => {
    it('should track sessions', () => {
      collector.startSession('session-1');

      const state = collector.getDashboardState();
      expect(state.activeSession).toBe(true);
    });

    it('should record messages in session', () => {
      collector.startSession('session-1');
      collector.recordMessage('user');
      collector.recordMessage('assistant');
      collector.recordMessage('user');

      // Session metrics would be updated
      const state = collector.getDashboardState();
      expect(state.activeSession).toBe(true);
    });

    it('should end sessions', () => {
      collector.startSession('session-1');
      collector.recordMessage('user');
      const metrics = collector.endSession();

      expect(metrics).toBeDefined();
      expect(metrics!.messageCount).toBe(1);

      const state = collector.getDashboardState();
      expect(state.activeSession).toBe(false);
    });
  });

  describe('Dashboard State', () => {
    it('should provide dashboard state', () => {
      const state = collector.getDashboardState();

      expect(state).toHaveProperty('uptime');
      expect(state).toHaveProperty('activeSession');
      expect(state).toHaveProperty('totalTokens');
      expect(state).toHaveProperty('totalCost');
      expect(state).toHaveProperty('totalToolCalls');
      expect(state).toHaveProperty('avgResponseTime');
      expect(state).toHaveProperty('errorRate');
      expect(state).toHaveProperty('tokensPerMinute');
      expect(state).toHaveProperty('costPerHour');
    });

    it('should calculate totals', () => {
      collector.recordAPIRequest({
        provider: 'grok',
        model: 'grok-3-latest',
        promptTokens: 500,
        completionTokens: 500,
        cost: 0.05,
        latency: 500,
        success: true,
      });

      collector.recordToolExecution({ name: 'tool1', duration: 100, success: true });
      collector.recordToolExecution({ name: 'tool2', duration: 100, success: true });

      expect(collector.getTotalTokens()).toBe(1000);
      expect(collector.getTotalCost()).toBe(0.05);
      expect(collector.getTotalToolCalls()).toBe(2);
    });

    it('should calculate error rate', () => {
      collector.recordAPIRequest({
        provider: 'grok',
        model: 'grok-3-latest',
        promptTokens: 100,
        completionTokens: 100,
        cost: 0.01,
        latency: 100,
        success: true,
      });

      collector.recordAPIRequest({
        provider: 'grok',
        model: 'grok-3-latest',
        promptTokens: 100,
        completionTokens: 0,
        cost: 0,
        latency: 100,
        success: false,
      });

      expect(collector.getErrorRate()).toBe(50);
    });
  });

  describe('Export', () => {
    it('should export all metrics', () => {
      // Add error handler to prevent unhandled error
      collector.on('error', () => {});

      collector.recordAPIRequest({
        provider: 'grok',
        model: 'test',
        promptTokens: 100,
        completionTokens: 100,
        cost: 0.01,
        latency: 500,
        success: true,
      });

      collector.recordToolExecution({ name: 'test', duration: 100, success: true });
      collector.recordError('test', 'error');

      const exported = collector.export();

      expect(exported.uptime).toBeGreaterThanOrEqual(0);
      expect(exported.providers).toHaveLength(1);
      expect(exported.tools).toHaveLength(1);
      expect(exported.errors).toHaveLength(1);
    });
  });

  describe('Reset', () => {
    it('should reset all metrics', () => {
      collector.recordAPIRequest({
        provider: 'grok',
        model: 'test',
        promptTokens: 100,
        completionTokens: 100,
        cost: 0.01,
        latency: 500,
        success: true,
      });

      collector.reset();

      expect(collector.getTotalTokens()).toBe(0);
      expect(collector.getProviderMetrics()).toHaveLength(0);
      expect(collector.getToolMetrics()).toHaveLength(0);
    });
  });

  describe('Singleton', () => {
    it('should return same instance', () => {
      resetMetricsCollector();
      const i1 = getMetricsCollector();
      const i2 = getMetricsCollector();
      expect(i1).toBe(i2);
    });
  });
});

describe('TerminalDashboard', () => {
  let collector: MetricsCollector;
  let dashboard: TerminalDashboard;

  beforeEach(() => {
    collector = new MetricsCollector();
    dashboard = new TerminalDashboard(collector);
  });

  afterEach(() => {
    dashboard.stopLiveRefresh();
    collector.dispose();
  });

  it('should render dashboard', () => {
    const output = dashboard.render();

    expect(output).toContain('GROK CLI OBSERVABILITY');
    expect(output).toContain('Overview');
    expect(output).toContain('Uptime');
  });

  it('should include metrics in render', () => {
    collector.recordAPIRequest({
      provider: 'grok',
      model: 'grok-3-latest',
      promptTokens: 100,
      completionTokens: 100,
      cost: 0.01,
      latency: 500,
      success: true,
    });

    const output = dashboard.render();
    expect(output).toContain('Providers');
    expect(output).toContain('grok');
  });

  it('should include tool metrics', () => {
    collector.recordToolExecution({ name: 'read_file', duration: 100, success: true });
    collector.recordToolExecution({ name: 'read_file', duration: 100, success: true });

    const output = dashboard.render();
    expect(output).toContain('Top Tools');
    expect(output).toContain('read_file');
  });

  it('should include errors', () => {
    // Add error handler to prevent unhandled error
    collector.on('error', () => {});

    collector.recordError('test_error', 'Something went wrong');

    const output = dashboard.render();
    expect(output).toContain('Recent Errors');
    expect(output).toContain('test_error');
  });
});

describe('PrometheusExporter', () => {
  let collector: MetricsCollector;
  let exporter: PrometheusExporter;

  beforeEach(() => {
    collector = new MetricsCollector();
    exporter = new PrometheusExporter(collector);
  });

  afterEach(() => {
    collector.dispose();
  });

  it('should export in Prometheus format', () => {
    const output = exporter.export();

    expect(output).toContain('# HELP');
    expect(output).toContain('# TYPE');
    expect(output).toContain('grok_tokens_total');
    expect(output).toContain('grok_cost_usd_total');
  });

  it('should include provider metrics', () => {
    collector.recordAPIRequest({
      provider: 'grok',
      model: 'grok-3-latest',
      promptTokens: 100,
      completionTokens: 100,
      cost: 0.01,
      latency: 500,
      success: true,
    });

    const output = exporter.export();
    expect(output).toContain('grok_provider_requests_total');
    expect(output).toContain('provider="grok"');
    expect(output).toContain('model="grok-3-latest"');
  });

  it('should include uptime', () => {
    const output = exporter.export();
    expect(output).toContain('grok_uptime_seconds');
  });

  it('should include error rate', () => {
    const output = exporter.export();
    expect(output).toContain('grok_error_rate_percent');
  });
});
