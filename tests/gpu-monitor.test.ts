/**
 * Tests for GPU Monitor
 *
 * Tests the GPU VRAM monitoring and offload recommendation system.
 */

import {
  GPUMonitor,
  getGPUMonitor,
  initializeGPUMonitor,
  resetGPUMonitor,
  DEFAULT_GPU_MONITOR_CONFIG,
} from '../src/hardware/gpu-monitor.js';

// ============================================================================
// GPUMonitor Tests
// ============================================================================

describe('GPUMonitor', () => {
  beforeEach(() => {
    resetGPUMonitor();
  });

  describe('constructor', () => {
    it('should create with default config', () => {
      const monitor = new GPUMonitor();
      const config = monitor.getConfig();
      expect(config.pollInterval).toBe(DEFAULT_GPU_MONITOR_CONFIG.pollInterval);
      expect(config.warningThreshold).toBe(DEFAULT_GPU_MONITOR_CONFIG.warningThreshold);
    });

    it('should create with custom config', () => {
      const monitor = new GPUMonitor({
        pollInterval: 10000,
        autoPoll: false,
      });
      const config = monitor.getConfig();
      expect(config.pollInterval).toBe(10000);
      expect(config.autoPoll).toBe(false);
    });
  });

  describe('initialize', () => {
    it('should initialize and return vendor', async () => {
      const monitor = new GPUMonitor();
      const vendor = await monitor.initialize();
      expect(['nvidia', 'amd', 'apple', 'intel', 'unknown']).toContain(vendor);
    });

    it('should handle multiple initialization calls', async () => {
      const monitor = new GPUMonitor();
      await monitor.initialize();
      const vendor = await monitor.initialize();
      expect(['nvidia', 'amd', 'apple', 'intel', 'unknown']).toContain(vendor);
    });
  });

  describe('getStats', () => {
    it('should return VRAM stats', async () => {
      const monitor = new GPUMonitor();
      await monitor.initialize();
      const stats = await monitor.getStats();

      expect(stats).toHaveProperty('totalVRAM');
      expect(stats).toHaveProperty('usedVRAM');
      expect(stats).toHaveProperty('freeVRAM');
      expect(stats).toHaveProperty('usagePercent');
      expect(stats).toHaveProperty('gpuCount');
      expect(stats).toHaveProperty('gpus');
      expect(stats).toHaveProperty('timestamp');

      expect(typeof stats.totalVRAM).toBe('number');
      expect(typeof stats.usedVRAM).toBe('number');
      expect(typeof stats.freeVRAM).toBe('number');
      expect(typeof stats.usagePercent).toBe('number');
    });

    it('should return consistent stats', async () => {
      const monitor = new GPUMonitor();
      await monitor.initialize();

      const stats1 = await monitor.getStats();
      const stats2 = await monitor.getStats();

      // Stats should be reasonable (not wildly different in quick succession)
      expect(stats1.totalVRAM).toBe(stats2.totalVRAM);
    });

    it('should have valid usage percentage', async () => {
      const monitor = new GPUMonitor();
      await monitor.initialize();
      const stats = await monitor.getStats();

      expect(stats.usagePercent).toBeGreaterThanOrEqual(0);
      expect(stats.usagePercent).toBeLessThanOrEqual(100);
    });
  });

  describe('calculateOffloadRecommendation', () => {
    let monitor: GPUMonitor;

    beforeEach(async () => {
      monitor = new GPUMonitor();
      await monitor.initialize();
      // Get stats to populate lastStats
      await monitor.getStats();
    });

    it('should return offload recommendation', () => {
      const recommendation = monitor.calculateOffloadRecommendation(4000);

      expect(recommendation).toHaveProperty('shouldOffload');
      expect(recommendation).toHaveProperty('suggestedGpuLayers');
      expect(recommendation).toHaveProperty('maxGpuLayers');
      expect(recommendation).toHaveProperty('reason');
      expect(recommendation).toHaveProperty('estimatedVRAMUsage');
      expect(recommendation).toHaveProperty('safeVRAMLimit');
    });

    it('should handle different model sizes', () => {
      const small = monitor.calculateOffloadRecommendation(2000);
      const large = monitor.calculateOffloadRecommendation(40000);

      expect(typeof small.suggestedGpuLayers).toBe('number');
      expect(typeof large.suggestedGpuLayers).toBe('number');
    });

    it('should return valid layer count', () => {
      const recommendation = monitor.calculateOffloadRecommendation(4000, 32);

      expect(typeof recommendation.suggestedGpuLayers).toBe('number');
      expect(recommendation.suggestedGpuLayers).toBeGreaterThanOrEqual(0);
      expect(recommendation.suggestedGpuLayers).toBeLessThanOrEqual(32);
    });

    it('should provide reason', () => {
      const recommendation = monitor.calculateOffloadRecommendation(4000);

      expect(typeof recommendation.reason).toBe('string');
      expect(recommendation.reason.length).toBeGreaterThan(0);
    });
  });

  describe('getRecommendedLayers', () => {
    let monitor: GPUMonitor;

    beforeEach(async () => {
      monitor = new GPUMonitor();
      await monitor.initialize();
    });

    it('should return layer count for 7b model', async () => {
      const layers = await monitor.getRecommendedLayers('7b');

      expect(typeof layers).toBe('number');
      expect(layers).toBeGreaterThanOrEqual(0);
    });

    it('should return layer count for 3b model', async () => {
      const layers = await monitor.getRecommendedLayers('3b');

      expect(typeof layers).toBe('number');
      expect(layers).toBeGreaterThanOrEqual(0);
    });

    it('should return layer count for 70b model', async () => {
      const layers = await monitor.getRecommendedLayers('70b');

      expect(typeof layers).toBe('number');
      expect(layers).toBeGreaterThanOrEqual(0);
    });
  });

  describe('formatStats', () => {
    it('should format stats for display', async () => {
      const monitor = new GPUMonitor();
      await monitor.initialize();
      await monitor.getStats();
      const status = monitor.formatStats();

      expect(typeof status).toBe('string');
      expect(status.length).toBeGreaterThan(0);
    });

    it('should indicate no data when stats not loaded', () => {
      const monitor = new GPUMonitor();
      const status = monitor.formatStats();

      expect(status).toContain('No data');
    });
  });

  describe('updateConfig', () => {
    it('should update configuration', () => {
      const monitor = new GPUMonitor();
      monitor.updateConfig({ pollInterval: 15000 });

      const config = monitor.getConfig();
      expect(config.pollInterval).toBe(15000);
    });

    it('should preserve other config values', () => {
      const monitor = new GPUMonitor({
        pollInterval: 5000,
        warningThreshold: 70,
      });

      monitor.updateConfig({ pollInterval: 10000 });

      const config = monitor.getConfig();
      expect(config.pollInterval).toBe(10000);
      expect(config.warningThreshold).toBe(70);
    });
  });

  describe('dispose', () => {
    it('should dispose without error', () => {
      const monitor = new GPUMonitor();
      expect(() => monitor.dispose()).not.toThrow();
    });

    it('should be able to dispose multiple times', async () => {
      const monitor = new GPUMonitor({ autoPoll: true });
      await monitor.initialize();
      monitor.dispose();

      expect(() => monitor.dispose()).not.toThrow();
    });
  });
});

