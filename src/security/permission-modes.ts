/**
 * Permission Modes
 *
 * Five-tier permission system: default, plan, acceptEdits, dontAsk, bypassPermissions.
 * With managed setting to disable bypass, subagent-specific modes, and pattern-based allowlists.
 */

import { logger } from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export type PermissionMode = 'default' | 'plan' | 'acceptEdits' | 'dontAsk' | 'bypassPermissions';

export interface PermissionModeConfig {
  mode: PermissionMode;
  disableBypass: boolean;
  subagentMode?: PermissionMode;
}

export interface PermissionDecision {
  allowed: boolean;
  reason: string;
  prompted: boolean;
}

// ============================================================================
// Tool Classifications
// ============================================================================

const READ_ONLY_TOOLS = new Set([
  'view_file',
  'read_file',
  'search',
  'list_files',
  'grep',
  'glob',
  'git_log',
  'git_status',
  'git_diff',
]);

const EDIT_TOOLS = new Set([
  'str_replace_editor',
  'create_file',
  'write_file',
  'edit_file',
  'apply_patch',
  'multi_edit',
]);

const DESTRUCTIVE_TOOLS = new Set([
  'bash',
  'delete_file',
  'rm',
  'git_reset',
  'git_checkout',
]);

// ============================================================================
// Permission Mode Manager
// ============================================================================

export class PermissionModeManager {
  private config: PermissionModeConfig;
  private allowedPatterns: string[] = [];

  constructor(config?: Partial<PermissionModeConfig>) {
    this.config = {
      mode: config?.mode || 'default',
      disableBypass: config?.disableBypass ?? false,
      subagentMode: config?.subagentMode,
    };
  }

  /**
   * Set the permission mode
   * Returns false if trying to set bypassPermissions when it's disabled
   */
  setMode(mode: PermissionMode): boolean {
    if (mode === 'bypassPermissions' && this.config.disableBypass) {
      logger.warn('Cannot enable bypassPermissions: disabled by managed setting');
      return false;
    }
    this.config.mode = mode;
    logger.info(`Permission mode set to: ${mode}`);
    return true;
  }

  getMode(): PermissionMode {
    return this.config.mode;
  }

  /**
   * Check permission for an action
   */
  checkPermission(action: string, toolName: string): PermissionDecision {
    // Check pattern allowlist first
    if (this.isPatternAllowed(action)) {
      return { allowed: true, reason: 'Matched allowed pattern', prompted: false };
    }

    switch (this.config.mode) {
      case 'default':
        return this.checkDefault(action, toolName);
      case 'plan':
        return this.checkPlan(action, toolName);
      case 'acceptEdits':
        return this.checkAcceptEdits(action, toolName);
      case 'dontAsk':
        return this.checkDontAsk(action, toolName);
      case 'bypassPermissions':
        return this.checkBypass(action, toolName);
      default:
        return this.checkDefault(action, toolName);
    }
  }

  /**
   * Default mode: prompt for everything except read-only
   */
  private checkDefault(_action: string, toolName: string): PermissionDecision {
    if (this.isReadOnlyTool(toolName)) {
      return { allowed: true, reason: 'Read-only tool auto-approved', prompted: false };
    }
    return { allowed: true, reason: 'Requires user confirmation', prompted: true };
  }

  /**
   * Plan mode: only allow read-only tools, block edits and destructive
   */
  private checkPlan(_action: string, toolName: string): PermissionDecision {
    if (this.isReadOnlyTool(toolName)) {
      return { allowed: true, reason: 'Read-only tool allowed in plan mode', prompted: false };
    }
    return { allowed: false, reason: 'Only read-only tools allowed in plan mode', prompted: false };
  }

  /**
   * Accept edits mode: auto-approve read and edit tools, prompt for destructive
   */
  private checkAcceptEdits(_action: string, toolName: string): PermissionDecision {
    if (this.isReadOnlyTool(toolName)) {
      return { allowed: true, reason: 'Read-only tool auto-approved', prompted: false };
    }
    if (this.isEditTool(toolName)) {
      return { allowed: true, reason: 'Edit tool auto-approved in acceptEdits mode', prompted: false };
    }
    if (this.isDestructiveTool(toolName)) {
      return { allowed: true, reason: 'Destructive tool requires confirmation', prompted: true };
    }
    return { allowed: true, reason: 'Requires confirmation', prompted: true };
  }

  /**
   * Don't ask mode: auto-approve everything except destructive
   */
  private checkDontAsk(_action: string, toolName: string): PermissionDecision {
    if (this.isDestructiveTool(toolName)) {
      return { allowed: true, reason: 'Destructive tool requires confirmation in dontAsk mode', prompted: true };
    }
    return { allowed: true, reason: 'Auto-approved in dontAsk mode', prompted: false };
  }

  /**
   * Bypass mode: auto-approve everything
   */
  private checkBypass(_action: string, _toolName: string): PermissionDecision {
    return { allowed: true, reason: 'All operations auto-approved in bypass mode', prompted: false };
  }

  /**
   * Tool classification
   */
  isReadOnlyTool(toolName: string): boolean {
    return READ_ONLY_TOOLS.has(toolName);
  }

  isEditTool(toolName: string): boolean {
    return EDIT_TOOLS.has(toolName);
  }

  isDestructiveTool(toolName: string): boolean {
    return DESTRUCTIVE_TOOLS.has(toolName);
  }

  /**
   * Add an allowed pattern
   */
  addAllowedPattern(pattern: string): void {
    if (!this.allowedPatterns.includes(pattern)) {
      this.allowedPatterns.push(pattern);
    }
  }

  /**
   * Check if an action matches any allowed pattern
   */
  isPatternAllowed(action: string): boolean {
    return this.allowedPatterns.some(pattern => {
      // Convert glob-like pattern to regex
      const regex = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*');
      return new RegExp(`^${regex}$`).test(action);
    });
  }

  /**
   * Set subagent mode
   */
  setSubagentMode(mode: PermissionMode): void {
    this.config.subagentMode = mode;
    logger.info(`Subagent permission mode set to: ${mode}`);
  }

  getSubagentMode(): PermissionMode {
    return this.config.subagentMode || this.config.mode;
  }

  /**
   * Set bypass disabled (managed setting)
   */
  setBypassDisabled(disabled: boolean): void {
    this.config.disableBypass = disabled;
    // If bypass was active and we're disabling it, revert to default
    if (disabled && this.config.mode === 'bypassPermissions') {
      this.config.mode = 'default';
      logger.warn('Bypass was active but has been disabled, reverting to default mode');
    }
    logger.info(`Bypass disabled: ${disabled}`);
  }

  isBypassDisabled(): boolean {
    return this.config.disableBypass;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let permissionModeManagerInstance: PermissionModeManager | null = null;

export function getPermissionModeManager(): PermissionModeManager {
  if (!permissionModeManagerInstance) {
    permissionModeManagerInstance = new PermissionModeManager();
  }
  return permissionModeManagerInstance;
}

export function resetPermissionModeManager(): void {
  permissionModeManagerInstance = null;
}
