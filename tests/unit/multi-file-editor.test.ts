/**
 * Unit tests for MultiFileEditor
 * Tests atomic multi-file operations and rollback support
 */

import { MultiFileEditor } from '../../src/tools/advanced/multi-file-editor';
import * as fs from 'fs-extra';

// Mock fs-extra
jest.mock('fs-extra', () => ({
  pathExists: jest.fn(),
  readFile: jest.fn(),
  writeFile: jest.fn(),
  mkdir: jest.fn(),
  ensureDir: jest.fn(),
  rename: jest.fn(),
  unlink: jest.fn(),
  remove: jest.fn(),
}));

describe('MultiFileEditor', () => {
  let editor: MultiFileEditor;

  beforeEach(() => {
    jest.clearAllMocks();
    editor = new MultiFileEditor();
    (fs.pathExists as unknown as jest.Mock).mockResolvedValue(true);
  });

  describe('Transactions', () => {
    it('should begin and commit a transaction', async () => {
      (fs.writeFile as unknown as jest.Mock).mockResolvedValue(undefined);
      (fs.ensureDir as unknown as jest.Mock).mockResolvedValue(undefined);
      (fs.pathExists as unknown as jest.Mock).mockResolvedValue(false); // File shouldn't exist for create

      editor.beginTransaction('test txn');
      editor.addCreateFile('file1.ts', 'content1');
      
      const result = await editor.commit();

      expect(result.success).toBe(true);
      expect(result.operationsExecuted).toBe(1);
      expect(fs.writeFile).toHaveBeenCalled();
    });

    it('should fail commit if validation fails', async () => {
      (fs.pathExists as unknown as jest.Mock).mockResolvedValue(false);

      editor.beginTransaction('fail txn');
      editor.addEditFile('missing.ts', [{ type: 'replace', startLine: 1, newText: 'new', oldText: 'old' }]);
      
      const result = await editor.commit();

      expect(result.success).toBe(false);
      expect(result.operationsExecuted).toBe(0);
    });

    it('should rollback if an operation fails', async () => {
      (fs.pathExists as unknown as jest.Mock).mockResolvedValue(true);
      (fs.readFile as unknown as jest.Mock).mockResolvedValue('original content');
      // Succeed for first, fail for second
      (fs.writeFile as unknown as jest.Mock)
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('Write failed'));

      editor.beginTransaction('rollback txn');
      editor.addEditFile('file1.ts', [{ type: 'replace', startLine: 1, newText: 'new1', oldText: 'original' }]);
      editor.addEditFile('file2.ts', [{ type: 'replace', startLine: 1, newText: 'new2', oldText: 'original' }]);

      const result = await editor.commit();

      expect(result.success).toBe(false);
      expect(result.operationsExecuted).toBe(1);
      // Verify rollback: should have rewritten file1 with original content
      expect(fs.writeFile).toHaveBeenCalledWith('file1.ts', 'original content', expect.anything());
    });
  });

  describe('Operations', () => {
    it('should add various operations', () => {
      editor.beginTransaction();
      editor.addCreateFile('f1.ts', 'c1');
      editor.addReplace('f2.ts', 'old', 'new');
      editor.addInsert('f3.ts', 5, 'inserted');
      editor.addDeleteLines('f4.ts', 10, 12);
      editor.addDeleteFile('f5.ts');
      editor.addRenameFile('old.ts', 'new.ts');

      const transactions = editor.getAllTransactions();
      expect(transactions[0].operations).toHaveLength(6);
    });
  });

  describe('Preview', () => {
    it('should generate previews for operations', async () => {
      (fs.readFile as unknown as jest.Mock).mockResolvedValue('line1\nline2\nline3');
      
      editor.beginTransaction();
      editor.addCreateFile('new.ts', 'hello\nworld');
      editor.addDeleteFile('old.ts');

      const previews = await editor.preview();
      
      expect(previews).toHaveLength(2);
      expect(previews[0].type).toBe('create');
      expect(previews[1].type).toBe('delete');
    });
  });
});