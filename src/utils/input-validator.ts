/**
 * Input Validation Utilities
 *
 * Centralized input validation for CLI arguments, tool inputs, and API parameters.
 * Provides type-safe validation with clear error messages.
 *
 * Features:
 * - Zod-based schema validation for tool inputs
 * - Path sanitization and traversal prevention
 * - URL validation with protocol restrictions
 * - String size limits to prevent resource exhaustion
 * - Descriptive error messages for debugging
 */

import { z, ZodError, ZodSchema } from 'zod';
import * as path from 'path';

export interface ValidationResult<T = unknown> {
  valid: boolean;
  value?: T;
  error?: string;
}

export interface ValidationOptions {
  /** Field name for error messages */
  fieldName?: string;
  /** Allow empty strings (default: false) */
  allowEmpty?: boolean;
  /** Custom error message */
  customError?: string;
}

// ============================================================================
// String Validators
// ============================================================================

/**
 * Validate that a value is a non-empty string
 */
export function validateString(
  value: unknown,
  options: ValidationOptions = {}
): ValidationResult<string> {
  const { fieldName = 'value', allowEmpty = false, customError } = options;

  if (value === undefined || value === null) {
    return {
      valid: false,
      error: customError || `${fieldName} is required`,
    };
  }

  if (typeof value !== 'string') {
    return {
      valid: false,
      error: customError || `${fieldName} must be a string`,
    };
  }

  if (!allowEmpty && value.trim() === '') {
    return {
      valid: false,
      error: customError || `${fieldName} cannot be empty`,
    };
  }

  return { valid: true, value };
}

/**
 * Validate string with length constraints
 */
export function validateStringLength(
  value: unknown,
  minLength: number,
  maxLength: number,
  options: ValidationOptions = {}
): ValidationResult<string> {
  const stringResult = validateString(value, options);
  if (!stringResult.valid) return stringResult;

  const { fieldName = 'value' } = options;
  const str = stringResult.value!;

  if (str.length < minLength) {
    return {
      valid: false,
      error: `${fieldName} must be at least ${minLength} characters`,
    };
  }

  if (str.length > maxLength) {
    return {
      valid: false,
      error: `${fieldName} must be at most ${maxLength} characters`,
    };
  }

  return { valid: true, value: str };
}

/**
 * Validate string matches a pattern
 */
export function validatePattern(
  value: unknown,
  pattern: RegExp,
  options: ValidationOptions & { patternDescription?: string } = {}
): ValidationResult<string> {
  const stringResult = validateString(value, options);
  if (!stringResult.valid) return stringResult;

  const { fieldName = 'value', patternDescription = 'required format' } = options;
  const str = stringResult.value!;

  if (!pattern.test(str)) {
    return {
      valid: false,
      error: `${fieldName} does not match ${patternDescription}`,
    };
  }

  return { valid: true, value: str };
}

// ============================================================================
// Number Validators
// ============================================================================

/**
 * Validate that a value is a number
 */
export function validateNumber(
  value: unknown,
  options: ValidationOptions = {}
): ValidationResult<number> {
  const { fieldName = 'value', customError } = options;

  if (value === undefined || value === null) {
    return {
      valid: false,
      error: customError || `${fieldName} is required`,
    };
  }

  const num = typeof value === 'string' ? parseFloat(value) : value;

  if (typeof num !== 'number' || isNaN(num)) {
    return {
      valid: false,
      error: customError || `${fieldName} must be a valid number`,
    };
  }

  return { valid: true, value: num };
}

/**
 * Validate number within range
 */
export function validateNumberRange(
  value: unknown,
  min: number,
  max: number,
  options: ValidationOptions = {}
): ValidationResult<number> {
  const numResult = validateNumber(value, options);
  if (!numResult.valid) return numResult;

  const { fieldName = 'value' } = options;
  const num = numResult.value!;

  if (num < min || num > max) {
    return {
      valid: false,
      error: `${fieldName} must be between ${min} and ${max}`,
    };
  }

  return { valid: true, value: num };
}

/**
 * Validate positive integer
 */
