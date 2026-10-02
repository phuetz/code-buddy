import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';
import type { ChatEntry } from '../agent/types.js';

/** The same durable message shape for incremental NDJSON and final JSON. */
export function headlessMessage(entry: ChatEntry): ChatCompletionMessageParam | undefined {
  if (entry.type === 'user') return { role: 'user', content: entry.content };
  if (entry.type === 'assistant') {
    return {
      role: 'assistant', content: entry.content,
      ...(entry.toolCalls?.length ? { tool_calls: entry.toolCalls.map(call => ({
        id: call.id, type: 'function' as const, function: { name: call.function.name, arguments: call.function.arguments },
      })) } : {}),
    };
  }
  if (entry.type === 'tool_result' && entry.toolCall) {
    return { role: 'tool', tool_call_id: entry.toolCall.id, content: entry.content };
  }
  return undefined;
}
