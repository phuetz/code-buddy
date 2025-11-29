/**
 * Configuration Validator with JSON Schema
 *
 * Validates configuration files using JSON Schema with helpful error messages.
 */

import * as fs from 'fs-extra';
import * as path from 'path';

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
}

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

    for (const schemaName of Object.keys(this.schemas)) {
      const filePath = path.join(dirPath, schemaName);
      if (await fs.pathExists(filePath)) {
        results.set(schemaName, await this.validateFile(filePath));
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
export async function validateStartupConfig(grokDir: string): Promise<boolean> {
  const validator = getConfigValidator();
  const results = await validator.validateDirectory(grokDir);

  let allValid = true;
  for (const [file, result] of results) {
    if (!result.valid) {
      console.error(validator.formatResult(result, file));
      allValid = false;
    }
  }

  return allValid;
}
