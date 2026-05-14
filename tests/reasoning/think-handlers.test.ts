/**
 * Tests for /think command handlers
 *
 * Covers help text, mode toggling, status display, and problem-solving paths.
 */

import { vi } from 'vitest';
import {
  handleThink,
  getActiveThinkingMode,
  setActiveThinkingMode,
} from '../../src/commands/handlers/think-handlers.js';

// Mock the tree-of-thought reasoner so tests never make real API calls
const mockSolve = jest.fn();
const mockChainOfThought = jest.fn();
const mockSetMode = jest.fn();
const mockFormatResult = jest.fn();
const providerMocks = vi.hoisted(() => ({
  mockDetectProvider: vi.fn(),
}));
const { mockDetectProvider } = providerMocks;

jest.mock('../../src/agent/reasoning/tree-of-thought.js', () => ({
  getTreeOfThoughtReasoner: jest.fn(function() { return {
    solve: mockSolve,
    chainOfThought: mockChainOfThought,
    setMode: mockSetMode,
    formatResult: mockFormatResult,
  }; }),
  TreeOfThoughtReasoner: jest.fn(),
}));

jest.mock('../../src/utils/provider-detector.js', () => ({
  detectProviderFromEnv: providerMocks.mockDetectProvider,
  selectModelForDetectedProvider: (detected: { defaultModel: string }) => detected.defaultModel,
}));

