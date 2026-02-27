/**
 * Centralized configuration constants for Code Buddy
 */

export const AGENT_CONFIG = {
  /** Maximum number of tool execution rounds before stopping */
  MAX_TOOL_ROUNDS: 30,
  /** Default temperature for model generation */
  DEFAULT_TEMPERATURE: 0.7,
  /** Timeout for agent operations (ms) */
  AGENT_TIMEOUT: 300000, // 5 minutes
} as const;

export const SEARCH_CONFIG = {
  /** Maximum depth for directory traversal */
  MAX_DEPTH: 10,
  /** Number of context lines to show before match */
  CONTEXT_BEFORE: 3,
  /** Number of context lines to show after match */
  CONTEXT_AFTER: 3,
  /** Maximum number of search results to display */
  MAX_RESULTS: 100,
  /** Cache TTL for search results (ms) */
  CACHE_TTL: 60000, // 1 minute
} as const;

export const TEXT_EDITOR_CONFIG = {
  /** Similarity threshold for fuzzy matching (0-1) */
  SIMILARITY_THRESHOLD: 0.8,
  /** Maximum file size to edit (bytes) */
  MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB
  /** Default encoding for text files */
  DEFAULT_ENCODING: 'utf-8',
} as const;

export const BASH_CONFIG = {
  /** Timeout for bash command execution (ms) */
  COMMAND_TIMEOUT: 30000, // 30 seconds
  /** Maximum output size to capture (bytes) */
  MAX_OUTPUT_SIZE: 1024 * 1024, // 1MB
  /** Dangerous commands that require confirmation */
  DANGEROUS_COMMANDS: [
    'rm',
    'rmdir',
    'del',
    'format',
    'mkfs',
    'dd',
    'shutdown',
    'reboot',
    'halt',
    'poweroff',
    'init',
  ],
  /** Blocked commands that are never allowed */
  BLOCKED_COMMANDS: [
    'fork',
    ':(){ :|:& };:',  // fork bomb
  ],
} as const;

export const UI_CONFIG = {
  /** Maximum lines to display in confirmation dialog */
  MAX_PREVIEW_LINES: 500,
  /** Refresh rate for streaming updates (ms) */
  STREAM_REFRESH_RATE: 100,
  /** Token count update interval (ms) */
  TOKEN_UPDATE_INTERVAL: 500,
} as const;

export const API_CONFIG = {
  /** Default base URL for CodeBuddy API */
  DEFAULT_BASE_URL: 'https://api.x.ai/v1',
  /** Default model */
  DEFAULT_MODEL: 'grok-beta',
  /** Request timeout (ms) */
  REQUEST_TIMEOUT: 60000, // 1 minute
  /** Maximum retries for failed requests */
  MAX_RETRIES: 3,
  /** Retry delay (ms) */
  RETRY_DELAY: 1000,
  /** LM Studio default base URL */
  LMSTUDIO_BASE_URL: 'http://localhost:1234/v1',
  /** Ollama default base URL */
  OLLAMA_BASE_URL: 'http://localhost:11434/v1',
} as const;

export const PATHS = {
  /** User settings directory */
  SETTINGS_DIR: '.codebuddy',
  /** User settings file name */
  SETTINGS_FILE: 'user-settings.json',
  /** Custom instructions file name */
  CUSTOM_INSTRUCTIONS_FILE: 'CODEBUDDY.md',
  /** Cache directory name */
  CACHE_DIR: '.cache',
} as const;

