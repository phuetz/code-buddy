import { CodeBuddyToolCall } from '../codebuddy/client.js';
import { StreamEvent, ChunkProcessorOptions } from './types.js';
import { sanitizeLLMOutput, extractCommentaryToolCalls } from '../utils/sanitize.js';

interface ChatDelta {
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
  }>;
}

/**
 * Chunk timeout error for per-chunk timeout handling
 */
export class ChunkTimeoutError extends Error {
  constructor(
    public readonly chunkIndex: number,
    public readonly timeoutMs: number
  ) {
    super(`Chunk ${chunkIndex} timed out after ${timeoutMs}ms`);
    this.name = 'ChunkTimeoutError';
  }
}

/**
 * Latency metrics for streaming performance analysis
 */
export interface StreamingMetrics {
  /** Total chunks processed */
  chunkCount: number;
  /** Total bytes processed */
  totalBytes: number;
  /** Average chunk processing time in ms */
  avgProcessingTimeMs: number;
  /** Max chunk processing time in ms */
  maxProcessingTimeMs: number;
  /** Min chunk processing time in ms */
  minProcessingTimeMs: number;
  /** Time to first chunk in ms */
  timeToFirstChunkMs: number;
  /** Total processing time in ms */
  totalProcessingTimeMs: number;
  /** Chunks per second throughput */
  chunksPerSecond: number;
  /** Bytes per second throughput */
  bytesPerSecond: number;
  /** Number of batched flushes */
  batchFlushCount: number;
  /** Backpressure events count */
  backpressureEvents: number;
  /** P50 latency (median) in ms */
  p50LatencyMs: number;
  /** P95 latency in ms */
  p95LatencyMs: number;
  /** P99 latency in ms */
  p99LatencyMs: number;
  /** Number of chunk timeouts */
  chunkTimeouts: number;
  /** Jitter (latency variance) in ms */
  jitterMs: number;
  /** Inter-chunk arrival time average in ms */
  avgInterChunkTimeMs: number;
}

/**
 * Extended options for optimized chunk processor
 */
export interface OptimizedChunkProcessorOptions extends ChunkProcessorOptions {
  /** Enable batch processing for small chunks (default: true) */
  enableBatching?: boolean;
  /** Batch size threshold in bytes before auto-flush (default: 64) */
  batchSizeThreshold?: number;
  /** Batch time threshold in ms before auto-flush (default: 16 ~60fps) */
  batchTimeThresholdMs?: number;
  /** Enable backpressure handling (default: true) */
  enableBackpressure?: boolean;
  /** Max pending events before applying backpressure (default: 100) */
  maxPendingEvents?: number;
  /** Throttle render updates in ms (default: 16 ~60fps) */
  renderThrottleMs?: number;
  /** Per-chunk timeout in ms (default: 5000). 0 = no timeout */
  chunkTimeoutMs?: number;
  /** Adaptive throttle based on rendering performance (default: true) */
  adaptiveThrottle?: boolean;
  /** Min render throttle for adaptive mode in ms (default: 8 ~120fps) */
  minRenderThrottleMs?: number;
  /** Max render throttle for adaptive mode in ms (default: 50 ~20fps) */
  maxRenderThrottleMs?: number;
  /** Flow hint callback for consumer feedback */
  onFlowHint?: (hint: FlowHint) => void;
}

/**
 * Flow control hints for consumers
 */
export interface FlowHint {
  /** Current flow state */
  state: 'flowing' | 'slow' | 'backpressured';
  /** Recommended action for consumer */
  action: 'continue' | 'slow_down' | 'pause';
  /** Buffer fill percentage 0-100 */
  bufferFillPercent: number;
  /** Estimated time to drain buffer in ms */
  estimatedDrainTimeMs: number;
}

// Reusable event arrays to reduce allocations
const EMPTY_EVENTS: StreamEvent[] = [];

/**
 * High-performance processor for streaming chunks
 * Optimizations:
 * - Reusable buffers to minimize memory allocations
 * - Batch processing for small chunks
 * - Backpressure handling for flow control
 * - Per-chunk timeout support
 * - Latency metrics with percentiles for performance monitoring
 * - Adaptive render throttling based on consumer performance
 * - Flow hints for consumer feedback
 */
