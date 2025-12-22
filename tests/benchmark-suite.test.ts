/**
 * Tests for Benchmark Suite
 *
 * Tests LLM performance benchmarking with TTFT/TPS metrics.
 */

import {
  BenchmarkSuite,
  getBenchmarkSuite,
  resetBenchmarkSuite,
  DEFAULT_PROMPTS,
  type BenchmarkCallback,
} from '../src/performance/benchmark-suite.js';

// ============================================================================
// Mock Callback
// ============================================================================

function createMockCallback(
  options: {
    latencyMs?: number;
    ttftMs?: number;
    outputTokens?: number;
    failRate?: number;
  } = {}
): BenchmarkCallback {
  const {
    latencyMs = 100,
    ttftMs = 20,
    outputTokens = 50,
    failRate = 0,
  } = options;

  return async (prompt: string, onFirstToken?: () => void) => {
    // Simulate TTFT
    await new Promise((resolve) => setTimeout(resolve, ttftMs));
    if (onFirstToken) onFirstToken();

    // Simulate remaining generation
    await new Promise((resolve) => setTimeout(resolve, latencyMs - ttftMs));

    // Random failure based on failRate
    if (Math.random() < failRate) {
      throw new Error('Simulated failure');
    }

    return {
      content: 'Mock response '.repeat(10),
      inputTokens: Math.ceil(prompt.length / 4),
      outputTokens,
    };
  };
}

// ============================================================================
// BenchmarkSuite Tests
// ============================================================================

