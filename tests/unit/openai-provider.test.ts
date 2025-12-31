/**
 * OpenAI Provider Unit Tests
 *
 * Comprehensive tests for the OpenAIProvider class.
 */

import { OpenAIProvider } from '../../src/providers/openai-provider.js';
import type { CompletionOptions, LLMMessage, ToolDefinition } from '../../src/providers/types.js';

// Create mock for OpenAI before importing
const mockCreate = jest.fn();
const mockOpenAIInstance = {
  chat: {
    completions: {
      create: mockCreate,
    },
  },
};

// Mock OpenAI module
jest.mock('openai', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => mockOpenAIInstance),
  };
});

describe('OpenAIProvider', () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    provider = new OpenAIProvider();
    mockCreate.mockClear();
  });

  afterEach(() => {
    provider.dispose();
  });

  describe('Provider Properties', () => {
    it('should have correct type', () => {
      expect(provider.type).toBe('openai');
    });

    it('should have correct name', () => {
      expect(provider.name).toBe('GPT (OpenAI)');
    });

    it('should have correct default model', () => {
      expect(provider.defaultModel).toBe('gpt-4o');
    });
  });

  describe('Initialization', () => {
    it('should not be ready before initialization', () => {
      expect(provider.isReady()).toBe(false);
    });

    it('should throw error without API key', async () => {
      await expect(provider.initialize({ apiKey: '' }))
        .rejects.toThrow('GPT (OpenAI) API key is required');
    });

    it('should initialize with valid API key', async () => {
      await provider.initialize({ apiKey: 'test-api-key' });
      expect(provider.isReady()).toBe(true);
    });

    it('should emit ready event after initialization', async () => {
      const readyListener = jest.fn();
      provider.on('ready', readyListener);

      await provider.initialize({ apiKey: 'test-api-key' });

      expect(readyListener).toHaveBeenCalled();
    });
  });

  describe('Complete Method', () => {
    const mockResponse = {
      id: 'chatcmpl-123',
      choices: [
        {
          message: {
            content: 'Hello! How can I help you?',
            tool_calls: [],
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 8,
        total_tokens: 18,
      },
      model: 'gpt-4o',
    };

    beforeEach(async () => {
      await provider.initialize({ apiKey: 'test-api-key' });
      mockCreate.mockResolvedValue(mockResponse);
    });

    it('should throw if not initialized', async () => {
      const uninitProvider = new OpenAIProvider();
      await expect(uninitProvider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      })).rejects.toThrow('Provider not initialized');
      uninitProvider.dispose();
    });

    it('should complete basic request', async () => {
      const options: CompletionOptions = {
        messages: [{ role: 'user', content: 'Hello' }],
      };

      const response = await provider.complete(options);

      expect(response.id).toBe('chatcmpl-123');
      expect(response.content).toBe('Hello! How can I help you?');
      expect(response.finishReason).toBe('stop');
      expect(response.model).toBe('gpt-4o');
      expect(response.provider).toBe('openai');
    });

    it('should handle system prompt', async () => {
      const options: CompletionOptions = {
        messages: [{ role: 'user', content: 'Hello' }],
        systemPrompt: 'You are a helpful assistant.',
      };

      await provider.complete(options);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            { role: 'system', content: 'You are a helpful assistant.', name: undefined, tool_call_id: undefined, tool_calls: undefined },
          ]),
        })
      );
    });

    it('should handle custom temperature', async () => {
      const options: CompletionOptions = {
        messages: [{ role: 'user', content: 'Hello' }],
        temperature: 0.5,
      };

      await provider.complete(options);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.5,
        })
      );
    });

    it('should handle custom max tokens', async () => {
      const options: CompletionOptions = {
        messages: [{ role: 'user', content: 'Hello' }],
        maxTokens: 2048,
      };

      await provider.complete(options);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          max_tokens: 2048,
        })
      );
    });

    it('should use config temperature when not specified in options', async () => {
      const configuredProvider = new OpenAIProvider();
      await configuredProvider.initialize({
        apiKey: 'test-key',
        temperature: 0.9,
      });

      await configuredProvider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.9,
        })
      );

      configuredProvider.dispose();
    });

    it('should handle usage data correctly', async () => {
      const response = await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(response.usage).toEqual({
        promptTokens: 10,
        completionTokens: 8,
        totalTokens: 18,
      });
    });

    it('should handle missing usage data', async () => {
      mockCreate.mockResolvedValue({
        ...mockResponse,
        usage: undefined,
      });

      const response = await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(response.usage).toEqual({
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      });
    });
  });

  describe('Tool Calls', () => {
    beforeEach(async () => {
      await provider.initialize({ apiKey: 'test-api-key' });
    });

    it('should format tools correctly', async () => {
      const tools: ToolDefinition[] = [
        {
          name: 'get_weather',
          description: 'Get weather information',
          parameters: {
            type: 'object',
            properties: {
              location: { type: 'string' },
            },
            required: ['location'],
          },
        },
      ];

      mockCreate.mockResolvedValue({
        id: 'chatcmpl-123',
        choices: [{ message: { content: null, tool_calls: [] }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        model: 'gpt-4o',
      });

      await provider.complete({
        messages: [{ role: 'user', content: 'What is the weather?' }],
        tools,
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: [
            {
              type: 'function',
              function: {
                name: 'get_weather',
                description: 'Get weather information',
                parameters: {
                  type: 'object',
                  properties: {
                    location: { type: 'string' },
                  },
                  required: ['location'],
                },
              },
            },
          ],
        })
      );
    });

    it('should parse tool call responses', async () => {
      mockCreate.mockResolvedValue({
        id: 'chatcmpl-123',
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'call_123',
                  function: {
                    name: 'get_weather',
                    arguments: '{"location": "Paris"}',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { prompt_tokens: 15, completion_tokens: 10, total_tokens: 25 },
        model: 'gpt-4o',
      });

      const response = await provider.complete({
        messages: [{ role: 'user', content: 'What is the weather in Paris?' }],
        tools: [
          {
            name: 'get_weather',
            description: 'Get weather',
            parameters: { type: 'object', properties: {} },
          },
        ],
      });

      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolCalls[0]).toEqual({
        id: 'call_123',
        type: 'function',
        function: {
          name: 'get_weather',
          arguments: '{"location": "Paris"}',
        },
      });
      expect(response.finishReason).toBe('tool_calls');
    });

    it('should handle multiple tool calls', async () => {
      mockCreate.mockResolvedValue({
        id: 'chatcmpl-123',
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  function: { name: 'tool_a', arguments: '{}' },
                },
                {
                  id: 'call_2',
                  function: { name: 'tool_b', arguments: '{"x": 1}' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        model: 'gpt-4o',
      });

      const response = await provider.complete({
        messages: [{ role: 'user', content: 'Use both tools' }],
        tools: [
          { name: 'tool_a', description: 'Tool A', parameters: {} },
          { name: 'tool_b', description: 'Tool B', parameters: {} },
        ],
      });

      expect(response.toolCalls).toHaveLength(2);
      expect(response.toolCalls[0].function.name).toBe('tool_a');
      expect(response.toolCalls[1].function.name).toBe('tool_b');
    });

    it('should handle tool messages in conversation', async () => {
      const messages: LLMMessage[] = [
        { role: 'user', content: 'What is the weather?' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_123',
              type: 'function',
              function: { name: 'get_weather', arguments: '{}' },
            },
          ],
        },
        {
          role: 'tool',
          content: '{"temperature": 20}',
          tool_call_id: 'call_123',
          name: 'get_weather',
        },
      ];

      mockCreate.mockResolvedValue({
        id: 'chatcmpl-124',
        choices: [{ message: { content: 'The temperature is 20 degrees.', tool_calls: [] }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 },
        model: 'gpt-4o',
      });

      const response = await provider.complete({ messages });

      expect(response.content).toBe('The temperature is 20 degrees.');
    });
  });

  describe('Streaming', () => {
    beforeEach(async () => {
      await provider.initialize({ apiKey: 'test-api-key' });
    });

    it('should throw if not initialized', async () => {
      const uninitProvider = new OpenAIProvider();
      const stream = uninitProvider.stream({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      await expect(async () => {
        for await (const _chunk of stream) {
          // Should throw before yielding
        }
      }).rejects.toThrow('Provider not initialized');
      uninitProvider.dispose();
    });

    it('should stream content chunks', async () => {
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield {
            choices: [{ delta: { content: 'Hello' }, finish_reason: null }],
          };
          yield {
            choices: [{ delta: { content: ' World' }, finish_reason: null }],
          };
          yield {
            choices: [{ delta: {}, finish_reason: 'stop' }],
          };
        },
      };

      mockCreate.mockResolvedValue(mockStream);

      const chunks: string[] = [];
      for await (const chunk of provider.stream({
        messages: [{ role: 'user', content: 'Hello' }],
      })) {
        if (chunk.type === 'content') {
          chunks.push(chunk.content!);
        }
      }

      expect(chunks).toEqual(['Hello', ' World']);
    });

    it('should stream with streaming flag', async () => {
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield { choices: [{ delta: { content: 'Test' }, finish_reason: null }] };
          yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
        },
      };

      mockCreate.mockResolvedValue(mockStream);

      for await (const _chunk of provider.stream({
        messages: [{ role: 'user', content: 'Hello' }],
      })) {
        break;
      }

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          stream: true,
        })
      );
    });

    it('should stream tool calls', async () => {
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield {
            choices: [{
              delta: {
                tool_calls: [{
                  index: 0,
                  id: 'call_123',
                  function: { name: 'get_', arguments: '' },
                }],
              },
              finish_reason: null,
            }],
          };
          yield {
            choices: [{
              delta: {
                tool_calls: [{
                  index: 0,
                  function: { name: 'weather', arguments: '{"loc' },
                }],
              },
              finish_reason: null,
            }],
          };
          yield {
            choices: [{
              delta: {
                tool_calls: [{
                  index: 0,
                  function: { arguments: 'ation":"Paris"}' },
                }],
              },
              finish_reason: null,
            }],
          };
          yield {
            choices: [{ delta: {}, finish_reason: 'tool_calls' }],
          };
        },
      };

      mockCreate.mockResolvedValue(mockStream);

      const toolCalls: Array<{ id: string; function: { name: string; arguments: string } }> = [];
      for await (const chunk of provider.stream({
        messages: [{ role: 'user', content: 'Weather in Paris?' }],
        tools: [{ name: 'get_weather', description: 'Get weather', parameters: {} }],
      })) {
        if (chunk.type === 'tool_call') {
          toolCalls.push({
            id: chunk.toolCall!.id || '',
            function: {
              name: chunk.toolCall!.function?.name || '',
              arguments: chunk.toolCall!.function?.arguments || '',
            },
          });
        }
      }

      // The last emitted tool call should have the complete data
      const lastToolCall = toolCalls[toolCalls.length - 1];
      expect(lastToolCall.id).toBe('call_123');
      expect(lastToolCall.function.name).toBe('get_weather');
      expect(lastToolCall.function.arguments).toBe('{"location":"Paris"}');
    });

    it('should emit done chunk at end of stream', async () => {
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield { choices: [{ delta: { content: 'Test' }, finish_reason: null }] };
          yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
        },
      };

      mockCreate.mockResolvedValue(mockStream);

      let doneReceived = false;
      for await (const chunk of provider.stream({
        messages: [{ role: 'user', content: 'Hello' }],
      })) {
        if (chunk.type === 'done') {
          doneReceived = true;
        }
      }

      expect(doneReceived).toBe(true);
    });
  });

  describe('getModels', () => {
    it('should return list of available models', async () => {
      const models = await provider.getModels();

      expect(models).toContain('gpt-4o');
      expect(models).toContain('gpt-4o-mini');
      expect(models).toContain('gpt-4-turbo');
      expect(models).toContain('o1');
      expect(models).toContain('o1-mini');
      expect(models).toContain('o3-mini');
    });

    it('should return array type', async () => {
      const models = await provider.getModels();
      expect(Array.isArray(models)).toBe(true);
    });
  });

  describe('getPricing', () => {
    it('should return pricing information', () => {
      const pricing = provider.getPricing();

      expect(pricing).toHaveProperty('input');
      expect(pricing).toHaveProperty('output');
    });

    it('should return GPT-4o pricing', () => {
      const pricing = provider.getPricing();

      expect(pricing.input).toBe(2.5);
      expect(pricing.output).toBe(10);
    });

    it('should return positive pricing values', () => {
      const pricing = provider.getPricing();

      expect(pricing.input).toBeGreaterThan(0);
      expect(pricing.output).toBeGreaterThan(0);
    });
  });

  describe('estimateTokens', () => {
    it('should estimate tokens for text', () => {
      const text = 'Hello, this is a test message.';
      const tokens = provider.estimateTokens(text);

      expect(tokens).toBeGreaterThan(0);
    });

    it('should return roughly 1 token per 4 characters', () => {
      const text = 'abcd'; // 4 characters
      const tokens = provider.estimateTokens(text);

      expect(tokens).toBe(1);
    });

    it('should handle empty string', () => {
      const tokens = provider.estimateTokens('');
      expect(tokens).toBe(0);
    });

    it('should handle long text', () => {
      const text = 'a'.repeat(1000);
      const tokens = provider.estimateTokens(text);

      expect(tokens).toBe(250);
    });
  });

  describe('dispose', () => {
    it('should set ready to false', async () => {
      await provider.initialize({ apiKey: 'test-key' });
      expect(provider.isReady()).toBe(true);

      provider.dispose();
      expect(provider.isReady()).toBe(false);
    });

    it('should remove all listeners', async () => {
      const listener = jest.fn();
      provider.on('test', listener);

      provider.dispose();
      provider.emit('test');

      expect(listener).not.toHaveBeenCalled();
    });

    it('should be safe to call multiple times', () => {
      expect(() => {
        provider.dispose();
        provider.dispose();
        provider.dispose();
      }).not.toThrow();
    });
  });

  describe('Edge Cases', () => {
    beforeEach(async () => {
      await provider.initialize({ apiKey: 'test-api-key' });
    });

    it('should handle null content in response', async () => {
      mockCreate.mockResolvedValue({
        id: 'chatcmpl-123',
        choices: [
          {
            message: { content: null, tool_calls: [] },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10 },
        model: 'gpt-4o',
      });

      const response = await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(response.content).toBeNull();
    });

    it('should handle empty tool_calls array', async () => {
      mockCreate.mockResolvedValue({
        id: 'chatcmpl-123',
        choices: [
          {
            message: { content: 'Hello', tool_calls: [] },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        model: 'gpt-4o',
      });

      const response = await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(response.toolCalls).toEqual([]);
    });

    it('should handle undefined tool_calls', async () => {
      mockCreate.mockResolvedValue({
        id: 'chatcmpl-123',
        choices: [
          {
            message: { content: 'Hello', tool_calls: undefined },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        model: 'gpt-4o',
      });

      const response = await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(response.toolCalls).toEqual([]);
    });

    it('should handle API errors', async () => {
      mockCreate.mockRejectedValue(new Error('API Error'));

      await expect(provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      })).rejects.toThrow('API Error');
    });

    it('should handle network errors', async () => {
      mockCreate.mockRejectedValue(new Error('Network error'));

      await expect(provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      })).rejects.toThrow('Network error');
    });

    it('should use default values when options not specified', async () => {
      mockCreate.mockResolvedValue({
        id: 'chatcmpl-123',
        choices: [{ message: { content: 'Hi', tool_calls: [] }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
        model: 'gpt-4o',
      });

      await provider.complete({
        messages: [{ role: 'user', content: 'Hi' }],
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.7,
          max_tokens: 4096,
        })
      );
    });
  });
});
