/**
 * LLM Response Cache
 *
 * Implements intelligent caching for LLM API responses using semantic similarity.
 * Key features:
 * - Semantic matching using n-gram embeddings
 * - Prompt prefix matching for context-aware caching
 * - Cost tracking and savings estimation
 * - Automatic invalidation for stale entries
 *
 * Research shows 60-70% API call reduction with semantic caching.
 */

import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger.js';
import type { CodeBuddyMessage } from '../codebuddy/client.js';

// ============================================================================
// Types
// ============================================================================

export interface LLMCacheEntry {
  key: string;
  queryHash: string;
  queryPrefix: string; // First N chars for quick filtering
  embedding: number[];
  response: {
    content: string | null;
    toolCalls?: unknown[];
    usage?: {
      promptTokens: number;
      completionTokens: number;
    };
  };
  model: string;
  timestamp: number;
  expiresAt: number;
  hits: number;
  tokensSaved: number;
  metadata?: {
    systemPromptHash?: string;
    toolsHash?: string;
    messageCount?: number;
  };
}

export interface LLMCacheConfig {
  enabled: boolean;
  ttlMs: number;
  maxEntries: number;
  similarityThreshold: number;
  minTokensToCache: number;
  costPerMillion: number;
  persistToDisk: boolean;
  cachePath: string;
  prefixLength: number; // Length of query prefix for quick filtering
  embeddingDim: number;
  ngramSize: number;
}

export interface LLMCacheStats {
  totalEntries: number;
  hits: number;
  misses: number;
  hitRate: number;
  semanticHits: number;
  exactHits: number;
  tokensSaved: number;
  estimatedCostSaved: number;
  evictions: number;
  avgSimilarity: number;
  cacheSize: number;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: LLMCacheConfig = {
  enabled: true,
  ttlMs: 10 * 60 * 1000, // 10 minutes
  maxEntries: 500,
  similarityThreshold: 0.92,
  minTokensToCache: 100,
  costPerMillion: 3.0,
  persistToDisk: true,
  cachePath: '.codebuddy/cache/llm-response-cache.json',
  prefixLength: 200,
  embeddingDim: 128,
  ngramSize: 3,
};

// ============================================================================
// LLM Response Cache
// ============================================================================

export class LLMResponseCache extends EventEmitter {
  private cache: Map<string, LLMCacheEntry> = new Map();
  private config: LLMCacheConfig;
  private stats: LLMCacheStats = {
    totalEntries: 0,
    hits: 0,
    misses: 0,
    hitRate: 0,
    semanticHits: 0,
    exactHits: 0,
    tokensSaved: 0,
    estimatedCostSaved: 0,
    evictions: 0,
    avgSimilarity: 0,
    cacheSize: 0,
  };
  private similarityScores: number[] = [];
  private saveTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly saveDebounceMs = 2000;

  constructor(config: Partial<LLMCacheConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };

    if (this.config.persistToDisk) {
      this.loadFromDisk();
    }
  }

  /**
   * Try to get a cached response for the given messages
   */
  async get(
    messages: CodeBuddyMessage[],
    model: string,
    options?: { systemPromptHash?: string; toolsHash?: string }
  ): Promise<LLMCacheEntry | null> {
    if (!this.config.enabled) return null;

    // Extract query from messages (last user message)
    const query = this.extractQuery(messages);
    if (!query || query.length < 20) return null;

    // Try exact match first
    const exactKey = this.createExactKey(query, model, options);
    const exactMatch = this.cache.get(exactKey);

    if (exactMatch && !this.isExpired(exactMatch)) {
      exactMatch.hits++;
      this.stats.hits++;
      this.stats.exactHits++;
      this.stats.tokensSaved += exactMatch.tokensSaved;
      this.updateStats();
      this.emit('cache:hit', { type: 'exact', key: exactKey });
      return exactMatch;
    }

    // Try semantic match
    const semanticMatch = this.findSemanticMatch(query, model, options);
    if (semanticMatch) {
      semanticMatch.entry.hits++;
      this.stats.hits++;
      this.stats.semanticHits++;
      this.stats.tokensSaved += semanticMatch.entry.tokensSaved;
      this.similarityScores.push(semanticMatch.similarity);
      if (this.similarityScores.length > 1000) {
        this.similarityScores.splice(0, this.similarityScores.length - 500);
      }
      this.updateStats();
      this.emit('cache:hit', { type: 'semantic', similarity: semanticMatch.similarity });
      return semanticMatch.entry;
    }

    this.stats.misses++;
    this.updateStats();
    this.emit('cache:miss', { query: query.substring(0, 100) });
    return null;
  }

