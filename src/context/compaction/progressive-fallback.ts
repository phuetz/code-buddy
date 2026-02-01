/**
 * Progressive Fallback
 *
 * Handles cases where summarization produces oversized results.
 * Uses progressive strategies to reduce content size while
 * preserving as much information as possible.
 */

import type { ChatMessage } from '../../types/index.js';
import type { CompactionConfig, CompactionResult } from './types.js';
import { DEFAULT_COMPACTION_CONFIG } from './types.js';
import { countTokens, countMessageTokens } from '../token-counter.js';
import { truncateText } from './parallel-summarizer.js';
import { logger } from '../../utils/logger.js';

// ============================================================================
// Fallback Strategies
// ============================================================================

/**
 * Strategy for reducing content size
 */
export type FallbackStrategy = 'truncate' | 'remove-middle' | 'extract-key' | 'aggressive-truncate';

/**
 * Fallback result
 */
export interface FallbackResult {
  content: string;
  tokenCount: number;
  strategy: FallbackStrategy;
  originalTokens: number;
  compressionRatio: number;
}

/**
 * Apply truncation fallback
 */
export function applyTruncation(
  content: string,
  targetTokens: number,
  config: Partial<CompactionConfig> = {},
  model: string = 'gpt-4'
): FallbackResult {
  const cfg = { ...DEFAULT_COMPACTION_CONFIG, ...config };
  const originalTokens = countTokens(content, model);

  // Calculate approximate char ratio
  const charPerToken = content.length / originalTokens;
  const targetChars = targetTokens * charPerToken;

  // Split between head and tail
  const headChars = Math.max(cfg.truncateHeadChars, Math.floor(targetChars * 0.6));
  const tailChars = Math.max(cfg.truncateTailChars, Math.floor(targetChars * 0.4));

  const truncated = truncateText(content, headChars, tailChars);
  const tokenCount = countTokens(truncated, model);

  return {
    content: truncated,
    tokenCount,
    strategy: 'truncate',
    originalTokens,
    compressionRatio: 1 - (tokenCount / originalTokens),
  };
}

/**
 * Remove middle content (keep head and tail with more aggressive ratios)
 */
export function removeMiddle(
  content: string,
  targetTokens: number,
  model: string = 'gpt-4'
): FallbackResult {
  const originalTokens = countTokens(content, model);
  const charPerToken = content.length / originalTokens;
  const targetChars = Math.floor(targetTokens * charPerToken);

  // 70% head, 30% tail
  const headChars = Math.floor(targetChars * 0.7);
  const tailChars = Math.floor(targetChars * 0.3);

  const head = content.slice(0, headChars);
  const tail = content.slice(-tailChars);
  const removedCount = content.length - headChars - tailChars;

  const result = `${head}\n\n[... ${removedCount} characters removed ...]\n\n${tail}`;
  const tokenCount = countTokens(result, model);

  return {
    content: result,
    tokenCount,
    strategy: 'remove-middle',
    originalTokens,
    compressionRatio: 1 - (tokenCount / originalTokens),
  };
}

/**
 * Extract only key information (most aggressive)
 */
export function extractKeyInfo(
  content: string,
  targetTokens: number,
  model: string = 'gpt-4'
): FallbackResult {
  const originalTokens = countTokens(content, model);
  const charPerToken = content.length / originalTokens;
  const targetChars = Math.floor(targetTokens * charPerToken);

  // Extract sentences with important keywords
  const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 20);

  const keywordScores: Array<{ sentence: string; score: number }> = [];

  for (const sentence of sentences) {
    let score = 0;
    const lower = sentence.toLowerCase();

    // High importance keywords
    if (lower.includes('error') || lower.includes('bug')) score += 5;
    if (lower.includes('fix') || lower.includes('solution')) score += 4;
    if (lower.includes('important') || lower.includes('critical')) score += 4;
    if (lower.includes('decided') || lower.includes('decision')) score += 3;
    if (lower.includes('todo') || lower.includes('need to')) score += 3;
    if (lower.includes('created') || lower.includes('added')) score += 2;
    if (lower.includes('modified') || lower.includes('changed')) score += 2;
    if (lower.includes('file') || lower.includes('function')) score += 1;

    // Code indicators
    if (sentence.includes('`') || sentence.includes('()')) score += 2;

    if (score > 0) {
      keywordScores.push({ sentence: sentence.trim(), score });
    }
  }

  // Sort by score and build result within target
  keywordScores.sort((a, b) => b.score - a.score);

  const selected: string[] = [];
  let currentLength = 0;

  for (const item of keywordScores) {
    if (currentLength + item.sentence.length + 2 <= targetChars) {
      selected.push(item.sentence);
      currentLength += item.sentence.length + 2;
    }
  }

  // If no key sentences found, fall back to aggressive truncation
  if (selected.length === 0) {
    return aggressiveTruncate(content, targetTokens, model);
  }

  const result = `[Key information extracted]\n${selected.join('. ')}.`;
  const tokenCount = countTokens(result, model);

  return {
    content: result,
    tokenCount,
    strategy: 'extract-key',
    originalTokens,
    compressionRatio: 1 - (tokenCount / originalTokens),
  };
}