export class ChunkProcessor {
  // Content accumulators - reuse string buffers
  private contentBuffer: string[] = [];
  private rawContentBuffer: string[] = [];
  private accumulatedContent = '';
  private rawContent = '';
  private contentDirty = false;

  // Tool calls storage
  private toolCallsMap: Map<number, Partial<CodeBuddyToolCall>> = new Map();

  // Batch processing state
  private pendingBatch: string[] = [];
  private pendingBatchSize = 0;
  private lastBatchFlushTime = 0;
  private batchFlushCount = 0;

  // Backpressure state
  private pendingEvents: StreamEvent[] = [];
  private isBackpressured = false;
  private backpressureEvents = 0;

  // Render throttling
  private lastRenderTime = 0;
  private pendingRenderContent = '';
  private currentRenderThrottle = 16; // Adaptive throttle value
  private renderDurations: number[] = []; // Track render performance

  // Metrics tracking
  private startTime = 0;
  private firstChunkTime = 0;
  private processingTimes: number[] = [];
  private interChunkTimes: number[] = [];
  private lastChunkArrivalTime = 0;
  private totalBytes = 0;
  private chunkCount = 0;
  private chunkTimeouts = 0;

  // Per-chunk timeout tracking
  private chunkTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private lastChunkProcessedTime = 0;

  // Options with defaults - use intersection type for proper typing
  private options: Required<Omit<OptimizedChunkProcessorOptions, 'onFlowHint'>> & {
    onFlowHint: ((hint: FlowHint) => void) | null;
  };

  constructor(options: OptimizedChunkProcessorOptions = {}) {
    this.options = {
      sanitize: options.sanitize ?? true,
      extractCommentaryTools: options.extractCommentaryTools ?? true,
      enableBatching: options.enableBatching ?? true,
      batchSizeThreshold: options.batchSizeThreshold ?? 64,
      batchTimeThresholdMs: options.batchTimeThresholdMs ?? 16,
      enableBackpressure: options.enableBackpressure ?? true,
      maxPendingEvents: options.maxPendingEvents ?? 100,
      renderThrottleMs: options.renderThrottleMs ?? 16,
      chunkTimeoutMs: options.chunkTimeoutMs ?? 5000,
      adaptiveThrottle: options.adaptiveThrottle ?? true,
      minRenderThrottleMs: options.minRenderThrottleMs ?? 8,
      maxRenderThrottleMs: options.maxRenderThrottleMs ?? 50,
      onFlowHint: options.onFlowHint ?? null,
    };
    this.currentRenderThrottle = this.options.renderThrottleMs;
  }

  /**
   * Start per-chunk timeout monitoring
   * Call this when waiting for the next chunk
   */
  startChunkTimeout(): void {
    if (this.options.chunkTimeoutMs <= 0) return;

    this.clearChunkTimeout();
    this.chunkTimeoutTimer = setTimeout(() => {
      this.chunkTimeouts++;
      // Emit timeout event by adding to pending events
      this.pendingEvents.push({
        type: 'error',
        error: `Chunk timeout after ${this.options.chunkTimeoutMs}ms (chunk #${this.chunkCount + 1})`,
      });
    }, this.options.chunkTimeoutMs);
  }

  /**
   * Clear the current chunk timeout
   * Call this when a chunk is received
   */
  clearChunkTimeout(): void {
    if (this.chunkTimeoutTimer) {
      clearTimeout(this.chunkTimeoutTimer);
      this.chunkTimeoutTimer = null;
    }
  }

  /**
   * Check if a chunk timeout has occurred
   */
  hasTimedOut(): boolean {
    return this.pendingEvents.some(e => e.type === 'error' && e.error?.includes('Chunk timeout'));
  }

