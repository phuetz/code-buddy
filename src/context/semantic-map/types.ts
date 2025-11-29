/**
 * Codebase Semantic Map Types
 *
 * Defines types for building and querying a semantic understanding
 * of a codebase including structure, relationships, and concepts.
 *
 * Based on research:
 * - Program comprehension
 * - Code knowledge graphs
 * - Software architecture recovery
 */

/**
 * Types of code elements
 */
export type CodeElementType =
  | "file"
  | "directory"
  | "module"
  | "class"
  | "interface"
  | "type"
  | "function"
  | "method"
  | "variable"
  | "constant"
  | "enum"
  | "import"
  | "export"
  | "component"
  | "hook"
  | "test"
  | "config";

/**
 * A code element in the semantic map
 */
export interface CodeElement {
  id: string;
  type: CodeElementType;
  name: string;
  qualifiedName: string; // Full path/name
  filePath: string;
  location: ElementLocation;
  description?: string;
  language: string;
  visibility: "public" | "private" | "protected" | "internal";
  metadata: Record<string, unknown>;
  signature?: string; // For functions/methods
  docstring?: string;
}

/**
 * Location of an element in source code
 */
export interface ElementLocation {
  startLine: number;
  endLine: number;
  startColumn?: number;
  endColumn?: number;
}

/**
 * Types of relationships between code elements
 */
export type RelationshipType =
  | "imports"           // A imports B
  | "exports"           // A exports B
  | "calls"             // A calls B
  | "implements"        // A implements interface B
  | "extends"           // A extends B
  | "uses"              // A uses type/variable B
  | "defines"           // A defines B
  | "contains"          // A contains B (directory/file)
  | "tests"             // A tests B
  | "depends_on"        // A depends on B
  | "similar_to"        // A is semantically similar to B
  | "overrides"         // A overrides B
  | "references"        // A references B
  | "instantiates";     // A instantiates class B

/**
 * A relationship between two code elements
 */
export interface CodeRelationship {
  id: string;
  type: RelationshipType;
  sourceId: string;
  targetId: string;
  strength: number; // 0-1, how strong the relationship is
  metadata: Record<string, unknown>;
}

/**
 * A semantic cluster of related elements
 */
export interface SemanticCluster {
  id: string;
  name: string;
  description: string;
  category: ClusterCategory;
  elements: string[]; // Element IDs
  centroid?: number[]; // Semantic centroid
  coherence: number; // 0-1, how coherent the cluster is
  keywords: string[];
}

/**
 * Categories for semantic clusters
 */
export type ClusterCategory =
  | "feature"          // A user-facing feature
  | "module"           // A logical module
  | "layer"            // An architectural layer
  | "utility"          // Utility/helper code
  | "data_model"       // Data models/types
  | "api"              // API endpoints
  | "ui"               // User interface
  | "business_logic"   // Core business logic
  | "infrastructure"   // Infrastructure code
  | "testing"          // Test code
  | "configuration"    // Configuration
  | "unknown";

/**
 * Architectural layer
 */
export interface ArchitecturalLayer {
  id: string;
  name: string;
  description: string;
  level: number; // Higher = more abstract
  elements: string[];
  dependencies: string[]; // Other layer IDs
}

/**
 * A concept or topic in the codebase
 */
export interface CodeConcept {
  id: string;
  name: string;
  description: string;
  keywords: string[];
  relatedElements: string[];
  frequency: number; // How often it appears
  importance: number; // 0-1
}

/**
 * The complete semantic map of a codebase
 */
export interface SemanticMap {
  id: string;
  rootPath: string;
  createdAt: Date;
  updatedAt: Date;
  elements: Map<string, CodeElement>;
  relationships: Map<string, CodeRelationship>;
  clusters: Map<string, SemanticCluster>;
  layers: ArchitecturalLayer[];
  concepts: Map<string, CodeConcept>;
  stats: MapStatistics;
  metadata: Record<string, unknown>;
}

/**
 * Statistics about the semantic map
 */
export interface MapStatistics {
  totalFiles: number;
  totalElements: number;
  totalRelationships: number;
  totalClusters: number;
  elementsByType: Map<CodeElementType, number>;
  relationshipsByType: Map<RelationshipType, number>;
  averageClusterSize: number;
  coveragePercent: number;
}

/**
 * Configuration for building the semantic map
 */
export interface SemanticMapConfig {
  includePaths: string[];
  excludePaths: string[];
  languages: string[];
  analyzeImports: boolean;
  analyzeCalls: boolean;
  analyzeTypes: boolean;
  buildClusters: boolean;
  minClusterSize: number;
  maxClusterCount: number;
  similarityThreshold: number;
  useEmbeddings: boolean;
  cacheEnabled: boolean;
}

/**
 * Default configuration
 */
export const DEFAULT_MAP_CONFIG: SemanticMapConfig = {
  includePaths: ["."],
  excludePaths: ["node_modules", "dist", "build", ".git", "coverage"],
  languages: ["typescript", "javascript", "python", "go", "rust", "java"],
  analyzeImports: true,
  analyzeCalls: true,
  analyzeTypes: true,
  buildClusters: true,
  minClusterSize: 3,
  maxClusterCount: 50,
  similarityThreshold: 0.3,
  useEmbeddings: false,
  cacheEnabled: true,
};

/**
 * Query for searching the semantic map
 */
export interface SemanticQuery {
  text?: string;
  elementTypes?: CodeElementType[];
  relationshipTypes?: RelationshipType[];
  clusters?: string[];
  concepts?: string[];
  filePaths?: string[];
  maxResults?: number;
  includeRelated?: boolean;
  relatedDepth?: number;
}

/**
 * Result of a semantic query
 */
export interface SemanticQueryResult {
  elements: CodeElement[];
  relationships: CodeRelationship[];
  clusters: SemanticCluster[];
  concepts: CodeConcept[];
  relevanceScores: Map<string, number>;
  queryTime: number;
}

/**
 * Impact analysis result
 */
export interface ImpactAnalysis {
  changedElement: CodeElement;
  directlyAffected: CodeElement[];
  transitivelyAffected: CodeElement[];
  affectedTests: CodeElement[];
  riskLevel: "low" | "medium" | "high" | "critical";
  recommendations: string[];
}

/**
 * Navigation suggestion
 */
export interface NavigationSuggestion {
  from: CodeElement;
  to: CodeElement;
  reason: string;
  relevance: number;
  relationship?: RelationshipType;
}

/**
 * Events emitted during map building
 */
export interface MapBuildingEvents {
  "map:start": { config: SemanticMapConfig };
  "map:file": { path: string; elements: number };
  "map:relationships": { count: number };
  "map:clusters": { count: number };
  "map:complete": { stats: MapStatistics };
  "map:error": { error: string; path?: string };
}

/**
 * Function for reading files
 */
export type FileReader = (path: string) => Promise<string>;

/**
 * Function for listing files
 */
export type FileLister = (pattern: string) => Promise<string[]>;

/**
 * AST node (simplified)
 */
export interface ASTNode {
  type: string;
  name?: string;
  start: number;
  end: number;
  children?: ASTNode[];
  properties?: Record<string, unknown>;
}
