/**
 * Unit tests for EnhancedSearch
 * Tests ripgrep-based search, symbol discovery, and caching
 */

import { EnhancedSearch, getEnhancedSearch, resetEnhancedSearch } from '../../src/tools/enhanced-search';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';

// Mock child_process
jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

// Mock @vscode/ripgrep
jest.mock('@vscode/ripgrep', () => ({
  rgPath: '/path/to/rg',
}));

describe('EnhancedSearch', () => {
  let search: EnhancedSearch;

  beforeEach(() => {
    jest.clearAllMocks();
    resetEnhancedSearch();
    search = new EnhancedSearch();
  });

  describe('search()', () => {
    it('should perform search using ripgrep and return results', async () => {
      const mockRg = new EventEmitter() as any;
      mockRg.stdout = new EventEmitter();
      mockRg.stderr = new EventEmitter();
      
      (spawn as jest.Mock).mockReturnValue(mockRg);

      const searchPromise = search.search('test-query');

      // Simulate ripgrep JSON output
      mockRg.stdout.emit('data', Buffer.from(JSON.stringify({
        type: 'match',
        data: {
          path: { text: 'file.ts' },
          line_number: 10,
          submatches: [{ start: 5, match: { text: 'test-query' } }],
          lines: { text: 'const test-query = 1;' }
        }
      }) + '\n'));

      // Simulate completion
      setTimeout(() => mockRg.emit('close', 0), 10);

      const { results, stats } = await searchPromise;

      expect(results).toHaveLength(1);
      expect(results[0].file).toBe('file.ts');
      expect(stats.matchCount).toBe(1);
      expect(spawn).toHaveBeenCalled();
    });

    it('should use cache for repeated queries', async () => {
      const mockRg = new EventEmitter() as any;
      mockRg.stdout = new EventEmitter();
      mockRg.stderr = new EventEmitter();
      (spawn as jest.Mock).mockReturnValue(mockRg);

      // First call (uncached)
      const p1 = search.search('query');
      mockRg.stdout.emit('data', Buffer.from(JSON.stringify({
        type: 'match',
        data: { path: { text: 'f.ts' }, line_number: 1 }
      }) + '\n'));
      mockRg.emit('close', 0);
      await p1;

      // Second call (should be cached)
      const { results, stats } = await search.search('query');

      expect(stats.cached).toBe(true);
      expect(spawn).toHaveBeenCalledTimes(1); // Only once
    });
  });

  describe('findSymbols()', () => {
    it('should find function symbols', async () => {
      // Mock search to return a function definition line
      jest.spyOn(search, 'search').mockResolvedValue({
        results: [{
          file: 'src/app.ts',
          line: 5,
          column: 0,
          text: 'export function main() {',
          match: 'main'
        }],
        stats: { filesSearched: 1, matchCount: 1, duration: 10, cached: false }
      });

      const symbols = await search.findSymbols('main', { types: ['function'] });

      expect(symbols).toHaveLength(1);
      expect(symbols[0].name).toBe('main');
      expect(symbols[0].type).toBe('function');
      expect(symbols[0].exported).toBe(true);
    });
  });

  describe('findReferences()', () => {
    it('should find all word references', async () => {
      const searchSpy = jest.spyOn(search, 'search').mockResolvedValue({
        results: [],
        stats: { filesSearched: 0, matchCount: 0, duration: 0, cached: false }
      });

      await search.findReferences('myVar');

      expect(searchSpy).toHaveBeenCalledWith('myVar', expect.objectContaining({
        wholeWord: true
      }));
    });
  });

  describe('findDefinition()', () => {
    it('should find definition of a symbol', async () => {
      jest.spyOn(search, 'findSymbols').mockResolvedValue([{
        name: 'MyClass',
        type: 'class',
        file: 'models.ts',
        line: 10,
        exported: true
      }]);

      const def = await search.findDefinition('MyClass');

      expect(def).not.toBeNull();
      expect(def?.file).toBe('models.ts');
    });
  });

  describe('Cache Management', () => {
    it('should clear cache', async () => {
      // Add to cache
      const mockRg = new EventEmitter() as any;
      mockRg.stdout = new EventEmitter();
      mockRg.stderr = new EventEmitter();
      (spawn as jest.Mock).mockReturnValue(mockRg);
      
      const p = search.search('q');
      mockRg.emit('close', 0);
      await p;
      
      expect(search.getCacheStats().searchCache).toBe(1);
      
      search.clearCache();
      expect(search.getCacheStats().searchCache).toBe(0);
    });
  });
});

describe('getEnhancedSearch singleton', () => {
  it('should return same instance', () => {
    const s1 = getEnhancedSearch();
    const s2 = getEnhancedSearch();
    expect(s1).toBe(s2);
  });
});
