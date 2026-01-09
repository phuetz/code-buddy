import { CodeBuddyMessage } from '../codebuddy/client.js';
import { TokenCounter } from './token-counter.js';
import { CompressionResult } from './types.js';

export interface CompressionOptions {
  targetRatio?: number;
  preserveSystemPrompt?: boolean;
  preserveRecentMessages?: number;
}

/**
 * Context Compression Engine
 * Implements sophisticated compression strategies
 */
export class ContextCompressor {
  constructor(private tokenCounter: TokenCounter) {}

  /**
   * Compress messages to meet token target
   */
  compress(
    messages: CodeBuddyMessage[], 
    tokenLimit: number,
    options: CompressionOptions = {}
  ): CompressionResult {
    const initialTokens = this.countTotalTokens(messages);
    if (initialTokens <= tokenLimit) {
      return {
        compressed: false,
        messages,
        tokensReduced: 0,
        strategy: 'none'
      };
    }

    // Clone to avoid mutation
    let processedMessages = [...messages];
    const systemMessage = options.preserveSystemPrompt ? processedMessages.find(m => m.role === 'system') : null;
    const recentCount = options.preserveRecentMessages !== undefined ? options.preserveRecentMessages : 2;
    
    // Filter out system message if we're preserving it separately to add back later
    if (systemMessage) {
      processedMessages = processedMessages.filter(m => m.role !== 'system');
    }

    // Separate recent messages
    const recentMessages = recentCount > 0 ? processedMessages.slice(-recentCount) : [];
    let olderMessages = recentCount > 0 ? processedMessages.slice(0, -recentCount) : processedMessages;

    // Strategy 1: Truncate tool outputs (often very large)
    olderMessages = this.truncateToolOutputs(olderMessages);
    
    // Reassemble to check if we're good
    let currentSet: CodeBuddyMessage[] = [];
    if (systemMessage) {
      currentSet.push(systemMessage as CodeBuddyMessage);
    }
    currentSet.push(...olderMessages, ...recentMessages);
    
    let currentTokens = this.countTotalTokens(currentSet);

    if (currentTokens <= tokenLimit) {
      return {
        compressed: true,
        messages: currentSet,
        tokensReduced: initialTokens - currentTokens,
        strategy: 'tool_truncation'
      };
    }

    // Strategy 2: Summarize older conversation
    // In a real implementation, this would call an LLM. Here we simulate/use heuristic summarization.
    // For now, we'll use a sliding window approach which is a form of lossy compression/summarization
    // by dropping middle messages.
    
    // Strategy 3: Sliding Window (Aggressive)
    // Keep removing oldest messages from 'olderMessages' until we fit
    while (olderMessages.length > 0 && currentTokens > tokenLimit) {
      olderMessages.shift(); // Remove oldest
      
      currentSet = [];
      if (systemMessage) {
        currentSet.push(systemMessage as CodeBuddyMessage);
      }
      currentSet.push(...olderMessages, ...recentMessages);
      
      currentTokens = this.countTotalTokens(currentSet);
    }

    // If still over limit (extreme case where recent messages are huge), truncate recent messages content
    if (currentTokens > tokenLimit) {
        // This is a hard truncation scenario
        return {
            compressed: true,
            messages: this.hardTruncate(currentSet, tokenLimit),
            tokensReduced: initialTokens - tokenLimit, // Approximate
            strategy: 'hard_truncation'
        };
    }

    return {
      compressed: true,
      messages: currentSet,
      tokensReduced: initialTokens - currentTokens,
      strategy: 'sliding_window'
    };
  }

  private countTotalTokens(messages: CodeBuddyMessage[]): number {
    const tokenMessages = messages.map(msg => ({
      role: msg.role,
      content: typeof msg.content === 'string' ? msg.content : null,
      tool_calls: 'tool_calls' in msg ? msg.tool_calls : undefined,
    }));
    return this.tokenCounter.countMessageTokens(tokenMessages);
  }

  private truncateToolOutputs(messages: CodeBuddyMessage[]): CodeBuddyMessage[] {
    const MAX_TOOL_OUTPUT = 500;
    return messages.map(msg => {
      if (msg.role === 'tool' && typeof msg.content === 'string' && msg.content.length > MAX_TOOL_OUTPUT) {
        return {
          ...msg,
          content: msg.content.slice(0, MAX_TOOL_OUTPUT) + '... [truncated]'
        };
      }
      return msg;
    });
  }

  private hardTruncate(messages: CodeBuddyMessage[], limit: number): CodeBuddyMessage[] {
    // Basic implementation: just return what fits, priority to system then recent
    // This is a "save the ship" strategy
    const result: CodeBuddyMessage[] = [];
    let currentTokens = 0;

    // Always keep system if present
    const system = messages.find(m => m.role === 'system');
    if (system) {
        result.push(system);
        currentTokens += this.countTotalTokens([system]);
    }

    // Try to add from most recent backwards
    const reverseMsgs = [...messages].reverse().filter(m => m.role !== 'system');
    
    for (const msg of reverseMsgs) {
        const msgTokens = this.countTotalTokens([msg]);
        if (currentTokens + msgTokens <= limit) {
            result.unshift(msg);
            currentTokens += msgTokens;
        } else {
            break; 
        }
    }
    
    // Ensure system is first
    if (system && result[0] !== system) {
        // Should already be handled but safety check
        const idx = result.indexOf(system);
        if (idx >= 0) result.splice(idx, 1);
        result.unshift(system);
    }

    return result;
  }
}