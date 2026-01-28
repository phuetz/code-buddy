import { ToolRegistration } from '../tools/tool-manager.js';
import { SlashCommand } from '../commands/slash-commands.js';
import { Logger } from '../utils/logger.js';

/**
 * Plugin Configuration Schema
 * JSON Schema-like definition for validating plugin configuration
 */
export interface PluginConfigSchema {
  type: 'object';
  properties: Record<string, PluginConfigPropertySchema>;
  required?: string[];
}

export interface PluginConfigPropertySchema {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description?: string;
  default?: unknown;
  enum?: (string | number | boolean)[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  items?: PluginConfigPropertySchema;
}

/**
 * Plugin Manifest
 * Defines metadata for a plugin
 */
export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  license?: string;
  homepage?: string;
  repository?: string;
  minApiVersion?: string;
  permissions?: PluginPermissions;
  /** Whether the plugin should run in an isolated Worker Thread (default: true) */
  isolated?: boolean;
  /** Default configuration values for this plugin */
  defaultConfig?: Record<string, unknown>;
  /** JSON Schema for validating plugin configuration */
  configSchema?: PluginConfigSchema;
}

/**
 * Plugin Permissions
 * Defines what a plugin is allowed to do
 */
export interface PluginPermissions {
  filesystem?: boolean | string[]; // true = all, array = specific paths
  network?: boolean | string[]; // true = all, array = specific domains
  shell?: boolean; // Execute shell commands
  env?: boolean; // Access environment variables
}

/**
 * Plugin Context
 * Passed to plugin lifecycle methods to interact with the host system
 */
export interface PluginContext {
  /** Logger scoped to this plugin */
  logger: Logger;
  
  /** Configuration for this plugin */
  config: Record<string, unknown>;
  
  /** Register a tool */
  registerTool(tool: ToolRegistration): void;
  
  /** Register a slash command */
  registerCommand(command: SlashCommand): void;
  
  /** Register a provider (e.g., for LLMs) */
  registerProvider(provider: unknown): void; // TODO: Define Provider interface
  
  /** Path to plugin's data directory */
  dataDir: string;
}

/**
 * Plugin Interface
 * The main entry point for a plugin
 */
export interface Plugin {
  /** Called when the plugin is loaded */
  activate(context: PluginContext): Promise<void> | void;
  
  /** Called when the plugin is unloaded or disabled */
  deactivate(): Promise<void> | void;
}

/**
 * Plugin Status
 */
export enum PluginStatus {
  LOADED = 'loaded',
  ACTIVE = 'active',
  DISABLED = 'disabled',
  ERROR = 'error',
}

/**
 * Plugin Metadata (internal use)
 */
export interface PluginMetadata {
  manifest: PluginManifest;
  status: PluginStatus;
  path: string;
  error?: Error;
  instance?: Plugin;
  /** Whether this plugin is running in isolation (Worker Thread) */
  isolated?: boolean;
}

/**
 * Plugin Isolation Configuration
 */
export interface PluginIsolationConfig {
  /** Execution timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Memory limit in MB (default: 128) */
  memoryLimit?: number;
  /** Stack size in MB (default: 4) */
  stackSize?: number;
}

/**
 * Plugin Execution Statistics (for monitoring isolated plugins)
 */
export interface PluginExecutionStats {
  pluginId: string;
  startTime: number;
  activationTime?: number;
  messageCount: number;
  errorCount: number;
  lastError?: string;
  isRunning: boolean;
}

/**
 * Manifest Validation Error
 */
export class ManifestValidationError extends Error {
  constructor(
    message: string,
    public readonly field?: string,
    public readonly value?: unknown
  ) {
    super(message);
    this.name = 'ManifestValidationError';
  }
}

/**
 * Validation result type
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate a plugin manifest
 * Ensures all required fields are present and have valid formats
 */
