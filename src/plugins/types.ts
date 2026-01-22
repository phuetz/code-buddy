import { ToolRegistration } from '../tools/tool-manager.js';
import { SlashCommand } from '../commands/slash-commands.js';
import { Logger } from '../utils/logger.js';

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

  // Security: Check for suspicious fields that shouldn't exist
  const allowedFields = new Set([
    'id', 'name', 'version', 'description', 'author', 'license',
    'homepage', 'repository', 'minApiVersion', 'permissions', 'isolated'
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
