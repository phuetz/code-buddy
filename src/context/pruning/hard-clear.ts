/**
 * Hard Clear
 *
 * Performs hard clearing of messages by replacing content
 * with a placeholder after TTL expires. Used for tool call
 * results that are no longer needed.
 */

import type { PruningConfig, PrunableMessage, ToolCallTimestamp } from './config.js';
import { DEFAULT_PRUNING_CONFIG } from './config.js';

// ============================================================================
// Placeholders
// ============================================================================

/**
 * Create a placeholder for cleared tool result
 */
export function createToolResultPlaceholder(
  toolName: string,
  toolCallId: string,
  originalLength: number
): string {
  return `[Tool result cleared: ${toolName} (${toolCallId}), ${originalLength} chars removed]`;
}

/**
 * Create a placeholder for cleared assistant message
 */
export function createAssistantPlaceholder(
  messageIndex: number,
  originalLength: number,
  summary?: string
): string {
  const base = `[Assistant message #${messageIndex} cleared, ${originalLength} chars removed]`;
  if (summary) {
    return `${base}\nSummary: ${summary}`;
  }
  return base;
}

/**
 * Create a placeholder for cleared tool call
 */
export function createToolCallPlaceholder(
  toolName: string,
  toolCallId: string
): string {
  return `[Tool call cleared: ${toolName} (${toolCallId})]`;
}

// ============================================================================
// Hard Clear Functions
// ============================================================================

/**
 * Hard clear a message, replacing content with a placeholder
 */
export function hardClearMessage(
  message: PrunableMessage,
  placeholder: string
): PrunableMessage {
  if (message.hardCleared) {
    return message;
  }

  return {
    ...message,
    content: placeholder,
    hardCleared: true,
    softTrimmed: false, // Reset soft trim flag
  };
}

/**
 * Hard clear messages with expired tool calls
 */
export function hardClearExpiredToolCalls(
  messages: PrunableMessage[],
  expiredToolCalls: ToolCallTimestamp[],
  _config: Partial<PruningConfig> = {}
): { messages: PrunableMessage[]; clearedCount: number; toolCallsCleared: string[] } {
  const expiredIds = new Set(expiredToolCalls.map(tc => tc.toolCallId));
  const toolCallsCleared: string[] = [];
  let clearedCount = 0;

  const clearedMessages = messages.map(msg => {
    // Check if message has any expired tool calls
    const hasExpired = msg.toolCallIds.some(id => expiredIds.has(id));

    if (!hasExpired || msg.hardCleared) {
      return msg;
    }

    // Find the tool call info
    const expiredToolCall = expiredToolCalls.find(tc =>
      msg.toolCallIds.includes(tc.toolCallId)
    );

    if (!expiredToolCall) {
      return msg;
    }

    // Clear the message
    const placeholder = createToolResultPlaceholder(
      expiredToolCall.toolName,
      expiredToolCall.toolCallId,
      msg.originalLength
    );

    toolCallsCleared.push(...msg.toolCallIds.filter(id => expiredIds.has(id)));
    clearedCount++;

    return hardClearMessage(msg, placeholder);
  });

  return {
    messages: clearedMessages,
    clearedCount,
    toolCallsCleared,
  };
}

/**
 * Hard clear old messages based on age
 */
export function hardClearOldMessages(
  messages: PrunableMessage[],
  config: Partial<PruningConfig> = {}
): { messages: PrunableMessage[]; clearedCount: number } {
  const cfg = { ...DEFAULT_PRUNING_CONFIG, ...config };

  // Skip if no max age is set
  if (cfg.maxMessageAge <= 0) {
    return { messages, clearedCount: 0 };
  }

  const now = Date.now();
  let clearedCount = 0;

  const clearedMessages = messages.map((msg, index) => {
    // Skip already cleared messages
    if (msg.hardCleared) {
      return msg;
    }

    // Skip system messages
    if (cfg.keepSystemMessages && msg.role === 'system') {
      return msg;
    }

    // Skip user messages
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

    // Check age
    const age = now - msg.timestamp;
    if (age <= cfg.maxMessageAge) {
      return msg;
    }

    // Clear the message
    const placeholder = createAssistantPlaceholder(
      msg.index,
      msg.originalLength
    );

    clearedCount++;

    return hardClearMessage(msg, placeholder);
  });

  return {
    messages: clearedMessages,
    clearedCount,
  };
}

/**
 * Check if a message should be hard cleared
 */
export function shouldHardClear(
  message: PrunableMessage,
  expiredToolCallIds: Set<string>,
  messages: PrunableMessage[],
  config: Partial<PruningConfig> = {}
): boolean {
  const cfg = { ...DEFAULT_PRUNING_CONFIG, ...config };

  // Already cleared
  if (message.hardCleared) {
    return false;
  }

  // Check if has expired tool calls
  if (message.toolCallIds.some(id => expiredToolCallIds.has(id))) {
    return true;
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

  // Check age
  if (cfg.maxMessageAge > 0) {
    const age = Date.now() - message.timestamp;
    if (age > cfg.maxMessageAge) {
      return true;
    }
  }

  return false;
}

/**
 * Combine hard clear operations
 */
export function applyHardClear(
  messages: PrunableMessage[],
  expiredToolCalls: ToolCallTimestamp[],
  config: Partial<PruningConfig> = {}
): { messages: PrunableMessage[]; clearedCount: number; toolCallsCleared: string[] } {
  // First clear expired tool calls
  const toolCallResult = hardClearExpiredToolCalls(messages, expiredToolCalls, config);

  // Then clear old messages
  const ageResult = hardClearOldMessages(toolCallResult.messages, config);

  return {
    messages: ageResult.messages,
    clearedCount: toolCallResult.clearedCount + ageResult.clearedCount,
    toolCallsCleared: toolCallResult.toolCallsCleared,
  };
}
