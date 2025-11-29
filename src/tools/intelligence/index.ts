/**
 * Code Intelligence Module
 *
 * Exports all code intelligence tools including:
 * - AST Parser
 * - Symbol Search
 * - Dependency Analyzer
 * - Code Context Builder
 * - Refactoring Assistant
 */

// Types
export * from "./types.js";

// AST Parser
export {
  ASTParser,
  createASTParser,
  getASTParser,
  resetASTParser,
} from "./ast-parser.js";

// Symbol Search
export {
  SymbolSearch,
  createSymbolSearch,
  getSymbolSearch,
  resetSymbolSearch,
} from "./symbol-search.js";

// Dependency Analyzer
export {
  DependencyAnalyzer,
  DependencyAnalyzerConfig,
  DependencyAnalysisResult,
  createDependencyAnalyzer,
  getDependencyAnalyzer,
  resetDependencyAnalyzer,
} from "./dependency-analyzer.js";

// Code Context
export {
  CodeContextBuilder,
  createCodeContextBuilder,
  getCodeContextBuilder,
  resetCodeContextBuilder,
} from "./code-context.js";

// Refactoring Assistant
export {
  RefactoringAssistant,
  createRefactoringAssistant,
  getRefactoringAssistant,
  resetRefactoringAssistant,
} from "./refactoring-assistant.js";
