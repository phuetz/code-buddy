/**
 * Tool Cache
 *
 * Caches results of deterministic tool calls to avoid redundant operations.
 * Uses semantic similarity to match similar queries.
 */

import { EventEmitter } from 'events';
import { SemanticCache } from '../utils/semantic-cache.js';
import { ToolResult } from '../types/index.js';

// ============================================================================
// Types
// ============================================================================

export interface ToolCacheConfig {
  enabled: boolean;
  ttlMs: number;
  maxEntries: number;
  /** Persist entries to disk (default true). Tests set false to stay hermetic. */
  persistToDisk?: boolean;
  /** On-disk location, relative to the working directory by default. */
  cachePath?: string;
  similarityThreshold: number;
  cacheableTools: Set<string>;
  excludePatterns: RegExp[];
}

export interface CachedToolResult extends ToolResult {
  cached: boolean;
  cacheKey?: string;
  similarity?: number;
}

export interface ToolCacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  savedCalls: number;
  savedTime: number; // Estimated ms saved
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: ToolCacheConfig = {
  enabled: true,
  ttlMs: 5 * 60 * 1000, // 5 minutes
  maxEntries: 500,
  persistToDisk: true,
  cachePath: '.codebuddy/cache/tool-cache.json',
  similarityThreshold: 0.9,
  cacheableTools: new Set([
    'search',
    'grep',
    'rg',
    'glob',
    'find_files',
    'list_files',
    'view_file',
    'symbol_search',
    'find_references',
    'web_search',
    'git_status',
    'git_log',
  ]),
  excludePatterns: [
    /--force/i,
    /--no-cache/i,
    /random|uuid|timestamp/i,
  ],
};

// Tools that modify state (never cache)
const MUTABLE_TOOLS = new Set([
  'bash',
  'str_replace_editor',
  'create_file',
  'delete_file',
  'move_file',
  'git_commit',
  'git_push',
  'git_checkout',
  'npm_install',
]);

// ============================================================================
// Tool Cache Class
// ============================================================================

export class ToolCache extends EventEmitter {
  private cache: SemanticCache<ToolResult>;
  private config: ToolCacheConfig;
  private stats: ToolCacheStats;
  private avgToolTime: number = 500; // Estimated average tool execution time in ms

  constructor(config: Partial<ToolCacheConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.cache = new SemanticCache<ToolResult>({
      maxEntries: this.config.maxEntries,
      ttlMs: this.config.ttlMs,
      similarityThreshold: this.config.similarityThreshold,
      persistToDisk: this.config.persistToDisk ?? true,
      cachePath: this.config.cachePath ?? '.codebuddy/cache/tool-cache.json',
    });
    this.stats = {
      hits: 0,
      misses: 0,
      hitRate: 0,
      savedCalls: 0,
      savedTime: 0,
    };

    // Forward cache events
    this.cache.on('cache:hit', (data) => this.emit('hit', data));
    this.cache.on('cache:miss', (data) => this.emit('miss', data));
  }

  /**
   * Check if a tool call can be cached
   */
  isCacheable(toolName: string, args: Record<string, unknown>): boolean {
    if (!this.config.enabled) return false;

    // Never cache mutable tools
    if (MUTABLE_TOOLS.has(toolName)) return false;

    // Check if tool is in cacheable list
    if (!this.config.cacheableTools.has(toolName)) return false;

    // Check exclude patterns
    const argsStr = JSON.stringify(args);
    for (const pattern of this.config.excludePatterns) {
      if (pattern.test(argsStr)) return false;
    }

    return true;
  }

  /**
   * Get cached result or execute tool
   */
  async getOrExecute(
    toolName: string,
    args: Record<string, unknown>,
    executeFn: () => Promise<ToolResult>
  ): Promise<CachedToolResult> {
    // Check if cacheable
    if (!this.isCacheable(toolName, args)) {
      const result = await executeFn();
      return { ...result, cached: false };
    }

    // Create cache key
    const cacheKey = this.createCacheKey(toolName, args);

    // Try cache
    const { result, cached, similarity } = await this.cache.getOrCompute(
      cacheKey,
      executeFn,
      { toolName, args }
    );

    // Update stats
    if (cached) {
      this.stats.hits++;
      this.stats.savedCalls++;
      this.stats.savedTime += this.avgToolTime;
    } else {
      this.stats.misses++;
    }
    this.updateHitRate();

    return {
      ...result,
      cached,
      cacheKey,
      similarity,
    };
  }

  /**
   * Invalidate cache for specific tool or pattern
   */
  invalidate(toolName?: string, pattern?: string | RegExp): number {
    if (toolName) {
      return this.cache.invalidate(new RegExp(`^${toolName}:`));
    }
    if (pattern) {
      return this.cache.invalidate(pattern);
    }
    return 0;
  }

  /**
   * Invalidate cache entries affected by file changes
   */
  invalidateForFile(filePath: string): number {
    // Invalidate any cache entries that reference this file
    return this.cache.invalidate(new RegExp(filePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  /**
   * Clear entire cache
   */
  clear(): void {
    this.cache.clear();
    this.resetStats();
  }

  /**
   * Get cache statistics
   */
  getStats(): ToolCacheStats {
    return { ...this.stats };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      hits: 0,
      misses: 0,
      hitRate: 0,
      savedCalls: 0,
      savedTime: 0,
    };
  }

  /**
   * Get detailed cache info
   */
  getCacheInfo(): {
    stats: ToolCacheStats;
    cacheStats: ReturnType<SemanticCache['getStats']>;
    config: ToolCacheConfig;
  } {
    return {
      stats: this.getStats(),
      cacheStats: this.cache.getStats(),
      config: { ...this.config },
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ToolCacheConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Dispose cache
   */
  dispose(): void {
    this.cache.dispose();
    this.removeAllListeners();
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private createCacheKey(toolName: string, args: Record<string, unknown>): string {
    // Sort args for consistent key
    const sortedArgs = Object.keys(args)
      .sort()
      .map((k) => `${k}=${JSON.stringify(args[k])}`)
      .join('&');
    return `${toolName}:${sortedArgs}`;
  }

  private updateHitRate(): void {
    const total = this.stats.hits + this.stats.misses;
    this.stats.hitRate = total > 0 ? this.stats.hits / total : 0;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let toolCacheInstance: ToolCache | null = null;

export function getToolCache(config?: Partial<ToolCacheConfig>): ToolCache {
  if (!toolCacheInstance) {
    toolCacheInstance = new ToolCache(config);
  }
  return toolCacheInstance;
}

export function resetToolCache(): void {
  if (toolCacheInstance) {
    toolCacheInstance.dispose();
  }
  toolCacheInstance = null;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Wrap a tool executor with caching
 */
export function withCache<T extends ToolResult>(
  toolName: string,
  args: Record<string, unknown>,
  executeFn: () => Promise<T>
): Promise<T & { cached: boolean }> {
  const cache = getToolCache();
  return cache.getOrExecute(toolName, args, executeFn) as Promise<T & { cached: boolean }>;
}

/**
 * Decorator for caching tool methods
 */
export function Cacheable(toolName?: string) {
  return function (
    _target: unknown,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;
    const name = toolName || propertyKey;

    descriptor.value = async function (this: unknown, ...args: unknown[]) {
      const cache = getToolCache();
      const argsObj = (args[0] as Record<string, unknown>) || {};

      if (!cache.isCacheable(name, argsObj)) {
        return originalMethod.apply(this, args);
      }

      return cache.getOrExecute(name, argsObj, () =>
        originalMethod.apply(this, args)
      );
    };

    return descriptor;
  };
}
