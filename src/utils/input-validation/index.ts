/**
 * Input Validation Module
 *
 * Barrel re-exports plus remaining validators (tool schemas,
 * URL sanitization, unified validators object, bash tool schemas).
 */

import { z, ZodError, ZodSchema } from 'zod';
import * as path from 'path';

// Re-export types
export type { ValidationResult, ValidationOptions } from './types.js';

// Re-export constants
export { VALIDATION_LIMITS } from './constants.js';

// Re-export common validators
export {
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
  validateOptional,
  validateWithDefault,
  type SchemaField,
  type Schema,
  validateSchema,
  assertValid,
  createAssertingValidator,
  assertString,
  assertNumber,
  assertPositiveInteger,
  assertArray,
  assertObject,
  assertBoolean,
  assertUrl,
  assertEmail,
} from './common-validators.js';

// Re-export path validators
export {
  validateFilePath,
  sanitizeFilePath,
  isPathSafeForWrite,
  type PathValidationOptions,
  type UnifiedValidationResult,
  validatePath,
  DANGEROUS_PATH_PATTERNS,
} from './path-validator.js';

// Re-export command validators
export {
  validateCommand,
  sanitizeForShell,
} from './command-validator.js';

// ============================================================================
// Imports needed for this module's own exports
// ============================================================================

import type { ValidationResult } from './types.js';
import { VALIDATION_LIMITS } from './constants.js';
import { validateCommand, sanitizeForShell } from './command-validator.js';
import { validateFilePath } from './path-validator.js';
import { createAssertingValidator } from './common-validators.js';
import type { UnifiedValidationResult } from './path-validator.js';
import { validatePath, DANGEROUS_PATH_PATTERNS } from './path-validator.js';

// ============================================================================
// Asserting validator for file path (needs to be here, depends on path-validator)
// ============================================================================

export const assertFilePath = createAssertingValidator(validateFilePath);

// ============================================================================
// Bash Tool Schemas and Validators
// ============================================================================

/**
 * Schemas for bash tool operations
 */
export const bashToolSchemas = {
  execute: {
    command: { type: 'string' as const, required: true, minLength: 1 },
    timeout: { type: 'number' as const, required: false, min: 1, max: 600000 },
  },
  listFiles: {
    directory: { type: 'string' as const, required: false },
  },
  findFiles: {
    pattern: { type: 'string' as const, required: true, minLength: 1 },
    directory: { type: 'string' as const, required: false },
  },
  grep: {
    pattern: { type: 'string' as const, required: true, minLength: 1 },
    files: { type: 'string' as const, required: false },
  },
};

/**
 * Validate input against a schema
 */
export function validateWithSchema(
  schema: Record<string, { type: string; required?: boolean; minLength?: number; min?: number; max?: number }>,
  input: Record<string, unknown>,
  _context: string
): ValidationResult<Record<string, unknown>> {
  for (const [field, rules] of Object.entries(schema)) {
    const value = input[field];

    // Check required fields
    if (rules.required && (value === undefined || value === null)) {
      return { valid: false, error: `Missing required field: ${field}` };
    }

    // Skip validation for optional undefined fields
    if (value === undefined || value === null) continue;

    // Type validation
    if (rules.type === 'string' && typeof value !== 'string') {
      return { valid: false, error: `${field} must be a string` };
    }
    if (rules.type === 'number' && typeof value !== 'number') {
      return { valid: false, error: `${field} must be a number` };
    }

    // String constraints
    if (rules.type === 'string' && typeof value === 'string') {
      if (rules.minLength && value.length < rules.minLength) {
        return { valid: false, error: `${field} must be at least ${rules.minLength} characters` };
      }
    }

    // Number constraints
    if (rules.type === 'number' && typeof value === 'number') {
      if (rules.min !== undefined && value < rules.min) {
        return { valid: false, error: `${field} must be at least ${rules.min}` };
      }
      if (rules.max !== undefined && value > rules.max) {
        return { valid: false, error: `${field} must be at most ${rules.max}` };
      }
    }
  }

  return { valid: true, value: input };
}

