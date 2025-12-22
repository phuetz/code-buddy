/**
 * Cross-Encoder Reranker for RAG
 *
 * Implements cross-encoder based reranking for improved RAG retrieval precision.
 * Cross-encoders jointly encode query and document for more accurate relevance scoring.
 *
 * Research basis:
 * - "Sentence-BERT" (Reimers & Gurevych, 2019): Cross-encoder architecture
 * - "MS MARCO" benchmark: Cross-encoder reranking improvements
 * - ColBERT, MonoT5: Modern reranking techniques
 *
 * Architecture:
 * - Stage 1: Fast bi-encoder retrieval (existing RAG)
 * - Stage 2: Cross-encoder reranking of top-K candidates
 *
 * Benefits:
 * - Higher precision in top results
 * - Better semantic matching
 * - Context-aware relevance scoring
 */

import { EventEmitter } from 'events';
import { ScoredChunk, CodeChunk } from './codebase-rag/types.js';

// ============================================================================
// Types
// ============================================================================

export interface RerankerConfig {
  /** Maximum candidates to rerank (default: 50) */
  maxCandidates: number;
  /** Final top-K to return after reranking (default: 10) */
  topK: number;
  /** Minimum score threshold (0-1) */
  minScore: number;
  /** Weight for original bi-encoder score (0-1) */
  biEncoderWeight: number;
  /** Weight for cross-encoder score (0-1) */
  crossEncoderWeight: number;
  /** Enable query expansion */
  enableQueryExpansion: boolean;
  /** Cache TTL in milliseconds */
  cacheTTL: number;
}

const DEFAULT_CONFIG: RerankerConfig = {
  maxCandidates: 50,
  topK: 10,
  minScore: 0.3,
  biEncoderWeight: 0.3,
  crossEncoderWeight: 0.7,
  enableQueryExpansion: true,
  cacheTTL: 5 * 60 * 1000, // 5 minutes
};

export interface RerankedResult {
  chunk: CodeChunk;
  originalScore: number;
  crossEncoderScore: number;
  finalScore: number;
  rank: number;
  explanation?: string;
}

export interface RerankerStats {
  candidatesProcessed: number;
  resultsReturned: number;
  avgOriginalScore: number;
  avgCrossEncoderScore: number;
  avgFinalScore: number;
  processingTimeMs: number;
}

// ============================================================================
// Cross-Encoder Implementation
// ============================================================================

/**
 * Cross-Encoder scoring using multiple relevance signals
 *
 * Without a heavy ML model, we simulate cross-encoder behavior using:
 * 1. Term overlap analysis
 * 2. Semantic field matching
 * 3. Code structure relevance
 * 4. Context coherence scoring
 */
class CrossEncoderScorer {
  /**
   * Score a query-document pair
   */
  score(query: string, document: string): number {
    const scores = [
      this.termOverlapScore(query, document) * 0.25,
      this.semanticFieldScore(query, document) * 0.25,
      this.codeStructureScore(query, document) * 0.25,
      this.contextCoherenceScore(query, document) * 0.25,
    ];

    return scores.reduce((sum, s) => sum + s, 0);
  }

  /**
   * Explain the scoring
   */
  explain(query: string, document: string): string {
    const termScore = this.termOverlapScore(query, document);
    const semanticScore = this.semanticFieldScore(query, document);
    const codeScore = this.codeStructureScore(query, document);
    const contextScore = this.contextCoherenceScore(query, document);

    const parts = [];
    if (termScore > 0.5) parts.push('strong term match');
    if (semanticScore > 0.5) parts.push('semantic relevance');
    if (codeScore > 0.5) parts.push('code structure match');
    if (contextScore > 0.5) parts.push('context coherence');

    return parts.length > 0 ? parts.join(', ') : 'weak match';
  }

