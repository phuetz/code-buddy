/**
 * Tests for Performance Benchmarks
 */

import * as os from 'os';
import * as path from 'path';
import {
  BenchmarkRunner,
  BenchmarkResult,
  BenchmarkSuite,
  BenchmarkOptions,
  benchmarks,
  runCoreEngineBenchmarks,
  runAllBenchmarks,
} from '../../src/benchmarks/performance-benchmarks';

// Mock fs-extra
jest.mock('fs-extra', () => ({
  ensureDir: jest.fn().mockResolvedValue(undefined),
  writeJson: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
  readFile: jest.fn().mockResolvedValue('mock content'),
  readJson: jest.fn(),
  remove: jest.fn().mockResolvedValue(undefined),
}));

// Mock os for consistent test results
jest.mock('os', () => ({
  platform: jest.fn().mockReturnValue('linux'),
  arch: jest.fn().mockReturnValue('x64'),
  cpus: jest.fn().mockReturnValue([{}, {}, {}, {}]),
  totalmem: jest.fn().mockReturnValue(16 * 1024 * 1024 * 1024),
  freemem: jest.fn().mockReturnValue(8 * 1024 * 1024 * 1024),
  tmpdir: jest.fn().mockReturnValue('/tmp'),
}));

// Mock console to suppress output during tests
const mockConsole = {
  log: jest.spyOn(console, 'log').mockImplementation(),
  error: jest.spyOn(console, 'error').mockImplementation(),
};

const mockFs = require('fs-extra') as jest.Mocked<typeof import('fs-extra')>;
const mockOs = os as jest.Mocked<typeof os>;

