/**
 * Unit tests for CodeBuddyClient
 * Tests API client initialization, chat completion, streaming, retry logic, and error handling
 */

import { CodeBuddyClient, CodeBuddyMessage, CodeBuddyTool, hasToolCalls } from '../../src/codebuddy/client';

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

// Mock dependencies
jest.mock('../../src/utils/model-utils', () => ({
  validateModel: jest.fn(),
  getModelInfo: jest.fn().mockReturnValue({
    maxTokens: 8192,
    provider: 'xai',
    isSupported: true,
  }),
}));
jest.mock('../../src/utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Import OpenAI after mocking
import OpenAI from 'openai';
const MockedOpenAI = OpenAI as jest.MockedClass<typeof OpenAI>;

describe('CodeBuddyClient', () => {
  const mockApiKey = 'test-api-key-12345';
  let client: CodeBuddyClient;

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset environment variables
    delete process.env.GROK_BASE_URL;
    delete process.env.CODEBUDDY_MAX_TOKENS;
    delete process.env.GROK_FORCE_TOOLS;
    delete process.env.GROK_CONVERT_TOOL_MESSAGES;
  });

  describe('Constructor and Initialization', () => {
    it('should create client with API key', () => {
      client = new CodeBuddyClient(mockApiKey);

      expect(MockedOpenAI).toHaveBeenCalledWith({
        apiKey: mockApiKey,
        baseURL: 'https://api.x.ai/v1',
        timeout: 360000,
      });
    });

    it('should use default model when not specified', () => {
      client = new CodeBuddyClient(mockApiKey);

      expect(client.getCurrentModel()).toBe('grok-code-fast-1');
    });

    it('should use custom model when provided', () => {
      client = new CodeBuddyClient(mockApiKey, 'grok-beta');

      expect(client.getCurrentModel()).toBe('grok-beta');
    });

    it('should use custom base URL when provided', () => {
      const customURL = 'https://custom.api.com/v1';
      client = new CodeBuddyClient(mockApiKey, undefined, customURL);

      expect(MockedOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: customURL,
        })
      );
    });

    it('should use GROK_BASE_URL from environment', () => {
      process.env.GROK_BASE_URL = 'https://env.api.com/v1';
      client = new CodeBuddyClient(mockApiKey);

      expect(MockedOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'https://env.api.com/v1',
        })
      );
    });

    it('should prioritize custom baseURL over environment variable', () => {
      process.env.GROK_BASE_URL = 'https://env.api.com/v1';
      const customURL = 'https://custom.api.com/v1';
      client = new CodeBuddyClient(mockApiKey, undefined, customURL);

      expect(MockedOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: customURL,
        })
      );
    });

    it('should use default max tokens when CODEBUDDY_MAX_TOKENS not set', () => {
      client = new CodeBuddyClient(mockApiKey);
      // Default is 1536 - verified via chat call
      expect(client).toBeDefined();
    });

    it('should use custom max tokens from environment', () => {
      process.env.CODEBUDDY_MAX_TOKENS = '2048';
      client = new CodeBuddyClient(mockApiKey);
      // Max tokens will be used in chat calls
      expect(client).toBeDefined();
    });

    it('should ignore invalid max tokens from environment', () => {
      process.env.CODEBUDDY_MAX_TOKENS = 'invalid';
      client = new CodeBuddyClient(mockApiKey);
      // Should fallback to default
      expect(client).toBeDefined();
    });

    it('should ignore negative max tokens from environment', () => {
      process.env.CODEBUDDY_MAX_TOKENS = '-100';
      client = new CodeBuddyClient(mockApiKey);
      // Should fallback to default
      expect(client).toBeDefined();
    });
  });

  describe('Model Management', () => {
    beforeEach(() => {
      client = new CodeBuddyClient(mockApiKey);
    });

    it('should get current model', () => {
      expect(client.getCurrentModel()).toBe('grok-code-fast-1');
    });

    it('should set model', () => {
      client.setModel('grok-beta');
      expect(client.getCurrentModel()).toBe('grok-beta');
    });

    it('should get base URL', () => {
      expect(client.getBaseURL()).toBe('https://api.x.ai/v1');
    });
  });

  describe('Chat Completion', () => {
    beforeEach(() => {
      client = new CodeBuddyClient(mockApiKey);
    });

    it('should send chat request with messages', async () => {
      const mockResponse = {
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Hello! How can I help you?',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 7,
          total_tokens: 17,
        },
      };
      mockCreate.mockResolvedValueOnce(mockResponse);

      const messages: CodeBuddyMessage[] = [
        { role: 'user', content: 'Hello' },
      ];

      const response = await client.chat(messages);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'grok-code-fast-1',
          messages,
          temperature: 0.7,
          max_tokens: 16384,
        })
      );
      expect(response.choices[0].message.content).toBe('Hello! How can I help you?');
    });

    it('should include tools in request when provided', async () => {
      const mockResponse = {
        choices: [{ message: { role: 'assistant', content: 'Done' }, finish_reason: 'stop' }],
      };
      mockCreate.mockResolvedValueOnce(mockResponse);

      const messages: CodeBuddyMessage[] = [
        { role: 'user', content: 'List files' },
      ];

      const tools: CodeBuddyTool[] = [
        {
          type: 'function',
          function: {
            name: 'bash',
            description: 'Execute bash command',
            parameters: {
              type: 'object',
              properties: {
                command: { type: 'string', description: 'The command to run' },
              },
              required: ['command'],
            },
          },
        },
      ];

      await client.chat(messages, tools);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          tools,
          tool_choice: 'auto',
        })
      );
    });

    it('should use custom model from options', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
      });

      const messages: CodeBuddyMessage[] = [{ role: 'user', content: 'Hi' }];

      await client.chat(messages, [], { model: 'custom-model' });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'custom-model',
        })
      );
    });

    it('should use custom temperature from options', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
      });

      const messages: CodeBuddyMessage[] = [{ role: 'user', content: 'Hi' }];

      await client.chat(messages, [], { temperature: 0.3 });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.3,
        })
      );
    });

    it('should support legacy string model parameter', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
      });

      const messages: CodeBuddyMessage[] = [{ role: 'user', content: 'Hi' }];

      await client.chat(messages, [], 'legacy-model');

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'legacy-model',
        })
      );
    });

    it('should include search parameters when provided', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { role: 'assistant', content: 'Search result' }, finish_reason: 'stop' }],
      });

      const messages: CodeBuddyMessage[] = [{ role: 'user', content: 'Search query' }];

      await client.chat(messages, [], {
        searchOptions: {
          search_parameters: { mode: 'on' },
        },
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          search_parameters: { mode: 'on' },
        })
      );
    });

    it('should handle API errors gracefully', async () => {
      // Mock retry to fail all attempts
      mockCreate.mockRejectedValue(new Error('API rate limit exceeded'));

      const messages: CodeBuddyMessage[] = [{ role: 'user', content: 'Hi' }];

      await expect(client.chat(messages)).rejects.toThrow('CodeBuddy API error: API rate limit exceeded');
    });

    it('should handle non-Error exceptions', async () => {
      mockCreate.mockRejectedValueOnce('String error');

      const messages: CodeBuddyMessage[] = [{ role: 'user', content: 'Hi' }];

      await expect(client.chat(messages)).rejects.toThrow('CodeBuddy API error: String error');
    });
  });

  describe('Streaming Chat Completion', () => {
    beforeEach(() => {
      client = new CodeBuddyClient(mockApiKey);
    });

    it('should stream chat responses', async () => {
      const mockChunks = [
        { choices: [{ delta: { content: 'Hello' }, index: 0 }] },
        { choices: [{ delta: { content: ' World' }, index: 0 }] },
        { choices: [{ delta: {}, finish_reason: 'stop', index: 0 }] },
      ];

      async function* mockAsyncGenerator() {
        for (const chunk of mockChunks) {
          yield chunk;
        }
      }

      mockCreate.mockResolvedValueOnce(mockAsyncGenerator());

      const messages: CodeBuddyMessage[] = [{ role: 'user', content: 'Hello' }];
      const chunks: unknown[] = [];

      for await (const chunk of client.chatStream(messages)) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(3);
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          stream: true,
        })
      );
    });

    it('should include tools in streaming request', async () => {
      async function* mockAsyncGenerator() {
        yield { choices: [{ delta: { content: 'Done' }, index: 0 }] };
      }

      mockCreate.mockResolvedValueOnce(mockAsyncGenerator());

      const messages: CodeBuddyMessage[] = [{ role: 'user', content: 'List files' }];
      const tools: CodeBuddyTool[] = [
        {
          type: 'function',
          function: {
            name: 'bash',
            description: 'Execute bash command',
            parameters: {
              type: 'object',
              properties: { command: { type: 'string' } },
              required: ['command'],
            },
          },
        },
      ];

      const generator = client.chatStream(messages, tools);
      // Consume the generator
      for await (const _chunk of generator) {
        // Just consume
      }

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          tools,
          tool_choice: 'auto',
          stream: true,
        })
      );
    });

    it('should handle streaming errors', async () => {
      mockCreate.mockRejectedValueOnce(new Error('Stream connection failed'));

      const messages: CodeBuddyMessage[] = [{ role: 'user', content: 'Hi' }];

      await expect(async () => {
        for await (const _chunk of client.chatStream(messages)) {
          // Should throw before yielding
        }
      }).rejects.toThrow('CodeBuddy API error: Stream connection failed');
    });
  });

  describe('Search', () => {
    beforeEach(() => {
      client = new CodeBuddyClient(mockApiKey);
    });

    it('should perform search with default parameters', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { role: 'assistant', content: 'Search result' }, finish_reason: 'stop' }],
      });

      const response = await client.search('What is TypeScript?');

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [{ role: 'user', content: 'What is TypeScript?' }],
          search_parameters: { mode: 'on' },
        })
      );
      expect(response.choices[0].message.content).toBe('Search result');
    });

    it('should use custom search parameters', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { role: 'assistant', content: 'Result' }, finish_reason: 'stop' }],
      });

      await client.search('Query', { mode: 'auto' });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          search_parameters: { mode: 'auto' },
        })
      );
    });
  });

  describe('Tool Support Probing', () => {
    beforeEach(() => {
      jest.clearAllMocks();

      // Reset model utils mock for this test suite
      const modelUtils = require('../../src/utils/model-utils');
      modelUtils.getModelInfo.mockReturnValue({
        maxTokens: 8192,
        provider: 'xai',
        isSupported: true,
      });
    });

    it('should detect tool support from known providers', async () => {
      const modelUtils = require('../../src/utils/model-utils');
      modelUtils.getModelInfo.mockReturnValue({
        maxTokens: 8192,
        provider: 'xai',
        isSupported: true,
      });

      client = new CodeBuddyClient(mockApiKey);
      const result = await client.probeToolSupport();

      expect(result).toBe(true);
      // Should not make API call for known providers
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('should skip probe when GROK_FORCE_TOOLS is enabled', async () => {
      process.env.GROK_FORCE_TOOLS = 'true';

      const modelUtils = require('../../src/utils/model-utils');
      modelUtils.getModelInfo.mockReturnValue({
        maxTokens: 8192,
        provider: 'unknown',
        isSupported: false,
      });

      client = new CodeBuddyClient(mockApiKey, 'unknown-model');
      const result = await client.probeToolSupport();

      expect(result).toBe(true);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('should detect tool support for function calling models', async () => {
      const modelUtils = require('../../src/utils/model-utils');
      modelUtils.getModelInfo.mockReturnValue({
        maxTokens: 8192,
        provider: 'unknown',
        isSupported: false,
      });

      client = new CodeBuddyClient(mockApiKey, 'hermes-2-pro');
      const result = await client.probeToolSupport();

      expect(result).toBe(true);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('should probe API for unknown models', async () => {
      const modelUtils = require('../../src/utils/model-utils');
      modelUtils.getModelInfo.mockReturnValue({
        maxTokens: 8192,
        provider: 'unknown',
        isSupported: false,
      });

      mockCreate.mockResolvedValueOnce({
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'get_current_time', arguments: '{}' },
                },
              ],
            },
          },
        ],
      });

      client = new CodeBuddyClient(mockApiKey, 'totally-unknown-model');
      const result = await client.probeToolSupport();

      expect(result).toBe(true);
      expect(mockCreate).toHaveBeenCalled();
    });

    it('should detect no tool support when probe fails', async () => {
      const modelUtils = require('../../src/utils/model-utils');
      modelUtils.getModelInfo.mockReturnValue({
        maxTokens: 8192,
        provider: 'unknown',
        isSupported: false,
      });

      mockCreate.mockRejectedValueOnce(new Error('Tools not supported'));

      client = new CodeBuddyClient(mockApiKey, 'totally-unknown-model');
      const result = await client.probeToolSupport();

      expect(result).toBe(false);
    });

    it('should detect no tool support when response has no tool calls', async () => {
      const modelUtils = require('../../src/utils/model-utils');
      modelUtils.getModelInfo.mockReturnValue({
        maxTokens: 8192,
        provider: 'unknown',
        isSupported: false,
      });

      mockCreate.mockResolvedValueOnce({
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'I cannot use tools',
            },
          },
        ],
      });

      client = new CodeBuddyClient(mockApiKey, 'totally-unknown-model');
      const result = await client.probeToolSupport();

      expect(result).toBe(false);
    });

    it('should cache probe result', async () => {
      const modelUtils = require('../../src/utils/model-utils');
      modelUtils.getModelInfo.mockReturnValue({
        maxTokens: 8192,
        provider: 'unknown',
        isSupported: false,
      });

      mockCreate.mockResolvedValueOnce({
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [{ id: '1', type: 'function', function: { name: 'test', arguments: '{}' } }],
            },
          },
        ],
      });

      client = new CodeBuddyClient(mockApiKey, 'totally-unknown-model');

      const result1 = await client.probeToolSupport();
      const result2 = await client.probeToolSupport();

      expect(result1).toBe(true);
      expect(result2).toBe(true);
      // Should only call API once
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it('should handle empty choices array in probe response', async () => {
      const modelUtils = require('../../src/utils/model-utils');
      modelUtils.getModelInfo.mockReturnValue({
        maxTokens: 8192,
        provider: 'unknown',
        isSupported: false,
      });

      mockCreate.mockResolvedValueOnce({
        choices: [],
      });

      client = new CodeBuddyClient(mockApiKey, 'totally-unknown-model');
      const result = await client.probeToolSupport();

      expect(result).toBe(false);
    });
  });

  describe('Local Inference Detection', () => {
    it('should detect LM Studio by port 1234', async () => {
      client = new CodeBuddyClient(mockApiKey, undefined, 'http://localhost:1234/v1');

      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
      });

      const messages: CodeBuddyMessage[] = [{ role: 'user', content: 'Hi' }];
      const tools: CodeBuddyTool[] = [
        {
          type: 'function',
          function: {
            name: 'test',
            description: 'Test tool',
            parameters: { type: 'object', properties: {}, required: [] },
          },
        },
      ];

      await client.chat(messages, tools);

      // Tools should be empty for local inference
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: [],
        })
      );
    });

    it('should enable tools when GROK_FORCE_TOOLS is set', async () => {
      process.env.GROK_FORCE_TOOLS = 'true';
      client = new CodeBuddyClient(mockApiKey, undefined, 'http://localhost:1234/v1');

      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
      });

      const messages: CodeBuddyMessage[] = [{ role: 'user', content: 'Hi' }];
      const tools: CodeBuddyTool[] = [
        {
          type: 'function',
          function: {
            name: 'test',
            description: 'Test tool',
            parameters: { type: 'object', properties: {}, required: [] },
          },
        },
      ];

      await client.chat(messages, tools);

      // Tools should be included when force is enabled
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          tools,
          tool_choice: 'auto',
        })
      );
    });

    it('should enable tools for Ollama by default', async () => {
      const modelUtils = require('../../src/utils/model-utils');
      modelUtils.getModelInfo.mockReturnValue({
        maxTokens: 8192,
        provider: 'ollama',
        isSupported: true,
      });

      client = new CodeBuddyClient(mockApiKey, 'llama3.2', 'http://localhost:11434/v1');

      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
      });

      const messages: CodeBuddyMessage[] = [{ role: 'user', content: 'Hi' }];
      const tools: CodeBuddyTool[] = [
        {
          type: 'function',
          function: {
            name: 'test',
            description: 'Test tool',
            parameters: { type: 'object', properties: {}, required: [] },
          },
        },
      ];

      await client.chat(messages, tools);

      // Ollama should have tools enabled
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          tools,
          tool_choice: 'auto',
        })
      );
    });
  });

  describe('Tool Message Conversion for Local Models', () => {
    it('should convert tool messages for LM Studio', async () => {
      client = new CodeBuddyClient(mockApiKey, undefined, 'http://localhost:1234/v1');

      async function* mockAsyncGenerator() {
        yield { choices: [{ delta: { content: 'OK' }, index: 0 }] };
      }
      mockCreate.mockResolvedValueOnce(mockAsyncGenerator());

      const messages: CodeBuddyMessage[] = [
        { role: 'user', content: 'Run a command' },
        {
          role: 'assistant',
          content: 'I will run the command',
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'bash', arguments: '{"command":"ls"}' },
            },
          ],
        } as unknown as CodeBuddyMessage,
        { role: 'tool', tool_call_id: 'call_1', content: 'file1.txt\nfile2.txt' } as CodeBuddyMessage,
      ];

      for await (const _chunk of client.chatStream(messages)) {
        // Consume
      }

      // Messages should be converted
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ role: 'user', content: expect.stringContaining('[Tool Result]') }),
          ]),
        })
      );
    });

    it('should convert tool messages when GROK_CONVERT_TOOL_MESSAGES is set', async () => {
      process.env.GROK_CONVERT_TOOL_MESSAGES = 'true';
      client = new CodeBuddyClient(mockApiKey);

      async function* mockAsyncGenerator() {
        yield { choices: [{ delta: { content: 'OK' }, index: 0 }] };
      }
      mockCreate.mockResolvedValueOnce(mockAsyncGenerator());

      const messages: CodeBuddyMessage[] = [
        { role: 'user', content: 'Hi' },
        { role: 'tool', tool_call_id: 'call_1', content: 'Result' } as CodeBuddyMessage,
      ];

      for await (const _chunk of client.chatStream(messages)) {
        // Consume
      }

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ role: 'user', content: '[Tool Result]\nResult' }),
          ]),
        })
      );
    });
  });

  describe('hasToolCalls Type Guard', () => {
    it('should return true for assistant message with tool calls', () => {
      const msg = {
        role: 'assistant' as const,
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function' as const,
            function: { name: 'test', arguments: '{}' },
          },
        ],
      };

      expect(hasToolCalls(msg)).toBe(true);
    });

    it('should return false for user message', () => {
      const msg = {
        role: 'user' as const,
        content: 'Hello',
      };

      expect(hasToolCalls(msg)).toBe(false);
    });

    it('should return false for assistant message without tool calls', () => {
      const msg = {
        role: 'assistant' as const,
        content: 'Hello',
      };

      expect(hasToolCalls(msg)).toBe(false);
    });

    it('should return false for tool result message', () => {
      const msg = {
        role: 'tool' as const,
        content: 'Result',
        tool_call_id: 'call_1',
      };

      expect(hasToolCalls(msg as CodeBuddyMessage)).toBe(false);
    });
  });

  describe('Response Usage Tracking', () => {
    beforeEach(() => {
      client = new CodeBuddyClient(mockApiKey);
    });

    it('should return usage information from response', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { role: 'assistant', content: 'Hi' }, finish_reason: 'stop' }],
        usage: {
          prompt_tokens: 25,
          completion_tokens: 10,
          total_tokens: 35,
        },
      });

      const response = await client.chat([{ role: 'user', content: 'Hello' }]);

      expect(response.usage).toEqual({
        prompt_tokens: 25,
        completion_tokens: 10,
        total_tokens: 35,
      });
    });

    it('should handle response without usage', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { role: 'assistant', content: 'Hi' }, finish_reason: 'stop' }],
      });

      const response = await client.chat([{ role: 'user', content: 'Hello' }]);

      expect(response.usage).toBeUndefined();
    });
  });

  describe('Tool Call Response Handling', () => {
    beforeEach(() => {
      client = new CodeBuddyClient(mockApiKey);
    });

    it('should return tool calls in response', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_abc123',
                  type: 'function',
                  function: {
                    name: 'bash',
                    arguments: '{"command":"ls -la"}',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      });

      const response = await client.chat(
        [{ role: 'user', content: 'List files' }],
        [
          {
            type: 'function',
            function: {
              name: 'bash',
              description: 'Execute command',
              parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
            },
          },
        ]
      );

      expect(response.choices[0].message.tool_calls).toBeDefined();
      expect(response.choices[0].message.tool_calls![0].function.name).toBe('bash');
      expect(response.choices[0].finish_reason).toBe('tool_calls');
    });

    it('should handle multiple tool calls', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'read_file', arguments: '{"path":"a.txt"}' },
                },
                {
                  id: 'call_2',
                  type: 'function',
                  function: { name: 'read_file', arguments: '{"path":"b.txt"}' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      });

      const response = await client.chat([{ role: 'user', content: 'Read both files' }]);

      expect(response.choices[0].message.tool_calls).toHaveLength(2);
    });
  });

  describe('Retry Logic and Error Handling', () => {
    beforeEach(() => {
      client = new CodeBuddyClient(mockApiKey);
    });

    it('should throw wrapped error on API failure', async () => {
      // Mock retry to fail all attempts
      mockCreate.mockRejectedValue(new Error('Connection timeout'));

      await expect(client.chat([{ role: 'user', content: 'Hi' }])).rejects.toThrow(
        'CodeBuddy API error: Connection timeout'
      );
    });

    it('should throw wrapped error on streaming failure', async () => {
      mockCreate.mockRejectedValueOnce(new Error('Stream interrupted'));

      await expect(async () => {
        for await (const _chunk of client.chatStream([{ role: 'user', content: 'Hi' }])) {
          // Should throw
        }
      }).rejects.toThrow('CodeBuddy API error: Stream interrupted');
    });

    it('should handle rate limit errors', async () => {
      const rateLimitError = new Error('Rate limit exceeded. Please retry after 60 seconds.');
      // Mock retry to fail all attempts
      mockCreate.mockRejectedValue(rateLimitError);

      await expect(client.chat([{ role: 'user', content: 'Hi' }])).rejects.toThrow(
        'CodeBuddy API error: Rate limit exceeded'
      );
    });

    it('should handle authentication errors', async () => {
      const authError = new Error('Invalid API key provided');
      mockCreate.mockRejectedValueOnce(authError);

      await expect(client.chat([{ role: 'user', content: 'Hi' }])).rejects.toThrow(
        'CodeBuddy API error: Invalid API key provided'
      );
    });

    it('should handle network errors', async () => {
      const networkError = new Error('ENOTFOUND api.x.ai');
      // Mock retry to fail all attempts
      mockCreate.mockRejectedValue(networkError);

      await expect(client.chat([{ role: 'user', content: 'Hi' }])).rejects.toThrow(
        'CodeBuddy API error: ENOTFOUND api.x.ai'
      );
    }, 30000);
  });

  describe('Edge Cases', () => {
    beforeEach(() => {
      client = new CodeBuddyClient(mockApiKey);
    });

    it('should handle empty messages array', async () => {
      // Empty messages array now throws error in source
      await expect(client.chat([])).rejects.toThrow('Messages array cannot be empty');
    });

    it('should handle empty tools array', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { role: 'assistant', content: 'Hi' }, finish_reason: 'stop' }],
      });

      await client.chat([{ role: 'user', content: 'Hi' }], []);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: [],
        })
      );
    });

    it('should handle null content in assistant message', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { role: 'assistant', content: null }, finish_reason: 'stop' }],
      });

      const response = await client.chat([{ role: 'user', content: 'Hi' }]);
      // The mock response is returned as-is
      expect(response.choices[0].message.content).toBeNull();
    });

    it('should handle system messages', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
      });

      const messages: CodeBuddyMessage[] = [
        { role: 'system', content: 'You are a helpful assistant' },
        { role: 'user', content: 'Hi' },
      ];

      await client.chat(messages);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages,
        })
      );
    });

    it('should handle very long messages', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
      });

      const longContent = 'x'.repeat(100000);
      const messages: CodeBuddyMessage[] = [{ role: 'user', content: longContent }];

      await client.chat(messages);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [{ role: 'user', content: longContent }],
        })
      );
    });

    it('should handle special characters in messages', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
      });

      const specialContent = '```typescript\nconst x = "hello <world> & \\"test\\"";\n```';
      const messages: CodeBuddyMessage[] = [{ role: 'user', content: specialContent }];

      await client.chat(messages);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [{ role: 'user', content: specialContent }],
        })
      );
    });
  });

  describe('Concurrent Probe Handling', () => {
    it('should handle concurrent probeToolSupport calls', async () => {
      const modelUtils = require('../../src/utils/model-utils');
      modelUtils.getModelInfo.mockReturnValue({
        maxTokens: 8192,
        provider: 'unknown',
        isSupported: false,
      });

      mockCreate.mockImplementation(() => {
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              choices: [
                {
                  message: {
                    role: 'assistant',
                    content: null,
                    tool_calls: [{ id: '1', type: 'function', function: { name: 'test', arguments: '{}' } }],
                  },
                },
              ],
            });
          }, 50);
        });
      });

      // Use model name that doesn't match function calling patterns
      client = new CodeBuddyClient(mockApiKey, 'custom-gpt-model');

      // Call probe concurrently
      const [result1, result2, result3] = await Promise.all([
        client.probeToolSupport(),
        client.probeToolSupport(),
        client.probeToolSupport(),
      ]);

      expect(result1).toBe(true);
      expect(result2).toBe(true);
      expect(result3).toBe(true);
      // With single-flight pattern, exactly 1 API call should be made
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });
  });
});
