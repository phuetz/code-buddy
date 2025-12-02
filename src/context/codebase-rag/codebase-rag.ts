/**
 * Codebase RAG System
 *
 * Main RAG (Retrieval-Augmented Generation) system for codebase search.
 * Implements semantic code search with intelligent chunking and retrieval.
 *
 * Based on research from:
 * - Corrective RAG (CRAG, 2024)
 * - RAG for Large Scale Code Repos (Qodo)
 * - RAG Comprehensive Survey (arXiv 2506.00054)
 */

import fs from "fs";
import path from "path";
import { EventEmitter } from "events";
import {
  CodeChunk,
  ScoredChunk,
  RetrievalResult,
  QueryContext,
  QueryIntent,
  QueryFilters,
  CRAGEvaluation,
  RAGConfig,
  DEFAULT_RAG_CONFIG,
  IndexStats,
  FileIndexResult,
  EmbeddingProvider,
  VectorStore,
} from "./types.js";
import { CodeChunker, createChunker, detectLanguage } from "./chunker.js";
import { createEmbeddingProvider, cosineSimilarity } from "./embeddings.js";
import { createVectorStore, InMemoryVectorStore } from "./vector-store.js";

/**
 * Main Codebase RAG class
 */
export class CodebaseRAG extends EventEmitter {
  private config: RAGConfig;
  private chunker: CodeChunker;
  private embedder: EmbeddingProvider;
  private vectorStore: VectorStore;
  private chunkStore: Map<string, CodeChunk> = new Map();
  private fileIndex: Map<string, string[]> = new Map(); // filePath -> chunkIds
  private indexStats: IndexStats;
  private isIndexing: boolean = false;

  constructor(config: Partial<RAGConfig> = {}) {
    super();
    this.config = { ...DEFAULT_RAG_CONFIG, ...config };
    this.chunker = createChunker(this.config);
    this.embedder = createEmbeddingProvider("code", this.config.embeddingDimension);
    this.vectorStore = createVectorStore("memory", {
      persistPath: this.config.indexPath
        ? path.join(this.config.indexPath, "vectors.json")
        : undefined,
    });

    this.indexStats = {
      totalChunks: 0,
      totalFiles: 0,
      totalTokens: 0,
      indexSize: 0,
      lastUpdated: new Date(),
      languages: {},
      chunkTypes: {} as any,
    };
  }

  /**
   * Index an entire codebase
   */
  async indexCodebase(
    rootPath: string,
    options: {
      includePatterns?: string[];
      excludePatterns?: string[];
      onProgress?: (current: number, total: number, file: string) => void;
    } = {}
  ): Promise<IndexStats> {
    if (this.isIndexing) {
      throw new Error("Indexing already in progress");
    }

    this.isIndexing = true;
    this.emit("index:start", { rootPath });

    try {
      // Find all files
      const files = await this.findFiles(rootPath, {
        includePatterns: options.includePatterns,
        excludePatterns: options.excludePatterns || this.config.excludePatterns,
      });

      this.emit("index:files_found", { count: files.length });

      // Index each file
      let processed = 0;
      for (const file of files) {
        const result = await this.indexFile(file);

        processed++;
        if (options.onProgress) {
          options.onProgress(processed, files.length, file);
        }

        this.emit("index:file_processed", {
          file,
          success: result.success,
          chunks: result.chunks.length,
          progress: processed / files.length,
        });
      }

      // Update stats
      this.indexStats.lastUpdated = new Date();
      this.indexStats.totalFiles = this.fileIndex.size;
      this.indexStats.totalChunks = this.chunkStore.size;

      // Save to disk if configured
      if (this.config.indexPath) {
        await this.saveIndex();
      }

      this.emit("index:complete", { stats: this.indexStats });
      return this.indexStats;

    } finally {
      this.isIndexing = false;
    }
  }

