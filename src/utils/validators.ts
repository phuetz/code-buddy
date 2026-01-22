/**
 * Unified Input Validation Layer
 *
 * Provides Result-based validation functions for all user inputs:
 * - CLI arguments
 * - Slash command arguments
 * - Tool arguments
 * - API parameters
 *
 * Uses a functional Result<T, E> pattern for type-safe error handling
 * without exceptions.
 */

import * as path from 'path';
import { ValidationError } from './errors.js';

// ============================================================================
// Result Type (Rust-inspired)
// ============================================================================

/**
 * Represents a successful result containing a value
 */
export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

/**
 * Represents a failed result containing an error
 */
export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

/**
 * Result type - either Ok with value or Err with error
 * Provides a type-safe way to handle operations that can fail
 */
export type Result<T, E = ValidationError> = Ok<T> | Err<E>;

/**
 * Create a successful result
 */
export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

/**
 * Create a failed result
 */
export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

/**
 * Create a validation error result with a message
 */
export function validationErr(message: string, field?: string, value?: unknown): Err<ValidationError> {
  return err(new ValidationError(message, field, value));
}

/**
 * Check if result is Ok
 */
export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok;
}

/**
 * Check if result is Err
 */
export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return !result.ok;
}

/**
 * Unwrap a Result, throwing if it's an error
 */
export function unwrap<T, E extends Error>(result: Result<T, E>): T {
  if (result.ok) {
    return result.value;
  }
  throw result.error;
}

/**
 * Unwrap a Result with a default value if it's an error
 */
export function unwrapOr<T, E>(result: Result<T, E>, defaultValue: T): T {
  if (result.ok) {
    return result.value;
  }
  return defaultValue;
}

/**
 * Map a successful result to a new value
 */
export function map<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  if (result.ok) {
    return ok(fn(result.value));
  }
  return result;
}

/**
 * Chain result operations (flatMap/bind)
 */
export function andThen<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>
): Result<U, E> {
  if (result.ok) {
    return fn(result.value);
  }
  return result;
}

// ============================================================================
// Validation Constants
// ============================================================================

/** Maximum file path length */
const MAX_PATH_LENGTH = 4096;

/** Maximum command length */
const MAX_COMMAND_LENGTH = 100000;

/** Maximum URL length */
const MAX_URL_LENGTH = 2048;

/** Maximum API key length */
const MAX_API_KEY_LENGTH = 256;

/** Dangerous path traversal patterns */
const PATH_TRAVERSAL_PATTERNS = [
  /\.\.[/\\]/,           // ../  or ..\
  /[/\\]\.\./,           // /../ or \..
  /^\.\.$/,              // just ".."
  // eslint-disable-next-line no-control-regex
  /\x00/,                // null byte
  /[\r\n]/,              // newlines (can be used for injection)
];

/** Dangerous command patterns */
const DANGEROUS_COMMAND_PATTERNS: RegExp[] = [
  /rm\s+(-rf?|--recursive)\s+[/~]/i,      // rm -rf /
  /rm\s+.*\/\s*$/i,                        // rm path/
  />\s*\/dev\/sd[a-z]/i,                   // write to disk device
  /dd\s+.*if=.*of=\/dev/i,                 // dd to device
  /mkfs/i,                                  // format filesystem
  /:\(\)\s*\{\s*:\|:&\s*\};:/,             // fork bomb
  /chmod\s+-R\s+777\s+\//i,                // chmod 777 on root
  /wget.*\|\s*(ba)?sh/i,                   // wget | sh
  /curl.*\|\s*(ba)?sh/i,                   // curl | sh
  /sudo\s+(rm|dd|mkfs)/i,                  // dangerous sudo
  />\s*\/etc\/(passwd|shadow|sudoers)/i,   // overwrite system files
  /nc\s+.*-e\s+.*sh/i,                     // netcat reverse shell
];

/** Allowed URL protocols */
const ALLOWED_URL_PROTOCOLS = ['http:', 'https:', 'file:'];

/** API key patterns for validation (common formats) */
const API_KEY_PATTERNS = {
  grok: /^xai-[a-zA-Z0-9-_]+$/,
  openai: /^sk-[a-zA-Z0-9-_]+$/,
  anthropic: /^sk-ant-[a-zA-Z0-9-_]+$/,
  generic: /^[a-zA-Z0-9-_]{20,}$/,
};

