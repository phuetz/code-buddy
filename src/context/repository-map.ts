/**
 * Repository Map - Aider-inspired code context system
 *
 * Based on research from:
 * - Aider's repository map with PageRank-style ranking
 * - CodeRAG paper for dependency-aware retrieval
 * - JetBrains context compression research
 *
 * This module provides intelligent code context by:
 * 1. Building a symbol graph of the codebase
 * 2. Ranking symbols by reference frequency (PageRank-inspired)
 * 3. Dynamically fitting context to token budget
 * 4. Prioritizing relevant code based on current task
 */

import { promises as fsPromises } from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger.js';

// Symbol types for the repository map
type SymbolKind = 'class' | 'function' | 'method' | 'interface' | 'type' | 'variable' | 'import' | 'export';

interface Symbol {
  name: string;
  kind: SymbolKind;
  filePath: string;
  line: number;
  endLine?: number;
  signature?: string;
  references: string[]; // Files that reference this symbol
  definitions: string[]; // Files where this symbol is defined
}

interface FileInfo {
  path: string;
  relativePath: string;
  symbols: Symbol[];
  imports: string[];
  exports: string[];
  rank: number; // PageRank-style importance score
  lastModified: number;
}

interface RepoMapConfig {
  rootDir: string;
  maxTokens: number;
  includePatterns: string[];
  excludePatterns: string[];
  maxFileSize: number;
  cacheEnabled: boolean;
}

