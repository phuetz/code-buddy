/**
 * Code Context Tool
 *
 * Builds comprehensive understanding of code structure, relationships,
 * and semantics for a given file or codebase.
 *
 * Inspired by hurry-mode's code context capabilities.
 */

import * as fs from "fs";
import * as path from "path";
import {
  CodeContext,
  ContextualSymbol,
  ContextualDependency,
  CodeRelationship,
  SemanticContext,
  QualityMetrics,
  DetectedPattern,
  CodeSymbol,
  SupportedLanguage,
} from "./types.js";
import { ASTParser, getASTParser } from "./ast-parser.js";
import { SymbolSearch, getSymbolSearch } from "./symbol-search.js";
import { DependencyAnalyzer, getDependencyAnalyzer } from "./dependency-analyzer.js";

/**
 * Code Context Builder
 */
export class CodeContextBuilder {
  private parser: ASTParser;
  private symbolSearch: SymbolSearch;
  private dependencyAnalyzer: DependencyAnalyzer;

  constructor(
    parser?: ASTParser,
    symbolSearch?: SymbolSearch,
    dependencyAnalyzer?: DependencyAnalyzer
  ) {
    this.parser = parser || getASTParser();
    this.symbolSearch = symbolSearch || getSymbolSearch();
    this.dependencyAnalyzer = dependencyAnalyzer || getDependencyAnalyzer();
  }

  /**
   * Build context for a single file
   */
  async buildFileContext(filePath: string): Promise<CodeContext> {
    // Parse the file
    const parseResult = await this.parser.parseFile(filePath);

    // Build contextual symbols
    const contextualSymbols = await this.enrichSymbols(parseResult.symbols, filePath);

    // Build contextual dependencies
    const contextualDependencies = this.buildDependencies(parseResult.imports, filePath);

    // Build relationships
    const relationships = this.buildRelationships(contextualSymbols);

    // Build semantic context
    const semantics = this.buildSemanticContext(filePath, contextualSymbols);

    // Calculate quality metrics
    const content = fs.readFileSync(filePath, "utf-8");
    const quality = this.calculateQualityMetrics(content, contextualSymbols);

    return {
      filePath,
      language: parseResult.language,
      symbols: contextualSymbols,
      dependencies: contextualDependencies,
      relationships,
      semantics,
      quality,
    };
  }

  /**
   * Enrich symbols with contextual information
   */
  private async enrichSymbols(
    symbols: CodeSymbol[],
    filePath: string
  ): Promise<ContextualSymbol[]> {
    const enriched: ContextualSymbol[] = [];

    for (const symbol of symbols) {
      // Find related symbols
      const relatedSymbols = this.findRelatedSymbols(symbol, symbols);

      // Calculate usage count (simple heuristic)
      const usageCount = await this.estimateUsageCount(symbol);

      // Calculate complexity for functions
      const complexity = symbol.type === "function" || symbol.type === "method"
        ? this.calculateSymbolComplexity(symbol)
        : undefined;

      // Generate semantic tags
      const semanticTags = this.generateSemanticTags(symbol);

      enriched.push({
        ...symbol,
        relatedSymbols,
        usageCount,
        complexity,
        semanticTags,
      });
    }

    return enriched;
  }

  /**
   * Find related symbols within the same file
   */
  private findRelatedSymbols(symbol: CodeSymbol, allSymbols: CodeSymbol[]): string[] {
    const related: string[] = [];

    // Parent relationship
    if (symbol.parentId) {
      related.push(symbol.parentId);
    }

    // Children relationships
    if (symbol.children) {
      related.push(...symbol.children);
    }

    // Type relationships (if function uses types defined in file)
    for (const other of allSymbols) {
      if (other.id === symbol.id) continue;

      // Check if symbol references another symbol's name
      if (symbol.signature?.includes(other.name)) {
        related.push(other.id);
      }

      // Check return type
      if (symbol.returnType?.includes(other.name)) {
        related.push(other.id);
      }
    }

    return [...new Set(related)];
  }

  /**
   * Estimate usage count for a symbol
   */
  private async estimateUsageCount(symbol: CodeSymbol): Promise<number> {
    // Simple heuristic based on visibility and type
    let baseCount = 1;

    if (symbol.visibility === "public") baseCount *= 2;
    if (symbol.type === "class" || symbol.type === "interface") baseCount *= 3;
    if (symbol.type === "function" || symbol.type === "method") baseCount *= 2;

    return baseCount;
  }

