/**
 * Prompt Caching Module
 *
 * Implements prompt caching for LLM API calls to reduce costs and latency.
 * Research shows up to 90% cost reduction and 80% latency improvement.
 *
 * References:
 * - OpenAI Prompt Caching: https://platform.openai.com/docs/guides/prompt-caching
 * - Anthropic Prompt Caching: https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
 */

import { createHash } from "crypto";
import { EventEmitter } from "events";
import { logger } from "../utils/logger.js";
import type { CodeBuddyMessage, CodeBuddyTool } from "../codebuddy/client.js";

/**
 * Cache entry structure
 */
export interface CacheEntry {
  hash: string;
  timestamp: number;
  hitCount: number;
  tokens: number;
  type: "system" | "tools" | "context" | "full";
}

/**
 * Cache statistics
 */
export interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  totalTokensSaved: number;
  estimatedCostSaved: number;
  entries: number;
}

/**
 * Cache configuration
 */
export interface CacheConfig {
  enabled: boolean;
  maxEntries: number;
  ttlMs: number;
  minTokensToCache: number;
  costPerMillion: number; // Cost per million input tokens
}

/**
 * Default cache configuration
 */
export const DEFAULT_CACHE_CONFIG: CacheConfig = {
  enabled: true,
  maxEntries: 1000,
  ttlMs: 5 * 60 * 1000, // 5 minutes (matches OpenAI auto-cache TTL)
  minTokensToCache: 1024,
  costPerMillion: 3.0, // Default for grok models
};

/**
 * Prompt Cache Manager
 *
 * Manages caching of prompt components to optimize API costs.
 * Implements LRU eviction and TTL-based expiration.
 */
