/**
 * Tool Output Masking Service
 *
 * Replaces bulky old tool outputs in conversation history with
 * head/tail previews + file references. Uses a "Hybrid Backward
 * Scanned FIFO" algorithm: newest outputs are protected, oldest
 * are replaced with summaries.
 *
 * Inspired by Gemini CLI's toolOutputMaskingService.ts
 */

import { logger } from '../utils/logger.js';
import { truncateOutput } from '../utils/bounded-output.js';
import type { CodeBuddyMessage } from '../codebuddy/client.js';

/** Tokens worth of newest tool outputs to protect from masking */
const PROTECTION_THRESHOLD_CHARS = 200_000; // ~50K tokens * 4 chars/token

/** Only trigger masking if total prunable chars exceeds this */
const MIN_PRUNABLE_CHARS = 120_000; // ~30K tokens

/** Whether to always protect the latest turn's outputs */
const PROTECT_LATEST_TURN = true;

/** Maximum lines for head preview */
const HEAD_PREVIEW_LINES = 10;

/** Maximum lines for tail preview */
const TAIL_PREVIEW_LINES = 10;

/** Maximum chars for short content preview */
const SHORT_PREVIEW_CHARS = 250;

/** Tools whose output should never be masked */
const EXEMPT_TOOLS = new Set([
  'ask_human',
  'plan',
  'reason',
  'terminate',
  'todo_update',
  'lessons_add',
]);

export const MASKING_TAG = '<tool_output_masked>';
export const MASKING_TAG_END = '</tool_output_masked>';

/**
 * Generate a head/tail preview of content.
 */
function generatePreview(content: string): string {
  const lines = content.split('\n');

  if (lines.length <= HEAD_PREVIEW_LINES + TAIL_PREVIEW_LINES) {
    // Short enough — use char-based preview
    if (content.length <= SHORT_PREVIEW_CHARS * 2) return content;
    return truncateOutput(content, SHORT_PREVIEW_CHARS * 2);
  }

  const head = lines.slice(0, HEAD_PREVIEW_LINES).join('\n');
  const tail = lines.slice(-TAIL_PREVIEW_LINES).join('\n');
  const omitted = lines.length - HEAD_PREVIEW_LINES - TAIL_PREVIEW_LINES;

  return truncateOutput(`${head}\n\n... (${omitted} lines omitted) ...\n\n${tail}`, 4000);
}

/**
 * Apply tool output masking to conversation messages.
 * Scans backward from the most recent message, protecting the newest
 * outputs and replacing older ones with previews.
 *
 * @param messages - Mutable message array (modified in place)
 * @returns Number of messages masked
 */
export function applyToolOutputMasking(messages: CodeBuddyMessage[]): number {
  // Find tool result messages and their char counts
  const toolMessages: Array<{
    index: number;
    chars: number;
    toolName: string;
  }> = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg || msg.role !== 'tool' || typeof msg.content !== 'string') continue;

    // Extract tool name from preceding assistant message
    let toolName = '';
    const toolCallId = (msg as { tool_call_id?: string }).tool_call_id;
    for (let j = i - 1; j >= 0; j--) {
      const prev = messages[j];
      if (prev && prev.role === 'assistant' && 'tool_calls' in prev && Array.isArray(prev.tool_calls)) {
        const tc = (prev.tool_calls as Array<{ id: string; function?: { name: string } }>)
          .find(t => t.id === toolCallId);
        if (tc) {
          toolName = tc.function?.name ?? '';
        }
        break;
      }
    }

    // Skip exempt tools
    if (EXEMPT_TOOLS.has(toolName)) continue;

    // Skip already masked
    if (msg.content.includes(MASKING_TAG)) continue;

    toolMessages.push({
      index: i,
      chars: msg.content.length,
      toolName,
    });
  }

  if (toolMessages.length === 0) return 0;

  // Backward scan: protect newest outputs
  let cumulativeChars = 0;
  let protectionBoundary = -1;

  // If protecting latest turn, start from second-to-last tool message
  const startIdx = PROTECT_LATEST_TURN && toolMessages.length > 1
    ? toolMessages.length - 2
    : toolMessages.length - 1;

  for (let i = startIdx; i >= 0; i--) {
    const tm = toolMessages[i];
    if (!tm) continue;
    cumulativeChars += tm.chars;
    if (cumulativeChars > PROTECTION_THRESHOLD_CHARS) {
      protectionBoundary = i;
      break;
    }
  }

  // No boundary reached — everything fits in protection window
  if (protectionBoundary < 0) return 0;

  // Calculate total prunable chars
  let totalPrunable = 0;
  for (let i = 0; i <= protectionBoundary; i++) {
    const tm = toolMessages[i];
    if (!tm) continue;
    totalPrunable += tm.chars;
  }

  // Only mask if enough prunable content
  if (totalPrunable < MIN_PRUNABLE_CHARS) return 0;

  // Mask old outputs (validate index bounds before access)
  let masked = 0;
  for (let i = 0; i <= protectionBoundary; i++) {
    const tm = toolMessages[i];
    if (!tm) continue;
    const { index, toolName } = tm;
    if (index < 0 || index >= messages.length) continue;
    const msg = messages[index];
    if (!msg || typeof msg.content !== 'string') continue;

    const preview = generatePreview(msg.content);
    const originalChars = msg.content.length;

    msg.content = [
      MASKING_TAG,
      `Tool: ${toolName || 'unknown'}`,
      `Original size: ${originalChars} chars`,
      '',
      preview,
      MASKING_TAG_END,
    ].join('\n');

    masked++;
  }

  if (masked > 0) {
    logger.debug(`Tool output masking: masked ${masked} outputs, freed ~${(totalPrunable / 4).toFixed(0)} tokens`);
  }

  return masked;
}

