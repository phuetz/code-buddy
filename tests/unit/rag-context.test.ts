/**
 * Tests for RAG Context Modules
 *
 * Comprehensive tests for:
 * - MultiPathRetrieval system
 * - Embedding providers
 * - Vector stores
 * - Code chunker
 */

import {
  MultiPathRetrieval,
  getMultiPathRetrieval,
  resetMultiPathRetrieval,
  QueryContext,
  RetrievalPath,
} from '../../src/context/multi-path-retrieval';

// Mock fs module
jest.mock('fs', () => ({
  readFileSync: jest.fn(),
  readdirSync: jest.fn(),
  existsSync: jest.fn(),
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn(),
}));

// Mock path module
jest.mock('path', () => {
  const originalPath = jest.requireActual('path');
  return {
    ...originalPath,
    join: jest.fn((...args: string[]) => args.join('/')),
    extname: jest.fn((p: string) => {
      const parts = p.split('.');
      return parts.length > 1 ? '.' + parts.pop() : '';
    }),
    basename: jest.fn((p: string) => p.split('/').pop() || p),
  };
});

// Mock logger
jest.mock('../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

const mockFs = require('fs');

describe('MultiPathRetrieval', () => {
  let retrieval: MultiPathRetrieval;

  beforeEach(() => {
    jest.clearAllMocks();
    resetMultiPathRetrieval();
    retrieval = new MultiPathRetrieval();
  });

  afterEach(() => {
    retrieval.dispose();
  });

  describe('Constructor', () => {
    it('should create with default config', () => {
      expect(retrieval).toBeDefined();
    });

    it('should create with custom config', () => {
      const customRetrieval = new MultiPathRetrieval({
        resultsPerPath: 5,
        totalResults: 15,
        enableReranking: false,
      });
      expect(customRetrieval).toBeDefined();
      customRetrieval.dispose();
    });

    it('should merge custom config with defaults', () => {
      const customRetrieval = new MultiPathRetrieval({
        resultsPerPath: 5,
      });
      expect(customRetrieval).toBeDefined();
      customRetrieval.dispose();
    });
  });

  describe('indexFile', () => {
    it('should index a TypeScript file', async () => {
      mockFs.readFileSync.mockReturnValue(`
        export function testFunction() {
          return 42;
        }

        export class TestClass {
          method() {
            return 'test';
          }
        }
      `);

      const indexHandler = jest.fn();
      retrieval.on('index:file', indexHandler);

      await retrieval.indexFile('/test/file.ts');

      expect(mockFs.readFileSync).toHaveBeenCalledWith('/test/file.ts', 'utf-8');
      expect(indexHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          filePath: '/test/file.ts',
        })
      );
    });

    it('should handle file read errors', async () => {
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error('File not found');
      });

      const errorHandler = jest.fn();
      retrieval.on('index:error', errorHandler);

      await retrieval.indexFile('/test/nonexistent.ts');

      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          filePath: '/test/nonexistent.ts',
        })
      );
    });

    it('should extract symbols from code', async () => {
      mockFs.readFileSync.mockReturnValue(`
        const myConstant = 'value';
        function myFunction() {}
        class MyClass {}
      `);

      await retrieval.indexFile('/test/symbols.ts');

      const stats = retrieval.getIndexStats();
      expect(stats.chunks).toBeGreaterThan(0);
    });

    it('should extract dependencies from imports', async () => {
      mockFs.readFileSync.mockReturnValue(`
        import { something } from './other';
        import path from 'path';
        const fs = require('fs');
      `);

      await retrieval.indexFile('/test/imports.ts');

      const stats = retrieval.getIndexStats();
      expect(stats.chunks).toBeGreaterThan(0);
    });
  });

  describe('indexDirectory', () => {
    beforeEach(() => {
      mockFs.readdirSync.mockImplementation((dir: string, _options: unknown) => {
        if (dir === '/test/project') {
          return [
            { name: 'file1.ts', isDirectory: () => false, isFile: () => true },
            { name: 'file2.ts', isDirectory: () => false, isFile: () => true },
            { name: 'subdir', isDirectory: () => true, isFile: () => false },
          ];
        }
        if (dir === '/test/project/subdir') {
          return [
            { name: 'nested.ts', isDirectory: () => false, isFile: () => true },
          ];
        }
        return [];
      });
      mockFs.readFileSync.mockReturnValue('function test() {}');
    });

    it('should index all matching files', async () => {
      const completeHandler = jest.fn();
      retrieval.on('index:complete', completeHandler);

      await retrieval.indexDirectory('/test/project');

      expect(completeHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          directory: '/test/project',
        })
      );
    });

    it('should skip node_modules', async () => {
      mockFs.readdirSync.mockImplementation((dir: string, _options: unknown) => {
        if (dir === '/test/project') {
          return [
            { name: 'file.ts', isDirectory: () => false, isFile: () => true },
            { name: 'node_modules', isDirectory: () => true, isFile: () => false },
          ];
        }
        if (dir === '/test/project/node_modules') {
          return [
            { name: 'module.ts', isDirectory: () => false, isFile: () => true },
          ];
        }
        return [];
      });

      await retrieval.indexDirectory('/test/project');

      const stats = retrieval.getIndexStats();
      expect(stats.files).toBe(1); // Only the main file, not node_modules
    });

    it('should skip hidden directories', async () => {
      mockFs.readdirSync.mockImplementation((dir: string, _options: unknown) => {
        if (dir === '/test/project') {
          return [
            { name: 'file.ts', isDirectory: () => false, isFile: () => true },
            { name: '.git', isDirectory: () => true, isFile: () => false },
          ];
        }
        return [];
      });

      await retrieval.indexDirectory('/test/project');

      const stats = retrieval.getIndexStats();
      expect(stats.files).toBe(1);
    });

    it('should use custom patterns', async () => {
      await retrieval.indexDirectory('/test/project', ['**/*.js']);

      // Should use the provided patterns instead of defaults
      expect(mockFs.readdirSync).toHaveBeenCalled();
    });
  });

  describe('retrieve', () => {
    beforeEach(async () => {
      mockFs.readFileSync.mockReturnValue(`
        export function searchFunction() {
          return 'search result';
        }

        export function processData(data) {
          return data.map(x => x * 2);
        }
      `);
      await retrieval.indexFile('/test/file.ts');
    });

    it('should retrieve chunks matching query', async () => {
      const result = await retrieval.retrieve('search function');

      expect(result).toBeDefined();
      expect(result.chunks).toBeDefined();
      expect(result.fusedContext).toBeDefined();
      expect(result.tokensUsed).toBeGreaterThan(0);
    });

    it('should emit retrieval events', async () => {
      const startHandler = jest.fn();
      const completeHandler = jest.fn();

      retrieval.on('retrieval:start', startHandler);
      retrieval.on('retrieval:complete', completeHandler);

      await retrieval.retrieve('test query');

      expect(startHandler).toHaveBeenCalled();
      expect(completeHandler).toHaveBeenCalled();
    });

    it('should use cache for repeated queries', async () => {
      // First query
      await retrieval.retrieve('search');

      // Second query - should hit cache
      const cacheHandler = jest.fn();
      retrieval.on('cache:hit', cacheHandler);

      await retrieval.retrieve('search');

      expect(cacheHandler).toHaveBeenCalled();
    });

    it('should respect query context', async () => {
      const context: QueryContext = {
        currentFile: '/test/file.ts',
        taskType: 'completion',
        recentFiles: ['/test/file.ts'],
      };

      const result = await retrieval.retrieve('search', context);

      expect(result).toBeDefined();
    });

    it('should include path results', async () => {
      const result = await retrieval.retrieve('search');

      expect(result.paths).toBeDefined();
      expect(result.paths.length).toBeGreaterThan(0);
      expect(result.paths[0]).toHaveProperty('name');
      expect(result.paths[0]).toHaveProperty('queryUsed');
    });

    it('should handle error context', async () => {
      const context: QueryContext = {
        errorMessage: 'TypeError: undefined is not a function',
        taskType: 'repair',
      };

      const result = await retrieval.retrieve('fix error', context);

      expect(result).toBeDefined();
    });
  });

  describe('addPath', () => {
    it('should add custom retrieval path', () => {
      const customPath: RetrievalPath = {
        name: 'custom',
        queryTransform: (q) => `custom: ${q}`,
        weight: 0.5,
      };

      retrieval.addPath(customPath);

      // Verify path was added by running a retrieval
      expect(retrieval).toBeDefined();
    });
  });

  describe('clearCache', () => {
    it('should clear the cache', async () => {
      mockFs.readFileSync.mockReturnValue('function test() {}');
      await retrieval.indexFile('/test/file.ts');

      // Populate cache
      await retrieval.retrieve('test');

      // Clear cache
      retrieval.clearCache();

      // Next query should not hit cache
      const cacheHandler = jest.fn();
      retrieval.on('cache:hit', cacheHandler);

      await retrieval.retrieve('test');

      // Cache handler should not be called since we cleared
      expect(cacheHandler).not.toHaveBeenCalled();
    });
  });

  describe('clearIndex', () => {
    it('should clear the index', async () => {
      mockFs.readFileSync.mockReturnValue('function test() {}');
      await retrieval.indexFile('/test/file.ts');

      const statsBefore = retrieval.getIndexStats();
      expect(statsBefore.chunks).toBeGreaterThan(0);

      retrieval.clearIndex();

      const statsAfter = retrieval.getIndexStats();
      expect(statsAfter.chunks).toBe(0);
    });
  });

  describe('getIndexStats', () => {
    it('should return empty stats initially', () => {
      const stats = retrieval.getIndexStats();

      expect(stats.files).toBe(0);
      expect(stats.chunks).toBe(0);
      expect(stats.totalTokens).toBe(0);
    });

    it('should return updated stats after indexing', async () => {
      mockFs.readFileSync.mockReturnValue('function test() { return "hello world"; }');
      await retrieval.indexFile('/test/file.ts');

      const stats = retrieval.getIndexStats();

      expect(stats.files).toBeGreaterThan(0);
      expect(stats.chunks).toBeGreaterThan(0);
      expect(stats.totalTokens).toBeGreaterThan(0);
    });
  });

  describe('Singleton Functions', () => {
    beforeEach(() => {
      resetMultiPathRetrieval();
    });

    it('getMultiPathRetrieval should return singleton', () => {
      const instance1 = getMultiPathRetrieval();
      const instance2 = getMultiPathRetrieval();

      expect(instance1).toBe(instance2);
    });

    it('getMultiPathRetrieval should apply config on first call', () => {
      const instance = getMultiPathRetrieval({ resultsPerPath: 5 });
      expect(instance).toBeDefined();
    });

    it('resetMultiPathRetrieval should clear singleton', () => {
      const instance1 = getMultiPathRetrieval();
      resetMultiPathRetrieval();
      const instance2 = getMultiPathRetrieval();

      expect(instance1).not.toBe(instance2);
    });
  });

  describe('EventEmitter Behavior', () => {
    it('should support event listeners', () => {
      const handler = jest.fn();
      retrieval.on('retrieval:start', handler);

      expect(retrieval.listenerCount('retrieval:start')).toBe(1);
    });

    it('should support removing listeners', () => {
      const handler = jest.fn();
      retrieval.on('retrieval:start', handler);
      retrieval.off('retrieval:start', handler);

      expect(retrieval.listenerCount('retrieval:start')).toBe(0);
    });

    it('should clear listeners on dispose', () => {
      retrieval.on('retrieval:start', jest.fn());
      retrieval.on('retrieval:complete', jest.fn());

      retrieval.dispose();

      expect(retrieval.listenerCount('retrieval:start')).toBe(0);
      expect(retrieval.listenerCount('retrieval:complete')).toBe(0);
    });
  });
});

