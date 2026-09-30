/**
 * Tests for LSP Rename Tool
 *
 * Tests:
 * - Rename generates correct workspace edit
 * - Multi-file rename applies to all files
 * - Invalid position returns error
 * - Tool result format is correct
 * - applyTextEdit / applyEditsToContent correctness
 * - uriToPath conversion
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Mock the LSP client before importing the tool
const mockPrepareRename = vi.fn();
const mockRename = vi.fn();
const mockDetectLanguage = vi.fn();

vi.mock('../../src/lsp/lsp-client.js', () => ({
  getLSPClient: () => ({
    prepareRename: mockPrepareRename,
    rename: mockRename,
    detectLanguage: mockDetectLanguage,
  }),
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock fs
const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();
const mockWriteFileSync = vi.fn();

vi.mock('fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
  default: {
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
    readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
    writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
  },
}));

import {
  executeLspRename,
  applyTextEdit,
  applyEditsToContent,
  extractEdits,
  uriToPath,
} from '../../src/tools/lsp-rename-tool.js';
import type { LSPWorkspaceEdit, LSPTextEdit } from '../../src/lsp/lsp-client.js';

describe('LSP Rename Tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
    mockDetectLanguage.mockReturnValue('typescript');
  });

  // ==========================================================================
  // applyTextEdit
  // ==========================================================================

  describe('applyTextEdit', () => {
    it('should replace text on a single line', () => {
      const content = 'const foo = 42;';
      const edit: LSPTextEdit = {
        range: { start: { line: 0, character: 6 }, end: { line: 0, character: 9 } },
        newText: 'bar',
      };
      expect(applyTextEdit(content, edit)).toBe('const bar = 42;');
    });

    it('should handle multi-line replacement', () => {
      const content = 'line1\nline2\nline3';
      const edit: LSPTextEdit = {
        range: { start: { line: 0, character: 3 }, end: { line: 2, character: 3 } },
        newText: 'REPLACED',
      };
      expect(applyTextEdit(content, edit)).toBe('linREPLACEDe3');
    });

    it('should handle insertion (empty range)', () => {
      const content = 'hello world';
      const edit: LSPTextEdit = {
        range: { start: { line: 0, character: 5 }, end: { line: 0, character: 5 } },
        newText: ' beautiful',
      };
      expect(applyTextEdit(content, edit)).toBe('hello beautiful world');
    });
  });

  // ==========================================================================
  // applyEditsToContent
  // ==========================================================================

  describe('applyEditsToContent', () => {
    it('should apply multiple edits in correct order (bottom-up)', () => {
      const content = 'const foo = 1;\nconst bar = 2;\nconst baz = 3;';
      const edits: LSPTextEdit[] = [
        { range: { start: { line: 0, character: 6 }, end: { line: 0, character: 9 } }, newText: 'alpha' },
        { range: { start: { line: 2, character: 6 }, end: { line: 2, character: 9 } }, newText: 'gamma' },
      ];
      const result = applyEditsToContent(content, edits);
      expect(result).toBe('const alpha = 1;\nconst bar = 2;\nconst gamma = 3;');
    });

    it('should handle edits on the same line in correct order', () => {
      const content = 'foo + bar';
      const edits: LSPTextEdit[] = [
        { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }, newText: 'alpha' },
        { range: { start: { line: 0, character: 6 }, end: { line: 0, character: 9 } }, newText: 'beta' },
      ];
      const result = applyEditsToContent(content, edits);
      expect(result).toBe('alpha + beta');
    });
  });

  // ==========================================================================
  // extractEdits
  // ==========================================================================

  describe('extractEdits', () => {
    it('should extract from changes format', () => {
      const workspaceEdit: LSPWorkspaceEdit = {
        changes: {
          'file:///src/main.ts': [
            { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }, newText: 'bar' },
          ],
          'file:///src/utils.ts': [
            { range: { start: { line: 5, character: 10 }, end: { line: 5, character: 13 } }, newText: 'bar' },
          ],
        },
      };

      const result = extractEdits(workspaceEdit);
      expect(result.size).toBe(2);
    });

    it('should extract from documentChanges format', () => {
      const workspaceEdit: LSPWorkspaceEdit = {
        documentChanges: [
          {
            textDocument: { uri: 'file:///src/main.ts', version: 1 },
            edits: [
              { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }, newText: 'bar' },
            ],
          },
        ],
      };

      const result = extractEdits(workspaceEdit);
      expect(result.size).toBe(1);
    });

    it('should merge both formats', () => {
      const workspaceEdit: LSPWorkspaceEdit = {
        changes: {
          'file:///src/a.ts': [
            { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }, newText: 'x' },
          ],
        },
        documentChanges: [
          {
            textDocument: { uri: 'file:///src/a.ts', version: 1 },
            edits: [
              { range: { start: { line: 5, character: 0 }, end: { line: 5, character: 3 } }, newText: 'y' },
            ],
          },
        ],
      };

      const result = extractEdits(workspaceEdit);
      expect(result.size).toBe(1);
      // Both edits should be merged for the same file
      const edits = result.get(uriToPath('file:///src/a.ts'));
      expect(edits).toBeDefined();
      expect(edits!.length).toBe(2);
    });
  });

  // ==========================================================================
  // uriToPath
  // ==========================================================================

  describe('uriToPath', () => {
    it('preserves the absolute filesystem path when decoding a standard file URI', () => {
      const file = resolve('fixture with spaces.ts');
      expect(uriToPath(pathToFileURL(file).href)).toBe(file);
    });

    it('should strip file:/// prefix', () => {
      const result = uriToPath('file:///src/main.ts');
      expect(result).toContain('src');
      expect(result).toContain('main.ts');
      expect(result).not.toContain('file:');
    });

    it('should decode URI-encoded characters', () => {
      const result = uriToPath('file:///path%20with%20spaces/file.ts');
      expect(result).toContain('path with spaces');
    });
  });

  // ==========================================================================
  // executeLspRename
  // ==========================================================================

  describe('executeLspRename', () => {
    it('should return error for missing filePath', async () => {
      const result = await executeLspRename({
        filePath: '',
        line: 1,
        character: 1,
        newName: 'newFoo',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('filePath');
    });

    it('should return error for invalid line', async () => {
      const result = await executeLspRename({
        filePath: 'test.ts',
        line: 0,
        character: 1,
        newName: 'newFoo',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('line');
    });

    it('should return error for empty newName', async () => {
      const result = await executeLspRename({
        filePath: 'test.ts',
        line: 1,
        character: 1,
        newName: '',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('newName');
    });

    it('should return error for file not found', async () => {
      mockExistsSync.mockReturnValue(false);
      const result = await executeLspRename({
        filePath: 'nonexistent.ts',
        line: 1,
        character: 1,
        newName: 'newFoo',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('File not found');
    });

    it('should return error for unsupported language', async () => {
      mockDetectLanguage.mockReturnValue(null);
      const result = await executeLspRename({
        filePath: 'test.xyz',
        line: 1,
        character: 1,
        newName: 'newFoo',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unsupported language');
    });

    it('should return error when prepareRename fails', async () => {
      mockPrepareRename.mockResolvedValue(null);
      const result = await executeLspRename({
        filePath: 'test.ts',
        line: 1,
        character: 7,
        newName: 'newFoo',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Cannot rename');
    });

    it('should return error when rename returns null', async () => {
      mockPrepareRename.mockResolvedValue({
        range: { start: { line: 0, character: 6 }, end: { line: 0, character: 9 } },
        placeholder: 'foo',
      });
      mockRename.mockResolvedValue(null);

      const result = await executeLspRename({
        filePath: 'test.ts',
        line: 1,
        character: 7,
        newName: 'newFoo',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('no edits');
    });

    it('should successfully apply a single-file rename', async () => {
      mockPrepareRename.mockResolvedValue({
        range: { start: { line: 0, character: 6 }, end: { line: 0, character: 9 } },
        placeholder: 'foo',
      });

      const resolvedPath = expect.any(String);

      mockRename.mockResolvedValue({
        changes: {
          ['file:///' + process.cwd().replace(/\\/g, '/') + '/test.ts']: [
            {
              range: { start: { line: 0, character: 6 }, end: { line: 0, character: 9 } },
              newText: 'newFoo',
            },
          ],
        },
      });

      mockReadFileSync.mockReturnValue('const foo = 42;');

      const result = await executeLspRename({
        filePath: 'test.ts',
        line: 1,
        character: 7,
        newName: 'newFoo',
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('Renamed');
      expect(result.output).toContain('newFoo');
      expect(result.output).toContain('Files changed: 1');
      expect(result.output).toContain('Total edits: 1');
      expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    });

    it('should apply multi-file rename across all files', async () => {
      mockPrepareRename.mockResolvedValue({
        range: { start: { line: 0, character: 6 }, end: { line: 0, character: 9 } },
        placeholder: 'foo',
      });

      const cwd = process.cwd().replace(/\\/g, '/');

      mockRename.mockResolvedValue({
        changes: {
          [`file:///${cwd}/src/main.ts`]: [
            {
              range: { start: { line: 0, character: 6 }, end: { line: 0, character: 9 } },
              newText: 'bar',
            },
          ],
          [`file:///${cwd}/src/utils.ts`]: [
            {
              range: { start: { line: 2, character: 10 }, end: { line: 2, character: 13 } },
              newText: 'bar',
            },
            {
              range: { start: { line: 5, character: 15 }, end: { line: 5, character: 18 } },
              newText: 'bar',
            },
          ],
        },
      });

      mockReadFileSync
        .mockReturnValueOnce('const foo = 42;')
        .mockReturnValueOnce('import { x } from "./main";\n\nfunction test(foo: number) {\n  return foo;\n}\n\nconsole.log(test(foo));');

      const result = await executeLspRename({
        filePath: 'src/main.ts',
        line: 1,
        character: 7,
        newName: 'bar',
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('Files changed: 2');
      expect(result.output).toContain('Total edits: 3');
      expect(mockWriteFileSync).toHaveBeenCalledTimes(2);
    });

    it('should include data with filesChanged and files list', async () => {
      mockPrepareRename.mockResolvedValue({
        range: { start: { line: 0, character: 6 }, end: { line: 0, character: 9 } },
        placeholder: 'foo',
      });

      const cwd = process.cwd().replace(/\\/g, '/');

      mockRename.mockResolvedValue({
        changes: {
          [`file:///${cwd}/test.ts`]: [
            {
              range: { start: { line: 0, character: 6 }, end: { line: 0, character: 9 } },
              newText: 'bar',
            },
          ],
        },
      });

      mockReadFileSync.mockReturnValue('const foo = 42;');

      const result = await executeLspRename({
        filePath: 'test.ts',
        line: 1,
        character: 7,
        newName: 'bar',
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      const data = result.data as { filesChanged: number; totalEdits: number; files: string[] };
      expect(data.filesChanged).toBe(1);
      expect(data.totalEdits).toBe(1);
      expect(data.files).toHaveLength(1);
    });
    it('writes to the absolute path returned by the language server', async () => {
      const file = resolve('fixture with spaces.ts');
      mockPrepareRename.mockResolvedValue({ placeholder: 'foo' });
      mockRename.mockResolvedValue({ changes: {
        [pathToFileURL(file).href]: [{
          range: { start: { line: 0, character: 6 }, end: { line: 0, character: 9 } },
          newText: 'bar',
        }],
      } });
      mockReadFileSync.mockReturnValue('const foo = 42;');
      const result = await executeLspRename({ filePath: file, line: 1, character: 7, newName: 'bar' });
      expect(result.success).toBe(true);
      expect(mockWriteFileSync).toHaveBeenCalledWith(file, 'const bar = 42;', 'utf-8');
    });

    it('reports a failed write instead of claiming a file was changed', async () => {
      const file = resolve('fixture.ts');
      mockPrepareRename.mockResolvedValue({ placeholder: 'foo' });
      mockRename.mockResolvedValue({ changes: {
        [pathToFileURL(file).href]: [{
          range: { start: { line: 0, character: 6 }, end: { line: 0, character: 9 } },
          newText: 'bar',
        }],
      } });
      mockReadFileSync.mockImplementationOnce(() => { throw new Error('EACCES'); });
      const result = await executeLspRename({ filePath: file, line: 1, character: 7, newName: 'bar' });
      expect(result.success).toBe(false);
      expect(result.output).toContain('Files changed: 0');
      expect(result.error).toContain('could not apply edits');
      expect(mockWriteFileSync).not.toHaveBeenCalled();
    });
  });
});
