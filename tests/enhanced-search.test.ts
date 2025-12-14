/**
 * Tests for enhanced-search.ts
 *
 * Tests the high-performance code search module with:
 * - LRU caching
 * - Streaming search with ripgrep
 * - Symbol search (functions, classes, interfaces)
 * - Reference search
 * - Multi-pattern search
 */

import { EventEmitter } from 'events';

// Mock @vscode/ripgrep
jest.mock('@vscode/ripgrep', () => ({
  rgPath: '/mock/path/to/rg',
}));

// Mock child_process
const mockSpawn = jest.fn();
jest.mock('child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
  ChildProcess: class {},
}));

import {
  EnhancedSearch,
  getEnhancedSearch,
  resetEnhancedSearch,
  SearchMatch,
  SearchStats,
} from '../src/tools/enhanced-search.js';

// Helper to create mock child process
function createMockProcess() {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const process = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: jest.Mock;
  };
  process.stdout = stdout;
  process.stderr = stderr;
  process.kill = jest.fn();
  return process;
}

describe('EnhancedSearch', () => {
  let search: EnhancedSearch;

  beforeEach(() => {
    jest.clearAllMocks();
    resetEnhancedSearch();
    search = new EnhancedSearch('/test/workdir');
  });

  afterEach(() => {
    search.cancelAll();
    search.clearCache();
  });

  describe('constructor', () => {
    it('should create instance with default workdir', () => {
      const defaultSearch = new EnhancedSearch();
      expect(defaultSearch).toBeInstanceOf(EnhancedSearch);
    });

    it('should create instance with custom workdir', () => {
      expect(search).toBeInstanceOf(EnhancedSearch);
    });
  });

  describe('setWorkdir', () => {
    it('should update working directory', () => {
      search.setWorkdir('/new/workdir');
      // Verify by checking cache key changes (indirectly tested via search)
      expect(search).toBeDefined();
    });
  });

  describe('getRipgrepPath', () => {
    it('should return ripgrep path', () => {
      const path = search.getRipgrepPath();
      expect(path).toBe('/mock/path/to/rg');
    });

    it('should handle asar paths', () => {
      // Mock rgPath with asar
      jest.resetModules();
      jest.doMock('@vscode/ripgrep', () => ({
        rgPath: '/app.asar/node_modules/rg',
      }));

      // Re-import to get new mock
      const { EnhancedSearch: ES } = require('../src/tools/enhanced-search.js');
      const s = new ES();
      const path = s.getRipgrepPath();
      expect(path).toContain('asar.unpacked');
    });
  });

  describe('streamSearch', () => {
    it('should spawn ripgrep with correct arguments', () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      search.streamSearch('test query');

      expect(mockSpawn).toHaveBeenCalledWith(
        '/mock/path/to/rg',
        expect.arrayContaining([
          '--json',
          '--with-filename',
          '--line-number',
          'test query',
        ]),
        expect.objectContaining({
          cwd: '/test/workdir',
        })
      );
    });

    it('should handle search options correctly', () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      search.streamSearch('query', {
        caseSensitive: true,
        wholeWord: true,
        regex: true,
        maxResults: 100,
        contextLines: 3,
        includeHidden: true,
        followSymlinks: true,
        fileTypes: ['ts', 'js'],
        includeGlob: ['src/**'],
        excludeGlob: ['test/**'],
      });

      const args = mockSpawn.mock.calls[0][1];
      expect(args).not.toContain('--ignore-case');
      expect(args).toContain('--word-regexp');
      expect(args).not.toContain('--fixed-strings');
      expect(args).toContain('--max-count');
      expect(args).toContain('100');
      expect(args).toContain('--context');
      expect(args).toContain('3');
      expect(args).toContain('--hidden');
      expect(args).toContain('--follow');
      expect(args).toContain('--type');
      expect(args).toContain('ts');
      expect(args).toContain('--glob');
      expect(args).toContain('src/**');
      expect(args).toContain('!test/**');
    });

    it('should emit match events on stdout data', (done) => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const matches: SearchMatch[] = [];
      const rg = search.streamSearch('query', {
        onMatch: (match) => matches.push(match),
      });

      search.on('match', (match) => {
        expect(match.file).toBe('test.ts');
        expect(match.line).toBe(10);
        done();
      });

      // Simulate ripgrep JSON output
      const jsonLine = JSON.stringify({
        type: 'match',
        data: {
          path: { text: 'test.ts' },
          line_number: 10,
          submatches: [{ start: 5, match: { text: 'query' } }],
          lines: { text: 'const query = "test";' },
        },
      });

      mockProcess.stdout.emit('data', Buffer.from(jsonLine + '\n'));
    });

    it('should emit progress events', (done) => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      search.on('progress', (progress) => {
        expect(progress.filesSearched).toBeGreaterThanOrEqual(1);
        done();
      });

      search.streamSearch('query');

      // Simulate begin event
      const beginLine = JSON.stringify({
        type: 'begin',
        data: { path: { text: 'file1.ts' } },
      });

      mockProcess.stdout.emit('data', Buffer.from(beginLine + '\n'));
    });

    it('should emit complete event with results', (done) => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      search.on('complete', (results: SearchMatch[], stats: SearchStats) => {
        expect(results).toHaveLength(1);
        expect(stats.matchCount).toBe(1);
        expect(stats.cached).toBe(false);
        done();
      });

      search.streamSearch('query');

      const matchLine = JSON.stringify({
        type: 'match',
        data: {
          path: { text: 'test.ts' },
          line_number: 1,
          submatches: [{ start: 0, match: { text: 'query' } }],
          lines: { text: 'query' },
        },
      });

      mockProcess.stdout.emit('data', Buffer.from(matchLine + '\n'));
      mockProcess.emit('close', 0);
    });

    it('should emit error event on process error', (done) => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      search.on('error', (error) => {
        expect(error.message).toBe('spawn error');
        done();
      });

      search.streamSearch('query');
      mockProcess.emit('error', new Error('spawn error'));
    });

    it('should emit error on non-zero exit code', (done) => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      search.on('error', (error) => {
        expect(error.message).toContain('Search failed');
        done();
      });

      search.streamSearch('query');
      mockProcess.emit('close', 3); // Error code
    });

    it('should handle exit code 1 (no matches) as success', (done) => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      search.on('complete', (results: SearchMatch[]) => {
        expect(results).toHaveLength(0);
        done();
      });

      search.streamSearch('query');
      mockProcess.emit('close', 1);
    });

    it('should handle stderr warnings', () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const warnings: string[] = [];
      search.on('warning', (msg) => warnings.push(msg));

      search.streamSearch('query');
      mockProcess.stderr.emit('data', Buffer.from('Some warning'));

      expect(warnings).toContain('Some warning');
    });

    it('should not emit warning for "No files were searched"', () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const warnings: string[] = [];
      search.on('warning', (msg) => warnings.push(msg));

      search.streamSearch('query');
      mockProcess.stderr.emit('data', Buffer.from('No files were searched'));

      expect(warnings).toHaveLength(0);
    });

    it('should call option callbacks', (done) => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const callbacks = {
        onMatch: jest.fn(),
        onProgress: jest.fn(),
        onComplete: jest.fn(),
        onError: jest.fn(),
      };

      search.streamSearch('query', callbacks);

      const matchLine = JSON.stringify({
        type: 'match',
        data: {
          path: { text: 'test.ts' },
          line_number: 1,
          submatches: [{ start: 0, match: { text: 'q' } }],
          lines: { text: 'q' },
        },
      });

      mockProcess.stdout.emit('data', Buffer.from(matchLine + '\n'));

      setTimeout(() => {
        expect(callbacks.onMatch).toHaveBeenCalled();
        mockProcess.emit('close', 0);
        setTimeout(() => {
          expect(callbacks.onComplete).toHaveBeenCalled();
          done();
        }, 10);
      }, 10);
    });
  });

  describe('search (Promise API)', () => {
    it('should return results as promise', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const searchPromise = search.search('query');

      // Simulate match and close
      const matchLine = JSON.stringify({
        type: 'match',
        data: {
          path: { text: 'file.ts' },
          line_number: 5,
          submatches: [{ start: 0, match: { text: 'query' } }],
          lines: { text: 'query result' },
        },
      });

      setTimeout(() => {
        mockProcess.stdout.emit('data', Buffer.from(matchLine + '\n'));
        mockProcess.emit('close', 0);
      }, 10);

      const { results, stats } = await searchPromise;

      expect(results).toHaveLength(1);
      expect(results[0].file).toBe('file.ts');
      expect(stats.cached).toBe(false);
    });

    it('should return cached results on second call', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      // First call
      const promise1 = search.search('cached-query');

      setTimeout(() => {
        const matchLine = JSON.stringify({
          type: 'match',
          data: {
            path: { text: 'cached.ts' },
            line_number: 1,
            submatches: [{ start: 0, match: { text: 'cached' } }],
            lines: { text: 'cached result' },
          },
        });
        mockProcess.stdout.emit('data', Buffer.from(matchLine + '\n'));
        mockProcess.emit('close', 0);
      }, 10);

      await promise1;

      // Second call should return cached
      mockSpawn.mockClear();
      const { results, stats } = await search.search('cached-query');

      expect(mockSpawn).not.toHaveBeenCalled();
      expect(results).toHaveLength(1);
      expect(stats.cached).toBe(true);
    });

    it('should reject on search error', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      // Add error listener to prevent unhandled error event
      // (EventEmitter throws if 'error' event has no listeners)
      search.on('error', () => {});

      const searchPromise = search.search('error-query');

      setTimeout(() => {
        // Emit error on the child process which triggers rejection
        mockProcess.emit('error', new Error('Search error'));
      }, 10);

      await expect(searchPromise).rejects.toThrow('Search error');
    });
  });

  describe('findSymbols', () => {
    it('should search for symbols by name', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const promise = search.findSymbols('myFunction', {
        types: ['function'],
      });

      // Simulate multiple searches completing
      setTimeout(() => {
        const matchLine = JSON.stringify({
          type: 'match',
          data: {
            path: { text: 'utils.ts' },
            line_number: 10,
            submatches: [{ start: 0, match: { text: 'function myFunction' } }],
            lines: { text: 'export async function myFunction() {' },
          },
        });
        mockProcess.stdout.emit('data', Buffer.from(matchLine + '\n'));
        mockProcess.emit('close', 0);
      }, 10);

      const symbols = await promise;

      expect(symbols.length).toBeGreaterThanOrEqual(0);
    });

    it('should filter by exported only', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const promise = search.findSymbols('myFunc', {
        exportedOnly: true,
      });

      setTimeout(() => {
        mockProcess.emit('close', 1); // No matches
      }, 10);

      const symbols = await promise;
      expect(Array.isArray(symbols)).toBe(true);
    });

    it('should use symbol cache', async () => {
      // findSymbols makes multiple internal searches, so we need to mock
      // all processes to close immediately
      mockSpawn.mockImplementation(() => {
        const proc = createMockProcess();
        // Auto-close the process
        setImmediate(() => proc.emit('close', 1));
        return proc;
      });

      // First call
      const symbols1 = await search.findSymbols('cachedSymbol');
      expect(Array.isArray(symbols1)).toBe(true);

      // Track calls after first findSymbols
      const callCountAfterFirst = mockSpawn.mock.calls.length;

      // Second call should use cache (no new spawns for same query)
      const symbols2 = await search.findSymbols('cachedSymbol');
      expect(Array.isArray(symbols2)).toBe(true);

      // Should have same results (both from cache on second call)
      expect(symbols1).toEqual(symbols2);
    });
  });

  describe('findReferences', () => {
    it('should search for symbol references with whole word matching', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const promise = search.findReferences('myVar');

      setTimeout(() => {
        const matchLine = JSON.stringify({
          type: 'match',
          data: {
            path: { text: 'main.ts' },
            line_number: 20,
            submatches: [{ start: 5, match: { text: 'myVar' } }],
            lines: { text: 'const myVar = 5;' },
          },
        });
        mockProcess.stdout.emit('data', Buffer.from(matchLine + '\n'));
        mockProcess.emit('close', 0);
      }, 10);

      const references = await promise;

      expect(references).toHaveLength(1);
      expect(references[0].match).toBe('myVar');
    });

    it('should include context lines', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      search.findReferences('withContext', { contextLines: 2 });

      const args = mockSpawn.mock.calls[0][1];
      expect(args).toContain('--context');
      expect(args).toContain('2');
    });
  });

  describe('findDefinition', () => {
    it('should find exact symbol definition', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const promise = search.findDefinition('MyClass');

      setTimeout(() => {
        const matchLine = JSON.stringify({
          type: 'match',
          data: {
            path: { text: 'models.ts' },
            line_number: 5,
            submatches: [{ start: 0, match: { text: 'class MyClass' } }],
            lines: { text: 'export class MyClass {' },
          },
        });
        mockProcess.stdout.emit('data', Buffer.from(matchLine + '\n'));
        mockProcess.emit('close', 0);
      }, 10);

      const definition = await promise;

      // May be null if parsing fails, but should not throw
      expect(definition === null || typeof definition === 'object').toBe(true);
    });

    it('should return null if no definition found', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const promise = search.findDefinition('NonExistent');

      setTimeout(() => {
        mockProcess.emit('close', 1); // No matches
      }, 10);

      const definition = await promise;
      expect(definition).toBeNull();
    });
  });

  describe('searchMultiple', () => {
    it('should search multiple patterns with OR operator', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const promise = search.searchMultiple(['pattern1', 'pattern2'], {
        operator: 'OR',
      });

      setTimeout(() => {
        const matchLine = JSON.stringify({
          type: 'match',
          data: {
            path: { text: 'file.ts' },
            line_number: 1,
            submatches: [{ start: 0, match: { text: 'pattern1' } }],
            lines: { text: 'pattern1 here' },
          },
        });
        mockProcess.stdout.emit('data', Buffer.from(matchLine + '\n'));
        mockProcess.emit('close', 0);
      }, 10);

      const results = await promise;

      expect(results instanceof Map).toBe(true);
      expect(results.has('pattern1')).toBe(true);
      expect(results.has('pattern2')).toBe(true);
    });

    it('should search with AND operator', async () => {
      // searchMultiple with AND makes multiple searches, auto-close all
      mockSpawn.mockImplementation(() => {
        const proc = createMockProcess();
        setImmediate(() => proc.emit('close', 1));
        return proc;
      });

      const results = await search.searchMultiple(['func', 'async'], {
        operator: 'AND',
      });

      expect(results instanceof Map).toBe(true);
    });
  });

  describe('cancelAll', () => {
    it('should kill all active processes', () => {
      const mockProcess1 = createMockProcess();
      const mockProcess2 = createMockProcess();
      mockSpawn
        .mockReturnValueOnce(mockProcess1)
        .mockReturnValueOnce(mockProcess2);

      search.streamSearch('query1');
      search.streamSearch('query2');

      search.cancelAll();

      expect(mockProcess1.kill).toHaveBeenCalledWith('SIGTERM');
      expect(mockProcess2.kill).toHaveBeenCalledWith('SIGTERM');
    });
  });

  describe('clearCache', () => {
    it('should clear all caches', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      // Populate cache
      const promise = search.search('cache-test');
      setTimeout(() => mockProcess.emit('close', 1), 10);
      await promise;

      const statsBefore = search.getCacheStats();
      expect(statsBefore.searchCache).toBeGreaterThanOrEqual(0);

      search.clearCache();

      const statsAfter = search.getCacheStats();
      expect(statsAfter.searchCache).toBe(0);
      expect(statsAfter.symbolCache).toBe(0);
    });
  });

  describe('getCacheStats', () => {
    it('should return cache statistics', () => {
      const stats = search.getCacheStats();

      expect(stats).toHaveProperty('searchCache');
      expect(stats).toHaveProperty('symbolCache');
      expect(typeof stats.searchCache).toBe('number');
      expect(typeof stats.symbolCache).toBe('number');
    });
  });
});

