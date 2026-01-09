/**
 * Backpressure Controller
 *
 * Manages flow control for streams to prevent memory overflow
 * and handle slow consumers gracefully.
 */

import { EventEmitter } from 'events';

export interface BackpressureOptions {
  /** High water mark - pause producer when buffer exceeds this */
  highWaterMark?: number;
  /** Low water mark - resume producer when buffer drops below this */
  lowWaterMark?: number;
  /** Maximum time to wait for buffer drain in milliseconds */
  drainTimeout?: number;
  /** Strategy for handling overflow */
  overflowStrategy?: 'block' | 'drop' | 'error';
}

export interface BackpressureStats {
  totalChunks: number;
  droppedChunks: number;
  pauseCount: number;
  resumeCount: number;
  currentBufferSize: number;
  isPaused: boolean;
  overflowCount: number;
  avgDrainTime: number;
}

export type BackpressureState = 'flowing' | 'paused' | 'drained' | 'overflow';

export class BackpressureController<T = unknown> extends EventEmitter {
  private buffer: T[] = [];
  private state: BackpressureState = 'flowing';
  private options: Required<BackpressureOptions>;
  private stats: BackpressureStats;
  private drainResolvers: Array<() => void> = [];
  private drainTimes: number[] = [];
  private lastPauseTime: number = 0;

  constructor(options: BackpressureOptions = {}) {
    super();
    const highWaterMark = options.highWaterMark ?? 100;
    this.options = {
      highWaterMark,
      lowWaterMark: options.lowWaterMark ?? Math.floor(highWaterMark / 2),
      drainTimeout: options.drainTimeout ?? 30000,
      overflowStrategy: options.overflowStrategy ?? 'block',
    };

    // Ensure low water mark is less than high water mark
    if (this.options.lowWaterMark >= this.options.highWaterMark) {
      this.options.lowWaterMark = Math.floor(this.options.highWaterMark / 2);
    }

    this.stats = this.createInitialStats();
  }

  private createInitialStats(): BackpressureStats {
    return {
      totalChunks: 0,
      droppedChunks: 0,
      pauseCount: 0,
      resumeCount: 0,
      currentBufferSize: 0,
      isPaused: false,
      overflowCount: 0,
      avgDrainTime: 0,
    };
  }

  /**
   * Push a chunk into the buffer
   * Returns true if accepted, false if dropped/blocked
   */
  async push(chunk: T): Promise<boolean> {
    this.stats.totalChunks++;

    // Check for overflow condition
    if (this.buffer.length >= this.options.highWaterMark) {
      return this.handleOverflow(chunk);
    }

    this.buffer.push(chunk);
    this.stats.currentBufferSize = this.buffer.length;

    // Check if we need to pause
    if (this.buffer.length >= this.options.highWaterMark) {
      this.pause();
    }

    this.emit('data', { chunk, bufferSize: this.buffer.length });
    return true;
  }

  /**
   * Pull a chunk from the buffer
   */
  pull(): T | undefined {
    const chunk = this.buffer.shift();
    this.stats.currentBufferSize = this.buffer.length;

    // Check if we can resume
    if (this.state === 'paused' && this.buffer.length <= this.options.lowWaterMark) {
      this.resume();
    }

    // Check if drained
    if (this.buffer.length === 0) {
      this.drain();
    }

    return chunk;
  }

  /**
   * Pull all chunks from the buffer
   */
  pullAll(): T[] {
    const chunks = [...this.buffer];
    this.buffer = [];
    this.stats.currentBufferSize = 0;

    this.drain();

    if (this.state === 'paused') {
      this.resume();
    }

    return chunks;
  }

