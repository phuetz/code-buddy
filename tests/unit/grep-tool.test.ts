/**
 * Unit tests for Grep/Text Search functionality
 *
 * Tests the text search capabilities within SearchTool (executeRipgrep)
 * which uses ripgrep for fast file content searching.
 *
 * Note: These tests focus on verifying that the correct arguments are passed
 * to ripgrep. The async behavior is tested in search-tool.test.ts.
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

// Sample ripgrep JSON output for testing
const createRipgrepOutput = (matches: Array<{ file: string; line: number; column: number; text: string; match: string }>) => {
  return matches
    .map(
      (m) =>
        JSON.stringify({
          type: 'match',
          data: {
            path: { text: m.file },
            line_number: m.line,
            lines: { text: m.text },
            submatches: [{ start: m.column, match: { text: m.match } }],
          },
        })
    )
    .join('\n');
};

describe('Grep/Text Search Tool', () => {
  let searchTool: SearchTool;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    searchTool = new SearchTool();
    searchTool.setCurrentDirectory('/test/project');
    mockReaddir.mockResolvedValue([]);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('Basic Text Search', () => {
    it('should execute ripgrep search and return results', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const searchPromise = searchTool.search('function', { searchType: 'text' });

      setImmediate(() => {
        mockProcess.stdout.emit(
          'data',
          createRipgrepOutput([
            { file: 'src/utils.ts', line: 10, column: 0, text: 'function helper() {', match: 'function' },
            { file: 'src/main.ts', line: 5, column: 7, text: 'export function main() {', match: 'function' },
          ])
        );
        mockProcess.emit('close', 0);
      });

      jest.runAllTimers();
      const result = await searchPromise;

      expect(result.success).toBe(true);
      expect(result.output).toContain('function');
      // Verify spawn was called with the query in args
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('--json');
      expect(args).toContain('function');
    });

    it('should handle no matches found', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const searchPromise = searchTool.search('nonexistent_pattern', { searchType: 'text' });

      setImmediate(() => {
        mockProcess.emit('close', 1); // Code 1 means no matches
      });

      jest.runAllTimers();
      const result = await searchPromise;

      expect(result.success).toBe(true);
      expect(result.output).toContain('No results found');
    });

    it('should include file name in output', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const searchPromise = searchTool.search('test', { searchType: 'text' });

      setImmediate(() => {
        mockProcess.stdout.emit(
          'data',
          createRipgrepOutput([{ file: 'test.ts', line: 42, column: 0, text: 'test case', match: 'test' }])
        );
        mockProcess.emit('close', 0);
      });

      jest.runAllTimers();
      const result = await searchPromise;

      expect(result.success).toBe(true);
      // Output format shows file name with match count
      expect(result.output).toContain('test.ts');
    });
  });

  describe('Search Options - Arguments Check', () => {
    it('should use case-insensitive search by default', () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      // Start search (don't await - just check spawn args)
      searchTool.search('TEST', { searchType: 'text' });

      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('--ignore-case');
    });

    it('should use case-sensitive search when specified', () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      searchTool.search('Test', { searchType: 'text', caseSensitive: true });

      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).not.toContain('--ignore-case');
    });

    it('should use whole word matching when specified', () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      searchTool.search('test', { searchType: 'text', wholeWord: true });

      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('--word-regexp');
    });

    it('should use fixed-strings by default', () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      searchTool.search('test.pattern', { searchType: 'text' });

      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('--fixed-strings');
    });

    it('should not use fixed-strings when regex mode is enabled', () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      searchTool.search('test.*pattern', { searchType: 'text', regex: true });

      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).not.toContain('--fixed-strings');
    });

    it('should apply max results limit', () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      searchTool.search('test', { searchType: 'text', maxResults: 50 });

      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('--max-count');
      expect(args).toContain('50');
    });
  });

  describe('File Type Filters - Arguments Check', () => {
    it('should filter by file type', () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      searchTool.search('test', { searchType: 'text', fileTypes: ['ts', 'js'] });

      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('--type');
      expect(args.filter(a => a === '--type').length).toBe(2);
    });

    it('should apply include pattern', () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      searchTool.search('test', { searchType: 'text', includePattern: '*.tsx' });

      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('--glob');
      expect(args).toContain('*.tsx');
    });

    it('should apply exclude pattern', () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      searchTool.search('test', { searchType: 'text', excludePattern: '*.test.ts' });

      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('--glob');
      expect(args).toContain('!*.test.ts');
    });

    it('should exclude specific files', () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      searchTool.search('test', {
        searchType: 'text',
        excludeFiles: ['package-lock.json', 'yarn.lock'],
      });

      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('!package-lock.json');
      expect(args).toContain('!yarn.lock');
    });
  });

  describe('Default Exclusions', () => {
    it('should exclude .git directory', () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      searchTool.search('test', { searchType: 'text' });

      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('!.git/**');
    });

    it('should exclude node_modules directory', () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      searchTool.search('test', { searchType: 'text' });

      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('!node_modules/**');
    });

    it('should exclude log files', () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      searchTool.search('test', { searchType: 'text' });

      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('!*.log');
    });
  });

  describe('Error Handling', () => {
    it('should handle ripgrep errors gracefully', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const searchPromise = searchTool.search('test', { searchType: 'text' });

      setImmediate(() => {
        mockProcess.stderr.emit('data', 'Some error occurred');
        mockProcess.emit('close', 2); // Error exit code
      });

      jest.runAllTimers();
      const result = await searchPromise;

      expect(result.success).toBe(false);
      expect(result.error).toContain('Ripgrep failed');
    });

    it('should handle spawn errors', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const searchPromise = searchTool.search('test', { searchType: 'text' });

      setImmediate(() => {
        mockProcess.emit('error', new Error('Spawn error'));
      });

      jest.runAllTimers();
      const result = await searchPromise;

      expect(result.success).toBe(false);
      expect(result.error).toContain('Spawn error');
    });

    it('should handle malformed JSON in output', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const searchPromise = searchTool.search('test', { searchType: 'text' });

      setImmediate(() => {
        mockProcess.stdout.emit('data', 'not valid json\n{also not valid');
        mockProcess.emit('close', 0);
      });

      jest.runAllTimers();
      const result = await searchPromise;

      // Should handle gracefully, either with no results or partial results
      expect(result.success).toBe(true);
    });
  });

  describe('Output Parsing', () => {
    it('should parse ripgrep JSON output correctly', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const searchPromise = searchTool.search('import', { searchType: 'text' });

      setImmediate(() => {
        mockProcess.stdout.emit(
          'data',
          createRipgrepOutput([
            { file: 'src/index.ts', line: 1, column: 0, text: "import fs from 'fs';", match: 'import' },
            { file: 'src/utils.ts', line: 3, column: 0, text: "import path from 'path';", match: 'import' },
          ])
        );
        mockProcess.emit('close', 0);
      });

      jest.runAllTimers();
      const result = await searchPromise;

      expect(result.success).toBe(true);
      expect(result.output).toContain('src/index.ts');
      expect(result.output).toContain('src/utils.ts');
    });

    it('should handle empty submatches', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const searchPromise = searchTool.search('test', { searchType: 'text' });

      setImmediate(() => {
        mockProcess.stdout.emit(
          'data',
          JSON.stringify({
            type: 'match',
            data: {
              path: { text: 'file.ts' },
              line_number: 1,
              lines: { text: 'test line' },
              submatches: [],
            },
          })
        );
        mockProcess.emit('close', 0);
      });

      jest.runAllTimers();
      const result = await searchPromise;

      expect(result.success).toBe(true);
    });

    it('should handle summary messages in output', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const searchPromise = searchTool.search('test', { searchType: 'text' });

      setImmediate(() => {
        mockProcess.stdout.emit(
          'data',
          [
            createRipgrepOutput([{ file: 'file.ts', line: 1, column: 0, text: 'test', match: 'test' }]),
            JSON.stringify({ type: 'summary', data: { elapsed_total: { secs: 0, nanos: 123456 } } }),
          ].join('\n')
        );
        mockProcess.emit('close', 0);
      });

      jest.runAllTimers();
      const result = await searchPromise;

      expect(result.success).toBe(true);
    });
  });

  describe('Current Directory', () => {
    it('should search in the current directory', () => {
      searchTool.setCurrentDirectory('/custom/search/path');
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      searchTool.search('test', { searchType: 'text' });

      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('/custom/search/path');
    });
  });

  describe('Binary Path Handling', () => {
    it('should use ripgrep binary path from @vscode/ripgrep', () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      searchTool.search('test', { searchType: 'text' });

      const binaryPath = mockSpawn.mock.calls[0][0] as string;
      expect(binaryPath).toContain('rg');
    });
  });

  describe('Special Characters', () => {
    it('should handle queries with special regex characters', () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      searchTool.search('test.pattern()', { searchType: 'text' });

      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('--fixed-strings');
      expect(args).toContain('test.pattern()');
    });

    it('should handle unicode in queries', () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      searchTool.search('\u4E2D\u6587\u67E5\u8BE2', { searchType: 'text' });

      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('\u4E2D\u6587\u67E5\u8BE2');
    });
  });

  describe('Large Output Handling', () => {
    it('should handle multiple data chunks', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const searchPromise = searchTool.search('test', { searchType: 'text' });

      setImmediate(() => {
        // Send data in multiple chunks
        mockProcess.stdout.emit(
          'data',
          createRipgrepOutput([{ file: 'file1.ts', line: 1, column: 0, text: 'test1', match: 'test' }])
        );
        mockProcess.stdout.emit(
          'data',
          '\n' + createRipgrepOutput([{ file: 'file2.ts', line: 2, column: 0, text: 'test2', match: 'test' }])
        );
        mockProcess.emit('close', 0);
      });

      jest.runAllTimers();
      const result = await searchPromise;

      expect(result.success).toBe(true);
      expect(result.output).toContain('file1.ts');
      expect(result.output).toContain('file2.ts');
    });
  });

  describe('Combined Search Mode', () => {
    it('should search both files and text when searchType is both', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);
      mockReaddir.mockResolvedValue([{ name: 'config.ts', isFile: () => true, isDirectory: () => false }]);

      const searchPromise = searchTool.search('config', { searchType: 'both' });

      setImmediate(() => {
        mockProcess.emit('close', 1);
      });

      jest.runAllTimers();
      const result = await searchPromise;

      expect(result.success).toBe(true);
      expect(mockSpawn).toHaveBeenCalled();
      expect(mockReaddir).toHaveBeenCalled();
    });
  });
});
