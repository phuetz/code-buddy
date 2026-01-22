/**
 * Configuration Validator with Zod Schema
 *
 * Validates configuration files using Zod with helpful error messages.
 * Provides comprehensive validation for all CodeBuddy configuration files.
 *
 * Features:
 * - Complete Zod schema definitions for all config files
 * - Strict type validation with TypeScript inference
 * - Default value extraction and application
 * - Clear, actionable error messages with suggestions
 * - Fail-fast startup validation
 * - Automatic migration from old config formats
 * - Environment variable validation
 * - Documentation generation from schemas
 */

import { z, ZodError, ZodSchema, ZodObject, ZodDefault, ZodOptional, ZodType } from 'zod';
import { logger } from "./logger.js";
import fs from 'fs-extra';
import * as path from 'path';
import os from 'os';

// JSON Schema types
export interface JSONSchema {
  type?: string | string[];
  properties?: Record<string, JSONSchema>;
  required?: string[];
  items?: JSONSchema;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  default?: unknown;
  description?: string;
  additionalProperties?: boolean | JSONSchema;
  oneOf?: JSONSchema[];
  anyOf?: JSONSchema[];
  allOf?: JSONSchema[];
  $ref?: string;
  // Extended schema properties
  examples?: unknown[];
  deprecated?: boolean;
  deprecationMessage?: string;
  sensitive?: boolean; // Marks sensitive fields like API keys
  envVar?: string; // Associated environment variable
  since?: string; // Version when option was added
}

export interface ValidationError {
  path: string;
  message: string;
  expected?: string;
  received?: string;
  suggestion?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
  /** Validated and transformed data with defaults applied */
  data?: unknown;
}

// ============================================================================
// Zod Schema Definitions
// ============================================================================

/**
 * Valid AI provider options
 */
export const AI_PROVIDERS = ['grok', 'claude', 'openai', 'gemini', 'ollama', 'lmstudio', 'local'] as const;
export type AIProvider = typeof AI_PROVIDERS[number];

/**
 * Valid autonomy levels
 */
export const AUTONOMY_LEVELS = ['suggest', 'confirm', 'auto', 'full', 'yolo'] as const;
export type AutonomyLevel = typeof AUTONOMY_LEVELS[number];

/**
 * Valid agent modes
 */
export const AGENT_MODES = ['plan', 'code', 'ask', 'architect'] as const;
export type AgentMode = typeof AGENT_MODES[number];

/**
 * Valid hook events
 */
export const HOOK_EVENTS = ['PreToolUse', 'PostToolUse', 'SessionStart', 'SessionEnd', 'Notification'] as const;
export type HookEvent = typeof HOOK_EVENTS[number];

/**
 * Valid theme options
 */
export const THEMES = ['dark', 'light', 'auto', 'default', 'neon', 'pastel', 'matrix', 'ocean', 'sunset', 'minimal', 'high-contrast'] as const;
export type Theme = typeof THEMES[number];

// ----------------------------------------------------------------------------
// Settings Schema (project-level .codebuddy/settings.json)
// ----------------------------------------------------------------------------

export const SettingsSchema = z.object({
  model: z.string()
    .min(1, 'Model name cannot be empty')
    .max(100, 'Model name too long')
    .default('grok-3-latest')
    .describe('Default AI model to use'),

  maxRounds: z.number()
    .int('Must be an integer')
    .min(1, 'Minimum 1 round')
    .max(500, 'Maximum 500 rounds')
    .default(30)
    .describe('Maximum tool execution rounds per request'),

  autonomyLevel: z.enum(AUTONOMY_LEVELS)
    .default('confirm')
    .describe('Level of autonomous operation'),

  enableRAG: z.boolean()
    .default(true)
    .describe('Enable RAG-based tool selection'),

  parallelTools: z.boolean()
    .default(true)
    .describe('Enable parallel tool execution'),

  temperature: z.number()
    .min(0, 'Temperature cannot be negative')
    .max(2, 'Temperature cannot exceed 2')
    .default(0.7)
    .describe('Model temperature for response variation'),

  maxTokens: z.number()
    .int('Must be an integer')
    .min(100, 'Minimum 100 tokens')
    .max(200000, 'Maximum 200000 tokens')
    .optional()
    .describe('Maximum tokens per request'),

  agentMode: z.enum(AGENT_MODES)
    .optional()
    .describe('Default agent mode'),

  contextWindow: z.number()
    .int()
    .min(1000)
    .max(200000)
    .optional()
    .describe('Context window size in tokens'),

  enableCheckpoints: z.boolean()
    .default(true)
    .describe('Enable automatic checkpoints for file changes'),

  enableTelemetry: z.boolean()
    .default(false)
    .describe('Enable anonymous usage telemetry'),
}).strict();

export type Settings = z.infer<typeof SettingsSchema>;

// ----------------------------------------------------------------------------
// User Settings Schema (global ~/.codebuddy/user-settings.json)
// ----------------------------------------------------------------------------