describe('think-handlers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset thinking mode before each test
    setActiveThinkingMode(null);
    mockDetectProvider.mockReturnValue({
      provider: 'grok',
      apiKey: 'test-key-123',
      baseURL: undefined,
      defaultModel: 'grok-3-latest',
    });
  });

  // ── /think (no args) ─────────────────────────────────────────────────

  describe('handleThink([])', () => {
    it('returns help text when called with no arguments', async () => {
      const result = await handleThink([]);

      expect(result.handled).toBe(true);
      expect(result.entry!.type).toBe('assistant');
      expect(result.entry!.content).toContain('Usage:');
      expect(result.entry!.content).toContain('/think off');
      expect(result.entry!.content).toContain('/think shallow');
      expect(result.entry!.content).toContain('/think medium');
      expect(result.entry!.content).toContain('/think deep');
      expect(result.entry!.content).toContain('/think exhaustive');
      expect(result.entry!.timestamp).toBeInstanceOf(Date);
    });

    it('shows current mode as "off" in help text when no mode is set', async () => {
      const result = await handleThink([]);
      expect(result.entry!.content).toContain('Current mode: off');
    });

    it('shows current mode in help text when a mode is active', async () => {
      setActiveThinkingMode('deep');
      const result = await handleThink([]);
      expect(result.entry!.content).toContain('Current mode: deep');
    });
  });

  // ── /think off ────────────────────────────────────────────────────────

  describe('handleThink(["off"])', () => {
    it('disables thinking mode', async () => {
      setActiveThinkingMode('medium');
      const result = await handleThink(['off']);

      expect(result.handled).toBe(true);
      expect(result.entry!.content).toContain('disabled');
      expect(getActiveThinkingMode()).toBeNull();
      expect(result.entry!.timestamp).toBeInstanceOf(Date);
    });

    it('is idempotent when already off', async () => {
      const result = await handleThink(['off']);
      expect(result.handled).toBe(true);
      expect(getActiveThinkingMode()).toBeNull();
    });
  });

  // ── /think status ─────────────────────────────────────────────────────

  describe('handleThink(["status"])', () => {
    it('shows current mode and no-runs message when off', async () => {
      const result = await handleThink(['status']);

      expect(result.handled).toBe(true);
      expect(result.entry!.content).toContain('Reasoning mode: off');
      expect(result.entry!.content).toContain('No reasoning runs yet');
      expect(result.entry!.timestamp).toBeInstanceOf(Date);
    });

    it('shows configuration when a mode is active', async () => {
      setActiveThinkingMode('deep');
      const result = await handleThink(['status']);

      expect(result.entry!.content).toContain('Reasoning mode: deep');
      expect(result.entry!.content).toContain('Configuration:');
      expect(result.entry!.content).toContain('Mode:');
      expect(result.entry!.content).toContain('Max iterations:');
      expect(result.entry!.content).toContain('Max depth:');
      expect(result.entry!.content).toContain('Expansion:');
    });
  });

  // ── /think <mode> — setting modes ─────────────────────────────────────

  describe('handleThink(["medium"])', () => {
    it('sets mode to medium', async () => {
      const result = await handleThink(['medium']);

      expect(result.handled).toBe(true);
      expect(result.entry!.content).toContain('medium');
      expect(getActiveThinkingMode()).toBe('medium');
      expect(result.entry!.timestamp).toBeInstanceOf(Date);
    });

    it('includes configuration details in the response', async () => {
      const result = await handleThink(['medium']);
      expect(result.entry!.content).toContain('Mode:');
      expect(result.entry!.content).toContain('All subsequent complex queries');
    });
  });

  describe('handleThink(["shallow"])', () => {
    it('sets mode to shallow', async () => {
      const result = await handleThink(['shallow']);

      expect(result.handled).toBe(true);
      expect(getActiveThinkingMode()).toBe('shallow');
      expect(result.entry!.content).toContain('shallow');
      expect(result.entry!.timestamp).toBeInstanceOf(Date);
    });
  });

  describe('handleThink(["deep"])', () => {
    it('sets mode to deep', async () => {
      const result = await handleThink(['deep']);

      expect(result.handled).toBe(true);
      expect(getActiveThinkingMode()).toBe('deep');
      expect(result.entry!.content).toContain('deep');
      expect(result.entry!.timestamp).toBeInstanceOf(Date);
    });
  });

  describe('handleThink(["exhaustive"])', () => {
    it('sets mode to exhaustive', async () => {
      const result = await handleThink(['exhaustive']);

      expect(result.handled).toBe(true);
      expect(getActiveThinkingMode()).toBe('exhaustive');
      expect(result.entry!.content).toContain('exhaustive');
      expect(result.entry!.timestamp).toBeInstanceOf(Date);
    });
  });

  // ── Mode persistence via getActiveThinkingMode ────────────────────────

  describe('getActiveThinkingMode / setActiveThinkingMode', () => {
    it('returns null initially', () => {
      expect(getActiveThinkingMode()).toBeNull();
    });

    it('returns the mode after setting', () => {
      setActiveThinkingMode('deep');
      expect(getActiveThinkingMode()).toBe('deep');
    });

    it('returns null after setting to null', () => {
      setActiveThinkingMode('medium');
      setActiveThinkingMode(null);
      expect(getActiveThinkingMode()).toBeNull();
    });

    it('setting a mode via handleThink updates getActiveThinkingMode', async () => {
      await handleThink(['shallow']);
      expect(getActiveThinkingMode()).toBe('shallow');

      await handleThink(['deep']);
      expect(getActiveThinkingMode()).toBe('deep');

      await handleThink(['off']);
      expect(getActiveThinkingMode()).toBeNull();
    });
  });

  // ── /think <problem> — problem solving (no provider) ──────────────────

  describe('handleThink with problem text (no provider)', () => {
    beforeEach(() => {
      mockDetectProvider.mockReturnValue(null);
    });

    it('returns an error when no provider is detected', async () => {
      const result = await handleThink(['how', 'do', 'I', 'center', 'a', 'div?']);

      expect(result.handled).toBe(true);
      expect(result.entry!.content).toContain('no LLM provider configured');
      expect(result.entry!.timestamp).toBeInstanceOf(Date);
    });

    it('returns an error for invalid mode text that becomes problem text', async () => {
      const result = await handleThink(['invalidmode', 'some', 'text']);

      expect(result.handled).toBe(true);
      // Without a provider it should fail with the provider setup error
      expect(result.entry!.content).toContain('no LLM provider configured');
      expect(result.entry!.timestamp).toBeInstanceOf(Date);
    });
  });

  // ── /think <mode> <problem> — mode + problem ──────────────────────────

  describe('handleThink with mode and problem text', () => {
    beforeEach(() => {
      mockDetectProvider.mockReturnValue(null);
    });

    it('sets mode AND attempts to solve when given mode + problem', async () => {
      const result = await handleThink(['deep', 'how', 'to', 'optimize', 'DB']);

      expect(result.handled).toBe(true);
      // Mode should be set even though solving will fail
      expect(getActiveThinkingMode()).toBe('deep');
      // Without a provider it should fail
      expect(result.entry!.content).toContain('no LLM provider configured');
    });
  });

  // ── /think <mode> <problem> — with mock provider ─────────────────────

  describe('handleThink with problem solving (mocked API)', () => {
    it('runs chain-of-thought for shallow mode with problem text', async () => {
      mockChainOfThought.mockResolvedValue({
        steps: [{ step: 1, thought: 'think about it', action: 'none', observation: 'ok' }],
        finalAnswer: 'the answer',
        confidence: 0.9,
      });

      setActiveThinkingMode('shallow');
      const result = await handleThink(['shallow', 'what', 'is', '2+2']);

      expect(result.handled).toBe(true);
      expect(result.entry!.content).toContain('Chain-of-Thought');
      expect(result.entry!.content).toContain('the answer');
      expect(result.entry!.content).toContain('90%');
      expect(result.entry!.timestamp).toBeInstanceOf(Date);
    });

    it('passes ChatGPT Codex OAuth transport into the reasoner', async () => {
      mockDetectProvider.mockReturnValue({
        provider: 'chatgpt',
        apiKey: 'oauth-chatgpt',
        baseURL: 'https://chatgpt.com/backend-api/codex',
        defaultModel: 'gpt-5.5',
      });
      mockSolve.mockResolvedValue({
        success: true,
        solution: { content: 'solution', metadata: {} },
        path: [],
        alternatives: [],
        stats: {
          iterations: 1,
          nodesCreated: 1,
          nodesEvaluated: 1,
          nodesRefined: 0,
          maxDepthReached: 1,
          totalTime: 100,
          bestScore: 0.9,
          tokensUsed: 10,
        },
        tree: { id: 'root', content: 'root' },
      });
      mockFormatResult.mockReturnValue('ok');

      await handleThink(['deep', 'problem']);

      const { getTreeOfThoughtReasoner } = await import('../../src/agent/reasoning/tree-of-thought.js');
      expect(getTreeOfThoughtReasoner).toHaveBeenCalledWith(
        'oauth-chatgpt',
        'https://chatgpt.com/backend-api/codex',
        { mode: 'deep', model: 'gpt-5.5' }
      );
    });

    it('runs full tree-of-thought for non-shallow modes', async () => {
      const mockResult = {
        success: true,
        solution: { content: 'solution', metadata: {} },
        path: [],
        alternatives: [],
        stats: {
          iterations: 10,
          nodesCreated: 20,
          nodesEvaluated: 15,
          nodesRefined: 3,
          maxDepthReached: 5,
          totalTime: 3000,
          bestScore: 0.85,
          tokensUsed: 5000,
        },
        tree: { id: 'root', content: 'root' },
      };
      mockSolve.mockResolvedValue(mockResult);
      mockFormatResult.mockReturnValue('Formatted reasoning result');

      const result = await handleThink(['deep', 'complex', 'problem']);

      expect(result.handled).toBe(true);
      expect(result.entry!.content).toBe('Formatted reasoning result');
      expect(mockSolve).toHaveBeenCalled();
    });

    it('handles reasoning errors gracefully', async () => {
      mockSolve.mockRejectedValue(new Error('LLM API timeout'));

      setActiveThinkingMode('medium');
      const result = await handleThink(['medium', 'failing', 'problem']);

      expect(result.handled).toBe(true);
      expect(result.entry!.content).toContain('Reasoning failed');
      expect(result.entry!.content).toContain('LLM API timeout');
      expect(result.entry!.timestamp).toBeInstanceOf(Date);
    });
  });

  // ── All results have timestamp ────────────────────────────────────────

  describe('timestamp presence', () => {
    it('help text has timestamp', async () => {
      const result = await handleThink([]);
      expect(result.entry!.timestamp).toBeInstanceOf(Date);
    });

    it('off command has timestamp', async () => {
      const result = await handleThink(['off']);
      expect(result.entry!.timestamp).toBeInstanceOf(Date);
    });

    it('status command has timestamp', async () => {
      const result = await handleThink(['status']);
      expect(result.entry!.timestamp).toBeInstanceOf(Date);
    });

    it('mode setting has timestamp', async () => {
      const result = await handleThink(['medium']);
      expect(result.entry!.timestamp).toBeInstanceOf(Date);
    });
  });
});
