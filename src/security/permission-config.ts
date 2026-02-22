/**
 * Permission Configuration System
 *
 * Based on Cursor CLI's permission model:
 * - JSON-based configuration
 * - Path restrictions
 * - Command allowlists/blocklists
 * - Network access control
 * - Sandboxed execution support
 *
 * Provides fine-grained control over what the AI agent can do.
 */

import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { logger } from "../utils/logger.js";

// ============================================================================
// Types
// ============================================================================

export interface PermissionConfig {
  // Version for config migration
  version: string;

  // File system permissions
  fileSystem: {
    // Paths the agent can read from (glob patterns)
    allowedReadPaths: string[];
    // Paths the agent can write to (glob patterns)
    allowedWritePaths: string[];
    // Paths that are always blocked (glob patterns)
    blockedPaths: string[];
    // Maximum file size that can be created/modified (bytes)
    maxFileSize: number;
    // Allow creating new files
    allowCreate: boolean;
    // Allow deleting files
    allowDelete: boolean;
  };

  // Command execution permissions
  commands: {
    // Commands that are allowed (exact or patterns)
    allowedCommands: string[];
    // Commands that are blocked (exact or patterns)
    blockedCommands: string[];
    // Allow running arbitrary shell commands
    allowArbitraryCommands: boolean;
    // Maximum execution time (ms)
    maxExecutionTime: number;
    // Allow sudo/elevated commands
    allowSudo: boolean;
  };

  // Network permissions
  network: {
    // Allow outgoing network requests
    allowOutgoing: boolean;
    // Allowed hosts (domains or IPs)
    allowedHosts: string[];
    // Blocked hosts
    blockedHosts: string[];
    // Allow localhost access
    allowLocalhost: boolean;
  };

  // Tool permissions
  tools: {
    // Tools that require confirmation
    requireConfirmation: string[];
    // Tools that are completely disabled
    disabled: string[];
    // Auto-approve these tools (no confirmation)
    autoApproved: string[];
  };

  // Safety settings
  safety: {
    // Enable sandbox mode (restricted environment)
    sandboxMode: boolean;
    // Require confirmation for all destructive operations
    confirmDestructive: boolean;
    // Enable dry-run mode (show what would be done)
    dryRunMode: boolean;
    // Maximum operations per session
    maxOperationsPerSession: number;
  };
}

export interface PermissionCheckResult {
  allowed: boolean;
  reason?: string;
  requiresConfirmation?: boolean;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_PERMISSION_CONFIG: PermissionConfig = {
  version: '1.0.0',

  fileSystem: {
    allowedReadPaths: ['**/*'],
    allowedWritePaths: ['**/*'],
    blockedPaths: [
      '**/node_modules/**',
      '**/.git/objects/**',
      '**/.env',
      '**/*.pem',
      '**/*.key',
      '**/secrets/**',
      '**/credentials/**',
    ],
    maxFileSize: 10 * 1024 * 1024, // 10MB
    allowCreate: true,
    allowDelete: true,
  },

  commands: {
    allowedCommands: [
      'git *',
      'npm *',
      'npx *',
      'yarn *',
      'pnpm *',
      'node *',
      'python *',
      'pip *',
      'cargo *',
      'go *',
      'make *',
      'ls *',
      'cat *',
      'grep *',
      'find *',
      'head *',
      'tail *',
      'wc *',
      'sort *',
      'uniq *',
      'diff *',
      'curl *',
      'wget *',
    ],
    blockedCommands: [
      'rm -rf /',
      'rm -rf ~',
      'rm -rf /*',
      ':(){:|:&};:',   // Fork bomb
      '> /dev/sda',
      'dd if=/dev/zero',
      'mkfs.*',
      'chmod 777',
      'curl * | bash',
      'wget * | bash',
    ],
    allowArbitraryCommands: false,
    maxExecutionTime: 300000, // 5 minutes
    allowSudo: false,
  },

  network: {
    allowOutgoing: true,
    allowedHosts: ['*'],
    blockedHosts: [],
    allowLocalhost: true,
  },

  tools: {
    requireConfirmation: [
      'bash',
      'str_replace_editor',
      'create_file',
      'delete_file',
    ],
    disabled: [],
    autoApproved: [
      'view_file',
      'search',
      'list_files',
    ],
  },

  safety: {
    sandboxMode: false,
    confirmDestructive: true,
    dryRunMode: false,
    maxOperationsPerSession: 1000,
  },
};

// ============================================================================
// Permission Manager
// ============================================================================

export class PermissionManager extends EventEmitter {
  private config: PermissionConfig;
  private configPath: string;
  private operationCount: number = 0;

