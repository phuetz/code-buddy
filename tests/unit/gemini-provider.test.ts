/**
 * Gemini Provider Unit Tests
 *
 * Comprehensive tests for the GeminiProvider class.
 */

import { GeminiProvider } from '../../src/providers/gemini-provider.js';
import type { CompletionOptions, ToolDefinition } from '../../src/providers/types.js';

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('GeminiProvider', () => {
  let provider: GeminiProvider;

  beforeEach(() => {
    provider = new GeminiProvider();
    mockFetch.mockClear();
  });

  afterEach(() => {
    provider.dispose();
  });

  describe('Provider Properties', () => {
    it('should have correct type', () => {
      expect(provider.type).toBe('gemini');
    });

    it('should have correct name', () => {
      expect(provider.name).toBe('Gemini (Google)');
    });

    it('should have correct default model', () => {
      expect(provider.defaultModel).toBe('gemini-2.0-flash');
    });
  });

  describe('Initialization', () => {
    it('should not be ready before initialization', () => {
      expect(provider.isReady()).toBe(false);
    });

    it('should throw error without API key', async () => {
      await expect(provider.initialize({ apiKey: '' }))
        .rejects.toThrow('Gemini (Google) API key is required');
    });

    it('should initialize with valid API key', async () => {
      await provider.initialize({ apiKey: 'test-api-key' });
      expect(provider.isReady()).toBe(true);
    });

    it('should use default base URL', async () => {
      await provider.initialize({ apiKey: 'test-api-key' });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: 'Hello' }] }, finishReason: 'STOP' }],
        }),
      });

      await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('https://generativelanguage.googleapis.com/v1beta'),
        expect.anything()
      );
    });

    it('should use custom base URL when provided', async () => {
      await provider.initialize({
        apiKey: 'test-api-key',
        baseUrl: 'https://custom.gemini.api',
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: 'Hello' }] }, finishReason: 'STOP' }],
        }),
      });

      await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('https://custom.gemini.api'),
        expect.anything()
      );
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
      candidates: [
        {
          content: {
            parts: [{ text: 'Hello! How can I help you?' }],
          },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 8,
        totalTokenCount: 18,
      },
    };

    beforeEach(async () => {
      await provider.initialize({ apiKey: 'test-api-key' });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });
    });

    it('should throw if not initialized', async () => {
      const uninitProvider = new GeminiProvider();
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

      expect(response.content).toBe('Hello! How can I help you?');
      expect(response.finishReason).toBe('stop');
      expect(response.provider).toBe('gemini');
    });

    it('should include API key in URL', async () => {
      await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('key=test-api-key'),
        expect.anything()
      );
    });

    it('should handle system prompt', async () => {
      const options: CompletionOptions = {
        messages: [{ role: 'user', content: 'Hello' }],
        systemPrompt: 'You are a helpful assistant.',
      };

      await provider.complete(options);

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.systemInstruction).toEqual({
        parts: [{ text: 'You are a helpful assistant.' }],
      });
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

    it('should throw on API error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
      });

      await expect(provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      })).rejects.toThrow('Gemini API error: 400 Bad Request');
    });
  });

  describe('Message Formatting', () => {
    beforeEach(async () => {
      await provider.initialize({ apiKey: 'test-api-key' });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: 'Response' }] }, finishReason: 'STOP' }],
        }),
      });
    });

    it('should convert user role correctly', async () => {
      await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.contents[0].role).toBe('user');
    });

    it('should convert assistant role to model', async () => {
      await provider.complete({
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there!' },
          { role: 'user', content: 'How are you?' },
        ],
      });

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.contents[1].role).toBe('model');
    });

    it('should convert tool messages to function role', async () => {
      await provider.complete({
        messages: [
          { role: 'user', content: 'What is the weather?' },
          {
            role: 'tool',
            content: '{"temperature": 20}',
            name: 'get_weather',
            tool_call_id: 'call_123',
          },
        ],
      });

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.contents[1].role).toBe('function');
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

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: 'Response' }] }, finishReason: 'STOP' }],
        }),
      });

      await provider.complete({
        messages: [{ role: 'user', content: 'What is the weather?' }],
        tools,
      });

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.tools).toEqual([
        {
          functionDeclarations: [
            {
              name: 'get_weather',
              description: 'Get weather information',
              parameters: {
                type: 'object',
                properties: { location: { type: 'string' } },
                required: ['location'],
              },
            },
          ],
        },
      ]);
    });

    it('should parse function call responses', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    functionCall: {
                      name: 'get_weather',
                      args: { location: 'Paris' },
                    },
                  },
                ],
              },
              finishReason: 'STOP',
            },
          ],
        }),
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
      expect(response.toolCalls[0].function.name).toBe('get_weather');
      expect(response.toolCalls[0].function.arguments).toBe('{"location":"Paris"}');
    });
  });

  describe('Streaming', () => {
    beforeEach(async () => {
      await provider.initialize({ apiKey: 'test-api-key' });
    });

    it('should throw if not initialized', async () => {
      const uninitProvider = new GeminiProvider();
      const stream = uninitProvider.stream({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      await expect(async () => {
        for await (const _chunk of stream) {
          // Should throw
        }
      }).rejects.toThrow('Provider not initialized');
      uninitProvider.dispose();
    });

    it('should stream content chunks', async () => {
      const mockReader = {
        read: jest.fn()
          .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode('data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}\n') })
          .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode('data: {"candidates":[{"content":{"parts":[{"text":" World"}]}}]}\n') })
          .mockResolvedValueOnce({ done: true }),
        releaseLock: jest.fn(),
      };

      mockFetch.mockResolvedValue({
        ok: true,
        body: { getReader: () => mockReader },
      });

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

    it('should throw on API error during streaming', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const stream = provider.stream({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      await expect(async () => {
        for await (const _chunk of stream) {
          // Should throw
        }
      }).rejects.toThrow('Gemini API error: 500 Internal Server Error');
    });

    it('should throw if no response body', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        body: null,
      });

      const stream = provider.stream({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      await expect(async () => {
        for await (const _chunk of stream) {
          // Should throw
        }
      }).rejects.toThrow('No response body');
    });
  });

  describe('getModels', () => {
    it('should return list of available models', async () => {
      const models = await provider.getModels();

      expect(models).toContain('gemini-2.0-flash');
      expect(models).toContain('gemini-2.0-flash-thinking');
      expect(models).toContain('gemini-1.5-pro');
      expect(models).toContain('gemini-1.5-flash');
    });
  });

  describe('getPricing', () => {
    it('should return pricing information', () => {
      const pricing = provider.getPricing();

      expect(pricing).toHaveProperty('input');
      expect(pricing).toHaveProperty('output');
    });

    it('should return Gemini 2.0 Flash pricing', () => {
      const pricing = provider.getPricing();

      expect(pricing.input).toBe(0.075);
      expect(pricing.output).toBe(0.30);
    });
  });

  describe('estimateTokens', () => {
    it('should estimate tokens for text', () => {
      const text = 'Hello, this is a test message.';
      const tokens = provider.estimateTokens(text);

      expect(tokens).toBeGreaterThan(0);
    });

    it('should handle empty string', () => {
      const tokens = provider.estimateTokens('');
      expect(tokens).toBe(0);
    });
  });

  describe('dispose', () => {
    it('should set ready to false', async () => {
      await provider.initialize({ apiKey: 'test-key' });
      expect(provider.isReady()).toBe(true);

      provider.dispose();
      expect(provider.isReady()).toBe(false);
    });

    it('should remove all listeners', () => {
      const listener = jest.fn();
      provider.on('test', listener);

      provider.dispose();
      provider.emit('test');

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    beforeEach(async () => {
      await provider.initialize({ apiKey: 'test-api-key' });
    });

    it('should handle empty content response', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: { parts: [] },
              finishReason: 'STOP',
            },
          ],
        }),
      });

      const response = await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      // Empty content string becomes null
      expect(response.content).toBeNull();
    });

    it('should concatenate multiple text parts', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  { text: 'Hello' },
                  { text: ' ' },
                  { text: 'World' },
                ],
              },
              finishReason: 'STOP',
            },
          ],
        }),
      });

      const response = await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(response.content).toBe('Hello World');
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      await expect(provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      })).rejects.toThrow('Network error');
    });
  });
});