// ============================================================================
// Zod-based Tool Input Schemas
// ============================================================================

/**
 * Custom Zod refinement for safe file paths
 * Prevents directory traversal attacks and validates path structure
 */
const safePathSchema = z.string()
  .min(1, 'Path cannot be empty')
  .max(VALIDATION_LIMITS.MAX_PATH_LENGTH, `Path exceeds maximum length of ${VALIDATION_LIMITS.MAX_PATH_LENGTH}`)
  .refine((p) => !p.includes('\0'), 'Path contains null bytes')
  .refine((p) => !p.includes('..'), 'Path traversal (..) is not allowed')
  .refine((p) => !p.startsWith('~root'), 'Access to root home directory is not allowed')
  .transform((p) => path.normalize(p));

/**
 * Relaxed path schema that allows relative paths with ..
 * Use for read-only operations where traversal is less dangerous
 */
const relaxedPathSchema = z.string()
  .min(1, 'Path cannot be empty')
  .max(VALIDATION_LIMITS.MAX_PATH_LENGTH, `Path exceeds maximum length of ${VALIDATION_LIMITS.MAX_PATH_LENGTH}`)
  .refine((p) => !p.includes('\0'), 'Path contains null bytes');

/**
 * URL schema with protocol restrictions
 */
const safeUrlSchema = z.string()
  .min(1, 'URL cannot be empty')
  .max(VALIDATION_LIMITS.MAX_URL_LENGTH, `URL exceeds maximum length of ${VALIDATION_LIMITS.MAX_URL_LENGTH}`)
  .refine((url) => {
    try {
      const parsed = new URL(url);
      return ['http:', 'https:'].includes(parsed.protocol);
    } catch {
      return false;
    }
  }, 'Invalid URL or unsupported protocol (only http/https allowed)');

/**
 * Line number schema (positive integer within reasonable range)
 */
const lineNumberSchema = z.number()
  .int('Line number must be an integer')
  .min(1, 'Line number must be at least 1')
  .max(VALIDATION_LIMITS.MAX_VIEW_LINES, `Line number exceeds maximum of ${VALIDATION_LIMITS.MAX_VIEW_LINES}`);

// ============================================================================
// Tool Input Schemas
// ============================================================================

/**
 * Schema for view_file tool
 */
export const viewFileSchema = z.object({
  path: relaxedPathSchema,
  start_line: lineNumberSchema.optional(),
  end_line: lineNumberSchema.optional(),
}).refine(
  (data) => {
    if (data.start_line && data.end_line) {
      return data.end_line >= data.start_line;
    }
    return true;
  },
  { message: 'end_line must be greater than or equal to start_line' }
);

/**
 * Schema for create_file tool
 */
export const createFileSchema = z.object({
  path: safePathSchema,
  content: z.string()
    .max(VALIDATION_LIMITS.MAX_CONTENT_SIZE, `Content exceeds maximum size of ${VALIDATION_LIMITS.MAX_CONTENT_SIZE} bytes`),
});

/**
 * Schema for str_replace_editor tool
 */
export const strReplaceEditorSchema = z.preprocess(
  (val: unknown) => {
    if (typeof val === 'object' && val !== null) {
      const v = val as Record<string, unknown>;
      return {
        ...v,
        old_str: v.old_str ?? v.pattern ?? v.find ?? v.old_text ?? v.old_content ?? v.old_string,
        new_str: v.new_str ?? v.replacement ?? v.replace ?? v.new_text ?? v.new_content ?? v.new_string,
      };
    }
    return val;
  },
  z.object({
    path: safePathSchema,
    old_str: z.string({
      required_error: 'old_str (or pattern, find, old_text, old_content, old_string) is required',
      invalid_type_error: 'old_str (or pattern, find, old_text, old_content, old_string) must be a string',
    })
      .min(1, 'old_str (or pattern, find, old_text, old_content, old_string) cannot be empty')
      .max(VALIDATION_LIMITS.MAX_CONTENT_SIZE, 'old_str exceeds maximum size'),
    new_str: z.string({
      required_error: 'new_str (or replacement, replace, new_text, new_content, new_string) is required',
      invalid_type_error: 'new_str (or replacement, replace, new_text, new_content, new_string) must be a string',
    })
      .max(VALIDATION_LIMITS.MAX_CONTENT_SIZE, 'new_str exceeds maximum size'),
    replace_all: z.boolean().optional(),
  })
);

