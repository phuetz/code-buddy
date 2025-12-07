/**
 * Structured Error Types for Grok CLI
 *
 * Provides a hierarchy of error types for better error handling,
 * debugging, and user feedback.
 */

/**
 * Base error class for all Grok CLI errors
 */
export class GrokError extends Error {
  public readonly code: string;
  public readonly isOperational: boolean;
  public readonly timestamp: Date;
  public readonly context?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    options: {
      cause?: Error;
      isOperational?: boolean;
      context?: Record<string, unknown>;
    } = {}
  ) {
    super(message);
    this.name = 'GrokError';
    this.code = code;
    this.isOperational = options.isOperational ?? true;
    this.timestamp = new Date();
    this.context = options.context;

    if (options.cause) {
      this.cause = options.cause;
    }

    // Capture stack trace
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      timestamp: this.timestamp.toISOString(),
      context: this.context,
      stack: this.stack,
    };
  }
}

// ============================================================================
// Tool Errors
// ============================================================================

/**
 * Error during tool execution
 */
export class ToolExecutionError extends GrokError {
  public readonly toolName: string;
  public readonly args?: Record<string, unknown>;

  constructor(
    toolName: string,
    message: string,
    options: {
      cause?: Error;
      args?: Record<string, unknown>;
      context?: Record<string, unknown>;
    } = {}
  ) {
    super('TOOL_EXECUTION_ERROR', message, options);
    this.name = 'ToolExecutionError';
    this.toolName = toolName;
    this.args = options.args;
  }
}

/**
 * Tool validation failed
 */
export class ToolValidationError extends GrokError {
  public readonly toolName: string;
  public readonly validationErrors: string[];

  constructor(
    toolName: string,
    validationErrors: string[],
    options: { context?: Record<string, unknown> } = {}
  ) {
    super(
      'TOOL_VALIDATION_ERROR',
      `Validation failed for tool "${toolName}": ${validationErrors.join(', ')}`,
      options
    );
    this.name = 'ToolValidationError';
    this.toolName = toolName;
    this.validationErrors = validationErrors;
  }
}

/**
 * Tool not found
 */
export class ToolNotFoundError extends GrokError {
  public readonly toolName: string;

  constructor(toolName: string) {
    super('TOOL_NOT_FOUND', `Tool "${toolName}" not found`);
    this.name = 'ToolNotFoundError';
    this.toolName = toolName;
  }
}

// ============================================================================
// Security Errors
// ============================================================================

/**
 * User denied confirmation for an operation
 */
export class ConfirmationDeniedError extends GrokError {
  public readonly operation: string;
  public readonly target?: string;

  constructor(operation: string, target?: string) {
    super(
      'CONFIRMATION_DENIED',
      `User denied confirmation for operation: ${operation}${target ? ` on ${target}` : ''}`
    );
    this.name = 'ConfirmationDeniedError';
    this.operation = operation;
    this.target = target;
  }
}

/**
 * Operation blocked by security sandbox
 */
export class SandboxViolationError extends GrokError {
  public readonly operation: string;
  public readonly reason: string;

  constructor(operation: string, reason: string) {
    super('SANDBOX_VIOLATION', `Sandbox blocked operation: ${operation}. Reason: ${reason}`);
    this.name = 'SandboxViolationError';
    this.operation = operation;
    this.reason = reason;
  }
}

/**
 * Path traversal attempt detected
 */
export class PathTraversalError extends GrokError {
  public readonly attemptedPath: string;
  public readonly basePath: string;

  constructor(attemptedPath: string, basePath: string) {
    super(
      'PATH_TRAVERSAL',
      `Path traversal detected: "${attemptedPath}" is outside allowed base "${basePath}"`
    );
    this.name = 'PathTraversalError';
    this.attemptedPath = attemptedPath;
    this.basePath = basePath;
  }
}

/**
 * Command injection attempt detected
 */
export class CommandInjectionError extends GrokError {
  public readonly command: string;
  public readonly pattern: string;

  constructor(command: string, pattern: string) {
    super(
      'COMMAND_INJECTION',
      `Potential command injection detected in: "${command.substring(0, 50)}..."`
    );
    this.name = 'CommandInjectionError';
    this.command = command;
    this.pattern = pattern;
  }
}

// ============================================================================
// Context Errors
// ============================================================================

/**
 * Context token limit exceeded
 */
export class ContextLimitExceededError extends GrokError {
  public readonly currentTokens: number;
  public readonly maxTokens: number;
  public readonly overflow: number;

  constructor(currentTokens: number, maxTokens: number) {
    super(
      'CONTEXT_LIMIT_EXCEEDED',
      `Context limit exceeded: ${currentTokens} tokens (max: ${maxTokens})`
    );
    this.name = 'ContextLimitExceededError';
    this.currentTokens = currentTokens;
    this.maxTokens = maxTokens;
    this.overflow = currentTokens - maxTokens;
  }
}

/**
 * File too large to process
 */
