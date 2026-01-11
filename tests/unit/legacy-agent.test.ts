import { Agent } from '../../src/agent/index';

// Mock tools
const mockView = jest.fn();
const mockStrReplace = jest.fn();
const mockCreate = jest.fn();
const mockInsert = jest.fn();
const mockUndoEdit = jest.fn();
const mockGetEditHistory = jest.fn().mockReturnValue([]);

const mockBashExecute = jest.fn();
const mockGetCurrentDirectory = jest.fn().mockReturnValue('/test/dir');

jest.mock('../../src/tools/index.js', () => ({
  TextEditorTool: jest.fn().mockImplementation(() => ({
    view: mockView,
    strReplace: mockStrReplace,
    create: mockCreate,
    insert: mockInsert,
    undoEdit: mockUndoEdit,
    getEditHistory: mockGetEditHistory,
  })),
  BashTool: jest.fn().mockImplementation(() => ({
    execute: mockBashExecute,
    getCurrentDirectory: mockGetCurrentDirectory,
  })),
}));

describe('Legacy Agent', () => {
  let agent: Agent;

  beforeEach(() => {
    jest.clearAllMocks();
    agent = new Agent();
  });

  describe('processCommand', () => {
    it('should handle "view" command', async () => {
      mockView.mockResolvedValue({ success: true, output: 'content' });
      await agent.processCommand('view file.txt');
      expect(mockView).toHaveBeenCalledWith('file.txt', undefined);

      await agent.processCommand('view file.txt 1-10');
      expect(mockView).toHaveBeenCalledWith('file.txt', [1, 10]);
    });

    it('should handle "str_replace" command', async () => {
      mockStrReplace.mockResolvedValue({ success: true });
      await agent.processCommand('str_replace file.txt "old" "new"');
      expect(mockStrReplace).toHaveBeenCalledWith('file.txt', 'old', 'new');
    });

    it('should return error for invalid "str_replace"', async () => {
      const result = await agent.processCommand('str_replace invalid');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid str_replace');
    });

    it('should handle "create" command', async () => {
      mockCreate.mockResolvedValue({ success: true });
      await agent.processCommand('create file.txt "content"');
      expect(mockCreate).toHaveBeenCalledWith('file.txt', 'content');
    });

    it('should return error for invalid "create"', async () => {
      const result = await agent.processCommand('create invalid');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid create');
    });

    it('should handle "insert" command', async () => {
      mockInsert.mockResolvedValue({ success: true });
      await agent.processCommand('insert file.txt 5 "content"');
      expect(mockInsert).toHaveBeenCalledWith('file.txt', 5, 'content');
    });

    it('should return error for invalid "insert"', async () => {
      const result = await agent.processCommand('insert invalid');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid insert');
    });

    it('should handle "undo_edit" command', async () => {
      mockUndoEdit.mockResolvedValue({ success: true });
      await agent.processCommand('undo_edit');
      expect(mockUndoEdit).toHaveBeenCalled();
    });

    it('should handle "bash" command', async () => {
      mockBashExecute.mockResolvedValue({ success: true, output: 'ok' });
      await agent.processCommand('bash ls -la');
      expect(mockBashExecute).toHaveBeenCalledWith('ls -la');
    });

    it('should handle "$" shorthand', async () => {
      mockBashExecute.mockResolvedValue({ success: true, output: 'ok' });
      await agent.processCommand('$ ls -la');
      expect(mockBashExecute).toHaveBeenCalledWith('ls -la');
    });

    it('should handle "pwd" command', async () => {
      const result = await agent.processCommand('pwd');
      expect(result.success).toBe(true);
      expect(result.output).toBe('/test/dir');
    });

    it('should handle "history" command', async () => {
      mockGetEditHistory.mockReturnValue([{ id: 1, action: 'edit' }]);
      const result = await agent.processCommand('history');
      expect(result.success).toBe(true);
      expect(result.output).toContain('"id": 1');
    });

    it('should handle empty "history"', async () => {
      mockGetEditHistory.mockReturnValue([]);
      const result = await agent.processCommand('history');
      expect(result.success).toBe(true);
      expect(result.output).toBe('No edit history');
    });

    it('should handle "help" command', async () => {
      const result = await agent.processCommand('help');
      expect(result.success).toBe(true);
      expect(result.output).toContain('Available commands');
    });

    it('should default to bash for unknown commands', async () => {
      mockBashExecute.mockResolvedValue({ success: true, output: 'ok' });
      await agent.processCommand('unknown command');
      expect(mockBashExecute).toHaveBeenCalledWith('unknown command');
    });
  });

  describe('getCurrentState', () => {
    it('should return current state', () => {
      const state = agent.getCurrentState();
      expect(state.currentDirectory).toBe('/test/dir');
      expect(state.editHistory).toEqual([]);
    });
  });
});
