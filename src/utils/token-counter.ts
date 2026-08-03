/**
 * Token Counter with Lazy Loading
 *
 * Tiktoken is lazy-loaded on first use to reduce startup time (23 MB module).
 * The module is loaded synchronously when first needed, but the application
 * can start without it.
 *
 * This is the canonical TokenCounter implementation for the entire codebase.
 * The previous duplicate at src/context/token-counter.ts has been collapsed
 * into a thin re-export shim that forwards to this module so there is a
 * single source of truth for token counting and a single tiktoken load.
 */

/**
 * Simplified message shape for token counting.
 * Supports both string content and multimodal content arrays.
 */
export interface TokenCounterMessage {
  role: string;
  content: string | null | unknown[];
  tool_calls?: unknown[];
}

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
   * Count tokens in messages array (for chat completions).
   *
   * Accepts the widened TokenCounterMessage shape so multimodal content
   * (array of parts like `{ type: "text", text: "..." }`) is handled —
   * previously this was only in the context/ duplicate, so callers that
   * passed image messages got zero tokens for the content.
   */
  countMessageTokens(messages: TokenCounterMessage[]): number {
    let totalTokens = 0;

    for (const message of messages) {
      // Every message follows <|start|>{role/name}\n{content}<|end|\>\n
      totalTokens += 3; // Base tokens per message

      if (message.content) {
        if (typeof message.content === 'string') {
          totalTokens += this.countTokens(message.content);
        } else if (Array.isArray(message.content)) {
          // Multimodal content parts — count the text parts; image parts
          // are tracked by the provider-specific pricing, not by us.
          //
          // ⚠️ This differs on purpose from the free functions in
          // src/context/token-counter.ts, which DO add a per-image budget:
          // pricing is the provider's business, context budgeting is ours.
          // A caller that needs the context budget must therefore add
          // `estimateImageUrlTokens(message.content)` itself — see how
          // ContextManagerV2.countTokens and EnhancedContextCompressor do it.
          // Do not "fix" this by adding images here without checking every
          // cost-estimation caller of this class.
          for (const part of message.content) {
            if (typeof part === 'object' && part !== null && 'text' in part && typeof (part as { text: unknown }).text === 'string') {
              totalTokens += this.countTokens((part as { text: string }).text);
            }
          }
        }
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

// ============================================================================
// Cost Calculation
// ============================================================================

/**
 * Token pricing per 1K tokens (in USD)
 */
export const TOKEN_PRICING: Record<string, { input: number; output: number }> = {
  // OpenAI
  'gpt-4o': { input: 0.0025, output: 0.01 },
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'gpt-4-turbo': { input: 0.01, output: 0.03 },
  'gpt-4': { input: 0.03, output: 0.06 },
  'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
  // Anthropic
  'claude-3-opus': { input: 0.015, output: 0.075 },
  'claude-3-sonnet': { input: 0.003, output: 0.015 },
  'claude-3-haiku': { input: 0.00025, output: 0.00125 },
  'claude-3.5-sonnet': { input: 0.003, output: 0.015 },
  // xAI Grok
  'grok-2': { input: 0.002, output: 0.01 },
  'grok-2-mini': { input: 0.0002, output: 0.001 },
  'grok-3': { input: 0.003, output: 0.015 },
  'grok-3-mini': { input: 0.0003, output: 0.0015 },
  // Local models (free)
  'local': { input: 0, output: 0 },
  'ollama': { input: 0, output: 0 },
  'lmstudio': { input: 0, output: 0 },
};

/**
 * Calculate cost for a request
 */
export function calculateCost(
  inputTokens: number,
  outputTokens: number,
  model: string
): { inputCost: number; outputCost: number; totalCost: number } {
  // Find pricing (check for partial match)
  let pricing = TOKEN_PRICING[model];
  if (!pricing) {
    // Try to match by prefix
    const lowerModel = model.toLowerCase();
    for (const [key, value] of Object.entries(TOKEN_PRICING)) {
      if (lowerModel.includes(key.toLowerCase())) {
        pricing = value;
        break;
      }
    }
  }

  // Default to local (free) if not found
  const effectivePricing = pricing ?? { input: 0, output: 0 };

  const inputCost = (inputTokens / 1000) * effectivePricing.input;
  const outputCost = (outputTokens / 1000) * effectivePricing.output;

  return {
    inputCost,
    outputCost,
    totalCost: inputCost + outputCost,
  };
}

/**
 * Format cost for display
 */
export function formatCost(cost: number): string {
  if (cost === 0) return 'Free';
  if (cost < 0.001) return `$${(cost * 1000).toFixed(3)}m`; // millicents
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  if (cost < 1) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(2)}`;
}