// ============================================================================
// TTL-Based Tool Result Expiry (DeepWiki Gap #5)
// ============================================================================

/**
 * Age-based relevance decay for tool results.
 *
 * Tool results older than `maxAgeTurns` are progressively compressed:
 * - 50-75% age: truncated to head/tail preview
 * - 75-100% age: replaced with one-line stub
 * - >100% age: removed entirely
 *
 * @param messages - Mutable message array
 * @param currentTurn - Current tool round number
 * @param maxAgeTurns - Maximum age before full removal (default 20)
 * @returns Number of results expired
 */
export function expireOldToolResults(
  messages: CodeBuddyMessage[],
  currentTurn: number,
  maxAgeTurns: number = 20,
): number {
  let expired = 0;

  // Assign approximate turn numbers based on position
  // Each assistant+tool pair ≈ 1 turn
  let turnEstimate = 0;
  const turnMap = new Map<number, number>(); // message index → estimated turn

  for (let i = 0; i < messages.length; i++) {
    if (messages[i]?.role === 'assistant') turnEstimate++;
    turnMap.set(i, turnEstimate);
  }

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg || msg.role !== 'tool' || typeof msg.content !== 'string') continue;
    if (msg.content.includes(MASKING_TAG)) continue; // Already masked

    const msgTurn = turnMap.get(i) ?? 0;
    const age = currentTurn - msgTurn;

    if (age <= maxAgeTurns * 0.5) continue; // Fresh enough

    if (age > maxAgeTurns) {
      // Full removal: replace with stub
      msg.content = `[Tool result expired: age ${age} turns > ${maxAgeTurns} limit]`;
      expired++;
    } else if (age > maxAgeTurns * 0.75) {
      // Heavy compression: one-line summary
      const firstLine = msg.content.split('\n')[0]?.substring(0, 100) ?? '';
      msg.content = `[Aged tool result (${age} turns): ${firstLine}...]`;
      expired++;
    } else {
      // Moderate compression: head/tail preview
      if (msg.content.length > 500) {
        msg.content = generatePreview(msg.content);
        expired++;
      }
    }
  }

  if (expired > 0) {
    logger.debug(`Tool result TTL: expired ${expired} results (currentTurn=${currentTurn}, maxAge=${maxAgeTurns})`);
  }

  return expired;
}

// ============================================================================
// Image-Only Tool Result Pruning (Native Engine Vague 4 Phase 3)
// ============================================================================

/** Number of most-recent image tool results to keep intact */
const IMAGE_KEEP_RECENT = 2;

/** Chars-per-token estimate for base64 content (~0.75 chars/token for base64) */
const BASE64_CHARS_PER_TOKEN = 0.75;

/** Tools known to produce image outputs */
const IMAGE_TOOLS = new Set([
  'browser_screenshot',
  'screenshot',
  'computer_use',
  'image_process',
  'ocr_extract',
]);

/** Regex to detect data URI base64 inline images in text content */
const DATA_URI_REGEX = /data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]{100,}/;

/**
 * Check whether a content part is an OpenAI multimodal image_url part.
 */
function isImageUrlPart(part: unknown): part is { type: 'image_url'; image_url: { url: string } } {
  if (!part || typeof part !== 'object') return false;
  const p = part as Record<string, unknown>;
  return p.type === 'image_url' &&
    typeof p.image_url === 'object' &&
    p.image_url !== null &&
    typeof (p.image_url as Record<string, unknown>).url === 'string';
}

/**
 * Estimate token count for an image content part or data URI.
 */
function estimateImageTokens(content: string): number {
  return Math.ceil(content.length * BASE64_CHARS_PER_TOKEN);
}

