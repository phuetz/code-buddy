
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CodeBuddyClient } from '../../src/codebuddy/client';

vi.mock('openai', () => ({
  __esModule: true,
  default: vi.fn().mockImplementation(function() { return {
    chat: { completions: { create: vi.fn() } },
  }; }),
}));

vi.mock('../../src/utils/model-utils', () => ({
  validateModel: vi.fn(),
  getModelInfo: vi.fn().mockReturnValue({
    maxTokens: 8192,
    provider: 'google',
    isSupported: true,
  }),
}));

vi.mock('../../src/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('CodeBuddyClient Gemini malformed recovery', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('retries once and returns tool call when first response is MALFORMED_FUNCTION_CALL', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [{ finishReason: 'MALFORMED_FUNCTION_CALL' }],
          usageMetadata: { totalTokenCount: 10 },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [{
            finishReason: 'STOP',
            content: {
              parts: [{
                functionCall: {
                  name: 'create_file',
                  args: { path: 'a.txt', content: 'ok' },
                },
              }],
            },
          }],
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 5,
            totalTokenCount: 15,
          },
        }),
      });

    global.fetch = fetchMock as unknown as typeof fetch;

    const client = new CodeBuddyClient(
      'test-gemini-key',
      'gemini-2.5-flash',
      'https://generativelanguage.googleapis.com/v1beta',
    );

    const response = await client.chat(
      [{ role: 'user', content: 'create a file' }],
      [{
        type: 'function',
        function: {
          name: 'create_file',
          description: 'create',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              content: { type: 'string' },
            },
            required: ['path', 'content'],
          },
        },
      }],
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(response.choices[0].message.tool_calls?.[0].function.name).toBe('create_file');
  });

  it('falls back to gemini default model when an incompatible model is provided with Gemini base URL', () => {
    const client = new CodeBuddyClient(
      'test-gemini-key',
      'grok-3-latest',
      'https://generativelanguage.googleapis.com/v1beta',
    );
    expect(client.getCurrentModel()).toBe('gemini-2.5-flash');
  });

  it('retries with fallback Gemini model on model-not-found 404', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () =>
          '{"error":{"code":404,"message":"models/grok-3-latest is not found for API version v1beta"}}',
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [{
            finishReason: 'STOP',
            content: { parts: [{ text: 'ok' }] },
          }],
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
        }),
      });
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = new CodeBuddyClient(
      'test-gemini-key',
      'gemini-2.5-flash',
      'https://generativelanguage.googleapis.com/v1beta',
    );
    const response = await client.chat(
      [{ role: 'user', content: 'ping' }],
      [],
      { model: 'grok-3-latest' },
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(response.choices[0].message.content).toBe('ok');
  });
});
