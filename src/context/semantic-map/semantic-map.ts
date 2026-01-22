/**
 * Codebase Semantic Map
 *
 * Builds and maintains a semantic understanding of a codebase
 * including structure, relationships, and concepts.
 *
 * Features:
 * - Code element extraction
 * - Relationship analysis
 * - Semantic clustering
 * - Impact analysis
 * - Intelligent navigation
 *
 * This module re-exports from the modular structure for backwards compatibility.
 */

// Re-export all types
export * from "./types.js";

// Re-export language patterns
export { LANGUAGE_PATTERNS } from "./patterns.js";

// Re-export formatter
export { formatMap } from "./formatter.js";

// Re-export builder and singleton
export {
  SemanticMapBuilder,
  createSemanticMapBuilder,
  getSemanticMapBuilder,
  resetSemanticMapBuilder,
} from "./builder.js";
