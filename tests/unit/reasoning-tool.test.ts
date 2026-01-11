/**
 * Unit tests for ReasoningTool
 */

import { ReasoningTool } from '../../src/tools/reasoning-tool';
import * as reasoningModule from '../../src/agent/reasoning/index';

// Mock reasoning module
const mockSolve = jest.fn();
const mockFormatResult = jest.fn();
const mockSetMode = jest.fn();

const mockReasoner = {
  solve: mockSolve,
  formatResult: mockFormatResult,
  setMode: mockSetMode,
};

jest.mock('../../src/agent/reasoning/index', () => ({
  getTreeOfThoughtReasoner: jest.fn(() => mockReasoner),
}));

describe('ReasoningTool', () => {
  let tool: ReasoningTool;

  beforeEach(() => {
    jest.clearAllMocks();
    tool = new ReasoningTool();
  });

  describe('execute()', () => {
    it('should solve a problem successfully', async () => {
      mockSolve.mockResolvedValue({
        success: true,
        solution: { content: 'Solution' },
        stats: { iterations: 5 },
      });
      mockFormatResult.mockReturnValue('Formatted Output');

      const args = {
        problem: 'How do I center a div?',
        context: 'CSS',
      };

      const result = await tool.execute(args);

      expect(result.success).toBe(true);
      expect(result.output).toBe('Formatted Output');
      expect(result.data).toBeDefined();
      expect(mockSolve).toHaveBeenCalledWith({
        description: args.problem,
        context: args.context,
        constraints: undefined,
      });
    });

    it('should set reasoning mode if provided', async () => {
      mockSolve.mockResolvedValue({ success: true });
      mockFormatResult.mockReturnValue('');

      await tool.execute({
        problem: 'Hard problem',
        mode: 'deep',
      });

      expect(mockSetMode).toHaveBeenCalledWith('deep');
    });

    it('should handle constraints', async () => {
      mockSolve.mockResolvedValue({ success: true });
      mockFormatResult.mockReturnValue('');

      const constraints = ['Must be fast', 'No external libs'];
      await tool.execute({
        problem: 'Optimize algo',
        constraints,
      });

      expect(mockSolve).toHaveBeenCalledWith(expect.objectContaining({
        constraints,
      }));
    });

    it('should return error if reasoning fails', async () => {
      mockSolve.mockRejectedValue(new Error('Reasoning error'));

      const result = await tool.execute({
        problem: 'Crash me',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Reasoning failed: Reasoning error');
    });
  });

  describe('Initialization', () => {
    it('should lazily initialize reasoner', async () => {
      // Reasoner shouldn't be created until execute is called
      expect(reasoningModule.getTreeOfThoughtReasoner).not.toHaveBeenCalled();

      mockSolve.mockResolvedValue({ success: true });
      mockFormatResult.mockReturnValue('');

      await tool.execute({ problem: 'Test' });

      expect(reasoningModule.getTreeOfThoughtReasoner).toHaveBeenCalled();
    });
  });
});
