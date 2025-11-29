/**
 * Dependency Analyzer Tool
 *
 * Analyzes import/export dependencies, detects circular dependencies,
 * identifies unreachable files, and generates dependency graphs.
 *
 * Inspired by hurry-mode's dependency analysis capabilities.
 */

import * as fs from "fs";
import * as path from "path";
import {
  DependencyGraph,
  DependencyNode,
  DependencyEdge,
  CircularDependency,
  DependencyStats,
  DependencyInfo,
  ImportInfo,
} from "./types.js";
import { ASTParser, getASTParser } from "./ast-parser.js";

/**
 * Configuration for dependency analysis
 */
export interface DependencyAnalyzerConfig {
  rootPath: string;
  filePatterns: string[];
  excludePatterns: string[];
  detectCircular: boolean;
  findUnreachable: boolean;
  generateGraph: boolean;
  entryPoints?: string[];
  maxDepth: number;
  resolveExtensions: string[];
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: DependencyAnalyzerConfig = {
  rootPath: ".",
  filePatterns: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"],
  excludePatterns: ["node_modules", "dist", "build", ".git", "coverage"],
  detectCircular: true,
  findUnreachable: true,
  generateGraph: true,
  maxDepth: 100,
  resolveExtensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
};

/**
 * Analysis result
 */
export interface DependencyAnalysisResult {
  graph: DependencyGraph;
  circularDependencies: CircularDependency[];
  unreachableFiles: string[];
  externalDependencies: Map<string, string[]>;
  stats: DependencyStats;
  analysisTime: number;
}

/**
 * Dependency Analyzer
 */
export class DependencyAnalyzer {
  private config: DependencyAnalyzerConfig;
  private parser: ASTParser;
  private graph: Map<string, DependencyNode> = new Map();
  private edges: DependencyEdge[] = [];

  constructor(config: Partial<DependencyAnalyzerConfig> = {}, parser?: ASTParser) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.parser = parser || getASTParser();
  }

  /**
   * Analyze dependencies in a codebase
   */
  async analyze(rootPath?: string): Promise<DependencyAnalysisResult> {
    const startTime = Date.now();
    const effectiveRoot = rootPath || this.config.rootPath;

    // Reset state
    this.graph.clear();
    this.edges = [];

    // Discover files
    const files = await this.discoverFiles(effectiveRoot);

    // Build initial nodes
    for (const file of files) {
      this.graph.set(file, {
        filePath: file,
        imports: [],
        exports: [],
        dependencies: [],
        dependents: [],
        depth: -1,
        isEntryPoint: false,
      });
    }

    // Parse files and extract dependencies
    for (const file of files) {
      await this.analyzeFile(file, effectiveRoot);
    }

    // Detect entry points
    const entryPoints = this.config.entryPoints || this.detectEntryPoints();
    for (const entry of entryPoints) {
      const node = this.graph.get(entry);
      if (node) {
        node.isEntryPoint = true;
      }
    }

    // Calculate depths
    this.calculateDepths(entryPoints);

    // Detect circular dependencies
    let circularDependencies: CircularDependency[] = [];
    if (this.config.detectCircular) {
      circularDependencies = this.detectCircularDependencies();
    }

    // Find unreachable files
    let unreachableFiles: string[] = [];
    if (this.config.findUnreachable) {
      unreachableFiles = this.findUnreachableFiles(entryPoints);
    }

    // Extract external dependencies
    const externalDependencies = this.extractExternalDependencies();

    // Calculate statistics
    const stats = this.calculateStats(circularDependencies);

    return {
      graph: {
        nodes: this.graph,
        edges: this.edges,
        circularDependencies,
        unreachableFiles,
        entryPoints,
        stats,
      },
      circularDependencies,
      unreachableFiles,
      externalDependencies,
      stats,
      analysisTime: Date.now() - startTime,
    };
  }

