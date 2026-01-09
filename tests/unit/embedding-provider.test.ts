/**
 * Unit tests for EmbeddingProvider
 * Tests vector embedding generation for semantic search and similarity
 */

import { EventEmitter } from 'events';

// Mock external dependencies before imports
const mockPipeline = jest.fn();
const mockFetch = jest.fn();

// Mock @xenova/transformers
jest.mock('@xenova/transformers', () => ({
  pipeline: mockPipeline,
}));

// Mock fetch globally
global.fetch = mockFetch as unknown as typeof fetch;

// Mock logger
jest.mock('../../src/utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock fs
jest.mock('fs', () => ({
  existsSync: jest.fn(() => true),
  mkdirSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
}));

import {
  EmbeddingProvider,
  EmbeddingConfig,
  EmbeddingResult,
  BatchEmbeddingResult,
  getEmbeddingProvider,
  initializeEmbeddingProvider,
  resetEmbeddingProvider,
} from '../../src/embeddings/embedding-provider';
import fs from 'fs';

describe('EmbeddingProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetEmbeddingProvider();
    (fs.existsSync as jest.Mock).mockReturnValue(true);
  });

  describe('Constructor', () => {
    it('should create provider with default config', () => {
      const provider = new EmbeddingProvider();
      expect(provider).toBeInstanceOf(EventEmitter);
      expect(provider.getProviderType()).toBe('local');
      expect(provider.isReady()).toBe(false);
    });

    it('should create provider with custom config', () => {
      const config: Partial<EmbeddingConfig> = {
        provider: 'mock',
        modelName: 'custom-model',
        batchSize: 16,
      };
      const provider = new EmbeddingProvider(config);
      expect(provider.getProviderType()).toBe('mock');
    });

    it('should create provider with openai provider type', () => {
      const provider = new EmbeddingProvider({ provider: 'openai' });
      expect(provider.getProviderType()).toBe('openai');
    });

    it('should create provider with grok provider type', () => {
      const provider = new EmbeddingProvider({ provider: 'grok' });
      expect(provider.getProviderType()).toBe('grok');
    });
  });

  describe('Initialize', () => {
    it('should initialize mock provider without issues', async () => {
      const provider = new EmbeddingProvider({ provider: 'mock' });
      await provider.initialize();
      expect(provider.isReady()).toBe(true);
    });

    it('should emit initialized event on success', async () => {
      const provider = new EmbeddingProvider({ provider: 'mock' });
      const initHandler = jest.fn();
      provider.on('initialized', initHandler);

      await provider.initialize();

      expect(initHandler).toHaveBeenCalledWith({ provider: 'mock' });
    });

    it('should not re-initialize if already initialized', async () => {
      const provider = new EmbeddingProvider({ provider: 'mock' });
      await provider.initialize();
      await provider.initialize();
      expect(provider.isReady()).toBe(true);
    });

    it('should handle concurrent initialization calls', async () => {
      const provider = new EmbeddingProvider({ provider: 'mock' });

      const [result1, result2, result3] = await Promise.all([
        provider.initialize(),
        provider.initialize(),
        provider.initialize(),
      ]);

      expect(provider.isReady()).toBe(true);
    });

    describe('Local Model Initialization', () => {
      it('should initialize local model successfully', async () => {
        const mockPipelineFn = jest.fn().mockResolvedValue({
          data: new Float32Array(384).fill(0.1),
        });
        mockPipeline.mockResolvedValue(mockPipelineFn);

        const provider = new EmbeddingProvider({
          provider: 'local',
          cacheDir: '/tmp/test-models',
        });

        const modelLoadedHandler = jest.fn();
        provider.on('model:loaded', modelLoadedHandler);

        await provider.initialize();

        expect(mockPipeline).toHaveBeenCalledWith(
          'feature-extraction',
          'Xenova/all-MiniLM-L6-v2',
          { quantized: true }
        );
        expect(modelLoadedHandler).toHaveBeenCalled();
        expect(provider.isReady()).toBe(true);
      });

      it('should create cache directory if it does not exist', async () => {
        (fs.existsSync as jest.Mock).mockReturnValue(false);
        const mockPipelineFn = jest.fn().mockResolvedValue({ data: new Float32Array(384) });
        mockPipeline.mockResolvedValue(mockPipelineFn);

        const provider = new EmbeddingProvider({
          provider: 'local',
          cacheDir: '/tmp/new-cache-dir',
        });

        await provider.initialize();

        expect(fs.mkdirSync).toHaveBeenCalledWith('/tmp/new-cache-dir', { recursive: true });
      });

      it('should fall back to mock provider if local model fails', async () => {
        mockPipeline.mockRejectedValue(new Error('Model load failed'));

        const provider = new EmbeddingProvider({ provider: 'local' });
        const errorHandler = jest.fn();
        provider.on('error', errorHandler);

        await provider.initialize();

        expect(provider.getProviderType()).toBe('mock');
        expect(provider.isReady()).toBe(true);
      });

      it('should fall back to mock when transformers module not found', async () => {
        // This error triggers the special path that re-throws with a helpful message
        mockPipeline.mockRejectedValue(new Error('Cannot find module @xenova/transformers'));

        const provider = new EmbeddingProvider({ provider: 'local' });

        // Add error listener to prevent unhandled error from EventEmitter
        const errorHandler = jest.fn();
        provider.on('error', errorHandler);

        // Should not throw - falls back to mock
        await provider.initialize();

        // Error should be emitted
        expect(errorHandler).toHaveBeenCalled();
        // The error message should contain the helpful message
        expect(errorHandler.mock.calls[0][0].message).toContain(
          'Local embeddings require @xenova/transformers'
        );
        // Should fall back to mock
        expect(provider.getProviderType()).toBe('mock');
        expect(provider.isReady()).toBe(true);
      });
    });

    describe('API Provider Initialization', () => {
      it('should initialize openai provider without API call', async () => {
        const provider = new EmbeddingProvider({
          provider: 'openai',
          apiKey: 'test-key',
        });

        await provider.initialize();

        expect(provider.isReady()).toBe(true);
        expect(mockFetch).not.toHaveBeenCalled();
      });

      it('should initialize grok provider without API call', async () => {
        const provider = new EmbeddingProvider({
          provider: 'grok',
          apiKey: 'test-key',
        });

        await provider.initialize();

        expect(provider.isReady()).toBe(true);
        expect(mockFetch).not.toHaveBeenCalled();
      });
    });
  });

  describe('getDimensions', () => {
    it('should return 384 for default local model', () => {
      const provider = new EmbeddingProvider();
      expect(provider.getDimensions()).toBe(384);
    });

    it('should return 1536 for text-embedding-ada-002', () => {
      const provider = new EmbeddingProvider({
        modelName: 'text-embedding-ada-002',
      });
      expect(provider.getDimensions()).toBe(1536);
    });

    it('should return 1536 for text-embedding-3-small', () => {
      const provider = new EmbeddingProvider({
        modelName: 'text-embedding-3-small',
      });
      expect(provider.getDimensions()).toBe(1536);
    });

    it('should return 3072 for text-embedding-3-large', () => {
      const provider = new EmbeddingProvider({
        modelName: 'text-embedding-3-large',
      });
      expect(provider.getDimensions()).toBe(3072);
    });

    it('should return 384 for unknown model', () => {
      const provider = new EmbeddingProvider({
        modelName: 'unknown-model',
      });
      expect(provider.getDimensions()).toBe(384);
    });
  });

  describe('isReady', () => {
    it('should return false before initialization', () => {
      const provider = new EmbeddingProvider({ provider: 'mock' });
      expect(provider.isReady()).toBe(false);
    });

    it('should return true after initialization', async () => {
      const provider = new EmbeddingProvider({ provider: 'mock' });
      await provider.initialize();
      expect(provider.isReady()).toBe(true);
    });
  });

  describe('getProviderType', () => {
    it('should return correct provider type', () => {
      const localProvider = new EmbeddingProvider({ provider: 'local' });
      expect(localProvider.getProviderType()).toBe('local');

      const mockProvider = new EmbeddingProvider({ provider: 'mock' });
      expect(mockProvider.getProviderType()).toBe('mock');

      const openaiProvider = new EmbeddingProvider({ provider: 'openai' });
      expect(openaiProvider.getProviderType()).toBe('openai');

      const grokProvider = new EmbeddingProvider({ provider: 'grok' });
      expect(grokProvider.getProviderType()).toBe('grok');
    });
  });

  describe('embed (Mock Provider)', () => {
    let provider: EmbeddingProvider;

    beforeEach(async () => {
      provider = new EmbeddingProvider({ provider: 'mock' });
      await provider.initialize();
    });

    it('should generate embedding for text', async () => {
      const result = await provider.embed('Hello world');

      expect(result.embedding).toBeInstanceOf(Float32Array);
      expect(result.dimensions).toBe(384);
      expect(result.provider).toBe('mock');
    });

    it('should generate deterministic embeddings for same text', async () => {
      const result1 = await provider.embed('test text');
      const result2 = await provider.embed('test text');

      expect(Array.from(result1.embedding)).toEqual(Array.from(result2.embedding));
    });

    it('should generate different embeddings for different text', async () => {
      const result1 = await provider.embed('first text');
      const result2 = await provider.embed('second text completely different');

      expect(Array.from(result1.embedding)).not.toEqual(Array.from(result2.embedding));
    });

    it('should normalize embeddings', async () => {
      const result = await provider.embed('sample text for testing');

      // Calculate L2 norm
      let norm = 0;
      for (let i = 0; i < result.embedding.length; i++) {
        norm += result.embedding[i] * result.embedding[i];
      }
      norm = Math.sqrt(norm);

      expect(norm).toBeCloseTo(1, 5);
    });

    it('should handle empty text', async () => {
      const result = await provider.embed('');

      expect(result.embedding).toBeInstanceOf(Float32Array);
      expect(result.dimensions).toBe(384);
    });

    it('should handle special characters', async () => {
      const result = await provider.embed('function() { return x + y; }');

      expect(result.embedding).toBeInstanceOf(Float32Array);
      expect(result.dimensions).toBe(384);
    });

    it('should handle unicode characters', async () => {
      const result = await provider.embed('Hello unicode characters test');

      expect(result.embedding).toBeInstanceOf(Float32Array);
      expect(result.dimensions).toBe(384);
    });

    it('should handle very long text', async () => {
      const longText = 'word '.repeat(10000);
      const result = await provider.embed(longText);

      expect(result.embedding).toBeInstanceOf(Float32Array);
      expect(result.dimensions).toBe(384);
    });
  });

  describe('embed (Local Provider)', () => {
    it('should use local model when initialized', async () => {
      const mockResult = { data: new Float32Array(384).fill(0.1) };
      const mockPipelineFn = jest.fn().mockResolvedValue(mockResult);
      mockPipeline.mockResolvedValue(mockPipelineFn);

      const provider = new EmbeddingProvider({ provider: 'local' });
      await provider.initialize();

      const result = await provider.embed('test text');

      expect(mockPipelineFn).toHaveBeenCalledWith('test text', {
        pooling: 'mean',
        normalize: true,
      });
      expect(result.provider).toBe('local');
    });

    it('should throw error if local model not initialized', async () => {
      // Force provider to think it's initialized but without pipeline
      const provider = new EmbeddingProvider({ provider: 'mock' });
      await provider.initialize();
      // Manually change provider type to local (simulating edge case)
      (provider as any).config.provider = 'local';
      (provider as any).pipeline = null;

      await expect(provider.embed('test')).rejects.toThrow('Local model not initialized');
    });
  });

  describe('embed (OpenAI Provider)', () => {
    let provider: EmbeddingProvider;

    beforeEach(async () => {
      provider = new EmbeddingProvider({
        provider: 'openai',
        apiKey: 'test-openai-key',
        modelName: 'text-embedding-3-small',
      });
      await provider.initialize();
    });

    it('should call OpenAI API with correct parameters', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ embedding: Array(1536).fill(0.1), index: 0 }],
          usage: { total_tokens: 10 },
        }),
      });

      const result = await provider.embed('test text');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/embeddings',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-openai-key',
          },
          body: JSON.stringify({
            input: ['test text'],
            model: 'text-embedding-3-small',
          }),
        })
      );
      expect(result.provider).toBe('openai');
      expect(result.embedding).toBeInstanceOf(Float32Array);
    });

    it('should throw error when API key is missing', async () => {
      const providerNoKey = new EmbeddingProvider({
        provider: 'openai',
        apiKey: undefined,
      });
      await providerNoKey.initialize();

      await expect(providerNoKey.embed('test')).rejects.toThrow(
        'OpenAI API key required for embeddings'
      );
    });

    it('should handle API errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        text: async () => 'Rate limit exceeded',
      });

      await expect(provider.embed('test')).rejects.toThrow(
        'OpenAI embedding error: Rate limit exceeded'
      );
    });
  });

  describe('embed (Grok Provider)', () => {
    let provider: EmbeddingProvider;
    const originalEnv = process.env.GROK_API_KEY;

    beforeEach(async () => {
      process.env.GROK_API_KEY = 'env-grok-key';
      provider = new EmbeddingProvider({
        provider: 'grok',
        modelName: 'grok-embedding',
      });
      await provider.initialize();
    });

    afterEach(() => {
      if (originalEnv) {
        process.env.GROK_API_KEY = originalEnv;
      } else {
        delete process.env.GROK_API_KEY;
      }
    });

    it('should call Grok API with correct parameters', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ embedding: Array(384).fill(0.1), index: 0 }],
          usage: { total_tokens: 10 },
        }),
      });

      const result = await provider.embed('test text');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.x.ai/v1/embeddings',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer env-grok-key',
          },
        })
      );
      expect(result.provider).toBe('grok');
    });

    it('should use provided API key over environment variable', async () => {
      const providerWithKey = new EmbeddingProvider({
        provider: 'grok',
        apiKey: 'explicit-key',
      });
      await providerWithKey.initialize();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ embedding: Array(384).fill(0.1), index: 0 }],
        }),
      });

      await providerWithKey.embed('test');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer explicit-key',
          }),
        })
      );
    });

    it('should use custom API endpoint', async () => {
      const providerCustomEndpoint = new EmbeddingProvider({
        provider: 'grok',
        apiKey: 'test-key',
        apiEndpoint: 'https://custom.api.com/embeddings',
      });
      await providerCustomEndpoint.initialize();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ embedding: Array(384).fill(0.1), index: 0 }],
        }),
      });

      await providerCustomEndpoint.embed('test');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://custom.api.com/embeddings',
        expect.any(Object)
      );
    });

    it('should throw error when API key is missing', async () => {
      delete process.env.GROK_API_KEY;
      const providerNoKey = new EmbeddingProvider({
        provider: 'grok',
        apiKey: undefined,
      });
      await providerNoKey.initialize();

      await expect(providerNoKey.embed('test')).rejects.toThrow(
        'CodeBuddy API key required for embeddings'
      );
    });

    it('should handle API errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        text: async () => 'Server error',
      });

      await expect(provider.embed('test')).rejects.toThrow(
        'Grok embedding error: Server error'
      );
    });
  });

  describe('embedBatch', () => {
    describe('Mock Provider', () => {
      let provider: EmbeddingProvider;

      beforeEach(async () => {
        provider = new EmbeddingProvider({ provider: 'mock' });
        await provider.initialize();
      });

      it('should embed multiple texts', async () => {
        const texts = ['text one', 'text two', 'text three'];
        const result = await provider.embedBatch(texts);

        expect(result.embeddings).toHaveLength(3);
        expect(result.dimensions).toBe(384);
        expect(result.provider).toBe('mock');
      });

      it('should handle empty array', async () => {
        const result = await provider.embedBatch([]);

        expect(result.embeddings).toHaveLength(0);
        expect(result.dimensions).toBe(384);
      });

      it('should produce consistent results with individual embed calls', async () => {
        const texts = ['hello', 'world'];
        const batchResult = await provider.embedBatch(texts);

        const individual1 = await provider.embed(texts[0]);
        const individual2 = await provider.embed(texts[1]);

        expect(Array.from(batchResult.embeddings[0])).toEqual(
          Array.from(individual1.embedding)
        );
        expect(Array.from(batchResult.embeddings[1])).toEqual(
          Array.from(individual2.embedding)
        );
      });
    });

    describe('Local Provider', () => {
      it('should process in batches and emit progress', async () => {
        const mockResult = { data: new Float32Array(384).fill(0.1) };
        const mockPipelineFn = jest.fn().mockResolvedValue(mockResult);
        mockPipeline.mockResolvedValue(mockPipelineFn);

        const provider = new EmbeddingProvider({
          provider: 'local',
          batchSize: 2,
        });
        await provider.initialize();

        const progressHandler = jest.fn();
        provider.on('batch:progress', progressHandler);

        const texts = ['one', 'two', 'three', 'four', 'five'];
        await provider.embedBatch(texts);

        expect(progressHandler).toHaveBeenCalled();
      });
    });

    describe('OpenAI Provider', () => {
      it('should batch request to OpenAI', async () => {
        const provider = new EmbeddingProvider({
          provider: 'openai',
          apiKey: 'test-key',
        });
        await provider.initialize();

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: [
              { embedding: Array(1536).fill(0.1), index: 0 },
              { embedding: Array(1536).fill(0.2), index: 1 },
            ],
            usage: { total_tokens: 20 },
          }),
        });

        const result = await provider.embedBatch(['text1', 'text2']);

        expect(result.embeddings).toHaveLength(2);
        expect(result.totalTokens).toBe(20);
      });

      it('should sort embeddings by index', async () => {
        const provider = new EmbeddingProvider({
          provider: 'openai',
          apiKey: 'test-key',
        });
        await provider.initialize();

        // Return out of order
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: [
              { embedding: Array(1536).fill(0.2), index: 1 },
              { embedding: Array(1536).fill(0.1), index: 0 },
            ],
            usage: { total_tokens: 20 },
          }),
        });

        const result = await provider.embedBatch(['text1', 'text2']);

        // First embedding should have 0.1 values (index 0)
        expect(result.embeddings[0][0]).toBeCloseTo(0.1, 5);
        expect(result.embeddings[1][0]).toBeCloseTo(0.2, 5);
      });
    });

    describe('Grok Provider', () => {
      it('should batch request to Grok', async () => {
        const provider = new EmbeddingProvider({
          provider: 'grok',
          apiKey: 'test-key',
        });
        await provider.initialize();

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: [
              { embedding: Array(384).fill(0.1), index: 0 },
              { embedding: Array(384).fill(0.2), index: 1 },
            ],
          }),
        });

        const result = await provider.embedBatch(['text1', 'text2']);

        expect(result.embeddings).toHaveLength(2);
        expect(result.provider).toBe('grok');
      });
    });
  });

  describe('cosineSimilarity', () => {
    let provider: EmbeddingProvider;

    beforeEach(async () => {
      provider = new EmbeddingProvider({ provider: 'mock' });
      await provider.initialize();
    });

    it('should return 1 for identical vectors', () => {
      const v = new Float32Array([0.5, 0.5, 0.5, 0.5]);
      const similarity = provider.cosineSimilarity(v, v);
      expect(similarity).toBeCloseTo(1, 5);
    });

    it('should return 0 for orthogonal vectors', () => {
      const v1 = new Float32Array([1, 0, 0, 0]);
      const v2 = new Float32Array([0, 1, 0, 0]);
      const similarity = provider.cosineSimilarity(v1, v2);
      expect(similarity).toBeCloseTo(0, 5);
    });

    it('should return -1 for opposite vectors', () => {
      const v1 = new Float32Array([1, 0, 0, 0]);
      const v2 = new Float32Array([-1, 0, 0, 0]);
      const similarity = provider.cosineSimilarity(v1, v2);
      expect(similarity).toBeCloseTo(-1, 5);
    });

    it('should return 0 for different length vectors', () => {
      const v1 = new Float32Array([1, 0, 0]);
      const v2 = new Float32Array([1, 0, 0, 0]);
      const similarity = provider.cosineSimilarity(v1, v2);
      expect(similarity).toBe(0);
    });

    it('should return 0 for zero vectors', () => {
      const v1 = new Float32Array([0, 0, 0, 0]);
      const v2 = new Float32Array([1, 0, 0, 0]);
      const similarity = provider.cosineSimilarity(v1, v2);
      expect(similarity).toBe(0);
    });

    it('should calculate correct similarity', () => {
      const v1 = new Float32Array([1, 2, 3]);
      const v2 = new Float32Array([4, 5, 6]);
      const similarity = provider.cosineSimilarity(v1, v2);

      // Manual calculation: (1*4 + 2*5 + 3*6) / (sqrt(14) * sqrt(77))
      const expected = 32 / (Math.sqrt(14) * Math.sqrt(77));
      expect(similarity).toBeCloseTo(expected, 5);
    });

    it('should be symmetric', () => {
      const v1 = new Float32Array([1, 2, 3, 4]);
      const v2 = new Float32Array([5, 6, 7, 8]);

      const sim1 = provider.cosineSimilarity(v1, v2);
      const sim2 = provider.cosineSimilarity(v2, v1);

      expect(sim1).toBeCloseTo(sim2, 10);
    });

    it('should handle negative values', () => {
      const v1 = new Float32Array([-1, 2, -3, 4]);
      const v2 = new Float32Array([1, -2, 3, -4]);
      const similarity = provider.cosineSimilarity(v1, v2);

      expect(similarity).toBeCloseTo(-1, 5);
    });
  });

  describe('Unknown Provider', () => {
    it('should throw error for unknown provider on embed', async () => {
      const provider = new EmbeddingProvider({ provider: 'mock' });
      await provider.initialize();
      // Manually set to unknown provider
      (provider as any).config.provider = 'unknown' as any;

      await expect(provider.embed('test')).rejects.toThrow(
        'Unknown embedding provider: unknown'
      );
    });

    it('should throw error for unknown provider on embedBatch', async () => {
      const provider = new EmbeddingProvider({ provider: 'mock' });
      await provider.initialize();
      (provider as any).config.provider = 'unknown' as any;

      await expect(provider.embedBatch(['test'])).rejects.toThrow(
        'Unknown embedding provider: unknown'
      );
    });
  });
});

