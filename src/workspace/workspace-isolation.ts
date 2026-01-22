/**
 * Workspace Isolation Module
 *
 * Provides security isolation to ensure file operations stay within the workspace.
 * Prevents access to files outside the current workspace directory.
 *
 * Security features:
 * - Validates all paths are under the workspace root
 * - Blocks path traversal attacks (../)
 * - Blocks symlinks pointing outside the workspace
 * - Whitelist for necessary system files
 * - Logs all blocked access attempts
 *
 * Configuration:
 * - Can be disabled with --allow-outside CLI flag
 * - Whitelist can be extended via configuration
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface WorkspaceIsolationConfig {
  /** Enable workspace isolation (default: true) */
  enabled: boolean;
  /** Workspace root directory */
  workspaceRoot: string;
  /** Additional allowed paths outside workspace */
  additionalAllowedPaths: string[];
  /** Log blocked access attempts (default: true) */
  logBlockedAccess: boolean;
  /** Strict mode - block even whitelisted paths (default: false) */
  strictMode: boolean;
}

export interface PathValidationResult {
  /** Whether the path is valid and allowed */
  valid: boolean;
  /** Resolved absolute path */
  resolved: string;
  /** Error message if invalid */
  error?: string;
  /** Reason for blocking */
  reason?: 'outside_workspace' | 'path_traversal' | 'symlink_escape' | 'blocked_path';
}

export interface BlockedAccessLog {
  timestamp: Date;
  requestedPath: string;
  resolvedPath: string;
  reason: string;
  operation: string;
}

// ============================================================================
// System Whitelist - Paths that are always accessible
// ============================================================================

/**
 * System directories that tools may need to access for proper functioning.
 * These are read-only access paths that don't contain user secrets.
 */
const SYSTEM_WHITELIST: readonly string[] = [
  // Node.js and package management
  '/usr/lib/node_modules',
  '/usr/local/lib/node_modules',
  // Temporary directories
  os.tmpdir(),
  '/tmp',
  '/var/tmp',
  // Common development tool caches (read-only)
  path.join(os.homedir(), '.npm'),
  path.join(os.homedir(), '.yarn'),
  path.join(os.homedir(), '.pnpm-store'),
  path.join(os.homedir(), '.bun'),
  // Language runtimes
  path.join(os.homedir(), '.nvm'),
  path.join(os.homedir(), '.cargo'),
  path.join(os.homedir(), '.rustup'),
  path.join(os.homedir(), '.pyenv'),
  path.join(os.homedir(), '.local', 'share', 'mise'),
  // CodeBuddy config (for loading settings, sessions, etc.)
  path.join(os.homedir(), '.codebuddy'),
  path.join(os.homedir(), '.grok'),
  // VS Code extensions (for ripgrep, etc.)
  path.join(os.homedir(), '.vscode'),
  path.join(os.homedir(), '.vscode-server'),
];

/**
 * Paths that should never be accessed, even if they would otherwise be allowed.
 * These contain sensitive credentials and secrets.
 */
const BLOCKED_PATHS: readonly string[] = [
  path.join(os.homedir(), '.ssh'),
  path.join(os.homedir(), '.gnupg'),
  path.join(os.homedir(), '.aws', 'credentials'),
  path.join(os.homedir(), '.aws', 'config'),
  path.join(os.homedir(), '.docker', 'config.json'),
  path.join(os.homedir(), '.npmrc'),
  path.join(os.homedir(), '.netrc'),
  path.join(os.homedir(), '.config', 'gh', 'hosts.yml'),
  path.join(os.homedir(), '.config', 'gcloud', 'credentials.db'),
  path.join(os.homedir(), '.kube', 'config'),
  path.join(os.homedir(), '.codebuddy', 'credentials.enc'),
  '/etc/passwd',
  '/etc/shadow',
  '/etc/sudoers',
  '/etc/security',
];

// ============================================================================
// Workspace Isolation Class
// ============================================================================

export class WorkspaceIsolation extends EventEmitter {
  private config: WorkspaceIsolationConfig;
  private blockedAccessLog: BlockedAccessLog[] = [];
  private systemWhitelist: Set<string>;
  private blockedPaths: Set<string>;

  constructor(config: Partial<WorkspaceIsolationConfig> = {}) {
    super();
    this.config = {
      enabled: true,
      workspaceRoot: process.cwd(),
      additionalAllowedPaths: [],
      logBlockedAccess: true,
      strictMode: false,
      ...config,
    };

    // Normalize workspace root
    this.config.workspaceRoot = path.resolve(this.config.workspaceRoot);

    // Build whitelist set for fast lookup
    this.systemWhitelist = new Set(
      [...SYSTEM_WHITELIST, ...this.config.additionalAllowedPaths]
        .map(p => path.resolve(p))
    );

    // Build blocked paths set
    this.blockedPaths = new Set(
      BLOCKED_PATHS.map(p => path.resolve(p))
    );
  }

  /**
   * Get current configuration
   */
  getConfig(): Readonly<WorkspaceIsolationConfig> {
    return { ...this.config };
  }