  /**
   * Calculate complexity for a symbol
   */
  private calculateSymbolComplexity(symbol: CodeSymbol): number {
    let complexity = 1;

    // Add complexity based on parameters
    if (symbol.parameters) {
      complexity += symbol.parameters.length * 0.5;
    }

    // Add complexity based on signature length (heuristic)
    if (symbol.signature) {
      const signatureComplexity = (symbol.signature.match(/[<>{}[\]()]/g) || []).length;
      complexity += signatureComplexity * 0.2;
    }

    return Math.round(complexity * 10) / 10;
  }

  /**
   * Generate semantic tags for a symbol
   */
  private generateSemanticTags(symbol: CodeSymbol): string[] {
    const tags: string[] = [];
    const nameLower = symbol.name.toLowerCase();

    // Test-related
    if (
      nameLower.includes("test") ||
      nameLower.includes("spec") ||
      nameLower.includes("mock")
    ) {
      tags.push("test");
    }

    // Utility-related
    if (
      nameLower.includes("util") ||
      nameLower.includes("helper") ||
      nameLower.includes("format") ||
      nameLower.includes("parse") ||
      nameLower.includes("convert")
    ) {
      tags.push("utility");
    }

    // API-related
    if (
      nameLower.includes("api") ||
      nameLower.includes("fetch") ||
      nameLower.includes("request") ||
      nameLower.includes("response") ||
      nameLower.includes("endpoint")
    ) {
      tags.push("api");
    }

    // UI-related
    if (
      nameLower.includes("component") ||
      nameLower.includes("render") ||
      nameLower.includes("view") ||
      nameLower.includes("page") ||
      nameLower.includes("button") ||
      nameLower.includes("input")
    ) {
      tags.push("ui");
    }

    // Model-related
    if (
      nameLower.includes("model") ||
      nameLower.includes("entity") ||
      nameLower.includes("schema") ||
      nameLower.includes("type") && symbol.type === "interface"
    ) {
      tags.push("model");
    }

    // Controller/Handler-related
    if (
      nameLower.includes("controller") ||
      nameLower.includes("handler") ||
      nameLower.includes("service") ||
      nameLower.includes("manager")
    ) {
      tags.push("controller");
    }

    // Async-related
    if (
      symbol.metadata.isAsync ||
      nameLower.includes("async") ||
      nameLower.includes("promise")
    ) {
      tags.push("async");
    }

    // Event-related
    if (
      nameLower.includes("event") ||
      nameLower.includes("listener") ||
      nameLower.includes("emit") ||
      nameLower.includes("on")
    ) {
      tags.push("event");
    }

    // Config-related
    if (
      nameLower.includes("config") ||
      nameLower.includes("option") ||
      nameLower.includes("setting")
    ) {
      tags.push("config");
    }

    return tags;
  }

  /**
   * Build contextual dependencies
   */
  private buildDependencies(
    imports: { source: string; specifiers: any[]; isTypeOnly: boolean }[],
    filePath: string
  ): ContextualDependency[] {
    const dependencies: ContextualDependency[] = [];

    for (const imp of imports) {
      const type = this.categorizeDependency(imp.source);
      const symbols = imp.specifiers?.map((s: any) => s.name || s.alias) || [];

      dependencies.push({
        source: imp.source,
        type,
        symbols,
        isCircular: false, // Would need full graph to determine
        importance: this.calculateDependencyImportance(type, symbols.length),
      });
    }

    return dependencies;
  }

  /**
   * Categorize a dependency
   */
  private categorizeDependency(source: string): "internal" | "external" | "builtin" {
    // Builtin modules
    const builtins = [
      "fs",
      "path",
      "http",
      "https",
      "crypto",
      "os",
      "util",
      "events",
      "stream",
      "buffer",
      "url",
      "querystring",
      "child_process",
      "cluster",
      "net",
      "dns",
      "tls",
      "assert",
      "zlib",
    ];

    if (builtins.includes(source) || source.startsWith("node:")) {
      return "builtin";
    }

    // Internal (relative) imports
    if (source.startsWith(".") || source.startsWith("/")) {
      return "internal";
    }

    // External packages
    return "external";
  }

  /**
   * Calculate dependency importance
   */
  private calculateDependencyImportance(
    type: "internal" | "external" | "builtin",
    symbolCount: number
  ): number {
    let importance = 0.5;

    // Internal dependencies are more important for understanding code
    if (type === "internal") importance += 0.3;
    if (type === "external") importance += 0.1;

    // More symbols = more important
    importance += Math.min(0.2, symbolCount * 0.05);

    return Math.min(1, importance);
  }