  /**
   * Index a single file
   */
  async indexFile(filePath: string): Promise<FileIndexResult> {
    const startTime = Date.now();

    try {
      // Read file content
      const content = fs.readFileSync(filePath, "utf-8");

      // Skip binary files
      if (this.isBinaryContent(content)) {
        return {
          filePath,
          chunks: [],
          success: false,
          error: "Binary file",
          processingTime: Date.now() - startTime,
        };
      }

      // Chunk the file
      const chunks = this.chunker.chunkFile(content, filePath);

      // Remove old chunks for this file
      await this.removeFileChunks(filePath);

      // Embed and store chunks
      const chunkIds: string[] = [];
      for (const chunk of chunks) {
        // Generate embedding
        const embedding = await this.embedder.embed(
          this.prepareTextForEmbedding(chunk)
        );
        chunk.embedding = embedding;

        // Store in vector store
        await this.vectorStore.add(chunk.id, embedding, {
          filePath: chunk.filePath,
          type: chunk.type,
          language: chunk.language,
          startLine: chunk.startLine,
          name: chunk.metadata.name,
        });

        // Store chunk
        this.chunkStore.set(chunk.id, chunk);
        chunkIds.push(chunk.id);

        // Update stats
        const lang = chunk.language;
        this.indexStats.languages[lang] = (this.indexStats.languages[lang] || 0) + 1;
        this.indexStats.chunkTypes[chunk.type] = (this.indexStats.chunkTypes[chunk.type] || 0) + 1;
        this.indexStats.totalTokens += this.estimateTokens(chunk.content);
      }

      // Update file index
      this.fileIndex.set(filePath, chunkIds);

      return {
        filePath,
        chunks,
        success: true,
        processingTime: Date.now() - startTime,
      };

    } catch (error: any) {
      return {
        filePath,
        chunks: [],
        success: false,
        error: error.message,
        processingTime: Date.now() - startTime,
      };
    }
  }

  /**
   * Retrieve relevant code chunks for a query
   */
  async retrieve(
    query: string,
    options: {
      topK?: number;
      minScore?: number;
      filters?: QueryFilters;
      strategy?: "semantic" | "keyword" | "hybrid" | "reranked" | "corrective";
    } = {}
  ): Promise<RetrievalResult> {
    const startTime = Date.now();
    const topK = options.topK || this.config.topK;
    const minScore = options.minScore || this.config.minScore;
    const strategy = options.strategy || this.config.strategy;

    // Classify query intent
    const intent = this.classifyQueryIntent(query);

    // Build filter from options
    const filter = this.buildFilter(options.filters);

    let results: ScoredChunk[];

    switch (strategy) {
      case "semantic":
        results = await this.semanticSearch(query, topK * 2, filter);
        break;
      case "keyword":
        results = await this.keywordSearch(query, topK * 2, filter);
        break;
      case "hybrid":
        results = await this.hybridSearch(query, topK * 2, filter);
        break;
      case "reranked":
        results = await this.rerankedSearch(query, topK * 2, filter);
        break;
      case "corrective":
        results = await this.correctiveSearch(query, topK * 2, filter);
        break;
      default:
        results = await this.hybridSearch(query, topK * 2, filter);
    }

    // Filter by minimum score and take top K
    const filteredResults = results
      .filter(r => r.score >= minScore)
      .slice(0, topK);

    return {
      chunks: filteredResults,
      query,
      totalChunks: this.chunkStore.size,
      retrievalTime: Date.now() - startTime,
      strategy,
    };
  }

  /**
   * Semantic search using embeddings
   */
  private async semanticSearch(
    query: string,
    k: number,
    filter?: Record<string, unknown>
  ): Promise<ScoredChunk[]> {
    const queryEmbedding = await this.embedder.embed(query);
    const searchResults = await this.vectorStore.search(queryEmbedding, k, filter);

    const results: ScoredChunk[] = [];
    for (const result of searchResults) {
      const chunk = this.chunkStore.get(result.id);
      if (chunk) {
        results.push({
          chunk,
          score: result.score,
          matchType: "semantic",
        });
      }
    }
    return results;
  }

