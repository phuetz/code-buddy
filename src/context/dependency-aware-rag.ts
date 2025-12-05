/**
 * Dependency-Aware RAG System
 *
 * Enhanced RAG that integrates dependency graph analysis for better context retrieval.
 * Based on CodeRAG research for repo-level code generation.
 *
 * Key improvements:
 * - Dependency-aware retrieval: when finding code, also retrieve dependencies
 * - Call graph context: understand caller/callee relationships
 * - Import chain resolution: follow import paths for complete context
 * - Smart context expansion: prioritize relevant connected code
 *
 * Research basis:
 * - CodeRAG (2024): Repository-level code generation with dependency graphs
 * - CRAG (2024): Corrective RAG for knowledge-intensive tasks
 */

import { EventEmitter } from 'events';
import * as path from 'path';
import { CodebaseRAG, getCodebaseRAG } from './codebase-rag/codebase-rag.js';
import { DependencyAnalyzer, getDependencyAnalyzer, DependencyAnalysisResult } from '../tools/intelligence/dependency-analyzer.js';
import { ScoredChunk, CodeChunk, RetrievalResult } from './codebase-rag/types.js';
import { DependencyNode } from '../tools/intelligence/types.js';

/**
 * Configuration for dependency-aware RAG
 */
export interface DependencyRAGConfig {
  // How many levels of dependencies to include (0 = none, 1 = direct, 2+ = transitive)
  dependencyDepth: number;
  // How many levels of dependents to include
  dependentDepth: number;
  // Maximum number of dependency files to include
  maxDependencyFiles: number;
  // Maximum tokens for dependency context
  maxDependencyTokens: number;
  // Weight for dependency relevance score (0-1)
  dependencyWeight: number;
  // Whether to include import/export information
  includeImportExports: boolean;
  // Whether to analyze call graph
  analyzeCallGraph: boolean;
  // Cache TTL in milliseconds
  cacheTTL: number;
}

const DEFAULT_CONFIG: DependencyRAGConfig = {
  dependencyDepth: 2,
  dependentDepth: 1,
  maxDependencyFiles: 10,
  maxDependencyTokens: 4000,
  dependencyWeight: 0.3,
  includeImportExports: true,
  analyzeCallGraph: true,
  cacheTTL: 5 * 60 * 1000, // 5 minutes
};

/**
 * Extended retrieval result with dependency information
 */
export interface DependencyAwareResult extends RetrievalResult {
  // Dependencies of the retrieved chunks
  dependencies: DependencyContext[];
  // Files that depend on the retrieved chunks
  dependents: DependencyContext[];
  // Dependency graph statistics
  graphStats: {
    filesAnalyzed: number;
    totalDependencies: number;
    dependencyDepth: number;
  };
}

/**
 * Dependency context information
 */
export interface DependencyContext {
  filePath: string;
  relativePath: string;
  imports: string[];
  exports: string[];
  relevanceScore: number;
  // Summary of the file's purpose
  summary?: string;
  // Key chunks from the file
  keyChunks: CodeChunk[];
  // Relationship to the query
  relationship: 'imports' | 'imported_by' | 'calls' | 'called_by' | 'related';
}

/**
 * Cache entry for dependency analysis
 */
interface CacheEntry {
  result: DependencyAnalysisResult;
  timestamp: number;
}

/**
 * Dependency-Aware RAG class
 */
export class DependencyAwareRAG extends EventEmitter {
  private config: DependencyRAGConfig;
  private baseRAG: CodebaseRAG;
  private depAnalyzer: DependencyAnalyzer;
  private analysisCache: Map<string, CacheEntry> = new Map();
  private isInitialized: boolean = false;
  private currentAnalysis: DependencyAnalysisResult | null = null;

  constructor(config: Partial<DependencyRAGConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.baseRAG = getCodebaseRAG();
    this.depAnalyzer = getDependencyAnalyzer();
  }

