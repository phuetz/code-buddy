/**
 * Tests for Ollama Embedding Provider
 *
 * Tests the Ollama-based embedding system for local neural embeddings.
 */

import {
  OllamaEmbeddingProvider,
  getOllamaEmbeddings,
  initializeOllamaEmbeddings,
  resetOllamaEmbeddings,
  EMBEDDING_MODELS,
  DEFAULT_OLLAMA_EMBEDDING_CONFIG,
} from '../src/context/codebase-rag/ollama-embeddings.js';
import type { CodeChunk } from '../src/context/codebase-rag/types.js';

// ============================================================================
// Mock fetch for tests (Ollama not always available)
// ============================================================================

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

// ============================================================================
// OllamaEmbeddingProvider Tests
// ============================================================================

describe('OllamaEmbeddingProvider', () => {
  beforeEach(() => {
    resetOllamaEmbeddings();
    mockFetch.mockClear();
  });

  describe('constructor', () => {
    it('should create with default config', () => {
      const provider = new OllamaEmbeddingProvider();
      const config = provider.getConfig();

      expect(config.baseUrl).toBe(DEFAULT_OLLAMA_EMBEDDING_CONFIG.baseUrl);
      expect(config.model).toBe(DEFAULT_OLLAMA_EMBEDDING_CONFIG.model);
      expect(config.timeout).toBe(DEFAULT_OLLAMA_EMBEDDING_CONFIG.timeout);
    });

    it('should create with custom config', () => {
      const provider = new OllamaEmbeddingProvider({
        baseUrl: 'http://custom:11434',
        model: 'mxbai-embed-large',
        timeout: 60000,
      });
      const config = provider.getConfig();

      expect(config.baseUrl).toBe('http://custom:11434');
      expect(config.model).toBe('mxbai-embed-large');
      expect(config.timeout).toBe(60000);
    });

    it('should set dimensions from known model', () => {
      const provider = new OllamaEmbeddingProvider({ model: 'nomic-embed-text' });
      expect(provider.getDimensions()).toBe(768);
    });

    it('should set dimensions for mxbai-embed-large', () => {
      const provider = new OllamaEmbeddingProvider({ model: 'mxbai-embed-large' });
      expect(provider.getDimensions()).toBe(1024);
    });

    it('should set dimensions for all-minilm', () => {
      const provider = new OllamaEmbeddingProvider({ model: 'all-minilm' });
      expect(provider.getDimensions()).toBe(384);
    });

    it('should default to 768 for unknown model', () => {
      const provider = new OllamaEmbeddingProvider({ model: 'unknown-model' });
      expect(provider.getDimensions()).toBe(768);
    });
  });

  describe('initialize', () => {
    it('should return false when Ollama is not available', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      const provider = new OllamaEmbeddingProvider();
      const result = await provider.initialize();

      expect(result).toBe(false);
      expect(provider.isReady()).toBe(false);
    });

    it('should return true when Ollama is available with model', async () => {
      // Mock /api/tags response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          models: [{ name: 'nomic-embed-text:latest' }],
        }),
      });

      // Mock /api/embeddings test response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          embedding: new Array(768).fill(0.1),
        }),
      });

      const provider = new OllamaEmbeddingProvider();
      const result = await provider.initialize();

      expect(result).toBe(true);
      expect(provider.isReady()).toBe(true);
    });

    it('should emit ready event on success', (done) => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [{ name: 'nomic-embed-text:latest' }] }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ embedding: new Array(768).fill(0.1) }),
      });

      const provider = new OllamaEmbeddingProvider();
      provider.on('ready', () => {
        expect(provider.isReady()).toBe(true);
        done();
      });

      provider.initialize();
    });
  });

  describe('isReady', () => {
    it('should return false before initialization', () => {
      const provider = new OllamaEmbeddingProvider();
      expect(provider.isReady()).toBe(false);
    });
  });

  describe('getDimensions', () => {
    it('should return correct dimensions', () => {
      const provider = new OllamaEmbeddingProvider({ model: 'nomic-embed-text' });
      expect(provider.getDimensions()).toBe(768);
    });
  });

  describe('embed', () => {
    it('should return zero vector when not available', async () => {
      const provider = new OllamaEmbeddingProvider();
      // Not initialized, so not available

      const embedding = await provider.embed('test text');

      expect(embedding.length).toBe(768);
      expect(embedding.every((v) => v === 0)).toBe(true);
    });

    it('should return embedding from Ollama', async () => {
      // Setup mocks for initialization:
      // 1. /api/tags call
      // 2. embed("test") call during init verification
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [{ name: 'nomic-embed-text:latest' }] }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ embedding: new Array(768).fill(0.1) }),
      });

      const provider = new OllamaEmbeddingProvider();
      await provider.initialize();

      // Mock response for actual test embed call
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ embedding: new Array(768).fill(0.5) }),
      });

      const embedding = await provider.embed('test text');

      expect(embedding.length).toBe(768);
      // Verify we got a non-zero embedding (actual values depend on mock)
      expect(embedding.some((v) => v !== 0)).toBe(true);
    });

    it('should retry on failure', async () => {
      // Initialize provider
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [{ name: 'nomic-embed-text:latest' }] }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ embedding: new Array(768).fill(0.1) }),
      });

      const provider = new OllamaEmbeddingProvider({
        retryAttempts: 3,
        retryDelay: 10,
      });
      await provider.initialize();

      // First attempt fails, retry succeeds
      mockFetch
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ embedding: new Array(768).fill(0.3) }),
        });

      const embedding = await provider.embed('test text');

      // Should get valid embedding even after retry
      expect(embedding.length).toBe(768);
      expect(embedding.some((v) => v !== 0)).toBe(true);
    });

    it('should return zero vector after all retries fail', async () => {
      // Initialize
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [{ name: 'nomic-embed-text:latest' }] }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ embedding: new Array(768).fill(0.1) }),
      });

      const provider = new OllamaEmbeddingProvider({
        retryAttempts: 2,
        retryDelay: 10,
      });
      await provider.initialize();

      // All attempts fail
      mockFetch.mockRejectedValue(new Error('Network error'));

      const embedding = await provider.embed('test text');

      expect(embedding.length).toBe(768);
      expect(embedding.every((v) => v === 0)).toBe(true);
    });
  });

  describe('embedBatch', () => {
    beforeEach(async () => {
      // Initialize provider
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [{ name: 'nomic-embed-text:latest' }] }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ embedding: new Array(768).fill(0.1) }),
      });
    });

    it('should embed multiple texts', async () => {
      const provider = new OllamaEmbeddingProvider({ batchSize: 2 });
      await provider.initialize();

      // Mock responses for batch
      for (let i = 0; i < 3; i++) {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ embedding: new Array(768).fill(0.1 * (i + 1)) }),
        });
      }

      const texts = ['text1', 'text2', 'text3'];
      const embeddings = await provider.embedBatch(texts);

      expect(embeddings.length).toBe(3);
      expect(embeddings[0].length).toBe(768);
    });

    it('should emit batch progress', (done) => {
      const provider = new OllamaEmbeddingProvider({ batchSize: 2 });
      provider.initialize().then(() => {
        // Mock responses
        for (let i = 0; i < 3; i++) {
          mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ embedding: new Array(768).fill(0.1) }),
          });
        }

        provider.on('batch:progress', (progress) => {
          expect(progress).toHaveProperty('completed');
          expect(progress).toHaveProperty('total');
          done();
        });

        provider.embedBatch(['text1', 'text2', 'text3']);
      });
    });
  });

  describe('embedChunk', () => {
    it('should embed code chunk with metadata', async () => {
      // Initialize
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [{ name: 'nomic-embed-text:latest' }] }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ embedding: new Array(768).fill(0.1) }),
      });

      const provider = new OllamaEmbeddingProvider();
      await provider.initialize();

      // Mock embed response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ embedding: new Array(768).fill(0.5) }),
      });

      const chunk: CodeChunk = {
        id: 'test-chunk',
        content: 'function hello() { return "world"; }',
        filePath: 'src/hello.ts',
        startLine: 1,
        endLine: 3,
        type: 'function',
        language: 'typescript',
        metadata: {
          name: 'hello',
          signature: 'hello(): string',
        },
      };

      const embedding = await provider.embedChunk(chunk);

      expect(embedding.length).toBe(768);
      // Verify the request included enhanced text
      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      const body = JSON.parse(lastCall[1].body);
      expect(body.prompt).toContain('File:');
      expect(body.prompt).toContain('typescript');
    });
  });

  describe('similarity', () => {
    let provider: OllamaEmbeddingProvider;

    beforeEach(() => {
      provider = new OllamaEmbeddingProvider();
    });

    it('should return 1 for identical vectors', () => {
      const v = [0.5, 0.5, 0.5, 0.5];
      const similarity = provider.similarity(v, v);
      expect(similarity).toBeCloseTo(1, 5);
    });

    it('should return 0 for orthogonal vectors', () => {
      const v1 = [1, 0, 0, 0];
      const v2 = [0, 1, 0, 0];
      const similarity = provider.similarity(v1, v2);
      expect(similarity).toBeCloseTo(0, 5);
    });

    it('should return -1 for opposite vectors', () => {
      const v1 = [1, 0, 0, 0];
      const v2 = [-1, 0, 0, 0];
      const similarity = provider.similarity(v1, v2);
      expect(similarity).toBeCloseTo(-1, 5);
    });

    it('should throw for different dimensions', () => {
      const v1 = [1, 0, 0];
      const v2 = [1, 0, 0, 0];
      expect(() => provider.similarity(v1, v2)).toThrow('same dimensions');
    });

    it('should handle zero vectors', () => {
      const v1 = [0, 0, 0, 0];
      const v2 = [1, 0, 0, 0];
      const similarity = provider.similarity(v1, v2);
      expect(similarity).toBe(0);
    });
  });

  describe('getModelInfo', () => {
    it('should return model info for known model', () => {
      const provider = new OllamaEmbeddingProvider({ model: 'nomic-embed-text' });
      const info = provider.getModelInfo();

      expect(info).not.toBeNull();
      expect(info?.name).toBe('nomic-embed-text');
      expect(info?.dimensions).toBe(768);
    });

    it('should return null for unknown model', () => {
      const provider = new OllamaEmbeddingProvider({ model: 'unknown-model' });
      const info = provider.getModelInfo();

      expect(info).toBeNull();
    });
  });

  describe('updateConfig', () => {
    it('should update configuration', () => {
      const provider = new OllamaEmbeddingProvider();
      provider.updateConfig({ timeout: 60000 });

      const config = provider.getConfig();
      expect(config.timeout).toBe(60000);
    });

    it('should update dimensions when model changes', () => {
      const provider = new OllamaEmbeddingProvider({ model: 'nomic-embed-text' });
      expect(provider.getDimensions()).toBe(768);

      provider.updateConfig({ model: 'mxbai-embed-large' });
      expect(provider.getDimensions()).toBe(1024);
    });
  });

  describe('formatStatus', () => {
    it('should format status for display', () => {
      const provider = new OllamaEmbeddingProvider();
      const status = provider.formatStatus();

      expect(typeof status).toBe('string');
      expect(status).toContain('Ollama');
      expect(status).toContain('Status');
    });

    it('should show model information', () => {
      const provider = new OllamaEmbeddingProvider({ model: 'nomic-embed-text' });
      const status = provider.formatStatus();

      expect(status).toContain('nomic-embed-text');
      expect(status).toContain('768');
    });
  });

  describe('dispose', () => {
    it('should dispose without error', () => {
      const provider = new OllamaEmbeddingProvider();
      expect(() => provider.dispose()).not.toThrow();
    });

    it('should mark as unavailable after dispose', () => {
      const provider = new OllamaEmbeddingProvider();
      provider.dispose();
      expect(provider.isReady()).toBe(false);
    });
  });
});

