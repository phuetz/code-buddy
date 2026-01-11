/**
 * Automated Performance Benchmarks
 *
 * Measure and track performance:
 * - Startup time
 * - Tool execution latency
 * - Memory usage
 * - Token processing speed
 * - File operation throughput
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { logger } from '../utils/logger.js';

export interface BenchmarkResult {
  name: string;
  iterations: number;
  totalTime: number;
  avgTime: number;
  minTime: number;
  maxTime: number;
  stdDev: number;
  opsPerSecond: number;
  memoryUsed?: number;
  timestamp: Date;
}

export interface BenchmarkSuite {
  name: string;
  results: BenchmarkResult[];
  totalDuration: number;
  systemInfo: SystemInfo;
  timestamp: Date;
}

export interface SystemInfo {
  platform: string;
  arch: string;
  cpus: number;
  totalMemory: number;
  freeMemory: number;
  nodeVersion: string;
  v8Version?: string;
}

export interface BenchmarkOptions {
  /** Number of iterations */
  iterations?: number;
  /** Warmup iterations */
  warmupIterations?: number;
  /** Timeout per iteration in ms */
  timeout?: number;
  /** Collect memory stats */
  collectMemory?: boolean;
  /** Output directory */
  outputDir?: string;
}

const DEFAULT_OPTIONS: Required<BenchmarkOptions> = {
  iterations: 100,
  warmupIterations: 10,
  timeout: 30000,
  collectMemory: true,
  outputDir: '.benchmarks',
};

/**
 * Benchmark Runner
 */
export class BenchmarkRunner {
  private options: Required<BenchmarkOptions>;
  private results: BenchmarkResult[] = [];

  constructor(options?: BenchmarkOptions) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Run a benchmark
   */
  async benchmark(
    name: string,
    fn: () => Promise<void> | void,
    options?: Partial<BenchmarkOptions>
  ): Promise<BenchmarkResult> {
    const opts = { ...this.options, ...options };
    const times: number[] = [];
    let memoryUsed = 0;

    // Warmup
    for (let i = 0; i < opts.warmupIterations; i++) {
      await fn();
    }

    // Force GC if available
    if (global.gc) {
      global.gc();
    }

    const startMemory = process.memoryUsage().heapUsed;

    // Run iterations
    for (let i = 0; i < opts.iterations; i++) {
      const start = performance.now();
      await fn();
      const end = performance.now();
      times.push(end - start);
    }

    if (opts.collectMemory) {
      memoryUsed = process.memoryUsage().heapUsed - startMemory;
    }

    const totalTime = times.reduce((a, b) => a + b, 0);
    const avgTime = totalTime / times.length;
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);

    // Calculate standard deviation
    const squaredDiffs = times.map(t => Math.pow(t - avgTime, 2));
    const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / squaredDiffs.length;
    const stdDev = Math.sqrt(avgSquaredDiff);

    const result: BenchmarkResult = {
      name,
      iterations: opts.iterations,
      totalTime,
      avgTime,
      minTime,
      maxTime,
      stdDev,
      opsPerSecond: 1000 / avgTime,
      memoryUsed: opts.collectMemory ? memoryUsed : undefined,
      timestamp: new Date(),
    };

