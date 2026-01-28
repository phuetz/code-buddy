/**
 * Custom error classes for Grok CLI
 */

/**
 * Base error class for all Grok CLI errors
 */
export class CodeBuddyError extends Error {
  constructor(message: string, public code?: string, public details?: unknown) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      details: this.details,
    };
  }
}

/**
 * Error thrown when API key is missing or invalid
 */
export class APIKeyError extends CodeBuddyError {
  constructor(message: string = 'No API key found') {
    super(message, 'API_KEY_ERROR');
  }
}

/**
 * Error thrown when API request fails
 */
export class APIError extends CodeBuddyError {
  constructor(
    message: string,
    public statusCode?: number,
    public response?: unknown
  ) {
    super(message, 'API_ERROR', { statusCode, response });
  }
}

/**
 * Error thrown when network request fails
 */
export class NetworkError extends CodeBuddyError {
  constructor(message: string, public originalError?: Error) {
    super(message, 'NETWORK_ERROR', originalError);
  }
}

/**
 * Error thrown when operation times out
 */
export class TimeoutError extends CodeBuddyError {
  constructor(message: string, public timeoutMs: number) {
    super(message, 'TIMEOUT_ERROR', { timeoutMs });
  }
}

/**
 * Error thrown when file operation fails
 */
export class FileError extends CodeBuddyError {
  constructor(
    message: string,
    public filePath: string,
    public operation: 'read' | 'write' | 'delete' | 'create'
  ) {
    super(message, 'FILE_ERROR', { filePath, operation });
  }
}

/**
 * Error thrown when file is not found
 */
export class FileNotFoundError extends FileError {
  constructor(filePath: string) {
    super(`File not found: ${filePath}`, filePath, 'read');
    this.code = 'FILE_NOT_FOUND';
  }
}

/**
 * Error thrown when tool execution fails
 */
export class ToolExecutionError extends CodeBuddyError {
  constructor(
    message: string,
    public toolName: string,
    public toolArgs?: unknown
  ) {
    super(message, 'TOOL_EXECUTION_ERROR', { toolName, toolArgs });
  }
}

/**
 * Error thrown when bash command is invalid or dangerous
 */
export class InvalidCommandError extends CodeBuddyError {
  constructor(message: string, public command: string) {
    super(message, 'INVALID_COMMAND', { command });
  }
}

/**
 * Error thrown when bash command execution fails
 */
export class CommandExecutionError extends CodeBuddyError {
  constructor(
    message: string,
    public command: string,
    public exitCode?: number,
    public stderr?: string
  ) {
    super(message, 'COMMAND_EXECUTION_ERROR', { command, exitCode, stderr });
  }
}

/**
 * Error thrown when validation fails
 */
export class ValidationError extends CodeBuddyError {
  constructor(message: string, public field?: string, public value?: unknown) {
    super(message, 'VALIDATION_ERROR', { field, value });
  }
}

/**
 * Error thrown when configuration is invalid
 */
export class ConfigurationError extends CodeBuddyError {
  constructor(message: string, public configKey?: string) {
    super(message, 'CONFIGURATION_ERROR', { configKey });
  }
}

/**
 * Error thrown when MCP server communication fails
 */
export class MCPError extends CodeBuddyError {
  constructor(
    message: string,
    public serverName?: string,
    public operation?: string
  ) {
    super(message, 'MCP_ERROR', { serverName, operation });
  }
}

/**
 * Error thrown when search operation fails
 */
export class SearchError extends CodeBuddyError {
  constructor(
    message: string,
    public query?: string,
    public searchType?: 'ripgrep' | 'web' | 'symbol'
  ) {
    super(message, 'SEARCH_ERROR', { query, searchType });
  }
}

/**
 * Error thrown when code parsing fails
 */
export class ParserError extends CodeBuddyError {
  constructor(
    message: string,
    public filePath?: string,
    public language?: string
  ) {
    super(message, 'PARSER_ERROR', { filePath, language });
  }
}

/**
 * Error thrown when path traversal is attempted
 */
export class PathTraversalError extends CodeBuddyError {
  constructor(message: string, public attemptedPath: string, public basePath?: string) {
    super(message, 'PATH_TRAVERSAL_ERROR', { attemptedPath, basePath });
  }
}

/**
 * Error thrown when JSON parsing fails
 */
export class JSONParseError extends CodeBuddyError {
  constructor(message: string, public input?: string) {
    super(message, 'JSON_PARSE_ERROR', { input: input?.substring(0, 200) });
  }
}

/**
 * Error thrown when a loop exceeds maximum iterations
 */
export class LoopTimeoutError extends CodeBuddyError {
  constructor(
    message: string,
    public maxIterations: number,
    public context?: string
  ) {
    super(message, 'LOOP_TIMEOUT_ERROR', { maxIterations, context });
  }
}

/**
 * Checks if an error is a CodeBuddyError or subclass
 */
export function isCodeBuddyError(error: unknown): error is CodeBuddyError {
  return error instanceof CodeBuddyError;
}

/**
 * Safely extracts error message from any error type
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'An unknown error occurred';
}

/**
 * Wraps a promise with timeout
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string = 'Operation timed out'
): Promise<T> {
  let timeoutHandle: NodeJS.Timeout;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new TimeoutError(errorMessage, timeoutMs));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutHandle!);
  }
}

/**
 * Retries a function with exponential backoff
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    initialDelay?: number;
    maxDelay?: number;
    shouldRetry?: (error: unknown) => boolean;
  } = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 10000,
    shouldRetry = () => true,
  } = options;

  let lastError: unknown;
  let delay = initialDelay;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === maxRetries || !shouldRetry(error)) {
        throw error;
      }

      // Wait before retrying with exponential backoff
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * 2, maxDelay);
    }
  }

  throw lastError;
}

/**
 * Options for loop guard
 */
export interface LoopGuardOptions {
  /** Maximum number of iterations allowed (default: 10000) */
  maxIterations?: number;
  /** Context description for error messages */
  context?: string;
  /** Warning threshold - logs warning when reached (default: 80% of max) */
  warnAt?: number;
  /** Optional logger function for warnings */
  onWarn?: (message: string) => void;
}

/**
 * Loop guard to prevent infinite loops
 * Returns a function that should be called at each iteration.
 * Throws LoopTimeoutError when max iterations exceeded.
 *
 * @example
 * ```typescript
 * const guard = createLoopGuard({ maxIterations: 1000, context: 'parsing postfix' });
 * while (true) {
 *   guard(); // Throws if iterations exceed limit
 *   // ... loop body
 * }
 * ```
 */
export function createLoopGuard(options: LoopGuardOptions = {}): () => void {
  const {
    maxIterations = 10000,
    context = 'loop',
    warnAt = Math.floor(maxIterations * 0.8),
    onWarn,
  } = options;

  let iterations = 0;
  let warned = false;

  return () => {
    iterations++;

    if (!warned && iterations >= warnAt && onWarn) {
      warned = true;
      onWarn(
        `Warning: ${context} approaching iteration limit (${iterations}/${maxIterations})`
      );
    }

    if (iterations > maxIterations) {
      throw new LoopTimeoutError(
        `${context} exceeded maximum iterations (${maxIterations}). ` +
          'This may indicate an infinite loop or corrupted input.',
        maxIterations,
        context
      );
    }
  };
}
