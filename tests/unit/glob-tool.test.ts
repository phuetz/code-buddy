/**
 * Unit tests for Glob/File Search functionality
 *
 * Tests the file search capabilities within SearchTool (findFilesByPattern)
 * which implements glob-like pattern matching for finding files.
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

interface MockDirEntry {
  name: string;
  isFile: () => boolean;
  isDirectory: () => boolean;
}

function createFileEntry(name: string): MockDirEntry {
  return { name, isFile: () => true, isDirectory: () => false };
}

function createDirEntry(name: string): MockDirEntry {
  return { name, isFile: () => false, isDirectory: () => true };
}

describe('Glob/File Search Tool', () => {
  let searchTool: SearchTool;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    searchTool = new SearchTool();
    searchTool.setCurrentDirectory('/test/project');
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('File Pattern Matching', () => {
    it('should find files matching exact name', async () => {
      mockReaddir.mockResolvedValue([
        createFileEntry('config.ts'),
        createFileEntry('config.json'),
        createFileEntry('utils.ts'),
      ]);

      const result = await searchTool.search('config', { searchType: 'files' });
      expect(result.success).toBe(true);
      expect(result.output).toContain('config');
    });

    it('should find files with partial name match', async () => {
      mockReaddir.mockResolvedValue([
        createFileEntry('search-tool.ts'),
        createFileEntry('search-utils.ts'),
        createFileEntry('bash-tool.ts'),
      ]);

      const result = await searchTool.search('search', { searchType: 'files' });
      expect(result.success).toBe(true);
      expect(result.output).toContain('search');
    });

    it('should perform case-insensitive matching', async () => {
      mockReaddir.mockResolvedValue([
        createFileEntry('SearchTool.ts'),
        createFileEntry('SEARCH_UTIL.ts'),
        createFileEntry('search.ts'),
      ]);

      const result = await searchTool.search('SEARCH', { searchType: 'files' });
      expect(result.success).toBe(true);
    });

    it('should return no results when pattern does not match', async () => {
      mockReaddir.mockResolvedValue([
        createFileEntry('apple.ts'),
        createFileEntry('banana.ts'),
      ]);

      const result = await searchTool.search('xyz123', { searchType: 'files' });
      expect(result.success).toBe(true);
      expect(result.output).toContain('No results found');
    });
  });

  describe('Directory Traversal', () => {
    it('should traverse into subdirectories', async () => {
      mockReaddir
        .mockResolvedValueOnce([createDirEntry('src'), createFileEntry('package.json')])
        .mockResolvedValueOnce([createFileEntry('index.ts')]);

      const result = await searchTool.search('index', { searchType: 'files' });
      expect(result.success).toBe(true);
      expect(mockReaddir).toHaveBeenCalledTimes(2);
    });

    it('should respect MAX_DEPTH limit', async () => {
      let depth = 0;
      mockReaddir.mockImplementation(() => {
        depth++;
        if (depth > 15) return Promise.resolve([]);
        return Promise.resolve([createDirEntry('deep'), createFileEntry('file.ts')]);
      });

      await searchTool.search('file', { searchType: 'files' });
      expect(depth).toBeLessThanOrEqual(15);
    });

    it('should skip node_modules directory', async () => {
      mockReaddir.mockResolvedValue([
        createDirEntry('src'),
        createDirEntry('node_modules'),
        createFileEntry('package.json'),
      ]);

      await searchTool.search('file', { searchType: 'files' });
      const calls = mockReaddir.mock.calls;
      const calledPaths = calls.map(call => call[0]);
      expect(calledPaths.some((p: string) => p.includes('node_modules'))).toBe(false);
    });

    it('should skip common build directories', async () => {
      const buildDirs = ['node_modules', '.git', '.svn', 'dist', 'build', '.next', '.cache'];
      mockReaddir.mockResolvedValue([
        ...buildDirs.map(name => createDirEntry(name)),
        createFileEntry('index.ts'),
      ]);

      await searchTool.search('index', { searchType: 'files' });
      expect(mockReaddir).toHaveBeenCalledTimes(1);
    });
  });

  describe('Hidden Files', () => {
    it('should skip hidden files by default', async () => {
      mockReaddir.mockResolvedValue([
        createFileEntry('.env'),
        createFileEntry('.gitignore'),
        createFileEntry('config.ts'),
      ]);

      const result = await searchTool.search('env', { searchType: 'files' });
      expect(result.success).toBe(true);
      expect(result.output).not.toContain('.env');
    });

    it('should include hidden files when includeHidden is true', async () => {
      mockReaddir.mockResolvedValue([
        createFileEntry('.env'),
        createFileEntry('config.ts'),
      ]);

      const result = await searchTool.search('env', { searchType: 'files', includeHidden: true });
      expect(result.success).toBe(true);
      expect(result.output).toContain('.env');
    });
  });

  describe('Result Limiting', () => {
    it('should limit results to maxResults option', async () => {
      const manyFiles = Array.from({ length: 100 }, (_, i) => createFileEntry(`file${i}.ts`));
      mockReaddir.mockResolvedValue(manyFiles);

      const result = await searchTool.search('file', { searchType: 'files', maxResults: 10 });
      expect(result.success).toBe(true);
    });

    it('should handle search with many directories', async () => {
      let callCount = 0;
      mockReaddir.mockImplementation(() => {
        callCount++;
        return Promise.resolve([
          createDirEntry('subdir'),
          ...Array.from({ length: 20 }, (_, i) => createFileEntry(`file${callCount}_${i}.ts`)),
        ]);
      });

      await searchTool.search('file', { searchType: 'files', maxResults: 30 });
      // Should process some directories but not infinitely
      expect(callCount).toBeLessThanOrEqual(20);
    });
  });

  describe('Exclude Pattern', () => {
    it('should exclude files matching excludePattern', async () => {
      mockReaddir.mockResolvedValue([
        createFileEntry('search.ts'),
        createFileEntry('search.test.ts'),
        createFileEntry('search.spec.ts'),
      ]);

      const result = await searchTool.search('search', { searchType: 'files', excludePattern: 'test' });
      expect(result.success).toBe(true);
      expect(result.output).not.toContain('test');
    });
  });

  describe('Error Handling', () => {
    it('should handle directory read errors gracefully', async () => {
      mockReaddir.mockRejectedValue(new Error('Permission denied'));

      const result = await searchTool.search('file', { searchType: 'files' });
      expect(result.success).toBe(true);
      expect(result.output).toContain('No results found');
    });

    it('should handle empty directories', async () => {
      mockReaddir.mockResolvedValue([]);

      const result = await searchTool.search('file', { searchType: 'files' });
      expect(result.success).toBe(true);
      expect(result.output).toContain('No results found');
    });
  });

  describe('Combined Search', () => {
    it('should search both files and text when searchType is both', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);
      mockReaddir.mockResolvedValue([createFileEntry('config.ts')]);

      const searchPromise = searchTool.search('config', { searchType: 'both' });
      setImmediate(() => mockProcess.emit('close', 1));
      jest.runAllTimers();

      const result = await searchPromise;
      expect(result.success).toBe(true);
      expect(mockReaddir).toHaveBeenCalled();
      expect(mockSpawn).toHaveBeenCalled();
    });
  });

  describe('Current Directory', () => {
    it('should search from current directory', async () => {
      searchTool.setCurrentDirectory('/custom/path');
      mockReaddir.mockResolvedValue([createFileEntry('file.ts')]);

      await searchTool.search('file', { searchType: 'files' });
      expect(mockReaddir).toHaveBeenCalledWith('/custom/path', expect.any(Object));
    });
  });

  describe('Special Characters', () => {
    it('should handle files with spaces in names', async () => {
      mockReaddir.mockResolvedValue([createFileEntry('my file.ts'), createFileEntry('another file.ts')]);

      const result = await searchTool.search('file', { searchType: 'files' });
      expect(result.success).toBe(true);
    });

    it('should handle files with unicode characters', async () => {
      mockReaddir.mockResolvedValue([createFileEntry('\u4E2D\u6587.ts'), createFileEntry('normal.ts')]);

      const result = await searchTool.search('\u4E2D', { searchType: 'files' });
      expect(result.success).toBe(true);
    });
  });
});
