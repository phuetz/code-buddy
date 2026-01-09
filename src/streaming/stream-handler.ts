import { EventEmitter } from 'events';
import { StreamEvent, StreamStats } from './types.js';
import { ChunkProcessor } from './chunk-processor.js';
import { CodeBuddyToolCall } from '../codebuddy/client.js';
import { ToolResult } from '../types/index.js';

export class StreamHandler extends EventEmitter {
  private processor: ChunkProcessor;
  private stats: StreamStats;

  constructor() {
    super();
    this.processor = new ChunkProcessor();
    this.stats = this.createInitialStats();
  }

  private createInitialStats(): StreamStats {
    return {
      chunkCount: 0,
      contentLength: 0,
      toolCallCount: 0,
      startTime: Date.now(),
    };
  }

  /**
   * Handle an async stream of chunks
   */
  async *handleStream(
    stream: AsyncIterable<any>,
    abortSignal?: AbortSignal
  ): AsyncGenerator<StreamEvent, void, unknown> {
    this.stats = this.createInitialStats();
    this.processor.reset();

    try {
      for await (const chunk of stream) {
        if (abortSignal?.aborted) {
          yield { type: 'error', error: 'Operation cancelled by user' };
          return;
        }

        this.stats.chunkCount++;
        const events = this.processor.processDelta(chunk);

        for (const event of events) {
          if (event.type === 'content' && event.content) {
            this.stats.contentLength += event.content.length;
          }
          yield event;
        }
      }

      // Check for finalized tool calls (including commentary-style)
      const toolCalls = this.processor.getToolCalls();
      if (toolCalls.length > 0) {
        this.stats.toolCallCount = toolCalls.length;
        // Check if these were already yielded as deltas
        // For simplicity, we just yield the final set if needed, or agent uses them
      }

      this.stats.duration = Date.now() - this.stats.startTime;
      yield { type: 'done' };
    } catch (error) {
      yield { 
        type: 'error', 
        error: error instanceof Error ? error.message : String(error) 
      };
    }
  }

  /**
   * Helper to create a tool result event
   */
  createToolResultEvent(toolCall: CodeBuddyToolCall, result: ToolResult): StreamEvent {
    return {
      type: 'tool_result',
      toolCall,
      toolResult: result,
    };
  }

  /**
   * Get current streaming statistics
   */
  getStats(): StreamStats {
    return { ...this.stats };
  }

  /**
   * Get accumulated data
   */
  getAccumulated() {
    return {
      content: this.processor.getAccumulatedContent(),
      toolCalls: this.processor.getToolCalls(),
    };
  }
}