export function validatePositiveInteger(
  value: unknown,
  options: ValidationOptions = {}
): ValidationResult<number> {
  const numResult = validateNumber(value, options);
  if (!numResult.valid) return numResult;

  const { fieldName = 'value' } = options;
  const num = numResult.value!;

  if (!Number.isInteger(num) || num < 1) {
    return {
      valid: false,
      error: `${fieldName} must be a positive integer`,
    };
  }

  return { valid: true, value: num };
}

// ============================================================================
// Array Validators
// ============================================================================

/**
 * Validate that a value is an array
 */
export function validateArray<T = unknown>(
  value: unknown,
  options: ValidationOptions & { minLength?: number; maxLength?: number } = {}
): ValidationResult<T[]> {
  const { fieldName = 'value', minLength, maxLength, customError } = options;

  if (value === undefined || value === null) {
    return {
      valid: false,
      error: customError || `${fieldName} is required`,
    };
  }

  if (!Array.isArray(value)) {
    return {
      valid: false,
      error: customError || `${fieldName} must be an array`,
    };
  }

  if (minLength !== undefined && value.length < minLength) {
    return {
      valid: false,
      error: `${fieldName} must have at least ${minLength} items`,
    };
  }

  if (maxLength !== undefined && value.length > maxLength) {
    return {
      valid: false,
      error: `${fieldName} must have at most ${maxLength} items`,
    };
  }

  return { valid: true, value: value as T[] };
}

// ============================================================================
// Object Validators
// ============================================================================

/**
 * Validate that a value is a non-null object
 */
export function validateObject<T extends Record<string, unknown> = Record<string, unknown>>(
  value: unknown,
  options: ValidationOptions = {}
): ValidationResult<T> {
  const { fieldName = 'value', customError } = options;

  if (value === undefined || value === null) {
    return {
      valid: false,
      error: customError || `${fieldName} is required`,
    };
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    return {
      valid: false,
      error: customError || `${fieldName} must be an object`,
    };
  }

  return { valid: true, value: value as T };
}

// ============================================================================
// Enum/Choice Validators
// ============================================================================

/**
 * Validate that a value is one of the allowed choices
 */
export function validateChoice<T extends string>(
  value: unknown,
  choices: readonly T[],
  options: ValidationOptions = {}
): ValidationResult<T> {
  const stringResult = validateString(value, options);
  if (!stringResult.valid) return stringResult as ValidationResult<T>;

  const { fieldName = 'value' } = options;
  const str = stringResult.value!;

  if (!choices.includes(str as T)) {
    return {
      valid: false,
      error: `${fieldName} must be one of: ${choices.join(', ')}`,
    };
  }

  return { valid: true, value: str as T };
}

// ============================================================================
// Boolean Validators
// ============================================================================

/**
 * Validate and parse boolean value
 */
export function validateBoolean(
  value: unknown,
  options: ValidationOptions = {}
): ValidationResult<boolean> {
  const { fieldName = 'value', customError } = options;

  if (value === undefined || value === null) {
    return {
      valid: false,
      error: customError || `${fieldName} is required`,
    };
  }

  if (typeof value === 'boolean') {
    return { valid: true, value };
  }

  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    if (lower === 'true' || lower === '1' || lower === 'yes') {
      return { valid: true, value: true };
    }
    if (lower === 'false' || lower === '0' || lower === 'no') {
      return { valid: true, value: false };
    }
  }

  if (typeof value === 'number') {
    return { valid: true, value: value !== 0 };
  }

  return {
    valid: false,
    error: customError || `${fieldName} must be a boolean`,
  };
}

// ============================================================================
// Special Validators
// ============================================================================

/**
 * Validate URL format
 */
export function validateUrl(
  value: unknown,
  options: ValidationOptions & { protocols?: string[] } = {}
): ValidationResult<string> {
  const stringResult = validateString(value, options);
  if (!stringResult.valid) return stringResult;

  const { fieldName = 'URL', protocols = ['http:', 'https:'] } = options;
  const str = stringResult.value!;

  try {
    const url = new URL(str);
    if (!protocols.includes(url.protocol)) {
      return {
        valid: false,
        error: `${fieldName} must use one of these protocols: ${protocols.join(', ')}`,
      };
    }
    return { valid: true, value: str };
  } catch {
    return {
      valid: false,
      error: `${fieldName} is not a valid URL`,
    };
  }
}

