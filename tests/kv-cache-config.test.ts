/**
 * Tests for KV-Cache Configuration
 *
 * Tests KV-Cache management for local LLM inference.
 */

import {
  KVCacheManager,
  getKVCacheManager,
  resetKVCacheManager,
  MODEL_ARCHITECTURES,
  DEFAULT_KV_CACHE_CONFIG,
  type ModelArchitecture,
} from '../src/inference/kv-cache-config.js';

// ============================================================================
// KVCacheManager Tests
// ============================================================================

describe('KVCacheManager', () => {
  beforeEach(() => {
    resetKVCacheManager();
  });

  describe('constructor', () => {
    it('should create with default config', () => {
      const manager = new KVCacheManager();
      const config = manager.getConfig();

      expect(config.contextLength).toBe(DEFAULT_KV_CACHE_CONFIG.contextLength);
      expect(config.kvQuantization).toBe(DEFAULT_KV_CACHE_CONFIG.kvQuantization);
      expect(config.flashAttention).toBe(DEFAULT_KV_CACHE_CONFIG.flashAttention);
    });

    it('should create with custom config', () => {
      const manager = new KVCacheManager({
        contextLength: 8192,
        kvQuantization: 'q4_0',
        flashAttention: false,
      });
      const config = manager.getConfig();

      expect(config.contextLength).toBe(8192);
      expect(config.kvQuantization).toBe('q4_0');
      expect(config.flashAttention).toBe(false);
    });
  });

  describe('setArchitecture', () => {
    it('should set architecture from object', () => {
      const manager = new KVCacheManager();
      const arch: ModelArchitecture = {
        nLayers: 32,
        nEmbed: 4096,
        nHead: 32,
        nKVHead: 8,
      };
      manager.setArchitecture(arch);

      // Verify by checking estimate uses the architecture
      const estimate = manager.estimateMemory();
      expect(estimate.totalBytes).toBeGreaterThan(0);
    });

    it('should detect architecture from model name', () => {
      const manager = new KVCacheManager();
      manager.setArchitecture('qwen2.5-7b-instruct');

      const estimate = manager.estimateMemory();
      expect(estimate.totalBytes).toBeGreaterThan(0);
    });

    it('should detect llama architecture', () => {
      const manager = new KVCacheManager();
      manager.setArchitecture('llama-3.1-8b');

      const estimate = manager.estimateMemory();
      expect(estimate.totalBytes).toBeGreaterThan(0);
    });

    it('should fallback for unknown model', () => {
      const manager = new KVCacheManager();
      manager.setArchitecture('unknown-model-xyz');

      // Should still work with fallback
      const estimate = manager.estimateMemory();
      expect(estimate.totalBytes).toBeGreaterThan(0);
    });
  });

  describe('estimateMemory', () => {
    it('should estimate memory without architecture', () => {
      const manager = new KVCacheManager({ contextLength: 4096 });
      const estimate = manager.estimateMemory();

      expect(estimate.totalBytes).toBeGreaterThan(0);
      expect(estimate.gpuMemoryMB).toBeGreaterThan(0);
      expect(estimate.recommendation).toBeDefined();
      expect(typeof estimate.fitsInVRAM).toBe('boolean');
    });

    it('should estimate memory with architecture', () => {
      const manager = new KVCacheManager({ contextLength: 4096 });
      manager.setArchitecture('qwen2.5-7b');

      const estimate = manager.estimateMemory();

      expect(estimate.totalBytes).toBeGreaterThan(0);
      expect(estimate.perLayerBytes).toBeGreaterThan(0);
      expect(estimate.gpuMemoryMB).toBeGreaterThan(0);
    });

    it('should accept custom context length', () => {
      const manager = new KVCacheManager({ contextLength: 4096 });
      manager.setArchitecture('qwen2.5-7b');

      const estimate4k = manager.estimateMemory(4096);
      const estimate8k = manager.estimateMemory(8192);

      expect(estimate8k.totalBytes).toBeGreaterThan(estimate4k.totalBytes);
      expect(estimate8k.gpuMemoryMB).toBeGreaterThan(estimate4k.gpuMemoryMB);
    });

    it('should consider batch size', () => {
      const manager = new KVCacheManager();
      manager.setArchitecture('llama-3.1-8b');

      const batch1 = manager.estimateMemory(4096, 1);
      const batch4 = manager.estimateMemory(4096, 4);

      expect(batch4.totalBytes).toBeGreaterThan(batch1.totalBytes);
    });

    it('should reduce memory with quantization', () => {
      const managerF16 = new KVCacheManager({ kvQuantization: 'f16' });
      managerF16.setArchitecture('qwen2.5-7b');
      const estimateF16 = managerF16.estimateMemory();

      const managerQ4 = new KVCacheManager({ kvQuantization: 'q4_0' });
      managerQ4.setArchitecture('qwen2.5-7b');
      const estimateQ4 = managerQ4.estimateMemory();

      expect(estimateQ4.gpuMemoryMB).toBeLessThan(estimateF16.gpuMemoryMB);
    });

    it('should provide recommendation', () => {
      const manager = new KVCacheManager({ contextLength: 32768 });
      manager.setArchitecture('qwen2.5-7b');

      const estimate = manager.estimateMemory();

      expect(estimate.recommendation).toBeDefined();
      expect(estimate.recommendation.length).toBeGreaterThan(0);
    });
  });

  describe('generateLlamaCppArgs', () => {
    it('should generate context length argument', () => {
      const manager = new KVCacheManager({ contextLength: 8192 });
      const args = manager.generateLlamaCppArgs();

      expect(args).toContain('-c');
      expect(args).toContain('8192');
    });

    it('should generate batch size arguments', () => {
      const manager = new KVCacheManager({
        batchSize: 1024,
        ubatchSize: 256,
      });
      const args = manager.generateLlamaCppArgs();

      expect(args).toContain('-b');
      expect(args).toContain('1024');
      expect(args).toContain('-ub');
      expect(args).toContain('256');
    });

    it('should generate KV quantization arguments', () => {
      const manager = new KVCacheManager({ kvQuantization: 'q8_0' });
      const args = manager.generateLlamaCppArgs();

      expect(args).toContain('--cache-type-k');
      expect(args).toContain('q8_0');
      expect(args).toContain('--cache-type-v');
    });

    it('should not add KV quant args for f16', () => {
      const manager = new KVCacheManager({ kvQuantization: 'f16' });
      const args = manager.generateLlamaCppArgs();

      expect(args).not.toContain('--cache-type-k');
    });

    it('should generate flash attention argument', () => {
      const manager = new KVCacheManager({ flashAttention: true });
      const args = manager.generateLlamaCppArgs();

      expect(args).toContain('-fa');
    });

    it('should generate GPU layers argument with architecture', () => {
      const manager = new KVCacheManager({ cpuOffloadLayers: 8 });
      manager.setArchitecture('llama-3.1-8b'); // 32 layers

      const args = manager.generateLlamaCppArgs();

      expect(args).toContain('-ngl');
      expect(args).toContain('24'); // 32 - 8 = 24 GPU layers
    });
  });

  describe('generateLMStudioConfig', () => {
    it('should generate LM Studio config object', () => {
      const manager = new KVCacheManager({
        contextLength: 16384,
        kvQuantization: 'q4_0',
        flashAttention: true,
        batchSize: 512,
      });
      manager.setArchitecture('qwen2.5-7b');

      const config = manager.generateLMStudioConfig();

      expect(config.contextLength).toBe(16384);
      expect(config.kvCache).toEqual({ quantization: 'q4_0' });
      expect(config.inference).toEqual({
        batchSize: 512,
        flashAttention: true,
      });
    });

    it('should include GPU offload settings', () => {
      const manager = new KVCacheManager({ offloadMode: 'partial' });
      manager.setArchitecture('llama-3.1-8b');

      const config = manager.generateLMStudioConfig();

      expect(config.gpu).toBeDefined();
      expect(config.gpu).toHaveProperty('offload');
      expect(config.gpu).toHaveProperty('layers');
    });
  });

  describe('optimizeForVRAM', () => {
    it('should return minimal config for very limited VRAM', () => {
      const manager = new KVCacheManager();
      manager.setArchitecture('qwen2.5-7b');

      const optimized = manager.optimizeForVRAM(4000, 4000); // 4GB total, 4GB model

      expect(optimized.contextLength).toBe(2048);
      expect(optimized.kvQuantization).toBe('q4_0');
      expect(optimized.offloadMode).toBe('partial');
    });

    it('should return conservative config for limited VRAM', () => {
      const manager = new KVCacheManager();
      manager.setArchitecture('qwen2.5-7b');

      const optimized = manager.optimizeForVRAM(6000, 4000); // 6GB total, 4GB model

      expect(optimized.contextLength).toBe(4096);
      expect(optimized.kvQuantization).toBe('q4_0');
    });

    it('should return moderate config for decent VRAM', () => {
      const manager = new KVCacheManager();
      manager.setArchitecture('qwen2.5-7b');

      const optimized = manager.optimizeForVRAM(8000, 4000); // 8GB total, 4GB model

      expect(optimized.contextLength).toBe(8192);
      expect(optimized.kvQuantization).toBe('q8_0');
    });

    it('should return optimal config for plenty of VRAM', () => {
      const manager = new KVCacheManager();
      manager.setArchitecture('qwen2.5-7b');

      const optimized = manager.optimizeForVRAM(16000, 4000); // 16GB total

      expect(optimized.contextLength).toBe(16384);
      expect(optimized.kvQuantization).toBe('f16');
    });
  });

  describe('updateConfig', () => {
    it('should update configuration', () => {
      const manager = new KVCacheManager();
      manager.updateConfig({ contextLength: 32768 });

      const config = manager.getConfig();
      expect(config.contextLength).toBe(32768);
    });

    it('should emit configUpdated event', () => {
      const manager = new KVCacheManager();
      const handler = jest.fn();
      manager.on('configUpdated', handler);

      manager.updateConfig({ contextLength: 8192 });

      expect(handler).toHaveBeenCalled();
    });

    it('should preserve other config values', () => {
      const manager = new KVCacheManager({
        contextLength: 4096,
        kvQuantization: 'q8_0',
      });

      manager.updateConfig({ contextLength: 8192 });

      const config = manager.getConfig();
      expect(config.contextLength).toBe(8192);
      expect(config.kvQuantization).toBe('q8_0');
    });
  });

  describe('formatConfig', () => {
    it('should format config for display', () => {
      const manager = new KVCacheManager({
        contextLength: 8192,
        kvQuantization: 'q4_0',
      });
      manager.setArchitecture('qwen2.5-7b');

      const formatted = manager.formatConfig();

      expect(typeof formatted).toBe('string');
      expect(formatted).toContain('KV-Cache Configuration');
      expect(formatted).toContain((8192).toLocaleString());
      expect(formatted).toContain('q4_0');
      expect(formatted).toContain('Memory Estimate');
      expect(formatted).toContain('Recommendation');
    });
  });
});