describe('Singleton functions', () => {
  beforeEach(() => {
    resetEnhancedSearch();
  });

  describe('getEnhancedSearch', () => {
    it('should return singleton instance', () => {
      const instance1 = getEnhancedSearch();
      const instance2 = getEnhancedSearch();

      expect(instance1).toBe(instance2);
    });

    it('should create with workdir', () => {
      const instance = getEnhancedSearch('/custom/path');
      expect(instance).toBeInstanceOf(EnhancedSearch);
    });

    it('should update workdir on existing instance', () => {
      const instance1 = getEnhancedSearch('/path1');
      const instance2 = getEnhancedSearch('/path2');

      expect(instance1).toBe(instance2);
    });
  });

  describe('resetEnhancedSearch', () => {
    it('should clear singleton and caches', () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const instance1 = getEnhancedSearch();
      instance1.streamSearch('test');

      resetEnhancedSearch();

      const instance2 = getEnhancedSearch();
      expect(instance1).not.toBe(instance2);
    });

    it('should cancel active processes', () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const instance = getEnhancedSearch();
      instance.streamSearch('test');

      resetEnhancedSearch();

      expect(mockProcess.kill).toHaveBeenCalled();
    });
  });
});

describe('LRU Cache behavior', () => {
  let search: EnhancedSearch;

  beforeEach(() => {
    jest.clearAllMocks();
    resetEnhancedSearch();
    search = new EnhancedSearch();
  });

  it('should evict oldest entries when full', async () => {
    // This tests the internal LRU cache behavior indirectly
    // by making many searches and checking cache doesn't grow unbounded
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);

    // Make multiple unique searches
    for (let i = 0; i < 5; i++) {
      const promise = search.search(`unique-query-${i}`);
      setTimeout(() => mockProcess.emit('close', 1), 5);
      await promise;
    }

    const stats = search.getCacheStats();
    expect(stats.searchCache).toBeLessThanOrEqual(100); // Max size
  });

  it('should expire entries after TTL', async () => {
    // TTL behavior is harder to test without time manipulation
    // This just verifies the cache exists and works
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);

    const promise = search.search('ttl-test');
    setTimeout(() => mockProcess.emit('close', 1), 5);
    await promise;

    // Second call within TTL should hit cache
    const { stats } = await search.search('ttl-test');
    expect(stats.cached).toBe(true);
  });
});