// ============================================================================
// Singleton Functions Tests
// ============================================================================

describe('GPU Monitor Singleton', () => {
  beforeEach(() => {
    resetGPUMonitor();
  });

  describe('getGPUMonitor', () => {
    it('should return same instance', () => {
      const monitor1 = getGPUMonitor();
      const monitor2 = getGPUMonitor();
      expect(monitor1).toBe(monitor2);
    });

    it('should accept config on first call', () => {
      const monitor = getGPUMonitor({ pollInterval: 20000 });
      const config = monitor.getConfig();
      expect(config.pollInterval).toBe(20000);
    });

    it('should ignore config on subsequent calls', () => {
      const monitor1 = getGPUMonitor({ pollInterval: 20000 });
      const monitor2 = getGPUMonitor({ pollInterval: 5000 });

      expect(monitor1).toBe(monitor2);
      expect(monitor2.getConfig().pollInterval).toBe(20000);
    });
  });

  describe('initializeGPUMonitor', () => {
    it('should initialize and return monitor', async () => {
      const monitor = await initializeGPUMonitor();
      expect(monitor).toBeInstanceOf(GPUMonitor);
    });

    it('should return same instance as getGPUMonitor', async () => {
      const initialized = await initializeGPUMonitor();
      const gotten = getGPUMonitor();
      expect(initialized).toBe(gotten);
    });
  });

  describe('resetGPUMonitor', () => {
    it('should reset singleton', () => {
      const monitor1 = getGPUMonitor();
      resetGPUMonitor();
      const monitor2 = getGPUMonitor();
      expect(monitor1).not.toBe(monitor2);
    });
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe('GPU Monitor Integration', () => {
  it('should work with model loading workflow', async () => {
    const monitor = await initializeGPUMonitor();
    await monitor.getStats();

    // Simulate checking if a model can be loaded
    const modelSizeMB = 4000; // 4GB model
    const recommendation = monitor.calculateOffloadRecommendation(modelSizeMB);

    expect(recommendation.suggestedGpuLayers).toBeDefined();
    expect(recommendation.reason).toBeDefined();
  });

  it('should provide useful status for CLI display', async () => {
    const monitor = await initializeGPUMonitor();
    await monitor.getStats();
    const status = monitor.formatStats();

    // Status should be readable
    expect(typeof status).toBe('string');
    expect(status.length).toBeGreaterThan(0);
  });
});
