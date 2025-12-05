/**
 * Application Constants
 *
 * Centralized configuration for magic numbers, timeouts, and limits.
 * These replace hardcoded values throughout the codebase for better
 * maintainability and configurability.
 */

// ============================================================================
// Timing Constants (in milliseconds)
// ============================================================================

export const TIMING = {
  // UI delays
  MCP_STATUS_INITIAL_DELAY: 2000,
  MCP_STATUS_POLL_INTERVAL: 3000,
  SPINNER_FRAME_INTERVAL: 80,

  // Memory and cache
  MEMORY_DECAY_INTERVAL: 3600000,        // 1 hour
  CACHE_CLEANUP_INTERVAL: 300000,        // 5 minutes
  AUTO_SAVE_INTERVAL: 30000,             // 30 seconds

  // Timeouts
  DEFAULT_COMMAND_TIMEOUT: 120000,       // 2 minutes
  MAX_COMMAND_TIMEOUT: 600000,           // 10 minutes
  HOOK_DEFAULT_TIMEOUT: 30000,           // 30 seconds
  API_REQUEST_TIMEOUT: 60000,            // 1 minute
  PTY_NON_INTERACTIVE_TIMEOUT: 30000,    // 30 seconds

  // Debounce/throttle
  INPUT_DEBOUNCE: 150,
  SEARCH_DEBOUNCE: 300,
  FILE_WATCH_DEBOUNCE: 500,

  // Session
  SESSION_IDLE_TIMEOUT: 1800000,         // 30 minutes
  COMMAND_SCAN_INTERVAL: 5000,           // 5 seconds
} as const;

// ============================================================================
// Size Limits
// ============================================================================

export const LIMITS = {
  // File sizes (in bytes)
  MAX_FILE_SIZE: 10 * 1024 * 1024,       // 10 MB
  MAX_BUFFER_SIZE: 10 * 1024 * 1024,     // 10 MB
  LARGE_FILE_THRESHOLD: 2000,            // lines

  // Cache sizes
  MAX_CHECKPOINTS: 50,
  MAX_CHUNK_STORE_SIZE: 2000,
  MAX_FILE_INDEX_SIZE: 1000,
  MAX_SYMBOL_INDEX_SIZE: 5000,
  MAX_MEMORY_ENTRIES: 500,
  MAX_ANALYSIS_CACHE: 200,
  MAX_REPAIR_HISTORY: 100,
  MAX_CLIENT_POOL: 10,
  MAX_PLUGINS: 50,

  // Agent limits
  MAX_AGENT_ROUNDS: 30,
  MAX_YOLO_ROUNDS: 400,
  MAX_PARALLEL_TOOLS: 8,
  MAX_REPAIR_ITERATIONS: 5,

  // Context limits
  MAX_CONTEXT_TOKENS: 128000,
  MAX_RESPONSE_TOKENS: 4096,
  CONTEXT_WARNING_THRESHOLD: 0.75,       // 75%
  CONTEXT_CRITICAL_THRESHOLD: 0.90,      // 90%
  RESPONSE_TOKEN_RESERVE: 0.125,         // 12.5%

  // UI limits
  MAX_TABLE_COLUMN_WIDTH: 50,
  MAX_PROGRESS_VALUE: 100,
  MIN_PROGRESS_VALUE: 0,
  MAX_TERMINAL_COLS: 120,
  MAX_TERMINAL_ROWS: 30,
} as const;

// ============================================================================
// Cost Limits
// ============================================================================

export const COST = {
  DEFAULT_SESSION_LIMIT: 10,             // $10
  YOLO_SESSION_LIMIT: Infinity,
  WARNING_THRESHOLD: 0.8,                // 80% of limit
} as const;

// ============================================================================
// Retry Configuration
// ============================================================================

export const RETRY = {
  MAX_RETRIES: 3,
  INITIAL_DELAY: 1000,                   // 1 second
  MAX_DELAY: 30000,                      // 30 seconds
  BACKOFF_MULTIPLIER: 2,
} as const;

// ============================================================================
// Scoring and Weights
// ============================================================================

export const SCORING = {
  // Memory decay
  MEMORY_TAG_WEIGHT: 0.05,
  MEMORY_MAX_TAG_BONUS: 0.15,
  MEMORY_DECAY_RATE: 0.1,

  // Similarity thresholds
  SEMANTIC_SIMILARITY_THRESHOLD: 0.85,
  FUZZY_MATCH_THRESHOLD: 0.6,

  // RAG scoring
  RAG_RERANK_TOP_K: 10,
  RAG_CONTEXT_WEIGHT: 0.7,
  RAG_RECENCY_WEIGHT: 0.3,
} as const;

// ============================================================================
// Token Budgets
// ============================================================================

export const TOKEN_BUDGET = {
  NONE: 0,
  STANDARD_THINKING: 4000,
  DEEP_THINKING: 10000,
  EXHAUSTIVE_THINKING: 32000,
  EXTENDED_SHALLOW: 5000,
  EXTENDED_MEDIUM: 20000,
  EXTENDED_DEEP: 100000,
} as const;

// ============================================================================
// Embedding Configuration
// ============================================================================

export const EMBEDDING = {
  DEFAULT_DIM: 128,
  NGRAM_SIZE: 3,
} as const;

// ============================================================================
// Path and File Patterns
// ============================================================================

export const PATTERNS = {
  // Files to always exclude from indexing
  ALWAYS_EXCLUDE: [
    'node_modules',
    '.git',
    'dist',
    'build',
    '.next',
    '.nuxt',
    'coverage',
    '.cache',
    '.turbo',
    '*.log',
    '*.lock',
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    '.env*',
    '*.min.js',
    '*.min.css',
    '*.map',
    '*.d.ts',
  ],

  // Binary file extensions
  BINARY_EXTENSIONS: [
    '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.svg',
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.zip', '.tar', '.gz', '.rar', '.7z',
    '.exe', '.dll', '.so', '.dylib',
    '.ttf', '.woff', '.woff2', '.eot',
    '.mp3', '.mp4', '.wav', '.avi', '.mov',
  ],
} as const;

// ============================================================================
// Type Exports
// ============================================================================

export type TimingKey = keyof typeof TIMING;
export type LimitKey = keyof typeof LIMITS;
export type CostKey = keyof typeof COST;
export type RetryKey = keyof typeof RETRY;
export type ScoringKey = keyof typeof SCORING;
export type TokenBudgetKey = keyof typeof TOKEN_BUDGET;
