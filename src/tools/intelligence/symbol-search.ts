/**
 * Symbol Search Tool
 *
 * Fuzzy and exact symbol search across codebase using Fuse.js.
 * Supports cross-referencing and usage analysis.
 *
 * Inspired by hurry-mode's symbol search capabilities.
 */

import * as fs from "fs";
import * as path from "path";
import {
  CodeSymbol,
  SymbolType,
  SymbolScope,
  SupportedLanguage,
  SymbolSearchOptions,
  SymbolSearchResult,
  SymbolUsage,
  SearchMatch,
  ASTParseResult,
} from "./types.js";
import { ASTParser, getASTParser } from "./ast-parser.js";

/**
 * Simple Fuse.js-like fuzzy matcher
 * (Implementing core functionality to avoid external dependency)
 */
class FuzzyMatcher {
  private threshold: number;
  private keys: string[];

  constructor(options: { threshold?: number; keys: string[] }) {
    this.threshold = options.threshold ?? 0.4;
    this.keys = options.keys;
  }

  /**
   * Calculate Levenshtein distance
   */
  private levenshteinDistance(s1: string, s2: string): number {
    const m = s1.length;
    const n = s2.length;

    if (m === 0) return n;
    if (n === 0) return m;

    const dp: number[][] = Array(m + 1)
      .fill(null)
      .map(() => Array(n + 1).fill(0));

    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + cost
        );
      }
    }

    return dp[m][n];
  }

  /**
   * Calculate similarity score (0-1, higher is better)
   */
  private calculateScore(query: string, target: string): number {
    const q = query.toLowerCase();
    const t = target.toLowerCase();

    // Exact match
    if (t === q) return 1.0;

    // Contains match
    if (t.includes(q)) {
      return 0.9 - (t.indexOf(q) / t.length) * 0.1;
    }

    // Starts with
    if (t.startsWith(q)) {
      return 0.85;
    }

    // Fuzzy match using Levenshtein distance
    const distance = this.levenshteinDistance(q, t);
    const maxLen = Math.max(q.length, t.length);
    const similarity = 1 - distance / maxLen;

    return similarity;
  }

  /**
   * Find matching indices in the target string
   */
  private findMatchIndices(query: string, target: string): [number, number][] {
    const indices: [number, number][] = [];
    const q = query.toLowerCase();
    const t = target.toLowerCase();

    let lastIndex = 0;
    for (const char of q) {
      const idx = t.indexOf(char, lastIndex);
      if (idx !== -1) {
        indices.push([idx, idx + 1]);
        lastIndex = idx + 1;
      }
    }

    return indices;
  }

  /**
   * Search items
   */
  search<T extends Record<string, unknown>>(
    items: T[],
    query: string
  ): Array<{ item: T; score: number; matches: SearchMatch[] }> {
    const results: Array<{ item: T; score: number; matches: SearchMatch[] }> = [];

    for (const item of items) {
      let bestScore = 0;
      const matches: SearchMatch[] = [];

      for (const key of this.keys) {
        const value = item[key];
        if (typeof value !== "string") continue;

        const score = this.calculateScore(query, value);
        if (score > bestScore) {
          bestScore = score;
        }

        if (score >= this.threshold) {
          matches.push({
            key,
            value,
            indices: this.findMatchIndices(query, value),
          });
        }
      }

      if (bestScore >= this.threshold) {
        results.push({ item, score: bestScore, matches });
      }
    }

    return results.sort((a, b) => b.score - a.score);
  }
}

/**
 * Symbol index for fast lookup
 */
interface SymbolIndex {
  symbols: CodeSymbol[];
  byName: Map<string, CodeSymbol[]>;
  byType: Map<SymbolType, CodeSymbol[]>;
  byFile: Map<string, CodeSymbol[]>;
  timestamp: number;
}

/**
 * Symbol Search Tool
 */
export class SymbolSearch {
  private parser: ASTParser;
  private index: SymbolIndex | null = null;
  private indexedPaths: Set<string> = new Set();
  private cacheTimeout = 5 * 60 * 1000; // 5 minutes

  private excludePatterns = [
    "node_modules",
    "dist",
    "build",
    ".git",
    "coverage",
    "__pycache__",
    ".next",
    ".nuxt",
    "vendor",
  ];

  private includeExtensions = [
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".py",
    ".go",
    ".rs",
    ".java",
  ];

  constructor(parser?: ASTParser) {
    this.parser = parser || getASTParser();
  }