  /**
   * Build relationships between symbols
   */
  private buildRelationships(symbols: ContextualSymbol[]): CodeRelationship[] {
    const relationships: CodeRelationship[] = [];

    for (const symbol of symbols) {
      // Inheritance relationships
      if (symbol.type === "class" && symbol.metadata.extends) {
        const parent = symbols.find((s) => s.name === symbol.metadata.extends);
        if (parent) {
          relationships.push({
            sourceId: symbol.id,
            targetId: parent.id,
            type: "inherits",
            strength: 1.0,
          });
        }
      }

      // Implementation relationships
      if (symbol.type === "class" && symbol.metadata.implements) {
        const impls = symbol.metadata.implements as string[];
        for (const impl of impls) {
          const iface = symbols.find((s) => s.name === impl);
          if (iface) {
            relationships.push({
              sourceId: symbol.id,
              targetId: iface.id,
              type: "implements",
              strength: 1.0,
            });
          }
        }
      }

      // Usage relationships from related symbols
      for (const relatedId of symbol.relatedSymbols) {
        if (!relationships.some(
          (r) =>
            (r.sourceId === symbol.id && r.targetId === relatedId) ||
            (r.sourceId === relatedId && r.targetId === symbol.id)
        )) {
          relationships.push({
            sourceId: symbol.id,
            targetId: relatedId,
            type: "uses",
            strength: 0.5,
          });
        }
      }
    }

    return relationships;
  }

  /**
   * Build semantic context for a file
   */
  private buildSemanticContext(
    filePath: string,
    symbols: ContextualSymbol[]
  ): SemanticContext {
    // Infer purpose from file path and symbols
    const purpose = this.inferPurpose(filePath, symbols);

    // Extract domain from path
    const domain = this.extractDomain(filePath);

    // Detect patterns
    const patterns = this.detectPatterns(symbols);

    // Collect all tags
    const allTags = new Set<string>();
    for (const symbol of symbols) {
      for (const tag of symbol.semanticTags) {
        allTags.add(tag);
      }
    }

    return {
      purpose,
      domain,
      patterns,
      tags: Array.from(allTags),
    };
  }

  /**
   * Infer purpose of a file
   */
  private inferPurpose(filePath: string, symbols: ContextualSymbol[]): string {
    const fileName = path.basename(filePath, path.extname(filePath)).toLowerCase();
    const dirName = path.dirname(filePath).toLowerCase();

    // Check file name patterns
    if (fileName.includes("test") || fileName.includes("spec")) {
      return "Testing - Contains test cases";
    }
    if (fileName.includes("config") || fileName.includes("settings")) {
      return "Configuration - Application settings";
    }
    if (fileName.includes("util") || fileName.includes("helper")) {
      return "Utility - Helper functions";
    }
    if (fileName.includes("type") || fileName.includes("interface")) {
      return "Type definitions";
    }
    if (fileName === "index") {
      return "Module entry point - Exports public API";
    }

    // Check directory patterns
    if (dirName.includes("component") || dirName.includes("ui")) {
      return "UI Component";
    }
    if (dirName.includes("service")) {
      return "Service layer - Business logic";
    }
    if (dirName.includes("api") || dirName.includes("route")) {
      return "API layer - HTTP endpoints";
    }
    if (dirName.includes("model") || dirName.includes("entity")) {
      return "Data model definitions";
    }

    // Infer from symbols
    const hasClasses = symbols.some((s) => s.type === "class");
    const hasFunctions = symbols.some((s) => s.type === "function");
    const hasInterfaces = symbols.some((s) => s.type === "interface");

    if (hasInterfaces && !hasClasses && !hasFunctions) {
      return "Type definitions";
    }
    if (hasClasses && symbols.filter((s) => s.type === "class").length === 1) {
      return `${symbols.find((s) => s.type === "class")?.name} class implementation`;
    }
    if (hasFunctions && !hasClasses) {
      return "Utility functions module";
    }

    return "General module";
  }

  /**
   * Extract domain from file path
   */
  private extractDomain(filePath: string): string[] {
    const parts = filePath.split("/").filter((p) => p && p !== "src" && !p.includes("."));
    const domains: string[] = [];

    for (const part of parts) {
      if (!["utils", "helpers", "lib", "common", "shared"].includes(part.toLowerCase())) {
        domains.push(part);
      }
    }

    return domains.slice(-3); // Last 3 meaningful parts
  }

