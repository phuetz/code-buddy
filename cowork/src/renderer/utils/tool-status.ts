import type { ContentBlock, Message, ToolResultContent } from '../types';

export type ToolStatus = 'running' | 'success' | 'error';

interface ResolveToolStatusInput {
  toolUseId: string;
  /** Blocks of the message that owns the tool_use (looks first here for a result). */
  ownerBlocks?: ContentBlock[];
  /** All session messages — fallback search when the result lives in a later message. */
  allMessages?: readonly Message[];
  /** Whether the session has an active turn — gates the `running` state. */
  hasActiveTurn: boolean;
}

interface ResolveToolStatusResult {
  status: ToolStatus;
  toolResult: ToolResultContent | null;
}

/**
 * Mirror of the inline status logic in `ToolUseBlock`. Extracted so
 * `ToolBadgeStrip` can render a compact summary of every tool call
 * without re-duplicating the lookup. Pure function — testable in
 * the node vitest env.
 *
 * Resolution order for the matching `tool_result`:
 *   1. Within `ownerBlocks` (same message)
 *   2. Across `allMessages` (cross-message — happens when the result
 *      arrives in a later assistant turn)
 *
 * Status semantics:
 *   - No matching result + `hasActiveTurn` → `running`
 *   - No matching result + idle session → `success` (treat as "done,
 *     result was lost or trimmed")
 *   - Matching result with `isError === true` → `error`
 *   - Matching result otherwise → `success`
 */
export function resolveToolStatus(
  input: ResolveToolStatusInput,
): ResolveToolStatusResult {
  const { toolUseId, ownerBlocks, allMessages, hasActiveTurn } = input;

  let toolResult: ToolResultContent | null = null;

  if (ownerBlocks) {
    for (const block of ownerBlocks) {
      if (block.type === 'tool_result' && (block as ToolResultContent).toolUseId === toolUseId) {
        toolResult = block as ToolResultContent;
        break;
      }
    }
  }

  if (!toolResult && allMessages) {
    for (const msg of allMessages) {
      if (!Array.isArray(msg.content)) continue;
      for (const block of msg.content as ContentBlock[]) {
        if (block.type === 'tool_result' && (block as ToolResultContent).toolUseId === toolUseId) {
          toolResult = block as ToolResultContent;
          break;
        }
      }
      if (toolResult) break;
    }
  }

  let status: ToolStatus;
  if (!toolResult) {
    status = hasActiveTurn ? 'running' : 'success';
  } else if (toolResult.isError === true) {
    status = 'error';
  } else {
    status = 'success';
  }

  return { status, toolResult };
}

/**
 * Trim a tool name down to a compact label suitable for a badge.
 * Strips `mcp__<server>__` prefixes and clips at 24 chars.
 */
export function compactToolLabel(toolName: string): string {
  const stripped = toolName.replace(/^mcp__[^_]+__/u, '');
  return stripped.length > 24 ? `${stripped.slice(0, 22)}…` : stripped;
}
