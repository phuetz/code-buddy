/**
 * Comprehensive Unit Tests for Embedding Module
 *
 * Covers:
 * - Embedding generation (EmbeddingProvider)
 * - Vector similarity calculations (cosine similarity)
 * - Embedding caching (EmbeddingRepository)
 * - Batch processing (embedBatch)
 * - Vector stores (InMemoryVectorStore, PartitionedVectorStore, HNSWVectorStore)
 */

import {
  EmbeddingProvider,
  getEmbeddingProvider,
  resetEmbeddingProvider,
  type EmbeddingProviderType,
  type EmbeddingConfig,
} from '../../src/embeddings/embedding-provider';
import {
  InMemoryVectorStore,
  PartitionedVectorStore,
  createVectorStore,
} from '../../src/context/codebase-rag/vector-store';
import {
  HNSWVectorStore,
  getHNSWStore,
  resetHNSWStore,
  DEFAULT_HNSW_CONFIG,
  type HNSWConfig,
  type VectorEntry,
} from '../../src/context/codebase-rag/hnsw-store';
import {
  EmbeddingRepository,
  getEmbeddingRepository,
  resetEmbeddingRepository,
} from '../../src/database/repositories/embedding-repository';

// ============================================================================
// Mocks
// ============================================================================

// Mock the database manager for EmbeddingRepository tests
jest.mock('../../src/database/database-manager', () => {
  const mockDb = {
    prepare: jest.fn(() => ({
      get: jest.fn(),
      all: jest.fn(() => []),
      run: jest.fn(() => ({ changes: 0 })),
    })),
    transaction: jest.fn((fn) => fn),
  };

  return {
    getDatabaseManager: jest.fn(() => ({
      getDatabase: jest.fn(() => mockDb),
    })),
  };
});

// Mock fs for vector store persistence tests
jest.mock('fs', () => {
  const originalFs = jest.requireActual('fs');
  return {
    ...originalFs,
    existsSync: jest.fn((path: string) => {
      // Return true for specific test paths
      if (path.includes('test-persist') || path.includes('.codebuddy')) {
        return false;
      }
      return originalFs.existsSync(path);
    }),
    mkdirSync: jest.fn(),
    writeFileSync: jest.fn(),
    readFileSync: jest.fn(() => JSON.stringify({
      version: 1,
      vectors: [],
    })),
  };
});

