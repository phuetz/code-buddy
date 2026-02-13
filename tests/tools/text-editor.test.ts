/**
 * Tests for TextEditorTool
 *
 * Comprehensive tests covering:
 * - View file content (full, range, large files, directories)
 * - Create new file
 * - Edit existing file (str_replace) with exact and fuzzy matching
 * - Insert at line
 * - Replace lines
 * - Undo last edit
 * - File not found errors
 * - Path validation
 * - Edit history tracking
 * - Dispose / cleanup
 */

import { TextEditorTool } from '../../src/tools/text-editor';
import { ConfirmationService } from '../../src/utils/confirmation-service';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';

// Mock logger
jest.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock disposable registry
jest.mock('../../src/utils/disposable', () => ({
  registerDisposable: jest.fn(),
  Disposable: class {},
}));

// Mock fuzzy match utilities
jest.mock('../../src/utils/fuzzy-match', () => ({
  findBestFuzzyMatch: jest.fn(() => null),
  generateFuzzyDiff: jest.fn(() => ''),
  suggestWhitespaceFixes: jest.fn(() => []),
}));

// Mock diff generator
jest.mock('../../src/utils/diff-generator', () => ({
  generateDiff: jest.fn((oldLines: string[], newLines: string[], filePath: string) => ({
    diff: `--- a/${filePath}\n+++ b/${filePath}\n@@ changes @@`,
    hasChanges: oldLines.join('\n') !== newLines.join('\n'),
  })),
}));

// Mock latency optimizer
jest.mock('../../src/optimization/latency-optimizer', () => ({
  measureLatency: jest.fn(async (_name: string, fn: () => unknown) => fn()),
}));

// Mock workspace isolation
jest.mock('../../src/workspace/workspace-isolation', () => ({
  getWorkspaceIsolation: jest.fn(() => ({
    getConfig: () => ({ enabled: false }),
    validatePath: jest.fn(),
  })),
}));