/**
 * Schema for edit_file (Morph) tool
 */
export const editFileSchema = z.object({
  target_file: safePathSchema,
  instructions: z.string()
    .min(1, 'Instructions cannot be empty')
    .max(VALIDATION_LIMITS.MAX_QUERY_LENGTH, 'Instructions exceed maximum length'),
  code_edit: z.string()
    .min(1, 'code_edit cannot be empty')
    .max(VALIDATION_LIMITS.MAX_CODE_EDIT_SIZE, 'code_edit exceeds maximum size'),
});

/**
 * Schema for bash tool
 */
export const bashSchema = z.object({
  command: z.string()
    .min(1, 'Command cannot be empty')
    .max(VALIDATION_LIMITS.MAX_COMMAND_LENGTH, `Command exceeds maximum length of ${VALIDATION_LIMITS.MAX_COMMAND_LENGTH}`)
    .refine((cmd) => {
      const result = validateCommand(cmd);
      return result.valid;
    }, 'Command contains dangerous patterns'),
});

/**
 * Schema for search tool
 */
export const searchSchema = z.object({
  query: z.string()
    .min(1, 'Search query cannot be empty')
    .max(VALIDATION_LIMITS.MAX_QUERY_LENGTH, 'Search query exceeds maximum length'),
  include_pattern: z.string().max(1000).optional(),
  exclude_pattern: z.string().max(1000).optional(),
  case_sensitive: z.boolean().optional(),
  regex: z.boolean().optional(),
  max_results: z.number().int().min(1).max(1000).optional(),
});

/**
 * Schema for web_search tool
 */
export const webSearchSchema = z.object({
  query: z.string()
    .min(1, 'Search query cannot be empty')
    .max(VALIDATION_LIMITS.MAX_QUERY_LENGTH, 'Search query exceeds maximum length'),
  max_results: z.number().int().min(1).max(100).optional(),
});

/**
 * Schema for web_fetch tool
 */
export const webFetchSchema = z.object({
  url: safeUrlSchema,
});

/**
 * Schema for create_todo_list tool
 */
export const createTodoListSchema = z.object({
  todos: z.array(z.object({
    id: z.string().min(1, 'Todo id cannot be empty'),
    content: z.string().min(1, 'Todo content cannot be empty').max(10000),
    status: z.enum(['pending', 'in_progress', 'completed', 'blocked']),
    priority: z.enum(['low', 'medium', 'high']).optional().default('medium'),
  })).min(1, 'At least one todo is required').max(100, 'Maximum 100 todos allowed'),
});

/**
 * Schema for update_todo_list tool
 */
export const updateTodoListSchema = z.object({
  updates: z.array(z.object({
    id: z.string().min(1, 'Todo id cannot be empty'),
    status: z.enum(['pending', 'in_progress', 'completed', 'blocked']).optional(),
    content: z.string().min(1).max(10000).optional(),
    priority: z.enum(['low', 'medium', 'high']).optional(),
  })).min(1, 'At least one update is required').max(100, 'Maximum 100 updates allowed'),
});

// ============================================================================
// Tool Schema Registry
// ============================================================================

/**
 * Registry mapping tool names to their validation schemas
 */
export const TOOL_SCHEMAS: Record<string, ZodSchema> = {
  view_file: viewFileSchema,
  create_file: createFileSchema,
  str_replace_editor: strReplaceEditorSchema,
  edit_file: editFileSchema,
  bash: bashSchema,
  search: searchSchema,
  web_search: webSearchSchema,
  web_fetch: webFetchSchema,
  create_todo_list: createTodoListSchema,
  update_todo_list: updateTodoListSchema,
};

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validation error with structured details
 */