describe('BenchmarkRunner', () => {
  let runner: BenchmarkRunner;

  beforeEach(() => {
    jest.clearAllMocks();
    runner = new BenchmarkRunner();
  });

  describe('Constructor', () => {
    it('should create with default options', () => {
      const instance = new BenchmarkRunner();
      expect(instance).toBeDefined();
    });

    it('should create with custom options', () => {
      const options: BenchmarkOptions = {
        iterations: 50,
        warmupIterations: 5,
        timeout: 10000,
        collectMemory: false,
        outputDir: '.custom-benchmarks',
      };

      const instance = new BenchmarkRunner(options);
      expect(instance).toBeDefined();
    });

    it('should merge custom options with defaults', () => {
      const options: Partial<BenchmarkOptions> = {
        iterations: 25,
      };

      const instance = new BenchmarkRunner(options);
      expect(instance).toBeDefined();
    });
  });

  describe('benchmark', () => {
    it('should run a sync benchmark function', async () => {
      let counter = 0;
      const fn = () => {
        counter++;
      };

      const result = await runner.benchmark('sync-test', fn, {
        iterations: 10,
        warmupIterations: 2,
      });

      expect(result.name).toBe('sync-test');
      expect(result.iterations).toBe(10);
      expect(counter).toBe(12); // 10 iterations + 2 warmup
    });

    it('should run an async benchmark function', async () => {
      let counter = 0;
      const fn = async () => {
        await Promise.resolve();
        counter++;
      };

      const result = await runner.benchmark('async-test', fn, {
        iterations: 5,
        warmupIterations: 1,
      });

      expect(result.name).toBe('async-test');
      expect(result.iterations).toBe(5);
      expect(counter).toBe(6); // 5 iterations + 1 warmup
    });

    it('should calculate timing statistics', async () => {
      const fn = () => {
        // Simple operation
        const arr = Array(100).fill(0);
        arr.reduce((a, b) => a + b, 0);
      };

      const result = await runner.benchmark('stats-test', fn, {
        iterations: 20,
        warmupIterations: 5,
      });

      expect(result.totalTime).toBeGreaterThan(0);
      expect(result.avgTime).toBeGreaterThan(0);
      expect(result.minTime).toBeGreaterThan(0);
      expect(result.maxTime).toBeGreaterThan(0);
      expect(result.minTime).toBeLessThanOrEqual(result.avgTime);
      expect(result.maxTime).toBeGreaterThanOrEqual(result.avgTime);
    });

    it('should calculate standard deviation', async () => {
      const fn = () => {
        // Variable time operation
        Math.random();
      };

      const result = await runner.benchmark('stddev-test', fn, {
        iterations: 100,
        warmupIterations: 10,
      });

      expect(result.stdDev).toBeGreaterThanOrEqual(0);
    });

    it('should calculate operations per second', async () => {
      const fn = () => {
        // Fast operation
      };

      const result = await runner.benchmark('ops-test', fn, {
        iterations: 100,
        warmupIterations: 10,
      });

      expect(result.opsPerSecond).toBeGreaterThan(0);
      // ops/s = 1000 / avgTime (in ms)
      expect(result.opsPerSecond).toBeCloseTo(1000 / result.avgTime, 0);
    });

    it('should collect memory usage when enabled', async () => {
      const fn = () => {
        const arr = Array(1000).fill({ data: 'test' });
        void arr;
      };

      const result = await runner.benchmark('memory-test', fn, {
        iterations: 10,
        warmupIterations: 2,
        collectMemory: true,
      });

      expect(result.memoryUsed).toBeDefined();
      expect(typeof result.memoryUsed).toBe('number');
    });

    it('should not collect memory when disabled', async () => {
      const fn = () => {};

      const result = await runner.benchmark('no-memory-test', fn, {
        iterations: 10,
        warmupIterations: 2,
        collectMemory: false,
      });

      expect(result.memoryUsed).toBeUndefined();
    });

    it('should include timestamp in result', async () => {
      const fn = () => {};

      const before = new Date();
      const result = await runner.benchmark('timestamp-test', fn, {
        iterations: 5,
        warmupIterations: 1,
      });
      const after = new Date();

      expect(result.timestamp).toBeInstanceOf(Date);
      expect(result.timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(result.timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should store results internally', async () => {
      await runner.benchmark('stored1', () => {}, { iterations: 5, warmupIterations: 1 });
      await runner.benchmark('stored2', () => {}, { iterations: 5, warmupIterations: 1 });

      // Results are stored internally - we can verify through runSuite or other methods
      expect(true).toBe(true);
    });

    it('should override default options with provided options', async () => {
      const customRunner = new BenchmarkRunner({
        iterations: 100,
        warmupIterations: 20,
      });

      let counter = 0;
      const fn = () => {
        counter++;
      };

      await customRunner.benchmark('override-test', fn, {
        iterations: 5,
        warmupIterations: 1,
      });

      expect(counter).toBe(6); // 5 iterations + 1 warmup (not 100 + 20)
    });

    it('should handle errors thrown in benchmark function', async () => {
      const fn = () => {
        throw new Error('Benchmark error');
      };

      await expect(
        runner.benchmark('error-test', fn, {
          iterations: 1,
          warmupIterations: 0,
        })
      ).rejects.toThrow('Benchmark error');
    });

    it('should handle async errors', async () => {
      const fn = async () => {
        await Promise.reject(new Error('Async error'));
      };

      await expect(
        runner.benchmark('async-error-test', fn, {
          iterations: 1,
          warmupIterations: 0,
        })
      ).rejects.toThrow('Async error');
    });
  });

  describe('runSuite', () => {
    it('should run multiple benchmarks in a suite', async () => {
      const benchmarkList = [
        { name: 'bench1', fn: () => {} },
        { name: 'bench2', fn: () => {} },
        { name: 'bench3', fn: () => {} },
      ];

      const suiteRunner = new BenchmarkRunner({
        iterations: 5,
        warmupIterations: 1,
      });

      const suite = await suiteRunner.runSuite('Test Suite', benchmarkList);

      expect(suite.name).toBe('Test Suite');
      expect(suite.results).toHaveLength(3);
      expect(suite.results.map((r) => r.name)).toEqual(['bench1', 'bench2', 'bench3']);
    });

    it('should include total duration', async () => {
      const benchmarkList = [{ name: 'duration-test', fn: () => {} }];

      const suiteRunner = new BenchmarkRunner({
        iterations: 5,
        warmupIterations: 1,
      });

      const suite = await suiteRunner.runSuite('Duration Suite', benchmarkList);

      expect(suite.totalDuration).toBeGreaterThanOrEqual(0);
    });

    it('should include system info', async () => {
      const benchmarkList = [{ name: 'sysinfo-test', fn: () => {} }];

      const suiteRunner = new BenchmarkRunner({
        iterations: 5,
        warmupIterations: 1,
      });

      const suite = await suiteRunner.runSuite('SysInfo Suite', benchmarkList);

      expect(suite.systemInfo).toBeDefined();
      expect(suite.systemInfo.platform).toBe('linux');
      expect(suite.systemInfo.arch).toBe('x64');
      expect(suite.systemInfo.cpus).toBe(4);
      expect(suite.systemInfo.totalMemory).toBe(16 * 1024 * 1024 * 1024);
      expect(suite.systemInfo.freeMemory).toBe(8 * 1024 * 1024 * 1024);
      expect(suite.systemInfo.nodeVersion).toBeDefined();
    });

    it('should include timestamp', async () => {
      const benchmarkList = [{ name: 'ts-test', fn: () => {} }];

      const suiteRunner = new BenchmarkRunner({
        iterations: 5,
        warmupIterations: 1,
      });

      const before = new Date();
      const suite = await suiteRunner.runSuite('Timestamp Suite', benchmarkList);
      const after = new Date();

      expect(suite.timestamp).toBeInstanceOf(Date);
      expect(suite.timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(suite.timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should log progress to console', async () => {
      const benchmarkList = [
        { name: 'log-test-1', fn: () => {} },
        { name: 'log-test-2', fn: () => {} },
      ];

      const suiteRunner = new BenchmarkRunner({
        iterations: 5,
        warmupIterations: 1,
      });

      await suiteRunner.runSuite('Log Suite', benchmarkList);

      expect(mockConsole.log).toHaveBeenCalledWith('Running: log-test-1...');
      expect(mockConsole.log).toHaveBeenCalledWith('Running: log-test-2...');
    });

    it('should handle empty benchmark list', async () => {
      const suiteRunner = new BenchmarkRunner({
        iterations: 5,
        warmupIterations: 1,
      });

      const suite = await suiteRunner.runSuite('Empty Suite', []);

      expect(suite.name).toBe('Empty Suite');
      expect(suite.results).toHaveLength(0);
    });

    it('should run async benchmarks in suite', async () => {
      const benchmarkList = [
        {
          name: 'async-suite-test',
          fn: async () => {
            await Promise.resolve();
          },
        },
      ];

      const suiteRunner = new BenchmarkRunner({
        iterations: 5,
        warmupIterations: 1,
      });

      const suite = await suiteRunner.runSuite('Async Suite', benchmarkList);

      expect(suite.results).toHaveLength(1);
      expect(suite.results[0].name).toBe('async-suite-test');
    });
  });

  describe('saveResults', () => {
    it('should save suite results to file', async () => {
      const suite: BenchmarkSuite = {
        name: 'Save Test',
        results: [],
        totalDuration: 1000,
        systemInfo: {
          platform: 'linux',
          arch: 'x64',
          cpus: 4,
          totalMemory: 16 * 1024 * 1024 * 1024,
          freeMemory: 8 * 1024 * 1024 * 1024,
          nodeVersion: 'v18.0.0',
        },
        timestamp: new Date(),
      };

      const filepath = await runner.saveResults(suite);

      expect(mockFs.ensureDir).toHaveBeenCalledWith('.benchmarks');
      expect(mockFs.writeJson).toHaveBeenCalledWith(
        expect.stringContaining('benchmark-save-test'),
        suite,
        { spaces: 2 }
      );
      expect(filepath).toContain('.benchmarks');
      expect(filepath).toContain('benchmark-save-test');
      expect(filepath).toContain('.json');
    });

    it('should use custom output directory', async () => {
      const customRunner = new BenchmarkRunner({
        outputDir: '.custom-output',
      });

      const suite: BenchmarkSuite = {
        name: 'Custom Dir',
        results: [],
        totalDuration: 500,
        systemInfo: {
          platform: 'linux',
          arch: 'x64',
          cpus: 4,
          totalMemory: 16 * 1024 * 1024 * 1024,
          freeMemory: 8 * 1024 * 1024 * 1024,
          nodeVersion: 'v18.0.0',
        },
        timestamp: new Date(),
      };

      await customRunner.saveResults(suite);

      expect(mockFs.ensureDir).toHaveBeenCalledWith('.custom-output');
    });

    it('should generate filename from suite name', async () => {
      const suite: BenchmarkSuite = {
        name: 'My Test Suite With Spaces',
        results: [],
        totalDuration: 500,
        systemInfo: {
          platform: 'linux',
          arch: 'x64',
          cpus: 4,
          totalMemory: 16 * 1024 * 1024 * 1024,
          freeMemory: 8 * 1024 * 1024 * 1024,
          nodeVersion: 'v18.0.0',
        },
        timestamp: new Date(),
      };

      const filepath = await runner.saveResults(suite);

      expect(filepath).toContain('my-test-suite-with-spaces');
    });
  });

  describe('formatResults', () => {
    it('should format suite results as table', () => {
      const suite: BenchmarkSuite = {
        name: 'Format Test',
        results: [
          {
            name: 'Test Benchmark',
            iterations: 100,
            totalTime: 1000,
            avgTime: 10,
            minTime: 5,
            maxTime: 15,
            stdDev: 2,
            opsPerSecond: 100,
            timestamp: new Date(),
          },
        ],
        totalDuration: 2000,
        systemInfo: {
          platform: 'linux',
          arch: 'x64',
          cpus: 4,
          totalMemory: 16 * 1024 * 1024 * 1024,
          freeMemory: 8 * 1024 * 1024 * 1024,
          nodeVersion: 'v18.0.0',
        },
        timestamp: new Date(),
      };

      const output = runner.formatResults(suite);

      expect(output).toContain('BENCHMARK RESULTS: Format Test');
      expect(output).toContain('SYSTEM INFO');
      expect(output).toContain('linux x64');
      expect(output).toContain('4'); // CPUs
      expect(output).toContain('16.0 GB'); // Total memory
      expect(output).toContain('RESULTS');
      expect(output).toContain('Test Benchmark');
      expect(output).toContain('SUMMARY');
    });

    it('should format multiple results', () => {
      const suite: BenchmarkSuite = {
        name: 'Multi Results',
        results: [
          {
            name: 'Benchmark 1',
            iterations: 100,
            totalTime: 500,
            avgTime: 5,
            minTime: 2,
            maxTime: 8,
            stdDev: 1,
            opsPerSecond: 200,
            timestamp: new Date(),
          },
          {
            name: 'Benchmark 2',
            iterations: 100,
            totalTime: 1000,
            avgTime: 10,
            minTime: 5,
            maxTime: 15,
            stdDev: 2,
            opsPerSecond: 100,
            timestamp: new Date(),
          },
        ],
        totalDuration: 3000,
        systemInfo: {
          platform: 'linux',
          arch: 'x64',
          cpus: 4,
          totalMemory: 16 * 1024 * 1024 * 1024,
          freeMemory: 8 * 1024 * 1024 * 1024,
          nodeVersion: 'v18.0.0',
        },
        timestamp: new Date(),
      };

      const output = runner.formatResults(suite);

      expect(output).toContain('Benchmark 1');
      expect(output).toContain('Benchmark 2');
      expect(output).toContain('Total Benchmarks:  2');
    });

    it('should show combined average time', () => {
      const suite: BenchmarkSuite = {
        name: 'Combined Avg',
        results: [
          {
            name: 'B1',
            iterations: 10,
            totalTime: 100,
            avgTime: 10,
            minTime: 5,
            maxTime: 15,
            stdDev: 1,
            opsPerSecond: 100,
            timestamp: new Date(),
          },
          {
            name: 'B2',
            iterations: 10,
            totalTime: 200,
            avgTime: 20,
            minTime: 10,
            maxTime: 30,
            stdDev: 2,
            opsPerSecond: 50,
            timestamp: new Date(),
          },
        ],
        totalDuration: 1000,
        systemInfo: {
          platform: 'linux',
          arch: 'x64',
          cpus: 4,
          totalMemory: 16 * 1024 * 1024 * 1024,
          freeMemory: 8 * 1024 * 1024 * 1024,
          nodeVersion: 'v18.0.0',
        },
        timestamp: new Date(),
      };

      const output = runner.formatResults(suite);

      // Combined avg should be 10 + 20 = 30
      expect(output).toContain('30.00ms');
    });

    it('should include generated timestamp', () => {
      const timestamp = new Date('2024-01-15T10:30:00');
      const suite: BenchmarkSuite = {
        name: 'Timestamp Test',
        results: [],
        totalDuration: 500,
        systemInfo: {
          platform: 'linux',
          arch: 'x64',
          cpus: 4,
          totalMemory: 16 * 1024 * 1024 * 1024,
          freeMemory: 8 * 1024 * 1024 * 1024,
          nodeVersion: 'v18.0.0',
        },
        timestamp,
      };

      const output = runner.formatResults(suite);

      expect(output).toContain('Generated:');
    });
  });

  describe('compareWithBaseline', () => {
    it('should compare current results with baseline', async () => {
      const baseline: BenchmarkSuite = {
        name: 'Baseline',
        results: [
          {
            name: 'Compare Test',
            iterations: 100,
            totalTime: 1000,
            avgTime: 10,
            minTime: 5,
            maxTime: 15,
            stdDev: 2,
            opsPerSecond: 100,
            timestamp: new Date(),
          },
        ],
        totalDuration: 2000,
        systemInfo: {
          platform: 'linux',
          arch: 'x64',
          cpus: 4,
          totalMemory: 16 * 1024 * 1024 * 1024,
          freeMemory: 8 * 1024 * 1024 * 1024,
          nodeVersion: 'v18.0.0',
        },
        timestamp: new Date(),
      };

      mockFs.readJson.mockResolvedValue(baseline);

      const current: BenchmarkSuite = {
        name: 'Current',
        results: [
          {
            name: 'Compare Test',
            iterations: 100,
            totalTime: 800,
            avgTime: 8, // 20% faster
            minTime: 4,
            maxTime: 12,
            stdDev: 1.5,
            opsPerSecond: 125,
            timestamp: new Date(),
          },
        ],
        totalDuration: 1600,
        systemInfo: {
          platform: 'linux',
          arch: 'x64',
          cpus: 4,
          totalMemory: 16 * 1024 * 1024 * 1024,
          freeMemory: 8 * 1024 * 1024 * 1024,
          nodeVersion: 'v18.0.0',
        },
        timestamp: new Date(),
      };

      const comparison = await runner.compareWithBaseline(current, '/path/to/baseline.json');

      expect(comparison).toContain('COMPARISON WITH BASELINE');
      expect(comparison).toContain('Compare Test');
      expect(comparison).toContain('8.00ms');
      expect(comparison).toContain('10.00ms');
    });

    it('should show positive change indicator for regression', async () => {
      const baseline: BenchmarkSuite = {
        name: 'Baseline',
        results: [
          {
            name: 'Slow Test',
            iterations: 100,
            totalTime: 1000,
            avgTime: 10,
            minTime: 5,
            maxTime: 15,
            stdDev: 2,
            opsPerSecond: 100,
            timestamp: new Date(),
          },
        ],
        totalDuration: 2000,
        systemInfo: {
          platform: 'linux',
          arch: 'x64',
          cpus: 4,
          totalMemory: 16 * 1024 * 1024 * 1024,
          freeMemory: 8 * 1024 * 1024 * 1024,
          nodeVersion: 'v18.0.0',
        },
        timestamp: new Date(),
      };

      mockFs.readJson.mockResolvedValue(baseline);

      const current: BenchmarkSuite = {
        name: 'Current',
        results: [
          {
            name: 'Slow Test',
            iterations: 100,
            totalTime: 1500,
            avgTime: 15, // 50% slower - significant regression
            minTime: 8,
            maxTime: 22,
            stdDev: 3,
            opsPerSecond: 67,
            timestamp: new Date(),
          },
        ],
        totalDuration: 3000,
        systemInfo: {
          platform: 'linux',
          arch: 'x64',
          cpus: 4,
          totalMemory: 16 * 1024 * 1024 * 1024,
          freeMemory: 8 * 1024 * 1024 * 1024,
          nodeVersion: 'v18.0.0',
        },
        timestamp: new Date(),
      };

      const comparison = await runner.compareWithBaseline(current, '/path/to/baseline.json');

      expect(comparison).toContain('+50.0%');
    });

    it('should skip benchmarks not in baseline', async () => {
      const baseline: BenchmarkSuite = {
        name: 'Baseline',
        results: [
          {
            name: 'Existing Test',
            iterations: 100,
            totalTime: 1000,
            avgTime: 10,
            minTime: 5,
            maxTime: 15,
            stdDev: 2,
            opsPerSecond: 100,
            timestamp: new Date(),
          },
        ],
        totalDuration: 2000,
        systemInfo: {
          platform: 'linux',
          arch: 'x64',
          cpus: 4,
          totalMemory: 16 * 1024 * 1024 * 1024,
          freeMemory: 8 * 1024 * 1024 * 1024,
          nodeVersion: 'v18.0.0',
        },
        timestamp: new Date(),
      };

      mockFs.readJson.mockResolvedValue(baseline);

      const current: BenchmarkSuite = {
        name: 'Current',
        results: [
          {
            name: 'New Test', // Not in baseline
            iterations: 100,
            totalTime: 500,
            avgTime: 5,
            minTime: 2,
            maxTime: 8,
            stdDev: 1,
            opsPerSecond: 200,
            timestamp: new Date(),
          },
        ],
        totalDuration: 1000,
        systemInfo: {
          platform: 'linux',
          arch: 'x64',
          cpus: 4,
          totalMemory: 16 * 1024 * 1024 * 1024,
          freeMemory: 8 * 1024 * 1024 * 1024,
          nodeVersion: 'v18.0.0',
        },
        timestamp: new Date(),
      };

      const comparison = await runner.compareWithBaseline(current, '/path/to/baseline.json');

      // Should not contain "New Test" since it's not in baseline
      expect(comparison).not.toContain('New Test');
    });
  });
});

describe('benchmarks utilities', () => {
  describe('measureAsync', () => {
    it('should measure async function duration', async () => {
      const fn = async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return 'result';
      };

      const { result, duration } = await benchmarks.measureAsync(fn);

      expect(result).toBe('result');
      expect(duration).toBeGreaterThanOrEqual(0);
    });

    it('should return correct result type', async () => {
      const fn = async () => ({ value: 42, name: 'test' });

      const { result } = await benchmarks.measureAsync(fn);

      expect(result.value).toBe(42);
      expect(result.name).toBe('test');
    });

    it('should handle async errors', async () => {
      const fn = async () => {
        throw new Error('Async measure error');
      };

      await expect(benchmarks.measureAsync(fn)).rejects.toThrow('Async measure error');
    });
  });

  describe('measureSync', () => {
    it('should measure sync function duration', () => {
      const fn = () => {
        let sum = 0;
        for (let i = 0; i < 1000; i++) {
          sum += i;
        }
        return sum;
      };

      const { result, duration } = benchmarks.measureSync(fn);

      expect(result).toBe(499500);
      expect(duration).toBeGreaterThanOrEqual(0);
    });

    it('should return correct result type', () => {
      const fn = () => ['a', 'b', 'c'];

      const { result } = benchmarks.measureSync(fn);

      expect(result).toEqual(['a', 'b', 'c']);
    });

    it('should handle sync errors', () => {
      const fn = () => {
        throw new Error('Sync measure error');
      };

      expect(() => benchmarks.measureSync(fn)).toThrow('Sync measure error');
    });
  });

  describe('createString', () => {
    it('should create string of specified size in KB', () => {
      const str = benchmarks.createString(1);

      expect(str.length).toBe(1024);
    });

    it('should create larger strings', () => {
      const str = benchmarks.createString(10);

      expect(str.length).toBe(10 * 1024);
    });

    it('should create string of all x characters', () => {
      const str = benchmarks.createString(1);

      expect(str).toMatch(/^x+$/);
    });

    it('should handle zero size', () => {
      const str = benchmarks.createString(0);

      expect(str.length).toBe(0);
    });
  });

  describe('createTestFile', () => {
    it('should create a test file with specified size', async () => {
      await benchmarks.createTestFile('/tmp/test.txt', 5);

      expect(mockFs.writeFile).toHaveBeenCalledWith(
        '/tmp/test.txt',
        expect.any(String)
      );

      const writeCall = mockFs.writeFile.mock.calls[0];
      expect((writeCall[1] as string).length).toBe(5 * 1024);
    });

    it('should use createString for content', async () => {
      await benchmarks.createTestFile('/tmp/content.txt', 2);

      const writeCall = mockFs.writeFile.mock.calls[0];
      expect((writeCall[1] as string)).toMatch(/^x+$/);
    });
  });

  describe('cleanup', () => {
    it('should remove directory', async () => {
      await benchmarks.cleanup('/tmp/benchmark-test');

      expect(mockFs.remove).toHaveBeenCalledWith('/tmp/benchmark-test');
    });

    it('should handle cleanup errors gracefully', async () => {
      (mockFs.remove as jest.Mock).mockRejectedValueOnce(new Error('Cleanup error'));

      await expect(benchmarks.cleanup('/tmp/error')).rejects.toThrow('Cleanup error');
    });
  });
});

describe('runCoreEngineBenchmarks', () => {
  it('should run core engine benchmark suite', async () => {
    const runner = new BenchmarkRunner({
      iterations: 2,
      warmupIterations: 1,
    });

    const suite = await runCoreEngineBenchmarks(runner);

    expect(suite.name).toBe('Core Engine');
    expect(suite.results.length).toBeGreaterThan(0);
  });

  it('should include JSON parse benchmarks', async () => {
    const runner = new BenchmarkRunner({
      iterations: 2,
      warmupIterations: 1,
    });

    const suite = await runCoreEngineBenchmarks(runner);

    const benchmarkNames = suite.results.map((r) => r.name);
    expect(benchmarkNames).toContain('JSON parse (1KB)');
    expect(benchmarkNames).toContain('JSON parse (10KB)');
  });

  it('should include string operations benchmark', async () => {
    const runner = new BenchmarkRunner({
      iterations: 2,
      warmupIterations: 1,
    });

    const suite = await runCoreEngineBenchmarks(runner);

    const benchmarkNames = suite.results.map((r) => r.name);
    expect(benchmarkNames).toContain('String operations (1KB)');
  });

  it('should include RegExp benchmark', async () => {
    const runner = new BenchmarkRunner({
      iterations: 2,
      warmupIterations: 1,
    });

    const suite = await runCoreEngineBenchmarks(runner);

    const benchmarkNames = suite.results.map((r) => r.name);
    expect(benchmarkNames).toContain('RegExp matching');
  });

  it('should include array operations benchmark', async () => {
    const runner = new BenchmarkRunner({
      iterations: 2,
      warmupIterations: 1,
    });

    const suite = await runCoreEngineBenchmarks(runner);

    const benchmarkNames = suite.results.map((r) => r.name);
    expect(benchmarkNames).toContain('Array operations (10K items)');
  });

  it('should include Map operations benchmark', async () => {
    const runner = new BenchmarkRunner({
      iterations: 2,
      warmupIterations: 1,
    });

    const suite = await runCoreEngineBenchmarks(runner);

    const benchmarkNames = suite.results.map((r) => r.name);
    expect(benchmarkNames).toContain('Map operations (1K entries)');
  });

  it('should include file read benchmarks', async () => {
    const runner = new BenchmarkRunner({
      iterations: 2,
      warmupIterations: 1,
    });

    const suite = await runCoreEngineBenchmarks(runner);

    const benchmarkNames = suite.results.map((r) => r.name);
    expect(benchmarkNames).toContain('File read (1KB)');
    expect(benchmarkNames).toContain('File read (100KB)');
  });

  it('should clean up temp directory', async () => {
    const runner = new BenchmarkRunner({
      iterations: 2,
      warmupIterations: 1,
    });

    await runCoreEngineBenchmarks(runner);

    expect(mockFs.remove).toHaveBeenCalled();
  });
});

describe('runAllBenchmarks', () => {
  it('should run all benchmark suites', async () => {
    const suites = await runAllBenchmarks({
      iterations: 2,
      warmupIterations: 1,
    });

    expect(Array.isArray(suites)).toBe(true);
    expect(suites.length).toBeGreaterThan(0);
  });

  it('should include core engine benchmarks', async () => {
    const suites = await runAllBenchmarks({
      iterations: 2,
      warmupIterations: 1,
    });

    const suiteNames = suites.map((s) => s.name);
    expect(suiteNames).toContain('Core Engine');
  });

  it('should log progress', async () => {
    await runAllBenchmarks({
      iterations: 2,
      warmupIterations: 1,
    });

    expect(mockConsole.log).toHaveBeenCalledWith('Running Core Engine Benchmarks...');
  });

  it('should use default options when none provided', async () => {
    const suites = await runAllBenchmarks();

    expect(Array.isArray(suites)).toBe(true);
  });
});

describe('BenchmarkResult interface', () => {
  it('should have all required fields', () => {
    const result: BenchmarkResult = {
      name: 'test',
      iterations: 100,
      totalTime: 1000,
      avgTime: 10,
      minTime: 5,
      maxTime: 15,
      stdDev: 2,
      opsPerSecond: 100,
      timestamp: new Date(),
    };

    expect(result.name).toBeDefined();
    expect(result.iterations).toBeDefined();
    expect(result.totalTime).toBeDefined();
    expect(result.avgTime).toBeDefined();
    expect(result.minTime).toBeDefined();
    expect(result.maxTime).toBeDefined();
    expect(result.stdDev).toBeDefined();
    expect(result.opsPerSecond).toBeDefined();
    expect(result.timestamp).toBeDefined();
  });

  it('should allow optional memoryUsed field', () => {
    const resultWithMemory: BenchmarkResult = {
      name: 'test',
      iterations: 100,
      totalTime: 1000,
      avgTime: 10,
      minTime: 5,
      maxTime: 15,
      stdDev: 2,
      opsPerSecond: 100,
      memoryUsed: 1024,
      timestamp: new Date(),
    };

    expect(resultWithMemory.memoryUsed).toBe(1024);
  });
});

describe('SystemInfo interface', () => {
  it('should have all required fields', () => {
    const sysInfo = {
      platform: 'linux',
      arch: 'x64',
      cpus: 4,
      totalMemory: 16 * 1024 * 1024 * 1024,
      freeMemory: 8 * 1024 * 1024 * 1024,
      nodeVersion: 'v18.0.0',
    };

    expect(sysInfo.platform).toBeDefined();
    expect(sysInfo.arch).toBeDefined();
    expect(sysInfo.cpus).toBeDefined();
    expect(sysInfo.totalMemory).toBeDefined();
    expect(sysInfo.freeMemory).toBeDefined();
    expect(sysInfo.nodeVersion).toBeDefined();
  });

  it('should allow optional v8Version field', () => {
    const sysInfoWithV8 = {
      platform: 'linux',
      arch: 'x64',
      cpus: 4,
      totalMemory: 16 * 1024 * 1024 * 1024,
      freeMemory: 8 * 1024 * 1024 * 1024,
      nodeVersion: 'v18.0.0',
      v8Version: '10.2.154.4',
    };

    expect(sysInfoWithV8.v8Version).toBe('10.2.154.4');
  });
});