  constructor(configPath?: string) {
    super();
    this.configPath = configPath || '.codebuddy/permissions.json';
    this.config = this.loadConfig();
  }

  /**
   * Load configuration from file or use defaults
   */
  private loadConfig(): PermissionConfig {
    try {
      if (fs.existsSync(this.configPath)) {
        const content = fs.readFileSync(this.configPath, 'utf-8');
        const loaded = JSON.parse(content);
        return this.mergeWithDefaults(loaded);
      }
    } catch (error) {
      logger.error(`Error loading permission config: ${error}`);
    }
    // Return a deep copy of defaults to prevent mutation of the original
    return this.mergeWithDefaults({});
  }

  /**
   * Merge loaded config with defaults (for missing fields)
   */
  private mergeWithDefaults(loaded: Partial<PermissionConfig>): PermissionConfig {
    return {
      ...DEFAULT_PERMISSION_CONFIG,
      ...loaded,
      fileSystem: { ...DEFAULT_PERMISSION_CONFIG.fileSystem, ...loaded.fileSystem },
      commands: { ...DEFAULT_PERMISSION_CONFIG.commands, ...loaded.commands },
      network: { ...DEFAULT_PERMISSION_CONFIG.network, ...loaded.network },
      tools: { ...DEFAULT_PERMISSION_CONFIG.tools, ...loaded.tools },
      safety: { ...DEFAULT_PERMISSION_CONFIG.safety, ...loaded.safety },
    };
  }

  /**
   * Save configuration to file
   */
  saveConfig(): void {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
      this.emit('config:saved', this.configPath);
    } catch (error) {
      this.emit('config:error', error);
    }
  }

  /**
   * Check if a file path is allowed for reading
   */
  checkReadPermission(filePath: string): PermissionCheckResult {
    const normalized = path.normalize(filePath);

    // Check blocked paths first
    if (this.matchesAnyPattern(normalized, this.config.fileSystem.blockedPaths)) {
      return { allowed: false, reason: 'Path is in blocked list' };
    }

    // Check allowed paths
    if (!this.matchesAnyPattern(normalized, this.config.fileSystem.allowedReadPaths)) {
      return { allowed: false, reason: 'Path not in allowed read list' };
    }

    return { allowed: true };
  }

  /**
   * Check if a file path is allowed for writing
   */
  checkWritePermission(filePath: string, isCreate: boolean = false): PermissionCheckResult {
    const normalized = path.normalize(filePath);

    // Check operation count
    if (this.operationCount >= this.config.safety.maxOperationsPerSession) {
      return { allowed: false, reason: 'Maximum operations per session reached' };
    }

    // Check blocked paths
    if (this.matchesAnyPattern(normalized, this.config.fileSystem.blockedPaths)) {
      return { allowed: false, reason: 'Path is in blocked list' };
    }

    // Check allowed paths
    if (!this.matchesAnyPattern(normalized, this.config.fileSystem.allowedWritePaths)) {
      return { allowed: false, reason: 'Path not in allowed write list' };
    }

    // Check create permission
    if (isCreate && !this.config.fileSystem.allowCreate) {
      return { allowed: false, reason: 'File creation is disabled' };
    }

    // Check if confirmation required
    const requiresConfirmation = this.config.safety.confirmDestructive;

    return { allowed: true, requiresConfirmation };
  }

  /**
   * Check if a command is allowed
   */
  checkCommandPermission(command: string): PermissionCheckResult {
    const normalized = command.trim();

    // Check blocked commands first
    for (const blocked of this.config.commands.blockedCommands) {
      if (this.commandMatches(normalized, blocked)) {
        return { allowed: false, reason: `Command matches blocked pattern: ${blocked}` };
      }
    }

    // Check sudo
    if (!this.config.commands.allowSudo && /^sudo\s/.test(normalized)) {
      return { allowed: false, reason: 'Sudo commands are not allowed' };
    }

    // Check if arbitrary commands allowed
    if (this.config.commands.allowArbitraryCommands) {
      return { allowed: true, requiresConfirmation: this.config.safety.confirmDestructive };
    }

    // Check allowed commands
    for (const allowed of this.config.commands.allowedCommands) {
      if (this.commandMatches(normalized, allowed)) {
        return { allowed: true, requiresConfirmation: this.config.safety.confirmDestructive };
      }
    }

    return { allowed: false, reason: 'Command not in allowed list' };
  }

