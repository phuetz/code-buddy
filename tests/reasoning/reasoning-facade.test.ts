/**
 * Tests for ReasoningFacade
 *
 * Covers construction, usage tracking, result formatting,
 * auto-select mode heuristics, and singleton management.
 */

import {
  ReasoningFacade,
  getReasoningFacade,
  resetReasoningFacade,
} from '../../src/agent/reasoning/reasoning-facade.js';

// Mock the tree-of-thought module to avoid real API calls
const mockSolve = jest.fn();
const mockChainOfThought = jest.fn();
const mockSetMode = jest.fn();
const mockFormatResult = jest.fn();

jest.mock('../../src/agent/reasoning/tree-of-thought.js', () => ({
  TreeOfThoughtReasoner: jest.fn().mockImplementation(() => ({
    solve: mockSolve,
    chainOfThought: mockChainOfThought,
    setMode: mockSetMode,
    formatResult: mockFormatResult,
  })),
}));

describe('ReasoningFacade', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetReasoningFacade();
  });

  // ── Constructor ─────────────────────────────────────────────────────

  describe('constructor', () => {
    it('creates a facade with an API key', () => {
      const facade = new ReasoningFacade('test-api-key');
      expect(facade).toBeInstanceOf(ReasoningFacade);
    });

    it('creates a facade with API key and base URL', () => {
      const facade = new ReasoningFacade('test-api-key', 'https://custom.api/v1');
      expect(facade).toBeInstanceOf(ReasoningFacade);
    });
  });

  // ── getUsage / resetUsage ───────────────────────────────────────────

  describe('getUsage()', () => {
    it('returns zeroed stats initially', () => {
      const facade = new ReasoningFacade('test-key');
      const usage = facade.getUsage();

      expect(usage.totalCalls).toBe(0);
      expect(usage.cotCalls).toBe(0);
      expect(usage.totCalls).toBe(0);
      expect(usage.mctsCalls).toBe(0);
      expect(usage.totalTimeMs).toBe(0);
      expect(usage.estimatedTokens).toBe(0);
    });

    it('returns a copy, not a reference', () => {
      const facade = new ReasoningFacade('test-key');
      const usage1 = facade.getUsage();
      const usage2 = facade.getUsage();
      expect(usage1).not.toBe(usage2);
      expect(usage1).toEqual(usage2);
    });
  });

  describe('resetUsage()', () => {
    it('clears all usage stats', async () => {
      const facade = new ReasoningFacade('test-key');

      // Run a solve to accumulate some usage
      mockChainOfThought.mockResolvedValue({
        steps: [],
        finalAnswer: 'answer',
        confidence: 0.5,
      });

      await facade.solve(
        { description: 'short' },
        { mode: 'shallow' },
      );

      // Verify usage was tracked
      const usageBefore = facade.getUsage();
      expect(usageBefore.totalCalls).toBe(1);

      // Reset
      facade.resetUsage();

      const usageAfter = facade.getUsage();
      expect(usageAfter.totalCalls).toBe(0);
      expect(usageAfter.cotCalls).toBe(0);
      expect(usageAfter.totCalls).toBe(0);
      expect(usageAfter.mctsCalls).toBe(0);
      expect(usageAfter.totalTimeMs).toBe(0);
      expect(usageAfter.estimatedTokens).toBe(0);
    });
  });

  // ── Usage tracking via solve() ──────────────────────────────────────

  describe('usage tracking', () => {
    it('increments cotCalls for shallow mode', async () => {
      const facade = new ReasoningFacade('test-key');
      mockChainOfThought.mockResolvedValue({
        steps: [],
        finalAnswer: 'answer',
        confidence: 0.8,
      });

      await facade.solve({ description: 'test' }, { mode: 'shallow' });

      const usage = facade.getUsage();
      expect(usage.totalCalls).toBe(1);
      expect(usage.cotCalls).toBe(1);
      expect(usage.totCalls).toBe(0);
      expect(usage.mctsCalls).toBe(0);
    });

    it('increments totCalls for medium mode', async () => {
      const facade = new ReasoningFacade('test-key');
      mockSolve.mockResolvedValue({
        success: true,
        solution: null,
        path: [],
        alternatives: [],
        stats: { iterations: 1, nodesCreated: 1, nodesEvaluated: 1, nodesRefined: 0, maxDepthReached: 1, totalTime: 100, bestScore: 0.9, tokensUsed: 100 },
        tree: { id: 'root', content: 'root' },
      });

      await facade.solve({ description: 'test' }, { mode: 'medium' });

      const usage = facade.getUsage();
      expect(usage.totalCalls).toBe(1);
      expect(usage.totCalls).toBe(1);
    });

    it('increments mctsCalls for deep mode', async () => {
      const facade = new ReasoningFacade('test-key');
      mockSolve.mockResolvedValue({
        success: true,
        solution: null,
        path: [],
        alternatives: [],
        stats: { iterations: 1, nodesCreated: 1, nodesEvaluated: 1, nodesRefined: 0, maxDepthReached: 1, totalTime: 100, bestScore: 0.9, tokensUsed: 100 },
        tree: { id: 'root', content: 'root' },
      });

      await facade.solve({ description: 'test' }, { mode: 'deep' });

      const usage = facade.getUsage();
      expect(usage.mctsCalls).toBe(1);
    });

    it('increments mctsCalls for exhaustive mode', async () => {
      const facade = new ReasoningFacade('test-key');
      mockSolve.mockResolvedValue({
        success: true,
        solution: null,
        path: [],
        alternatives: [],
        stats: { iterations: 1, nodesCreated: 1, nodesEvaluated: 1, nodesRefined: 0, maxDepthReached: 1, totalTime: 100, bestScore: 0.9, tokensUsed: 100 },
        tree: { id: 'root', content: 'root' },
      });

      await facade.solve({ description: 'test' }, { mode: 'exhaustive' });

      const usage = facade.getUsage();
      expect(usage.mctsCalls).toBe(1);
    });

    it('accumulates totalTimeMs and estimatedTokens across calls', async () => {
      const facade = new ReasoningFacade('test-key');
      mockChainOfThought.mockResolvedValue({
        steps: [],
        finalAnswer: 'answer',
        confidence: 0.8,
      });

      await facade.solve({ description: 'test' }, { mode: 'shallow' });
      await facade.solve({ description: 'test2' }, { mode: 'shallow' });

      const usage = facade.getUsage();
      expect(usage.totalCalls).toBe(2);
      expect(usage.cotCalls).toBe(2);
      // estimatedTokens should be > 0 (default budget * 0.6 * 2 calls)
      expect(usage.estimatedTokens).toBeGreaterThan(0);
    });
  });

  // ── formatResult ────────────────────────────────────────────────────

  describe('formatResult()', () => {
    it('formats a CoTResult with steps, finalAnswer, and confidence', () => {
      const facade = new ReasoningFacade('test-key');
      const cotResult = {
        steps: [
          { step: 1, thought: 'analyze the problem', action: 'think', observation: 'interesting' },
          { step: 2, thought: 'form hypothesis', action: 'test', observation: 'confirmed' },
        ],
        finalAnswer: 'the answer is 42',
        confidence: 0.85,
      };

      const formatted = facade.formatResult(cotResult);

      expect(formatted).toContain('CHAIN-OF-THOUGHT');
      expect(formatted).toContain('the answer is 42');
      expect(formatted).toContain('85%');
      expect(formatted).toContain('Step 1');
      expect(formatted).toContain('Step 2');
      expect(formatted).toContain('analyze the problem');
      expect(formatted).toContain('form hypothesis');
    });

    it('formats a CoTResult with no action/observation fields', () => {
      const facade = new ReasoningFacade('test-key');
      const cotResult = {
        steps: [
          { step: 1, thought: 'just thinking' },
        ],
        finalAnswer: 'simple answer',
        confidence: 0.5,
      };

      const formatted = facade.formatResult(cotResult);

      expect(formatted).toContain('CHAIN-OF-THOUGHT');
      expect(formatted).toContain('simple answer');
      expect(formatted).toContain('50%');
    });

    it('formats a CoTResult with zero confidence', () => {
      const facade = new ReasoningFacade('test-key');
      const cotResult = {
        steps: [],
        finalAnswer: 'uncertain',
        confidence: 0,
      };

      const formatted = facade.formatResult(cotResult);
      expect(formatted).toContain('0%');
    });

    it('delegates to reasoner.formatResult for ReasoningResult', () => {
      const facade = new ReasoningFacade('test-key');
      mockFormatResult.mockReturnValue('Mocked tree-of-thought output');

      const reasoningResult = {
        success: true,
        solution: { id: '1', content: 'solution', type: 'conclusion', parent: null, children: [], score: 0.9, visits: 5, depth: 3, metadata: { generationRound: 1 }, state: 'completed' },
        path: [],
        alternatives: [],
        stats: {
          iterations: 20,
          nodesCreated: 50,
          nodesEvaluated: 30,
          nodesRefined: 5,
          maxDepthReached: 6,
          totalTime: 5000,
          bestScore: 0.9,
          tokensUsed: 10000,
        },
        tree: { id: 'root', content: 'root', type: 'analysis', parent: null, children: [], score: 0, visits: 0, depth: 0, metadata: { generationRound: 0 }, state: 'pending' },
      };

      const formatted = facade.formatResult(reasoningResult as any);

      expect(mockFormatResult).toHaveBeenCalledWith(reasoningResult);
      expect(formatted).toBe('Mocked tree-of-thought output');
    });

    it('distinguishes CoTResult from ReasoningResult correctly', () => {
      const facade = new ReasoningFacade('test-key');

      // A CoTResult has steps + finalAnswer
      const cot = { steps: [], finalAnswer: 'yes', confidence: 1 };
      const formatted = facade.formatResult(cot);
      expect(formatted).toContain('CHAIN-OF-THOUGHT');
      expect(mockFormatResult).not.toHaveBeenCalled();
    });
  });

  // ── autoSelectMode (tested indirectly via solve) ─────────────────────

  describe('auto-select mode heuristics', () => {
    it('uses shallow for short problems without constraints/examples', async () => {
      const facade = new ReasoningFacade('test-key');
      mockChainOfThought.mockResolvedValue({
        steps: [{ step: 1, thought: 'quick' }],
        finalAnswer: 'done',
        confidence: 0.9,
      });

      await facade.solve({ description: 'short problem' });

      // shallow mode calls chainOfThought, not solve
      expect(mockChainOfThought).toHaveBeenCalled();
      expect(mockSolve).not.toHaveBeenCalled();
    });

    it('uses medium for medium-length problems with constraints', async () => {
      const facade = new ReasoningFacade('test-key');
      const mockReasoningResult = {
        success: true,
        solution: null,
        path: [],
        alternatives: [],
        stats: { iterations: 5, nodesCreated: 10, nodesEvaluated: 8, nodesRefined: 2, maxDepthReached: 3, totalTime: 1000, bestScore: 0.7, tokensUsed: 3000 },
        tree: { id: 'root', content: 'root' },
      };
      mockSolve.mockResolvedValue(mockReasoningResult);

      // 200 chars + constraints => medium
      const description = 'A'.repeat(200);
      await facade.solve({
        description,
        constraints: ['must be fast', 'must be correct'],
      });

      // medium mode calls solve (tree-of-thought), not chainOfThought
      expect(mockSolve).toHaveBeenCalled();
      expect(mockSetMode).toHaveBeenCalledWith('medium', expect.objectContaining({ tokenBudget: expect.any(Number) }));
    });

    it('uses deep for long problems with constraints and examples', async () => {
      const facade = new ReasoningFacade('test-key');
      const mockReasoningResult = {
        success: true,
        solution: null,
        path: [],
        alternatives: [],
        stats: { iterations: 20, nodesCreated: 50, nodesEvaluated: 30, nodesRefined: 5, maxDepthReached: 8, totalTime: 5000, bestScore: 0.85, tokensUsed: 15000 },
        tree: { id: 'root', content: 'root' },
      };
      mockSolve.mockResolvedValue(mockReasoningResult);

      await facade.solve({
        description: 'A'.repeat(600),
        constraints: ['must handle edge cases'],
        examples: [{ input: 'test', expectedOutput: 'result' }],
      });

      expect(mockSolve).toHaveBeenCalled();
      expect(mockSetMode).toHaveBeenCalledWith('deep', expect.objectContaining({ tokenBudget: expect.any(Number) }));
    });

    it('explicit mode overrides auto-selection', async () => {
      const facade = new ReasoningFacade('test-key');
      mockChainOfThought.mockResolvedValue({
        steps: [],
        finalAnswer: 'done',
        confidence: 0.9,
      });

      // Even though a long description would normally trigger medium/deep,
      // explicitly passing shallow should use shallow (chainOfThought)
      await facade.solve(
        { description: 'A'.repeat(600), constraints: ['complex'] },
        { mode: 'shallow' },
      );

      expect(mockChainOfThought).toHaveBeenCalled();
      expect(mockSolve).not.toHaveBeenCalled();
    });
  });

  // ── Singleton management ──────────────────────────────────────────────

  describe('getReasoningFacade / resetReasoningFacade', () => {
    it('returns the same instance on repeated calls', () => {
      const facade1 = getReasoningFacade('key1');
      const facade2 = getReasoningFacade('key1');
      expect(facade1).toBe(facade2);
    });

    it('resetReasoningFacade clears the singleton', () => {
      const facade1 = getReasoningFacade('key1');
      resetReasoningFacade();
      const facade2 = getReasoningFacade('key2');
      expect(facade1).not.toBe(facade2);
    });

    it('new instance after reset has zeroed usage', () => {
      const facade1 = getReasoningFacade('key1');
      // Manually check usage is clean
      expect(facade1.getUsage().totalCalls).toBe(0);

      resetReasoningFacade();
      const facade2 = getReasoningFacade('key2');
      expect(facade2.getUsage().totalCalls).toBe(0);
    });
  });

  // ── Auto-escalation ───────────────────────────────────────────────────

  describe('auto-escalation', () => {
    it('escalates when autoEscalate is true and initial result is poor', async () => {
      const facade = new ReasoningFacade('test-key');

      // First call (shallow) returns low confidence => should escalate
      mockChainOfThought.mockResolvedValue({
        steps: [],
        finalAnswer: 'weak',
        confidence: 0.2,
      });

      // Escalation to medium (solve) returns good result
      const goodResult = {
        success: true,
        solution: null,
        path: [],
        alternatives: [],
        stats: { iterations: 10, nodesCreated: 20, nodesEvaluated: 15, nodesRefined: 3, maxDepthReached: 5, totalTime: 2000, bestScore: 0.9, tokensUsed: 5000 },
        tree: { id: 'root', content: 'root' },
      };
      mockSolve.mockResolvedValue(goodResult);

      const result = await facade.solve(
        { description: 'test' },
        { mode: 'shallow', autoEscalate: true },
      );

      // Should have escalated and returned the better result
      expect(mockSolve).toHaveBeenCalled();
    });

    it('does not escalate when autoEscalate is false', async () => {
      const facade = new ReasoningFacade('test-key');

      mockChainOfThought.mockResolvedValue({
        steps: [],
        finalAnswer: 'weak',
        confidence: 0.2,
      });

      await facade.solve(
        { description: 'test' },
        { mode: 'shallow', autoEscalate: false },
      );

      // Should NOT have called solve (escalation)
      expect(mockSolve).not.toHaveBeenCalled();
    });

    it('does not escalate when confidence is above threshold', async () => {
      const facade = new ReasoningFacade('test-key');

      mockChainOfThought.mockResolvedValue({
        steps: [],
        finalAnswer: 'good answer',
        confidence: 0.8,
      });

      await facade.solve(
        { description: 'test' },
        { mode: 'shallow', autoEscalate: true },
      );

      // Good confidence => no escalation
      expect(mockSolve).not.toHaveBeenCalled();
    });
  });
});
