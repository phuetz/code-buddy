/**
 * Hybrid Search Engine
 *
 * Combines vector similarity search with BM25 keyword search for
 * improved recall and precision. Supports searching across multiple
 * sources (memories, code, messages).
 *
 * Formula: hybridScore = vectorWeight * vectorScore + bm25Weight * bm25Score
 * Default weights: 70% vector, 30% BM25
 *
 * Vector search powered by USearch for O(log n) approximate nearest neighbor search.
 * @see https://github.com/unum-cloud/usearch
 */

import { EventEmitter } from 'events';
import type {
  HybridSearchResult,
  HybridSearchOptions,
  HybridSearchConfig,
  SearchSource,
  BM25Document,
} from './types.js';
import { DEFAULT_HYBRID_CONFIG } from './types.js';
import { BM25Index, getBM25Index } from './bm25.js';
import { createVectorIndex } from './vector-index-factory.js';
import type { VectorEngine, VectorIndexLike } from './vector-index-factory.js';
import { getEmbeddingProvider, EmbeddingProvider } from '../embeddings/embedding-provider.js';
import { getMemoryRepository, MemoryRepository } from '../database/repositories/memory-repository.js';
import { logger } from '../utils/logger.js';

// Default embedding dimensions for MiniLM-L6-v2
const DEFAULT_EMBEDDING_DIMENSIONS = 384;

// ============================================================================
// Hybrid Search Engine
// ============================================================================

/**
 * Hybrid search engine combining vector and BM25 search
 */
export class HybridSearchEngine extends EventEmitter {
  private config: HybridSearchConfig;
  private bm25Indexes: Map<SearchSource, BM25Index> = new Map();
  private vectorIndexes: Map<SearchSource, VectorIndexLike> = new Map();
  /** Moteur réellement retenu par la fabrique — affiché par `getStats()`. */
  private vectorEngine: VectorEngine | null = null;
  private embeddingProvider: EmbeddingProvider | null = null;
  private memoryRepository: MemoryRepository | null = null;
  private cache: Map<string, { results: HybridSearchResult[]; timestamp: number }> = new Map();
  private initialized: boolean = false;
  private embeddingDimensions: number = DEFAULT_EMBEDDING_DIMENSIONS;

  constructor(config: Partial<HybridSearchConfig> = {}) {
    super();
    this.config = { ...DEFAULT_HYBRID_CONFIG, ...config };
  }

  /**
   * Initialize the search engine
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Initialize embedding provider
    try {
      this.embeddingProvider = getEmbeddingProvider({
        provider: 'local',
        modelName: 'Xenova/all-MiniLM-L6-v2',
      });
    } catch (error) {
      logger.warn('Failed to initialize embedding provider for hybrid search', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Initialize memory repository
    try {
      this.memoryRepository = getMemoryRepository();
    } catch (error) {
      logger.warn('Failed to initialize memory repository for hybrid search', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Initialize BM25 indexes for each source
    this.bm25Indexes.set('memories', getBM25Index('memories'));
    this.bm25Indexes.set('code', getBM25Index('code'));
    this.bm25Indexes.set('messages', getBM25Index('messages'));
    this.bm25Indexes.set('cache', getBM25Index('cache'));

    // Initialize USearch vector indexes for each source
    // Using HNSW algorithm for O(log n) approximate nearest neighbor search
    const sources: SearchSource[] = ['memories', 'code', 'messages', 'cache'];
    for (const source of sources) {
      // La fabrique choisit : `usearch` là où il s'installe, le sidecar Rust
      // ailleurs (Windows), la boucle JavaScript seulement si les deux manquent.
      const { index: vectorIndex, engine } = await createVectorIndex({
        name: `hybrid-${source}`,
        dimensions: this.embeddingDimensions,
        connectivity: 16,
        expansionAdd: 128,
        expansionSearch: 64,
      });
      await vectorIndex.initialize();
      this.vectorIndexes.set(source, vectorIndex);
      this.vectorEngine = engine;
    }

    // Build initial indexes from existing data
    await this.rebuildIndexes();

    this.initialized = true;
    logger.info(`Hybrid search engine initialized with ${this.vectorEngine ?? 'no'} vector indexes`);
  }

  /**
   * Search across all sources
   */
  async search(options: HybridSearchOptions): Promise<HybridSearchResult[]> {
    await this.initialize();

    const startTime = Date.now();
    const query = options.query.trim();

    if (!query) {
      return [];
    }

    this.emit('search:started', { query, options });

    // Check cache
    const cacheKey = this.getCacheKey(options);
    if (this.config.enableCache) {
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.config.cacheTTL) {
        this.emit('cache:hit', { query });
        return cached.results;
      }
      this.emit('cache:miss', { query });
    }

