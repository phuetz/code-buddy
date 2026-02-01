/**
 * Context Pruning Module
 *
 * Provides TTL-based pruning of context messages to manage
 * context window size. Includes soft trimming and hard clearing.
 */

// Configuration
export type {
  PruningConfig,
  ToolCallTimestamp,
  PrunableMessage,
  PruningResult,
  PruningEvents,
} from './config.js';

export { DEFAULT_PRUNING_CONFIG } from './config.js';

// TTL Manager
export { TTLManager, getTTLManager, resetTTLManager } from './ttl-manager.js';

// Soft Trim
export {
  softTrimString,
  softTrimContent,
  softTrimMessage,
  softTrimMessages,
  shouldSoftTrim,
} from './soft-trim.js';

// Hard Clear
export {
  createToolResultPlaceholder,
  createAssistantPlaceholder,
  createToolCallPlaceholder,
  hardClearMessage,
  hardClearExpiredToolCalls,
  hardClearOldMessages,
  shouldHardClear,
  applyHardClear,
} from './hard-clear.js';

// ============================================================================
// Main Pruning Function
// ============================================================================

import type { PruningConfig, PrunableMessage, PruningResult } from './config.js';
import { DEFAULT_PRUNING_CONFIG } from './config.js';
import { TTLManager, getTTLManager } from './ttl-manager.js';
import { softTrimMessages } from './soft-trim.js';
import { applyHardClear } from './hard-clear.js';
import { logger } from '../../utils/logger.js';

/**
 * Convert a ChatMessage-like object to PrunableMessage
 */
export function toPrunableMessage(
  message: {
    role: string;
    content: string | null | unknown;
    tool_calls?: Array<{ id: string }>;
  },
  index: number,
  timestamp: number = Date.now()
): PrunableMessage {
  const content = message.content;
  const originalLength = typeof content === 'string'
    ? content.length
    : content === null
    ? 0
    : JSON.stringify(content).length;

  const toolCallIds = message.tool_calls?.map(tc => tc.id) || [];

  return {
    index,
    role: message.role,
    content,
    originalLength,
    timestamp,
    toolCallIds,
    softTrimmed: false,
    hardCleared: false,
  };
}

/**
 * Convert PrunableMessage back to ChatMessage-like object
 */
export function fromPrunableMessage(message: PrunableMessage): {
  role: string;
  content: string | null | unknown;
} {
  return {
    role: message.role,
    content: message.content,
  };
}

/**
 * Apply full pruning pipeline to messages
 *
 * Pipeline:
 * 1. Get expired tool calls from TTL manager
 * 2. Hard clear messages with expired tool calls
 * 3. Soft trim remaining large messages
 */
export function pruneMessages(
  messages: PrunableMessage[],
  config: Partial<PruningConfig> = {}
): PruningResult {
  const cfg = { ...DEFAULT_PRUNING_CONFIG, ...config };
  const ttlManager = getTTLManager(cfg);

  logger.debug('Starting context pruning', {
    messageCount: messages.length,
    ttlMs: cfg.ttlMs,
  });

  // Step 1: Get expired tool calls
  const expiredToolCalls = ttlManager.getExpiredToolCalls();

  // Step 2: Hard clear expired tool call results
  const hardClearResult = applyHardClear(messages, expiredToolCalls, cfg);

  // Mark tool calls as pruned
  ttlManager.markManyPruned(hardClearResult.toolCallsCleared);

  // Step 3: Soft trim remaining large messages
  const softTrimResult = softTrimMessages(hardClearResult.messages, cfg);

  logger.debug('Pruning complete', {
    hardCleared: hardClearResult.clearedCount,
    softTrimmed: softTrimResult.trimmedCount,
    toolCallsPruned: hardClearResult.toolCallsCleared.length,
    charactersRemoved: softTrimResult.totalRemoved,
  });

  return {
    messages: softTrimResult.messages,
    softTrimmedCount: softTrimResult.trimmedCount,
    hardClearedCount: hardClearResult.clearedCount,
    charactersRemoved: softTrimResult.totalRemoved,
    toolCallsPruned: hardClearResult.toolCallsCleared,
  };
}

/**
 * Register tool calls for TTL tracking
 */
export function registerToolCalls(
  toolCalls: Array<{ id: string; function: { name: string } }>,
  messageIndex: number,
  config: Partial<PruningConfig> = {}
): void {
  const ttlManager = getTTLManager(config);

  for (const toolCall of toolCalls) {
    ttlManager.registerToolCall(
      toolCall.id,
      toolCall.function.name,
      messageIndex
    );
  }
}

/**
 * Check if pruning is needed based on message count and age
 */
export function shouldPrune(
  messages: PrunableMessage[],
  config: Partial<PruningConfig> = {}
): boolean {
  const cfg = { ...DEFAULT_PRUNING_CONFIG, ...config };
  const ttlManager = getTTLManager(cfg);

  // Check for expired tool calls
  const expiredToolCalls = ttlManager.getExpiredToolCalls();
  if (expiredToolCalls.length > 0) {
    return true;
  }

  // Check for large messages that could be soft trimmed
  const largeMsgCount = messages.filter(m => {
    if (m.softTrimmed || m.hardCleared) return false;
    const len = typeof m.content === 'string'
      ? m.content.length
      : JSON.stringify(m.content).length;
    return len >= cfg.minPrunableChars;
  }).length;

  if (largeMsgCount > 0) {
    return true;
  }

  // Check for old messages
  if (cfg.maxMessageAge > 0) {
    const now = Date.now();
    const oldMsgCount = messages.filter(m => {
      if (m.hardCleared) return false;
      return now - m.timestamp > cfg.maxMessageAge;
    }).length;

    if (oldMsgCount > 0) {
      return true;
    }
  }

  return false;
}

/**
 * Get pruning statistics
 */
export function getPruningStats(
  messages: PrunableMessage[],
  config: Partial<PruningConfig> = {}
): {
  totalMessages: number;
  softTrimmed: number;
  hardCleared: number;
  prunableCount: number;
  ttlStats: ReturnType<TTLManager['getStats']>;
} {
  const cfg = { ...DEFAULT_PRUNING_CONFIG, ...config };
  const ttlManager = getTTLManager(cfg);

  const softTrimmed = messages.filter(m => m.softTrimmed).length;
  const hardCleared = messages.filter(m => m.hardCleared).length;
  const prunableCount = messages.filter(m => {
    if (m.softTrimmed || m.hardCleared) return false;
    const len = typeof m.content === 'string'
      ? m.content.length
      : m.content === null
      ? 0
      : JSON.stringify(m.content).length;
    return len >= cfg.minPrunableChars;
  }).length;

  return {
    totalMessages: messages.length,
    softTrimmed,
    hardCleared,
    prunableCount,
    ttlStats: ttlManager.getStats(),
  };
}