  /**
   * Detect design patterns in code
   */
  private detectPatterns(symbols: ContextualSymbol[]): DetectedPattern[] {
    const patterns: DetectedPattern[] = [];

    // Singleton pattern
    const singletonIndicators = symbols.filter(
      (s) =>
        s.name.toLowerCase().includes("instance") ||
        s.name.toLowerCase().includes("singleton") ||
        (s.type === "method" && s.name === "getInstance")
    );
    if (singletonIndicators.length > 0) {
      patterns.push({
        name: "Singleton",
        confidence: Math.min(0.9, 0.3 * singletonIndicators.length),
        locations: singletonIndicators.map((s) => s.id),
      });
    }

    // Factory pattern
    const factoryIndicators = symbols.filter(
      (s) =>
        s.name.toLowerCase().includes("factory") ||
        s.name.toLowerCase().includes("create") ||
        s.name.toLowerCase().includes("build")
    );
    if (factoryIndicators.length > 0) {
      patterns.push({
        name: "Factory",
        confidence: Math.min(0.9, 0.3 * factoryIndicators.length),
        locations: factoryIndicators.map((s) => s.id),
      });
    }

    // Observer pattern
    const observerIndicators = symbols.filter(
      (s) =>
        s.name.toLowerCase().includes("observer") ||
        s.name.toLowerCase().includes("listener") ||
        s.name.toLowerCase().includes("subscribe") ||
        s.name.toLowerCase().includes("emit")
    );
    if (observerIndicators.length >= 2) {
      patterns.push({
        name: "Observer",
        confidence: Math.min(0.9, 0.25 * observerIndicators.length),
        locations: observerIndicators.map((s) => s.id),
      });
    }

    // Repository pattern
    const repoIndicators = symbols.filter(
      (s) =>
        s.name.toLowerCase().includes("repository") ||
        (s.type === "class" &&
          ["find", "save", "delete", "update"].some((m) =>
            symbols.some(
              (child) =>
                child.parentId === s.id &&
                child.name.toLowerCase().includes(m)
            )
          ))
    );
    if (repoIndicators.length > 0) {
      patterns.push({
        name: "Repository",
        confidence: 0.7,
        locations: repoIndicators.map((s) => s.id),
      });
    }

    return patterns;
  }

  /**
   * Calculate quality metrics
   */
  private calculateQualityMetrics(
    content: string,
    symbols: ContextualSymbol[]
  ): QualityMetrics {
    const lines = content.split("\n");
    const linesOfCode = lines.filter((l) => l.trim() && !l.trim().startsWith("//")).length;

    // Count comments
    const commentLines = lines.filter(
      (l) => l.trim().startsWith("//") || l.trim().startsWith("*") || l.trim().startsWith("/*")
    ).length;
    const commentRatio = linesOfCode > 0 ? commentLines / linesOfCode : 0;

    // Calculate cyclomatic complexity
    const cyclomaticComplexity = this.calculateCyclomaticComplexity(content);

    // Calculate cognitive complexity
    const cognitiveComplexity = this.calculateCognitiveComplexity(content);

    // Calculate maintainability index (Microsoft formula)
    const avgComplexity = cyclomaticComplexity;
    const halsteadVolume = linesOfCode * Math.log2(symbols.length + 1);
    const maintainabilityIndex = Math.max(
      0,
      (171 - 5.2 * Math.log(halsteadVolume) - 0.23 * avgComplexity - 16.2 * Math.log(linesOfCode)) *
        100 / 171
    );

    // Estimate technical debt (hours)
    const technicalDebt = (100 - maintainabilityIndex) * linesOfCode / 1000;

    // Calculate sub-scores
    const maintainabilityScore = maintainabilityIndex / 100;
    const readabilityScore = Math.min(1, commentRatio * 2 + 0.5);
    const testabilityScore = symbols.some((s) => s.semanticTags.includes("test")) ? 0.8 : 0.4;
    const reusabilityScore = symbols.filter((s) => s.visibility === "public").length /
      Math.max(1, symbols.length);

    return {
      complexity: {
        cyclomatic: cyclomaticComplexity,
        cognitive: cognitiveComplexity,
      },
      maintainability: Math.round(maintainabilityIndex),
      linesOfCode,
      commentRatio: Math.round(commentRatio * 100) / 100,
      technicalDebt: Math.round(technicalDebt * 10) / 10,
      scores: {
        maintainability: Math.round(maintainabilityScore * 100) / 100,
        readability: Math.round(readabilityScore * 100) / 100,
        testability: Math.round(testabilityScore * 100) / 100,
        reusability: Math.round(reusabilityScore * 100) / 100,
      },
    };
  }

