/**
 * Tool Permissions System
 *
 * Inspired by mistral-vibe's tool permission system that allows:
 * - ALWAYS: Auto-execute without prompting
 * - ASK: Request user confirmation before running
 * - NEVER: Block execution entirely
 *
 * Supports:
 * - Exact tool name matching
 * - Glob patterns (e.g., "read_*", "git*")
 * - Regex patterns with "re:" prefix (e.g., "re:^file_.*")
 */

import fs from 'fs-extra';
import path from 'path';
import os from 'os';

// ============================================================================
// Types
// ============================================================================

export enum ToolPermission {
  ALWAYS = 'always',   // Auto-execute without prompting
  ASK = 'ask',         // Request user confirmation
  NEVER = 'never',     // Block execution entirely
}

export interface ToolPermissionRule {
  /** Pattern to match tool names (exact, glob, or regex with "re:" prefix) */
  pattern: string;
  /** Permission level for matching tools */
  permission: ToolPermission;
  /** Optional reason for this rule (shown to user) */
  reason?: string;
}

export interface ToolPermissionConfig {
  /** Default permission for tools not matching any rule */
  default: ToolPermission;
  /** Rules for specific tools or patterns */
  rules: ToolPermissionRule[];
  /** Allowlist patterns (auto-approve these) */
  allowlist: string[];
  /** Denylist patterns (always block these) */
  denylist: string[];
}

// ============================================================================
// Default Configuration (like mistral-vibe)
// ============================================================================

const DEFAULT_CONFIG: ToolPermissionConfig = {
  default: ToolPermission.ASK,
  rules: [
    // Read-only operations are always allowed
    { pattern: 'read_file', permission: ToolPermission.ALWAYS },
    { pattern: 'view_file', permission: ToolPermission.ALWAYS },
    { pattern: 'list_files', permission: ToolPermission.ALWAYS },
    { pattern: 'search_files', permission: ToolPermission.ALWAYS },
    { pattern: 'grep', permission: ToolPermission.ALWAYS },
    { pattern: 'find_files', permission: ToolPermission.ALWAYS },
    { pattern: 'glob', permission: ToolPermission.ALWAYS },
    { pattern: 'git_status', permission: ToolPermission.ALWAYS },
    { pattern: 'git_log', permission: ToolPermission.ALWAYS },
    { pattern: 'git_diff', permission: ToolPermission.ALWAYS },

    // Todo operations are always allowed
    { pattern: 'todo_*', permission: ToolPermission.ALWAYS },

    // Write operations require confirmation
    { pattern: 'write_file', permission: ToolPermission.ASK },
    { pattern: 'edit_file', permission: ToolPermission.ASK },
    { pattern: 'create_file', permission: ToolPermission.ASK },
    { pattern: 'delete_file', permission: ToolPermission.ASK },
    { pattern: 'str_replace', permission: ToolPermission.ASK },

    // Shell commands require confirmation
    { pattern: 'bash', permission: ToolPermission.ASK },
    { pattern: 'shell', permission: ToolPermission.ASK },
    { pattern: 'execute', permission: ToolPermission.ASK },

    // Git write operations require confirmation
    { pattern: 'git_commit', permission: ToolPermission.ASK },
    { pattern: 'git_push', permission: ToolPermission.ASK },
    { pattern: 'git_checkout', permission: ToolPermission.ASK },
  ],
  allowlist: [
    // Safe bash commands (like mistral-vibe)
    'echo *',
    'ls *',
    'cat *',
    'head *',
    'tail *',
    'find *',
    'git log *',
    'git status *',
    'git diff *',
    'npm run test*',
    'npm run build*',
    'npm run lint*',
  ],
  denylist: [
    // Interactive commands that can't work in non-TTY
    'vim *',
    'nano *',
    'emacs *',
    'less *',
    'more *',
    'bash -i*',
    'python',
    'node',
    // Dangerous commands
    'rm -rf /*',
    'rm -rf ~*',
    'sudo *',
  ],
};

// ============================================================================
// Pattern Matching
// ============================================================================

/**
 * Check if a string matches a pattern (glob or regex)
 */
function matchesPattern(input: string, pattern: string): boolean {
  // Regex pattern (with "re:" prefix)
  if (pattern.startsWith('re:')) {
    try {
      const regex = new RegExp(pattern.slice(3));
      return regex.test(input);
    } catch {
      return false;
    }
  }

  // Glob pattern (convert to regex)
  const regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape special chars
    .replace(/\*/g, '.*')                  // * -> .*
    .replace(/\?/g, '.');                  // ? -> .

  const regex = new RegExp(`^${regexPattern}$`, 'i');
  return regex.test(input);
}

// ============================================================================
// Tool Permission Manager
// ============================================================================

export class ToolPermissionManager {
  private config: ToolPermissionConfig;
  private configPath: string;

  constructor(configPath?: string) {
    this.configPath = configPath || path.join(os.homedir(), '.grok', 'tool-permissions.json');
    this.config = this.loadConfig();
  }