export const SUPPORTED_MODELS = {
  // Grok models (xAI API model identifiers)
  'grok-4-1-fast': { maxTokens: 2000000, provider: 'xai' },
  'grok-4-latest': { maxTokens: 256000, provider: 'xai' },
  'grok-4-fast': { maxTokens: 2000000, provider: 'xai' },
  'grok-code-fast-1': { maxTokens: 256000, provider: 'xai' },
  'grok-3-latest': { maxTokens: 131072, provider: 'xai' },
  'grok-3-mini': { maxTokens: 131072, provider: 'xai' },
  'grok-3-fast': { maxTokens: 131072, provider: 'xai' },
  'grok-2-1212': { maxTokens: 32768, provider: 'xai' },
  'grok-2-vision-1212': { maxTokens: 32768, provider: 'xai' },
  // Claude models
  'claude-opus-4-6': { maxTokens: 200000, provider: 'anthropic' },
  'claude-sonnet-4-5-20250929': { maxTokens: 200000, provider: 'anthropic' },
  'claude-haiku-4-5-20251001': { maxTokens: 200000, provider: 'anthropic' },
  'claude-sonnet-4-20250514': { maxTokens: 200000, provider: 'anthropic' },
  'claude-opus-4-20250514': { maxTokens: 200000, provider: 'anthropic' },
  // Gemini models
  'gemini-2.5-flash': { maxTokens: 1000000, provider: 'google' },
  'gemini-2.5-pro': { maxTokens: 1000000, provider: 'google' },
  'gemini-2.0-flash': { maxTokens: 1000000, provider: 'google' },
  'gemini-2.0-flash-thinking': { maxTokens: 1000000, provider: 'google' },
  'gemini-1.5-pro': { maxTokens: 2000000, provider: 'google' },
  'gemini-1.5-flash': { maxTokens: 1000000, provider: 'google' },
  // GPT models
  'gpt-5': { maxTokens: 400000, provider: 'openai' },
  'gpt-4.1': { maxTokens: 1000000, provider: 'openai' },
  'gpt-4o': { maxTokens: 128000, provider: 'openai' },
  // LM Studio models (local inference via OpenAI-compatible API)
  'lmstudio': { maxTokens: 8192, provider: 'lmstudio' },
  'local-model': { maxTokens: 8192, provider: 'lmstudio' },
  // Common open-source models used with LM Studio
  'llama-3.1-8b': { maxTokens: 131072, provider: 'lmstudio' },
  'llama-3.1-70b': { maxTokens: 131072, provider: 'lmstudio' },
  'llama-3.2-3b': { maxTokens: 131072, provider: 'lmstudio' },
  'mistral-7b': { maxTokens: 32768, provider: 'lmstudio' },
  'mixtral-8x7b': { maxTokens: 32768, provider: 'lmstudio' },
  'codellama-34b': { maxTokens: 16384, provider: 'lmstudio' },
  'deepseek-coder': { maxTokens: 16384, provider: 'lmstudio' },
  'qwen2.5-coder': { maxTokens: 32768, provider: 'lmstudio' },
  'phi-3': { maxTokens: 4096, provider: 'lmstudio' },
  // Ollama models (local inference via OpenAI-compatible API)
  'ollama': { maxTokens: 8192, provider: 'ollama' },
  'llama3.2': { maxTokens: 131072, provider: 'ollama' },
  'llama3.2:1b': { maxTokens: 131072, provider: 'ollama' },
  'llama3.2:3b': { maxTokens: 131072, provider: 'ollama' },
  'llama3.1': { maxTokens: 131072, provider: 'ollama' },
  'llama3.1:8b': { maxTokens: 131072, provider: 'ollama' },
  'llama3.1:70b': { maxTokens: 131072, provider: 'ollama' },
  'mistral': { maxTokens: 32768, provider: 'ollama' },
  'mixtral': { maxTokens: 32768, provider: 'ollama' },
  'codellama': { maxTokens: 16384, provider: 'ollama' },
  'deepseek-coder-v2': { maxTokens: 131072, provider: 'ollama' },
  'qwen2.5': { maxTokens: 32768, provider: 'ollama' },
  'qwen2.5-coder:7b': { maxTokens: 32768, provider: 'ollama' },
  'phi3': { maxTokens: 4096, provider: 'ollama' },
  'gemma2': { maxTokens: 8192, provider: 'ollama' },
  'command-r': { maxTokens: 131072, provider: 'ollama' },
} as const;

export const TOKEN_LIMITS = {
  /** Token limit for grok-4.1 fast */
  'grok-4-1-fast': 2000000,
  /** Token limit for grok-4 */
  'grok-4-latest': 256000,
  /** Token limit for grok-3 */
  'grok-3-latest': 131072,
  /** Token limit for grok-2 */
  'grok-2-1212': 32768,
  /** Token limit for other models */
  'default': 131072,
} as const;

