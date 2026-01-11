/**
 * Unit tests for UnifiedDiffEditor
 * Tests Aider-inspired code editing system
 */

import { UnifiedDiffEditor, DiffOperation } from '../../src/tools/unified-diff-editor';
import * as fs from 'fs-extra';
import * as path from 'path';

// Mock fs-extra
jest.mock('fs-extra', () => ({
  pathExists: jest.fn(),
  readFile: jest.fn(),
  writeFile: jest.fn(),
  mkdir: jest.fn(),
  ensureDir: jest.fn(),
  rename: jest.fn(),
  stat: jest.fn(),
  access: jest.fn(), // Keeping access for backward compat if needed, but VFS uses pathExists
}));

describe('UnifiedDiffEditor', () => {
  let editor: UnifiedDiffEditor;
  const mockFilePath = 'test.ts';

  beforeEach(() => {
    jest.clearAllMocks();
    editor = new UnifiedDiffEditor({ enableBackups: false });
    (fs.pathExists as unknown as jest.Mock).mockResolvedValue(true);
  });

  describe('applyDiff() - Exact Matching', () => {
    it('should apply an exact match hunk successfully', async () => {
      const original = 'function hello() {\n  console.log("hi");\n}';
      (fs.readFile as unknown as jest.Mock).mockResolvedValue(original);

      const op: DiffOperation = {
        filePath: mockFilePath,
        hunks: [{
          searchText: 'console.log("hi");',
          replaceText: 'console.log("hello world");',
        }],
      };

      const result = await editor.applyDiff(op);

      expect(result.success).toBe(true);
      expect(result.hunksApplied).toBe(1);
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.any(String),
        original.replace('hi', 'hello world'),
        'utf-8'
      );
    });

    it('should fail if search text is not found', async () => {
      (fs.readFile as unknown as jest.Mock).mockResolvedValue('some code');

      const op: DiffOperation = {
        filePath: mockFilePath,
        hunks: [{
          searchText: 'nonexistent',
          replaceText: 'new',
        }],
      };

      const result = await editor.applyDiff(op);

      expect(result.success).toBe(false);
      expect(result.hunksFailed).toBe(1);
    });
  });

  describe('applyDiff() - Fuzzy Matching', () => {
    it('should apply hunk with minor whitespace differences', async () => {
      const original = 'function hello() {\n    console.log("hi");\n}';
      (fs.readFile as unknown as jest.Mock).mockResolvedValue(original);

      const op: DiffOperation = {
        filePath: mockFilePath,
        hunks: [{
          searchText: '  console.log("hi");', // 2 spaces instead of 4
          replaceText: '  console.log("hello");',
        }],
      };

      const result = await editor.applyDiff(op);

      expect(result.success).toBe(true);
      expect(result.hunksApplied).toBe(1);
    });
  });

  describe('applyDiff() - Normalized Matching', () => {
    it('should apply hunk with significant formatting differences', async () => {
      const original = 'const x = { a: 1, b: 2 };';
      (fs.readFile as unknown as jest.Mock).mockResolvedValue(original);

      const op: DiffOperation = {
        filePath: mockFilePath,
        hunks: [{
          searchText: 'const x = {\na: 1,\nb: 2\n};',
          replaceText: 'const x = { a: 1 };',
        }],
      };

      const result = await editor.applyDiff(op);

      expect(result.success).toBe(true);
      expect(result.hunksApplied).toBe(1);
    });
  });

  describe('applyDiff() - Multiple Hunks', () => {
    it('should apply multiple hunks to the same file', async () => {
      const original = 'line1\nline2\nline3\nline4';
      (fs.readFile as unknown as jest.Mock).mockResolvedValue(original);

      const op: DiffOperation = {
        filePath: mockFilePath,
        hunks: [
          { searchText: 'line1', replaceText: 'new1' },
          { searchText: 'line3', replaceText: 'new3' },
        ],
      };

      const result = await editor.applyDiff(op);

      expect(result.success).toBe(true);
      expect(result.hunksApplied).toBe(2);
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.any(String),
        'new1\nline2\nnew3\nline4',
        'utf-8'
      );
    });
  });

  describe('parseDiff()', () => {
    it('should parse unified diff string correctly', () => {
      const diffString = `diff --git a/src/index.ts b/src/index.ts
@@ -1,3 +1,3 @@
-console.log("old");
+console.log("new");
 `;
       const ops = UnifiedDiffEditor.parseDiff(diffString);

       expect(ops).toHaveLength(1);
       expect(ops[0].filePath).toBe('src/index.ts');
       expect(ops[0].hunks[0].searchText).toBe('console.log("old");');
       expect(ops[0].hunks[0].replaceText).toBe('console.log("new");');
     });

    it('should handle context lines in diff', () => {
      const diffString = `diff --git a/file.ts b/file.ts
@@ -1,5 +1,5 @@
 function test() {
-  return false;
+  return true;
 }
 `;
       const ops = UnifiedDiffEditor.parseDiff(diffString);

       expect(ops[0].hunks[0].searchText).toContain('function test()');
       expect(ops[0].hunks[0].replaceText).toContain('return true;');
    });
  });

  describe('Backups', () => {
    it('should create backup if enabled', async () => {
      editor = new UnifiedDiffEditor({ enableBackups: true });
      (fs.readFile as unknown as jest.Mock).mockResolvedValue('original');

      const op: DiffOperation = {
        filePath: mockFilePath,
        hunks: [{ searchText: 'original', replaceText: 'new' }],
      };

      const result = await editor.applyDiff(op);

      expect(result.backup).toBeDefined();
      expect(fs.writeFile).toHaveBeenCalledTimes(2); // Backup + Original
    });
  });

  describe('Error Handling', () => {
    it('should handle file not found', async () => {
      (fs.pathExists as unknown as jest.Mock).mockResolvedValue(false);

      const op: DiffOperation = {
        filePath: 'missing.ts',
        hunks: [{ searchText: 'x', replaceText: 'y' }],
      };

      const result = await editor.applyDiff(op);

      expect(result.success).toBe(false);
      expect(result.errors[0]).toContain('not found');
    });

    it('should create file if missing and requested', async () => {
      (fs.pathExists as unknown as jest.Mock).mockResolvedValue(false);

      const op: DiffOperation = {
        filePath: 'new.ts',
        hunks: [{ searchText: '', replaceText: 'hello' }],
        createIfMissing: true,
      };

      const result = await editor.applyDiff(op);

      expect(result.success).toBe(true);
      expect(fs.writeFile).toHaveBeenCalledWith(expect.any(String), 'hello', 'utf-8');
    });
  });
});