describe('BenchmarkSuite', () => {
  beforeEach(() => {
    resetBenchmarkSuite();
  });

  describe('constructor', () => {
    it('should create with default config', () => {
      const suite = new BenchmarkSuite();
      const config = suite.getConfig();

      expect(config.warmupRuns).toBe(2);
      expect(config.runs).toBe(10);
      expect(config.concurrency).toBe(1);
      expect(config.timeout).toBe(60000);
    });

    it('should create with custom config', () => {
      const suite = new BenchmarkSuite({
        warmupRuns: 1,
        runs: 5,
        concurrency: 2,
        timeout: 30000,
      });
      const config = suite.getConfig();

      expect(config.warmupRuns).toBe(1);
      expect(config.runs).toBe(5);
      expect(config.concurrency).toBe(2);
      expect(config.timeout).toBe(30000);
    });

    it('should use custom prompts', () => {
      const prompts = [
        { name: 'custom', prompt: 'Custom prompt', category: 'simple' as const },
      ];
      const suite = new BenchmarkSuite({ prompts });
      const config = suite.getConfig();

      expect(config.prompts).toHaveLength(1);
      expect(config.prompts[0].name).toBe('custom');
    });
  });

  describe('run', () => {
    it('should run benchmark and return results', async () => {
      const suite = new BenchmarkSuite({
        warmupRuns: 1,
        runs: 3,
      });

      const callback = createMockCallback({ latencyMs: 50 });
      const results = await suite.run('test-model', callback);

      expect(results.model).toBe('test-model');
      expect(results.runs).toHaveLength(3);
      expect(results.summary.totalRuns).toBe(3);
      expect(results.timestamp).toBeInstanceOf(Date);
    });

    it('should track successful and failed runs', async () => {
      const suite = new BenchmarkSuite({
        warmupRuns: 0,
        runs: 10,
      });

      const callback = createMockCallback({ failRate: 0.3 });
      const results = await suite.run('test-model', callback);

      expect(results.summary.totalRuns).toBe(10);
      expect(results.summary.successfulRuns + results.summary.failedRuns).toBe(10);
    });

    it('should emit phase events', async () => {
      const suite = new BenchmarkSuite({
        warmupRuns: 1,
        runs: 2,
      });

      const phaseHandler = jest.fn();
      suite.on('phase', phaseHandler);

      await suite.run('test-model', createMockCallback());

      expect(phaseHandler).toHaveBeenCalledWith(
        expect.objectContaining({ phase: 'warmup' })
      );
      expect(phaseHandler).toHaveBeenCalledWith(
        expect.objectContaining({ phase: 'benchmark' })
      );
    });

    it('should emit run events', async () => {
      const suite = new BenchmarkSuite({
        warmupRuns: 0,
        runs: 3,
      });

      const runHandler = jest.fn();
      suite.on('run', runHandler);

      await suite.run('test-model', createMockCallback());

      expect(runHandler).toHaveBeenCalledTimes(3);
    });

    it('should emit complete event', async () => {
      const suite = new BenchmarkSuite({
        warmupRuns: 0,
        runs: 2,
      });

      const completeHandler = jest.fn();
      suite.on('complete', completeHandler);

      await suite.run('test-model', createMockCallback());

      expect(completeHandler).toHaveBeenCalledTimes(1);
      expect(completeHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'test-model',
          summary: expect.any(Object),
        })
      );
    });

    it('should throw if already running', async () => {
      const suite = new BenchmarkSuite({
        warmupRuns: 0,
        runs: 5,
      });

      const callback = createMockCallback({ latencyMs: 100 });

      // Start first run
      const firstRun = suite.run('test-model', callback);

      // Try to start second run immediately
      await expect(suite.run('test-model', callback)).rejects.toThrow(
        'already running'
      );

      // Wait for first run to complete
      await firstRun;
    });

    it('should handle timeout', async () => {
      const suite = new BenchmarkSuite({
        warmupRuns: 0,
        runs: 1,
        timeout: 50, // Very short timeout
      });

      const callback = createMockCallback({ latencyMs: 200 }); // Longer than timeout
      const results = await suite.run('test-model', callback);

      expect(results.summary.failedRuns).toBe(1);
      expect(results.runs[0].error).toContain('Timeout');
    });
  });

  describe('run - concurrent', () => {
    it('should run benchmarks concurrently', async () => {
      const suite = new BenchmarkSuite({
        warmupRuns: 0,
        runs: 4,
        concurrency: 2,
      });

      const batchHandler = jest.fn();
      suite.on('batchComplete', batchHandler);

      const callback = createMockCallback({ latencyMs: 50 });
      const results = await suite.run('test-model', callback);

      expect(results.summary.totalRuns).toBe(4);
      expect(batchHandler).toHaveBeenCalledTimes(2); // 4 runs / 2 concurrency = 2 batches
    });
  });

  describe('summary statistics', () => {
    it('should calculate percentiles', async () => {
      const suite = new BenchmarkSuite({
        warmupRuns: 0,
        runs: 10,
      });

      const callback = createMockCallback({ latencyMs: 100 });
      const results = await suite.run('test-model', callback);

      expect(results.summary.ttft.p50).toBeGreaterThan(0);
      expect(results.summary.ttft.p95).toBeGreaterThanOrEqual(results.summary.ttft.p50);
      expect(results.summary.ttft.p99).toBeGreaterThanOrEqual(results.summary.ttft.p95);
    });

    it('should calculate average and standard deviation', async () => {
      const suite = new BenchmarkSuite({
        warmupRuns: 0,
        runs: 5,
      });

      const callback = createMockCallback();
      const results = await suite.run('test-model', callback);

      expect(results.summary.ttft.avg).toBeGreaterThan(0);
      expect(results.summary.ttft.stdDev).toBeGreaterThanOrEqual(0);
    });

    it('should calculate TPS', async () => {
      const suite = new BenchmarkSuite({
        warmupRuns: 0,
        runs: 3,
      });

      const callback = createMockCallback({ outputTokens: 100, latencyMs: 100 });
      const results = await suite.run('test-model', callback);

      expect(results.summary.tps.avg).toBeGreaterThan(0);
    });

    it('should calculate throughput', async () => {
      const suite = new BenchmarkSuite({
        warmupRuns: 0,
        runs: 5,
      });

      const callback = createMockCallback({ latencyMs: 50 });
      const results = await suite.run('test-model', callback);

      expect(results.summary.throughput).toBeGreaterThan(0);
    });

    it('should track token counts', async () => {
      const suite = new BenchmarkSuite({
        warmupRuns: 0,
        runs: 3,
      });

      const callback = createMockCallback({ outputTokens: 50 });
      const results = await suite.run('test-model', callback);

      expect(results.summary.inputTokens.total).toBeGreaterThan(0);
      expect(results.summary.outputTokens.total).toBe(150); // 3 runs × 50 tokens
      expect(results.summary.outputTokens.average).toBe(50);
    });

    it('should calculate cost', async () => {
      const suite = new BenchmarkSuite({
        warmupRuns: 0,
        runs: 2,
      });

      const callback = createMockCallback();
      const results = await suite.run('test-model', callback);

      expect(results.summary.cost.total).toBeGreaterThanOrEqual(0);
      expect(results.summary.cost.average).toBeGreaterThanOrEqual(0);
    });
  });

  describe('formatResults', () => {
    it('should format results for display', async () => {
      const suite = new BenchmarkSuite({
        warmupRuns: 0,
        runs: 3,
      });

      const callback = createMockCallback();
      const results = await suite.run('test-model', callback);
      const formatted = suite.formatResults(results);

      expect(typeof formatted).toBe('string');
      expect(formatted).toContain('BENCHMARK RESULTS');
      expect(formatted).toContain('test-model');
      expect(formatted).toContain('LATENCY');
      expect(formatted).toContain('TTFT');
      expect(formatted).toContain('TPS');
      expect(formatted).toContain('COST');
    });
  });

  describe('exportJSON', () => {
    it('should export results as JSON', async () => {
      const suite = new BenchmarkSuite({
        warmupRuns: 0,
        runs: 2,
      });

      const callback = createMockCallback();
      const results = await suite.run('test-model', callback);
      const json = suite.exportJSON(results);

      expect(typeof json).toBe('string');
      const parsed = JSON.parse(json);
      expect(parsed.model).toBe('test-model');
      expect(parsed.runs).toHaveLength(2);
    });
  });

  describe('compare', () => {
    it('should compare two benchmark results', async () => {
      const suite = new BenchmarkSuite({
        warmupRuns: 0,
        runs: 3,
      });

      const slowCallback = createMockCallback({ latencyMs: 200, ttftMs: 100 });
      const fastCallback = createMockCallback({ latencyMs: 100, ttftMs: 20 });

      const baseline = await suite.run('slow-model', slowCallback);

      // Reset for second run
      resetBenchmarkSuite();
      const suite2 = new BenchmarkSuite({ warmupRuns: 0, runs: 3 });
      const current = await suite2.run('fast-model', fastCallback);

      const comparison = suite2.compare(baseline, current);

      expect(comparison.baseline).toBe('slow-model');
      expect(comparison.current).toBe('fast-model');
      // Check that comparison has valid structure
      expect(comparison.ttft).toHaveProperty('baseline');
      expect(comparison.ttft).toHaveProperty('current');
      expect(comparison.ttft).toHaveProperty('diff');
      expect(comparison.ttft).toHaveProperty('improved');
      expect(typeof comparison.ttft.improved).toBe('boolean');
    });
  });

  describe('updateConfig', () => {
    it('should update configuration', () => {
      const suite = new BenchmarkSuite();
      suite.updateConfig({ runs: 20 });

      const config = suite.getConfig();
      expect(config.runs).toBe(20);
    });
  });
});