  /**
   * Analyze a single file
   */
  private async analyzeFile(filePath: string, rootPath: string): Promise<void> {
    try {
      const result = await this.parser.parseFile(filePath);
      const node = this.graph.get(filePath);

      if (!node) return;

      // Process imports
      for (const imp of result.imports) {
        const resolvedPath = this.resolveImport(imp.source, filePath, rootPath);

        if (resolvedPath) {
          // Internal dependency
          node.dependencies.push(resolvedPath);
          node.imports.push(imp.source);

          // Update dependent's dependents
          const targetNode = this.graph.get(resolvedPath);
          if (targetNode) {
            targetNode.dependents.push(filePath);
          }

          // Add edge
          this.edges.push({
            source: filePath,
            target: resolvedPath,
            type: "internal",
            weight: 1,
          });
        } else if (!imp.source.startsWith(".")) {
          // External dependency
          node.imports.push(imp.source);

          this.edges.push({
            source: filePath,
            target: imp.source,
            type: "external",
            weight: 0.5,
          });
        }
      }

      // Process exports
      for (const exp of result.exports) {
        node.exports.push(exp.name);
      }
    } catch (error) {
      // Skip files that can't be parsed
    }
  }

  /**
   * Resolve an import to a file path
   */
  private resolveImport(
    source: string,
    fromFile: string,
    rootPath: string
  ): string | null {
    // Skip external packages
    if (!source.startsWith(".") && !source.startsWith("/")) {
      return null;
    }

    const fromDir = path.dirname(fromFile);
    let targetPath = path.resolve(fromDir, source);

    // Try different extensions
    for (const ext of this.config.resolveExtensions) {
      // Direct file
      if (fs.existsSync(targetPath + ext)) {
        return targetPath + ext;
      }

      // Index file
      const indexPath = path.join(targetPath, `index${ext}`);
      if (fs.existsSync(indexPath)) {
        return indexPath;
      }
    }

    // Check if it's already a valid path
    if (fs.existsSync(targetPath)) {
      const stat = fs.statSync(targetPath);
      if (stat.isDirectory()) {
        // Try index files
        for (const ext of this.config.resolveExtensions) {
          const indexPath = path.join(targetPath, `index${ext}`);
          if (fs.existsSync(indexPath)) {
            return indexPath;
          }
        }
      } else {
        return targetPath;
      }
    }

    return null;
  }

  /**
   * Detect entry points
   */
  private detectEntryPoints(): string[] {
    const entryPoints: string[] = [];

    // Common entry point patterns
    const entryPatterns = [
      /index\.[jt]sx?$/,
      /main\.[jt]sx?$/,
      /app\.[jt]sx?$/,
      /server\.[jt]sx?$/,
      /cli\.[jt]sx?$/,
    ];

    // Files with no dependents are potential entry points
    for (const [filePath, node] of this.graph) {
      // Check if matches entry pattern
      if (entryPatterns.some((p) => p.test(filePath))) {
        entryPoints.push(filePath);
        continue;
      }

      // Files with no dependents (and has dependencies) might be entry points
      if (node.dependents.length === 0 && node.dependencies.length > 0) {
        // Check if it's in src root
        if (filePath.split("/").filter((p) => p === "src").length === 1) {
          const parts = filePath.split("/");
          const srcIndex = parts.indexOf("src");
          if (srcIndex >= 0 && parts.length === srcIndex + 2) {
            entryPoints.push(filePath);
          }
        }
      }
    }

    // If no entry points found, use files with most dependencies
    if (entryPoints.length === 0) {
      const sorted = Array.from(this.graph.values())
        .filter((n) => n.dependents.length === 0)
        .sort((a, b) => b.dependencies.length - a.dependencies.length);

      if (sorted.length > 0) {
        entryPoints.push(sorted[0].filePath);
      }
    }

    return entryPoints;
  }

  /**
   * Calculate depths from entry points
   */
  private calculateDepths(entryPoints: string[]): void {
    const visited = new Set<string>();
    const queue: Array<{ path: string; depth: number }> = [];

    // Start from entry points
    for (const entry of entryPoints) {
      queue.push({ path: entry, depth: 0 });
    }

    while (queue.length > 0) {
      const { path: currentPath, depth } = queue.shift()!;

      if (visited.has(currentPath)) continue;
      visited.add(currentPath);

      const node = this.graph.get(currentPath);
      if (!node) continue;

      node.depth = depth;

      // Add dependencies to queue
      for (const dep of node.dependencies) {
        if (!visited.has(dep)) {
          queue.push({ path: dep, depth: depth + 1 });
        }
      }
    }
  }

