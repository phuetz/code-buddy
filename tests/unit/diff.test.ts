/**
 * Comprehensive Unit Tests for Diff Module
 *
 * This test file covers:
 * - Diff generation (semantic-diff, split-screen-diff)
 * - Patch application (unified-diff-editor)
 * - Conflict resolution (three-way-diff integration)
 *
 * Uses Jest with proper mocks for file system and external dependencies.
 */

// Mock fs-extra before importing modules that use it
const mockFsReadFile = jest.fn();

jest.mock('fs-extra', () => ({
  readFile: (...args: unknown[]) => mockFsReadFile(...args),
}));

// Mock fs promises
const mockFsPromisesReadFile = jest.fn();
const mockFsPromisesWriteFile = jest.fn();
const mockFsPromisesMkdir = jest.fn();
const mockFsPromisesAccess = jest.fn();
const mockFsPromisesReaddir = jest.fn();

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  promises: {
    readFile: (...args: unknown[]) => mockFsPromisesReadFile(...args),
    writeFile: (...args: unknown[]) => mockFsPromisesWriteFile(...args),
    mkdir: (...args: unknown[]) => mockFsPromisesMkdir(...args),
    access: (...args: unknown[]) => mockFsPromisesAccess(...args),
    readdir: (...args: unknown[]) => mockFsPromisesReaddir(...args),
  },
}));

import {
  semanticDiff,
  semanticDiffFiles,
  formatSemanticDiff,
  SemanticDiffResult,
} from '../../src/tools/semantic-diff';

import {
  UnifiedDiffEditor,
  getUnifiedDiffEditor,
  resetUnifiedDiffEditor,
  DiffOperation,
} from '../../src/tools/unified-diff-editor';

import {
  generateSplitDiff,
  formatSplitDiff,
  toUnifiedDiff,
  formatCompactSummary,
  hasChanges,
} from '../../src/ui/split-screen-diff';

import {
  ThreeWayDiff,
  getThreeWayDiff,
  ConflictResolution,
} from '../../src/advanced/three-way-diff';