  /**
   * Process a delta chunk and return derived events
   * Optimized for minimal allocations and batch processing
   */
  processDelta(chunk: ChatDelta): StreamEvent[] {
    const processStart = performance.now();

    // Clear any pending timeout since we received a chunk
    this.clearChunkTimeout();

    // Initialize timing on first chunk
    if (this.chunkCount === 0) {
      this.startTime = processStart;
      this.lastChunkArrivalTime = processStart;
    } else {
      // Track inter-chunk arrival time
      const interChunkTime = processStart - this.lastChunkArrivalTime;
      this.interChunkTimes.push(interChunkTime);
      // Keep only last 100 samples for memory efficiency
      if (this.interChunkTimes.length > 100) {
        this.interChunkTimes.shift();
      }
      this.lastChunkArrivalTime = processStart;
    }

    const delta = chunk.choices?.[0]?.delta;
    if (!delta) {
      // Start timeout for next chunk
      this.startChunkTimeout();
      return EMPTY_EVENTS;
    }

    // Track first meaningful chunk
    if (this.firstChunkTime === 0 && (delta.content || delta.tool_calls)) {
      this.firstChunkTime = processStart;
    }

    this.chunkCount++;
    this.lastChunkProcessedTime = processStart;
    const events: StreamEvent[] = [];

    // Handle content with batching optimization
    if (delta.content) {
      const contentLength = delta.content.length;
      this.totalBytes += contentLength;

      // Add to raw buffer
      this.rawContentBuffer.push(delta.content);
      this.contentDirty = true;

      // Batch small chunks for better performance
      if (this.options.enableBatching && this.shouldBatch(contentLength)) {
        this.addToBatch(delta.content);

        // Check if we should flush the batch
        if (this.shouldFlushBatch()) {
          const batchedContent = this.flushBatch();
          if (batchedContent) {
            const sanitized = this.processSanitize(batchedContent);
            if (sanitized) {
              this.contentBuffer.push(sanitized);
              events.push(this.createContentEvent(sanitized));
            }
          }
        }
      } else {
        // Process immediately for larger chunks
        const sanitized = this.processSanitize(delta.content);
        if (sanitized) {
          this.contentBuffer.push(sanitized);
          events.push(this.createContentEvent(sanitized));
        }
      }
    }

    // Handle tool calls deltas
    if (delta.tool_calls) {
      this.processToolCalls(delta.tool_calls, events);
    }

    // Apply backpressure if needed
    if (this.options.enableBackpressure) {
      this.handleBackpressure(events);
    }

    // Track processing time
    const processEnd = performance.now();
    const processingTime = processEnd - processStart;
    this.processingTimes.push(processingTime);

    // Keep only last 100 samples for memory efficiency
    if (this.processingTimes.length > 100) {
      this.processingTimes.shift();
    }

    // Emit flow hint if callback is provided
    if (this.options.onFlowHint) {
      this.emitFlowHint();
    }

    // Start timeout for next chunk
    this.startChunkTimeout();

    return events;
  }

  /**
   * Emit a flow hint to the consumer based on current state
   */
  private emitFlowHint(): void {
    if (!this.options.onFlowHint) return;

    const bufferFillPercent = (this.pendingEvents.length / this.options.maxPendingEvents) * 100;
    const avgProcessingTime = this.getAverageProcessingTime();
    const estimatedDrainTimeMs = this.pendingEvents.length * avgProcessingTime;

    let state: FlowHint['state'];
    let action: FlowHint['action'];

    if (this.isBackpressured) {
      state = 'backpressured';
      action = 'pause';
    } else if (bufferFillPercent > 50) {
      state = 'slow';
      action = 'slow_down';
    } else {
      state = 'flowing';
      action = 'continue';
    }

    this.options.onFlowHint({
      state,
      action,
      bufferFillPercent,
      estimatedDrainTimeMs,
    });
  }

  /**
   * Get average processing time from recent samples
   */
  private getAverageProcessingTime(): number {
    if (this.processingTimes.length === 0) return 1;
    const sum = this.processingTimes.reduce((a, b) => a + b, 0);
    return sum / this.processingTimes.length;
  }

  /**
   * Determine if content should be batched
   * Batching is used for rapid successive small chunks.
   * A chunk is batched if:
   * - It's small enough (< batchSizeThreshold)
   * - AND it arrived quickly after the last chunk (< batchTimeThresholdMs)
   * This ensures isolated chunks emit immediately for responsiveness
   * while rapid streams of small chunks are batched for efficiency
   */
  private shouldBatch(contentLength: number): boolean {
    // Only batch small chunks
    if (contentLength >= this.options.batchSizeThreshold) {
      return false;
    }

    // Only batch if chunk arrived quickly after the last one (rapid streaming)
    // If it's been a while since last chunk, emit immediately
    const now = performance.now();
    const timeSinceLastChunk = now - this.lastChunkArrivalTime;

    // If too much time has passed, don't batch - emit immediately
    if (timeSinceLastChunk > this.options.batchTimeThresholdMs * 2) {
      return false;
    }

    // If there's already content pending, continue batching
    if (this.pendingBatch.length > 0) {
      return true;
    }

    // For the very first chunk or isolated chunks, don't batch
    return false;
  }

