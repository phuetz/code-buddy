/**
 * Hybrid Memory Search
 *
 * Combines BM25 keyword search with semantic vector search
 * for high-quality memory retrieval. BM25 is always available,
 * while semantic search activates opportunistically when embeddings initialize.
 */

import { logger } from '../utils/logger.js';
import type { EmbeddingProvider as EmbeddingProviderType } from '../embeddings/embedding-provider.js';

// ============================================================================
// Types
// ============================================================================

export interface SearchResult {
  key: string;
  value: string;
  score: number;
  source: 'bm25' | 'semantic' | 'hybrid';
}

// ============================================================================
// BM25Index
// ============================================================================

export class BM25Index {
  private documents: Map<string, string> = new Map();
  private tokenizedDocs: Map<string, string[]> = new Map();
  private docLengths: Map<string, number> = new Map();
  private avgDocLength = 0;
  private df: Map<string, number> = new Map(); // document frequency
  private k1: number;
  private b: number;

  constructor(k1 = 1.5, b = 0.75) {
    this.k1 = k1;
    this.b = b;
  }

  addDocument(id: string, text: string): void {
    // Remove if exists to update
    if (this.documents.has(id)) {
      this.removeDocument(id);
    }

    this.documents.set(id, text);
    const tokens = this.tokenize(text);
    this.tokenizedDocs.set(id, tokens);
    this.docLengths.set(id, tokens.length);

    // Update document frequency
    const uniqueTokens = new Set(tokens);
    for (const token of uniqueTokens) {
      this.df.set(token, (this.df.get(token) || 0) + 1);
    }

    this.updateAvgDocLength();
    logger.debug('Document added to BM25 index', { id });
  }

  search(query: string, limit = 10): SearchResult[] {
    const queryTokens = this.tokenize(query);
    const n = this.documents.size;

    if (n === 0) return [];

    const scores: Array<{ id: string; score: number }> = [];

    for (const [docId, tokens] of this.tokenizedDocs.entries()) {
      let score = 0;
      const dl = this.docLengths.get(docId) || 0;

      for (const qToken of queryTokens) {
        const docFreq = this.df.get(qToken) || 0;
        if (docFreq === 0) continue;

        // IDF = ln((N - df + 0.5) / (df + 0.5) + 1)
        const idf = Math.log((n - docFreq + 0.5) / (docFreq + 0.5) + 1);

        // Term frequency in document
        const tf = tokens.filter(t => t === qToken).length;

        // BM25 score component
        const tfNorm = (tf * (this.k1 + 1)) / (tf + this.k1 * (1 - this.b + this.b * dl / this.avgDocLength));

        score += idf * tfNorm;
      }

      if (score > 0) {
        scores.push({ id: docId, score });
      }
    }

    scores.sort((a, b) => b.score - a.score);

    return scores.slice(0, limit).map(s => ({
      key: s.id,
      value: this.documents.get(s.id) || '',
      score: s.score,
      source: 'bm25' as const,
    }));
  }

  removeDocument(id: string): void {
    const tokens = this.tokenizedDocs.get(id);
    if (tokens) {
      const uniqueTokens = new Set(tokens);
      for (const token of uniqueTokens) {
        const count = this.df.get(token) || 0;
        if (count <= 1) {
          this.df.delete(token);
        } else {
          this.df.set(token, count - 1);
        }
      }
    }

    this.documents.delete(id);
    this.tokenizedDocs.delete(id);
    this.docLengths.delete(id);
    this.updateAvgDocLength();
  }

  getDocumentCount(): number {
    return this.documents.size;
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 0);
  }

  private updateAvgDocLength(): void {
    if (this.docLengths.size === 0) {
      this.avgDocLength = 0;
      return;
    }
    let total = 0;
    for (const len of this.docLengths.values()) {
      total += len;
    }
    this.avgDocLength = total / this.docLengths.size;
  }
}

// ============================================================================
// HybridMemorySearch
// ============================================================================

export class HybridMemorySearch {
  private static instance: HybridMemorySearch | null = null;

  private bm25Index: BM25Index;
  private bm25Weight = 0.7;
  private semanticWeight = 0.3;
  private embeddingProvider: EmbeddingProviderType | null = null;
  private embeddingInitFailed = false;
  private documentEmbeddings: Map<string, Float32Array> = new Map();

  private constructor() {
    this.bm25Index = new BM25Index();
  }

  static getInstance(): HybridMemorySearch {
    if (!HybridMemorySearch.instance) {
      HybridMemorySearch.instance = new HybridMemorySearch();
    }
    return HybridMemorySearch.instance;
  }

  static resetInstance(): void {
    HybridMemorySearch.instance = null;
  }

  index(entries: Array<{ key: string; value: string }>): void {
    for (const entry of entries) {
      this.bm25Index.addDocument(entry.key, entry.value);
    }
    logger.debug('Indexed entries', { count: entries.length });

    // Embed documents asynchronously (non-blocking)
    this.embedDocuments(entries).catch(err => {
      logger.warn('Failed to embed documents for semantic search', { error: String(err) });
    });
  }

