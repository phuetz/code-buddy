/**
 * Unit tests for ClaudeProvider
 */

import { ClaudeProvider } from '../../src/providers/claude-provider';
import { CompletionOptions } from '../../src/providers/types';

// Mock Anthropic SDK
const mockCreate = jest.fn();
const mockStream = jest.fn();
const mockAnthropic = jest.fn().mockImplementation(() => ({
  messages: {
    create: mockCreate,
    stream: mockStream,
  },
}));

jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: mockAnthropic,
}), { virtual: true });

describe('ClaudeProvider', () => {
  let provider: ClaudeProvider;
  const config = { apiKey: 'test-key' };

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new ClaudeProvider();
  });

  describe('initialize()', () => {
    it('should initialize successfully', async () => {
      await provider.initialize(config);
      expect(provider.isReady()).toBe(true);
      expect(mockAnthropic).toHaveBeenCalledWith(expect.objectContaining({
        apiKey: 'test-key',
      }));
    });
  });

  describe('complete()', () => {
    it('should send completion request and return normalized response', async () => {
      await provider.initialize(config);
      
      mockCreate.mockResolvedValue({
        id: 'msg-123',
        content: [{ type: 'text', text: 'Hello from Claude' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 20 },
        model: 'claude-3-sonnet',
      });

      const options: CompletionOptions = {
        messages: [{ role: 'user', content: 'hi' }],
      };

      const result = await provider.complete(options);

      expect(result.content).toBe('Hello from Claude');
      expect(result.usage.totalTokens).toBe(30);
      expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
        model: provider.defaultModel,
      }));
    });

    it('should handle tool calls in response', async () => {
      await provider.initialize(config);
      
      mockCreate.mockResolvedValue({
        id: 'msg-456',
        content: [
          { type: 'text', text: 'I will help you with that.' },
          { type: 'tool_use', id: 'tool-1', name: 'calculate', input: { a: 1, b: 2 } }
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 15, output_tokens: 25 },
        model: 'claude-3-sonnet',
      });

      const result = await provider.complete({ messages: [] });

      expect(result.content).toBe('I will help you with that.');
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].function.name).toBe('calculate');
      expect(result.toolCalls[0].function.arguments).toBe('{"a":1,"b":2}');
    });
  });

  describe('stream()', () => {
    it('should yield content chunks', async () => {
      await provider.initialize(config);
      
      const mockStreamIter = (async function* () {
        yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'He' } };
        yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'llo' } };
        yield { type: 'message_stop' };
      })();

      mockStream.mockReturnValue(mockStreamIter);

      const chunks = [];
      for await (const chunk of provider.stream({ messages: [] })) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(3);
      expect(chunks[0]).toEqual({ type: 'content', content: 'He' });
      expect(chunks[1]).toEqual({ type: 'content', content: 'llo' });
      expect(chunks[2]).toEqual({ type: 'done' });
    });

    it('should handle tool call JSON deltas', async () => {
      await provider.initialize(config);
      
      const mockStreamIter = (async function* () {
        yield { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"a":' } };
        yield { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '1}' } };
        yield { type: 'message_stop' };
      })();

      mockStream.mockReturnValue(mockStreamIter);

      const chunks = [];
      for await (const chunk of provider.stream({ messages: [] })) {
        chunks.push(chunk);
      }

      const toolCallChunks = chunks.filter(c => c.type === 'tool_call');
      expect(toolCallChunks).toHaveLength(2);
      expect((toolCallChunks[0] as any).toolCall.function.arguments).toBe('{"a":');
    });
  });

  describe('supports()', () => {
    it('should support vision and json_mode', () => {
      expect(provider.supports('vision')).toBe(true);
      expect(provider.supports('json_mode')).toBe(true);
    });
  });
});