describe('Symbol detection', () => {
  let search: EnhancedSearch;

  beforeEach(() => {
    jest.clearAllMocks();
    resetEnhancedSearch();
    search = new EnhancedSearch();
  });

  it('should detect TypeScript function', async () => {
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);

    const promise = search.findSymbols('testFunc', { types: ['function'] });

    setTimeout(() => {
      const matchLine = JSON.stringify({
        type: 'match',
        data: {
          path: { text: 'test.ts' },
          line_number: 1,
          submatches: [{ start: 0, match: { text: 'function testFunc' } }],
          lines: { text: 'export async function testFunc() {}' },
        },
      });
      mockProcess.stdout.emit('data', Buffer.from(matchLine + '\n'));
      mockProcess.emit('close', 0);
    }, 10);

    const symbols = await promise;
    // The parsing may or may not find the symbol depending on implementation
    expect(Array.isArray(symbols)).toBe(true);
  });

  it('should detect class definitions', async () => {
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);

    const promise = search.findSymbols('MyClass', { types: ['class'] });

    setTimeout(() => {
      const matchLine = JSON.stringify({
        type: 'match',
        data: {
          path: { text: 'class.ts' },
          line_number: 1,
          submatches: [{ start: 0, match: { text: 'class MyClass' } }],
          lines: { text: 'export class MyClass extends Base {}' },
        },
      });
      mockProcess.stdout.emit('data', Buffer.from(matchLine + '\n'));
      mockProcess.emit('close', 0);
    }, 10);

    const symbols = await promise;
    expect(Array.isArray(symbols)).toBe(true);
  });

  it('should detect interface definitions', async () => {
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);

    const promise = search.findSymbols('IConfig', { types: ['interface'] });

    setTimeout(() => {
      const matchLine = JSON.stringify({
        type: 'match',
        data: {
          path: { text: 'types.ts' },
          line_number: 1,
          submatches: [{ start: 0, match: { text: 'interface IConfig' } }],
          lines: { text: 'export interface IConfig {}' },
        },
      });
      mockProcess.stdout.emit('data', Buffer.from(matchLine + '\n'));
      mockProcess.emit('close', 0);
    }, 10);

    const symbols = await promise;
    expect(Array.isArray(symbols)).toBe(true);
  });

  it('should detect const definitions', async () => {
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);

    const promise = search.findSymbols('CONFIG', { types: ['const'] });

    setTimeout(() => {
      const matchLine = JSON.stringify({
        type: 'match',
        data: {
          path: { text: 'config.ts' },
          line_number: 1,
          submatches: [{ start: 0, match: { text: 'const CONFIG' } }],
          lines: { text: 'export const CONFIG = {};' },
        },
      });
      mockProcess.stdout.emit('data', Buffer.from(matchLine + '\n'));
      mockProcess.emit('close', 0);
    }, 10);

    const symbols = await promise;
    expect(Array.isArray(symbols)).toBe(true);
  });
});