export const UserSettingsSchema = z.object({
  apiKey: z.string()
    .min(1, 'API key cannot be empty')
    .optional()
    .describe('API key for the AI provider'),

  baseURL: z.string()
    .url('Must be a valid URL')
    .regex(/^https?:\/\//, 'URL must start with http:// or https://')
    .optional()
    .describe('Custom API base URL'),

  defaultModel: z.string()
    .min(1)
    .max(100)
    .default('grok-code-fast-1')
    .describe('Default model for all sessions'),

  models: z.array(z.string().min(1))
    .default(['grok-code-fast-1', 'grok-4-latest', 'grok-3-latest', 'grok-3-fast', 'grok-3-mini-fast'])
    .describe('List of available models'),

  provider: z.enum(AI_PROVIDERS)
    .default('grok')
    .describe('Active AI provider'),

  model: z.string()
    .optional()
    .describe('Current model override'),

  theme: z.enum(THEMES)
    .default('auto')
    .describe('UI color theme'),

  editor: z.string()
    .optional()
    .describe('Preferred text editor command'),

  shell: z.string()
    .optional()
    .describe('Preferred shell'),

  language: z.string()
    .regex(/^[a-z]{2}(-[A-Z]{2})?$/, 'Invalid language code (e.g., en, en-US)')
    .default('en')
    .describe('Preferred language'),
}).strict();

export type UserSettings = z.infer<typeof UserSettingsSchema>;

// ----------------------------------------------------------------------------
// Hooks Schema (.codebuddy/hooks.json)
// ----------------------------------------------------------------------------

export const HookSchema = z.object({
  event: z.enum(HOOK_EVENTS)
    .describe('Hook trigger event'),

  pattern: z.string()
    .optional()
    .describe('Regex pattern to match tool names'),

  command: z.string()
    .min(1, 'Command cannot be empty')
    .describe('Shell command to execute'),

  description: z.string()
    .optional()
    .describe('Human-readable description'),

  timeout: z.number()
    .int()
    .min(1000, 'Minimum 1 second timeout')
    .max(300000, 'Maximum 5 minute timeout')
    .default(30000)
    .describe('Command timeout in milliseconds'),

  continueOnError: z.boolean()
    .default(false)
    .describe('Continue if hook fails'),

  enabled: z.boolean()
    .default(true)
    .describe('Whether hook is active'),
});

export const HooksConfigSchema = z.object({
  hooks: z.array(HookSchema)
    .default([])
    .describe('List of lifecycle hooks'),
}).strict();

export type HookConfig = z.infer<typeof HookSchema>;
export type HooksConfig = z.infer<typeof HooksConfigSchema>;

// ----------------------------------------------------------------------------
// MCP Server Schema (.codebuddy/mcp.json)
// ----------------------------------------------------------------------------

export const MCPServerSchema = z.object({
  command: z.string()
    .min(1, 'Command is required')
    .describe('Command to start the MCP server'),

  args: z.array(z.string())
    .default([])
    .describe('Command arguments'),

  env: z.record(z.string())
    .default({})
    .describe('Environment variables'),

  enabled: z.boolean()
    .default(true)
    .describe('Whether server is enabled'),

  alwaysAllow: z.array(z.string())
    .default([])
    .describe('Tools always allowed without confirmation'),

  autoStart: z.boolean()
    .default(true)
    .describe('Auto-start with session'),

  timeout: z.number()
    .int()
    .min(1000)
    .max(60000)
    .default(10000)
    .describe('Connection timeout in ms'),
});

export const MCPConfigSchema = z.object({
  servers: z.record(MCPServerSchema)
    .default({})
    .describe('MCP server configurations'),

  defaultTimeout: z.number()
    .int()
    .min(1000)
    .max(60000)
    .default(10000)
    .describe('Default server timeout'),
}).strict();

export type MCPServerConfig = z.infer<typeof MCPServerSchema>;
export type MCPConfig = z.infer<typeof MCPConfigSchema>;

// ----------------------------------------------------------------------------
// YOLO Mode Schema (.codebuddy/yolo.json)
// ----------------------------------------------------------------------------

export const YoloConfigSchema = z.object({
  enabled: z.boolean()
    .default(false)
    .describe('Enable YOLO mode'),

  allowList: z.array(z.string())
    .default([])
    .describe('Commands that can be auto-executed'),

  denyList: z.array(z.string())
    .default(['rm -rf', 'sudo rm', 'dd', 'mkfs', ':(){', 'chmod -R 777'])
    .describe('Commands that are always blocked'),

  maxAutoEdits: z.number()
    .int()
    .min(0)
    .max(100)
    .default(5)
    .describe('Maximum auto file edits per session'),

  maxAutoCommands: z.number()
    .int()
    .min(0)
    .max(100)
    .default(10)
    .describe('Maximum auto shell commands per session'),

  safeMode: z.boolean()
    .default(true)
    .describe('Extra safety checks in YOLO mode'),

  allowFileCreation: z.boolean()
    .default(true)
    .describe('Allow auto file creation'),

  allowFileDeletion: z.boolean()
    .default(false)
    .describe('Allow auto file deletion'),

  allowGitOperations: z.boolean()
    .default(false)
    .describe('Allow auto git commits/pushes'),

  maxCostPerSession: z.number()
    .min(0)
    .max(100)
    .default(10)
    .describe('Maximum cost per session in dollars'),
}).strict();

export type YoloConfig = z.infer<typeof YoloConfigSchema>;

// ----------------------------------------------------------------------------
// Environment Variables Schema
// ----------------------------------------------------------------------------

export const EnvVarsSchema = z.object({
  GROK_API_KEY: z.string()
    .min(1, 'API key cannot be empty')
    .optional()
    .describe('Grok API key from x.ai'),

  MORPH_API_KEY: z.string()
    .optional()
    .describe('Morph API key for fast file editing'),

  GROK_BASE_URL: z.string()
    .url()
    .optional()
    .describe('Custom API endpoint'),

  GROK_MODEL: z.string()
    .optional()
    .describe('Default model to use'),

  YOLO_MODE: z.enum(['true', 'false', '1', '0'])
    .transform(v => v === 'true' || v === '1')
    .optional()
    .describe('Enable YOLO mode'),

  MAX_COST: z.string()
    .transform(v => parseFloat(v))
    .pipe(z.number().min(0).max(1000))
    .optional()
    .describe('Session cost limit in dollars'),

  DEBUG: z.enum(['true', 'false', '1', '0'])
    .transform(v => v === 'true' || v === '1')
    .optional()
    .describe('Enable debug logging'),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error'])
    .optional()
    .describe('Log verbosity level'),

  CODEBUDDY_CONFIG_DIR: z.string()
    .optional()
    .describe('Custom config directory path'),

  NO_COLOR: z.string()
    .optional()
    .describe('Disable colored output'),

  FORCE_COLOR: z.string()
    .optional()
    .describe('Force colored output'),
});

export type EnvVars = z.infer<typeof EnvVarsSchema>;

// ----------------------------------------------------------------------------
// Schema Registry
// ----------------------------------------------------------------------------

/**
 * Map of schema names to their Zod schemas
 */
export const ZOD_SCHEMAS: Record<string, ZodSchema> = {
  'settings.json': SettingsSchema,
  'user-settings.json': UserSettingsSchema,
  'hooks.json': HooksConfigSchema,
  'mcp.json': MCPConfigSchema,
  'yolo.json': YoloConfigSchema,
  'env': EnvVarsSchema,
};

// ============================================================================
// Legacy JSON Schema Definitions (for backwards compatibility)
// ============================================================================

// Schema definitions for all config files
export const SCHEMAS: Record<string, JSONSchema> = {
  'settings.json': {
    type: 'object',
    properties: {
      model: {
        type: 'string',
        description: 'Default AI model to use',
        default: 'grok-3-latest',
      },
      maxRounds: {
        type: 'number',
        minimum: 1,
        maximum: 100,
        default: 30,
        description: 'Maximum tool execution rounds',
      },
      autonomyLevel: {
        type: 'string',
        enum: ['suggest', 'confirm', 'auto', 'full'],
        default: 'confirm',
        description: 'Level of autonomous operation',
      },
      enableRAG: {
        type: 'boolean',
        default: true,
        description: 'Enable RAG-based tool selection',
      },
      parallelTools: {
        type: 'boolean',
        default: true,
        description: 'Enable parallel tool execution',
      },
      temperature: {
        type: 'number',
        minimum: 0,
        maximum: 2,
        default: 0.7,
        description: 'Model temperature',
      },
      maxTokens: {
        type: 'number',
        minimum: 100,
        maximum: 200000,
        description: 'Maximum tokens per request',
      },
    },
    additionalProperties: false,
  },

  'user-settings.json': {
    type: 'object',
    properties: {
      apiKey: {
        type: 'string',
        minLength: 1,
        description: 'API key for Grok',
      },
      baseURL: {
        type: 'string',
        pattern: '^https?://',
        description: 'Custom API base URL',
      },
      defaultModel: {
        type: 'string',
        description: 'Default model for all sessions',
      },
      theme: {
        type: 'string',
        enum: ['dark', 'light', 'auto'],
        default: 'auto',
      },
    },
    additionalProperties: false,
  },

  'hooks.json': {
    type: 'object',
    properties: {
      hooks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            event: {
              type: 'string',
              enum: ['PreToolUse', 'PostToolUse', 'SessionStart', 'SessionEnd', 'Notification'],
              description: 'Hook trigger event',
            },
            pattern: {
              type: 'string',
              description: 'Regex pattern to match tool names',
            },
            command: {
              type: 'string',
              minLength: 1,
              description: 'Shell command to execute',
            },
            description: {
              type: 'string',
              description: 'Human-readable description',
            },
            timeout: {
              type: 'number',
              minimum: 1000,
              maximum: 300000,
              default: 30000,
              description: 'Command timeout in milliseconds',
            },
            continueOnError: {
              type: 'boolean',
              default: false,
              description: 'Continue if hook fails',
            },
          },
          required: ['event', 'command'],
        },
      },
    },
    required: ['hooks'],
    additionalProperties: false,
  },

  'mcp.json': {
    type: 'object',
    properties: {
      servers: {
        type: 'object',
        additionalProperties: {
          type: 'object',
          properties: {
            command: {
              type: 'string',
              minLength: 1,
              description: 'Command to start the MCP server',
            },
            args: {
              type: 'array',
              items: { type: 'string' },
              description: 'Command arguments',
            },
            env: {
              type: 'object',
              additionalProperties: { type: 'string' },
              description: 'Environment variables',
            },
            enabled: {
              type: 'boolean',
              default: true,
            },
          },
          required: ['command'],
        },
      },
    },
    required: ['servers'],
    additionalProperties: false,
  },

  'yolo.json': {
    type: 'object',
    properties: {
      enabled: {
        type: 'boolean',
        default: false,
        description: 'Enable YOLO mode',
      },
      allowList: {
        type: 'array',
        items: { type: 'string' },
        description: 'Commands that can be auto-executed',
      },
      denyList: {
        type: 'array',
        items: { type: 'string' },
        description: 'Commands that are always blocked',
      },
      maxAutoEdits: {
        type: 'number',
        minimum: 0,
        maximum: 100,
        default: 5,
        description: 'Maximum auto file edits per session',
      },
      maxAutoCommands: {
        type: 'number',
        minimum: 0,
        maximum: 100,
        default: 10,
        description: 'Maximum auto shell commands per session',
      },
      safeMode: {
        type: 'boolean',
        default: true,
        description: 'Extra safety checks in YOLO mode',
      },
    },
    additionalProperties: false,
  },
};

