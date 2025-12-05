/**
 * Tests for Dependency-Aware RAG
 */

import {
  DependencyAwareRAG,
  getDependencyAwareRAG,
  resetDependencyAwareRAG,
} from '../src/context/dependency-aware-rag';

// Mock the dependency analyzer
jest.mock('../src/tools/intelligence/dependency-analyzer', () => ({
  getDependencyAnalyzer: jest.fn().mockReturnValue({
    analyze: jest.fn().mockResolvedValue({
      graph: {
        nodes: new Map([
          ['src/index.ts', {
            filePath: 'src/index.ts',
            imports: ['./utils', './config'],
            exports: ['main', 'init'],
            dependencies: ['src/utils.ts', 'src/config.ts'],
            dependents: [],
            depth: 0,
            isEntryPoint: true,
          }],
          ['src/utils.ts', {
            filePath: 'src/utils.ts',
            imports: [],
            exports: ['helper', 'format'],
            dependencies: [],
            dependents: ['src/index.ts'],
            depth: 1,
            isEntryPoint: false,
          }],
          ['src/config.ts', {
            filePath: 'src/config.ts',
            imports: [],
            exports: ['config', 'settings'],
            dependencies: [],
            dependents: ['src/index.ts'],
            depth: 1,
            isEntryPoint: false,
          }],
        ]),
        edges: [],
        circularDependencies: [],
        unreachableFiles: [],
        entryPoints: ['src/index.ts'],
        stats: {
          totalFiles: 3,
          totalDependencies: 2,
          averageDependencies: 0.67,
          maxDepth: 1,
          circularCount: 0,
          externalDependencies: 0,
        },
      },
      circularDependencies: [],
      unreachableFiles: [],
      externalDependencies: new Map(),
      stats: {
        totalFiles: 3,
        totalDependencies: 2,
        averageDependencies: 0.67,
        maxDepth: 1,
        circularCount: 0,
        externalDependencies: 0,
      },
      analysisTime: 100,
    }),
    getDependencyChain: jest.fn().mockReturnValue(['src/index.ts', 'src/utils.ts']),
  }),
  DependencyAnalyzer: jest.fn(),
}));

// Mock the codebase RAG
jest.mock('../src/context/codebase-rag/codebase-rag', () => ({
  getCodebaseRAG: jest.fn().mockReturnValue({
    retrieve: jest.fn().mockResolvedValue({
      chunks: [
        {
          chunk: {
            id: 'chunk-1',
            content: 'function main() { return init(); }',
            filePath: 'src/index.ts',
            startLine: 1,
            endLine: 3,
            type: 'function',
            language: 'typescript',
            metadata: { name: 'main' },
          },
          score: 0.9,
          matchType: 'hybrid',
        },
      ],
      query: 'test query',
      totalChunks: 10,
      retrievalTime: 50,
      strategy: 'hybrid',
    }),
    getFileChunks: jest.fn().mockReturnValue([
      {
        id: 'chunk-1',
        content: 'export function helper() {}',
        filePath: 'src/utils.ts',
        startLine: 1,
        endLine: 1,
        type: 'function',
        language: 'typescript',
        metadata: { name: 'helper' },
      },
    ]),
  }),
  CodebaseRAG: jest.fn(),
}));