  /**
   * Add content to pending batch
   */
  private addToBatch(content: string): void {
    this.pendingBatch.push(content);
    this.pendingBatchSize += content.length;

    if (this.lastBatchFlushTime === 0) {
      this.lastBatchFlushTime = performance.now();
    }
  }

  /**
   * Check if batch should be flushed
   */
  private shouldFlushBatch(): boolean {
    if (this.pendingBatch.length === 0) return false;

    // Flush if size threshold reached
    if (this.pendingBatchSize >= this.options.batchSizeThreshold) {
      return true;
    }

    // Flush if time threshold reached
    const elapsed = performance.now() - this.lastBatchFlushTime;
    if (elapsed >= this.options.batchTimeThresholdMs) {
      return true;
    }

    return false;
  }

  /**
   * Flush batched content and return combined string
   */
  private flushBatch(): string {
    if (this.pendingBatch.length === 0) return '';

    const content = this.pendingBatch.join('');
    this.pendingBatch.length = 0; // Reuse array
    this.pendingBatchSize = 0;
    this.lastBatchFlushTime = performance.now();
    this.batchFlushCount++;

    return content;
  }

  /**
   * Force flush any pending batched content
   * Call this at stream end to ensure all content is emitted
   */
  flushPendingBatch(): StreamEvent | null {
    const content = this.flushBatch();
    if (!content) return null;

    const sanitized = this.processSanitize(content);
    if (sanitized) {
      this.contentBuffer.push(sanitized);
      return this.createContentEvent(sanitized);
    }
    return null;
  }

  /**
   * Process sanitization with caching for performance
   */
  private processSanitize(content: string): string {
    if (!this.options.sanitize) return content;
    return sanitizeLLMOutput(content);
  }

  /**
   * Create a content event (reuses pattern for consistency)
   */
  private createContentEvent(content: string): StreamEvent {
    return { type: 'content', content };
  }

  /**
   * Process tool call deltas efficiently
   */
  private processToolCalls(
    toolCalls: Array<{
      index: number;
      id?: string;
      function?: {
        name?: string;
        arguments?: string;
      };
    }>,
    events: StreamEvent[]
  ): void {
    if (!toolCalls || toolCalls.length === 0) return;

    for (let i = 0; i < toolCalls.length; i++) {
      const tc = toolCalls[i];
      const index = tc.index;

      let existing = this.toolCallsMap.get(index);
      if (!existing) {
        existing = {
          id: tc.id || '',
          type: 'function' as const,
          function: { name: '', arguments: '' },
        };
        this.toolCallsMap.set(index, existing);
      }

      if (tc.id) existing.id = tc.id;
      if (tc.function?.name) existing.function!.name += tc.function.name;
      if (tc.function?.arguments) existing.function!.arguments += tc.function.arguments;

      // Emit event if we have a name
      if (existing.function?.name) {
        events.push({
          type: 'tool_call',
          toolCall: existing as CodeBuddyToolCall
        });
      }
    }
  }

  /**
   * Handle backpressure by queueing events when overwhelmed
   */
  private handleBackpressure(events: StreamEvent[]): void {
    const totalPending = this.pendingEvents.length + events.length;

    if (totalPending > this.options.maxPendingEvents) {
      if (!this.isBackpressured) {
        this.isBackpressured = true;
        this.backpressureEvents++;
      }
      // Queue events instead of returning them immediately
      this.pendingEvents.push(...events);
      events.length = 0; // Clear the events array
    } else if (this.isBackpressured && totalPending < this.options.maxPendingEvents / 2) {
      // Release backpressure when queue drains to half
      this.isBackpressured = false;
    }
  }

  /**
   * Drain pending events (call when ready to process more)
   */
  drainPendingEvents(maxCount?: number): StreamEvent[] {
    if (this.pendingEvents.length === 0) return EMPTY_EVENTS;

    const count = maxCount ?? this.pendingEvents.length;
    const drained = this.pendingEvents.splice(0, count);

    // Check if we can release backpressure
    if (this.isBackpressured && this.pendingEvents.length < this.options.maxPendingEvents / 2) {
      this.isBackpressured = false;
    }

    return drained;
  }