/**
 * Check whether a message content contains image data.
 * Returns true if content is an array with image_url parts,
 * or a string containing a data URI base64 image.
 */
function hasImageContent(content: unknown): boolean {
  if (Array.isArray(content)) {
    return content.some(part => isImageUrlPart(part));
  }
  if (typeof content === 'string') {
    return DATA_URI_REGEX.test(content);
  }
  return false;
}

/**
 * Prune image-only tool results from conversation messages.
 *
 * Keeps the 2 most recent image tool results intact and replaces
 * older ones with lightweight stubs, estimating tokens saved.
 *
 * Handles two image formats:
 * - OpenAI multimodal: content arrays with `{ type: 'image_url', image_url: { url: '...' } }`
 * - Data URI base64 inline: `data:image/...;base64,...` in text content
 *
 * @param messages - Array of conversation messages (modified in place)
 * @returns Object with the modified messages, count pruned, and estimated tokens saved
 */
export function pruneImageContent(
  messages: CodeBuddyMessage[],
): { messages: CodeBuddyMessage[]; prunedCount: number; tokensSaved: number } {
  if (!messages || messages.length === 0) {
    return { messages, prunedCount: 0, tokensSaved: 0 };
  }

  // Collect indices of tool messages that contain image data
  const imageToolIndices: Array<{
    index: number;
    toolName: string;
    estimatedTokens: number;
  }> = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg || msg.role !== 'tool') continue;

    // Extract tool name from preceding assistant message
    let toolName = '';
    const toolCallId = (msg as { tool_call_id?: string }).tool_call_id;
    for (let j = i - 1; j >= 0; j--) {
      const prev = messages[j];
      if (prev && prev.role === 'assistant' && 'tool_calls' in prev && Array.isArray(prev.tool_calls)) {
        const tc = (prev.tool_calls as Array<{ id: string; function?: { name: string } }>)
          .find(t => t.id === toolCallId);
        if (tc) {
          toolName = tc.function?.name ?? '';
        }
        break;
      }
    }

    // Check if this tool result contains image data
    const content = msg.content;
    if (!hasImageContent(content)) continue;

    // Estimate tokens for the image content
    let estimatedTokens = 0;
    if (Array.isArray(content)) {
      for (const part of content) {
        if (isImageUrlPart(part)) {
          estimatedTokens += estimateImageTokens(
            (part as unknown as { image_url: { url: string } }).image_url.url
          );
        }
      }
    } else if (typeof content === 'string') {
      const matches = content.match(new RegExp(DATA_URI_REGEX.source, 'g'));
      if (matches) {
        for (const match of matches) {
          estimatedTokens += estimateImageTokens(match);
        }
      }
    }

    imageToolIndices.push({ index: i, toolName, estimatedTokens });
  }

  // Nothing to prune
  if (imageToolIndices.length <= IMAGE_KEEP_RECENT) {
    return { messages, prunedCount: 0, tokensSaved: 0 };
  }

  // Keep the N most recent, prune the rest
  const toPrune = imageToolIndices.slice(0, imageToolIndices.length - IMAGE_KEEP_RECENT);
  let totalTokensSaved = 0;

  for (const { index, toolName, estimatedTokens } of toPrune) {
    if (index < 0 || index >= messages.length) continue;
    const msg = messages[index];
    if (!msg) continue;

    totalTokensSaved += estimatedTokens;

    const displayName = toolName || (IMAGE_TOOLS.has(toolName) ? toolName : 'unknown');
    const stub = `[Image pruned: ${displayName}, saved ~${estimatedTokens} tokens]`;

    // Replace content: if it's an array, filter out image parts and add stub
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mutableMsg = msg as any;
    if (Array.isArray(mutableMsg.content)) {
      const nonImageParts = (mutableMsg.content as unknown[])
        .filter(part => !isImageUrlPart(part));
      if (nonImageParts.length > 0) {
        // Keep text parts, add stub
        mutableMsg.content = [
          ...nonImageParts,
          { type: 'text', text: stub },
        ];
      } else {
        // All parts were images
        mutableMsg.content = stub;
      }
    } else if (typeof mutableMsg.content === 'string') {
      // Replace data URIs with stub
      mutableMsg.content = mutableMsg.content.replace(
        new RegExp(DATA_URI_REGEX.source, 'g'),
        stub,
      );
    }
  }

  if (toPrune.length > 0) {
    logger.debug(
      `Image pruning: pruned ${toPrune.length} image results, saved ~${totalTokensSaved} tokens`
    );
  }

  return {
    messages,
    prunedCount: toPrune.length,
    tokensSaved: totalTokensSaved,
  };
}
