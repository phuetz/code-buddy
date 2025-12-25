/**
 * Performance Profiler Tool
 *
 * Provides memory and CPU profiling utilities:
 * - Memory usage snapshots
 * - Heap statistics
 * - CPU timing measurements
 * - Performance marks
 */

import { performance, PerformanceObserver } from 'perf_hooks';
import * as v8 from 'v8';

export interface MemorySnapshot {
  timestamp: Date;
  heapUsed: number;
  heapTotal: number;
  external: number;
  arrayBuffers: number;
  rss: number;
}

export interface HeapStats {
  totalHeapSize: number;
  usedHeapSize: number;
  heapSizeLimit: number;
  totalPhysicalSize: number;
  totalAvailableSize: number;
  mallocedMemory: number;
  peakMallocedMemory: number;
}

export interface ProfileMeasurement {
  name: string;
  duration: number;
  startTime: number;
  endTime: number;
}

export interface ProfileReport {
  startTime: Date;
  endTime: Date;
  duration: number;
  memoryStart: MemorySnapshot;
  memoryEnd: MemorySnapshot;
  memoryDelta: {
    heapUsed: number;
    rss: number;
  };
  measurements: ProfileMeasurement[];
  heapStats: HeapStats;
}

/**
 * Performance Profiler
 */
export class Profiler {
  private measurements: Map<string, { start: number }> = new Map();
  private completedMeasurements: ProfileMeasurement[] = [];
  private startSnapshot: MemorySnapshot | null = null;
  private startTime: Date | null = null;

  /**
   * Take a memory snapshot
   */
  takeMemorySnapshot(): MemorySnapshot {
    const mem = process.memoryUsage();
    return {
      timestamp: new Date(),
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      external: mem.external,
      arrayBuffers: mem.arrayBuffers,
      rss: mem.rss,
    };
  }

  /**
   * Get V8 heap statistics
   */
  getHeapStats(): HeapStats {
    const stats = v8.getHeapStatistics();
    return {
      totalHeapSize: stats.total_heap_size,
      usedHeapSize: stats.used_heap_size,
      heapSizeLimit: stats.heap_size_limit,
      totalPhysicalSize: stats.total_physical_size,
      totalAvailableSize: stats.total_available_size,
      mallocedMemory: stats.malloced_memory,
      peakMallocedMemory: stats.peak_malloced_memory,
    };
  }

  /**
   * Start profiling session
   */
  startSession(): void {
    this.startTime = new Date();
    this.startSnapshot = this.takeMemorySnapshot();
    this.measurements.clear();
    this.completedMeasurements = [];
  }

  /**
   * Start timing a measurement
   */
  startMeasure(name: string): void {
    this.measurements.set(name, { start: performance.now() });
  }

  /**
   * End timing a measurement
   */
  endMeasure(name: string): number {
    const measurement = this.measurements.get(name);
    if (!measurement) {
      throw new Error(`No measurement started with name: ${name}`);
    }

    const endTime = performance.now();
    const duration = endTime - measurement.start;

    this.completedMeasurements.push({
      name,
      duration,
      startTime: measurement.start,
      endTime,
    });

    this.measurements.delete(name);
    return duration;
  }

  /**
   * Measure a function execution
   */
  async measure<T>(name: string, fn: () => T | Promise<T>): Promise<T> {
    this.startMeasure(name);
    try {
      const result = await fn();
      this.endMeasure(name);
      return result;
    } catch (error) {
      this.endMeasure(name);
      throw error;
    }
  }

  /**
   * End profiling session and get report
   */
  endSession(): ProfileReport {
    if (!this.startTime || !this.startSnapshot) {
      throw new Error('No profiling session started');
    }

    const endTime = new Date();
    const memoryEnd = this.takeMemorySnapshot();
    const heapStats = this.getHeapStats();

    return {
      startTime: this.startTime,
      endTime,
      duration: endTime.getTime() - this.startTime.getTime(),
      memoryStart: this.startSnapshot,
      memoryEnd,
      memoryDelta: {
        heapUsed: memoryEnd.heapUsed - this.startSnapshot.heapUsed,
        rss: memoryEnd.rss - this.startSnapshot.rss,
      },
      measurements: [...this.completedMeasurements],
      heapStats,
    };
  }

  /**
   * Force garbage collection (requires --expose-gc flag)
   */
  forceGC(): boolean {
    if (global.gc) {
      global.gc();
      return true;
    }
    return false;
  }
}

/**
 * Format bytes to human readable
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/**
 * Format profile report for display
 */
export function formatProfileReport(report: ProfileReport): string {
  const lines: string[] = [
    '',
    '== Performance Profile Report ==',
    '',
    `Duration: ${report.duration}ms`,
    '',
    'Memory Usage:',
    `  Start - Heap: ${formatBytes(report.memoryStart.heapUsed)} | RSS: ${formatBytes(report.memoryStart.rss)}`,
    `  End   - Heap: ${formatBytes(report.memoryEnd.heapUsed)} | RSS: ${formatBytes(report.memoryEnd.rss)}`,
    `  Delta - Heap: ${report.memoryDelta.heapUsed >= 0 ? '+' : ''}${formatBytes(report.memoryDelta.heapUsed)} | RSS: ${report.memoryDelta.rss >= 0 ? '+' : ''}${formatBytes(report.memoryDelta.rss)}`,
    '',
    'Heap Statistics:',
    `  Used: ${formatBytes(report.heapStats.usedHeapSize)} / ${formatBytes(report.heapStats.totalHeapSize)}`,
    `  Limit: ${formatBytes(report.heapStats.heapSizeLimit)}`,
    `  Peak Malloc: ${formatBytes(report.heapStats.peakMallocedMemory)}`,
    '',
  ];

  if (report.measurements.length > 0) {
    lines.push('Measurements:');
    const sorted = [...report.measurements].sort((a, b) => b.duration - a.duration);
    for (const m of sorted) {
      lines.push(`  ${m.name}: ${m.duration.toFixed(2)}ms`);
    }
  }

  return lines.join('\n');
}

// Singleton instance
let profilerInstance: Profiler | null = null;

export function getProfiler(): Profiler {
  if (!profilerInstance) {
    profilerInstance = new Profiler();
  }
  return profilerInstance;
}

export default Profiler;
