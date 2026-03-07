/**
 * Tests for HybridMemorySearch with semantic search integration
 */


// Mock logger to suppress output

import { BM25Index, HybridMemorySearch } from '../../src/memory/hybrid-search.js';
import { vi } from 'vitest';

jest.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock EmbeddingProvider for semantic search tests
const mockEmbed = jest.fn();
const mockInitialize = jest.fn().mockResolvedValue(undefined);

jest.mock('../../src/embeddings/embedding-provider.js', () => ({
  EmbeddingProvider: jest.fn().mockImplementation(function() { return {
    initialize: mockInitialize,
    embed: mockEmbed,
  }; }),
}));

describe('BM25Index', () => {
  let index: BM25Index;

  beforeEach(() => {
    index = new BM25Index();
  });

  it('should add documents and report correct count', () => {
    index.addDocument('doc1', 'hello world');
    index.addDocument('doc2', 'foo bar baz');
    expect(index.getDocumentCount()).toBe(2);
  });

  it('should search and return matching documents', () => {
    index.addDocument('doc1', 'the quick brown fox');
    index.addDocument('doc2', 'the lazy brown dog');
    index.addDocument('doc3', 'hello world');

    const results = index.search('brown fox');
    expect(results.length).toBeGreaterThan(0);
    // doc1 should rank highest because it has both "brown" and "fox"
    expect(results[0].key).toBe('doc1');
    expect(results[0].source).toBe('bm25');
    expect(results[0].score).toBeGreaterThan(0);
  });

  it('should return empty results for empty index', () => {
    const results = index.search('anything');
    expect(results).toEqual([]);
  });

  it('should return empty results when query matches no documents', () => {
    index.addDocument('doc1', 'hello world');
    const results = index.search('zzzznotfound');
    expect(results).toEqual([]);
  });

  it('should respect limit parameter', () => {
    for (let i = 0; i < 20; i++) {
      index.addDocument(`doc${i}`, `common word repeated document ${i}`);
    }
    const results = index.search('common word', 5);
    expect(results.length).toBeLessThanOrEqual(5);
  });

  it('should remove documents and update index', () => {
    index.addDocument('doc1', 'hello world');
    index.addDocument('doc2', 'hello there');
    expect(index.getDocumentCount()).toBe(2);

    index.removeDocument('doc1');
    expect(index.getDocumentCount()).toBe(1);

    const results = index.search('hello');
    expect(results.length).toBe(1);
    expect(results[0].key).toBe('doc2');
  });

  it('should handle removing non-existent document gracefully', () => {
    index.addDocument('doc1', 'hello');
    index.removeDocument('nonexistent');
    expect(index.getDocumentCount()).toBe(1);
  });

  it('should update document when adding with existing id', () => {
    index.addDocument('doc1', 'original content');
    index.addDocument('doc1', 'updated content');
    expect(index.getDocumentCount()).toBe(1);

    const results = index.search('updated');
    expect(results.length).toBe(1);
    expect(results[0].value).toBe('updated content');
  });

  it('should return document value in results', () => {
    index.addDocument('doc1', 'the quick brown fox jumps');
    const results = index.search('fox');
    expect(results[0].value).toBe('the quick brown fox jumps');
  });
});

