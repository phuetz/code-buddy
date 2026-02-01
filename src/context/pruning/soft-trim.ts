/**
 * Soft Trim
 *
 * Performs soft trimming of message content by keeping
 * the head and tail portions while removing the middle.
 * Preserves context while reducing token count.
 */

import type { PruningConfig, PrunableMessage } from './config.js';
import { DEFAULT_PRUNING_CONFIG } from './config.js';

// ============================================================================
// Soft Trim Functions
// ============================================================================

/**
 * Soft trim a string by keeping head and tail
 */
export function softTrimString(
  content: string,
  headChars: number = 1500,
  tailChars: number = 1500
): { trimmed: string; removed: number } {
  // Don't trim if content is short enough
  if (content.length <= headChars + tailChars + 100) {
    return { trimmed: content, removed: 0 };
  }

  const head = content.slice(0, headChars);
  const tail = content.slice(-tailChars);
  const removed = content.length - headChars - tailChars;

  const trimmed = `${head}\n\n[... ${removed} characters trimmed ...]\n\n${tail}`;

  return { trimmed, removed };
}

/**
 * Soft trim a message content
 */
export function softTrimContent(
  content: string | null | unknown,
  config: Partial<PruningConfig> = {}
): { content: string | null | unknown; removed: number; trimmed: boolean } {
  const cfg = { ...DEFAULT_PRUNING_CONFIG, ...config };

  // Handle null or non-string content
  if (content === null) {
    return { content: null, removed: 0, trimmed: false };
  }

  if (typeof content !== 'string') {
    // Try to handle arrays (multimodal content)
    if (Array.isArray(content)) {
      let totalRemoved = 0;
      const trimmedContent = content.map(part => {
        if (typeof part === 'object' && part !== null && 'text' in part) {
          const textPart = part as { text: string; [key: string]: unknown };
          const { trimmed, removed } = softTrimString(
            textPart.text,
            cfg.softTrimHeadChars,
            cfg.softTrimTailChars
          );
          totalRemoved += removed;
          return { ...textPart, text: trimmed };
        }
        return part;
      });
      return {
        content: trimmedContent,
        removed: totalRemoved,
        trimmed: totalRemoved > 0,
      };
    }

    // JSON stringify other content
    const str = JSON.stringify(content);
    if (str.length < cfg.minPrunableChars) {
      return { content, removed: 0, trimmed: false };
    }

    const { trimmed, removed } = softTrimString(
      str,
      cfg.softTrimHeadChars,
      cfg.softTrimTailChars
    );
    return { content: trimmed, removed, trimmed: removed > 0 };
  }

  // Handle string content
  if (content.length < cfg.minPrunableChars) {
    return { content, removed: 0, trimmed: false };
  }

  const { trimmed, removed } = softTrimString(
    content,
    cfg.softTrimHeadChars,
    cfg.softTrimTailChars
  );

  return { content: trimmed, removed, trimmed: removed > 0 };
}

/**
 * Soft trim a prunable message
 */
export function softTrimMessage(
  message: PrunableMessage,
  config: Partial<PruningConfig> = {}
): PrunableMessage {
  if (message.softTrimmed || message.hardCleared) {
    return message;
  }

  const { content, removed, trimmed } = softTrimContent(message.content, config);

  return {
    ...message,
    content,
    softTrimmed: trimmed,
  };
}

/**
 * Soft trim multiple messages
 */
export function softTrimMessages(
  messages: PrunableMessage[],
  config: Partial<PruningConfig> = {}
): { messages: PrunableMessage[]; totalRemoved: number; trimmedCount: number } {
  const cfg = { ...DEFAULT_PRUNING_CONFIG, ...config };

  let totalRemoved = 0;
  let trimmedCount = 0;

  const trimmedMessages = messages.map((msg, index) => {
    // Skip system messages if configured
    if (cfg.keepSystemMessages && msg.role === 'system') {
      return msg;
    }

    // Skip user messages if configured
    if (cfg.keepUserMessages && msg.role === 'user') {
      return msg;
    }

    // Skip last N assistant messages
    if (msg.role === 'assistant') {
      const assistantMessages = messages.filter(m => m.role === 'assistant');
      const assistantIndex = assistantMessages.indexOf(msg);
      if (assistantIndex >= assistantMessages.length - cfg.keepLastNAssistant) {
        return msg;
      }
    }

    // Check message age
    if (cfg.maxMessageAge > 0) {
      const age = Date.now() - msg.timestamp;
      if (age < cfg.maxMessageAge * 0.5) {
        // Don't trim messages that are less than 50% of max age
        return msg;
      }
    }

    const { content, removed, trimmed } = softTrimContent(msg.content, cfg);

    if (trimmed) {
      totalRemoved += removed;
      trimmedCount++;
    }

    return {
      ...msg,
      content,
      softTrimmed: trimmed,
    };
  });

  return {
    messages: trimmedMessages,
    totalRemoved,
    trimmedCount,
  };
}

/**
 * Check if a message should be soft trimmed based on configuration
 */
export function shouldSoftTrim(
  message: PrunableMessage,
  messages: PrunableMessage[],
  config: Partial<PruningConfig> = {}
): boolean {
  const cfg = { ...DEFAULT_PRUNING_CONFIG, ...config };

  // Already trimmed or cleared
  if (message.softTrimmed || message.hardCleared) {
    return false;
  }

  // Skip system messages
  if (cfg.keepSystemMessages && message.role === 'system') {
    return false;
  }

  // Skip user messages
  if (cfg.keepUserMessages && message.role === 'user') {
    return false;
  }

  // Skip last N assistant messages
  if (message.role === 'assistant') {
    const assistantMessages = messages.filter(m => m.role === 'assistant');
    const assistantIndex = assistantMessages.indexOf(message);
    if (assistantIndex >= assistantMessages.length - cfg.keepLastNAssistant) {
      return false;
    }
  }

  // Check content length
  const contentLength = typeof message.content === 'string'
    ? message.content.length
    : JSON.stringify(message.content).length;

  return contentLength >= cfg.minPrunableChars;
}