// ============================================================================
// MODEL_ARCHITECTURES Tests
// ============================================================================

describe('MODEL_ARCHITECTURES', () => {
  it('should have Qwen models', () => {
    expect(MODEL_ARCHITECTURES['qwen2.5-7b']).toBeDefined();
    expect(MODEL_ARCHITECTURES['qwen2.5-14b']).toBeDefined();
    expect(MODEL_ARCHITECTURES['qwen2.5-32b']).toBeDefined();
  });

  it('should have Llama models', () => {
    expect(MODEL_ARCHITECTURES['llama-3.1-8b']).toBeDefined();
    expect(MODEL_ARCHITECTURES['llama-3.2-3b']).toBeDefined();
  });

  it('should have Mistral models', () => {
    expect(MODEL_ARCHITECTURES['mistral-7b']).toBeDefined();
    expect(MODEL_ARCHITECTURES['devstral-7b']).toBeDefined();
  });

  it('should have valid architecture structure', () => {
    for (const [_name, arch] of Object.entries(MODEL_ARCHITECTURES)) {
      expect(arch.nLayers).toBeGreaterThan(0);
      expect(arch.nEmbed).toBeGreaterThan(0);
      expect(arch.nHead).toBeGreaterThan(0);
      // nKVHead is optional for MHA models
      if (arch.nKVHead !== undefined) {
        expect(arch.nKVHead).toBeGreaterThan(0);
        expect(arch.nKVHead).toBeLessThanOrEqual(arch.nHead);
      }
    }
  });

  it('should have GQA (grouped query attention) for most models', () => {
    // Most modern models use GQA where nKVHead < nHead
    const modelsWithGQA = Object.entries(MODEL_ARCHITECTURES).filter(
      ([_, arch]) => arch.nKVHead !== undefined && arch.nKVHead < arch.nHead
    );
    expect(modelsWithGQA.length).toBeGreaterThan(5);
  });
});

