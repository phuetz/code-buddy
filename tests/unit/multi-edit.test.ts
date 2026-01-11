/**
 * Unit tests for MultiEditTool
 */

import { MultiEditTool, EditOperation } from '../../src/tools/multi-edit';
import * as fs from 'fs-extra';

// Mock fs-extra
jest.mock('fs-extra', () => ({
  pathExists: jest.fn(),
  readFile: jest.fn(),
  writeFile: jest.fn(),
}));

// Mock PathValidator
jest.mock('../../src/utils/path-validator', () => {
  return {
    PathValidator: jest.fn().mockImplementation(() => ({
      validate: jest.fn().mockImplementation((p) => ({ valid: true, resolved: p })),
      setBaseDirectory: jest.fn(),
    })),
  };
});

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

describe('MultiEditTool', () => {
  let tool: MultiEditTool;

  beforeEach(() => {
    jest.clearAllMocks();
    tool = new MultiEditTool();
  });

  describe('execute()', () => {
    it('should perform multiple edits successfully', async () => {
      (fs.pathExists as unknown as jest.Mock).mockResolvedValue(true);
      (fs.readFile as unknown as jest.Mock).mockResolvedValue('original content');
      (fs.writeFile as unknown as jest.Mock).mockResolvedValue(undefined);

      const edits: EditOperation[] = [
        { file_path: 'file1.ts', old_str: 'original', new_str: 'new1' },
        { file_path: 'file2.ts', old_str: 'original', new_str: 'new2' },
      ];

      const result = await tool.execute(edits);

      expect(result.success).toBe(true);
      expect(fs.writeFile).toHaveBeenCalledTimes(2);
      expect(result.output).toContain('✓ 2 successful');
    });

    it('should return error if string not found in one of the files', async () => {
      (fs.pathExists as unknown as jest.Mock).mockResolvedValue(true);
      (fs.readFile as unknown as jest.Mock).mockResolvedValue('other content');

      const edits: EditOperation[] = [
        { file_path: 'file1.ts', old_str: 'missing', new_str: 'new' },
      ];

      const result = await tool.execute(edits);

      expect(result.success).toBe(false);
      expect(result.error).toContain('1 edit(s) failed');
      expect(result.output).toContain('Failed edits');
    });

    it('should handle missing files', async () => {
      (fs.pathExists as unknown as jest.Mock).mockResolvedValue(false);

      const edits: EditOperation[] = [
        { file_path: 'missing.ts', old_str: 'x', new_str: 'y' },
      ];

      const result = await tool.execute(edits);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Validation failed');
    });
  });

  describe('executeParallel()', () => {
    it('should perform edits in parallel across different files', async () => {
      (fs.pathExists as unknown as jest.Mock).mockResolvedValue(true);
      (fs.readFile as unknown as jest.Mock).mockResolvedValue('content');
      
      const edits: EditOperation[] = [
        { file_path: 'a.ts', old_str: 'content', new_str: 'newA' },
        { file_path: 'b.ts', old_str: 'content', new_str: 'newB' },
      ];

      const result = await tool.executeParallel(edits);

      expect(result.success).toBe(true);
      expect(fs.writeFile).toHaveBeenCalledTimes(2);
    });

    it('should execute edits sequentially for the same file', async () => {
      (fs.pathExists as unknown as jest.Mock).mockResolvedValue(true);
      
      // First read returns 'content', second read (after first edit) should return 'new1'
      (fs.readFile as unknown as jest.Mock)
        .mockResolvedValueOnce('content')
        .mockResolvedValueOnce('new1');

      const edits: EditOperation[] = [
        { file_path: 'same.ts', old_str: 'content', new_str: 'new1' },
        { file_path: 'same.ts', old_str: 'new1', new_str: 'new2' },
      ];

      const result = await tool.executeParallel(edits);

      expect(result.success).toBe(true);
      expect(fs.writeFile).toHaveBeenCalledTimes(2);
      expect(fs.writeFile).toHaveBeenLastCalledWith(expect.any(String), 'new2', 'utf-8');
    });
  });
});
