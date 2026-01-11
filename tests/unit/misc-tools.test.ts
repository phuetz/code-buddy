
import { CommentWatcher } from '../../src/tools/comment-watcher.js';
import { semanticDiffFiles } from '../../src/tools/semantic-diff.js';
import { MigrationManager } from '../../src/tools/db-migration.js';
import { ScreenshotTool } from '../../src/tools/screenshot-tool.js';
import { loadImageFromFile } from '../../src/tools/image-input.js';
import { UnifiedVfsRouter } from '../../src/services/vfs/unified-vfs-router.js';

// Mock UnifiedVfsRouter
const mockReadFile = jest.fn();
const mockReadFileBuffer = jest.fn();
const mockWriteFile = jest.fn();
const mockExists = jest.fn();
const mockEnsureDir = jest.fn();
const mockStat = jest.fn();
const mockReadDirectory = jest.fn();
const mockRemove = jest.fn();

jest.mock('../../src/services/vfs/unified-vfs-router.js', () => ({
  UnifiedVfsRouter: {
    Instance: {
      readFile: (...args: unknown[]) => mockReadFile(...args),
      readFileBuffer: (...args: unknown[]) => mockReadFileBuffer(...args),
      writeFile: (...args: unknown[]) => mockWriteFile(...args),
      exists: (...args: unknown[]) => mockExists(...args),
      ensureDir: (...args: unknown[]) => mockEnsureDir(...args),
      stat: (...args: unknown[]) => mockStat(...args),
      readDirectory: (...args: unknown[]) => mockReadDirectory(...args),
      remove: (...args: unknown[]) => mockRemove(...args),
    },
  },
}));

// Mock Database for MigrationManager
jest.mock('better-sqlite3', () => {
  return jest.fn().mockImplementation(() => ({
    exec: jest.fn(),
    prepare: jest.fn(() => ({
      get: jest.fn(),
      all: jest.fn(),
      run: jest.fn(),
    })),
    transaction: (fn: any) => fn,
    close: jest.fn(),
  }));
});

describe('Miscellaneous Tools VFS Migration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('CommentWatcher', () => {
    it('should use VFS for scanning files', async () => {
      const watcher = new CommentWatcher();
      
      mockReadFile.mockResolvedValue('// TODO(ai): fix this');
      
      await watcher.scanFile('test.ts');
      
      expect(mockReadFile).toHaveBeenCalledWith('test.ts', 'utf-8');
    });
  });

  describe('SemanticDiff', () => {
    it('should use VFS for reading compared files', async () => {
      mockReadFile.mockResolvedValue('const x = 1;');
      
      await semanticDiffFiles('old.ts', 'new.ts');
      
      expect(mockReadFile).toHaveBeenCalledWith('old.ts', 'utf-8');
      expect(mockReadFile).toHaveBeenCalledWith('new.ts', 'utf-8');
    });
  });

  describe('MigrationManager', () => {
    it('should use VFS for creating migration', async () => {
      const manager = new MigrationManager();
      
      await manager.createMigration('test_migration');
      
      expect(mockEnsureDir).toHaveBeenCalled();
      expect(mockWriteFile).toHaveBeenCalled();
    });
  });

  describe('ScreenshotTool', () => {
    it('should use VFS for ensuring output dir', async () => {
      const tool = new ScreenshotTool();
      
      // Capture calls ensureDir
      // We assume spawn will fail or we mock it, but ensureDir is called first
      try {
        await tool.capture();
      } catch {
        // Expected spawn error
      }
      
      expect(mockEnsureDir).toHaveBeenCalled();
    });
  });

  describe('ImageInput', () => {
    it('should use VFS for loading image from file', async () => {
      mockExists.mockResolvedValue(true);
      mockReadFileBuffer.mockResolvedValue(Buffer.from('fake image data'));
      
      await loadImageFromFile('test.png');
      
      expect(mockExists).toHaveBeenCalled();
      expect(mockReadFileBuffer).toHaveBeenCalled();
    });
  });
});
