/**
 * Multi-stage Compaction Types
 *
 * Types for the multi-stage context compaction system that uses
 * parallel summarization, adaptive chunking, and memory flushing.
 */

import type { ChatMessage } from '../../types/index.js';

// ============================================================================
// Compaction Configuration
// ============================================================================

/**
 * Compaction configuration
 */
export interface CompactionConfig {
  /** Number of parallel chunks for summarization (default: 4) */
  parallelChunks: number;
  /** Target compression ratio (default: 0.5 = 50% reduction) */
  targetRatio: number;
  /** Minimum messages required for compaction */
  minMessages: number;
  /** Maximum retries for oversized results */
  maxRetries: number;
  /** Whether to flush to memory before compaction */
  flushToMemory: boolean;
  /** Fallback truncation head characters */
  truncateHeadChars: number;
  /** Fallback truncation tail characters */
  truncateTailChars: number;
}

/**
 * Default compaction configuration
 */
export const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
  parallelChunks: 4,
  targetRatio: 0.5,
  minMessages: 10,
  maxRetries: 3,
  flushToMemory: true,
  truncateHeadChars: 1500,
  truncateTailChars: 1500,
};

// ============================================================================
// Compaction Types
// ============================================================================

/**
 * A chunk of messages to be summarized
 */
export interface MessageChunk {
  /** Chunk index */
  index: number;
  /** Messages in this chunk */
  messages: ChatMessage[];
  /** Total tokens in chunk */
  tokenCount: number;
}

/**
 * Result of summarizing a chunk
 */
export interface ChunkSummary {
  /** Chunk index */
  index: number;
  /** Summary text */
  summary: string;
  /** Token count of summary */
  tokenCount: number;
  /** Original token count */
  originalTokenCount: number;
  /** Compression ratio achieved */
  compressionRatio: number;
}

/**
 * Compaction result
 */
export interface CompactionResult {
  /** Compacted messages (system + summary + recent) */
  messages: ChatMessage[];
  /** Total tokens after compaction */
  totalTokens: number;
  /** Original token count */
  originalTokens: number;
  /** Compression ratio achieved */
  compressionRatio: number;
  /** Number of messages compacted */
  messagesCompacted: number;
  /** Memories flushed (if enabled) */
  memoriesFlushed: number;
  /** Whether fallback was used */
  usedFallback: boolean;
  /** Duration in milliseconds */
  duration: number;
}

/**
 * Memory entry to flush
 */
export interface FlushableMemory {
  /** Content to store */
  content: string;
  /** Type of memory */
  type: 'summary' | 'decision' | 'fact' | 'context';
  /** Importance score */
  importance: number;
  /** Associated tags */
  tags: string[];
}

// ============================================================================
// Adaptive Chunking Types
// ============================================================================

/**
 * Adaptive chunk configuration based on message statistics
 */
export interface AdaptiveChunkConfig {
  /** Target tokens per chunk */
  targetTokensPerChunk: number;
  /** Minimum chunk size */
  minChunkSize: number;
  /** Maximum chunk size */
  maxChunkSize: number;
  /** Whether to preserve message boundaries */
  preserveMessageBoundaries: boolean;
}

/**
 * Message statistics for adaptive chunking
 */
export interface MessageStats {
  /** Total messages */
  totalMessages: number;
  /** Total tokens */
  totalTokens: number;
  /** Average tokens per message */
  avgTokensPerMessage: number;
  /** Max tokens in a message */
  maxTokensPerMessage: number;
  /** Min tokens in a message */
  minTokensPerMessage: number;
}

// ============================================================================
// Events
// ============================================================================

/**
 * Compaction events
 */
export interface CompactionEvents {
  'compaction:started': { messageCount: number; tokenCount: number };
  'compaction:chunk-summarized': ChunkSummary;
  'compaction:memory-flushed': { count: number };
  'compaction:completed': CompactionResult;
  'compaction:fallback': { reason: string };
  'compaction:error': { error: Error };
}
