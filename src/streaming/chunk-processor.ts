import { CodeBuddyToolCall } from '../codebuddy/client.js';
import { StreamEvent, ChunkProcessorOptions } from './types.js';
import { sanitizeLLMOutput, extractCommentaryToolCalls } from '../utils/sanitize.js';

/**
 * Robust processor for streaming chunks
 * Handles accumulation of content and tool calls from deltas
 */
export class ChunkProcessor {
  private accumulatedContent = '';
  private rawContent = '';
  private toolCallsMap: Map<number, Partial<CodeBuddyToolCall>> = new Map();
  private options: Required<ChunkProcessorOptions>;

  constructor(options: ChunkProcessorOptions = {}) {
    this.options = {
      sanitize: options.sanitize ?? true,
      extractCommentaryTools: options.extractCommentaryTools ?? true,
    };
  }

  /**
   * Process a delta chunk and return derived events
   */
  processDelta(chunk: any): StreamEvent[] {
    const events: StreamEvent[] = [];
    const delta = chunk.choices?.[0]?.delta;

    if (!delta) return events;

    // Handle content
    if (delta.content) {
      this.rawContent += delta.content;
      const sanitized = this.options.sanitize ? sanitizeLLMOutput(delta.content) : delta.content;
      if (sanitized) {
        this.accumulatedContent += sanitized;
        events.push({ type: 'content', content: sanitized });
      }
    }

    // Handle tool calls deltas
    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const index = tc.index;
        const existing = this.toolCallsMap.get(index) || {
          id: tc.id || '',
          type: 'function' as const,
          function: { name: '', arguments: '' },
        };

        if (tc.id) existing.id = tc.id;
        if (tc.function?.name) existing.function!.name += tc.function.name;
        if (tc.function?.arguments) existing.function!.arguments += tc.function.arguments;

        this.toolCallsMap.set(index, existing);

        // Yield tool calls event if we have a name (even partial)
        if (existing.function?.name) {
          events.push({ 
            type: 'tool_call', 
            toolCall: existing as CodeBuddyToolCall 
          });
        }
      }
    }

    return events;
  }

  /**
   * Get all accumulated tool calls (finalized)
   */
  getToolCalls(): CodeBuddyToolCall[] {
    const calls = Array.from(this.toolCallsMap.values()) as CodeBuddyToolCall[];
    
    // Check for commentary-style tool calls if enabled and no native calls found
    if (this.options.extractCommentaryTools && calls.length === 0 && this.rawContent) {
      const { toolCalls: extracted } = extractCommentaryToolCalls(this.rawContent);
      if (extracted.length > 0) {
        return extracted.map((tc, index) => ({
          id: `commentary_${Date.now()}_${index}`,
          type: 'function' as const,
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments),
          },
        }));
      }
    }
    
    return calls;
  }

  /**
   * Get full accumulated content (sanitized)
   */
  getAccumulatedContent(): string {
    return this.accumulatedContent;
  }

  /**
   * Get raw accumulated content
   */
  getRawContent(): string {
    return this.rawContent;
  }

  /**
   * Reset the processor for a new round
   */
  reset(): void {
    this.accumulatedContent = '';
    this.rawContent = '';
    this.toolCallsMap.clear();
  }
}