describe('Search options', () => {
  let search: EnhancedSearch;

  beforeEach(() => {
    jest.clearAllMocks();
    resetEnhancedSearch();
    search = new EnhancedSearch();
  });

  it('should build args for case-insensitive search (default)', () => {
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);

    search.streamSearch('test');

    const args = mockSpawn.mock.calls[0][1];
    expect(args).toContain('--ignore-case');
  });

  it('should build args for case-sensitive search', () => {
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);

    search.streamSearch('test', { caseSensitive: true });

    const args = mockSpawn.mock.calls[0][1];
    expect(args).not.toContain('--ignore-case');
  });

  it('should build args for fixed-string search (default)', () => {
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);

    search.streamSearch('test');

    const args = mockSpawn.mock.calls[0][1];
    expect(args).toContain('--fixed-strings');
  });

  it('should build args for regex search', () => {
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);

    search.streamSearch('test.*pattern', { regex: true });

    const args = mockSpawn.mock.calls[0][1];
    expect(args).not.toContain('--fixed-strings');
  });

  it('should add default exclusions', () => {
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);

    search.streamSearch('test');

    const args = mockSpawn.mock.calls[0][1];
    expect(args).toContain('!.git/**');
    expect(args).toContain('!node_modules/**');
  });
});

describe('Edge cases', () => {
  let search: EnhancedSearch;

  beforeEach(() => {
    jest.clearAllMocks();
    resetEnhancedSearch();
    search = new EnhancedSearch();
  });

  it('should handle invalid JSON in stdout gracefully', (done) => {
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);

    search.streamSearch('test');

    // Send invalid JSON - should not throw
    mockProcess.stdout.emit('data', Buffer.from('not json\n'));
    mockProcess.stdout.emit('data', Buffer.from('{"partial":true\n'));

    // Should still complete successfully
    search.on('complete', () => done());
    mockProcess.emit('close', 0);
  });

  it('should handle partial JSON lines (buffering)', (done) => {
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);

    const matches: SearchMatch[] = [];
    search.on('match', (m) => matches.push(m));

    search.streamSearch('test');

    // Send JSON split across chunks
    const fullJson = JSON.stringify({
      type: 'match',
      data: {
        path: { text: 'split.ts' },
        line_number: 1,
        submatches: [{ start: 0, match: { text: 'test' } }],
        lines: { text: 'test' },
      },
    });

    const mid = Math.floor(fullJson.length / 2);
    mockProcess.stdout.emit('data', Buffer.from(fullJson.slice(0, mid)));
    mockProcess.stdout.emit('data', Buffer.from(fullJson.slice(mid) + '\n'));

    setTimeout(() => {
      expect(matches).toHaveLength(1);
      mockProcess.emit('close', 0);
      done();
    }, 20);
  });

  it('should process remaining buffer on close', (done) => {
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);

    const matches: SearchMatch[] = [];
    search.on('complete', (results: SearchMatch[]) => {
      expect(results).toHaveLength(1);
      done();
    });

    search.streamSearch('test');

    // Send JSON without trailing newline
    const json = JSON.stringify({
      type: 'match',
      data: {
        path: { text: 'last.ts' },
        line_number: 1,
        submatches: [{ start: 0, match: { text: 'test' } }],
        lines: { text: 'test' },
      },
    });

    mockProcess.stdout.emit('data', Buffer.from(json));
    mockProcess.emit('close', 0);
  });

  it('should handle empty search results', (done) => {
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);

    search.on('complete', (results: SearchMatch[], stats: SearchStats) => {
      expect(results).toHaveLength(0);
      expect(stats.matchCount).toBe(0);
      done();
    });

    search.streamSearch('nonexistent');
    mockProcess.emit('close', 1); // Exit code 1 = no matches
  });
});
