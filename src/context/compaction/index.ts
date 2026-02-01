/**
 * Multi-stage Compaction Module
 *
 * Provides context compaction through parallel summarization,
 * adaptive chunking, memory flushing, and progressive fallback.
 */

// Types
export type {
  CompactionConfig,
  MessageChunk,
  ChunkSummary,
  CompactionResult,
  FlushableMemory,
  AdaptiveChunkConfig,
  MessageStats,
  CompactionEvents,
} from './types.js';

export { DEFAULT_COMPACTION_CONFIG } from './types.js';

// Adaptive Chunker
export {
  calculateMessageStats,
  calculateOptimalChunkCount,
  chunkMessages,
  balanceChunks,
} from './adaptive-chunker.js';

// Parallel Summarizer
export type { Summarizer } from './parallel-summarizer.js';
export {
  LocalSummarizer,
  summarizeChunksParallel,
  mergeSummaries,
  truncateText,
  defaultSummarizer,
} from './parallel-summarizer.js';

// Memory Flush
export {
  extractFlushableMemories,
  flushToMemory,
  flushMessagesToMemory,
} from './memory-flush.js';

// Progressive Fallback
export type { FallbackStrategy, FallbackResult } from './progressive-fallback.js';
export {
  applyTruncation,
  removeMiddle,
  extractKeyInfo,
  aggressiveTruncate,
  applyProgressiveFallback,
  applyMessageFallback,
} from './progressive-fallback.js';

// ============================================================================
// Main Compaction Function
// ============================================================================

import type { ChatMessage } from '../../types/index.js';
import type { CompactionConfig, CompactionResult } from './types.js';
import { DEFAULT_COMPACTION_CONFIG } from './types.js';
import { chunkMessages, balanceChunks } from './adaptive-chunker.js';
import { summarizeChunksParallel, mergeSummaries, defaultSummarizer, type Summarizer } from './parallel-summarizer.js';
import { flushMessagesToMemory } from './memory-flush.js';
import { applyMessageFallback } from './progressive-fallback.js';
import { countMessageTokens } from '../token-counter.js';
import { logger } from '../../utils/logger.js';

/**
 * Compact messages using multi-stage approach
 *
 * Algorithm:
 * 1. Optionally flush important context to EnhancedMemory
 * 2. Split messages into adaptive chunks
 * 3. Summarize each chunk in parallel
 * 4. Merge summaries
 * 5. If oversized, apply progressive fallback
 */
export async function compactMessages(
  messages: ChatMessage[],
  targetTokens: number,
  options: {
    config?: Partial<CompactionConfig>;
    summarizer?: Summarizer;
    model?: string;
    projectId?: string;
    sessionId?: string;
  } = {}
): Promise<CompactionResult> {
  const startTime = Date.now();
  const config = { ...DEFAULT_COMPACTION_CONFIG, ...options.config };
  const summarizer = options.summarizer ?? defaultSummarizer;
  const model = options.model ?? 'gpt-4';

  // Calculate original tokens
  let originalTokens = 0;
  for (const message of messages) {
    originalTokens += countMessageTokens(message, model);
  }

  // Skip if not enough messages
  if (messages.length < config.minMessages) {
    return {
      messages,
      totalTokens: originalTokens,
      originalTokens,
      compressionRatio: 0,
      messagesCompacted: 0,
      memoriesFlushed: 0,
      usedFallback: false,
      duration: Date.now() - startTime,
    };
  }

  logger.debug('Starting multi-stage compaction', {
    messageCount: messages.length,
    originalTokens,
    targetTokens,
  });

  // Step 1: Flush to memory if enabled
  let memoriesFlushed = 0;
  if (config.flushToMemory) {
    try {
      memoriesFlushed = await flushMessagesToMemory(messages, {
        projectId: options.projectId,
        sessionId: options.sessionId,
      });
      logger.debug('Flushed memories before compaction', { memoriesFlushed });
    } catch (error) {
      logger.warn('Memory flush failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Step 2: Chunk messages adaptively
  let chunks = chunkMessages(messages, config.parallelChunks, {}, model);
  chunks = balanceChunks(chunks);

  logger.debug('Created message chunks', {
    chunkCount: chunks.length,
    tokenDistribution: chunks.map(c => c.tokenCount),
  });

  // Step 3: Summarize chunks in parallel
  let retryCount = 0;

  while (retryCount < config.maxRetries) {
    try {
      const summaries = await summarizeChunksParallel(chunks, summarizer, model);
      const { merged, tokenCount } = mergeSummaries(summaries, model);

      // Check if within target
      if (tokenCount <= targetTokens) {
        // Create summary message
        const summaryMessage: ChatMessage = {
          role: 'system',
          content: `[Conversation Summary]\n\n${merged}`,
        };

        const totalTokens = countMessageTokens(summaryMessage, model);

        logger.debug('Compaction successful', {
          totalTokens,
          originalTokens,
          compressionRatio: 1 - (totalTokens / originalTokens),
          retries: retryCount,
        });

        return {
          messages: [summaryMessage],
          totalTokens,
          originalTokens,
          compressionRatio: 1 - (totalTokens / originalTokens),
          messagesCompacted: messages.length,
          memoriesFlushed,
          usedFallback: false,
          duration: Date.now() - startTime,
        };
      }

      // Still oversized, increase chunks and retry
      retryCount++;
      chunks = chunkMessages(messages, config.parallelChunks * (retryCount + 1), {}, model);
      chunks = balanceChunks(chunks);

      logger.debug('Summary oversized, retrying with more chunks', {
        tokenCount,
        targetTokens,
        newChunkCount: chunks.length,
        retry: retryCount,
      });
    } catch (error) {
      logger.warn('Summarization failed', {
        error: error instanceof Error ? error.message : String(error),
        retry: retryCount,
      });
      retryCount++;
    }
  }

  // Step 4: Apply progressive fallback
  logger.debug('Applying progressive fallback');

  const fallbackResult = applyMessageFallback(messages, targetTokens, config, model);

  return {
    ...fallbackResult,
    memoriesFlushed,
    duration: Date.now() - startTime,
  };
}
