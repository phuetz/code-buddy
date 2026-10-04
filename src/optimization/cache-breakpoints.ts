/**
 * Prompt Cache Breakpoints — Manus AI / Native Engine KV-cache optimization
 *
 * Without explicit breakpoints, Anthropic Claude caching only activates when
 * the entire prompt is identical — which never happens if the time or todos
 * change. With a `cache_control: {type: "ephemeral"}` marker after the stable
 * system prefix, the stable section (~3000 tokens of identity + tools +
 * instructions) is cached regardless of dynamic suffix changes.
 *
 * Cost impact: cached input at $0.30/MTok vs $3.00/MTok (10× savings).
 *
 * This module provides:
 * 1. `injectAnthropicCacheBreakpoints(messages)` — mark the last system
 *    message of the leading run (before the first non-system message) with
 *    cache_control. A later system message is the volatile tail.
 * 2. `buildStableDynamicSplit(systemPrompt)` — split a system prompt into
 *    stable prefix (identity/tools/instructions) and dynamic suffix (time,
 *    todos, memory). The split point is the first line beginning with a
 *    dynamic marker.
 */

import type { CodeBuddyMessage } from '../codebuddy/client.js';

// ============================================================================
// Types
// ============================================================================

export type CacheBreakpointMessage = CodeBuddyMessage & {
  cache_control?: { type: 'ephemeral' };
};

export interface StableDynamicSplit {
  /** Stable prefix — identity, tool descriptions, base instructions */
  stablePrefix: string;
  /** Dynamic suffix — current time, todos, memory retrieval, repo profile */
  dynamicSuffix: string;
}

// ============================================================================
// Dynamic section markers
// ============================================================================

/**
 * Lines matching these patterns are considered dynamic (change per-turn).
 * Everything from the first match onwards is the dynamic suffix.
 */
const DYNAMIC_MARKERS = [
  /^#+\s*(Current Time|Today's Date|Memory Context|Active Todos|Todo|Workspace Context|Repository Profile)/i,
  /^<(todo_context|memory|knowledge|repo_profile|workspace_context)>/i,
  /^Today is /i,
  /^\*\*Current session/i,
];

// ============================================================================
// Stable/Dynamic split
// ============================================================================

/**
 * Split a system prompt string into a stable prefix and dynamic suffix.
 * The split is at the first line matching a DYNAMIC_MARKERS pattern.
 */
export function buildStableDynamicSplit(systemPrompt: string): StableDynamicSplit {
  const lines = systemPrompt.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? '').trim();
    if (DYNAMIC_MARKERS.some(re => re.test(line))) {
      return {
        stablePrefix: lines.slice(0, i).join('\n').trimEnd(),
        dynamicSuffix: lines.slice(i).join('\n').trimStart(),
      };
    }
  }

  // No dynamic section found → entire prompt is stable
  return { stablePrefix: systemPrompt, dynamicSuffix: '' };
}

// ============================================================================
// Anthropic cache_control injection
// ============================================================================

/**
 * Inject `cache_control: {type: "ephemeral"}` onto the last system message
 * of the leading run, before the first user or assistant message. Anthropic
 * caches everything up to that marker. A system message after the user
 * (`runtime_settings`, workspace, the moved environment block) is volatile
 * and must not carry the marker — it changes between turns and folders.
 *
 * When every message is a system message, the last one is marked (there is
 * no volatile tail to exclude).
 *
 * Call this **only** when the active provider is Anthropic (detected by model
 * name containing "claude" or provider being "anthropic").
 *
 * @param messages - The full message array to be sent to the API
 * @returns A new array with the cache_control marker injected (originals unmodified)
 */
export function injectAnthropicCacheBreakpoints(
  messages: CodeBuddyMessage[]
): CacheBreakpointMessage[] {
  const result: CacheBreakpointMessage[] = [...messages] as CacheBreakpointMessage[];

  let headEnd = result.findIndex(message => message?.role !== 'system');
  if (headEnd === -1) headEnd = result.length;

  let lastSystemIdx = -1;
  for (let i = headEnd - 1; i >= 0; i--) {
    if (result[i]?.role === 'system') {
      lastSystemIdx = i;
      break;
    }
  }

  const lastSystemMessage = lastSystemIdx === -1 ? undefined : result[lastSystemIdx];
  if (lastSystemIdx === -1 || lastSystemMessage === undefined) return result;

  result[lastSystemIdx] = {
    ...lastSystemMessage,
    cache_control: { type: 'ephemeral' },
  };

  return result;
}

// ============================================================================
// Provider detection
// ============================================================================

/**
 * Returns true if the model/provider string indicates Anthropic Claude.
 */
export function isAnthropicModel(modelOrProvider: string): boolean {
  const s = modelOrProvider.toLowerCase();
  return s.includes('claude') || s === 'anthropic';
}