  /**
   * Calculate term overlap between query and document
   */
  private termOverlapScore(query: string, document: string): number {
    const queryTerms = this.extractTerms(query);
    const docTerms = this.extractTerms(document);

    if (queryTerms.length === 0) return 0;

    let matchCount = 0;
    for (const term of queryTerms) {
      if (docTerms.includes(term)) {
        matchCount++;
      } else {
        // Partial match for compound words
        for (const docTerm of docTerms) {
          if (docTerm.includes(term) || term.includes(docTerm)) {
            matchCount += 0.5;
            break;
          }
        }
      }
    }

    return Math.min(1, matchCount / queryTerms.length);
  }

  /**
   * Calculate semantic field relevance
   */
  private semanticFieldScore(query: string, document: string): number {
    // Semantic field dictionaries for code-related queries
    const semanticFields: Record<string, string[]> = {
      error: ['error', 'exception', 'throw', 'catch', 'try', 'fail', 'bug', 'fix', 'issue'],
      auth: ['auth', 'login', 'logout', 'password', 'token', 'session', 'user', 'credential'],
      database: ['database', 'db', 'query', 'sql', 'table', 'schema', 'migration', 'model'],
      api: ['api', 'endpoint', 'route', 'request', 'response', 'http', 'rest', 'graphql'],
      test: ['test', 'spec', 'mock', 'assert', 'expect', 'jest', 'mocha', 'describe', 'it'],
      performance: ['performance', 'optimize', 'cache', 'memory', 'speed', 'latency', 'fast'],
      security: ['security', 'encrypt', 'hash', 'salt', 'permission', 'role', 'access'],
      config: ['config', 'setting', 'option', 'env', 'environment', 'variable', 'parameter'],
      ui: ['ui', 'component', 'render', 'display', 'view', 'button', 'input', 'form'],
      async: ['async', 'await', 'promise', 'callback', 'event', 'stream', 'observable'],
    };

    const queryLower = query.toLowerCase();
    const docLower = document.toLowerCase();

    let maxScore = 0;

    for (const [_field, terms] of Object.entries(semanticFields)) {
      const queryMatches = terms.filter(t => queryLower.includes(t)).length;
      const docMatches = terms.filter(t => docLower.includes(t)).length;

      if (queryMatches > 0 && docMatches > 0) {
        const fieldScore = (queryMatches * docMatches) / (terms.length * terms.length);
        maxScore = Math.max(maxScore, Math.min(1, fieldScore * 4)); // Amplify for visibility
      }
    }

    return maxScore;
  }

  /**
   * Calculate code structure relevance
   */
  private codeStructureScore(query: string, document: string): number {
    let score = 0;
    const queryLower = query.toLowerCase();
    const docLower = document.toLowerCase();

    // Check for function/method queries
    const functionPatterns = [
      /function\s+(\w+)/g,
      /const\s+(\w+)\s*=/g,
      /(\w+)\s*\(/g,
      /def\s+(\w+)/g,
      /async\s+(\w+)/g,
    ];

    // Extract identifiers from query
    const queryIdentifiers = new Set<string>();
    for (const pattern of functionPatterns) {
      let match;
      while ((match = pattern.exec(query)) !== null) {
        queryIdentifiers.add(match[1].toLowerCase());
      }
    }

    // Also add plain words that look like identifiers
    const words = query.match(/\b[a-zA-Z_]\w+\b/g) || [];
    for (const word of words) {
      if (word.length > 2) {
        queryIdentifiers.add(word.toLowerCase());
      }
    }

    // Check document for matches
    for (const identifier of queryIdentifiers) {
      if (docLower.includes(identifier)) {
        score += 0.2;
      }
    }

    // Boost for code block patterns
    if (document.includes('function') || document.includes('class') || document.includes('interface')) {
      if (queryLower.includes('function') || queryLower.includes('class') || queryLower.includes('interface')) {
        score += 0.3;
      }
    }

    // Boost for import/export patterns
    if ((document.includes('import') || document.includes('export')) &&
        (queryLower.includes('import') || queryLower.includes('export'))) {
      score += 0.2;
    }

    return Math.min(1, score);
  }

  /**
   * Calculate context coherence
   */
  private contextCoherenceScore(query: string, document: string): number {
    // Check if the document provides coherent context for the query
    let score = 0;

    // Length appropriateness
    const docLength = document.length;
    if (docLength >= 50 && docLength <= 2000) {
      score += 0.3; // Prefer medium-length chunks
    } else if (docLength >= 20 && docLength <= 5000) {
      score += 0.1;
    }

    // Check for complete code structures
    const hasCompleteFunction = /function\s+\w+\s*\([^)]*\)\s*\{[\s\S]*\}/m.test(document);
    const hasCompleteClass = /class\s+\w+[\s\S]*\{[\s\S]*\}/m.test(document);
    const hasCompleteInterface = /interface\s+\w+\s*\{[\s\S]*\}/m.test(document);

    if (hasCompleteFunction || hasCompleteClass || hasCompleteInterface) {
      score += 0.4;
    }

    // Check for documentation
    if (document.includes('/**') || document.includes('//') || document.includes('#')) {
      score += 0.2;
    }

    // Check for type annotations (TypeScript)
    if (document.includes(': ') && (document.includes('string') || document.includes('number') ||
        document.includes('boolean') || document.includes('[]'))) {
      score += 0.1;
    }

    return Math.min(1, score);
  }

