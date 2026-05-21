/**
 * OpenAI-compat strategy hooks — Vague 2 Phase C1.
 *
 * Pure functions that mutate the message array sent to providers reachable
 * through the OpenAI SDK (GPT, Grok, Anthropic via OpenRouter, OpenRouter,
 * Together, Fireworks, Groq, Ollama, vLLM, LM Studio).
 *
 * Today these hooks are imported from `client.ts`'s `chat()` path. In Phase
 * C2 they will move into the dedicated `OpenAICompatProvider` strategy.
 * Keeping them as exported pure fns means they are testable in isolation
 * and reusable by both `chat()` and `chatStream()` once C3 lands and the
 * `chatStream()` Anthropic-isms gap (flagged in commit 7f6853b) closes.
 */

import type { CodeBuddyMessage } from '../client.js';

/**
 * Re-export so the OpenAI-compat strategy has a single import point for
 * Anthropic message hooks. The implementation lives in src/optimization/
 * because the cache-breakpoint concept also serves Manus AI optimizations
 * unrelated to this strategy.
 */
export { injectAnthropicCacheBreakpoints } from '../../optimization/cache-breakpoints.js';

/**
 * Append the IMPORTANT JSON instruction to the last system message.
 *
 * Anthropic does not honor `response_format: { type: 'json_object' }`
 * natively (no Claude API equivalent to OpenAI's JSON mode). We coerce
 * it via the system prompt instead.
 *
 * Returns a new array — originals unmodified. No-op if there is no system
 * message or the last system message has non-string content (e.g. a parts
 * array).
 *
 * Bug history (commit 7f6853b): the inlined version of this hack in
 * `client.ts` reassigned a local `finalMessages` variable but the request
 * payload kept the original reference, so the warning never reached the
 * API. Pulling this out as a pure fn that returns a new array forces the
 * caller to assign explicitly, which makes the bug pattern impossible.
 */
export function injectJsonSystemPromptForAnthropic(
  messages: CodeBuddyMessage[],
): CodeBuddyMessage[] {
  let lastSystemIdx = -1;
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index]?.role === 'system') {
      lastSystemIdx = index;
      break;
    }
  }
  if (lastSystemIdx < 0) return messages;
  const sysMsg = messages[lastSystemIdx];
  if (typeof sysMsg.content !== 'string') return messages;

  const result = [...messages];
  result[lastSystemIdx] = {
    ...sysMsg,
    content: sysMsg.content + '\n\nIMPORTANT: You must respond with valid JSON only. No markdown, no explanation — just a JSON object.',
  };
  return result;
}
