/**
 * Clipboard Handler
 *
 * /copy — copy last assistant response to clipboard
 * /copy code — copy last code block from response
 * /copy <text> — copy specified text
 */

import type { CommandHandlerResult } from './session-handlers.js';
import type { ChatEntry } from '../../agent/codebuddy-agent.js';
import { copyToClipboard, isClipboardAvailable } from '../../utils/clipboard.js';
import { failureFlag } from '../slash-failure.js';

/**
 * Extract the last code block from a text string.
 * Returns the content within the last ```...``` block, or null if none found.
 */
function extractLastCodeBlock(text: string): string | null {
  const codeBlockRegex = /```[\w]*\n?([\s\S]*?)```/g;
  let lastMatch: string | null = null;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    lastMatch = (match[1] ?? '').trim();
  }

  return lastMatch;
}

/**
 * Find the last assistant message from conversation history.
 */
function getLastAssistantMessage(history: ChatEntry[]): string | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const entry = history[i];
    if (entry?.type === 'assistant' && entry.content) {
      return entry.content;
    }
  }
  return null;
}

/**
 * Handle /copy command
 *
 * @param args - Command arguments
 * @param conversationHistory - Full conversation history for extracting last response
 */
export function handleCopy(
  args: string[],
  conversationHistory: ChatEntry[],
): CommandHandlerResult {
  // Check clipboard availability
  if (!isClipboardAvailable()) {
    return {
      handled: true,
...failureFlag('Clipboard is not available on this system. On Linux, install xclip, xsel, or wl-copy.'),
      entry: {
        type: 'assistant',
        content: 'Clipboard is not available on this system. On Linux, install xclip, xsel, or wl-copy.',
        timestamp: new Date(),
      },
    };
  }

  const action = args[0]?.toLowerCase();
  const fullArgs = args.join(' ').trim();

  // /copy code — extract and copy last code block
  if (action === 'code') {
    const lastMessage = getLastAssistantMessage(conversationHistory);
    if (!lastMessage) {
      return {
        handled: true,
...failureFlag('No assistant response found to copy.'),
        entry: {
          type: 'assistant',
          content: 'No assistant response found to copy.',
          timestamp: new Date(),
        },
      };
    }

    const codeBlock = extractLastCodeBlock(lastMessage);
    if (!codeBlock) {
      return {
        handled: true,
...failureFlag('No code block found in the last response.'),
        entry: {
          type: 'assistant',
          content: 'No code block found in the last response.',
          timestamp: new Date(),
        },
      };
    }

    const success = copyToClipboard(codeBlock);
    return {
      handled: true,
...failureFlag(success
          ? `Copied code block to clipboard (${codeBlock.length} chars).`
          : 'Failed to copy to clipboard.'),
      entry: {
        type: 'assistant',
        content: success
          ? `Copied code block to clipboard (${codeBlock.length} chars).`
          : 'Failed to copy to clipboard.',
        timestamp: new Date(),
      },
    };
  }

  // /copy <text> — copy specified text
  if (fullArgs.length > 0) {
    const success = copyToClipboard(fullArgs);
    return {
      handled: true,
...failureFlag(success
          ? `Copied to clipboard (${fullArgs.length} chars).`
          : 'Failed to copy to clipboard.'),
      entry: {
        type: 'assistant',
        content: success
          ? `Copied to clipboard (${fullArgs.length} chars).`
          : 'Failed to copy to clipboard.',
        timestamp: new Date(),
      },
    };
  }

  // /copy — copy last assistant response
  const lastMessage = getLastAssistantMessage(conversationHistory);
  if (!lastMessage) {
    return {
      handled: true,
...failureFlag('No assistant response found to copy.'),
      entry: {
        type: 'assistant',
        content: 'No assistant response found to copy.',
        timestamp: new Date(),
      },
    };
  }

  const success = copyToClipboard(lastMessage);
  return {
    handled: true,
...failureFlag(success
        ? `Copied last response to clipboard (${lastMessage.length} chars).`
        : 'Failed to copy to clipboard.'),
    entry: {
      type: 'assistant',
      content: success
        ? `Copied last response to clipboard (${lastMessage.length} chars).`
        : 'Failed to copy to clipboard.',
      timestamp: new Date(),
    },
  };
}
