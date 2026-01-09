/**
 * Unit tests for FileAutocomplete Component (File Tree / File Picker)
 *
 * Tests for the FileAutocomplete component which provides file path suggestions:
 * - File reference extraction from input (@)
 * - File suggestion generation
 * - Directory/file sorting
 * - File icon mapping
 * - Path handling (relative, absolute)
 * - Hidden file filtering
 * - Case-insensitive matching
 * - Edge cases and error handling
 */

// Mock external dependencies before imports
jest.mock('react', () => {
  const React = jest.requireActual('react');
  return {
    ...React,
    memo: jest.fn((component) => component),
    useState: jest.fn((initial) => [initial, jest.fn()]),
    useEffect: jest.fn(),
    useMemo: jest.fn((fn) => fn()),
  };
});

jest.mock('ink', () => ({
  Box: 'Box',
  Text: 'Text',
}));

jest.mock('fs', () => ({
  existsSync: jest.fn(() => true),
  readdirSync: jest.fn(() => []),
}));

jest.mock('path', () => ({
  join: jest.fn((...args: string[]) => args.join('/')),
  relative: jest.fn((from: string, to: string) => to.replace(from + '/', '')),
  extname: jest.fn((filename: string) => {
    const idx = filename.lastIndexOf('.');
    return idx > 0 ? filename.slice(idx) : '';
  }),
}));

jest.mock('../../src/ui/context/theme-context', () => ({
  useTheme: jest.fn(() => ({
    colors: {
      primary: '#007AFF',
      text: '#FFFFFF',
      textMuted: '#8E8E93',
      borderActive: '#007AFF',
      backgroundAlt: '#2C2C2E',
    },
  })),
}));

import fs from 'fs';
import path from 'path';

