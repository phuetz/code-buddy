/**
 * Three-Tier Approval Modes System
 *
 * Inspired by Codex CLI's permission model:
 * - read-only: Only read operations, no writes or commands
 * - auto: Automatically approve safe operations, confirm dangerous ones
 * - full-access: All operations auto-approved (for trusted environments)
 *
 * Provides fine-grained control over what the agent can do without confirmation.
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { parseJSONSafe, ApprovalModeConfigSchema } from '../utils/json-validator.js';

// ============================================================================
// Types
// ============================================================================

export type ApprovalMode = 'read-only' | 'auto' | 'full-access';

export type OperationType =
  | 'file-read'
  | 'file-write'
  | 'file-create'
  | 'file-delete'
  | 'command-safe'
  | 'command-network'
  | 'command-system'
  | 'command-destructive'
  | 'network-fetch'
  | 'search'
  | 'unknown';

export interface OperationRequest {
  type: OperationType;
  tool: string;
  target?: string;
  command?: string;
  description?: string;
}

export interface ApprovalResult {
  approved: boolean;
  requiresConfirmation: boolean;
  reason?: string;
  autoApproved?: boolean;
}

export interface ApprovalModeConfig {
  mode: ApprovalMode;
  description: string;
  autoApproveTypes: OperationType[];
  requireConfirmTypes: OperationType[];
  blockTypes: OperationType[];
}

// ============================================================================
// Mode Configurations
// ============================================================================

const APPROVAL_MODE_CONFIGS: Record<ApprovalMode, ApprovalModeConfig> = {
  'read-only': {
    mode: 'read-only',
    description: 'Read-only mode - no write operations allowed',
    autoApproveTypes: ['file-read', 'search', 'network-fetch'],
    requireConfirmTypes: [],
    blockTypes: [
      'file-write',
      'file-create',
      'file-delete',
      'command-safe',
      'command-network',
      'command-system',
      'command-destructive',
    ],
  },
  auto: {
    mode: 'auto',
    description: 'Auto mode - approve safe operations, confirm dangerous ones',
    autoApproveTypes: [
      'file-read',
      'search',
      'network-fetch',
      'command-safe',
    ],
    requireConfirmTypes: [
      'file-write',
      'file-create',
      'file-delete',
      'command-network',
      'command-system',
    ],
    blockTypes: ['command-destructive'],
  },
  'full-access': {
    mode: 'full-access',
    description: 'Full access mode - all operations auto-approved',
    autoApproveTypes: [
      'file-read',
      'file-write',
      'file-create',
      'file-delete',
      'search',
      'network-fetch',
      'command-safe',
      'command-network',
      'command-system',
    ],
    requireConfirmTypes: ['command-destructive'],
    blockTypes: [],
  },
};

// Safe commands that can be auto-approved
const SAFE_COMMANDS = new Set([
  'ls', 'cat', 'head', 'tail', 'less', 'more', 'wc', 'grep', 'find',
  'pwd', 'echo', 'date', 'whoami', 'uname', 'which', 'whereis',
  'git status', 'git log', 'git diff', 'git branch', 'git show',
  'npm list', 'npm ls', 'npm outdated', 'npm view',
  'node --version', 'npm --version', 'python --version',
  'cargo --version', 'go version', 'rustc --version',
]);

// Network-related commands
const NETWORK_COMMANDS = new Set([
  'curl', 'wget', 'fetch', 'http', 'ssh', 'scp', 'rsync',
  'npm install', 'npm i', 'npm ci', 'npm update',
  'yarn', 'yarn install', 'yarn add',
  'pip install', 'pip3 install',
  'cargo install', 'cargo add',
  'go get', 'go mod download',
]);

// System-modifying commands
const SYSTEM_COMMANDS = new Set([
  'chmod', 'chown', 'chgrp', 'mount', 'umount',
  'systemctl', 'service', 'launchctl',
  'apt', 'apt-get', 'yum', 'dnf', 'brew', 'pacman',
  'docker', 'docker-compose', 'podman',
  'kubectl', 'helm',
]);

// Destructive commands (always require confirmation or blocked)
const DESTRUCTIVE_PATTERNS = [
  /^rm\s+-rf?\s+\//,
  /^rm\s+-rf?\s+~/,
  /^rm\s+-rf?\s+\*/,
  /^sudo\s+rm/,
  /^dd\s+if=/,
  /^mkfs\./,
  /^format/i,
  />\s*\/dev\//,
  /:\(\)\{:\|:&\};:/,  // Fork bomb
];

