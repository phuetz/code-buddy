/**
 * Search Module
 *
 * Hybrid search combining vector similarity and BM25 keyword search
 * for improved recall and precision across memories, code, and messages.
 *
 * @example
 * ```typescript
 * import { getHybridSearchEngine } from './search';
 *
 * const engine = getHybridSearchEngine();
 * await engine.initialize();
 *
 * // Hybrid search (default: 70% vector, 30% BM25)
 * const results = await engine.search({
 *   query: 'how to handle authentication',
 *   limit: 10,
 * });
 *
 * // Vector-only search
 * const vectorResults = await engine.search({
 *   query: 'semantic similarity search',
 *   vectorOnly: true,
 * });
 *
 * // BM25-only search
 * const keywordResults = await engine.search({
 *   query: 'exact keyword match',
 *   bm25Only: true,
 * });
 *
 * // Custom weights
 * const customResults = await engine.search({
 *   query: 'balanced search',
 *   vectorWeight: 0.5,
 *   bm25Weight: 0.5,
 * });
 * ```
 */

// Types
export type {
  HybridSearchResult,
  HybridSearchOptions,
  HybridSearchConfig,
  SearchSource,
  BM25Config,
  BM25Document,
  BM25Stats,
  FTS5Config,
  FTS5MatchResult,
  HybridSearchEvents,
} from './types.js';

export {
  DEFAULT_BM25_CONFIG,
  DEFAULT_HYBRID_CONFIG,
} from './types.js';

// BM25
export {
  BM25Index,
  getBM25Index,
  removeBM25Index,
  clearAllBM25Indexes,
  tokenize,
  stem,
  tokenizeAndStem,
} from './bm25.js';

// Hybrid Search (main API)
export {
  HybridSearchEngine,
  getHybridSearchEngine,
  resetHybridSearchEngine,
} from './hybrid-search.js';

// USearch Vector Index (high-performance ANN)
export type {
  USearchMetric,
  USearchDType,
  USearchIndexConfig,
  USearchResult,
  IndexableVector,
  VectorSearchResult,
  USearchStats,
  USearchEvents,
} from './usearch-index.js';

export {
  DEFAULT_USEARCH_CONFIG,
  USearchVectorIndex,
  getUSearchIndex,
  removeUSearchIndex,
  clearAllUSearchIndexes,
} from './usearch-index.js';
