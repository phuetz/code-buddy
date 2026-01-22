/**
 * Unit Tests for ChunkProcessor
 *
 * Tests covering:
 * - Delta processing for content and tool calls
 * - Accumulation of streaming content
 * - Tool call assembly from deltas
 * - Commentary-style tool extraction
 * - Reset functionality
 */

import { ChunkProcessor } from '../../src/streaming/chunk-processor';

// Mock dependencies
jest.mock('../../src/utils/sanitize', () => ({
  sanitizeLLMOutput: jest.fn((content: string) => content),
  extractCommentaryToolCalls: jest.fn(() => ({ toolCalls: [], content: '' })),
}));

import { sanitizeLLMOutput, extractCommentaryToolCalls } from '../../src/utils/sanitize';

const mockSanitize = sanitizeLLMOutput as jest.Mock;
const mockExtractCommentary = extractCommentaryToolCalls as jest.Mock;

describe('ChunkProcessor', () => {
  let processor: ChunkProcessor;

  beforeEach(() => {
    processor = new ChunkProcessor();
    jest.clearAllMocks();
    mockSanitize.mockImplementation((content: string) => content);
    mockExtractCommentary.mockReturnValue({ toolCalls: [], content: '' });
  });

  describe('Constructor', () => {
    it('should create with default options', () => {
      const p = new ChunkProcessor();
      expect(p).toBeDefined();
      expect(p.getAccumulatedContent()).toBe('');
      expect(p.getRawContent()).toBe('');
      expect(p.getToolCalls()).toEqual([]);
    });

    it('should accept custom options', () => {
      const p = new ChunkProcessor({
        sanitize: false,
        extractCommentaryTools: false,
      });
      expect(p).toBeDefined();
    });

    it('should default sanitize to true', () => {
      const p = new ChunkProcessor({});
      // Process content to verify sanitize is called
      p.processDelta({
        choices: [{ delta: { content: 'test' } }],
      });
      expect(mockSanitize).toHaveBeenCalled();
    });
  });

  describe('processDelta - Content', () => {
    it('should process content delta and return content event', () => {
      const events = processor.processDelta({
        choices: [{ delta: { content: 'Hello' } }],
      });

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: 'content',
        content: 'Hello',
      });
    });

    it('should accumulate content across multiple deltas', () => {
      processor.processDelta({
        choices: [{ delta: { content: 'Hello' } }],
      });
      processor.processDelta({
        choices: [{ delta: { content: ' ' } }],
      });
      processor.processDelta({
        choices: [{ delta: { content: 'World' } }],
      });

      expect(processor.getAccumulatedContent()).toBe('Hello World');
    });

    it('should sanitize content when sanitize option is true', () => {
      mockSanitize.mockReturnValue('sanitized');

      const events = processor.processDelta({
        choices: [{ delta: { content: 'raw content' } }],
      });

      expect(mockSanitize).toHaveBeenCalledWith('raw content');
      expect(events[0].content).toBe('sanitized');
    });

    it('should not sanitize content when sanitize option is false', () => {
      const p = new ChunkProcessor({ sanitize: false });

      p.processDelta({
        choices: [{ delta: { content: 'raw content' } }],
      });

      expect(mockSanitize).not.toHaveBeenCalled();
    });

    it('should track raw content separately', () => {
      mockSanitize.mockImplementation((content: string) =>
        content.replace('bad', 'good')
      );

      processor.processDelta({
        choices: [{ delta: { content: 'bad content' } }],
      });

      expect(processor.getRawContent()).toBe('bad content');
      expect(processor.getAccumulatedContent()).toBe('good content');
    });

    it('should not emit event if sanitized content is empty', () => {
      mockSanitize.mockReturnValue('');

      const events = processor.processDelta({
        choices: [{ delta: { content: 'content' } }],
      });

      expect(events).toHaveLength(0);
    });

    it('should handle null content in delta', () => {
      const events = processor.processDelta({
        choices: [{ delta: { content: null } }],
      });

      expect(events).toHaveLength(0);
      expect(processor.getAccumulatedContent()).toBe('');
    });
  });

  describe('processDelta - Tool Calls', () => {
    it('should process tool call delta with id and name', () => {
      const events = processor.processDelta({
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              id: 'call_123',
              function: {
                name: 'bash',
                arguments: '',
              },
            }],
          },
        }],
      });

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('tool_call');
      expect(events[0].toolCall).toMatchObject({
        id: 'call_123',
        function: {
          name: 'bash',
        },
      });
    });

    it('should accumulate tool call arguments across deltas', () => {
      processor.processDelta({
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              id: 'call_123',
              function: {
                name: 'bash',
                arguments: '{"comma',
              },
            }],
          },
        }],
      });

      processor.processDelta({
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              function: {
                arguments: 'nd": "ls',
              },
            }],
          },
        }],
      });

      processor.processDelta({
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              function: {
                arguments: '"}',
              },
            }],
          },
        }],
      });

      const toolCalls = processor.getToolCalls();
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].function.arguments).toBe('{"command": "ls"}');
    });

    it('should handle multiple concurrent tool calls', () => {
      processor.processDelta({
        choices: [{
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call_1',
                function: { name: 'bash', arguments: '{}' },
              },
              {
                index: 1,
                id: 'call_2',
                function: { name: 'read', arguments: '{}' },
              },
            ],
          },
        }],
      });

      const toolCalls = processor.getToolCalls();
      expect(toolCalls).toHaveLength(2);
      expect(toolCalls[0].id).toBe('call_1');
      expect(toolCalls[1].id).toBe('call_2');
    });

    it('should accumulate name across deltas', () => {
      processor.processDelta({
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              id: 'call_123',
              function: { name: 'ba' },
            }],
          },
        }],
      });

      processor.processDelta({
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              function: { name: 'sh' },
            }],
          },
        }],
      });

      const toolCalls = processor.getToolCalls();
      expect(toolCalls[0].function.name).toBe('bash');
    });

    it('should not emit tool_call event if no name yet', () => {
      const events = processor.processDelta({
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              id: 'call_123',
              function: { arguments: '{}' },
            }],
          },
        }],
      });

      // Should not emit because name is empty
      expect(events.filter(e => e.type === 'tool_call')).toHaveLength(0);
    });
  });

  describe('processDelta - Edge Cases', () => {
    it('should return empty array for empty chunk', () => {
      const events = processor.processDelta({});
      expect(events).toEqual([]);
    });

    it('should return empty array for empty choices', () => {
      const events = processor.processDelta({ choices: [] });
      expect(events).toEqual([]);
    });

    it('should return empty array for undefined delta', () => {
      const events = processor.processDelta({
        choices: [{}],
      });
      expect(events).toEqual([]);
    });

    it('should handle both content and tool calls in same delta', () => {
      const events = processor.processDelta({
        choices: [{
          delta: {
            content: 'Text content',
            tool_calls: [{
              index: 0,
              id: 'call_123',
              function: { name: 'bash', arguments: '{}' },
            }],
          },
        }],
      });

      expect(events).toHaveLength(2);
      expect(events.find(e => e.type === 'content')).toBeDefined();
      expect(events.find(e => e.type === 'tool_call')).toBeDefined();
    });
  });

  describe('getToolCalls - Commentary Extraction', () => {
    it('should extract commentary-style tool calls when no native calls', () => {
      mockExtractCommentary.mockReturnValue({
        toolCalls: [
          { name: 'bash', arguments: { command: 'ls' } },
        ],
        content: 'Some text',
      });

      // Add raw content
      processor.processDelta({
        choices: [{ delta: { content: 'Some commentary with tool call' } }],
      });

      const toolCalls = processor.getToolCalls();

      expect(mockExtractCommentary).toHaveBeenCalled();
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].function.name).toBe('bash');
      expect(toolCalls[0].function.arguments).toBe('{"command":"ls"}');
      expect(toolCalls[0].id).toMatch(/^commentary_/);
    });

    it('should not extract commentary when native tool calls exist', () => {
      // Add native tool call
      processor.processDelta({
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              id: 'call_native',
              function: { name: 'bash', arguments: '{}' },
            }],
          },
        }],
      });

      const toolCalls = processor.getToolCalls();

      expect(mockExtractCommentary).not.toHaveBeenCalled();
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].id).toBe('call_native');
    });

    it('should not extract commentary when option is disabled', () => {
      const p = new ChunkProcessor({ extractCommentaryTools: false });

      mockExtractCommentary.mockReturnValue({
        toolCalls: [{ name: 'bash', arguments: {} }],
        content: '',
      });

      p.processDelta({
        choices: [{ delta: { content: 'commentary' } }],
      });

      const toolCalls = p.getToolCalls();

      expect(mockExtractCommentary).not.toHaveBeenCalled();
      expect(toolCalls).toHaveLength(0);
    });

    it('should not extract commentary when raw content is empty', () => {
      const toolCalls = processor.getToolCalls();

      expect(mockExtractCommentary).not.toHaveBeenCalled();
      expect(toolCalls).toHaveLength(0);
    });

    it('should generate unique IDs for multiple commentary tools', () => {
      mockExtractCommentary.mockReturnValue({
        toolCalls: [
          { name: 'bash', arguments: { command: 'ls' } },
          { name: 'read', arguments: { path: '/tmp/file' } },
        ],
        content: '',
      });

      processor.processDelta({
        choices: [{ delta: { content: 'multiple tools' } }],
      });

      const toolCalls = processor.getToolCalls();

      expect(toolCalls).toHaveLength(2);
      expect(toolCalls[0].id).not.toBe(toolCalls[1].id);
    });
  });

  describe('reset', () => {
    it('should clear accumulated content', () => {
      processor.processDelta({
        choices: [{ delta: { content: 'Hello' } }],
      });
      expect(processor.getAccumulatedContent()).toBe('Hello');

      processor.reset();
      expect(processor.getAccumulatedContent()).toBe('');
    });

    it('should clear raw content', () => {
      processor.processDelta({
        choices: [{ delta: { content: 'Hello' } }],
      });
      expect(processor.getRawContent()).toBe('Hello');

      processor.reset();
      expect(processor.getRawContent()).toBe('');
    });

    it('should clear tool calls', () => {
      processor.processDelta({
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              id: 'call_123',
              function: { name: 'bash', arguments: '{}' },
            }],
          },
        }],
      });
      expect(processor.getToolCalls()).toHaveLength(1);

      processor.reset();
      expect(processor.getToolCalls()).toHaveLength(0);
    });

    it('should allow reuse after reset', () => {
      processor.processDelta({
        choices: [{ delta: { content: 'First' } }],
      });
      processor.reset();

      processor.processDelta({
        choices: [{ delta: { content: 'Second' } }],
      });

      expect(processor.getAccumulatedContent()).toBe('Second');
    });
  });

  describe('getAccumulatedContent', () => {
    it('should return empty string initially', () => {
      expect(processor.getAccumulatedContent()).toBe('');
    });

    it('should return sanitized accumulated content', () => {
      mockSanitize.mockImplementation(s => s.toUpperCase());

      processor.processDelta({
        choices: [{ delta: { content: 'hello' } }],
      });

      expect(processor.getAccumulatedContent()).toBe('HELLO');
    });
  });

  describe('getRawContent', () => {
    it('should return empty string initially', () => {
      expect(processor.getRawContent()).toBe('');
    });

    it('should return unsanitized raw content', () => {
      mockSanitize.mockImplementation(s => s.toUpperCase());

      processor.processDelta({
        choices: [{ delta: { content: 'hello' } }],
      });

      expect(processor.getRawContent()).toBe('hello');
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle a complete streaming response', () => {
      // Simulate a typical streaming response
      const deltas = [
        { content: 'Let me ' },
        { content: 'help you ' },
        { content: 'with that.' },
        {
          tool_calls: [{
            index: 0,
            id: 'call_abc',
            function: { name: 'bash' },
          }],
        },
        {
          tool_calls: [{
            index: 0,
            function: { arguments: '{"command":' },
          }],
        },
        {
          tool_calls: [{
            index: 0,
            function: { arguments: ' "ls -la"}' },
          }],
        },
      ];

      for (const delta of deltas) {
        processor.processDelta({ choices: [{ delta }] });
      }

      expect(processor.getAccumulatedContent()).toBe('Let me help you with that.');
      expect(processor.getToolCalls()).toHaveLength(1);
      expect(processor.getToolCalls()[0].function.arguments).toBe('{"command": "ls -la"}');
    });

    it('should handle interleaved content and tool calls', () => {
      processor.processDelta({
        choices: [{ delta: { content: 'Text 1' } }],
      });
      processor.processDelta({
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              id: 'call_1',
              function: { name: 'tool1', arguments: '{}' },
            }],
          },
        }],
      });
      processor.processDelta({
        choices: [{ delta: { content: ' Text 2' } }],
      });

      expect(processor.getAccumulatedContent()).toBe('Text 1 Text 2');
      expect(processor.getToolCalls()).toHaveLength(1);
    });

    it('should handle rapid successive deltas', () => {
      for (let i = 0; i < 100; i++) {
        processor.processDelta({
          choices: [{ delta: { content: 'x' } }],
        });
      }

      expect(processor.getAccumulatedContent()).toBe('x'.repeat(100));
    });
  });
});