// ============================================================================
// DEFAULT_KV_CACHE_CONFIG Tests
// ============================================================================

describe('DEFAULT_KV_CACHE_CONFIG', () => {
  it('should have reasonable defaults', () => {
    expect(DEFAULT_KV_CACHE_CONFIG.contextLength).toBe(4096);
    expect(DEFAULT_KV_CACHE_CONFIG.kvQuantization).toBe('f16');
    expect(DEFAULT_KV_CACHE_CONFIG.flashAttention).toBe(true);
    expect(DEFAULT_KV_CACHE_CONFIG.batchSize).toBe(512);
  });
});

// ============================================================================
// Singleton Tests
// ============================================================================

describe('KVCacheManager Singleton', () => {
  beforeEach(() => {
    resetKVCacheManager();
  });

  describe('getKVCacheManager', () => {
    it('should return same instance', () => {
      const m1 = getKVCacheManager();
      const m2 = getKVCacheManager();
      expect(m1).toBe(m2);
    });

    it('should accept config on first call', () => {
      const manager = getKVCacheManager({ contextLength: 16384 });
      expect(manager.getConfig().contextLength).toBe(16384);
    });
  });

  describe('resetKVCacheManager', () => {
    it('should reset singleton', () => {
      const m1 = getKVCacheManager();
      resetKVCacheManager();
      const m2 = getKVCacheManager();
      expect(m1).not.toBe(m2);
    });
  });
});