/**
 * Configuration Validator
 */
export class ConfigValidator {
  private schemas: Record<string, JSONSchema>;

  constructor(customSchemas?: Record<string, JSONSchema>) {
    this.schemas = { ...SCHEMAS, ...customSchemas };
  }

  /**
   * Validate a configuration object against a schema
   */
  validate(config: unknown, schemaName: string): ValidationResult {
    const schema = this.schemas[schemaName];
    if (!schema) {
      return {
        valid: false,
        errors: [{ path: '', message: `Unknown schema: ${schemaName}` }],
        warnings: [],
      };
    }

    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];

    this.validateValue(config, schema, '', errors, warnings);

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate a configuration file
   */
  async validateFile(filePath: string): Promise<ValidationResult> {
    const fileName = path.basename(filePath);

    // Check if file exists
    if (!await fs.pathExists(filePath)) {
      return {
        valid: false,
        errors: [{ path: filePath, message: 'File not found' }],
        warnings: [],
      };
    }

    // Read and parse file
    let config: unknown;
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      config = JSON.parse(content);
    } catch (error) {
      return {
        valid: false,
        errors: [{
          path: filePath,
          message: `Invalid JSON: ${error instanceof Error ? error.message : 'Parse error'}`,
          suggestion: 'Check for syntax errors like missing commas or quotes',
        }],
        warnings: [],
      };
    }

