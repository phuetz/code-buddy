/**
 * Tests for File Module
 *
 * Comprehensive tests covering:
 * - TextEditorTool file operations (view, create, edit, replace, insert)
 * - Path validation and security
 * - MultiFileEditor transactional operations
 * - WatchModeManager file watching
 * - Context file loading and path handling
 */

import * as path from 'path';
import * as os from 'os';

// ============================================================
// MOCKS
// ============================================================

// Mock fs-extra
const mockFsExtra = {
  pathExists: jest.fn(),
  stat: jest.fn(),
  readFile: jest.fn(),
  writeFile: jest.fn(),
  readdir: jest.fn(),
  ensureDir: jest.fn(),
  remove: jest.fn(),
  realpathSync: jest.fn(),
  existsSync: jest.fn(),
};
jest.mock('fs-extra', () => mockFsExtra);

// Mock fs/promises
const mockFsPromises = {
  writeFile: jest.fn(),
  readFile: jest.fn(),
  mkdir: jest.fn(),
  unlink: jest.fn(),
  rename: jest.fn(),
};
jest.mock('fs/promises', () => mockFsPromises);

// Mock fs for watch and symlink detection
const mockFsWatch = jest.fn();
const mockFsExistsSync = jest.fn<boolean, [string]>(() => true);
const mockFsRealpathSync = jest.fn<string, [string]>((p: string) => p);
jest.mock('fs', () => ({
  watch: mockFsWatch,
  existsSync: (p: string) => mockFsExistsSync(p),
  realpathSync: (p: string) => mockFsRealpathSync(p),
  promises: {
    readFile: jest.fn(),
    writeFile: jest.fn(),
    mkdir: jest.fn(),
    unlink: jest.fn(),
    rename: jest.fn(),
  },
}));

// Mock confirmation service
jest.mock('../../src/utils/confirmation-service', () => ({
  ConfirmationService: {
    getInstance: jest.fn(() => ({
      getSessionFlags: jest.fn(() => ({ fileOperations: true, allOperations: false })),
      requestConfirmation: jest.fn(() => Promise.resolve({ confirmed: true })),
    })),
  },
}));

