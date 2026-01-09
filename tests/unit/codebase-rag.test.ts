/**
 * Tests for CodebaseRAG
 *
 * Comprehensive tests for the Codebase RAG (Retrieval-Augmented Generation) system.
 * Tests indexing, retrieval strategies, and query processing.
 */

import {
  CodebaseRAG,
  createCodebaseRAG,
  getCodebaseRAG,
  resetCodebaseRAG,
} from '../../src/context/codebase-rag/codebase-rag';
import {
  CodeChunk,
  ChunkType,
  DEFAULT_RAG_CONFIG,
} from '../../src/context/codebase-rag/types';

// Mock fs/promises
jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn(),
    writeFile: jest.fn(),
    readdir: jest.fn(),
    mkdir: jest.fn(),
    access: jest.fn(),
  },
}));

// Mock path
jest.mock('path', () => {
  const originalPath = jest.requireActual('path');
  return {
    ...originalPath,
    join: jest.fn((...args: string[]) => args.join('/')),
    relative: jest.fn((from: string, to: string) => to.replace(from + '/', '')),
    dirname: jest.fn((p: string) => p.split('/').slice(0, -1).join('/')),
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

// Mock embeddings
jest.mock('../../src/context/codebase-rag/embeddings', () => ({
  createEmbeddingProvider: jest.fn(() => ({
    embed: jest.fn().mockResolvedValue(new Array(384).fill(0.1)),
    embedBatch: jest.fn().mockResolvedValue([new Array(384).fill(0.1)]),
    getDimension: jest.fn().mockReturnValue(384),
    getModelName: jest.fn().mockReturnValue('mock-model'),
  })),
  cosineSimilarity: jest.fn((a: number[], b: number[]) => {
    // Simple mock cosine similarity
    let dot = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      dot += a[i] * b[i];
    }
    return Math.min(dot / (a.length * 0.01 + 1), 1);
  }),
}));

// Mock vector-store
jest.mock('../../src/context/codebase-rag/vector-store', () => ({
  createVectorStore: jest.fn(() => ({
    add: jest.fn().mockResolvedValue(undefined),
    addBatch: jest.fn().mockResolvedValue(undefined),
    search: jest.fn().mockResolvedValue([
      { id: 'chunk-1', score: 0.9 },
      { id: 'chunk-2', score: 0.8 },
    ]),
    delete: jest.fn().mockResolvedValue(undefined),
    deleteByFilter: jest.fn().mockResolvedValue(0),
    count: jest.fn().mockResolvedValue(0),
    clear: jest.fn().mockResolvedValue(undefined),
  })),
  InMemoryVectorStore: jest.fn().mockImplementation(() => ({
    add: jest.fn().mockResolvedValue(undefined),
    search: jest.fn().mockResolvedValue([]),
    delete: jest.fn().mockResolvedValue(undefined),
    clear: jest.fn().mockResolvedValue(undefined),
    saveToDisk: jest.fn().mockResolvedValue(undefined),
    dispose: jest.fn().mockResolvedValue(undefined),
  })),
}));

// Mock chunker
jest.mock('../../src/context/codebase-rag/chunker', () => ({
  createChunker: jest.fn(() => ({
    chunkFile: jest.fn((content: string, filePath: string) => {
      const mockChunk: CodeChunk = {
        id: `chunk-${Date.now()}`,
        content,
        filePath,
        startLine: 1,
        endLine: content.split('\n').length,
        type: 'function' as ChunkType,
        language: 'typescript',
        metadata: {
          name: 'testFunction',
        },
      };
      return [mockChunk];
    }),
    getConfig: jest.fn().mockReturnValue(DEFAULT_RAG_CONFIG),
    updateConfig: jest.fn(),
  })),
  detectLanguage: jest.fn((filePath: string) => {
    if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) return 'typescript';
    if (filePath.endsWith('.js') || filePath.endsWith('.jsx')) return 'javascript';
    if (filePath.endsWith('.py')) return 'python';
    if (filePath.endsWith('.go')) return 'go';
    return 'text';
  }),
}));

const fsPromises = require('fs').promises;

describe('CodebaseRAG', () => {
  let rag: CodebaseRAG;

  beforeEach(() => {
    jest.clearAllMocks();
    resetCodebaseRAG();
    rag = new CodebaseRAG();
  });

  afterEach(async () => {
    await rag.dispose();
  });

  describe('Constructor', () => {
    it('should create with default config', () => {
      expect(rag).toBeDefined();
    });

    it('should create with custom config', () => {
      const customRag = new CodebaseRAG({
        topK: 5,
        minScore: 0.3,
        strategy: 'semantic',
      });
      expect(customRag).toBeDefined();
      customRag.dispose();
    });

    it('should merge custom config with defaults', () => {
      const customRag = new CodebaseRAG({
        topK: 5,
      });
      const stats = customRag.getStats();
      expect(stats.totalChunks).toBe(0);
      customRag.dispose();
    });
  });

  describe('getStats', () => {
    it('should return initial empty stats', () => {
      const stats = rag.getStats();
      expect(stats.totalChunks).toBe(0);
      expect(stats.totalFiles).toBe(0);
      expect(stats.totalTokens).toBe(0);
      expect(stats.lastUpdated).toBeInstanceOf(Date);
    });

    it('should return a copy of stats', () => {
      const stats1 = rag.getStats();
      const stats2 = rag.getStats();
      expect(stats1).not.toBe(stats2);
      expect(stats1).toEqual(stats2);
    });
  });

  describe('indexFile', () => {
    beforeEach(() => {
      fsPromises.readFile.mockResolvedValue('function test() { return 42; }');
    });

    it('should index a valid file', async () => {
      const result = await rag.indexFile('/test/file.ts');

      expect(result.success).toBe(true);
      expect(result.filePath).toBe('/test/file.ts');
      expect(result.chunks.length).toBeGreaterThan(0);
      expect(result.processingTime).toBeGreaterThanOrEqual(0);
    });

    it('should handle file read errors', async () => {
      fsPromises.readFile.mockRejectedValue(new Error('File not found'));

      const result = await rag.indexFile('/test/nonexistent.ts');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should skip binary files', async () => {
      // Binary content with null bytes
      fsPromises.readFile.mockResolvedValue('binary\0content\0here');

      const result = await rag.indexFile('/test/binary.bin');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Binary file');
    });

    it('should return processing time', async () => {
      const result = await rag.indexFile('/test/file.ts');

      expect(typeof result.processingTime).toBe('number');
      expect(result.processingTime).toBeGreaterThanOrEqual(0);
    });
  });

  describe('indexCodebase', () => {
    beforeEach(() => {
      fsPromises.readdir.mockResolvedValue([
        { name: 'file1.ts', isDirectory: () => false, isFile: () => true },
        { name: 'file2.ts', isDirectory: () => false, isFile: () => true },
      ]);
      fsPromises.readFile.mockResolvedValue('const x = 1;');
    });

    it('should index multiple files', async () => {
      const stats = await rag.indexCodebase('/test/project');

      expect(stats).toBeDefined();
      expect(stats.lastUpdated).toBeInstanceOf(Date);
    });

    it('should emit events during indexing', async () => {
      const startHandler = jest.fn();
      const filesFoundHandler = jest.fn();
      const fileProcessedHandler = jest.fn();
      const completeHandler = jest.fn();

      rag.on('index:start', startHandler);
      rag.on('index:files_found', filesFoundHandler);
      rag.on('index:file_processed', fileProcessedHandler);
      rag.on('index:complete', completeHandler);

      await rag.indexCodebase('/test/project');

      expect(startHandler).toHaveBeenCalled();
      expect(filesFoundHandler).toHaveBeenCalled();
      expect(completeHandler).toHaveBeenCalled();
    });

    it('should call progress callback', async () => {
      const progressFn = jest.fn();

      await rag.indexCodebase('/test/project', {
        onProgress: progressFn,
      });

      expect(progressFn).toHaveBeenCalled();
    });

    it('should throw if already indexing', async () => {
      // Start first indexing
      const indexPromise1 = rag.indexCodebase('/test/project1');

      // Try to start another indexing immediately
      await expect(rag.indexCodebase('/test/project2')).rejects.toThrow(
        'Indexing already in progress'
      );

      // Wait for first to complete
      await indexPromise1;
    });

    it('should handle exclude patterns', async () => {
      await rag.indexCodebase('/test/project', {
        excludePatterns: ['**/node_modules/**', '**/*.test.ts'],
      });

      expect(fsPromises.readdir).toHaveBeenCalled();
    });

    it('should handle include patterns', async () => {
      await rag.indexCodebase('/test/project', {
        includePatterns: ['**/*.ts'],
      });

      expect(fsPromises.readdir).toHaveBeenCalled();
    });
  });

  describe('retrieve', () => {
    beforeEach(async () => {
      // Pre-populate with some chunks
      fsPromises.readFile.mockResolvedValue('function testFunction() { return 42; }');
      await rag.indexFile('/test/file.ts');
    });

    it('should retrieve chunks with default options', async () => {
      const result = await rag.retrieve('test function');

      expect(result).toBeDefined();
      expect(result.query).toBe('test function');
      expect(result.chunks).toBeDefined();
      expect(result.retrievalTime).toBeGreaterThanOrEqual(0);
    });

    it('should respect topK option', async () => {
      const result = await rag.retrieve('test', { topK: 5 });

      expect(result.chunks.length).toBeLessThanOrEqual(5);
    });

    it('should use semantic strategy', async () => {
      const result = await rag.retrieve('test', { strategy: 'semantic' });

      expect(result.strategy).toBe('semantic');
    });

    it('should use keyword strategy', async () => {
      const result = await rag.retrieve('test', { strategy: 'keyword' });

      expect(result.strategy).toBe('keyword');
    });

    it('should use hybrid strategy', async () => {
      const result = await rag.retrieve('test', { strategy: 'hybrid' });

      expect(result.strategy).toBe('hybrid');
    });

    it('should use reranked strategy', async () => {
      const result = await rag.retrieve('test', { strategy: 'reranked' });

      expect(result.strategy).toBe('reranked');
    });

    it('should use corrective strategy', async () => {
      const result = await rag.retrieve('test', { strategy: 'corrective' });

      expect(result.strategy).toBe('corrective');
    });

    it('should apply minimum score filter', async () => {
      const result = await rag.retrieve('test', { minScore: 0.9 });

      for (const chunk of result.chunks) {
        expect(chunk.score).toBeGreaterThanOrEqual(0.9);
      }
    });

    it('should apply query filters', async () => {
      const result = await rag.retrieve('test', {
        filters: {
          languages: ['typescript'],
          chunkTypes: ['function'],
        },
      });

      expect(result).toBeDefined();
    });
  });

  describe('getChunk', () => {
    it('should return undefined for non-existent chunk', () => {
      const chunk = rag.getChunk('non-existent-id');
      expect(chunk).toBeUndefined();
    });

    it('should return chunk after indexing', async () => {
      fsPromises.readFile.mockResolvedValue('function test() {}');
      const result = await rag.indexFile('/test/file.ts');

      if (result.chunks.length > 0) {
        const chunk = rag.getChunk(result.chunks[0].id);
        expect(chunk).toBeDefined();
      }
    });
  });

  describe('getFileChunks', () => {
    it('should return empty array for non-indexed file', () => {
      const chunks = rag.getFileChunks('/non/existent/file.ts');
      expect(chunks).toEqual([]);
    });

    it('should return chunks for indexed file', async () => {
      fsPromises.readFile.mockResolvedValue('function test() {}');
      await rag.indexFile('/test/file.ts');

      const chunks = rag.getFileChunks('/test/file.ts');
      expect(chunks.length).toBeGreaterThan(0);
    });
  });

  describe('clear', () => {
    it('should clear all data', async () => {
      fsPromises.readFile.mockResolvedValue('function test() {}');
      await rag.indexFile('/test/file.ts');

      await rag.clear();

      const stats = rag.getStats();
      expect(stats.totalChunks).toBe(0);
      expect(stats.totalFiles).toBe(0);
    });
  });

  describe('saveIndex', () => {
    it('should not save without indexPath config', async () => {
      await rag.saveIndex();
      expect(fsPromises.writeFile).not.toHaveBeenCalled();
    });

    it('should save with indexPath config', async () => {
      fsPromises.access.mockRejectedValue(new Error('Not found'));
      fsPromises.mkdir.mockResolvedValue(undefined);
      fsPromises.writeFile.mockResolvedValue(undefined);

      const ragWithPath = new CodebaseRAG({ indexPath: '/test/index' });
      fsPromises.readFile.mockResolvedValue('function test() {}');
      await ragWithPath.indexFile('/test/file.ts');
      await ragWithPath.saveIndex();

      expect(fsPromises.writeFile).toHaveBeenCalled();
      await ragWithPath.dispose();
    });
  });

  describe('loadIndex', () => {
    it('should return false without indexPath config', async () => {
      const result = await rag.loadIndex();
      expect(result).toBe(false);
    });

    it('should return false if directory does not exist', async () => {
      fsPromises.access.mockRejectedValue(new Error('Not found'));

      const ragWithPath = new CodebaseRAG({ indexPath: '/test/index' });
      const result = await ragWithPath.loadIndex();

      expect(result).toBe(false);
      await ragWithPath.dispose();
    });

    it('should load existing index', async () => {
      fsPromises.access.mockResolvedValue(undefined);
      fsPromises.readFile.mockImplementation((filePath: string) => {
        if (filePath.includes('chunks.json')) {
          return Promise.resolve(JSON.stringify([
            {
              id: 'chunk-1',
              content: 'test',
              filePath: '/test/file.ts',
              startLine: 1,
              endLine: 1,
              type: 'function',
              language: 'typescript',
              metadata: {},
            },
          ]));
        }
        if (filePath.includes('file-index.json')) {
          return Promise.resolve(JSON.stringify({ '/test/file.ts': ['chunk-1'] }));
        }
        if (filePath.includes('stats.json')) {
          return Promise.resolve(JSON.stringify({
            totalChunks: 1,
            totalFiles: 1,
            totalTokens: 10,
            indexSize: 100,
            lastUpdated: new Date().toISOString(),
            languages: { typescript: 1 },
            chunkTypes: { function: 1 },
          }));
        }
        return Promise.resolve('');
      });

      const ragWithPath = new CodebaseRAG({ indexPath: '/test/index' });
      const result = await ragWithPath.loadIndex();

      expect(result).toBe(true);
      await ragWithPath.dispose();
    });
  });

  describe('dispose', () => {
    it('should clean up resources', async () => {
      fsPromises.readFile.mockResolvedValue('function test() {}');
      await rag.indexFile('/test/file.ts');

      await rag.dispose();

      // After dispose, internal state should be cleared
      const chunks = rag.getFileChunks('/test/file.ts');
      expect(chunks).toEqual([]);
    });
  });

  describe('Singleton Functions', () => {
    beforeEach(() => {
      resetCodebaseRAG();
    });

    it('createCodebaseRAG should create new instance', () => {
      const instance1 = createCodebaseRAG();
      const instance2 = createCodebaseRAG();

      expect(instance1).not.toBe(instance2);

      instance1.dispose();
      instance2.dispose();
    });

    it('getCodebaseRAG should return singleton', () => {
      const instance1 = getCodebaseRAG();
      const instance2 = getCodebaseRAG();

      expect(instance1).toBe(instance2);
    });

    it('getCodebaseRAG should apply config on first call', () => {
      const instance = getCodebaseRAG({ topK: 5 });
      expect(instance).toBeDefined();
    });

    it('resetCodebaseRAG should clear singleton', () => {
      const instance1 = getCodebaseRAG();
      resetCodebaseRAG();
      const instance2 = getCodebaseRAG();

      expect(instance1).not.toBe(instance2);
    });
  });

  describe('Binary Content Detection', () => {
    it('should detect binary content with null bytes', async () => {
      fsPromises.readFile.mockResolvedValue('test\x00content');

      const result = await rag.indexFile('/test/binary.bin');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Binary file');
    });

    it('should accept valid text content', async () => {
      fsPromises.readFile.mockResolvedValue('function test() { return 42; }');

      const result = await rag.indexFile('/test/valid.ts');

      expect(result.success).toBe(true);
    });
  });

  describe('Query Intent Classification', () => {
    beforeEach(async () => {
      fsPromises.readFile.mockResolvedValue('function findUser() { return user; }');
      await rag.indexFile('/test/file.ts');
    });

    it('should handle find queries', async () => {
      const result = await rag.retrieve('find the function');
      expect(result).toBeDefined();
    });

    it('should handle understand queries', async () => {
      const result = await rag.retrieve('how does this work');
      expect(result).toBeDefined();
    });

    it('should handle fix queries', async () => {
      const result = await rag.retrieve('fix the bug in error handling');
      expect(result).toBeDefined();
    });

    it('should handle add feature queries', async () => {
      const result = await rag.retrieve('implement new feature');
      expect(result).toBeDefined();
    });

    it('should handle refactor queries', async () => {
      const result = await rag.retrieve('refactor this code to improve performance');
      expect(result).toBeDefined();
    });

    it('should extract entities from backticks', async () => {
      const result = await rag.retrieve('find the `testFunction` method');
      expect(result).toBeDefined();
    });
  });

  describe('EventEmitter Behavior', () => {
    it('should support event listeners', () => {
      const handler = jest.fn();
      rag.on('index:start', handler);

      expect(rag.listenerCount('index:start')).toBe(1);
    });

    it('should support removing listeners', () => {
      const handler = jest.fn();
      rag.on('index:start', handler);
      rag.off('index:start', handler);

      expect(rag.listenerCount('index:start')).toBe(0);
    });

    it('should clear listeners on dispose', async () => {
      rag.on('index:start', jest.fn());
      rag.on('index:complete', jest.fn());

      await rag.dispose();

      expect(rag.listenerCount('index:start')).toBe(0);
      expect(rag.listenerCount('index:complete')).toBe(0);
    });
  });

  describe('Filter Building', () => {
    beforeEach(async () => {
      fsPromises.readFile.mockResolvedValue('function test() {}');
      await rag.indexFile('/test/file.ts');
    });

    it('should build filter with single language', async () => {
      const result = await rag.retrieve('test', {
        filters: { languages: ['typescript'] },
      });
      expect(result).toBeDefined();
    });

    it('should build filter with single chunk type', async () => {
      const result = await rag.retrieve('test', {
        filters: { chunkTypes: ['function'] },
      });
      expect(result).toBeDefined();
    });

    it('should handle multiple languages', async () => {
      const result = await rag.retrieve('test', {
        filters: { languages: ['typescript', 'javascript'] },
      });
      expect(result).toBeDefined();
    });
  });
});