export class FileTooLargeError extends GrokError {
  public readonly filePath: string;
  public readonly fileSize: number;
  public readonly maxSize: number;

  constructor(filePath: string, fileSize: number, maxSize: number) {
    super(
      'FILE_TOO_LARGE',
      `File "${filePath}" is too large: ${fileSize} bytes (max: ${maxSize})`
    );
    this.name = 'FileTooLargeError';
    this.filePath = filePath;
    this.fileSize = fileSize;
    this.maxSize = maxSize;
  }
}

// ============================================================================
// API Errors
// ============================================================================

/**
 * API request failed
 */
export class ApiError extends GrokError {
  public readonly statusCode?: number;
  public readonly endpoint?: string;

  constructor(
    message: string,
    options: {
      cause?: Error;
      statusCode?: number;
      endpoint?: string;
      context?: Record<string, unknown>;
    } = {}
  ) {
    super('API_ERROR', message, options);
    this.name = 'ApiError';
    this.statusCode = options.statusCode;
    this.endpoint = options.endpoint;
  }
}

/**
 * API rate limit exceeded
 */
export class RateLimitError extends ApiError {
  public readonly retryAfter?: number;

  constructor(retryAfter?: number) {
    super('Rate limit exceeded', { statusCode: 429 });
    this.name = 'RateLimitError';
    // Override code in constructor using Object.defineProperty
    Object.defineProperty(this, 'code', { value: 'RATE_LIMIT_EXCEEDED', writable: false });
    this.retryAfter = retryAfter;
  }
}

/**
 * API authentication failed
 */
export class AuthenticationError extends ApiError {
  constructor(message: string = 'Authentication failed') {
    super(message, { statusCode: 401 });
    this.name = 'AuthenticationError';
    Object.defineProperty(this, 'code', { value: 'AUTHENTICATION_FAILED', writable: false });
  }
}

// ============================================================================
// Configuration Errors
// ============================================================================

/**
 * Configuration validation failed
 */
export class ConfigurationError extends GrokError {
  public readonly configKey?: string;
  public readonly expectedType?: string;
  public readonly receivedValue?: unknown;

  constructor(
    message: string,
    options: {
      configKey?: string;
      expectedType?: string;
      receivedValue?: unknown;
    } = {}
  ) {
    super('CONFIGURATION_ERROR', message, { isOperational: true });
    this.name = 'ConfigurationError';
    this.configKey = options.configKey;
    this.expectedType = options.expectedType;
    this.receivedValue = options.receivedValue;
  }
}

/**
 * Required configuration missing
 */
export class MissingConfigError extends ConfigurationError {
  constructor(configKey: string) {
    super(`Required configuration "${configKey}" is missing`, { configKey });
    this.name = 'MissingConfigError';
    Object.defineProperty(this, 'code', { value: 'MISSING_CONFIG', writable: false });
  }
}

// ============================================================================
// Plugin Errors
// ============================================================================

/**
 * Plugin loading failed
 */
export class PluginLoadError extends GrokError {
  public readonly pluginName: string;
  public readonly pluginPath?: string;

  constructor(
    pluginName: string,
    message: string,
    options: { cause?: Error; pluginPath?: string } = {}
  ) {
    super('PLUGIN_LOAD_ERROR', message, options);
    this.name = 'PluginLoadError';
    this.pluginName = pluginName;
    this.pluginPath = options.pluginPath;
  }
}

/**
 * Plugin permission denied
 */
export class PluginPermissionError extends GrokError {
  public readonly pluginName: string;
  public readonly permission: string;

  constructor(pluginName: string, permission: string) {
    super(
      'PLUGIN_PERMISSION_DENIED',
      `Plugin "${pluginName}" does not have permission: ${permission}`
    );
    this.name = 'PluginPermissionError';
    this.pluginName = pluginName;
    this.permission = permission;
  }
}

// ============================================================================
// MCP Errors
// ============================================================================

/**
 * MCP server connection failed
 */
export class MCPConnectionError extends GrokError {
  public readonly serverName: string;
  public readonly serverCommand?: string;

  constructor(
    serverName: string,
    message: string,
    options: { cause?: Error; serverCommand?: string } = {}
  ) {
    super('MCP_CONNECTION_ERROR', message, options);
    this.name = 'MCPConnectionError';
    this.serverName = serverName;
    this.serverCommand = options.serverCommand;
  }
}

/**
 * MCP protocol error
 */
export class MCPProtocolError extends GrokError {
  public readonly serverName: string;
  public readonly method?: string;

  constructor(
    serverName: string,
    message: string,
    options: { method?: string } = {}
  ) {
    super('MCP_PROTOCOL_ERROR', message);
    this.name = 'MCPProtocolError';
    this.serverName = serverName;
    this.method = options.method;
  }
}

// ============================================================================
// Timeout Errors
// ============================================================================

/**
 * Operation timed out
 */
export class TimeoutError extends GrokError {
  public readonly operation: string;
  public readonly timeoutMs: number;