  /**
   * Calculate cyclomatic complexity
   */
  private calculateCyclomaticComplexity(content: string): number {
    let complexity = 1;

    const patterns = [
      /\bif\b/g,
      /\belse\s+if\b/g,
      /\bfor\b/g,
      /\bwhile\b/g,
      /\bcase\b/g,
      /\bcatch\b/g,
      /\?[^:]+:/g, // ternary
      /&&/g,
      /\|\|/g,
    ];

    for (const pattern of patterns) {
      const matches = content.match(pattern);
      if (matches) {
        complexity += matches.length;
      }
    }

    return complexity;
  }

  /**
   * Calculate cognitive complexity
   */
  private calculateCognitiveComplexity(content: string): number {
    let complexity = 0;
    let nestingLevel = 0;

    const lines = content.split("\n");

    for (const line of lines) {
      const trimmed = line.trim();

      // Increase nesting on opening structures
      if (
        /\b(if|for|while|switch|try)\s*\(/.test(trimmed) ||
        /\belse\s*\{/.test(trimmed)
      ) {
        complexity += 1 + nestingLevel;
        nestingLevel++;
      }

      // Decrease nesting on closing brace (simplified)
      if (trimmed === "}" && nestingLevel > 0) {
        nestingLevel--;
      }

      // Add for logical operators
      const andOr = (trimmed.match(/&&|\|\|/g) || []).length;
      complexity += andOr;

      // Add for recursion (simplified detection)
      if (/\bfunction\s+(\w+)/.test(trimmed)) {
        const funcName = trimmed.match(/\bfunction\s+(\w+)/)?.[1];
        if (funcName && content.includes(`${funcName}(`)) {
          complexity += 1;
        }
      }
    }

    return complexity;
  }

  /**
   * Format context for display
   */
  formatContext(context: CodeContext): string {
    const lines: string[] = [];

    lines.push("═".repeat(60));
    lines.push("📋 CODE CONTEXT");
    lines.push("═".repeat(60));
    lines.push("");

    lines.push(`File: ${context.filePath}`);
    lines.push(`Language: ${context.language}`);
    lines.push(`Purpose: ${context.semantics.purpose}`);
    lines.push("");

    lines.push("─".repeat(40));
    lines.push("Symbols:");
    for (const symbol of context.symbols.slice(0, 10)) {
      const tags = symbol.semanticTags.length > 0 ? ` [${symbol.semanticTags.join(", ")}]` : "";
      lines.push(`  ${symbol.type}: ${symbol.name}${tags}`);
    }
    if (context.symbols.length > 10) {
      lines.push(`  ... and ${context.symbols.length - 10} more`);
    }

    lines.push("");
    lines.push("─".repeat(40));
    lines.push("Quality Metrics:");
    lines.push(`  Lines of Code: ${context.quality.linesOfCode}`);
    lines.push(`  Cyclomatic Complexity: ${context.quality.complexity.cyclomatic}`);
    lines.push(`  Maintainability: ${context.quality.maintainability}%`);
    lines.push(`  Technical Debt: ${context.quality.technicalDebt}h`);

    if (context.semantics.patterns.length > 0) {
      lines.push("");
      lines.push("─".repeat(40));
      lines.push("Detected Patterns:");
      for (const pattern of context.semantics.patterns) {
        lines.push(`  ${pattern.name} (${Math.round(pattern.confidence * 100)}% confidence)`);
      }
    }

    lines.push("");
    lines.push("═".repeat(60));

    return lines.join("\n");
  }
}

/**
 * Create a code context builder
 */
export function createCodeContextBuilder(): CodeContextBuilder {
  return new CodeContextBuilder();
}

// Singleton instance
let codeContextBuilderInstance: CodeContextBuilder | null = null;

export function getCodeContextBuilder(): CodeContextBuilder {
  if (!codeContextBuilderInstance) {
    codeContextBuilderInstance = createCodeContextBuilder();
  }
  return codeContextBuilderInstance;
}

export function resetCodeContextBuilder(): void {
  codeContextBuilderInstance = null;
}
