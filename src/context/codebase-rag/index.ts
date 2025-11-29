/**
 * Codebase RAG Module
 *
 * Semantic code search and retrieval-augmented generation for codebases.
 */

// Types
export * from "./types.js";

// Chunking
export {
  CodeChunker,
  createChunker,
  detectLanguage,
} from "./chunker.js";

// Embeddings
export {
  LocalEmbeddingProvider,
  SemanticHashEmbeddingProvider,
  CodeEmbeddingProvider,
  createEmbeddingProvider,
  cosineSimilarity,
} from "./embeddings.js";

// Vector Store
export {
  InMemoryVectorStore,
  PartitionedVectorStore,
  createVectorStore,
} from "./vector-store.js";

// Main RAG System
export {
  CodebaseRAG,
  createCodebaseRAG,
  getCodebaseRAG,
  resetCodebaseRAG,
} from "./codebase-rag.js";
