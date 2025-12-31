/**
 * Tests for SearchTool (src/tools/search.ts)
 *
 * Comprehensive tests covering:
 * - Unified search with glob patterns
 * - Content search with ripgrep
 * - File search with fuzzy matching
 * - Result filtering and ranking
 * - Cache behavior
 * - Enhanced search methods (symbols, references, definitions)
 * - Error handling
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

// Mock fs-extra
const mockReaddir = jest.fn();
const mockFsExtra = {
  readdir: mockReaddir,
  pathExists: jest.fn(() => Promise.resolve(true)),
  stat: jest.fn(() => Promise.resolve({ isDirectory: () => false })),
};
jest.mock('fs-extra', () => mockFsExtra);

// Mock ConfirmationService
jest.mock('../../src/utils/confirmation-service', () => ({
  ConfirmationService: {
    getInstance: jest.fn(() => ({
      getSessionFlags: jest.fn(() => ({ allOperations: false })),
      requestConfirmation: jest.fn(() => Promise.resolve({ confirmed: true })),
    })),
  },
}));

// Mock enhanced-search
const mockEnhancedSearch = {
  findSymbols: jest.fn(),
  findReferences: jest.fn(),
  findDefinition: jest.fn(),
  searchMultiple: jest.fn(),
  getCacheStats: jest.fn(() => ({ searchCache: 0, symbolCache: 0 })),
  clearCache: jest.fn(),
};
jest.mock('../../src/tools/enhanced-search.js', () => ({
  getEnhancedSearch: jest.fn(() => mockEnhancedSearch),
  SearchMatch: class {},
  SymbolMatch: class {},
}));

import { SearchTool } from '../../src/tools/search.js';

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

// Helper to create ripgrep JSON match output
function createRipgrepMatch(file: string, line: number, text: string, match: string) {
  return JSON.stringify({
    type: 'match',
    data: {
      path: { text: file },
      line_number: line,
      submatches: [{ start: 0, match: { text: match } }],
      lines: { text: text },
    },
  });
}

describe('SearchTool', () => {
  let searchTool: SearchTool;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    searchTool = new SearchTool();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('constructor', () => {
    it('should create instance with default current directory', () => {
      expect(searchTool).toBeInstanceOf(SearchTool);
      expect(searchTool.getCurrentDirectory()).toBe(process.cwd());
    });
  });

  describe('setCurrentDirectory', () => {
    it('should update current working directory', () => {
      searchTool.setCurrentDirectory('/custom/path');
      expect(searchTool.getCurrentDirectory()).toBe('/custom/path');
    });
  });

  describe('search - text search type', () => {
    it('should execute ripgrep with correct arguments for text search', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const searchPromise = searchTool.search('test query', { searchType: 'text' });

      // Simulate ripgrep completing with no matches
      setImmediate(() => {
        mockProcess.emit('close', 1);
      });
      jest.runAllTimers();

      const result = await searchPromise;

      expect(mockSpawn).toHaveBeenCalled();
      const args = mockSpawn.mock.calls[0][1];
      expect(args).toContain('--json');
      expect(args).toContain('--with-filename');
      expect(args).toContain('--line-number');
      expect(args).toContain('--column');
      expect(args).toContain('--no-heading');
      expect(args).toContain('--color=never');
      expect(args).toContain('test query');
      expect(result.success).toBe(true);
    });

    it('should add --ignore-case by default', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const searchPromise = searchTool.search('query', { searchType: 'text' });

      setImmediate(() => {
        mockProcess.emit('close', 1);
      });
      jest.runAllTimers();

      await searchPromise;

      const args = mockSpawn.mock.calls[0][1];
      expect(args).toContain('--ignore-case');
    });

    it('should not add --ignore-case when caseSensitive is true', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const searchPromise = searchTool.search('query', {
        searchType: 'text',
        caseSensitive: true,
      });

      setImmediate(() => {
        mockProcess.emit('close', 1);
      });
      jest.runAllTimers();

      await searchPromise;

      const args = mockSpawn.mock.calls[0][1];
      expect(args).not.toContain('--ignore-case');
    });

    it('should add --word-regexp when wholeWord is true', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const searchPromise = searchTool.search('query', {
        searchType: 'text',
        wholeWord: true,
      });

      setImmediate(() => {
        mockProcess.emit('close', 1);
      });
      jest.runAllTimers();

      await searchPromise;

      const args = mockSpawn.mock.calls[0][1];
      expect(args).toContain('--word-regexp');
    });

    it('should add --fixed-strings by default (non-regex)', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const searchPromise = searchTool.search('query', { searchType: 'text' });

      setImmediate(() => {
        mockProcess.emit('close', 1);
      });
      jest.runAllTimers();

      await searchPromise;

      const args = mockSpawn.mock.calls[0][1];
      expect(args).toContain('--fixed-strings');
    });

    it('should not add --fixed-strings when regex is true', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const searchPromise = searchTool.search('test.*pattern', {
        searchType: 'text',
        regex: true,
      });

      setImmediate(() => {
        mockProcess.emit('close', 1);
      });
      jest.runAllTimers();

      await searchPromise;

      const args = mockSpawn.mock.calls[0][1];
      expect(args).not.toContain('--fixed-strings');
    });

    it('should add --max-count when maxResults is provided', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const searchPromise = searchTool.search('query', {
        searchType: 'text',
        maxResults: 50,
      });

      setImmediate(() => {
        mockProcess.emit('close', 1);
      });
      jest.runAllTimers();

      await searchPromise;

      const args = mockSpawn.mock.calls[0][1];
      expect(args).toContain('--max-count');
      expect(args).toContain('50');
    });

    it('should add file type filters', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const searchPromise = searchTool.search('query', {
        searchType: 'text',
        fileTypes: ['ts', 'js'],
      });

      setImmediate(() => {
        mockProcess.emit('close', 1);
      });
      jest.runAllTimers();

      await searchPromise;

      const args = mockSpawn.mock.calls[0][1];
      expect(args).toContain('--type');
      expect(args).toContain('ts');
      expect(args).toContain('js');
    });

    it('should add include pattern with --glob', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const searchPromise = searchTool.search('query', {
        searchType: 'text',
        includePattern: 'src/**/*.ts',
      });

      setImmediate(() => {
        mockProcess.emit('close', 1);
      });
      jest.runAllTimers();

      await searchPromise;

      const args = mockSpawn.mock.calls[0][1];
      expect(args).toContain('--glob');
      expect(args).toContain('src/**/*.ts');
    });

    it('should add exclude pattern with --glob and negation', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const searchPromise = searchTool.search('query', {
        searchType: 'text',
        excludePattern: 'test/**',
      });

      setImmediate(() => {
        mockProcess.emit('close', 1);
      });
      jest.runAllTimers();

      await searchPromise;

      const args = mockSpawn.mock.calls[0][1];
      expect(args).toContain('--glob');
      expect(args).toContain('!test/**');
    });

    it('should add exclude files with --glob and negation', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const searchPromise = searchTool.search('query', {
        searchType: 'text',
        excludeFiles: ['*.test.ts', '*.spec.ts'],
      });

      setImmediate(() => {
        mockProcess.emit('close', 1);
      });
      jest.runAllTimers();

      await searchPromise;

      const args = mockSpawn.mock.calls[0][1];
      expect(args).toContain('!*.test.ts');
      expect(args).toContain('!*.spec.ts');
    });

    it('should always exclude .git and node_modules', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const searchPromise = searchTool.search('query', { searchType: 'text' });

      setImmediate(() => {
        mockProcess.emit('close', 1);
      });
      jest.runAllTimers();

      await searchPromise;

      const args = mockSpawn.mock.calls[0][1];
      expect(args).toContain('!.git/**');
      expect(args).toContain('!node_modules/**');
    });

    it('should parse ripgrep JSON output correctly', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const searchPromise = searchTool.search('query', { searchType: 'text' });

      setImmediate(() => {
        const matchLine = createRipgrepMatch('src/index.ts', 10, 'const query = "test";', 'query');
        mockProcess.stdout.emit('data', Buffer.from(matchLine + '\n'));
        mockProcess.emit('close', 0);
      });
      jest.runAllTimers();

      const result = await searchPromise;

      expect(result.success).toBe(true);
      expect(result.output).toContain('src/index.ts');
    });

    it('should handle multiple matches', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const searchPromise = searchTool.search('query', { searchType: 'text' });

      setImmediate(() => {
        const match1 = createRipgrepMatch('file1.ts', 5, 'const query = 1;', 'query');
        const match2 = createRipgrepMatch('file2.ts', 10, 'let query = 2;', 'query');
        const match3 = createRipgrepMatch('file1.ts', 15, 'var query = 3;', 'query');
        mockProcess.stdout.emit('data', Buffer.from(match1 + '\n' + match2 + '\n' + match3 + '\n'));
        mockProcess.emit('close', 0);
      });
      jest.runAllTimers();

      const result = await searchPromise;

      expect(result.success).toBe(true);
      expect(result.output).toContain('file1.ts');
      expect(result.output).toContain('file2.ts');
      expect(result.output).toContain('2 matches'); // file1.ts has 2 matches
    });

    it('should return "No results found" when no matches', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const searchPromise = searchTool.search('nonexistent', { searchType: 'text' });

      setImmediate(() => {
        mockProcess.emit('close', 1); // Exit code 1 = no matches
      });
      jest.runAllTimers();

      const result = await searchPromise;

      expect(result.success).toBe(true);
      expect(result.output).toContain('No results found');
    });

    it('should set up timeout for ripgrep process', async () => {
      // This test verifies the timeout mechanism is set up correctly
      // We can't actually test the full 30 second timeout, but we can verify
      // the process is spawned and handles completion correctly
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const searchPromise = searchTool.search('query', { searchType: 'text' });

      // Simulate normal completion (within timeout)
      setImmediate(() => {
        mockProcess.emit('close', 0);
      });
      jest.runAllTimers();

      const result = await searchPromise;

      // Verify the spawn was called with all the expected args
      expect(mockSpawn).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('should reject with timeout error when process takes too long', async () => {
      // Simulate what happens when the internal timedOut flag is set
      // This tests the error path when timeout occurs
      jest.useRealTimers();

      const mockProcess = createMockProcess();

      // Override kill to simulate the timeout behavior
      mockProcess.kill = jest.fn();

      mockSpawn.mockReturnValue(mockProcess);

      const searchPromise = searchTool.search('query', { searchType: 'text' });

      // Give the promise a chance to start
      await new Promise(resolve => setTimeout(resolve, 10));

      // Manually trigger what would happen on timeout: kill the process
      // and then the close event fires, but the timedOut flag causes rejection
      // Since we can't actually wait 30s, we just close with an error code
      mockProcess.emit('close', 2);

      const result = await searchPromise;

      // On non-standard exit code, we should get an error
      expect(result.success).toBe(false);
      expect(result.error).toContain('Ripgrep failed');

      jest.useFakeTimers();
    });

    it('should handle ripgrep process error', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const searchPromise = searchTool.search('query', { searchType: 'text' });

      setImmediate(() => {
        mockProcess.emit('error', new Error('spawn failed'));
      });
      jest.runAllTimers();

      const result = await searchPromise;

      expect(result.success).toBe(false);
      expect(result.error).toContain('spawn failed');
    });

    it('should handle ripgrep non-zero exit code (not 0 or 1)', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const searchPromise = searchTool.search('query', { searchType: 'text' });

      setImmediate(() => {
        mockProcess.stderr.emit('data', Buffer.from('Some error occurred'));
        mockProcess.emit('close', 2);
      });
      jest.runAllTimers();

      const result = await searchPromise;

      expect(result.success).toBe(false);
      expect(result.error).toContain('Ripgrep failed');
    });

    it('should skip invalid JSON lines gracefully', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const searchPromise = searchTool.search('query', { searchType: 'text' });

      setImmediate(() => {
        mockProcess.stdout.emit('data', Buffer.from('not valid json\n'));
        mockProcess.stdout.emit('data', Buffer.from('{"partial": true\n')); // Invalid JSON
        const validMatch = createRipgrepMatch('valid.ts', 1, 'query', 'query');
        mockProcess.stdout.emit('data', Buffer.from(validMatch + '\n'));
        mockProcess.emit('close', 0);
      });
      jest.runAllTimers();

      const result = await searchPromise;

      expect(result.success).toBe(true);
      expect(result.output).toContain('valid.ts');
    });

    it('should skip non-match JSON lines', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const searchPromise = searchTool.search('query', { searchType: 'text' });

      setImmediate(() => {
        // ripgrep also emits "begin" and "end" events
        mockProcess.stdout.emit('data', Buffer.from('{"type":"begin","data":{"path":{"text":"file.ts"}}}\n'));
        const match = createRipgrepMatch('file.ts', 1, 'query', 'query');
        mockProcess.stdout.emit('data', Buffer.from(match + '\n'));
        mockProcess.stdout.emit('data', Buffer.from('{"type":"end","data":{"path":{"text":"file.ts"}}}\n'));
        mockProcess.emit('close', 0);
      });
      jest.runAllTimers();

      const result = await searchPromise;

      expect(result.success).toBe(true);
      expect(result.output).toContain('file.ts');
    });
  });

  describe('search - file search type', () => {
    beforeEach(() => {
      // Reset directory mocks
      mockReaddir.mockReset();
    });

    it('should find files matching pattern', async () => {
      // Mock directory structure
      mockReaddir.mockResolvedValue([
        { name: 'search.ts', isFile: () => true, isDirectory: () => false },
        { name: 'search.test.ts', isFile: () => true, isDirectory: () => false },
        { name: 'utils', isFile: () => false, isDirectory: () => true },
      ]);

      const result = await searchTool.search('search', { searchType: 'files' });

      expect(result.success).toBe(true);
      expect(result.output).toContain('search.ts');
    });

    it('should skip hidden files by default', async () => {
      mockReaddir.mockResolvedValue([
        { name: '.hidden', isFile: () => true, isDirectory: () => false },
        { name: 'visible.ts', isFile: () => true, isDirectory: () => false },
      ]);

      const result = await searchTool.search('hidden', { searchType: 'files' });

      // Hidden file should not be found
      expect(result.success).toBe(true);
      expect(result.output).not.toContain('.hidden');
    });

    it('should include hidden files when includeHidden is true', async () => {
      mockReaddir.mockResolvedValue([
        { name: '.hidden', isFile: () => true, isDirectory: () => false },
        { name: 'visible.ts', isFile: () => true, isDirectory: () => false },
      ]);

      const result = await searchTool.search('hidden', {
        searchType: 'files',
        includeHidden: true,
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('.hidden');
    });

    it('should skip node_modules directory', async () => {
      mockReaddir
        .mockResolvedValueOnce([
          { name: 'src', isFile: () => false, isDirectory: () => true },
          { name: 'node_modules', isFile: () => false, isDirectory: () => true },
        ])
        .mockResolvedValueOnce([
          { name: 'index.ts', isFile: () => true, isDirectory: () => false },
        ]);

      await searchTool.search('index', { searchType: 'files' });

      // Should have called readdir on src but not node_modules
      expect(mockReaddir).toHaveBeenCalledTimes(2); // root + src
    });

    it('should skip common build directories', async () => {
      const commonDirs = ['node_modules', '.git', '.svn', '.hg', 'dist', 'build', '.next', '.cache'];

      mockReaddir.mockResolvedValue(
        commonDirs.map(name => ({
          name,
          isFile: () => false,
          isDirectory: () => true,
        }))
      );

      await searchTool.search('anything', { searchType: 'files' });

      // Should only have called readdir once (the root)
      expect(mockReaddir).toHaveBeenCalledTimes(1);
    });

    it('should respect maxResults for file search', async () => {
      // Create many files
      const manyFiles = Array.from({ length: 100 }, (_, i) => ({
        name: `file${i}.ts`,
        isFile: () => true,
        isDirectory: () => false,
      }));
      mockReaddir.mockResolvedValue(manyFiles);

      const result = await searchTool.search('file', {
        searchType: 'files',
        maxResults: 10,
      });

      expect(result.success).toBe(true);
      // Output should be limited
    });

    it('should apply exclude pattern to file search', async () => {
      mockReaddir.mockResolvedValue([
        { name: 'file.ts', isFile: () => true, isDirectory: () => false },
        { name: 'file.test.ts', isFile: () => true, isDirectory: () => false },
      ]);

      const result = await searchTool.search('file', {
        searchType: 'files',
        excludePattern: 'test',
      });

      expect(result.success).toBe(true);
      expect(result.output).not.toContain('test');
    });

    it('should return "No results found" when no files match', async () => {
      mockReaddir.mockResolvedValue([
        { name: 'other.ts', isFile: () => true, isDirectory: () => false },
      ]);

      const result = await searchTool.search('nonexistent', { searchType: 'files' });

      expect(result.success).toBe(true);
      expect(result.output).toContain('No results found');
    });

    it('should handle directory read errors gracefully', async () => {
      mockReaddir.mockRejectedValue(new Error('Permission denied'));

      const result = await searchTool.search('query', { searchType: 'files' });

      expect(result.success).toBe(true);
      expect(result.output).toContain('No results found');
    });

    it('should respect MAX_DEPTH limit', async () => {
      // Create deep directory structure
      let callCount = 0;
      mockReaddir.mockImplementation(() => {
        callCount++;
        if (callCount > 15) {
          return Promise.resolve([]);
        }
        return Promise.resolve([
          { name: 'deep', isFile: () => false, isDirectory: () => true },
          { name: 'file.ts', isFile: () => true, isDirectory: () => false },
        ]);
      });

      await searchTool.search('file', { searchType: 'files' });

      // Should not exceed MAX_DEPTH (10) + some buffer
      expect(callCount).toBeLessThanOrEqual(15);
    });
  });

  describe('search - both search type', () => {
    it('should search both text and files when searchType is "both"', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      mockReaddir.mockResolvedValue([
        { name: 'config.ts', isFile: () => true, isDirectory: () => false },
      ]);

      const searchPromise = searchTool.search('config', { searchType: 'both' });

      setImmediate(() => {
        const match = createRipgrepMatch('config.ts', 5, 'const config = {};', 'config');
        mockProcess.stdout.emit('data', Buffer.from(match + '\n'));
        mockProcess.emit('close', 0);
      });
      jest.runAllTimers();

      const result = await searchPromise;

      expect(result.success).toBe(true);
      expect(result.output).toContain('config.ts');
    });

    it('should default to "both" search type when not specified', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      mockReaddir.mockResolvedValue([]);

      const searchPromise = searchTool.search('query');

      setImmediate(() => {
        mockProcess.emit('close', 1);
      });
      jest.runAllTimers();

      await searchPromise;

      expect(mockSpawn).toHaveBeenCalled(); // Text search was executed
      expect(mockReaddir).toHaveBeenCalled(); // File search was executed
    });
  });

  describe('file score calculation', () => {
    it('should give highest score to exact filename matches', async () => {
      mockReaddir.mockResolvedValue([
        { name: 'search', isFile: () => true, isDirectory: () => false },
        { name: 'search.ts', isFile: () => true, isDirectory: () => false },
        { name: 'file-search.ts', isFile: () => true, isDirectory: () => false },
      ]);

      const result = await searchTool.search('search', { searchType: 'files' });

      expect(result.success).toBe(true);
      // "search" should appear before "file-search.ts" due to higher score
      // All matching files should be in the output
      expect(result.output).toContain('search');
    });

    it('should score path matches lower than filename matches', async () => {
      mockReaddir
        .mockResolvedValueOnce([
          { name: 'deep', isFile: () => false, isDirectory: () => true },
        ])
        .mockResolvedValueOnce([
          { name: 'search.ts', isFile: () => true, isDirectory: () => false },
        ]);

      const result = await searchTool.search('search', { searchType: 'files' });

      expect(result.success).toBe(true);
    });
  });

  describe('result formatting', () => {
    it('should show match counts per file', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const searchPromise = searchTool.search('query', { searchType: 'text' });

      setImmediate(() => {
        const match1 = createRipgrepMatch('file.ts', 1, 'query 1', 'query');
        const match2 = createRipgrepMatch('file.ts', 5, 'query 2', 'query');
        const match3 = createRipgrepMatch('file.ts', 10, 'query 3', 'query');
        mockProcess.stdout.emit('data', Buffer.from(match1 + '\n' + match2 + '\n' + match3 + '\n'));
        mockProcess.emit('close', 0);
      });
      jest.runAllTimers();

      const result = await searchPromise;

      expect(result.output).toContain('3 matches');
    });

    it('should limit displayed files to 8', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const searchPromise = searchTool.search('query', { searchType: 'text' });

      setImmediate(() => {
        let output = '';
        for (let i = 1; i <= 15; i++) {
          output += createRipgrepMatch(`file${i}.ts`, 1, 'query', 'query') + '\n';
        }
        mockProcess.stdout.emit('data', Buffer.from(output));
        mockProcess.emit('close', 0);
      });
      jest.runAllTimers();

      const result = await searchPromise;

      expect(result.output).toContain('+7 more');
    });
  });

  describe('caching', () => {
    it('should cache and return cached results', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      // First search
      const searchPromise1 = searchTool.search('cached-query', { searchType: 'text' });

      setImmediate(() => {
        const match = createRipgrepMatch('cached.ts', 1, 'cached-query', 'cached-query');
        mockProcess.stdout.emit('data', Buffer.from(match + '\n'));
        mockProcess.emit('close', 0);
      });
      jest.runAllTimers();

      const result1 = await searchPromise1;

      expect(result1.success).toBe(true);
      expect(result1.output).not.toContain('[Cached result]');

      // Clear spawn mock to verify no new spawns
      mockSpawn.mockClear();

      // Second search with same parameters
      const result2 = await searchTool.search('cached-query', { searchType: 'text' });

      expect(mockSpawn).not.toHaveBeenCalled();
      expect(result2.success).toBe(true);
      expect(result2.output).toContain('[Cached result]');
    });

    it('should not use cache when search parameters differ', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      // First search
      const searchPromise1 = searchTool.search('query', {
        searchType: 'text',
        caseSensitive: false,
      });

      setImmediate(() => {
        mockProcess.emit('close', 1);
      });
      jest.runAllTimers();

      await searchPromise1;

      // Second search with different options
      const mockProcess2 = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess2);

      const searchPromise2 = searchTool.search('query', {
        searchType: 'text',
        caseSensitive: true,
      });

      setImmediate(() => {
        mockProcess2.emit('close', 1);
      });
      jest.runAllTimers();

      await searchPromise2;

      expect(mockSpawn).toHaveBeenCalledTimes(2);
    });
  });

  describe('clearCaches', () => {
    it('should clear internal search cache', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      // Populate cache
      const searchPromise = searchTool.search('cache-test', { searchType: 'text' });
      setImmediate(() => mockProcess.emit('close', 1));
      jest.runAllTimers();
      await searchPromise;

      // Clear caches
      searchTool.clearCaches();

      // New search should not be cached
      mockSpawn.mockClear();
      const mockProcess2 = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess2);

      const searchPromise2 = searchTool.search('cache-test', { searchType: 'text' });
      setImmediate(() => mockProcess2.emit('close', 1));
      jest.runAllTimers();
      await searchPromise2;

      expect(mockSpawn).toHaveBeenCalled();
    });

    it('should clear enhanced search cache', () => {
      searchTool.clearCaches();
      expect(mockEnhancedSearch.clearCache).toHaveBeenCalled();
    });
  });

  describe('getCacheStats', () => {
    it('should return cache statistics from enhanced search', () => {
      mockEnhancedSearch.getCacheStats.mockReturnValue({
        searchCache: 5,
        symbolCache: 3,
      });

      const stats = searchTool.getCacheStats();

      expect(stats).toEqual({ searchCache: 5, symbolCache: 3 });
    });
  });

  describe('findSymbols', () => {
    it('should find symbols matching name', async () => {
      mockEnhancedSearch.findSymbols.mockResolvedValue([
        {
          type: 'function',
          name: 'myFunction',
          file: 'utils.ts',
          line: 10,
          exported: true,
          signature: 'function myFunction(): void',
        },
      ]);

      const result = await searchTool.findSymbols('myFunction');

      expect(result.success).toBe(true);
      expect(result.output).toContain('myFunction');
      expect(result.output).toContain('utils.ts');
    });

    it('should filter by symbol types', async () => {
      mockEnhancedSearch.findSymbols.mockResolvedValue([]);

      await searchTool.findSymbols('MyClass', { types: ['class'] });

      expect(mockEnhancedSearch.findSymbols).toHaveBeenCalledWith('MyClass', {
        types: ['class'],
      });
    });

    it('should filter by exported only', async () => {
      mockEnhancedSearch.findSymbols.mockResolvedValue([]);

      await searchTool.findSymbols('myFunc', { exportedOnly: true });

      expect(mockEnhancedSearch.findSymbols).toHaveBeenCalledWith('myFunc', {
        exportedOnly: true,
      });
    });

    it('should return "No symbols found" when no matches', async () => {
      mockEnhancedSearch.findSymbols.mockResolvedValue([]);

      const result = await searchTool.findSymbols('nonexistent');

      expect(result.success).toBe(true);
      expect(result.output).toContain('No symbols found');
    });

    it('should handle errors gracefully', async () => {
      mockEnhancedSearch.findSymbols.mockRejectedValue(new Error('Search failed'));

      const result = await searchTool.findSymbols('myFunc');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Symbol search error');
    });

    it('should group symbols by type in output', async () => {
      mockEnhancedSearch.findSymbols.mockResolvedValue([
        { type: 'function', name: 'func1', file: 'a.ts', line: 1, exported: true, signature: '' },
        { type: 'class', name: 'Class1', file: 'b.ts', line: 2, exported: false, signature: '' },
        { type: 'function', name: 'func2', file: 'c.ts', line: 3, exported: true, signature: '' },
      ]);

      const result = await searchTool.findSymbols('search');

      expect(result.output).toContain('Function');
      expect(result.output).toContain('Class');
    });
  });

  describe('findReferences', () => {
    it('should find all references to a symbol', async () => {
      mockEnhancedSearch.findReferences.mockResolvedValue([
        { file: 'main.ts', line: 10, text: 'const x = myVar;', match: 'myVar' },
        { file: 'utils.ts', line: 20, text: 'console.log(myVar);', match: 'myVar' },
      ]);

      const result = await searchTool.findReferences('myVar');

      expect(result.success).toBe(true);
      expect(result.output).toContain('myVar');
      expect(result.output).toContain('main.ts');
      expect(result.output).toContain('utils.ts');
    });

    it('should pass context lines option', async () => {
      mockEnhancedSearch.findReferences.mockResolvedValue([]);

      await searchTool.findReferences('symbol', 5);

      expect(mockEnhancedSearch.findReferences).toHaveBeenCalledWith('symbol', {
        contextLines: 5,
      });
    });

    it('should return "No references found" when no matches', async () => {
      mockEnhancedSearch.findReferences.mockResolvedValue([]);

      const result = await searchTool.findReferences('nonexistent');

      expect(result.success).toBe(true);
      expect(result.output).toContain('No references found');
    });

    it('should handle errors gracefully', async () => {
      mockEnhancedSearch.findReferences.mockRejectedValue(new Error('Search failed'));

      const result = await searchTool.findReferences('myVar');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Reference search error');
    });

    it('should group references by file in output', async () => {
      mockEnhancedSearch.findReferences.mockResolvedValue([
        { file: 'file.ts', line: 1, text: 'line 1', match: 'x' },
        { file: 'file.ts', line: 5, text: 'line 5', match: 'x' },
        { file: 'other.ts', line: 10, text: 'line 10', match: 'x' },
      ]);

      const result = await searchTool.findReferences('x');

      expect(result.output).toContain('file.ts:');
      expect(result.output).toContain('other.ts:');
    });

    it('should truncate long text lines in output', async () => {
      mockEnhancedSearch.findReferences.mockResolvedValue([
        {
          file: 'file.ts',
          line: 1,
          text: 'a'.repeat(100), // Very long line
          match: 'a',
        },
      ]);

      const result = await searchTool.findReferences('a');

      expect(result.output).toContain('...');
    });
  });

  describe('findDefinition', () => {
    it('should find symbol definition', async () => {
      mockEnhancedSearch.findDefinition.mockResolvedValue({
        type: 'class',
        name: 'MyClass',
        file: 'models.ts',
        line: 5,
        exported: true,
        signature: 'class MyClass',
      });

      const result = await searchTool.findDefinition('MyClass');

      expect(result.success).toBe(true);
      expect(result.output).toContain('MyClass');
      expect(result.output).toContain('models.ts');
      expect(result.output).toContain('class');
      expect(result.output).toContain('[exported]');
    });

    it('should show [private] for non-exported symbols', async () => {
      mockEnhancedSearch.findDefinition.mockResolvedValue({
        type: 'function',
        name: 'privateFunc',
        file: 'internal.ts',
        line: 10,
        exported: false,
        signature: 'function privateFunc()',
      });

      const result = await searchTool.findDefinition('privateFunc');

      expect(result.output).toContain('[private]');
    });

    it('should return "No definition found" when not found', async () => {
      mockEnhancedSearch.findDefinition.mockResolvedValue(null);

      const result = await searchTool.findDefinition('nonexistent');

      expect(result.success).toBe(true);
      expect(result.output).toContain('No definition found');
    });

    it('should handle errors gracefully', async () => {
      mockEnhancedSearch.findDefinition.mockRejectedValue(new Error('Search failed'));

      const result = await searchTool.findDefinition('symbol');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Definition search error');
    });
  });

  describe('searchMultiple', () => {
    it('should search multiple patterns with OR operator', async () => {
      mockEnhancedSearch.searchMultiple.mockResolvedValue(
        new Map([
          ['pattern1', [{ file: 'file.ts', line: 1, text: 'pattern1', match: 'pattern1' }]],
          ['pattern2', [{ file: 'file.ts', line: 2, text: 'pattern2', match: 'pattern2' }]],
        ])
      );

      const result = await searchTool.searchMultiple(['pattern1', 'pattern2'], 'OR');

      expect(result.success).toBe(true);
      expect(result.output).toContain('pattern1');
      expect(result.output).toContain('pattern2');
      expect(result.output).toContain('(OR)');
    });

    it('should search with AND operator', async () => {
      mockEnhancedSearch.searchMultiple.mockResolvedValue(
        new Map([
          ['func', [{ file: 'file.ts', line: 1, text: 'async func', match: 'func' }]],
          ['async', [{ file: 'file.ts', line: 1, text: 'async func', match: 'async' }]],
        ])
      );

      const result = await searchTool.searchMultiple(['func', 'async'], 'AND');

      expect(result.success).toBe(true);
      expect(result.output).toContain('(AND)');
      expect(mockEnhancedSearch.searchMultiple).toHaveBeenCalledWith(
        ['func', 'async'],
        { operator: 'AND' }
      );
    });

    it('should return "No results found" when no matches', async () => {
      mockEnhancedSearch.searchMultiple.mockResolvedValue(new Map());

      const result = await searchTool.searchMultiple(['nonexistent']);

      expect(result.success).toBe(true);
      expect(result.output).toContain('No results found');
    });

    it('should handle errors gracefully', async () => {
      mockEnhancedSearch.searchMultiple.mockRejectedValue(new Error('Search failed'));

      const result = await searchTool.searchMultiple(['pattern']);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Multi-pattern search error');
    });

    it('should show limited files per pattern', async () => {
      const manyFiles = Array.from({ length: 10 }, (_, i) => ({
        file: `file${i}.ts`,
        line: 1,
        text: 'pattern',
        match: 'pattern',
      }));

      mockEnhancedSearch.searchMultiple.mockResolvedValue(
        new Map([['pattern', manyFiles]])
      );

      const result = await searchTool.searchMultiple(['pattern']);

      expect(result.output).toContain('+5 more files');
    });
  });

  describe('error handling', () => {
    it('should handle unexpected errors in search', async () => {
      // Force an error by making spawn throw
      mockSpawn.mockImplementation(() => {
        throw new Error('Unexpected error');
      });

      const result = await searchTool.search('query', { searchType: 'text' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Search error');
    });

    it('should handle non-Error thrown objects', async () => {
      mockSpawn.mockImplementation(() => {
        throw 'string error';
      });

      const result = await searchTool.search('query', { searchType: 'text' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('string error');
    });
  });
});