/**
 * Validate email format
 */
export function validateEmail(
  value: unknown,
  options: ValidationOptions = {}
): ValidationResult<string> {
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return validatePattern(value, emailPattern, {
    ...options,
    fieldName: options.fieldName || 'email',
    patternDescription: 'a valid email format',
  });
}

/**
 * Validate file path (basic check, not security)
 */
export function validateFilePath(
  value: unknown,
  options: ValidationOptions & { mustBeAbsolute?: boolean } = {}
): ValidationResult<string> {
  const stringResult = validateString(value, options);
  if (!stringResult.valid) return stringResult;

  const { fieldName = 'file path', mustBeAbsolute = false } = options;
  const str = stringResult.value!;

  // Check for null bytes (security)
  if (str.includes('\0')) {
    return {
      valid: false,
      error: `${fieldName} contains invalid characters`,
    };
  }

  // Check absolute path requirement
  if (mustBeAbsolute && !str.startsWith('/') && !str.match(/^[A-Za-z]:\\/)) {
    return {
      valid: false,
      error: `${fieldName} must be an absolute path`,
    };
  }

  return { valid: true, value: str };
}

// ============================================================================
// Composite Validators
// ============================================================================

/**
 * Validate optional value (returns valid with undefined if not provided)
 */
export function validateOptional<T>(
  value: unknown,
  validator: (value: unknown, options: ValidationOptions) => ValidationResult<T>,
  options: ValidationOptions = {}
): ValidationResult<T | undefined> {
  if (value === undefined || value === null) {
    return { valid: true, value: undefined };
  }
  return validator(value, options);
}

/**
 * Validate with default value
 */
export function validateWithDefault<T>(
  value: unknown,
  defaultValue: T,
  validator: (value: unknown, options: ValidationOptions) => ValidationResult<T>,
  options: ValidationOptions = {}
): ValidationResult<T> {
  if (value === undefined || value === null) {
    return { valid: true, value: defaultValue };
  }
  return validator(value, options);
}

// ============================================================================
// Schema-based Validation
// ============================================================================

export interface SchemaField<T = unknown> {
  validator: (value: unknown, options: ValidationOptions) => ValidationResult<T>;
  required?: boolean;
  default?: T;
  fieldName?: string;
}

export type Schema = Record<string, SchemaField>;

/**
 * Validate an object against a schema
 */
export function validateSchema<T extends Record<string, unknown>>(
  data: unknown,
  schema: Schema,
  options: { strict?: boolean } = {}
): ValidationResult<T> {
  const objectResult = validateObject(data);
  if (!objectResult.valid) return objectResult as ValidationResult<T>;

  const obj = objectResult.value!;
  const result: Record<string, unknown> = {};
  const errors: string[] = [];

  for (const [key, field] of Object.entries(schema)) {
    const value = obj[key];
    const fieldName = field.fieldName || key;

    if (value === undefined || value === null) {
      if (field.required !== false && field.default === undefined) {
        errors.push(`${fieldName} is required`);
      } else if (field.default !== undefined) {
        result[key] = field.default;
      }
      continue;
    }

    const fieldResult = field.validator(value, { fieldName });
    if (!fieldResult.valid) {
      errors.push(fieldResult.error!);
    } else {
      result[key] = fieldResult.value;
    }
  }

  // Check for unknown keys in strict mode
  if (options.strict) {
    const schemaKeys = new Set(Object.keys(schema));
    for (const key of Object.keys(obj)) {
      if (!schemaKeys.has(key)) {
        errors.push(`Unknown field: ${key}`);
      }
    }
  }

  if (errors.length > 0) {
    return {
      valid: false,
      error: errors.join('; '),
    };
  }

  return { valid: true, value: result as T };
}

// ============================================================================
// Assertion Helpers
// ============================================================================

/**
 * Assert validation passes or throw error
 */