// === Server ===

export const SERVER_CONFIG = {
  /** Default port for the API server */
  DEFAULT_PORT: 3000,
  /** Default host to bind the server to */
  DEFAULT_HOST: '0.0.0.0',
  /** Default maximum request body size */
  DEFAULT_MAX_REQUEST_SIZE: '10mb',
  /** Default maximum WebSocket connections */
  DEFAULT_MAX_CONNECTIONS: 100,
  /** Default JWT expiration */
  DEFAULT_JWT_EXPIRATION: '24h',
} as const;

// === Timeouts ===

export const TIMEOUT_CONFIG = {
  /** Default timeout for external command execution (ms) */
  DEFAULT_COMMAND_TIMEOUT: 30000,
  /** Default timeout for download/OCR operations (ms) */
  DEFAULT_DOWNLOAD_TIMEOUT: 60000,
  /** Default export interval for telemetry/metrics (ms) */
  DEFAULT_EXPORT_INTERVAL: 30000,
  /** Default WebSocket heartbeat interval (ms) */
  WS_HEARTBEAT_INTERVAL: 30000,
  /** Default WebSocket idle timeout (ms) */
  WS_IDLE_TIMEOUT: 60000,
  /** Default webhook request timeout (ms) */
  DEFAULT_WEBHOOK_TIMEOUT: 30000,
  /** Default rate limit window (ms) */
  DEFAULT_RATE_LIMIT_WINDOW: 60000,
  /** Default metrics export interval (ms) */
  DEFAULT_METRICS_INTERVAL: 60000,
  /** Default rate limit cleanup interval (ms) */
  RATE_LIMIT_CLEANUP_INTERVAL: 60000,
} as const;

// === URLs ===

export const URL_CONFIG = {
  /** Default cloud API endpoint, overridable via CODEBUDDY_CLOUD_URL env var */
  CLOUD_API_ENDPOINT: process.env.CODEBUDDY_CLOUD_URL || 'https://api.codebuddy.cloud',
  /** Default OTLP endpoint for OpenTelemetry */
  DEFAULT_OTLP_ENDPOINT: 'http://localhost:4318',
} as const;

// === Limits ===

export const LIMIT_CONFIG = {
  /** Maximum entries in the rate limit store before eviction */
  MAX_RATE_LIMIT_ENTRIES: 10000,
  /** Default rate limit: max requests per window */
  DEFAULT_RATE_LIMIT_MAX: 100,
  /** Auth endpoint rate limit: max requests per window */
  AUTH_RATE_LIMIT_MAX: 10,
  /** Read-only endpoint rate limit: max requests per window */
  READONLY_RATE_LIMIT_MAX: 200,
  /** Sensitive endpoint rate limit: max requests per window */
  SENSITIVE_RATE_LIMIT_MAX: 5,
  /** Maximum webhook request body size (bytes) */
  DEFAULT_WEBHOOK_MAX_BODY_SIZE: 1024 * 1024, // 1MB
  /** Maximum internal metrics buffer size */
  MAX_OTEL_METRICS: 1000,
  /** Maximum image size for multimodal input (bytes) */
  DEFAULT_MAX_IMAGE_SIZE: 20 * 1024 * 1024, // 20MB
  /** Maximum image dimension for auto-resize */
  DEFAULT_MAX_IMAGE_DIMENSION: 2048,
} as const;

export const ERROR_MESSAGES = {
  NO_API_KEY: 'No API key found. Please set XAI_API_KEY environment variable or provide --api-key flag.',
  TOOL_EXECUTION_FAILED: 'Tool execution failed',
  FILE_NOT_FOUND: 'File not found',
  INVALID_COMMAND: 'Invalid or dangerous command',
  NETWORK_ERROR: 'Network error occurred',
  TIMEOUT_ERROR: 'Operation timed out',
} as const;

export const SUCCESS_MESSAGES = {
  FILE_CREATED: 'File created successfully',
  FILE_UPDATED: 'File updated successfully',
  FILE_DELETED: 'File deleted successfully',
  COMMAND_EXECUTED: 'Command executed successfully',
} as const;