  /**
   * Check if backpressure is currently applied
   */
  isUnderBackpressure(): boolean {
    return this.isBackpressured;
  }

  /**
   * Get count of pending events
   */
  getPendingEventCount(): number {
    return this.pendingEvents.length;
  }

  /**
   * Check if content should be rendered (throttled)
   * Uses adaptive throttling if enabled
   */
  shouldRender(): boolean {
    const now = performance.now();
    const effectiveThrottle = this.options.adaptiveThrottle
      ? this.currentRenderThrottle
      : this.options.renderThrottleMs;

    if (now - this.lastRenderTime >= effectiveThrottle) {
      this.lastRenderTime = now;
      return true;
    }
    return false;
  }

  /**
   * Get throttled content for rendering
   * Accumulates content between renders and returns it when shouldRender() is true
   */
  getThrottledContent(content: string): string | null {
    this.pendingRenderContent += content;

    if (this.shouldRender()) {
      const toRender = this.pendingRenderContent;
      this.pendingRenderContent = '';
      return toRender;
    }

    return null;
  }

  /**
   * Report render duration for adaptive throttling
   * Call this after rendering to help the processor adjust throttle
   */
  reportRenderDuration(durationMs: number): void {
    if (!this.options.adaptiveThrottle) return;

    this.renderDurations.push(durationMs);
    // Keep only last 20 samples
    if (this.renderDurations.length > 20) {
      this.renderDurations.shift();
    }

    // Adjust throttle based on render performance
    this.adjustAdaptiveThrottle();
  }

  /**
   * Adjust adaptive throttle based on recent render durations
   */
  private adjustAdaptiveThrottle(): void {
    if (this.renderDurations.length < 3) return;

    const avgRenderTime = this.renderDurations.reduce((a, b) => a + b, 0) / this.renderDurations.length;

    // If rendering is taking too long, increase throttle (reduce frame rate)
    if (avgRenderTime > this.currentRenderThrottle * 0.8) {
      this.currentRenderThrottle = Math.min(
        this.currentRenderThrottle * 1.2,
        this.options.maxRenderThrottleMs
      );
    }
    // If rendering is fast, decrease throttle (increase frame rate)
    else if (avgRenderTime < this.currentRenderThrottle * 0.3) {
      this.currentRenderThrottle = Math.max(
        this.currentRenderThrottle * 0.8,
        this.options.minRenderThrottleMs
      );
    }
  }

  /**
   * Get current adaptive render throttle value
   */
  getCurrentRenderThrottle(): number {
    return this.currentRenderThrottle;
  }

  /**
   * Force get any pending render content
   */
  flushRenderContent(): string {
    const content = this.pendingRenderContent;
    this.pendingRenderContent = '';
    return content;
  }

  /**
   * Get all accumulated tool calls (finalized)
   */
  getToolCalls(): CodeBuddyToolCall[] {
    const calls = Array.from(this.toolCallsMap.values()) as CodeBuddyToolCall[];

    // Check for commentary-style tool calls if enabled and no native calls found
    if (this.options.extractCommentaryTools && calls.length === 0) {
      const rawContent = this.getRawContent();
      if (rawContent) {
        const { toolCalls: extracted } = extractCommentaryToolCalls(rawContent);
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
    }

    return calls;
  }

  /**
   * Get full accumulated content (sanitized)
   * Uses lazy joining for better memory efficiency
   */
  getAccumulatedContent(): string {
    if (this.contentDirty || !this.accumulatedContent) {
      this.accumulatedContent = this.contentBuffer.join('');
    }
    return this.accumulatedContent;
  }

  /**
   * Get raw accumulated content
   * Uses lazy joining for better memory efficiency
   */
  getRawContent(): string {
    if (this.contentDirty || !this.rawContent) {
      this.rawContent = this.rawContentBuffer.join('');
      this.contentDirty = false;
    }
    return this.rawContent;
  }

  /**
   * Calculate percentile from sorted array
   */
  private calculatePercentile(sortedArray: number[], percentile: number): number {
    if (sortedArray.length === 0) return 0;
    const index = Math.ceil((percentile / 100) * sortedArray.length) - 1;
    return sortedArray[Math.max(0, index)];
  }

  /**
   * Calculate variance (jitter) from array of times
   */
  private calculateVariance(times: number[]): number {
    if (times.length < 2) return 0;
    const mean = times.reduce((a, b) => a + b, 0) / times.length;
    const squaredDiffs = times.map(t => Math.pow(t - mean, 2));
    return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / times.length);
  }