// Mock logger to suppress output during tests
jest.mock('../../src/utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// ============================================================================
// EmbeddingProvider Tests
// ============================================================================

describe('EmbeddingProvider', () => {
  beforeEach(() => {
    resetEmbeddingProvider();
  });

  afterEach(() => {
    resetEmbeddingProvider();
  });

  describe('constructor', () => {
    it('should create with default configuration', () => {
      const provider = new EmbeddingProvider();
      expect(provider.getProviderType()).toBe('local');
      expect(provider.getDimensions()).toBe(384);
    });

    it('should create with mock provider', () => {
      const provider = new EmbeddingProvider({ provider: 'mock' });
      expect(provider.getProviderType()).toBe('mock');
    });

    it('should accept custom configuration', () => {
      const config: Partial<EmbeddingConfig> = {
        provider: 'openai',
        modelName: 'text-embedding-3-small',
        apiKey: 'test-api-key',
        batchSize: 16,
      };
      const provider = new EmbeddingProvider(config);
      expect(provider.getProviderType()).toBe('openai');
    });

    it('should use custom cache directory', () => {
      const provider = new EmbeddingProvider({
        provider: 'mock',
        cacheDir: '/custom/cache/dir',
      });
      expect(provider).toBeDefined();
    });
  });

  describe('getDimensions', () => {
    it('should return 384 for MiniLM model', () => {
      const provider = new EmbeddingProvider({
        provider: 'mock',
        modelName: 'Xenova/all-MiniLM-L6-v2',
      });
      expect(provider.getDimensions()).toBe(384);
    });

    it('should return 1536 for text-embedding-ada-002', () => {
      const provider = new EmbeddingProvider({
        provider: 'mock',
        modelName: 'text-embedding-ada-002',
      });
      expect(provider.getDimensions()).toBe(1536);
    });

    it('should return 1536 for text-embedding-3-small', () => {
      const provider = new EmbeddingProvider({
        provider: 'mock',
        modelName: 'text-embedding-3-small',
      });
      expect(provider.getDimensions()).toBe(1536);
    });

    it('should return 3072 for text-embedding-3-large', () => {
      const provider = new EmbeddingProvider({
        provider: 'mock',
        modelName: 'text-embedding-3-large',
      });
      expect(provider.getDimensions()).toBe(3072);
    });

    it('should default to 384 for unknown model', () => {
      const provider = new EmbeddingProvider({
        provider: 'mock',
        modelName: 'unknown-custom-model',
      });
      expect(provider.getDimensions()).toBe(384);
    });
  });

  describe('initialization', () => {
    it('should not be ready before initialization', () => {
      const provider = new EmbeddingProvider({ provider: 'mock' });
      expect(provider.isReady()).toBe(false);
    });

    it('should be ready after initialization', async () => {
      const provider = new EmbeddingProvider({ provider: 'mock' });
      await provider.initialize();
      expect(provider.isReady()).toBe(true);
    });

    it('should handle concurrent initialization calls', async () => {
      const provider = new EmbeddingProvider({ provider: 'mock' });

      const results = await Promise.all([
        provider.initialize(),
        provider.initialize(),
        provider.initialize(),
      ]);

      expect(provider.isReady()).toBe(true);
      // All promises should resolve without error
      expect(results).toHaveLength(3);
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
      const isReadyAfterFirst = provider.isReady();

      await provider.initialize();
      const isReadyAfterSecond = provider.isReady();

      expect(isReadyAfterFirst).toBe(true);
      expect(isReadyAfterSecond).toBe(true);
    });
  });

  describe('embed', () => {
    let provider: EmbeddingProvider;

    beforeEach(async () => {
      provider = new EmbeddingProvider({ provider: 'mock' });
      await provider.initialize();
    });

    it('should generate embedding for text', async () => {
      const result = await provider.embed('Hello, world!');

      expect(result.embedding).toBeInstanceOf(Float32Array);
      expect(result.dimensions).toBe(384);
      expect(result.provider).toBe('mock');
    });

    it('should generate consistent embeddings for same text', async () => {
      const text = 'Deterministic embedding test';
      const result1 = await provider.embed(text);
      const result2 = await provider.embed(text);

      expect(Array.from(result1.embedding)).toEqual(Array.from(result2.embedding));
    });

    it('should generate different embeddings for different text', async () => {
      const result1 = await provider.embed('First text sample');
      const result2 = await provider.embed('Completely different content');

      expect(Array.from(result1.embedding)).not.toEqual(Array.from(result2.embedding));
    });

    it('should return normalized embeddings (unit length)', async () => {
      const result = await provider.embed('Test normalization');

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

    it('should handle very long text', async () => {
      const longText = 'x'.repeat(10000);
      const result = await provider.embed(longText);
      expect(result.embedding).toBeInstanceOf(Float32Array);
      expect(result.dimensions).toBe(384);
    });

    it('should handle special characters', async () => {
      const specialText = '!@#$%^&*()_+-=[]{}|;:"<>,.?/~`';
      const result = await provider.embed(specialText);
      expect(result.embedding).toBeInstanceOf(Float32Array);
    });

    it('should handle unicode text', async () => {
      const unicodeText = 'Hello unicode chars test';
      const result = await provider.embed(unicodeText);
      expect(result.embedding).toBeInstanceOf(Float32Array);
    });

    it('should handle newlines and whitespace', async () => {
      const multilineText = 'Line 1\nLine 2\n\tTabbed line\n  Spaced line';
      const result = await provider.embed(multilineText);
      expect(result.embedding).toBeInstanceOf(Float32Array);
    });
  });

  describe('embedBatch', () => {
    let provider: EmbeddingProvider;

    beforeEach(async () => {
      provider = new EmbeddingProvider({ provider: 'mock', batchSize: 2 });
      await provider.initialize();
    });

    it('should generate embeddings for multiple texts', async () => {
      const texts = ['Text one', 'Text two', 'Text three'];
      const result = await provider.embedBatch(texts);

      expect(result.embeddings).toHaveLength(3);
      expect(result.dimensions).toBe(384);
      expect(result.provider).toBe('mock');
    });

    it('should return empty array for empty input', async () => {
      const result = await provider.embedBatch([]);

      expect(result.embeddings).toHaveLength(0);
      expect(result.dimensions).toBe(384);
    });

    it('should generate consistent batch embeddings', async () => {
      const texts = ['A', 'B', 'C'];
      const result1 = await provider.embedBatch(texts);
      const result2 = await provider.embedBatch(texts);

      for (let i = 0; i < texts.length; i++) {
        expect(Array.from(result1.embeddings[i])).toEqual(
          Array.from(result2.embeddings[i])
        );
      }
    });

    it('should process large batches correctly', async () => {
      const texts = Array.from({ length: 10 }, (_, i) => `Text number ${i}`);
      const result = await provider.embedBatch(texts);

      expect(result.embeddings).toHaveLength(10);

      // Verify each embedding is normalized
      for (const embedding of result.embeddings) {
        let norm = 0;
        for (let i = 0; i < embedding.length; i++) {
          norm += embedding[i] * embedding[i];
        }
        norm = Math.sqrt(norm);
        expect(norm).toBeCloseTo(1, 5);
      }
    });

    it('should produce same results as individual embed calls', async () => {
      const texts = ['First', 'Second', 'Third'];
      const batchResult = await provider.embedBatch(texts);

      for (let i = 0; i < texts.length; i++) {
        const singleResult = await provider.embed(texts[i]);
        expect(Array.from(batchResult.embeddings[i])).toEqual(
          Array.from(singleResult.embedding)
        );
      }
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

    it('should return 0 for zero vectors', () => {
      const v1 = new Float32Array([0, 0, 0, 0]);
      const v2 = new Float32Array([1, 0, 0, 0]);
      const similarity = provider.cosineSimilarity(v1, v2);
      expect(similarity).toBe(0);
    });

    it('should calculate correct similarity for arbitrary vectors', () => {
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

    it('should handle very small values', () => {
      const v1 = new Float32Array([1e-10, 1e-10]);
      const v2 = new Float32Array([1e-10, 1e-10]);
      const similarity = provider.cosineSimilarity(v1, v2);

      expect(similarity).toBeCloseTo(1, 5);
    });

    it('should handle very large values', () => {
      const v1 = new Float32Array([1e10, 1e10]);
      const v2 = new Float32Array([1e10, 1e10]);
      const similarity = provider.cosineSimilarity(v1, v2);

      expect(similarity).toBeCloseTo(1, 5);
    });
  });

  describe('error handling', () => {
    it('should throw for unknown provider in embed', async () => {
      const provider = new EmbeddingProvider({
        provider: 'unknown' as EmbeddingProviderType,
      });

      await expect(provider.embed('test')).rejects.toThrow('Unknown embedding provider');
    });

    it('should throw for unknown provider in embedBatch', async () => {
      const provider = new EmbeddingProvider({
        provider: 'unknown' as EmbeddingProviderType,
      });

      await expect(provider.embedBatch(['test'])).rejects.toThrow(
        'Unknown embedding provider'
      );
    });

    it('should require API key for OpenAI provider', async () => {
      const provider = new EmbeddingProvider({ provider: 'openai' });

      await expect(provider.embed('test')).rejects.toThrow('API key required');
    });

    it('should require API key for Grok provider without env variable', async () => {
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

  describe('singleton functions', () => {
    it('should return same instance from getEmbeddingProvider', () => {
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
});

// ============================================================================
// InMemoryVectorStore Tests
// ============================================================================

describe('InMemoryVectorStore', () => {
  let store: InMemoryVectorStore;

  beforeEach(() => {
    store = new InMemoryVectorStore();
  });

  afterEach(async () => {
    await store.dispose();
  });

  describe('add', () => {
    it('should add a vector', async () => {
      await store.add('id1', [0.1, 0.2, 0.3], { label: 'test' });

      const count = await store.count();
      expect(count).toBe(1);
    });

    it('should add vector with metadata', async () => {
      await store.add('id1', [0.1, 0.2, 0.3], {
        filePath: '/test/file.ts',
        language: 'typescript',
      });

      expect(store.has('id1')).toBe(true);
    });

    it('should overwrite existing vector with same ID', async () => {
      await store.add('id1', [0.1, 0.2, 0.3]);
      await store.add('id1', [0.4, 0.5, 0.6]);

      const count = await store.count();
      expect(count).toBe(1);

      const entry = store.get('id1');
      expect(entry?.embedding).toEqual([0.4, 0.5, 0.6]);
    });
  });

  describe('addBatch', () => {
    it('should add multiple vectors in batch', async () => {
      const items = [
        { id: 'v1', embedding: [0.1, 0.2, 0.3] },
        { id: 'v2', embedding: [0.4, 0.5, 0.6] },
        { id: 'v3', embedding: [0.7, 0.8, 0.9] },
      ];

      await store.addBatch(items);

      const count = await store.count();
      expect(count).toBe(3);
    });

    it('should add vectors with metadata in batch', async () => {
      const items = [
        { id: 'v1', embedding: [0.1, 0.2], metadata: { type: 'function' } },
        { id: 'v2', embedding: [0.3, 0.4], metadata: { type: 'class' } },
      ];

      await store.addBatch(items);

      expect(store.get('v1')?.metadata).toEqual({ type: 'function' });
      expect(store.get('v2')?.metadata).toEqual({ type: 'class' });
    });
  });

  describe('search', () => {
    beforeEach(async () => {
      // Add some vectors for searching
      await store.addBatch([
        { id: 'v1', embedding: [1, 0, 0], metadata: { language: 'js' } },
        { id: 'v2', embedding: [0, 1, 0], metadata: { language: 'ts' } },
        { id: 'v3', embedding: [0, 0, 1], metadata: { language: 'js' } },
        { id: 'v4', embedding: [0.707, 0.707, 0], metadata: { language: 'ts' } },
      ]);
    });

    it('should find most similar vectors', async () => {
      const results = await store.search([1, 0, 0], 2);

      expect(results).toHaveLength(2);
      expect(results[0].id).toBe('v1');
      expect(results[0].score).toBeCloseTo(1, 5);
    });

    it('should respect k parameter', async () => {
      const results = await store.search([1, 0, 0], 1);
      expect(results).toHaveLength(1);
    });

    it('should filter by metadata', async () => {
      const results = await store.search([1, 0, 0], 10, { language: 'js' });

      expect(results).toHaveLength(2);
      results.forEach((r) => {
        const entry = store.get(r.id);
        expect(entry?.metadata.language).toBe('js');
      });
    });

    it('should return empty array for empty store', async () => {
      const emptyStore = new InMemoryVectorStore();
      const results = await emptyStore.search([1, 0, 0], 10);

      expect(results).toEqual([]);
    });

    it('should sort results by score descending', async () => {
      const results = await store.search([0.6, 0.8, 0], 4);

      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });
  });

  describe('delete', () => {
    it('should delete a vector by ID', async () => {
      await store.add('id1', [0.1, 0.2, 0.3]);
      await store.delete('id1');

      expect(store.has('id1')).toBe(false);
      expect(await store.count()).toBe(0);
    });

    it('should handle deleting non-existent ID', async () => {
      await store.delete('non-existent');
      // Should not throw
      expect(await store.count()).toBe(0);
    });
  });

  describe('deleteByFilter', () => {
    beforeEach(async () => {
      await store.addBatch([
        { id: 'v1', embedding: [0.1], metadata: { language: 'js' } },
        { id: 'v2', embedding: [0.2], metadata: { language: 'ts' } },
        { id: 'v3', embedding: [0.3], metadata: { language: 'js' } },
      ]);
    });

    it('should delete vectors matching filter', async () => {
      const deleted = await store.deleteByFilter({ language: 'js' });

      expect(deleted).toBe(2);
      expect(await store.count()).toBe(1);
    });

    it('should return 0 for non-matching filter', async () => {
      const deleted = await store.deleteByFilter({ language: 'python' });

      expect(deleted).toBe(0);
      expect(await store.count()).toBe(3);
    });
  });

  describe('clear', () => {
    it('should remove all vectors', async () => {
      await store.addBatch([
        { id: 'v1', embedding: [0.1] },
        { id: 'v2', embedding: [0.2] },
      ]);

      await store.clear();

      expect(await store.count()).toBe(0);
    });
  });

  describe('get and has', () => {
    it('should get vector by ID', async () => {
      await store.add('id1', [0.1, 0.2, 0.3], { label: 'test' });

      const entry = store.get('id1');

      expect(entry).toBeDefined();
      expect(entry?.id).toBe('id1');
      expect(entry?.embedding).toEqual([0.1, 0.2, 0.3]);
      expect(entry?.metadata.label).toBe('test');
    });

    it('should return undefined for non-existent ID', () => {
      const entry = store.get('non-existent');
      expect(entry).toBeUndefined();
    });

    it('should check if ID exists', async () => {
      await store.add('id1', [0.1]);

      expect(store.has('id1')).toBe(true);
      expect(store.has('id2')).toBe(false);
    });
  });

  describe('getAllIds', () => {
    it('should return all IDs', async () => {
      await store.addBatch([
        { id: 'a', embedding: [0.1] },
        { id: 'b', embedding: [0.2] },
        { id: 'c', embedding: [0.3] },
      ]);

      const ids = store.getAllIds();

      expect(ids).toHaveLength(3);
      expect(ids).toContain('a');
      expect(ids).toContain('b');
      expect(ids).toContain('c');
    });
  });

  describe('memory usage', () => {
    it('should estimate memory usage', async () => {
      await store.addBatch([
        { id: 'v1', embedding: [0.1, 0.2, 0.3], metadata: { test: true } },
        { id: 'v2', embedding: [0.4, 0.5, 0.6], metadata: { test: false } },
      ]);

      const usage = store.getMemoryUsage();
      expect(usage).toBeGreaterThan(0);
    });
  });
});

// ============================================================================
// PartitionedVectorStore Tests
// ============================================================================

describe('PartitionedVectorStore', () => {
  let store: PartitionedVectorStore;

  beforeEach(() => {
    store = new PartitionedVectorStore('language');
  });

  afterEach(async () => {
    await store.dispose();
  });

  describe('add', () => {
    it('should add vector to correct partition', async () => {
      await store.add('id1', [0.1, 0.2], { language: 'typescript' });
      await store.add('id2', [0.3, 0.4], { language: 'javascript' });

      const partitionNames = store.getPartitionNames();
      expect(partitionNames).toContain('typescript');
      expect(partitionNames).toContain('javascript');
    });

    it('should use default partition for missing key', async () => {
      await store.add('id1', [0.1, 0.2], {});

      const partitionNames = store.getPartitionNames();
      expect(partitionNames).toContain('default');
    });
  });

  describe('addBatch', () => {
    it('should add vectors to appropriate partitions', async () => {
      await store.addBatch([
        { id: 'v1', embedding: [0.1], metadata: { language: 'js' } },
        { id: 'v2', embedding: [0.2], metadata: { language: 'ts' } },
        { id: 'v3', embedding: [0.3], metadata: { language: 'js' } },
      ]);

      const stats = await store.getPartitionStats();
      expect(stats['js']).toBe(2);
      expect(stats['ts']).toBe(1);
    });
  });

  describe('search', () => {
    beforeEach(async () => {
      await store.addBatch([
        { id: 'v1', embedding: [1, 0, 0], metadata: { language: 'js' } },
        { id: 'v2', embedding: [0, 1, 0], metadata: { language: 'ts' } },
        { id: 'v3', embedding: [0, 0, 1], metadata: { language: 'js' } },
      ]);
    });

    it('should search across all partitions', async () => {
      const results = await store.search([1, 0, 0], 10);

      expect(results.length).toBeGreaterThan(0);
    });

    it('should filter search to specific partition', async () => {
      const results = await store.search([1, 0, 0], 10, { language: 'js' });

      expect(results).toHaveLength(2);
    });

    it('should return empty for non-existent partition filter', async () => {
      const results = await store.search([1, 0, 0], 10, { language: 'python' });

      expect(results).toHaveLength(0);
    });
  });

  describe('count', () => {
    it('should count vectors across all partitions', async () => {
      await store.addBatch([
        { id: 'v1', embedding: [0.1], metadata: { language: 'js' } },
        { id: 'v2', embedding: [0.2], metadata: { language: 'ts' } },
        { id: 'v3', embedding: [0.3], metadata: { language: 'py' } },
      ]);

      const count = await store.count();
      expect(count).toBe(3);
    });
  });

  describe('delete', () => {
    it('should delete vector from correct partition', async () => {
      await store.add('id1', [0.1], { language: 'js' });

      await store.delete('id1');

      expect(await store.count()).toBe(0);
    });
  });

  describe('deleteByFilter', () => {
    it('should delete matching vectors across partitions', async () => {
      await store.addBatch([
        { id: 'v1', embedding: [0.1], metadata: { language: 'js', type: 'function' } },
        { id: 'v2', embedding: [0.2], metadata: { language: 'ts', type: 'function' } },
        { id: 'v3', embedding: [0.3], metadata: { language: 'js', type: 'class' } },
      ]);

      const deleted = await store.deleteByFilter({ type: 'function' });

      expect(deleted).toBe(2);
      expect(await store.count()).toBe(1);
    });
  });

  describe('clear', () => {
    it('should clear all partitions', async () => {
      await store.addBatch([
        { id: 'v1', embedding: [0.1], metadata: { language: 'js' } },
        { id: 'v2', embedding: [0.2], metadata: { language: 'ts' } },
      ]);

      await store.clear();

      expect(await store.count()).toBe(0);
      expect(store.getPartitionNames()).toHaveLength(0);
    });
  });

  describe('getPartitionStats', () => {
    it('should return correct statistics per partition', async () => {
      await store.addBatch([
        { id: 'v1', embedding: [0.1], metadata: { language: 'js' } },
        { id: 'v2', embedding: [0.2], metadata: { language: 'js' } },
        { id: 'v3', embedding: [0.3], metadata: { language: 'ts' } },
      ]);

      const stats = await store.getPartitionStats();

      expect(stats).toEqual({
        js: 2,
        ts: 1,
      });
    });
  });
});

// ============================================================================
// createVectorStore Factory Tests
// ============================================================================

describe('createVectorStore', () => {
  it('should create InMemoryVectorStore by default', () => {
    const store = createVectorStore();
    expect(store).toBeInstanceOf(InMemoryVectorStore);
  });

  it('should create InMemoryVectorStore with memory type', () => {
    const store = createVectorStore('memory');
    expect(store).toBeInstanceOf(InMemoryVectorStore);
  });

  it('should create PartitionedVectorStore with partitioned type', () => {
    const store = createVectorStore('partitioned', { partitionKey: 'category' });
    expect(store).toBeInstanceOf(PartitionedVectorStore);
  });
});

// ============================================================================
// HNSWVectorStore Tests
// ============================================================================

describe('HNSWVectorStore', () => {
  let store: HNSWVectorStore;

  beforeEach(() => {
    resetHNSWStore();
    store = new HNSWVectorStore({ dimensions: 4, efConstruction: 10, efSearch: 5 });
  });

  afterEach(() => {
    store.dispose();
    resetHNSWStore();
  });

  describe('constructor', () => {
    it('should create with default config', () => {
      const defaultStore = new HNSWVectorStore();
      expect(defaultStore.getConfig().dimensions).toBe(DEFAULT_HNSW_CONFIG.dimensions);
    });

    it('should accept custom config', () => {
      const config: Partial<HNSWConfig> = {
        dimensions: 512,
        maxConnections: 32,
        efSearch: 100,
      };
      const customStore = new HNSWVectorStore(config);
      const storeConfig = customStore.getConfig();

      expect(storeConfig.dimensions).toBe(512);
      expect(storeConfig.maxConnections).toBe(32);
      expect(storeConfig.efSearch).toBe(100);
    });
  });

  describe('add', () => {
    it('should add a vector', () => {
      store.add({ id: 'v1', vector: [1, 0, 0, 0] });

      expect(store.size()).toBe(1);
      expect(store.has('v1')).toBe(true);
    });

    it('should add vector with metadata', () => {
      store.add({
        id: 'v1',
        vector: [1, 0, 0, 0],
        metadata: { type: 'test' },
      });

      const entry = store.get('v1');
      expect(entry?.metadata).toEqual({ type: 'test' });
    });

    it('should throw for wrong dimensions', () => {
      expect(() => {
        store.add({ id: 'v1', vector: [1, 0, 0] }); // 3 dims instead of 4
      }).toThrow('dimensions mismatch');
    });

    it('should emit add event', () => {
      const events: Array<{ id: string; level: number }> = [];
      store.on('add', (data) => {
        events.push(data);
      });

      // First node doesn't emit (early return in HNSW implementation)
      store.add({ id: 'v1', vector: [1, 0, 0, 0] });
      // Subsequent nodes emit the add event
      store.add({ id: 'v2', vector: [0, 1, 0, 0] });

      // Event is emitted synchronously for second node
      expect(events).toHaveLength(1);
      expect(events[0].id).toBe('v2');
    });
  });

  describe('addBatch', () => {
    it('should add multiple vectors', () => {
      const entries: VectorEntry[] = [
        { id: 'v1', vector: [1, 0, 0, 0] },
        { id: 'v2', vector: [0, 1, 0, 0] },
        { id: 'v3', vector: [0, 0, 1, 0] },
      ];

      store.addBatch(entries);

      expect(store.size()).toBe(3);
    });

    it('should emit progress events for large batches', () => {
      const progressEvents: number[] = [];
      store.on('batch:progress', (data) => {
        progressEvents.push(data.completed);
      });

      const entries = Array.from({ length: 2000 }, (_, i) => ({
        id: `v${i}`,
        vector: [Math.random(), Math.random(), Math.random(), Math.random()],
      }));

      store.addBatch(entries);

      expect(progressEvents.length).toBeGreaterThan(0);
    });
  });

  describe('search', () => {
    beforeEach(() => {
      store.add({ id: 'v1', vector: [1, 0, 0, 0] });
      store.add({ id: 'v2', vector: [0, 1, 0, 0] });
      store.add({ id: 'v3', vector: [0, 0, 1, 0] });
      store.add({ id: 'v4', vector: [0.707, 0.707, 0, 0] });
    });

    it('should find nearest neighbors', () => {
      const results = store.search([1, 0, 0, 0], 2);

      expect(results.length).toBeLessThanOrEqual(2);
      expect(results[0].id).toBe('v1');
    });

    it('should return empty for empty store', () => {
      const emptyStore = new HNSWVectorStore({ dimensions: 4 });
      const results = emptyStore.search([1, 0, 0, 0]);

      expect(results).toEqual([]);
    });

    it('should throw for wrong query dimensions', () => {
      expect(() => {
        store.search([1, 0, 0], 10); // 3 dims instead of 4
      }).toThrow('dimensions mismatch');
    });

    it('should return valid scores', () => {
      const results = store.search([1, 0, 0, 0], 10);

      for (const result of results) {
        // HNSW uses Euclidean distance converted to similarity score (1 - distance)
        // For normalized vectors, score ranges roughly from -1 to 1 depending on distance
        expect(typeof result.score).toBe('number');
        expect(result.score).toBeLessThanOrEqual(1);
      }
    });

    it('should include metadata in results', () => {
      const storeWithMeta = new HNSWVectorStore({ dimensions: 4 });
      storeWithMeta.add({
        id: 'v1',
        vector: [1, 0, 0, 0],
        metadata: { label: 'test' },
      });

      const results = storeWithMeta.search([1, 0, 0, 0], 1);

      expect(results[0].metadata).toEqual({ label: 'test' });
    });
  });

  describe('delete', () => {
    beforeEach(() => {
      store.add({ id: 'v1', vector: [1, 0, 0, 0] });
      store.add({ id: 'v2', vector: [0, 1, 0, 0] });
    });

    it('should delete vector by ID', () => {
      const result = store.delete('v1');

      expect(result).toBe(true);
      expect(store.size()).toBe(1);
      expect(store.has('v1')).toBe(false);
    });

    it('should return false for non-existent ID', () => {
      const result = store.delete('non-existent');
      expect(result).toBe(false);
    });

    it('should update entry point when deleting it', () => {
      // Delete the entry point and verify store still works
      const singleStore = new HNSWVectorStore({ dimensions: 4 });
      singleStore.add({ id: 'v1', vector: [1, 0, 0, 0] });

      singleStore.delete('v1');

      expect(singleStore.size()).toBe(0);
    });

    it('should emit delete event', (done) => {
      store.on('delete', (data) => {
        expect(data.id).toBe('v1');
        done();
      });

      store.delete('v1');
    });
  });

  describe('get and has', () => {
    it('should get vector by ID', () => {
      store.add({ id: 'v1', vector: [1, 0, 0, 0], metadata: { test: true } });

      const entry = store.get('v1');

      expect(entry).toBeDefined();
      expect(entry?.id).toBe('v1');
      expect(entry?.vector).toEqual([1, 0, 0, 0]);
      expect(entry?.metadata).toEqual({ test: true });
    });

    it('should return null for non-existent ID', () => {
      const entry = store.get('non-existent');
      expect(entry).toBeNull();
    });

    it('should check if ID exists', () => {
      store.add({ id: 'v1', vector: [1, 0, 0, 0] });

      expect(store.has('v1')).toBe(true);
      expect(store.has('v2')).toBe(false);
    });
  });

  describe('clear', () => {
    it('should remove all vectors', () => {
      store.add({ id: 'v1', vector: [1, 0, 0, 0] });
      store.add({ id: 'v2', vector: [0, 1, 0, 0] });

      store.clear();

      expect(store.size()).toBe(0);
    });

    it('should emit clear event', (done) => {
      store.on('clear', () => {
        done();
      });

      store.clear();
    });
  });

  describe('getStats', () => {
    it('should return index statistics', () => {
      store.add({ id: 'v1', vector: [1, 0, 0, 0] });
      store.add({ id: 'v2', vector: [0, 1, 0, 0] });

      const stats = store.getStats();

      expect(stats.size).toBe(2);
      expect(stats.dimensions).toBe(4);
      expect(stats.maxLevel).toBeGreaterThanOrEqual(0);
      expect(typeof stats.avgConnections).toBe('number');
    });
  });

  describe('updateConfig', () => {
    it('should update configuration', () => {
      store.updateConfig({ efSearch: 200 });

      const config = store.getConfig();
      expect(config.efSearch).toBe(200);
    });
  });

  describe('formatStatus', () => {
    it('should format status for display', () => {
      store.add({ id: 'v1', vector: [1, 0, 0, 0] });

      const status = store.formatStatus();

      expect(status).toContain('HNSW');
      expect(status).toContain('Vectors');
      expect(status).toContain('Dimensions');
    });
  });

  describe('singleton functions', () => {
    it('should return same instance from getHNSWStore', () => {
      const store1 = getHNSWStore({ dimensions: 128 });
      const store2 = getHNSWStore();

      expect(store1).toBe(store2);
    });

    it('should reset singleton with resetHNSWStore', () => {
      const store1 = getHNSWStore({ dimensions: 128 });
      resetHNSWStore();
      const store2 = getHNSWStore({ dimensions: 256 });

      expect(store1).not.toBe(store2);
    });
  });
});

// ============================================================================
// EmbeddingRepository Tests
// ============================================================================

// Type for mock database
interface MockDatabase {
  prepare: jest.Mock;
  transaction: jest.Mock;
}

describe('EmbeddingRepository', () => {
  let repo: EmbeddingRepository;
  let mockDb: MockDatabase;

  beforeEach(() => {
    resetEmbeddingRepository();

    // Create mock database
    mockDb = {
      prepare: jest.fn(() => ({
        get: jest.fn(),
        all: jest.fn(() => []),
        run: jest.fn(() => ({ changes: 0 })),
      })),
      transaction: jest.fn((fn) => fn),
    };

    // Cast through unknown to satisfy TypeScript
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    repo = new EmbeddingRepository(mockDb as any);
  });

  afterEach(() => {
    resetEmbeddingRepository();
  });

  describe('upsert', () => {
    it('should prepare insert statement', () => {
      const embedding = {
        project_id: 'proj1',
        file_path: '/test/file.ts',
        chunk_index: 0,
        chunk_text: 'test code',
        chunk_hash: 'abc123',
        embedding: new Float32Array([0.1, 0.2, 0.3]),
      };

      mockDb.prepare.mockReturnValue({
        get: jest.fn().mockReturnValue({
          ...embedding,
          id: 1,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          embedding: Buffer.from(embedding.embedding.buffer),
        }),
      });

      repo.upsert(embedding);

      expect(mockDb.prepare).toHaveBeenCalled();
    });
  });

  describe('bulkUpsert', () => {
    it('should use transaction for bulk insert', () => {
      const embeddings = [
        {
          project_id: 'proj1',
          file_path: '/test/file1.ts',
          chunk_index: 0,
          chunk_text: 'code 1',
          chunk_hash: 'hash1',
          embedding: new Float32Array([0.1, 0.2]),
        },
        {
          project_id: 'proj1',
          file_path: '/test/file2.ts',
          chunk_index: 0,
          chunk_text: 'code 2',
          chunk_hash: 'hash2',
          embedding: new Float32Array([0.3, 0.4]),
        },
      ];

      mockDb.prepare.mockReturnValue({
        run: jest.fn(),
      });

      repo.bulkUpsert(embeddings);

      expect(mockDb.transaction).toHaveBeenCalled();
    });
  });

  describe('getById', () => {
    it('should return null for non-existent ID', () => {
      mockDb.prepare.mockReturnValue({
        get: jest.fn().mockReturnValue(undefined),
      });

      const result = repo.getById(999);

      expect(result).toBeNull();
    });
  });

  describe('find', () => {
    it('should query with project filter', () => {
      mockDb.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue([]),
      });

      repo.find({ projectId: 'proj1' });

      expect(mockDb.prepare).toHaveBeenCalled();
    });

    it('should query with language filter', () => {
      mockDb.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue([]),
      });

      repo.find({ language: 'typescript' });

      expect(mockDb.prepare).toHaveBeenCalled();
    });

    it('should query with symbol type filter', () => {
      mockDb.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue([]),
      });

      repo.find({ symbolType: 'function' });

      expect(mockDb.prepare).toHaveBeenCalled();
    });
  });

  describe('searchSimilar', () => {
    it('should calculate cosine similarity for candidates', () => {
      const mockEmbeddings = [
        {
          id: 1,
          project_id: 'proj1',
          file_path: '/test/file.ts',
          chunk_index: 0,
          chunk_text: 'code',
          chunk_hash: 'hash',
          embedding: Buffer.from(new Float32Array([1, 0, 0]).buffer),
        },
      ];

      mockDb.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue(mockEmbeddings),
      });

      const queryEmbedding = new Float32Array([1, 0, 0]);
      const results = repo.searchSimilar(queryEmbedding, {}, 10);

      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe('searchBySymbol', () => {
    it('should search by symbol name', () => {
      mockDb.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue([]),
      });

      repo.searchBySymbol('handleClick');

      expect(mockDb.prepare).toHaveBeenCalled();
    });
  });

  describe('deleteForFile', () => {
    it('should delete embeddings for specific file', () => {
      mockDb.prepare.mockReturnValue({
        run: jest.fn().mockReturnValue({ changes: 5 }),
      });

      const deleted = repo.deleteForFile('proj1', '/test/file.ts');

      expect(deleted).toBe(5);
    });
  });

  describe('deleteForProject', () => {
    it('should delete all embeddings for project', () => {
      mockDb.prepare.mockReturnValue({
        run: jest.fn().mockReturnValue({ changes: 100 }),
      });

      const deleted = repo.deleteForProject('proj1');

      expect(deleted).toBe(100);
    });
  });

  describe('deleteStale', () => {
    it('should delete stale embeddings', () => {
      mockDb.prepare.mockReturnValue({
        run: jest.fn().mockReturnValue({ changes: 10 }),
      });

      const deleted = repo.deleteStale('proj1', ['/test/active.ts']);

      expect(deleted).toBe(10);
    });

    it('should delete all for empty existing files', () => {
      mockDb.prepare.mockReturnValue({
        run: jest.fn().mockReturnValue({ changes: 50 }),
      });

      const deleted = repo.deleteStale('proj1', []);

      expect(deleted).toBe(50);
    });
  });

  describe('needsReindex', () => {
    it('should return true when no existing embedding', () => {
      mockDb.prepare.mockReturnValue({
        get: jest.fn().mockReturnValue(undefined),
      });

      const needs = repo.needsReindex('proj1', '/test/file.ts', 'newhash');

      expect(needs).toBe(true);
    });

    it('should return true when hash differs', () => {
      mockDb.prepare.mockReturnValue({
        get: jest.fn().mockReturnValue({ chunk_hash: 'oldhash' }),
      });

      const needs = repo.needsReindex('proj1', '/test/file.ts', 'newhash');

      expect(needs).toBe(true);
    });

    it('should return false when hash matches', () => {
      mockDb.prepare.mockReturnValue({
        get: jest.fn().mockReturnValue({ chunk_hash: 'samehash' }),
      });

      const needs = repo.needsReindex('proj1', '/test/file.ts', 'samehash');

      expect(needs).toBe(false);
    });
  });

  describe('getStats', () => {
    it('should return statistics', () => {
      // Track call order to return different results
      let callIndex = 0;
      mockDb.prepare.mockImplementation(() => {
        callIndex++;
        // First two calls are for COUNT queries
        if (callIndex <= 2) {
          return { get: jest.fn().mockReturnValue({ count: callIndex === 1 ? 100 : 20 }) };
        }
        // Next two calls are for GROUP BY queries
        if (callIndex === 3) {
          return {
            all: jest.fn().mockReturnValue([
              { language: 'typescript', count: 60 },
              { language: 'javascript', count: 40 },
            ]),
          };
        }
        return {
          all: jest.fn().mockReturnValue([
            { symbol_type: 'function', count: 70 },
            { symbol_type: 'class', count: 30 },
          ]),
        };
      });

      const stats = repo.getStats('proj1');

      expect(stats).toHaveProperty('totalEmbeddings');
      expect(stats).toHaveProperty('totalFiles');
      expect(stats).toHaveProperty('byLanguage');
      expect(stats).toHaveProperty('bySymbolType');
    });
  });

  describe('singleton functions', () => {
    it('should return same instance from getEmbeddingRepository', () => {
      // Reset first
      resetEmbeddingRepository();

      // These will use the mocked getDatabaseManager
      const repo1 = getEmbeddingRepository();
      const repo2 = getEmbeddingRepository();

      expect(repo1).toBe(repo2);
    });
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe('Embedding Integration', () => {
  describe('EmbeddingProvider with VectorStore', () => {
    it('should embed text and store in vector store', async () => {
      const provider = new EmbeddingProvider({ provider: 'mock' });
      await provider.initialize();

      const store = new InMemoryVectorStore();

      const texts = ['function add(a, b) { return a + b; }', 'class Calculator {}'];

      for (let i = 0; i < texts.length; i++) {
        const result = await provider.embed(texts[i]);
        await store.add(`chunk-${i}`, Array.from(result.embedding));
      }

      expect(await store.count()).toBe(2);

      // Search should work
      const queryResult = await provider.embed('add function');
      const searchResults = await store.search(Array.from(queryResult.embedding), 1);

      expect(searchResults.length).toBeGreaterThan(0);
    });
  });

  describe('Batch embedding with HNSW store', () => {
    it('should batch embed and index with HNSW', async () => {
      const provider = new EmbeddingProvider({ provider: 'mock' });
      await provider.initialize();

      const store = new HNSWVectorStore({ dimensions: 384 });

      const texts = [
        'async function fetchData() {}',
        'const API_URL = "https://api.example.com"',
        'interface User { name: string; }',
      ];

      const batchResult = await provider.embedBatch(texts);

      for (let i = 0; i < texts.length; i++) {
        store.add({
          id: `chunk-${i}`,
          vector: Array.from(batchResult.embeddings[i]),
          metadata: { text: texts[i] },
        });
      }

      expect(store.size()).toBe(3);

      // Search
      const queryResult = await provider.embed('fetch API data');
      const results = store.search(Array.from(queryResult.embedding), 2);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0]).toHaveProperty('id');
      expect(results[0]).toHaveProperty('score');
    });
  });

  describe('Similarity calculation consistency', () => {
    it('should produce consistent similarity across provider and store', async () => {
      const provider = new EmbeddingProvider({ provider: 'mock' });
      await provider.initialize();

      const result1 = await provider.embed('hello world');
      const result2 = await provider.embed('hello world');

      // Same text should give similarity of 1
      const similarity = provider.cosineSimilarity(result1.embedding, result2.embedding);
      expect(similarity).toBeCloseTo(1, 5);
    });
  });
});