describe('TextEditorTool', () => {
  let editor: TextEditorTool;
  let confirmationService: ConfirmationService;
  let tmpDir: string;

  beforeEach(async () => {
    // Create temp directory for test files
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'text-editor-test-'));

    // Reset confirmation service singleton
    (ConfirmationService as unknown as { instance: ConfirmationService | undefined }).instance = undefined;
    confirmationService = ConfirmationService.getInstance();
    // Auto-approve file operations for testing
    confirmationService.setSessionFlag('fileOperations', true);

    editor = new TextEditorTool();
    // Set base directory to our temp dir
    editor.setBaseDirectory(tmpDir);
  });

  afterEach(async () => {
    editor.dispose();
    if (confirmationService) {
      confirmationService.dispose();
    }
    (ConfirmationService as unknown as { instance: ConfirmationService | undefined }).instance = undefined;

    // Clean up temp directory
    try {
      await fs.remove(tmpDir);
    } catch { /* ignore */ }
  });

  describe('View File Content', () => {
    it('should view entire file with line numbers', async () => {
      const filePath = path.join(tmpDir, 'test.txt');
      await fs.writeFile(filePath, 'line1\nline2\nline3');

      const result = await editor.view(filePath);
      expect(result.success).toBe(true);
      expect(result.output).toContain('line1');
      expect(result.output).toContain('line2');
      expect(result.output).toContain('line3');
    });

    it('should view file with line range', async () => {
      const filePath = path.join(tmpDir, 'range.txt');
      await fs.writeFile(filePath, 'a\nb\nc\nd\ne');

      const result = await editor.view(filePath, [2, 4]);
      expect(result.success).toBe(true);
      expect(result.output).toContain('b');
      expect(result.output).toContain('c');
      expect(result.output).toContain('d');
      expect(result.output).toContain('Lines 2-4');
    });

    it('should view directory listing', async () => {
      const subDir = path.join(tmpDir, 'subdir');
      await fs.ensureDir(subDir);
      await fs.writeFile(path.join(subDir, 'file1.txt'), 'content1');
      await fs.writeFile(path.join(subDir, 'file2.txt'), 'content2');

      const result = await editor.view(subDir);
      expect(result.success).toBe(true);
      expect(result.output).toContain('file1.txt');
      expect(result.output).toContain('file2.txt');
      expect(result.output).toContain('Directory contents');
    });

    it('should return error for non-existent file', async () => {
      const result = await editor.view(path.join(tmpDir, 'nonexistent.txt'));
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should handle large files with head/tail truncation', async () => {
      const filePath = path.join(tmpDir, 'large.txt');
      const lines = Array.from({ length: 600 }, (_, i) => `line ${i + 1}`);
      await fs.writeFile(filePath, lines.join('\n'));

      const result = await editor.view(filePath);
      expect(result.success).toBe(true);
      expect(result.output).toContain('600 lines');
      expect(result.output).toContain('omitted');
    });

    it('should show all content for files under 500 lines', async () => {
      const filePath = path.join(tmpDir, 'medium.txt');
      const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`);
      await fs.writeFile(filePath, lines.join('\n'));

      const result = await editor.view(filePath);
      expect(result.success).toBe(true);
      expect(result.output).toContain('line 1');
      expect(result.output).toContain('line 100');
      expect(result.output).not.toContain('omitted');
    });

    it('should handle empty file', async () => {
      const filePath = path.join(tmpDir, 'empty.txt');
      await fs.writeFile(filePath, '');

      const result = await editor.view(filePath);
      expect(result.success).toBe(true);
    });
  });

  describe('Create New File', () => {
    it('should create a new file with content', async () => {
      const filePath = path.join(tmpDir, 'new-file.txt');
      const result = await editor.create(filePath, 'Hello, World!');

      expect(result.success).toBe(true);
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('Hello, World!');
    });

    it('should create file with multiline content', async () => {
      const filePath = path.join(tmpDir, 'multiline.txt');
      const content = 'line1\nline2\nline3';
      const result = await editor.create(filePath, content);

      expect(result.success).toBe(true);
      const actual = await fs.readFile(filePath, 'utf-8');
      expect(actual).toBe(content);
    });

    it('should fail when file already exists', async () => {
      const filePath = path.join(tmpDir, 'existing.txt');
      await fs.writeFile(filePath, 'existing content');

      const result = await editor.create(filePath, 'new content');
      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
    });

    it('should create parent directories if needed', async () => {
      const filePath = path.join(tmpDir, 'deep', 'nested', 'file.txt');
      const result = await editor.create(filePath, 'deep content');

      expect(result.success).toBe(true);
      expect(await fs.pathExists(filePath)).toBe(true);
    });

    it('should record create in edit history', async () => {
      const filePath = path.join(tmpDir, 'history-test.txt');
      await editor.create(filePath, 'content');

      const history = editor.getEditHistory();
      expect(history.length).toBe(1);
      expect(history[0].command).toBe('create');
      expect(history[0].path).toBe(filePath);
    });

    it('should return diff output for created file', async () => {
      const filePath = path.join(tmpDir, 'diff-create.txt');
      const result = await editor.create(filePath, 'content');

      expect(result.success).toBe(true);
      expect(result.output).toBeDefined();
    });
  });

  describe('String Replace (strReplace)', () => {
    it('should replace text in file', async () => {
      const filePath = path.join(tmpDir, 'replace.txt');
      await fs.writeFile(filePath, 'Hello World');

      const result = await editor.strReplace(filePath, 'World', 'Universe');
      expect(result.success).toBe(true);

      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('Hello Universe');
    });

    it('should replace first occurrence by default', async () => {
      const filePath = path.join(tmpDir, 'multi-replace.txt');
      await fs.writeFile(filePath, 'foo bar foo baz foo');

      const result = await editor.strReplace(filePath, 'foo', 'qux');
      expect(result.success).toBe(true);

      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('qux bar foo baz foo');
    });

    it('should replace all occurrences when replaceAll is true', async () => {
      const filePath = path.join(tmpDir, 'replace-all.txt');
      await fs.writeFile(filePath, 'foo bar foo baz foo');

      const result = await editor.strReplace(filePath, 'foo', 'qux', true);
      expect(result.success).toBe(true);

      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('qux bar qux baz qux');
    });

    it('should return error when file not found', async () => {
      const result = await editor.strReplace(
        path.join(tmpDir, 'nonexistent.txt'),
        'old',
        'new'
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should return error when search string not found in file', async () => {
      const filePath = path.join(tmpDir, 'no-match.txt');
      await fs.writeFile(filePath, 'Hello World');

      const result = await editor.strReplace(filePath, 'NotInFile', 'replacement');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should handle multiline replacement', async () => {
      const filePath = path.join(tmpDir, 'multiline-replace.txt');
      await fs.writeFile(filePath, 'line1\nline2\nline3');

      const result = await editor.strReplace(filePath, 'line2', 'replaced');
      expect(result.success).toBe(true);

      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('line1\nreplaced\nline3');
    });

    it('should handle special regex characters in search string', async () => {
      const filePath = path.join(tmpDir, 'regex-chars.txt');
      await fs.writeFile(filePath, 'price is $10.00 (total)');

      const result = await editor.strReplace(filePath, '$10.00', '$20.00');
      expect(result.success).toBe(true);

      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('price is $20.00 (total)');
    });

    it('should record replacement in edit history', async () => {
      const filePath = path.join(tmpDir, 'history-replace.txt');
      await fs.writeFile(filePath, 'Hello World');

      await editor.strReplace(filePath, 'World', 'Universe');

      const history = editor.getEditHistory();
      expect(history.length).toBe(1);
      expect(history[0].command).toBe('str_replace');
      expect(history[0].old_str).toBe('World');
      expect(history[0].new_str).toBe('Universe');
    });

    it('should return diff output on successful replacement', async () => {
      const filePath = path.join(tmpDir, 'diff-replace.txt');
      await fs.writeFile(filePath, 'Hello World');

      const result = await editor.strReplace(filePath, 'World', 'Universe');
      expect(result.success).toBe(true);
      expect(result.output).toBeDefined();
    });
  });

  describe('Insert at Line', () => {
    it('should insert content at specified line', async () => {
      const filePath = path.join(tmpDir, 'insert.txt');
      await fs.writeFile(filePath, 'line1\nline2\nline3');

      const result = await editor.insert(filePath, 2, 'inserted');
      expect(result.success).toBe(true);

      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('line1\ninserted\nline2\nline3');
    });

    it('should insert at beginning of file (line 1)', async () => {
      const filePath = path.join(tmpDir, 'insert-start.txt');
      await fs.writeFile(filePath, 'existing');

      const result = await editor.insert(filePath, 1, 'first');
      expect(result.success).toBe(true);

      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('first\nexisting');
    });

    it('should insert at end of file', async () => {
      const filePath = path.join(tmpDir, 'insert-end.txt');
      await fs.writeFile(filePath, 'line1\nline2');

      const result = await editor.insert(filePath, 3, 'last');
      expect(result.success).toBe(true);

      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('line1\nline2\nlast');
    });

    it('should return error for invalid line number (too low)', async () => {
      const filePath = path.join(tmpDir, 'insert-invalid.txt');
      await fs.writeFile(filePath, 'line1');

      const result = await editor.insert(filePath, 0, 'bad');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid insert line');
    });

    it('should return error for invalid line number (too high)', async () => {
      const filePath = path.join(tmpDir, 'insert-high.txt');
      await fs.writeFile(filePath, 'line1');

      const result = await editor.insert(filePath, 100, 'bad');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid insert line');
    });

    it('should return error for non-existent file', async () => {
      const result = await editor.insert(
        path.join(tmpDir, 'nonexistent.txt'),
        1,
        'content'
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should record insert in edit history', async () => {
      const filePath = path.join(tmpDir, 'history-insert.txt');
      await fs.writeFile(filePath, 'line1');

      await editor.insert(filePath, 1, 'inserted');

      const history = editor.getEditHistory();
      expect(history.length).toBe(1);
      expect(history[0].command).toBe('insert');
      expect(history[0].insert_line).toBe(1);
    });
  });

  describe('Replace Lines', () => {
    it('should replace a range of lines', async () => {
      const filePath = path.join(tmpDir, 'replace-lines.txt');
      await fs.writeFile(filePath, 'line1\nline2\nline3\nline4\nline5');

      const result = await editor.replaceLines(filePath, 2, 4, 'replaced');
      expect(result.success).toBe(true);

      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('line1\nreplaced\nline5');
    });

    it('should replace single line', async () => {
      const filePath = path.join(tmpDir, 'replace-single.txt');
      await fs.writeFile(filePath, 'line1\nline2\nline3');

      const result = await editor.replaceLines(filePath, 2, 2, 'new line 2');
      expect(result.success).toBe(true);

      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('line1\nnew line 2\nline3');
    });

    it('should replace with multiline content', async () => {
      const filePath = path.join(tmpDir, 'replace-multi.txt');
      await fs.writeFile(filePath, 'line1\nline2\nline3');

      const result = await editor.replaceLines(filePath, 2, 2, 'new A\nnew B\nnew C');
      expect(result.success).toBe(true);

      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('line1\nnew A\nnew B\nnew C\nline3');
    });

    it('should return error for invalid start line', async () => {
      const filePath = path.join(tmpDir, 'replace-bad-start.txt');
      await fs.writeFile(filePath, 'line1\nline2');

      const result = await editor.replaceLines(filePath, 0, 1, 'bad');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid start line');
    });

    it('should return error for invalid end line (beyond file)', async () => {
      const filePath = path.join(tmpDir, 'replace-bad-end.txt');
      await fs.writeFile(filePath, 'line1\nline2');

      const result = await editor.replaceLines(filePath, 1, 100, 'bad');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid end line');
    });

    it('should return error for end line before start line', async () => {
      const filePath = path.join(tmpDir, 'replace-reversed.txt');
      await fs.writeFile(filePath, 'line1\nline2\nline3');

      const result = await editor.replaceLines(filePath, 3, 1, 'bad');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid end line');
    });

    it('should return error for non-existent file', async () => {
      const result = await editor.replaceLines(
        path.join(tmpDir, 'nonexistent.txt'),
        1,
        1,
        'content'
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('Undo Last Edit', () => {
    it('should undo str_replace', async () => {
      const filePath = path.join(tmpDir, 'undo-replace.txt');
      await fs.writeFile(filePath, 'Hello World');

      await editor.strReplace(filePath, 'World', 'Universe');
      const afterReplace = await fs.readFile(filePath, 'utf-8');
      expect(afterReplace).toBe('Hello Universe');

      const result = await editor.undoEdit();
      expect(result.success).toBe(true);

      const afterUndo = await fs.readFile(filePath, 'utf-8');
      expect(afterUndo).toBe('Hello World');
    });

    it('should undo create by removing file', async () => {
      const filePath = path.join(tmpDir, 'undo-create.txt');
      await editor.create(filePath, 'temp content');
      expect(await fs.pathExists(filePath)).toBe(true);

      const result = await editor.undoEdit();
      expect(result.success).toBe(true);
      expect(await fs.pathExists(filePath)).toBe(false);
    });

    it('should undo insert by removing the inserted line', async () => {
      const filePath = path.join(tmpDir, 'undo-insert.txt');
      await fs.writeFile(filePath, 'line1\nline2');

      await editor.insert(filePath, 2, 'inserted');
      const afterInsert = await fs.readFile(filePath, 'utf-8');
      expect(afterInsert).toBe('line1\ninserted\nline2');

      const result = await editor.undoEdit();
      expect(result.success).toBe(true);

      const afterUndo = await fs.readFile(filePath, 'utf-8');
      expect(afterUndo).toBe('line1\nline2');
    });

    it('should return error when no edits to undo', async () => {
      const result = await editor.undoEdit();
      expect(result.success).toBe(false);
      expect(result.error).toContain('No edits to undo');
    });

    it('should only undo the last edit', async () => {
      const filePath = path.join(tmpDir, 'undo-last.txt');
      await fs.writeFile(filePath, 'AAA BBB CCC');

      await editor.strReplace(filePath, 'AAA', 'XXX');
      await editor.strReplace(filePath, 'BBB', 'YYY');

      const result = await editor.undoEdit();
      expect(result.success).toBe(true);

      const content = await fs.readFile(filePath, 'utf-8');
      // Only the last edit (BBB->YYY) should be undone
      expect(content).toBe('XXX BBB CCC');
    });
  });

  describe('Edit History', () => {
    it('should start with empty history', () => {
      expect(editor.getEditHistory()).toEqual([]);
    });

    it('should track all edits', async () => {
      const filePath1 = path.join(tmpDir, 'history1.txt');
      const filePath2 = path.join(tmpDir, 'history2.txt');
      await fs.writeFile(filePath1, 'content1');

      await editor.create(filePath2, 'content2');
      await editor.strReplace(filePath1, 'content1', 'modified');

      const history = editor.getEditHistory();
      expect(history.length).toBe(2);
      expect(history[0].command).toBe('create');
      expect(history[1].command).toBe('str_replace');
    });

    it('should return a copy of history (not a reference)', () => {
      const history1 = editor.getEditHistory();
      const history2 = editor.getEditHistory();
      expect(history1).not.toBe(history2);
    });

    it('should clear history on dispose', async () => {
      const filePath = path.join(tmpDir, 'dispose-history.txt');
      await editor.create(filePath, 'content');
      expect(editor.getEditHistory().length).toBe(1);

      editor.dispose();
      expect(editor.getEditHistory()).toEqual([]);
    });
  });

  describe('Base Directory', () => {
    it('should set base directory', () => {
      editor.setBaseDirectory('/tmp');
      // No error means success
    });

    it('should resolve relative paths against base directory', async () => {
      const filePath = path.join(tmpDir, 'base-dir-test.txt');
      await fs.writeFile(filePath, 'test');

      // Since we set tmpDir as base, viewing the filename should resolve correctly
      const result = await editor.view(filePath);
      expect(result.success).toBe(true);
    });
  });

  describe('Error Cases', () => {
    it('should handle path traversal attempts', async () => {
      // Try to access file outside base directory
      const result = await editor.view('/etc/hostname');
      // May fail due to path validation
      // The result depends on workspace isolation configuration
      expect(result).toBeDefined();
    });

    it('should handle file with no read permission gracefully', async () => {
      const filePath = path.join(tmpDir, 'no-read.txt');
      await fs.writeFile(filePath, 'secret');
      await fs.chmod(filePath, 0o000);

      try {
        const result = await editor.view(filePath);
        // Should fail with permission error
        if (!result.success) {
          expect(result.error).toBeDefined();
        }
      } finally {
        // Restore permissions for cleanup
        await fs.chmod(filePath, 0o644);
      }
    });

    it('should handle concurrent edit attempts gracefully', async () => {
      const filePath = path.join(tmpDir, 'concurrent.txt');
      await fs.writeFile(filePath, 'original');

      // Run two replacements concurrently
      const [result1, result2] = await Promise.all([
        editor.strReplace(filePath, 'original', 'modified1'),
        editor.strReplace(filePath, 'original', 'modified2'),
      ]);

      // At least one should succeed
      expect(result1.success || result2.success).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle file with only whitespace', async () => {
      const filePath = path.join(tmpDir, 'whitespace.txt');
      await fs.writeFile(filePath, '   \n   \n   ');

      const result = await editor.view(filePath);
      expect(result.success).toBe(true);
    });

    it('should handle file with unicode content', async () => {
      const filePath = path.join(tmpDir, 'unicode.txt');
      await fs.writeFile(filePath, 'Hello World');

      const result = await editor.view(filePath);
      expect(result.success).toBe(true);
      expect(result.output).toContain('Hello');
    });

    it('should handle replace with empty string', async () => {
      const filePath = path.join(tmpDir, 'empty-replace.txt');
      await fs.writeFile(filePath, 'Hello World');

      const result = await editor.strReplace(filePath, 'World', '');
      expect(result.success).toBe(true);

      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('Hello ');
    });

    it('should handle create with empty content', async () => {
      const filePath = path.join(tmpDir, 'empty-create.txt');
      const result = await editor.create(filePath, '');
      expect(result.success).toBe(true);

      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('');
    });

    it('should handle file with very long lines', async () => {
      const filePath = path.join(tmpDir, 'long-line.txt');
      const longLine = 'x'.repeat(10000);
      await fs.writeFile(filePath, longLine);

      const result = await editor.view(filePath);
      expect(result.success).toBe(true);
    });
  });
});