  search(query: string, limit = 10): SearchResult[] {
    // BM25 search
    const bm25Results = this.bm25Index.search(query, limit);

    // Semantic search - synchronous lookup against cached embeddings
    const semanticResults = this.semanticSearch(query, limit);

    // If no semantic results, use BM25 at full weight
    if (semanticResults.length === 0) {
      return bm25Results.map(r => ({
        ...r,
        source: 'hybrid' as const,
      }));
    }

    // Hybrid merge
    return this.mergeResults(bm25Results, semanticResults, limit);
  }

  setWeights(bm25Weight: number, semanticWeight: number): void {
    this.bm25Weight = bm25Weight;
    this.semanticWeight = semanticWeight;
  }

  getStats(): { documentCount: number; bm25Weight: number; semanticWeight: number } {
    return {
      documentCount: this.bm25Index.getDocumentCount(),
      bm25Weight: this.bm25Weight,
      semanticWeight: this.semanticWeight,
    };
  }

  clear(): void {
    this.bm25Index = new BM25Index();
    this.documentEmbeddings.clear();
  }

  private async initEmbeddings(): Promise<EmbeddingProviderType | null> {
    if (this.embeddingInitFailed) return null;
    if (this.embeddingProvider) return this.embeddingProvider;

    try {
      const { EmbeddingProvider } = await import('../embeddings/embedding-provider.js');
      this.embeddingProvider = new EmbeddingProvider();
      await this.embeddingProvider.initialize();
      logger.debug('Embedding provider initialized for hybrid search');
      return this.embeddingProvider;
    } catch (error) {
      this.embeddingInitFailed = true;
      logger.warn('Embedding provider init failed, continuing BM25-only', { error: String(error) });
      return null;
    }
  }

  private async embedDocuments(entries: Array<{ key: string; value: string }>): Promise<void> {
    const provider = await this.initEmbeddings();
    if (!provider) return;

    for (const entry of entries) {
      try {
        const result = await provider.embed(entry.value);
        this.documentEmbeddings.set(entry.key, result.embedding);
      } catch (error) {
        logger.debug(`Failed to embed document: ${entry.key}`, { error: String(error) });
      }
    }
  }

  private semanticSearch(query: string, limit: number): SearchResult[] {
    if (this.documentEmbeddings.size === 0 || !this.embeddingProvider) {
      return [];
    }

    // We need the query embedding synchronously, but embedding is async.
    // Use cached query embeddings or return empty if not available.
    // For synchronous search, we pre-compute during index() and do
    // cosine similarity against stored embeddings.
    const queryEmbedding = this.getCachedQueryEmbedding(query);
    if (!queryEmbedding) {
      // Trigger async embedding for next time
      this.cacheQueryEmbedding(query);
      return [];
    }

    const scores: Array<{ key: string; score: number }> = [];

    for (const [key, docEmbedding] of this.documentEmbeddings.entries()) {
      const score = this.cosineSimilarity(queryEmbedding, docEmbedding);
      if (score > 0) {
        scores.push({ key, score });
      }
    }

    scores.sort((a, b) => b.score - a.score);

    return scores.slice(0, limit).map(s => ({
      key: s.key,
      value: '', // Value will be filled in during merge from BM25 or looked up
      score: s.score,
      source: 'semantic' as const,
    }));
  }

  private queryEmbeddingCache: Map<string, Float32Array> = new Map();

  private getCachedQueryEmbedding(query: string): Float32Array | null {
    return this.queryEmbeddingCache.get(query) || null;
  }

  private async cacheQueryEmbedding(query: string): Promise<void> {
    const provider = await this.initEmbeddings();
    if (!provider) return;

    try {
      const result = await provider.embed(query);
      this.queryEmbeddingCache.set(query, result.embedding);

      // Limit cache size
      if (this.queryEmbeddingCache.size > 100) {
        const firstKey = this.queryEmbeddingCache.keys().next().value;
        if (firstKey) this.queryEmbeddingCache.delete(firstKey);
      }
    } catch (error) {
      logger.debug('Failed to cache query embedding', { error: String(error) });
    }
  }

  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) return 0;

    return dotProduct / denominator;
  }

  private mergeResults(bm25: SearchResult[], semantic: SearchResult[], limit: number): SearchResult[] {
    const merged = new Map<string, SearchResult>();

    for (const r of bm25) {
      merged.set(r.key, {
        key: r.key,
        value: r.value,
        score: r.score * this.bm25Weight,
        source: 'hybrid',
      });
    }

    for (const r of semantic) {
      const existing = merged.get(r.key);
      if (existing) {
        existing.score += r.score * this.semanticWeight;
      } else {
        merged.set(r.key, {
          key: r.key,
          value: r.value,
          score: r.score * this.semanticWeight,
          source: 'hybrid',
        });
      }
    }

    return Array.from(merged.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}
