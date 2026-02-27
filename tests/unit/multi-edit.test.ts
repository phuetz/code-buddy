/**
 * Unit tests for MultiEditTool (mocked VFS)
 */

import { MultiEditTool, SingleFileEdit } from '../../src/tools/multi-edit';

// Mock the VFS router
const mockReadFile = jest.fn();
const mockWriteFile = jest.fn();
const mockExists = jest.fn();
const mockResolvePath = jest.fn();

jest.mock('../../src/services/vfs/unified-vfs-router', () => ({
  UnifiedVfsRouter: {
    Instance: {
      readFile: (...args: unknown[]) => mockReadFile(...args),
      writeFile: (...args: unknown[]) => mockWriteFile(...args),
      exists: (...args: unknown[]) => mockExists(...args),
      resolvePath: (...args: unknown[]) => mockResolvePath(...args),
    },
  },
}));

// Mock ConfirmationService
jest.mock('../../src/utils/confirmation-service', () => ({
  ConfirmationService: {
    getInstance: jest.fn(() => ({
      getSessionFlags: jest.fn().mockReturnValue({ fileOperations: true }),
      requestConfirmation: jest.fn().mockResolvedValue({ confirmed: true }),
    })),
  },
}));

// Mock CheckpointManager
jest.mock('../../src/checkpoints/checkpoint-manager', () => ({
  getCheckpointManager: jest.fn(() => ({
    checkpointBeforeEdit: jest.fn(),
  })),
}));

// Mock diff-generator
jest.mock('../../src/utils/diff-generator', () => ({
  generateDiff: jest.fn().mockReturnValue({ diff: '--- a/file\n+++ b/file\n@@ @@\n-old\n+new' }),
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

describe('MultiEditTool', () => {
  let tool: MultiEditTool;

  beforeEach(() => {
    jest.clearAllMocks();
    tool = new MultiEditTool();

    // Default mock behavior
    mockResolvePath.mockImplementation((p: string) => ({ valid: true, resolved: p }));
    mockExists.mockResolvedValue(true);
    mockWriteFile.mockResolvedValue(undefined);
  });

  describe('execute()', () => {
    it('should apply multiple edits to a single file', async () => {
      mockReadFile.mockResolvedValue('AAA BBB CCC');

      const edits: SingleFileEdit[] = [
        { old_string: 'AAA', new_string: '111' },
        { old_string: 'BBB', new_string: '222' },
      ];

      const result = await tool.execute('file.ts', edits);

      expect(result.success).toBe(true);
      expect(mockWriteFile).toHaveBeenCalledTimes(1);
      expect(mockWriteFile).toHaveBeenCalledWith('file.ts', '111 222 CCC', 'utf-8');
    });

    it('should fail atomically if any edit old_string not found', async () => {
      mockReadFile.mockResolvedValue('Hello World');

      const edits: SingleFileEdit[] = [
        { old_string: 'Hello', new_string: 'Hi' },
        { old_string: 'MISSING', new_string: 'X' },
      ];

      const result = await tool.execute('file.ts', edits);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Edit #2 failed');
      // File should NOT be written
      expect(mockWriteFile).not.toHaveBeenCalled();
    });

    it('should return error if file not found', async () => {
      mockExists.mockResolvedValue(false);

      const result = await tool.execute('missing.ts', [
        { old_string: 'x', new_string: 'y' },
      ]);

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should return error for invalid path', async () => {
      mockResolvePath.mockReturnValue({ valid: false, error: 'Path outside allowed directory' });

      const result = await tool.execute('/etc/passwd', [
        { old_string: 'x', new_string: 'y' },
      ]);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Path outside');
    });

    it('should return error for empty edits', async () => {
      const result = await tool.execute('file.ts', []);
      expect(result.success).toBe(false);
      expect(result.error).toContain('non-empty array');
    });

    it('should return error for missing file_path', async () => {
      const result = await tool.execute('', [{ old_string: 'a', new_string: 'b' }]);
      expect(result.success).toBe(false);
      expect(result.error).toContain('file_path is required');
    });

    it('should skip write when content is unchanged', async () => {
      mockReadFile.mockResolvedValue('same');

      const result = await tool.execute('file.ts', [
        { old_string: 'same', new_string: 'same' },
      ]);

      expect(result.success).toBe(true);
      expect(result.output).toContain('No changes needed');
      expect(mockWriteFile).not.toHaveBeenCalled();
    });

    it('should apply edits in sequence allowing chaining', async () => {
      mockReadFile.mockResolvedValue('A-B');

      const edits: SingleFileEdit[] = [
        { old_string: 'A', new_string: 'X' },
        { old_string: 'X-B', new_string: 'RESULT' },
      ];

      const result = await tool.execute('file.ts', edits);

      expect(result.success).toBe(true);
      expect(mockWriteFile).toHaveBeenCalledWith('file.ts', 'RESULT', 'utf-8');
    });

    it('should validate edit objects have required fields', async () => {
      const result = await tool.execute('file.ts', [
        { old_string: 'a' } as unknown as SingleFileEdit,
      ]);

      expect(result.success).toBe(false);
      expect(result.error).toContain('new_string must be a string');
    });
  });
});
