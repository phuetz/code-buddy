/**
 * Unit tests for GrokProvider
 */

import { GrokProvider } from '../../src/providers/grok-provider';
import { CompletionOptions } from '../../src/providers/types';

// Create mock constructor and methods
const mockCreate = jest.fn();
const mockOpenAI = jest.fn().mockImplementation(() => ({
  chat: {
    completions: {
      create: mockCreate,
    },
  },
}));

// Mock the whole module for dynamic import
jest.mock('openai', () => ({
  __esModule: true,
  default: mockOpenAI,
}), { virtual: true });

describe('GrokProvider', () => {
  let provider: GrokProvider;
  const config = { apiKey: 'test-key' };

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new GrokProvider();
  });

  describe('initialize()', () => {
    it('should initialize successfully', async () => {
      await provider.initialize(config);
      expect(provider.isReady()).toBe(true);
      expect(mockOpenAI).toHaveBeenCalledWith(expect.objectContaining({
        apiKey: 'test-key',
      }));
    });
  });

  describe('complete()', () => {
    it('should send completion request and return normalized response', async () => {
      await provider.initialize(config);
      
      mockCreate.mockResolvedValue({
        id: 'test-id',
        choices: [{
          message: { content: 'hello', tool_calls: [] },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        model: 'grok-3',
      });

      const options: CompletionOptions = {
        messages: [{ role: 'user', content: 'hi' }],
      };

      const result = await provider.complete(options);

      expect(result.content).toBe('hello');
      expect(result.usage.totalTokens).toBe(15);
      expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
        model: provider.defaultModel,
      }));
    });

    it('should handle tool calls in response', async () => {
      await provider.initialize(config);
      
      mockCreate.mockResolvedValue({
        id: 'test-id',
        choices: [{
          message: {
            content: null,
            tool_calls: [{
              id: 'call-1',
              type: 'function',
              function: { name: 'get_weather', arguments: '{"city":"London"}' },
            }],
          },
          finish_reason: 'tool_calls',
        }],
        usage: { total_tokens: 20 },
        model: 'grok-3',
      });

      const result = await provider.complete({ messages: [] });

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].function.name).toBe('get_weather');
    });
  });

  describe('stream()', () => {
    it('should yield content chunks', async () => {
      await provider.initialize(config);
      
      const mockStream = (async function* () {
        yield { choices: [{ delta: { content: 'he' } }] };
        yield { choices: [{ delta: { content: 'llo' } }] };
        yield { choices: [{ finish_reason: 'stop' }] };
      })();

      mockCreate.mockResolvedValue(mockStream);

      const chunks = [];
      for await (const chunk of provider.stream({ messages: [] })) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(3);
      expect(chunks[0]).toEqual({ type: 'content', content: 'he' });
      expect(chunks[1]).toEqual({ type: 'content', content: 'llo' });
      expect(chunks[2]).toEqual({ type: 'done' });
    });

    it('should handle tool call deltas', async () => {
      await provider.initialize(config);
      
      const mockStream = (async function* () {
        yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'get_' } }] } }] };
        yield { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'weather' } }] } }] };
        yield { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"city":' } }] } }] };
        yield { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"NY"}' } }] } }] };
        yield { choices: [{ finish_reason: 'stop' }] };
      })();

      mockCreate.mockResolvedValue(mockStream);

      const chunks = [];
      for await (const chunk of provider.stream({ messages: [] })) {
        chunks.push(chunk);
      }

      const toolCallChunks = chunks.filter(c => c.type === 'tool_call');
      expect(toolCallChunks.length).toBeGreaterThan(0);
      
      // Last tool call chunk should have full name and arguments
      const lastToolCall = toolCallChunks[toolCallChunks.length - 1] as any;
      expect(lastToolCall.toolCall.function.name).toBe('get_weather');
      expect(lastToolCall.toolCall.function.arguments).toBe('{"city":"NY"}');
    });
  });

  describe('getPricing()', () => {
    it('should return pricing info', () => {
      const pricing = provider.getPricing();
      expect(pricing).toHaveProperty('input');
      expect(pricing).toHaveProperty('output');
    });
  });

  describe('supports()', () => {
    it('should support streaming and tools', () => {
      expect(provider.supports('streaming')).toBe(true);
      expect(provider.supports('tools')).toBe(true);
    });

    it('should detect vision support from model name', async () => {
      await provider.initialize({ apiKey: 'key', model: 'grok-2-vision' });
      expect(provider.supports('vision')).toBe(true);
    });
  });
});