  /**
   * Store a response in the cache
   */
  set(
    messages: CodeBuddyMessage[],
    response: LLMCacheEntry['response'],
    model: string,
    options?: { systemPromptHash?: string; toolsHash?: string }
  ): void {
    if (!this.config.enabled) return;

    const query = this.extractQuery(messages);
    if (!query || query.length < 20) return;

    // Check minimum tokens to cache
    const totalTokens =
      (response.usage?.promptTokens || 0) + (response.usage?.completionTokens || 0);
    if (totalTokens < this.config.minTokensToCache) return;

    // Evict if at capacity
    this.evictIfNeeded();

    const key = this.createExactKey(query, model, options);
    const entry: LLMCacheEntry = {
      key,
      queryHash: this.hashString(query),
      queryPrefix: query.substring(0, this.config.prefixLength),
      embedding: this.computeEmbedding(query),
      response,
      model,
      timestamp: Date.now(),
      expiresAt: Date.now() + this.config.ttlMs,
      hits: 0,
      tokensSaved: totalTokens,
      metadata: {
        systemPromptHash: options?.systemPromptHash,
        toolsHash: options?.toolsHash,
        messageCount: messages.length,
      },
    };

    this.cache.set(key, entry);
    this.stats.totalEntries = this.cache.size;
    this.emit('cache:set', { key, tokens: totalTokens });

    if (this.config.persistToDisk) {
      this.scheduleSave();
    }
  }

