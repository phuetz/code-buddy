import type { Message, ContentBlock } from '../types';

/**
 * Walk back from `assistantMessageId` to find the index of the user
 * message that produced the assistant turn. Returns -1 if no such user
 * message exists or the id is unknown.
 */
export function findPrecedingUserIndex(
  messages: readonly Message[],
  assistantMessageId: string,
): number {
  const targetIndex = messages.findIndex((m) => m.id === assistantMessageId);
  if (targetIndex < 0) return -1;
  for (let i = targetIndex - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'user') return i;
  }
  return -1;
}

/**
 * Normalise a message's content into a `ContentBlock[]` array. Mirrors
 * the existing rendering convention — string content becomes a single
 * `text` block; arrays pass through verbatim; null/undefined becomes
 * an empty `text` block.
 */
export function normaliseContent(content: Message['content']): ContentBlock[] {
  if (Array.isArray(content)) return content as ContentBlock[];
  return [{ type: 'text', text: String(content ?? '') }];
}

/**
 * Compute the slice + replay payload for a regeneration. Returns null
 * when the assistant message can't be regenerated (no user before, or
 * not assistant role).
 *
 * - `slicedMessages`: messages array with the preceding user message
 *   AND everything after dropped — `continueSession()` will re-add the
 *   user message itself when called, so we trim from `userIndex`
 *   inclusive.
 * - `replayContent`: the user content blocks to feed back into
 *   `continueSession()`.
 */
export function computeRegenerationPlan(
  messages: readonly Message[],
  assistantMessage: Message,
): { slicedMessages: Message[]; replayContent: ContentBlock[] } | null {
  if (assistantMessage.role !== 'assistant') return null;
  const userIndex = findPrecedingUserIndex(messages, assistantMessage.id);
  if (userIndex < 0) return null;
  return {
    slicedMessages: messages.slice(0, userIndex),
    replayContent: normaliseContent(messages[userIndex].content),
  };
}