// ============================================================================
// Approval Mode Manager
// ============================================================================

export class ApprovalModeManager extends EventEmitter {
  private mode: ApprovalMode = 'auto';
  private configPath: string;
  private sessionApprovals: Map<string, boolean> = new Map();
  private operationHistory: OperationRequest[] = [];

  constructor(configPath?: string) {
    super();
    this.configPath = configPath || '.grok/approval-mode.json';
    this.loadConfig();
  }

  /**
   * Load configuration from file with schema validation
   */
  private loadConfig(): void {
    try {
      if (fs.existsSync(this.configPath)) {
        const content = fs.readFileSync(this.configPath, 'utf-8');
        const config = parseJSONSafe(content, ApprovalModeConfigSchema);
        if (config && config.mode in APPROVAL_MODE_CONFIGS) {
          this.mode = config.mode;
        }
      }
    } catch {
      // Use default mode
    }
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
      fs.writeFileSync(
        this.configPath,
        JSON.stringify({ mode: this.mode }, null, 2)
      );
      this.emit('config:saved', this.mode);
    } catch (error) {
      this.emit('config:error', error);
    }
  }

  /**
   * Set approval mode
   */
  setMode(mode: ApprovalMode): void {
    const previousMode = this.mode;
    this.mode = mode;
    this.sessionApprovals.clear();
    this.emit('mode:changed', { previousMode, newMode: mode });
  }

  /**
   * Get current mode
   */
  getMode(): ApprovalMode {
    return this.mode;
  }

  /**
   * Get mode configuration
   */
  getModeConfig(): ApprovalModeConfig {
    return { ...APPROVAL_MODE_CONFIGS[this.mode] };
  }

  /**
   * Check if an operation should be approved
   */
  checkApproval(request: OperationRequest): ApprovalResult {
    const config = APPROVAL_MODE_CONFIGS[this.mode];
    const operationType = this.classifyOperation(request);

    // Track operation
    this.operationHistory.push({ ...request, type: operationType });

    // Check if blocked
    if (config.blockTypes.includes(operationType)) {
      return {
        approved: false,
        requiresConfirmation: false,
        reason: `Operation blocked in ${this.mode} mode`,
      };
    }

    // Check if auto-approved
    if (config.autoApproveTypes.includes(operationType)) {
      this.emit('operation:auto-approved', request);
      return {
        approved: true,
        requiresConfirmation: false,
        autoApproved: true,
      };
    }

    // Check session approvals (e.g., "don't ask again")
    const sessionKey = this.getSessionKey(request);
    if (this.sessionApprovals.has(sessionKey)) {
      return {
        approved: this.sessionApprovals.get(sessionKey)!,
        requiresConfirmation: false,
        autoApproved: true,
        reason: 'Previously approved this session',
      };
    }

    // Requires confirmation
    if (config.requireConfirmTypes.includes(operationType)) {
      return {
        approved: false,
        requiresConfirmation: true,
        reason: `${operationType} requires confirmation`,
      };
    }

    // Unknown type - require confirmation
    return {
      approved: false,
      requiresConfirmation: true,
      reason: 'Unknown operation type',
    };
  }

  /**
   * Classify operation type from request
   */
  private classifyOperation(request: OperationRequest): OperationType {
    // If type is already set, use it
    if (request.type && request.type !== 'unknown') {
      return request.type;
    }

    const tool = request.tool.toLowerCase();
    const command = request.command?.toLowerCase() || '';

    // File operations
    if (tool === 'read' || tool === 'view_file' || tool === 'cat') {
      return 'file-read';
    }
    if (tool === 'write' || tool === 'create_file') {
      return request.target && fs.existsSync(request.target)
        ? 'file-write'
        : 'file-create';
    }
    if (tool === 'delete' || tool === 'rm') {
      return 'file-delete';
    }
    if (tool === 'edit' || tool === 'str_replace_editor') {
      return 'file-write';
    }

    // Search operations
    if (tool === 'search' || tool === 'grep' || tool === 'glob' || tool === 'find_files') {
      return 'search';
    }

    // Network operations
    if (tool === 'web_fetch' || tool === 'web_search' || tool === 'fetch') {
      return 'network-fetch';
    }

    // Command classification
    if (tool === 'bash' || tool === 'shell' || tool === 'execute') {
      return this.classifyCommand(command);
    }

    return 'unknown';
  }

  /**
   * Classify a shell command
   */
  private classifyCommand(command: string): OperationType {
    // Check destructive patterns first
    for (const pattern of DESTRUCTIVE_PATTERNS) {
      if (pattern.test(command)) {
        return 'command-destructive';
      }
    }

    // Get base command
    const baseCommand = command.split(/\s+/)[0];
    const fullCommand = command.trim();

    // Check safe commands
    if (SAFE_COMMANDS.has(baseCommand) || SAFE_COMMANDS.has(fullCommand)) {
      return 'command-safe';
    }

    // Check network commands
    if (NETWORK_COMMANDS.has(baseCommand)) {
      return 'command-network';
    }

    // Check system commands
    if (SYSTEM_COMMANDS.has(baseCommand)) {
      return 'command-system';
    }

    // Git commands are generally safe for reading
    if (baseCommand === 'git') {
      const gitSubcommand = command.split(/\s+/)[1];
      const safeGitCommands = ['status', 'log', 'diff', 'branch', 'show', 'ls-files'];
      if (safeGitCommands.includes(gitSubcommand)) {
        return 'command-safe';
      }
      return 'command-system';
    }

    // Default to system command (requires confirmation in auto mode)
    return 'command-system';
  }

  /**
   * Get session key for an operation
   */
  private getSessionKey(request: OperationRequest): string {
    return `${request.tool}:${request.type}:${request.target || ''}`;
  }

  /**
   * Remember approval for this session
   */
  rememberApproval(request: OperationRequest, approved: boolean): void {
    const key = this.getSessionKey(request);
    this.sessionApprovals.set(key, approved);
    this.emit('session:approval-remembered', { key, approved });
  }

  /**
   * Clear session approvals
   */
  clearSessionApprovals(): void {
    this.sessionApprovals.clear();
    this.emit('session:approvals-cleared');
  }

  /**
   * Get operation history
   */
  getOperationHistory(): OperationRequest[] {
    return [...this.operationHistory];
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalOperations: number;
    byType: Record<OperationType, number>;
    autoApproved: number;
    blocked: number;
  } {
    const byType: Record<OperationType, number> = {
      'file-read': 0,
      'file-write': 0,
      'file-create': 0,
      'file-delete': 0,
      'command-safe': 0,
      'command-network': 0,
      'command-system': 0,
      'command-destructive': 0,
      'network-fetch': 0,
      search: 0,
      unknown: 0,
    };

    for (const op of this.operationHistory) {
      byType[op.type]++;
    }

    const config = APPROVAL_MODE_CONFIGS[this.mode];
    let autoApproved = 0;
    let blocked = 0;

    for (const op of this.operationHistory) {
      if (config.autoApproveTypes.includes(op.type)) autoApproved++;
      if (config.blockTypes.includes(op.type)) blocked++;
    }

    return {
      totalOperations: this.operationHistory.length,
      byType,
      autoApproved,
      blocked,
    };
  }

  /**
   * Get all available modes
   */
  getAvailableModes(): ApprovalModeConfig[] {
    return Object.values(APPROVAL_MODE_CONFIGS);
  }

  /**
   * Format mode for display
   */
  formatMode(mode: ApprovalMode): string {
    const icons: Record<ApprovalMode, string> = {
      'read-only': '👁️',
      auto: '🤖',
      'full-access': '🔓',
    };
    const config = APPROVAL_MODE_CONFIGS[mode];
    return `${icons[mode]} ${mode}: ${config.description}`;
  }

  /**
   * Get help text
   */
  getHelpText(): string {
    return `
**Approval Modes**

Control what operations the agent can perform:

| Mode | Description |
|------|-------------|
| read-only | Only read operations (search, view files) |
| auto | Auto-approve safe ops, confirm dangerous ones |
| full-access | All operations auto-approved |

**Commands:**
- \`/mode read-only\` - Switch to read-only mode
- \`/mode auto\` - Switch to auto mode (default)
- \`/mode full-access\` - Switch to full-access mode

**Auto-approved in "auto" mode:**
- File reads
- Searches
- Safe commands (ls, git status, etc.)

**Requires confirmation in "auto" mode:**
- File writes/creates/deletes
- Network commands (npm install, etc.)
- System commands (docker, kubectl, etc.)
`.trim();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let approvalModeInstance: ApprovalModeManager | null = null;

export function getApprovalModeManager(
  configPath?: string
): ApprovalModeManager {
  if (!approvalModeInstance) {
    approvalModeInstance = new ApprovalModeManager(configPath);
  }
  return approvalModeInstance;
}

export function resetApprovalModeManager(): void {
  approvalModeInstance = null;
}