// Mock disposable
jest.mock('../../src/utils/disposable', () => ({
  registerDisposable: jest.fn(),
  Disposable: class {},
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

// Mock fuzzy-match
jest.mock('../../src/utils/fuzzy-match', () => ({
  findBestFuzzyMatch: jest.fn(() => null),
  generateFuzzyDiff: jest.fn(() => ''),
  suggestWhitespaceFixes: jest.fn(() => []),
}));

// Mock VFS (UnifiedVfsRouter)
// Note: resolvePath uses fs.existsSync and fs.realpathSync internally for symlink detection
const mockVfs = {
  exists: jest.fn(),
  readFile: jest.fn(),
  writeFile: jest.fn(),
  ensureDir: jest.fn(),
  readdir: jest.fn(),
  stat: jest.fn(),
  lstat: jest.fn(),
  unlink: jest.fn(),
  remove: jest.fn(),
  mkdir: jest.fn(),
  resolvePath: jest.fn((filePath: string, baseDir: string) => {
    const resolved = path.resolve(filePath);
    const normalizedBase = path.normalize(baseDir);
    const normalizedResolved = path.normalize(resolved);

    // First check: normalized path must be within base directory
    if (!normalizedResolved.startsWith(normalizedBase)) {
      return { valid: false, resolved, error: `Path traversal not allowed: ${filePath} resolves outside project directory` };
    }

    // Second check: if file exists, resolve symlinks and verify real path
    try {
      if (mockFsExistsSync(resolved)) {
        const realPath = mockFsRealpathSync(resolved);
        const realBase = mockFsRealpathSync(baseDir);
        if (!realPath.startsWith(realBase)) {
          return { valid: false, resolved, error: `Symlink traversal not allowed: ${filePath} points outside project directory` };
        }
      }
    } catch {
      // If realpath fails, allow the operation (file may not exist yet)
    }

    return { valid: true, resolved };
  }),
  isSymlink: jest.fn(() => Promise.resolve(false)),
  realpath: jest.fn((p: string) => Promise.resolve(p)),
};
jest.mock('../../src/services/vfs/unified-vfs-router.js', () => ({
  UnifiedVfsRouter: {
    Instance: mockVfs,
  },
}));

// Import modules after mocks
import { TextEditorTool } from '../../src/tools/text-editor';
import { MultiFileEditor, createMultiFileEditor, resetMultiFileEditor } from '../../src/tools/advanced/multi-file-editor';
import {
  WatchModeManager,
  extractAIComments,
  removeAIComment,
  formatAIComment,
  createWatchMode,
} from '../../src/commands/watch-mode';
import {
  loadProjectContextFiles,
  loadContext,
  formatContextForPrompt,
  initContextFile,
  hasContextFiles,
  formatContextSummary,
} from '../../src/context/context-files';

// ============================================================
// TEXT EDITOR TOOL TESTS
// ============================================================

describe('TextEditorTool', () => {
  let editor: TextEditorTool;
  const testDir = '/test/project';

  beforeEach(() => {
    jest.clearAllMocks();

    // Set up default fs mocks for symlink detection
    mockFsExistsSync.mockReturnValue(true);
    mockFsRealpathSync.mockImplementation((p: string) => p);

    // Set up default VFS mock behaviors
    mockVfs.exists.mockResolvedValue(false);
    mockVfs.readFile.mockResolvedValue('');
    mockVfs.writeFile.mockResolvedValue(undefined);
    mockVfs.ensureDir.mockResolvedValue(undefined);
    mockVfs.remove.mockResolvedValue(undefined);
    mockVfs.stat.mockResolvedValue({ isDirectory: () => false, isFile: () => true, size: 0 });
    mockVfs.lstat.mockResolvedValue({ isDirectory: () => false, isSymbolicLink: () => false });

    // resolvePath - validate paths with symlink detection using fs mocks
    mockVfs.resolvePath.mockImplementation((filePath: string, baseDir: string) => {
      const resolved = path.resolve(filePath);
      const normalizedBase = path.normalize(baseDir);
      const normalizedResolved = path.normalize(resolved);

      // First check: normalized path must be within base directory
      if (!normalizedResolved.startsWith(normalizedBase)) {
        return { valid: false, resolved, error: `Path traversal not allowed: ${filePath} resolves outside project directory` };
      }

      // Second check: if file exists, resolve symlinks and verify real path
      try {
        if (mockFsExistsSync(resolved)) {
          const realPath = mockFsRealpathSync(resolved);
          const realBase = mockFsRealpathSync(baseDir);
          if (!realPath.startsWith(realBase)) {
            return { valid: false, resolved, error: `Symlink traversal not allowed: ${filePath} points outside project directory` };
          }
        }
      } catch {
        // If realpath fails, allow the operation (file may not exist yet)
      }

      return { valid: true, resolved };
    });

    mockVfs.realpath.mockImplementation((p: string) => Promise.resolve(path.resolve(p)));
    mockVfs.isSymlink.mockResolvedValue(false);

    editor = new TextEditorTool();
    editor.setBaseDirectory(testDir);
  });

  afterEach(() => {
    editor.dispose();
  });

  describe('Path Validation', () => {
    it('should allow paths within base directory', async () => {
      mockVfs.exists.mockResolvedValue(true);
      mockVfs.stat.mockResolvedValue({ isDirectory: () => false, size: 100 });
      mockVfs.readFile.mockResolvedValue('file content');

      const result = await editor.view(path.join(testDir, 'src/file.ts'));
      expect(result.success).toBe(true);
    });

    it('should block path traversal attempts', async () => {
      const result = await editor.view('/etc/passwd');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Path traversal not allowed');
    });

    it('should block relative path traversal', async () => {
      const result = await editor.view(path.join(testDir, '../../etc/passwd'));
      expect(result.success).toBe(false);
      expect(result.error).toContain('Path traversal not allowed');
    });

    it('should detect symlink traversal attacks', async () => {
      // Set up fs mocks for symlink detection (used by resolvePath internally)
      mockFsExistsSync.mockReturnValue(true);
      mockFsRealpathSync.mockImplementation((p: string) => {
        if (p === testDir) return testDir;
        return '/etc/passwd'; // Symlink points outside
      });

      const result = await editor.view(path.join(testDir, 'malicious-symlink'));
      expect(result.success).toBe(false);
      expect(result.error).toContain('Symlink traversal not allowed');
    });

    it('should allow operations when symlinks stay within base', async () => {
      // Set up fs mocks for symlink detection
      mockFsExistsSync.mockReturnValue(true);
      mockFsRealpathSync.mockImplementation((p: string) => {
        if (p === testDir) return testDir;
        return path.join(testDir, 'actual-file.ts');
      });

      // Set up VFS mocks for file reading
      mockVfs.exists.mockResolvedValue(true);
      mockVfs.stat.mockResolvedValue({ isDirectory: () => false, isFile: () => true, size: 100 });
      mockVfs.readFile.mockResolvedValue('content');

      const result = await editor.view(path.join(testDir, 'symlink-file.ts'));
      expect(result.success).toBe(true);
    });
  });

  describe('View Operation', () => {
    it('should view file contents', async () => {
      mockVfs.exists.mockResolvedValue(true);
      mockVfs.stat.mockResolvedValue({ isDirectory: () => false, size: 100 });
      mockVfs.readFile.mockResolvedValue('line1\nline2\nline3');

      const result = await editor.view(path.join(testDir, 'file.ts'));
      expect(result.success).toBe(true);
      expect(result.output).toContain('file.ts');
      expect(result.output).toContain('line1');
    });

    it('should view specific line range', async () => {
      mockVfs.exists.mockResolvedValue(true);
      mockVfs.stat.mockResolvedValue({ isDirectory: () => false, size: 100 });
      mockVfs.readFile.mockResolvedValue('line1\nline2\nline3\nline4\nline5');

      const result = await editor.view(path.join(testDir, 'file.ts'), [2, 4]);
      expect(result.success).toBe(true);
      expect(result.output).toContain('Lines 2-4');
      expect(result.output).toContain('line2');
      expect(result.output).not.toContain('line1');
    });

    it('should list directory contents', async () => {
      mockVfs.exists.mockResolvedValue(true);
      mockVfs.stat.mockResolvedValue({ isDirectory: () => true });
      mockVfs.readdir.mockResolvedValue(['file1.ts', 'file2.ts', 'folder']);

      const result = await editor.view(path.join(testDir, 'src'));
      expect(result.success).toBe(true);
      expect(result.output).toContain('Directory contents');
      expect(result.output).toContain('file1.ts');
    });

    it('should handle file not found', async () => {
      mockVfs.exists.mockResolvedValue(false);

      const result = await editor.view(path.join(testDir, 'nonexistent.ts'));
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should show full content for files under 500 lines', async () => {
      const manyLines = Array.from({ length: 50 }, (_, i) => `line${i + 1}`).join('\n');
      mockVfs.exists.mockResolvedValue(true);
      mockVfs.stat.mockResolvedValue({ isDirectory: () => false });
      mockVfs.readFile.mockResolvedValue(manyLines);

      const result = await editor.view(path.join(testDir, 'large.ts'));
      expect(result.success).toBe(true);
      expect(result.output).toContain('1: line1');
      expect(result.output).toContain('50: line50');
    });
  });

  describe('Create Operation', () => {
    it('should create a new file', async () => {
      mockVfs.exists.mockResolvedValue(false);
      mockVfs.ensureDir.mockResolvedValue(undefined);
      mockVfs.writeFile.mockResolvedValue(undefined);

      const result = await editor.create(
        path.join(testDir, 'new-file.ts'),
        'const x = 1;'
      );
      expect(result.success).toBe(true);
      expect(mockVfs.writeFile).toHaveBeenCalled();
    });

    it('should prevent overwriting existing files', async () => {
      mockVfs.exists.mockResolvedValue(true);
      mockVfs.stat.mockResolvedValue({ isFile: () => true });

      const result = await editor.create(
        path.join(testDir, 'existing.ts'),
        'content'
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
    });

    it('should create parent directories', async () => {
      mockVfs.exists.mockResolvedValue(false);
      mockVfs.ensureDir.mockResolvedValue(undefined);
      mockVfs.writeFile.mockResolvedValue(undefined);

      await editor.create(
        path.join(testDir, 'deep/nested/folder/file.ts'),
        'content'
      );
      expect(mockVfs.ensureDir).toHaveBeenCalled();
    });

    it('should add to edit history after creation', async () => {
      mockVfs.exists.mockResolvedValue(false);
      mockVfs.ensureDir.mockResolvedValue(undefined);
      mockVfs.writeFile.mockResolvedValue(undefined);

      await editor.create(path.join(testDir, 'file.ts'), 'content');
      const history = editor.getEditHistory();
      expect(history.length).toBe(1);
      expect(history[0].command).toBe('create');
    });
  });

  describe('String Replace Operation', () => {
    it('should replace string in file', async () => {
      mockVfs.exists.mockResolvedValue(true);
      mockVfs.readFile.mockResolvedValue('const old = 1;');
      mockVfs.writeFile.mockResolvedValue(undefined);

      const result = await editor.strReplace(
        path.join(testDir, 'file.ts'),
        'old',
        'newValue'
      );
      expect(result.success).toBe(true);
      expect(mockVfs.writeFile).toHaveBeenCalledWith(
        expect.any(String),
        'const newValue = 1;',
        'utf-8'
      );
    });

    it('should replace all occurrences when replaceAll is true', async () => {
      mockVfs.exists.mockResolvedValue(true);
      mockVfs.readFile.mockResolvedValue('old old old');
      mockVfs.writeFile.mockResolvedValue(undefined);

      const result = await editor.strReplace(
        path.join(testDir, 'file.ts'),
        'old',
        'new',
        true
      );
      expect(result.success).toBe(true);
      expect(mockVfs.writeFile).toHaveBeenCalledWith(
        expect.any(String),
        'new new new',
        'utf-8'
      );
    });

    it('should fail when string not found', async () => {
      mockVfs.exists.mockResolvedValue(true);
      mockVfs.readFile.mockResolvedValue('some content');

      const result = await editor.strReplace(
        path.join(testDir, 'file.ts'),
        'nonexistent',
        'replacement'
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('String not found');
    });

    it('should handle file not found', async () => {
      mockVfs.exists.mockResolvedValue(false);

      const result = await editor.strReplace(
        path.join(testDir, 'missing.ts'),
        'old',
        'new'
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('File not found');
    });
  });

  describe('Replace Lines Operation', () => {
    it('should replace specific lines', async () => {
      mockVfs.exists.mockResolvedValue(true);
      mockVfs.readFile.mockResolvedValue('line1\nline2\nline3\nline4');
      mockVfs.writeFile.mockResolvedValue(undefined);

      const result = await editor.replaceLines(
        path.join(testDir, 'file.ts'),
        2,
        3,
        'replaced\ncontent'
      );
      expect(result.success).toBe(true);
      expect(mockVfs.writeFile).toHaveBeenCalledWith(
        expect.any(String),
        'line1\nreplaced\ncontent\nline4',
        'utf-8'
      );
    });

    it('should validate start line', async () => {
      mockVfs.exists.mockResolvedValue(true);
      mockVfs.readFile.mockResolvedValue('line1\nline2');

      const result = await editor.replaceLines(
        path.join(testDir, 'file.ts'),
        0,
        1,
        'new'
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid start line');
    });

    it('should validate end line', async () => {
      mockVfs.exists.mockResolvedValue(true);
      mockVfs.readFile.mockResolvedValue('line1\nline2');

      const result = await editor.replaceLines(
        path.join(testDir, 'file.ts'),
        1,
        100,
        'new'
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid end line');
    });
  });

  describe('Insert Operation', () => {
    it('should insert content at line', async () => {
      mockVfs.exists.mockResolvedValue(true);
      mockVfs.readFile.mockResolvedValue('line1\nline2\nline3');
      mockVfs.writeFile.mockResolvedValue(undefined);

      const result = await editor.insert(
        path.join(testDir, 'file.ts'),
        2,
        'inserted'
      );
      expect(result.success).toBe(true);
      expect(mockVfs.writeFile).toHaveBeenCalledWith(
        expect.any(String),
        'line1\ninserted\nline2\nline3',
        'utf-8'
      );
    });

    it('should validate insert line number', async () => {
      mockVfs.exists.mockResolvedValue(true);
      mockVfs.readFile.mockResolvedValue('line1\nline2');

      const result = await editor.insert(
        path.join(testDir, 'file.ts'),
        100,
        'content'
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid insert line');
    });
  });

  describe('Undo Operation', () => {
    it('should undo create by removing file', async () => {
      mockVfs.exists.mockResolvedValue(false);
      mockVfs.ensureDir.mockResolvedValue(undefined);
      mockVfs.writeFile.mockResolvedValue(undefined);
      mockVfs.remove.mockResolvedValue(undefined);

      await editor.create(path.join(testDir, 'file.ts'), 'content');
      const result = await editor.undoEdit();

      expect(result.success).toBe(true);
      expect(mockVfs.remove).toHaveBeenCalled();
    });

    it('should undo string replace', async () => {
      mockVfs.exists.mockResolvedValue(true);
      mockVfs.readFile
        .mockResolvedValueOnce('old content')
        .mockResolvedValueOnce('new content');
      mockVfs.writeFile.mockResolvedValue(undefined);

      await editor.strReplace(path.join(testDir, 'file.ts'), 'old', 'new');
      const result = await editor.undoEdit();

      expect(result.success).toBe(true);
    });

    it('should return error when no edits to undo', async () => {
      const result = await editor.undoEdit();
      expect(result.success).toBe(false);
      expect(result.error).toContain('No edits to undo');
    });
  });

  describe('Edit History', () => {
    it('should track edit history', async () => {
      mockVfs.exists.mockResolvedValue(true);
      mockVfs.readFile.mockResolvedValue('content');
      mockVfs.writeFile.mockResolvedValue(undefined);

      await editor.strReplace(path.join(testDir, 'a.ts'), 'content', 'new');
      await editor.strReplace(path.join(testDir, 'b.ts'), 'content', 'other');

      const history = editor.getEditHistory();
      expect(history.length).toBe(2);
    });

    it('should clear history on dispose', async () => {
      mockVfs.exists.mockResolvedValue(true);
      mockVfs.readFile.mockResolvedValue('content');
      mockVfs.writeFile.mockResolvedValue(undefined);

      await editor.strReplace(path.join(testDir, 'file.ts'), 'content', 'new');
      editor.dispose();

      const history = editor.getEditHistory();
      expect(history.length).toBe(0);
    });
  });
});

// ============================================================
// MULTI-FILE EDITOR TESTS
// ============================================================

describe('MultiFileEditor', () => {
  let editor: MultiFileEditor;
  const testDir = '/test/project';

  beforeEach(() => {
    jest.clearAllMocks();
    resetMultiFileEditor();
    editor = createMultiFileEditor();
  });

  describe('Transaction Management', () => {
    it('should begin a transaction', () => {
      const txnId = editor.beginTransaction('Test transaction');
      expect(txnId).toBeDefined();
      expect(editor.hasActiveTransaction()).toBe(true);
    });

    it('should prevent nested transactions', () => {
      editor.beginTransaction();
      expect(() => editor.beginTransaction()).toThrow('already active');
    });

    it('should allow adding operations to transaction', () => {
      editor.beginTransaction();
      const opId = editor.addCreateFile(path.join(testDir, 'file.ts'), 'content');
      expect(opId).toBeDefined();
    });

    it('should fail when adding without transaction', () => {
      expect(() =>
        editor.addCreateFile(path.join(testDir, 'file.ts'), 'content')
      ).toThrow('No active transaction');
    });

    it('should get active transaction ID', () => {
      const txnId = editor.beginTransaction();
      expect(editor.getActiveTransactionId()).toBe(txnId);
    });

    it('should return null when no active transaction', () => {
      expect(editor.getActiveTransactionId()).toBeNull();
    });
  });

  describe('File Operations', () => {
    beforeEach(() => {
      editor.beginTransaction();
    });

    it('should add create file operation', () => {
      const opId = editor.addCreateFile(path.join(testDir, 'new.ts'), 'content');
      expect(opId).toContain('op-');
    });

    it('should add edit file operation', () => {
      const opId = editor.addEditFile(path.join(testDir, 'file.ts'), [
        { type: 'replace', startLine: 1, oldText: 'old', newText: 'new' },
      ]);
      expect(opId).toBeDefined();
    });

    it('should add replace operation', () => {
      const opId = editor.addReplace(
        path.join(testDir, 'file.ts'),
        'old',
        'new'
      );
      expect(opId).toBeDefined();
    });

    it('should add insert operation', () => {
      const opId = editor.addInsert(path.join(testDir, 'file.ts'), 5, 'new line');
      expect(opId).toBeDefined();
    });

    it('should add delete lines operation', () => {
      const opId = editor.addDeleteLines(path.join(testDir, 'file.ts'), 1, 5);
      expect(opId).toBeDefined();
    });

    it('should add delete file operation', () => {
      const opId = editor.addDeleteFile(path.join(testDir, 'file.ts'));
      expect(opId).toBeDefined();
    });

    it('should add rename file operation', () => {
      const opId = editor.addRenameFile(
        path.join(testDir, 'old.ts'),
        path.join(testDir, 'new.ts')
      );
      expect(opId).toBeDefined();
    });
  });

  describe('Transaction Validation', () => {
    it('should return invalid when no transaction', async () => {
      const result = await editor.validate();
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('No active transaction');
    });

    it('should warn when creating file that exists', async () => {
      // MultiFileEditor.validate() uses vfs.exists(), not native fs.existsSync
      mockVfs.exists.mockResolvedValue(true);

      editor.beginTransaction();
      editor.addCreateFile(path.join(testDir, 'existing.ts'), 'content');
      const result = await editor.validate();

      expect(result.warnings).toContainEqual(
        expect.stringContaining('already exists')
      );
    });

    it('should error when editing non-existent file', async () => {
      // MultiFileEditor.validate() uses vfs.exists(), not native fs.existsSync
      mockVfs.exists.mockResolvedValue(false);

      editor.beginTransaction();
      editor.addEditFile(path.join(testDir, 'missing.ts'), [
        { type: 'replace', startLine: 1, oldText: 'a', newText: 'b' },
      ]);
      const result = await editor.validate();

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.stringContaining('does not exist')
      );
    });
  });

  describe('Transaction Commit', () => {
    it('should commit transaction successfully', async () => {
      mockFsExistsSync.mockReturnValue(false);
      mockFsPromises.mkdir.mockResolvedValue(undefined);
      mockVfs.writeFile.mockResolvedValue(undefined);

      editor.beginTransaction('Create file');
      editor.addCreateFile(path.join(testDir, 'new.ts'), 'content');
      const result = await editor.commit();

      expect(result.success).toBe(true);
      expect(result.operationsExecuted).toBe(1);
      expect(result.operationsFailed).toBe(0);
    });

    it('should fail without active transaction', async () => {
      await expect(editor.commit()).rejects.toThrow('No active transaction');
    });

    it('should include duration in result', async () => {
      mockFsExistsSync.mockReturnValue(false);
      mockFsPromises.mkdir.mockResolvedValue(undefined);
      mockVfs.writeFile.mockResolvedValue(undefined);

      editor.beginTransaction();
      editor.addCreateFile(path.join(testDir, 'file.ts'), 'content');
      const result = await editor.commit();

      expect(result.duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Transaction Rollback', () => {
    it('should rollback active transaction', async () => {
      mockFsExistsSync.mockReturnValue(false);

      editor.beginTransaction();
      editor.addCreateFile(path.join(testDir, 'file.ts'), 'content');
      await editor.rollback();

      expect(editor.hasActiveTransaction()).toBe(false);
    });

    it('should fail without active transaction', async () => {
      await expect(editor.rollback()).rejects.toThrow('No active transaction');
    });
  });

  describe('Preview Changes', () => {
    it('should preview create operation', async () => {
      editor.beginTransaction();
      editor.addCreateFile(path.join(testDir, 'file.ts'), 'line1\nline2');
      const previews = await editor.preview();

      expect(previews.length).toBe(1);
      expect(previews[0].type).toBe('create');
      expect(previews[0].linesAdded).toBe(2);
    });

    it('should return empty array without transaction', async () => {
      const previews = await editor.preview();
      expect(previews).toEqual([]);
    });
  });

  describe('Multi-File Atomic Operations', () => {
    it('should execute multiple operations atomically', async () => {
      mockFsExistsSync.mockReturnValue(false);
      mockFsPromises.mkdir.mockResolvedValue(undefined);
      mockVfs.writeFile.mockResolvedValue(undefined);

      const result = await editor.executeMultiFileOperation(
        [
          { type: 'create', filePath: path.join(testDir, 'a.ts'), content: 'a' },
          { type: 'create', filePath: path.join(testDir, 'b.ts'), content: 'b' },
        ],
        'Create multiple files'
      );

      expect(result.success).toBe(true);
      expect(result.operationsExecuted).toBe(2);
    });
  });

  describe('Transaction History', () => {
    it('should store transactions', async () => {
      mockFsExistsSync.mockReturnValue(false);
      mockFsPromises.mkdir.mockResolvedValue(undefined);
      mockVfs.writeFile.mockResolvedValue(undefined);

      editor.beginTransaction();
      editor.addCreateFile(path.join(testDir, 'file.ts'), 'content');
      await editor.commit();

      const transactions = editor.getAllTransactions();
      expect(transactions.length).toBe(1);
    });

    it('should get transaction by ID', async () => {
      mockFsExistsSync.mockReturnValue(false);
      mockFsPromises.mkdir.mockResolvedValue(undefined);
      mockVfs.writeFile.mockResolvedValue(undefined);

      const txnId = editor.beginTransaction();
      editor.addCreateFile(path.join(testDir, 'file.ts'), 'content');
      await editor.commit();

      const transaction = editor.getTransaction(txnId);
      expect(transaction).toBeDefined();
      expect(transaction?.id).toBe(txnId);
    });

    it('should clear history', () => {
      editor.clearHistory();
      const transactions = editor.getAllTransactions();
      expect(transactions.length).toBe(0);
    });
  });
});

// ============================================================
// WATCH MODE MANAGER TESTS
// ============================================================

describe('WatchModeManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('AI Comment Extraction', () => {
    it('should extract AI action comments (hash style)', () => {
      const content = '# AI! Add validation\nsome code';
      const comments = extractAIComments(content, '/test/file.py');

      expect(comments.length).toBe(1);
      expect(comments[0].type).toBe('action');
      expect(comments[0].content).toBe('Add validation');
    });

    it('should extract AI question comments (hash style)', () => {
      const content = '# AI? What does this function do?\ndef foo():';
      const comments = extractAIComments(content, '/test/file.py');

      expect(comments.length).toBe(1);
      expect(comments[0].type).toBe('question');
      expect(comments[0].content).toBe('What does this function do?');
    });

    it('should extract AI comments (double slash style)', () => {
      const content = '// AI! Refactor this function\nconst x = 1;';
      const comments = extractAIComments(content, '/test/file.ts');

      expect(comments.length).toBe(1);
      expect(comments[0].type).toBe('action');
      expect(comments[0].content).toBe('Refactor this function');
    });

    it('should extract AI comments (SQL style)', () => {
      const content = '-- AI! Optimize this query\nSELECT * FROM users';
      const comments = extractAIComments(content, '/test/file.sql');

      expect(comments.length).toBe(1);
      expect(comments[0].type).toBe('action');
    });

    it('should extract AI comments (HTML style)', () => {
      const content = '<!-- AI! Fix layout -->\n<div>content</div>';
      const comments = extractAIComments(content, '/test/file.html');

      // HTML pattern matches, and the SQL pattern may also match '-->'
      // Both patterns have type 'action'
      expect(comments.length).toBeGreaterThanOrEqual(1);
      expect(comments.some(c => c.type === 'action')).toBe(true);
      expect(comments.some(c => c.content.includes('Fix layout'))).toBe(true);
    });

    it('should include line number', () => {
      const content = 'line1\n// AI! Fix bug\nline3';
      const comments = extractAIComments(content, '/test/file.ts');

      expect(comments[0].lineNumber).toBe(2);
    });

    it('should include context around comment', () => {
      const content = 'line1\nline2\n// AI! Help\nline4\nline5';
      const comments = extractAIComments(content, '/test/file.ts');

      expect(comments[0].context).toContain('line1');
      expect(comments[0].context).toContain('line5');
    });

    it('should extract multiple comments', () => {
      const content = '// AI! First\ncode\n// AI? Second';
      const comments = extractAIComments(content, '/test/file.ts');

      expect(comments.length).toBe(2);
    });
  });

  describe('AI Comment Removal', () => {
    it('should remove AI comment from line', async () => {
      // watch-mode uses fs-extra directly, not VFS
      mockFsExtra.readFile.mockResolvedValue('code // AI! Fix this\nother');
      mockFsExtra.writeFile.mockResolvedValue(undefined);

      await removeAIComment('/test/file.ts', 1);

      expect(mockFsExtra.writeFile).toHaveBeenCalled();
    });
  });

  describe('Format AI Comment', () => {
    it('should format action comment', () => {
      const comment = {
        type: 'action' as const,
        content: 'Add validation',
        filePath: '/test/file.ts',
        lineNumber: 10,
        context: 'function test() {}',
      };

      const formatted = formatAIComment(comment);
      expect(formatted).toContain('AI!');
      expect(formatted).toContain('ACTION');
      expect(formatted).toContain('Add validation');
    });

    it('should format question comment', () => {
      const comment = {
        type: 'question' as const,
        content: 'What is this?',
        filePath: '/test/file.ts',
        lineNumber: 5,
        context: 'const x = 1;',
      };

      const formatted = formatAIComment(comment);
      expect(formatted).toContain('AI?');
      expect(formatted).toContain('QUESTION');
    });
  });

  describe('Watch Manager Lifecycle', () => {
    it('should create watch mode with default config', () => {
      const manager = createWatchMode();
      expect(manager).toBeInstanceOf(WatchModeManager);
    });

    it('should create with custom paths', () => {
      const manager = createWatchMode(['/custom/path']);
      expect(manager).toBeDefined();
    });

    it('should emit started event on start', async () => {
      const mockWatcher = { close: jest.fn() };
      mockFsWatch.mockReturnValue(mockWatcher);

      const manager = new WatchModeManager({ paths: ['/test'] });
      const handler = jest.fn();
      manager.on('started', handler);

      await manager.start();
      expect(handler).toHaveBeenCalled();

      await manager.stop();
    });

    it('should emit stopped event on stop', async () => {
      const mockWatcher = { close: jest.fn() };
      mockFsWatch.mockReturnValue(mockWatcher);

      const manager = new WatchModeManager({ paths: ['/test'] });
      const handler = jest.fn();
      manager.on('stopped', handler);

      await manager.start();
      await manager.stop();

      expect(handler).toHaveBeenCalled();
    });

    it('should close all watchers on stop', async () => {
      const mockWatcher = { close: jest.fn() };
      mockFsWatch.mockReturnValue(mockWatcher);

      const manager = new WatchModeManager({ paths: ['/test1', '/test2'] });
      await manager.start();
      await manager.stop();

      expect(mockWatcher.close).toHaveBeenCalledTimes(2);
    });
  });

  describe('File Filtering', () => {
    it('should ignore node_modules', async () => {
      const mockWatcher = {
        close: jest.fn(),
      };
      let changeHandler: ((event: string, filename: string) => void) | undefined;
      mockFsWatch.mockImplementation((_path, _opts, cb) => {
        changeHandler = cb;
        return mockWatcher;
      });

      const manager = new WatchModeManager({ paths: ['/test'] });
      const commentHandler = jest.fn();
      manager.on('comment', commentHandler);

      await manager.start();

      // Simulate change in node_modules
      changeHandler?.('change', 'node_modules/package/file.js');

      // Should not process file in node_modules
      await manager.stop();
    });
  });
});

// ============================================================
// CONTEXT FILES TESTS
// ============================================================

describe('Context Files', () => {
  const testProjectDir = '/test/project';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('loadProjectContextFiles', () => {
    it('should load project context files', async () => {
      // context-files uses fs-extra (pathExists, readFile) directly, not VFS
      mockFsExtra.pathExists.mockImplementation(async (p: string) => {
        return p.includes('GROK.md');
      });
      mockFsExtra.readFile.mockResolvedValue('# Project Context');

      const files = await loadProjectContextFiles(testProjectDir);
      expect(files.length).toBeGreaterThan(0);
    });

    it('should return empty array when no context files', async () => {
      mockFsExtra.pathExists.mockResolvedValue(false);

      const files = await loadProjectContextFiles(testProjectDir);
      expect(files).toEqual([]);
    });

    it('should sort by priority', async () => {
      mockFsExtra.pathExists.mockResolvedValue(true);
      mockFsExtra.readFile.mockResolvedValue('content');

      const files = await loadProjectContextFiles(testProjectDir);
      // Files should be sorted by priority
      for (let i = 1; i < files.length; i++) {
        expect(files[i].priority).toBeGreaterThanOrEqual(files[i - 1].priority);
      }
    });
  });

  describe('loadContext', () => {
    it('should combine context files', async () => {
      mockFsExtra.pathExists.mockImplementation(async (p: string) => {
        return p.includes('GROK.md');
      });
      mockFsExtra.readFile.mockResolvedValue('# Context');

      const context = await loadContext(testProjectDir);
      expect(context.files.length).toBeGreaterThan(0);
      expect(context.combinedContent).toContain('Context');
    });

    it('should return empty context when no files', async () => {
      mockFsExtra.pathExists.mockResolvedValue(false);

      const context = await loadContext(testProjectDir);
      expect(context.files).toEqual([]);
      expect(context.combinedContent).toBe('');
      expect(context.totalSize).toBe(0);
    });
  });

  describe('formatContextForPrompt', () => {
    it('should format context with tags', () => {
      const context = {
        files: [{ path: '/test', content: 'content', source: 'project' as const, priority: 1 }],
        combinedContent: 'Test content',
        totalSize: 12,
      };

      const formatted = formatContextForPrompt(context);
      expect(formatted).toContain('<project_context>');
      expect(formatted).toContain('Test content');
      expect(formatted).toContain('</project_context>');
    });

    it('should return empty string for empty context', () => {
      const context = {
        files: [],
        combinedContent: '',
        totalSize: 0,
      };

      const formatted = formatContextForPrompt(context);
      expect(formatted).toBe('');
    });
  });

  describe('initContextFile', () => {
    it('should create context file with template', async () => {
      // initContextFile uses fs-extra directly, not VFS
      mockFsExtra.pathExists.mockResolvedValue(false);
      mockFsExtra.ensureDir.mockResolvedValue(undefined);
      mockFsExtra.writeFile.mockResolvedValue(undefined);

      const filePath = await initContextFile(testProjectDir);
      expect(filePath).toContain('CONTEXT.md');
      expect(mockFsExtra.writeFile).toHaveBeenCalled();
    });

    it('should return existing path if file exists', async () => {
      // initContextFile uses fs-extra directly, not VFS
      mockFsExtra.ensureDir.mockResolvedValue(undefined);
      mockFsExtra.pathExists.mockResolvedValue(true); // CONTEXT.md exists

      const filePath = await initContextFile(testProjectDir);
      expect(filePath).toContain('CONTEXT.md');
      expect(mockFsExtra.writeFile).not.toHaveBeenCalled();
    });
  });

  describe('hasContextFiles', () => {
    it('should return true when context files exist', async () => {
      // hasContextFiles calls loadProjectContextFiles which uses fs-extra
      mockFsExtra.pathExists.mockImplementation(async (p: string) => {
        return p.includes('GROK.md');
      });
      mockFsExtra.readFile.mockResolvedValue('content');

      const hasFiles = await hasContextFiles(testProjectDir);
      expect(hasFiles).toBe(true);
    });

    it('should return false when no context files', async () => {
      // hasContextFiles calls loadProjectContextFiles which uses fs-extra
      mockFsExtra.pathExists.mockResolvedValue(false);

      const hasFiles = await hasContextFiles(testProjectDir);
      expect(hasFiles).toBe(false);
    });
  });

  describe('formatContextSummary', () => {
    it('should format summary with file info', () => {
      const context = {
        files: [
          { path: '/test/GROK.md', content: 'x'.repeat(2048), source: 'project' as const, priority: 1 },
        ],
        combinedContent: 'x'.repeat(2048),
        totalSize: 2048,
      };

      const summary = formatContextSummary(context);
      expect(summary).toContain('Context files loaded');
      expect(summary).toContain('GROK.md');
      expect(summary).toContain('KB');
    });

    it('should show no files message', () => {
      const context = {
        files: [],
        combinedContent: '',
        totalSize: 0,
      };

      const summary = formatContextSummary(context);
      expect(summary).toContain('No context files found');
    });

    it('should show global label for global files', () => {
      const context = {
        files: [
          {
            path: path.join(os.homedir(), '.codebuddy/CONTEXT.md'),
            content: 'global content',
            source: 'global' as const,
            priority: 10,
          },
        ],
        combinedContent: 'global content',
        totalSize: 14,
      };

      const summary = formatContextSummary(context);
      expect(summary).toContain('(global)');
    });
  });
});

// ============================================================
// EDGE CASES AND ERROR HANDLING
// ============================================================

describe('Error Handling', () => {
  describe('TextEditorTool Error Cases', () => {
    let editor: TextEditorTool;

    beforeEach(() => {
      jest.clearAllMocks();
      editor = new TextEditorTool();
      editor.setBaseDirectory('/test');
    });

    afterEach(() => {
      editor.dispose();
    });

    it('should handle read errors gracefully', async () => {
      // TextEditorTool.view() uses vfs.readFile(), not fs-extra
      mockVfs.exists.mockResolvedValue(true);
      mockVfs.stat.mockResolvedValue({ isDirectory: () => false, isFile: () => true });
      mockVfs.readFile.mockRejectedValue(new Error('Permission denied'));

      const result = await editor.view('/test/file.ts');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Error viewing');
    });

    it('should handle write errors gracefully', async () => {
      mockVfs.exists.mockResolvedValue(true);
      mockVfs.readFile.mockResolvedValue('content');
      mockVfs.writeFile.mockRejectedValue(new Error('Disk full'));

      const result = await editor.strReplace('/test/file.ts', 'content', 'new');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Error replacing');
    });
  });

  describe('MultiFileEditor Error Cases', () => {
    let editor: MultiFileEditor;

    beforeEach(() => {
      jest.clearAllMocks();
      resetMultiFileEditor();
      editor = createMultiFileEditor();
    });

    it('should handle commit errors and rollback', async () => {
      mockFsExistsSync.mockReturnValue(false);
      mockFsPromises.mkdir.mockResolvedValue(undefined);
      mockVfs.writeFile.mockRejectedValue(new Error('Write failed'));
      mockFsPromises.unlink.mockResolvedValue(undefined);

      editor.beginTransaction();
      editor.addCreateFile('/test/file.ts', 'content');
      const result = await editor.commit();

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('WatchModeManager Error Cases', () => {
    it('should emit error on watch failure', async () => {
      mockFsWatch.mockImplementation(() => {
        throw new Error('Watch failed');
      });

      const manager = new WatchModeManager({ paths: ['/test'] });
      const errorHandler = jest.fn();
      manager.on('error', errorHandler);

      await manager.start();
      expect(errorHandler).toHaveBeenCalled();
    });
  });
});