  /**
   * Detect circular dependencies using DFS
   */
  private detectCircularDependencies(): CircularDependency[] {
    const cycles: CircularDependency[] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const pathStack: string[] = [];

    const dfs = (node: string): void => {
      visited.add(node);
      recursionStack.add(node);
      pathStack.push(node);

      const nodeData = this.graph.get(node);
      if (!nodeData) {
        pathStack.pop();
        recursionStack.delete(node);
        return;
      }

      for (const dep of nodeData.dependencies) {
        if (!visited.has(dep)) {
          dfs(dep);
        } else if (recursionStack.has(dep)) {
          // Found a cycle
          const cycleStart = pathStack.indexOf(dep);
          const cycle = pathStack.slice(cycleStart);
          cycle.push(dep); // Complete the cycle

          const cycleType = cycle.length === 2 ? "direct" : "indirect";
          const severity = cycle.length === 2 ? "high" : cycle.length <= 4 ? "medium" : "low";

          // Check if this cycle is already recorded
          const cycleKey = [...cycle].sort().join(",");
          const exists = cycles.some(
            (c) => [...c.cycle].sort().join(",") === cycleKey
          );

          if (!exists) {
            cycles.push({
              cycle,
              type: cycleType,
              severity,
            });
          }
        }
      }

      pathStack.pop();
      recursionStack.delete(node);
    };

    // Run DFS from each node
    for (const nodePath of this.graph.keys()) {
      if (!visited.has(nodePath)) {
        dfs(nodePath);
      }
    }

    return cycles;
  }

  /**
   * Find unreachable files
   */
  private findUnreachableFiles(entryPoints: string[]): string[] {
    const reachable = new Set<string>();
    const queue = [...entryPoints];

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (reachable.has(current)) continue;
      reachable.add(current);

      const node = this.graph.get(current);
      if (!node) continue;

      for (const dep of node.dependencies) {
        if (!reachable.has(dep)) {
          queue.push(dep);
        }
      }
    }

    // Find files not reached
    const unreachable: string[] = [];
    for (const filePath of this.graph.keys()) {
      if (!reachable.has(filePath)) {
        unreachable.push(filePath);
      }
    }