  /**
   * Initialize the dependency-aware RAG system
   */
  async initialize(rootPath: string): Promise<void> {
    if (this.isInitialized) return;

    this.emit('init:start', { rootPath });

    try {
      // Check cache first
      const cached = this.analysisCache.get(rootPath);
      if (cached && Date.now() - cached.timestamp < this.config.cacheTTL) {
        this.currentAnalysis = cached.result;
        this.emit('init:cache_hit', { rootPath });
      } else {
        // Run dependency analysis
        this.emit('init:analyzing_dependencies', { rootPath });
        this.currentAnalysis = await this.depAnalyzer.analyze(rootPath);

        // Cache the result
        this.analysisCache.set(rootPath, {
          result: this.currentAnalysis,
          timestamp: Date.now(),
        });
      }

      this.isInitialized = true;
      this.emit('init:complete', {
        files: this.currentAnalysis.stats.totalFiles,
        dependencies: this.currentAnalysis.stats.totalDependencies,
      });
    } catch (error) {
      this.emit('init:error', { error });
      // Continue without dependency analysis
      this.currentAnalysis = null;
      this.isInitialized = true;
    }
  }

  /**
   * Retrieve code with dependency-aware context
   */
  async retrieve(
    query: string,
    rootPath: string,
    options: {
      topK?: number;
      minScore?: number;
      includeDependencies?: boolean;
      includeDependents?: boolean;
      filters?: {
        languages?: string[];
        filePatterns?: string[];
      };
    } = {}
  ): Promise<DependencyAwareResult> {
    const startTime = Date.now();

    // Ensure initialized
    await this.initialize(rootPath);

    // Get base retrieval results
    const baseResult = await this.baseRAG.retrieve(query, {
      topK: options.topK || 10,
      minScore: options.minScore || 0.3,
      strategy: 'hybrid',
      filters: {
        languages: options.filters?.languages,
      },
    });

    // If no dependency analysis available, return base results
    if (!this.currentAnalysis || (!options.includeDependencies && !options.includeDependents)) {
      return {
        ...baseResult,
        dependencies: [],
        dependents: [],
        graphStats: {
          filesAnalyzed: 0,
          totalDependencies: 0,
          dependencyDepth: 0,
        },
      };
    }

    // Extract unique files from results
    const resultFiles = new Set<string>();
    for (const chunk of baseResult.chunks) {
      resultFiles.add(chunk.chunk.filePath);
    }

    // Find dependencies and dependents
    const dependencies: DependencyContext[] = [];
    const dependents: DependencyContext[] = [];

    if (options.includeDependencies !== false) {
      const deps = await this.findDependencies(
        Array.from(resultFiles),
        this.config.dependencyDepth
      );
      dependencies.push(...deps);
    }

    if (options.includeDependents !== false) {
      const deps = await this.findDependents(
        Array.from(resultFiles),
        this.config.dependentDepth
      );
      dependents.push(...deps);
    }

    // Score and rank dependency contexts
    this.scoreDependencyContexts(query, dependencies);
    this.scoreDependencyContexts(query, dependents);

    // Sort by relevance score
    dependencies.sort((a, b) => b.relevanceScore - a.relevanceScore);
    dependents.sort((a, b) => b.relevanceScore - a.relevanceScore);

    // Limit to max files
    const limitedDeps = dependencies.slice(0, this.config.maxDependencyFiles);
    const limitedDependents = dependents.slice(0, this.config.maxDependencyFiles);

    // Re-rank base results incorporating dependency information
    const rerankedChunks = this.reRankWithDependencies(
      baseResult.chunks,
      limitedDeps,
      limitedDependents
    );

    return {
      ...baseResult,
      chunks: rerankedChunks,
      dependencies: limitedDeps,
      dependents: limitedDependents,
      retrievalTime: Date.now() - startTime,
      graphStats: {
        filesAnalyzed: this.currentAnalysis.stats.totalFiles,
        totalDependencies: this.currentAnalysis.stats.totalDependencies,
        dependencyDepth: this.config.dependencyDepth,
      },
    };
  }

