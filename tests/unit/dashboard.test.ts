
import { MetricsCollector } from '../../src/observability/dashboard.js';

describe('MetricsCollector', () => {
  let collector: MetricsCollector;

  beforeEach(() => {
    collector = new MetricsCollector();
  });

  afterEach(() => {
    collector.dispose();
  });

  it('should initialize with default metrics', () => {
    const state = collector.getDashboardState();
    expect(state.totalTokens).toBe(0);
    expect(state.totalCost).toBe(0);
  });

  it('should record API request metrics', () => {
    collector.recordAPIRequest({
      provider: 'grok',
      model: 'grok-beta',
      promptTokens: 10,
      completionTokens: 20,
      cost: 0.001,
      latency: 100,
      success: true
    });

    const state = collector.getDashboardState();
    expect(state.totalTokens).toBe(30);
    expect(state.totalCost).toBe(0.001);
    
    const providers = collector.getProviderMetrics();
    expect(providers.length).toBe(1);
    expect(providers[0].provider).toBe('grok');
    expect(providers[0].totalRequests).toBe(1);
  });

  it('should record tool execution metrics', () => {
    collector.recordToolExecution({
      name: 'test-tool',
      duration: 50,
      success: true
    });

    const tools = collector.getToolMetrics();
    expect(tools.length).toBe(1);
    expect(tools[0].name).toBe('test-tool');
    expect(tools[0].totalCalls).toBe(1);
    expect(tools[0].avgDuration).toBe(50);
  });

  it('should track session state', () => {
    collector.startSession('session-1');
    collector.recordMessage('user');
    collector.recordMessage('assistant');
    
    const session = collector.endSession();
    expect(session).not.toBeNull();
    expect(session?.sessionId).toBe('session-1');
    expect(session?.messageCount).toBe(2);
  });

  it('should manage metric history', () => {
    collector.record('custom_metric', 10);
    collector.record('custom_metric', 20);
    
    const history = collector.getMetricHistory('custom_metric');
    expect(history.length).toBe(2);
    expect(history[0].value).toBe(10);
    expect(history[1].value).toBe(20);
  });
});
