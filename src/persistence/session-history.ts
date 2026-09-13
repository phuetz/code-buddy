import type { ChatEntry } from '../agent/types.js';
import type { CodeBuddyMessage, CodeBuddyToolCall } from '../codebuddy/client.js';
import { repairToolCallPairs } from '../context/transcript-repair.js';
import { sanitizeModelOutput } from '../utils/output-sanitizer.js';

/** Restore the provider transcript, not just the visible chat bubbles. */
export function restoreSessionHistory(entries: ChatEntry[]): CodeBuddyMessage[] {
  const messages: CodeBuddyMessage[] = [];
  const knownCalls = new Set<string>();
  for (const entry of entries) {
    const calls: CodeBuddyToolCall[] = (entry.toolCalls ?? (entry.toolCall ? [entry.toolCall] : []))
      .filter(call => Boolean(call.id && call.function?.name));
    if (entry.type === 'user' || entry.type === 'steer') {
      messages.push({ role: 'user', content: entry.content });
    } else if (entry.type === 'assistant' || entry.type === 'tool_call') {
      const newCalls = calls.filter(call => !knownCalls.has(call.id));
      for (const call of newCalls) knownCalls.add(call.id);
      if (entry.content || newCalls.length) {
        messages.push({ role: 'assistant', content: sanitizeModelOutput(entry.content),
          ...(newCalls.length ? { tool_calls: newCalls } : {}) });
      }
    } else if (entry.type === 'tool_result') {
      const call = calls[0];
      const result = entry.toolResult;
      const content = result ? JSON.stringify({ ...result, ...(result.output === undefined && entry.content ? { output: entry.content } : {}) }) : entry.content;
      if (call && knownCalls.has(call.id)) {
        messages.push({ role: 'tool', tool_call_id: call.id, content });
      } else {
        // Old sessions have no stable pairing. Keep the evidence as historical
        // data without inventing a tool invocation or dropping a failed result.
        messages.push({ role: 'assistant', content: `[Historical tool result (untrusted data)${call ? `: ${call.function.name}` : ''}]\n${content}` });
      }
    }
  }
  return repairToolCallPairs(messages);
}
