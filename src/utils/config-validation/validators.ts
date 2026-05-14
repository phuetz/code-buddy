/**
 * Configuration Validators
 *
 * Contains the ConfigValidator (legacy JSON schema), ZodConfigValidator (Zod-based),
 * startup validation functions, and config command handlers.
 */

import { ZodError, ZodSchema, ZodType } from 'zod';
import { logger } from "../logger.js";
import { detectProviderFromEnv } from '../provider-detector.js';
import fs from 'fs-extra';
import * as path from 'path';
import os from 'os';

import type {
  JSONSchema,
  ValidationError,
  ValidationResult,
  Settings,
  UserSettings,
  HooksConfig,
  MCPConfig,
  YoloConfig,
  EnvVars,
} from './schema.js';

import {
  SCHEMAS,
  ZOD_SCHEMAS,
  SettingsSchema as _SettingsSchema,
  UserSettingsSchema as _UserSettingsSchema,
} from './schema.js';

// ============================================================================
// Legacy JSON Schema Validator
// ============================================================================

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
// Zod Error Conversion
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

// ============================================================================
// Zod-based Configuration Validator
// ============================================================================

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

  // Check for provider credentials. ChatGPT OAuth is file-backed, so use
  // the same provider detector as runtime instead of requiring GROK_API_KEY.
  const detectedProvider = detectProviderFromEnv();
  if (!validatedConfigs.userSettings?.apiKey && !detectedProvider?.apiKey) {
    warnings.push(
      'No AI provider configured. Run `buddy login chatgpt`, set a provider API key, or configure apiKey in user-settings.json'
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
