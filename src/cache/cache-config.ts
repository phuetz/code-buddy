/**
 * Cache Configuration
 *
 * Centralized configuration for all caching subsystems.
 * Provides sensible defaults based on research and best practices.
 */

export interface CacheLayerConfig {
  enabled: boolean;
  ttlMs: number;
  maxEntries: number;
  persistToDisk: boolean;
  compressionEnabled: boolean;
}

export interface UnifiedCacheConfig {
  /** Global cache enable/disable */
  enabled: boolean;

  /** Base directory for persistent cache files */
  cacheDir: string;

  /** LLM Response Cache - caches similar queries to reduce API calls */
  llmResponse: CacheLayerConfig & {
    similarityThreshold: number;
    minTokensToCache: number;
    costPerMillion: number;
  };

  /** File Content Cache - caches file reads with hash-based invalidation */
  fileContent: CacheLayerConfig & {
    maxFileSizeBytes: number;
    watchForChanges: boolean;
  };

  /** Embedding Cache - caches vector embeddings for RAG */
  embedding: CacheLayerConfig & {
    dimension: number;
    modelName: string;
  };

  /** Search Results Cache - caches search/grep results */
  searchResults: CacheLayerConfig & {
    invalidateOnFileChange: boolean;
  };

  /** Tool Results Cache - caches deterministic tool calls */
  toolResults: CacheLayerConfig & {
    cacheableTools: string[];
    excludePatterns: RegExp[];
  };
}

/**
 * Default cache configuration
 */
export const DEFAULT_CACHE_CONFIG: UnifiedCacheConfig = {
  enabled: true,
  cacheDir: '.codebuddy/cache',

  llmResponse: {
    enabled: true,
    ttlMs: 10 * 60 * 1000, // 10 minutes
    maxEntries: 500,
    persistToDisk: true,
    compressionEnabled: true,
    similarityThreshold: 0.92, // High threshold for semantic matching
    minTokensToCache: 100,
    costPerMillion: 3.0,
  },

  fileContent: {
    enabled: true,
    ttlMs: 5 * 60 * 1000, // 5 minutes
    maxEntries: 1000,
    persistToDisk: false, // Memory only for fast access
    compressionEnabled: false,
    maxFileSizeBytes: 1024 * 1024, // 1MB max
    watchForChanges: true,
  },

  embedding: {
    enabled: true,
    ttlMs: 60 * 60 * 1000, // 1 hour
    maxEntries: 10000,
    persistToDisk: true,
    compressionEnabled: true,
    dimension: 384,
    modelName: 'code-embedding',
  },

  searchResults: {
    enabled: true,
    ttlMs: 2 * 60 * 1000, // 2 minutes
    maxEntries: 200,
    persistToDisk: false,
    compressionEnabled: false,
    invalidateOnFileChange: true,
  },

  toolResults: {
    enabled: true,
    ttlMs: 5 * 60 * 1000, // 5 minutes
    maxEntries: 500,
    persistToDisk: true,
    compressionEnabled: false,
    cacheableTools: [
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
      'git_diff',
    ],
    excludePatterns: [
      /--force/i,
      /--no-cache/i,
      /random|uuid|timestamp/i,
    ],
  },
};

/**
 * Performance-optimized config (aggressive caching)
 */
export const PERFORMANCE_CACHE_CONFIG: Partial<UnifiedCacheConfig> = {
  llmResponse: {
    ...DEFAULT_CACHE_CONFIG.llmResponse,
    ttlMs: 30 * 60 * 1000, // 30 minutes
    maxEntries: 1000,
    similarityThreshold: 0.88, // Slightly lower for more hits
  },
  fileContent: {
    ...DEFAULT_CACHE_CONFIG.fileContent,
    ttlMs: 15 * 60 * 1000, // 15 minutes
    maxEntries: 2000,
  },
  embedding: {
    ...DEFAULT_CACHE_CONFIG.embedding,
    ttlMs: 24 * 60 * 60 * 1000, // 24 hours
    maxEntries: 50000,
  },
};

/**
 * Memory-efficient config (reduced caching)
 */
export const MEMORY_EFFICIENT_CACHE_CONFIG: Partial<UnifiedCacheConfig> = {
  llmResponse: {
    ...DEFAULT_CACHE_CONFIG.llmResponse,
    maxEntries: 100,
    persistToDisk: true, // Offload to disk
  },
  fileContent: {
    ...DEFAULT_CACHE_CONFIG.fileContent,
    maxEntries: 200,
    maxFileSizeBytes: 256 * 1024, // 256KB max
  },
  embedding: {
    ...DEFAULT_CACHE_CONFIG.embedding,
    maxEntries: 2000,
    persistToDisk: true,
  },
};

/**
 * Get environment-aware cache config
 */
export function getCacheConfig(): UnifiedCacheConfig {
  const config = { ...DEFAULT_CACHE_CONFIG };

  // Check environment variables
  if (process.env.CODEBUDDY_CACHE_DISABLED === 'true') {
    config.enabled = false;
  }

  if (process.env.CODEBUDDY_CACHE_DIR) {
    config.cacheDir = process.env.CODEBUDDY_CACHE_DIR;
  }

  // Performance mode
  if (process.env.CODEBUDDY_CACHE_MODE === 'performance') {
    return { ...config, ...PERFORMANCE_CACHE_CONFIG } as UnifiedCacheConfig;
  }

  // Memory-efficient mode
  if (process.env.CODEBUDDY_CACHE_MODE === 'memory') {
    return { ...config, ...MEMORY_EFFICIENT_CACHE_CONFIG } as UnifiedCacheConfig;
  }

  return config;
}
