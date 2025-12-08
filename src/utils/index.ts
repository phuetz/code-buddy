/**
 * Utils Module - Centralized exports for utility functions
 *
 * Note: Some modules have types with the same names (e.g., CacheEntry, CacheStats).
 * Import directly from the specific module if you need a specific version.
 */

// Core utilities - errors provides base error classes
export {
  GrokError,
  APIKeyError,
  APIError,
  NetworkError,
  TimeoutError,
  FileError,
  FileNotFoundError,
  ToolExecutionError,
  InvalidCommandError,
  CommandExecutionError,
  ValidationError as GrokValidationError,
  ConfigurationError,
  MCPError,
  SearchError,
  ParserError,
  PathTraversalError,
  JSONParseError,
  isGrokError,
  getErrorMessage,
  withTimeout,
  withRetry,
} from "./errors.js";

// Logger
export {
  Logger,
  LogLevel,
  LogFormat,
  LogContext,
  LogEntry,
  LoggerOptions,
  getLogger,
  createLogger,
  resetLogger,
  logger,
  isDebugEnabled,
  debug,
} from "./logger.js";

// LRU Cache (primary cache implementation)
export {
  LRUCache,
  LRUCacheOptions,
  CacheEntry as LRUCacheEntry,
  CacheStats as LRUCacheStats,
} from "./lru-cache.js";

// Path and input validation
export {
  PathValidator,
  PathValidatorOptions,
  PathValidationResult,
  getPathValidator,
  initializePathValidator,
  validatePath,
  isPathSafe,
} from "./path-validator.js";
export {
  ValidationResult,
  ValidationOptions,
  validateString,
  validateStringLength,
  validatePattern,
  validateNumber,
  validateNumberRange,
  validatePositiveInteger,
  validateArray,
  validateObject,
  validateChoice,
  validateBoolean,
  validateUrl,
  validateEmail,
  validateFilePath,
  validateOptional,
  validateWithDefault,
  validateSchema,
  assertValid,
  assertString,
  assertNumber,
} from "./input-validator.js";

// Settings and configuration
export {
  SettingsManager,
  getSettingsManager,
  UserSettings,
  ProjectSettings,
} from "./settings-manager.js";
export {
  ConfigValidator,
  ValidationError as ConfigValidationError,
  ValidationResult as ConfigValidationResult,
  JSONSchema,
  SCHEMAS,
  getConfigValidator,
  validateStartupConfig,
} from "./config-validator.js";
export {
  ModelConfig as ModelConfigType,
  ModelOption,
  getCurrentModel,
  loadModelConfig,
  getDefaultModels,
  updateCurrentModel,
  updateDefaultModel,
} from "./model-config.js";
export {
  ModelName,
  ModelProvider,
  ModelInfo,
  isSupportedModel,
  getModelInfo,
  validateModel,
  getDefaultModel,
  getSupportedModels,
  getModelsByProvider,
  suggestModel,
  formatModelInfo,
} from "./model-utils.js";

// Cost and rate limiting
export {
  CostTracker,
  TokenUsage,
  CostReport,
  CostConfig,
  ModelPricing,
  getCostTracker,
} from "./cost-tracker.js";
export {
  RateLimiter,
  RateLimitConfig,
  RateLimitStatus,
  QueuedRequest,
  getRateLimiter,
  resetRateLimiter,
  rateLimited,
} from "./rate-limiter.js";

// Caching - export with prefixed names to avoid conflicts
export {
  Cache,
  CacheEntry as SimpleCacheEntry,
  createCacheKey,
} from "./cache.js";
export {
  ResponseCache,
  CacheEntry as ResponseCacheEntry,
  CacheStats as ResponseCacheStats,
  getResponseCache,
  resetResponseCache,
} from "./response-cache.js";
export {
  SemanticCache,
  CacheEntry as SemanticCacheEntry,
  CacheConfig as SemanticCacheConfig,
  CacheStats as SemanticCacheStats,
  CacheLookupResult,
  getApiCache,
  resetApiCache,
  createToolCacheKey,
  isCacheable,
} from "./semantic-cache.js";

