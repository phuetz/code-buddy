import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs-extra';
import { MultiEditTool, getMultiEditTool, resetMultiEditTool, SingleFileEdit } from '../src/tools/multi-edit';

// Mock the confirmation service
jest.mock('../src/utils/confirmation-service', () => ({
  ConfirmationService: {
    getInstance: () => ({
      getSessionFlags: () => ({ fileOperations: true, allOperations: true }),
      requestConfirmation: jest.fn().mockResolvedValue({ confirmed: true }),
    }),
  },
}));

// Mock the checkpoint manager
jest.mock('../src/checkpoints/checkpoint-manager', () => ({
  getCheckpointManager: () => ({
    checkpointBeforeEdit: jest.fn(),
  }),
}));

describe('MultiEditTool', () => {
  let multiEdit: MultiEditTool;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'multi-edit-test-'));
    multiEdit = new MultiEditTool();
    multiEdit.setBaseDirectory(tempDir);
  });

  afterEach(async () => {
    await fs.remove(tempDir);
    resetMultiEditTool();
  });

  describe('execute', () => {
    it('should return error for empty edits array', async () => {
      const filePath = path.join(tempDir, 'test.txt');
      await fs.writeFile(filePath, 'Hello');

      const result = await multiEdit.execute(filePath, []);
      expect(result.success).toBe(false);
      expect(result.error).toContain('non-empty array');
    });

    it('should return error for missing file_path', async () => {
      const result = await multiEdit.execute('', [{ old_string: 'a', new_string: 'b' }]);
      expect(result.success).toBe(false);
      expect(result.error).toContain('file_path is required');
    });

    it('should successfully apply a single edit', async () => {
      const filePath = path.join(tempDir, 'test.txt');
      await fs.writeFile(filePath, 'Hello World');

      const result = await multiEdit.execute(filePath, [
        { old_string: 'World', new_string: 'Universe' },
      ]);

      expect(result.success).toBe(true);
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('Hello Universe');
    });

    it('should apply multiple edits to the same file in order', async () => {
      const filePath = path.join(tempDir, 'test.txt');
      await fs.writeFile(filePath, 'AAA BBB CCC');

      const result = await multiEdit.execute(filePath, [
        { old_string: 'AAA', new_string: '111' },
        { old_string: 'BBB', new_string: '222' },
        { old_string: 'CCC', new_string: '333' },
      ]);

      expect(result.success).toBe(true);
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('111 222 333');
    });

    it('should replace only first occurrence', async () => {
      const filePath = path.join(tempDir, 'test.txt');
      await fs.writeFile(filePath, 'foo bar foo baz foo');

      const result = await multiEdit.execute(filePath, [
        { old_string: 'foo', new_string: 'XXX' },
      ]);

      expect(result.success).toBe(true);
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('XXX bar foo baz foo');
    });

    it('should return error for non-existent file', async () => {
      const result = await multiEdit.execute(
        path.join(tempDir, 'nonexistent.txt'),
        [{ old_string: 'old', new_string: 'new' }]
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should return error when old_string not found and roll back', async () => {
      const filePath = path.join(tempDir, 'test.txt');
      await fs.writeFile(filePath, 'Hello World');

      const result = await multiEdit.execute(filePath, [
        { old_string: 'Hello', new_string: 'Hi' },
        { old_string: 'NOTFOUND', new_string: 'X' },
      ]);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Edit #2 failed');
      expect(result.error).toContain('No changes were applied');

      // Original file should be unchanged (atomic rollback)
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('Hello World');
    });

    it('should handle edits that depend on previous edits', async () => {
      const filePath = path.join(tempDir, 'test.txt');
      await fs.writeFile(filePath, 'A-B-C');

      const result = await multiEdit.execute(filePath, [
        { old_string: 'A', new_string: 'X' },
        { old_string: 'X-B', new_string: 'Y' },
      ]);

      expect(result.success).toBe(true);
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('Y-C');
    });

    it('should include diff in output on success', async () => {
      const filePath = path.join(tempDir, 'test.txt');
      await fs.writeFile(filePath, 'Hello');

      const result = await multiEdit.execute(filePath, [
        { old_string: 'Hello', new_string: 'Hi' },
      ]);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Applied 1 edit');
    });

    it('should handle multi-line edits', async () => {
      const filePath = path.join(tempDir, 'test.txt');
      await fs.writeFile(filePath, 'line1\nline2\nline3\n');

      const result = await multiEdit.execute(filePath, [
        { old_string: 'line1\nline2', new_string: 'newline1\nnewline2\nnewline2b' },
      ]);

      expect(result.success).toBe(true);
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('newline1\nnewline2\nnewline2b\nline3\n');
    });

    it('should return no-op for identical content', async () => {
      const filePath = path.join(tempDir, 'test.txt');
      await fs.writeFile(filePath, 'same');

      const result = await multiEdit.execute(filePath, [
        { old_string: 'same', new_string: 'same' },
      ]);

      expect(result.success).toBe(true);
      expect(result.output).toContain('No changes needed');
    });
  });

  describe('setBaseDirectory', () => {
    it('should update the base directory', () => {
      const newDir = '/new/base/dir';
      multiEdit.setBaseDirectory(newDir);
      // No error means success
    });
  });

  describe('getMultiEditTool', () => {
    it('should return singleton instance', () => {
      const instance1 = getMultiEditTool();
      const instance2 = getMultiEditTool();
      expect(instance1).toBe(instance2);
    });

    it('should return MultiEditTool instance', () => {
      const instance = getMultiEditTool();
      expect(instance).toBeInstanceOf(MultiEditTool);
    });
  });
});