  /**
   * Build or rebuild the symbol index
   */
  async buildIndex(
    rootPath: string,
    forceRebuild = false
  ): Promise<{ symbolCount: number; fileCount: number; buildTime: number }> {
    const startTime = Date.now();

    if (!forceRebuild && this.index && Date.now() - this.index.timestamp < this.cacheTimeout) {
      return {
        symbolCount: this.index.symbols.length,
        fileCount: this.indexedPaths.size,
        buildTime: 0,
      };
    }

    // Discover files
    const files = await this.discoverFiles(rootPath);

    // Parse all files
    const allSymbols: CodeSymbol[] = [];
    const byName = new Map<string, CodeSymbol[]>();
    const byType = new Map<SymbolType, CodeSymbol[]>();
    const byFile = new Map<string, CodeSymbol[]>();

    for (const filePath of files) {
      try {
        const result = await this.parser.parseFile(filePath);
        allSymbols.push(...result.symbols);

        // Index by file
        byFile.set(filePath, result.symbols);

        // Index by name and type
        for (const symbol of result.symbols) {
          // By name
          const nameSymbols = byName.get(symbol.name) || [];
          nameSymbols.push(symbol);
          byName.set(symbol.name, nameSymbols);

          // By type
          const typeSymbols = byType.get(symbol.type) || [];
          typeSymbols.push(symbol);
          byType.set(symbol.type, typeSymbols);
        }

        this.indexedPaths.add(filePath);
      } catch (error) {
        // Skip files that can't be parsed
      }
    }

    this.index = {
      symbols: allSymbols,
      byName,
      byType,
      byFile,
      timestamp: Date.now(),
    };

    return {
      symbolCount: allSymbols.length,
      fileCount: files.length,
      buildTime: Date.now() - startTime,
    };
  }

  /**
   * Search for symbols
   */
  async search(options: SymbolSearchOptions): Promise<SymbolSearchResult[]> {
    if (!this.index) {
      throw new Error("Index not built. Call buildIndex() first.");
    }

    let candidates = [...this.index.symbols];

    // Filter by types
    if (options.types && options.types.length > 0) {
      candidates = candidates.filter((s) => options.types!.includes(s.type));
    }

    // Filter by scopes
    if (options.scopes && options.scopes.length > 0) {
      candidates = candidates.filter((s) => options.scopes!.includes(s.scope));
    }

    // Filter by languages
    if (options.languages && options.languages.length > 0) {
      candidates = candidates.filter((s) => options.languages!.includes(s.language));
    }

    // Filter by file paths
    if (options.filePaths && options.filePaths.length > 0) {
      candidates = candidates.filter((s) =>
        options.filePaths!.some((p) => s.filePath.includes(p))
      );
    }

    // Filter by exclude paths
    if (options.excludePaths && options.excludePaths.length > 0) {
      candidates = candidates.filter((s) =>
        !options.excludePaths!.some((p) => s.filePath.includes(p))
      );
    }

    // Search
    let results: SymbolSearchResult[];

    if (options.fuzzy !== false) {
      // Fuzzy search
      const matcher = new FuzzyMatcher({
        threshold: 0.3,
        keys: ["name", "signature"],
      });

      const fuzzyResults = matcher.search(
        candidates as unknown as Record<string, unknown>[],
        options.query
      );

      results = fuzzyResults.map((r) => ({
        symbol: r.item as unknown as CodeSymbol,
        score: r.score,
        matches: r.matches,
      }));
    } else {
      // Exact/case-sensitive search
      const query = options.caseSensitive
        ? options.query
        : options.query.toLowerCase();

      results = candidates
        .filter((s) => {
          const name = options.caseSensitive ? s.name : s.name.toLowerCase();
          return name.includes(query);
        })
        .map((s) => ({
          symbol: s,
          score: s.name.toLowerCase() === query.toLowerCase() ? 1.0 : 0.8,
        }));
    }

    // Find usages if requested
    if (options.includeUsages) {
      for (const result of results) {
        result.usages = await this.findUsages(result.symbol);
      }
    }

    // Apply max results
    if (options.maxResults && results.length > options.maxResults) {
      results = results.slice(0, options.maxResults);
    }

    return results;
  }

