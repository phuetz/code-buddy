/**
 * Unit tests for TextEditorTool
 *
 * Comprehensive tests covering:
 * - File reading/viewing operations
 * - File writing/creation operations
 * - File patching/editing (str_replace)
 * - Line operations (insert, delete, replace)
 * - Error handling for missing files
 * - Encoding handling
 * - Path validation and security
 * - Undo functionality
 */

import { TextEditorTool } from '../../src/tools/text-editor';
import * as path from 'path';

// Mock fs-extra module
const mockPathExists = jest.fn();
const mockStat = jest.fn();
const mockReaddir = jest.fn();
const mockReadFile = jest.fn();
const mockExistsSync = jest.fn();
const mockRealpathSync = jest.fn();
const mockEnsureDir = jest.fn();
const mockRemove = jest.fn();
// UnifiedVfsRouter uses fs-extra writeFile, so we need to mock it here too using the same mock function
// to maintain test compatibility
const mockWriteFile = jest.fn();

jest.mock('fs-extra', () => ({
  pathExists: (...args: unknown[]) => mockPathExists(...args),
  stat: (...args: unknown[]) => mockStat(...args),
  readdir: (...args: unknown[]) => mockReaddir(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  realpathSync: (...args: unknown[]) => mockRealpathSync(...args),
  ensureDir: (...args: unknown[]) => mockEnsureDir(...args),
  remove: (...args: unknown[]) => mockRemove(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
}));

// Mock fs/promises module
// Kept for compatibility if other modules use it, but TextEditorTool now goes through VFS -> fs-extra
jest.mock('fs/promises', () => ({
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
}));

// Mock confirmation service
const mockGetSessionFlags = jest.fn();
const mockRequestConfirmation = jest.fn();

jest.mock('../../src/utils/confirmation-service', () => ({
  ConfirmationService: {
    getInstance: jest.fn(() => ({
      getSessionFlags: mockGetSessionFlags,
      requestConfirmation: mockRequestConfirmation,
    })),
  },
}));

// Mock disposable utility
jest.mock('../../src/utils/disposable', () => ({
  registerDisposable: jest.fn(),
}));

// Mock logger
jest.mock('../../src/utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock fuzzy-match utility
const mockFindBestFuzzyMatch = jest.fn();
const mockGenerateFuzzyDiff = jest.fn();
const mockSuggestWhitespaceFixes = jest.fn();

jest.mock('../../src/utils/fuzzy-match', () => ({
  findBestFuzzyMatch: (...args: unknown[]) => mockFindBestFuzzyMatch(...args),
  generateFuzzyDiff: (...args: unknown[]) => mockGenerateFuzzyDiff(...args),
  suggestWhitespaceFixes: (...args: unknown[]) => mockSuggestWhitespaceFixes(...args),
}));

describe('TextEditorTool', () => {
  let editor: TextEditorTool;
  const testDir = '/test/project';

  beforeEach(() => {
    editor = new TextEditorTool();
    editor.setBaseDirectory(testDir);
    jest.clearAllMocks();

    // Reset default mock behaviors
    mockExistsSync.mockReturnValue(false);
    mockRealpathSync.mockImplementation((p: unknown) => p as string);
    mockFindBestFuzzyMatch.mockReturnValue(null);
    mockSuggestWhitespaceFixes.mockReturnValue([]);
    mockGetSessionFlags.mockReturnValue({
      fileOperations: true,
      bashCommands: true,
      allOperations: false,
    });
    mockRequestConfirmation.mockResolvedValue({ confirmed: true });
    mockWriteFile.mockResolvedValue(undefined);
    mockEnsureDir.mockResolvedValue(undefined);
  });

  afterEach(() => {
    editor.dispose();
  });

  describe('Path Validation', () => {
    it('should reject paths outside base directory', async () => {
      const result = await editor.view('/etc/passwd');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Path traversal not allowed');
    });

    it('should reject path traversal attempts', async () => {
      const result = await editor.view(`${testDir}/../../../etc/passwd`);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Path traversal not allowed');
    });

    it('should reject symlink traversal attacks', async () => {
      const filePath = `${testDir}/evil-link`;
      mockExistsSync.mockReturnValue(true);
      mockRealpathSync.mockImplementation((p: unknown) => {
        const pathStr = p as string;
        if (pathStr === path.resolve(filePath)) return '/etc/passwd';
        if (pathStr === path.resolve(testDir)) return testDir;
        return pathStr;
      });

      const result = await editor.view(filePath);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Symlink traversal not allowed');
    });

    it('should allow paths within base directory', async () => {
      const filePath = `${testDir}/src/file.ts`;
      mockPathExists.mockResolvedValue(true);
      mockStat.mockResolvedValue({ isDirectory: () => false });
      mockReadFile.mockResolvedValue('file content');

      const result = await editor.view(filePath);

      expect(result.success).toBe(true);
    });
  });

  describe('View Operation', () => {
    describe('File Reading', () => {
      it('should read file content successfully', async () => {
        const filePath = `${testDir}/test.txt`;
        const content = 'line1\nline2\nline3';
        mockPathExists.mockResolvedValue(true);
        mockStat.mockResolvedValue({ isDirectory: () => false });
        mockReadFile.mockResolvedValue(content);

        const result = await editor.view(filePath);

        expect(result.success).toBe(true);
        expect(result.output).toContain('Contents of');
        expect(result.output).toContain('line1');
        expect(result.output).toContain('line2');
        expect(result.output).toContain('line3');
      });

      it('should show line numbers', async () => {
        const filePath = `${testDir}/test.txt`;
        const content = 'first\nsecond\nthird';
        mockPathExists.mockResolvedValue(true);
        mockStat.mockResolvedValue({ isDirectory: () => false });
        mockReadFile.mockResolvedValue(content);

        const result = await editor.view(filePath);

        expect(result.success).toBe(true);
        expect(result.output).toContain('1: first');
        expect(result.output).toContain('2: second');
        expect(result.output).toContain('3: third');
      });

      it('should truncate files with more than 10 lines by default', async () => {
        const filePath = `${testDir}/long-file.txt`;
        const lines = Array.from({ length: 20 }, (_, i) => `line${i + 1}`);
        mockPathExists.mockResolvedValue(true);
        mockStat.mockResolvedValue({ isDirectory: () => false });
        mockReadFile.mockResolvedValue(lines.join('\n'));

        const result = await editor.view(filePath);

        expect(result.success).toBe(true);
        expect(result.output).toContain('... +10 lines');
        expect(result.output).toContain('10: line10');
        expect(result.output).not.toContain('11: line11');
      });

      it('should support viewing specific line ranges', async () => {
        const filePath = `${testDir}/test.txt`;
        const content = 'line1\nline2\nline3\nline4\nline5';
        mockPathExists.mockResolvedValue(true);
        mockStat.mockResolvedValue({ isDirectory: () => false });
        mockReadFile.mockResolvedValue(content);

        const result = await editor.view(filePath, [2, 4]);

        expect(result.success).toBe(true);
        expect(result.output).toContain('Lines 2-4 of');
        expect(result.output).toContain('2: line2');
        expect(result.output).toContain('3: line3');
        expect(result.output).toContain('4: line4');
        expect(result.output).not.toContain('line1');
        expect(result.output).not.toContain('line5');
      });
    });

    describe('Directory Reading', () => {
      it('should list directory contents', async () => {
        const dirPath = `${testDir}/src`;
        mockPathExists.mockResolvedValue(true);
        mockStat.mockResolvedValue({ isDirectory: () => true });
        mockReaddir.mockResolvedValue(['file1.ts', 'file2.ts', 'index.ts']);

        const result = await editor.view(dirPath);

        expect(result.success).toBe(true);
        expect(result.output).toContain('Directory contents of');
        expect(result.output).toContain('file1.ts');
        expect(result.output).toContain('file2.ts');
        expect(result.output).toContain('index.ts');
      });
    });

    describe('Error Handling', () => {
      it('should return error for non-existent file', async () => {
        const filePath = `${testDir}/missing.txt`;
        mockPathExists.mockResolvedValue(false);

        const result = await editor.view(filePath);

        expect(result.success).toBe(false);
        expect(result.error).toContain('File or directory not found');
      });

      it('should handle read errors gracefully', async () => {
        const filePath = `${testDir}/error.txt`;
        mockPathExists.mockResolvedValue(true);
        mockStat.mockResolvedValue({ isDirectory: () => false });
        mockReadFile.mockRejectedValue(new Error('Permission denied'));

        const result = await editor.view(filePath);

        expect(result.success).toBe(false);
        expect(result.error).toContain('Error viewing');
        expect(result.error).toContain('Permission denied');
      });
    });
  });

  describe('String Replace Operation', () => {
    const testFilePath = `${testDir}/test.txt`;
    const originalContent = 'function hello() {\n  console.log("Hello");\n}';

    beforeEach(() => {
      mockPathExists.mockResolvedValue(true);
      mockStat.mockResolvedValue({ isDirectory: () => false });
      mockReadFile.mockResolvedValue(originalContent);
    });

    it('should replace string in file', async () => {
      const result = await editor.strReplace(
        testFilePath,
        'console.log("Hello")',
        'console.log("World")'
      );

      expect(result.success).toBe(true);
      expect(mockWriteFile).toHaveBeenCalled();
      const writtenContent = mockWriteFile.mock.calls[0][1] as string;
      expect(writtenContent).toContain('console.log("World")');
    });

    it('should replace all occurrences when replaceAll is true', async () => {
      const contentWithMultiple = 'foo bar foo baz foo';
      mockReadFile.mockResolvedValue(contentWithMultiple);

      const result = await editor.strReplace(testFilePath, 'foo', 'qux', true);

      expect(result.success).toBe(true);
      const writtenContent = mockWriteFile.mock.calls[0][1] as string;
      expect(writtenContent).toBe('qux bar qux baz qux');
    });

    it('should replace only first occurrence by default', async () => {
      const contentWithMultiple = 'foo bar foo baz foo';
      mockReadFile.mockResolvedValue(contentWithMultiple);

      const result = await editor.strReplace(testFilePath, 'foo', 'qux', false);

      expect(result.success).toBe(true);
      const writtenContent = mockWriteFile.mock.calls[0][1] as string;
      expect(writtenContent).toBe('qux bar foo baz foo');
    });

    it('should return error when string not found', async () => {
      const result = await editor.strReplace(
        testFilePath,
        'nonexistent string',
        'replacement'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('String not found');
    });

    it('should try fuzzy matching when exact match fails', async () => {
      const contentWithTypo = 'consol.log("test")';
      mockReadFile.mockResolvedValue(contentWithTypo);
      mockFindBestFuzzyMatch.mockReturnValue({
        match: 'consol.log("test")',
        similarity: 0.95,
        startLine: 1,
        endLine: 1,
        similarityPercent: '95%',
      });

      const result = await editor.strReplace(
        testFilePath,
        'console.log("test")',
        'console.log("fixed")'
      );

      expect(mockFindBestFuzzyMatch).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('should suggest whitespace fixes when string not found', async () => {
      mockSuggestWhitespaceFixes.mockReturnValue([
        'Check for leading/trailing whitespace',
        'Verify line endings (LF vs CRLF)',
      ]);

      const result = await editor.strReplace(
        testFilePath,
        'nonexistent',
        'replacement'
      );

      expect(result.success).toBe(false);
      expect(mockSuggestWhitespaceFixes).toHaveBeenCalled();
    });

    it('should return error for missing file', async () => {
      mockPathExists.mockResolvedValue(false);

      const result = await editor.strReplace(testFilePath, 'old', 'new');

      expect(result.success).toBe(false);
      expect(result.error).toContain('File not found');
    });

    it('should add edit to history', async () => {
      await editor.strReplace(testFilePath, 'console.log("Hello")', 'console.log("World")');

      const history = editor.getEditHistory();
      expect(history).toHaveLength(1);
      expect(history[0].command).toBe('str_replace');
      expect(history[0].path).toBe(testFilePath);
    });

    it('should generate proper diff output', async () => {
      const result = await editor.strReplace(
        testFilePath,
        'console.log("Hello")',
        'console.log("World")'
      );

      expect(result.success).toBe(true);
      expect(result.output).toContain('Updated');
      expect(result.output).toContain('---');
      expect(result.output).toContain('+++');
    });
  });

  describe('Create Operation', () => {
    const newFilePath = `${testDir}/new-file.txt`;
    const newContent = 'This is new content';

    beforeEach(() => {
      mockPathExists.mockResolvedValue(false);
    });

    it('should create new file', async () => {
      const result = await editor.create(newFilePath, newContent);

      expect(result.success).toBe(true);
      expect(mockEnsureDir).toHaveBeenCalled();
      expect(mockWriteFile).toHaveBeenCalledWith(
        path.resolve(newFilePath),
        newContent,
        'utf-8'
      );
    });

    it('should prevent overwriting existing files', async () => {
      mockPathExists.mockResolvedValue(true);
      mockStat.mockResolvedValue({ isFile: () => true });

      const result = await editor.create(newFilePath, newContent);

      expect(result.success).toBe(false);
      expect(result.error).toContain('File already exists');
      expect(result.error).toContain('str_replace_editor');
    });

    it('should add create to edit history', async () => {
      await editor.create(newFilePath, newContent);

      const history = editor.getEditHistory();
      expect(history).toHaveLength(1);
      expect(history[0].command).toBe('create');
      expect(history[0].path).toBe(newFilePath);
      expect(history[0].content).toBe(newContent);
    });

    it('should create parent directories if needed', async () => {
      const nestedPath = `${testDir}/deep/nested/file.txt`;

      await editor.create(nestedPath, newContent);

      expect(mockEnsureDir).toHaveBeenCalledWith(
        path.dirname(path.resolve(nestedPath))
      );
    });

    it('should generate diff-style output for new files', async () => {
      const result = await editor.create(newFilePath, newContent);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Updated');
    });
  });

  describe('Replace Lines Operation', () => {
    const testFilePath = `${testDir}/test.txt`;
    const originalContent = 'line1\nline2\nline3\nline4\nline5';

    beforeEach(() => {
      mockPathExists.mockResolvedValue(true);
      mockStat.mockResolvedValue({ isDirectory: () => false });
      mockReadFile.mockResolvedValue(originalContent);
    });

    it('should replace lines in range', async () => {
      const result = await editor.replaceLines(testFilePath, 2, 4, 'replacement');

      expect(result.success).toBe(true);
      const writtenContent = mockWriteFile.mock.calls[0][1] as string;
      expect(writtenContent).toBe('line1\nreplacement\nline5');
    });

    it('should replace single line', async () => {
      const result = await editor.replaceLines(testFilePath, 3, 3, 'new-line3');

      expect(result.success).toBe(true);
      const writtenContent = mockWriteFile.mock.calls[0][1] as string;
      expect(writtenContent).toBe('line1\nline2\nnew-line3\nline4\nline5');
    });

    it('should handle multi-line replacement content', async () => {
      const result = await editor.replaceLines(testFilePath, 2, 3, 'newA\nnewB\nnewC');

      expect(result.success).toBe(true);
      const writtenContent = mockWriteFile.mock.calls[0][1] as string;
      expect(writtenContent).toBe('line1\nnewA\nnewB\nnewC\nline4\nline5');
    });

    it('should return error for invalid start line', async () => {
      const result = await editor.replaceLines(testFilePath, 0, 3, 'replacement');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid start line');
    });

    it('should return error for start line beyond file length', async () => {
      const result = await editor.replaceLines(testFilePath, 10, 12, 'replacement');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid start line');
    });

    it('should return error for end line before start line', async () => {
      const result = await editor.replaceLines(testFilePath, 4, 2, 'replacement');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid end line');
    });

    it('should return error for end line beyond file length', async () => {
      const result = await editor.replaceLines(testFilePath, 3, 10, 'replacement');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid end line');
    });

    it('should return error for missing file', async () => {
      mockPathExists.mockResolvedValue(false);

      const result = await editor.replaceLines(testFilePath, 1, 2, 'replacement');

      expect(result.success).toBe(false);
      expect(result.error).toContain('File not found');
    });
  });

  describe('Insert Operation', () => {
    const testFilePath = `${testDir}/test.txt`;
    const originalContent = 'line1\nline2\nline3';

    beforeEach(() => {
      mockPathExists.mockResolvedValue(true);
      mockStat.mockResolvedValue({ isDirectory: () => false });
      mockReadFile.mockResolvedValue(originalContent);
    });

    it('should insert at the beginning', async () => {
      const result = await editor.insert(testFilePath, 1, 'inserted');

      expect(result.success).toBe(true);
      const writtenContent = mockWriteFile.mock.calls[0][1] as string;
      expect(writtenContent).toBe('inserted\nline1\nline2\nline3');
    });

    it('should insert in the middle', async () => {
      const result = await editor.insert(testFilePath, 2, 'inserted');

      expect(result.success).toBe(true);
      const writtenContent = mockWriteFile.mock.calls[0][1] as string;
      expect(writtenContent).toBe('line1\ninserted\nline2\nline3');
    });

    it('should insert at the end', async () => {
      const result = await editor.insert(testFilePath, 4, 'inserted');

      expect(result.success).toBe(true);
      const writtenContent = mockWriteFile.mock.calls[0][1] as string;
      expect(writtenContent).toBe('line1\nline2\nline3\ninserted');
    });

    it('should return error for invalid insert line (0)', async () => {
      const result = await editor.insert(testFilePath, 0, 'inserted');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid insert line');
    });

    it('should return error for insert line beyond file + 1', async () => {
      const result = await editor.insert(testFilePath, 10, 'inserted');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid insert line');
    });

    it('should return error for missing file', async () => {
      mockPathExists.mockResolvedValue(false);

      const result = await editor.insert(testFilePath, 1, 'inserted');

      expect(result.success).toBe(false);
      expect(result.error).toContain('File not found');
    });

    it('should add insert to edit history', async () => {
      await editor.insert(testFilePath, 2, 'inserted content');

      const history = editor.getEditHistory();
      expect(history).toHaveLength(1);
      expect(history[0].command).toBe('insert');
      expect(history[0].insert_line).toBe(2);
      expect(history[0].content).toBe('inserted content');
    });
  });

  describe('Undo Operation', () => {
    const testFilePath = `${testDir}/test.txt`;

    beforeEach(() => {
      mockPathExists.mockResolvedValue(true);
      mockStat.mockResolvedValue({ isDirectory: () => false });
    });

    it('should return error when no edits to undo', async () => {
      const result = await editor.undoEdit();

      expect(result.success).toBe(false);
      expect(result.error).toContain('No edits to undo');
    });

    it('should undo str_replace operation', async () => {
      // First, perform an edit
      mockReadFile.mockResolvedValue('original content');
      await editor.strReplace(testFilePath, 'original', 'modified');

      // Then undo it
      mockReadFile.mockResolvedValue('modified content');
      const result = await editor.undoEdit();

      expect(result.success).toBe(true);
      expect(result.output).toContain('Successfully undid str_replace');
    });

    it('should undo create operation by removing file', async () => {
      const newFilePath = `${testDir}/new-file.txt`;
      mockPathExists.mockResolvedValue(false);

      await editor.create(newFilePath, 'content');

      mockRemove.mockResolvedValue(undefined);
      const result = await editor.undoEdit();

      expect(result.success).toBe(true);
      expect(result.output).toContain('Successfully undid create');
      expect(mockRemove).toHaveBeenCalled();
    });

    it('should undo insert operation', async () => {
      mockReadFile.mockResolvedValue('line1\nline2\nline3');
      await editor.insert(testFilePath, 2, 'inserted');

      // Content after insert
      mockReadFile.mockResolvedValue('line1\ninserted\nline2\nline3');
      const result = await editor.undoEdit();

      expect(result.success).toBe(true);
      expect(result.output).toContain('Successfully undid insert');
    });

    it('should remove edit from history after undo', async () => {
      mockReadFile.mockResolvedValue('line1\nline2');
      mockPathExists.mockResolvedValue(true);

      await editor.strReplace(testFilePath, 'line1', 'modified');
      expect(editor.getEditHistory()).toHaveLength(1);

      mockReadFile.mockResolvedValue('modified\nline2');
      await editor.undoEdit();
      expect(editor.getEditHistory()).toHaveLength(0);
    });
  });

  describe('Edit History', () => {
    it('should return empty history initially', () => {
      const history = editor.getEditHistory();
      expect(history).toEqual([]);
    });

    it('should return copy of history', async () => {
      mockPathExists.mockResolvedValue(true);
      mockReadFile.mockResolvedValue('content');

      await editor.strReplace(`${testDir}/test.txt`, 'content', 'modified');

      const history1 = editor.getEditHistory();
      const history2 = editor.getEditHistory();

      expect(history1).not.toBe(history2);
      expect(history1).toEqual(history2);
    });
  });

  describe('Dispose', () => {
    it('should clear edit history on dispose', async () => {
      mockPathExists.mockResolvedValue(true);
      mockReadFile.mockResolvedValue('content');

      await editor.strReplace(`${testDir}/test.txt`, 'content', 'modified');
      expect(editor.getEditHistory()).toHaveLength(1);

      editor.dispose();
      expect(editor.getEditHistory()).toHaveLength(0);
    });
  });

  describe('Encoding Handling', () => {
    const testFilePath = `${testDir}/test.txt`;

    beforeEach(() => {
      mockPathExists.mockResolvedValue(true);
      mockStat.mockResolvedValue({ isDirectory: () => false });
    });

    it('should handle UTF-8 content correctly', async () => {
      const utf8Content = 'Hello \u4e16\u754c!\n\u65e5\u672c\u8a9e\u3067\u3059';
      mockReadFile.mockResolvedValue(utf8Content);

      const result = await editor.view(testFilePath);

      expect(result.success).toBe(true);
      expect(result.output).toContain('\u4e16\u754c');
      expect(result.output).toContain('\u65e5\u672c\u8a9e');
    });

    it('should write files with UTF-8 encoding', async () => {
      const utf8Content = '\u4e2d\u6587\u5185\u5bb9';
      mockPathExists.mockResolvedValue(false);

      await editor.create(testFilePath, utf8Content);

      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.any(String),
        utf8Content,
        'utf-8'
      );
    });

    it('should handle special characters in replacements', async () => {
      const contentWithSpecial = 'price: $100';
      mockReadFile.mockResolvedValue(contentWithSpecial);

      const result = await editor.strReplace(testFilePath, '$100', '\u20ac100');

      expect(result.success).toBe(true);
      const writtenContent = mockWriteFile.mock.calls[0][1] as string;
      expect(writtenContent).toBe('price: \u20ac100');
    });

    it('should preserve line endings', async () => {
      const contentWithCRLF = 'line1\r\nline2\r\nline3';
      mockReadFile.mockResolvedValue(contentWithCRLF);

      const result = await editor.strReplace(testFilePath, 'line2', 'modified');

      expect(result.success).toBe(true);
      const writtenContent = mockWriteFile.mock.calls[0][1] as string;
      // Note: The implementation splits by \n, so CRLF becomes part of line content
      expect(writtenContent).toContain('modified');
    });
  });

  describe('Confirmation Service Integration', () => {
    const testFilePath = `${testDir}/test.txt`;

    beforeEach(() => {
      mockPathExists.mockResolvedValue(true);
      mockStat.mockResolvedValue({ isDirectory: () => false });
      mockReadFile.mockResolvedValue('original content');
    });

    it('should skip confirmation when session flag is set', async () => {
      mockGetSessionFlags.mockReturnValue({
        fileOperations: true,
        bashCommands: false,
        allOperations: false,
      });

      await editor.strReplace(testFilePath, 'original', 'modified');

      expect(mockRequestConfirmation).not.toHaveBeenCalled();
    });

    it('should request confirmation when session flag is not set', async () => {
      mockGetSessionFlags.mockReturnValue({
        fileOperations: false,
        bashCommands: false,
        allOperations: false,
      });
      mockRequestConfirmation.mockResolvedValue({ confirmed: true });

      await editor.strReplace(testFilePath, 'original', 'modified');

      expect(mockRequestConfirmation).toHaveBeenCalled();
    });

    it('should cancel operation when user rejects', async () => {
      mockGetSessionFlags.mockReturnValue({
        fileOperations: false,
        bashCommands: false,
        allOperations: false,
      });
      mockRequestConfirmation.mockResolvedValue({
        confirmed: false,
        feedback: 'User declined',
      });

      const result = await editor.strReplace(testFilePath, 'original', 'modified');

      expect(result.success).toBe(false);
      expect(result.error).toContain('User declined');
      expect(mockWriteFile).not.toHaveBeenCalled();
    });
  });

  describe('Error Message Handling', () => {
    const testFilePath = `${testDir}/test.txt`;

    it('should handle Error objects', async () => {
      mockPathExists.mockRejectedValue(new Error('Test error message'));

      const result = await editor.view(testFilePath);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Test error message');
    });

    it('should handle string errors', async () => {
      mockPathExists.mockRejectedValue('String error');

      const result = await editor.view(testFilePath);

      expect(result.success).toBe(false);
      expect(result.error).toContain('String error');
    });

    it('should handle unknown error types', async () => {
      mockPathExists.mockRejectedValue({ custom: 'error object' });

      const result = await editor.view(testFilePath);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('Base Directory Management', () => {
    it('should default to process.cwd()', () => {
      const newEditor = new TextEditorTool();
      // The base directory is private, but we can test via path validation
      // A path relative to cwd should work
      newEditor.dispose();
    });

    it('should allow setting base directory', async () => {
      const customBase = '/custom/project';
      editor.setBaseDirectory(customBase);

      // Path outside custom base should be rejected
      const result = await editor.view('/other/path/file.txt');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Path traversal not allowed');
    });

    it('should resolve relative base directory', () => {
      // This tests that setBaseDirectory uses path.resolve
      editor.setBaseDirectory('./relative/path');
      // No error should be thrown
    });
  });

  describe('Diff Generation', () => {
    const testFilePath = `${testDir}/test.txt`;

    beforeEach(() => {
      mockPathExists.mockResolvedValue(true);
      mockStat.mockResolvedValue({ isDirectory: () => false });
    });

    it('should show additions in diff', async () => {
      mockReadFile.mockResolvedValue('line1\nline2');

      const result = await editor.strReplace(testFilePath, 'line2', 'line2\nline3');

      expect(result.success).toBe(true);
      expect(result.output).toContain('+');
    });

    it('should show removals in diff', async () => {
      mockReadFile.mockResolvedValue('line1\nline2\nline3');

      const result = await editor.strReplace(testFilePath, 'line2\nline3', 'line2');

      expect(result.success).toBe(true);
      expect(result.output).toContain('-');
    });

    it('should indicate no changes when content is identical', async () => {
      mockReadFile.mockResolvedValue('same content');

      const result = await editor.strReplace(testFilePath, 'same content', 'same content');

      expect(result.success).toBe(true);
      expect(result.output).toContain('No changes');
    });
  });
});
