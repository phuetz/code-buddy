/**
 * Codebase RAG Types
 *
 * Types for the Retrieval-Augmented Generation system for codebases.
 * Based on research from:
 * - Corrective RAG (CRAG, 2024)
 * - RAG for Large Scale Code Repos (Qodo)
 * - RAG Comprehensive Survey (arXiv 2506.00054)
 */

/**
 * A chunk of code or documentation
 */
export interface CodeChunk {
  id: string;
  content: string;
  filePath: string;
  startLine: number;
  endLine: number;
  type: ChunkType;
  language: string;
  metadata: ChunkMetadata;
  embedding?: number[];
}

/**
 * Type of code chunk
 */
export type ChunkType =
  | "function"
  | "class"
  | "method"
  | "interface"
  | "type"
  | "constant"
  | "import"
  | "export"
  | "comment"
  | "documentation"
  | "config"
  | "test"
  | "file_header"
  | "code_block"
  | "unknown";

/**
 * Metadata for a code chunk
 */
export interface ChunkMetadata {
  name?: string;              // Function/class/variable name
  signature?: string;         // Function signature
  docstring?: string;         // Associated documentation
  imports?: string[];         // Dependencies
  exports?: string[];         // What this exports
  references?: string[];      // What it references
  calledBy?: string[];        // Functions that call this
  calls?: string[];           // Functions this calls
  complexity?: number;        // Cyclomatic complexity estimate
  isPublic?: boolean;         // Public API or internal
  isAsync?: boolean;          // Async function
  parameters?: ParameterInfo[];
  returnType?: string;
  tags?: string[];            // Custom tags
}

/**
 * Parameter information
 */
export interface ParameterInfo {
  name: string;
  type?: string;
  optional?: boolean;
  defaultValue?: string;
  description?: string;
}

/**
 * Result from retrieval
 */
export interface RetrievalResult {
  chunks: ScoredChunk[];
  query: string;
  totalChunks: number;
  retrievalTime: number;
  strategy: RetrievalStrategy;
}

/**
 * A chunk with relevance score
 */
export interface ScoredChunk {
  chunk: CodeChunk;
  score: number;
  matchType: "semantic" | "keyword" | "hybrid";
  highlights?: TextHighlight[];
}

/**
 * Text highlight for matching segments
 */
export interface TextHighlight {
  start: number;
  end: number;
  text: string;
}

/**
 * Retrieval strategy
 */
export type RetrievalStrategy =
  | "semantic"       // Pure embedding similarity
  | "keyword"        // BM25/TF-IDF
  | "hybrid"         // Combination of both
  | "reranked"       // Semantic + LLM reranking
  | "corrective";    // CRAG with correction

/**
 * Configuration for the RAG system
 */
export interface RAGConfig {
  // Chunking settings
  chunkSize: number;           // Target tokens per chunk
  chunkOverlap: number;        // Overlap between chunks
  respectBoundaries: boolean;  // Don't split functions/classes

  // Retrieval settings
  topK: number;                // Number of chunks to retrieve
  minScore: number;            // Minimum relevance score
  strategy: RetrievalStrategy;

  // Embedding settings
  embeddingModel: string;      // Model for embeddings
  embeddingDimension: number;  // Embedding vector size

  // Index settings
  indexPath?: string;          // Where to store index
  autoUpdate: boolean;         // Update on file changes
  excludePatterns: string[];   // Files to exclude

  // Reranking settings
  useReranking: boolean;       // Enable LLM reranking
  rerankTopK?: number;         // Rerank top N results
}

/**
 * Default RAG configuration
 */
export const DEFAULT_RAG_CONFIG: RAGConfig = {
  chunkSize: 512,
  chunkOverlap: 64,
  respectBoundaries: true,
  topK: 10,
  minScore: 0.5,
  strategy: "hybrid",
  embeddingModel: "default",
  embeddingDimension: 384,
  autoUpdate: true,
  excludePatterns: [
    "node_modules/**",
    ".git/**",
    "dist/**",
    "build/**",
    "*.min.js",
    "*.map",
    "package-lock.json",
    "yarn.lock",
    "bun.lockb",
  ],
  useReranking: false,
};

/**
 * Index statistics
 */
export interface IndexStats {
  totalChunks: number;
  totalFiles: number;
  totalTokens: number;
  indexSize: number;
  lastUpdated: Date;
  languages: Record<string, number>;
  chunkTypes: Partial<Record<ChunkType, number>>;
}

/**
 * File indexing result
 */
export interface FileIndexResult {
  filePath: string;
  chunks: CodeChunk[];
  success: boolean;
  error?: string;
  processingTime: number;
}

/**
 * Query context for retrieval
 */
export interface QueryContext {
  query: string;
  intent?: QueryIntent;
  filters?: QueryFilters;
  previousResults?: ScoredChunk[];
}

/**
 * Query intent classification
 */
export interface QueryIntent {
  type: "find_function" | "understand_code" | "fix_bug" | "add_feature" | "refactor" | "general";
  entities: string[];        // Mentioned entities (function names, etc.)
  fileTypes?: string[];      // Specific file types
  confidence: number;
}

/**
 * Filters for query
 */
export interface QueryFilters {
  filePatterns?: string[];   // Glob patterns for files
  chunkTypes?: ChunkType[];  // Types of chunks to include
  languages?: string[];      // Programming languages
  minComplexity?: number;
  maxComplexity?: number;
  isPublic?: boolean;
  tags?: string[];
}

/**
 * Corrective RAG evaluation result
 */
export interface CRAGEvaluation {
  isRelevant: boolean;
  confidence: number;
  action: "accept" | "refine" | "web_search" | "reject";
  refinedQuery?: string;
  feedback?: string;
}

/**
 * Embedding provider interface
 */
export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  getDimension(): number;
  getModelName(): string;
}

/**
 * Vector store interface
 */
export interface VectorStore {
  add(id: string, embedding: number[], metadata?: Record<string, unknown>): Promise<void>;
  addBatch(items: Array<{ id: string; embedding: number[]; metadata?: Record<string, unknown> }>): Promise<void>;
  search(embedding: number[], k: number, filter?: Record<string, unknown>): Promise<Array<{ id: string; score: number }>>;
  delete(id: string): Promise<void>;
  deleteByFilter(filter: Record<string, unknown>): Promise<number>;
  count(): Promise<number>;
  clear(): Promise<void>;
}

/**
 * Language parser interface
 */
export interface LanguageParser {
  parse(content: string, filePath: string): ParseResult;
  getSupportedLanguages(): string[];
  getLanguageForFile(filePath: string): string | null;
}

/**
 * Parse result from language parser
 */
export interface ParseResult {
  chunks: Omit<CodeChunk, "id" | "embedding">[];
  symbols: SymbolInfo[];
  imports: ImportInfo[];
  exports: ExportInfo[];
}

/**
 * Symbol information
 */
export interface SymbolInfo {
  name: string;
  type: ChunkType;
  startLine: number;
  endLine: number;
  signature?: string;
  docstring?: string;
}

/**
 * Import information
 */
export interface ImportInfo {
  module: string;
  symbols: string[];
  isDefault: boolean;
  line: number;
}

/**
 * Export information
 */
export interface ExportInfo {
  name: string;
  isDefault: boolean;
  type: ChunkType;
  line: number;
}