  /**
   * Find dependencies of given files
   */
  private async findDependencies(
    files: string[],
    depth: number
  ): Promise<DependencyContext[]> {
    if (!this.currentAnalysis || depth <= 0) return [];

    const visited = new Set<string>(files);
    const queue: Array<{ file: string; depth: number }> = files.map(f => ({ file: f, depth: 0 }));
    const results: DependencyContext[] = [];

    while (queue.length > 0) {
      const { file, depth: currentDepth } = queue.shift()!;

      if (currentDepth >= depth) continue;

      const node = this.currentAnalysis.graph.nodes.get(file);
      if (!node) continue;

      for (const dep of node.dependencies) {
        if (visited.has(dep)) continue;
        visited.add(dep);

        const depNode = this.currentAnalysis.graph.nodes.get(dep);
        if (!depNode) continue;

        const context = await this.buildDependencyContext(depNode, 'imports');
        results.push(context);

        // Add to queue for deeper traversal
        queue.push({ file: dep, depth: currentDepth + 1 });
      }
    }

    return results;
  }

  /**
   * Find dependents of given files (files that import them)
   */
  private async findDependents(
    files: string[],
    depth: number
  ): Promise<DependencyContext[]> {
    if (!this.currentAnalysis || depth <= 0) return [];

    const visited = new Set<string>(files);
    const queue: Array<{ file: string; depth: number }> = files.map(f => ({ file: f, depth: 0 }));
    const results: DependencyContext[] = [];

    while (queue.length > 0) {
      const { file, depth: currentDepth } = queue.shift()!;

      if (currentDepth >= depth) continue;

      const node = this.currentAnalysis.graph.nodes.get(file);
      if (!node) continue;

      for (const dependent of node.dependents) {
        if (visited.has(dependent)) continue;
        visited.add(dependent);

        const depNode = this.currentAnalysis.graph.nodes.get(dependent);
        if (!depNode) continue;

        const context = await this.buildDependencyContext(depNode, 'imported_by');
        results.push(context);

        // Add to queue for deeper traversal
        queue.push({ file: dependent, depth: currentDepth + 1 });
      }
    }

    return results;
  }

  /**
   * Build dependency context for a file
   */
  private async buildDependencyContext(
    node: DependencyNode,
    relationship: DependencyContext['relationship']
  ): Promise<DependencyContext> {
    // Get chunks from the RAG for this file
    const chunks = this.baseRAG.getFileChunks(node.filePath);

    // Select key chunks (functions, classes, exports)
    const keyChunks = chunks.filter(c =>
      c.type === 'function' || c.type === 'class' || c.type === 'export'
    ).slice(0, 3);

    // Generate file summary
    const summary = this.generateFileSummary(node, chunks);

    return {
      filePath: node.filePath,
      relativePath: path.basename(node.filePath),
      imports: node.imports,
      exports: node.exports,
      relevanceScore: 0, // Will be set by scoreDependencyContexts
      summary,
      keyChunks,
      relationship,
    };
  }

  /**
   * Generate a summary of a file based on its node and chunks
   */
  private generateFileSummary(node: DependencyNode, chunks: CodeChunk[]): string {
    const parts: string[] = [];

    // File type and language (ext reserved for future language-specific handling)
    const _ext = path.extname(node.filePath);
    parts.push(`File: ${path.basename(node.filePath)}`);

    // Exports summary
    if (node.exports.length > 0) {
      const exportList = node.exports.slice(0, 5).join(', ');
      parts.push(`Exports: ${exportList}${node.exports.length > 5 ? '...' : ''}`);
    }

    // Key symbols
    const symbols = chunks
      .filter(c => c.metadata.name)
      .map(c => c.metadata.name)
      .slice(0, 5);
    if (symbols.length > 0) {
      parts.push(`Defines: ${symbols.join(', ')}`);
    }

    return parts.join(' | ');
  }

  /**
   * Score dependency contexts based on query relevance
   */
  private scoreDependencyContexts(query: string, contexts: DependencyContext[]): void {
    const queryTokens = this.tokenize(query.toLowerCase());

    for (const ctx of contexts) {
      let score = 0;

      // Score based on file name match
      const fileName = path.basename(ctx.filePath).toLowerCase();
      for (const token of queryTokens) {
        if (fileName.includes(token)) {
          score += 2;
        }
      }

      // Score based on export matches
      for (const exp of ctx.exports) {
        const expLower = exp.toLowerCase();
        for (const token of queryTokens) {
          if (expLower.includes(token)) {
            score += 1.5;
          }
        }
      }

      // Score based on key chunk content
      for (const chunk of ctx.keyChunks) {
        const content = chunk.content.toLowerCase();
        for (const token of queryTokens) {
          if (content.includes(token)) {
            score += 0.5;
          }
        }

        // Bonus for name match
        if (chunk.metadata.name) {
          const name = chunk.metadata.name.toLowerCase();
          for (const token of queryTokens) {
            if (name.includes(token)) {
              score += 2;
            }
          }
        }
      }

      // Normalize score
      ctx.relevanceScore = Math.min(score / queryTokens.length, 1);
    }
  }

