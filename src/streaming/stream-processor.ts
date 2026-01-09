/**
 * Stream Processor
 *
 * Core stream processing functionality for handling async iterables
 * with support for buffering, error handling, and lifecycle management.
 */

import { EventEmitter } from 'events';

export interface StreamProcessorOptions {
  /** Maximum buffer size before applying backpressure */
  maxBufferSize?: number;
  /** Timeout for stream operations in milliseconds */
  timeout?: number;
  /** Enable automatic retry on transient errors */
  autoRetry?: boolean;
  /** Maximum retry attempts */
  maxRetries?: number;
  /** Base delay for exponential backoff in milliseconds */
  retryBaseDelay?: number;
}

export interface StreamStats {
  chunksProcessed: number;
  bytesProcessed: number;
  startTime: number;
  endTime?: number;
  errors: number;
  retries: number;
}

export type StreamState = 'idle' | 'streaming' | 'paused' | 'completed' | 'error' | 'aborted';

export class StreamProcessor<T> extends EventEmitter {
  private buffer: T[] = [];
  private state: StreamState = 'idle';
  private stats: StreamStats;
  private abortController: AbortController | null = null;
  private options: Required<StreamProcessorOptions>;
  private pausePromise: Promise<void> | null = null;
  private pauseResolve: (() => void) | null = null;

  constructor(options: StreamProcessorOptions = {}) {
    super();
    this.options = {
      maxBufferSize: options.maxBufferSize ?? 1000,
      timeout: options.timeout ?? 30000,
      autoRetry: options.autoRetry ?? true,
      maxRetries: options.maxRetries ?? 3,
      retryBaseDelay: options.retryBaseDelay ?? 1000,
    };
    this.stats = this.createInitialStats();
  }

  private createInitialStats(): StreamStats {
    return {
      chunksProcessed: 0,
      bytesProcessed: 0,
      startTime: 0,
      errors: 0,
      retries: 0,
    };
  }

  /**
   * Process an async iterable stream
   */
  async *process(
    source: AsyncIterable<T>,
    transform?: (chunk: T) => T | Promise<T>
  ): AsyncGenerator<T, void, unknown> {
    this.state = 'streaming';
    this.stats = this.createInitialStats();
    this.stats.startTime = Date.now();
    this.abortController = new AbortController();

    this.emit('start', { stats: this.stats });

    try {
      for await (const chunk of source) {
        // Check for abort
        if (this.abortController.signal.aborted) {
          this.state = 'aborted';
          this.emit('abort', { stats: this.stats });
          return;
        }

        // Check for pause
        if (this.pausePromise) {
          this.state = 'paused';
          this.emit('pause', { stats: this.stats });
          await this.pausePromise;
          this.state = 'streaming';
          this.emit('resume', { stats: this.stats });
        }

        // Check buffer size for backpressure
        if (this.buffer.length >= this.options.maxBufferSize) {
          this.emit('backpressure', { bufferSize: this.buffer.length });
          await this.waitForBufferDrain();
        }

        // Transform if needed
        let processedChunk: T;
        if (transform) {
          try {
            processedChunk = await transform(chunk);
          } catch (error) {
            this.stats.errors++;
            this.emit('transformError', { error, chunk });
            continue;
          }
        } else {
          processedChunk = chunk;
        }

        // Update stats
        this.stats.chunksProcessed++;
        if (typeof processedChunk === 'string') {
          this.stats.bytesProcessed += processedChunk.length;
        } else if (Buffer.isBuffer(processedChunk)) {
          this.stats.bytesProcessed += processedChunk.length;
        }

        this.buffer.push(processedChunk);
        this.emit('chunk', { chunk: processedChunk, stats: this.stats });

        yield processedChunk;

        // Drain the buffer
        this.buffer.shift();
      }

      this.state = 'completed';
      this.stats.endTime = Date.now();
      this.emit('complete', { stats: this.stats });
    } catch (error) {
      this.state = 'error';
      this.stats.errors++;
      this.stats.endTime = Date.now();
      this.emit('error', { error, stats: this.stats });
      throw error;
    } finally {
      this.abortController = null;
    }
  }

  /**
   * Process stream with automatic retry on failure
   */
  async *processWithRetry(
    sourceFactory: () => AsyncIterable<T>,
    transform?: (chunk: T) => T | Promise<T>
  ): AsyncGenerator<T, void, unknown> {
    let attempt = 0;
    let lastError: Error | null = null;

    while (attempt <= this.options.maxRetries) {
      try {
        const source = sourceFactory();
        yield* this.process(source, transform);
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.stats.retries++;
        attempt++;

        if (attempt <= this.options.maxRetries && this.options.autoRetry) {
          const delay = this.calculateBackoff(attempt);
          this.emit('retry', { attempt, delay, error: lastError });
          await this.sleep(delay);
        }
      }
    }

    throw lastError || new Error('Stream processing failed after retries');
  }

  /**
   * Collect all chunks from a stream
   */
  async collect(source: AsyncIterable<T>): Promise<T[]> {
    const chunks: T[] = [];
    for await (const chunk of this.process(source)) {
      chunks.push(chunk);
    }
    return chunks;
  }

  /**
   * Reduce stream to a single value
   */
  async reduce<R>(
    source: AsyncIterable<T>,
    reducer: (acc: R, chunk: T) => R | Promise<R>,
    initial: R
  ): Promise<R> {
    let accumulator = initial;
    for await (const chunk of this.process(source)) {
      accumulator = await reducer(accumulator, chunk);
    }
    return accumulator;
  }

  /**
   * Pause stream processing
   */
  pause(): void {
    if (this.state === 'streaming' && !this.pausePromise) {
      this.pausePromise = new Promise((resolve) => {
        this.pauseResolve = resolve;
      });
    }
  }

  /**
   * Resume stream processing
   */
  resume(): void {
    if (this.pauseResolve) {
      this.pauseResolve();
      this.pausePromise = null;
      this.pauseResolve = null;
    }
  }

  /**
   * Abort stream processing
   */
  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
    this.resume(); // Unblock any paused state
  }

  /**
   * Get current stream state
   */
  getState(): StreamState {
    return this.state;
  }

  /**
   * Get current stats
   */
  getStats(): StreamStats {
    return { ...this.stats };
  }

  /**
   * Get buffer size
   */
  getBufferSize(): number {
    return this.buffer.length;
  }

  /**
   * Check if stream is active
   */
  isActive(): boolean {
    return this.state === 'streaming' || this.state === 'paused';
  }

  private async waitForBufferDrain(): Promise<void> {
    while (this.buffer.length >= this.options.maxBufferSize / 2) {
      await this.sleep(10);
    }
  }

  private calculateBackoff(attempt: number): number {
    const delay = this.options.retryBaseDelay * Math.pow(2, attempt - 1);
    // Add jitter
    const jitter = Math.random() * 0.1 * delay;
    return Math.min(delay + jitter, 30000); // Cap at 30 seconds
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Reset processor state
   */
  reset(): void {
    this.abort();
    this.buffer = [];
    this.state = 'idle';
    this.stats = this.createInitialStats();
  }
}