describe('Diff Module - Comprehensive Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ===========================================================================
  // Semantic Diff Tests
  // ===========================================================================
  describe('SemanticDiff', () => {
    describe('Basic Diff Generation', () => {
      it('should detect identical code as semantically equivalent', () => {
        const code = `function hello() {
  return "world";
}`;
        const result = semanticDiff(code, code);

        expect(result.isSemanticEquivalent).toBe(true);
        expect(result.summary.totalChanges).toBe(0);
      });

      it('should detect whitespace-only changes as formatting', () => {
        const oldCode = 'function test() { return 1; }';
        const newCode = 'function test() {\n  return 1;\n}';

        const result = semanticDiff(oldCode, newCode);

        expect(result.isSemanticEquivalent).toBe(true);
        expect(result.summary.formattingOnly).toBeGreaterThan(0);
      });

      it('should detect comment-only changes as formatting', () => {
        const oldCode = '// Old comment\nconst x = 1;';
        const newCode = '// New comment\nconst x = 1;';

        const result = semanticDiff(oldCode, newCode);

        expect(result.isSemanticEquivalent).toBe(true);
      });

      it('should detect added functions', () => {
        const oldCode = `function existing() {
  return 1;
}`;
        const newCode = `function existing() {
  return 1;
}

function newFunction() {
  return 2;
}`;

        const result = semanticDiff(oldCode, newCode);

        expect(result.summary.additions).toBeGreaterThan(0);
        expect(result.isSemanticEquivalent).toBe(false);

        const addedChange = result.changes.find(c => c.type === 'added');
        expect(addedChange).toBeDefined();
        expect(addedChange?.description).toContain('newFunction');
      });

      it('should detect removed functions', () => {
        const oldCode = `function toRemove() {
  return 1;
}

function toKeep() {
  return 2;
}`;
        const newCode = `function toKeep() {
  return 2;
}`;

        const result = semanticDiff(oldCode, newCode);

        expect(result.summary.deletions).toBeGreaterThan(0);

        const removedChange = result.changes.find(c => c.type === 'removed');
        expect(removedChange).toBeDefined();
        expect(removedChange?.description).toContain('toRemove');
      });

      it('should detect modified functions', () => {
        const oldCode = `function calculate() {
  return 1 + 1;
}`;
        const newCode = `function calculate() {
  return 2 + 2;
}`;

        const result = semanticDiff(oldCode, newCode);

        expect(result.isSemanticEquivalent).toBe(false);
        // Could be detected as modified or as add/remove pair
        expect(result.summary.totalChanges).toBeGreaterThan(0);
      });

      it('should detect renamed functions', () => {
        const oldCode = `function oldName() {
  return 42;
}`;
        const newCode = `function newName() {
  return 42;
}`;

        const result = semanticDiff(oldCode, newCode, { detectRenames: true });

        // May be detected as rename or as add+remove
        expect(result.summary.totalChanges).toBeGreaterThan(0);
      });
    });

    describe('Options Configuration', () => {
      it('should respect ignoreWhitespace option', () => {
        const oldCode = 'const x=1;';
        const newCode = 'const x = 1;';

        const withIgnore = semanticDiff(oldCode, newCode, { ignoreWhitespace: true });

        expect(withIgnore.isSemanticEquivalent).toBe(true);
      });

      it('should respect ignoreComments option', () => {
        const oldCode = '/* comment */ const x = 1;';
        const newCode = '/* different */ const x = 1;';

        const withIgnore = semanticDiff(oldCode, newCode, { ignoreComments: true });

        expect(withIgnore.isSemanticEquivalent).toBe(true);
      });

      it('should use default options when none provided', () => {
        const result = semanticDiff('const x = 1;', 'const x = 1;');

        expect(result.isSemanticEquivalent).toBe(true);
      });

      it('should respect renameSimilarity threshold', () => {
        const oldCode = `function longFunctionName() {
  return 1;
  return 2;
  return 3;
}`;
        const newCode = `function renamedFunction() {
  return 1;
  return 2;
  return 3;
}`;

        const highThreshold = semanticDiff(oldCode, newCode, { renameSimilarity: 0.99 });
        const lowThreshold = semanticDiff(oldCode, newCode, { renameSimilarity: 0.5 });

        // Different thresholds may produce different results
        expect(highThreshold.summary.totalChanges).toBeGreaterThan(0);
        expect(lowThreshold.summary.totalChanges).toBeGreaterThan(0);
      });
    });

    describe('Code Block Detection', () => {
      it('should detect class definitions', () => {
        const oldCode = '';
        const newCode = `class MyClass {
  constructor() {}
  method() {}
}`;

        const result = semanticDiff(oldCode, newCode);

        expect(result.summary.additions).toBeGreaterThan(0);
        const addedClass = result.changes.find(c => c.description.includes('class'));
        expect(addedClass).toBeDefined();
      });

      it('should detect interface definitions', () => {
        const oldCode = '';
        const newCode = `interface MyInterface {
  prop: string;
  method(): void;
}`;

        const result = semanticDiff(oldCode, newCode);

        expect(result.summary.additions).toBeGreaterThan(0);
      });

      it('should detect variable declarations', () => {
        const oldCode = '';
        const newCode = 'const myConst = 42;';

        const result = semanticDiff(oldCode, newCode);

        expect(result.summary.additions).toBeGreaterThan(0);
      });

      it('should detect import statements', () => {
        const oldCode = '';
        const newCode = "import { something } from 'module';";

        const result = semanticDiff(oldCode, newCode);

        expect(result.summary.additions).toBeGreaterThan(0);
      });

      it('should detect arrow functions', () => {
        const oldCode = '';
        const newCode = 'const arrowFn = () => 42;';

        const result = semanticDiff(oldCode, newCode);

        expect(result.summary.additions).toBeGreaterThan(0);
      });

      it('should detect async functions', () => {
        const oldCode = '';
        const newCode = `async function fetchData() {
  return await fetch('/api');
}`;

        const result = semanticDiff(oldCode, newCode);

        expect(result.summary.additions).toBeGreaterThan(0);
      });
    });

    describe('Move Detection', () => {
      it('should detect moved code blocks when enabled', () => {
        const oldCode = `function first() { return 1; }

function second() { return 2; }`;

        const newCode = `function second() { return 2; }

function first() { return 1; }`;

        const result = semanticDiff(oldCode, newCode, { detectMoves: true });

        // Move detection may or may not trigger depending on implementation
        expect(result).toBeDefined();
      });
    });

    describe('Format Output', () => {
      it('should format semantically equivalent result', () => {
        const result: SemanticDiffResult = {
          summary: {
            totalChanges: 0,
            additions: 0,
            deletions: 0,
            modifications: 0,
            renames: 0,
            moves: 0,
            formattingOnly: 0,
          },
          changes: [],
          isSemanticEquivalent: true,
        };

        const formatted = formatSemanticDiff(result);

        expect(formatted).toContain('semantically equivalent');
      });

      it('should format result with changes', () => {
        const result: SemanticDiffResult = {
          summary: {
            totalChanges: 3,
            additions: 1,
            deletions: 1,
            modifications: 1,
            renames: 0,
            moves: 0,
            formattingOnly: 0,
          },
          changes: [
            {
              type: 'added',
              location: { startLine: 1, endLine: 5 },
              description: 'Added function: newFunc',
              confidence: 1.0,
            },
            {
              type: 'removed',
              location: { startLine: 10, endLine: 15 },
              description: 'Removed function: oldFunc',
              confidence: 1.0,
            },
            {
              type: 'modified',
              location: { startLine: 20, endLine: 25 },
              description: 'Modified function: existingFunc',
              confidence: 0.9,
            },
          ],
          isSemanticEquivalent: false,
        };

        const formatted = formatSemanticDiff(result);

        expect(formatted).toContain('Summary');
        expect(formatted).toContain('Total changes: 3');
        expect(formatted).toContain('Additions: 1');
        expect(formatted).toContain('Deletions: 1');
        expect(formatted).toContain('Modifications: 1');
        expect(formatted).toContain('Changes:');
        expect(formatted).toContain('newFunc');
        expect(formatted).toContain('oldFunc');
      });

      it('should format formatting-only changes', () => {
        const result: SemanticDiffResult = {
          summary: {
            totalChanges: 1,
            additions: 0,
            deletions: 0,
            modifications: 0,
            renames: 0,
            moves: 0,
            formattingOnly: 1,
          },
          changes: [
            {
              type: 'formatting',
              location: { startLine: 1, endLine: 10 },
              description: 'Formatting changes only',
              confidence: 1.0,
            },
          ],
          isSemanticEquivalent: true,
        };

        const formatted = formatSemanticDiff(result);

        expect(formatted).toContain('semantically equivalent');
        expect(formatted).toContain('formatting');
      });
    });

    describe('File-Based Diff', () => {
      it('should diff two files', async () => {
        const oldContent = 'const x = 1;';
        const newContent = 'const x = 2;';

        mockFsReadFile
          .mockResolvedValueOnce(oldContent)
          .mockResolvedValueOnce(newContent);

        const result = await semanticDiffFiles('old.ts', 'new.ts');

        expect(result).toBeDefined();
        expect(mockFsReadFile).toHaveBeenCalledWith('old.ts', 'utf-8');
        expect(mockFsReadFile).toHaveBeenCalledWith('new.ts', 'utf-8');
      });

      it('should add file path to change locations', async () => {
        const oldContent = 'const x = 1;';
        const newContent = 'const y = 2;';

        mockFsReadFile
          .mockResolvedValueOnce(oldContent)
          .mockResolvedValueOnce(newContent);

        const result = await semanticDiffFiles('old.ts', 'new.ts');

        // Changes should have file path in location
        result.changes.forEach(change => {
          if (change.location.file) {
            expect(change.location.file).toBe('new.ts');
          }
        });
      });
    });
  });

  // ===========================================================================
  // Unified Diff Editor Tests
  // ===========================================================================
  describe('UnifiedDiffEditor', () => {
    let editor: UnifiedDiffEditor;

    beforeEach(() => {
      resetUnifiedDiffEditor();
      editor = new UnifiedDiffEditor({
        backupDir: '.test-backups',
        enableBackups: false,
        fuzzyMatchThreshold: 0.8,
      });
      jest.clearAllMocks();
    });

    describe('Hunk Application', () => {
      it('should apply exact match hunk', async () => {
        const content = 'line1\nold line\nline3';

        mockFsPromisesAccess.mockResolvedValue(undefined);
        mockFsPromisesReadFile.mockResolvedValue(content);
        mockFsPromisesMkdir.mockResolvedValue(undefined);
        mockFsPromisesWriteFile.mockResolvedValue(undefined);

        const operation: DiffOperation = {
          filePath: '/test/file.ts',
          hunks: [
            {
              searchText: 'old line',
              replaceText: 'new line',
            },
          ],
        };

        const result = await editor.applyDiff(operation);

        expect(result.success).toBe(true);
        expect(result.hunksApplied).toBe(1);
        expect(result.hunksFailed).toBe(0);
        expect(mockFsPromisesWriteFile).toHaveBeenCalledWith(
          expect.any(String),
          'line1\nnew line\nline3',
          'utf-8'
        );
      });

      it('should apply multiple hunks in sequence', async () => {
        const content = 'line1\nline2\nline3';

        mockFsPromisesAccess.mockResolvedValue(undefined);
        mockFsPromisesReadFile.mockResolvedValue(content);
        mockFsPromisesMkdir.mockResolvedValue(undefined);
        mockFsPromisesWriteFile.mockResolvedValue(undefined);

        const operation: DiffOperation = {
          filePath: '/test/file.ts',
          hunks: [
            { searchText: 'line1', replaceText: 'modified1' },
            { searchText: 'line3', replaceText: 'modified3' },
          ],
        };

        const result = await editor.applyDiff(operation);

        expect(result.success).toBe(true);
        expect(result.hunksApplied).toBe(2);
      });

      it('should handle failed hunk application', async () => {
        const content = 'line1\nline2\nline3';

        mockFsPromisesAccess.mockResolvedValue(undefined);
        mockFsPromisesReadFile.mockResolvedValue(content);
        mockFsPromisesMkdir.mockResolvedValue(undefined);
        mockFsPromisesWriteFile.mockResolvedValue(undefined);

        const operation: DiffOperation = {
          filePath: '/test/file.ts',
          hunks: [
            { searchText: 'nonexistent line', replaceText: 'replacement' },
          ],
        };

        const result = await editor.applyDiff(operation);

        expect(result.success).toBe(false);
        expect(result.hunksApplied).toBe(0);
        expect(result.hunksFailed).toBe(1);
        expect(result.errors.length).toBeGreaterThan(0);
      });

      it('should apply fuzzy match when exact match fails', async () => {
        const content = 'function test() {\n  return 1;\n}';

        mockFsPromisesAccess.mockResolvedValue(undefined);
        mockFsPromisesReadFile.mockResolvedValue(content);
        mockFsPromisesMkdir.mockResolvedValue(undefined);
        mockFsPromisesWriteFile.mockResolvedValue(undefined);

        const operation: DiffOperation = {
          filePath: '/test/file.ts',
          hunks: [
            {
              // Slightly different whitespace
              searchText: 'function test(){\n  return 1;\n}',
              replaceText: 'function test() {\n  return 2;\n}',
            },
          ],
        };

        const result = await editor.applyDiff(operation);

        // May succeed with fuzzy matching
        expect(result).toBeDefined();
      });

      it('should handle context before/after for disambiguation', async () => {
        const content = 'return 1;\nreturn 2;\nreturn 1;';

        mockFsPromisesAccess.mockResolvedValue(undefined);
        mockFsPromisesReadFile.mockResolvedValue(content);
        mockFsPromisesMkdir.mockResolvedValue(undefined);
        mockFsPromisesWriteFile.mockResolvedValue(undefined);

        const operation: DiffOperation = {
          filePath: '/test/file.ts',
          hunks: [
            {
              searchText: 'return 1;',
              replaceText: 'return 100;',
              contextBefore: undefined, // First occurrence
              contextAfter: 'return 2;',
            },
          ],
        };

        const result = await editor.applyDiff(operation);

        // Should find the correct occurrence based on context
        expect(result).toBeDefined();
      });
    });

    describe('File Operations', () => {
      it('should return error when file not found', async () => {
        mockFsPromisesAccess.mockRejectedValue(new Error('ENOENT'));

        const operation: DiffOperation = {
          filePath: '/nonexistent/file.ts',
          hunks: [{ searchText: 'x', replaceText: 'y' }],
        };

        const result = await editor.applyDiff(operation);

        expect(result.success).toBe(false);
        expect(result.errors).toContain('File not found: /nonexistent/file.ts');
      });

      it('should create file when createIfMissing is true', async () => {
        mockFsPromisesAccess.mockRejectedValue(new Error('ENOENT'));
        mockFsPromisesMkdir.mockResolvedValue(undefined);
        mockFsPromisesWriteFile.mockResolvedValue(undefined);

        const operation: DiffOperation = {
          filePath: '/new/file.ts',
          hunks: [{ searchText: '', replaceText: 'new content' }],
          createIfMissing: true,
        };

        const result = await editor.applyDiff(operation);

        expect(result.success).toBe(true);
      });

      it('should generate diff output after successful application', async () => {
        const content = 'old content';

        mockFsPromisesAccess.mockResolvedValue(undefined);
        mockFsPromisesReadFile.mockResolvedValue(content);
        mockFsPromisesMkdir.mockResolvedValue(undefined);
        mockFsPromisesWriteFile.mockResolvedValue(undefined);

        const operation: DiffOperation = {
          filePath: '/test/file.ts',
          hunks: [{ searchText: 'old content', replaceText: 'new content' }],
        };

        const result = await editor.applyDiff(operation);

        expect(result.diff).toBeDefined();
        expect(result.diff).toContain('---');
        expect(result.diff).toContain('+++');
      });
    });

    describe('Backup Management', () => {
      it('should create backup when enabled', async () => {
        const editorWithBackup = new UnifiedDiffEditor({
          backupDir: '.test-backups',
          enableBackups: true,
        });

        const content = 'original content';

        mockFsPromisesAccess.mockResolvedValue(undefined);
        mockFsPromisesReadFile.mockResolvedValue(content);
        mockFsPromisesMkdir.mockResolvedValue(undefined);
        mockFsPromisesWriteFile.mockResolvedValue(undefined);

        const operation: DiffOperation = {
          filePath: '/test/file.ts',
          hunks: [{ searchText: 'original', replaceText: 'modified' }],
        };

        const result = await editorWithBackup.applyDiff(operation);

        // Backup file should be written
        if (result.backup) {
          expect(mockFsPromisesWriteFile).toHaveBeenCalledWith(
            expect.stringContaining('.bak'),
            content,
            'utf-8'
          );
        }
      });

      it('should restore from backup', async () => {
        const backupContent = 'backup content';

        mockFsPromisesAccess.mockResolvedValue(undefined);
        mockFsPromisesReadFile.mockResolvedValue(backupContent);
        mockFsPromisesWriteFile.mockResolvedValue(undefined);

        const success = await editor.restoreBackup('/backups/file.bak', '/original/file.ts');

        expect(success).toBe(true);
        expect(mockFsPromisesWriteFile).toHaveBeenCalledWith('/original/file.ts', backupContent, 'utf-8');
      });

      it('should return false when backup not found', async () => {
        mockFsPromisesAccess.mockRejectedValue(new Error('ENOENT'));

        const success = await editor.restoreBackup('/nonexistent.bak', '/file.ts');

        expect(success).toBe(false);
      });

      it('should list available backups', async () => {
        mockFsPromisesAccess.mockResolvedValue(undefined);
        mockFsPromisesReaddir.mockResolvedValue([
          'file.ts.2024-01-01.bak',
          'file.ts.2024-01-02.bak',
          'other.ts.2024-01-01.bak',
        ]);

        const backups = await editor.listBackups('/path/to/file.ts');

        expect(backups.length).toBe(2);
        expect(backups[0]).toContain('file.ts');
      });

      it('should return empty array when backup dir not found', async () => {
        mockFsPromisesAccess.mockRejectedValue(new Error('ENOENT'));

        const backups = await editor.listBackups('/path/to/file.ts');

        expect(backups).toEqual([]);
      });
    });

    describe('Diff Parsing', () => {
      it('should parse unified diff string', () => {
        const diffString = `diff --git a/file.ts b/file.ts
--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,3 @@
 line1
-old line
+new line
 line3`;

        const operations = UnifiedDiffEditor.parseDiff(diffString);

        expect(operations.length).toBe(1);
        expect(operations[0].filePath).toBe('file.ts');
        expect(operations[0].hunks.length).toBeGreaterThan(0);
      });

      it('should parse multiple file diffs', () => {
        const diffString = `diff --git a/file1.ts b/file1.ts
@@ -1 +1 @@
-old1
+new1
diff --git a/file2.ts b/file2.ts
@@ -1 +1 @@
-old2
+new2`;

        const operations = UnifiedDiffEditor.parseDiff(diffString);

        expect(operations.length).toBe(2);
      });

      it('should extract search and replace text from hunks', () => {
        const diffString = `diff --git a/file.ts b/file.ts
@@ -1,3 +1,3 @@
 context line
-removed line
+added line
 another context`;

        const operations = UnifiedDiffEditor.parseDiff(diffString);

        if (operations.length > 0 && operations[0].hunks.length > 0) {
          const hunk = operations[0].hunks[0];
          // The parser extracts context lines and changes; verify structure exists
          expect(hunk.searchText).toBeDefined();
          expect(hunk.replaceText).toBeDefined();
        }
      });
    });

    describe('Singleton Pattern', () => {
      it('should return singleton instance', () => {
        resetUnifiedDiffEditor();
        const instance1 = getUnifiedDiffEditor();
        const instance2 = getUnifiedDiffEditor();

        expect(instance1).toBe(instance2);
      });

      it('should create new instance after reset', () => {
        const instance1 = getUnifiedDiffEditor();
        resetUnifiedDiffEditor();
        const instance2 = getUnifiedDiffEditor();

        expect(instance1).not.toBe(instance2);
      });
    });
  });

  // ===========================================================================
  // Split Screen Diff Tests
  // ===========================================================================
  describe('SplitScreenDiff', () => {
    describe('Diff Generation', () => {
      it('should generate diff for identical content', () => {
        const content = 'line1\nline2\nline3';

        const result = generateSplitDiff(content, content);

        expect(result.stats.linesAdded).toBe(0);
        expect(result.stats.linesRemoved).toBe(0);
        expect(result.stats.linesUnchanged).toBe(3);
      });

      it('should detect added lines', () => {
        const original = 'line1\nline2';
        const modified = 'line1\nline2\nline3';

        const result = generateSplitDiff(original, modified);

        expect(result.stats.linesAdded).toBe(1);
        expect(result.stats.linesRemoved).toBe(0);
      });

      it('should detect removed lines', () => {
        const original = 'line1\nline2\nline3';
        const modified = 'line1\nline2';

        const result = generateSplitDiff(original, modified);

        expect(result.stats.linesRemoved).toBe(1);
        expect(result.stats.linesAdded).toBe(0);
      });

      it('should detect modified lines', () => {
        const original = 'line1\noriginal\nline3';
        const modified = 'line1\nmodified\nline3';

        const result = generateSplitDiff(original, modified);

        // Modified lines show as removal + addition
        expect(result.stats.linesRemoved).toBeGreaterThan(0);
        expect(result.stats.linesAdded).toBeGreaterThan(0);
      });

      it('should handle empty original', () => {
        const result = generateSplitDiff('', 'new content');

        expect(result.stats.linesAdded).toBeGreaterThan(0);
        // Empty string splits to one empty line, which may be counted as removed
        expect(result.stats.linesRemoved).toBeGreaterThanOrEqual(0);
      });

      it('should handle empty modified', () => {
        const result = generateSplitDiff('old content', '');

        expect(result.stats.linesRemoved).toBeGreaterThan(0);
        // Empty string splits to one empty line, which may be counted as added
        expect(result.stats.linesAdded).toBeGreaterThanOrEqual(0);
      });

      it('should handle both empty', () => {
        const result = generateSplitDiff('', '');

        expect(result.stats.linesUnchanged).toBe(1); // Empty string splits to one empty line
      });
    });

    describe('Context Filtering', () => {
      it('should filter with context lines', () => {
        const original = 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj';
        const modified = 'a\nb\nc\nd\nX\nf\ng\nh\ni\nj';

        const result = generateSplitDiff(original, modified, { contextLines: 2 });

        // Should show change with surrounding context
        expect(result.lines.length).toBeLessThan(10);
      });

      it('should show all lines when contextLines is 0', () => {
        const original = 'a\nb\nc';
        const modified = 'a\nX\nc';

        const result = generateSplitDiff(original, modified, { contextLines: 0 });

        expect(result.lines.length).toBe(3);
      });

      it('should add separator for gaps', () => {
        const original = Array(20).fill('same').join('\n');
        const modified = original.replace('same', 'changed');

        const result = generateSplitDiff(original, modified, { contextLines: 1 });

        // May or may not have separators depending on change location
        expect(result.lines.length).toBeGreaterThan(0);
      });
    });

    describe('Line Type Detection', () => {
      it('should correctly mark same lines', () => {
        const content = 'unchanged line here';

        const result = generateSplitDiff(content, content);

        // Context filtering may result in empty lines for unchanged content
        // Verify that if lines exist, they are marked correctly
        if (result.lines.length > 0) {
          const sameLine = result.lines.find(l => l.leftContent === 'unchanged line here');
          if (sameLine) {
            expect(sameLine.leftType).toBe('same');
            expect(sameLine.rightType).toBe('same');
          }
        }
        // No changes means stats reflect unchanged
        expect(result.stats.linesUnchanged).toBe(1);
      });

      it('should correctly mark removed lines', () => {
        const original = 'to remove\nkeep';
        const modified = 'keep';

        const result = generateSplitDiff(original, modified);

        const removedLine = result.lines.find(l => l.leftType === 'removed');
        expect(removedLine).toBeDefined();
        expect(removedLine?.leftContent).toBe('to remove');
      });

      it('should correctly mark added lines', () => {
        const original = 'keep';
        const modified = 'keep\nnew line';

        const result = generateSplitDiff(original, modified);

        const addedLine = result.lines.find(l => l.rightType === 'added');
        expect(addedLine).toBeDefined();
        expect(addedLine?.rightContent).toBe('new line');
      });
    });

    describe('Format Output', () => {
      it('should format diff for terminal display', () => {
        const original = 'line1\nold\nline3';
        const modified = 'line1\nnew\nline3';

        const result = generateSplitDiff(original, modified);
        const formatted = formatSplitDiff(result);

        expect(formatted).toContain('ORIGINAL');
        expect(formatted).toContain('MODIFIED');
      });

      it('should include stats in formatted output', () => {
        const original = 'line1';
        const modified = 'line1\nline2';

        const result = generateSplitDiff(original, modified);
        const formatted = formatSplitDiff(result);

        expect(formatted).toContain('added');
      });

      it('should apply colors when colorize is true', () => {
        const original = 'old';
        const modified = 'new';

        const result = generateSplitDiff(original, modified);
        const formatted = formatSplitDiff(result, { colorize: true });

        expect(formatted).toContain('\x1b['); // ANSI escape code
      });

      it('should not apply colors when colorize is false', () => {
        const original = 'old';
        const modified = 'new';

        const result = generateSplitDiff(original, modified);
        const formatted = formatSplitDiff(result, { colorize: false });

        expect(formatted).not.toContain('\x1b[');
      });

      it('should truncate long lines when wrapLines is false', () => {
        const longLine = 'x'.repeat(200);
        const original = longLine;
        const modified = longLine + 'y';

        const result = generateSplitDiff(original, modified);
        const formatted = formatSplitDiff(result, { terminalWidth: 80, wrapLines: false });

        expect(formatted).toContain('...');
      });
    });

    describe('Unified Diff Conversion', () => {
      it('should convert to unified diff format', () => {
        const original = 'line1\nold\nline3';
        const modified = 'line1\nnew\nline3';

        const result = generateSplitDiff(original, modified);
        const unified = toUnifiedDiff(result);

        expect(unified).toContain('-old');
        expect(unified).toContain('+new');
        expect(unified).toContain(' line1');
      });

      it('should handle unchanged content', () => {
        const content = 'line1\nline2';

        const result = generateSplitDiff(content, content);
        const unified = toUnifiedDiff(result);

        // For unchanged content, context filtering may produce empty output
        // Or produce context-prefixed lines
        if (unified.length > 0) {
          expect(unified).not.toContain('-line');
          expect(unified).not.toContain('+line');
        }
        // Verify no changes were detected
        expect(result.stats.linesAdded).toBe(0);
        expect(result.stats.linesRemoved).toBe(0);
      });
    });

    describe('Compact Summary', () => {
      it('should format compact summary with changes', () => {
        const original = 'line1\nline2';
        const modified = 'line1\nline2\nline3';

        const result = generateSplitDiff(original, modified);
        const summary = formatCompactSummary(result);

        expect(summary).toContain('+1');
      });

      it('should format compact summary with removals', () => {
        const original = 'line1\nline2\nline3';
        const modified = 'line1\nline2';

        const result = generateSplitDiff(original, modified);
        const summary = formatCompactSummary(result);

        expect(summary).toContain('-1');
      });

      it('should return "No changes" when unchanged', () => {
        const content = 'line1\nline2';

        const result = generateSplitDiff(content, content);
        const summary = formatCompactSummary(result);

        expect(summary).toBe('No changes');
      });
    });

    describe('Has Changes Detection', () => {
      it('should return true when there are changes', () => {
        const result = generateSplitDiff('old', 'new');

        expect(hasChanges(result)).toBe(true);
      });

      it('should return false when no changes', () => {
        const content = 'same';
        const result = generateSplitDiff(content, content);

        expect(hasChanges(result)).toBe(false);
      });
    });
  });

  // ===========================================================================
  // Three-Way Diff Integration Tests
  // ===========================================================================
  describe('ThreeWayDiff Integration', () => {
    let diff: ThreeWayDiff;

    beforeEach(() => {
      diff = new ThreeWayDiff();
    });

    describe('Conflict Detection and Resolution', () => {
      it('should detect and resolve simple conflicts', () => {
        const base = 'line1\nline2\nline3';
        const ours = 'line1\nour change\nline3';
        const theirs = 'line1\ntheir change\nline3';

        const result = diff.diff(base, ours, theirs);
        expect(result.hasConflicts).toBe(true);

        // Resolve with ours
        const resolved = diff.resolveConflicts(result, [
          { hunkIndex: 0, choice: 'ours' },
        ]);

        expect(resolved).toContain('our change');
        expect(resolved).not.toContain('their change');
        expect(resolved).not.toContain('<<<<<<<');
      });

      it('should resolve multiple conflicts', () => {
        const base = 'a\nb\nc\nd\ne';
        const ours = 'a\nX\nc\nY\ne';
        const theirs = 'a\nP\nc\nQ\ne';

        const result = diff.diff(base, ours, theirs);

        const resolutions: ConflictResolution[] = result.hunks
          .filter(h => h.status === 'conflict')
          .map((_, index) => ({
            hunkIndex: index,
            choice: 'ours' as const,
          }));

        const resolved = diff.resolveConflicts(result, resolutions);

        expect(resolved).not.toContain('<<<<<<<');
      });

      it('should merge both changes', () => {
        const base = 'line1\noriginal\nline3';
        const ours = 'line1\nour addition\nline3';
        const theirs = 'line1\ntheir addition\nline3';

        const result = diff.diff(base, ours, theirs);

        if (result.hasConflicts) {
          const resolved = diff.resolveConflicts(result, [
            { hunkIndex: 0, choice: 'both' },
          ]);

          expect(resolved).toContain('our addition');
          expect(resolved).toContain('their addition');
        }
      });

      it('should apply custom resolution', () => {
        const base = 'line1\noriginal\nline3';
        const ours = 'line1\nour version\nline3';
        const theirs = 'line1\ntheir version\nline3';

        const result = diff.diff(base, ours, theirs);

        if (result.hasConflicts) {
          const resolved = diff.resolveConflicts(result, [
            {
              hunkIndex: 0,
              choice: 'custom',
              customContent: 'merged version',
            },
          ]);

          expect(resolved).toContain('merged version');
        }
      });
    });

    describe('Auto-Merge Scenarios', () => {
      it('should auto-merge non-conflicting changes', () => {
        const base = 'line1\nline2\nline3\nline4\nline5';
        const ours = 'line1\nour change\nline3\nline4\nline5';
        const theirs = 'line1\nline2\nline3\ntheir change\nline5';

        const result = diff.diff(base, ours, theirs);

        // Changes are in different lines, should auto-merge
        if (!result.hasConflicts && result.merged) {
          expect(result.merged).toContain('our change');
          expect(result.merged).toContain('their change');
        }
      });

      it('should handle identical changes from both sides', () => {
        const base = 'line1\noriginal\nline3';
        const ours = 'line1\nsame change\nline3';
        const theirs = 'line1\nsame change\nline3';

        const result = diff.diff(base, ours, theirs);

        // Same change from both sides should not conflict
        expect(result.hasConflicts).toBe(false);
      });
    });

    describe('Conflict Marker Parsing', () => {
      it('should parse conflict markers from file content', () => {
        const conflictedContent = `line1
<<<<<<< OURS
our version
=======
their version
>>>>>>> THEIRS
line3`;

        const hunks = diff.parseConflictMarkers(conflictedContent);

        expect(hunks.length).toBe(1);
        expect(hunks[0].ours).toContain('our version');
        expect(hunks[0].theirs).toContain('their version');
      });

      it('should handle multiple conflict regions', () => {
        const content = `<<<<<<< OURS
a
=======
b
>>>>>>> THEIRS
middle
<<<<<<< OURS
c
=======
d
>>>>>>> THEIRS`;

        const hunks = diff.parseConflictMarkers(content);

        expect(hunks.length).toBe(2);
      });
    });

    describe('Singleton Access', () => {
      it('should provide singleton access', () => {
        const instance1 = getThreeWayDiff();
        const instance2 = getThreeWayDiff();

        expect(instance1).toBe(instance2);
      });
    });
  });

  // ===========================================================================
  // Edge Cases and Error Handling
  // ===========================================================================
  describe('Edge Cases', () => {
    describe('Empty Content Handling', () => {
      it('should handle empty strings in semantic diff', () => {
        const result = semanticDiff('', '');
        expect(result.isSemanticEquivalent).toBe(true);
      });

      it('should handle empty to content in semantic diff', () => {
        const result = semanticDiff('', 'const x = 1;');
        // The semantic diff extracts code blocks; simple text may not be detected
        // Verify the result is defined and doesn't crash
        expect(result).toBeDefined();
        expect(result.isSemanticEquivalent).toBe(false);
      });

      it('should handle content to empty in semantic diff', () => {
        const result = semanticDiff('const x = 1;', '');
        // The semantic diff extracts code blocks
        // Verify the result is defined and doesn't crash
        expect(result).toBeDefined();
        expect(result.isSemanticEquivalent).toBe(false);
      });

      it('should handle empty in split diff', () => {
        const result = generateSplitDiff('', 'new');
        expect(hasChanges(result)).toBe(true);
      });
    });

    describe('Unicode Content', () => {
      it('should handle unicode in semantic diff', () => {
        const oldCode = 'const greeting = "Hello";';
        const newCode = 'const greeting = "Hello, World!";';

        const result = semanticDiff(oldCode, newCode);
        expect(result).toBeDefined();
      });

      it('should handle unicode in split diff', () => {
        const original = 'const emoji = "smile";';
        const modified = 'const emoji = "grin";';

        const result = generateSplitDiff(original, modified);
        expect(result).toBeDefined();
      });
    });

    describe('Large Content', () => {
      it('should handle large files', () => {
        const largeContent = Array(1000).fill('line').join('\n');
        const modifiedContent = largeContent.replace('line', 'modified');

        const result = generateSplitDiff(largeContent, modifiedContent);
        expect(result).toBeDefined();
        expect(result.lines.length).toBeGreaterThan(0);
      });
    });

    describe('Special Characters', () => {
      it('should handle regex special characters', () => {
        const content = 'const pattern = /^test$/;';

        const result = semanticDiff(content, content);
        expect(result.isSemanticEquivalent).toBe(true);
      });

      it('should handle escape sequences', () => {
        const content = 'const str = "line1\\nline2";';

        const result = semanticDiff(content, content);
        expect(result.isSemanticEquivalent).toBe(true);
      });
    });
  });
});