  /**
   * Extract terms from text
   */
  private extractTerms(text: string): string[] {
    // Split by common delimiters and filter
    const terms = text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 2)
      .filter(t => !this.isStopWord(t));

    // Also extract camelCase/snake_case parts
    const extraTerms: string[] = [];
    for (const term of terms) {
      // camelCase
      const camelParts = term.split(/(?=[A-Z])/);
      if (camelParts.length > 1) {
        extraTerms.push(...camelParts.map(p => p.toLowerCase()).filter(p => p.length > 2));
      }
      // snake_case
      const snakeParts = term.split('_');
      if (snakeParts.length > 1) {
        extraTerms.push(...snakeParts.filter(p => p.length > 2));
      }
    }

    return [...new Set([...terms, ...extraTerms])];
  }

  /**
   * Check if a word is a stop word
   */
  private isStopWord(word: string): boolean {
    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
      'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
      'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need',
      'this', 'that', 'these', 'those', 'it', 'its', 'they', 'them',
      'const', 'let', 'var', 'new', 'return', 'if', 'else', 'while', 'for',
    ]);
    return stopWords.has(word);
  }
}

// ============================================================================
// Query Expander
// ============================================================================

class QueryExpander {
  private synonyms: Map<string, string[]> = new Map([
    ['error', ['exception', 'bug', 'issue', 'problem', 'failure']],
    ['function', ['method', 'procedure', 'routine', 'handler']],
    ['create', ['make', 'generate', 'build', 'construct', 'initialize']],
    ['delete', ['remove', 'destroy', 'drop', 'clear', 'erase']],
    ['update', ['modify', 'change', 'edit', 'alter', 'patch']],
    ['get', ['fetch', 'retrieve', 'obtain', 'load', 'read']],
    ['set', ['assign', 'configure', 'define', 'establish']],
    ['test', ['spec', 'check', 'verify', 'validate', 'assert']],
    ['config', ['configuration', 'settings', 'options', 'preferences']],
    ['auth', ['authentication', 'authorization', 'login', 'security']],
    ['api', ['endpoint', 'route', 'service', 'interface']],
    ['db', ['database', 'storage', 'persistence', 'repository']],
  ]);

  /**
   * Expand query with synonyms and related terms
   */
  expand(query: string): string[] {
    const terms = query.toLowerCase().split(/\s+/);
    const expanded = new Set<string>([query]);

    for (const term of terms) {
      const synonymList = this.synonyms.get(term);
      if (synonymList) {
        for (const synonym of synonymList) {
          expanded.add(query.replace(new RegExp(`\\b${term}\\b`, 'gi'), synonym));
        }
      }
    }

    return Array.from(expanded);
  }
}