export class PromptCacheManager extends EventEmitter {
  private config: CacheConfig;
  private cache: Map<string, CacheEntry> = new Map();
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    hitRate: 0,
    totalTokensSaved: 0,
    estimatedCostSaved: 0,
    entries: 0,
  };

  // Cached prompt components for session
  private systemPromptHash: string | null = null;
  private toolsHash: string | null = null;
  private contextHashes: Map<string, string> = new Map();

  constructor(config: Partial<CacheConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CACHE_CONFIG, ...config };
  }

  /**
   * Generate hash for content
   */
  private hash(content: string): string {
    return createHash("sha256").update(content).digest("hex").slice(0, 16);
  }

  /**
   * Estimate token count (rough approximation)
   */
  private estimateTokens(content: string): number {
    // Rough estimate: 1 token ≈ 4 characters
    return Math.ceil(content.length / 4);
  }

  /**
   * Check if cache entry is valid
   */
  private isValid(entry: CacheEntry): boolean {
    return Date.now() - entry.timestamp < this.config.ttlMs;
  }

  /**
   * Evict expired entries
   */
  private evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now - entry.timestamp >= this.config.ttlMs) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Evict LRU entries if at capacity
   */
  private evictLRU(): void {
    if (this.cache.size <= this.config.maxEntries) return;

    // Sort by timestamp (oldest first)
    const sorted = [...this.cache.entries()].sort(
      (a, b) => a[1].timestamp - b[1].timestamp
    );

    // Remove oldest entries
    const toRemove = sorted.slice(0, this.cache.size - this.config.maxEntries);
    for (const [key] of toRemove) {
      this.cache.delete(key);
    }
  }

  /**
   * Cache system prompt
   */
  cacheSystemPrompt(prompt: string): string {
    const hash = this.hash(prompt);
    const tokens = this.estimateTokens(prompt);

    if (tokens >= this.config.minTokensToCache) {
      this.addEntry(hash, tokens, "system");
      this.systemPromptHash = hash;
    }

    return hash;
  }

  /**
   * Cache tools definition
   */
  cacheTools(tools: CodeBuddyTool[]): string {
    const content = JSON.stringify(tools);
    const hash = this.hash(content);
    const tokens = this.estimateTokens(content);

    if (tokens >= this.config.minTokensToCache) {
      this.addEntry(hash, tokens, "tools");
      this.toolsHash = hash;
    }

    return hash;
  }

  /**
   * Cache context content
   */
  cacheContext(key: string, content: string): string {
    const hash = this.hash(content);
    const tokens = this.estimateTokens(content);

    if (tokens >= this.config.minTokensToCache) {
      this.addEntry(hash, tokens, "context");
      this.contextHashes.set(key, hash);
    }

    return hash;
  }

  /**
   * Add cache entry
   */
  private addEntry(hash: string, tokens: number, type: CacheEntry["type"]): void {
    this.evictExpired();
    this.evictLRU();

    const existing = this.cache.get(hash);
    if (existing && this.isValid(existing)) {
      // Cache hit
      existing.hitCount++;
      existing.timestamp = Date.now();
      this.stats.hits++;
      this.stats.totalTokensSaved += tokens;
      this.stats.estimatedCostSaved +=
        (tokens / 1_000_000) * this.config.costPerMillion * 0.9; // 90% discount
      this.emit("cache:hit", { hash, tokens, type });
    } else {
      // Cache miss
      this.cache.set(hash, {
        hash,
        timestamp: Date.now(),
        hitCount: 0,
        tokens,
        type,
      });
      this.stats.misses++;
      this.emit("cache:miss", { hash, tokens, type });
      
      // Check limits after adding
      this.evictLRU();
    }

    this.stats.entries = this.cache.size;
    this.stats.hitRate =
      this.stats.hits / (this.stats.hits + this.stats.misses);
  }

  /**
   * Check if content is cached
   */
  isCached(content: string): boolean {
    const hash = this.hash(content);
    const entry = this.cache.get(hash);
    return entry !== undefined && this.isValid(entry);
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * Format stats for display
   */
  formatStats(): string {
    const lines: string[] = [
      "📦 Prompt Cache Statistics",
      `├─ Entries: ${this.stats.entries}`,
      `├─ Hit Rate: ${(this.stats.hitRate * 100).toFixed(1)}%`,
      `├─ Tokens Saved: ${this.stats.totalTokensSaved.toLocaleString()}`,
      `└─ Est. Cost Saved: $${this.stats.estimatedCostSaved.toFixed(4)}`,
    ];
    return lines.join("\n");
  }

  /**
   * Clear cache
   */
  clear(): void {
    this.cache.clear();
    this.systemPromptHash = null;
    this.toolsHash = null;
    this.contextHashes.clear();
    logger.debug("Prompt cache cleared");
  }

  /**
   * Warm cache with common prompts
   */
  warmCache(prompts: { system?: string; tools?: CodeBuddyTool[] }): void {
    if (prompts.system) {
      this.cacheSystemPrompt(prompts.system);
    }
    if (prompts.tools) {
      this.cacheTools(prompts.tools);
    }
    this.emit("cache:warmed");
  }

  /**
   * Structure messages for optimal caching
   *
   * OpenAI/Anthropic cache prompts from the beginning, so static content
   * should come first. This reorders messages to maximize cache hits.
   */
  structureForCaching(messages: CodeBuddyMessage[]): CodeBuddyMessage[] {
    if (!this.config.enabled) return messages;

    // Separate static vs dynamic content
    const systemMessages: CodeBuddyMessage[] = [];
    const otherMessages: CodeBuddyMessage[] = [];

    for (const msg of messages) {
      if (msg.role === "system") {
        systemMessages.push(msg);
      } else {
        otherMessages.push(msg);
      }
    }

    // System messages first (most static, most cacheable)
    return [...systemMessages, ...otherMessages];
  }

  /**
   * Get configuration
   */
  getConfig(): CacheConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<CacheConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

// Singleton instance
let cacheManager: PromptCacheManager | null = null;

/**
 * Get or create cache manager instance
 */
export function getPromptCacheManager(
  config?: Partial<CacheConfig>
): PromptCacheManager {
  if (!cacheManager) {
    cacheManager = new PromptCacheManager(config);
  }
  return cacheManager;
}

/**
 * Initialize cache manager with config
 */
export function initializePromptCache(
  config?: Partial<CacheConfig>
): PromptCacheManager {
  cacheManager = new PromptCacheManager(config);
  return cacheManager;
}