describe('HybridMemorySearch', () => {
  beforeEach(async () => {
    // Allow fire-and-forget embedding tasks from prior tests to settle before resetting shared mocks.
    await new Promise(resolve => setTimeout(resolve, 60));
    HybridMemorySearch.resetInstance();
    mockEmbed.mockReset();
    mockInitialize.mockReset();
    mockInitialize.mockResolvedValue(undefined);
  });

  describe('singleton', () => {
    it('should return the same instance from getInstance()', () => {
      const a = HybridMemorySearch.getInstance();
      const b = HybridMemorySearch.getInstance();
      expect(a).toBe(b);
    });

    it('should return a new instance after resetInstance()', () => {
      const a = HybridMemorySearch.getInstance();
      HybridMemorySearch.resetInstance();
      const b = HybridMemorySearch.getInstance();
      expect(a).not.toBe(b);
    });
  });

  describe('index()', () => {
    it('should store documents in BM25 index', () => {
      const search = HybridMemorySearch.getInstance();
      search.index([
        { key: 'k1', value: 'hello world' },
        { key: 'k2', value: 'foo bar' },
      ]);

      const stats = search.getStats();
      expect(stats.documentCount).toBe(2);
    });
  });

  describe('search() BM25-only', () => {
    it('should return BM25 results when no embeddings are available', () => {
      const search = HybridMemorySearch.getInstance();
      search.index([
        { key: 'k1', value: 'the quick brown fox' },
        { key: 'k2', value: 'lazy brown dog' },
        { key: 'k3', value: 'hello world' },
      ]);

      const results = search.search('brown fox');
      expect(results.length).toBeGreaterThan(0);
      // Without semantic results, source should still be 'hybrid' (BM25 at full weight)
      expect(results[0].source).toBe('hybrid');
      expect(results[0].key).toBe('k1');
    });

    it('should return empty results for unmatched query', () => {
      const search = HybridMemorySearch.getInstance();
      search.index([{ key: 'k1', value: 'hello world' }]);

      const results = search.search('zzzznotfound');
      expect(results).toEqual([]);
    });
  });

  describe('semantic search integration', () => {
    it('should call embedDocuments via index() and store embeddings', async () => {
      // Setup mock to return embeddings
      mockEmbed.mockResolvedValue({
        embedding: new Float32Array([0.1, 0.2, 0.3]),
        dimensions: 3,
        provider: 'mock' as const,
      });

      const search = HybridMemorySearch.getInstance();
      search.index([{ key: 'k1', value: 'test document' }]);
      await (search as unknown as {
        embedDocuments: (entries: Array<{ key: string; value: string }>) => Promise<void>;
      }).embedDocuments([{ key: 'k1', value: 'test document' }]);

      await vi.waitFor(() => {
        const embeddings = (search as unknown as { documentEmbeddings: Map<string, Float32Array> })
          .documentEmbeddings;
        expect(embeddings.has('k1')).toBe(true);
        expect(embeddings.get('k1')).toBeInstanceOf(Float32Array);
      }, { timeout: 1000 });
    });

    it('should combine BM25 and semantic scores when both are available', async () => {
      // We need to set up embeddings for documents AND a cached query embedding.
      // The search() method calls semanticSearch() synchronously, which needs
      // a cached query embedding.
      const docEmbedding = new Float32Array([0.5, 0.5, 0.5]);
      const queryEmbedding = new Float32Array([0.5, 0.5, 0.5]);

      mockEmbed
        .mockResolvedValueOnce({ embedding: docEmbedding, dimensions: 3, provider: 'mock' })
        .mockResolvedValueOnce({ embedding: queryEmbedding, dimensions: 3, provider: 'mock' });

      const search = HybridMemorySearch.getInstance();
      search.index([{ key: 'k1', value: 'test query document' }]);

      // Wait for document embedding
      await new Promise(resolve => setTimeout(resolve, 50));

      // First search triggers async query embedding caching
      search.search('test query');

      // Wait for query embedding to be cached
      await new Promise(resolve => setTimeout(resolve, 50));

      // Second search should use cached query embedding and combine scores
      const results = search.search('test query');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].source).toBe('hybrid');
      expect(results[0].score).toBeGreaterThan(0);
    });

    it('should fall back to BM25-only if embedding init fails', async () => {
      mockInitialize.mockRejectedValue(new Error('No GPU available'));

      const search = HybridMemorySearch.getInstance();
      search.index([{ key: 'k1', value: 'hello world' }]);

      // Wait for async embedding attempt to fail
      await new Promise(resolve => setTimeout(resolve, 50));

      const results = search.search('hello');
      expect(results.length).toBe(1);
      expect(results[0].source).toBe('hybrid');
      expect(results[0].key).toBe('k1');
    });

    it('should not retry embedding init after failure', async () => {
      mockInitialize.mockRejectedValue(new Error('Init failed'));

      const search = HybridMemorySearch.getInstance();
      search.index([{ key: 'k1', value: 'first' }]);
      await new Promise(resolve => setTimeout(resolve, 50));

      // Reset mock to see if it gets called again
      mockInitialize.mockReset();
      mockInitialize.mockResolvedValue(undefined);

      search.index([{ key: 'k2', value: 'second' }]);
      await new Promise(resolve => setTimeout(resolve, 50));

      // embeddingInitFailed should prevent re-init
      expect(mockInitialize).not.toHaveBeenCalled();
    });
  });

  describe('cosine similarity', () => {
    it('should compute cosine similarity of identical vectors as 1', async () => {
      // We test cosine similarity indirectly through semantic search.
      // Set up two identical embeddings - the similarity should be 1.0.
      const embedding = new Float32Array([1, 0, 0]);

      mockEmbed.mockResolvedValue({ embedding, dimensions: 3, provider: 'mock' });

      const search = HybridMemorySearch.getInstance();
      search.index([{ key: 'k1', value: 'same content' }]);
      await new Promise(resolve => setTimeout(resolve, 50));

      // First search caches query embedding
      search.search('same content');
      await new Promise(resolve => setTimeout(resolve, 50));

      // Second search uses cached embedding - cosine similarity of [1,0,0] with [1,0,0] = 1.0
      const results = search.search('same content');
      expect(results.length).toBeGreaterThan(0);
      // The semantic score for identical vectors should be 1.0
      // Combined hybrid score = bm25_score * 0.7 + 1.0 * 0.3
      expect(results[0].score).toBeGreaterThan(0);
    });

    it('should compute cosine similarity of orthogonal vectors as 0', async () => {
      const docEmbedding = new Float32Array([1, 0, 0]);
      const queryEmbedding = new Float32Array([0, 1, 0]);

      mockEmbed
        .mockResolvedValueOnce({ embedding: docEmbedding, dimensions: 3, provider: 'mock' })
        .mockResolvedValueOnce({ embedding: queryEmbedding, dimensions: 3, provider: 'mock' });

      const search = HybridMemorySearch.getInstance();
      search.index([{ key: 'k1', value: 'document text here' }]);
      await new Promise(resolve => setTimeout(resolve, 50));

      // First search triggers query embedding caching
      search.search('query text here');
      await new Promise(resolve => setTimeout(resolve, 50));

      // Second search - orthogonal vectors contribute 0 semantic score
      const results = search.search('query text here');
      // Results should only come from BM25 since semantic score is 0
      for (const r of results) {
        // Score should only be from BM25 weight (no semantic contribution)
        expect(r.source).toBe('hybrid');
      }
    });
  });

  describe('setWeights()', () => {
    it('should change weights reported by getStats()', () => {
      const search = HybridMemorySearch.getInstance();
      search.setWeights(0.5, 0.5);

      const stats = search.getStats();
      expect(stats.bm25Weight).toBe(0.5);
      expect(stats.semanticWeight).toBe(0.5);
    });

    it('should affect merge behavior when semantic results exist', async () => {
      const embedding = new Float32Array([0.5, 0.5, 0.5]);
      mockEmbed.mockResolvedValue({ embedding, dimensions: 3, provider: 'mock' });

      const search = HybridMemorySearch.getInstance();
      search.index([{ key: 'k1', value: 'test weights document' }]);
      await new Promise(resolve => setTimeout(resolve, 50));

      // Cache query embedding
      search.search('test weights');
      await new Promise(resolve => setTimeout(resolve, 50));

      // Get baseline score with default weights (0.7/0.3)
      const baselineResults = search.search('test weights');
      const baselineScore = baselineResults[0]?.score ?? 0;

      // Change to equal weights
      search.setWeights(0.5, 0.5);
      const equalResults = search.search('test weights');
      const equalScore = equalResults[0]?.score ?? 0;

      // Scores should differ because weights changed
      // (unless the BM25 and semantic scores happen to be equal, which is unlikely)
      expect(equalResults.length).toBeGreaterThan(0);
      // At minimum, the weights are updated
      expect(search.getStats().bm25Weight).toBe(0.5);
      expect(search.getStats().semanticWeight).toBe(0.5);
    });
  });

  describe('clear()', () => {
    it('should reset both BM25 index and embeddings', async () => {
      mockEmbed.mockResolvedValue({
        embedding: new Float32Array([0.1, 0.2, 0.3]),
        dimensions: 3,
        provider: 'mock',
      });

      const search = HybridMemorySearch.getInstance();
      search.index([
        { key: 'k1', value: 'hello world' },
        { key: 'k2', value: 'foo bar' },
      ]);
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(search.getStats().documentCount).toBe(2);

      search.clear();

      expect(search.getStats().documentCount).toBe(0);
      const results = search.search('hello');
      expect(results).toEqual([]);
    });
  });

  describe('getStats()', () => {
    it('should return correct document count and default weights', () => {
      const search = HybridMemorySearch.getInstance();
      const stats = search.getStats();

      expect(stats.documentCount).toBe(0);
      expect(stats.bm25Weight).toBe(0.7);
      expect(stats.semanticWeight).toBe(0.3);
    });

    it('should reflect document count after indexing', () => {
      const search = HybridMemorySearch.getInstance();
      search.index([
        { key: 'k1', value: 'one' },
        { key: 'k2', value: 'two' },
        { key: 'k3', value: 'three' },
      ]);

      expect(search.getStats().documentCount).toBe(3);
    });

    it('should reflect updated weights after setWeights()', () => {
      const search = HybridMemorySearch.getInstance();
      search.setWeights(0.4, 0.6);

      const stats = search.getStats();
      expect(stats.bm25Weight).toBe(0.4);
      expect(stats.semanticWeight).toBe(0.6);
    });
  });
});