// ============================================================================
// Singleton Functions Tests
// ============================================================================

describe('Ollama Embeddings Singleton', () => {
  beforeEach(() => {
    resetOllamaEmbeddings();
    mockFetch.mockClear();
  });

  describe('getOllamaEmbeddings', () => {
    it('should return same instance', () => {
      const provider1 = getOllamaEmbeddings();
      const provider2 = getOllamaEmbeddings();
      expect(provider1).toBe(provider2);
    });

    it('should accept config on first call', () => {
      const provider = getOllamaEmbeddings({ model: 'all-minilm' });
      expect(provider.getDimensions()).toBe(384);
    });
  });

  describe('initializeOllamaEmbeddings', () => {
    it('should initialize and return provider', async () => {
      mockFetch.mockRejectedValue(new Error('Not available'));

      const provider = await initializeOllamaEmbeddings();
      expect(provider).toBeInstanceOf(OllamaEmbeddingProvider);
    });
  });

  describe('resetOllamaEmbeddings', () => {
    it('should reset singleton', () => {
      const provider1 = getOllamaEmbeddings();
      resetOllamaEmbeddings();
      const provider2 = getOllamaEmbeddings();
      expect(provider1).not.toBe(provider2);
    });
  });
});

// ============================================================================
// EMBEDDING_MODELS Tests
// ============================================================================