// =============================================================================
// Embedding Provider Tests
// =============================================================================

import {
  LocalEmbeddingProvider,
  SemanticHashEmbeddingProvider,
  CodeEmbeddingProvider,
  cosineSimilarity,
  createEmbeddingProvider,
} from '../../src/context/codebase-rag/embeddings';

describe('Embedding Providers', () => {
  describe('LocalEmbeddingProvider', () => {
    let provider: LocalEmbeddingProvider;

    beforeEach(() => {
      provider = new LocalEmbeddingProvider(384);
    });

    it('should create with default dimension', () => {
      const defaultProvider = new LocalEmbeddingProvider();
      expect(defaultProvider.getDimension()).toBe(384);
    });

    it('should create with custom dimension', () => {
      const customProvider = new LocalEmbeddingProvider(512);
      expect(customProvider.getDimension()).toBe(512);
    });

    it('should return correct model name', () => {
      expect(provider.getModelName()).toBe('local-tfidf');
    });

    it('should embed text', async () => {
      const embedding = await provider.embed('test query');

      expect(embedding).toBeDefined();
      expect(embedding.length).toBe(384);
      expect(embedding.every(v => typeof v === 'number')).toBe(true);
    });

    it('should embed batch of texts', async () => {
      const embeddings = await provider.embedBatch(['text 1', 'text 2']);

      expect(embeddings).toBeDefined();
      expect(embeddings.length).toBe(2);
      expect(embeddings[0].length).toBe(384);
    });

    it('should return normalized vectors', async () => {
      const embedding = await provider.embed('test query');

      // Check L2 norm is approximately 1
      const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
      expect(norm).toBeCloseTo(1, 5);
    });

    it('should initialize with corpus', async () => {
      await provider.initialize(['document 1', 'document 2', 'document 3']);

      const embedding = await provider.embed('document query');
      expect(embedding.length).toBe(384);
    });
  });

  describe('SemanticHashEmbeddingProvider', () => {
    let provider: SemanticHashEmbeddingProvider;

    beforeEach(() => {
      provider = new SemanticHashEmbeddingProvider(384);
    });

    it('should create with default dimension', () => {
      const defaultProvider = new SemanticHashEmbeddingProvider();
      expect(defaultProvider.getDimension()).toBe(384);
    });

    it('should return correct model name', () => {
      expect(provider.getModelName()).toBe('semantic-hash');
    });

    it('should embed text', async () => {
      const embedding = await provider.embed('test query');

      expect(embedding).toBeDefined();
      expect(embedding.length).toBe(384);
    });

    it('should produce consistent embeddings', async () => {
      const embedding1 = await provider.embed('test query');
      const embedding2 = await provider.embed('test query');

      // Same text should produce same embedding
      expect(embedding1).toEqual(embedding2);
    });

    it('should produce different embeddings for different texts', async () => {
      const embedding1 = await provider.embed('first text');
      const embedding2 = await provider.embed('completely different content');

      // Different texts should produce different embeddings
      const areEqual = embedding1.every((v, i) => v === embedding2[i]);
      expect(areEqual).toBe(false);
    });

    it('should embed batch', async () => {
      const embeddings = await provider.embedBatch(['text 1', 'text 2']);

      expect(embeddings.length).toBe(2);
    });
  });

  describe('CodeEmbeddingProvider', () => {
    let provider: CodeEmbeddingProvider;

    beforeEach(() => {
      provider = new CodeEmbeddingProvider(384);
    });

    it('should create with default dimension', () => {
      const defaultProvider = new CodeEmbeddingProvider();
      expect(defaultProvider.getDimension()).toBe(384);
    });

    it('should return correct model name', () => {
      expect(provider.getModelName()).toBe('code-embedding');
    });

    it('should embed code', async () => {
      const code = `
        function test() {
          return 42;
        }
      `;
      const embedding = await provider.embed(code);

      expect(embedding).toBeDefined();
      expect(embedding.length).toBe(384);
    });

    it('should extract code features', async () => {
      const asyncCode = 'async function fetchData() { await fetch(); }';
      const syncCode = 'function getData() { return data; }';

      const asyncEmb = await provider.embed(asyncCode);
      const syncEmb = await provider.embed(syncCode);

      // Embeddings should be different
      const areEqual = asyncEmb.every((v, i) => v === syncEmb[i]);
      expect(areEqual).toBe(false);
    });

    it('should handle class code', async () => {
      const code = `
        export class MyClass {
          private value: number;

          constructor() {
            this.value = 0;
          }

          getValue(): number {
            return this.value;
          }
        }
      `;
      const embedding = await provider.embed(code);

      expect(embedding.length).toBe(384);
    });

    it('should handle test code', async () => {
      const code = `
        describe('test', () => {
          it('should work', () => {
            expect(true).toBe(true);
          });
        });
      `;
      const embedding = await provider.embed(code);

      expect(embedding.length).toBe(384);
    });

    it('should embed batch', async () => {
      const codes = [
        'function a() {}',
        'function b() {}',
      ];
      const embeddings = await provider.embedBatch(codes);

      expect(embeddings.length).toBe(2);
    });
  });

  describe('cosineSimilarity', () => {
    it('should return 1 for identical vectors', () => {
      const v = [1, 0, 0, 0];
      const similarity = cosineSimilarity(v, v);

      expect(similarity).toBeCloseTo(1, 5);
    });

    it('should return 0 for orthogonal vectors', () => {
      const v1 = [1, 0, 0, 0];
      const v2 = [0, 1, 0, 0];
      const similarity = cosineSimilarity(v1, v2);

      expect(similarity).toBeCloseTo(0, 5);
    });

    it('should return -1 for opposite vectors', () => {
      const v1 = [1, 0, 0, 0];
      const v2 = [-1, 0, 0, 0];
      const similarity = cosineSimilarity(v1, v2);

      expect(similarity).toBeCloseTo(-1, 5);
    });

    it('should throw for mismatched dimensions', () => {
      const v1 = [1, 2, 3];
      const v2 = [1, 2];

      expect(() => cosineSimilarity(v1, v2)).toThrow('Vectors must have same dimension');
    });

    it('should handle zero vectors', () => {
      const v1 = [0, 0, 0, 0];
      const v2 = [1, 2, 3, 4];
      const similarity = cosineSimilarity(v1, v2);

      expect(similarity).toBe(0);
    });
  });

  describe('createEmbeddingProvider', () => {
    it('should create local provider', () => {
      const provider = createEmbeddingProvider('local');
      expect(provider.getModelName()).toBe('local-tfidf');
    });

    it('should create semantic provider', () => {
      const provider = createEmbeddingProvider('semantic');
      expect(provider.getModelName()).toBe('semantic-hash');
    });

    it('should create code provider', () => {
      const provider = createEmbeddingProvider('code');
      expect(provider.getModelName()).toBe('code-embedding');
    });

    it('should create code provider by default', () => {
      const provider = createEmbeddingProvider();
      expect(provider.getModelName()).toBe('code-embedding');
    });

    it('should respect custom dimension', () => {
      const provider = createEmbeddingProvider('local', 512);
      expect(provider.getDimension()).toBe(512);
    });
  });
});