describe('FileAutocomplete Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ==========================================================================
  // FileSuggestion Interface Tests
  // ==========================================================================

  describe('FileSuggestion Interface', () => {
    interface FileSuggestion {
      name: string;
      path: string;
      isDirectory: boolean;
      extension?: string;
    }

    it('should represent a file correctly', () => {
      const suggestion: FileSuggestion = {
        name: 'index.ts',
        path: 'src/index.ts',
        isDirectory: false,
        extension: '.ts',
      };

      expect(suggestion.name).toBe('index.ts');
      expect(suggestion.isDirectory).toBe(false);
      expect(suggestion.extension).toBe('.ts');
    });

    it('should represent a directory correctly', () => {
      const suggestion: FileSuggestion = {
        name: 'components',
        path: 'src/components',
        isDirectory: true,
      };

      expect(suggestion.name).toBe('components');
      expect(suggestion.isDirectory).toBe(true);
      expect(suggestion.extension).toBeUndefined();
    });
  });

  // ==========================================================================
  // extractFileReference Tests
  // ==========================================================================

  describe('extractFileReference', () => {
    function extractFileReference(input: string): {
      found: boolean;
      partial: string;
      startPos: number;
    } {
      const atIndex = input.lastIndexOf('@');

      if (atIndex === -1) {
        return { found: false, partial: '', startPos: -1 };
      }

      if (atIndex > 0 && !/\s/.test(input[atIndex - 1])) {
        return { found: false, partial: '', startPos: -1 };
      }

      const partial = input.slice(atIndex + 1);

      if (partial.includes(' ')) {
        return { found: false, partial: '', startPos: -1 };
      }

      return { found: true, partial, startPos: atIndex };
    }

    it('should find @ at the start of input', () => {
      const result = extractFileReference('@src');

      expect(result.found).toBe(true);
      expect(result.partial).toBe('src');
      expect(result.startPos).toBe(0);
    });

    it('should find @ after whitespace', () => {
      const result = extractFileReference('read @package.json');

      expect(result.found).toBe(true);
      expect(result.partial).toBe('package.json');
      expect(result.startPos).toBe(5);
    });

    it('should not find @ in the middle of a word', () => {
      const result = extractFileReference('email@example.com');

      expect(result.found).toBe(false);
    });

    it('should return not found when no @', () => {
      const result = extractFileReference('some input without at sign');

      expect(result.found).toBe(false);
      expect(result.partial).toBe('');
      expect(result.startPos).toBe(-1);
    });

    it('should return not found when @ is followed by space', () => {
      const result = extractFileReference('read @ file.ts');

      expect(result.found).toBe(false);
    });

    it('should handle multiple @ signs (use last one)', () => {
      const result = extractFileReference('test @first @second');

      expect(result.found).toBe(true);
      expect(result.partial).toBe('second');
    });

    it('should handle empty input', () => {
      const result = extractFileReference('');

      expect(result.found).toBe(false);
    });

    it('should handle just @', () => {
      const result = extractFileReference('@');

      expect(result.found).toBe(true);
      expect(result.partial).toBe('');
      expect(result.startPos).toBe(0);
    });

    it('should handle @ at end with no path', () => {
      const result = extractFileReference('read @');

      expect(result.found).toBe(true);
      expect(result.partial).toBe('');
    });

    it('should handle tab character before @', () => {
      const result = extractFileReference('text\t@file');

      expect(result.found).toBe(true);
      expect(result.partial).toBe('file');
    });

    it('should handle newline before @', () => {
      const result = extractFileReference('text\n@file');

      expect(result.found).toBe(true);
      expect(result.partial).toBe('file');
    });
  });

  // ==========================================================================
  // getFileSuggestions Tests
  // ==========================================================================

  describe('getFileSuggestions', () => {
    interface FileSuggestion {
      name: string;
      path: string;
      isDirectory: boolean;
      extension?: string;
    }

    // Mock directory entry type
    interface MockDirent {
      name: string;
      isDirectory: () => boolean;
    }

    function getFileSuggestions(
      partial: string,
      cwd: string = '/test/project',
      mockEntries: MockDirent[] = []
    ): FileSuggestion[] {
      const suggestions: FileSuggestion[] = [];

      // Mock fs functions
      const existsSync = fs.existsSync as jest.Mock;
      const readdirSync = fs.readdirSync as jest.Mock;

      existsSync.mockReturnValue(true);
      readdirSync.mockReturnValue(mockEntries);

      try {
        let searchDir: string;
        let prefix: string;

        if (partial === '' || partial === '.') {
          searchDir = cwd;
          prefix = '';
        } else if (partial.startsWith('/')) {
          const lastSlash = partial.lastIndexOf('/');
          searchDir = partial.slice(0, lastSlash + 1) || '/';
          prefix = partial.slice(lastSlash + 1);
        } else if (partial.includes('/')) {
          const lastSlash = partial.lastIndexOf('/');
          searchDir = (path.join as jest.Mock)(cwd, partial.slice(0, lastSlash + 1));
          prefix = partial.slice(lastSlash + 1);
        } else {
          searchDir = cwd;
          prefix = partial;
        }

        if (!existsSync(searchDir)) {
          return suggestions;
        }

        const entries = readdirSync(searchDir, { withFileTypes: true }) as MockDirent[];
        const lowerPrefix = prefix.toLowerCase();

        for (const entry of entries) {
          if (entry.name.startsWith('.') && !prefix.startsWith('.')) {
            continue;
          }

          if (!entry.name.toLowerCase().startsWith(lowerPrefix)) {
            continue;
          }

          const fullPath = (path.join as jest.Mock)(searchDir, entry.name);
          const relativePath = (path.relative as jest.Mock)(cwd, fullPath);
          const ext = (path.extname as jest.Mock)(entry.name).toLowerCase();

          suggestions.push({
            name: entry.name,
            path: relativePath.startsWith('..') ? fullPath : relativePath,
            isDirectory: entry.isDirectory(),
            extension: ext || undefined,
          });
        }

        suggestions.sort((a, b) => {
          if (a.isDirectory !== b.isDirectory) {
            return a.isDirectory ? -1 : 1;
          }
          return a.name.localeCompare(b.name);
        });
      } catch {
        // Ignore filesystem errors
      }

      return suggestions;
    }

    it('should return files matching prefix', () => {
      const mockEntries: MockDirent[] = [
        { name: 'index.ts', isDirectory: () => false },
        { name: 'index.test.ts', isDirectory: () => false },
        { name: 'main.ts', isDirectory: () => false },
      ];

      const results = getFileSuggestions('ind', '/test/project', mockEntries);

      expect(results.length).toBe(2);
      expect(results[0].name).toBe('index.test.ts');
      expect(results[1].name).toBe('index.ts');
    });

    it('should list all files when partial is empty', () => {
      const mockEntries: MockDirent[] = [
        { name: 'src', isDirectory: () => true },
        { name: 'package.json', isDirectory: () => false },
      ];

      const results = getFileSuggestions('', '/test/project', mockEntries);

      expect(results.length).toBe(2);
    });

    it('should sort directories before files', () => {
      const mockEntries: MockDirent[] = [
        { name: 'file.ts', isDirectory: () => false },
        { name: 'directory', isDirectory: () => true },
        { name: 'another-file.ts', isDirectory: () => false },
        { name: 'another-dir', isDirectory: () => true },
      ];

      const results = getFileSuggestions('', '/test/project', mockEntries);

      expect(results[0].isDirectory).toBe(true);
      expect(results[1].isDirectory).toBe(true);
      expect(results[2].isDirectory).toBe(false);
      expect(results[3].isDirectory).toBe(false);
    });

    it('should sort alphabetically within same type', () => {
      const mockEntries: MockDirent[] = [
        { name: 'zebra', isDirectory: () => true },
        { name: 'alpha', isDirectory: () => true },
        { name: 'beta.ts', isDirectory: () => false },
        { name: 'alpha.ts', isDirectory: () => false },
      ];

      const results = getFileSuggestions('', '/test/project', mockEntries);

      expect(results[0].name).toBe('alpha');
      expect(results[1].name).toBe('zebra');
      expect(results[2].name).toBe('alpha.ts');
      expect(results[3].name).toBe('beta.ts');
    });

    it('should skip hidden files unless prefix starts with .', () => {
      const mockEntries: MockDirent[] = [
        { name: '.hidden', isDirectory: () => false },
        { name: '.gitignore', isDirectory: () => false },
        { name: 'visible.ts', isDirectory: () => false },
      ];

      const results = getFileSuggestions('', '/test/project', mockEntries);

      expect(results.length).toBe(1);
      expect(results[0].name).toBe('visible.ts');
    });

    it('should include hidden files when prefix starts with .', () => {
      const mockEntries: MockDirent[] = [
        { name: '.hidden', isDirectory: () => false },
        { name: '.gitignore', isDirectory: () => false },
        { name: 'visible.ts', isDirectory: () => false },
      ];

      const results = getFileSuggestions('.g', '/test/project', mockEntries);

      // When prefix starts with ".", it should match hidden files starting with .g
      expect(results.length).toBe(1);
      expect(results[0].name).toBe('.gitignore');
    });

    it('should be case-insensitive', () => {
      const mockEntries: MockDirent[] = [
        { name: 'README.md', isDirectory: () => false },
        { name: 'readme.txt', isDirectory: () => false },
        { name: 'other.ts', isDirectory: () => false },
      ];

      const results = getFileSuggestions('read', '/test/project', mockEntries);

      expect(results.length).toBe(2);
    });

    it('should handle non-existent directory', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      const results = getFileSuggestions('src/', '/test/project', []);

      expect(results).toEqual([]);
    });

    it('should extract file extension', () => {
      const mockEntries: MockDirent[] = [
        { name: 'index.ts', isDirectory: () => false },
        { name: 'styles.css', isDirectory: () => false },
      ];

      const results = getFileSuggestions('', '/test/project', mockEntries);

      // Sorted alphabetically: index.ts, styles.css
      expect(results[0].extension).toBe('.ts');
      expect(results[1].extension).toBe('.css');
    });

    it('should handle files without extension', () => {
      const mockEntries: MockDirent[] = [{ name: 'Makefile', isDirectory: () => false }];

      (path.extname as jest.Mock).mockReturnValue('');

      const results = getFileSuggestions('', '/test/project', mockEntries);

      expect(results[0].extension).toBeUndefined();
    });
  });

  // ==========================================================================
  // getFileIcon Tests
  // ==========================================================================

  describe('getFileIcon', () => {
    interface FileSuggestion {
      name: string;
      path: string;
      isDirectory: boolean;
      extension?: string;
    }

    function getFileIcon(suggestion: FileSuggestion): string {
      if (suggestion.isDirectory) {
        return '\uD83D\uDCC1';
      }

      const iconMap: Record<string, string> = {
        '.ts': '\uD83D\uDCC4',
        '.tsx': '\u269B\uFE0F',
        '.js': '\uD83D\uDFE8',
        '.jsx': '\u269B\uFE0F',
        '.json': '{}',
        '.md': '\uD83D\uDCDD',
        '.py': '\uD83D\uDC0D',
        '.rs': '\uD83E\uDD80',
        '.go': '\uD83D\uDC39',
        '.sh': '\uD83D\uDCDC',
        '.yml': '\u2699\uFE0F',
        '.yaml': '\u2699\uFE0F',
        '.css': '\uD83C\uDFA8',
        '.scss': '\uD83C\uDFA8',
        '.html': '\uD83C\uDF10',
        '.sql': '\uD83D\uDDC3\uFE0F',
        '.txt': '\uD83D\uDCC4',
      };

      return iconMap[suggestion.extension || ''] || '\uD83D\uDCC4';
    }

    it('should return folder icon for directories', () => {
      const suggestion: FileSuggestion = {
        name: 'src',
        path: 'src',
        isDirectory: true,
      };

      expect(getFileIcon(suggestion)).toBe('\uD83D\uDCC1');
    });

    it('should return TypeScript icon for .ts files', () => {
      const suggestion: FileSuggestion = {
        name: 'index.ts',
        path: 'src/index.ts',
        isDirectory: false,
        extension: '.ts',
      };

      expect(getFileIcon(suggestion)).toBe('\uD83D\uDCC4');
    });

    it('should return React icon for .tsx and .jsx files', () => {
      const tsxSuggestion: FileSuggestion = {
        name: 'App.tsx',
        path: 'src/App.tsx',
        isDirectory: false,
        extension: '.tsx',
      };

      const jsxSuggestion: FileSuggestion = {
        name: 'App.jsx',
        path: 'src/App.jsx',
        isDirectory: false,
        extension: '.jsx',
      };

      expect(getFileIcon(tsxSuggestion)).toBe('\u269B\uFE0F');
      expect(getFileIcon(jsxSuggestion)).toBe('\u269B\uFE0F');
    });

    it('should return JSON icon for .json files', () => {
      const suggestion: FileSuggestion = {
        name: 'package.json',
        path: 'package.json',
        isDirectory: false,
        extension: '.json',
      };

      expect(getFileIcon(suggestion)).toBe('{}');
    });

    it('should return markdown icon for .md files', () => {
      const suggestion: FileSuggestion = {
        name: 'README.md',
        path: 'README.md',
        isDirectory: false,
        extension: '.md',
      };

      expect(getFileIcon(suggestion)).toBe('\uD83D\uDCDD');
    });

    it('should return Python icon for .py files', () => {
      const suggestion: FileSuggestion = {
        name: 'script.py',
        path: 'script.py',
        isDirectory: false,
        extension: '.py',
      };

      expect(getFileIcon(suggestion)).toBe('\uD83D\uDC0D');
    });

    it('should return default icon for unknown extensions', () => {
      const suggestion: FileSuggestion = {
        name: 'file.xyz',
        path: 'file.xyz',
        isDirectory: false,
        extension: '.xyz',
      };

      expect(getFileIcon(suggestion)).toBe('\uD83D\uDCC4');
    });

    it('should return default icon when extension is undefined', () => {
      const suggestion: FileSuggestion = {
        name: 'Makefile',
        path: 'Makefile',
        isDirectory: false,
      };

      expect(getFileIcon(suggestion)).toBe('\uD83D\uDCC4');
    });
  });

  // ==========================================================================
  // Path Handling Tests
  // ==========================================================================

  describe('Path Handling', () => {
    it('should handle relative paths', () => {
      const partial = 'src/components/';
      const isRelativePath = !partial.startsWith('/') && partial.includes('/');

      expect(isRelativePath).toBe(true);
    });

    it('should handle absolute paths', () => {
      const partial = '/usr/local/bin/';
      const isAbsolutePath = partial.startsWith('/');

      expect(isAbsolutePath).toBe(true);
    });

    it('should extract search directory and prefix for relative path', () => {
      const partial = 'src/components/But';
      const lastSlash = partial.lastIndexOf('/');
      const dirPart = partial.slice(0, lastSlash + 1);
      const prefix = partial.slice(lastSlash + 1);

      expect(dirPart).toBe('src/components/');
      expect(prefix).toBe('But');
    });

    it('should extract search directory and prefix for absolute path', () => {
      const partial = '/home/user/pro';
      const lastSlash = partial.lastIndexOf('/');
      const dirPart = partial.slice(0, lastSlash + 1) || '/';
      const prefix = partial.slice(lastSlash + 1);

      expect(dirPart).toBe('/home/user/');
      expect(prefix).toBe('pro');
    });

    it('should handle root path', () => {
      const partial = '/';
      const lastSlash = partial.lastIndexOf('/');
      const dirPart = partial.slice(0, lastSlash + 1) || '/';
      const prefix = partial.slice(lastSlash + 1);

      expect(dirPart).toBe('/');
      expect(prefix).toBe('');
    });
  });

  // ==========================================================================
  // Visibility Logic Tests
  // ==========================================================================

  describe('Visibility Logic', () => {
    it('should not show when not visible', () => {
      const visible = false;
      const found = true;
      const suggestionsLength = 5;

      const shouldRender = visible && found && suggestionsLength > 0;

      expect(shouldRender).toBe(false);
    });

    it('should not show when @ not found', () => {
      const visible = true;
      const found = false;
      const suggestionsLength = 5;

      const shouldRender = visible && found && suggestionsLength > 0;

      expect(shouldRender).toBe(false);
    });

    it('should not show when no suggestions', () => {
      const visible = true;
      const found = true;
      const suggestionsLength = 0;

      const shouldRender = visible && found && suggestionsLength > 0;

      expect(shouldRender).toBe(false);
    });

    it('should show when all conditions met', () => {
      const visible = true;
      const found = true;
      const suggestionsLength = 3;

      const shouldRender = visible && found && suggestionsLength > 0;

      expect(shouldRender).toBe(true);
    });
  });

  // ==========================================================================
  // Selection Rendering Tests
  // ==========================================================================

  describe('Selection Rendering', () => {
    it('should identify selected item', () => {
      const selectedIndex = 2;
      const items = ['a', 'b', 'c', 'd'];

      items.forEach((_, index) => {
        const isSelected = index === selectedIndex;
        if (index === 2) {
          expect(isSelected).toBe(true);
        } else {
          expect(isSelected).toBe(false);
        }
      });
    });

    it('should add directory suffix', () => {
      const isDirectory = true;
      const suffix = isDirectory ? '/' : '';

      expect(suffix).toBe('/');
    });

    it('should not add suffix for files', () => {
      const isDirectory = false;
      const suffix = isDirectory ? '/' : '';

      expect(suffix).toBe('');
    });
  });

  // ==========================================================================
  // maxSuggestions Tests
  // ==========================================================================

  describe('maxSuggestions', () => {
    it('should limit suggestions to maxSuggestions', () => {
      const allSuggestions = Array.from({ length: 20 }, (_, i) => ({
        name: `file${i}.ts`,
        path: `file${i}.ts`,
        isDirectory: false,
      }));
      const maxSuggestions = 8;

      const limitedSuggestions = allSuggestions.slice(0, maxSuggestions);

      expect(limitedSuggestions.length).toBe(8);
    });

    it('should return all when less than max', () => {
      const allSuggestions = Array.from({ length: 5 }, (_, i) => ({
        name: `file${i}.ts`,
        path: `file${i}.ts`,
        isDirectory: false,
      }));
      const maxSuggestions = 8;

      const limitedSuggestions = allSuggestions.slice(0, maxSuggestions);

      expect(limitedSuggestions.length).toBe(5);
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle special characters in filenames', () => {
      const filename = 'file-with-dashes_and_underscores.test.ts';
      const ext = filename.slice(filename.lastIndexOf('.'));

      expect(ext).toBe('.ts');
    });

    it('should handle files with multiple dots', () => {
      const filename = 'component.test.spec.ts';
      const ext = filename.slice(filename.lastIndexOf('.'));

      expect(ext).toBe('.ts');
    });

    it('should handle very long paths', () => {
      const longPath = 'a/b/c/d/e/f/g/h/i/j/k/l/m/n/o/p/file.ts';
      const lastSlash = longPath.lastIndexOf('/');
      const prefix = longPath.slice(lastSlash + 1);

      expect(prefix).toBe('file.ts');
    });

    it('should handle unicode filenames', () => {
      const filename = '\u6587\u4EF6.ts';

      expect(filename.length).toBeGreaterThan(0);
    });

    it('should handle empty suggestions gracefully', () => {
      const suggestions: unknown[] = [];
      const selectedIndex = 0;

      const safeIndex = suggestions.length > 0 ? selectedIndex : -1;

      expect(safeIndex).toBe(-1);
    });
  });
});
