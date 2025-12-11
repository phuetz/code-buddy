/**
 * Token Counter with Lazy Loading
 *
 * Tiktoken is lazy-loaded on first use to reduce startup time (23 MB module).
 * The module is loaded synchronously when first needed, but the application
 * can start without it.
 */

// Lazy-loaded tiktoken module
let tiktoken: typeof import('tiktoken') | null = null;
let loadAttempted = false;

/**
 * Lazily load tiktoken module (synchronous after first load)
 */
function getTiktoken(): typeof import('tiktoken') | null {
  if (tiktoken) return tiktoken;
  if (loadAttempted) return null;

  loadAttempted = true;
  try {
    // Dynamic require for lazy loading
     
    tiktoken = require('tiktoken');
  } catch {
    // Tiktoken not available, will use estimation
    tiktoken = null;
  }
  return tiktoken;
}

export class TokenCounter {
  private encoder: import('tiktoken').Tiktoken | null = null;
  private model: string;
  private initialized = false;

  constructor(model: string = 'gpt-4') {
    this.model = model;
  }

  /**
   * Initialize the encoder lazily
   */
  private ensureInitialized(): void {
    if (this.initialized) return;
    this.initialized = true;

    const tk = getTiktoken();
    if (!tk) return;

    try {
      // Try to get encoding for specific model
      this.encoder = tk.encoding_for_model(
        this.model as Parameters<typeof tk.encoding_for_model>[0]
      );
    } catch {
      // Fallback to cl100k_base (used by GPT-4 and most modern models)
      this.encoder = tk.get_encoding('cl100k_base');
    }
  }

  /**
   * Count tokens in a string
   */
  countTokens(text: string): number {
    if (!text) return 0;
    this.ensureInitialized();

    if (this.encoder) {
      return this.encoder.encode(text).length;
    }
    // Fallback: estimate ~4 chars per token
    return Math.ceil(text.length / 4);
  }

  /**
   * Count tokens in messages array (for chat completions)
   */
  countMessageTokens(
    messages: Array<{ role: string; content: string | null; tool_calls?: unknown }>
  ): number {
    let totalTokens = 0;

    for (const message of messages) {
      // Every message follows <|start|>{role/name}\n{content}<|end|\>\n
      totalTokens += 3; // Base tokens per message

      if (message.content && typeof message.content === 'string') {
        totalTokens += this.countTokens(message.content);
      }

      if (message.role) {
        totalTokens += this.countTokens(message.role);
      }

      // Add extra tokens for tool calls if present
      if (message.tool_calls) {
        totalTokens += this.countTokens(JSON.stringify(message.tool_calls));
      }
    }

    totalTokens += 3; // Every reply is primed with <|start|>assistant<|message|>

    return totalTokens;
  }

  /**
   * Estimate tokens for streaming content
   * This is an approximation since we don't have the full response yet
   */
  estimateStreamingTokens(accumulatedContent: string): number {
    return this.countTokens(accumulatedContent);
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    if (this.encoder) {
      this.encoder.free();
      this.encoder = null;
    }
    this.initialized = false;
  }
}

/**
 * Format token count for display (e.g., 1.2k for 1200)
 */
export function formatTokenCount(count: number): string {
  if (count <= 999) {
    return count.toString();
  }

  if (count < 1_000_000) {
    const k = count / 1000;
    return k % 1 === 0 ? `${k}k` : `${k.toFixed(1)}k`;
  }

  const m = count / 1_000_000;
  return m % 1 === 0 ? `${m}m` : `${m.toFixed(1)}m`;
}

/**
 * Create a token counter instance
 */
export function createTokenCounter(model?: string): TokenCounter {
  return new TokenCounter(model);
}

// Singleton instance for simple usage
let defaultCounter: TokenCounter | null = null;

/**
 * Count tokens in a string using default encoder
 * This is a convenience function for simple token counting
 *
 * @param text - The text to count tokens for
 * @returns Number of tokens
 *
 * @example
 * ```typescript
 * const count = countTokens('Hello, world!');
 * console.log(count); // 4
 * ```
 */
export function countTokens(text: string): number {
  if (!defaultCounter) {
    defaultCounter = new TokenCounter();
  }
  return defaultCounter.countTokens(text);
}

/**
 * Estimate tokens without loading tiktoken (fast approximation)
 * ~4 characters per token on average
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Preload tiktoken module in background (optional)
 * Call this early to warm up the module without blocking
 */
export function preloadTiktoken(): void {
  setTimeout(() => {
    getTiktoken();
  }, 100);
}