export class ToolValidationError extends Error {
  public readonly toolName: string;
  public readonly issues: Array<{ path: string; message: string }>;

  constructor(toolName: string, issues: Array<{ path: string; message: string }>) {
    const issueMessages = issues.map(i => `  - ${i.path}: ${i.message}`).join('\n');
    super(`Validation failed for tool "${toolName}":\n${issueMessages}`);
    this.name = 'ToolValidationError';
    this.toolName = toolName;
    this.issues = issues;
  }
}

/**
 * Format Zod errors into readable messages
 */
function formatZodError(error: ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({
    path: issue.path.length > 0 ? issue.path.join('.') : 'input',
    message: issue.message,
  }));
}

/**
 * Validate tool arguments using the appropriate schema
 *
 * @param toolName - Name of the tool being called
 * @param args - Arguments to validate
 * @returns Validated and transformed arguments
 * @throws ToolValidationError if validation fails
 */
export function validateToolArgs<T = Record<string, unknown>>(
  toolName: string,
  args: unknown
): T {
  const schema = TOOL_SCHEMAS[toolName];

  // If no schema is registered, allow the args through with basic object check
  if (!schema) {
    if (typeof args !== 'object' || args === null) {
      throw new ToolValidationError(toolName, [
        { path: 'input', message: 'Arguments must be an object' }
      ]);
    }
    return args as T;
  }

  try {
    return schema.parse(args) as T;
  } catch (error) {
    if (error instanceof ZodError) {
      throw new ToolValidationError(toolName, formatZodError(error));
    }
    throw error;
  }
}

/**
 * Safe validation that returns a result object instead of throwing
 */