    return unreachable;
  }

  /**
   * Extract external dependencies
   */
  private extractExternalDependencies(): Map<string, string[]> {
    const external = new Map<string, string[]>();

    for (const edge of this.edges) {
      if (edge.type === "external") {
        const files = external.get(edge.target) || [];
        files.push(edge.source);
        external.set(edge.target, files);
      }
    }

    return external;
  }

  /**
   * Calculate statistics
   */
  private calculateStats(cycles: CircularDependency[]): DependencyStats {
    const nodes = Array.from(this.graph.values());
    const totalDeps = nodes.reduce((sum, n) => sum + n.dependencies.length, 0);

    const externalCount = this.edges.filter((e) => e.type === "external").length;
    const maxDepth = Math.max(...nodes.map((n) => n.depth).filter((d) => d >= 0), 0);

    return {
      totalFiles: this.graph.size,
      totalDependencies: totalDeps,
      averageDependencies: this.graph.size > 0 ? totalDeps / this.graph.size : 0,
      maxDepth,
      circularCount: cycles.length,
      externalDependencies: externalCount,
    };
  }

  /**
   * Discover files to analyze
   */
  private async discoverFiles(rootPath: string): Promise<string[]> {
    const files: string[] = [];
    const extensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

    const walk = (dir: string) => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);

          if (entry.isDirectory()) {
            if (!this.config.excludePatterns.some((p) => entry.name.includes(p))) {
              walk(fullPath);
            }
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (extensions.includes(ext)) {
              files.push(fullPath);
            }
          }
        }
      } catch {
        // Skip directories that can't be read
      }
    };

    walk(rootPath);
    return files;
  }

  /**
   * Get dependency graph as JSON
   */
  toJSON(): Record<string, unknown> {
    const nodes: Record<string, unknown>[] = [];
    const edges: Record<string, unknown>[] = [];

    for (const [path, node] of this.graph) {
      nodes.push({
        id: path,
        label: path.split("/").pop(),
        ...node,
      });
    }

    for (const edge of this.edges) {
      edges.push(edge);
    }

    return { nodes, edges };
  }

  /**
   * Get dependency chain between two files
   */
  getDependencyChain(from: string, to: string): string[] | null {
    const visited = new Set<string>();
    const queue: Array<{ path: string; chain: string[] }> = [
      { path: from, chain: [from] },
    ];

    while (queue.length > 0) {
      const { path: current, chain } = queue.shift()!;

      if (current === to) {
        return chain;
      }

      if (visited.has(current)) continue;
      visited.add(current);

      const node = this.graph.get(current);
      if (!node) continue;

      for (const dep of node.dependencies) {
        if (!visited.has(dep)) {
          queue.push({ path: dep, chain: [...chain, dep] });
        }
      }
    }

    return null;
  }

  /**
   * Get files that depend on a given file
   */
  getDependents(filePath: string): string[] {
    const node = this.graph.get(filePath);
    return node?.dependents || [];
  }

  /**
   * Get files that a given file depends on
   */
  getDependencies(filePath: string): string[] {
    const node = this.graph.get(filePath);
    return node?.dependencies || [];
  }

  /**
   * Format result for display
   */
  formatResult(result: DependencyAnalysisResult): string {
    const lines: string[] = [];

    lines.push("═".repeat(60));
    lines.push("📊 DEPENDENCY ANALYSIS RESULT");
    lines.push("═".repeat(60));
    lines.push("");

    lines.push("Statistics:");
    lines.push(`  Total files: ${result.stats.totalFiles}`);
    lines.push(`  Total dependencies: ${result.stats.totalDependencies}`);
    lines.push(`  Average dependencies: ${result.stats.averageDependencies.toFixed(1)}`);
    lines.push(`  Max depth: ${result.stats.maxDepth}`);
    lines.push(`  External packages: ${result.stats.externalDependencies}`);
    lines.push(`  Analysis time: ${result.analysisTime}ms`);

    if (result.circularDependencies.length > 0) {
      lines.push("");
      lines.push("─".repeat(40));
      lines.push(`⚠️  Circular Dependencies (${result.circularDependencies.length}):`);
      for (const cycle of result.circularDependencies.slice(0, 10)) {
        lines.push(`  [${cycle.severity}] ${cycle.cycle.map((p) => path.basename(p)).join(" → ")}`);
      }
      if (result.circularDependencies.length > 10) {
        lines.push(`  ... and ${result.circularDependencies.length - 10} more`);
      }
    }

    if (result.unreachableFiles.length > 0) {
      lines.push("");
      lines.push("─".repeat(40));
      lines.push(`📭 Unreachable Files (${result.unreachableFiles.length}):`);
      for (const file of result.unreachableFiles.slice(0, 10)) {
        lines.push(`  ${path.basename(file)}`);
      }
      if (result.unreachableFiles.length > 10) {
        lines.push(`  ... and ${result.unreachableFiles.length - 10} more`);
      }
    }

    lines.push("");
    lines.push("═".repeat(60));

    return lines.join("\n");
  }
}

/**
 * Create a dependency analyzer
 */
export function createDependencyAnalyzer(
  config?: Partial<DependencyAnalyzerConfig>,
  parser?: ASTParser
): DependencyAnalyzer {
  return new DependencyAnalyzer(config, parser);
}

// Singleton instance
let dependencyAnalyzerInstance: DependencyAnalyzer | null = null;

export function getDependencyAnalyzer(): DependencyAnalyzer {
  if (!dependencyAnalyzerInstance) {
    dependencyAnalyzerInstance = createDependencyAnalyzer();
  }
  return dependencyAnalyzerInstance;
}

export function resetDependencyAnalyzer(): void {
  dependencyAnalyzerInstance = null;
}