    try {
      // Get weights
      const vectorWeight = options.vectorWeight ?? this.config.defaultVectorWeight;
      const bm25Weight = options.bm25Weight ?? this.config.defaultBM25Weight;
      const limit = options.limit ?? this.config.defaultLimit;
      const minScore = options.minScore ?? this.config.defaultMinScore;
      const sources = options.sources ?? ['memories', 'code', 'messages'];

      let results: HybridSearchResult[] = [];

      // Search each source
      for (const source of sources) {
        const sourceResults = await this.searchSource(
          source,
          query,
          options,
          vectorWeight,
          bm25Weight
        );
        results.push(...sourceResults);
      }

      // Sort by combined score
      results.sort((a, b) => b.score - a.score);

      // Filter by minimum score
      results = results.filter(r => r.score >= minScore);

      // Limit results
      results = results.slice(0, limit);

      // Cache results
      if (this.config.enableCache) {
        this.cache.set(cacheKey, { results, timestamp: Date.now() });
      }

      const duration = Date.now() - startTime;
      this.emit('search:completed', { query, results, duration });

      return results;
    } catch (error) {
      this.emit('search:error', { query, error: error as Error });
      throw error;
    }
  }

  /**
   * Search a specific source
   */
  private async searchSource(
    source: SearchSource,
    query: string,
    options: HybridSearchOptions,
    vectorWeight: number,
    bm25Weight: number
  ): Promise<HybridSearchResult[]> {
    const results: HybridSearchResult[] = [];

    // Get BM25 results (always available)
    let bm25Results: Array<{ id: string; score: number }> = [];
    if (!options.vectorOnly) {
      const bm25Index = this.bm25Indexes.get(source);
      if (bm25Index) {
        bm25Results = bm25Index.search(query, (options.limit ?? 50) * 2);
        bm25Results = BM25Index.normalizeScores(bm25Results);
      }
    }

    // Get vector results using USearch HNSW index (if embedding provider available)
    let vectorResults: Array<{ id: string; score: number; content: string; metadata?: Record<string, unknown> }> = [];
    if (!options.bm25Only && this.embeddingProvider) {
      vectorResults = await this.vectorSearch(source, query, options);
    }

    // Combine results
    const scoreMap = new Map<string, { vectorScore: number; bm25Score: number; content: string; metadata?: Record<string, unknown> }>();

    // Add BM25 results
    for (const result of bm25Results) {
      const bm25Index = this.bm25Indexes.get(source);
      const doc = bm25Index?.getDocument(result.id);
      scoreMap.set(result.id, {
        vectorScore: 0,
        bm25Score: result.score,
        content: doc?.content || '',
        metadata: doc?.metadata,
      });
    }

    // Add/merge vector results
    for (const result of vectorResults) {
      const existing = scoreMap.get(result.id);
      if (existing) {
        existing.vectorScore = result.score;
      } else {
        scoreMap.set(result.id, {
          vectorScore: result.score,
          bm25Score: 0,
          content: result.content,
          metadata: result.metadata,
        });
      }
    }

    // Calculate hybrid scores
    for (const [id, scores] of scoreMap) {
      // If one method has no results, adjust weights
      let effectiveVectorWeight = vectorWeight;
      let effectiveBM25Weight = bm25Weight;

      if (scores.vectorScore === 0 && scores.bm25Score > 0) {
        effectiveBM25Weight = 1;
        effectiveVectorWeight = 0;
      } else if (scores.bm25Score === 0 && scores.vectorScore > 0) {
        effectiveVectorWeight = 1;
        effectiveBM25Weight = 0;
      }

      const combinedScore =
        effectiveVectorWeight * scores.vectorScore +
        effectiveBM25Weight * scores.bm25Score;

      results.push({
        id,
        content: scores.content,
        score: combinedScore,
        vectorScore: scores.vectorScore,
        bm25Score: scores.bm25Score,
        source,
        metadata: scores.metadata,
      });
    }

    return results;
  }

  /**
   * Vector search using USearch HNSW index
   * O(log n) approximate nearest neighbor search
   */
  private async vectorSearch(
    source: SearchSource,
    query: string,
    options: HybridSearchOptions
  ): Promise<Array<{ id: string; score: number; content: string; metadata?: Record<string, unknown> }>> {
    if (!this.embeddingProvider) {
      return [];
    }

    const vectorIndex = this.vectorIndexes.get(source);
    if (!vectorIndex || vectorIndex.size() === 0) {
      return [];
    }

    try {
      // Generate query embedding
      const queryEmbedding = await this.embeddingProvider.embed(query);
      const queryVector = Array.from(queryEmbedding.embedding);

      // Search using USearch HNSW index - O(log n) instead of O(n)
      const limit = (options.limit ?? 50) * 2;
      const searchResults = await vectorIndex.search(queryVector, limit);

      // Filter by minimum score and get content from BM25 index
      const bm25Index = this.bm25Indexes.get(source);
      const results: Array<{ id: string; score: number; content: string; metadata?: Record<string, unknown> }> = [];

      for (const result of searchResults) {
        // Skip low-scoring results
        if (result.score < 0.5) continue;

        // Get content from BM25 index or metadata
        const doc = bm25Index?.getDocument(result.id);
        const content = doc?.content || '';

        results.push({
          id: result.id,
          score: result.score,
          content,
          metadata: result.metadata || doc?.metadata,
        });
      }

      return results;
    } catch (error) {
      logger.warn('USearch vector search failed, falling back to BM25 only', {
        source,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Vector search memories using USearch
   * @deprecated Use vectorSearch(source, query, options) instead
   */
  private async vectorSearchMemories(
    query: string,
    options: HybridSearchOptions
  ): Promise<Array<{ id: string; score: number; content: string; metadata?: Record<string, unknown> }>> {
    return this.vectorSearch('memories', query, options);
  }

  /**
   * Index a document
   */
  async indexDocument(source: SearchSource, doc: BM25Document): Promise<void> {
    await this.initialize();

    const index = this.bm25Indexes.get(source);
    if (index) {
      index.addDocument(doc);
      this.emit('index:updated', { source, documentCount: index.getStats().totalDocuments });
    }
  }

  /**
   * Index multiple documents
   */
  async indexDocuments(source: SearchSource, docs: BM25Document[]): Promise<void> {
    await this.initialize();

    const index = this.bm25Indexes.get(source);
    if (index) {
      index.addDocuments(docs);
      this.emit('index:updated', { source, documentCount: index.getStats().totalDocuments });
    }
  }

  /**
   * Remove a document from the index
   */
  removeDocument(source: SearchSource, docId: string): boolean {
    const index = this.bm25Indexes.get(source);
    if (index) {
      return index.removeDocument(docId);
    }
    return false;
  }

  /**
   * Rebuild indexes from data sources
   */
  async rebuildIndexes(): Promise<void> {
    // Rebuild memories index (BM25 + USearch vector)
    if (this.memoryRepository) {
      const memoriesBM25 = this.bm25Indexes.get('memories');
      const memoriesVector = this.vectorIndexes.get('memories');

      if (memoriesBM25) {
        memoriesBM25.clear();
      }
      if (memoriesVector) {
        memoriesVector.clear();
        await memoriesVector.initialize();
      }

      const memories = this.memoryRepository.find({ limit: 10000 });
      let vectorCount = 0;

      for (const memory of memories) {
        // Add to BM25 index
        if (memoriesBM25) {
          memoriesBM25.addDocument({
            id: memory.id,
            content: memory.content,
            metadata: memory.metadata as Record<string, unknown> | undefined,
          });
        }

        // Add to USearch vector index if embedding exists
        if (memoriesVector && memory.embedding) {
          await memoriesVector.add({
            id: memory.id,
            embedding: Array.from(memory.embedding),
            metadata: memory.metadata as Record<string, unknown> | undefined,
          });
          vectorCount++;
        }
      }

      this.emit('index:updated', {
        source: 'memories',
        documentCount: memoriesBM25?.getStats().totalDocuments ?? 0,
      });

      logger.info('Rebuilt memories indexes', {
        bm25Documents: memoriesBM25?.getStats().totalDocuments ?? 0,
        vectorDocuments: vectorCount,
      });
    }
  }

  /**
   * Index a vector embedding for a document
   */
  async indexVector(
    source: SearchSource,
    id: string,
    embedding: number[],
    metadata?: Record<string, unknown>
  ): Promise<void> {
    await this.initialize();

    const vectorIndex = this.vectorIndexes.get(source);
    if (vectorIndex) {
      await vectorIndex.add({ id, embedding, metadata });
      this.emit('vector:indexed', { source, id });
    }
  }

  /**
   * Index multiple vector embeddings
   */
  async indexVectors(
    source: SearchSource,
    vectors: Array<{ id: string; embedding: number[]; metadata?: Record<string, unknown> }>
  ): Promise<void> {
    await this.initialize();

    const vectorIndex = this.vectorIndexes.get(source);
    if (vectorIndex) {
      await vectorIndex.addBatch(vectors);
      this.emit('vectors:indexed', { source, count: vectors.length });
    }
  }

  /**
   * Remove a vector from the index
   */
  removeVector(source: SearchSource, id: string): boolean {
    const vectorIndex = this.vectorIndexes.get(source);
    if (vectorIndex) {
      return vectorIndex.remove(id);
    }
    return false;
  }

  /**
   * Get cache key for search options
   */
  private getCacheKey(options: HybridSearchOptions): string {
    return JSON.stringify({
      query: options.query,
      limit: options.limit,
      sources: options.sources,
      projectId: options.projectId,
      types: options.types,
      vectorOnly: options.vectorOnly,
      bm25Only: options.bm25Only,
    });
  }

  /**
   * Clear the search cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get search statistics
   */
  getStats(): {
    bm25Indexes: Record<string, { totalDocuments: number; uniqueTerms: number }>;
    vectorIndexes: Record<string, { size: number; dimensions: number; memoryUsage: number }>;
    cacheSize: number;
    embeddingProviderAvailable: boolean;
    /** Vrai seulement si le moteur retenu EST usearch — un index Rust ou la boucle
     *  JavaScript répondent désormais `false`, alors qu'ils comptent des index. */
    usearchEnabled: boolean;
    /** Le moteur réellement retenu : `usearch`, `rust` ou `javascript`. */
    vectorEngine: VectorEngine | null;
  } {
    const bm25Indexes: Record<string, { totalDocuments: number; uniqueTerms: number }> = {};
    const vectorIndexes: Record<string, { size: number; dimensions: number; memoryUsage: number }> = {};

    for (const [source, index] of this.bm25Indexes) {
      const stats = index.getStats();
      bm25Indexes[source] = {
        totalDocuments: stats.totalDocuments,
        uniqueTerms: stats.uniqueTerms,
      };
    }

    for (const [source, index] of this.vectorIndexes) {
      const stats = index.getStats();
      vectorIndexes[source] = {
        size: stats.size,
        dimensions: stats.dimensions,
        memoryUsage: stats.memoryUsage,
      };
    }

    return {
      bm25Indexes,
      vectorIndexes,
      cacheSize: this.cache.size,
      embeddingProviderAvailable: this.embeddingProvider !== null,
      usearchEnabled: this.vectorEngine === 'usearch',
      vectorEngine: this.vectorEngine,
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<HybridSearchConfig>): void {
    Object.assign(this.config, config);
  }

  /**
   * Dispose and cleanup
   */
  dispose(): void {
    this.cache.clear();

    // Cleanup BM25 indexes
    for (const index of this.bm25Indexes.values()) {
      index.clear();
    }
    this.bm25Indexes.clear();

    // Cleanup USearch vector indexes
    for (const index of this.vectorIndexes.values()) {
      index.dispose();
    }
    this.vectorIndexes.clear();

    this.removeAllListeners();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let searchEngineInstance: HybridSearchEngine | null = null;

/**
 * Get or create the HybridSearchEngine singleton
 */
export function getHybridSearchEngine(config?: Partial<HybridSearchConfig>): HybridSearchEngine {
  if (!searchEngineInstance) {
    searchEngineInstance = new HybridSearchEngine(config);
  }
  return searchEngineInstance;
}

/**
 * Reset the HybridSearchEngine singleton
 */
export function resetHybridSearchEngine(): void {
  if (searchEngineInstance) {
    searchEngineInstance.dispose();
  }
  searchEngineInstance = null;
}
