/**
 * BM25 Search Implementation
 *
 * In-memory BM25 (Best Match 25) implementation for keyword-based
 * full-text search. Can be used standalone or with FTS5 for SQLite.
 *
 * BM25 is a ranking function used by search engines to rank matching
 * documents according to their relevance to a given search query.
 */

import type { BM25Config, BM25Document, BM25Stats } from './types.js';
import { DEFAULT_BM25_CONFIG } from './types.js';

// ============================================================================
// Tokenization
// ============================================================================

/**
 * Simple tokenizer that splits on whitespace and punctuation
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    // Remove punctuation except apostrophes in words
    .replace(/[^\w\s']/g, ' ')
    // Split on whitespace
    .split(/\s+/)
    // Remove empty tokens and very short tokens
    .filter(token => token.length > 1)
    // Remove common stopwords
    .filter(token => !STOPWORDS.has(token));
}

/**
 * Porter stemmer (simplified version)
 * Reduces words to their root form
 */
export function stem(word: string): string {
  // Simple suffix stripping for common patterns
  const suffixes = [
    ['ational', 'ate'],
    ['tional', 'tion'],
    ['enci', 'ence'],
    ['anci', 'ance'],
    ['izer', 'ize'],
    ['isation', 'ize'],
    ['ization', 'ize'],
    ['ation', 'ate'],
    ['ator', 'ate'],
    ['alism', 'al'],
    ['iveness', 'ive'],
    ['fulness', 'ful'],
    ['ousness', 'ous'],
    ['aliti', 'al'],
    ['iviti', 'ive'],
    ['biliti', 'ble'],
    ['alli', 'al'],
    ['entli', 'ent'],
    ['eli', 'e'],
    ['ousli', 'ous'],
    ['ing', ''],
    ['ed', ''],
    ['ly', ''],
    ['ies', 'y'],
    ['es', ''],
    ['s', ''],
  ];

  let result = word.toLowerCase();

  for (const [suffix, replacement] of suffixes) {
    if (result.endsWith(suffix) && result.length > suffix.length + 2) {
      result = result.slice(0, -suffix.length) + replacement;
      break;
    }
  }

  return result;
}

/**
 * Tokenize and stem text
 */
export function tokenizeAndStem(text: string): string[] {
  return tokenize(text).map(stem);
}

/**
 * Common English stopwords
 */
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for',
  'from', 'has', 'he', 'in', 'is', 'it', 'its', 'of', 'on',
  'or', 'that', 'the', 'to', 'was', 'were', 'will', 'with',
  'this', 'but', 'they', 'have', 'had', 'what', 'when',
  'where', 'who', 'which', 'why', 'how', 'all', 'each',
  'every', 'both', 'few', 'more', 'most', 'other', 'some',
  'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so',
  'than', 'too', 'very', 'can', 'just', 'should', 'now',
]);

// ============================================================================
// BM25 Index
// ============================================================================

/**
 * BM25 search index
 */
export class BM25Index {
  private config: BM25Config;
  private documents: Map<string, BM25Document> = new Map();
  private documentLengths: Map<string, number> = new Map();
  private termFrequencies: Map<string, Map<string, number>> = new Map(); // term -> docId -> freq
  private documentFrequencies: Map<string, number> = new Map(); // term -> doc count
  private avgDocLength: number = 0;

  constructor(config: Partial<BM25Config> = {}) {
    this.config = { ...DEFAULT_BM25_CONFIG, ...config };
  }

  /**
   * Add a document to the index
   */
  addDocument(doc: BM25Document): void {
    // Remove existing if present
    if (this.documents.has(doc.id)) {
      this.removeDocument(doc.id);
    }

    // Tokenize and stem
    const tokens = tokenizeAndStem(doc.content);

    // Store document
    this.documents.set(doc.id, doc);
    this.documentLengths.set(doc.id, tokens.length);

    // Count term frequencies
    const termCounts = new Map<string, number>();
    for (const token of tokens) {
      termCounts.set(token, (termCounts.get(token) || 0) + 1);
    }

    // Update inverted index
    for (const [term, count] of termCounts) {
      if (!this.termFrequencies.has(term)) {
        this.termFrequencies.set(term, new Map());
      }
      this.termFrequencies.get(term)!.set(doc.id, count);

      // Update document frequency
      this.documentFrequencies.set(
        term,
        (this.documentFrequencies.get(term) || 0) + 1
      );
    }

    // Update average document length
    this.updateAvgDocLength();
  }

  /**
   * Add multiple documents
   */
  addDocuments(docs: BM25Document[]): void {
    for (const doc of docs) {
      this.addDocument(doc);
    }
  }

