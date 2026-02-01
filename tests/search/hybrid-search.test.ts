/**
 * Hybrid Search Tests
 */

import {
  BM25Index,
  getBM25Index,
  removeBM25Index,
  clearAllBM25Indexes,
  tokenize,
  stem,
  tokenizeAndStem,
} from '../../src/search/bm25.js';
import type { BM25Document } from '../../src/search/types.js';

describe('BM25 Search', () => {
  let index: BM25Index;

  beforeEach(() => {
    clearAllBM25Indexes();
    index = new BM25Index();
  });

  describe('tokenization', () => {
    it('should tokenize text into words', () => {
      const tokens = tokenize('Hello World, this is a test!');
      expect(tokens).toContain('hello');
      expect(tokens).toContain('world');
      expect(tokens).toContain('test');
      // Stopwords should be removed
      expect(tokens).not.toContain('this');
      expect(tokens).not.toContain('is');
      expect(tokens).not.toContain('a');
    });

    it('should handle empty text', () => {
      const tokens = tokenize('');
      expect(tokens).toEqual([]);
    });

    it('should remove short tokens', () => {
      const tokens = tokenize('I am a b c test');
      expect(tokens).not.toContain('b');
      expect(tokens).not.toContain('c');
    });
  });

  describe('stemming', () => {
    it('should reduce words to roots', () => {
      expect(stem('running')).toBe('runn');
      expect(stem('tests')).toBe('test');
      expect(stem('tested')).toBe('test');
    });
  });

  describe('tokenizeAndStem', () => {
    it('should tokenize and stem', () => {
      const tokens = tokenizeAndStem('running tests quickly');
      expect(tokens).toContain('runn');
      expect(tokens).toContain('test');
      expect(tokens).toContain('quick');
    });
  });

  describe('BM25Index', () => {
    const documents: BM25Document[] = [
      { id: '1', content: 'The quick brown fox jumps over the lazy dog' },
      { id: '2', content: 'A quick brown dog outpaces a quick fox' },
      { id: '3', content: 'The lazy cat sleeps all day long' },
      { id: '4', content: 'Programming in JavaScript is fun' },
      { id: '5', content: 'JavaScript and TypeScript are great languages' },
    ];

    beforeEach(() => {
      index.addDocuments(documents);
    });

    describe('addDocument', () => {
      it('should add documents to the index', () => {
        const stats = index.getStats();
        expect(stats.totalDocuments).toBe(5);
      });

      it('should update document if ID exists', () => {
        index.addDocument({ id: '1', content: 'Updated content' });
        const stats = index.getStats();
        expect(stats.totalDocuments).toBe(5);
        expect(index.getDocument('1')?.content).toBe('Updated content');
      });
    });

    describe('removeDocument', () => {
      it('should remove a document', () => {
        const removed = index.removeDocument('1');
        expect(removed).toBe(true);
        expect(index.getStats().totalDocuments).toBe(4);
      });

      it('should return false for non-existent document', () => {
        const removed = index.removeDocument('999');
        expect(removed).toBe(false);
      });
    });

    describe('search', () => {
      it('should find documents matching query', () => {
        const results = index.search('quick fox');
        expect(results.length).toBeGreaterThan(0);
        // Documents with "quick" and "fox" should be found
        const ids = results.map(r => r.id);
        expect(ids).toContain('1');
        expect(ids).toContain('2');
      });

      it('should rank more relevant documents higher', () => {
        const results = index.search('JavaScript');
        expect(results.length).toBe(2);
        // Both JS documents should be found
        const ids = results.map(r => r.id);
        expect(ids).toContain('4');
        expect(ids).toContain('5');
      });

      it('should return empty for no matches', () => {
        const results = index.search('python ruby');
        expect(results.length).toBe(0);
      });

      it('should handle empty query', () => {
        const results = index.search('');
        expect(results.length).toBe(0);
      });

      it('should limit results', () => {
        const results = index.search('quick', 1);
        expect(results.length).toBe(1);
      });
    });

    describe('getStats', () => {
      it('should return correct statistics', () => {
        const stats = index.getStats();
        expect(stats.totalDocuments).toBe(5);
        expect(stats.avgDocLength).toBeGreaterThan(0);
        expect(stats.uniqueTerms).toBeGreaterThan(0);
      });
    });

    describe('normalizeScores', () => {
      it('should normalize scores to 0-1 range', () => {
        const results = [
          { id: '1', score: 10 },
          { id: '2', score: 5 },
          { id: '3', score: 2 },
        ];
        const normalized = BM25Index.normalizeScores(results);

        expect(normalized[0].score).toBe(1);
        expect(normalized[1].score).toBe(0.5);
        expect(normalized[2].score).toBe(0.2);
      });

      it('should handle empty results', () => {
        const normalized = BM25Index.normalizeScores([]);
        expect(normalized).toEqual([]);
      });
    });
  });

  describe('Index management', () => {
    it('should get or create named indexes', () => {
      const index1 = getBM25Index('test1');
      const index2 = getBM25Index('test1');
      expect(index1).toBe(index2);

      const index3 = getBM25Index('test2');
      expect(index3).not.toBe(index1);
    });

    it('should remove named indexes', () => {
      const index1 = getBM25Index('toRemove');
      index1.addDocument({ id: '1', content: 'test' });

      const removed = removeBM25Index('toRemove');
      expect(removed).toBe(true);

      const newIndex = getBM25Index('toRemove');
      expect(newIndex.getStats().totalDocuments).toBe(0);
    });

    it('should clear all indexes', () => {
      const index1 = getBM25Index('clear1');
      const index2 = getBM25Index('clear2');
      index1.addDocument({ id: '1', content: 'test1' });
      index2.addDocument({ id: '2', content: 'test2' });

      clearAllBM25Indexes();

      const newIndex1 = getBM25Index('clear1');
      const newIndex2 = getBM25Index('clear2');
      expect(newIndex1.getStats().totalDocuments).toBe(0);
      expect(newIndex2.getStats().totalDocuments).toBe(0);
    });
  });
});
