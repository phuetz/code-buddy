/**
 * Hybrid Search Types
 *
 * Types for hybrid search combining vector similarity (semantic)
 * and BM25 (keyword) search for improved recall and precision.
 */

// ============================================================================
// Search Result Types
// ============================================================================

/**
 * A single search result
 */
export interface HybridSearchResult {
  /** Unique identifier of the result */
  id: string;
  /** Content of the result */
  content: string;
  /** Combined hybrid score (0-1) */
  score: number;
  /** Vector similarity score (0-1) */
  vectorScore: number;
  /** BM25 keyword score (normalized 0-1) */
  bm25Score: number;
  /** Source of the result (memories, code, etc.) */
  source: SearchSource;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Source of search results
 */
export type SearchSource =
  | 'memories'
  | 'code'
  | 'messages'
  | 'cache';

/**
 * Search options
 */
export interface HybridSearchOptions {
  /** Search query */
  query: string;
  /** Maximum results to return */
  limit?: number;
  /** Minimum score threshold (0-1) */
  minScore?: number;
  /** Weight for vector search (0-1, default 0.7) */
  vectorWeight?: number;
  /** Weight for BM25 search (0-1, default 0.3) */
  bm25Weight?: number;
  /** Sources to search */
  sources?: SearchSource[];
  /** Filter by project ID */
  projectId?: string;
  /** Filter by type (for memories) */
  types?: string[];
  /** Whether to use only vector search */
  vectorOnly?: boolean;
  /** Whether to use only BM25 search */
  bm25Only?: boolean;
}

// ============================================================================
// BM25 Types
// ============================================================================

/**
 * BM25 configuration parameters
 */
export interface BM25Config {
  /** k1: Term frequency saturation parameter (default: 1.2) */
  k1: number;
  /** b: Length normalization parameter (default: 0.75) */
  b: number;
  /** Minimum document frequency for a term to be considered */
  minDocFreq?: number;
}

/**
 * Default BM25 configuration
 */
export const DEFAULT_BM25_CONFIG: BM25Config = {
  k1: 1.2,
  b: 0.75,
  minDocFreq: 1,
};

/**
 * BM25 document for indexing
 */
export interface BM25Document {
  /** Document ID */
  id: string;
  /** Document content (will be tokenized) */
  content: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * BM25 index statistics
 */
export interface BM25Stats {
  /** Total number of documents */
  totalDocuments: number;
  /** Average document length */
  avgDocLength: number;
  /** Number of unique terms */
  uniqueTerms: number;
  /** Total term occurrences */
  totalTerms: number;
}

// ============================================================================
// FTS5 Types (SQLite Full-Text Search)
// ============================================================================

/**
 * FTS5 table configuration
 */
export interface FTS5Config {
  /** Table name for FTS5 virtual table */
  tableName: string;
  /** Content table to sync with */
  contentTable: string;
  /** Content rowid column */
  contentRowid: string;
  /** Columns to index */
  columns: string[];
  /** Tokenizer to use (default: 'porter unicode61') */
  tokenizer?: string;
}

/**
 * FTS5 match result
 */
export interface FTS5MatchResult {
  /** Row ID from content table */
  rowid: number;
  /** BM25 rank score (negative, closer to 0 is better) */
  rank: number;
  /** Matched snippet (if requested) */
  snippet?: string;
}

// ============================================================================
// Hybrid Search Configuration
// ============================================================================

/**
 * Hybrid search engine configuration
 */
export interface HybridSearchConfig {
  /** Default vector weight */
  defaultVectorWeight: number;
  /** Default BM25 weight */
  defaultBM25Weight: number;
  /** Default minimum score */
  defaultMinScore: number;
  /** Default result limit */
  defaultLimit: number;
  /** BM25 configuration */
  bm25Config: BM25Config;
  /** Whether FTS5 is available */
  fts5Available: boolean;
  /** Enable search result caching */
  enableCache: boolean;
  /** Cache TTL in milliseconds */
  cacheTTL: number;
}

/**
 * Default hybrid search configuration
 */
export const DEFAULT_HYBRID_CONFIG: HybridSearchConfig = {
  defaultVectorWeight: 0.7,
  defaultBM25Weight: 0.3,
  defaultMinScore: 0.3,
  defaultLimit: 20,
  bm25Config: DEFAULT_BM25_CONFIG,
  fts5Available: false,
  enableCache: true,
  cacheTTL: 60000, // 1 minute
};

// ============================================================================
// Search Events
// ============================================================================

/**
 * Hybrid search events
 */
export interface HybridSearchEvents {
  'search:started': { query: string; options: HybridSearchOptions };
  'search:completed': { query: string; results: HybridSearchResult[]; duration: number };
  'search:error': { query: string; error: Error };
  'index:updated': { source: SearchSource; documentCount: number };
  'cache:hit': { query: string };
  'cache:miss': { query: string };
}
