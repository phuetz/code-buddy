/**
 * JSON Validation Utilities
 *
 * Provides type-safe JSON parsing with schema validation using Zod.
 * Prevents runtime errors from malformed JSON and ensures type safety.
 */

import { z, ZodSchema, ZodError } from 'zod';

// ============================================================================
// Types
// ============================================================================

export interface ParseResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  zodError?: ZodError;
}

export interface ValidationOptions {
  /** Return partial data on validation error instead of undefined */
  allowPartial?: boolean;
  /** Custom error message prefix */
  errorPrefix?: string;
}

// ============================================================================
// Common Schemas
// ============================================================================

/**
 * Schema for configuration files
 */
export const ConfigFileSchema = z.object({
  mode: z.string().optional(),
  model: z.string().optional(),
  apiKey: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().positive().optional(),
}).passthrough(); // Allow additional fields

/**
 * Schema for approval mode config
 */
export const ApprovalModeConfigSchema = z.object({
  mode: z.enum(['read-only', 'auto', 'full-access']),
});

/**
 * Schema for settings
 */
export const SettingsSchema = z.object({
  model: z.string().optional(),
  provider: z.string().optional(),
  temperature: z.number().optional(),
  maxTokens: z.number().optional(),
  theme: z.string().optional(),
  language: z.string().optional(),
}).passthrough();

/**
 * Schema for session data
 */
export const SessionSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant', 'system', 'tool']),
    content: z.string().nullable(),
  }).passthrough()),
  createdAt: z.number().optional(),
  updatedAt: z.number().optional(),
}).passthrough();

/**
 * Schema for cache entries
 */
export const CacheEntrySchema = z.object({
  key: z.string(),
  value: z.unknown(),
  timestamp: z.number(),
  ttl: z.number().optional(),
}).passthrough();

/**
 * Schema for tool call results
 */
export const ToolCallSchema = z.object({
  id: z.string().optional(),
  type: z.literal('function').optional(),
  function: z.object({
    name: z.string(),
    arguments: z.string(),
  }),
}).passthrough();

/**
 * Schema for LLM response
 */
export const LLMResponseSchema = z.object({
  id: z.string().optional(),
  model: z.string().optional(),
  choices: z.array(z.object({
    message: z.object({
      role: z.string(),
      content: z.string().nullable(),
      tool_calls: z.array(ToolCallSchema).optional(),
    }).passthrough(),
    finish_reason: z.string().nullable().optional(),
  }).passthrough()).optional(),
  usage: z.object({
    prompt_tokens: z.number().optional(),
    completion_tokens: z.number().optional(),
    total_tokens: z.number().optional(),
  }).passthrough().optional(),
}).passthrough();

/**
 * Schema for GitHub API responses
 */
export const GitHubPRSchema = z.object({
  number: z.number(),
  title: z.string(),
  state: z.string(),
  body: z.string().nullable(),
  user: z.object({
    login: z.string(),
  }).passthrough().optional(),
  labels: z.array(z.object({
    name: z.string(),
  }).passthrough()).optional(),
  head: z.object({
    ref: z.string(),
    sha: z.string(),
  }).passthrough().optional(),
  base: z.object({
    ref: z.string(),
  }).passthrough().optional(),
}).passthrough();

/**
 * Schema for hook configuration
 */
export const HookConfigSchema = z.object({
  enabled: z.boolean().optional(),
  hooks: z.array(z.object({
    name: z.string(),
    event: z.string(),
    command: z.string().optional(),
    script: z.string().optional(),
  }).passthrough()).optional(),
}).passthrough();

// ============================================================================
// Parsing Functions
// ============================================================================

/**
 * Parse JSON string with schema validation
 *
 * @param jsonString - Raw JSON string to parse
 * @param schema - Zod schema to validate against
 * @param options - Parsing options
 * @returns ParseResult with typed data or error details
 */
export function parseJSON<T>(
  jsonString: string,
  schema: ZodSchema<T>,
  options: ValidationOptions = {}
): ParseResult<T> {
  const { errorPrefix = 'JSON validation failed' } = options;

  try {
    // First, parse the raw JSON
    const rawData = JSON.parse(jsonString);

    // Then, validate against schema
    const result = schema.safeParse(rawData);

    if (result.success) {
      return {
        success: true,
        data: result.data,
      };
    }

    return {
      success: false,
      error: `${errorPrefix}: ${formatZodError(result.error)}`,
      zodError: result.error,
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      return {
        success: false,
        error: `${errorPrefix}: Invalid JSON syntax - ${error.message}`,
      };
    }
    return {
      success: false,
      error: `${errorPrefix}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Parse JSON with schema validation, returning undefined on error
 */
export function parseJSONSafe<T>(
  jsonString: string,
  schema: ZodSchema<T>
): T | undefined {
  const result = parseJSON(jsonString, schema);
  return result.success ? result.data : undefined;
}

/**
 * Parse JSON with schema validation, throwing on error
 */
export function parseJSONStrict<T>(
  jsonString: string,
  schema: ZodSchema<T>,
  errorMessage?: string
): T {
  const result = parseJSON(jsonString, schema);
  if (!result.success) {
    throw new Error(errorMessage || result.error);
  }
  return result.data!;
}

/**
 * Parse JSON without schema validation (just type casting)
 * Use when you need to parse but validation is handled elsewhere
 */
export function parseJSONUntyped<T = unknown>(jsonString: string): ParseResult<T> {
  try {
    const data = JSON.parse(jsonString) as T;
    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Validate existing object against schema
 */
export function validateObject<T>(
  data: unknown,
  schema: ZodSchema<T>
): ParseResult<T> {
  const result = schema.safeParse(data);

  if (result.success) {
    return { success: true, data: result.data };
  }

  return {
    success: false,
    error: formatZodError(result.error),
    zodError: result.error,
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Format Zod error into human-readable string
 */
export function formatZodError(error: ZodError): string {
  const issues = error.issues.map((issue) => {
    const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    return `${path}${issue.message}`;
  });

  return issues.join('; ');
}

/**
 * Create a schema for array of items
 */
export function arrayOf<T>(itemSchema: ZodSchema<T>) {
  return z.array(itemSchema);
}

// Note: optionalWithDefault removed due to complex Zod typing
// Use z.optional().default() directly when needed

/**
 * Create a schema that accepts string or number and returns number
 */
export const stringOrNumber = z.union([z.string(), z.number()]).transform((val) =>
  typeof val === 'string' ? parseFloat(val) : val
);

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard for checking if value is a valid JSON string
 */
export function isValidJSON(value: string): boolean {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Type guard for checking if value matches schema
 */
export function matchesSchema<T>(value: unknown, schema: ZodSchema<T>): value is T {
  return schema.safeParse(value).success;
}

// ============================================================================
// Exports
// ============================================================================

export { z, ZodSchema, ZodError };