  /**
   * Update workspace root
   */
  setWorkspaceRoot(root: string): void {
    this.config.workspaceRoot = path.resolve(root);
    this.emit('workspace:root-changed', this.config.workspaceRoot);
  }

  /**
   * Enable or disable isolation
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
    this.emit('isolation:toggled', enabled);

    if (!enabled) {
      logger.warn('Workspace isolation disabled - file access is unrestricted');
    }
  }

  /**
   * Add an allowed path to the whitelist
   */
  addAllowedPath(allowedPath: string): void {
    const resolved = path.resolve(allowedPath);
    this.config.additionalAllowedPaths.push(resolved);
    this.systemWhitelist.add(resolved);
  }

  /**
   * Check if a path is in the blocked list
   */
  private isBlockedPath(resolvedPath: string): boolean {
    // Check exact matches
    if (this.blockedPaths.has(resolvedPath)) {
      return true;
    }

    // Check if path is under a blocked directory
    const blockedPathsArray = Array.from(this.blockedPaths);
    for (let i = 0; i < blockedPathsArray.length; i++) {
      if (resolvedPath.startsWith(blockedPathsArray[i] + path.sep)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if a path is in the system whitelist
   */
  private isWhitelisted(resolvedPath: string): boolean {
    if (this.config.strictMode) {
      return false;
    }

    // Check exact matches
    if (this.systemWhitelist.has(resolvedPath)) {
      return true;
    }

    // Check if path is under a whitelisted directory
    const whitelistArray = Array.from(this.systemWhitelist);
    for (let i = 0; i < whitelistArray.length; i++) {
      if (resolvedPath.startsWith(whitelistArray[i] + path.sep)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if a path is within the workspace
   */
  private isWithinWorkspace(resolvedPath: string): boolean {
    const normalizedWorkspace = path.normalize(this.config.workspaceRoot);
    const normalizedPath = path.normalize(resolvedPath);

    return (
      normalizedPath === normalizedWorkspace ||
      normalizedPath.startsWith(normalizedWorkspace + path.sep)
    );
  }

  /**
   * Log a blocked access attempt
   */
  private logBlockedAccess(
    requestedPath: string,
    resolvedPath: string,
    reason: string,
    operation: string
  ): void {
    const logEntry: BlockedAccessLog = {
      timestamp: new Date(),
      requestedPath,
      resolvedPath,
      reason,
      operation,
    };

    this.blockedAccessLog.push(logEntry);

    // Keep only last 100 entries
    if (this.blockedAccessLog.length > 100) {
      this.blockedAccessLog.shift();
    }

    if (this.config.logBlockedAccess) {
      logger.warn('Workspace isolation blocked access', {
        requestedPath,
        resolvedPath,
        reason,
        operation,
        workspaceRoot: this.config.workspaceRoot,
      });
    }

    this.emit('access:blocked', logEntry);
  }

  /**
   * Validate a file path against workspace isolation rules
   *
   * @param filePath - Path to validate (can be relative or absolute)
   * @param operation - Description of the operation (for logging)
   * @returns Validation result with resolved path or error
   */
  validatePath(filePath: string, operation: string = 'file access'): PathValidationResult {
    // If isolation is disabled, allow everything
    if (!this.config.enabled) {
      return {
        valid: true,
        resolved: path.resolve(filePath),
      };
    }

    // Handle empty or invalid paths
    if (!filePath || typeof filePath !== 'string') {
      return {
        valid: false,
        resolved: '',
        error: 'Invalid file path: path must be a non-empty string',
        reason: 'path_traversal',
      };
    }

    // Normalize and resolve the path
    const resolved = path.resolve(filePath);

    // Check if path is explicitly blocked (secrets, credentials)
    if (this.isBlockedPath(resolved)) {
      this.logBlockedAccess(filePath, resolved, 'blocked_path', operation);
      return {
        valid: false,
        resolved,
        error: `Access to protected path is blocked: ${filePath}`,
        reason: 'blocked_path',
      };
    }

    // Check if path is within workspace
    const isInWorkspace = this.isWithinWorkspace(resolved);

    // Check if path is in system whitelist
    const isWhitelisted = this.isWhitelisted(resolved);

    // Allow if in workspace or whitelisted
    if (!isInWorkspace && !isWhitelisted) {
      this.logBlockedAccess(filePath, resolved, 'outside_workspace', operation);
      return {
        valid: false,
        resolved,
        error: `Path outside workspace not allowed: ${filePath} (workspace: ${this.config.workspaceRoot})`,
        reason: 'outside_workspace',
      };
    }

    // Check for symlink traversal if file exists
    try {
      if (fs.existsSync(resolved)) {
        const realPath = fs.realpathSync(resolved);

        // Check if real path is blocked
        if (this.isBlockedPath(realPath)) {
          this.logBlockedAccess(filePath, realPath, 'blocked_path_via_symlink', operation);
          return {
            valid: false,
            resolved,
            error: `Symlink to protected path is blocked: ${filePath} -> ${realPath}`,
            reason: 'symlink_escape',
          };
        }

        // Check if real path is within workspace or whitelisted
        const realIsInWorkspace = this.isWithinWorkspace(realPath);
        const realIsWhitelisted = this.isWhitelisted(realPath);

        if (!realIsInWorkspace && !realIsWhitelisted) {
          this.logBlockedAccess(filePath, realPath, 'symlink_escape', operation);
          return {
            valid: false,
            resolved,
            error: `Symlink traversal not allowed: ${filePath} points to ${realPath} (outside workspace)`,
            reason: 'symlink_escape',
          };
        }
      }
    } catch (_err) {
      // If realpath fails, file may not exist yet - that's OK
    }

    return {
      valid: true,
      resolved,
    };
  }

  /**
   * Validate multiple paths at once
   */
  validatePaths(
    filePaths: string[],
    operation: string = 'file access'
  ): {
    valid: boolean;
    results: Map<string, PathValidationResult>;
    errors: string[];
  } {
    const results = new Map<string, PathValidationResult>();
    const errors: string[] = [];

    for (const filePath of filePaths) {
      const result = this.validatePath(filePath, operation);
      results.set(filePath, result);
      if (!result.valid && result.error) {
        errors.push(result.error);
      }
    }

    return {
      valid: errors.length === 0,
      results,
      errors,
    };
  }

  /**
   * Quick check if a path is safe (returns boolean only)
   */
  isSafe(filePath: string): boolean {
    return this.validatePath(filePath, 'safety check').valid;
  }

  /**
   * Validate and resolve a path, throwing if invalid
   */
  resolveOrThrow(filePath: string, operation: string = 'file access'): string {
    const result = this.validatePath(filePath, operation);
    if (!result.valid) {
      throw new Error(result.error || 'Path validation failed');
    }
    return result.resolved;
  }

  /**
   * Get the blocked access log
   */
  getBlockedAccessLog(): readonly BlockedAccessLog[] {
    return [...this.blockedAccessLog];
  }

  /**
   * Clear the blocked access log
   */
  clearBlockedAccessLog(): void {
    this.blockedAccessLog = [];
  }

  /**
   * Format blocked access log for display
   */
  formatBlockedAccessLog(): string {
    if (this.blockedAccessLog.length === 0) {
      return 'No blocked access attempts.';
    }

    const lines = [
      '',
      'Blocked Access Log:',
      '-'.repeat(60),
    ];

    for (const entry of this.blockedAccessLog.slice(-20)) {
      const time = entry.timestamp.toISOString();
      lines.push(`  [${time}] ${entry.operation}`);
      lines.push(`    Path: ${entry.requestedPath}`);
      lines.push(`    Reason: ${entry.reason}`);
    }

    if (this.blockedAccessLog.length > 20) {
      lines.push(`  ... and ${this.blockedAccessLog.length - 20} more entries`);
    }

    lines.push('');
    return lines.join('\n');
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let workspaceIsolationInstance: WorkspaceIsolation | null = null;

/**
 * Get the workspace isolation singleton
 */
export function getWorkspaceIsolation(
  config?: Partial<WorkspaceIsolationConfig>
): WorkspaceIsolation {
  if (!workspaceIsolationInstance) {
    workspaceIsolationInstance = new WorkspaceIsolation(config);
  } else if (config) {
    // Update configuration
    if (config.workspaceRoot) {
      workspaceIsolationInstance.setWorkspaceRoot(config.workspaceRoot);
    }
    if (config.enabled !== undefined) {
      workspaceIsolationInstance.setEnabled(config.enabled);
    }
    if (config.additionalAllowedPaths) {
      for (const p of config.additionalAllowedPaths) {
        workspaceIsolationInstance.addAllowedPath(p);
      }
    }
  }
  return workspaceIsolationInstance;
}

/**
 * Reset the workspace isolation singleton (for testing)
 */
export function resetWorkspaceIsolation(): void {
  workspaceIsolationInstance = null;
}

/**
 * Initialize workspace isolation from CLI options
 */
export function initializeWorkspaceIsolation(options: {
  allowOutside?: boolean;
  directory?: string;
  additionalPaths?: string[];
}): WorkspaceIsolation {
  return getWorkspaceIsolation({
    enabled: !options.allowOutside,
    workspaceRoot: options.directory || process.cwd(),
    additionalAllowedPaths: options.additionalPaths || [],
  });
}

/**
 * Convenience function to validate a path
 */
export function validateWorkspacePath(
  filePath: string,
  operation?: string
): PathValidationResult {
  return getWorkspaceIsolation().validatePath(filePath, operation);
}

/**
 * Convenience function to check if a path is safe
 */
export function isPathInWorkspace(filePath: string): boolean {
  return getWorkspaceIsolation().isSafe(filePath);
}

export default {
  WorkspaceIsolation,
  getWorkspaceIsolation,
  resetWorkspaceIsolation,
  initializeWorkspaceIsolation,
  validateWorkspacePath,
  isPathInWorkspace,
};
