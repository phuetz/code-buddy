/**
 * Token Counter — unified surface that re-exports the canonical class
 * from src/utils/token-counter.ts while keeping the free-function API
 * (countTokens / countMessageTokens / countMessagesTokens) that the
 * context/compaction/* modules import.
 *
 * Historically there were two full implementations (this file and
 * src/utils/token-counter.ts). The class is now a single source of
 * truth — this file delegates to it via createTokenCounter() and a
 * model-keyed cache. The free functions still take a `model` parameter
 * because callers in src/context/compaction/* use that signature.
 *
 * Note: we intentionally still `import` from 'tiktoken' here so tests
 * that mock `tiktoken` at the vitest level (see context-manager-v3.test
 * for the canonical pattern) continue to affect token counting used by
 * context management code. The utils canonical class uses a lazy
 * `require('tiktoken')` which is not intercepted by ESM vi.mock.
 */

import { encoding_for_model, TiktokenModel, get_encoding, Tiktoken } from 'tiktoken';
import { logger } from '../utils/logger.js';
import {
  TokenCounter as CanonicalTokenCounter,
  createTokenCounter as canonicalCreateTokenCounter,
  type TokenCounterMessage,
} from '../utils/token-counter.js';

export type { TokenCounterMessage } from '../utils/token-counter.js';
/** Re-exported for callers that used the context/ interface name. */
export type TokenCounter = CanonicalTokenCounter;

/** Conservative context-budget estimate for one OpenAI-style image part. */
export const IMAGE_URL_TOKEN_ESTIMATE = 1100;

/** Count the fixed token budget contributed by multimodal `image_url` parts. */
export function estimateImageUrlTokens(content: unknown): number {
  if (!Array.isArray(content)) return 0;

  let imageCount = 0;
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    const candidate = part as { type?: unknown; image_url?: unknown };
    if (candidate.type !== 'image_url' || !candidate.image_url || typeof candidate.image_url !== 'object') {
      continue;
    }
    const imageUrl = candidate.image_url as { url?: unknown };
    if (typeof imageUrl.url === 'string' && imageUrl.url.length > 0) {
      imageCount++;
    }
  }
  return imageCount * IMAGE_URL_TOKEN_ESTIMATE;
}

/**
 * Create a token counter instance.
 * Returns the canonical lazy-loaded counter from utils/token-counter.ts
 * so streaming-handler, context-manager-v2 and friends all share the
 * same implementation and the same tiktoken WASM load.
 */
export function createTokenCounter(model: string = 'gpt-4'): CanonicalTokenCounter {
  return canonicalCreateTokenCounter(model);
}

// ============================================================================
// Free functions with the legacy `(text, model)` signature.
//
// These intentionally use a LOCAL tiktoken encoder instead of delegating
// to the canonical class, because several context-management tests mock
// `tiktoken` at the vi.mock level and expect that mock to apply to these
// functions. Keeping a direct tiktoken import here preserves that
// behavior (the class-based path still uses lazy `require('tiktoken')`
// for startup speed).
// ============================================================================

interface ModelEncoder {
  encoder: Tiktoken | null;
}

const encoderCache = new Map<string, ModelEncoder>();

function getEncoder(model: string): Tiktoken | null {
  const cached = encoderCache.get(model);
  if (cached) return cached.encoder;

  let encoder: Tiktoken | null = null;
  try {
    encoder = encoding_for_model(model as TiktokenModel);
  } catch {
    try {
      encoder = get_encoding('cl100k_base');
    } catch (err) {
      logger.debug('Failed to initialize tiktoken encoder, falling back to estimation', { err });
      encoder = null;
    }
  }
  encoderCache.set(model, { encoder });
  return encoder;
}

function estimateTokensFromChars(text: string): number {
  return Math.ceil((text || '').length / 4);
}

/** Count tokens in a plain text string for the given model. */
export function countTokens(text: string, model: string = 'gpt-4'): number {
  if (!text) return 0;
  const enc = getEncoder(model);
  if (!enc) return estimateTokensFromChars(text);
  try {
    return enc.encode(text).length;
  } catch {
    return estimateTokensFromChars(text);
  }
}

function tokensForMessage(message: TokenCounterMessage, model: string): number {
  let n = 3; // per-message overhead
  n += countTokens(message.role || '', model);
  if (message.content) {
    if (typeof message.content === 'string') {
      n += countTokens(message.content, model);
    } else if (Array.isArray(message.content)) {
      for (const part of message.content) {
        if (typeof part === 'object' && part !== null && 'text' in part && typeof (part as { text: unknown }).text === 'string') {
          n += countTokens((part as { text: string }).text, model);
        }
      }
      n += estimateImageUrlTokens(message.content);
    }
  }
  if (message.tool_calls) {
    n += countTokens(JSON.stringify(message.tool_calls), model);
  }
  return n;
}

/** Count tokens in a single message. */
export function countMessageTokens(message: TokenCounterMessage, model: string = 'gpt-4'): number {
  return tokensForMessage(message, model) + 3; // priming tokens
}

/** Count tokens in an array of messages. */
export function countMessagesTokens(messages: TokenCounterMessage[], model: string = 'gpt-4'): number {
  let total = 0;
  for (const m of messages) total += tokensForMessage(m, model);
  return total + 3; // priming tokens
}
