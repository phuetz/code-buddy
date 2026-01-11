/**
 * Streaming Module
 *
 * Provides utilities for handling streaming responses from LLM APIs.
 *
 * @module agent/streaming
 */

export {
  StreamingHandler,
  sanitizeLLMOutput,
  extractCommentaryToolCalls,
  type StreamingConfig,
  type RawStreamingChunk,
  type ProcessedChunk,
  type ExtractedToolCallsResult,
  type AccumulatedMessage,
  type ExtractedToolCall,
} from './streaming-handler.js';

export { reduceStreamChunk } from './message-reducer.js';