// ============================================================================
// Reranker Manager
// ============================================================================

export class CrossEncoderReranker extends EventEmitter {
  private config: RerankerConfig;
  private scorer: CrossEncoderScorer;
  private expander: QueryExpander;
  private cache: Map<string, { result: RerankedResult[]; timestamp: number }> = new Map();

  constructor(config: Partial<RerankerConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.scorer = new CrossEncoderScorer();
    this.expander = new QueryExpander();
  }

  /**
   * Rerank candidates using cross-encoder scoring
   */
  rerank(query: string, candidates: ScoredChunk[]): { results: RerankedResult[]; stats: RerankerStats } {
    const startTime = Date.now();

    // Check cache
    const cacheKey = this.getCacheKey(query, candidates);
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.config.cacheTTL) {
      return {
        results: cached.result,
        stats: this.calculateStats(cached.result, Date.now() - startTime),
      };
    }

    // Limit candidates
    const limitedCandidates = candidates.slice(0, this.config.maxCandidates);

    // Expand query if enabled
    const queries = this.config.enableQueryExpansion
      ? this.expander.expand(query)
      : [query];

    // Score each candidate
    const scored: RerankedResult[] = limitedCandidates.map(candidate => {
      // Get max cross-encoder score across query expansions
      let maxCrossScore = 0;
      for (const q of queries) {
        const score = this.scorer.score(q, candidate.chunk.content);
        maxCrossScore = Math.max(maxCrossScore, score);
      }

      // Combine scores
      const finalScore =
        candidate.score * this.config.biEncoderWeight +
        maxCrossScore * this.config.crossEncoderWeight;

      return {
        chunk: candidate.chunk,
        originalScore: candidate.score,
        crossEncoderScore: maxCrossScore,
        finalScore,
        rank: 0,
        explanation: this.scorer.explain(query, candidate.chunk.content),
      };
    });

    // Sort by final score
    scored.sort((a, b) => b.finalScore - a.finalScore);

    // Assign ranks
    scored.forEach((result, index) => {
      result.rank = index + 1;
    });

    // Filter by minimum score and take top-K
    const results = scored
      .filter(r => r.finalScore >= this.config.minScore)
      .slice(0, this.config.topK);

    // Cache result
    this.cache.set(cacheKey, { result: results, timestamp: Date.now() });

    // Cleanup old cache entries
    this.cleanupCache();

    const stats = this.calculateStats(results, Date.now() - startTime);

    this.emit('reranked', { query, stats });