// ============================================================================
// File Path Validators
// ============================================================================

export interface FilePathOptions {
  /** Allow absolute paths (default: true) */
  allowAbsolute?: boolean;
  /** Allow relative paths (default: true) */
  allowRelative?: boolean;
  /** Base directory for relative path resolution */
  baseDirectory?: string;
  /** Allowed file extensions (e.g., ['.ts', '.js']) */
  allowedExtensions?: string[];
  /** Disallowed file extensions (e.g., ['.exe', '.sh']) */
  disallowedExtensions?: string[];
  /** Maximum path length */
  maxLength?: number;
  /** Field name for error messages */
  fieldName?: string;
}

/**
 * Validate a file path for security and correctness
 *
 * Checks for:
 * - Path traversal attacks (../)
 * - Null byte injection
 * - Invalid characters
 * - Extension restrictions
 *
 * @param filePath - The file path to validate
 * @param options - Validation options
 * @returns Result with sanitized path or validation error
 */
export function validateFilePath(
  filePath: unknown,
  options: FilePathOptions = {}
): Result<string, ValidationError> {
  const {
    allowAbsolute = true,
    allowRelative = true,
    baseDirectory,
    allowedExtensions,
    disallowedExtensions,
    maxLength = MAX_PATH_LENGTH,
    fieldName = 'file path',
  } = options;

  // Type check
  if (typeof filePath !== 'string') {
    return validationErr(`${fieldName} must be a string`, fieldName, filePath);
  }

  // Empty check
  const trimmed = filePath.trim();
  if (trimmed.length === 0) {
    return validationErr(`${fieldName} cannot be empty`, fieldName, filePath);
  }

  // Length check
  if (trimmed.length > maxLength) {
    return validationErr(
      `${fieldName} exceeds maximum length of ${maxLength} characters`,
      fieldName,
      filePath
    );
  }

  // Path traversal check
  for (const pattern of PATH_TRAVERSAL_PATTERNS) {
    if (pattern.test(trimmed)) {
      return validationErr(
        `${fieldName} contains invalid path traversal pattern`,
        fieldName,
        filePath
      );
    }
  }

  // Check absolute vs relative
  const isAbsolute = path.isAbsolute(trimmed);

  if (isAbsolute && !allowAbsolute) {
    return validationErr(
      `${fieldName} must be a relative path`,
      fieldName,
      filePath
    );
  }

  if (!isAbsolute && !allowRelative) {
    return validationErr(
      `${fieldName} must be an absolute path`,
      fieldName,
      filePath
    );
  }

  // Resolve path if base directory provided
  let resolvedPath = trimmed;
  if (baseDirectory && !isAbsolute) {
    resolvedPath = path.resolve(baseDirectory, trimmed);

    // Ensure resolved path stays within base directory
    const normalizedBase = path.normalize(baseDirectory);
    const normalizedResolved = path.normalize(resolvedPath);

    if (!normalizedResolved.startsWith(normalizedBase + path.sep) &&
        normalizedResolved !== normalizedBase) {
      return validationErr(
        `${fieldName} resolves outside allowed directory`,
        fieldName,
        filePath
      );
    }
  }

  // Extension checks
  const ext = path.extname(trimmed).toLowerCase();

  if (allowedExtensions && allowedExtensions.length > 0) {
    if (!allowedExtensions.includes(ext)) {
      return validationErr(
        `${fieldName} has invalid extension. Allowed: ${allowedExtensions.join(', ')}`,
        fieldName,
        filePath
      );
    }
  }

  if (disallowedExtensions && disallowedExtensions.includes(ext)) {
    return validationErr(
      `${fieldName} has disallowed extension: ${ext}`,
      fieldName,
      filePath
    );
  }

  return ok(resolvedPath);
}

// ============================================================================
// Command Validators
// ============================================================================

export interface CommandOptions {
  /** Allow dangerous commands (default: false) */
  allowDangerous?: boolean;
  /** Allowed command prefixes (e.g., ['git', 'npm']) */
  allowedCommands?: string[];
  /** Disallowed command prefixes */
  disallowedCommands?: string[];
  /** Maximum command length */
  maxLength?: number;
  /** Field name for error messages */
  fieldName?: string;
}

