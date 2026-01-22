/**
 * Streaming Module
 *
 * Comprehensive streaming utilities for handling async data streams
 * with support for transformations, backpressure, and error recovery.
 *
 * Key features:
 * - Per-chunk timeout handling for latency control
 * - Adaptive render throttling for smooth UI updates
 * - Detailed latency metrics with percentiles (p50/p95/p99)
 * - Flow hints for consumer feedback
 * - Native Node.js stream integration
 * - Backpressure handling for flow control
 */

export { StreamProcessor, StreamProcessorOptions } from './stream-processor.js';
export * from './types.js';
export {
  ChunkProcessor,
  ChunkTimeoutError,
  StreamingMetrics,
  OptimizedChunkProcessorOptions,
  FlowHint,
} from './chunk-processor.js';
export {
  StreamHandler,
  StreamHandlerOptions,
  ExtendedStreamStats,
} from './stream-handler.js';
export { ChunkHandler } from './chunk-handler.js';
export { StreamTransformer, TransformFunction } from './stream-transformer.js';
export { BackpressureController, BackpressureOptions } from './backpressure.js';