    this.results.push(result);
    return result;
  }

  /**
   * Run multiple benchmarks as a suite
   */
  async runSuite(
    name: string,
    benchmarks: Array<{ name: string; fn: () => Promise<void> | void }>
  ): Promise<BenchmarkSuite> {
    const startTime = Date.now();
    const results: BenchmarkResult[] = [];

    for (const { name: benchName, fn } of benchmarks) {
      logger.info(`Running: ${benchName}...`);
      const result = await this.benchmark(benchName, fn);
      results.push(result);
      logger.info(`  ${result.avgTime.toFixed(2)}ms avg (${result.opsPerSecond.toFixed(2)} ops/s)`);
    }

    const suite: BenchmarkSuite = {
      name,
      results,
      totalDuration: Date.now() - startTime,
      systemInfo: this.getSystemInfo(),
      timestamp: new Date(),
    };

    return suite;
  }

  /**
   * Get system information
   */
  private getSystemInfo(): SystemInfo {
    return {
      platform: os.platform(),
      arch: os.arch(),
      cpus: os.cpus().length,
      totalMemory: os.totalmem(),
      freeMemory: os.freemem(),
      nodeVersion: process.version,
      v8Version: process.versions.v8,
    };
  }

  /**
   * Save results to file
   */
  async saveResults(suite: BenchmarkSuite): Promise<string> {
    await fs.ensureDir(this.options.outputDir);

    const filename = `benchmark-${suite.name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}.json`;
    const filepath = path.join(this.options.outputDir, filename);

    await fs.writeJson(filepath, suite, { spaces: 2 });
    return filepath;
  }

  /**
   * Format results as table
   */
  formatResults(suite: BenchmarkSuite): string {
    const lines: string[] = [];

    lines.push('');
    lines.push('═══════════════════════════════════════════════════════════════════════════════');
    lines.push(`                        BENCHMARK RESULTS: ${suite.name}`);
    lines.push('═══════════════════════════════════════════════════════════════════════════════');
    lines.push('');

    // System info
    lines.push('SYSTEM INFO');
    lines.push('───────────────────────────────────────────────────────────────────────────────');
    lines.push(`  Platform:    ${suite.systemInfo.platform} ${suite.systemInfo.arch}`);
    lines.push(`  CPUs:        ${suite.systemInfo.cpus}`);
    lines.push(`  Memory:      ${(suite.systemInfo.totalMemory / 1024 / 1024 / 1024).toFixed(1)} GB`);
    lines.push(`  Node:        ${suite.systemInfo.nodeVersion}`);
    lines.push('');

    // Results table
    lines.push('RESULTS');
    lines.push('───────────────────────────────────────────────────────────────────────────────');
    lines.push('  Name                          Avg (ms)    Min      Max      Ops/s');
    lines.push('  ─────────────────────────────────────────────────────────────────────────────');

    for (const result of suite.results) {
      const name = result.name.padEnd(30);
      const avg = result.avgTime.toFixed(2).padStart(8);
      const min = result.minTime.toFixed(2).padStart(8);
      const max = result.maxTime.toFixed(2).padStart(8);
      const ops = result.opsPerSecond.toFixed(0).padStart(10);
      lines.push(`  ${name} ${avg} ${min} ${max} ${ops}`);
    }

    lines.push('');

    // Summary
    const totalAvg = suite.results.reduce((s, r) => s + r.avgTime, 0);
    lines.push('SUMMARY');
    lines.push('───────────────────────────────────────────────────────────────────────────────');
    lines.push(`  Total Benchmarks:  ${suite.results.length}`);
    lines.push(`  Total Duration:    ${(suite.totalDuration / 1000).toFixed(2)}s`);
    lines.push(`  Combined Avg:      ${totalAvg.toFixed(2)}ms`);
    lines.push('');

    lines.push('═══════════════════════════════════════════════════════════════════════════════');
    lines.push(`Generated: ${suite.timestamp.toLocaleString()}`);

    return lines.join('\n');
  }

  /**
   * Compare with previous results
   */
  async compareWithBaseline(suite: BenchmarkSuite, baselinePath: string): Promise<string> {
    const baseline = await fs.readJson(baselinePath) as BenchmarkSuite;
    const lines: string[] = [];

    lines.push('');
    lines.push('COMPARISON WITH BASELINE');
    lines.push('───────────────────────────────────────────────────────────────────────────────');
    lines.push('  Name                          Current    Baseline   Change');
    lines.push('  ─────────────────────────────────────────────────────────────────────────────');

    for (const result of suite.results) {
      const baselineResult = baseline.results.find(r => r.name === result.name);
      if (!baselineResult) continue;

      const name = result.name.padEnd(30);
      const current = result.avgTime.toFixed(2).padStart(8);
      const base = baselineResult.avgTime.toFixed(2).padStart(10);
      const change = ((result.avgTime - baselineResult.avgTime) / baselineResult.avgTime * 100);
      const changeStr = `${change >= 0 ? '+' : ''}${change.toFixed(1)}%`.padStart(10);
      const indicator = change > 5 ? '⚠️' : change < -5 ? '✓' : '';

      lines.push(`  ${name} ${current}ms ${base}ms ${changeStr} ${indicator}`);
    }

    lines.push('');
    return lines.join('\n');
  }
}