describe('EMBEDDING_MODELS', () => {
  it('should have nomic-embed-text', () => {
    expect(EMBEDDING_MODELS['nomic-embed-text']).toBeDefined();
    expect(EMBEDDING_MODELS['nomic-embed-text'].dimensions).toBe(768);
  });

  it('should have mxbai-embed-large', () => {
    expect(EMBEDDING_MODELS['mxbai-embed-large']).toBeDefined();
    expect(EMBEDDING_MODELS['mxbai-embed-large'].dimensions).toBe(1024);
  });

  it('should have all-minilm', () => {
    expect(EMBEDDING_MODELS['all-minilm']).toBeDefined();
    expect(EMBEDDING_MODELS['all-minilm'].dimensions).toBe(384);
  });

  it('should have valid model info structure', () => {
    for (const [key, model] of Object.entries(EMBEDDING_MODELS)) {
      expect(model.name).toBe(key);
      expect(typeof model.dimensions).toBe('number');
      expect(typeof model.description).toBe('string');
      expect(typeof model.sizeGB).toBe('number');
    }
  });
});

// ============================================================================
// Static Methods Tests
// ============================================================================

describe('OllamaEmbeddingProvider Static Methods', () => {
  describe('getAvailableModels', () => {
    it('should return list of models', () => {
      const models = OllamaEmbeddingProvider.getAvailableModels();

      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBeGreaterThan(0);
    });

    it('should return valid model info', () => {
      const models = OllamaEmbeddingProvider.getAvailableModels();

      for (const model of models) {
        expect(model).toHaveProperty('name');
        expect(model).toHaveProperty('dimensions');
        expect(model).toHaveProperty('description');
        expect(model).toHaveProperty('sizeGB');
      }
    });
  });
});