/**
 * Validate a shell command for security
 *
 * Checks for:
 * - Dangerous patterns (rm -rf /, fork bombs, etc.)
 * - Command injection patterns
 * - Allowed/disallowed commands
 *
 * @param command - The command to validate
 * @param options - Validation options
 * @returns Result with command or validation error
 */
export function validateCommand(
  command: unknown,
  options: CommandOptions = {}
): Result<string, ValidationError> {
  const {
    allowDangerous = false,
    allowedCommands,
    disallowedCommands,
    maxLength = MAX_COMMAND_LENGTH,
    fieldName = 'command',
  } = options;

  // Type check
  if (typeof command !== 'string') {
    return validationErr(`${fieldName} must be a string`, fieldName, command);
  }

  // Empty check
  const trimmed = command.trim();
  if (trimmed.length === 0) {
    return validationErr(`${fieldName} cannot be empty`, fieldName, command);
  }

  // Length check
  if (trimmed.length > maxLength) {
    return validationErr(
      `${fieldName} exceeds maximum length of ${maxLength} characters`,
      fieldName,
      command
    );
  }

  // Null byte check
  if (trimmed.includes('\0')) {
    return validationErr(
      `${fieldName} contains invalid null bytes`,
      fieldName,
      command
    );
  }

  // Dangerous pattern check
  if (!allowDangerous) {
    for (const pattern of DANGEROUS_COMMAND_PATTERNS) {
      if (pattern.test(trimmed)) {
        return validationErr(
          `${fieldName} contains dangerous pattern`,
          fieldName,
          command
        );
      }
    }
  }

  // Extract base command
  const baseCommand = trimmed.split(/[\s;|&]/)[0].replace(/^(sudo\s+)?/, '');

  // Allowed commands check
  if (allowedCommands && allowedCommands.length > 0) {
    const isAllowed = allowedCommands.some(
      allowed => baseCommand === allowed || baseCommand.startsWith(allowed + '/')
    );
    if (!isAllowed) {
      return validationErr(
        `${fieldName} '${baseCommand}' is not in allowed list: ${allowedCommands.join(', ')}`,
        fieldName,
        command
      );
    }
  }

  // Disallowed commands check
  if (disallowedCommands) {
    const isDisallowed = disallowedCommands.some(
      disallowed => baseCommand === disallowed || baseCommand.startsWith(disallowed + '/')
    );
    if (isDisallowed) {
      return validationErr(
        `${fieldName} '${baseCommand}' is not allowed`,
        fieldName,
        command
      );
    }
  }

  return ok(trimmed);
}

// ============================================================================
// API Key Validators
// ============================================================================

export interface ApiKeyOptions {
  /** Provider type for format validation */
  provider?: 'grok' | 'openai' | 'anthropic' | 'generic';
  /** Minimum key length */
  minLength?: number;
  /** Maximum key length */
  maxLength?: number;
  /** Field name for error messages */
  fieldName?: string;
}

/**
 * Validate an API key
 *
 * Checks for:
 * - Proper format based on provider
 * - Length constraints
 * - Invalid characters
 *
 * @param apiKey - The API key to validate
 * @param options - Validation options
 * @returns Result with API key or validation error
 */
export function validateApiKey(
  apiKey: unknown,
  options: ApiKeyOptions = {}
): Result<string, ValidationError> {
  const {
    provider = 'generic',
    minLength = 20,
    maxLength = MAX_API_KEY_LENGTH,
    fieldName = 'API key',
  } = options;

  // Type check
  if (typeof apiKey !== 'string') {
    return validationErr(`${fieldName} must be a string`, fieldName, apiKey);
  }

  // Empty check
  const trimmed = apiKey.trim();
  if (trimmed.length === 0) {
    return validationErr(`${fieldName} cannot be empty`, fieldName);
  }

  // Length checks
  if (trimmed.length < minLength) {
    return validationErr(
      `${fieldName} is too short (minimum ${minLength} characters)`,
      fieldName
    );
  }

  if (trimmed.length > maxLength) {
    return validationErr(
      `${fieldName} is too long (maximum ${maxLength} characters)`,
      fieldName
    );
  }

  // Format check based on provider
  const pattern = API_KEY_PATTERNS[provider];
  if (pattern && !pattern.test(trimmed)) {
    return validationErr(
      `${fieldName} has invalid format for ${provider}`,
      fieldName
    );
  }

  // Check for common placeholder patterns
  const placeholderPatterns = [
    /^(your[-_]?)?api[-_]?key$/i,
    /^<.*>$/,
    /^xxx+$/i,
    /^test[-_]?key$/i,
    /^placeholder$/i,
    /^\*+$/,
  ];

  for (const placeholder of placeholderPatterns) {
    if (placeholder.test(trimmed)) {
      return validationErr(
        `${fieldName} appears to be a placeholder value`,
        fieldName
      );
    }
  }

  return ok(trimmed);
}