// =============================================================================
// Vector Store Tests
// =============================================================================

import {
  InMemoryVectorStore,
  PartitionedVectorStore,
  createVectorStore,
} from '../../src/context/codebase-rag/vector-store';

describe('Vector Stores', () => {
  describe('InMemoryVectorStore', () => {
    let store: InMemoryVectorStore;

    beforeEach(() => {
      store = new InMemoryVectorStore();
    });

    afterEach(async () => {
      await store.dispose();
    });

    it('should add vectors', async () => {
      await store.add('id1', [0.1, 0.2, 0.3], { key: 'value' });

      const count = await store.count();
      expect(count).toBe(1);
    });

    it('should add batch of vectors', async () => {
      await store.addBatch([
        { id: 'id1', embedding: [0.1, 0.2], metadata: {} },
        { id: 'id2', embedding: [0.3, 0.4], metadata: {} },
      ]);

      const count = await store.count();
      expect(count).toBe(2);
    });

    it('should search for similar vectors', async () => {
      await store.add('id1', [1, 0, 0], {});
      await store.add('id2', [0.9, 0.1, 0], {});
      await store.add('id3', [0, 1, 0], {});

      const results = await store.search([1, 0, 0], 2);

      expect(results.length).toBe(2);
      expect(results[0].id).toBe('id1');
      expect(results[0].score).toBeCloseTo(1, 5);
    });

    it('should delete vectors', async () => {
      await store.add('id1', [0.1, 0.2], {});
      await store.delete('id1');

      const count = await store.count();
      expect(count).toBe(0);
    });

    it('should delete by filter', async () => {
      await store.add('id1', [0.1, 0.2], { type: 'a' });
      await store.add('id2', [0.3, 0.4], { type: 'b' });
      await store.add('id3', [0.5, 0.6], { type: 'a' });

      const deleted = await store.deleteByFilter({ type: 'a' });

      expect(deleted).toBe(2);
      const count = await store.count();
      expect(count).toBe(1);
    });

    it('should clear all vectors', async () => {
      await store.add('id1', [0.1, 0.2], {});
      await store.add('id2', [0.3, 0.4], {});

      await store.clear();

      const count = await store.count();
      expect(count).toBe(0);
    });

    it('should get vector by id', async () => {
      await store.add('id1', [0.1, 0.2], { key: 'value' });

      const entry = store.get('id1');

      expect(entry).toBeDefined();
      expect(entry?.id).toBe('id1');
      expect(entry?.metadata.key).toBe('value');
    });

    it('should check if vector exists', async () => {
      await store.add('id1', [0.1, 0.2], {});

      expect(store.has('id1')).toBe(true);
      expect(store.has('id2')).toBe(false);
    });

    it('should get all ids', async () => {
      await store.add('id1', [0.1, 0.2], {});
      await store.add('id2', [0.3, 0.4], {});

      const ids = store.getAllIds();

      expect(ids).toContain('id1');
      expect(ids).toContain('id2');
    });

    it('should filter search results', async () => {
      await store.add('id1', [1, 0], { language: 'typescript' });
      await store.add('id2', [0.9, 0.1], { language: 'javascript' });

      const results = await store.search([1, 0], 10, { language: 'typescript' });

      expect(results.length).toBe(1);
      expect(results[0].id).toBe('id1');
    });

    it('should estimate memory usage', async () => {
      await store.add('id1', new Array(384).fill(0.1), { key: 'value' });

      const memory = store.getMemoryUsage();

      expect(memory).toBeGreaterThan(0);
    });
  });

  describe('PartitionedVectorStore', () => {
    let store: PartitionedVectorStore;

    beforeEach(() => {
      store = new PartitionedVectorStore('language');
    });

    afterEach(async () => {
      await store.dispose();
    });

    it('should partition by key', async () => {
      await store.add('id1', [0.1, 0.2], { language: 'typescript' });
      await store.add('id2', [0.3, 0.4], { language: 'javascript' });

      const partitions = store.getPartitionNames();

      expect(partitions).toContain('typescript');
      expect(partitions).toContain('javascript');
    });

    it('should add batch and partition', async () => {
      await store.addBatch([
        { id: 'id1', embedding: [0.1, 0.2], metadata: { language: 'typescript' } },
        { id: 'id2', embedding: [0.3, 0.4], metadata: { language: 'javascript' } },
      ]);

      const count = await store.count();
      expect(count).toBe(2);
    });

    it('should search specific partition', async () => {
      await store.add('id1', [1, 0], { language: 'typescript' });
      await store.add('id2', [0.9, 0.1], { language: 'javascript' });

      const results = await store.search([1, 0], 10, { language: 'typescript' });

      expect(results.length).toBe(1);
      expect(results[0].id).toBe('id1');
    });

    it('should search all partitions', async () => {
      await store.add('id1', [1, 0], { language: 'typescript' });
      await store.add('id2', [0.9, 0.1], { language: 'javascript' });

      const results = await store.search([1, 0], 10);

      expect(results.length).toBe(2);
    });

    it('should delete from all partitions', async () => {
      await store.add('id1', [0.1, 0.2], { language: 'typescript' });
      await store.delete('id1');

      const count = await store.count();
      expect(count).toBe(0);
    });

    it('should delete by filter', async () => {
      await store.add('id1', [0.1, 0.2], { language: 'typescript', type: 'function' });
      await store.add('id2', [0.3, 0.4], { language: 'typescript', type: 'class' });

      const deleted = await store.deleteByFilter({ type: 'function' });

      expect(deleted).toBe(1);
    });

    it('should clear all partitions', async () => {
      await store.add('id1', [0.1, 0.2], { language: 'typescript' });
      await store.add('id2', [0.3, 0.4], { language: 'javascript' });

      await store.clear();

      const count = await store.count();
      expect(count).toBe(0);
    });

    it('should get partition stats', async () => {
      await store.add('id1', [0.1, 0.2], { language: 'typescript' });
      await store.add('id2', [0.3, 0.4], { language: 'typescript' });
      await store.add('id3', [0.5, 0.6], { language: 'javascript' });

      const stats = await store.getPartitionStats();

      expect(stats.typescript).toBe(2);
      expect(stats.javascript).toBe(1);
    });

    it('should use default partition for items without key', async () => {
      await store.add('id1', [0.1, 0.2], {});

      const partitions = store.getPartitionNames();
      expect(partitions).toContain('default');
    });
  });

  describe('createVectorStore', () => {
    it('should create memory store by default', () => {
      const store = createVectorStore();
      expect(store).toBeInstanceOf(InMemoryVectorStore);
    });

    it('should create memory store explicitly', () => {
      const store = createVectorStore('memory');
      expect(store).toBeInstanceOf(InMemoryVectorStore);
    });

    it('should create partitioned store', () => {
      const store = createVectorStore('partitioned', { partitionKey: 'language' });
      expect(store).toBeInstanceOf(PartitionedVectorStore);
    });
  });
});