  /**
   * Wait for buffer to drain below low water mark
   */
  async waitForDrain(): Promise<void> {
    if (this.buffer.length <= this.options.lowWaterMark) {
      return;
    }

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const index = this.drainResolvers.indexOf(resolve);
        if (index > -1) {
          this.drainResolvers.splice(index, 1);
        }
        reject(new Error(`Drain timeout after ${this.options.drainTimeout}ms`));
      }, this.options.drainTimeout);

      this.drainResolvers.push(() => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  /**
   * Process an async iterable with backpressure control
   */
  async *process(source: AsyncIterable<T>): AsyncGenerator<T, void, unknown> {
    for await (const chunk of source) {
      const accepted = await this.push(chunk);
      if (!accepted && this.options.overflowStrategy === 'error') {
        throw new Error('Buffer overflow');
      }
    }

    // Yield buffered chunks
    while (this.buffer.length > 0) {
      const chunk = this.pull();
      if (chunk !== undefined) {
        yield chunk;
      }
    }
  }

  /**
   * Apply backpressure to an async generator
   */
  async *apply(
    source: AsyncIterable<T>,
    consumer: (chunk: T) => Promise<void>
  ): AsyncGenerator<T, void, unknown> {
    for await (const chunk of source) {
      // Wait if paused
      if (this.state === 'paused') {
        await this.waitForDrain();
      }

      await this.push(chunk);

      // Process through consumer
      const bufferedChunk = this.pull();
      if (bufferedChunk !== undefined) {
        await consumer(bufferedChunk);
        yield bufferedChunk;
      }
    }

    // Drain remaining buffer
    while (this.buffer.length > 0) {
      const chunk = this.pull();
      if (chunk !== undefined) {
        await consumer(chunk);
        yield chunk;
      }
    }
  }

  private async handleOverflow(chunk: T): Promise<boolean> {
    this.stats.overflowCount++;
    this.emit('overflow', { bufferSize: this.buffer.length, chunk });

    switch (this.options.overflowStrategy) {
      case 'drop':
        this.stats.droppedChunks++;
        this.emit('drop', { chunk, bufferSize: this.buffer.length });
        return false;

      case 'error':
        throw new Error(`Buffer overflow: ${this.buffer.length} chunks`);

      case 'block':
      default:
        await this.waitForDrain();
        this.buffer.push(chunk);
        this.stats.currentBufferSize = this.buffer.length;
        return true;
    }
  }

  private pause(): void {
    if (this.state !== 'paused') {
      this.state = 'paused';
      this.stats.isPaused = true;
      this.stats.pauseCount++;
      this.lastPauseTime = Date.now();
      this.emit('pause', { bufferSize: this.buffer.length });
    }
  }

  private resume(): void {
    if (this.state === 'paused') {
      const drainTime = Date.now() - this.lastPauseTime;
      this.drainTimes.push(drainTime);
      // Keep only last 100 drain times
      if (this.drainTimes.length > 100) {
        this.drainTimes.shift();
      }
      this.stats.avgDrainTime = this.drainTimes.reduce((a, b) => a + b, 0) / this.drainTimes.length;

      this.state = 'flowing';
      this.stats.isPaused = false;
      this.stats.resumeCount++;
      this.emit('resume', { bufferSize: this.buffer.length, drainTime });

      // Resolve pending drain waiters
      while (this.drainResolvers.length > 0) {
        const resolver = this.drainResolvers.shift();
        if (resolver) resolver();
      }
    }
  }

  private drain(): void {
    if (this.buffer.length === 0) {
      this.state = 'drained';
      this.emit('drain', {});

      // Resolve any remaining drain waiters
      while (this.drainResolvers.length > 0) {
        const resolver = this.drainResolvers.shift();
        if (resolver) resolver();
      }
    }
  }

  /**
   * Get current state
   */
  getState(): BackpressureState {
    return this.state;
  }

  /**
   * Get current buffer size
   */
  getBufferSize(): number {
    return this.buffer.length;
  }

  /**
   * Check if buffer is full
   */
  isFull(): boolean {
    return this.buffer.length >= this.options.highWaterMark;
  }

  /**
   * Check if buffer is empty
   */
  isEmpty(): boolean {
    return this.buffer.length === 0;
  }

  /**
   * Check if currently paused
   */
  isPaused(): boolean {
    return this.state === 'paused';
  }

  /**
   * Get statistics
   */
  getStats(): BackpressureStats {
    return {
      ...this.stats,
      currentBufferSize: this.buffer.length,
      isPaused: this.state === 'paused',
    };
  }

  /**
   * Get fill percentage
   */
  getFillPercentage(): number {
    return (this.buffer.length / this.options.highWaterMark) * 100;
  }

  /**
   * Reset controller
   */
  reset(): void {
    this.buffer = [];
    this.state = 'flowing';
    this.stats = this.createInitialStats();
    this.drainResolvers = [];
    this.drainTimes = [];
    this.lastPauseTime = 0;
  }

  /**
   * Clear buffer without resetting stats
   */
  clear(): void {
    this.buffer = [];
    this.stats.currentBufferSize = 0;
    if (this.state === 'paused') {
      this.resume();
    }
    this.drain();
  }

  /**
   * Update options dynamically
   */
  updateOptions(options: Partial<BackpressureOptions>): void {
    if (options.highWaterMark !== undefined) {
      this.options.highWaterMark = options.highWaterMark;
    }
    if (options.lowWaterMark !== undefined) {
      this.options.lowWaterMark = options.lowWaterMark;
    }
    if (options.drainTimeout !== undefined) {
      this.options.drainTimeout = options.drainTimeout;
    }
    if (options.overflowStrategy !== undefined) {
      this.options.overflowStrategy = options.overflowStrategy;
    }

    // Ensure low water mark is valid
    if (this.options.lowWaterMark >= this.options.highWaterMark) {
      this.options.lowWaterMark = Math.floor(this.options.highWaterMark / 2);
    }

    // Check if we need to adjust state based on new options
    if (this.state === 'paused' && this.buffer.length <= this.options.lowWaterMark) {
      this.resume();
    } else if (this.state === 'flowing' && this.buffer.length >= this.options.highWaterMark) {
      this.pause();
    }
  }
}

/**
 * Create a backpressure-controlled async generator
 */
export async function* withBackpressure<T>(
  source: AsyncIterable<T>,
  options?: BackpressureOptions
): AsyncGenerator<T, void, unknown> {
  const controller = new BackpressureController<T>(options);

  for await (const chunk of source) {
    await controller.push(chunk);

    // Yield chunks as they're available
    while (!controller.isEmpty()) {
      const item = controller.pull();
      if (item !== undefined) {
        yield item;
      }
    }
  }

  // Drain remaining buffer
  while (!controller.isEmpty()) {
    const item = controller.pull();
    if (item !== undefined) {
      yield item;
    }
  }
}