// ============================================================================
// JSON Validators
// ============================================================================

export interface JsonOptions<T = unknown> {
  /** Zod schema for validation (optional) */
  schema?: { safeParse: (data: unknown) => { success: boolean; data?: T; error?: { message: string } } };
  /** Maximum JSON string length */
  maxLength?: number;
  /** Field name for error messages */
  fieldName?: string;
}

/**
 * Validate and parse a JSON string
 *
 * @param jsonString - The JSON string to parse
 * @param options - Validation options
 * @returns Result with parsed JSON or validation error
 */
export function validateJson<T = unknown>(
  jsonString: unknown,
  options: JsonOptions<T> = {}
): Result<T, ValidationError> {
  const {
    schema,
    maxLength = 10_000_000, // 10MB default
    fieldName = 'JSON',
  } = options;

  // Type check
  if (typeof jsonString !== 'string') {
    return validationErr(`${fieldName} must be a string`, fieldName, jsonString);
  }

  // Empty check
  if (jsonString.trim().length === 0) {
    return validationErr(`${fieldName} cannot be empty`, fieldName);
  }

  // Length check
  if (jsonString.length > maxLength) {
    return validationErr(
      `${fieldName} exceeds maximum length of ${maxLength} characters`,
      fieldName
    );
  }

  // Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Parse error';
    return validationErr(`Invalid ${fieldName}: ${message}`, fieldName);
  }

  // Schema validation if provided
  if (schema) {
    const result = schema.safeParse(parsed);
    if (!result.success) {
      return validationErr(
        `${fieldName} validation failed: ${result.error?.message || 'Unknown error'}`,
        fieldName
      );
    }
    return ok(result.data as T);
  }

  return ok(parsed as T);
}

// ============================================================================
// URL Validators
// ============================================================================

export interface UrlOptions {
  /** Allowed protocols (default: ['http:', 'https:']) */
  protocols?: string[];
  /** Require HTTPS only */
  httpsOnly?: boolean;
  /** Allowed hostnames */
  allowedHosts?: string[];
  /** Blocked hostnames */
  blockedHosts?: string[];
  /** Maximum URL length */
  maxLength?: number;
  /** Field name for error messages */
  fieldName?: string;
}

/**
 * Validate a URL
 *
 * Checks for:
 * - Valid URL format
 * - Allowed protocols
 * - Host restrictions
 * - Common attack patterns
 *
 * @param urlString - The URL to validate
 * @param options - Validation options
 * @returns Result with URL object or validation error
 */