  /**
   * Re-rank chunks incorporating dependency information
   */
  private reRankWithDependencies(
    chunks: ScoredChunk[],
    dependencies: DependencyContext[],
    dependents: DependencyContext[]
  ): ScoredChunk[] {
    // Create a map of file -> dependency relevance
    const depScores = new Map<string, number>();

    for (const dep of dependencies) {
      depScores.set(dep.filePath, dep.relevanceScore);
    }
    for (const dep of dependents) {
      const existing = depScores.get(dep.filePath) || 0;
      depScores.set(dep.filePath, Math.max(existing, dep.relevanceScore));
    }

    // Boost scores for chunks from files with high dependency relevance
    const reranked = chunks.map(chunk => {
      const depScore = depScores.get(chunk.chunk.filePath) || 0;
      const boostedScore = chunk.score * (1 - this.config.dependencyWeight) +
        depScore * this.config.dependencyWeight;

      return {
        ...chunk,
        score: boostedScore,
      };
    });

    // Sort by new score
    return reranked.sort((a, b) => b.score - a.score);
  }

  /**
   * Get expanded context for a specific file
   */
  async getExpandedContext(
    filePath: string,
    rootPath: string,
    options: {
      includeImports?: boolean;
      includeExports?: boolean;
      maxTokens?: number;
    } = {}
  ): Promise<{
    file: DependencyContext;
    imports: DependencyContext[];
    exports: DependencyContext[];
    totalTokens: number;
  }> {
    await this.initialize(rootPath);

    const maxTokens = options.maxTokens || this.config.maxDependencyTokens;

    if (!this.currentAnalysis) {
      throw new Error('Dependency analysis not available');
    }

    const node = this.currentAnalysis.graph.nodes.get(filePath);
    if (!node) {
      throw new Error(`File not found in dependency graph: ${filePath}`);
    }

    const fileContext = await this.buildDependencyContext(node, 'related');
    let totalTokens = this.estimateTokens(JSON.stringify(fileContext));

    const imports: DependencyContext[] = [];
    const exports: DependencyContext[] = [];

    // Get import contexts
    if (options.includeImports !== false) {
      for (const dep of node.dependencies) {
        if (totalTokens >= maxTokens) break;

        const depNode = this.currentAnalysis.graph.nodes.get(dep);
        if (!depNode) continue;

        const ctx = await this.buildDependencyContext(depNode, 'imports');
        const tokens = this.estimateTokens(JSON.stringify(ctx));

        if (totalTokens + tokens <= maxTokens) {
          imports.push(ctx);
          totalTokens += tokens;
        }
      }
    }

    // Get export contexts (files that import this file)
    if (options.includeExports !== false) {
      for (const dependent of node.dependents) {
        if (totalTokens >= maxTokens) break;

        const depNode = this.currentAnalysis.graph.nodes.get(dependent);
        if (!depNode) continue;

        const ctx = await this.buildDependencyContext(depNode, 'imported_by');
        const tokens = this.estimateTokens(JSON.stringify(ctx));

        if (totalTokens + tokens <= maxTokens) {
          exports.push(ctx);
          totalTokens += tokens;
        }
      }
    }

    return {
      file: fileContext,
      imports,
      exports,
      totalTokens,
    };
  }

  /**
   * Find the shortest path between two files in the dependency graph
   */
  getDependencyPath(fromFile: string, toFile: string): string[] | null {
    if (!this.currentAnalysis) return null;
    return this.depAnalyzer.getDependencyChain(fromFile, toFile);
  }