  /**
   * Remove a document from the index
   */
  removeDocument(docId: string): boolean {
    if (!this.documents.has(docId)) {
      return false;
    }

    const doc = this.documents.get(docId)!;
    const tokens = new Set(tokenizeAndStem(doc.content));

    // Update inverted index
    for (const term of tokens) {
      const termDocs = this.termFrequencies.get(term);
      if (termDocs) {
        termDocs.delete(docId);
        if (termDocs.size === 0) {
          this.termFrequencies.delete(term);
          this.documentFrequencies.delete(term);
        } else {
          this.documentFrequencies.set(
            term,
            (this.documentFrequencies.get(term) || 1) - 1
          );
        }
      }
    }

    this.documents.delete(docId);
    this.documentLengths.delete(docId);
    this.updateAvgDocLength();

    return true;
  }

  /**
   * Search the index
   */
  search(query: string, limit: number = 20): Array<{ id: string; score: number }> {
    const queryTokens = tokenizeAndStem(query);

    if (queryTokens.length === 0) {
      return [];
    }

    const scores = new Map<string, number>();
    const N = this.documents.size;

    if (N === 0) {
      return [];
    }

    // Calculate BM25 score for each document
    for (const docId of this.documents.keys()) {
      let score = 0;

      for (const term of queryTokens) {
        const termDocs = this.termFrequencies.get(term);
        if (!termDocs) continue;

        const tf = termDocs.get(docId) || 0;
        if (tf === 0) continue;

        const df = this.documentFrequencies.get(term) || 0;
        if (df < (this.config.minDocFreq || 1)) continue;

        const docLength = this.documentLengths.get(docId) || 0;

        // IDF component
        const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);

        // TF component with length normalization
        const tfNorm =
          (tf * (this.config.k1 + 1)) /
          (tf +
            this.config.k1 *
              (1 - this.config.b + this.config.b * (docLength / this.avgDocLength)));

        score += idf * tfNorm;
      }

      if (score > 0) {
        scores.set(docId, score);
      }
    }

    // Sort by score and return top results
    return Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([id, score]) => ({ id, score }));
  }

  /**
   * Get document by ID
   */
  getDocument(docId: string): BM25Document | undefined {
    return this.documents.get(docId);
  }

  /**
   * Check if document exists
   */
  hasDocument(docId: string): boolean {
    return this.documents.has(docId);
  }

  /**
   * Get index statistics
   */
  getStats(): BM25Stats {
    let totalTerms = 0;
    for (const length of this.documentLengths.values()) {
      totalTerms += length;
    }

    return {
      totalDocuments: this.documents.size,
      avgDocLength: this.avgDocLength,
      uniqueTerms: this.termFrequencies.size,
      totalTerms,
    };
  }

  /**
   * Clear the index
   */
  clear(): void {
    this.documents.clear();
    this.documentLengths.clear();
    this.termFrequencies.clear();
    this.documentFrequencies.clear();
    this.avgDocLength = 0;
  }

  /**
   * Update average document length
   */
  private updateAvgDocLength(): void {
    if (this.documentLengths.size === 0) {
      this.avgDocLength = 0;
      return;
    }

    let totalLength = 0;
    for (const length of this.documentLengths.values()) {
      totalLength += length;
    }
    this.avgDocLength = totalLength / this.documentLengths.size;
  }

  /**
   * Normalize BM25 scores to 0-1 range
   */
  static normalizeScores(
    results: Array<{ id: string; score: number }>
  ): Array<{ id: string; score: number }> {
    if (results.length === 0) return [];

    const maxScore = Math.max(...results.map(r => r.score));
    if (maxScore === 0) return results;

    return results.map(r => ({
      id: r.id,
      score: r.score / maxScore,
    }));
  }
}

// ============================================================================
// Singleton
// ============================================================================

const indexes: Map<string, BM25Index> = new Map();

/**
 * Get or create a BM25 index by name
 */
export function getBM25Index(name: string = 'default', config?: Partial<BM25Config>): BM25Index {
  if (!indexes.has(name)) {
    indexes.set(name, new BM25Index(config));
  }
  return indexes.get(name)!;
}

/**
 * Remove a BM25 index
 */
export function removeBM25Index(name: string): boolean {
  const index = indexes.get(name);
  if (index) {
    index.clear();
    indexes.delete(name);
    return true;
  }
  return false;
}

/**
 * Clear all indexes
 */
export function clearAllBM25Indexes(): void {
  for (const index of indexes.values()) {
    index.clear();
  }
  indexes.clear();
}
