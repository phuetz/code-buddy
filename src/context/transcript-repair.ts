/**
 * Transcript Repair — Post-compaction validation
 *
 * After compaction, validates that every tool_result has a corresponding
 * tool_call, and vice versa. LLM providers reject malformed transcripts
 * (e.g., orphaned tool results without their calling assistant message).
 *
 * Native Engine v2026.3.11 alignment.
 */

import type { CodeBuddyMessage } from '../codebuddy/client.js';
import { hasToolCalls } from '../codebuddy/client.js';
import { logger } from '../utils/logger.js';

/**
 * Repair tool call/result pairing in a message transcript by CANONICAL
 * REBUILD: every tool result is re-emitted directly after the assistant
 * message that called it — the layout providers actually require.
 *
 * Handles, in one pass over corrupted transcripts (all observed after
 * compaction or provider hiccups):
 *  1. Orphaned tool results (tool_call_id with no surviving call) — removed.
 *  2. tool_calls that lost their result — a synthetic result is injected.
 *  3. Id-less tool_calls — stripped (they can never be paired; a provider
 *     rejects them); an assistant left with zero calls loses the property.
 *  4. Duplicate tool_call ids across assistants — first occurrence wins,
 *     later duplicates are stripped (an id shared by two calls is protocol
 *     corruption with no unambiguous repair).
 *  5. Duplicate results for one id — first wins.
 *  6. Results ordered BEFORE their call — relocated to the canonical slot.
 *
 * Idempotent: repairing a repaired transcript is a no-op.
 *
 * @returns Repaired message array (new array, original not mutated).
 */
export function repairToolCallPairs(messages: CodeBuddyMessage[]): CodeBuddyMessage[] {
  // Pass A — decide the valid call ids (dedupe: first assistant occurrence
  // wins) and index each id's FIRST result.
  const validCallIds = new Set<string>();
  let strippedCalls = 0;
  for (const msg of messages) {
    if (hasToolCalls(msg)) {
      for (const tc of msg.tool_calls) {
        if (!tc.id || validCallIds.has(tc.id)) {
          strippedCalls++;
          continue;
        }
        validCallIds.add(tc.id);
      }
    }
  }

  const resultsById = new Map<string, CodeBuddyMessage>();
  let removedOrphans = 0;
  let duplicateResults = 0;
  for (const msg of messages) {
    if (msg.role !== 'tool') continue;
    const callId = (msg as { tool_call_id?: string }).tool_call_id;
    if (!callId || !validCallIds.has(callId)) {
      removedOrphans++;
    } else if (resultsById.has(callId)) {
      duplicateResults++;
    } else {
      resultsById.set(callId, msg);
    }
  }

  // Pass B — rebuild: non-tool messages keep their order; each assistant's
  // valid calls are followed immediately by their (real or synthetic) results.
  const seenCallIds = new Set<string>();
  const result: CodeBuddyMessage[] = [];
  let injectedSynthetics = 0;
  for (const msg of messages) {
    if (msg.role === 'tool') continue; // re-emitted in their canonical slot

    if (hasToolCalls(msg)) {
      const validCalls = msg.tool_calls.filter(tc => {
        if (!tc.id || seenCallIds.has(tc.id)) return false;
        seenCallIds.add(tc.id);
        return true;
      });
      if (validCalls.length === 0) {
        // No pairable calls left — emit as a plain assistant message.
        const { tool_calls: _stripped, ...rest } = msg as CodeBuddyMessage & { tool_calls?: unknown };
        result.push(rest as CodeBuddyMessage);
        continue;
      }
      result.push(
        validCalls.length === msg.tool_calls.length ? msg : ({ ...msg, tool_calls: validCalls } as CodeBuddyMessage),
      );
      for (const tc of validCalls) {
        const existing = resultsById.get(tc.id!);
        if (existing) {
          result.push(existing);
        } else {
          result.push({
            role: 'tool',
            tool_call_id: tc.id,
            name: tc.function.name,
            content: '[result lost during compaction]',
          } as CodeBuddyMessage);
          injectedSynthetics++;
        }
      }
      continue;
    }

    result.push(msg);
  }

  if (removedOrphans > 0 || injectedSynthetics > 0 || strippedCalls > 0 || duplicateResults > 0) {
    logger.info(
      `Transcript repair: removed ${removedOrphans} orphaned tool results, ` +
      `injected ${injectedSynthetics} synthetic results, ` +
      `stripped ${strippedCalls} unpairable tool calls, ` +
      `dropped ${duplicateResults} duplicate results`
    );
  }

  return result;
}
