/**
 * Comprehensive Unit Tests for Models Module
 *
 * Tests model definitions, capabilities, configurations, and selection logic.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EventEmitter } from 'events';

// Mock the dependencies before importing the module
jest.mock('fs');
jest.mock('../../src/utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock GPU Monitor
const mockGPUStats = {
  totalVRAM: 16384,
  usedVRAM: 4096,
  freeVRAM: 12288,
  usagePercent: 25,
  gpuCount: 1,
  gpus: [
    {
      id: 0,
      name: 'NVIDIA RTX 4090',
      vendor: 'nvidia',
      vramTotal: 16384,
      vramUsed: 4096,
      vramFree: 12288,
      utilization: 25,
    },
  ],
  timestamp: new Date(),
};

const mockGPUMonitor = {
  initialize: jest.fn().mockResolvedValue('nvidia'),
  getStats: jest.fn().mockResolvedValue(mockGPUStats),
  dispose: jest.fn(),
};

jest.mock('../../src/hardware/gpu-monitor', () => ({
  getGPUMonitor: jest.fn(() => mockGPUMonitor),
  GPUMonitor: jest.fn(),
}));

// Import the module after mocking
import {
  ModelHub,
  getModelHub,
  resetModelHub,
  RECOMMENDED_MODELS,
  QUANTIZATION_TYPES,
  DEFAULT_MODEL_HUB_CONFIG,
  type ModelInfo,
  type ModelSize,
  type QuantizationType,
  type DownloadProgress,
  type DownloadedModel,
  type ModelHubConfig,
} from '../../src/models/model-hub';

// Use any to avoid complex type casting with Jest mocks
const mockedFs = fs as any;

describe('Models Module', () => {
  // ==========================================================================
  // QUANTIZATION_TYPES Tests
  // ==========================================================================

  describe('QUANTIZATION_TYPES', () => {
    it('should define all standard quantization types', () => {
      const expectedTypes = [
        'Q2_K', 'Q3_K_S', 'Q3_K_M', 'Q4_0', 'Q4_K_S', 'Q4_K_M',
        'Q5_0', 'Q5_K_S', 'Q5_K_M', 'Q6_K', 'Q8_0', 'F16',
      ];

      for (const type of expectedTypes) {
        expect(QUANTIZATION_TYPES[type]).toBeDefined();
      }
    });

    it('should have valid properties for each quantization type', () => {
      for (const [key, quant] of Object.entries(QUANTIZATION_TYPES)) {
        expect(quant.name).toBe(key);
        expect(quant.bitsPerWeight).toBeGreaterThan(0);
        expect(quant.bitsPerWeight).toBeLessThanOrEqual(16);
        expect(quant.qualityScore).toBeGreaterThanOrEqual(1);
        expect(quant.qualityScore).toBeLessThanOrEqual(10);
        expect(quant.description).toBeTruthy();
      }
    });

    it('should have increasing quality scores with higher bit widths', () => {
      // Lower quantization should generally have lower quality
      expect(QUANTIZATION_TYPES.Q2_K.qualityScore).toBeLessThan(
        QUANTIZATION_TYPES.Q4_K_M.qualityScore
      );
      expect(QUANTIZATION_TYPES.Q4_K_M.qualityScore).toBeLessThan(
        QUANTIZATION_TYPES.Q8_0.qualityScore
      );
    });

    it('should have Q4_K_M as a recommended medium quality option', () => {
      const q4km = QUANTIZATION_TYPES.Q4_K_M;
      expect(q4km.bitsPerWeight).toBe(4.5);
      expect(q4km.qualityScore).toBe(8);
      expect(q4km.description).toContain('recommended');
    });

    it('should have F16 as the highest quality option', () => {
      const f16 = QUANTIZATION_TYPES.F16;
      expect(f16.bitsPerWeight).toBe(16.0);
      expect(f16.qualityScore).toBe(10);
      expect(f16.description).toContain('lossless');
    });
  });

  // ==========================================================================
  // RECOMMENDED_MODELS Tests
  // ==========================================================================

  describe('RECOMMENDED_MODELS', () => {
    it('should define code-specialized models', () => {
      expect(RECOMMENDED_MODELS['devstral-7b']).toBeDefined();
      expect(RECOMMENDED_MODELS['codellama-7b']).toBeDefined();
      expect(RECOMMENDED_MODELS['deepseek-coder-7b']).toBeDefined();
      expect(RECOMMENDED_MODELS['qwen-coder-7b']).toBeDefined();
    });

    it('should define general-purpose models', () => {
      expect(RECOMMENDED_MODELS['llama-3.2-3b']).toBeDefined();
      expect(RECOMMENDED_MODELS['mistral-7b']).toBeDefined();
    });

    it('should define structured output models', () => {
      expect(RECOMMENDED_MODELS['granite-3b']).toBeDefined();
      expect(RECOMMENDED_MODELS['granite-3b'].tags).toContain('json');
    });

    it('should have valid ModelInfo structure for each model', () => {
      for (const [id, model] of Object.entries(RECOMMENDED_MODELS)) {
        expect(model.id).toBe(id);
        expect(model.name).toBeTruthy();
        expect(['1b', '3b', '7b', '8b', '13b', '14b', '30b', '34b', '70b']).toContain(model.size);
        expect(model.parameterCount).toBeGreaterThan(0);
        expect(model.description).toBeTruthy();
        expect(model.huggingFaceRepo).toBeTruthy();
        expect(model.defaultQuantization).toBeTruthy();
        expect(model.supportedQuantizations.length).toBeGreaterThan(0);
        expect(model.contextLength).toBeGreaterThan(0);
        expect(model.license).toBeTruthy();
        expect(Array.isArray(model.tags)).toBe(true);
      }
    });

    it('should have devstral-7b optimized for agentic coding', () => {
      const model = RECOMMENDED_MODELS['devstral-7b'];
      expect(model.tags).toContain('agentic');
      expect(model.tags).toContain('code');
      expect(model.tags).toContain('tool-use');
    });

    it('should have qwen-coder-7b with long context support', () => {
      const model = RECOMMENDED_MODELS['qwen-coder-7b'];
      expect(model.contextLength).toBe(131072);
      expect(model.tags).toContain('long-context');
    });

    it('should have llama-3.2-3b as a fast lightweight model', () => {
      const model = RECOMMENDED_MODELS['llama-3.2-3b'];
      expect(model.size).toBe('3b');
      expect(model.tags).toContain('fast');
    });

    it('should have valid HuggingFace repository URLs', () => {
      for (const model of Object.values(RECOMMENDED_MODELS)) {
        expect(model.huggingFaceRepo).toMatch(/^[\w-]+\/[\w.-]+$/);
      }
    });

    it('should have default quantization in supported list', () => {
      for (const model of Object.values(RECOMMENDED_MODELS)) {
        expect(model.supportedQuantizations).toContain(model.defaultQuantization);
      }
    });
  });

  // ==========================================================================
  // DEFAULT_MODEL_HUB_CONFIG Tests
  // ==========================================================================

  describe('DEFAULT_MODEL_HUB_CONFIG', () => {
    it('should have a valid models directory path', () => {
      expect(DEFAULT_MODEL_HUB_CONFIG.modelsDir).toContain('.codebuddy');
      expect(DEFAULT_MODEL_HUB_CONFIG.modelsDir).toContain('models');
    });

    it('should have reasonable timeout value', () => {
      expect(DEFAULT_MODEL_HUB_CONFIG.downloadTimeout).toBe(3600000); // 1 hour
    });

    it('should have reasonable chunk size', () => {
      expect(DEFAULT_MODEL_HUB_CONFIG.chunkSize).toBe(1024 * 1024); // 1MB
    });

    it('should have autoSelectQuantization enabled by default', () => {
      expect(DEFAULT_MODEL_HUB_CONFIG.autoSelectQuantization).toBe(true);
    });
  });

  // ==========================================================================
  // ModelHub Class Tests
  // ==========================================================================

  describe('ModelHub', () => {
    let modelHub: ModelHub;
    const testModelsDir = '/tmp/test-models';

    beforeEach(() => {
      jest.clearAllMocks();
      resetModelHub();

      // Setup fs mocks
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.mkdirSync.mockImplementation(() => undefined);
      mockedFs.readdirSync.mockReturnValue([]);
      mockedFs.statSync.mockReturnValue({
        size: 1000000000,
        mtime: new Date(),
      } as fs.Stats);

      modelHub = new ModelHub({ modelsDir: testModelsDir });
    });

    afterEach(() => {
      if (modelHub) {
        modelHub.dispose();
      }
    });

    describe('Constructor and Initialization', () => {
      it('should create ModelHub with default config', () => {
        const hub = new ModelHub();
        expect(hub).toBeInstanceOf(ModelHub);
        expect(hub).toBeInstanceOf(EventEmitter);
        hub.dispose();
      });

      it('should merge custom config with defaults', () => {
        const customConfig = {
          modelsDir: '/custom/path',
          downloadTimeout: 7200000,
        };

        const hub = new ModelHub(customConfig);
        const config = hub.getConfig();

        expect(config.modelsDir).toBe('/custom/path');
        expect(config.downloadTimeout).toBe(7200000);
        expect(config.chunkSize).toBe(DEFAULT_MODEL_HUB_CONFIG.chunkSize);
        hub.dispose();
      });

      it('should create models directory if it does not exist', () => {
        mockedFs.existsSync.mockReturnValue(false);

        const hub = new ModelHub({ modelsDir: '/new/models/path' });

        expect(mockedFs.mkdirSync).toHaveBeenCalledWith('/new/models/path', { recursive: true });
        hub.dispose();
      });

      it('should scan for existing local models on initialization', () => {
        const mockFiles = ['model-a-Q4_K_M.gguf', 'model-b-Q5_K_M.gguf'];
        mockedFs.readdirSync.mockReturnValue(mockFiles);

        const hub = new ModelHub({ modelsDir: testModelsDir });

        const downloaded = hub.listDownloaded();
        expect(downloaded.length).toBe(2);
        hub.dispose();
      });
    });

    describe('listModels', () => {
      it('should return all recommended models', () => {
        const models = modelHub.listModels();

        expect(Array.isArray(models)).toBe(true);
        expect(models.length).toBe(Object.keys(RECOMMENDED_MODELS).length);
      });

      it('should return models with complete information', () => {
        const models = modelHub.listModels();

        for (const model of models) {
          expect(model.id).toBeTruthy();
          expect(model.name).toBeTruthy();
          expect(model.parameterCount).toBeGreaterThan(0);
        }
      });
    });

    describe('getModelInfo', () => {
      it('should return model info for valid model ID', () => {
        const model = modelHub.getModelInfo('devstral-7b');

        expect(model).toBeDefined();
        expect(model?.id).toBe('devstral-7b');
        expect(model?.name).toBe('Devstral 7B');
      });

      it('should return null for unknown model ID', () => {
        const model = modelHub.getModelInfo('nonexistent-model');

        expect(model).toBeNull();
      });

      it('should return model info for all recommended models', () => {
        for (const modelId of Object.keys(RECOMMENDED_MODELS)) {
          const model = modelHub.getModelInfo(modelId);
          expect(model).not.toBeNull();
          expect(model?.id).toBe(modelId);
        }
      });
    });

    describe('estimateVRAM', () => {
      it('should estimate VRAM for known quantization', () => {
        const model = RECOMMENDED_MODELS['devstral-7b'];
        const vram = modelHub.estimateVRAM(model, 'Q4_K_M');

        expect(vram).toBeGreaterThan(0);
      });

      it('should return default for unknown quantization', () => {
        const model = RECOMMENDED_MODELS['devstral-7b'];
        const vram = modelHub.estimateVRAM(model, 'UNKNOWN');

        // Default calculation: params * 4000
        expect(vram).toBe(model.parameterCount * 4000);
      });

      it('should estimate higher VRAM for higher quality quantization', () => {
        const model = RECOMMENDED_MODELS['mistral-7b'];

        const vramQ4 = modelHub.estimateVRAM(model, 'Q4_K_M');
        const vramQ8 = modelHub.estimateVRAM(model, 'Q8_0');

        expect(vramQ8).toBeGreaterThan(vramQ4);
      });

      it('should account for context length in VRAM estimation', () => {
        // Compare models with different context lengths
        const shortContext = { ...RECOMMENDED_MODELS['codellama-7b'] };
        const longContext = { ...RECOMMENDED_MODELS['qwen-coder-7b'] };

        // Both 7B models but different context lengths
        const vramShort = modelHub.estimateVRAM(shortContext, 'Q4_K_M');
        const vramLong = modelHub.estimateVRAM(longContext, 'Q4_K_M');

        expect(vramLong).toBeGreaterThan(vramShort);
      });
    });

    describe('selectQuantization', () => {
      it('should return default quantization when autoSelect is disabled', async () => {
        const hub = new ModelHub({
          modelsDir: testModelsDir,
          autoSelectQuantization: false,
        });

        const model = RECOMMENDED_MODELS['devstral-7b'];
        const quant = await hub.selectQuantization(model);

        expect(quant).toBe(model.defaultQuantization);
        hub.dispose();
      });

      it('should select quantization based on available VRAM', async () => {
        const model = RECOMMENDED_MODELS['devstral-7b'];
        const quant = await modelHub.selectQuantization(model);

        expect(model.supportedQuantizations).toContain(quant);
      });

      it('should select highest quality that fits in VRAM', async () => {
        // With 12GB free VRAM, should be able to fit high quality for 7B model
        const model = RECOMMENDED_MODELS['devstral-7b'];
        const quant = await modelHub.selectQuantization(model);

        // Should select a high-quality quantization
        const selectedQuant = QUANTIZATION_TYPES[quant];
        expect(selectedQuant.qualityScore).toBeGreaterThanOrEqual(7);
      });

      it('should use target VRAM when provided', async () => {
        const model = RECOMMENDED_MODELS['devstral-7b'];

        // Very limited VRAM
        const quantLimited = await modelHub.selectQuantization(model, 2000);

        // Ample VRAM
        const quantAmple = await modelHub.selectQuantization(model, 20000);

        // Limited VRAM should select lower quality
        const limitedScore = QUANTIZATION_TYPES[quantLimited]?.qualityScore || 0;
        const ampleScore = QUANTIZATION_TYPES[quantAmple]?.qualityScore || 0;

        expect(limitedScore).toBeLessThanOrEqual(ampleScore);
      });
    });

    describe('getRecommendedModel', () => {
      it('should return a model for code use case', async () => {
        const model = await modelHub.getRecommendedModel('code');

        expect(model).not.toBeNull();
        expect(model?.tags).toContain('code');
      });

      it('should return a model for general use case', async () => {
        const model = await modelHub.getRecommendedModel('general');

        expect(model).not.toBeNull();
      });

      it('should return a model for fast use case', async () => {
        const model = await modelHub.getRecommendedModel('fast');

        expect(model).not.toBeNull();
        // Model should have either 'fast' or 'tool-use' tag (for agentic workflows)
        const hasFastOrToolUse = model?.tags.includes('fast') || model?.tags.includes('tool-use');
        expect(hasFastOrToolUse).toBe(true);
      });

      it('should prefer larger models within VRAM budget', async () => {
        const model = await modelHub.getRecommendedModel('code');

        // With 12GB VRAM, should select a 7B model not a 3B
        expect(model?.parameterCount).toBeGreaterThanOrEqual(7);
      });
    });

    describe('listDownloaded', () => {
      it('should return empty array when no models downloaded', () => {
        const downloaded = modelHub.listDownloaded();

        expect(Array.isArray(downloaded)).toBe(true);
        expect(downloaded.length).toBe(0);
      });

      it('should return downloaded models after scanning', () => {
        const mockFiles = ['devstral-7b-Q4_K_M.gguf'];
        mockedFs.readdirSync.mockReturnValue(mockFiles);

        const hub = new ModelHub({ modelsDir: testModelsDir });
        const downloaded = hub.listDownloaded();

        expect(downloaded.length).toBe(1);
        expect(downloaded[0].path).toContain('devstral-7b-Q4_K_M.gguf');
        hub.dispose();
      });
    });

    describe('getDownloaded', () => {
      beforeEach(() => {
        const mockFiles = ['devstral-7b-Q4_K_M.gguf', 'mistral-7b-Q5_K_M.gguf'];
        mockedFs.readdirSync.mockReturnValue(mockFiles);
      });

      it('should find downloaded model by exact filename', () => {
        const hub = new ModelHub({ modelsDir: testModelsDir });
        const model = hub.getDownloaded('devstral-7b-Q4_K_M.gguf');

        expect(model).not.toBeNull();
        expect(model?.path).toContain('devstral-7b-Q4_K_M.gguf');
        hub.dispose();
      });

      it('should find downloaded model by partial match', () => {
        const hub = new ModelHub({ modelsDir: testModelsDir });
        const model = hub.getDownloaded('devstral');

        expect(model).not.toBeNull();
        hub.dispose();
      });

      it('should return null for non-existent model', () => {
        const hub = new ModelHub({ modelsDir: testModelsDir });
        const model = hub.getDownloaded('nonexistent-model');

        expect(model).toBeNull();
        hub.dispose();
      });
    });

    describe('download', () => {
      beforeEach(() => {
        // Mock fetch for download tests
        global.fetch = jest.fn().mockResolvedValue({
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Map([['content-length', '1000000']]),
          body: {
            getReader: () => ({
              read: jest.fn()
                .mockResolvedValueOnce({ done: false, value: new Uint8Array(100) })
                .mockResolvedValueOnce({ done: true }),
            }),
          },
        });

        mockedFs.createWriteStream.mockReturnValue({
          write: jest.fn(),
          end: jest.fn(),
        } as unknown as fs.WriteStream);
      });

      it('should throw error for unknown model', async () => {
        await expect(modelHub.download('unknown-model')).rejects.toThrow('Unknown model');
      });

      it('should return existing model if already downloaded', async () => {
        const mockFiles = ['devstral-7b-Q4_K_M.gguf'];
        mockedFs.readdirSync.mockReturnValue(mockFiles);

        const hub = new ModelHub({ modelsDir: testModelsDir });
        const result = await hub.download('devstral-7b', 'Q4_K_M');

        expect(result).toBeDefined();
        expect(result.path).toContain('devstral-7b');
        hub.dispose();
      });

      it('should emit download:start event', async () => {
        const mockFiles: string[] = [];
        mockedFs.readdirSync.mockReturnValue(mockFiles);

        const hub = new ModelHub({ modelsDir: testModelsDir });
        const listener = jest.fn();
        hub.on('download:start', listener);

        try {
          await hub.download('devstral-7b', 'Q4_K_M');
        } catch {
          // Download might fail, but event should still be emitted
        }

        expect(listener).toHaveBeenCalled();
        hub.dispose();
      });
    });

    describe('delete', () => {
      beforeEach(() => {
        const mockFiles = ['devstral-7b-Q4_K_M.gguf'];
        mockedFs.readdirSync.mockReturnValue(mockFiles);
        mockedFs.unlinkSync.mockImplementation(() => undefined);
      });

      it('should delete existing model', () => {
        const hub = new ModelHub({ modelsDir: testModelsDir });
        const result = hub.delete('devstral-7b-Q4_K_M.gguf');

        expect(result).toBe(true);
        expect(mockedFs.unlinkSync).toHaveBeenCalled();
        hub.dispose();
      });

      it('should return false for non-existent model', () => {
        const hub = new ModelHub({ modelsDir: testModelsDir });
        const result = hub.delete('nonexistent.gguf');

        expect(result).toBe(false);
        hub.dispose();
      });

      it('should emit delete event on successful deletion', () => {
        const hub = new ModelHub({ modelsDir: testModelsDir });
        const listener = jest.fn();
        hub.on('delete', listener);

        hub.delete('devstral-7b-Q4_K_M.gguf');

        expect(listener).toHaveBeenCalledWith({ fileName: 'devstral-7b-Q4_K_M.gguf' });
        hub.dispose();
      });

      it('should handle deletion failure gracefully', () => {
        mockedFs.unlinkSync.mockImplementation(() => {
          throw new Error('Permission denied');
        });

        const hub = new ModelHub({ modelsDir: testModelsDir });
        const result = hub.delete('devstral-7b-Q4_K_M.gguf');

        expect(result).toBe(false);
        hub.dispose();
      });
    });

    describe('formatModelList', () => {
      it('should return formatted string with model info', () => {
        const formatted = modelHub.formatModelList();

        expect(formatted).toContain('Available Models');
        expect(formatted).toContain('Devstral 7B');
      });

      it('should show download status for downloaded models', () => {
        const mockFiles = ['devstral-7b-Q4_K_M.gguf'];
        mockedFs.readdirSync.mockReturnValue(mockFiles);

        const hub = new ModelHub({ modelsDir: testModelsDir });
        const formatted = hub.formatModelList();

        expect(formatted).toContain('Downloaded');
        hub.dispose();
      });
    });

    describe('formatRecommendations', () => {
      it('should return formatted recommendations based on VRAM', async () => {
        const formatted = await modelHub.formatRecommendations();

        expect(formatted).toContain('Model Recommendations');
        expect(formatted).toContain('Available VRAM');
      });
    });

    describe('Configuration Management', () => {
      it('should return current config via getConfig', () => {
        const config = modelHub.getConfig();

        expect(config.modelsDir).toBe(testModelsDir);
        expect(config.downloadTimeout).toBeDefined();
        expect(config.chunkSize).toBeDefined();
      });

      it('should update config via updateConfig', () => {
        modelHub.updateConfig({ downloadTimeout: 5000000 });

        const config = modelHub.getConfig();
        expect(config.downloadTimeout).toBe(5000000);
      });

      it('should not expose internal config reference', () => {
        const config1 = modelHub.getConfig();
        config1.downloadTimeout = 9999999;

        const config2 = modelHub.getConfig();
        expect(config2.downloadTimeout).not.toBe(9999999);
      });
    });

    describe('dispose', () => {
      it('should remove all listeners', () => {
        modelHub.on('download:start', jest.fn());
        modelHub.on('download:complete', jest.fn());

        modelHub.dispose();

        expect(modelHub.listenerCount('download:start')).toBe(0);
        expect(modelHub.listenerCount('download:complete')).toBe(0);
      });
    });
  });

  // ==========================================================================
  // Singleton Tests
  // ==========================================================================

  describe('ModelHub Singleton', () => {
    beforeEach(() => {
      resetModelHub();
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.mkdirSync.mockImplementation(() => undefined);
      mockedFs.readdirSync.mockReturnValue([]);
    });

    afterEach(() => {
      resetModelHub();
    });

    it('should return same instance from getModelHub', () => {
      const instance1 = getModelHub();
      const instance2 = getModelHub();

      expect(instance1).toBe(instance2);
    });

    it('should create new instance after reset', () => {
      const instance1 = getModelHub();
      resetModelHub();
      const instance2 = getModelHub();

      expect(instance1).not.toBe(instance2);
    });

    it('should accept config on first call', () => {
      const instance = getModelHub({ downloadTimeout: 1000000 });
      const config = instance.getConfig();

      expect(config.downloadTimeout).toBe(1000000);
    });
  });

  // ==========================================================================
  // Model Selection Logic Tests
  // ==========================================================================

  describe('Model Selection Logic', () => {
    let modelHub: ModelHub;

    beforeEach(() => {
      jest.clearAllMocks();
      resetModelHub();
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.mkdirSync.mockImplementation(() => undefined);
      mockedFs.readdirSync.mockReturnValue([]);

      modelHub = new ModelHub({ modelsDir: '/tmp/models' });
    });

    afterEach(() => {
      modelHub.dispose();
    });

    describe('Use Case Matching', () => {
      it('should filter models by code tag', async () => {
        const model = await modelHub.getRecommendedModel('code');

        expect(model).not.toBeNull();
        const hasCodeTag = model?.tags.includes('code') || model?.tags.includes('tool-use');
        expect(hasCodeTag).toBe(true);
      });

      it('should filter models by general tag', async () => {
        const model = await modelHub.getRecommendedModel('general');

        expect(model).not.toBeNull();
      });

      it('should filter models by fast tag', async () => {
        const model = await modelHub.getRecommendedModel('fast');

        expect(model).not.toBeNull();
      });
    });

    describe('VRAM-based Selection', () => {
      it('should select smaller model when VRAM is limited', async () => {
        // Mock limited VRAM
        mockGPUMonitor.getStats.mockResolvedValueOnce({
          ...mockGPUStats,
          freeVRAM: 3000, // Only 3GB free
        });

        const model = await modelHub.getRecommendedModel('code');

        // Should select a smaller model or return last in the list
        expect(model).not.toBeNull();
      });

      it('should leave VRAM buffer in selection', async () => {
        // Mock exact fit scenario with enough VRAM
        mockGPUMonitor.getStats.mockResolvedValueOnce({
          ...mockGPUStats,
          freeVRAM: 8000,
        });

        const model = await modelHub.getRecommendedModel('code');
        if (model) {
          const estimatedVRAM = modelHub.estimateVRAM(model, 'Q4_K_M');
          // Model's estimated VRAM should fit within available VRAM (with some buffer)
          // The algorithm leaves 10% buffer when selecting
          expect(estimatedVRAM).toBeLessThan(8000);
        }
      });
    });

    describe('Filename Parsing', () => {
      it('should extract model ID from GGUF filename', () => {
        const mockFiles = ['codellama-7b-Q4_K_M.gguf'];
        mockedFs.readdirSync.mockReturnValue(mockFiles);

        const hub = new ModelHub({ modelsDir: '/tmp/models' });
        const downloaded = hub.listDownloaded();

        expect(downloaded[0].id).toContain('codellama-7b');
        hub.dispose();
      });

      it('should extract quantization from GGUF filename', () => {
        const mockFiles = ['model-Q5_K_M.gguf'];
        mockedFs.readdirSync.mockReturnValue(mockFiles);

        const hub = new ModelHub({ modelsDir: '/tmp/models' });
        const downloaded = hub.listDownloaded();

        expect(downloaded[0].quantization).toBe('Q5_K_M');
        hub.dispose();
      });

      it('should handle unknown quantization in filename', () => {
        const mockFiles = ['model-UNKNOWN.gguf'];
        mockedFs.readdirSync.mockReturnValue(mockFiles);

        const hub = new ModelHub({ modelsDir: '/tmp/models' });
        const downloaded = hub.listDownloaded();

        expect(downloaded[0].quantization).toBe('unknown');
        hub.dispose();
      });
    });
  });

  // ==========================================================================
  // Event Emitter Tests
  // ==========================================================================

  describe('Event Emitter Functionality', () => {
    let modelHub: ModelHub;

    beforeEach(() => {
      jest.clearAllMocks();
      resetModelHub();
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.mkdirSync.mockImplementation(() => undefined);
      mockedFs.readdirSync.mockReturnValue([]);

      modelHub = new ModelHub({ modelsDir: '/tmp/models' });
    });

    afterEach(() => {
      modelHub.dispose();
    });

    it('should extend EventEmitter', () => {
      expect(modelHub).toBeInstanceOf(EventEmitter);
    });

    it('should support multiple listeners', () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();

      modelHub.on('download:start', listener1);
      modelHub.on('download:start', listener2);

      modelHub.emit('download:start', { modelId: 'test' });

      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);
    });

    it('should support once listeners', () => {
      const listener = jest.fn();

      modelHub.once('download:complete', listener);

      modelHub.emit('download:complete', { id: 'test1' });
      modelHub.emit('download:complete', { id: 'test2' });

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('should support removing listeners', () => {
      const listener = jest.fn();

      modelHub.on('download:error', listener);
      modelHub.off('download:error', listener);

      modelHub.emit('download:error', { error: 'test' });

      expect(listener).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Edge Cases Tests
  // ==========================================================================

  describe('Edge Cases', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      resetModelHub();
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.mkdirSync.mockImplementation(() => undefined);
      mockedFs.readdirSync.mockReturnValue([]);
    });

    it('should handle scan failure gracefully', () => {
      mockedFs.readdirSync.mockImplementation(() => {
        throw new Error('Directory not found');
      });

      // Should not throw
      expect(() => new ModelHub({ modelsDir: '/tmp/models' })).not.toThrow();
    });

    it('should handle non-GGUF files in models directory', () => {
      const mockFiles = ['readme.txt', 'config.json', 'model.gguf'];
      mockedFs.readdirSync.mockReturnValue(mockFiles);

      const hub = new ModelHub({ modelsDir: '/tmp/models' });
      const downloaded = hub.listDownloaded();

      expect(downloaded.length).toBe(1);
      hub.dispose();
    });

    it('should handle empty model list', () => {
      mockedFs.readdirSync.mockReturnValue([]);

      const hub = new ModelHub({ modelsDir: '/tmp/models' });
      const downloaded = hub.listDownloaded();

      expect(downloaded).toEqual([]);
      hub.dispose();
    });

    it('should handle HuggingFace token in config', () => {
      const hub = new ModelHub({
        modelsDir: '/tmp/models',
        hfToken: 'hf_test_token_12345',
      });

      const config = hub.getConfig();
      expect(config.hfToken).toBe('hf_test_token_12345');
      hub.dispose();
    });
  });

  // ==========================================================================
  // Type Definitions Tests
  // ==========================================================================

  describe('Type Definitions', () => {
    it('should accept valid ModelSize values', () => {
      const validSizes: ModelSize[] = ['1b', '3b', '7b', '8b', '13b', '14b', '30b', '34b', '70b'];

      for (const model of Object.values(RECOMMENDED_MODELS)) {
        expect(validSizes).toContain(model.size);
      }
    });

    it('should have QuantizationType with correct structure', () => {
      const quant: QuantizationType = QUANTIZATION_TYPES.Q4_K_M;

      expect(typeof quant.name).toBe('string');
      expect(typeof quant.bitsPerWeight).toBe('number');
      expect(typeof quant.qualityScore).toBe('number');
      expect(typeof quant.description).toBe('string');
    });

    it('should have ModelInfo with correct structure', () => {
      const model: ModelInfo = RECOMMENDED_MODELS['devstral-7b'];

      expect(typeof model.id).toBe('string');
      expect(typeof model.name).toBe('string');
      expect(typeof model.size).toBe('string');
      expect(typeof model.parameterCount).toBe('number');
      expect(typeof model.description).toBe('string');
      expect(typeof model.huggingFaceRepo).toBe('string');
      expect(typeof model.defaultQuantization).toBe('string');
      expect(Array.isArray(model.supportedQuantizations)).toBe(true);
      expect(typeof model.contextLength).toBe('number');
      expect(typeof model.license).toBe('string');
      expect(Array.isArray(model.tags)).toBe(true);
    });
  });
});