    return this.validate(config, fileName);
  }

  /**
   * Validate all config files in a directory
   */
  async validateDirectory(dirPath: string): Promise<Map<string, ValidationResult>> {
    const results = new Map<string, ValidationResult>();
    const schemaNames = Object.keys(this.schemas);

    // Check existence and validate files in parallel
    const validationResults = await Promise.all(
      schemaNames.map(async (schemaName) => {
        const filePath = path.join(dirPath, schemaName);
        if (await fs.pathExists(filePath)) {
          return { schemaName, result: await this.validateFile(filePath) };
        }
        return null;
      })
    );

    // Populate results map
    for (const entry of validationResults) {
      if (entry) {
        results.set(entry.schemaName, entry.result);
      }
    }

    return results;
  }

  /**
   * Get schema with defaults applied
   */
  getDefaults(schemaName: string): unknown {
    const schema = this.schemas[schemaName];
    if (!schema) return {};

    return this.extractDefaults(schema);
  }

  /**
   * Validate a value against a schema
   */
  private validateValue(
    value: unknown,
    schema: JSONSchema,
    path: string,
    errors: ValidationError[],
    warnings: ValidationError[]
  ): void {
    // Handle null/undefined
    if (value === null || value === undefined) {
      if (schema.default !== undefined) {
        warnings.push({
          path,
          message: 'Using default value',
          received: String(value),
          expected: String(schema.default),
        });
      }
      return;
    }

    // Type validation
    if (schema.type) {
      const types = Array.isArray(schema.type) ? schema.type : [schema.type];
      const actualType = this.getType(value);

      if (!types.includes(actualType)) {
        errors.push({
          path,
          message: `Invalid type`,
          expected: types.join(' | '),
          received: actualType,
          suggestion: `Value should be ${types.join(' or ')}`,
        });
        return;
      }
    }

    // Enum validation
    if (schema.enum && !schema.enum.includes(value)) {
      errors.push({
        path,
        message: 'Invalid enum value',
        expected: schema.enum.join(' | '),
        received: String(value),
        suggestion: `Must be one of: ${schema.enum.join(', ')}`,
      });
      return;
    }

    // String validations
    if (typeof value === 'string') {
      if (schema.minLength !== undefined && value.length < schema.minLength) {
        errors.push({
          path,
          message: `String too short`,
          expected: `>= ${schema.minLength} characters`,
          received: `${value.length} characters`,
        });
      }
      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        errors.push({
          path,
          message: `String too long`,
          expected: `<= ${schema.maxLength} characters`,
          received: `${value.length} characters`,
        });
      }
      if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
        errors.push({
          path,
          message: `Pattern mismatch`,
          expected: schema.pattern,
          received: value,
          suggestion: `Value must match pattern: ${schema.pattern}`,
        });
      }
    }

    // Number validations
    if (typeof value === 'number') {
      if (schema.minimum !== undefined && value < schema.minimum) {
        errors.push({
          path,
          message: `Number too small`,
          expected: `>= ${schema.minimum}`,
          received: String(value),
        });
      }
      if (schema.maximum !== undefined && value > schema.maximum) {
        errors.push({
          path,
          message: `Number too large`,
          expected: `<= ${schema.maximum}`,
          received: String(value),
        });
      }
    }

    // Object validations
    if (typeof value === 'object' && !Array.isArray(value) && value !== null) {
      const obj = value as Record<string, unknown>;

      // Required properties
      if (schema.required) {
        for (const required of schema.required) {
          if (!(required in obj)) {
            errors.push({
              path: path ? `${path}.${required}` : required,
              message: 'Required property missing',
              suggestion: `Add "${required}" property`,
            });
          }
        }
      }

      // Property validation
      if (schema.properties) {
        for (const [key, propSchema] of Object.entries(schema.properties)) {
          if (key in obj) {
            this.validateValue(
              obj[key],
              propSchema,
              path ? `${path}.${key}` : key,
              errors,
              warnings
            );
          }
        }
      }

      // Additional properties
      if (schema.additionalProperties === false) {
        const allowedKeys = new Set(Object.keys(schema.properties || {}));
        for (const key of Object.keys(obj)) {
          if (!allowedKeys.has(key)) {
            warnings.push({
              path: path ? `${path}.${key}` : key,
              message: 'Unknown property',
              suggestion: `Remove "${key}" or check spelling`,
            });
          }
        }
      } else if (typeof schema.additionalProperties === 'object') {
        const knownKeys = new Set(Object.keys(schema.properties || {}));
        for (const [key, val] of Object.entries(obj)) {
          if (!knownKeys.has(key)) {
            this.validateValue(
              val,
              schema.additionalProperties,
              path ? `${path}.${key}` : key,
              errors,
              warnings
            );
          }
        }
      }
    }

    // Array validations
    if (Array.isArray(value) && schema.items) {
      for (let i = 0; i < value.length; i++) {
        this.validateValue(
          value[i],
          schema.items,
          `${path}[${i}]`,
          errors,
          warnings
        );
      }
    }
  }

  /**
   * Get the JSON type of a value
   */
  private getType(value: unknown): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
  }

  /**
   * Extract default values from schema
   */
  private extractDefaults(schema: JSONSchema): unknown {
    if (schema.default !== undefined) {
      return schema.default;
    }

    if (schema.type === 'object' && schema.properties) {
      const defaults: Record<string, unknown> = {};
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        const defaultValue = this.extractDefaults(propSchema);
        if (defaultValue !== undefined) {
          defaults[key] = defaultValue;
        }
      }
      return Object.keys(defaults).length > 0 ? defaults : undefined;
    }

    if (schema.type === 'array') {
      return [];
    }

    return undefined;
  }

  /**
   * Format validation result for display
   */
  formatResult(result: ValidationResult, fileName: string): string {
    const lines: string[] = [];

    if (result.valid) {
      lines.push(`✅ ${fileName}: Valid`);
    } else {
      lines.push(`❌ ${fileName}: Invalid`);
    }

    for (const error of result.errors) {
      lines.push(`  ├─ ERROR at "${error.path || 'root'}": ${error.message}`);
      if (error.expected) {
        lines.push(`  │  Expected: ${error.expected}`);
      }
      if (error.received) {
        lines.push(`  │  Received: ${error.received}`);
      }
      if (error.suggestion) {
        lines.push(`  │  Suggestion: ${error.suggestion}`);
      }
    }

    for (const warning of result.warnings) {
      lines.push(`  ├─ WARNING at "${warning.path || 'root'}": ${warning.message}`);
      if (warning.suggestion) {
        lines.push(`  │  Suggestion: ${warning.suggestion}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Get available schemas
   */
  getSchemas(): string[] {
    return Object.keys(this.schemas);
  }

  /**
   * Get schema for a file
   */
  getSchema(name: string): JSONSchema | undefined {
    return this.schemas[name];
  }
}

// Singleton instance
let validatorInstance: ConfigValidator | null = null;

export function getConfigValidator(): ConfigValidator {
  if (!validatorInstance) {
    validatorInstance = new ConfigValidator();
  }
  return validatorInstance;
}

/**
 * Validate configuration on startup
 */
export async function validateStartupConfig(codebuddyDir: string): Promise<boolean> {
  const validator = getConfigValidator();
  const results = await validator.validateDirectory(codebuddyDir);

  let allValid = true;
  for (const [file, result] of results) {
    if (!result.valid) {
      logger.error(validator.formatResult(result, file));
      allValid = false;
    }
  }

  return allValid;
}

// ============================================================================
// Zod-based Configuration Validator
// ============================================================================

/**
 * Convert Zod error to ValidationError array
 */
function zodErrorToValidationErrors(error: ZodError): ValidationError[] {
  return error.errors.map(issue => {
    const path = issue.path.join('.');
    let suggestion: string | undefined;

    // Generate helpful suggestions based on error type
    switch (issue.code) {
      case 'invalid_type':
        suggestion = `Expected ${issue.expected}, but received ${issue.received}`;
        break;
      case 'invalid_enum_value':
        suggestion = `Valid options: ${(issue as { options?: string[] }).options?.join(', ')}`;
        break;
      case 'too_small':
        suggestion = `Value must be at least ${(issue as { minimum?: number }).minimum}`;
        break;
      case 'too_big':
        suggestion = `Value must be at most ${(issue as { maximum?: number }).maximum}`;
        break;
      case 'invalid_string':
        if ((issue as { validation?: string }).validation === 'url') {
          suggestion = 'Value must be a valid URL (e.g., https://api.example.com)';
        } else if ((issue as { validation?: string }).validation === 'regex') {
          suggestion = 'Value does not match the required format';
        }
        break;
      case 'unrecognized_keys':
        suggestion = `Unknown properties: ${(issue as { keys?: string[] }).keys?.join(', ')}. Check for typos or remove them.`;
        break;
    }

    return {
      path: path || 'root',
      message: issue.message,
      suggestion,
    };
  });
}

/**
 * Zod-based configuration validator with enhanced features
 */
export class ZodConfigValidator {
  private zodSchemas: Record<string, ZodSchema>;

  constructor(customSchemas?: Record<string, ZodSchema>) {
    this.zodSchemas = { ...ZOD_SCHEMAS, ...customSchemas };
  }

  /**
   * Validate configuration with Zod schema
   * Returns validated data with defaults applied
   */
  validate<T = unknown>(config: unknown, schemaName: string): ValidationResult & { data?: T } {
    const schema = this.zodSchemas[schemaName];
    if (!schema) {
      return {
        valid: false,
        errors: [{ path: '', message: `Unknown schema: ${schemaName}` }],
        warnings: [],
      };
    }

    try {
      const data = schema.parse(config) as T;
      return {
        valid: true,
        errors: [],
        warnings: [],
        data,
      };
    } catch (error) {
      if (error instanceof ZodError) {
        return {
          valid: false,
          errors: zodErrorToValidationErrors(error),
          warnings: [],
        };
      }
      throw error;
    }
  }

  /**
   * Safe parse - returns data or null without throwing
   */
  safeParse<T = unknown>(config: unknown, schemaName: string): { success: true; data: T } | { success: false; errors: ValidationError[] } {
    const result = this.validate<T>(config, schemaName);
    if (result.valid && result.data !== undefined) {
      return { success: true, data: result.data };
    }
    return { success: false, errors: result.errors };
  }

  /**
   * Validate and merge with defaults
   * Applies defaults for missing optional fields
   */
  validateWithDefaults<T = unknown>(config: unknown, schemaName: string): T | null {
    const result = this.safeParse<T>(config, schemaName);
    return result.success ? result.data : null;
  }

  /**
   * Validate a configuration file with Zod
   */
  async validateFile<T = unknown>(filePath: string): Promise<ValidationResult & { data?: T }> {
    const fileName = path.basename(filePath);

    // Check if file exists
    if (!await fs.pathExists(filePath)) {
      return {
        valid: false,
        errors: [{
          path: filePath,
          message: 'File not found',
          suggestion: `Create the file at ${filePath} or run 'buddy init' to generate default configuration`,
        }],
        warnings: [],
      };
    }

    // Read and parse file
    let config: unknown;
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      config = JSON.parse(content);
    } catch (error) {
      const jsonError = error instanceof SyntaxError ? error.message : 'Parse error';
      return {
        valid: false,
        errors: [{
          path: filePath,
          message: `Invalid JSON: ${jsonError}`,
          suggestion: 'Check for syntax errors: missing commas, unclosed brackets, or trailing commas',
        }],
        warnings: [],
      };
    }

    // Migrate old format if needed
    const migrated = await this.migrateConfig(config, fileName);

    return this.validate<T>(migrated, fileName);
  }

  /**
   * Validate all config files in a directory
   */
  async validateDirectory(dirPath: string): Promise<Map<string, ValidationResult>> {
    const results = new Map<string, ValidationResult>();
    const schemaNames = Object.keys(this.zodSchemas).filter(name => name !== 'env');

    const validationResults = await Promise.all(
      schemaNames.map(async (schemaName) => {
        const filePath = path.join(dirPath, schemaName);
        if (await fs.pathExists(filePath)) {
          return { schemaName, result: await this.validateFile(filePath) };
        }
        return null;
      })
    );

    for (const entry of validationResults) {
      if (entry) {
        results.set(entry.schemaName, entry.result);
      }
    }

    return results;
  }

  /**
   * Validate environment variables
   */
  validateEnvVars(): ValidationResult & { data?: EnvVars } {
    const envVars: Record<string, string | undefined> = {};

    // Extract relevant environment variables
    const relevantKeys = [
      'GROK_API_KEY', 'MORPH_API_KEY', 'GROK_BASE_URL', 'GROK_MODEL',
      'YOLO_MODE', 'MAX_COST', 'DEBUG', 'LOG_LEVEL',
      'CODEBUDDY_CONFIG_DIR', 'NO_COLOR', 'FORCE_COLOR'
    ];

    for (const key of relevantKeys) {
      if (process.env[key] !== undefined) {
        envVars[key] = process.env[key];
      }
    }

    return this.validate<EnvVars>(envVars, 'env');
  }

  /**
   * Get default values for a schema
   */
  getDefaults<T = unknown>(schemaName: string): T | undefined {
    const schema = this.zodSchemas[schemaName];
    if (!schema) return undefined;

    try {
      // Parse empty object to get defaults
      return schema.parse({}) as T;
    } catch {
      return undefined;
    }
  }

  /**
   * Generate schema documentation
   */
  generateDocs(schemaName: string): string {
    const schema = this.zodSchemas[schemaName];
    if (!schema) return `Unknown schema: ${schemaName}`;

    const lines: string[] = [
      `# Configuration: ${schemaName}`,
      '',
      '## Properties',
      '',
    ];

    // For ZodObject schemas, we can extract shape
    if (schema._def && 'shape' in schema._def) {
      const shape = (schema._def as { shape: () => Record<string, ZodType> }).shape();
      for (const [key, fieldSchema] of Object.entries(shape)) {
        const desc = fieldSchema.description || 'No description';
        const isOptional = fieldSchema.isOptional?.() ?? false;
        const defaultVal = this.getFieldDefault(fieldSchema);

        lines.push(`### \`${key}\`${isOptional ? ' (optional)' : ''}`);
        lines.push('');
        lines.push(desc);
        if (defaultVal !== undefined) {
          lines.push(`- Default: \`${JSON.stringify(defaultVal)}\``);
        }
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  /**
   * Get default value from a field schema
   */
  private getFieldDefault(schema: ZodType): unknown {
    if (schema._def && 'defaultValue' in schema._def) {
      const def = schema._def as { defaultValue: () => unknown };
      return typeof def.defaultValue === 'function' ? def.defaultValue() : def.defaultValue;
    }
    return undefined;
  }

  /**
   * Migrate old configuration formats to current format
   */
  async migrateConfig(config: unknown, schemaName: string): Promise<unknown> {
    if (typeof config !== 'object' || config === null) {
      return config;
    }

    const obj = config as Record<string, unknown>;
    const migrated = { ...obj };
    const migrations: string[] = [];

    switch (schemaName) {
      case 'settings.json':
        // Migrate old 'security' to 'autonomyLevel'
        if ('security' in obj && !('autonomyLevel' in obj)) {
          const securityMap: Record<string, string> = {
            'suggest': 'suggest',
            'auto-edit': 'auto',
            'full-auto': 'full',
          };
          migrated.autonomyLevel = securityMap[obj.security as string] || 'confirm';
          delete migrated.security;
          migrations.push('Migrated "security" to "autonomyLevel"');
        }

        // Migrate old 'maxToolRounds' to 'maxRounds'
        if ('maxToolRounds' in obj && !('maxRounds' in obj)) {
          migrated.maxRounds = obj.maxToolRounds;
          delete migrated.maxToolRounds;
          migrations.push('Migrated "maxToolRounds" to "maxRounds"');
        }

        // Migrate 'enableToolCache' to 'enableRAG'
        if ('enableToolCache' in obj && !('enableRAG' in obj)) {
          migrated.enableRAG = obj.enableToolCache;
          delete migrated.enableToolCache;
          migrations.push('Migrated "enableToolCache" to "enableRAG"');
        }
        break;

      case 'user-settings.json':
        // Migrate old 'grokApiKey' to 'apiKey'
        if ('grokApiKey' in obj && !('apiKey' in obj)) {
          migrated.apiKey = obj.grokApiKey;
          delete migrated.grokApiKey;
          migrations.push('Migrated "grokApiKey" to "apiKey"');
        }

        // Migrate old 'grokBaseUrl' to 'baseURL'
        if ('grokBaseUrl' in obj && !('baseURL' in obj)) {
          migrated.baseURL = obj.grokBaseUrl;
          delete migrated.grokBaseUrl;
          migrations.push('Migrated "grokBaseUrl" to "baseURL"');
        }
        break;

      case 'mcp.json':
        // Migrate old format without 'servers' wrapper
        if (!('servers' in obj) && Object.keys(obj).some(k => {
          const val = obj[k];
          return typeof val === 'object' && val !== null && 'command' in val;
        })) {
          migrated.servers = { ...obj };
          // Remove migrated keys from root
          for (const key of Object.keys(obj)) {
            if (key !== 'servers') {
              delete migrated[key];
            }
          }
          migrations.push('Wrapped MCP servers in "servers" object');
        }
        break;
    }

    if (migrations.length > 0) {
      logger.info(`Config migration for ${schemaName}:\n  - ${migrations.join('\n  - ')}`);
    }

    return migrated;
  }

  /**
   * Format validation result for display
   */
  formatResult(result: ValidationResult, fileName: string): string {
    const lines: string[] = [];

    if (result.valid) {
      lines.push(`[OK] ${fileName}: Valid configuration`);
    } else {
      lines.push(`[ERROR] ${fileName}: Invalid configuration`);
    }

    for (const error of result.errors) {
      lines.push(`  - ERROR at "${error.path}": ${error.message}`);
      if (error.suggestion) {
        lines.push(`    Suggestion: ${error.suggestion}`);
      }
    }

    for (const warning of result.warnings) {
      lines.push(`  - WARNING at "${warning.path}": ${warning.message}`);
      if (warning.suggestion) {
        lines.push(`    Suggestion: ${warning.suggestion}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Get list of available schemas
   */
  getSchemas(): string[] {
    return Object.keys(this.zodSchemas);
  }

  /**
   * Get Zod schema by name
   */
  getSchema(name: string): ZodSchema | undefined {
    return this.zodSchemas[name];
  }
}

// Singleton instance for Zod validator
let zodValidatorInstance: ZodConfigValidator | null = null;

export function getZodConfigValidator(): ZodConfigValidator {
  if (!zodValidatorInstance) {
    zodValidatorInstance = new ZodConfigValidator();
  }
  return zodValidatorInstance;
}

// ============================================================================
// Enhanced Startup Validation
// ============================================================================

/**
 * Result of comprehensive startup validation
 */
export interface StartupValidationResult {
  valid: boolean;
  configResults: Map<string, ValidationResult>;
  envResult: ValidationResult;
  warnings: string[];
  errors: string[];
  validatedConfigs: {
    settings?: Settings;
    userSettings?: UserSettings;
    hooks?: HooksConfig;
    mcp?: MCPConfig;
    yolo?: YoloConfig;
    env?: EnvVars;
  };
}

/**
 * Comprehensive startup validation with Zod
 * Validates all configuration files and environment variables
 */
export async function validateStartupConfigWithZod(
  projectDir: string,
  userDir?: string
): Promise<StartupValidationResult> {
  const validator = getZodConfigValidator();
  const warnings: string[] = [];
  const errors: string[] = [];
  const validatedConfigs: StartupValidationResult['validatedConfigs'] = {};

  // Validate project-level configs
  const projectConfigDir = path.join(projectDir, '.codebuddy');
  const configResults = await validator.validateDirectory(projectConfigDir);

  // Validate user-level settings
  const userConfigDir = userDir || path.join(os.homedir(), '.codebuddy');
  const userSettingsPath = path.join(userConfigDir, 'user-settings.json');

  if (await fs.pathExists(userSettingsPath)) {
    const userResult = await validator.validateFile<UserSettings>(userSettingsPath);
    configResults.set('user-settings.json', userResult);
    if (userResult.valid && userResult.data) {
      validatedConfigs.userSettings = userResult.data;
    }
  }

  // Extract validated configs
  for (const [file, result] of configResults) {
    if (result.valid && result.data) {
      switch (file) {
        case 'settings.json':
          validatedConfigs.settings = result.data as Settings;
          break;
        case 'hooks.json':
          validatedConfigs.hooks = result.data as HooksConfig;
          break;
        case 'mcp.json':
          validatedConfigs.mcp = result.data as MCPConfig;
          break;
        case 'yolo.json':
          validatedConfigs.yolo = result.data as YoloConfig;
          break;
      }
    } else if (!result.valid) {
      errors.push(validator.formatResult(result, file));
    }
  }

  // Validate environment variables
  const envResult = validator.validateEnvVars();
  if (envResult.valid && envResult.data) {
    validatedConfigs.env = envResult.data;
  } else if (!envResult.valid) {
    // Environment errors are warnings, not fatal
    for (const err of envResult.errors) {
      warnings.push(`Environment variable "${err.path}": ${err.message}`);
    }
  }

  // Check for required API key
  if (!validatedConfigs.userSettings?.apiKey && !process.env.GROK_API_KEY) {
    warnings.push(
      'No API key configured. Set GROK_API_KEY environment variable or configure apiKey in user-settings.json'
    );
  }

  const allValid = errors.length === 0;

  return {
    valid: allValid,
    configResults,
    envResult,
    warnings,
    errors,
    validatedConfigs,
  };
}

/**
 * Quick validation check - returns boolean
 */
export async function isConfigValid(projectDir: string): Promise<boolean> {
  const result = await validateStartupConfigWithZod(projectDir);
  return result.valid;
}

/**
 * Load and validate settings with defaults
 */
export async function loadValidatedSettings(filePath: string): Promise<Settings> {
  const validator = getZodConfigValidator();

  if (!await fs.pathExists(filePath)) {
    // Return defaults if file doesn't exist
    return validator.getDefaults<Settings>('settings.json') || {
      model: 'grok-3-latest',
      maxRounds: 30,
      autonomyLevel: 'confirm',
      enableRAG: true,
      parallelTools: true,
      temperature: 0.7,
      enableCheckpoints: true,
      enableTelemetry: false,
    };
  }

  const result = await validator.validateFile<Settings>(filePath);
  if (result.valid && result.data) {
    return result.data;
  }

  // Log errors but return defaults
  logger.warn(`Invalid settings at ${filePath}, using defaults`);
  for (const err of result.errors) {
    logger.warn(`  - ${err.path}: ${err.message}`);
  }

  return validator.getDefaults<Settings>('settings.json') || {
    model: 'grok-3-latest',
    maxRounds: 30,
    autonomyLevel: 'confirm',
    enableRAG: true,
    parallelTools: true,
    temperature: 0.7,
    enableCheckpoints: true,
    enableTelemetry: false,
  };
}

/**
 * Load and validate user settings with defaults
 */
export async function loadValidatedUserSettings(filePath: string): Promise<UserSettings> {
  const validator = getZodConfigValidator();

  if (!await fs.pathExists(filePath)) {
    return validator.getDefaults<UserSettings>('user-settings.json') || {
      defaultModel: 'grok-code-fast-1',
      models: ['grok-code-fast-1', 'grok-4-latest', 'grok-3-latest'],
      provider: 'grok',
      theme: 'auto',
      language: 'en',
    };
  }

  const result = await validator.validateFile<UserSettings>(filePath);
  if (result.valid && result.data) {
    return result.data;
  }

  logger.warn(`Invalid user settings at ${filePath}, using defaults`);
  return validator.getDefaults<UserSettings>('user-settings.json') || {
    defaultModel: 'grok-code-fast-1',
    models: ['grok-code-fast-1', 'grok-4-latest', 'grok-3-latest'],
    provider: 'grok',
    theme: 'auto',
    language: 'en',
  };
}

// ============================================================================
// Config Validation Command Handler
// ============================================================================

/**
 * Handle /config validate command
 */
export async function handleConfigValidateCommand(projectDir?: string): Promise<string> {
  const dir = projectDir || process.cwd();
  const result = await validateStartupConfigWithZod(dir);

  const lines: string[] = [
    '='.repeat(50),
    'Configuration Validation Report',
    '='.repeat(50),
    '',
  ];

  // Summary
  if (result.valid) {
    lines.push('[OK] All configuration files are valid');
  } else {
    lines.push('[ERROR] Configuration validation failed');
  }
  lines.push('');

  // Config file results
  lines.push('--- Configuration Files ---');
  const validator = getZodConfigValidator();

  if (result.configResults.size === 0) {
    lines.push('  No configuration files found.');
    lines.push('  Run "buddy init" to create default configuration.');
  } else {
    for (const [file, fileResult] of result.configResults) {
      lines.push(validator.formatResult(fileResult, file));
    }
  }
  lines.push('');

  // Environment variables
  lines.push('--- Environment Variables ---');
  if (result.envResult.valid) {
    lines.push('  [OK] Environment variables are valid');

    // Show which ones are set
    const envVars = result.validatedConfigs.env || {};
    const setVars = Object.entries(envVars)
      .filter(([, v]) => v !== undefined)
      .map(([k]) => k);

    if (setVars.length > 0) {
      lines.push(`  Set: ${setVars.join(', ')}`);
    }
  } else {
    for (const err of result.envResult.errors) {
      lines.push(`  [WARNING] ${err.path}: ${err.message}`);
    }
  }
  lines.push('');

  // Warnings
  if (result.warnings.length > 0) {
    lines.push('--- Warnings ---');
    for (const warning of result.warnings) {
      lines.push(`  - ${warning}`);
    }
    lines.push('');
  }

  // Errors
  if (result.errors.length > 0) {
    lines.push('--- Errors ---');
    for (const error of result.errors) {
      lines.push(error);
    }
    lines.push('');
  }

  lines.push('='.repeat(50));

  return lines.join('\n');
}
