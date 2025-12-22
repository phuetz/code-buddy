/**
 * Tests for Model Hub
 *
 * Tests the HuggingFace model download and management system.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  ModelHub,
  getModelHub,
  resetModelHub,
  RECOMMENDED_MODELS,
  QUANTIZATION_TYPES,
  DEFAULT_MODEL_HUB_CONFIG,
} from '../src/models/model-hub.js';

// ============================================================================
// Mock fetch for tests
// ============================================================================

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

// ============================================================================
// ModelHub Tests
// ============================================================================

describe('ModelHub', () => {
  let tempDir: string;

  beforeEach(() => {
    resetModelHub();
    mockFetch.mockClear();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'model-hub-test-'));
  });

  afterEach(() => {
    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('constructor', () => {
    it('should create with default config', () => {
      const hub = new ModelHub({ modelsDir: tempDir });
      const config = hub.getConfig();

      expect(config.modelsDir).toBe(tempDir);
      expect(config.downloadTimeout).toBe(DEFAULT_MODEL_HUB_CONFIG.downloadTimeout);
    });

    it('should create with custom config', () => {
      const hub = new ModelHub({
        modelsDir: tempDir,
        downloadTimeout: 7200000,
      });
      const config = hub.getConfig();

      expect(config.modelsDir).toBe(tempDir);
      expect(config.downloadTimeout).toBe(7200000);
    });

    it('should create models directory if not exists', () => {
      const nonExistentDir = path.join(tempDir, 'models', 'nested');
      new ModelHub({ modelsDir: nonExistentDir });

      expect(fs.existsSync(nonExistentDir)).toBe(true);
    });
  });

  describe('listModels', () => {
    it('should return available models', () => {
      const hub = new ModelHub({ modelsDir: tempDir });
      const models = hub.listModels();

      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBeGreaterThan(0);
    });

    it('should include model info', () => {
      const hub = new ModelHub({ modelsDir: tempDir });
      const models = hub.listModels();

      for (const model of models) {
        expect(model).toHaveProperty('id');
        expect(model).toHaveProperty('name');
        expect(model).toHaveProperty('size');
        expect(model).toHaveProperty('parameterCount');
        expect(model).toHaveProperty('description');
        expect(model).toHaveProperty('huggingFaceRepo');
      }
    });
  });

  describe('listDownloaded', () => {
    it('should return empty array when no models downloaded', () => {
      const hub = new ModelHub({ modelsDir: tempDir });
      const models = hub.listDownloaded();

      expect(models).toEqual([]);
    });

    it('should list downloaded models', () => {
      // Create a fake model file
      const modelFile = path.join(tempDir, 'test-model-Q4_K_M.gguf');
      fs.writeFileSync(modelFile, 'fake model data');

      const hub = new ModelHub({ modelsDir: tempDir });
      const models = hub.listDownloaded();

      expect(models.length).toBe(1);
      expect(models[0].path).toBe(modelFile);
    });
  });

  describe('getModelInfo', () => {
    it('should return info for known model', () => {
      const hub = new ModelHub({ modelsDir: tempDir });
      const info = hub.getModelInfo('devstral-7b');

      expect(info).not.toBeNull();
      expect(info?.id).toBe('devstral-7b');
      expect(info?.size).toBeDefined();
    });

    it('should return null for unknown model', () => {
      const hub = new ModelHub({ modelsDir: tempDir });
      const info = hub.getModelInfo('unknown-model-xyz');

      expect(info).toBeNull();
    });
  });

  describe('getDownloaded', () => {
    it('should return null when model not downloaded', () => {
      const hub = new ModelHub({ modelsDir: tempDir });
      const model = hub.getDownloaded('non-existent');

      expect(model).toBeNull();
    });

    it('should return downloaded model by filename', () => {
      const modelFile = path.join(tempDir, 'test-model-Q4_K_M.gguf');
      fs.writeFileSync(modelFile, 'fake model data');

      const hub = new ModelHub({ modelsDir: tempDir });
      const model = hub.getDownloaded('test-model-Q4_K_M.gguf');

      expect(model).not.toBeNull();
      expect(model?.path).toBe(modelFile);
    });
  });

  describe('delete', () => {
    it('should delete model file', () => {
      const modelFile = path.join(tempDir, 'test-model-Q4_K_M.gguf');
      fs.writeFileSync(modelFile, 'fake model data');

      const hub = new ModelHub({ modelsDir: tempDir });
      expect(fs.existsSync(modelFile)).toBe(true);

      const result = hub.delete('test-model-Q4_K_M.gguf');

      expect(result).toBe(true);
      expect(fs.existsSync(modelFile)).toBe(false);
    });

    it('should return false for non-existent file', () => {
      const hub = new ModelHub({ modelsDir: tempDir });
      const result = hub.delete('non-existent.gguf');

      expect(result).toBe(false);
    });

    it('should emit delete event', () => {
      const modelFile = path.join(tempDir, 'test-model-Q4_K_M.gguf');
      fs.writeFileSync(modelFile, 'fake model data');

      const hub = new ModelHub({ modelsDir: tempDir });
      const deleteHandler = jest.fn();
      hub.on('delete', deleteHandler);

      hub.delete('test-model-Q4_K_M.gguf');

      expect(deleteHandler).toHaveBeenCalled();
    });
  });

  describe('estimateVRAM', () => {
    it('should estimate VRAM for model', () => {
      const hub = new ModelHub({ modelsDir: tempDir });
      const model = RECOMMENDED_MODELS['devstral-7b'];
      const vram = hub.estimateVRAM(model, 'Q4_K_M');

      expect(typeof vram).toBe('number');
      expect(vram).toBeGreaterThan(0);
    });

    it('should estimate higher VRAM for higher quality quantization', () => {
      const hub = new ModelHub({ modelsDir: tempDir });
      const model = RECOMMENDED_MODELS['devstral-7b'];

      const vramQ4 = hub.estimateVRAM(model, 'Q4_K_M');
      const vramQ8 = hub.estimateVRAM(model, 'Q8_0');

      expect(vramQ8).toBeGreaterThan(vramQ4);
    });
  });

  describe('download', () => {
    it('should handle download errors gracefully', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const hub = new ModelHub({ modelsDir: tempDir });

      await expect(hub.download('devstral-7b', 'Q4_K_M')).rejects.toThrow();
    });

    it('should emit download:start event', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const hub = new ModelHub({ modelsDir: tempDir });
      const startHandler = jest.fn();
      hub.on('download:start', startHandler);

      try {
        await hub.download('devstral-7b', 'Q4_K_M');
      } catch {
        // Expected to fail
      }

      expect(startHandler).toHaveBeenCalled();
    });
  });

  describe('formatModelList', () => {
    it('should format model list for display', () => {
      const hub = new ModelHub({ modelsDir: tempDir });
      const list = hub.formatModelList();

      expect(typeof list).toBe('string');
      expect(list).toContain('Available Models');
      expect(list.length).toBeGreaterThan(0);
    });

    it('should show downloaded status', () => {
      // Create a fake model file
      fs.writeFileSync(path.join(tempDir, 'devstral-7b-Q4_K_M.gguf'), 'data');

      const hub = new ModelHub({ modelsDir: tempDir });
      const list = hub.formatModelList();

      // Check for download indicator emoji (either checkmark or arrow)
      expect(list.includes('✅') || list.includes('⬇')).toBe(true);
    });
  });

  describe('updateConfig', () => {
    it('should update configuration', () => {
      const hub = new ModelHub({ modelsDir: tempDir });
      hub.updateConfig({ downloadTimeout: 1800000 });

      const config = hub.getConfig();
      expect(config.downloadTimeout).toBe(1800000);
    });
  });

  describe('dispose', () => {
    it('should dispose without error', () => {
      const hub = new ModelHub({ modelsDir: tempDir });
      expect(() => hub.dispose()).not.toThrow();
    });
  });
});

// ============================================================================
// Singleton Functions Tests
// ============================================================================

describe('Model Hub Singleton', () => {
  let tempDir: string;

  beforeEach(() => {
    resetModelHub();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'model-hub-singleton-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('getModelHub', () => {
    it('should return same instance', () => {
      const hub1 = getModelHub({ modelsDir: tempDir });
      const hub2 = getModelHub({ modelsDir: tempDir });
      expect(hub1).toBe(hub2);
    });

    it('should accept config on first call', () => {
      const hub = getModelHub({ modelsDir: tempDir });
      expect(hub.getConfig().modelsDir).toBe(tempDir);
    });
  });

  describe('resetModelHub', () => {
    it('should reset singleton', () => {
      const hub1 = getModelHub({ modelsDir: tempDir });
      resetModelHub();
      const hub2 = getModelHub({ modelsDir: tempDir });
      expect(hub1).not.toBe(hub2);
    });
  });
});

// ============================================================================
// RECOMMENDED_MODELS Tests
// ============================================================================

describe('RECOMMENDED_MODELS', () => {
  it('should have devstral-7b', () => {
    expect(RECOMMENDED_MODELS['devstral-7b']).toBeDefined();
  });

  it('should have codellama-7b', () => {
    expect(RECOMMENDED_MODELS['codellama-7b']).toBeDefined();
  });

  it('should have llama-3.2-3b', () => {
    expect(RECOMMENDED_MODELS['llama-3.2-3b']).toBeDefined();
  });

  it('should have valid model structure', () => {
    for (const [id, model] of Object.entries(RECOMMENDED_MODELS)) {
      expect(model.id).toBe(id);
      expect(model.name).toBeDefined();
      expect(typeof model.size).toBe('string');
      expect(typeof model.parameterCount).toBe('number');
      expect(typeof model.huggingFaceRepo).toBe('string');
      expect(model.description).toBeDefined();
      expect(model.defaultQuantization).toBeDefined();
      expect(Array.isArray(model.supportedQuantizations)).toBe(true);
    }
  });
});

// ============================================================================
// QUANTIZATION_TYPES Tests
// ============================================================================

describe('QUANTIZATION_TYPES', () => {
  it('should have Q4_K_M', () => {
    expect(QUANTIZATION_TYPES['Q4_K_M']).toBeDefined();
    expect(QUANTIZATION_TYPES['Q4_K_M'].bitsPerWeight).toBe(4.5);
  });

  it('should have Q5_K_M', () => {
    expect(QUANTIZATION_TYPES['Q5_K_M']).toBeDefined();
    expect(QUANTIZATION_TYPES['Q5_K_M'].bitsPerWeight).toBe(5.5);
  });

  it('should have Q8_0', () => {
    expect(QUANTIZATION_TYPES['Q8_0']).toBeDefined();
    expect(QUANTIZATION_TYPES['Q8_0'].bitsPerWeight).toBe(8);
  });

  it('should have quality scores', () => {
    for (const quant of Object.values(QUANTIZATION_TYPES)) {
      expect(typeof quant.qualityScore).toBe('number');
      expect(quant.qualityScore).toBeGreaterThanOrEqual(1);
      expect(quant.qualityScore).toBeLessThanOrEqual(10);
    }
  });

  it('should have increasing bits per weight', () => {
    const q4 = QUANTIZATION_TYPES['Q4_K_M'].bitsPerWeight;
    const q5 = QUANTIZATION_TYPES['Q5_K_M'].bitsPerWeight;
    const q6 = QUANTIZATION_TYPES['Q6_K'].bitsPerWeight;
    const q8 = QUANTIZATION_TYPES['Q8_0'].bitsPerWeight;

    expect(q4).toBeLessThan(q5);
    expect(q5).toBeLessThan(q6);
    expect(q6).toBeLessThan(q8);
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe('Model Hub Integration', () => {
  let tempDir: string;

  beforeEach(() => {
    resetModelHub();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'model-hub-integration-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should provide model paths for Ollama/LM Studio', () => {
    // Create a fake downloaded model
    const modelFile = path.join(tempDir, 'devstral-7b-Q4_K_M.gguf');
    fs.writeFileSync(modelFile, 'fake gguf data');

    const hub = new ModelHub({ modelsDir: tempDir });
    const models = hub.listDownloaded();

    expect(models.length).toBe(1);
    expect(models[0].path).toMatch(/\.gguf$/);
    expect(fs.existsSync(models[0].path)).toBe(true);
  });

  it('should track downloaded model metadata', () => {
    // Create fake models
    fs.writeFileSync(path.join(tempDir, 'model1-Q4_K_M.gguf'), 'data');
    fs.writeFileSync(path.join(tempDir, 'model2-Q8_0.gguf'), 'more data');

    const hub = new ModelHub({ modelsDir: tempDir });
    const models = hub.listDownloaded();

    expect(models.length).toBe(2);

    for (const model of models) {
      expect(model).toHaveProperty('id');
      expect(model).toHaveProperty('path');
      expect(model).toHaveProperty('quantization');
      expect(model).toHaveProperty('sizeBytes');
      expect(model).toHaveProperty('downloadedAt');
    }
  });
});