  /**
   * Keyword-based search
   */
  private async keywordSearch(
    query: string,
    k: number,
    filter?: Record<string, unknown>
  ): Promise<ScoredChunk[]> {
    const queryTokens = this.tokenize(query.toLowerCase());
    const results: ScoredChunk[] = [];

    for (const chunk of this.chunkStore.values()) {
      // Apply filter
      if (filter && !this.matchesFilter(chunk, filter)) {
        continue;
      }

      const content = chunk.content.toLowerCase();
      const name = chunk.metadata.name?.toLowerCase() || "";

      // Calculate keyword score
      let score = 0;
      for (const token of queryTokens) {
        // Boost for name matches
        if (name.includes(token)) {
          score += 2;
        }
        // Count content occurrences
        const regex = new RegExp(token, "gi");
        const matches = content.match(regex);
        if (matches) {
          score += matches.length * 0.5;
        }
      }

      if (score > 0) {
        // Normalize score
        const normalizedScore = Math.min(score / queryTokens.length, 1);
        results.push({
          chunk,
          score: normalizedScore,
          matchType: "keyword",
          highlights: this.findHighlights(content, queryTokens),
        });
      }
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  /**
   * Hybrid search combining semantic and keyword
   */
  private async hybridSearch(
    query: string,
    k: number,
    filter?: Record<string, unknown>
  ): Promise<ScoredChunk[]> {
    // Get both result sets
    const [semanticResults, keywordResults] = await Promise.all([
      this.semanticSearch(query, k, filter),
      this.keywordSearch(query, k, filter),
    ]);

    // Merge and deduplicate
    const merged = new Map<string, ScoredChunk>();

    // Weight: 60% semantic, 40% keyword
    const semanticWeight = 0.6;
    const keywordWeight = 0.4;

    for (const result of semanticResults) {
      merged.set(result.chunk.id, {
        ...result,
        score: result.score * semanticWeight,
        matchType: "hybrid",
      });
    }

    for (const result of keywordResults) {
      const existing = merged.get(result.chunk.id);
      if (existing) {
        existing.score += result.score * keywordWeight;
        existing.highlights = result.highlights;
      } else {
        merged.set(result.chunk.id, {
          ...result,
          score: result.score * keywordWeight,
          matchType: "hybrid",
        });
      }
    }

    return Array.from(merged.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  /**
   * Reranked search with LLM scoring
   */
  private async rerankedSearch(
    query: string,
    k: number,
    filter?: Record<string, unknown>
  ): Promise<ScoredChunk[]> {
    // First, get candidates from hybrid search
    const candidates = await this.hybridSearch(query, k * 2, filter);

    // For now, use hybrid results directly
    // TODO: Implement LLM reranking when API is available
    return candidates.slice(0, k);
  }

  /**
   * Corrective RAG search
   * Evaluates relevance and refines query if needed
   */
  private async correctiveSearch(
    query: string,
    k: number,
    filter?: Record<string, unknown>,
    iteration: number = 0
  ): Promise<ScoredChunk[]> {
    const maxIterations = 3;

    // Get initial results
    const results = await this.hybridSearch(query, k, filter);

    if (iteration >= maxIterations || results.length === 0) {
      return results;
    }

    // Evaluate relevance of top results
    const evaluation = this.evaluateRelevance(query, results.slice(0, 3));

    if (evaluation.isRelevant && evaluation.confidence > 0.7) {
      return results;
    }

    // Try to refine the query based on evaluation
    if (evaluation.action === "refine" && evaluation.refinedQuery) {
      return this.correctiveSearch(
        evaluation.refinedQuery,
        k,
        filter,
        iteration + 1
      );
    }

    return results;
  }

  /**
   * Evaluate relevance of retrieved chunks
   */
  private evaluateRelevance(
    query: string,
    topResults: ScoredChunk[]
  ): CRAGEvaluation {
    if (topResults.length === 0) {
      return {
        isRelevant: false,
        confidence: 0,
        action: "reject",
        feedback: "No results found",
      };
    }

    // Calculate average score
    const avgScore = topResults.reduce((sum, r) => sum + r.score, 0) / topResults.length;

    // Check if query terms appear in results
    const queryTokens = this.tokenize(query.toLowerCase());
    let termMatches = 0;

    for (const result of topResults) {
      const content = result.chunk.content.toLowerCase();
      for (const token of queryTokens) {
        if (content.includes(token)) {
          termMatches++;
        }
      }
    }

    const termMatchRatio = termMatches / (queryTokens.length * topResults.length);

    // Determine relevance
    const isRelevant = avgScore > 0.5 && termMatchRatio > 0.3;
    const confidence = (avgScore + termMatchRatio) / 2;

    let action: CRAGEvaluation["action"] = "accept";
    let refinedQuery: string | undefined;

    if (!isRelevant) {
      if (termMatchRatio < 0.1) {
        // Try expanding the query
        action = "refine";
        refinedQuery = this.expandQuery(query);
      } else {
        action = "reject";
      }
    }

    return {
      isRelevant,
      confidence,
      action,
      refinedQuery,
    };
  }

  /**
   * Expand query with related terms
   */
  private expandQuery(query: string): string {
    // Simple query expansion using synonyms and related terms
    const expansions: Record<string, string[]> = {
      function: ["method", "func", "def", "procedure"],
      class: ["struct", "interface", "type"],
      error: ["exception", "throw", "catch", "fail"],
      test: ["spec", "describe", "it", "expect"],
      api: ["endpoint", "route", "handler"],
      database: ["db", "sql", "query", "model"],
      auth: ["authentication", "login", "session", "token"],
    };

    const tokens = this.tokenize(query.toLowerCase());
    const expanded = [...tokens];

    for (const token of tokens) {
      const related = expansions[token];
      if (related) {
        expanded.push(...related.slice(0, 2));
      }
    }

    return expanded.join(" ");
  }

  /**
   * Classify query intent
   */
  private classifyQueryIntent(query: string): QueryIntent {
    const lowerQuery = query.toLowerCase();

    let type: QueryIntent["type"] = "general";
    const entities: string[] = [];

    // Detect intent type
    if (/find|search|where|locate/.test(lowerQuery)) {
      type = "find_function";
    } else if (/how|what|explain|understand/.test(lowerQuery)) {
      type = "understand_code";
    } else if (/fix|bug|error|issue/.test(lowerQuery)) {
      type = "fix_bug";
    } else if (/add|implement|create|feature/.test(lowerQuery)) {
      type = "add_feature";
    } else if (/refactor|improve|optimize/.test(lowerQuery)) {
      type = "refactor";
    }

    // Extract entities (function/class names)
    const namePattern = /(?:function|class|method|interface|type)\s+`?(\w+)`?/gi;
    let match;
    while ((match = namePattern.exec(query)) !== null) {
      entities.push(match[1]);
    }

    // Also extract backtick-quoted names
    const backtickPattern = /`(\w+)`/g;
    while ((match = backtickPattern.exec(query)) !== null) {
      if (!entities.includes(match[1])) {
        entities.push(match[1]);
      }
    }

    return {
      type,
      entities,
      confidence: entities.length > 0 ? 0.8 : 0.5,
    };
  }

  /**
   * Prepare text for embedding (combines metadata with content)
   */
  private prepareTextForEmbedding(chunk: CodeChunk): string {
    const parts: string[] = [];

    if (chunk.metadata.name) {
      parts.push(`Name: ${chunk.metadata.name}`);
    }
    if (chunk.metadata.signature) {
      parts.push(`Signature: ${chunk.metadata.signature}`);
    }
    if (chunk.metadata.docstring) {
      parts.push(`Documentation: ${chunk.metadata.docstring}`);
    }

    parts.push(chunk.content);

    return parts.join("\n");
  }

  /**
   * Build filter object from QueryFilters
   */
  private buildFilter(filters?: QueryFilters): Record<string, unknown> | undefined {
    if (!filters) return undefined;

    const filter: Record<string, unknown> = {};

    if (filters.languages?.length === 1) {
      filter.language = filters.languages[0];
    }
    if (filters.chunkTypes?.length === 1) {
      filter.type = filters.chunkTypes[0];
    }

    return Object.keys(filter).length > 0 ? filter : undefined;
  }

  /**
   * Check if chunk matches filter
   */
  private matchesFilter(chunk: CodeChunk, filter: Record<string, unknown>): boolean {
    for (const [key, value] of Object.entries(filter)) {
      if (key === "language" && chunk.language !== value) return false;
      if (key === "type" && chunk.type !== value) return false;
      if (key === "filePath" && !chunk.filePath.includes(value as string)) return false;
    }
    return true;
  }

  /**
   * Find text highlights
   */
  private findHighlights(content: string, tokens: string[]): import("./types.js").TextHighlight[] {
    const highlights: import("./types.js").TextHighlight[] = [];

    for (const token of tokens) {
      const regex = new RegExp(token, "gi");
      let match;
      while ((match = regex.exec(content)) !== null) {
        highlights.push({
          start: match.index,
          end: match.index + token.length,
          text: match[0],
        });
      }
    }

    return highlights.slice(0, 10); // Limit highlights
  }

  /**
   * Remove chunks for a file
   */
  private async removeFileChunks(filePath: string): Promise<void> {
    const chunkIds = this.fileIndex.get(filePath) || [];

    for (const id of chunkIds) {
      this.chunkStore.delete(id);
      await this.vectorStore.delete(id);
    }

    this.fileIndex.delete(filePath);
  }

  /**
   * Find files to index
   */
  private async findFiles(
    rootPath: string,
    options: {
      includePatterns?: string[];
      excludePatterns?: string[];
    }
  ): Promise<string[]> {
    const files: string[] = [];
    const excludePatterns = options.excludePatterns || [];

    const walk = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(rootPath, fullPath);

        // Check exclusions
        if (this.matchesPatterns(relativePath, excludePatterns)) {
          continue;
        }

        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile()) {
          // Check if it's a code file
          const lang = detectLanguage(fullPath);
          if (lang !== "text") {
            files.push(fullPath);
          }
        }
      }
    };

    walk(rootPath);
    return files;
  }

  /**
   * Check if path matches any pattern
   */
  private matchesPatterns(filePath: string, patterns: string[]): boolean {
    for (const pattern of patterns) {
      if (this.matchesPattern(filePath, pattern)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Simple glob pattern matching
   */
  private matchesPattern(filePath: string, pattern: string): boolean {
    // Convert glob to regex
    const regex = pattern
      .replace(/\*\*/g, "<<<DOUBLESTAR>>>")
      .replace(/\*/g, "[^/]*")
      .replace(/<<<DOUBLESTAR>>>/g, ".*")
      .replace(/\?/g, ".");

    return new RegExp(`^${regex}$`).test(filePath);
  }

  /**
   * Check if content appears to be binary
   */
  private isBinaryContent(content: string): boolean {
    // Check for null bytes
    if (content.includes("\0")) return true;

    // Check ratio of printable characters
    // eslint-disable-next-line no-control-regex
    const printable = content.replace(/[\x00-\x1f\x7f-\x9f]/g, "");
    return printable.length / content.length < 0.9;
  }

  /**
   * Tokenize text
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter(t => t.length > 1);
  }

  /**
   * Estimate token count
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Save index to disk
   */
  async saveIndex(): Promise<void> {
    if (!this.config.indexPath) return;

    const dir = this.config.indexPath;
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Save chunks
    const chunks = Array.from(this.chunkStore.values()).map(chunk => ({
      ...chunk,
      embedding: undefined, // Don't save embeddings to chunk file
    }));

    fs.writeFileSync(
      path.join(dir, "chunks.json"),
      JSON.stringify(chunks),
      "utf-8"
    );

    // Save file index
    fs.writeFileSync(
      path.join(dir, "file-index.json"),
      JSON.stringify(Object.fromEntries(this.fileIndex)),
      "utf-8"
    );

    // Save stats
    fs.writeFileSync(
      path.join(dir, "stats.json"),
      JSON.stringify(this.indexStats),
      "utf-8"
    );

    // Vector store saves itself
    if (this.vectorStore instanceof InMemoryVectorStore) {
      await this.vectorStore.saveToDisk();
    }
  }

  /**
   * Load index from disk
   */
  async loadIndex(): Promise<boolean> {
    if (!this.config.indexPath) return false;

    const dir = this.config.indexPath;
    if (!fs.existsSync(dir)) return false;

    try {
      // Load chunks
      const chunksPath = path.join(dir, "chunks.json");
      if (fs.existsSync(chunksPath)) {
        const chunks = JSON.parse(fs.readFileSync(chunksPath, "utf-8"));
        for (const chunk of chunks) {
          this.chunkStore.set(chunk.id, chunk);
        }
      }

      // Load file index
      const fileIndexPath = path.join(dir, "file-index.json");
      if (fs.existsSync(fileIndexPath)) {
        const fileIndex = JSON.parse(fs.readFileSync(fileIndexPath, "utf-8"));
        this.fileIndex = new Map(Object.entries(fileIndex));
      }

      // Load stats
      const statsPath = path.join(dir, "stats.json");
      if (fs.existsSync(statsPath)) {
        this.indexStats = JSON.parse(fs.readFileSync(statsPath, "utf-8"));
        this.indexStats.lastUpdated = new Date(this.indexStats.lastUpdated);
      }

      return true;
    } catch (error) {
      console.warn("Failed to load index:", error);
      return false;
    }
  }

  /**
   * Get index statistics
   */
  getStats(): IndexStats {
    return { ...this.indexStats };
  }

  /**
   * Get a chunk by ID
   */
  getChunk(id: string): CodeChunk | undefined {
    return this.chunkStore.get(id);
  }

  /**
   * Get chunks for a file
   */
  getFileChunks(filePath: string): CodeChunk[] {
    const chunkIds = this.fileIndex.get(filePath) || [];
    return chunkIds
      .map(id => this.chunkStore.get(id))
      .filter((c): c is CodeChunk => c !== undefined);
  }

  /**
   * Clear the index
   */
  async clear(): Promise<void> {
    this.chunkStore.clear();
    this.fileIndex.clear();
    await this.vectorStore.clear();

    this.indexStats = {
      totalChunks: 0,
      totalFiles: 0,
      totalTokens: 0,
      indexSize: 0,
      lastUpdated: new Date(),
      languages: {},
      chunkTypes: {} as any,
    };
  }

  /**
   * Dispose resources
   */
  async dispose(): Promise<void> {
    if (this.vectorStore instanceof InMemoryVectorStore) {
      await this.vectorStore.dispose();
    }
  }
}

/**
 * Create a CodebaseRAG instance
 */
export function createCodebaseRAG(config: Partial<RAGConfig> = {}): CodebaseRAG {
  return new CodebaseRAG(config);
}

// Singleton instance
let codebaseRAGInstance: CodebaseRAG | null = null;

export function getCodebaseRAG(config: Partial<RAGConfig> = {}): CodebaseRAG {
  if (!codebaseRAGInstance) {
    codebaseRAGInstance = createCodebaseRAG(config);
  }
  return codebaseRAGInstance;
}

export function resetCodebaseRAG(): void {
  if (codebaseRAGInstance) {
    codebaseRAGInstance.dispose();
  }
  codebaseRAGInstance = null;
}