// Text processing
export {
  TextPosition,
  TextSelection,
  isWordBoundary,
  findWordStart,
  findWordEnd,
  moveToPreviousWord,
  moveToNextWord,
  deleteWordBefore,
  deleteWordAfter,
  getTextPosition,
  moveToLineStart,
  moveToLineEnd,
  deleteCharBefore,
  deleteCharAfter,
  insertText,
} from "./text-utils.js";
export {
  sanitizeFilePath,
  sanitizeCommandArg,
  escapeRegex,
  sanitizeHTML,
  sanitizeEmail as sanitizeEmailAddress,
  sanitizeURL,
  isAlphanumeric,
  truncateString,
  removeControlCharacters,
  sanitizeJSON,
  sanitizePort,
  sanitizeLLMOutput,
  ExtractedToolCall,
  extractCommentaryToolCalls,
} from "./sanitize.js";
export {
  TokenCounter,
  formatTokenCount,
  createTokenCounter,
  countTokens,
} from "./token-counter.js";

// System utilities
export {
  AutonomyManager,
  AutonomyLevel,
  AutonomyConfig,
  YOLOConfig,
  getAutonomyManager,
} from "./autonomy-manager.js";
export {
  ModelRouter,
  ModelRouterConfig,
  ModelConfig as RouterModelConfig,
  TaskType,
  getModelRouter,
} from "./model-router.js";
export {
  WorkspaceDetector,
  WorkspaceConfig,
  ProjectType,
  PackageManager,
  getWorkspaceDetector,
  detectWorkspace,
} from "./workspace-detector.js";
export {
  ConfirmationService,
  ConfirmationOptions,
  ConfirmationResult,
} from "./confirmation-service.js";
export {
  SelfHealingEngine,
  SelfHealingOptions,
  FixAttempt,
  SelfHealingResult,
  getSelfHealingEngine,
  resetSelfHealingEngine,
} from "./self-healing.js";

// Error handling
export {
  ErrorContext,
  ERROR_TEMPLATES,
  formatError,
  formatErrorJson,
  createErrorContext,
  printError,
  printErrorJson,
  formatWarning,
  formatSuccess,
  formatInfo,
} from "./error-formatter.js";
export {
  EXIT_CODES,
  ExitCode,
  EXIT_CODE_DESCRIPTIONS,
  exitWithCode,
  getExitCodeDescription,
  errorToExitCode,
  handleFatalError,
} from "./exit-codes.js";

// Specialized utilities
export {
  ParseResult as TestParseResult,
  parseTestOutput,
  isLikelyTestOutput,
  createTestResultsData,
} from "./test-output-parser.js";
export {
  CustomCommand,
  loadCustomCommands,
  getCustomCommand,
  processCommandPrompt,
  ensureCommandDirectories,
  createSampleCommand,
} from "./custom-commands.js";
export { loadCustomInstructions } from "./custom-instructions.js";
export {
  ConversationExporter,
  ExportOptions,
  getConversationExporter,
  resetConversationExporter,
} from "./conversation-export.js";
export {
  ShellType,
  CompletionOption,
  generateCompletion,
  getInstallInstructions,
  printCompletion,
  getSlashCommands,
  getCliOptions,
} from "./shell-completions.js";

// JSON validation with Zod
export {
  parseJSON,
  parseJSONSafe,
  parseJSONStrict,
  parseJSONUntyped,
  validateObject as validateObjectWithZod,
  formatZodError,
  isValidJSON,
  matchesSchema,
  // Common schemas
  ConfigFileSchema,
  ApprovalModeConfigSchema,
  SettingsSchema,
  SessionSchema,
  CacheEntrySchema,
  ToolCallSchema,
  LLMResponseSchema,
  GitHubPRSchema,
  HookConfigSchema,
  // Re-export zod for convenience
  z,
  type ParseResult as ZodParseResult,
  type ValidationOptions as ZodValidationOptions,
} from "./json-validator.js";