// ============================================================================
// DEFAULT_PROMPTS Tests
// ============================================================================

describe('DEFAULT_PROMPTS', () => {
  it('should have multiple prompts', () => {
    expect(DEFAULT_PROMPTS.length).toBeGreaterThan(0);
  });

  it('should have required properties', () => {
    for (const prompt of DEFAULT_PROMPTS) {
      expect(prompt.name).toBeDefined();
      expect(prompt.prompt).toBeDefined();
      expect(typeof prompt.name).toBe('string');
      expect(typeof prompt.prompt).toBe('string');
    }
  });

  it('should have different categories', () => {
    const categories = new Set(DEFAULT_PROMPTS.map((p) => p.category));
    expect(categories.size).toBeGreaterThan(1);
  });

  it('should include code prompts', () => {
    const codePrompts = DEFAULT_PROMPTS.filter((p) => p.category === 'code');
    expect(codePrompts.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// Singleton Tests
// ============================================================================

describe('Benchmark Suite Singleton', () => {
  beforeEach(() => {
    resetBenchmarkSuite();
  });

  describe('getBenchmarkSuite', () => {
    it('should return same instance', () => {
      const s1 = getBenchmarkSuite();
      const s2 = getBenchmarkSuite();
      expect(s1).toBe(s2);
    });

    it('should accept config on first call', () => {
      const suite = getBenchmarkSuite({ runs: 15 });
      expect(suite.getConfig().runs).toBe(15);
    });
  });

  describe('resetBenchmarkSuite', () => {
    it('should reset singleton', () => {
      const s1 = getBenchmarkSuite();
      resetBenchmarkSuite();
      const s2 = getBenchmarkSuite();
      expect(s1).not.toBe(s2);
    });
  });
});
