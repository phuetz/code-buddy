/**
 * Enhanced Search Module
 *
 * High-performance code search using bundled ripgrep binary.
 * Features:
 * - Streaming search with real-time results
 * - Symbol search (functions, classes, interfaces)
 * - Reference search (find all usages)
 * - Context-aware results with surrounding lines
 * - Smart LRU caching
 *
 * Uses @vscode/ripgrep for bundled binary (no system dependency)
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { rgPath } from '@vscode/ripgrep';

// ============================================================================
// Types
// ============================================================================

export interface SearchMatch {
  file: string;
  line: number;
  column: number;
  text: string;
  match: string;
  contextBefore?: string[];
  contextAfter?: string[];
}

export interface SymbolMatch {
  name: string;
  type: 'function' | 'class' | 'interface' | 'type' | 'const' | 'variable' | 'method' | 'property';
  file: string;
  line: number;
  signature?: string;
  exported: boolean;
}

export interface SearchOptions {
  caseSensitive?: boolean;
  wholeWord?: boolean;
  regex?: boolean;
  maxResults?: number;
  includeGlob?: string[];
  excludeGlob?: string[];
  fileTypes?: string[];
  contextLines?: number;
  includeHidden?: boolean;
  followSymlinks?: boolean;
  timeout?: number;
}

export interface StreamingSearchOptions extends SearchOptions {
  onMatch?: (match: SearchMatch) => void;
  onProgress?: (filesSearched: number, matchCount: number) => void;
  onComplete?: (results: SearchMatch[], stats: SearchStats) => void;
  onError?: (error: Error) => void;
}

export interface SearchStats {
  filesSearched: number;
  matchCount: number;
  duration: number;
  cached: boolean;
}

export interface SymbolSearchOptions {
  types?: SymbolMatch['type'][];
  exportedOnly?: boolean;
  includeGlob?: string[];
  excludeGlob?: string[];
}

// ============================================================================
// Language-specific symbol patterns
// ============================================================================

const SYMBOL_PATTERNS: Record<string, Record<SymbolMatch['type'], string>> = {
  typescript: {
    function: '(export\\s+)?(async\\s+)?function\\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\\s*[<(]',
    class: '(export\\s+)?(abstract\\s+)?class\\s+([a-zA-Z_$][a-zA-Z0-9_$]*)',
    interface: '(export\\s+)?interface\\s+([a-zA-Z_$][a-zA-Z0-9_$]*)',
    type: '(export\\s+)?type\\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\\s*=',
    const: '(export\\s+)?const\\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\\s*[=:]',
    variable: '(export\\s+)?(let|var)\\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\\s*[=:]',
    method: '(async\\s+)?([a-zA-Z_$][a-zA-Z0-9_$]*)\\s*\\([^)]*\\)\\s*[:{]',
    property: '(readonly\\s+)?([a-zA-Z_$][a-zA-Z0-9_$]*)\\s*[?]?\\s*:',
  },
  javascript: {
    function: '(export\\s+)?(async\\s+)?function\\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\\s*\\(',
    class: '(export\\s+)?class\\s+([a-zA-Z_$][a-zA-Z0-9_$]*)',
    interface: '', // JS doesn't have interfaces
    type: '', // JS doesn't have types
    const: '(export\\s+)?const\\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\\s*=',
    variable: '(export\\s+)?(let|var)\\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\\s*=',
    method: '(async\\s+)?([a-zA-Z_$][a-zA-Z0-9_$]*)\\s*\\([^)]*\\)\\s*\\{',
    property: '([a-zA-Z_$][a-zA-Z0-9_$]*)\\s*:',
  },
  python: {
    function: '(async\\s+)?def\\s+([a-zA-Z_][a-zA-Z0-9_]*)\\s*\\(',
    class: 'class\\s+([a-zA-Z_][a-zA-Z0-9_]*)\\s*[:(]',
    interface: '', // Python doesn't have interfaces
    type: '', // Python uses type hints differently
    const: '([A-Z_][A-Z0-9_]*)\\s*=', // Convention for constants
    variable: '([a-z_][a-z0-9_]*)\\s*=',
    method: '(async\\s+)?def\\s+([a-zA-Z_][a-zA-Z0-9_]*)\\s*\\(self',
    property: '@property',
  },
  go: {
    function: 'func\\s+([a-zA-Z_][a-zA-Z0-9_]*)\\s*\\(',
    class: '', // Go doesn't have classes
    interface: 'type\\s+([a-zA-Z_][a-zA-Z0-9_]*)\\s+interface\\s*\\{',
    type: 'type\\s+([a-zA-Z_][a-zA-Z0-9_]*)\\s+',
    const: 'const\\s+([a-zA-Z_][a-zA-Z0-9_]*)\\s*=',
    variable: 'var\\s+([a-zA-Z_][a-zA-Z0-9_]*)\\s+',
    method: 'func\\s+\\([^)]+\\)\\s+([a-zA-Z_][a-zA-Z0-9_]*)\\s*\\(',
    property: '',
  },
  rust: {
    function: '(pub\\s+)?(async\\s+)?fn\\s+([a-zA-Z_][a-zA-Z0-9_]*)\\s*[<(]',
    class: '', // Rust doesn't have classes
    interface: '(pub\\s+)?trait\\s+([a-zA-Z_][a-zA-Z0-9_]*)',
    type: '(pub\\s+)?type\\s+([a-zA-Z_][a-zA-Z0-9_]*)\\s*=',
    const: '(pub\\s+)?const\\s+([A-Z_][A-Z0-9_]*)\\s*:',
    variable: '(pub\\s+)?(let|let mut)\\s+([a-zA-Z_][a-zA-Z0-9_]*)\\s*[=:]',
    method: '(pub\\s+)?(async\\s+)?fn\\s+([a-zA-Z_][a-zA-Z0-9_]*)\\s*\\(&?(mut\\s+)?self',
    property: '(pub\\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\\s*:',
  },
};

// File extensions to language mapping
const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
};

// ============================================================================
// LRU Cache for search results
// ============================================================================

class LRUCache<T> {
  private cache = new Map<string, { value: T; timestamp: number }>();
  private maxSize: number;
  private ttl: number;

  constructor(maxSize: number = 100, ttlMs: number = 60000) {
    this.maxSize = maxSize;
    this.ttl = ttlMs;
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    // Check TTL
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return undefined;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T): void {
    // Delete existing to update order
    this.cache.delete(key);

    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }

    this.cache.set(key, { value, timestamp: Date.now() });
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

// ============================================================================
// Enhanced Search Engine
// ============================================================================

export class EnhancedSearch extends EventEmitter {
  private workdir: string;
  private cache: LRUCache<SearchMatch[]>;
  private symbolCache: LRUCache<SymbolMatch[]>;
  private activeProcesses: Set<ChildProcess> = new Set();

  constructor(workdir: string = process.cwd()) {
    super();
    this.workdir = workdir;
    this.cache = new LRUCache(100, 60000); // 100 entries, 1 min TTL
    this.symbolCache = new LRUCache(50, 120000); // 50 entries, 2 min TTL
  }

  /**
   * Set working directory
   */
  setWorkdir(dir: string): void {
    this.workdir = dir;
  }

  /**
   * Get the ripgrep binary path (bundled)
   */
  getRipgrepPath(): string {
    // Handle Electron asar packaging
    return rgPath.replace(/\.asar([\\/])/, '.asar.unpacked$1');
  }

  // ==========================================================================
  // Streaming Search
  // ==========================================================================

  /**
   * Stream search results in real-time
   * Emits 'match', 'progress', 'complete', 'error' events
   */
  streamSearch(query: string, options: StreamingSearchOptions = {}): ChildProcess {
    const args = this.buildRipgrepArgs(query, options);
    const startTime = Date.now();
    let matchCount = 0;
    let filesSearched = 0;
    const results: SearchMatch[] = [];
    let buffer = '';

    const rg = spawn(this.getRipgrepPath(), args, {
      cwd: this.workdir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.activeProcesses.add(rg);

    rg.stdout.on('data', (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const parsed = JSON.parse(line);

          if (parsed.type === 'match') {
            const match = this.parseMatchData(parsed.data, options.contextLines);
            results.push(match);
            matchCount++;

            options.onMatch?.(match);
            this.emit('match', match);
          } else if (parsed.type === 'begin') {
            filesSearched++;
            options.onProgress?.(filesSearched, matchCount);
            this.emit('progress', { filesSearched, matchCount });
          }
        } catch {
          // Skip invalid JSON
        }
      }
    });

    rg.stderr.on('data', (data: Buffer) => {
      const error = data.toString();
      if (!error.includes('No files were searched')) {
        this.emit('warning', error);
      }
    });

    rg.on('close', (code) => {
      this.activeProcesses.delete(rg);

      // Process remaining buffer
      if (buffer.trim()) {
        try {
          const parsed = JSON.parse(buffer);
          if (parsed.type === 'match') {
            const match = this.parseMatchData(parsed.data, options.contextLines);
            results.push(match);
            matchCount++;
          }
        } catch {
          // Ignore
        }
      }

      const stats: SearchStats = {
        filesSearched,
        matchCount,
        duration: Date.now() - startTime,
        cached: false,
      };

      if (code === 0 || code === 1 || code === 2) {
        // code 0 = matches found, 1 = no matches, 2 = pattern error (still return results)
        // Cache results
        const cacheKey = this.createCacheKey(query, options);
        this.cache.set(cacheKey, results);

        options.onComplete?.(results, stats);
        this.emit('complete', results, stats);
      } else {
        const error = new Error(`Search failed with code ${code}`);
        options.onError?.(error);
        this.emit('error', error);
      }
    });

    rg.on('error', (error) => {
      this.activeProcesses.delete(rg);
      options.onError?.(error);
      this.emit('error', error);
    });

    return rg;
  }

  /**
   * Standard search with Promise API (uses cache)
   */
  async search(query: string, options: SearchOptions = {}): Promise<{ results: SearchMatch[]; stats: SearchStats }> {
    const cacheKey = this.createCacheKey(query, options);
    const cached = this.cache.get(cacheKey);

    if (cached) {
      return {
        results: cached,
        stats: {
          filesSearched: 0,
          matchCount: cached.length,
          duration: 0,
          cached: true,
        },
      };
    }

    return new Promise((resolve, reject) => {
      const results: SearchMatch[] = [];
      const _startTime = Date.now(); // Reserved for performance metrics
      let filesSearched = 0;

      this.streamSearch(query, {
        ...options,
        onMatch: (match) => results.push(match),
        onProgress: (files) => { filesSearched = files; },
        onComplete: (_, stats) => {
          resolve({ results, stats: { ...stats, filesSearched } });
        },
        onError: reject,
      });
    });
  }

  // ==========================================================================
  // Symbol Search
  // ==========================================================================

  /**
   * Find symbols (functions, classes, interfaces, etc.)
   * Uses simple keyword search + post-processing for reliability
   */
  async findSymbols(name: string, options: SymbolSearchOptions = {}): Promise<SymbolMatch[]> {
    const cacheKey = `symbols:${name}:${JSON.stringify(options)}`;
    const cached = this.symbolCache.get(cacheKey);
    if (cached) return cached;

    const symbols: SymbolMatch[] = [];
    const types = options.types || ['function', 'class', 'interface', 'type', 'const'];

    // Build simple search patterns for each type
    const typeKeywords: Record<string, string[]> = {
      function: ['function ', 'async function ', 'def ', 'fn ', 'func '],
      class: ['class '],
      interface: ['interface '],
      type: ['type '],
      const: ['const '],
      variable: ['let ', 'var '],
      method: ['async ', 'public ', 'private ', 'protected '],
      property: [],
    };

    // Search for the symbol name with each type keyword
    const searchPromises: Promise<void>[] = [];

    for (const type of types) {
      const keywords = typeKeywords[type] || [];

      for (const keyword of keywords) {
        searchPromises.push(
          this.search(`${keyword}${name}`, {
            regex: false,
            includeGlob: options.includeGlob,
            excludeGlob: options.excludeGlob,
            maxResults: 50,
          }).then(({ results }) => {
            for (const result of results) {
              const symbol = this.parseSymbolSimple(result, type, options.exportedOnly);
              if (symbol) {
                symbols.push(symbol);
              }
            }
          }).catch((err) => {
            // Log search errors for debugging but continue with other patterns
            if (process.env.DEBUG) {
              console.error(`Symbol search pattern error: ${err.message || String(err)}`);
            }
          })
        );
      }
    }

    // Also do a general search for the name
    searchPromises.push(
      this.search(name, {
        regex: false,
        wholeWord: true,
        includeGlob: options.includeGlob,
        excludeGlob: options.excludeGlob,
        maxResults: 100,
      }).then(({ results }) => {
        for (const result of results) {
          const detectedType = this.detectSymbolType(result.text);
          if (detectedType && types.includes(detectedType)) {
            const symbol = this.parseSymbolSimple(result, detectedType, options.exportedOnly);
            if (symbol) {
              symbols.push(symbol);
            }
          }
        }
      }).catch((err) => {
        // Log search errors for debugging but continue
        if (process.env.DEBUG) {
          console.error(`General symbol search error: ${err.message || String(err)}`);
        }
      })
    );

    await Promise.all(searchPromises);

    // Deduplicate and sort
    const uniqueSymbols = this.deduplicateSymbols(symbols);
    this.symbolCache.set(cacheKey, uniqueSymbols);

    return uniqueSymbols;
  }

  /**
   * Detect symbol type from code line
   */
  private detectSymbolType(text: string): SymbolMatch['type'] | null {
    const trimmed = text.trim();

    if (/^(export\s+)?(async\s+)?function\s/.test(trimmed)) return 'function';
    if (/^(export\s+)?class\s/.test(trimmed)) return 'class';
    if (/^(export\s+)?interface\s/.test(trimmed)) return 'interface';
    if (/^(export\s+)?type\s/.test(trimmed)) return 'type';
    if (/^(export\s+)?const\s/.test(trimmed)) return 'const';
    if (/^(export\s+)?(let|var)\s/.test(trimmed)) return 'variable';
    if (/^(pub\s+)?(async\s+)?fn\s/.test(trimmed)) return 'function'; // Rust
    if (/^def\s/.test(trimmed)) return 'function'; // Python
    if (/^func\s/.test(trimmed)) return 'function'; // Go

    return null;
  }

  /**
   * Parse symbol from search result (simple approach)
   */
  private parseSymbolSimple(
    result: SearchMatch,
    type: SymbolMatch['type'],
    exportedOnly?: boolean
  ): SymbolMatch | null {
    const text = result.text.trim();
    const exported = /^(export|pub)\s/.test(text);

    if (exportedOnly && !exported) return null;

    // Extract symbol name using simple patterns
    let name = '';

    const patterns = [
      /(?:export\s+)?(?:async\s+)?function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/,
      /(?:export\s+)?class\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/,
      /(?:export\s+)?interface\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/,
      /(?:export\s+)?type\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/,
      /(?:export\s+)?const\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/,
      /(?:export\s+)?(?:let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/,
      /(?:pub\s+)?(?:async\s+)?fn\s+([a-zA-Z_][a-zA-Z0-9_]*)/,
      /def\s+([a-zA-Z_][a-zA-Z0-9_]*)/,
      /func\s+([a-zA-Z_][a-zA-Z0-9_]*)/,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        name = match[1];
        break;
      }
    }

    if (!name) return null;

    return {
      name,
      type,
      file: result.file,
      line: result.line,
      signature: text.substring(0, 100),
      exported,
    };
  }

  /**
   * Find all references to a symbol
   */
  async findReferences(symbolName: string, options: SearchOptions = {}): Promise<SearchMatch[]> {
    // Search for the symbol as a whole word
    const { results } = await this.search(symbolName, {
      ...options,
      wholeWord: true,
      contextLines: options.contextLines ?? 2,
    });

    return results;
  }

  /**
   * Find definition of a symbol
   */
  async findDefinition(symbolName: string): Promise<SymbolMatch | null> {
    const symbols = await this.findSymbols(symbolName, {
      types: ['function', 'class', 'interface', 'type', 'const', 'variable'],
    });

    // Return exact match if found
    const exact = symbols.find(s => s.name === symbolName);
    if (exact) return exact;

    // Return first partial match
    return symbols[0] || null;
  }

  // ==========================================================================
  // Multi-pattern Search
  // ==========================================================================

  /**
   * Search for multiple patterns at once
   */
  async searchMultiple(
    patterns: string[],
    options: SearchOptions & { operator?: 'OR' | 'AND' } = {}
  ): Promise<Map<string, SearchMatch[]>> {
    const results = new Map<string, SearchMatch[]>();
    const operator = options.operator || 'OR';

    if (operator === 'OR') {
      // Combine patterns with |
      const combinedPattern = patterns.map(p => `(${p})`).join('|');
      const { results: matches } = await this.search(combinedPattern, {
        ...options,
        regex: true,
      });

      // Group results by pattern
      for (const pattern of patterns) {
        const regex = new RegExp(pattern, options.caseSensitive ? '' : 'i');
        results.set(pattern, matches.filter(m => regex.test(m.text)));
      }
    } else {
      // AND: find files matching all patterns
      const matchesByFile = new Map<string, Set<string>>();

      for (const pattern of patterns) {
        const { results: matches } = await this.search(pattern, options);

        for (const match of matches) {
          if (!matchesByFile.has(match.file)) {
            matchesByFile.set(match.file, new Set());
          }
          matchesByFile.get(match.file)!.add(pattern);
        }
      }

      // Filter files that have all patterns
      const filesWithAll = Array.from(matchesByFile.entries())
        .filter(([_, patternSet]) => patternSet.size === patterns.length)
        .map(([file]) => file);

      // Re-search in those files only
      for (const pattern of patterns) {
        const { results: matches } = await this.search(pattern, {
          ...options,
          includeGlob: filesWithAll,
        });
        results.set(pattern, matches);
      }
    }

    return results;
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  /**
   * Cancel all active searches
   */
  cancelAll(): void {
    for (const process of this.activeProcesses) {
      process.kill('SIGTERM');
    }
    this.activeProcesses.clear();
  }

  /**
   * Clear caches
   */
  clearCache(): void {
    this.cache.clear();
    this.symbolCache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { searchCache: number; symbolCache: number } {
    return {
      searchCache: this.cache.size,
      symbolCache: this.symbolCache.size,
    };
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private buildRipgrepArgs(query: string, options: SearchOptions): string[] {
    const args = [
      '--json',
      '--with-filename',
      '--line-number',
      '--column',
      '--no-heading',
      '--color=never',
    ];

    // Case sensitivity
    if (!options.caseSensitive) {
      args.push('--ignore-case');
    }

    // Whole word
    if (options.wholeWord) {
      args.push('--word-regexp');
    }

    // Regex mode
    if (!options.regex) {
      args.push('--fixed-strings');
    }

    // Max results
    if (options.maxResults) {
      args.push('--max-count', options.maxResults.toString());
    }

    // Context lines
    if (options.contextLines && options.contextLines > 0) {
      args.push('--context', options.contextLines.toString());
    }

    // File types
    if (options.fileTypes?.length) {
      for (const type of options.fileTypes) {
        args.push('--type', type);
      }
    }

    // Include globs
    if (options.includeGlob?.length) {
      for (const glob of options.includeGlob) {
        args.push('--glob', glob);
      }
    }

    // Exclude globs
    if (options.excludeGlob?.length) {
      for (const glob of options.excludeGlob) {
        args.push('--glob', `!${glob}`);
      }
    }

    // Hidden files
    if (options.includeHidden) {
      args.push('--hidden');
    }

    // Follow symlinks
    if (options.followSymlinks) {
      args.push('--follow');
    }

    // Default excludes
    args.push(
      '--glob', '!.git/**',
      '--glob', '!node_modules/**',
      '--glob', '!*.lock',
      '--glob', '!*.log'
    );

    // Add query
    args.push(query);

    return args;
  }

  private parseMatchData(data: any, contextLines?: number): SearchMatch {
    const match: SearchMatch = {
      file: data.path?.text || '',
      line: data.line_number || 0,
      column: data.submatches?.[0]?.start || 0,
      text: data.lines?.text?.trim() || '',
      match: data.submatches?.[0]?.match?.text || '',
    };

    // Parse context if available
    if (contextLines && data.context) {
      match.contextBefore = [];
      match.contextAfter = [];
      // Context parsing would go here
    }

    return match;
  }

  private parseSymbol(
    result: SearchMatch,
    type: SymbolMatch['type'],
    lang: string,
    exportedOnly?: boolean
  ): SymbolMatch | null {
    const text = result.text;

    // Check if exported
    const exported = /^(export|pub)\s/.test(text);
    if (exportedOnly && !exported) return null;

    // Extract symbol name based on type and language
    let name = '';
    const patterns = SYMBOL_PATTERNS[lang];
    if (!patterns) return null;

    const pattern = patterns[type];
    if (!pattern) return null;

    const regex = new RegExp(pattern);
    const match = text.match(regex);

    if (match) {
      // Find the capture group with the name (usually last non-empty one)
      for (let i = match.length - 1; i >= 1; i--) {
        if (match[i] && /^[a-zA-Z_$]/.test(match[i])) {
          name = match[i];
          break;
        }
      }
    }

    if (!name) return null;

    return {
      name,
      type,
      file: result.file,
      line: result.line,
      signature: text.trim(),
      exported,
    };
  }

  private deduplicateSymbols(symbols: SymbolMatch[]): SymbolMatch[] {
    const seen = new Map<string, SymbolMatch>();

    for (const symbol of symbols) {
      const key = `${symbol.file}:${symbol.line}:${symbol.name}`;
      if (!seen.has(key)) {
        seen.set(key, symbol);
      }
    }

    return Array.from(seen.values())
      .sort((a, b) => {
        // Sort by: exact name match first, then exported, then alphabetically
        if (a.exported !== b.exported) return a.exported ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  }

  private getGlobsForLanguage(lang: string, options: SymbolSearchOptions): string[] {
    const globs: string[] = options.includeGlob || [];

    // Add language-specific globs
    const extensions = Object.entries(EXTENSION_TO_LANGUAGE)
      .filter(([_, l]) => l === lang)
      .map(([ext]) => `**/*${ext}`);

    return [...globs, ...extensions];
  }

  private createCacheKey(query: string, options: SearchOptions): string {
    return JSON.stringify({
      query,
      workdir: this.workdir,
      caseSensitive: options.caseSensitive,
      wholeWord: options.wholeWord,
      regex: options.regex,
      maxResults: options.maxResults,
      includeGlob: options.includeGlob,
      excludeGlob: options.excludeGlob,
      fileTypes: options.fileTypes,
    });
  }
}

// ============================================================================
// Singleton instance
// ============================================================================

let enhancedSearchInstance: EnhancedSearch | null = null;

export function getEnhancedSearch(workdir?: string): EnhancedSearch {
  if (!enhancedSearchInstance) {
    enhancedSearchInstance = new EnhancedSearch(workdir);
  } else if (workdir) {
    enhancedSearchInstance.setWorkdir(workdir);
  }
  return enhancedSearchInstance;
}

export function resetEnhancedSearch(): void {
  if (enhancedSearchInstance) {
    enhancedSearchInstance.cancelAll();
    enhancedSearchInstance.clearCache();
  }
  enhancedSearchInstance = null;
}
