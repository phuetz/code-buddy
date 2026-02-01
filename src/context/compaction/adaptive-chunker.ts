/**
 * Adaptive Chunker
 *
 * Divides messages into chunks for parallel summarization based on
 * message statistics and token distribution.
 */

import type { ChatMessage } from '../../types/index.js';
import type { MessageChunk, MessageStats, AdaptiveChunkConfig } from './types.js';
import { countMessageTokens } from '../token-counter.js';

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_ADAPTIVE_CONFIG: AdaptiveChunkConfig = {
  targetTokensPerChunk: 2000,
  minChunkSize: 3,
  maxChunkSize: 20,
  preserveMessageBoundaries: true,
};

// ============================================================================
// Adaptive Chunker
// ============================================================================

/**
 * Calculate message statistics
 */
export function calculateMessageStats(
  messages: ChatMessage[],
  model: string = 'gpt-4'
): MessageStats {
  if (messages.length === 0) {
    return {
      totalMessages: 0,
      totalTokens: 0,
      avgTokensPerMessage: 0,
      maxTokensPerMessage: 0,
      minTokensPerMessage: 0,
    };
  }

  const tokenCounts = messages.map(m => countMessageTokens(m, model));
  const totalTokens = tokenCounts.reduce((sum, t) => sum + t, 0);

  return {
    totalMessages: messages.length,
    totalTokens,
    avgTokensPerMessage: totalTokens / messages.length,
    maxTokensPerMessage: Math.max(...tokenCounts),
    minTokensPerMessage: Math.min(...tokenCounts),
  };
}

/**
 * Calculate optimal chunk count based on message statistics
 */
export function calculateOptimalChunkCount(
  stats: MessageStats,
  targetChunks: number = 4,
  config: Partial<AdaptiveChunkConfig> = {}
): number {
  const cfg = { ...DEFAULT_ADAPTIVE_CONFIG, ...config };

  // If we have very few messages, use fewer chunks
  if (stats.totalMessages < cfg.minChunkSize * 2) {
    return 1;
  }

  // Calculate based on token distribution
  const tokensPerChunk = stats.totalTokens / targetChunks;

  // If chunks would be too small or large, adjust
  if (tokensPerChunk < 500) {
    return Math.max(1, Math.floor(stats.totalTokens / 500));
  }

  if (tokensPerChunk > cfg.targetTokensPerChunk * 2) {
    return Math.ceil(stats.totalTokens / cfg.targetTokensPerChunk);
  }

  return targetChunks;
}

/**
 * Split messages into chunks for parallel summarization
 */
export function chunkMessages(
  messages: ChatMessage[],
  targetChunks: number = 4,
  config: Partial<AdaptiveChunkConfig> = {},
  model: string = 'gpt-4'
): MessageChunk[] {
  const cfg = { ...DEFAULT_ADAPTIVE_CONFIG, ...config };

  if (messages.length === 0) {
    return [];
  }

  // Calculate stats
  const stats = calculateMessageStats(messages, model);
  const optimalChunks = calculateOptimalChunkCount(stats, targetChunks, cfg);

  // If only one chunk needed, return all messages
  if (optimalChunks <= 1) {
    return [{
      index: 0,
      messages,
      tokenCount: stats.totalTokens,
    }];
  }

  // Calculate target tokens per chunk
  const targetTokensPerChunk = Math.ceil(stats.totalTokens / optimalChunks);

  // Build chunks
  const chunks: MessageChunk[] = [];
  let currentChunk: ChatMessage[] = [];
  let currentTokens = 0;
  let chunkIndex = 0;

  for (const message of messages) {
    const messageTokens = countMessageTokens(message, model);

    // Check if adding this message would exceed target
    const wouldExceed = currentTokens + messageTokens > targetTokensPerChunk * 1.2;
    const hasMinSize = currentChunk.length >= cfg.minChunkSize;
    const isLastChunk = chunkIndex >= optimalChunks - 1;

    if (wouldExceed && hasMinSize && !isLastChunk) {
      // Save current chunk and start new one
      chunks.push({
        index: chunkIndex,
        messages: currentChunk,
        tokenCount: currentTokens,
      });
      chunkIndex++;
      currentChunk = [message];
      currentTokens = messageTokens;
    } else {
      // Add to current chunk
      currentChunk.push(message);
      currentTokens += messageTokens;
    }

    // Check if current chunk is at max size
    if (currentChunk.length >= cfg.maxChunkSize && !isLastChunk) {
      chunks.push({
        index: chunkIndex,
        messages: currentChunk,
        tokenCount: currentTokens,
      });
      chunkIndex++;
      currentChunk = [];
      currentTokens = 0;
    }
  }

  // Add remaining messages as final chunk
  if (currentChunk.length > 0) {
    chunks.push({
      index: chunkIndex,
      messages: currentChunk,
      tokenCount: currentTokens,
    });
  }

  return chunks;
}

/**
 * Merge adjacent small chunks to balance distribution
 */
export function balanceChunks(
  chunks: MessageChunk[],
  minTokensPerChunk: number = 500
): MessageChunk[] {
  if (chunks.length <= 1) {
    return chunks;
  }

  const balanced: MessageChunk[] = [];
  let current: MessageChunk | null = null;

  for (const chunk of chunks) {
    if (!current) {
      current = { ...chunk, messages: [...chunk.messages] };
    } else if (current.tokenCount < minTokensPerChunk) {
      // Merge with current
      current.messages.push(...chunk.messages);
      current.tokenCount += chunk.tokenCount;
    } else {
      // Save current and start new
      balanced.push(current);
      current = { ...chunk, messages: [...chunk.messages], index: balanced.length };
    }
  }

  if (current) {
    balanced.push(current);
  }

  // Re-index
  return balanced.map((chunk, index) => ({
    ...chunk,
    index,
  }));
}