export function safeValidateToolArgs<T = Record<string, unknown>>(
  toolName: string,
  args: unknown
): ValidationResult<T> {
  try {
    const validated = validateToolArgs<T>(toolName, args);
    return { valid: true, value: validated };
  } catch (error) {
    if (error instanceof ToolValidationError) {
      return {
        valid: false,
        error: error.message,
      };
    }
    return {
      valid: false,
      error: `Unexpected validation error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ============================================================================
// URL Sanitization
// ============================================================================

/**
 * Blocked URL patterns for security
 */
const BLOCKED_URL_PATTERNS = [
  /^file:\/\//i,                           // Local file access
  /^javascript:/i,                         // JavaScript injection
  /^data:/i,                               // Data URIs (potential XSS)
  /localhost|127\.0\.0\.1|0\.0\.0\.0/i,   // Localhost access
  /\[::1\]/,                               // IPv6 localhost
  /169\.254\.\d+\.\d+/,                    // Link-local addresses
  /10\.\d+\.\d+\.\d+/,                     // Private IP range
  /172\.(1[6-9]|2\d|3[01])\.\d+\.\d+/,    // Private IP range
  /192\.168\.\d+\.\d+/,                    // Private IP range
];

/**
 * Sanitize and validate a URL for fetching
 *
 * @param url - The URL to sanitize
 * @returns The validated URL
 * @throws Error if URL is invalid or blocked
 */
export function sanitizeUrl(url: string): string {
  if (!url || typeof url !== 'string') {
    throw new Error('URL must be a non-empty string');
  }

  if (url.length > VALIDATION_LIMITS.MAX_URL_LENGTH) {
    throw new Error(`URL exceeds maximum length of ${VALIDATION_LIMITS.MAX_URL_LENGTH}`);
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Invalid URL format');
  }

  // Only allow http and https
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`Unsupported protocol: ${parsed.protocol}. Only http and https are allowed.`);
  }

  // Check against blocked patterns
  for (const pattern of BLOCKED_URL_PATTERNS) {
    if (pattern.test(url)) {
      throw new Error('Access to internal/local URLs is not allowed');
    }
  }

  return url;
}

/**
 * Check if a URL is safe for fetching (doesn't throw, returns boolean)
 */
export function isUrlSafe(url: string): boolean {
  try {
    sanitizeUrl(url);
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Additional Unified Validator Types
// ============================================================================

/**
 * Options for URL validation in unified validators
 */
export interface UrlValidationOptions {
  /** Allowed protocols (default: ['http:', 'https:']) */
  protocols?: string[];
  /** Block internal/localhost URLs (default: true) */
  blockInternal?: boolean;
  /** Field name for error messages */
  fieldName?: string;
}

/**
 * Options for JSON parsing in unified validators
 */
export interface JsonParseOptions {
  /** Maximum JSON string length */
  maxLength?: number;
  /** Custom error message prefix */
  errorPrefix?: string;
}

/**
 * Options for string sanitization
 */
export interface SanitizeOptions {
  /** Remove control characters (default: true) */
  removeControlChars?: boolean;
  /** Escape HTML entities (default: false) */
  escapeHtml?: boolean;
  /** Maximum length (truncate if exceeded) */
  maxLength?: number;
  /** Trim whitespace (default: true) */
  trim?: boolean;
}

// ============================================================================
// Unified Validators Object
// ============================================================================

/**
 * Unified validators object providing a consistent API for all validation needs.
 *
 * All validators return a UnifiedValidationResult with:
 * - valid: boolean indicating success
 * - value: the validated/sanitized value (if valid)
 * - error: descriptive error message (if invalid)
 *
 * @example
 * ```typescript
 * const pathResult = validators.path('/some/file.ts');
 * if (pathResult.valid) {
 *   console.log('Safe path:', pathResult.value);
 * }
 *
 * const urlResult = validators.url('https://example.com');
 * if (!urlResult.valid) {
 *   console.error('Invalid URL:', urlResult.error);
 * }
 * ```
 */
export const validators = {
  /**
   * Validate a file path for security and correctness.
   *
   * Checks for:
   * - Path traversal attacks (../)
   * - Null byte injection
   * - Dangerous paths (sensitive system files)
   * - Absolute/relative path restrictions
   *
   * @param input - The path to validate
   * @param options - Validation options
   * @returns ValidationResult with sanitized path or error
   */
  path: validatePath,

  /**
   * Validate a URL for security and correctness.
   *
   * Checks for:
   * - Valid URL format
   * - Allowed protocols (http/https by default)
   * - Internal/localhost blocking
   * - JavaScript protocol (XSS prevention)
   *
   * @param input - The URL to validate
   * @param options - Validation options
   * @returns ValidationResult with URL string or error
   */
  url: (
    input: string,
    options: UrlValidationOptions = {}
  ): UnifiedValidationResult<string> => {
    const {
      protocols = ['http:', 'https:'],
      blockInternal = true,
      fieldName = 'URL',
    } = options;

    // Basic type and empty check
    if (!input || typeof input !== 'string') {
      return { valid: false, error: `${fieldName} must be a non-empty string` };
    }

    const trimmed = input.trim();
    if (trimmed.length === 0) {
      return { valid: false, error: `${fieldName} cannot be empty` };
    }

    // Length check
    if (trimmed.length > VALIDATION_LIMITS.MAX_URL_LENGTH) {
      return {
        valid: false,
        error: `${fieldName} exceeds maximum length of ${VALIDATION_LIMITS.MAX_URL_LENGTH}`,
      };
    }

    // Parse URL
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      return { valid: false, error: `${fieldName} is not a valid URL` };
    }

    // Protocol check
    if (!protocols.includes(parsed.protocol)) {
      return {
        valid: false,
        error: `${fieldName} must use one of these protocols: ${protocols.join(', ')}`,
      };
    }

    // JavaScript protocol check (XSS prevention)
    if (trimmed.toLowerCase().startsWith('javascript:')) {
      return { valid: false, error: `${fieldName} cannot use JavaScript protocol` };
    }

    // Internal URL blocking
    if (blockInternal) {
      for (const pattern of BLOCKED_URL_PATTERNS) {
        if (pattern.test(trimmed)) {
          return { valid: false, error: `${fieldName} cannot access internal/localhost URLs` };
        }
      }
    }

    return { valid: true, value: trimmed };
  },

  /**
   * Parse and validate a JSON string.
   *
   * Features:
   * - Safe JSON parsing with error handling
   * - Size limits to prevent DoS
   * - Clear error messages for parse failures
   *
   * @param input - The JSON string to parse
   * @param options - Parse options
   * @returns Parsed value or null on failure
   */
  json: <T = unknown>(
    input: string,
    options: JsonParseOptions = {}
  ): T | null => {
    const {
      maxLength = 10_000_000, // 10MB default
      errorPrefix: _errorPrefix = 'JSON parse error',
    } = options;

    if (!input || typeof input !== 'string') {
      return null;
    }

    if (input.length > maxLength) {
      return null;
    }

    try {
      return JSON.parse(input) as T;
    } catch {
      // Return null on parse failure - caller can use jsonWithError for details
      return null;
    }
  },

  /**
   * Parse JSON with detailed error information.
   * Use this when you need to know why parsing failed.
   *
   * @param input - The JSON string to parse
   * @param options - Parse options
   * @returns ValidationResult with parsed value or error
   */
  jsonWithError: <T = unknown>(
    input: string,
    options: JsonParseOptions = {}
  ): UnifiedValidationResult<T> => {
    const {
      maxLength = 10_000_000,
      errorPrefix = 'JSON',
    } = options;

    if (!input || typeof input !== 'string') {
      return { valid: false, error: `${errorPrefix} must be a string` };
    }

    if (input.trim().length === 0) {
      return { valid: false, error: `${errorPrefix} cannot be empty` };
    }

    if (input.length > maxLength) {
      return { valid: false, error: `${errorPrefix} exceeds maximum size` };
    }

    try {
      const value = JSON.parse(input) as T;
      return { valid: true, value };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Parse error';
      return { valid: false, error: `Invalid ${errorPrefix}: ${message}` };
    }
  },

  /**
   * Sanitize a string by removing dangerous content.
   *
   * Features:
   * - Removes control characters
   * - Optionally escapes HTML entities
   * - Enforces length limits
   * - Trims whitespace
   *
   * @param input - The string to sanitize
   * @param options - Sanitization options
   * @returns Sanitized string
   */
  sanitize: (input: string, options: SanitizeOptions = {}): string => {
    const {
      removeControlChars = true,
      escapeHtml = false,
      maxLength,
      trim = true,
    } = options;

    if (!input || typeof input !== 'string') {
      return '';
    }

    let result = input;

    // Remove control characters (except \n, \r, \t)
    if (removeControlChars) {
      // eslint-disable-next-line no-control-regex
      result = result.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    }

    // Escape HTML entities
    if (escapeHtml) {
      result = result
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
    }

    // Trim
    if (trim) {
      result = result.trim();
    }

    // Enforce max length
    if (maxLength && result.length > maxLength) {
      result = result.substring(0, maxLength);
    }

    return result;
  },

  /**
   * Escape a string for safe use in shell commands.
   * Wraps the string in single quotes and escapes internal quotes.
   *
   * @param input - The string to escape
   * @returns Shell-safe escaped string
   */
  shellEscape: (input: string): string => {
    return sanitizeForShell(input);
  },

  /**
   * Validate a command for dangerous patterns.
   *
   * Checks for:
   * - Dangerous commands (rm -rf, fork bombs, etc.)
   * - Command injection patterns
   * - Remote code execution attempts
   *
   * @param input - The command to validate
   * @returns ValidationResult with command or error
   */
  command: (input: string): UnifiedValidationResult<string> => {
    return validateCommand(input);
  },

  /**
   * Check if a file path is safe (simple boolean check).
   * Use validators.path() for detailed validation with options.
   */
  isPathSafe: (input: string): boolean => {
    const result = validatePath(input);
    return result.valid;
  },

  /**
   * Check if a URL is safe (simple boolean check).
   * Use validators.url() for detailed validation with options.
   */
  isUrlSafe: (input: string): boolean => {
    const result = validators.url(input);
    return result.valid;
  },

  /**
   * Check if a string is valid JSON (simple boolean check).
   */
  isValidJson: (input: string): boolean => {
    try {
      JSON.parse(input);
      return true;
    } catch {
      return false;
    }
  },
};