describe('DependencyAwareRAG', () => {
  let rag: DependencyAwareRAG;

  beforeEach(() => {
    resetDependencyAwareRAG();
    rag = new DependencyAwareRAG();
    jest.clearAllMocks();
  });

  describe('Constructor', () => {
    it('should create with default config', () => {
      expect(rag).toBeDefined();
    });

    it('should accept custom config', () => {
      const customRAG = new DependencyAwareRAG({
        dependencyDepth: 3,
        maxDependencyFiles: 20,
      });

      expect(customRAG).toBeDefined();
    });
  });

  describe('initialize', () => {
    it('should initialize dependency analysis', async () => {
      await rag.initialize('/test/path');

      const stats = rag.getStats();
      expect(stats.isInitialized).toBe(true);
      expect(stats.graphStats).toBeDefined();
    });

    it('should emit init events', async () => {
      const startPromise = new Promise<void>((resolve) => {
        rag.on('init:start', () => resolve());
      });

      rag.initialize('/test/path');

      await expect(startPromise).resolves.toBeUndefined();
    });

    it('should use cache on repeated initialization', async () => {
      await rag.initialize('/test/path');
      await rag.initialize('/test/path');

      // Should have used cache
      const stats = rag.getStats();
      expect(stats.cacheSize).toBeGreaterThanOrEqual(1);
    });
  });

  describe('retrieve', () => {
    it('should retrieve with dependency awareness', async () => {
      const result = await rag.retrieve('main function', '/test/path', {
        includeDependencies: true,
        includeDependents: true,
      });

      expect(result.chunks.length).toBeGreaterThan(0);
      expect(result.graphStats).toBeDefined();
      expect(result.graphStats.filesAnalyzed).toBe(3);
    });

    it('should include dependencies in result', async () => {
      const result = await rag.retrieve('main function', '/test/path', {
        includeDependencies: true,
      });

      expect(result.dependencies).toBeDefined();
      expect(Array.isArray(result.dependencies)).toBe(true);
    });

    it('should include dependents in result', async () => {
      const result = await rag.retrieve('helper function', '/test/path', {
        includeDependents: true,
      });

      expect(result.dependents).toBeDefined();
      expect(Array.isArray(result.dependents)).toBe(true);
    });

    it('should work without dependency analysis', async () => {
      const result = await rag.retrieve('query', '/test/path', {
        includeDependencies: false,
        includeDependents: false,
      });

      expect(result.chunks.length).toBeGreaterThan(0);
      expect(result.dependencies).toHaveLength(0);
      expect(result.dependents).toHaveLength(0);
    });

    it('should filter by options', async () => {
      const result = await rag.retrieve('query', '/test/path', {
        topK: 5,
        minScore: 0.5,
        filters: {
          languages: ['typescript'],
        },
      });

      expect(result.chunks.length).toBeLessThanOrEqual(5);
    });
  });

  describe('getExpandedContext', () => {
    it('should get expanded context for a file', async () => {
      await rag.initialize('/test/path');

      const context = await rag.getExpandedContext('src/index.ts', '/test/path', {
        includeImports: true,
        includeExports: true,
      });

      expect(context.file).toBeDefined();
      expect(context.imports).toBeDefined();
      expect(context.exports).toBeDefined();
      expect(context.totalTokens).toBeGreaterThan(0);
    });

    it('should respect max tokens', async () => {
      await rag.initialize('/test/path');

      const context = await rag.getExpandedContext('src/index.ts', '/test/path', {
        maxTokens: 100,
      });

      // Token estimation is approximate, allow some margin
      expect(context.totalTokens).toBeLessThanOrEqual(150);
    });
  });

  describe('getDependencyPath', () => {
    it('should return dependency path between files', async () => {
      await rag.initialize('/test/path');

      const path = rag.getDependencyPath('src/index.ts', 'src/utils.ts');

      expect(path).toBeDefined();
      expect(Array.isArray(path)).toBe(true);
    });

    it('should return null when not initialized', () => {
      const path = rag.getDependencyPath('a.ts', 'b.ts');
      expect(path).toBeNull();
    });
  });

  describe('getImpactedFiles', () => {
    it('should return files impacted by changes', async () => {
      await rag.initialize('/test/path');

      const impacted = rag.getImpactedFiles('src/utils.ts');

      expect(Array.isArray(impacted)).toBe(true);
    });

    it('should return empty array when not initialized', () => {
      const impacted = rag.getImpactedFiles('file.ts');
      expect(impacted).toHaveLength(0);
    });
  });

  describe('formatResult', () => {
    it('should format result for display', async () => {
      const result = await rag.retrieve('test', '/test/path');
      const formatted = rag.formatResult(result);

      expect(formatted).toContain('DEPENDENCY-AWARE RAG RESULTS');
      expect(formatted).toContain('Query:');
      expect(formatted).toContain('Code Chunks');
    });

    it('should show dependencies section when present', async () => {
      const result = await rag.retrieve('test', '/test/path', {
        includeDependencies: true,
      });

      // Add mock dependencies
      result.dependencies = [
        {
          filePath: 'src/utils.ts',
          relativePath: 'utils.ts',
          imports: [],
          exports: ['helper'],
          relevanceScore: 0.8,
          keyChunks: [],
          relationship: 'imports',
        },
      ];

      const formatted = rag.formatResult(result);
      expect(formatted).toContain('Dependencies');
    });
  });

  describe('clearCache', () => {
    it('should clear the analysis cache', async () => {
      await rag.initialize('/test/path');

      expect(rag.getStats().isInitialized).toBe(true);

      rag.clearCache();

      expect(rag.getStats().isInitialized).toBe(false);
      expect(rag.getStats().cacheSize).toBe(0);
    });
  });

  describe('getStats', () => {
    it('should return current statistics', () => {
      const stats = rag.getStats();

      expect(stats).toHaveProperty('isInitialized');
      expect(stats).toHaveProperty('cacheSize');
      expect(stats).toHaveProperty('graphStats');
    });

    it('should reflect initialization state', async () => {
      expect(rag.getStats().isInitialized).toBe(false);

      await rag.initialize('/test/path');

      expect(rag.getStats().isInitialized).toBe(true);
    });
  });

  describe('singleton', () => {
    it('should return same instance', () => {
      const instance1 = getDependencyAwareRAG();
      const instance2 = getDependencyAwareRAG();
      expect(instance1).toBe(instance2);
    });

    it('should reset correctly', () => {
      const instance1 = getDependencyAwareRAG();
      resetDependencyAwareRAG();
      const instance2 = getDependencyAwareRAG();
      expect(instance1).not.toBe(instance2);
    });
  });

  describe('dependency context scoring', () => {
    it('should score dependencies by query relevance', async () => {
      // Set a specific query context
      const result = await rag.retrieve('helper format function', '/test/path', {
        includeDependencies: true,
      });

      // Dependencies should have relevance scores
      for (const dep of result.dependencies) {
        expect(dep.relevanceScore).toBeGreaterThanOrEqual(0);
        expect(dep.relevanceScore).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('error handling', () => {
    it('should handle initialization errors gracefully', async () => {
      // Mock error in analyzer
      const { getDependencyAnalyzer } = require('../src/tools/intelligence/dependency-analyzer');
      getDependencyAnalyzer.mockReturnValueOnce({
        analyze: jest.fn().mockRejectedValue(new Error('Analysis failed')),
      });

      const errorRAG = new DependencyAwareRAG();

      // Should not throw, just continue without analysis
      await expect(errorRAG.initialize('/test/path')).resolves.not.toThrow();
    });
  });
});