  /**
   * Get all files that would be affected by changes to a file
   */
  getImpactedFiles(filePath: string): string[] {
    if (!this.currentAnalysis) return [];

    const impacted = new Set<string>();
    const queue = [filePath];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (impacted.has(current)) continue;

      impacted.add(current);

      const node = this.currentAnalysis.graph.nodes.get(current);
      if (node) {
        for (const dependent of node.dependents) {
          if (!impacted.has(dependent)) {
            queue.push(dependent);
          }
        }
      }
    }

    // Remove the original file
    impacted.delete(filePath);
    return Array.from(impacted);
  }

  /**
   * Format results for display
   */
  formatResult(result: DependencyAwareResult): string {
    const lines: string[] = [];

    lines.push('═'.repeat(60));
    lines.push('DEPENDENCY-AWARE RAG RESULTS');
    lines.push('═'.repeat(60));
    lines.push('');

    lines.push(`Query: "${result.query}"`);
    lines.push(`Strategy: ${result.strategy}`);
    lines.push(`Retrieval time: ${result.retrievalTime}ms`);
    lines.push('');

    // Code chunks
    lines.push('─'.repeat(40));
    lines.push(`Code Chunks (${result.chunks.length}):`);
    for (const chunk of result.chunks.slice(0, 5)) {
      const name = chunk.chunk.metadata.name || 'anonymous';
      lines.push(`  [${(chunk.score * 100).toFixed(0)}%] ${name} (${path.basename(chunk.chunk.filePath)}:${chunk.chunk.startLine})`);
    }

    // Dependencies
    if (result.dependencies.length > 0) {
      lines.push('');
      lines.push('─'.repeat(40));
      lines.push(`Dependencies (${result.dependencies.length}):`);
      for (const dep of result.dependencies.slice(0, 5)) {
        lines.push(`  [${(dep.relevanceScore * 100).toFixed(0)}%] ${dep.relativePath}`);
        if (dep.exports.length > 0) {
          lines.push(`    Exports: ${dep.exports.slice(0, 3).join(', ')}`);
        }
      }
    }

    // Dependents
    if (result.dependents.length > 0) {
      lines.push('');
      lines.push('─'.repeat(40));
      lines.push(`Dependents (${result.dependents.length}):`);
      for (const dep of result.dependents.slice(0, 5)) {
        lines.push(`  [${(dep.relevanceScore * 100).toFixed(0)}%] ${dep.relativePath}`);
      }
    }

    // Graph stats
    lines.push('');
    lines.push('─'.repeat(40));
    lines.push('Graph Statistics:');
    lines.push(`  Files analyzed: ${result.graphStats.filesAnalyzed}`);
    lines.push(`  Total dependencies: ${result.graphStats.totalDependencies}`);
    lines.push(`  Depth: ${result.graphStats.dependencyDepth}`);

    lines.push('');
    lines.push('═'.repeat(60));

    return lines.join('\n');
  }

  /**
   * Tokenize text for scoring
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
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
   * Clear the cache
   */
  clearCache(): void {
    this.analysisCache.clear();
    this.currentAnalysis = null;
    this.isInitialized = false;
  }

  /**
   * Get current statistics
   */
  getStats(): {
    isInitialized: boolean;
    cacheSize: number;
    graphStats: DependencyAnalysisResult['stats'] | null;
  } {
    return {
      isInitialized: this.isInitialized,
      cacheSize: this.analysisCache.size,
      graphStats: this.currentAnalysis?.stats || null,
    };
  }
}

/**
 * Create a DependencyAwareRAG instance
 */
export function createDependencyAwareRAG(
  config: Partial<DependencyRAGConfig> = {}
): DependencyAwareRAG {
  return new DependencyAwareRAG(config);
}

// Singleton instance
let dependencyRAGInstance: DependencyAwareRAG | null = null;

export function getDependencyAwareRAG(
  config: Partial<DependencyRAGConfig> = {}
): DependencyAwareRAG {
  if (!dependencyRAGInstance) {
    dependencyRAGInstance = createDependencyAwareRAG(config);
  }
  return dependencyRAGInstance;
}

export function resetDependencyAwareRAG(): void {
  if (dependencyRAGInstance) {
    dependencyRAGInstance.clearCache();
  }
  dependencyRAGInstance = null;
}
