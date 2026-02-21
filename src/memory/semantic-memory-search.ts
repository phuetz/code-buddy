/**
 * OpenClaw-inspired 2-Step Memory Search System
 *
 * Workflow:
 * 1. Semantic search to find relevant content
 * 2. Targeted retrieval to minimize token usage
 *
 * Features:
 * - Semantic similarity scoring
 * - File-based memory storage
 * - Configurable minScore and maxResults
 * - Context-efficient retrieval
 */

import { EventEmitter } from 'events';
import fs from 'fs-extra';
import path from 'path';
import { logger } from '../utils/logger.js';

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface MemoryEntry {
  id: string;
  content: string;
  metadata: {
    source: string;
    path: string;
    lineStart: number;
    lineEnd: number;
    timestamp: Date;
    tags?: string[];
    importance?: number;
  };
  embedding?: number[];
}

export interface SearchResult {
  entry: MemoryEntry;
  score: number;
  matchedTerms: string[];
  snippet: string;
}

export interface SearchOptions {
  maxResults?: number;
  minScore?: number;
  tags?: string[];
  sources?: string[];
  dateRange?: {
    start?: Date;
    end?: Date;
  };
}

export interface RetrievalOptions {
  from?: number;
  lines?: number;
  context?: number;
}

export interface RetrievalResult {
  content: string;
  path: string;
  lineStart: number;
  lineEnd: number;
  totalLines: number;
}

export interface MemorySearchConfig {
  memoryDir: string;
  indexFile?: string;
  maxMemorySize?: number;
  embeddingProvider?: 'local' | 'openai' | 'none';
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: MemorySearchConfig = {
  memoryDir: '.codebuddy/memory',
  indexFile: '.codebuddy/memory/index.json',
  maxMemorySize: 10000, // Max entries
  embeddingProvider: 'none',
};

const DEFAULT_SEARCH_OPTIONS: SearchOptions = {
  maxResults: 10,
  minScore: 0.3,
};

// ============================================================================
// Semantic Memory Search Manager
// ============================================================================

export class SemanticMemorySearch extends EventEmitter {
  private config: MemorySearchConfig;
  private index: Map<string, MemoryEntry> = new Map();
  private invertedIndex: Map<string, Set<string>> = new Map(); // term -> entry IDs
  private loaded: boolean = false;

  constructor(config: Partial<MemorySearchConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize and load the memory index
   */
  async initialize(): Promise<void> {
    if (this.loaded) return;

    await this.loadIndex();
    await this.scanMemoryFiles();
    this.loaded = true;

    this.emit('initialized', { entryCount: this.index.size });
  }

  /**
   * Step 1: Semantic search across memory
   */
  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    if (!this.loaded) {
      await this.initialize();
    }

    const opts = { ...DEFAULT_SEARCH_OPTIONS, ...options };
    const queryTerms = this.tokenize(query);

    this.emit('search:start', { query, options: opts });

    // Find candidate entries using inverted index
    const candidateIds = new Set<string>();
    for (const term of queryTerms) {
      const entries = this.invertedIndex.get(term.toLowerCase());
      if (entries) {
        for (const id of entries) {
          candidateIds.add(id);
        }
      }
    }

    // Score candidates
    const results: SearchResult[] = [];

    for (const id of candidateIds) {
      const entry = this.index.get(id);
      if (!entry) continue;

      // Apply filters
      if (opts.tags && opts.tags.length > 0) {
        if (!entry.metadata.tags?.some(t => opts.tags!.includes(t))) {
          continue;
        }
      }

      if (opts.sources && opts.sources.length > 0) {
        if (!opts.sources.includes(entry.metadata.source)) {
          continue;
        }
      }

      if (opts.dateRange) {
        const entryDate = entry.metadata.timestamp;
        if (opts.dateRange.start && entryDate < opts.dateRange.start) continue;
        if (opts.dateRange.end && entryDate > opts.dateRange.end) continue;
      }

      // Calculate score
      const { score, matchedTerms } = this.calculateScore(entry, queryTerms);

      if (score >= (opts.minScore || 0)) {
        results.push({
          entry,
          score,
          matchedTerms,
          snippet: this.extractSnippet(entry.content, matchedTerms),
        });
      }
    }

    // Sort by score and limit results
    results.sort((a, b) => b.score - a.score);

    // Apply MMR re-ranking for diversity (lambda=0.7: 70% relevance, 30% diversity)
    const reranked = this.mmrRerank(results, 0.7, opts.maxResults ?? 10);

    this.emit('search:complete', { query, resultCount: reranked.length });

    return reranked;
  }