  /**
   * Find usages of a symbol
   */
  async findUsages(symbol: CodeSymbol): Promise<SymbolUsage[]> {
    const usages: SymbolUsage[] = [];

    // Add the definition
    usages.push({
      filePath: symbol.filePath,
      range: symbol.range,
      type: "definition",
      context: symbol.signature,
    });

    // Search for references in indexed files
    for (const [filePath, symbols] of this.index?.byFile || []) {
      if (filePath === symbol.filePath) continue;

      try {
        const content = fs.readFileSync(filePath, "utf-8");
        const lines = content.split("\n");

        // Simple text-based search for the symbol name
        const namePattern = new RegExp(`\\b${this.escapeRegex(symbol.name)}\\b`, "g");

        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
          const line = lines[lineNum];
          let match;

          while ((match = namePattern.exec(line)) !== null) {
            // Determine usage type
            let usageType: SymbolUsage["type"] = "reference";

            // Check if it's a call
            if (line.slice(match.index + symbol.name.length).trimStart().startsWith("(")) {
              usageType = "call";
            }

            // Check if it's an import
            if (line.includes("import") && line.includes(symbol.name)) {
              usageType = "import";
            }

            usages.push({
              filePath,
              range: {
                start: { line: lineNum + 1, column: match.index },
                end: { line: lineNum + 1, column: match.index + symbol.name.length },
              },
              type: usageType,
              context: line.trim().slice(0, 100),
            });
          }
        }
      } catch {
        // Skip files that can't be read
      }
    }

    return usages;
  }

  /**
   * Find cross-references
   */
  async findCrossReferences(
    symbolId: string
  ): Promise<Map<string, SymbolUsage[]>> {
    const crossRefs = new Map<string, SymbolUsage[]>();

    const symbol = this.index?.symbols.find((s) => s.id === symbolId);
    if (!symbol) return crossRefs;

    const usages = await this.findUsages(symbol);

    // Group by file
    for (const usage of usages) {
      const fileUsages = crossRefs.get(usage.filePath) || [];
      fileUsages.push(usage);
      crossRefs.set(usage.filePath, fileUsages);
    }

    return crossRefs;
  }

  /**
   * Find similar symbols
   */
  findSimilarSymbols(symbolId: string, threshold = 0.5): SymbolSearchResult[] {
    const symbol = this.index?.symbols.find((s) => s.id === symbolId);
    if (!symbol) return [];

    const matcher = new FuzzyMatcher({
      threshold,
      keys: ["name"],
    });

    const candidates = this.index!.symbols.filter(
      (s) => s.id !== symbolId && s.type === symbol.type
    );

    return matcher
      .search(candidates as unknown as Record<string, unknown>[], symbol.name)
      .map((r) => ({
        symbol: r.item as unknown as CodeSymbol,
        score: r.score,
        matches: r.matches,
      }));
  }

  /**
   * Get symbols by type
   */
  getSymbolsByType(type: SymbolType): CodeSymbol[] {
    return this.index?.byType.get(type) || [];
  }

  /**
   * Get symbols by file
   */
  getSymbolsByFile(filePath: string): CodeSymbol[] {
    return this.index?.byFile.get(filePath) || [];
  }

  /**
   * Get index statistics
   */
  getIndexStats(): {
    totalSymbols: number;
    totalFiles: number;
    symbolsByType: Record<string, number>;
    symbolsByLanguage: Record<string, number>;
    indexAge: number;
  } {
    if (!this.index) {
      return {
        totalSymbols: 0,
        totalFiles: 0,
        symbolsByType: {},
        symbolsByLanguage: {},
        indexAge: 0,
      };
    }

    const symbolsByType: Record<string, number> = {};
    const symbolsByLanguage: Record<string, number> = {};

    for (const symbol of this.index.symbols) {
      symbolsByType[symbol.type] = (symbolsByType[symbol.type] || 0) + 1;
      symbolsByLanguage[symbol.language] = (symbolsByLanguage[symbol.language] || 0) + 1;
    }

    return {
      totalSymbols: this.index.symbols.length,
      totalFiles: this.index.byFile.size,
      symbolsByType,
      symbolsByLanguage,
      indexAge: Date.now() - this.index.timestamp,
    };
  }

  /**
   * Discover files to index
   */
  private async discoverFiles(rootPath: string): Promise<string[]> {
    const files: string[] = [];

    const walk = (dir: string) => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);

          // Skip excluded directories
          if (entry.isDirectory()) {
            if (!this.excludePatterns.some((p) => entry.name.includes(p))) {
              walk(fullPath);
            }
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (this.includeExtensions.includes(ext)) {
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
   * Escape regex special characters
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /**
   * Clear the index
   */
  clearIndex(): void {
    this.index = null;
    this.indexedPaths.clear();
  }
}

/**
 * Create a symbol search instance
 */
export function createSymbolSearch(parser?: ASTParser): SymbolSearch {
  return new SymbolSearch(parser);
}

// Singleton instance
let symbolSearchInstance: SymbolSearch | null = null;

export function getSymbolSearch(): SymbolSearch {
  if (!symbolSearchInstance) {
    symbolSearchInstance = createSymbolSearch();
  }
  return symbolSearchInstance;
}

export function resetSymbolSearch(): void {
  symbolSearchInstance = null;
}
