/**
 * Message History Self-Repair (Vibe-inspired)
 *
 * Cleans and repairs malformed message sequences before sending to the LLM.
 * Fixes orphaned tool results, missing assistant messages, duplicate roles,
 * and other common issues that cause API errors.
 */

import { logger } from '../utils/logger.js';

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  name?: string;
}

export interface RepairResult {
  messages: LLMMessage[];
  repaired: boolean;
  repairs: string[];
}

/**
 * Repair a message history to ensure it's valid for LLM API calls.
 *
 * Fixes:
 * 1. Orphaned tool results (tool message without preceding assistant tool_call)
 * 2. Missing tool results (assistant with tool_calls but no following tool messages)
 * 3. Consecutive same-role messages (merge or insert bridge)
 * 4. Empty content messages
 * 5. First message must be system or user
 */
export function repairMessageHistory(messages: LLMMessage[]): RepairResult {
  if (messages.length === 0) {
    return { messages: [], repaired: false, repairs: [] };
  }

  const repairs: string[] = [];
  let result = [...messages.map(m => ({ ...m }))]; // deep-ish copy

  // Pass 1: Remove empty content messages (except tool_calls assistants)
  result = result.filter((msg, i) => {
    if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
      return true; // Keep even if content is null
    }
    if (msg.content === null || msg.content === undefined || msg.content === '') {
      if (msg.role !== 'assistant') {
        repairs.push(`Removed empty ${msg.role} message at position ${i}`);
        return false;
      }
    }
    return true;
  });

  // Pass 2: Fix orphaned tool messages
  const fixed: LLMMessage[] = [];
  for (let i = 0; i < result.length; i++) {
    const msg = result[i];

    if (msg.role === 'tool') {
      // Check if there's a preceding assistant with matching tool_call
      const hasParent = fixed.some(
        m => m.role === 'assistant' &&
          m.tool_calls?.some(tc => tc.id === msg.tool_call_id)
      );

      if (!hasParent) {
        // Insert a synthetic assistant message with the tool call
        const toolCallId = msg.tool_call_id || `synthetic_${Date.now()}_${i}`;
        msg.tool_call_id = toolCallId;

        fixed.push({
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: toolCallId,
            type: 'function',
            function: {
              name: msg.name || 'unknown_tool',
              arguments: '{}',
            },
          }],
        });
        repairs.push(`Inserted synthetic assistant for orphaned tool result at position ${i}`);
      }
    }

    fixed.push(msg);
  }
  result = fixed;

  // Pass 3: Fill missing tool results (idempotent - won't duplicate synthetic results)
  const SYNTHETIC_MARKER = '[No result recorded]';
  for (let i = 0; i < result.length; i++) {
    const msg = result[i];
    if (msg.role === 'assistant' && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        // Check if there's a corresponding tool result after this message (real or synthetic)
        const hasResult = result.slice(i + 1).some(
          m => m.role === 'tool' && m.tool_call_id === tc.id
        );

        if (!hasResult) {
          // Find where to insert (right after current assistant or after last tool result)
          let insertIdx = i + 1;
          while (insertIdx < result.length && result[insertIdx].role === 'tool') {
            insertIdx++;
          }

          result.splice(insertIdx, 0, {
            role: 'tool',
            content: SYNTHETIC_MARKER,
            tool_call_id: tc.id,
            name: tc.function.name,
          });
          repairs.push(`Inserted missing tool result for ${tc.function.name} (${tc.id})`);
        }
      }
    }
  }

  // Pass 4: Merge consecutive user messages
  const merged: LLMMessage[] = [];
  for (const msg of result) {
    const prev = merged[merged.length - 1];
    if (prev && prev.role === 'user' && msg.role === 'user') {
      prev.content = ((prev.content ?? '') + '\n' + (msg.content ?? '')).trim() || null;
      repairs.push('Merged consecutive user messages');
    } else {
      merged.push(msg);
    }
  }
  result = merged;

  // Pass 5: Ensure first non-system message is user
  const firstNonSystem = result.findIndex(m => m.role !== 'system');
  if (firstNonSystem >= 0 && result[firstNonSystem].role !== 'user') {
    result.splice(firstNonSystem, 0, {
      role: 'user',
      content: '[Session resumed]',
    });
    repairs.push('Inserted user message at start of conversation');
  }

  if (repairs.length > 0) {
    logger.debug('Message history repaired', { repairCount: repairs.length, repairs });
  }

  return {
    messages: result,
    repaired: repairs.length > 0,
    repairs,
  };
}