  /**
   * Get detailed streaming metrics for performance analysis
   */
  getMetrics(): StreamingMetrics {
    const now = performance.now();
    const totalTime = this.startTime > 0 ? now - this.startTime : 0;

    // Calculate processing time stats
    let avgTime = 0;
    let minTime = 0;
    let maxTime = 0;
    let p50 = 0;
    let p95 = 0;
    let p99 = 0;
    let jitter = 0;

    if (this.processingTimes.length > 0) {
      const sum = this.processingTimes.reduce((a, b) => a + b, 0);
      avgTime = sum / this.processingTimes.length;
      minTime = Math.min(...this.processingTimes);
      maxTime = Math.max(...this.processingTimes);

      // Calculate percentiles
      const sorted = [...this.processingTimes].sort((a, b) => a - b);
      p50 = this.calculatePercentile(sorted, 50);
      p95 = this.calculatePercentile(sorted, 95);
      p99 = this.calculatePercentile(sorted, 99);

      // Calculate jitter (standard deviation of processing times)
      jitter = this.calculateVariance(this.processingTimes);
    }

    // Calculate average inter-chunk arrival time
    let avgInterChunkTime = 0;
    if (this.interChunkTimes.length > 0) {
      avgInterChunkTime = this.interChunkTimes.reduce((a, b) => a + b, 0) / this.interChunkTimes.length;
    }

    return {
      chunkCount: this.chunkCount,
      totalBytes: this.totalBytes,
      avgProcessingTimeMs: avgTime,
      maxProcessingTimeMs: maxTime,
      minProcessingTimeMs: minTime,
      timeToFirstChunkMs: this.firstChunkTime > 0 ? this.firstChunkTime - this.startTime : 0,
      totalProcessingTimeMs: totalTime,
      chunksPerSecond: totalTime > 0 ? (this.chunkCount / totalTime) * 1000 : 0,
      bytesPerSecond: totalTime > 0 ? (this.totalBytes / totalTime) * 1000 : 0,
      batchFlushCount: this.batchFlushCount,
      backpressureEvents: this.backpressureEvents,
      p50LatencyMs: p50,
      p95LatencyMs: p95,
      p99LatencyMs: p99,
      chunkTimeouts: this.chunkTimeouts,
      jitterMs: jitter,
      avgInterChunkTimeMs: avgInterChunkTime,
    };
  }

  /**
   * Get a summary string of metrics for logging
   */
  getMetricsSummary(): string {
    const m = this.getMetrics();
    return [
      `Chunks: ${m.chunkCount}`,
      `Bytes: ${m.totalBytes}`,
      `TTFC: ${m.timeToFirstChunkMs.toFixed(2)}ms`,
      `Latency (p50/p95/p99): ${m.p50LatencyMs.toFixed(3)}/${m.p95LatencyMs.toFixed(3)}/${m.p99LatencyMs.toFixed(3)}ms`,
      `Jitter: ${m.jitterMs.toFixed(3)}ms`,
      `Throughput: ${m.chunksPerSecond.toFixed(1)} chunks/s, ${(m.bytesPerSecond / 1024).toFixed(1)} KB/s`,
      `Batches: ${m.batchFlushCount}`,
      `Backpressure: ${m.backpressureEvents}`,
      `Timeouts: ${m.chunkTimeouts}`,
    ].join(' | ');
  }