export function assertValid<T>(result: ValidationResult<T>, context?: string): T {
  if (!result.valid) {
    const prefix = context ? `${context}: ` : '';
    throw new Error(`${prefix}${result.error}`);
  }
  return result.value!;
}

/**
 * Create a throwing validator
 */
export function createAssertingValidator<T>(
  validator: (value: unknown, options?: ValidationOptions) => ValidationResult<T>
): (value: unknown, context?: string, options?: ValidationOptions) => T {
  return (value: unknown, context?: string, options?: ValidationOptions) => {
    return assertValid(validator(value, options), context);
  };
}

// Pre-built asserting validators
export const assertString = createAssertingValidator(validateString);
export const assertNumber = createAssertingValidator(validateNumber);
export const assertPositiveInteger = createAssertingValidator(validatePositiveInteger);
export const assertArray = createAssertingValidator(validateArray);
export const assertObject = createAssertingValidator(validateObject);
export const assertBoolean = createAssertingValidator(validateBoolean);
export const assertUrl = createAssertingValidator(validateUrl);
export const assertEmail = createAssertingValidator(validateEmail);
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

/**
 * Dangerous command patterns for validation
 * These patterns detect various command injection and dangerous operation attempts
 */
const DANGEROUS_PATTERNS: RegExp[] = [
  // Filesystem destruction
  /rm\s+(-rf?|--recursive)\s+[/~]/i,          // rm -rf / or ~
  /rm\s+.*\/\s*$/i,                            // rm something/
  />\s*\/dev\/sd[a-z]/i,                       // Write to disk device
  /dd\s+.*if=.*of=\/dev/i,                     // dd to device
  /mkfs/i,                                      // Format filesystem
  /:\(\)\s*\{\s*:\|:&\s*\};:/,                 // Fork bomb :(){ :|:& };:
  /chmod\s+-R\s+777\s+\//i,                    // chmod 777 /

  // Remote code execution via pipe to shell
  /wget.*\|\s*(ba)?sh/i,                       // wget | sh
  /curl.*\|\s*(ba)?sh/i,                       // curl | sh
  /base64\s+(-d|--decode).*\|\s*(ba)?sh/i,    // base64 -d | sh

  // Sudo with dangerous commands
  /sudo\s+(rm|dd|mkfs)/i,

  // Command injection via command substitution
  /\$\([^)]*(?:rm|dd|mkfs|chmod|chown|curl|wget|nc|netcat|bash|sh|eval|exec)/i,  // $(dangerous_cmd)
  /`[^`]*(?:rm|dd|mkfs|chmod|chown|curl|wget|nc|netcat|bash|sh|eval|exec)/i,     // `dangerous_cmd`

  // Dangerous variable expansion that could leak secrets
  /\$\{?(?:GROK_API_KEY|AWS_SECRET|AWS_ACCESS_KEY|GITHUB_TOKEN|NPM_TOKEN|MORPH_API_KEY|DATABASE_URL|DB_PASSWORD|SECRET_KEY|PRIVATE_KEY|API_KEY|API_SECRET|AUTH_TOKEN|ACCESS_TOKEN)\}?/i,

  // Eval and exec injection
  /\beval\s+.*\$/i,                            // eval with variable expansion
  /\bexec\s+\d*[<>]/i,                         // exec with redirections

  // Hex/octal encoded commands (potential obfuscation)
  /\\x[0-9a-f]{2}/i,                           // Hex escape sequences
  /\\[0-7]{3}/,                                // Octal escape sequences
  /\$'\\x/i,                                   // ANSI-C quoting with hex

  // Network exfiltration and reverse shells
  /\|\s*(nc|netcat|curl|wget)\s+[^|]*(>|>>)/i, // pipe to network tool with redirect
  />\s*\/dev\/(tcp|udp)\//i,                   // bash network redirection
  /\bnc\s+-[elp]/i,                            // netcat listen/exec modes
  /\bbash\s+-i\s+>&?\s*\/dev\/(tcp|udp)/i,    // bash reverse shell

  // Python/Perl/Ruby one-liners that could be dangerous
  /python[23]?\s+-c\s+['"].*(?:socket|subprocess|os\.system|eval|exec)/i,
  /perl\s+-e\s+['"].*(?:socket|system|exec)/i,
  /ruby\s+-e\s+['"].*(?:socket|system|exec)/i,
];

/**
 * Validate a command for dangerous patterns
 */
export function validateCommand(command: string): ValidationResult<string> {
  if (!command || typeof command !== 'string') {
    return { valid: false, error: 'Command must be a non-empty string' };
  }

  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      return { valid: false, error: `Dangerous command pattern detected` };
    }
  }

  return { valid: true, value: command };
}