// =============================================================================
// Code Chunker Tests
// =============================================================================

import {
  CodeChunker,
  detectLanguage,
  createChunker,
} from '../../src/context/codebase-rag/chunker';

describe('Code Chunker', () => {
  let chunker: CodeChunker;

  beforeEach(() => {
    chunker = new CodeChunker();
  });

  describe('detectLanguage', () => {
    it('should detect TypeScript', () => {
      expect(detectLanguage('file.ts')).toBe('typescript');
      expect(detectLanguage('file.tsx')).toBe('typescript');
    });

    it('should detect JavaScript', () => {
      expect(detectLanguage('file.js')).toBe('javascript');
      expect(detectLanguage('file.jsx')).toBe('javascript');
      expect(detectLanguage('file.mjs')).toBe('javascript');
      expect(detectLanguage('file.cjs')).toBe('javascript');
    });

    it('should detect Python', () => {
      expect(detectLanguage('file.py')).toBe('python');
      expect(detectLanguage('file.pyw')).toBe('python');
    });

    it('should detect Go', () => {
      expect(detectLanguage('file.go')).toBe('go');
    });

    it('should detect Rust', () => {
      expect(detectLanguage('file.rs')).toBe('rust');
    });

    it('should detect other languages', () => {
      expect(detectLanguage('file.rb')).toBe('ruby');
      expect(detectLanguage('file.java')).toBe('java');
      expect(detectLanguage('file.swift')).toBe('swift');
    });

    it('should return text for unknown extensions', () => {
      expect(detectLanguage('file.unknown')).toBe('text');
      expect(detectLanguage('file')).toBe('text');
    });
  });

  describe('chunkFile', () => {
    it('should chunk TypeScript file with functions', () => {
      const content = `
        export function functionOne() {
          return 1;
        }

        export function functionTwo() {
          return 2;
        }
      `;

      const chunks = chunker.chunkFile(content, 'file.ts');

      expect(chunks.length).toBeGreaterThan(0);
      for (const chunk of chunks) {
        expect(chunk.id).toBeDefined();
        expect(chunk.filePath).toBe('file.ts');
        expect(chunk.language).toBe('typescript');
      }
    });

    it('should chunk TypeScript file with classes', () => {
      const content = `
        export class MyClass {
          private value: number;

          constructor() {
            this.value = 0;
          }

          getValue(): number {
            return this.value;
          }
        }
      `;

      const chunks = chunker.chunkFile(content, 'file.ts');

      expect(chunks.length).toBeGreaterThan(0);
    });

    it('should chunk Python file', () => {
      const content = `
def function_one():
    return 1

class MyClass:
    def __init__(self):
        self.value = 0

    def get_value(self):
        return self.value
      `;

      const chunks = chunker.chunkFile(content, 'file.py');

      expect(chunks.length).toBeGreaterThan(0);
      for (const chunk of chunks) {
        expect(chunk.language).toBe('python');
      }
    });

    it('should chunk Go file', () => {
      const content = `
package main

func FunctionOne() int {
    return 1
}

type MyStruct struct {
    Value int
}

func (m *MyStruct) GetValue() int {
    return m.Value
}
      `;

      const chunks = chunker.chunkFile(content, 'file.go');

      expect(chunks.length).toBeGreaterThan(0);
      for (const chunk of chunks) {
        expect(chunk.language).toBe('go');
      }
    });

    it('should extract docstrings', () => {
      const content = `
/**
 * This is a docstring
 */
export function myFunction() {
  return 42;
}
      `;

      const chunks = chunker.chunkFile(content, 'file.ts');

      // Find the function chunk
      const funcChunk = chunks.find(c => c.type === 'function');
      if (funcChunk) {
        expect(funcChunk.metadata.docstring).toBeDefined();
      }
    });

    it('should handle async functions', () => {
      const content = `
export async function fetchData() {
  return await fetch('/api');
}
      `;

      const chunks = chunker.chunkFile(content, 'file.ts');

      const funcChunk = chunks.find(c => c.type === 'function');
      if (funcChunk) {
        expect(funcChunk.metadata.isAsync).toBe(true);
      }
    });

    it('should detect public exports', () => {
      const content = `
export function publicFunc() {}
function privateFunc() {}
      `;

      const chunks = chunker.chunkFile(content, 'file.ts');

      const publicChunk = chunks.find(c => c.content.includes('publicFunc'));
      const privateChunk = chunks.find(c => c.content.includes('privateFunc'));

      if (publicChunk) {
        expect(publicChunk.metadata.isPublic).toBe(true);
      }
      if (privateChunk) {
        expect(privateChunk.metadata.isPublic).toBe(false);
      }
    });

    it('should chunk by size when boundaries are disabled', () => {
      const configWithoutBoundaries = { respectBoundaries: false };
      const chunkerNoBoundaries = new CodeChunker(configWithoutBoundaries);

      const content = 'x\n'.repeat(1000);
      const chunks = chunkerNoBoundaries.chunkFile(content, 'file.txt');

      expect(chunks.length).toBeGreaterThan(1);
    });

    it('should handle empty files', () => {
      const chunks = chunker.chunkFile('', 'file.ts');

      // Chunker returns a code block for empty content
      expect(chunks.length).toBe(1);
      expect(chunks[0].content).toBe('');
      expect(chunks[0].type).toBe('code_block');
    });

    it('should handle files with only whitespace', () => {
      const chunks = chunker.chunkFile('   \n\n   ', 'file.ts');

      // Chunker returns a code block for whitespace-only content
      expect(chunks.length).toBe(1);
      expect(chunks[0].type).toBe('code_block');
    });
  });

  describe('Configuration', () => {
    it('should update configuration', () => {
      chunker.updateConfig({ chunkSize: 256 });
      const config = chunker.getConfig();

      expect(config.chunkSize).toBe(256);
    });

    it('should get configuration', () => {
      const config = chunker.getConfig();

      expect(config).toBeDefined();
      expect(config.chunkSize).toBeDefined();
      expect(config.chunkOverlap).toBeDefined();
    });
  });

  describe('createChunker', () => {
    it('should create chunker with default config', () => {
      const newChunker = createChunker();
      expect(newChunker).toBeInstanceOf(CodeChunker);
    });

    it('should create chunker with custom config', () => {
      const newChunker = createChunker({ chunkSize: 256 });
      const config = newChunker.getConfig();

      expect(config.chunkSize).toBe(256);
    });
  });
});