describe('Singleton Functions', () => {
  beforeEach(() => {
    resetEmbeddingProvider();
    jest.clearAllMocks();
  });

  describe('getEmbeddingProvider', () => {
    it('should return same instance on multiple calls', () => {
      const provider1 = getEmbeddingProvider({ provider: 'mock' });
      const provider2 = getEmbeddingProvider();

      expect(provider1).toBe(provider2);
    });

    it('should create instance with config on first call', () => {
      const provider = getEmbeddingProvider({ provider: 'openai' });
      expect(provider.getProviderType()).toBe('openai');
    });

    it('should ignore config on subsequent calls', () => {
      const provider1 = getEmbeddingProvider({ provider: 'mock' });
      const provider2 = getEmbeddingProvider({ provider: 'openai' });

      expect(provider2.getProviderType()).toBe('mock');
    });
  });

  describe('initializeEmbeddingProvider', () => {
    it('should initialize and return provider', async () => {
      const provider = await initializeEmbeddingProvider({ provider: 'mock' });

      expect(provider.isReady()).toBe(true);
      expect(provider.getProviderType()).toBe('mock');
    });

    it('should return same instance as getEmbeddingProvider', async () => {
      const initialized = await initializeEmbeddingProvider({ provider: 'mock' });
      const gotten = getEmbeddingProvider();

      expect(initialized).toBe(gotten);
    });
  });

  describe('resetEmbeddingProvider', () => {
    it('should reset singleton instance', () => {
      const provider1 = getEmbeddingProvider({ provider: 'mock' });
      resetEmbeddingProvider();
      const provider2 = getEmbeddingProvider({ provider: 'openai' });

      expect(provider1).not.toBe(provider2);
      expect(provider2.getProviderType()).toBe('openai');
    });
  });
});