  /**
   * Check if a tool can be used
   */
  checkToolPermission(toolName: string): PermissionCheckResult {
    // Check if disabled
    if (this.config.tools.disabled.includes(toolName)) {
      return { allowed: false, reason: 'Tool is disabled' };
    }

    // Check if auto-approved
    if (this.config.tools.autoApproved.includes(toolName)) {
      return { allowed: true, requiresConfirmation: false };
    }

    // Check if requires confirmation
    const requiresConfirmation = this.config.tools.requireConfirmation.includes(toolName);

    return { allowed: true, requiresConfirmation };
  }

  /**
   * Check network permission for a host
   */
  checkNetworkPermission(host: string): PermissionCheckResult {
    if (!this.config.network.allowOutgoing) {
      return { allowed: false, reason: 'Outgoing network requests are disabled' };
    }

    // Check localhost
    if (['localhost', '127.0.0.1', '::1'].includes(host)) {
      if (!this.config.network.allowLocalhost) {
        return { allowed: false, reason: 'Localhost access is disabled' };
      }
      return { allowed: true };
    }

    // Check blocked hosts
    if (this.config.network.blockedHosts.some(b => host.includes(b))) {
      return { allowed: false, reason: 'Host is blocked' };
    }

    // Check allowed hosts
    const allowAll = this.config.network.allowedHosts.includes('*');
    if (!allowAll && !this.config.network.allowedHosts.some(a => host.includes(a))) {
      return { allowed: false, reason: 'Host not in allowed list' };
    }

    return { allowed: true };
  }

  /**
   * Record an operation (for rate limiting)
   */
  recordOperation(): void {
    this.operationCount++;
    this.emit('operation:recorded', this.operationCount);
  }

  /**
   * Reset operation count
   */
  resetOperationCount(): void {
    this.operationCount = 0;
  }

  /**
   * Check if path matches any of the patterns
   */
  private matchesAnyPattern(filePath: string, patterns: string[]): boolean {
    for (const pattern of patterns) {
      if (this.pathMatches(filePath, pattern)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if path matches a glob pattern
   */
  private pathMatches(filePath: string, pattern: string): boolean {
    // Normalize separators to forward slashes for cross-platform compatibility
    const normalizedPath = filePath.replace(/\\/g, '/');
    const normalizedPattern = pattern.replace(/\\/g, '/');

    // Convert glob to regex
    const regex = normalizedPattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '{{GLOBSTAR}}')
      .replace(/\*/g, '[^/]*')
      .replace(/{{GLOBSTAR}}/g, '.*');

    return new RegExp(`^${regex}$`).test(normalizedPath);
  }

  /**
   * Check if command matches a pattern
   */
  private commandMatches(command: string, pattern: string): boolean {
    // Simple pattern matching with * wildcard
    const regex = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*');

    return new RegExp(`^${regex}$`).test(command);
  }

  /**
   * Get current configuration
   */
  getConfig(): PermissionConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<PermissionConfig>): void {
    this.config = this.mergeWithDefaults({ ...this.config, ...updates });
    this.emit('config:updated', this.config);
  }

  /**
   * Enable sandbox mode
   */
  enableSandbox(): void {
    this.config.safety.sandboxMode = true;
    this.config.commands.allowArbitraryCommands = false;
    this.config.commands.allowSudo = false;
    this.config.fileSystem.allowDelete = false;
    this.config.safety.confirmDestructive = true;
    this.emit('sandbox:enabled');
  }

  /**
   * Enable dry-run mode
   */
  enableDryRun(): void {
    this.config.safety.dryRunMode = true;
    this.emit('dryrun:enabled');
  }

  /**
   * Check if in sandbox mode
   */
  isSandboxed(): boolean {
    return this.config.safety.sandboxMode;
  }

  /**
   * Check if in dry-run mode
   */
  isDryRun(): boolean {
    return this.config.safety.dryRunMode;
  }

  /**
   * Dispose and cleanup resources
   */
  dispose(): void {
    this.removeAllListeners();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let permissionManagerInstance: PermissionManager | null = null;

export function getPermissionManager(configPath?: string): PermissionManager {
  if (!permissionManagerInstance) {
    permissionManagerInstance = new PermissionManager(configPath);
  }
  return permissionManagerInstance;
}

export function resetPermissionManager(): void {
  if (permissionManagerInstance) {
    permissionManagerInstance.dispose();
  }
  permissionManagerInstance = null;
}
