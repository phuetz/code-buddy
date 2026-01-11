/**
 * /compress Command - Context Compression (Gemini CLI inspired)
 *
 * Replaces the entire chat context with a summary to save tokens
 * while retaining key information about what has happened.
 */

import type { ChatCompletionMessageParam } from "openai/resources/chat";

/**
 * Result of a context compression operation.
 */
export interface CompressResult {
  /** Whether compression was performed. */
  success: boolean;
  /** Number of tokens before compression. */
  originalTokens: number;
  /** Number of tokens after compression. */
  compressedTokens: number;
  /** Number of tokens saved. */
  savedTokens: number;
  /** Percentage of tokens saved. */
  savingsPercent: number;
  /** The generated summary of the conversation. */
  summary: string;
}

/**
 * Generates a prompt for the LLM to summarize the conversation.
 *
 * @param messages - The conversation history.
 * @returns The prompt string.
 */
function buildSummaryPrompt(messages: ChatCompletionMessageParam[]): string {
  // Filter out system message and format conversation
  const conversation = messages
    .filter(m => m.role !== 'system')
    .map(m => {
      const role = m.role === 'user' ? 'User' : 'Assistant';
      const content = typeof m.content === 'string'
        ? m.content
        : JSON.stringify(m.content);
      return `${role}: ${content.slice(0, 1000)}${content.length > 1000 ? '...' : ''}`;
    })
    .join('\n\n');

  return `Summarize this conversation concisely, preserving:
1. Key decisions made
2. Files modified or created
3. Problems solved
4. Current task state
5. Important context for continuation

Conversation:
${conversation}

Provide a structured summary in this format:
## Session Summary
### Decisions Made
- ...
### Files Changed
- ...
### Current State
- ...
### Key Context
- ...`;
}

/**
 * Compresses messages by summarizing the conversation using an LLM.
 *
 * @param messages - The conversation history to compress.
 * @param llmCall - Function to call the LLM for summarization.
 * @param estimateTokens - Function to estimate token count.
 * @returns Promise resolving to compression result.
 */
export async function compressContext(
  messages: ChatCompletionMessageParam[],
  llmCall: (prompt: string) => Promise<string>,
  estimateTokens: (text: string) => number
): Promise<CompressResult> {
  // Calculate original token count
  const originalContent = messages
    .map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content))
    .join('\n');
  const originalTokens = estimateTokens(originalContent);

  // Don't compress if already small
  if (originalTokens < 2000) {
    return {
      success: false,
      originalTokens,
      compressedTokens: originalTokens,
      savedTokens: 0,
      savingsPercent: 0,
      summary: 'Context too small to compress',
    };
  }

  // Generate summary
  const summaryPrompt = buildSummaryPrompt(messages);
  const summary = await llmCall(summaryPrompt);

  // Calculate compressed token count
  const compressedTokens = estimateTokens(summary);
  const savedTokens = originalTokens - compressedTokens;
  const savingsPercent = Math.round((savedTokens / originalTokens) * 100);

  return {
    success: true,
    originalTokens,
    compressedTokens,
    savedTokens,
    savingsPercent,
    summary,
  };
}

/**
 * Creates a new message array with the compressed summary.
 * Preserves the system message and appends the summary as an assistant message.
 *
 * @param systemMessage - The original system message.
 * @param summary - The generated conversation summary.
 * @returns New array of messages.
 */
export function createCompressedMessages(
  systemMessage: ChatCompletionMessageParam,
  summary: string
): ChatCompletionMessageParam[] {
  return [
    systemMessage,
    {
      role: 'assistant',
      content: `[Previous conversation compressed]\n\n${summary}\n\n[Continuing from compressed state]`,
    },
  ];
}

/**
 * Formats the compression result for user display.
 *
 * @param result - The compression result.
 * @returns Formatted string.
 */
export function formatCompressResult(result: CompressResult): string {
  if (!result.success) {
    return `Context too small to compress (${result.originalTokens} tokens)`;
  }

  return `Context compressed:
  Original: ${result.originalTokens.toLocaleString()} tokens
  Compressed: ${result.compressedTokens.toLocaleString()} tokens
  Saved: ${result.savedTokens.toLocaleString()} tokens (${result.savingsPercent}%)`;
}