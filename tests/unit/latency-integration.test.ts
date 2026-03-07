/**
 * Latency Integration Tests
 *
 * Tests the integration of LatencyOptimizer into:
 * - File operations (UnifiedVfsRouter)
 * - LLM provider calls (BaseProvider)
 * - Streaming latency tracking
 */

import {
  LatencyOptimizer,
  StreamingOptimizer,
  getLatencyOptimizer,
  getStreamingOptimizer,
  measureLatency,
  resetOptimizers,
  OPERATION_TARGETS,
  LATENCY_THRESHOLDS,
} from '../../src/optimization/latency-optimizer.js';

describe('LatencyOptimizer Integration', () => {
  let optimizer: LatencyOptimizer;

  beforeEach(() => {
    resetOptimizers();
    optimizer = getLatencyOptimizer();
  });

  afterEach(() => {
    resetOptimizers();
  });

  describe('Operation Measurement', () => {
    it('should measure file_read operations', async () => {
      const result = await measureLatency('file_read', async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return 'test content';
      });

      expect(result).toBe('test content');

      const stats = optimizer.getStats();
      expect(stats.totalOperations).toBe(1);
    });

    it('should measure file_write operations', async () => {
      await measureLatency('file_write', async () => {
        await new Promise(resolve => setTimeout(resolve, 5));
      });

      const stats = optimizer.getStats();
      expect(stats.totalOperations).toBe(1);
      expect(stats.byOperation.file_write).toBeDefined();
    });

    it('should track met vs exceeded targets', async () => {
      // Fast operation - should meet target
      await measureLatency('file_read', async () => {
        await new Promise(resolve => setTimeout(resolve, 1));
      });

      const stats = optimizer.getStats();
      expect(stats.metTarget).toBeGreaterThanOrEqual(1);
    });

    it('should calculate percentiles correctly', async () => {
      // Create multiple measurements
      for (let i = 0; i < 5; i++) {
        await measureLatency('file_read', async () => {
          await new Promise(resolve => setTimeout(resolve, 5 + i));
        });
      }

      const stats = optimizer.getStats();
      expect(stats.p50).toBeGreaterThan(0);
      expect(stats.p95).toBeGreaterThanOrEqual(stats.p50);
      expect(stats.p99).toBeGreaterThanOrEqual(stats.p95);
    });

    it('should group stats by operation type', async () => {
      // Use unique operation names to avoid interference with other tests
      await measureLatency('test_read', async () => {
        await new Promise(resolve => setTimeout(resolve, 1));
      });
      await measureLatency('test_write', async () => {
        await new Promise(resolve => setTimeout(resolve, 1));
      });
      await measureLatency('test_read', async () => {
        await new Promise(resolve => setTimeout(resolve, 1));
      });

      const stats = optimizer.getStats();
      expect(stats.byOperation.test_read?.count).toBe(2);
      expect(stats.byOperation.test_write?.count).toBe(1);
    });
  });

  describe('LLM Operation Targets', () => {
    it('should have correct targets for simple_response', () => {
      expect(OPERATION_TARGETS.simple_response).toBe(500);
    });

    it('should have correct targets for complex_response', () => {
      expect(OPERATION_TARGETS.complex_response).toBe(3000);
    });

    it('should have correct targets for streaming_start', () => {
      expect(OPERATION_TARGETS.streaming_start).toBe(300);
    });
  });

  describe('Latency Thresholds', () => {
    it('should define instant threshold', () => {
      expect(LATENCY_THRESHOLDS.INSTANT).toBe(100);
    });

    it('should define fast threshold', () => {
      expect(LATENCY_THRESHOLDS.FAST).toBe(300);
    });

    it('should define acceptable threshold', () => {
      expect(LATENCY_THRESHOLDS.ACCEPTABLE).toBe(500);
    });

    it('should define slow threshold', () => {
      expect(LATENCY_THRESHOLDS.SLOW).toBe(1000);
    });
  });
});

