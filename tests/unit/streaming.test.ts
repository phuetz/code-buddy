/**
 * Unit tests for streaming functionality in CodeBuddyClient
 * Tests stream processing, chunk handling, tool call assembly, and error recovery
 */

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

import { CodeBuddyClient, CodeBuddyMessage, CodeBuddyTool } from '../../src/codebuddy/client';
import type { ChatCompletionChunk } from 'openai/resources/chat';

describe('Streaming Functionality', () => {
  const mockApiKey = 'test-api-key-12345';
  let client: CodeBuddyClient;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.GROK_BASE_URL;
    delete process.env.GROK_FORCE_TOOLS;
    client = new CodeBuddyClient(mockApiKey);
  });

  describe('Basic Streaming', () => {
    it('should stream text content in chunks', async () => {
      const mockChunks: Partial<ChatCompletionChunk>[] = [
        { choices: [{ delta: { content: 'Hello' }, index: 0, finish_reason: null }] },
        { choices: [{ delta: { content: ' ' }, index: 0, finish_reason: null }] },
        { choices: [{ delta: { content: 'World' }, index: 0, finish_reason: null }] },
        { choices: [{ delta: { content: '!' }, index: 0, finish_reason: null }] },
        { choices: [{ delta: {}, index: 0, finish_reason: 'stop' }] },
      ];

      async function* mockAsyncGenerator() {
        for (const chunk of mockChunks) {
          yield chunk;
        }
      }

      mockCreate.mockResolvedValueOnce(mockAsyncGenerator());

      const messages: CodeBuddyMessage[] = [{ role: 'user', content: 'Say hello' }];
      const chunks: ChatCompletionChunk[] = [];
      let fullContent = '';

      for await (const chunk of client.chatStream(messages)) {
        chunks.push(chunk);
        if (chunk.choices[0]?.delta?.content) {
          fullContent += chunk.choices[0].delta.content;
        }
      }

      expect(chunks).toHaveLength(5);
      expect(fullContent).toBe('Hello World!');
    });

    it('should handle empty content chunks', async () => {
      const mockChunks: Partial<ChatCompletionChunk>[] = [
        { choices: [{ delta: { content: '' }, index: 0, finish_reason: null }] },
        { choices: [{ delta: { content: 'Content' }, index: 0, finish_reason: null }] },
        { choices: [{ delta: { content: '' }, index: 0, finish_reason: null }] },
        { choices: [{ delta: {}, index: 0, finish_reason: 'stop' }] },
      ];

      async function* mockAsyncGenerator() {
        for (const chunk of mockChunks) {
          yield chunk;
        }
      }

      mockCreate.mockResolvedValueOnce(mockAsyncGenerator());

      const messages: CodeBuddyMessage[] = [{ role: 'user', content: 'Test' }];
      const chunks: ChatCompletionChunk[] = [];

      for await (const chunk of client.chatStream(messages)) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(4);
    });

    it('should handle unicode content', async () => {
      const unicodeContent = 'Hello, World! ';
      const mockChunks: Partial<ChatCompletionChunk>[] = [
        { choices: [{ delta: { content: unicodeContent }, index: 0, finish_reason: null }] },
        { choices: [{ delta: {}, index: 0, finish_reason: 'stop' }] },
      ];

      async function* mockAsyncGenerator() {
        for (const chunk of mockChunks) {
          yield chunk;
        }
      }

      mockCreate.mockResolvedValueOnce(mockAsyncGenerator());

      const messages: CodeBuddyMessage[] = [{ role: 'user', content: 'Test' }];
      let content = '';

      for await (const chunk of client.chatStream(messages)) {
        if (chunk.choices[0]?.delta?.content) {
          content += chunk.choices[0].delta.content;
        }
      }

      expect(content).toBe(unicodeContent);
    });

    it('should handle large content chunks', async () => {
      const largeContent = 'x'.repeat(10000);
      const mockChunks: Partial<ChatCompletionChunk>[] = [
        { choices: [{ delta: { content: largeContent }, index: 0, finish_reason: null }] },
        { choices: [{ delta: {}, index: 0, finish_reason: 'stop' }] },
      ];

      async function* mockAsyncGenerator() {
        for (const chunk of mockChunks) {
          yield chunk;
        }
      }

      mockCreate.mockResolvedValueOnce(mockAsyncGenerator());

      const messages: CodeBuddyMessage[] = [{ role: 'user', content: 'Generate large text' }];
      let content = '';

      for await (const chunk of client.chatStream(messages)) {
        if (chunk.choices[0]?.delta?.content) {
          content += chunk.choices[0].delta.content;
        }
      }

      expect(content).toBe(largeContent);
    });
  });

  describe('Tool Call Streaming', () => {
    it('should stream tool call deltas', async () => {
      const mockChunks: Partial<ChatCompletionChunk>[] = [
        {
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                id: 'call_abc123',
                type: 'function',
                function: { name: 'bash', arguments: '' },
              }],
            },
            index: 0,
            finish_reason: null,
          }],
        },
        {
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                function: { arguments: '{"com' },
              }],
            },
            index: 0,
            finish_reason: null,
          }],
        },
        {
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                function: { arguments: 'mand":"ls"}' },
              }],
            },
            index: 0,
            finish_reason: null,
          }],
        },
        { choices: [{ delta: {}, index: 0, finish_reason: 'tool_calls' }] },
      ];

      async function* mockAsyncGenerator() {
        for (const chunk of mockChunks) {
          yield chunk;
        }
      }

      mockCreate.mockResolvedValueOnce(mockAsyncGenerator());

      const messages: CodeBuddyMessage[] = [{ role: 'user', content: 'List files' }];
      const tools: CodeBuddyTool[] = [
        {
          type: 'function',
          function: {
            name: 'bash',
            description: 'Execute command',
            parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
          },
        },
      ];

      const chunks: ChatCompletionChunk[] = [];
      let toolCallArgs = '';

      for await (const chunk of client.chatStream(messages, tools)) {
        chunks.push(chunk);
        if (chunk.choices[0]?.delta?.tool_calls?.[0]?.function?.arguments) {
          toolCallArgs += chunk.choices[0].delta.tool_calls[0].function.arguments;
        }
      }

      expect(chunks).toHaveLength(4);
      expect(toolCallArgs).toBe('{"command":"ls"}');
    });

    it('should handle multiple parallel tool calls', async () => {
      const mockChunks: Partial<ChatCompletionChunk>[] = [
        {
          choices: [{
            delta: {
              tool_calls: [
                { index: 0, id: 'call_1', type: 'function', function: { name: 'view_file', arguments: '{"path":"a.txt"}' } },
              ],
            },
            index: 0,
            finish_reason: null,
          }],
        },
        {
          choices: [{
            delta: {
              tool_calls: [
                { index: 1, id: 'call_2', type: 'function', function: { name: 'view_file', arguments: '{"path":"b.txt"}' } },
              ],
            },
            index: 0,
            finish_reason: null,
          }],
        },
        { choices: [{ delta: {}, index: 0, finish_reason: 'tool_calls' }] },
      ];

      async function* mockAsyncGenerator() {
        for (const chunk of mockChunks) {
          yield chunk;
        }
      }

      mockCreate.mockResolvedValueOnce(mockAsyncGenerator());

      const messages: CodeBuddyMessage[] = [{ role: 'user', content: 'Read both files' }];
      const chunks: ChatCompletionChunk[] = [];

      for await (const chunk of client.chatStream(messages)) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(3);
    });

    it('should handle tool call with mixed content', async () => {
      const mockChunks: Partial<ChatCompletionChunk>[] = [
        {
          choices: [{
            delta: { content: 'I will execute the command' },
            index: 0,
            finish_reason: null,
          }],
        },
        {
          choices: [{
            delta: {
              tool_calls: [
                { index: 0, id: 'call_1', type: 'function', function: { name: 'bash', arguments: '{"command":"ls"}' } },
              ],
            },
            index: 0,
            finish_reason: null,
          }],
        },
        { choices: [{ delta: {}, index: 0, finish_reason: 'tool_calls' }] },
      ];

      async function* mockAsyncGenerator() {
        for (const chunk of mockChunks) {
          yield chunk;
        }
      }

      mockCreate.mockResolvedValueOnce(mockAsyncGenerator());

      const chunks: ChatCompletionChunk[] = [];
      let content = '';
      let hasToolCall = false;

      for await (const chunk of client.chatStream([{ role: 'user', content: 'Run ls' }])) {
        chunks.push(chunk);
        if (chunk.choices[0]?.delta?.content) {
          content += chunk.choices[0].delta.content;
        }
        if (chunk.choices[0]?.delta?.tool_calls) {
          hasToolCall = true;
        }
      }

      expect(content).toBe('I will execute the command');
      expect(hasToolCall).toBe(true);
    });
  });

  describe('Stream Error Handling', () => {
    it('should throw on API error', async () => {
      mockCreate.mockRejectedValueOnce(new Error('API Error'));

      const messages: CodeBuddyMessage[] = [{ role: 'user', content: 'Test' }];

      await expect(async () => {
        for await (const _chunk of client.chatStream(messages)) {
          // Should throw before yielding
        }
      }).rejects.toThrow('CodeBuddy API error: API Error');
    });

    it('should handle stream interruption', async () => {
      async function* mockAsyncGenerator() {
        yield { choices: [{ delta: { content: 'Hello' }, index: 0, finish_reason: null }] };
        throw new Error('Stream interrupted');
      }

      mockCreate.mockResolvedValueOnce(mockAsyncGenerator());

      const messages: CodeBuddyMessage[] = [{ role: 'user', content: 'Test' }];
      const chunks: ChatCompletionChunk[] = [];

      await expect(async () => {
        for await (const chunk of client.chatStream(messages)) {
          chunks.push(chunk);
        }
      }).rejects.toThrow('Stream interrupted');

      // Should have received one chunk before error
      expect(chunks.length).toBe(1);
    });

    it('should handle connection timeout', async () => {
      mockCreate.mockRejectedValueOnce(new Error('Connection timeout'));

      const messages: CodeBuddyMessage[] = [{ role: 'user', content: 'Test' }];

      await expect(async () => {
        for await (const _chunk of client.chatStream(messages)) {
          // Should throw
        }
      }).rejects.toThrow('CodeBuddy API error: Connection timeout');
    });

    it('should handle rate limit error', async () => {
      mockCreate.mockRejectedValueOnce(new Error('Rate limit exceeded'));

      const messages: CodeBuddyMessage[] = [{ role: 'user', content: 'Test' }];

      await expect(async () => {
        for await (const _chunk of client.chatStream(messages)) {
          // Should throw
        }
      }).rejects.toThrow('CodeBuddy API error: Rate limit exceeded');
    });

    it('should handle malformed chunk gracefully', async () => {
      const mockChunks = [
        { choices: [] }, // Malformed - empty choices
        { choices: [{ delta: { content: 'Valid' }, index: 0, finish_reason: null }] },
        { choices: [{ delta: {}, index: 0, finish_reason: 'stop' }] },
      ];

      async function* mockAsyncGenerator() {
        for (const chunk of mockChunks) {
          yield chunk;
        }
      }

      mockCreate.mockResolvedValueOnce(mockAsyncGenerator());

      const messages: CodeBuddyMessage[] = [{ role: 'user', content: 'Test' }];
      const chunks: unknown[] = [];

      for await (const chunk of client.chatStream(messages)) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(3);
    });
  });

  describe('Stream Options', () => {
    it('should include tools in streaming request', async () => {
      async function* mockAsyncGenerator() {
        yield { choices: [{ delta: { content: 'OK' }, index: 0, finish_reason: 'stop' }] };
      }

      mockCreate.mockResolvedValueOnce(mockAsyncGenerator());

      const messages: CodeBuddyMessage[] = [{ role: 'user', content: 'List files' }];
      const tools: CodeBuddyTool[] = [
        {
          type: 'function',
          function: {
            name: 'bash',
            description: 'Execute command',
            parameters: { type: 'object', properties: {}, required: [] },
          },
        },
      ];

      for await (const _chunk of client.chatStream(messages, tools)) {
        // Consume
      }

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          tools,
          tool_choice: 'auto',
          stream: true,
        })
      );
    });

    it('should use custom model in streaming', async () => {
      async function* mockAsyncGenerator() {
        yield { choices: [{ delta: { content: 'OK' }, index: 0, finish_reason: 'stop' }] };
      }

      mockCreate.mockResolvedValueOnce(mockAsyncGenerator());

      const messages: CodeBuddyMessage[] = [{ role: 'user', content: 'Test' }];

      for await (const _chunk of client.chatStream(messages, [], { model: 'custom-model' })) {
        // Consume
      }

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'custom-model',
        })
      );
    });

    it('should use custom temperature in streaming', async () => {
      async function* mockAsyncGenerator() {
        yield { choices: [{ delta: { content: 'OK' }, index: 0, finish_reason: 'stop' }] };
      }

      mockCreate.mockResolvedValueOnce(mockAsyncGenerator());

      const messages: CodeBuddyMessage[] = [{ role: 'user', content: 'Test' }];

      for await (const _chunk of client.chatStream(messages, [], { temperature: 0.2 })) {
        // Consume
      }

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.2,
        })
      );
    });

    it('should include search parameters in streaming', async () => {
      async function* mockAsyncGenerator() {
        yield { choices: [{ delta: { content: 'Search result' }, index: 0, finish_reason: 'stop' }] };
      }

      mockCreate.mockResolvedValueOnce(mockAsyncGenerator());

      const messages: CodeBuddyMessage[] = [{ role: 'user', content: 'Search query' }];

      for await (const _chunk of client.chatStream(messages, [], {
        searchOptions: { search_parameters: { mode: 'on' } },
      })) {
        // Consume
      }

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          search_parameters: { mode: 'on' },
        })
      );
    });
  });

  describe('Finish Reasons', () => {
    it('should handle stop finish reason', async () => {
      const mockChunks: Partial<ChatCompletionChunk>[] = [
        { choices: [{ delta: { content: 'Done' }, index: 0, finish_reason: null }] },
        { choices: [{ delta: {}, index: 0, finish_reason: 'stop' }] },
      ];

      async function* mockAsyncGenerator() {
        for (const chunk of mockChunks) {
          yield chunk;
        }
      }

      mockCreate.mockResolvedValueOnce(mockAsyncGenerator());

      const messages: CodeBuddyMessage[] = [{ role: 'user', content: 'Test' }];
      let finishReason: string | null = null;

      for await (const chunk of client.chatStream(messages)) {
        if (chunk.choices[0]?.finish_reason) {
          finishReason = chunk.choices[0].finish_reason;
        }
      }

      expect(finishReason).toBe('stop');
    });

    it('should handle tool_calls finish reason', async () => {
      const mockChunks: Partial<ChatCompletionChunk>[] = [
        {
          choices: [{
            delta: {
              tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'bash', arguments: '{}' } }],
            },
            index: 0,
            finish_reason: null,
          }],
        },
        { choices: [{ delta: {}, index: 0, finish_reason: 'tool_calls' }] },
      ];

      async function* mockAsyncGenerator() {
        for (const chunk of mockChunks) {
          yield chunk;
        }
      }

      mockCreate.mockResolvedValueOnce(mockAsyncGenerator());

      const messages: CodeBuddyMessage[] = [{ role: 'user', content: 'Test' }];
      let finishReason: string | null = null;

      for await (const chunk of client.chatStream(messages)) {
        if (chunk.choices[0]?.finish_reason) {
          finishReason = chunk.choices[0].finish_reason;
        }
      }

      expect(finishReason).toBe('tool_calls');
    });

    it('should handle length finish reason', async () => {
      const mockChunks: Partial<ChatCompletionChunk>[] = [
        { choices: [{ delta: { content: 'Truncated content' }, index: 0, finish_reason: null }] },
        { choices: [{ delta: {}, index: 0, finish_reason: 'length' }] },
      ];

      async function* mockAsyncGenerator() {
        for (const chunk of mockChunks) {
          yield chunk;
        }
      }

      mockCreate.mockResolvedValueOnce(mockAsyncGenerator());

      const messages: CodeBuddyMessage[] = [{ role: 'user', content: 'Generate long text' }];
      let finishReason: string | null = null;

      for await (const chunk of client.chatStream(messages)) {
        if (chunk.choices[0]?.finish_reason) {
          finishReason = chunk.choices[0].finish_reason;
        }
      }

      expect(finishReason).toBe('length');
    });
  });

  describe('Local Model Tool Message Conversion', () => {
    it('should convert tool messages for LM Studio', async () => {
      client = new CodeBuddyClient(mockApiKey, undefined, 'http://localhost:1234/v1');

      async function* mockAsyncGenerator() {
        yield { choices: [{ delta: { content: 'OK' }, index: 0, finish_reason: 'stop' }] };
      }
      mockCreate.mockResolvedValueOnce(mockAsyncGenerator());

      const messages: CodeBuddyMessage[] = [
        { role: 'user', content: 'Run command' },
        {
          role: 'assistant',
          content: 'I will run it',
          tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'bash', arguments: '{"command":"ls"}' } }],
        } as unknown as CodeBuddyMessage,
        { role: 'tool', tool_call_id: 'call_1', content: 'file1.txt\nfile2.txt' } as CodeBuddyMessage,
      ];

      for await (const _chunk of client.chatStream(messages)) {
        // Consume
      }

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'user',
              content: expect.stringContaining('[Tool Result]'),
            }),
          ]),
        })
      );
    });

    it('should not convert tool messages for non-local endpoints', async () => {
      async function* mockAsyncGenerator() {
        yield { choices: [{ delta: { content: 'OK' }, index: 0, finish_reason: 'stop' }] };
      }
      mockCreate.mockResolvedValueOnce(mockAsyncGenerator());

      const messages: CodeBuddyMessage[] = [
        { role: 'user', content: 'Test' },
        { role: 'tool', tool_call_id: 'call_1', content: 'Result' } as CodeBuddyMessage,
      ];

      for await (const _chunk of client.chatStream(messages)) {
        // Consume
      }

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'tool',
              content: 'Result',
            }),
          ]),
        })
      );
    });
  });

  describe('Stream Iterator Protocol', () => {
    it('should properly implement async iterator protocol', async () => {
      async function* mockAsyncGenerator() {
        yield { choices: [{ delta: { content: 'A' }, index: 0, finish_reason: null }] };
        yield { choices: [{ delta: { content: 'B' }, index: 0, finish_reason: null }] };
        yield { choices: [{ delta: {}, index: 0, finish_reason: 'stop' }] };
      }

      mockCreate.mockResolvedValueOnce(mockAsyncGenerator());

      const messages: CodeBuddyMessage[] = [{ role: 'user', content: 'Test' }];
      const stream = client.chatStream(messages);

      // Should be an async generator
      expect(typeof stream[Symbol.asyncIterator]).toBe('function');

      const result1 = await stream.next();
      expect(result1.done).toBe(false);
      expect(result1.value?.choices[0].delta.content).toBe('A');

      const result2 = await stream.next();
      expect(result2.done).toBe(false);
      expect(result2.value?.choices[0].delta.content).toBe('B');

      const result3 = await stream.next();
      expect(result3.done).toBe(false);
      expect(result3.value?.choices[0].finish_reason).toBe('stop');

      const result4 = await stream.next();
      expect(result4.done).toBe(true);
    });

    it('should support for-await-of loop', async () => {
      const mockChunks = [
        { choices: [{ delta: { content: '1' }, index: 0, finish_reason: null }] },
        { choices: [{ delta: { content: '2' }, index: 0, finish_reason: null }] },
        { choices: [{ delta: { content: '3' }, index: 0, finish_reason: null }] },
        { choices: [{ delta: {}, index: 0, finish_reason: 'stop' }] },
      ];

      async function* mockAsyncGenerator() {
        for (const chunk of mockChunks) {
          yield chunk;
        }
      }

      mockCreate.mockResolvedValueOnce(mockAsyncGenerator());

      const messages: CodeBuddyMessage[] = [{ role: 'user', content: 'Count' }];
      const contents: string[] = [];

      for await (const chunk of client.chatStream(messages)) {
        if (chunk.choices[0]?.delta?.content) {
          contents.push(chunk.choices[0].delta.content);
        }
      }

      expect(contents).toEqual(['1', '2', '3']);
    });
  });

  describe('Performance', () => {
    it('should handle rapid chunk delivery', async () => {
      const chunkCount = 1000;
      const mockChunks: unknown[] = [];

      for (let i = 0; i < chunkCount; i++) {
        mockChunks.push({
          choices: [{ delta: { content: 'x' }, index: 0, finish_reason: null }],
        });
      }
      mockChunks.push({ choices: [{ delta: {}, index: 0, finish_reason: 'stop' }] });

      async function* mockAsyncGenerator() {
        for (const chunk of mockChunks) {
          yield chunk;
        }
      }

      mockCreate.mockResolvedValueOnce(mockAsyncGenerator());

      const messages: CodeBuddyMessage[] = [{ role: 'user', content: 'Generate' }];
      let count = 0;

      const startTime = Date.now();
      for await (const _chunk of client.chatStream(messages)) {
        count++;
      }
      const duration = Date.now() - startTime;

      expect(count).toBe(chunkCount + 1);
      // Should process 1000 chunks quickly
      expect(duration).toBeLessThan(1000);
    });

    it('should not block on slow chunk processing', async () => {
      async function* mockAsyncGenerator() {
        yield { choices: [{ delta: { content: 'A' }, index: 0, finish_reason: null }] };
        yield { choices: [{ delta: { content: 'B' }, index: 0, finish_reason: null }] };
        yield { choices: [{ delta: {}, index: 0, finish_reason: 'stop' }] };
      }

      mockCreate.mockResolvedValueOnce(mockAsyncGenerator());

      const messages: CodeBuddyMessage[] = [{ role: 'user', content: 'Test' }];
      const contents: string[] = [];

      for await (const chunk of client.chatStream(messages)) {
        if (chunk.choices[0]?.delta?.content) {
          contents.push(chunk.choices[0].delta.content);
        }
        // Simulate slow processing
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      expect(contents).toEqual(['A', 'B']);
    });
  });
});