  /**
   * Get a progress indicator object suitable for UI display
   */
  getProgressIndicator(): {
    phase: 'connecting' | 'streaming' | 'completing';
    progress: number; // 0-100, estimated based on typical response
    bytesReceived: number;
    chunksReceived: number;
    elapsedMs: number;
    estimatedRemainingMs: number;
    latencyTrend: 'improving' | 'stable' | 'degrading';
  } {
    const now = performance.now();
    const elapsed = this.startTime > 0 ? now - this.startTime : 0;

    // Determine phase
    let phase: 'connecting' | 'streaming' | 'completing';
    if (this.chunkCount === 0) {
      phase = 'connecting';
    } else if (this.pendingBatch.length > 0 || this.pendingEvents.length > 0) {
      phase = 'streaming';
    } else {
      phase = this.chunkCount > 0 ? 'completing' : 'connecting';
    }

    // Estimate progress (rough heuristic based on typical response)
    // This could be improved with actual content analysis
    const estimatedTotalBytes = Math.max(this.totalBytes * 1.2, 1000);
    const progress = Math.min(95, (this.totalBytes / estimatedTotalBytes) * 100);

    // Estimate remaining time based on current throughput
    let estimatedRemainingMs = 0;
    if (elapsed > 0 && this.totalBytes > 0) {
      const bytesPerMs = this.totalBytes / elapsed;
      const remainingBytes = estimatedTotalBytes - this.totalBytes;
      estimatedRemainingMs = Math.max(0, remainingBytes / bytesPerMs);
    }

    // Determine latency trend by comparing recent vs older samples
    let latencyTrend: 'improving' | 'stable' | 'degrading' = 'stable';
    if (this.processingTimes.length >= 10) {
      const recentAvg = this.processingTimes.slice(-5).reduce((a, b) => a + b, 0) / 5;
      const olderAvg = this.processingTimes.slice(-10, -5).reduce((a, b) => a + b, 0) / 5;
      const diff = recentAvg - olderAvg;
      const threshold = olderAvg * 0.2; // 20% change threshold

      if (diff < -threshold) {
        latencyTrend = 'improving';
      } else if (diff > threshold) {
        latencyTrend = 'degrading';
      }
    }

    return {
      phase,
      progress,
      bytesReceived: this.totalBytes,
      chunksReceived: this.chunkCount,
      elapsedMs: elapsed,
      estimatedRemainingMs,
      latencyTrend,
    };
  }

  /**
   * Reset the processor for a new round
   * Optimized to reuse allocated arrays where possible
   */
  reset(): void {
    // Clear any pending timeout
    this.clearChunkTimeout();

    // Clear content buffers but keep array allocations
    this.contentBuffer.length = 0;
    this.rawContentBuffer.length = 0;
    this.accumulatedContent = '';
    this.rawContent = '';
    this.contentDirty = false;

    // Clear tool calls
    this.toolCallsMap.clear();

    // Reset batch state
    this.pendingBatch.length = 0;
    this.pendingBatchSize = 0;
    this.lastBatchFlushTime = 0;
    this.batchFlushCount = 0;

    // Reset backpressure state
    this.pendingEvents.length = 0;
    this.isBackpressured = false;
    this.backpressureEvents = 0;

    // Reset render throttling
    this.lastRenderTime = 0;
    this.pendingRenderContent = '';
    this.currentRenderThrottle = this.options.renderThrottleMs;
    this.renderDurations.length = 0;

    // Reset metrics
    this.startTime = 0;
    this.firstChunkTime = 0;
    this.processingTimes.length = 0;
    this.interChunkTimes.length = 0;
    this.lastChunkArrivalTime = 0;
    this.totalBytes = 0;
    this.chunkCount = 0;
    this.chunkTimeouts = 0;
    this.lastChunkProcessedTime = 0;
  }

  /**
   * Partial reset - keeps metrics but clears content
   * Useful for multi-turn conversations
   */
  softReset(): void {
    // Clear chunk timeout
    this.clearChunkTimeout();

    this.contentBuffer.length = 0;
    this.rawContentBuffer.length = 0;
    this.accumulatedContent = '';
    this.rawContent = '';
    this.contentDirty = false;
    this.toolCallsMap.clear();
    this.pendingBatch.length = 0;
    this.pendingBatchSize = 0;
    this.lastBatchFlushTime = 0;
    this.pendingEvents.length = 0;
    this.isBackpressured = false;
    this.pendingRenderContent = '';
  }

  /**
   * Get the number of chunk timeouts that occurred
   */
  getChunkTimeoutCount(): number {
    return this.chunkTimeouts;
  }

  /**
   * Update chunk timeout configuration dynamically
   */
  setChunkTimeout(timeoutMs: number): void {
    this.options.chunkTimeoutMs = timeoutMs;
    // If we have an active timeout, restart with new value
    if (this.chunkTimeoutTimer) {
      this.clearChunkTimeout();
      this.startChunkTimeout();
    }
  }
}
