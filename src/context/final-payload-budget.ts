/** The last guard before transport: count messages AND schemas after all hooks. */
import { createHash } from 'node:crypto';
import { countTokens } from './token-counter.js';
import { getRestorableCompressor } from './restorable-compression.js';
import type { OpenAiChatPayload } from '../codebuddy/providers/ollama-native-transport.js';

export interface PayloadRecoveryScope { workDir: string; sessionId?: string }
export class PayloadBudgetError extends Error {
  readonly code = 'CONTEXT_PAYLOAD';
  constructor(message: string) { super(message); this.name = 'PayloadBudgetError'; }
}

export function estimateFinalPayloadTokens(payload: Pick<OpenAiChatPayload, 'messages' | 'tools' | 'model'>): number {
  const serialized = JSON.stringify({ messages: payload.messages, tools: payload.tools ?? [] });
  // Runtime tokenizer is not always exposed. Use both encoding and UTF-8,
  // with a margin for the chat template and non-identical local tokenizers.
  // Bound encoder work for very long repeated runs (BPE can be quadratic).
  let encodedTokens = 0;
  for (let offset = 0; offset < serialized.length; offset += 4096) {
    encodedTokens += countTokens(serialized.slice(offset, offset + 4096), payload.model);
  }
  return Math.max(Math.ceil(encodedTokens * 1.25), Math.ceil(Buffer.byteLength(serialized) / 3))
    + payload.messages.length * 16;
}

export function budgetFinalPayload(payload: OpenAiChatPayload, contextWindow: number, scope: PayloadRecoveryScope, maxOutputTokens = contextWindow) {
  const outputTokens = Math.max(1, Math.min(payload.max_tokens ?? payload.max_completion_tokens ?? 4096, maxOutputTokens, contextWindow));
  const safetyTokens = 512;
  const inputBudget = contextWindow - outputTokens - safetyTokens;
  const next = structuredClone(payload);
  if (payload.max_completion_tokens !== undefined) {
    next.max_completion_tokens = outputTokens;
    delete next.max_tokens;
  } else next.max_tokens = outputTokens;
  const lastUser = next.messages.findLast(message => message.role === 'user');
  const beforeTokens = estimateFinalPayloadTokens(next);
  if (beforeTokens <= inputBudget) return { payload: next, beforeTokens, inputTokens: beforeTokens, outputTokens, safetyTokens };
  if (!lastUser) throw new PayloadBudgetError('Context payload has no user query. Restore the mission before retrying.');

  const original = JSON.stringify(payload);
  const identifier = `payload-${createHash('sha256').update(original).digest('hex').slice(0, 24)}`;
  const marker = `\n[Payload reduced. Use restore_context(identifier="${identifier}") to recover the original messages and schemas.]`;
  const recovery = getRestorableCompressor();
  recovery.capture(identifier, original, scope.workDir, scope.sessionId);
  let system = next.messages.find(message => message.role === 'system');
  if (!system) { system = { role: 'system', content: marker }; next.messages.unshift(system); }
  else system.content = (typeof system.content === 'string' ? system.content : '') + marker;

  // A newly read/restored observation must not immediately lose its middle
  // while old diagnostics occupy the window. Keep its whole call group.
  const recentCall = next.messages.findLast(message => message.role === 'assistant' && Array.isArray(message.tool_calls) && message.tool_calls.length > 0);
  const recentIds = new Set((Array.isArray(recentCall?.tool_calls) ? recentCall.tool_calls : []).map(call => call.id));
  const recentMessages = new Set(next.messages.filter(message => message === recentCall
    || (message.role === 'tool' && recentIds.has(message.tool_call_id))));

  // Keep protocol envelopes/IDs intact; only summarize older observations.
  for (const message of next.messages) {
    if (!recentMessages.has(message) && message.role === 'tool' && typeof message.content === 'string' && message.content.length > 2400) {
      message.content = message.content.slice(0, 1200) + marker + message.content.slice(-1200);
    }
  }
  // Evict old assistant/tool groups before erasing instructions/capabilities.
  // The current observation and last user query remain protected together.
  while (estimateFinalPayloadTokens(next) > inputBudget) {
    const index = next.messages.findIndex(message => message !== lastUser && message.role !== 'system' && !recentMessages.has(message));
    if (index < 0) break;
    const first = next.messages[index]!;
    const callIds = new Set((Array.isArray(first.tool_calls) ? first.tool_calls : []).map(call => call.id));
    next.messages = next.messages.filter((message, position) => position !== index && !(message.role === 'tool' && callIds.has(message.tool_call_id)));
  }
  // Only reduce the latest result when even user + tools + that group alone
  // cannot fit. An oversized system injection must not cause this reduction.
  const withoutSystems = { ...next, messages: next.messages.filter(message => message.role !== 'system') };
  if (estimateFinalPayloadTokens(withoutSystems) > inputBudget) {
    for (const message of recentMessages) {
      if (message.role === 'tool' && typeof message.content === 'string' && message.content.length > 2400) {
        message.content = message.content.slice(0, 1200) + marker + message.content.slice(-1200);
      }
    }
  }
  // Prefer the recent observation over huge project trees/injections. Each
  // removed system block remains in the session-scoped recovery snapshot.
  const systems = next.messages.filter(message => message.role === 'system' && typeof message.content === 'string')
    .sort((a, b) => String(b.content).length - String(a.content).length);
  for (const message of systems) {
    if (estimateFinalPayloadTokens(next) <= inputBudget) break;
    const text = String(message.content);
    let low = 0; let high = text.length;
    const render = (length: number) => text.slice(0, Math.ceil(length * 0.8)) + marker + (length > 0 ? text.slice(-Math.floor(length * 0.2)) : '');
    message.content = render(0);
    if (estimateFinalPayloadTokens(next) > inputBudget) continue;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2); message.content = render(middle);
      if (estimateFinalPayloadTokens(next) <= inputBudget) low = middle;
      else high = middle - 1;
    }
    message.content = render(low);
  }
  const inputTokens = estimateFinalPayloadTokens(next);
  if (inputTokens > inputBudget) throw new PayloadBudgetError(`Context payload exceeds ${contextWindow} tokens with the last user query preserved. Increase the runtime window or shorten the mission/schemas; no request sent.`);
  return { payload: next, beforeTokens, inputTokens, outputTokens, safetyTokens, identifier };
}
