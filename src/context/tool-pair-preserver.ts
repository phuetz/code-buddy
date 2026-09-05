/**
 * Tool-pair preserver — post-audit fix derived from Claude Code source
 * comparison (le dépôt privé de passation, propositions/AUDIT-COMPACTION-CLAUDE-CODE-2026-05-04.md).
 *
 * `SmartCompactionEngine.truncateMessages` walks newest-to-oldest and
 * stops when the budget is hit. If a `tool_result` lands in the kept
 * set without its `tool_call` parent (because the parent was just past
 * the cutoff), `validateToolCallOrder()` strips the orphaned result
 * downstream — silently losing useful information.
 *
 * This module is the pure function that re-injects the missing parent
 * (in its original-order position) so the kept set stays valid. Pure
 * function over (kept, original); no side effects, easily testable.
 *
 * Strategy: pair integrity > strict budget compliance. Slight overshoot
 * is preferable to losing tool result context.
 */

import type { Message } from './smart-compaction.js';

/**
 * For every kept `tool_result` whose `tool_call` parent is missing
 * from `kept`, find the parent in `original` and re-insert it. Returns
 * a new array preserving original chronological order. No-op when no
 * tool_result needs rescuing.
 *
 * Both inputs are read-only. Output is a fresh array.
 */
export function preserveToolPairs(kept: Message[], original: Message[]): Message[] {
  // 1. Collect tool_call_ids referenced by kept tool_results.
  const neededIds = new Set<string>();
  for (const msg of kept) {
    if (msg.role === 'tool' && typeof msg.tool_call_id === 'string') {
      neededIds.add(msg.tool_call_id);
    }
  }
  if (neededIds.size === 0) return kept;

  // 2. Track which needed ids are already covered by an assistant
  // message in `kept`. (One assistant message can carry multiple
  // tool_calls — covering one covers all of them.)
  const coveredIds = new Set<string>();
  for (const msg of kept) {
    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) coveredIds.add(tc.id);
    }
  }

  // 3. Walk `original` to find the missing parents. Each parent message
  // is added AT MOST ONCE even if it covers multiple needed ids.
  const missing = new Set<Message>();
  for (const msg of original) {
    if (!msg.tool_calls) continue;
    const hits = msg.tool_calls.some((tc) => neededIds.has(tc.id) && !coveredIds.has(tc.id));
    if (!hits) continue;
    missing.add(msg);
    // Mark ALL of this parent's tool_calls as covered.
    for (const tc of msg.tool_calls) coveredIds.add(tc.id);
  }
  if (missing.size === 0) return kept;

  // 4. Re-build the merged set by walking `original` and keeping
  // anything that's in `kept` OR in `missing`. Guarantees the
  // resulting order matches the original chronological order.
  const keptSet = new Set(kept);
  const merged: Message[] = [];
  for (const msg of original) {
    if (keptSet.has(msg) || missing.has(msg)) merged.push(msg);
  }
  return merged;
}
