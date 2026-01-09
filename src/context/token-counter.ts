import { encoding_for_model, TiktokenModel, get_encoding } from 'tiktoken';
import { logger } from '../utils/logger.js';

export interface TokenCounterMessage {
  role: string;
  content: string | null | unknown[];
  tool_calls?: unknown[];
}

export interface TokenCounter {
  countTokens(text: string): number;
  countMessageTokens(messages: TokenCounterMessage[]): number;
  estimateStreamingTokens(chunk: string): number;
  dispose(): void;
}

/**
 * Creates a token counter instance for a specific model
 */
export function createTokenCounter(model: string = 'gpt-4'): TokenCounter {
  let encoder: any;

  try {
    // Try to get encoding for specific model
    encoder = encoding_for_model(model as TiktokenModel);
  } catch (error) {
    // Fallback to cl100k_base (used by GPT-4, GPT-3.5-turbo)
    logger.debug(`Could not load encoding for model ${model}, falling back to cl100k_base`);
    try {
      encoder = get_encoding('cl100k_base');
    } catch (e) {
      // Ultimate fallback to estimation if tiktoken fails completely (e.g. wasm issues)
      logger.warn('Failed to initialize tiktoken, using character-based estimation');
      return new EstimatingTokenCounter();
    }
  }

  return new TiktokenCounter(encoder);
}

/**
 * Token counter implementation using tiktoken
 */
class TiktokenCounter implements TokenCounter {
  private encoder: any;

  constructor(encoder: any) {
    this.encoder = encoder;
  }

  countTokens(text: string): number {
    if (!text) return 0;
    try {
      return this.encoder.encode(text).length;
    } catch (error) {
      logger.warn('Token counting failed, falling back to estimation', { error });
      return Math.ceil(text.length / 4);
    }
  }

  countMessageTokens(messages: TokenCounterMessage[]): number {
    let numTokens = 0;

    // Per-message overhead (format dependent, simplified for approximation)
    // <|start|>{role}\n{content}<|end|>
    const tokensPerMessage = 3;

    for (const message of messages) {
      numTokens += tokensPerMessage;

      // Role
      numTokens += this.countTokens(message.role);

      // Content - handle both string and array formats
      if (message.content) {
        if (typeof message.content === 'string') {
          numTokens += this.countTokens(message.content);
        } else if (Array.isArray(message.content)) {
          // Handle content parts array (OpenAI format)
          for (const part of message.content) {
            if (typeof part === 'object' && part !== null && 'text' in part) {
              numTokens += this.countTokens((part as { text: string }).text);
            }
          }
        }
      }

      // Tool calls overhead
      if (message.tool_calls && Array.isArray(message.tool_calls)) {
        numTokens += this.countTokens(JSON.stringify(message.tool_calls));
      }
    }

    numTokens += 3; // Priming tokens for next response
    return numTokens;
  }

  estimateStreamingTokens(chunk: string): number {
    return this.countTokens(chunk);
  }

  dispose(): void {
    try {
      this.encoder.free();
    } catch (e) {
      // Ignore cleanup errors
    }
  }
}

/**
 * Fallback estimator when tiktoken is unavailable
 */
class EstimatingTokenCounter implements TokenCounter {
  countTokens(text: string): number {
    if (!text) return 0;
    // Average English token is ~4 characters
    // Code can be denser, so we use 3.5 as a safer estimate
    return Math.ceil(text.length / 3.5);
  }

  countMessageTokens(messages: TokenCounterMessage[]): number {
    let chars = 0;
    for (const msg of messages) {
      chars += msg.role.length;
      if (msg.content) {
        if (typeof msg.content === 'string') {
          chars += msg.content.length;
        } else if (Array.isArray(msg.content)) {
          for (const part of msg.content) {
            if (typeof part === 'object' && part !== null && 'text' in part) {
              chars += (part as { text: string }).text.length;
            }
          }
        }
      }
      if (msg.tool_calls) chars += JSON.stringify(msg.tool_calls).length;
    }
    return this.countTokens('a'.repeat(chars)); // Dummy string for calc
  }

  estimateStreamingTokens(chunk: string): number {
    return this.countTokens(chunk);
  }

  dispose(): void {}
}