  /**
   * Load configuration from file or use defaults
   */
  private loadConfig(): ToolPermissionConfig {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf-8');
        const loaded = JSON.parse(data) as Partial<ToolPermissionConfig>;

        // Merge with defaults
        return {
          default: loaded.default || DEFAULT_CONFIG.default,
          rules: [...DEFAULT_CONFIG.rules, ...(loaded.rules || [])],
          allowlist: [...DEFAULT_CONFIG.allowlist, ...(loaded.allowlist || [])],
          denylist: [...DEFAULT_CONFIG.denylist, ...(loaded.denylist || [])],
        };
      }
    } catch (error) {
      console.warn('Failed to load tool permissions config:', error);
    }

    return { ...DEFAULT_CONFIG };
  }

  /**
   * Save configuration to file
   */
  saveConfig(): void {
    try {
      const dir = path.dirname(this.configPath);
      fs.ensureDirSync(dir);
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
    } catch (error) {
      console.warn('Failed to save tool permissions config:', error);
    }
  }

  /**
   * Get permission for a tool
   *
   * @param toolName - Name of the tool
   * @param commandArgs - Optional command arguments (for bash/shell tools)
   * @returns Permission level and optional reason
   */
  getPermission(toolName: string, commandArgs?: string): {
    permission: ToolPermission;
    reason?: string;
  } {
    const fullCommand = commandArgs ? `${toolName} ${commandArgs}` : toolName;

    // Check denylist first (highest priority)
    for (const pattern of this.config.denylist) {
      if (matchesPattern(fullCommand, pattern) || matchesPattern(toolName, pattern)) {
        return {
          permission: ToolPermission.NEVER,
          reason: `Blocked by denylist pattern: ${pattern}`,
        };
      }
    }

    // Check allowlist (for bash commands with arguments)
    if (commandArgs) {
      for (const pattern of this.config.allowlist) {
        if (matchesPattern(fullCommand, pattern)) {
          return {
            permission: ToolPermission.ALWAYS,
            reason: `Allowed by allowlist pattern: ${pattern}`,
          };
        }
      }
    }

    // Check specific rules
    for (const rule of this.config.rules) {
      if (matchesPattern(toolName, rule.pattern)) {
        return {
          permission: rule.permission,
          reason: rule.reason || `Matched rule: ${rule.pattern}`,
        };
      }
    }

    // Return default
    return {
      permission: this.config.default,
      reason: 'Using default permission',
    };
  }

  /**
   * Check if a tool should be auto-approved
   */
  shouldAutoApprove(toolName: string, commandArgs?: string): boolean {
    const { permission } = this.getPermission(toolName, commandArgs);
    return permission === ToolPermission.ALWAYS;
  }

  /**
   * Check if a tool should be blocked
   */
  shouldBlock(toolName: string, commandArgs?: string): boolean {
    const { permission } = this.getPermission(toolName, commandArgs);
    return permission === ToolPermission.NEVER;
  }

  /**
   * Add a rule
   */
  addRule(rule: ToolPermissionRule): void {
    this.config.rules.push(rule);
    this.saveConfig();
  }

  /**
   * Remove a rule by pattern
   */
  removeRule(pattern: string): boolean {
    const initialLength = this.config.rules.length;
    this.config.rules = this.config.rules.filter(r => r.pattern !== pattern);

    if (this.config.rules.length !== initialLength) {
      this.saveConfig();
      return true;
    }
    return false;
  }

  /**
   * Add to allowlist
   */
  addToAllowlist(pattern: string): void {
    if (!this.config.allowlist.includes(pattern)) {
      this.config.allowlist.push(pattern);
      this.saveConfig();
    }
  }

  /**
   * Add to denylist
   */
  addToDenylist(pattern: string): void {
    if (!this.config.denylist.includes(pattern)) {
      this.config.denylist.push(pattern);
      this.saveConfig();
    }
  }

  /**
   * Get all rules
   */
  getRules(): ToolPermissionRule[] {
    return [...this.config.rules];
  }

  /**
   * Get configuration
   */
  getConfig(): ToolPermissionConfig {
    return { ...this.config };
  }

  /**
   * Reset to defaults
   */
  resetToDefaults(): void {
    this.config = { ...DEFAULT_CONFIG };
    this.saveConfig();
  }

  /**
   * Format rules for display
   */
  formatRules(): string {
    const lines: string[] = [
      'Tool Permissions Configuration',
      '═'.repeat(50),
      '',
      `Default: ${this.config.default.toUpperCase()}`,
      '',
      '📋 Rules:',
    ];

    const permissionIcons: Record<ToolPermission, string> = {
      [ToolPermission.ALWAYS]: '✅',
      [ToolPermission.ASK]: '❓',
      [ToolPermission.NEVER]: '🚫',
    };

    for (const rule of this.config.rules) {
      const icon = permissionIcons[rule.permission];
      lines.push(`  ${icon} ${rule.pattern} → ${rule.permission}`);
    }

    lines.push('');
    lines.push('✅ Allowlist:');
    for (const pattern of this.config.allowlist.slice(0, 10)) {
      lines.push(`  • ${pattern}`);
    }
    if (this.config.allowlist.length > 10) {
      lines.push(`  ... and ${this.config.allowlist.length - 10} more`);
    }

    lines.push('');
    lines.push('🚫 Denylist:');
    for (const pattern of this.config.denylist.slice(0, 10)) {
      lines.push(`  • ${pattern}`);
    }
    if (this.config.denylist.length > 10) {
      lines.push(`  ... and ${this.config.denylist.length - 10} more`);
    }

    return lines.join('\n');
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let instance: ToolPermissionManager | null = null;

export function getToolPermissionManager(): ToolPermissionManager {
  if (!instance) {
    instance = new ToolPermissionManager();
  }
  return instance;
}

export function resetToolPermissionManager(): void {
  instance = null;
}