const DEFAULT_CONFIG: Partial<RepoMapConfig> = {
  maxTokens: 4000,
  includePatterns: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.py', '**/*.go', '**/*.rs'],
  excludePatterns: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**', '**/coverage/**'],
  maxFileSize: 100000, // 100KB
  cacheEnabled: true,
};

/**
 * Repository Map class - builds and maintains a ranked symbol index
 */
export class RepositoryMap {
  private config: RepoMapConfig;
  private files: Map<string, FileInfo> = new Map();
  private symbols: Map<string, Symbol> = new Map();
  private referenceGraph: Map<string, Set<string>> = new Map();
  private initialized = false;
  private cache: Map<string, string> = new Map();

  constructor(config: Partial<RepoMapConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config } as RepoMapConfig;
  }

  /**
   * Initialize the repository map by scanning the codebase
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    const startTime = Date.now();

    // Scan files
    await this.scanDirectory(this.config.rootDir);

    // Build symbol graph
    await this.buildSymbolGraph();

    // Calculate PageRank scores
    this.calculateRanks();

    this.initialized = true;

    const elapsed = Date.now() - startTime;
    logger.debug(`[RepoMap] Initialized in ${elapsed}ms with ${this.files.size} files and ${this.symbols.size} symbols`);
  }

  /**
   * Get repository map context for a given query/task
   */
  getContext(query: string, relevantFiles: string[] = [], maxTokens?: number): string {
    const budget = maxTokens || this.config.maxTokens;
    const cacheKey = `${query}-${relevantFiles.join(',')}-${budget}`;

    if (this.config.cacheEnabled && this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    // Score files based on relevance to query and PageRank
    const scoredFiles = this.scoreFiles(query, relevantFiles);

    // Build context within token budget
    const context = this.buildContext(scoredFiles, budget);

    if (this.config.cacheEnabled) {
      this.cache.set(cacheKey, context);
    }

    return context;
  }

  /**
   * Get a compact map showing file structure and key symbols
   */
  getCompactMap(maxTokens: number = 2000): string {
    const sortedFiles = Array.from(this.files.values())
      .sort((a, b) => b.rank - a.rank);

    let output = '# Repository Map\n\n';
    let tokenEstimate = 20; // Header tokens

    for (const file of sortedFiles) {
      const fileSection = this.formatFileCompact(file);
      const sectionTokens = this.estimateTokens(fileSection);

      if (tokenEstimate + sectionTokens > maxTokens) break;

      output += fileSection;
      tokenEstimate += sectionTokens;
    }

    return output;
  }

  /**
   * Get symbols related to a specific file
   */
  getRelatedSymbols(filePath: string): Symbol[] {
    const file = this.files.get(filePath);
    if (!file) return [];

    const related: Symbol[] = [];

    // Get symbols defined in this file
    related.push(...file.symbols);

    // Get symbols from imported files
    for (const importPath of file.imports) {
      const importedFile = this.files.get(importPath);
      if (importedFile) {
        related.push(...importedFile.symbols.filter(s => s.kind === 'export'));
      }
    }

    return related;
  }

  /**
   * Update the map when a file changes
   */
  async updateFile(filePath: string): Promise<void> {
    const absolutePath = path.resolve(this.config.rootDir, filePath);

    const exists = await fsPromises.access(absolutePath).then(() => true).catch(() => false);
    if (!exists) {
      // File deleted
      this.files.delete(absolutePath);
      this.symbols.forEach((symbol, key) => {
        if (symbol.filePath === absolutePath) {
          this.symbols.delete(key);
        }
      });
    } else {
      // File added/modified
      await this.processFile(absolutePath);
    }

    // Recalculate ranks
    this.calculateRanks();

    // Clear cache
    this.cache.clear();
  }

  // Private methods

  private async scanDirectory(dir: string): Promise<void> {
    const entries = await fsPromises.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(this.config.rootDir, fullPath);

      // Check exclusions
      if (this.isExcluded(relativePath)) continue;

      if (entry.isDirectory()) {
        await this.scanDirectory(fullPath);
      } else if (entry.isFile() && this.isIncluded(relativePath)) {
        await this.processFile(fullPath);
      }
    }
  }

  private isExcluded(relativePath: string): boolean {
    return this.config.excludePatterns.some(pattern => {
      const regex = this.globToRegex(pattern);
      return regex.test(relativePath);
    });
  }

  private isIncluded(relativePath: string): boolean {
    return this.config.includePatterns.some(pattern => {
      const regex = this.globToRegex(pattern);
      return regex.test(relativePath);
    });
  }

  private globToRegex(glob: string): RegExp {
    const escaped = glob
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '{{GLOBSTAR}}')
      .replace(/\*/g, '[^/]*')
      .replace(/{{GLOBSTAR}}/g, '.*');
    return new RegExp(`^${escaped}$`);
  }

  private async processFile(filePath: string): Promise<void> {
    try {
      const stats = await fsPromises.stat(filePath);

      // Skip large files
      if (stats.size > this.config.maxFileSize) return;

      const content = await fsPromises.readFile(filePath, 'utf-8');
      const relativePath = path.relative(this.config.rootDir, filePath);

      const fileInfo: FileInfo = {
        path: filePath,
        relativePath,
        symbols: [],
        imports: [],
        exports: [],
        rank: 0,
        lastModified: stats.mtimeMs,
      };

      // Extract symbols based on file type
      const ext = path.extname(filePath);
      if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
        this.extractTypeScriptSymbols(content, fileInfo);
      } else if (ext === '.py') {
        this.extractPythonSymbols(content, fileInfo);
      }

      this.files.set(filePath, fileInfo);

      // Register symbols
      for (const symbol of fileInfo.symbols) {
        const symbolKey = `${symbol.name}:${symbol.kind}`;
        this.symbols.set(symbolKey, symbol);
      }
    } catch (_error) {
      // Skip files that can't be read
    }
  }

  private extractTypeScriptSymbols(content: string, fileInfo: FileInfo): void {
    const lines = content.split('\n');

    // Regex patterns for TypeScript/JavaScript symbols
    const patterns = {
      class: /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/,
      interface: /^(?:export\s+)?interface\s+(\w+)/,
      type: /^(?:export\s+)?type\s+(\w+)/,
      function: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/,
      constFunc: /^(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?\(/,
      arrowFunc: /^(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*(?::\s*\w+)?\s*=>/,
      method: /^\s+(?:async\s+)?(\w+)\s*\([^)]*\)\s*(?::\s*\w+)?\s*{/,
      import: /^import\s+(?:{[^}]+}|[^{]+)\s+from\s+['"]([^'"]+)['"]/,
      export: /^export\s+{([^}]+)}/,
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Check each pattern
      for (const [kind, pattern] of Object.entries(patterns)) {
        const match = line.match(pattern);
        if (match) {
          if (kind === 'import') {
            fileInfo.imports.push(match[1]);
          } else if (kind === 'export') {
            fileInfo.exports.push(...match[1].split(',').map(s => s.trim()));
          } else {
            const symbolKind = kind === 'constFunc' || kind === 'arrowFunc' ? 'function' : kind as SymbolKind;
            fileInfo.symbols.push({
              name: match[1],
              kind: symbolKind,
              filePath: fileInfo.path,
              line: lineNum,
              signature: this.extractSignature(lines, i),
              references: [],
              definitions: [fileInfo.path],
            });
          }
        }
      }
    }
  }

  private extractPythonSymbols(content: string, fileInfo: FileInfo): void {
    const lines = content.split('\n');

    const patterns = {
      class: /^class\s+(\w+)/,
      function: /^def\s+(\w+)/,
      method: /^\s+def\s+(\w+)/,
      import: /^(?:from\s+(\S+)\s+)?import\s+/,
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      for (const [kind, pattern] of Object.entries(patterns)) {
        const match = line.match(pattern);
        if (match) {
          if (kind === 'import') {
            if (match[1]) fileInfo.imports.push(match[1]);
          } else {
            fileInfo.symbols.push({
              name: match[1],
              kind: kind as SymbolKind,
              filePath: fileInfo.path,
              line: lineNum,
              signature: line.trim(),
              references: [],
              definitions: [fileInfo.path],
            });
          }
        }
      }
    }
  }

  private extractSignature(lines: string[], startLine: number): string {
    let signature = lines[startLine].trim();

    // For multi-line signatures, collect until we find the opening brace or colon
    let i = startLine;
    while (i < lines.length && !signature.includes('{') && !signature.includes(':') && i - startLine < 5) {
      i++;
      if (i < lines.length) {
        signature += ' ' + lines[i].trim();
      }
    }

    // Clean up the signature
    signature = signature.replace(/\s+/g, ' ').replace(/\{.*$/, '').trim();

    return signature;
  }

  private async buildSymbolGraph(): Promise<void> {
    // Build reference graph by scanning for symbol usage
    for (const [, file] of this.files) {
      const content = await fsPromises.readFile(file.path, 'utf-8');

      for (const [, symbol] of this.symbols) {
        // Skip if same file (self-reference)
        if (symbol.filePath === file.path) continue;

        // Check if symbol name appears in file content
        const regex = new RegExp(`\\b${symbol.name}\\b`);
        if (regex.test(content)) {
          symbol.references.push(file.path);

          // Update reference graph
          if (!this.referenceGraph.has(symbol.filePath)) {
            this.referenceGraph.set(symbol.filePath, new Set());
          }
          this.referenceGraph.get(symbol.filePath)!.add(file.path);
        }
      }
    }
  }

  private calculateRanks(): void {
    // PageRank-inspired ranking algorithm
    const dampingFactor = 0.85;
    const iterations = 10;

    // Initialize ranks
    for (const [, file] of this.files) {
      file.rank = 1.0 / this.files.size;
    }

    // Iterate PageRank
    for (let iter = 0; iter < iterations; iter++) {
      const newRanks = new Map<string, number>();

      for (const [filePath, file] of this.files) {
        let rank = (1 - dampingFactor) / this.files.size;

        // Sum contributions from files that reference this file
        for (const [otherPath, refs] of this.referenceGraph) {
          if (refs.has(filePath)) {
            const otherFile = this.files.get(otherPath);
            if (otherFile) {
              rank += dampingFactor * (otherFile.rank / refs.size);
            }
          }
        }

        // Boost for recently modified files
        const daysSinceModified = (Date.now() - file.lastModified) / (1000 * 60 * 60 * 24);
        const recencyBoost = Math.exp(-daysSinceModified / 30); // Decay over 30 days
        rank *= (1 + 0.2 * recencyBoost);

        // Boost for files with more symbols
        rank *= (1 + 0.1 * Math.log(1 + file.symbols.length));

        newRanks.set(filePath, rank);
      }

      // Update ranks
      for (const [filePath, rank] of newRanks) {
        const file = this.files.get(filePath);
        if (file) file.rank = rank;
      }
    }

    // Normalize ranks
    const maxRank = Math.max(...Array.from(this.files.values()).map(f => f.rank));
    if (maxRank > 0) {
      for (const [, file] of this.files) {
        file.rank /= maxRank;
      }
    }
  }

  private scoreFiles(query: string, relevantFiles: string[]): FileInfo[] {
    const queryTerms = query.toLowerCase().split(/\s+/);
    const relevantSet = new Set(relevantFiles.map(f => path.resolve(this.config.rootDir, f)));

    const scored = Array.from(this.files.values()).map(file => {
      let score = file.rank;

      // Boost for explicitly relevant files
      if (relevantSet.has(file.path)) {
        score *= 3;
      }

      // Boost for query term matches in path or symbols
      const pathLower = file.relativePath.toLowerCase();
      for (const term of queryTerms) {
        if (pathLower.includes(term)) {
          score *= 1.5;
        }
        for (const symbol of file.symbols) {
          if (symbol.name.toLowerCase().includes(term)) {
            score *= 1.3;
          }
        }
      }

      return { ...file, score };
    });

    return scored.sort((a, b) => b.score - a.score);
  }

  private buildContext(files: FileInfo[], maxTokens: number): string {
    let context = '# Repository Context\n\n';
    let tokenCount = this.estimateTokens(context);

    for (const file of files) {
      const section = this.formatFileContext(file);
      const sectionTokens = this.estimateTokens(section);

      if (tokenCount + sectionTokens > maxTokens) {
        // Try compact version
        const compact = this.formatFileCompact(file);
        const compactTokens = this.estimateTokens(compact);

        if (tokenCount + compactTokens <= maxTokens) {
          context += compact;
          tokenCount += compactTokens;
        } else {
          break;
        }
      } else {
        context += section;
        tokenCount += sectionTokens;
      }
    }

    return context;
  }

  private formatFileContext(file: FileInfo): string {
    let output = `## ${file.relativePath}\n`;

    if (file.symbols.length > 0) {
      output += '\n### Symbols:\n';
      for (const symbol of file.symbols) {
        output += `- ${symbol.kind}: ${symbol.signature || symbol.name} (line ${symbol.line})\n`;
      }
    }

    if (file.imports.length > 0) {
      output += '\n### Dependencies:\n';
      for (const imp of file.imports.slice(0, 10)) {
        output += `- ${imp}\n`;
      }
    }

    output += '\n';
    return output;
  }

  private formatFileCompact(file: FileInfo): string {
    const symbolNames = file.symbols.map(s => s.name).join(', ');
    return `- ${file.relativePath}: ${symbolNames || '(no symbols)'}\n`;
  }

  private estimateTokens(text: string): number {
    // Rough estimation: ~4 characters per token
    return Math.ceil(text.length / 4);
  }

  /**
   * Dispose resources and cleanup
   */
  dispose(): void {
    // RepositoryMap doesn't extend EventEmitter, no need to call removeAllListeners
    this.files.clear();
    this.symbols.clear();
    this.referenceGraph.clear();
    this.cache.clear();
  }
}

// Singleton instance
let repoMapInstance: RepositoryMap | null = null;

export function getRepositoryMap(rootDir?: string): RepositoryMap {
  if (!repoMapInstance && rootDir) {
    repoMapInstance = new RepositoryMap({ rootDir });
  }
  if (!repoMapInstance) {
    throw new Error('RepositoryMap not initialized. Call with rootDir first.');
  }
  return repoMapInstance;
}

export function resetRepositoryMap(): void {
  if (repoMapInstance) {
    repoMapInstance.dispose();
  }
  repoMapInstance = null;
}