  constructor(operation: string, timeoutMs: number) {
    super('TIMEOUT', `Operation "${operation}" timed out after ${timeoutMs}ms`);
    this.name = 'TimeoutError';
    this.operation = operation;
    this.timeoutMs = timeoutMs;
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Extract error message from unknown error type
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Check if error is a GrokError
 */
export function isGrokError(error: unknown): error is GrokError {
  return error instanceof GrokError;
}

/**
 * Check if error is operational (expected, can be handled gracefully)
 */
export function isOperationalError(error: unknown): boolean {
  if (error instanceof GrokError) {
    return error.isOperational;
  }
  return false;
}

/**
 * Wrap unknown error in GrokError
 */
export function wrapError(error: unknown, code: string = 'UNKNOWN_ERROR'): GrokError {
  if (error instanceof GrokError) {
    return error;
  }

  const message = getErrorMessage(error);
  const cause = error instanceof Error ? error : undefined;

  return new GrokError(code, message, { cause, isOperational: false });
}

/**
 * Create error from API response
 */
export function createApiError(
  statusCode: number,
  message: string,
  endpoint?: string
): ApiError {
  if (statusCode === 401) {
    return new AuthenticationError(message);
  }
  if (statusCode === 429) {
    return new RateLimitError();
  }
  return new ApiError(message, { statusCode, endpoint });
}

// ============================================================================
// Safe JSON Parsing Utilities
// ============================================================================

/**
 * JSON parse error with context
 */
export class JSONParseError extends GrokError {
  public readonly source?: string;
  public readonly position?: number;

  constructor(message: string, options: { source?: string; cause?: Error } = {}) {
    super('JSON_PARSE_ERROR', message, { cause: options.cause, isOperational: true });
    this.name = 'JSONParseError';
    this.source = options.source;
    // Try to extract position from SyntaxError
    if (options.cause instanceof SyntaxError) {
      const match = options.cause.message.match(/position\s+(\d+)/i);
      if (match) {
        this.position = parseInt(match[1], 10);
      }
    }
  }
}

/**
 * Safely parse JSON with error handling
 * Returns parsed value or defaultValue on failure
 *
 * @param json - JSON string to parse
 * @param defaultValue - Value to return on parse failure
 * @param context - Optional context for error logging
 * @returns Parsed value or default
 *
 * @example
 * ```typescript
 * const config = safeJSONParse(fileContent, { servers: [] }, 'config.json');
 * const data = safeJSONParse<UserData>(apiResponse, null);
 * ```
 */
export function safeJSONParse<T>(
  json: string,
  defaultValue: T,
  context?: string
): T {
  if (!json || typeof json !== 'string') {
    return defaultValue;
  }
  try {
    return JSON.parse(json) as T;
  } catch (error) {
    // Log in development, silent in production
    if (process.env.NODE_ENV !== 'production' && context) {
      console.warn(`JSON parse failed for ${context}:`, getErrorMessage(error));
    }
    return defaultValue;
  }
}

/**
 * Parse JSON and throw typed error on failure
 * Use when parsing failure should be handled explicitly
 *
 * @param json - JSON string to parse
 * @param source - Source identifier for error context
 * @returns Parsed value
 * @throws {JSONParseError} on parse failure
 *
 * @example
 * ```typescript
 * try {
 *   const config = parseJSONOrThrow(content, 'settings.json');
 * } catch (error) {
 *   if (error instanceof JSONParseError) {
 *     console.error(`Invalid JSON in ${error.source}`);
 *   }
 * }
 * ```
 */
export function parseJSONOrThrow<T = unknown>(json: string, source?: string): T {
  if (!json || typeof json !== 'string') {
    throw new JSONParseError('Input is not a valid string', { source });
  }
  try {
    return JSON.parse(json) as T;
  } catch (error) {
    throw new JSONParseError(
      `Failed to parse JSON${source ? ` from ${source}` : ''}: ${getErrorMessage(error)}`,
      { source, cause: error instanceof Error ? error : undefined }
    );
  }
}

/**
 * Parse JSON with validation function
 * Returns null if parsing fails or validation returns false
 *
 * @param json - JSON string to parse
 * @param validator - Function to validate parsed result
 * @param context - Optional context for error logging
 * @returns Validated parsed value or null
 *
 * @example
 * ```typescript
 * interface Config { apiKey: string }
 * const config = parseJSONWithValidation<Config>(
 *   content,
 *   (val): val is Config => typeof val?.apiKey === 'string',
 *   'config.json'
 * );
 * ```
 */
export function parseJSONWithValidation<T>(
  json: string,
  validator: (value: unknown) => value is T,
  context?: string
): T | null {
  const parsed = safeJSONParse(json, null, context);
  if (parsed === null) {
    return null;
  }
  if (!validator(parsed)) {
    if (process.env.NODE_ENV !== 'production' && context) {
      console.warn(`JSON validation failed for ${context}`);
    }
    return null;
  }
  return parsed;
}