    return { results, stats };
  }

  /**
   * Rerank with diversity (MMR - Maximal Marginal Relevance)
   */
  rerankWithDiversity(
    query: string,
    candidates: ScoredChunk[],
    lambda: number = 0.7 // Trade-off between relevance and diversity
  ): { results: RerankedResult[]; stats: RerankerStats } {
    const { results: initialResults, stats } = this.rerank(query, candidates);

    if (initialResults.length <= 1) {
      return { results: initialResults, stats };
    }

    // Apply MMR
    const selected: RerankedResult[] = [initialResults[0]];
    const remaining = initialResults.slice(1);

    while (selected.length < this.config.topK && remaining.length > 0) {
      let bestIndex = -1;
      let bestMMRScore = -Infinity;

      for (let i = 0; i < remaining.length; i++) {
        const candidate = remaining[i];

        // Calculate max similarity to already selected
        let maxSimilarity = 0;
        for (const sel of selected) {
          const sim = this.calculateSimilarity(candidate.chunk.content, sel.chunk.content);
          maxSimilarity = Math.max(maxSimilarity, sim);
        }

        // MMR score
        const mmrScore = lambda * candidate.finalScore - (1 - lambda) * maxSimilarity;

        if (mmrScore > bestMMRScore) {
          bestMMRScore = mmrScore;
          bestIndex = i;
        }
      }

      if (bestIndex >= 0) {
        selected.push(remaining[bestIndex]);
        remaining.splice(bestIndex, 1);
      } else {
        break;
      }
    }

    // Update ranks
    selected.forEach((result, index) => {
      result.rank = index + 1;
    });

    return { results: selected, stats };
  }

  /**
   * Calculate similarity between two documents
   */
  private calculateSimilarity(doc1: string, doc2: string): number {
    const terms1 = new Set(doc1.toLowerCase().split(/\W+/).filter(t => t.length > 2));
    const terms2 = new Set(doc2.toLowerCase().split(/\W+/).filter(t => t.length > 2));

    const intersection = new Set([...terms1].filter(t => terms2.has(t)));
    const union = new Set([...terms1, ...terms2]);

    return union.size > 0 ? intersection.size / union.size : 0;
  }

  /**
   * Generate cache key
   */
  private getCacheKey(query: string, candidates: ScoredChunk[]): string {
    const candidateIds = candidates.slice(0, 10).map(c => c.chunk.id || c.chunk.filePath).join('|');
    return `${query}::${candidateIds}`;
  }

  /**
   * Calculate statistics
   */
  private calculateStats(results: RerankedResult[], processingTimeMs: number): RerankerStats {
    if (results.length === 0) {
      return {
        candidatesProcessed: 0,
        resultsReturned: 0,
        avgOriginalScore: 0,
        avgCrossEncoderScore: 0,
        avgFinalScore: 0,
        processingTimeMs,
      };
    }

    const avgOriginalScore = results.reduce((sum, r) => sum + r.originalScore, 0) / results.length;
    const avgCrossEncoderScore = results.reduce((sum, r) => sum + r.crossEncoderScore, 0) / results.length;
    const avgFinalScore = results.reduce((sum, r) => sum + r.finalScore, 0) / results.length;

    return {
      candidatesProcessed: this.config.maxCandidates,
      resultsReturned: results.length,
      avgOriginalScore,
      avgCrossEncoderScore,
      avgFinalScore,
      processingTimeMs,
    };
  }

  /**
   * Cleanup old cache entries
   */
  private cleanupCache(): void {
    const now = Date.now();
    for (const [key, value] of this.cache) {
      if (now - value.timestamp > this.config.cacheTTL) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get configuration
   */
  getConfig(): RerankerConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<RerankerConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  /**
   * Format status
   */
  formatStatus(): string {
    const cacheSize = this.cache.size;

    const lines = [
      '╔══════════════════════════════════════════════════════════════╗',
      '║                  🔄 CROSS-ENCODER RERANKER                   ║',
      '╠══════════════════════════════════════════════════════════════╣',
      `║ Max Candidates:     ${this.config.maxCandidates.toString().padEnd(40)}║`,
      `║ Top-K:              ${this.config.topK.toString().padEnd(40)}║`,
      `║ Min Score:          ${this.config.minScore.toFixed(2).padEnd(40)}║`,
      `║ Bi-Encoder Weight:  ${this.config.biEncoderWeight.toFixed(2).padEnd(40)}║`,
      `║ Cross-Enc Weight:   ${this.config.crossEncoderWeight.toFixed(2).padEnd(40)}║`,
      `║ Query Expansion:    ${(this.config.enableQueryExpansion ? 'ON' : 'OFF').padEnd(40)}║`,
      `║ Cache Entries:      ${cacheSize.toString().padEnd(40)}║`,
      '╚══════════════════════════════════════════════════════════════╝',
    ];

    return lines.join('\n');
  }

  /**
   * Dispose resources and cleanup
   */
  dispose(): void {
    this.clearCache();
    this.removeAllListeners();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let rerankerInstance: CrossEncoderReranker | null = null;

export function getCrossEncoderReranker(config?: Partial<RerankerConfig>): CrossEncoderReranker {
  if (!rerankerInstance) {
    rerankerInstance = new CrossEncoderReranker(config);
  }
  return rerankerInstance;
}

export function resetCrossEncoderReranker(): void {
  if (rerankerInstance) {
    rerankerInstance.dispose();
  }
  rerankerInstance = null;
}
