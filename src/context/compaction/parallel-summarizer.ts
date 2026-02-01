/**
 * Parallel Summarizer
 *
 * Summarizes multiple message chunks in parallel for efficient
 * context compaction. Uses a fast model for summarization.
 */

import type { ChatMessage } from '../../types/index.js';
import type { MessageChunk, ChunkSummary } from './types.js';
import { countTokens } from '../token-counter.js';
import { logger } from '../../utils/logger.js';

// ============================================================================
// Summarization Prompt
// ============================================================================

// Prompt for LLM-based summarization (reserved for future use)
const _SUMMARIZE_PROMPT = `Summarize the following conversation segment concisely, preserving:
1. Key decisions made
2. Important facts discussed
3. Unresolved questions or TODOs
4. Technical details that would be needed for context

Be concise but complete. Output only the summary, no preamble.

Conversation:
`;

// ============================================================================
// Summarization Interface
// ============================================================================

/**
 * Interface for LLM summarization
 */
export interface Summarizer {
  summarize(text: string): Promise<string>;
}

/**
 * Local summarizer using simple extraction (fallback)
 */
export class LocalSummarizer implements Summarizer {
  async summarize(text: string): Promise<string> {
    // Extract key sentences using heuristics
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 20);

    // Score sentences by importance indicators
    const scored = sentences.map(sentence => {
      let score = 0;
      const lower = sentence.toLowerCase();

      // Keywords indicating importance
      if (lower.includes('decided') || lower.includes('decision')) score += 3;
      if (lower.includes('important') || lower.includes('critical')) score += 2;
      if (lower.includes('todo') || lower.includes('need to')) score += 2;
      if (lower.includes('error') || lower.includes('bug')) score += 2;
      if (lower.includes('should') || lower.includes('must')) score += 1;
      if (lower.includes('because') || lower.includes('reason')) score += 1;

      // Code indicators
      if (sentence.includes('```') || sentence.includes('function')) score += 1;

      // Question indicators
      if (sentence.includes('?')) score += 1;

      return { sentence, score };
    });

    // Sort by score and take top sentences
    scored.sort((a, b) => b.score - a.score);
    const topSentences = scored.slice(0, Math.min(10, Math.ceil(sentences.length / 3)));

    // Reconstruct in original order
    const topSet = new Set(topSentences.map(t => t.sentence));
    const ordered = sentences.filter(s => topSet.has(s));

    return ordered.join('. ').trim() + '.';
  }
}

// ============================================================================
// Parallel Summarizer
// ============================================================================

/**
 * Default local summarizer instance
 */
const defaultSummarizer = new LocalSummarizer();

/**
 * Format messages for summarization
 */
function formatMessagesForSummary(messages: ChatMessage[]): string {
  return messages
    .map(m => {
      const role = m.role.toUpperCase();
      const content = typeof m.content === 'string'
        ? m.content
        : JSON.stringify(m.content);
      return `[${role}]: ${content}`;
    })
    .join('\n\n');
}

/**
 * Summarize a single chunk
 */
async function summarizeChunk(
  chunk: MessageChunk,
  summarizer: Summarizer,
  model: string = 'gpt-4'
): Promise<ChunkSummary> {
  const text = formatMessagesForSummary(chunk.messages);

  try {
    const summary = await summarizer.summarize(text);
    const summaryTokens = countTokens(summary, model);

    return {
      index: chunk.index,
      summary,
      tokenCount: summaryTokens,
      originalTokenCount: chunk.tokenCount,
      compressionRatio: 1 - (summaryTokens / chunk.tokenCount),
    };
  } catch (error) {
    logger.warn('Chunk summarization failed, using truncation', {
      chunkIndex: chunk.index,
      error: error instanceof Error ? error.message : String(error),
    });

    // Fallback: truncate to first and last parts
    const truncated = truncateText(text, 500, 500);
    const truncatedTokens = countTokens(truncated, model);

    return {
      index: chunk.index,
      summary: `[Summarization failed, using excerpt]\n${truncated}`,
      tokenCount: truncatedTokens,
      originalTokenCount: chunk.tokenCount,
      compressionRatio: 1 - (truncatedTokens / chunk.tokenCount),
    };
  }
}

/**
 * Summarize multiple chunks in parallel
 */
export async function summarizeChunksParallel(
  chunks: MessageChunk[],
  summarizer: Summarizer = defaultSummarizer,
  model: string = 'gpt-4'
): Promise<ChunkSummary[]> {
  if (chunks.length === 0) {
    return [];
  }

  // Summarize all chunks in parallel
  const summaryPromises = chunks.map(chunk =>
    summarizeChunk(chunk, summarizer, model)
  );

  const summaries = await Promise.all(summaryPromises);

  // Sort by original index
  summaries.sort((a, b) => a.index - b.index);

  return summaries;
}

/**
 * Merge summaries into a single coherent summary
 */
export function mergeSummaries(
  summaries: ChunkSummary[],
  model: string = 'gpt-4'
): { merged: string; tokenCount: number } {
  if (summaries.length === 0) {
    return { merged: '', tokenCount: 0 };
  }

  if (summaries.length === 1) {
    return {
      merged: summaries[0].summary,
      tokenCount: summaries[0].tokenCount,
    };
  }

  // Combine summaries with section markers
  const parts = summaries.map((s, i) => {
    if (summaries.length <= 3) {
      return s.summary;
    }
    return `[Part ${i + 1}/${summaries.length}]\n${s.summary}`;
  });

  const merged = parts.join('\n\n');
  const tokenCount = countTokens(merged, model);

  return { merged, tokenCount };
}

/**
 * Truncate text keeping head and tail
 */
export function truncateText(
  text: string,
  headChars: number = 1500,
  tailChars: number = 1500
): string {
  if (text.length <= headChars + tailChars + 50) {
    return text;
  }

  const head = text.slice(0, headChars);
  const tail = text.slice(-tailChars);

  return `${head}\n\n[... ${text.length - headChars - tailChars} characters truncated ...]\n\n${tail}`;
}

export { defaultSummarizer };