export function validateManifest(manifest: unknown): ValidationResult {
  const errors: string[] = [];

  if (!manifest || typeof manifest !== 'object') {
    return { valid: false, errors: ['Manifest must be a valid object'] };
  }

  const m = manifest as Record<string, unknown>;

  // Required string fields
  const requiredStrings = ['id', 'name', 'version', 'description'] as const;
  for (const field of requiredStrings) {
    if (typeof m[field] !== 'string' || m[field].trim() === '') {
      errors.push(`Missing or invalid required field: ${field}`);
    }
  }

  // Validate ID format (alphanumeric, dashes, underscores only)
  if (typeof m.id === 'string' && !/^[a-zA-Z0-9_-]+$/.test(m.id)) {
    errors.push('Plugin ID must contain only alphanumeric characters, dashes, and underscores');
  }

  // Validate ID length (prevent path traversal attempts)
  if (typeof m.id === 'string' && (m.id.length < 2 || m.id.length > 64)) {
    errors.push('Plugin ID must be between 2 and 64 characters');
  }

  // Validate version format (semver-like)
  if (typeof m.version === 'string' && !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(m.version)) {
    errors.push('Version must be in semver format (e.g., 1.0.0)');
  }

  // Validate optional string fields if present
  const optionalStrings = ['author', 'license', 'homepage', 'repository', 'minApiVersion'] as const;
  for (const field of optionalStrings) {
    if (m[field] !== undefined && typeof m[field] !== 'string') {
      errors.push(`Invalid field type for ${field}: expected string`);
    }
  }

  // Validate permissions if present
  if (m.permissions !== undefined) {
    const permResult = validatePermissions(m.permissions);
    if (!permResult.valid) {
      errors.push(...permResult.errors.map(e => `permissions: ${e}`));
    }
  }

  // Validate isolated field if present
  if (m.isolated !== undefined && typeof m.isolated !== 'boolean') {
    errors.push('Field "isolated" must be a boolean');
  }

  // Validate defaultConfig if present
  if (m.defaultConfig !== undefined) {
    if (typeof m.defaultConfig !== 'object' || m.defaultConfig === null || Array.isArray(m.defaultConfig)) {
      errors.push('Field "defaultConfig" must be an object');
    }
  }

  // Validate configSchema if present
  if (m.configSchema !== undefined) {
    const schemaResult = validateConfigSchema(m.configSchema);
    if (!schemaResult.valid) {
      errors.push(...schemaResult.errors.map(e => `configSchema: ${e}`));
    }
  }

  // Security: Check for suspicious fields that shouldn't exist
  const allowedFields = new Set([
    'id', 'name', 'version', 'description', 'author', 'license',
    'homepage', 'repository', 'minApiVersion', 'permissions', 'isolated',
    'defaultConfig', 'configSchema'
  ]);
  for (const key of Object.keys(m)) {
    if (!allowedFields.has(key)) {
      errors.push(`Unknown field in manifest: ${key}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate plugin permissions object
 */
export function validatePermissions(permissions: unknown): ValidationResult {
  const errors: string[] = [];

  if (!permissions || typeof permissions !== 'object') {
    return { valid: false, errors: ['Permissions must be an object'] };
  }

  const p = permissions as Record<string, unknown>;

  // Validate filesystem permission
  if (p.filesystem !== undefined) {
    if (typeof p.filesystem !== 'boolean' && !isStringArray(p.filesystem)) {
      errors.push('filesystem must be boolean or array of path strings');
    }
    if (Array.isArray(p.filesystem)) {
      for (const path of p.filesystem) {
        if (typeof path !== 'string') {
          errors.push('filesystem paths must be strings');
          break;
        }
        // Security: Prevent path traversal
        if (path.includes('..') || path.startsWith('/')) {
          errors.push(`Invalid filesystem path: ${path} (no .. or absolute paths allowed)`);
        }
      }
    }
  }

  // Validate network permission
  if (p.network !== undefined) {
    if (typeof p.network !== 'boolean' && !isStringArray(p.network)) {
      errors.push('network must be boolean or array of domain strings');
    }
    if (Array.isArray(p.network)) {
      for (const domain of p.network) {
        if (typeof domain !== 'string') {
          errors.push('network domains must be strings');
          break;
        }
        // Basic domain validation
        if (!/^[a-zA-Z0-9.-]+$/.test(domain)) {
          errors.push(`Invalid network domain: ${domain}`);
        }
      }
    }
  }

  // Validate shell permission
  if (p.shell !== undefined && typeof p.shell !== 'boolean') {
    errors.push('shell must be a boolean');
  }

  // Validate env permission
  if (p.env !== undefined && typeof p.env !== 'boolean') {
    errors.push('env must be a boolean');
  }

  // Security: Check for unknown permission fields
  const allowedPermFields = new Set(['filesystem', 'network', 'shell', 'env']);
  for (const key of Object.keys(p)) {
    if (!allowedPermFields.has(key)) {
      errors.push(`Unknown permission field: ${key}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Helper to check if value is an array of strings
 */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

/**
 * Check if a plugin has a specific permission
 */
export function hasPermission(
  permissions: PluginPermissions | undefined,
  type: keyof PluginPermissions,
  target?: string
): boolean {
  if (!permissions) {
    return false;
  }

  const perm = permissions[type];

  if (perm === undefined || perm === false) {
    return false;
  }

  if (perm === true) {
    return true;
  }

  // For array permissions, check if target is in the list
  if (Array.isArray(perm) && target) {
    if (type === 'filesystem') {
      // For filesystem, check if path starts with any allowed path
      return perm.some(allowed => target.startsWith(allowed));
    }
    if (type === 'network') {
      // For network, check exact domain match or subdomain
      return perm.some(allowed =>
        target === allowed || target.endsWith(`.${allowed}`)
      );
    }
  }

  return false;
}

/**
 * Blocked module list for sandboxing
 * These modules should never be accessible to plugins without explicit permission
 */
export const BLOCKED_MODULES = {
  always: ['cluster', 'dgram', 'dns', 'tls', 'v8', 'vm', 'worker_threads', 'repl'],
  withoutShell: ['child_process'],
  withoutFilesystem: ['fs', 'fs/promises', 'fs-extra'],
  withoutNetwork: ['net', 'http', 'https', 'http2'],
} as const;

/**
 * Get list of blocked modules based on permissions
 */
export function getBlockedModules(permissions: PluginPermissions): string[] {
  const blocked: string[] = [...BLOCKED_MODULES.always];

  if (!permissions.shell) {
    blocked.push(...BLOCKED_MODULES.withoutShell);
  }
  if (!permissions.filesystem) {
    blocked.push(...BLOCKED_MODULES.withoutFilesystem);
  }
  if (!permissions.network) {
    blocked.push(...BLOCKED_MODULES.withoutNetwork);
  }

  return blocked;
}

/**
 * Validate a plugin configuration schema
 */
export function validateConfigSchema(schema: unknown): ValidationResult {
  const errors: string[] = [];

  if (!schema || typeof schema !== 'object') {
    return { valid: false, errors: ['Config schema must be an object'] };
  }

  const s = schema as Record<string, unknown>;

  if (s.type !== 'object') {
    errors.push('Config schema type must be "object"');
  }

  if (s.properties !== undefined) {
    if (typeof s.properties !== 'object' || s.properties === null || Array.isArray(s.properties)) {
      errors.push('Config schema properties must be an object');
    } else {
      const props = s.properties as Record<string, unknown>;
      for (const [key, value] of Object.entries(props)) {
        if (!isValidPropertySchema(value)) {
          errors.push(`Invalid property schema for "${key}"`);
        }
      }
    }
  }

  if (s.required !== undefined && !isStringArray(s.required)) {
    errors.push('Config schema required must be an array of strings');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Check if a value is a valid property schema
 */
function isValidPropertySchema(schema: unknown): boolean {
  if (!schema || typeof schema !== 'object') {
    return false;
  }

  const s = schema as Record<string, unknown>;
  const validTypes = ['string', 'number', 'boolean', 'array', 'object'];

  if (!validTypes.includes(s.type as string)) {
    return false;
  }

  return true;
}

/**
 * Validate a configuration value against a schema
 */
export function validateConfigValue(
  value: unknown,
  schema: PluginConfigPropertySchema,
  path: string = ''
): ValidationResult {
  const errors: string[] = [];
  const fullPath = path || 'config';

  // Type validation
  switch (schema.type) {
    case 'string':
      if (typeof value !== 'string') {
        errors.push(`${fullPath}: expected string, got ${typeof value}`);
      } else {
        if (schema.minLength !== undefined && value.length < schema.minLength) {
          errors.push(`${fullPath}: string too short (min ${schema.minLength})`);
        }
        if (schema.maxLength !== undefined && value.length > schema.maxLength) {
          errors.push(`${fullPath}: string too long (max ${schema.maxLength})`);
        }
        if (schema.pattern !== undefined) {
          try {
            const regex = new RegExp(schema.pattern);
            if (!regex.test(value)) {
              errors.push(`${fullPath}: string does not match pattern "${schema.pattern}"`);
            }
          } catch {
            // Invalid regex in schema - skip pattern validation
          }
        }
        if (schema.enum !== undefined && !schema.enum.includes(value)) {
          errors.push(`${fullPath}: value must be one of: ${schema.enum.join(', ')}`);
        }
      }
      break;

    case 'number':
      if (typeof value !== 'number' || isNaN(value)) {
        errors.push(`${fullPath}: expected number, got ${typeof value}`);
      } else {
        if (schema.minimum !== undefined && value < schema.minimum) {
          errors.push(`${fullPath}: number too small (min ${schema.minimum})`);
        }
        if (schema.maximum !== undefined && value > schema.maximum) {
          errors.push(`${fullPath}: number too large (max ${schema.maximum})`);
        }
        if (schema.enum !== undefined && !schema.enum.includes(value)) {
          errors.push(`${fullPath}: value must be one of: ${schema.enum.join(', ')}`);
        }
      }
      break;

    case 'boolean':
      if (typeof value !== 'boolean') {
        errors.push(`${fullPath}: expected boolean, got ${typeof value}`);
      }
      if (schema.enum !== undefined && !schema.enum.includes(value as boolean)) {
        errors.push(`${fullPath}: value must be one of: ${schema.enum.join(', ')}`);
      }
      break;

    case 'array':
      if (!Array.isArray(value)) {
        errors.push(`${fullPath}: expected array, got ${typeof value}`);
      } else if (schema.items) {
        for (let i = 0; i < value.length; i++) {
          const itemResult = validateConfigValue(value[i], schema.items, `${fullPath}[${i}]`);
          errors.push(...itemResult.errors);
        }
      }
      break;

    case 'object':
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        errors.push(`${fullPath}: expected object, got ${typeof value}`);
      }
      break;
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a complete plugin configuration against its schema
 */
export function validatePluginConfig(
  config: Record<string, unknown>,
  schema: PluginConfigSchema
): ValidationResult {
  const errors: string[] = [];

  // Check required fields
  if (schema.required) {
    for (const field of schema.required) {
      if (config[field] === undefined) {
        errors.push(`Missing required config field: ${field}`);
      }
    }
  }

  // Validate each property
  for (const [key, value] of Object.entries(config)) {
    const propertySchema = schema.properties[key];
    if (propertySchema) {
      const result = validateConfigValue(value, propertySchema, key);
      errors.push(...result.errors);
    }
    // Allow unknown properties for forward compatibility
  }

  return { valid: errors.length === 0, errors };
}
