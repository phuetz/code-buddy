/**
 * Code Intelligence Types
 *
 * Shared types for AST parsing, symbol search, dependency analysis,
 * code context, and refactoring operations.
 */

/**
 * Supported programming languages
 */
export type SupportedLanguage =
  | "typescript"
  | "javascript"
  | "python"
  | "go"
  | "rust"
  | "java"
  | "c"
  | "cpp"
  | "unknown";

/**
 * Symbol types that can be extracted from code
 */
export type SymbolType =
  | "function"
  | "class"
  | "interface"
  | "type"
  | "variable"
  | "constant"
  | "enum"
  | "method"
  | "property"
  | "parameter"
  | "import"
  | "export"
  | "namespace"
  | "module";

/**
 * Symbol visibility/accessibility
 */
export type SymbolVisibility = "public" | "private" | "protected" | "internal";

/**
 * Symbol scope
 */
export type SymbolScope = "global" | "module" | "class" | "function" | "block";

/**
 * Position in source code
 */
export interface SourcePosition {
  line: number;
  column: number;
  offset?: number;
}

/**
 * Range in source code
 */
export interface SourceRange {
  start: SourcePosition;
  end: SourcePosition;
}

/**
 * A code symbol extracted from AST
 */
export interface CodeSymbol {
  id: string;
  name: string;
  type: SymbolType;
  language: SupportedLanguage;
  filePath: string;
  range: SourceRange;
  visibility: SymbolVisibility;
  scope: SymbolScope;
  signature?: string;
  documentation?: string;
  parentId?: string;
  children?: string[];
  parameters?: ParameterInfo[];
  returnType?: string;
  modifiers?: string[];
  decorators?: string[];
  metadata: Record<string, unknown>;
}

/**
 * Parameter information
 */
export interface ParameterInfo {
  name: string;
  type?: string;
  defaultValue?: string;
  isOptional: boolean;
  isRest: boolean;
}

/**
 * Import information
 */
export interface ImportInfo {
  source: string;
  specifiers: ImportSpecifier[];
  isTypeOnly: boolean;
  isDynamic: boolean;
  range: SourceRange;
}

/**
 * Import specifier
 */
export interface ImportSpecifier {
  name: string;
  alias?: string;
  isDefault: boolean;
  isNamespace: boolean;
}

/**
 * Export information
 */
export interface ExportInfo {
  name: string;
  localName?: string;
  isDefault: boolean;
  isReExport: boolean;
  source?: string;
  range: SourceRange;
}

/**
 * AST parsing result
 */
export interface ASTParseResult {
  filePath: string;
  language: SupportedLanguage;
  symbols: CodeSymbol[];
  imports: ImportInfo[];
  exports: ExportInfo[];
  errors: ParseError[];
  parseTime: number;
  metadata: {
    lineCount: number;
    hasErrors: boolean;
    complexity?: number;
  };
}

/**
 * Parse error
 */
export interface ParseError {
  message: string;
  range?: SourceRange;
  severity: "error" | "warning";
}

/**
 * Symbol search options
 */
export interface SymbolSearchOptions {
  query: string;
  types?: SymbolType[];
  scopes?: SymbolScope[];
  languages?: SupportedLanguage[];
  filePaths?: string[];
  excludePaths?: string[];
  caseSensitive?: boolean;
  fuzzy?: boolean;
  maxResults?: number;
  includeUsages?: boolean;
}

/**
 * Symbol search result
 */
export interface SymbolSearchResult {
  symbol: CodeSymbol;
  score: number;
  matches?: SearchMatch[];
  usages?: SymbolUsage[];
}

/**
 * Search match details
 */
export interface SearchMatch {
  key: string;
  indices: [number, number][];
  value: string;
}

/**
 * Symbol usage location
 */
export interface SymbolUsage {
  filePath: string;
  range: SourceRange;
  type: "definition" | "reference" | "call" | "import" | "export";
  context?: string;
}

/**
 * Dependency information
 */
export interface DependencyInfo {
  source: string;
  target: string;
  type: "import" | "export" | "reexport" | "dynamic";
  specifiers: string[];
  isCircular?: boolean;
}

/**
 * Dependency graph
 */