/**
 * Sanitize a string for safe shell use
 */
export function sanitizeForShell(input: string): string {
  if (!input || typeof input !== 'string') return '';

  // Escape single quotes by ending the quote, adding escaped quote, and reopening
  const escaped = input.replace(/'/g, "'\\''");

  // Wrap in single quotes for safety
  return `'${escaped}'`;
}

// ============================================================================
// Zod-based Tool Input Schemas
// ============================================================================

/**
 * Configuration for input validation
 */
export const VALIDATION_LIMITS = {
  /** Maximum file path length */
  MAX_PATH_LENGTH: 4096,
  /** Maximum content size for file creation (10MB) */
  MAX_CONTENT_SIZE: 10 * 1024 * 1024,
  /** Maximum command length */
  MAX_COMMAND_LENGTH: 100000,
  /** Maximum URL length */
  MAX_URL_LENGTH: 2048,
  /** Maximum search query length */
  MAX_QUERY_LENGTH: 10000,
  /** Maximum code edit size (5MB) */
  MAX_CODE_EDIT_SIZE: 5 * 1024 * 1024,
  /** Maximum number of lines for file view */
  MAX_VIEW_LINES: 10000,
} as const;

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
export const strReplaceEditorSchema = z.object({
  path: safePathSchema,
  old_str: z.string()
    .min(1, 'old_str cannot be empty')
    .max(VALIDATION_LIMITS.MAX_CONTENT_SIZE, 'old_str exceeds maximum size'),
  new_str: z.string()
    .max(VALIDATION_LIMITS.MAX_CONTENT_SIZE, 'new_str exceeds maximum size'),
  replace_all: z.boolean().optional(),
});

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
// Path Sanitization
// ============================================================================

/**
 * Dangerous path patterns that should be blocked
 */
const DANGEROUS_PATH_PATTERNS = [
  /^\/etc\/(passwd|shadow|sudoers)/i,
  /^\/root\//,
  /\.ssh\/(id_rsa|id_ed25519|authorized_keys)/i,
  /\.(env|credentials|secrets?)(\.local)?$/i,
  /\/\.git\/config$/,
];

/**
 * Sanitize and validate a file path for write operations
 *
 * @param inputPath - The path to sanitize
 * @param basePath - Optional base path to resolve relative paths against
 * @returns Sanitized absolute path
 * @throws Error if path is dangerous or invalid
 */
export function sanitizeFilePath(inputPath: string, basePath?: string): string {
  if (!inputPath || typeof inputPath !== 'string') {
    throw new Error('Path must be a non-empty string');
  }

  // Check for null bytes
  if (inputPath.includes('\0')) {
    throw new Error('Path contains null bytes');
  }

  // Normalize the path
  let normalizedPath = path.normalize(inputPath);

  // Resolve to absolute path if base path provided
  if (basePath && !path.isAbsolute(normalizedPath)) {
    normalizedPath = path.resolve(basePath, normalizedPath);
  }

  // Check for dangerous patterns
  for (const pattern of DANGEROUS_PATH_PATTERNS) {
    if (pattern.test(normalizedPath)) {
      throw new Error(`Access to sensitive path is not allowed: ${inputPath}`);
    }
  }

  return normalizedPath;
}

/**
 * Check if a path is safe for write operations (doesn't throw, returns boolean)
 */
export function isPathSafeForWrite(inputPath: string, basePath?: string): boolean {
  try {
    sanitizeFilePath(inputPath, basePath);
    return true;
  } catch {
    return false;
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
