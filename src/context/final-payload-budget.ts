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

/** Old assistant/tool groups evicted together (see budgetFinalPayload). */
export const EVICTION_CHUNK = 8;

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
  const marker = '\n[Older context reduced to fit the window. Reduced observations carry individual recovery references.]';
  const recovery = getRestorableCompressor();
  // Keep the complete snapshot for diagnostics, but never suggest restoring a
  // whole request into a tool result: that recursively duplicates the history.
  recovery.capture(identifier, original, scope.workDir, scope.sessionId);
  const contentMarker = (content: string): string => {
    const key = `payload-content-${createHash('sha256').update(content).digest('hex').slice(0, 24)}`;
    recovery.capture(key, content, scope.workDir, scope.sessionId);
    return `\n[Content reduced. Use restore_context(identifier="${key}") to recover this content only.]\n`;
  };
  let system = next.messages.find(message => message.role === 'system');
  if (!system) { system = { role: 'system', content: marker }; next.messages.unshift(system); }
  else system.content = (typeof system.content === 'string' ? system.content : '') + marker;

  // A newly read/restored observation must not immediately lose its middle
  // while old diagnostics occupy the window. Keep its whole call group.
  const recentCall = next.messages.findLast(message => message.role === 'assistant' && Array.isArray(message.tool_calls) && message.tool_calls.length > 0);
  const recentIds = new Set((Array.isArray(recentCall?.tool_calls) ? recentCall.tool_calls : []).map(call => call.id));
  const recentMessages = new Set(next.messages.filter(message => message === recentCall
    || (message.role === 'tool' && recentIds.has(message.tool_call_id))));

  // Schemas and transport framing can trigger pressure even when the earlier
  // context pass fitted. Retire completed native reasoning before evicting
  // its findings; preserve the current tool round's thinking byte for byte.
  // All completed reasoning goes at once: this pass is stateless, and removing
  // "just enough" moved the cut one message further on every request, so a
  // local runtime re-evaluated the whole prompt each turn (banc harnais 03/10,
  // A-27b : 117 s d'évaluation par tour au lieu de ~3 s avec le cache).
  for (const message of next.messages) {
    if (message.role === 'assistant' && !recentMessages.has(message) && message.ollama_thinking) {
      delete message.ollama_thinking;
    }
  }
  const afterThinkingTokens = estimateFinalPayloadTokens(next);
  if (afterThinkingTokens <= inputBudget) {
    return { payload: next, beforeTokens, inputTokens: afterThinkingTokens, outputTokens, safetyTokens, identifier };
  }

  // Keep protocol envelopes/IDs intact; only summarize older observations.
  for (const message of next.messages) {
    if (!recentMessages.has(message) && message.role === 'tool' && typeof message.content === 'string' && message.content.length > 2400) {
      message.content = message.content.slice(0, 1200) + contentMarker(message.content) + message.content.slice(-1200);
    }
  }
  // Evict old assistant/tool groups before erasing instructions/capabilities.
  // The current observation and last user query remain protected together.
  // Groups go by chunks of EVICTION_CHUNK so that the following requests,
  // whose history only grows at the tail, keep exactly the same head and the
  // same cut until a whole new chunk is needed (prompt-cache stability).
  let evictedGroups = 0;
  const evictOldestGroup = (): boolean => {
    const index = next.messages.findIndex(message => message !== lastUser && message.role !== 'system' && !recentMessages.has(message));
    if (index < 0) return false;
    const first = next.messages[index]!;
    const callIds = new Set((Array.isArray(first.tool_calls) ? first.tool_calls : []).map(call => call.id));
    next.messages = next.messages.filter((message, position) => position !== index && !(message.role === 'tool' && callIds.has(message.tool_call_id)));
    evictedGroups += 1;
    return true;
  };
  while (estimateFinalPayloadTokens(next) > inputBudget) {
    if (!evictOldestGroup()) break;
  }
  while (evictedGroups > 0 && evictedGroups % EVICTION_CHUNK !== 0) {
    if (!evictOldestGroup()) break;
  }
  // Only reduce the latest result when even user + tools + that group alone
  // cannot fit. An oversized system injection must not cause this reduction.
  const withoutSystems = { ...next, messages: next.messages.filter(message => message.role !== 'system') };
  if (estimateFinalPayloadTokens(withoutSystems) > inputBudget) {
    for (const message of recentMessages) {
      if (message.role === 'tool' && typeof message.content === 'string' && message.content.length > 2400) {
        message.content = message.content.slice(0, 1200) + contentMarker(message.content) + message.content.slice(-1200);
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
    const systemMarker = contentMarker(text);
    let low = 0; let high = text.length;
    const render = (length: number) => text.slice(0, Math.ceil(length * 0.8)) + systemMarker + (length > 0 ? text.slice(-Math.floor(length * 0.2)) : '');
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
