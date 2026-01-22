import { EventEmitter } from 'events';
import { Readable, Transform } from 'stream';
import { StreamEvent, StreamStats } from './types.js';
import { ChunkProcessor, OptimizedChunkProcessorOptions, FlowHint, StreamingMetrics } from './chunk-processor.js';
import { CodeBuddyToolCall } from '../codebuddy/client.js';
import { ToolResult } from '../types/index.js';

/**
 * Extended stream stats with detailed metrics
 */
export interface ExtendedStreamStats extends StreamStats {
  /** Detailed metrics from chunk processor */
  metrics?: StreamingMetrics;
  /** Number of chunk timeouts */
  chunkTimeouts?: number;
  /** Whether stream completed due to timeout */
  timedOut?: boolean;
}

/**
 * Options for stream handler
 */
export interface StreamHandlerOptions {
  /** Options to pass to the chunk processor */
  processorOptions?: OptimizedChunkProcessorOptions;
  /** Per-chunk timeout in ms (default: 5000) */
  chunkTimeoutMs?: number;
  /** Global stream timeout in ms (default: 0 = no timeout) */
  globalTimeoutMs?: number;
  /** Enable metrics collection (default: true) */
  collectMetrics?: boolean;
}

export class StreamHandler extends EventEmitter {
  private processor: ChunkProcessor;
  private stats: ExtendedStreamStats;
  private options: Required<StreamHandlerOptions>;
  private globalTimeoutTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: StreamHandlerOptions = {}) {
    super();
    this.options = {
      processorOptions: options.processorOptions ?? {},
      chunkTimeoutMs: options.chunkTimeoutMs ?? 5000,
      globalTimeoutMs: options.globalTimeoutMs ?? 0,
      collectMetrics: options.collectMetrics ?? true,
    };

    // Merge chunk timeout into processor options
    const processorOpts: OptimizedChunkProcessorOptions = {
      ...this.options.processorOptions,
      chunkTimeoutMs: this.options.chunkTimeoutMs,
      onFlowHint: (hint: FlowHint) => this.emit('flowHint', hint),
    };

    this.processor = new ChunkProcessor(processorOpts);
    this.stats = this.createInitialStats();
  }

  private createInitialStats(): ExtendedStreamStats {
    return {
      chunkCount: 0,
      contentLength: 0,
      toolCallCount: 0,
      startTime: Date.now(),
      chunkTimeouts: 0,
      timedOut: false,
    };
  }

  /**
   * Start global timeout timer
   */
  private startGlobalTimeout(): void {
    if (this.options.globalTimeoutMs <= 0) return;

    this.clearGlobalTimeout();
    this.globalTimeoutTimer = setTimeout(() => {
      this.emit('globalTimeout', {
        timeoutMs: this.options.globalTimeoutMs,
        stats: this.stats,
      });
    }, this.options.globalTimeoutMs);
  }

  /**
   * Clear global timeout timer
   */
  private clearGlobalTimeout(): void {
    if (this.globalTimeoutTimer) {
      clearTimeout(this.globalTimeoutTimer);
      this.globalTimeoutTimer = null;
    }
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
    this.startGlobalTimeout();

    try {
      // Start waiting for first chunk
      this.processor.startChunkTimeout();

      for await (const chunk of stream) {
        if (abortSignal?.aborted) {
          this.clearGlobalTimeout();
          yield { type: 'error', error: 'Operation cancelled by user' };
          return;
        }

        // Check for chunk timeout before processing
        if (this.processor.hasTimedOut()) {
          const timeoutEvents = this.processor.drainPendingEvents();
          for (const event of timeoutEvents) {
            yield event;
          }
          this.stats.timedOut = true;
        }

        this.stats.chunkCount++;
        const events = this.processor.processDelta(chunk);

        for (const event of events) {
          if (event.type === 'content' && event.content) {
            this.stats.contentLength += event.content.length;
          }
          yield event;
        }

        // Drain any pending events (backpressure)
        const pendingEvents = this.processor.drainPendingEvents();
        for (const event of pendingEvents) {
          yield event;
        }

        // Emit progress update
        const progress = this.processor.getProgressIndicator();
        this.emit('progress', progress);
      }

      // Flush any remaining batched content
      const finalEvent = this.processor.flushPendingBatch();
      if (finalEvent) {
        yield finalEvent;
      }

      // Check for finalized tool calls (including commentary-style)
      const toolCalls = this.processor.getToolCalls();
      if (toolCalls.length > 0) {
        this.stats.toolCallCount = toolCalls.length;
      }

      // Collect final metrics
      if (this.options.collectMetrics) {
        this.stats.metrics = this.processor.getMetrics();
        this.stats.chunkTimeouts = this.processor.getChunkTimeoutCount();
      }

      this.stats.duration = Date.now() - this.stats.startTime;
      this.clearGlobalTimeout();
      this.processor.clearChunkTimeout();

      this.emit('complete', {
        stats: this.stats,
        metricsSummary: this.processor.getMetricsSummary(),
      });

      yield { type: 'done' };
    } catch (error) {
      this.clearGlobalTimeout();
      this.processor.clearChunkTimeout();

      if (this.options.collectMetrics) {
        this.stats.metrics = this.processor.getMetrics();
      }

      yield {
        type: 'error',
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Create a Node.js Transform stream for piping
   * This allows integration with native Node.js streams
   */
  createTransformStream(): Transform {
    const processor = this.processor;
    const emitProgress = this.emit.bind(this, 'progress');
    const emitComplete = (metricsSummary: ReturnType<typeof processor.getMetricsSummary>) => {
      this.emit('complete', {
        stats: this.stats,
        metricsSummary,
      });
    };

    return new Transform({
      objectMode: true,
      transform(chunk, _encoding, callback) {
        try {
          const events = processor.processDelta(chunk);
          for (const event of events) {
            this.push(event);
          }

          // Drain pending events
          const pending = processor.drainPendingEvents();
          for (const event of pending) {
            this.push(event);
          }

          // Emit progress
          emitProgress(processor.getProgressIndicator());

          callback();
        } catch (error) {
          callback(error instanceof Error ? error : new Error(String(error)));
        }
      },
      flush(callback) {
        // Flush any remaining content
        const finalEvent = processor.flushPendingBatch();
        if (finalEvent) {
          this.push(finalEvent);
        }

        // Emit completion
        emitComplete(processor.getMetricsSummary());

        this.push({ type: 'done' });
        callback();
      },
    });
  }

  /**
   * Process a Readable stream and return an async generator
   * Useful for integrating with Node.js streams
   */
  async *processReadableStream(
    readable: Readable,
    abortSignal?: AbortSignal
  ): AsyncGenerator<StreamEvent, void, unknown> {
    const transform = this.createTransformStream();
    readable.pipe(transform);

    for await (const event of transform) {
      if (abortSignal?.aborted) {
        transform.destroy();
        yield { type: 'error', error: 'Operation cancelled by user' };
        return;
      }
      yield event as StreamEvent;
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
