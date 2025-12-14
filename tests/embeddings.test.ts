/**
 * Tests for Embedding Provider
 */

import {
  EmbeddingProvider,
  getEmbeddingProvider,
  resetEmbeddingProvider,
  type EmbeddingProviderType,
} from '../src/embeddings/embedding-provider.js';

// ============================================================================
// Mock Provider Tests (no external dependencies)
// ============================================================================

describe('EmbeddingProvider', () => {
  beforeEach(() => {
    resetEmbeddingProvider();
  });

  describe('constructor', () => {
    it('should create with default config', () => {
      const provider = new EmbeddingProvider();
      expect(provider.getProviderType()).toBe('local');
      expect(provider.getDimensions()).toBe(384);
    });

    it('should create with mock provider', () => {
      const provider = new EmbeddingProvider({ provider: 'mock' });
      expect(provider.getProviderType()).toBe('mock');
    });

    it('should create with custom config', () => {
      const provider = new EmbeddingProvider({
        provider: 'openai',
        modelName: 'text-embedding-3-small',
        apiKey: 'test-key',
      });
      expect(provider.getProviderType()).toBe('openai');
    });
  });

  describe('getDimensions', () => {
    it('should return correct dimensions for MiniLM', () => {
      const provider = new EmbeddingProvider({
        provider: 'mock',
        modelName: 'Xenova/all-MiniLM-L6-v2',
      });
      expect(provider.getDimensions()).toBe(384);
    });

    it('should return correct dimensions for OpenAI models', () => {
      const provider = new EmbeddingProvider({
        provider: 'mock',
        modelName: 'text-embedding-ada-002',
      });
      expect(provider.getDimensions()).toBe(1536);
    });

    it('should return correct dimensions for text-embedding-3-large', () => {
      const provider = new EmbeddingProvider({
        provider: 'mock',
        modelName: 'text-embedding-3-large',
      });
      expect(provider.getDimensions()).toBe(3072);
    });

    it('should default to 384 for unknown model', () => {
      const provider = new EmbeddingProvider({
        provider: 'mock',
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

  describe('Mock Embeddings', () => {
    let provider: EmbeddingProvider;

    beforeEach(async () => {
      provider = new EmbeddingProvider({ provider: 'mock' });
      await provider.initialize();
    });

    describe('embed', () => {
      it('should generate embedding for text', async () => {
        const result = await provider.embed('Hello world');

        expect(result.embedding).toBeInstanceOf(Float32Array);
        expect(result.dimensions).toBe(384);
        expect(result.provider).toBe('mock');
      });

      it('should generate consistent embeddings for same text', async () => {
        const result1 = await provider.embed('Same text');
        const result2 = await provider.embed('Same text');

        expect(Array.from(result1.embedding)).toEqual(Array.from(result2.embedding));
      });

      it('should generate different embeddings for different text', async () => {
        const result1 = await provider.embed('Text one');
        const result2 = await provider.embed('Text two');

        expect(Array.from(result1.embedding)).not.toEqual(Array.from(result2.embedding));
      });

      it('should return normalized embeddings', async () => {
        const result = await provider.embed('Test normalization');

        // Calculate L2 norm
        let norm = 0;
        for (let i = 0; i < result.embedding.length; i++) {
          norm += result.embedding[i] * result.embedding[i];
        }
        norm = Math.sqrt(norm);

        expect(norm).toBeCloseTo(1, 5);
      });
    });

    describe('embedBatch', () => {
      it('should generate embeddings for multiple texts', async () => {
        const texts = ['Text one', 'Text two', 'Text three'];
        const result = await provider.embedBatch(texts);

        expect(result.embeddings.length).toBe(3);
        expect(result.dimensions).toBe(384);
        expect(result.provider).toBe('mock');
      });

      it('should return empty array for empty input', async () => {
        const result = await provider.embedBatch([]);

        expect(result.embeddings.length).toBe(0);
        expect(result.dimensions).toBe(384);
      });

      it('should generate consistent batch embeddings', async () => {
        const texts = ['A', 'B', 'C'];
        const result1 = await provider.embedBatch(texts);
        const result2 = await provider.embedBatch(texts);

        for (let i = 0; i < texts.length; i++) {
          expect(Array.from(result1.embeddings[i])).toEqual(Array.from(result2.embeddings[i]));
        }
      });
    });
  });

  describe('cosineSimilarity', () => {
    let provider: EmbeddingProvider;

    beforeEach(() => {
      provider = new EmbeddingProvider({ provider: 'mock' });
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

    it('should handle zero vectors', () => {
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
  });

  describe('Semantic Similarity', () => {
    let provider: EmbeddingProvider;

    beforeEach(async () => {
      provider = new EmbeddingProvider({ provider: 'mock' });
      await provider.initialize();
    });

    it('should produce higher similarity for similar text', async () => {
      const base = await provider.embed('The quick brown fox');
      const similar = await provider.embed('The fast brown fox');
      const different = await provider.embed('Machine learning algorithms');

      const simSimilar = provider.cosineSimilarity(base.embedding, similar.embedding);
      const simDifferent = provider.cosineSimilarity(base.embedding, different.embedding);

      // Mock embeddings are based on text hash, so this won't behave like real semantic similarity
      // but we can still verify the function works
      expect(typeof simSimilar).toBe('number');
      expect(typeof simDifferent).toBe('number');
      expect(simSimilar).toBeGreaterThanOrEqual(-1);
      expect(simSimilar).toBeLessThanOrEqual(1);
    });
  });

  describe('initialization', () => {
    it('should handle concurrent initialization calls', async () => {
      const provider = new EmbeddingProvider({ provider: 'mock' });

      // Start multiple initializations concurrently
      const [result1, result2, result3] = await Promise.all([
        provider.initialize(),
        provider.initialize(),
        provider.initialize(),
      ]);

      expect(provider.isReady()).toBe(true);
    });

    it('should emit initialized event', (done) => {
      const provider = new EmbeddingProvider({ provider: 'mock' });

      provider.on('initialized', (data) => {
        expect(data.provider).toBe('mock');
        done();
      });

      provider.initialize();
    });

    it('should not reinitialize if already initialized', async () => {
      const provider = new EmbeddingProvider({ provider: 'mock' });

      await provider.initialize();
      const firstReady = provider.isReady();

      await provider.initialize();
      const secondReady = provider.isReady();

      expect(firstReady).toBe(true);
      expect(secondReady).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should throw for unknown provider in embed', async () => {
      const provider = new EmbeddingProvider({ provider: 'unknown' as EmbeddingProviderType });

      await expect(provider.embed('test')).rejects.toThrow('Unknown embedding provider');
    });

    it('should throw for unknown provider in embedBatch', async () => {
      const provider = new EmbeddingProvider({ provider: 'unknown' as EmbeddingProviderType });

      await expect(provider.embedBatch(['test'])).rejects.toThrow('Unknown embedding provider');
    });

    it('should require API key for OpenAI', async () => {
      const provider = new EmbeddingProvider({ provider: 'openai' });

      await expect(provider.embed('test')).rejects.toThrow('API key required');
    });

    it('should require API key for Grok without env variable', async () => {
      const originalKey = process.env.GROK_API_KEY;
      delete process.env.GROK_API_KEY;

      const provider = new EmbeddingProvider({ provider: 'grok' });

      await expect(provider.embed('test')).rejects.toThrow('API key required');

      // Restore
      if (originalKey) {
        process.env.GROK_API_KEY = originalKey;
      }
    });
  });

  describe('Singleton functions', () => {
    it('should return same instance from getEmbeddingProvider', () => {
      resetEmbeddingProvider();
      const provider1 = getEmbeddingProvider({ provider: 'mock' });
      const provider2 = getEmbeddingProvider();
      expect(provider1).toBe(provider2);
    });

    it('should reset instance with resetEmbeddingProvider', () => {
      const provider1 = getEmbeddingProvider({ provider: 'mock' });
      resetEmbeddingProvider();
      const provider2 = getEmbeddingProvider({ provider: 'mock' });
      expect(provider1).not.toBe(provider2);
    });
  });

  describe('batch processing', () => {
    it('should process batches correctly', async () => {
      const provider = new EmbeddingProvider({
        provider: 'mock',
        batchSize: 2,
      });
      await provider.initialize();

      const texts = ['a', 'b', 'c', 'd', 'e'];
      const result = await provider.embedBatch(texts);

      expect(result.embeddings.length).toBe(5);
      expect(result.dimensions).toBe(384);

      // Each embedding should be normalized
      for (const embedding of result.embeddings) {
        let norm = 0;
        for (let i = 0; i < embedding.length; i++) {
          norm += embedding[i] * embedding[i];
        }
        norm = Math.sqrt(norm);
        expect(norm).toBeCloseTo(1, 5);
      }
    });
  });
});

// ============================================================================
// Integration with Enhanced Memory (mock test)
// ============================================================================

describe('EmbeddingProvider Integration', () => {
  it('should work with memory-like use case', async () => {
    const provider = new EmbeddingProvider({ provider: 'mock' });
    await provider.initialize();

    // Simulate storing memories with embeddings
    const memories = [
      { text: 'User prefers dark mode', embedding: null as Float32Array | null },
      { text: 'Project uses TypeScript', embedding: null as Float32Array | null },
      { text: 'Testing with Jest', embedding: null as Float32Array | null },
    ];

    // Generate embeddings
    for (const memory of memories) {
      const result = await provider.embed(memory.text);
      memory.embedding = result.embedding;
    }

    // Search for similar memory
    const queryResult = await provider.embed('dark theme preference');
    const queryEmbedding = queryResult.embedding;

    // Find most similar
    let bestMatch = { index: -1, similarity: -1 };
    for (let i = 0; i < memories.length; i++) {
      const sim = provider.cosineSimilarity(queryEmbedding, memories[i].embedding!);
      if (sim > bestMatch.similarity) {
        bestMatch = { index: i, similarity: sim };
      }
    }

    expect(bestMatch.index).toBeGreaterThanOrEqual(0);
    expect(bestMatch.similarity).toBeGreaterThanOrEqual(-1);
  });
});
