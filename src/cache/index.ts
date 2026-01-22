/**
 * Cache Module
 *
 * Provides intelligent caching for expensive operations:
 * - LLM API responses (semantic similarity matching)
 * - File content (hash-based invalidation)
 * - Vector embeddings (persistent cache)
 * - Search results (file-change-aware invalidation)
 *
 * Features:
 * - LRU eviction with configurable TTL (adaptive TTL for hot entries)
 * - Semantic cache with LSH for fast similarity search
 * - Intelligent file-based invalidation with dependency tracking
 * - Comprehensive metrics (hit rate, miss rate, latency percentiles)
 * - Disk persistence for long sessions
 * - Tiered TTL for search results based on volatility
 * - Partial match fallback for similar queries
 *
 * Usage:
 * ```typescript
 * import { getCacheManager, initializeCacheManager } from './cache';
 *
 * // Initialize (once at startup)
 * const cache = await initializeCacheManager();
 *
 * // Restore from previous session
 * await cache.restoreFromDisk();
 *
 * // Read file with caching
 * const { content, cached } = await cache.readFile('/path/to/file.ts');
 *
 * // Get or compute embedding
 * const { embedding, cached } = await cache.getOrComputeEmbedding(
 *   content,
 *   () => embeddingProvider.embed(content)
 * );
 *
 * // Cache LLM response
 * cache.setLLMResponse(messages, response, 'grok-code-fast-1');
 *
 * // Get cached search results
 * const results = cache.getSearchResults(query, 'text');
 *
 * // Register dependencies for smart invalidation
 * cache.registerDependency('search-key-123', ['/path/to/file.ts']);
 *
 * // Invalidate on file change (also invalidates dependents)
 * cache.invalidateForFile('/path/to/changed-file.ts');
 *
 * // Get detailed metrics with health status
 * const metrics = cache.getDetailedMetrics();
 * console.log(metrics.health.status); // 'healthy' | 'warning' | 'critical'
 *
 * // Get statistics
 * console.log(cache.formatStats());
 *
 * // Persist to disk before shutdown
 * await cache.persistToDisk();
 * ```
 */

// Configuration
export { getCacheConfig, DEFAULT_CACHE_CONFIG, PERFORMANCE_CACHE_CONFIG, MEMORY_EFFICIENT_CACHE_CONFIG } from './cache-config.js';
export type { UnifiedCacheConfig, CacheLayerConfig } from './cache-config.js';

// Unified Cache Manager
export { CacheManager, getCacheManager, initializeCacheManager, resetCacheManager } from './cache-manager.js';
export type { UnifiedCacheStats, CacheManagerConfig } from './cache-manager.js';

// Individual Caches
export { LLMResponseCache, getLLMResponseCache, resetLLMResponseCache } from './llm-response-cache.js';
export type { LLMCacheEntry, LLMCacheConfig, LLMCacheStats } from './llm-response-cache.js';

export { FileContentCache, getFileContentCache, resetFileContentCache } from './file-content-cache.js';
export type { FileCacheEntry, FileCacheConfig, FileCacheStats } from './file-content-cache.js';

export { EmbeddingCache, getEmbeddingCache, resetEmbeddingCache } from './embedding-cache.js';
export type { EmbeddingCacheEntry, EmbeddingCacheConfig, EmbeddingCacheStats } from './embedding-cache.js';

export { SearchResultsCache, getSearchResultsCache, resetSearchResultsCache } from './search-results-cache.js';
export type { SearchCacheEntry, SearchCacheConfig, SearchCacheStats } from './search-results-cache.js';

// Advanced LRU Cache
export { AdvancedLRUCache, createEmbeddingCache, createApiResponseCache, createSearchCache } from './advanced-lru-cache.js';
export type { AdvancedLRUCacheConfig, CacheEntry as AdvancedCacheEntry, CacheMetrics } from './advanced-lru-cache.js';