describe('StreamingOptimizer Integration', () => {
  let streamingOptimizer: StreamingOptimizer;

  beforeEach(() => {
    resetOptimizers();
    streamingOptimizer = getStreamingOptimizer();
  });

  afterEach(() => {
    resetOptimizers();
  });

  describe('First Token Tracking', () => {
    it('should record first token latency', () => {
      streamingOptimizer.recordFirstToken(150);
      streamingOptimizer.recordFirstToken(200);

      const stats = streamingOptimizer.getStats();
      expect(stats.avgFirstToken).toBe(175);
    });

    it('should calculate first token percentiles', () => {
      // Add multiple measurements
      const latencies = [100, 150, 200, 250, 300];
      latencies.forEach(l => streamingOptimizer.recordFirstToken(l));

      const stats = streamingOptimizer.getStats();
      expect(stats.firstTokenP50).toBeGreaterThan(0);
      expect(stats.firstTokenP95).toBeGreaterThanOrEqual(stats.firstTokenP50);
    });

    it('should track meeting target percentage', () => {
      // Target is 300ms
      streamingOptimizer.recordFirstToken(200); // meets
      streamingOptimizer.recordFirstToken(250); // meets
      streamingOptimizer.recordFirstToken(400); // exceeds

      const stats = streamingOptimizer.getStats();
      expect(stats.meetingTarget).toBeCloseTo(66.67, 0);
    });
  });

  describe('Total Time Tracking', () => {
    it('should record total streaming time', () => {
      // Must also record first token for getStats to return values
      streamingOptimizer.recordFirstToken(100);
      streamingOptimizer.recordTotalTime(1000);
      streamingOptimizer.recordTotalTime(2000);

      const stats = streamingOptimizer.getStats();
      expect(stats.avgTotalTime).toBe(1500);
    });
  });

  describe('Reset', () => {
    it('should reset all stats', () => {
      streamingOptimizer.recordFirstToken(100);
      streamingOptimizer.recordTotalTime(1000);
      streamingOptimizer.reset();

      const stats = streamingOptimizer.getStats();
      expect(stats.avgFirstToken).toBe(0);
      expect(stats.avgTotalTime).toBe(0);
    });
  });
});

describe('Singleton Behavior', () => {
  beforeEach(() => {
    resetOptimizers();
  });

  afterEach(() => {
    resetOptimizers();
  });

  it('should return same instance for latency optimizer', () => {
    const optimizer1 = getLatencyOptimizer();
    const optimizer2 = getLatencyOptimizer();
    expect(optimizer1).toBe(optimizer2);
  });

  it('should return same instance for streaming optimizer', () => {
    const optimizer1 = getStreamingOptimizer();
    const optimizer2 = getStreamingOptimizer();
    expect(optimizer1).toBe(optimizer2);
  });

  it('should create new instances after reset', () => {
    const before = getLatencyOptimizer();
    resetOptimizers();
    const after = getLatencyOptimizer();
    expect(before).not.toBe(after);
  });
});

describe('Event Emission', () => {
  let optimizer: LatencyOptimizer;

  beforeEach(() => {
    resetOptimizers();
    optimizer = getLatencyOptimizer();
  });

  afterEach(() => {
    resetOptimizers();
  });

  it('should emit operation:start event', async () => {
    await new Promise<void>((resolve, reject) => {
      optimizer.once('operation:start', (event) => {
        try {
          expect(event.operation).toBe('file_read');
          expect(event.target).toBe(OPERATION_TARGETS.file_read);
          resolve();
        } catch (error) {
          reject(error);
        }
      });

      optimizer.startOperation('file_read');
    });
  });

  it('should emit operation:end event', async () => {
    await new Promise<void>((resolve, reject) => {
      optimizer.once('operation:end', (event) => {
        try {
          expect(event.operation).toBe('file_read');
          expect(event.duration).toBeGreaterThanOrEqual(0);
          expect(event.status).toMatch(/met|exceeded/);
          resolve();
        } catch (error) {
          reject(error);
        }
      });

      const id = optimizer.startOperation('file_read');
      optimizer.endOperation(id);
    });
  });

  it('should emit cache:hit and cache:miss events', async () => {
    const hits: string[] = [];
    const misses: string[] = [];

    optimizer.on('cache:hit', (e) => hits.push(e.key));
    optimizer.on('cache:miss', (e) => misses.push(e.key));

    // First call - miss
    await optimizer.precompute('test-key', async () => 'value', 60000);
    expect(misses).toContain('test-key');

    // Second call - hit
    await optimizer.precompute('test-key', async () => 'value', 60000);
    expect(hits).toContain('test-key');
  });
});
