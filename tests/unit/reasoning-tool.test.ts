/**
 * Unit tests for ReasoningTool
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ReasoningTool } from '../../src/tools/reasoning-tool';
import * as reasoningModule from '../../src/agent/reasoning/index';

const testPaths = vi.hoisted(() => ({
  tmpHome: '',
}));

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return {
    ...actual,
    homedir: () => testPaths.tmpHome || actual.homedir(),
  };
});

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
  getTreeOfThoughtReasoner: jest.fn(function() { return mockReasoner; }),
}));

describe('ReasoningTool', () => {
  const originalEnv = process.env;
  let tool: ReasoningTool;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.CODEBUDDY_PROVIDER = 'chatgpt';
    delete process.env.CHATGPT_MODEL;
    testPaths.tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'reasoning-tool-'));
    const authDir = path.join(testPaths.tmpHome, '.codebuddy');
    fs.mkdirSync(authDir, { recursive: true });
    fs.writeFileSync(
      path.join(authDir, 'codex-auth.json'),
      JSON.stringify({ tokens: { access_token: 'test-chatgpt-token' } }),
    );
    tool = new ReasoningTool();
  });

  afterEach(() => {
    process.env = originalEnv;
    if (testPaths.tmpHome) {
      fs.rmSync(testPaths.tmpHome, { recursive: true, force: true });
      testPaths.tmpHome = '';
    }
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

      expect(reasoningModule.getTreeOfThoughtReasoner).toHaveBeenCalledWith(
        'oauth-chatgpt',
        'https://chatgpt.com/backend-api/codex',
        { model: 'gpt-5.5' },
      );
    });
  });
});