export interface DependencyGraph {
  nodes: Map<string, DependencyNode>;
  edges: DependencyEdge[];
  circularDependencies: CircularDependency[];
  unreachableFiles: string[];
  entryPoints: string[];
  stats: DependencyStats;
}

/**
 * Dependency node
 */
export interface DependencyNode {
  filePath: string;
  imports: string[];
  exports: string[];
  dependencies: string[];
  dependents: string[];
  depth: number;
  isEntryPoint: boolean;
}

/**
 * Dependency edge
 */
export interface DependencyEdge {
  source: string;
  target: string;
  type: "internal" | "external" | "builtin";
  weight: number;
}

/**
 * Circular dependency
 */
export interface CircularDependency {
  cycle: string[];
  type: "direct" | "indirect";
  severity: "low" | "medium" | "high";
}

/**
 * Dependency statistics
 */
export interface DependencyStats {
  totalFiles: number;
  totalDependencies: number;
  averageDependencies: number;
  maxDepth: number;
  circularCount: number;
  externalDependencies: number;
}

/**
 * Code context information
 */
export interface CodeContext {
  filePath: string;
  language: SupportedLanguage;
  symbols: ContextualSymbol[];
  dependencies: ContextualDependency[];
  relationships: CodeRelationship[];
  semantics: SemanticContext;
  quality: QualityMetrics;
}

/**
 * Contextual symbol with enriched information
 */
export interface ContextualSymbol extends CodeSymbol {
  relatedSymbols: string[];
  usageCount: number;
  complexity?: number;
  semanticTags: string[];
}

/**
 * Contextual dependency
 */
export interface ContextualDependency {
  source: string;
  type: "internal" | "external" | "builtin";
  symbols: string[];
  isCircular: boolean;
  importance: number;
}

/**
 * Code relationship
 */
export interface CodeRelationship {
  sourceId: string;
  targetId: string;
  type: "inherits" | "implements" | "uses" | "calls" | "composes" | "depends";
  strength: number;
}

/**
 * Semantic context
 */
export interface SemanticContext {
  purpose: string;
  domain: string[];
  patterns: DetectedPattern[];
  tags: string[];
}

/**
 * Detected design pattern
 */
export interface DetectedPattern {
  name: string;
  confidence: number;
  locations: string[];
}

/**
 * Quality metrics
 */
export interface QualityMetrics {
  complexity: {
    cyclomatic: number;
    cognitive: number;
  };
  maintainability: number;
  linesOfCode: number;
  commentRatio: number;
  technicalDebt: number;
  scores: {
    maintainability: number;
    readability: number;
    testability: number;
    reusability: number;
  };
}

/**
 * Refactoring operation types
 */
export type RefactoringType =
  | "rename"
  | "extractFunction"
  | "extractVariable"
  | "extractInterface"
  | "inlineFunction"
  | "inlineVariable"
  | "moveToFile"
  | "changeSignature";

/**
 * Refactoring request
 */
export interface RefactoringRequest {
  type: RefactoringType;
  filePath: string;
  range?: SourceRange;
  symbolId?: string;
  newName?: string;
  targetPath?: string;
  options?: Record<string, unknown>;
}

/**
 * Refactoring result
 */
export interface RefactoringResult {
  success: boolean;
  type: RefactoringType;
  changes: FileChange[];
  preview?: string;
  safetyAnalysis: SafetyAnalysis;
  error?: string;
}

/**
 * File change
 */
export interface FileChange {
  filePath: string;
  type: "create" | "modify" | "delete" | "rename";
  originalContent?: string;
  newContent?: string;
  edits?: TextEdit[];
}

/**
 * Text edit
 */
export interface TextEdit {
  range: SourceRange;
  newText: string;
}

/**
 * Safety analysis for refactoring
 */
export interface SafetyAnalysis {
  riskLevel: "low" | "medium" | "high";
  affectedFiles: number;
  affectedSymbols: number;
  breakingChanges: string[];
  warnings: string[];
  requiresTests: boolean;
}

/**
 * Index cache entry
 */
export interface IndexCacheEntry<T> {
  data: T;
  timestamp: number;
  filePath: string;
  checksum?: string;
}