  /**
   * Extract query from messages (typically last user message)
   */
  private extractQuery(messages: CodeBuddyMessage[]): string {
    // Get last user message
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === 'user' && typeof msg.content === 'string') {
        return msg.content;
      }
    }
    return '';
  }

  /**
   * Create exact match key
   */
  private createExactKey(
    query: string,
    model: string,
    options?: { systemPromptHash?: string; toolsHash?: string }
  ): string {
    const parts = [
      model,
      this.hashString(query),
      options?.systemPromptHash || '',
      options?.toolsHash || '',
    ];
    return parts.join(':');
  }

  /**
   * Find semantic match in cache
   */
  private findSemanticMatch(
    query: string,
    model: string,
    options?: { systemPromptHash?: string; toolsHash?: string }
  ): { entry: LLMCacheEntry; similarity: number } | null {
    const queryPrefix = query.substring(0, this.config.prefixLength);
    const queryEmbedding = this.computeEmbedding(query);

    let bestMatch: LLMCacheEntry | null = null;
    let bestSimilarity = 0;

    const entries = Array.from(this.cache.values());
    for (const entry of entries) {
      // Skip if expired
      if (this.isExpired(entry)) continue;

      // Skip if different model
      if (entry.model !== model) continue;

      // Skip if system prompt or tools changed
      if (options?.systemPromptHash && entry.metadata?.systemPromptHash !== options.systemPromptHash) {
        continue;
      }
      if (options?.toolsHash && entry.metadata?.toolsHash !== options.toolsHash) {
        continue;
      }

      // Quick prefix check first (fast rejection)
      const prefixSimilarity = this.prefixSimilarity(queryPrefix, entry.queryPrefix);
      if (prefixSimilarity < 0.3) continue;

      // Full semantic similarity
      const similarity = this.cosineSimilarity(queryEmbedding, entry.embedding);
      if (similarity > bestSimilarity && similarity >= this.config.similarityThreshold) {
        bestSimilarity = similarity;
        bestMatch = entry;
      }
    }

    return bestMatch ? { entry: bestMatch, similarity: bestSimilarity } : null;
  }

  /**
   * Compute n-gram based embedding
   */
  private computeEmbedding(text: string): number[] {
    const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
    const embedding = new Array(this.config.embeddingDim).fill(0);

    // Extract n-grams
    for (let i = 0; i <= normalized.length - this.config.ngramSize; i++) {
      const ngram = normalized.slice(i, i + this.config.ngramSize);
      const hash = this.simpleHash(ngram);
      const index = hash % this.config.embeddingDim;
      embedding[index] += 1;
    }

    // Normalize
    const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    if (magnitude > 0) {
      for (let i = 0; i < embedding.length; i++) {
        embedding[i] /= magnitude;
      }
    }

    return embedding;
  }

  /**
   * Compute cosine similarity
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let magnitudeA = 0;
    let magnitudeB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      magnitudeA += a[i] * a[i];
      magnitudeB += b[i] * b[i];
    }

    const magnitude = Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB);
    return magnitude > 0 ? dotProduct / magnitude : 0;
  }

  /**
   * Quick prefix similarity (Jaccard of words)
   */
  private prefixSimilarity(a: string, b: string): number {
    const wordsA = new Set(a.toLowerCase().split(/\s+/));
    const wordsB = new Set(b.toLowerCase().split(/\s+/));

    let intersection = 0;
    for (const word of wordsA) {
      if (wordsB.has(word)) intersection++;
    }

    const union = wordsA.size + wordsB.size - intersection;
    return union > 0 ? intersection / union : 0;
  }

  /**
   * Simple hash function
   */
  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  /**
   * Hash string using SHA256
   */
  private hashString(str: string): string {
    return crypto.createHash('sha256').update(str).digest('hex').slice(0, 16);
  }

  /**
   * Check if entry is expired
   */
  private isExpired(entry: LLMCacheEntry): boolean {
    return Date.now() > entry.expiresAt;
  }

  /**
   * Evict entries if at capacity
   */
  private evictIfNeeded(): void {
    // First, remove expired entries
    for (const [key, entry] of this.cache.entries()) {
      if (this.isExpired(entry)) {
        this.cache.delete(key);
        this.stats.evictions++;
      }
    }

    // Then evict LRU if still over capacity
    while (this.cache.size >= this.config.maxEntries) {
      let oldestKey: string | null = null;
      let oldestTime = Infinity;

      for (const [key, entry] of this.cache.entries()) {
        if (entry.timestamp < oldestTime) {
          oldestTime = entry.timestamp;
          oldestKey = key;
        }
      }

      if (oldestKey) {
        this.cache.delete(oldestKey);
        this.stats.evictions++;
      } else {
        break;
      }
    }
  }

  /**
   * Update statistics
   */
  private updateStats(): void {
    const total = this.stats.hits + this.stats.misses;
    this.stats.hitRate = total > 0 ? this.stats.hits / total : 0;
    this.stats.estimatedCostSaved =
      (this.stats.tokensSaved / 1_000_000) * this.config.costPerMillion * 0.9;
    this.stats.avgSimilarity =
      this.similarityScores.length > 0
        ? this.similarityScores.reduce((a, b) => a + b, 0) / this.similarityScores.length
        : 0;
    this.stats.cacheSize = this.cache.size;
  }

  /**
   * Get cache statistics
   */
  getStats(): LLMCacheStats {
    return { ...this.stats };
  }

  /**
   * Format statistics for display
   */
  formatStats(): string {
    const lines = [
      'LLM Response Cache Statistics',
      `  Entries: ${this.stats.totalEntries}`,
      `  Hit Rate: ${(this.stats.hitRate * 100).toFixed(1)}%`,
      `  Exact Hits: ${this.stats.exactHits}`,
      `  Semantic Hits: ${this.stats.semanticHits}`,
      `  Tokens Saved: ${this.stats.tokensSaved.toLocaleString()}`,
      `  Est. Cost Saved: $${this.stats.estimatedCostSaved.toFixed(4)}`,
      `  Avg Similarity: ${(this.stats.avgSimilarity * 100).toFixed(1)}%`,
    ];
    return lines.join('\n');
  }

  /**
   * Clear cache
   */
  clear(): void {
    this.cache.clear();
    this.stats = {
      totalEntries: 0,
      hits: 0,
      misses: 0,
      hitRate: 0,
      semanticHits: 0,
      exactHits: 0,
      tokensSaved: 0,
      estimatedCostSaved: 0,
      evictions: 0,
      avgSimilarity: 0,
      cacheSize: 0,
    };
    this.similarityScores = [];
    this.emit('cache:clear');
  }

  /**
   * Invalidate entries matching pattern
   */
  invalidate(pattern: RegExp): number {
    let count = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (pattern.test(entry.queryPrefix)) {
        this.cache.delete(key);
        count++;
      }
    }
    return count;
  }

  /**
   * Schedule debounced save
   */
  private scheduleSave(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    this.saveTimeout = setTimeout(() => {
      this.saveToDisk();
    }, this.saveDebounceMs);
  }

  /**
   * Save to disk
   */
  private async saveToDisk(): Promise<void> {
    if (!this.config.persistToDisk) return;

    try {
      const dir = path.dirname(this.config.cachePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      const entries = Array.from(this.cache.values())
        .filter(e => !this.isExpired(e))
        .slice(0, this.config.maxEntries);

      await fs.writeFile(
        this.config.cachePath,
        JSON.stringify({ entries, stats: this.stats }, null, 2)
      );
    } catch (error) {
      logger.debug('Failed to save LLM cache', { error });
    }
  }

  /**
   * Load from disk
   */
  private loadFromDisk(): void {
    if (!this.config.persistToDisk) return;

    (async () => {
      try {
        const content = await fs.readFile(this.config.cachePath, 'utf-8');
        const data = JSON.parse(content);

        if (Array.isArray(data.entries)) {
          const now = Date.now();
          for (const entry of data.entries) {
            if (entry.expiresAt > now) {
              this.cache.set(entry.key, entry);
            }
          }
          this.stats.totalEntries = this.cache.size;
          this.emit('cache:loaded', { count: this.cache.size });
        }
      } catch {
        // File doesn't exist or is invalid
      }
    })();
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    this.saveToDisk();
    this.cache.clear();
    this.removeAllListeners();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: LLMResponseCache | null = null;

export function getLLMResponseCache(config?: Partial<LLMCacheConfig>): LLMResponseCache {
  if (!instance) {
    instance = new LLMResponseCache(config);
  }
  return instance;
}

export function resetLLMResponseCache(): void {
  if (instance) {
    instance.dispose();
  }
  instance = null;
}
