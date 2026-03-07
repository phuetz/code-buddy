
// Mock logger before importing the client

import type { ChatCompletionChunk } from 'openai/resources/chat';
import { CodeBuddyClient } from '../../src/codebuddy/client.js';
import type { CodeBuddyTool, CodeBuddyMessage } from '../../src/codebuddy/client.js';

jest.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock model-utils to avoid validation issues
jest.mock('../../src/utils/model-utils.js', () => ({
  validateModel: jest.fn(),
  getModelInfo: jest.fn(function() { return { isSupported: true, provider: 'google' }; }),
}));

// Mock retry to just execute the function directly
jest.mock('../../src/utils/retry.js', () => ({
  retry: jest.fn((fn: () => Promise<unknown>) => fn()),
  RetryStrategies: {},
  RetryPredicates: {},
}));


// ---------- helpers ----------

function createSSEStream(chunks: object[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`));
      }
      controller.close();
    },
  });
}

function createSSERawStream(lines: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(new TextEncoder().encode(line));
      }
      controller.close();
    },
  });
}

function mockFetchResponse(body: ReadableStream<Uint8Array>, ok = true, status = 200): Response {
  return {
    ok,
    status,
    body,
    headers: new Headers(),
    json: jest.fn(),
    text: jest.fn(),
  } as unknown as Response;
}

async function collectChunks(gen: AsyncGenerator<ChatCompletionChunk>): Promise<ChatCompletionChunk[]> {
  const results: ChatCompletionChunk[] = [];
  for await (const chunk of gen) {
    results.push(chunk);
  }
  return results;
}

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const TEST_API_KEY = 'test-gemini-key';
const TEST_MODEL = 'gemini-2.0-flash';

function createClient(): CodeBuddyClient {
  return new CodeBuddyClient(TEST_API_KEY, TEST_MODEL, GEMINI_BASE_URL);
}

const sampleTool: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'read_file',
    description: 'Read a file from disk',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path' },
      },
      required: ['path'],
    },
  },
};

// ---------- tests ----------

describe('Gemini SSE Streaming', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  // ---- buildGeminiBody ----
  describe('buildGeminiBody', () => {
    it('should convert user and assistant messages to Gemini contents format', () => {
      const client = createClient();
      const messages: CodeBuddyMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
      ];

      // Access private method via casting
      const body = (client as unknown as Record<string, Function>).buildGeminiBody(messages);

      expect(body.contents).toBeDefined();
      expect(Array.isArray(body.contents)).toBe(true);
      const contents = body.contents as Array<{ role: string; parts: unknown[] }>;
      expect(contents).toHaveLength(2);
      expect(contents[0].role).toBe('user');
      expect(contents[0].parts).toEqual([{ text: 'Hello' }]);
      expect(contents[1].role).toBe('model');
      expect(contents[1].parts).toEqual([{ text: 'Hi there' }]);
    });

    it('should extract system message into systemInstruction', () => {
      const client = createClient();
      const messages: CodeBuddyMessage[] = [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hello' },
      ];

      const body = (client as unknown as Record<string, Function>).buildGeminiBody(messages);

      expect(body.systemInstruction).toEqual({
        parts: [{ text: 'You are helpful.' }],
      });
    });

    it('should include generationConfig with temperature and maxOutputTokens', () => {
      const client = createClient();
      const messages: CodeBuddyMessage[] = [
        { role: 'user', content: 'Hello' },
      ];

      const body = (client as unknown as Record<string, Function>).buildGeminiBody(
        messages, undefined, { temperature: 0.5 }
      );

      expect(body.generationConfig).toBeDefined();
      const config = body.generationConfig as Record<string, unknown>;
      expect(config.temperature).toBe(0.5);
      expect(config.maxOutputTokens).toBeDefined();
    });

    it('should convert tools to Gemini functionDeclarations format', () => {
      const client = createClient();
      const messages: CodeBuddyMessage[] = [
        { role: 'user', content: 'Read test.txt' },
      ];

      const body = (client as unknown as Record<string, Function>).buildGeminiBody(
        messages, [sampleTool]
      );

      expect(body.tools).toBeDefined();
      const tools = body.tools as Array<{ functionDeclarations: unknown[] }>;
      expect(tools).toHaveLength(1);
      expect(tools[0].functionDeclarations).toHaveLength(1);
      const decl = tools[0].functionDeclarations[0] as Record<string, unknown>;
      expect(decl.name).toBe('read_file');
      expect(decl.description).toBe('Read a file from disk');
      expect(body.toolConfig).toEqual({ functionCallingConfig: { mode: 'AUTO' } });
    });

    it('should convert assistant messages with tool_calls to model with functionCall parts', () => {
      const client = createClient();
      const messages: CodeBuddyMessage[] = [
        { role: 'user', content: 'Read file' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: 'call_1',
            type: 'function' as const,
            function: { name: 'read_file', arguments: '{"path":"test.txt"}' },
          }],
        },
        { role: 'tool', tool_call_id: 'call_1', content: 'file contents here' },
      ];

      const body = (client as unknown as Record<string, Function>).buildGeminiBody(messages);

      const contents = body.contents as Array<{ role: string; parts: unknown[] }>;
      // user, model (with functionCall), function (response)
      expect(contents.length).toBeGreaterThanOrEqual(3);

      // Find model turn with functionCall
      const modelTurn = contents.find(c => c.role === 'model');
      expect(modelTurn).toBeDefined();
      const fcPart = modelTurn!.parts.find((p: unknown) => typeof p === 'object' && p !== null && 'functionCall' in p) as Record<string, unknown> | undefined;
      expect(fcPart).toBeDefined();
      expect((fcPart!.functionCall as Record<string, unknown>).name).toBe('read_file');

      // Find function response turn
      const funcTurn = contents.find(c => c.role === 'function');
      expect(funcTurn).toBeDefined();
    });

    it('should ensure conversation starts with user role', () => {
      const client = createClient();
      const messages: CodeBuddyMessage[] = [
        { role: 'assistant', content: 'I started talking' },
        { role: 'user', content: 'Ok' },
      ];

      const body = (client as unknown as Record<string, Function>).buildGeminiBody(messages);

      const contents = body.contents as Array<{ role: string; parts: unknown[] }>;
      expect(contents[0].role).toBe('user');
    });

    it('should not include tools or toolConfig when no tools provided', () => {
      const client = createClient();
      const messages: CodeBuddyMessage[] = [
        { role: 'user', content: 'Hello' },
      ];

      const body = (client as unknown as Record<string, Function>).buildGeminiBody(messages);

      expect(body.tools).toBeUndefined();
      expect(body.toolConfig).toBeUndefined();
    });
  });

  // ---- parseGeminiSSE ----
  describe('parseGeminiSSE', () => {
    it('should parse a single SSE data line and yield the parsed object', async () => {
      const client = createClient();
      const payload = { candidates: [{ content: { parts: [{ text: 'hello' }] } }] };
      const stream = createSSEStream([payload]);
      const reader = stream.getReader();

      const parse = (client as unknown as Record<string, Function>).parseGeminiSSE(reader);
      const results: unknown[] = [];
      for await (const item of parse) {
        results.push(item);
      }

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual(payload);
    });

    it('should parse multiple SSE data lines and yield multiple objects', async () => {
      const client = createClient();
      const payloads = [
        { candidates: [{ content: { parts: [{ text: 'chunk1' }] } }] },
        { candidates: [{ content: { parts: [{ text: 'chunk2' }] } }] },
        { candidates: [{ content: { parts: [{ text: 'chunk3' }] } }] },
      ];
      const stream = createSSEStream(payloads);
      const reader = stream.getReader();

      const results: unknown[] = [];
      for await (const item of (client as unknown as Record<string, Function>).parseGeminiSSE(reader)) {
        results.push(item);
      }

      expect(results).toHaveLength(3);
      expect(results[0]).toEqual(payloads[0]);
      expect(results[1]).toEqual(payloads[1]);
      expect(results[2]).toEqual(payloads[2]);
    });

    it('should stop when encountering [DONE] data line', async () => {
      const client = createClient();
      const stream = createSSERawStream([
        `data: ${JSON.stringify({ text: 'first' })}\n\n`,
        `data: [DONE]\n\n`,
        `data: ${JSON.stringify({ text: 'should not appear' })}\n\n`,
      ]);
      const reader = stream.getReader();

      const results: unknown[] = [];
      for await (const item of (client as unknown as Record<string, Function>).parseGeminiSSE(reader)) {
        results.push(item);
      }

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({ text: 'first' });
    });

    it('should skip lines with invalid JSON', async () => {
      const client = createClient();
      const stream = createSSERawStream([
        `data: ${JSON.stringify({ valid: true })}\n\n`,
        `data: {invalid json\n\n`,
        `data: ${JSON.stringify({ also_valid: true })}\n\n`,
      ]);
      const reader = stream.getReader();

      const results: unknown[] = [];
      for await (const item of (client as unknown as Record<string, Function>).parseGeminiSSE(reader)) {
        results.push(item);
      }

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({ valid: true });
      expect(results[1]).toEqual({ also_valid: true });
    });

    it('should handle data split across multiple read chunks', async () => {
      const client = createClient();
      const encoder = new TextEncoder();
      // Split a single SSE message across two reads
      const fullLine = `data: ${JSON.stringify({ split: true })}\n\n`;
      const mid = Math.floor(fullLine.length / 2);
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(fullLine.slice(0, mid)));
          controller.enqueue(encoder.encode(fullLine.slice(mid)));
          controller.close();
        },
      });
      const reader = stream.getReader();

      const results: unknown[] = [];
      for await (const item of (client as unknown as Record<string, Function>).parseGeminiSSE(reader)) {
        results.push(item);
      }

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({ split: true });
    });

    it('should ignore non-data lines', async () => {
      const client = createClient();
      const stream = createSSERawStream([
        `: comment line\n`,
        `event: message\n`,
        `data: ${JSON.stringify({ real: true })}\n\n`,
      ]);
      const reader = stream.getReader();

      const results: unknown[] = [];
      for await (const item of (client as unknown as Record<string, Function>).parseGeminiSSE(reader)) {
        results.push(item);
      }

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({ real: true });
    });
  });

  // ---- geminiChatStream ----
  describe('geminiChatStream', () => {
    it('should yield ChatCompletionChunk objects with delta content on successful stream', async () => {
      const client = createClient();
      const ssePayloads = [
        { candidates: [{ content: { parts: [{ text: 'Hello' }] } }] },
        { candidates: [{ content: { parts: [{ text: ' world' }] } }] },
      ];

      global.fetch = jest.fn().mockResolvedValue(
        mockFetchResponse(createSSEStream(ssePayloads))
      );

      const chunks = await collectChunks(client.chatStream(
        [{ role: 'user', content: 'Hi' }]
      ));

      // Should have content chunks + final stop chunk
      expect(chunks.length).toBeGreaterThanOrEqual(3);

      // First chunk should have text content
      expect(chunks[0].object).toBe('chat.completion.chunk');
      expect(chunks[0].choices[0].delta.role).toBe('assistant');
      expect(chunks[0].choices[0].delta.content).toBe('Hello');

      // Second chunk
      expect(chunks[1].choices[0].delta.content).toBe(' world');

      // Last chunk should be the stop sentinel
      const lastChunk = chunks[chunks.length - 1];
      expect(lastChunk.choices[0].finish_reason).toBe('stop');
      expect(lastChunk.choices[0].delta).toEqual({});
    });

    it('should map Gemini finish reason STOP to stop (via final chunk)', async () => {
      const client = createClient();
      const ssePayloads = [
        { candidates: [{ content: { parts: [{ text: 'done' }] }, finishReason: 'STOP' }] },
      ];

      global.fetch = jest.fn().mockResolvedValue(
        mockFetchResponse(createSSEStream(ssePayloads))
      );

      const chunks = await collectChunks(client.chatStream(
        [{ role: 'user', content: 'Hi' }]
      ));

      // STOP is handled by the final stop chunk (not emitted as separate mapped chunk)
      // because the code only emits mapped finish reasons for non-STOP values
      const lastChunk = chunks[chunks.length - 1];
      expect(lastChunk.choices[0].finish_reason).toBe('stop');
    });

    it('should map Gemini finish reason MAX_TOKENS to length', async () => {
      const client = createClient();
      const ssePayloads = [
        { candidates: [{ content: { parts: [{ text: 'truncated' }] }, finishReason: 'MAX_TOKENS' }] },
      ];

      global.fetch = jest.fn().mockResolvedValue(
        mockFetchResponse(createSSEStream(ssePayloads))
      );

      const chunks = await collectChunks(client.chatStream(
        [{ role: 'user', content: 'Hi' }]
      ));

      // Should have a chunk with finish_reason 'length' before the final stop
      const lengthChunk = chunks.find(c => c.choices[0].finish_reason === 'length');
      expect(lengthChunk).toBeDefined();
    });

    it('should map Gemini finish reason SAFETY to content_filter', async () => {
      const client = createClient();
      const ssePayloads = [
        { candidates: [{ content: { parts: [{ text: '' }] }, finishReason: 'SAFETY' }] },
      ];

      global.fetch = jest.fn().mockResolvedValue(
        mockFetchResponse(createSSEStream(ssePayloads))
      );

      const chunks = await collectChunks(client.chatStream(
        [{ role: 'user', content: 'Hi' }]
      ));

      const filterChunk = chunks.find(c => c.choices[0].finish_reason === 'content_filter');
      expect(filterChunk).toBeDefined();
    });

    it('should map Gemini finish reason RECITATION to content_filter', async () => {
      const client = createClient();
      const ssePayloads = [
        { candidates: [{ content: { parts: [{ text: 'quote' }] }, finishReason: 'RECITATION' }] },
      ];

      global.fetch = jest.fn().mockResolvedValue(
        mockFetchResponse(createSSEStream(ssePayloads))
      );

      const chunks = await collectChunks(client.chatStream(
        [{ role: 'user', content: 'Hi' }]
      ));

      const filterChunk = chunks.find(c => c.choices[0].finish_reason === 'content_filter');
      expect(filterChunk).toBeDefined();
    });

    it('should yield tool call chunks for functionCall parts', async () => {
      const client = createClient();
      const ssePayloads = [
        {
          candidates: [{
            content: {
              parts: [{
                functionCall: { name: 'read_file', args: { path: '/test.txt' } },
              }],
            },
          }],
        },
      ];

      global.fetch = jest.fn().mockResolvedValue(
        mockFetchResponse(createSSEStream(ssePayloads))
      );

      const chunks = await collectChunks(client.chatStream(
        [{ role: 'user', content: 'Read test.txt' }],
        [sampleTool]
      ));

      // Find the tool call chunk
      const toolChunk = chunks.find(c =>
        c.choices[0].delta.tool_calls && c.choices[0].delta.tool_calls.length > 0
      );
      expect(toolChunk).toBeDefined();
      const tc = toolChunk!.choices[0].delta.tool_calls![0];
      expect(tc.function!.name).toBe('read_file');
      expect(JSON.parse(tc.function!.arguments!)).toEqual({ path: '/test.txt' });
    });

    it('should fall back to non-streaming when fetch returns non-ok status', async () => {
      const client = createClient();

      // First call: streaming attempt fails with 500
      // Second call: fallback non-streaming geminiChat succeeds
      global.fetch = jest.fn()
        .mockResolvedValueOnce(
          mockFetchResponse(createSSEStream([]), false, 500)
        )
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({
            candidates: [{
              content: { parts: [{ text: 'fallback response' }] },
              finishReason: 'STOP',
            }],
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
          }),
        } as unknown as Response);

      const chunks = await collectChunks(client.chatStream(
        [{ role: 'user', content: 'Hi' }]
      ));

      expect(chunks.length).toBeGreaterThan(0);
      // Should get fallback content
      const contentChunk = chunks.find(c => c.choices[0].delta.content);
      expect(contentChunk).toBeDefined();
      expect(contentChunk!.choices[0].delta.content).toBe('fallback response');
    });

    it('should fall back to non-streaming when response body is null', async () => {
      const client = createClient();

      // Streaming response with null body
      global.fetch = jest.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          body: null,
          headers: new Headers(),
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({
            candidates: [{
              content: { parts: [{ text: 'null body fallback' }] },
              finishReason: 'STOP',
            }],
            usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3, totalTokenCount: 8 },
          }),
        } as unknown as Response);

      const chunks = await collectChunks(client.chatStream(
        [{ role: 'user', content: 'Hi' }]
      ));

      expect(chunks.length).toBeGreaterThan(0);
      const contentChunk = chunks.find(c => c.choices[0].delta.content);
      expect(contentChunk).toBeDefined();
      expect(contentChunk!.choices[0].delta.content).toBe('null body fallback');
    });

    it('should fall back to non-streaming on stream read error', async () => {
      const client = createClient();

      // Create a stream that errors
      const errorStream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(new Error('stream read error'));
        },
      });

      global.fetch = jest.fn()
        .mockResolvedValueOnce(
          mockFetchResponse(errorStream)
        )
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({
            candidates: [{
              content: { parts: [{ text: 'error fallback' }] },
              finishReason: 'STOP',
            }],
            usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3, totalTokenCount: 8 },
          }),
        } as unknown as Response);

      const chunks = await collectChunks(client.chatStream(
        [{ role: 'user', content: 'Hi' }]
      ));

      expect(chunks.length).toBeGreaterThan(0);
      const contentChunk = chunks.find(c => c.choices[0].delta.content);
      expect(contentChunk).toBeDefined();
      expect(contentChunk!.choices[0].delta.content).toBe('error fallback');
    });

    it('should skip SSE chunks with no candidates', async () => {
      const client = createClient();
      const ssePayloads = [
        { candidates: [] },
        { noCandidate: true },
        { candidates: [{ content: { parts: [{ text: 'real content' }] } }] },
      ];

      global.fetch = jest.fn().mockResolvedValue(
        mockFetchResponse(createSSEStream(ssePayloads))
      );

      const chunks = await collectChunks(client.chatStream(
        [{ role: 'user', content: 'Hi' }]
      ));

      // Only the real content chunk + final stop
      const contentChunks = chunks.filter(c => c.choices[0].delta.content);
      expect(contentChunks).toHaveLength(1);
      expect(contentChunks[0].choices[0].delta.content).toBe('real content');
    });

    it('should skip SSE chunks with no parts in content', async () => {
      const client = createClient();
      const ssePayloads = [
        { candidates: [{ content: {} }] },
        { candidates: [{ content: { parts: [{ text: 'has parts' }] } }] },
      ];

      global.fetch = jest.fn().mockResolvedValue(
        mockFetchResponse(createSSEStream(ssePayloads))
      );

      const chunks = await collectChunks(client.chatStream(
        [{ role: 'user', content: 'Hi' }]
      ));

      const contentChunks = chunks.filter(c => c.choices[0].delta.content);
      expect(contentChunks).toHaveLength(1);
      expect(contentChunks[0].choices[0].delta.content).toBe('has parts');
    });

    it('should include model name in chunk metadata', async () => {
      const client = createClient();
      const ssePayloads = [
        { candidates: [{ content: { parts: [{ text: 'test' }] } }] },
      ];

      global.fetch = jest.fn().mockResolvedValue(
        mockFetchResponse(createSSEStream(ssePayloads))
      );

      const chunks = await collectChunks(client.chatStream(
        [{ role: 'user', content: 'Hi' }]
      ));

      expect(chunks[0].model).toBe(TEST_MODEL);
    });

    it('should send request to correct streaming URL with alt=sse', async () => {
      const client = createClient();
      const ssePayloads = [
        { candidates: [{ content: { parts: [{ text: 'ok' }] } }] },
      ];

      global.fetch = jest.fn().mockResolvedValue(
        mockFetchResponse(createSSEStream(ssePayloads))
      );

      await collectChunks(client.chatStream(
        [{ role: 'user', content: 'Hi' }]
      ));

      expect(global.fetch).toHaveBeenCalled();
      const callUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string;
      expect(callUrl).toContain(':streamGenerateContent');
      expect(callUrl).toContain('alt=sse');
      expect(callUrl).toContain(TEST_MODEL);
    });

    it('should send API key in x-goog-api-key header', async () => {
      const client = createClient();
      const ssePayloads = [
        { candidates: [{ content: { parts: [{ text: 'ok' }] } }] },
      ];

      global.fetch = jest.fn().mockResolvedValue(
        mockFetchResponse(createSSEStream(ssePayloads))
      );

      await collectChunks(client.chatStream(
        [{ role: 'user', content: 'Hi' }]
      ));

      const callOptions = (global.fetch as jest.Mock).mock.calls[0][1] as RequestInit;
      expect((callOptions.headers as Record<string, string>)['x-goog-api-key']).toBe(TEST_API_KEY);
    });

    it('should handle mixed text and functionCall parts in a single candidate', async () => {
      const client = createClient();
      const ssePayloads = [
        {
          candidates: [{
            content: {
              parts: [
                { text: 'Let me read that file.' },
                { functionCall: { name: 'read_file', args: { path: '/foo.txt' } } },
              ],
            },
          }],
        },
      ];

      global.fetch = jest.fn().mockResolvedValue(
        mockFetchResponse(createSSEStream(ssePayloads))
      );

      const chunks = await collectChunks(client.chatStream(
        [{ role: 'user', content: 'Read foo.txt' }],
        [sampleTool]
      ));

      const contentChunks = chunks.filter(c => c.choices[0].delta.content);
      const toolChunks = chunks.filter(c =>
        c.choices[0].delta.tool_calls && c.choices[0].delta.tool_calls.length > 0
      );

      expect(contentChunks).toHaveLength(1);
      expect(contentChunks[0].choices[0].delta.content).toBe('Let me read that file.');
      expect(toolChunks).toHaveLength(1);
      expect(toolChunks[0].choices[0].delta.tool_calls![0].function!.name).toBe('read_file');
    });

    it('should always emit a final stop chunk after successful stream', async () => {
      const client = createClient();
      const ssePayloads = [
        { candidates: [{ content: { parts: [{ text: 'hello' }] } }] },
      ];

      global.fetch = jest.fn().mockResolvedValue(
        mockFetchResponse(createSSEStream(ssePayloads))
      );

      const chunks = await collectChunks(client.chatStream(
        [{ role: 'user', content: 'Hi' }]
      ));

      const lastChunk = chunks[chunks.length - 1];
      expect(lastChunk.choices[0].finish_reason).toBe('stop');
      expect(lastChunk.choices[0].delta).toEqual({});
    });
  });
});