  /**
   * Step 2: Targeted retrieval from file
   */
  async retrieve(filePath: string, options: RetrievalOptions = {}): Promise<RetrievalResult> {
    const { from = 1, lines = 50, context = 3 } = options;

    const fullPath = path.isAbsolute(filePath)
      ? filePath
      : path.join(process.cwd(), this.config.memoryDir, filePath);

    if (!await fs.pathExists(fullPath)) {
      throw new Error(`Memory file not found: ${filePath}`);
    }

    const content = await fs.readFile(fullPath, 'utf-8');
    const allLines = content.split('\n');
    const totalLines = allLines.length;

    // Calculate actual line range with context
    const startLine = Math.max(1, from - context);
    const endLine = Math.min(totalLines, from + lines + context - 1);

    // Extract lines (1-indexed)
    const extractedLines = allLines.slice(startLine - 1, endLine);

    this.emit('retrieve:complete', { path: filePath, lines: extractedLines.length });

    return {
      content: extractedLines.join('\n'),
      path: filePath,
      lineStart: startLine,
      lineEnd: endLine,
      totalLines,
    };
  }

  /**
   * Add a memory entry
   */
  async add(content: string, metadata: Partial<MemoryEntry['metadata']>): Promise<string> {
    const id = this.generateId();
    const entry: MemoryEntry = {
      id,
      content,
      metadata: {
        source: metadata.source || 'manual',
        path: metadata.path || '',
        lineStart: metadata.lineStart || 1,
        lineEnd: metadata.lineEnd || content.split('\n').length,
        timestamp: metadata.timestamp || new Date(),
        tags: metadata.tags,
        importance: metadata.importance || 1,
      },
    };

    this.index.set(id, entry);
    this.indexEntry(entry);
    await this.saveIndex();

    this.emit('entry:added', { id, source: entry.metadata.source });

    return id;
  }

  /**
   * Remove a memory entry
   */
  async remove(id: string): Promise<boolean> {
    const entry = this.index.get(id);
    if (!entry) return false;

    // Remove from inverted index
    const terms = this.tokenize(entry.content);
    for (const term of terms) {
      const entries = this.invertedIndex.get(term.toLowerCase());
      if (entries) {
        entries.delete(id);
        if (entries.size === 0) {
          this.invertedIndex.delete(term.toLowerCase());
        }
      }
    }

    this.index.delete(id);
    await this.saveIndex();

    this.emit('entry:removed', { id });

    return true;
  }

  /**
   * Update a memory entry
   */
  async update(id: string, content: string, metadata?: Partial<MemoryEntry['metadata']>): Promise<boolean> {
    const existing = this.index.get(id);
    if (!existing) return false;

    // Remove old index entries
    await this.remove(id);

    // Add updated entry with same ID
    const entry: MemoryEntry = {
      id,
      content,
      metadata: {
        ...existing.metadata,
        ...metadata,
        timestamp: new Date(),
      },
    };

    this.index.set(id, entry);
    this.indexEntry(entry);
    await this.saveIndex();

    this.emit('entry:updated', { id });

    return true;
  }

  /**
   * Load the index from disk
   */
  private async loadIndex(): Promise<void> {
    const indexPath = this.config.indexFile!;

    if (await fs.pathExists(indexPath)) {
      try {
        const data = await fs.readJson(indexPath);
        for (const entry of data.entries || []) {
          entry.metadata.timestamp = new Date(entry.metadata.timestamp);
          this.index.set(entry.id, entry);
          this.indexEntry(entry);
        }
        logger.debug(`Loaded ${this.index.size} memory entries from index`);
      } catch (error) {
        logger.warn('Failed to load memory index, starting fresh');
      }
    }
  }

  /**
   * Save the index to disk
   */
  private async saveIndex(): Promise<void> {
    const indexPath = this.config.indexFile!;
    await fs.ensureDir(path.dirname(indexPath));

    const data = {
      version: 1,
      updatedAt: new Date().toISOString(),
      entries: Array.from(this.index.values()),
    };

    await fs.writeJson(indexPath, data, { spaces: 2 });
  }