describe('Integration Tests', () => {
  beforeEach(() => {
    resetEmbeddingProvider();
    jest.clearAllMocks();
  });

  it('should produce similar embeddings for similar text', async () => {
    const provider = new EmbeddingProvider({ provider: 'mock' });
    await provider.initialize();

    const emb1 = await provider.embed('hello world');
    const emb2 = await provider.embed('hello world');
    const emb3 = await provider.embed('completely different text here');

    const sim12 = provider.cosineSimilarity(emb1.embedding, emb2.embedding);
    const sim13 = provider.cosineSimilarity(emb1.embedding, emb3.embedding);

    expect(sim12).toBe(1); // Same text should be identical
    expect(sim13).toBeLessThan(1); // Different text should be different
  });

  it('should work with batch vs single embed consistently', async () => {
    const provider = new EmbeddingProvider({ provider: 'mock' });
    await provider.initialize();

    const texts = ['text one', 'text two', 'text three'];

    const batchResult = await provider.embedBatch(texts);
    const singleResults = await Promise.all(texts.map(t => provider.embed(t)));

    for (let i = 0; i < texts.length; i++) {
      expect(Array.from(batchResult.embeddings[i])).toEqual(
        Array.from(singleResults[i].embedding)
      );
    }
  });

  it('should handle sequential API calls correctly', async () => {
    const provider = new EmbeddingProvider({
      provider: 'openai',
      apiKey: 'test-key',
    });
    await provider.initialize();

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ embedding: Array(1536).fill(0.1), index: 0 }],
          usage: { total_tokens: 5 },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ embedding: Array(1536).fill(0.2), index: 0 }],
          usage: { total_tokens: 5 },
        }),
      });

    const result1 = await provider.embed('first');
    const result2 = await provider.embed('second');

    expect(result1.embedding[0]).toBeCloseTo(0.1, 5);
    expect(result2.embedding[0]).toBeCloseTo(0.2, 5);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
