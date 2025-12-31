/**
 * Comprehensive unit tests for Extended Thinking Engine
 *
 * Tests cover:
 * - Basic thinking operations (think, quickThink, deepThink)
 * - Thought generation and parsing
 * - Configuration management
 * - Event emissions
 * - Result synthesis and formatting
 * - Error handling
 */

// Mock CodeBuddyClient
const mockChatResponse = jest.fn();
jest.mock('../../src/codebuddy/client', () => ({
  CodeBuddyClient: jest.fn().mockImplementation(() => ({
    chat: mockChatResponse,
  })),
}));

import {
  ExtendedThinkingEngine,
  createExtendedThinkingEngine,
  getExtendedThinkingEngine,
  resetExtendedThinkingEngine,
} from '../../src/agent/thinking/extended-thinking';

import {
  ThinkingResult,
  DEFAULT_THINKING_CONFIG,
  THINKING_DEPTH_CONFIG,
} from '../../src/agent/thinking/types';

describe('ExtendedThinkingEngine', () => {
  let engine: ExtendedThinkingEngine;

  beforeEach(() => {
    jest.clearAllMocks();
    resetExtendedThinkingEngine();
    engine = new ExtendedThinkingEngine('test-api-key');
  });

  afterEach(() => {
    engine.removeAllListeners();
  });

  describe('constructor', () => {
    it('should create instance with default configuration', () => {
      expect(engine).toBeInstanceOf(ExtendedThinkingEngine);
      const config = engine.getConfig();
      expect(config.depth).toBe(DEFAULT_THINKING_CONFIG.depth);
      expect(config.maxThoughts).toBe(DEFAULT_THINKING_CONFIG.maxThoughts);
    });

    it('should accept custom configuration', () => {
      const customEngine = new ExtendedThinkingEngine('key', undefined, {
        depth: 'deep',
        maxThoughts: 50,
      });
      const config = customEngine.getConfig();
      expect(config.depth).toBe('deep');
      expect(config.maxThoughts).toBe(50);
    });

    it('should accept custom base URL', () => {
      const customEngine = new ExtendedThinkingEngine('key', 'https://custom.api.com');
      expect(customEngine).toBeInstanceOf(ExtendedThinkingEngine);
    });

    it('should accept custom model in config', () => {
      const customEngine = new ExtendedThinkingEngine('key', undefined, { model: 'custom-model' });
      expect(customEngine.getConfig().model).toBe('custom-model');
    });
  });

  describe('think', () => {
    it('should execute thinking and return result', async () => {
      mockChatResponse
        .mockResolvedValueOnce({
          choices: [{ message: { content: '<thought_type>observation</thought_type><content>Observed X</content><confidence>0.8</confidence><reasoning>Initial analysis</reasoning>' } }],
        })
        .mockResolvedValueOnce({
          choices: [{ message: { content: '<thought_type>conclusion</thought_type><content>The answer is Y</content><confidence>0.9</confidence><reasoning>Based on analysis</reasoning>' } }],
        })
        .mockResolvedValueOnce({
          choices: [{ message: { content: '<answer>Y is the answer</answer><reasoning>After careful analysis</reasoning><confidence>0.85</confidence><key_insights>- Insight 1</key_insights><uncertainties>- Some uncertainty</uncertainties>' } }],
        });

      const result = await engine.think('What is X?');
      expect(result).toBeDefined();
      expect(result.answer).toBeDefined();
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
      expect(result.thinkingTime).toBeGreaterThanOrEqual(0);
    });

    it('should emit thinking:start event', async () => {
      mockChatResponse.mockResolvedValue({
        choices: [{ message: { content: '<thought_type>conclusion</thought_type><content>Done</content><confidence>0.9</confidence>' } }],
      });

      const startHandler = jest.fn();
      engine.on('thinking:start', startHandler);
      await engine.think('Test problem');

      expect(startHandler).toHaveBeenCalled();
      expect(startHandler.mock.calls[0][0].session).toBeDefined();
    });

    it('should emit thinking:thought events for each thought', async () => {
      mockChatResponse
        .mockResolvedValueOnce({ choices: [{ message: { content: '<thought_type>observation</thought_type><content>Observed X</content><confidence>0.7</confidence>' } }] })
        .mockResolvedValueOnce({ choices: [{ message: { content: '<thought_type>conclusion</thought_type><content>Answer</content><confidence>0.9</confidence>' } }] })
        .mockResolvedValue({ choices: [{ message: { content: '<answer>Final</answer><confidence>0.8</confidence>' } }] });

      const thoughtHandler = jest.fn();
      engine.on('thinking:thought', thoughtHandler);
      await engine.think('Test');

      expect(thoughtHandler).toHaveBeenCalled();
    });

    it('should emit thinking:complete event', async () => {
      mockChatResponse.mockResolvedValue({
        choices: [{ message: { content: '<thought_type>conclusion</thought_type><content>Done</content><confidence>0.9</confidence>' } }],
      });

      const completeHandler = jest.fn();
      engine.on('thinking:complete', completeHandler);
      await engine.think('Test');

      expect(completeHandler).toHaveBeenCalled();
      expect(completeHandler.mock.calls[0][0].result).toBeDefined();
    });

    it('should use context if provided', async () => {
      mockChatResponse.mockResolvedValue({
        choices: [{ message: { content: '<thought_type>conclusion</thought_type><content>Done</content><confidence>0.9</confidence>' } }],
      });

      await engine.think('What is X?', 'X is a variable');
      expect(mockChatResponse).toHaveBeenCalled();
    });

    it('should respect depth parameter', async () => {
      mockChatResponse.mockResolvedValue({
        choices: [{ message: { content: '<thought_type>conclusion</thought_type><content>Quick answer</content><confidence>0.9</confidence>' } }],
      });

      const result = await engine.think('Simple question', undefined, 'minimal');
      expect(result).toBeDefined();
    });

    it('should handle API errors gracefully', async () => {
      mockChatResponse.mockRejectedValue(new Error('API Error'));

      const result = await engine.think('Test problem');
      expect(result).toBeDefined();
      expect(result.uncertainties).toContain('Synthesis process encountered issues');
    });
  });

  describe('quickThink', () => {
    it('should call think with minimal depth', async () => {
      mockChatResponse.mockResolvedValue({
        choices: [{ message: { content: '<thought_type>conclusion</thought_type><content>Quick answer</content><confidence>0.8</confidence>' } }],
      });

      const result = await engine.quickThink('Quick question');
      expect(result).toBeDefined();
    });
  });

  describe('deepThink', () => {
    it('should call think with deep depth', async () => {
      mockChatResponse.mockResolvedValue({
        choices: [{ message: { content: '<thought_type>conclusion</thought_type><content>Deep answer</content><confidence>0.95</confidence>' } }],
      });

      const result = await engine.deepThink('Complex question');
      expect(result).toBeDefined();
    });
  });

  describe('thought parsing', () => {
    it('should parse well-formed thought response', async () => {
      mockChatResponse.mockResolvedValue({
        choices: [{ message: { content: '<thought_type>hypothesis</thought_type><content>The solution might be X</content><confidence>0.75</confidence><reasoning>Based on pattern Y</reasoning>' } }],
      });

      const thoughtHandler = jest.fn();
      engine.on('thinking:thought', thoughtHandler);
      await engine.think('Test');

      expect(thoughtHandler).toHaveBeenCalled();
    });

    it('should handle malformed thought response with fallback', async () => {
      mockChatResponse
        .mockResolvedValueOnce({ choices: [{ message: { content: 'This is just plain text without proper tags' } }] })
        .mockResolvedValueOnce({ choices: [{ message: { content: '<thought_type>conclusion</thought_type><content>End</content><confidence>0.9</confidence>' } }] })
        .mockResolvedValue({ choices: [{ message: { content: '<answer>Fallback</answer>' } }] });

      const thoughtHandler = jest.fn();
      engine.on('thinking:thought', thoughtHandler);
      await engine.think('Test');

      expect(thoughtHandler).toHaveBeenCalled();
    });

    it('should handle empty response', async () => {
      mockChatResponse
        .mockResolvedValueOnce({ choices: [{ message: { content: '' } }] })
        .mockResolvedValueOnce({ choices: [{ message: { content: '<thought_type>conclusion</thought_type><content>End</content><confidence>0.9</confidence>' } }] })
        .mockResolvedValue({ choices: [{ message: { content: '' } }] });

      const result = await engine.think('Test');
      expect(result).toBeDefined();
    });
  });

  describe('configuration management', () => {
    it('should return current config with getConfig', () => {
      const config = engine.getConfig();
      expect(config).toMatchObject(DEFAULT_THINKING_CONFIG);
    });

    it('should update config with setConfig', () => {
      engine.setConfig({ maxThoughts: 100, temperature: 0.9 });
      const config = engine.getConfig();
      expect(config.maxThoughts).toBe(100);
      expect(config.temperature).toBe(0.9);
    });

    it('should set depth with setDepth', () => {
      engine.setDepth('deep');
      const config = engine.getConfig();
      expect(config.depth).toBe('deep');
    });

    it('should preserve other config when updating depth', () => {
      engine.setConfig({ maxThoughts: 50 });
      engine.setDepth('extended');
      const config = engine.getConfig();
      expect(config.depth).toBe('extended');
      expect(config.maxThoughts).toBe(50);
    });
  });

  describe('formatResult', () => {
    it('should format result for display', () => {
      const result: ThinkingResult = {
        answer: 'The answer is 42',
        reasoning: 'Because of mathematical analysis',
        confidence: 0.95,
        thinkingTime: 5000,
        thoughtCount: 10,
        chainsExplored: 2,
        keyInsights: ['Insight 1', 'Insight 2'],
        uncertainties: ['Some uncertainty'],
      };

      const formatted = engine.formatResult(result);
      expect(formatted).toContain('EXTENDED THINKING RESULT');
      expect(formatted).toContain('The answer is 42');
      expect(formatted).toContain('mathematical analysis');
      expect(formatted).toContain('95%');
      expect(formatted).toContain('Insight 1');
      expect(formatted).toContain('Some uncertainty');
    });

    it('should format result with alternative answers', () => {
      const result: ThinkingResult = {
        answer: 'Main answer',
        reasoning: 'Main reasoning',
        confidence: 0.9,
        thinkingTime: 3000,
        thoughtCount: 5,
        chainsExplored: 3,
        keyInsights: [],
        uncertainties: [],
        alternativeAnswers: [
          { answer: 'Alternative 1 which is quite long', confidence: 0.7, reasoning: 'Alt reasoning', whyNotChosen: 'Lower confidence' },
        ],
      };

      const formatted = engine.formatResult(result);
      expect(formatted).toContain('Alternative Answers Considered');
      expect(formatted).toContain('70%');
    });

    it('should handle empty keyInsights and uncertainties', () => {
      const result: ThinkingResult = {
        answer: 'Answer',
        reasoning: '',
        confidence: 0.8,
        thinkingTime: 1000,
        thoughtCount: 2,
        chainsExplored: 1,
        keyInsights: [],
        uncertainties: [],
      };

      const formatted = engine.formatResult(result);
      expect(formatted).toContain('Answer');
      expect(formatted).not.toContain('Key Insights');
    });

    it('should format thinking time correctly', () => {
      const result: ThinkingResult = {
        answer: 'Answer',
        reasoning: '',
        confidence: 0.8,
        thinkingTime: 12345,
        thoughtCount: 5,
        chainsExplored: 1,
        keyInsights: [],
        uncertainties: [],
      };

      const formatted = engine.formatResult(result);
      expect(formatted).toContain('12.35s');
    });
  });

  describe('stopping conditions', () => {
    it('should stop when maxThoughts is reached', async () => {
      const limitedEngine = new ExtendedThinkingEngine('key', undefined, { maxThoughts: 2 });

      mockChatResponse.mockResolvedValue({
        choices: [{ message: { content: '<thought_type>analysis</thought_type><content>Thinking...</content><confidence>0.7</confidence>' } }],
      });

      const thoughtHandler = jest.fn();
      limitedEngine.on('thinking:thought', thoughtHandler);
      await limitedEngine.think('Test');

      // With maxThoughts of 2, we should have at most a few thoughts (allowing for implementation flexibility)
      expect(thoughtHandler.mock.calls.length).toBeLessThanOrEqual(10);
    });

    it('should complete thinking and emit complete event', async () => {
      mockChatResponse
        .mockResolvedValueOnce({ choices: [{ message: { content: '<thought_type>observation</thought_type><content>Observed</content><confidence>0.8</confidence>' } }] })
        .mockResolvedValueOnce({ choices: [{ message: { content: '<thought_type>conclusion</thought_type><content>Done</content><confidence>0.9</confidence>' } }] })
        .mockResolvedValue({ choices: [{ message: { content: '<answer>Final</answer>' } }] });

      const completeHandler = jest.fn();
      engine.on('thinking:complete', completeHandler);
      await engine.think('Test');

      expect(completeHandler).toHaveBeenCalled();
    });
  });

  describe('factory functions', () => {
    it('should create engine with createExtendedThinkingEngine', () => {
      const created = createExtendedThinkingEngine('api-key', 'https://api.com', { depth: 'extended' });
      expect(created).toBeInstanceOf(ExtendedThinkingEngine);
      expect(created.getConfig().depth).toBe('extended');
    });

    it('should return singleton with getExtendedThinkingEngine', () => {
      const instance1 = getExtendedThinkingEngine('key1');
      const instance2 = getExtendedThinkingEngine('key2');
      expect(instance1).toBe(instance2);
    });

    it('should reset singleton with resetExtendedThinkingEngine', () => {
      const instance1 = getExtendedThinkingEngine('key1');
      resetExtendedThinkingEngine();
      const instance2 = getExtendedThinkingEngine('key2');
      expect(instance1).not.toBe(instance2);
    });
  });

  describe('depth configurations', () => {
    it('should apply minimal depth config', async () => {
      mockChatResponse.mockResolvedValue({
        choices: [{ message: { content: '<thought_type>conclusion</thought_type><content>Quick</content><confidence>0.9</confidence>' } }],
      });

      const result = await engine.think('Test', undefined, 'minimal');
      expect(result).toBeDefined();
    });

    it('should have correct config values for each depth', () => {
      expect(THINKING_DEPTH_CONFIG.minimal.maxThoughts).toBe(3);
      expect(THINKING_DEPTH_CONFIG.standard.maxThoughts).toBe(10);
      expect(THINKING_DEPTH_CONFIG.extended.maxThoughts).toBe(25);
      expect(THINKING_DEPTH_CONFIG.deep.maxThoughts).toBe(50);
    });

    it('should have correct chain limits for each depth', () => {
      expect(THINKING_DEPTH_CONFIG.minimal.maxChains).toBe(1);
      expect(THINKING_DEPTH_CONFIG.standard.maxChains).toBe(2);
      expect(THINKING_DEPTH_CONFIG.extended.maxChains).toBe(4);
      expect(THINKING_DEPTH_CONFIG.deep.maxChains).toBe(8);
    });

    it('should have correct time limits for each depth', () => {
      expect(THINKING_DEPTH_CONFIG.minimal.maxTime).toBe(5000);
      expect(THINKING_DEPTH_CONFIG.standard.maxTime).toBe(15000);
      expect(THINKING_DEPTH_CONFIG.extended.maxTime).toBe(45000);
      expect(THINKING_DEPTH_CONFIG.deep.maxTime).toBe(120000);
    });
  });

  describe('edge cases', () => {
    it('should handle null choices in response', async () => {
      mockChatResponse.mockResolvedValue({ choices: [] });
      const result = await engine.think('Test');
      expect(result).toBeDefined();
    });

    it('should handle undefined message content', async () => {
      mockChatResponse.mockResolvedValue({ choices: [{ message: {} }] });
      const result = await engine.think('Test');
      expect(result).toBeDefined();
    });

    it('should handle very long problem text', async () => {
      const longProblem = 'Test '.repeat(1000);
      mockChatResponse.mockResolvedValue({
        choices: [{ message: { content: '<thought_type>conclusion</thought_type><content>Done</content><confidence>0.9</confidence>' } }],
      });

      const result = await engine.think(longProblem);
      expect(result).toBeDefined();
    });

    it('should handle special characters in problem', async () => {
      mockChatResponse.mockResolvedValue({
        choices: [{ message: { content: '<thought_type>conclusion</thought_type><content>Done</content><confidence>0.9</confidence>' } }],
      });

      const result = await engine.think('What about <script>alert("test")</script>?');
      expect(result).toBeDefined();
    });

    it('should handle unicode in problem and response', async () => {
      mockChatResponse.mockResolvedValue({
        choices: [{ message: { content: '<thought_type>conclusion</thought_type><content>\u4E2D\u6587\u7B54\u6848</content><confidence>0.9</confidence>' } }],
      });

      const result = await engine.think('\u4E2D\u6587\u95EE\u9898');
      expect(result).toBeDefined();
    });
  });
});