  /**
   * Scan memory directory for markdown files
   */
  private async scanMemoryFiles(): Promise<void> {
    const memoryDir = path.join(process.cwd(), this.config.memoryDir);

    if (!await fs.pathExists(memoryDir)) {
      await fs.ensureDir(memoryDir);
      return;
    }

    const files = await this.findMarkdownFiles(memoryDir);

    for (const file of files) {
      const relativePath = path.relative(memoryDir, file);

      // Skip if already indexed
      if (Array.from(this.index.values()).some(e => e.metadata.path === relativePath)) {
        continue;
      }

      try {
        const content = await fs.readFile(file, 'utf-8');
        const stats = await fs.stat(file);

        await this.add(content, {
          source: 'file',
          path: relativePath,
          lineStart: 1,
          lineEnd: content.split('\n').length,
          timestamp: stats.mtime,
        });
      } catch (error) {
        logger.warn(`Failed to index memory file: ${file}`);
      }
    }
  }

  /**
   * Find all markdown files recursively
   */
  private async findMarkdownFiles(dir: string): Promise<string[]> {
    const results: string[] = [];

    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        results.push(...await this.findMarkdownFiles(fullPath));
      } else if (entry.name.endsWith('.md')) {
        results.push(fullPath);
      }
    }

    return results;
  }

  /**
   * Index an entry in the inverted index
   */
  private indexEntry(entry: MemoryEntry): void {
    const terms = this.tokenize(entry.content);

    for (const term of terms) {
      const lowered = term.toLowerCase();
      if (!this.invertedIndex.has(lowered)) {
        this.invertedIndex.set(lowered, new Set());
      }
      this.invertedIndex.get(lowered)!.add(entry.id);
    }

    // Also index tags
    if (entry.metadata.tags) {
      for (const tag of entry.metadata.tags) {
        const lowered = tag.toLowerCase();
        if (!this.invertedIndex.has(lowered)) {
          this.invertedIndex.set(lowered, new Set());
        }
        this.invertedIndex.get(lowered)!.add(entry.id);
      }
    }
  }

  /**
   * Tokenize text into terms
   */
  private tokenize(text: string): string[] {
    // Split on whitespace and punctuation, filter short terms
    return text
      .toLowerCase()
      .split(/[\s\p{P}]+/u)
      .filter(term => term.length >= 2)
      .filter(term => !this.isStopWord(term));
  }

  /**
   * Check if a term is a stop word
   */
  private isStopWord(term: string): boolean {
    const stopWords = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'must', 'can', 'to', 'of', 'in', 'for',
      'on', 'with', 'at', 'by', 'from', 'as', 'or', 'and', 'but', 'if',
      'then', 'else', 'when', 'up', 'down', 'out', 'off', 'over', 'under',
      'it', 'its', 'this', 'that', 'these', 'those', 'i', 'me', 'my',
      'we', 'our', 'you', 'your', 'he', 'she', 'they', 'their',
    ]);
    return stopWords.has(term);
  }

  /**
   * Calculate relevance score
   */
  private calculateScore(
    entry: MemoryEntry,
    queryTerms: string[]
  ): { score: number; matchedTerms: string[] } {
    const entryTerms = new Set(this.tokenize(entry.content));
    const matchedTerms: string[] = [];
    let matches = 0;

    for (const queryTerm of queryTerms) {
      if (entryTerms.has(queryTerm.toLowerCase())) {
        matches++;
        matchedTerms.push(queryTerm);
      }
    }

    // TF-IDF inspired scoring
    const termFrequency = matches / Math.max(queryTerms.length, 1);
    const docFrequency = this.invertedIndex.get(queryTerms[0]?.toLowerCase())?.size || 1;
    const idf = Math.log(this.index.size / docFrequency + 1);

    // Boost by importance
    const importanceBoost = entry.metadata.importance || 1;

    // Recency boost — exponential decay with 30-day half-life (OpenClaw pattern)
    // Formula: exp(-ln(2) * days / halfLife) → 1.0 at day 0, 0.5 at day 30, ~0.25 at day 60
    const daysSinceUpdate = (Date.now() - entry.metadata.timestamp.getTime()) / (1000 * 60 * 60 * 24);
    const recencyBoost = Math.max(0.1, Math.exp(-Math.LN2 * daysSinceUpdate / 30));

    const score = termFrequency * idf * importanceBoost * recencyBoost;

    return { score: Math.min(1, score), matchedTerms };
  }


  /**
   * MMR (Maximal Marginal Relevance) re-ranking for diversity.
   * lambda=0.7 means 70% relevance, 30% diversity penalty.
   * Prevents returning semantically redundant results.
   * Ref: Carbonell & Goldstein (1998)
   */
  private mmrRerank(
    candidates: SearchResult[],
    lambda: number = 0.7,
    k: number = 10
  ): SearchResult[] {
    if (candidates.length <= 1) return candidates;

    const selected: SearchResult[] = [];
    const remaining = [...candidates];

    // Simple term-overlap similarity between two SearchResult entries
    const termSim = (a: SearchResult, b: SearchResult): number => {
      const textA = a.entry.content ?? '';
      const textB = b.entry.content ?? '';
      const tokA = new Set(textA.toLowerCase().split(/\W+/).filter(t => t.length > 2));
      const tokB = new Set(textB.toLowerCase().split(/\W+/).filter(t => t.length > 2));
      if (tokA.size === 0 || tokB.size === 0) return 0;
      let inter = 0;
      for (const t of tokA) if (tokB.has(t)) inter++;
      return inter / Math.sqrt(tokA.size * tokB.size);
    };

    while (selected.length < k && remaining.length > 0) {
      let bestIdx = 0;
      let bestScore = -Infinity;

      for (let i = 0; i < remaining.length; i++) {
        const relevance = remaining[i].score;
        const maxSim = selected.length === 0
          ? 0
          : Math.max(...selected.map(s => termSim(remaining[i], s)));
        const mmrScore = lambda * relevance - (1 - lambda) * maxSim;
        if (mmrScore > bestScore) {
          bestScore = mmrScore;
          bestIdx = i;
        }
      }

      selected.push(remaining[bestIdx]);
      remaining.splice(bestIdx, 1);
    }

    return selected;
  }

  /**
   * Extract a relevant snippet from content
   */
  private extractSnippet(content: string, matchedTerms: string[], maxLength: number = 200): string {
    if (content.length <= maxLength) {
      return content;
    }

    // Find the first matched term
    const lowerContent = content.toLowerCase();
    let startPos = 0;

    for (const term of matchedTerms) {
      const pos = lowerContent.indexOf(term.toLowerCase());
      if (pos !== -1) {
        startPos = Math.max(0, pos - 50);
        break;
      }
    }

    const snippet = content.slice(startPos, startPos + maxLength);
    const prefix = startPos > 0 ? '...' : '';
    const suffix = startPos + maxLength < content.length ? '...' : '';

    return prefix + snippet.trim() + suffix;
  }

  /**
   * Generate a unique ID
   */
  private generateId(): string {
    return `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalEntries: number;
    totalTerms: number;
    sources: Record<string, number>;
    avgEntryLength: number;
  } {
    const sources: Record<string, number> = {};
    let totalLength = 0;

    for (const entry of this.index.values()) {
      sources[entry.metadata.source] = (sources[entry.metadata.source] || 0) + 1;
      totalLength += entry.content.length;
    }

    return {
      totalEntries: this.index.size,
      totalTerms: this.invertedIndex.size,
      sources,
      avgEntryLength: this.index.size > 0 ? Math.round(totalLength / this.index.size) : 0,
    };
  }

  /**
   * Clear all memory
   */
  async clear(): Promise<void> {
    this.index.clear();
    this.invertedIndex.clear();
    await this.saveIndex();
    this.emit('memory:cleared');
  }
}

// ============================================================================
// Singleton & Convenience Functions
// ============================================================================

let memorySearchInstance: SemanticMemorySearch | null = null;

export function getSemanticMemorySearch(config?: Partial<MemorySearchConfig>): SemanticMemorySearch {
  if (!memorySearchInstance) {
    memorySearchInstance = new SemanticMemorySearch(config);
  }
  return memorySearchInstance;
}

export function resetSemanticMemorySearch(): void {
  memorySearchInstance = null;
}

/**
 * Convenience: Search and retrieve in one call
 */
export async function searchAndRetrieve(
  query: string,
  options: SearchOptions & { retrieveLines?: number } = {}
): Promise<Array<{ result: SearchResult; content: string }>> {
  const search = getSemanticMemorySearch();
  await search.initialize();

  const results = await search.search(query, options);
  const detailed: Array<{ result: SearchResult; content: string }> = [];

  for (const result of results) {
    if (result.entry.metadata.path) {
      try {
        const retrieved = await search.retrieve(result.entry.metadata.path, {
          from: result.entry.metadata.lineStart,
          lines: options.retrieveLines || 50,
        });
        detailed.push({ result, content: retrieved.content });
      } catch {
        detailed.push({ result, content: result.entry.content });
      }
    } else {
      detailed.push({ result, content: result.entry.content });
    }
  }

  return detailed;
}
