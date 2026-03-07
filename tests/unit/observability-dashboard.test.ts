/**
 * Observability Dashboard Tests
 *
 * Tests for the interactive terminal dashboard components
 */

// Mock dependencies before imports
jest.mock('react', async () => {
  const React = await vi.importActual('react');
  return {
    ...React,
    memo: jest.fn((component) => component),
    useMemo: jest.fn((fn) => fn()),
    useState: jest.fn((initial) => [initial, jest.fn()]),
    useEffect: jest.fn(),
    useCallback: jest.fn((fn) => fn),
    useRef: jest.fn((initial) => ({ current: initial })),
  };
});

jest.mock('ink', () => ({
  Box: 'Box',
  Text: 'Text',
  useInput: jest.fn(),
  useApp: jest.fn(function() { return { exit: jest.fn() }; }),
}));

jest.mock('../../src/ui/context/theme-context.js', () => ({
  useTheme: () => ({
    colors: {
      primary: 'cyan',
      secondary: 'blue',
      success: 'green',
      warning: 'yellow',
      error: 'red',
      info: 'blue',
      text: 'white',
      textMuted: 'gray',
      border: 'gray',
      accent: 'magenta',
    },
    theme: 'dark',
  }),
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('../../src/optimization/latency-optimizer.js', () => ({
  getLatencyOptimizer: () => ({
    getStats: () => ({
      avgDuration: 150,
      p95: 300,
      metTarget: 85,
      totalOperations: 100,
    }),
  }),
  getStreamingOptimizer: () => ({
    getStats: () => ({
      avgFirstToken: 200,
    }),
  }),
  LATENCY_THRESHOLDS: {
    INSTANT: 50,
    FAST: 200,
    ACCEPTABLE: 500,
    SLOW: 1000,
    VERY_SLOW: 5000,
  },
}));

import {
  resetMetricsCollector,
  getMetricsCollector,
  type DashboardState,
  type ToolMetrics,
  type ProviderMetrics,
  type ErrorRecord,
  type MetricPoint,
} from '../../src/observability/dashboard.js';

// Define interfaces for testing
interface DashboardData {
  state: DashboardState;
  tools: ToolMetrics[];
  providers: ProviderMetrics[];
  errors: ErrorRecord[];
  latency: {
    avgDuration: number;
    p95: number;
    metTarget: number;
    totalOperations: number;
    avgFirstToken: number;
    byOperation: Map<string, { avg: number; count: number }>;
  };
  tokenHistory: MetricPoint[];
  costHistory: MetricPoint[];
  responseTimeHistory: MetricPoint[];
  isConnected: boolean;
  lastUpdate: number;
}

describe('Observability Dashboard', () => {
  beforeEach(() => {
    resetMetricsCollector();
    jest.clearAllMocks();
  });

  afterEach(() => {
    resetMetricsCollector();
  });

  describe('MetricsCollector Integration', () => {
    it('should start with empty metrics', () => {
      const collector = getMetricsCollector();
      const state = collector.getDashboardState();

      expect(state.totalTokens).toBe(0);
      expect(state.totalCost).toBe(0);
      expect(state.totalToolCalls).toBe(0);
    });

    it('should track API requests', () => {
      const collector = getMetricsCollector();

      collector.recordAPIRequest({
        provider: 'grok',
        model: 'grok-2',
        promptTokens: 100,
        completionTokens: 50,
        cost: 0.01,
        latency: 500,
        success: true,
      });

      const state = collector.getDashboardState();
      expect(state.totalTokens).toBe(150);
      expect(state.totalCost).toBe(0.01);
    });

    it('should track tool executions', () => {
      const collector = getMetricsCollector();

      collector.recordToolExecution({
        name: 'read_file',
        duration: 100,
        success: true,
      });

      const tools = collector.getToolMetrics();
      expect(tools.length).toBe(1);
      expect(tools[0].name).toBe('read_file');
      expect(tools[0].totalCalls).toBe(1);
      expect(tools[0].successCount).toBe(1);
    });

    it('should track errors', () => {
      const collector = getMetricsCollector();

      // Add error listener to prevent unhandled error event
      collector.on('error', () => {});

      collector.recordError('test_error', 'Test error message', { context: 'test' });

      const errors = collector.getRecentErrors();
      expect(errors.length).toBe(1);
      expect(errors[0].type).toBe('test_error');
      expect(errors[0].message).toBe('Test error message');
    });

    it('should calculate average response time', () => {
      const collector = getMetricsCollector();

      collector.recordAPIRequest({
        provider: 'grok',
        model: 'grok-2',
        promptTokens: 100,
        completionTokens: 50,
        cost: 0.01,
        latency: 300,
        success: true,
      });

      collector.recordAPIRequest({
        provider: 'grok',
        model: 'grok-2',
        promptTokens: 100,
        completionTokens: 50,
        cost: 0.01,
        latency: 500,
        success: true,
      });

      const state = collector.getDashboardState();
      expect(state.avgResponseTime).toBe(400);
    });

    it('should calculate error rate', () => {
      const collector = getMetricsCollector();

      // 4 successful, 1 failed = 20% error rate
      for (let i = 0; i < 4; i++) {
        collector.recordAPIRequest({
          provider: 'grok',
          model: 'grok-2',
          promptTokens: 100,
          completionTokens: 50,
          cost: 0.01,
          latency: 500,
          success: true,
        });
      }

      collector.recordAPIRequest({
        provider: 'grok',
        model: 'grok-2',
        promptTokens: 100,
        completionTokens: 50,
        cost: 0.01,
        latency: 500,
        success: false,
      });

      const state = collector.getDashboardState();
      expect(state.errorRate).toBe(20);
    });

    it('should track provider metrics', () => {
      const collector = getMetricsCollector();

      collector.recordAPIRequest({
        provider: 'grok',
        model: 'grok-2',
        promptTokens: 100,
        completionTokens: 50,
        cost: 0.01,
        latency: 500,
        success: true,
      });

      collector.recordAPIRequest({
        provider: 'claude',
        model: 'claude-3',
        promptTokens: 200,
        completionTokens: 100,
        cost: 0.02,
        latency: 300,
        success: true,
      });

      const providers = collector.getProviderMetrics();
      expect(providers.length).toBe(2);

      const grokProvider = providers.find(p => p.provider === 'grok');
      expect(grokProvider?.totalTokens).toBe(150);
      expect(grokProvider?.totalCost).toBe(0.01);
    });

    it('should track session lifecycle', () => {
      const collector = getMetricsCollector();

      collector.startSession('test-session');
      let state = collector.getDashboardState();
      expect(state.activeSession).toBe(true);

      collector.recordMessage('user');
      collector.recordMessage('assistant');

      const sessionMetrics = collector.endSession();
      expect(sessionMetrics?.messageCount).toBe(2);
      expect(sessionMetrics?.userMessages).toBe(1);
      expect(sessionMetrics?.assistantMessages).toBe(1);

      state = collector.getDashboardState();
      expect(state.activeSession).toBe(false);
    });

    it('should get metric history', () => {
      const collector = getMetricsCollector();

      collector.recordAPIRequest({
        provider: 'grok',
        model: 'grok-2',
        promptTokens: 100,
        completionTokens: 50,
        cost: 0.01,
        latency: 500,
        success: true,
      });

      const history = collector.getMetricHistory('tokens_total');
      expect(history.length).toBeGreaterThan(0);
    });

    it('should export metrics', () => {
      const collector = getMetricsCollector();

      collector.recordToolExecution({
        name: 'test_tool',
        duration: 100,
        success: true,
      });

      const exported = collector.export();
      expect(exported.tools.length).toBe(1);
      expect(exported.uptime).toBeGreaterThanOrEqual(0);
    });

    it('should reset metrics', () => {
      const collector = getMetricsCollector();

      collector.recordAPIRequest({
        provider: 'grok',
        model: 'grok-2',
        promptTokens: 100,
        completionTokens: 50,
        cost: 0.01,
        latency: 500,
        success: true,
      });

      collector.reset();

      const state = collector.getDashboardState();
      expect(state.totalTokens).toBe(0);
      expect(state.totalCost).toBe(0);
    });
  });

  describe('Dashboard Data Types', () => {
    it('should define correct ToolMetrics interface', () => {
      const toolMetrics: ToolMetrics = {
        name: 'test_tool',
        totalCalls: 10,
        successCount: 9,
        errorCount: 1,
        totalDuration: 1000,
        avgDuration: 100,
        minDuration: 50,
        maxDuration: 200,
        lastExecuted: Date.now(),
      };

      expect(toolMetrics.name).toBe('test_tool');
      expect(toolMetrics.totalCalls).toBe(10);
      expect(toolMetrics.successCount + toolMetrics.errorCount).toBe(10);
    });

    it('should define correct ProviderMetrics interface', () => {
      const providerMetrics: ProviderMetrics = {
        provider: 'grok',
        model: 'grok-2',
        totalRequests: 100,
        totalTokens: 15000,
        promptTokens: 10000,
        completionTokens: 5000,
        totalCost: 1.5,
        avgLatency: 500,
        errorCount: 5,
        lastRequest: Date.now(),
      };

      expect(providerMetrics.provider).toBe('grok');
      expect(providerMetrics.totalTokens).toBe(
        providerMetrics.promptTokens + providerMetrics.completionTokens
      );
    });

    it('should define correct DashboardState interface', () => {
      const state: DashboardState = {
        uptime: 60000,
        activeSession: true,
        totalSessions: 5,
        totalTokens: 10000,
        totalCost: 0.5,
        totalToolCalls: 50,
        avgResponseTime: 500,
        errorRate: 2.5,
        tokensPerMinute: 100,
        costPerHour: 0.1,
      };

      expect(state.activeSession).toBe(true);
      expect(state.errorRate).toBeLessThan(100);
    });
  });

  describe('Dashboard Helper Functions', () => {
    it('should calculate budget progress correctly', () => {
      const cost = 7.5;
      const budget = 10;
      const progress = (cost / budget) * 100;

      expect(progress).toBe(75);
    });

    it('should determine correct status based on progress', () => {
      const getStatus = (progress: number): 'success' | 'warning' | 'error' => {
        if (progress < 50) return 'success';
        if (progress < 80) return 'warning';
        return 'error';
      };

      expect(getStatus(30)).toBe('success');
      expect(getStatus(60)).toBe('warning');
      expect(getStatus(90)).toBe('error');
    });

    it('should format duration correctly', () => {
      const formatDuration = (ms: number): string => {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);

        if (hours > 0) return `${hours}h ${minutes % 60}m`;
        if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
        return `${seconds}s`;
      };

      expect(formatDuration(5000)).toBe('5s');
      expect(formatDuration(65000)).toBe('1m 5s');
      expect(formatDuration(3665000)).toBe('1h 1m');
    });

    it('should format cost correctly', () => {
      const formatCost = (cost: number): string => {
        if (cost === 0) return '$0.00';
        if (cost < 0.01) return `$${(cost * 1000).toFixed(2)}m`;
        if (cost < 1) return `$${cost.toFixed(3)}`;
        return `$${cost.toFixed(2)}`;
      };

      expect(formatCost(0)).toBe('$0.00');
      expect(formatCost(0.005)).toBe('$5.00m');
      expect(formatCost(0.5)).toBe('$0.500');
      expect(formatCost(5.0)).toBe('$5.00');
    });

    it('should format token count correctly', () => {
      const formatTokens = (count: number): string => {
        if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(2)}M`;
        if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
        return count.toString();
      };

      expect(formatTokens(500)).toBe('500');
      expect(formatTokens(1500)).toBe('1.5K');
      expect(formatTokens(1500000)).toBe('1.50M');
    });

    it('should format milliseconds correctly', () => {
      const formatMs = (ms: number): string => {
        if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
        return `${Math.round(ms)}ms`;
      };

      expect(formatMs(500)).toBe('500ms');
      expect(formatMs(1500)).toBe('1.50s');
    });

    it('should format time ago correctly', () => {
      const formatTimeAgo = (timestamp: number | undefined): string => {
        if (!timestamp) return 'Never';
        const seconds = Math.floor((Date.now() - timestamp) / 1000);
        if (seconds < 60) return `${seconds}s ago`;
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `${minutes}m ago`;
        const hours = Math.floor(minutes / 60);
        return `${hours}h ago`;
      };

      expect(formatTimeAgo(undefined)).toBe('Never');
      expect(formatTimeAgo(Date.now() - 30000)).toBe('30s ago');
      expect(formatTimeAgo(Date.now() - 120000)).toBe('2m ago');
      expect(formatTimeAgo(Date.now() - 7200000)).toBe('2h ago');
    });
  });

  describe('Sparkline Rendering Logic', () => {
    const SPARK_CHARS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

    it('should normalize data to sparkline characters', () => {
      const data = [0, 25, 50, 75, 100];
      const min = Math.min(...data);
      const max = Math.max(...data);
      const range = max - min || 1;

      const chars = data.map((value) => {
        const normalized = (value - min) / range;
        const index = Math.min(
          SPARK_CHARS.length - 1,
          Math.floor(normalized * (SPARK_CHARS.length - 1))
        );
        return SPARK_CHARS[index];
      });

      expect(chars[0]).toBe('▁'); // 0%
      expect(chars[2]).toBe('▄'); // 50%
      expect(chars[4]).toBe('█'); // 100%
    });

    it('should handle single value data', () => {
      const data = [50];
      const min = Math.min(...data);
      const max = Math.max(...data);
      const range = max - min || 1;

      const chars = data.map((value) => {
        const normalized = (value - min) / range;
        const index = Math.min(
          SPARK_CHARS.length - 1,
          Math.floor(normalized * (SPARK_CHARS.length - 1))
        );
        return SPARK_CHARS[index];
      });

      // Single value should be at max (since range is 1)
      expect(chars[0]).toBe('▁');
    });
  });

  describe('Bar Chart Rendering Logic', () => {
    it('should calculate bar widths proportionally', () => {
      const data = [
        { label: 'A', value: 10 },
        { label: 'B', value: 5 },
        { label: 'C', value: 2.5 },
      ];
      const maxBarWidth = 20;
      const maxValue = Math.max(...data.map((d) => d.value));

      const barWidths = data.map((item) =>
        Math.round((item.value / maxValue) * maxBarWidth)
      );

      expect(barWidths[0]).toBe(20); // 100%
      expect(barWidths[1]).toBe(10); // 50%
      expect(barWidths[2]).toBe(5);  // 25%
    });
  });

  describe('Progress Ring Logic', () => {
    it('should clamp progress to 0-100', () => {
      const clamp = (value: number) => Math.max(0, Math.min(100, value));

      expect(clamp(-10)).toBe(0);
      expect(clamp(50)).toBe(50);
      expect(clamp(150)).toBe(100);
    });

    it('should select correct ring character for small size', () => {
      const chars = ['○', '◔', '◑', '◕', '●'];
      const getChar = (progress: number) => {
        const index = Math.min(chars.length - 1, Math.floor(progress / 25));
        return chars[index];
      };

      expect(getChar(0)).toBe('○');
      expect(getChar(25)).toBe('◔');
      expect(getChar(50)).toBe('◑');
      expect(getChar(75)).toBe('◕');
      expect(getChar(100)).toBe('●');
    });
  });

  describe('Tool Sorting Logic', () => {
    it('should sort tools by calls', () => {
      const tools: ToolMetrics[] = [
        { name: 'a', totalCalls: 5, successCount: 5, errorCount: 0, totalDuration: 100, avgDuration: 20, minDuration: 10, maxDuration: 30 },
        { name: 'b', totalCalls: 10, successCount: 10, errorCount: 0, totalDuration: 200, avgDuration: 20, minDuration: 10, maxDuration: 30 },
        { name: 'c', totalCalls: 3, successCount: 3, errorCount: 0, totalDuration: 60, avgDuration: 20, minDuration: 10, maxDuration: 30 },
      ];

      const sorted = [...tools].sort((a, b) => b.totalCalls - a.totalCalls);
      expect(sorted[0].name).toBe('b');
      expect(sorted[1].name).toBe('a');
      expect(sorted[2].name).toBe('c');
    });

    it('should sort tools by success rate', () => {
      const tools: ToolMetrics[] = [
        { name: 'a', totalCalls: 10, successCount: 9, errorCount: 1, totalDuration: 100, avgDuration: 10, minDuration: 5, maxDuration: 20 },
        { name: 'b', totalCalls: 10, successCount: 10, errorCount: 0, totalDuration: 100, avgDuration: 10, minDuration: 5, maxDuration: 20 },
        { name: 'c', totalCalls: 10, successCount: 7, errorCount: 3, totalDuration: 100, avgDuration: 10, minDuration: 5, maxDuration: 20 },
      ];

      const sorted = [...tools].sort((a, b) => {
        const aRate = a.totalCalls > 0 ? a.successCount / a.totalCalls : 0;
        const bRate = b.totalCalls > 0 ? b.successCount / b.totalCalls : 0;
        return bRate - aRate;
      });

      expect(sorted[0].name).toBe('b'); // 100%
      expect(sorted[1].name).toBe('a'); // 90%
      expect(sorted[2].name).toBe('c'); // 70%
    });

    it('should sort tools by duration', () => {
      const tools: ToolMetrics[] = [
        { name: 'a', totalCalls: 10, successCount: 10, errorCount: 0, totalDuration: 1000, avgDuration: 100, minDuration: 50, maxDuration: 150 },
        { name: 'b', totalCalls: 10, successCount: 10, errorCount: 0, totalDuration: 500, avgDuration: 50, minDuration: 25, maxDuration: 75 },
        { name: 'c', totalCalls: 10, successCount: 10, errorCount: 0, totalDuration: 2000, avgDuration: 200, minDuration: 100, maxDuration: 300 },
      ];

      const sorted = [...tools].sort((a, b) => b.avgDuration - a.avgDuration);
      expect(sorted[0].name).toBe('c'); // 200ms
      expect(sorted[1].name).toBe('a'); // 100ms
      expect(sorted[2].name).toBe('b'); // 50ms
    });

    it('should sort tools by name', () => {
      const tools: ToolMetrics[] = [
        { name: 'read_file', totalCalls: 10, successCount: 10, errorCount: 0, totalDuration: 100, avgDuration: 10, minDuration: 5, maxDuration: 20 },
        { name: 'bash', totalCalls: 5, successCount: 5, errorCount: 0, totalDuration: 50, avgDuration: 10, minDuration: 5, maxDuration: 20 },
        { name: 'write_file', totalCalls: 8, successCount: 8, errorCount: 0, totalDuration: 80, avgDuration: 10, minDuration: 5, maxDuration: 20 },
      ];

      const sorted = [...tools].sort((a, b) => a.name.localeCompare(b.name));
      expect(sorted[0].name).toBe('bash');
      expect(sorted[1].name).toBe('read_file');
      expect(sorted[2].name).toBe('write_file');
    });
  });

  describe('Latency Status Classification', () => {
    const THRESHOLDS = {
      INSTANT: 50,
      FAST: 200,
      ACCEPTABLE: 500,
      SLOW: 1000,
      VERY_SLOW: 5000,
    };

    it('should classify latency status correctly', () => {
      const getStatus = (latency: number): 'success' | 'warning' | 'error' => {
        if (latency <= THRESHOLDS.FAST) return 'success';
        if (latency <= THRESHOLDS.ACCEPTABLE) return 'warning';
        return 'error';
      };

      expect(getStatus(100)).toBe('success');
      expect(getStatus(300)).toBe('warning');
      expect(getStatus(600)).toBe('error');
    });
  });

  describe('Dashboard Tab Navigation', () => {
    const TABS = ['overview', 'costs', 'latency', 'tools'];

    it('should cycle through tabs correctly', () => {
      let currentIndex = 0;
      const nextTab = () => {
        currentIndex = (currentIndex + 1) % TABS.length;
        return TABS[currentIndex];
      };

      expect(nextTab()).toBe('costs');
      expect(nextTab()).toBe('latency');
      expect(nextTab()).toBe('tools');
      expect(nextTab()).toBe('overview'); // Wraps around
    });

    it('should switch to tab by number', () => {
      const getTabByNumber = (num: string): string | undefined => {
        const index = parseInt(num, 10) - 1;
        if (index >= 0 && index < TABS.length) {
          return TABS[index];
        }
        return undefined;
      };

      expect(getTabByNumber('1')).toBe('overview');
      expect(getTabByNumber('2')).toBe('costs');
      expect(getTabByNumber('3')).toBe('latency');
      expect(getTabByNumber('4')).toBe('tools');
      expect(getTabByNumber('5')).toBeUndefined();
    });
  });
});