/**
 * Common benchmark utilities
 */
export const benchmarks = {
  /**
   * Measure async function
   */
  async measureAsync<T>(fn: () => Promise<T>): Promise<{ result: T; duration: number }> {
    const start = performance.now();
    const result = await fn();
    const duration = performance.now() - start;
    return { result, duration };
  },

  /**
   * Measure sync function
   */
  measureSync<T>(fn: () => T): { result: T; duration: number } {
    const start = performance.now();
    const result = fn();
    const duration = performance.now() - start;
    return { result, duration };
  },

  /**
   * Create a string of specified size
   */
  createString(sizeInKB: number): string {
    return 'x'.repeat(sizeInKB * 1024);
  },

  /**
   * Create test file
   */
  async createTestFile(filePath: string, sizeInKB: number): Promise<void> {
    const content = benchmarks.createString(sizeInKB);
    await fs.writeFile(filePath, content);
  },

  /**
   * Cleanup test files
   */
  async cleanup(dir: string): Promise<void> {
    await fs.remove(dir);
  },
};

/**
 * Pre-defined benchmark suites
 */
export async function runCoreEngineBenchmarks(runner: BenchmarkRunner): Promise<BenchmarkSuite> {
  const tempDir = path.join(os.tmpdir(), 'codebuddy-benchmarks');
  await fs.ensureDir(tempDir);

  const suite = await runner.runSuite('Core Engine', [
    {
      name: 'JSON parse (1KB)',
      fn: () => {
        const data = JSON.stringify({ items: Array(100).fill({ key: 'value' }) });
        JSON.parse(data);
      },
    },
    {
      name: 'JSON parse (10KB)',
      fn: () => {
        const data = JSON.stringify({ items: Array(1000).fill({ key: 'value' }) });
        JSON.parse(data);
      },
    },
    {
      name: 'String operations (1KB)',
      fn: () => {
        const str = benchmarks.createString(1);
        str.split('\n').map(line => line.trim()).join('\n');
      },
    },
    {
      name: 'RegExp matching',
      fn: () => {
        const text = 'function test() { return "hello world"; }'.repeat(100);
        text.match(/function\s+\w+\s*\([^)]*\)/g);
      },
    },
    {
      name: 'Array operations (10K items)',
      fn: () => {
        const arr = Array.from({ length: 10000 }, (_, i) => i);
        arr.filter(x => x % 2 === 0).map(x => x * 2).reduce((a, b) => a + b, 0);
      },
    },
    {
      name: 'Map operations (1K entries)',
      fn: () => {
        const map = new Map<string, number>();
        for (let i = 0; i < 1000; i++) {
          map.set(`key-${i}`, i);
        }
        for (const [, value] of map) {
          void value;
        }
      },
    },
    {
      name: 'File read (1KB)',
      fn: async () => {
        const file = path.join(tempDir, 'test-1kb.txt');
        await fs.writeFile(file, benchmarks.createString(1));
        await fs.readFile(file, 'utf-8');
      },
    },
    {
      name: 'File read (100KB)',
      fn: async () => {
        const file = path.join(tempDir, 'test-100kb.txt');
        await fs.writeFile(file, benchmarks.createString(100));
        await fs.readFile(file, 'utf-8');
      },
    },
  ]);

  await benchmarks.cleanup(tempDir);
  return suite;
}

/**
 * Run all benchmarks
 */
export async function runAllBenchmarks(options?: BenchmarkOptions): Promise<BenchmarkSuite[]> {
  const runner = new BenchmarkRunner(options);
  const suites: BenchmarkSuite[] = [];

  logger.info('Running Core Engine Benchmarks...');
  suites.push(await runCoreEngineBenchmarks(runner));

  return suites;
}

export default BenchmarkRunner;
