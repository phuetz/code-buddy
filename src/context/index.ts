/**
 * Context module - RAG, compression, context management, and web search
 */

export * from "./codebase-map.js";
export {
  loadContext,
  formatContextForPrompt,
  formatContextSummary,
  type LoadedContext,
  type ContextFile,
} from "./context-files.js";
export * from "./context-loader.js";
export * from "./context-manager-v2.js";
export * from "./compression.js";
export * from "./enhanced-compression.js";
export * from "./cross-encoder-reranker.js";
export * from "./dependency-aware-rag.js";
export * from "./multi-path-retrieval.js";
export * from "./observation-masking.js";
export * from "./repository-map.js";
export * from "./smart-preloader.js";
export * from "./web-search-grounding.js";

// Export types from types.ts, excluding those already exported by context-manager-v2
export type {
  ConversationSummary,
  ContextWarning,
  CompressionResult,
  MessageImportance,
  ImportanceFactors,
  ImportanceWeights,
  CompressionQualityMetrics,
  SummarizationConfig,
  SlidingWindowConfig,
  KeyInformation,
  ContentType,
  ClassifiedMessage,
  EnhancedCompressionResult,
  CompressionMetrics,
  ContextArchive,
} from "./types.js";