export function validateUrl(
  urlString: unknown,
  options: UrlOptions = {}
): Result<URL, ValidationError> {
  const {
    protocols = ALLOWED_URL_PROTOCOLS,
    httpsOnly = false,
    allowedHosts,
    blockedHosts,
    maxLength = MAX_URL_LENGTH,
    fieldName = 'URL',
  } = options;

  // Type check
  if (typeof urlString !== 'string') {
    return validationErr(`${fieldName} must be a string`, fieldName, urlString);
  }

  // Empty check
  const trimmed = urlString.trim();
  if (trimmed.length === 0) {
    return validationErr(`${fieldName} cannot be empty`, fieldName);
  }

  // Length check
  if (trimmed.length > maxLength) {
    return validationErr(
      `${fieldName} exceeds maximum length of ${maxLength} characters`,
      fieldName
    );
  }

  // Parse URL
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return validationErr(`${fieldName} is not a valid URL`, fieldName);
  }

  // Protocol check
  if (httpsOnly && url.protocol !== 'https:') {
    return validationErr(`${fieldName} must use HTTPS`, fieldName);
  }

  if (!protocols.includes(url.protocol)) {
    return validationErr(
      `${fieldName} protocol '${url.protocol}' is not allowed. Allowed: ${protocols.join(', ')}`,
      fieldName
    );
  }

  // Check for JavaScript protocol (XSS)
  if (url.protocol === 'javascript:' || trimmed.toLowerCase().startsWith('javascript:')) {
    return validationErr(`${fieldName} cannot use JavaScript protocol`, fieldName);
  }

  // Host checks
  const host = url.hostname.toLowerCase();

  if (allowedHosts && allowedHosts.length > 0) {
    const isAllowed = allowedHosts.some(
      allowed => host === allowed || host.endsWith('.' + allowed)
    );
    if (!isAllowed) {
      return validationErr(
        `${fieldName} host '${host}' is not in allowed list`,
        fieldName
      );
    }
  }

  if (blockedHosts) {
    const isBlocked = blockedHosts.some(
      blocked => host === blocked || host.endsWith('.' + blocked)
    );
    if (isBlocked) {
      return validationErr(
        `${fieldName} host '${host}' is blocked`,
        fieldName
      );
    }
  }

  // Check for internal/private network addresses
  const privatePatterns = [
    /^localhost$/i,
    /^127\./,
    /^10\./,
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
    /^192\.168\./,
    /^0\.0\.0\.0$/,
    /^::1$/,
    /^\[::1\]$/,
  ];

  // Only block internal addresses if not explicitly allowed
  if (!allowedHosts?.includes('localhost') && !allowedHosts?.includes(host)) {
    for (const pattern of privatePatterns) {
      if (pattern.test(host)) {
        return validationErr(
          `${fieldName} cannot access internal network addresses`,
          fieldName
        );
      }
    }
  }

  return ok(url);
}

// ============================================================================
// Composite Validators Object
// ============================================================================

/**
 * Validators object with all validation functions
 * Convenient for use as a single import
 */
export const validators = {
  /** Validate file path */
  filePath: validateFilePath,
  /** Validate shell command */
  command: validateCommand,
  /** Validate API key */
  apiKey: validateApiKey,
  /** Validate JSON string */
  json: validateJson,
  /** Validate URL */
  url: validateUrl,
};

// ============================================================================
// Sanitization Helpers
// ============================================================================

/**
 * Sanitize a file path by removing dangerous patterns
 * Returns the sanitized path or throws if path is too dangerous
 */
export function sanitizePath(filePath: string): string {
  // Remove null bytes
  let sanitized = filePath.replace(/\0/g, '');

  // Normalize path separators
  sanitized = sanitized.replace(/\\/g, '/');

  // Remove multiple consecutive slashes
  sanitized = sanitized.replace(/\/+/g, '/');

  // Remove leading/trailing whitespace
  sanitized = sanitized.trim();

  // Validate the sanitized path
  const result = validateFilePath(sanitized);
  if (!result.ok) {
    throw result.error;
  }

  return result.value;
}

/**
 * Escape a string for safe use in shell commands
 * Wraps the string in single quotes and escapes internal quotes
 */
export function escapeForShell(input: string): string {
  if (!input || typeof input !== 'string') return "''";

  // Escape single quotes by ending the quote, adding escaped quote, and reopening
  const escaped = input.replace(/'/g, "'\\''");

  // Wrap in single quotes for safety
  return `'${escaped}'`;
}

/**
 * Combine multiple validation results
 * Returns the first error or ok with all values
 */
export function combineResults<T extends readonly Result<unknown, ValidationError>[]>(
  ...results: T
): Result<{ [K in keyof T]: T[K] extends Result<infer V, unknown> ? V : never }, ValidationError> {
  const values: unknown[] = [];

  for (const result of results) {
    if (!result.ok) {
      return result;
    }
    values.push(result.value);
  }

  return ok(values as { [K in keyof T]: T[K] extends Result<infer V, unknown> ? V : never });
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard for checking if a value is a non-empty string
 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Type guard for checking if a value is a valid number
 */
export function isValidNumber(value: unknown): value is number {
  return typeof value === 'number' && !isNaN(value) && isFinite(value);
}

/**
 * Type guard for checking if a value is a plain object
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