/**
 * Aggressive truncation (last resort)
 */
export function aggressiveTruncate(
  content: string,
  targetTokens: number,
  model: string = 'gpt-4'
): FallbackResult {
  const originalTokens = countTokens(content, model);
  const charPerToken = content.length / originalTokens;
  const targetChars = Math.floor(targetTokens * charPerToken * 0.9); // 10% margin

  const truncated = content.slice(0, targetChars);
  const result = `${truncated}\n\n[... content truncated ...]`;
  const tokenCount = countTokens(result, model);

  return {
    content: result,
    tokenCount,
    strategy: 'aggressive-truncate',
    originalTokens,
    compressionRatio: 1 - (tokenCount / originalTokens),
  };
}

// ============================================================================
// Progressive Fallback Pipeline
// ============================================================================

/**
 * Apply progressive fallback strategies until target is met
 */
export function applyProgressiveFallback(
  content: string,
  targetTokens: number,
  config: Partial<CompactionConfig> = {},
  model: string = 'gpt-4'
): FallbackResult {
  const strategies: Array<(content: string, target: number, model: string) => FallbackResult> = [
    (c, t, m) => applyTruncation(c, t, config, m),
    removeMiddle,
    extractKeyInfo,
    aggressiveTruncate,
  ];

  for (const strategy of strategies) {
    const result = strategy(content, targetTokens, model);

    if (result.tokenCount <= targetTokens) {
      logger.debug('Fallback strategy succeeded', {
        strategy: result.strategy,
        targetTokens,
        actualTokens: result.tokenCount,
        compressionRatio: result.compressionRatio,
      });
      return result;
    }

    // Reduce target for next iteration
    targetTokens = Math.floor(targetTokens * 0.8);
  }

  // Last resort: aggressive truncate with minimal target
  return aggressiveTruncate(content, targetTokens, model);
}

/**
 * Apply fallback to messages if summarization failed
 */
export function applyMessageFallback(
  messages: ChatMessage[],
  targetTokens: number,
  config: Partial<CompactionConfig> = {},
  model: string = 'gpt-4'
): CompactionResult {
  const startTime = Date.now();
  const cfg = { ...DEFAULT_COMPACTION_CONFIG, ...config };

  // Calculate original tokens
  let originalTokens = 0;
  for (const message of messages) {
    originalTokens += countMessageTokens(message, model);
  }

  // Format messages as text
  const text = messages
    .map(m => {
      const role = m.role.toUpperCase();
      const content = typeof m.content === 'string'
        ? m.content
        : JSON.stringify(m.content);
      return `[${role}]: ${content}`;
    })
    .join('\n\n');

  // Apply progressive fallback
  const fallbackResult = applyProgressiveFallback(text, targetTokens, cfg, model);

  // Create summary message
  const summaryMessage: ChatMessage = {
    role: 'system',
    content: `[Conversation Summary (fallback)]\n\n${fallbackResult.content}`,
  };

  const totalTokens = countMessageTokens(summaryMessage, model);

  return {
    messages: [summaryMessage],
    totalTokens,
    originalTokens,
    compressionRatio: 1 - (totalTokens / originalTokens),
    messagesCompacted: messages.length,
    memoriesFlushed: 0,
    usedFallback: true,
    duration: Date.now() - startTime,
  };
}
