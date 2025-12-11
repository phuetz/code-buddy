/**
 * Execpolicy Framework
 *
 * Granular command authorization system inspired by Codex CLI.
 * Provides fine-grained control over which commands can be executed
 * and with what parameters.
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ============================================================================
// Types
// ============================================================================

export type PolicyAction = 'allow' | 'deny' | 'ask' | 'sandbox';

export interface PolicyRule {
  /** Unique rule ID */
  id: string;
  /** Rule name */
  name: string;
  /** Rule description */
  description?: string;
  /** Command pattern (glob or regex) */
  pattern: string;
  /** Whether pattern is regex */
  isRegex?: boolean;
  /** Action to take */
  action: PolicyAction;
  /** Additional constraints */
  constraints?: {
    /** Allowed arguments patterns */
    allowedArgs?: string[];
    /** Denied arguments patterns */
    deniedArgs?: string[];
    /** Allowed working directories */
    allowedDirs?: string[];
    /** Denied working directories */
    deniedDirs?: string[];
    /** Max execution time (ms) */
    maxTimeout?: number;
    /** Require sandbox */
    requireSandbox?: boolean;
    /** Allow network */
    allowNetwork?: boolean;
  };
  /** Priority (higher = evaluated first) */
  priority: number;
  /** Whether rule is enabled */
  enabled: boolean;
  /** Creation timestamp */
  createdAt: number;
  /** Tags for organization */
  tags?: string[];
}

export interface PolicyEvaluation {
  command: string;
  args: string[];
  workDir: string;
  matchedRule: PolicyRule | null;
  action: PolicyAction;
  reason: string;
  constraints: PolicyRule['constraints'];
  timestamp: number;
}

export interface ExecPolicyConfig {
  /** Default action when no rules match */
  defaultAction: PolicyAction;
  /** Enable audit logging */
  auditLog: boolean;
  /** Max audit log entries */
  maxAuditEntries: number;
  /** Rules file path */
  rulesPath?: string;
  /** Enable dangerous command detection */
  detectDangerous: boolean;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: ExecPolicyConfig = {
  defaultAction: 'ask',
  auditLog: true,
  maxAuditEntries: 1000,
  detectDangerous: true,
};

// ============================================================================
// Built-in Rules
// ============================================================================

const BUILTIN_RULES: PolicyRule[] = [
  // Safe read-only commands
  {
    id: 'builtin-read-safe',
    name: 'Safe Read Commands',
    description: 'Allow safe read-only commands',
    pattern: '^(ls|cat|head|tail|less|more|grep|find|which|whereis|file|stat|wc|pwd|whoami|hostname|uname|date|echo|printf)$',
    isRegex: true,
    action: 'allow',
    priority: 100,
    enabled: true,
    createdAt: Date.now(),
    tags: ['builtin', 'safe', 'read-only'],
  },

  // Git commands (mostly safe)
  {
    id: 'builtin-git-safe',
    name: 'Safe Git Commands',
    description: 'Allow non-destructive git commands',
    pattern: '^git$',
    isRegex: true,
    action: 'allow',
    constraints: {
      allowedArgs: [
        '^(status|log|diff|show|branch|tag|remote|config|fetch|pull|clone).*',
      ],
      deniedArgs: [
        '^(push|reset.*--hard|clean|-f|--force).*',
      ],
    },
    priority: 90,
    enabled: true,
    createdAt: Date.now(),
    tags: ['builtin', 'git'],
  },

  // Package managers - ask
  {
    id: 'builtin-pkg-managers',
    name: 'Package Managers',
    description: 'Ask before running package managers',
    pattern: '^(npm|yarn|pnpm|pip|pip3|cargo|go|bundle|gem|composer|apt|apt-get|brew|yum|dnf|pacman)$',
    isRegex: true,
    action: 'ask',
    priority: 80,
    enabled: true,
    createdAt: Date.now(),
    tags: ['builtin', 'package-manager'],
  },

  // Build tools - allow in sandbox
  {
    id: 'builtin-build-tools',
    name: 'Build Tools',
    description: 'Run build tools in sandbox',
    pattern: '^(make|cmake|ninja|gradle|mvn|ant)$',
    isRegex: true,
    action: 'sandbox',
    constraints: {
      requireSandbox: true,
    },
    priority: 75,
    enabled: true,
    createdAt: Date.now(),
    tags: ['builtin', 'build'],
  },

  // Dangerous commands - deny
  {
    id: 'builtin-dangerous',
    name: 'Dangerous Commands',
    description: 'Block dangerous commands',
    pattern: '^(rm|rmdir|dd|mkfs|fdisk|parted|shutdown|reboot|init|systemctl|chmod|chown)$',
    isRegex: true,
    action: 'deny',
    priority: 200,
    enabled: true,
    createdAt: Date.now(),
    tags: ['builtin', 'dangerous'],
  },

  // Shell interpreters - sandbox
  {
    id: 'builtin-shells',
    name: 'Shell Interpreters',
    description: 'Run shells in sandbox',
    pattern: '^(bash|sh|zsh|fish|dash|ksh)$',
    isRegex: true,
    action: 'sandbox',
    constraints: {
      requireSandbox: true,
    },
    priority: 70,
    enabled: true,
    createdAt: Date.now(),
    tags: ['builtin', 'shell'],
  },

  // Network tools - ask
  {
    id: 'builtin-network',
    name: 'Network Tools',
    description: 'Ask before network operations',
    pattern: '^(curl|wget|ssh|scp|rsync|ftp|sftp|nc|netcat|telnet|ping|traceroute|nmap)$',
    isRegex: true,
    action: 'ask',
    constraints: {
      allowNetwork: true,
    },
    priority: 85,
    enabled: true,
    createdAt: Date.now(),
    tags: ['builtin', 'network'],
  },

  // Scripting languages - sandbox
  {
    id: 'builtin-scripting',
    name: 'Scripting Languages',
    description: 'Run scripts in sandbox',
    pattern: '^(python|python3|ruby|perl|node|deno|bun|php)$',
    isRegex: true,
    action: 'sandbox',
    constraints: {
      requireSandbox: true,
      maxTimeout: 300000, // 5 minutes
    },
    priority: 60,
    enabled: true,
    createdAt: Date.now(),
    tags: ['builtin', 'scripting'],
  },

  // Editors - allow
  {
    id: 'builtin-editors',
    name: 'Text Editors',
    description: 'Allow text editors',
    pattern: '^(nano|vi|vim|nvim|emacs|code|subl)$',
    isRegex: true,
    action: 'allow',
    priority: 50,
    enabled: true,
    createdAt: Date.now(),
    tags: ['builtin', 'editor'],
  },
];

// ============================================================================
// Dangerous Patterns
// ============================================================================

const DANGEROUS_PATTERNS = [
  { pattern: /rm\s+(-rf?|--recursive)\s+\/$/, severity: 'critical', description: 'Delete root filesystem' },
  { pattern: /rm\s+(-rf?|--recursive)\s+~\/?$/, severity: 'critical', description: 'Delete home directory' },
  { pattern: /dd\s+.*of=\/dev\/sd[a-z]/, severity: 'critical', description: 'Overwrite disk device' },
  { pattern: /mkfs\s+/, severity: 'critical', description: 'Format filesystem' },
  { pattern: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, severity: 'critical', description: 'Fork bomb' },
  { pattern: /chmod\s+(-R\s+)?777\s+\//, severity: 'high', description: 'Insecure permissions on root' },
  { pattern: /curl.*\|\s*(bash|sh)/, severity: 'high', description: 'Pipe curl to shell' },
  { pattern: /wget.*\|\s*(bash|sh)/, severity: 'high', description: 'Pipe wget to shell' },
  { pattern: />\s*\/dev\/sd[a-z]/, severity: 'high', description: 'Write to disk device' },
  { pattern: /eval\s+"\$\(/, severity: 'medium', description: 'Eval command substitution' },
  { pattern: /base64\s+-d.*\|\s*(bash|sh)/, severity: 'high', description: 'Decode and execute' },
];

// ============================================================================
// ExecPolicy Class
// ============================================================================

export class ExecPolicy extends EventEmitter {
  private config: ExecPolicyConfig;
  private rules: PolicyRule[] = [];
  private auditLog: PolicyEvaluation[] = [];
  private initialized = false;

  constructor(config: Partial<ExecPolicyConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize policy system
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Load built-in rules
    this.rules = [...BUILTIN_RULES];

    // Load custom rules from file
    if (this.config.rulesPath) {
      await this.loadRulesFromFile(this.config.rulesPath);
    } else {
      // Try default location
      const defaultPath = path.join(os.homedir(), '.grok', 'execpolicy.json');
      if (fs.existsSync(defaultPath)) {
        await this.loadRulesFromFile(defaultPath);
      }
    }

    // Sort rules by priority
    this.rules.sort((a, b) => b.priority - a.priority);

    this.initialized = true;
    this.emit('initialized', { rulesCount: this.rules.length });
  }

  /**
   * Evaluate command against policy
   */
  evaluate(command: string, args: string[] = [], workDir: string = process.cwd()): PolicyEvaluation {
    const fullCommand = [command, ...args].join(' ');

    // Check for dangerous patterns first
    if (this.config.detectDangerous) {
      const dangerous = this.detectDangerous(fullCommand);
      if (dangerous) {
        const evaluation: PolicyEvaluation = {
          command,
          args,
          workDir,
          matchedRule: null,
          action: 'deny',
          reason: `Dangerous pattern detected: ${dangerous.description} (${dangerous.severity})`,
          constraints: {},
          timestamp: Date.now(),
        };
        this.recordAudit(evaluation);
        return evaluation;
      }
    }

    // Find matching rule
    for (const rule of this.rules) {
      if (!rule.enabled) continue;

      const matches = this.matchesRule(command, args, workDir, rule);
      if (matches) {
        const evaluation: PolicyEvaluation = {
          command,
          args,
          workDir,
          matchedRule: rule,
          action: rule.action,
          reason: `Matched rule: ${rule.name}`,
          constraints: rule.constraints || {},
          timestamp: Date.now(),
        };
        this.recordAudit(evaluation);
        return evaluation;
      }
    }

    // No rule matched, use default action
    const evaluation: PolicyEvaluation = {
      command,
      args,
      workDir,
      matchedRule: null,
      action: this.config.defaultAction,
      reason: 'No matching rule, using default action',
      constraints: {},
      timestamp: Date.now(),
    };
    this.recordAudit(evaluation);
    return evaluation;
  }

  /**
   * Quick check if command is allowed
   */
  isAllowed(command: string, args: string[] = [], workDir?: string): boolean {
    const evaluation = this.evaluate(command, args, workDir);
    return evaluation.action === 'allow';
  }

  /**
   * Add custom rule
   */
  addRule(rule: Omit<PolicyRule, 'id' | 'createdAt'>): PolicyRule {
    const newRule: PolicyRule = {
      ...rule,
      id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now(),
    };

    this.rules.push(newRule);
    this.rules.sort((a, b) => b.priority - a.priority);

    this.emit('rule:added', newRule);
    return newRule;
  }

  /**
   * Remove rule by ID
   */
  removeRule(id: string): boolean {
    const index = this.rules.findIndex(r => r.id === id);
    if (index === -1) return false;

    const removed = this.rules.splice(index, 1)[0];
    this.emit('rule:removed', removed);
    return true;
  }

  /**
   * Update rule
   */
  updateRule(id: string, updates: Partial<PolicyRule>): PolicyRule | null {
    const rule = this.rules.find(r => r.id === id);
    if (!rule) return null;

    Object.assign(rule, updates);
    this.rules.sort((a, b) => b.priority - a.priority);

    this.emit('rule:updated', rule);
    return rule;
  }

  /**
   * Get all rules
   */
  getRules(includeBuiltin = true): PolicyRule[] {
    if (includeBuiltin) {
      return [...this.rules];
    }
    return this.rules.filter(r => !r.tags?.includes('builtin'));
  }

  /**
   * Get rule by ID
   */
  getRule(id: string): PolicyRule | null {
    return this.rules.find(r => r.id === id) || null;
  }

  /**
   * Get audit log
   */
  getAuditLog(limit?: number): PolicyEvaluation[] {
    if (limit) {
      return this.auditLog.slice(-limit);
    }
    return [...this.auditLog];
  }

  /**
   * Clear audit log
   */
  clearAuditLog(): void {
    this.auditLog = [];
  }

  /**
   * Export rules to JSON
   */
  exportRules(includeBuiltin = false): string {
    const rules = this.getRules(includeBuiltin);
    return JSON.stringify(rules, null, 2);
  }

  /**
   * Import rules from JSON
   */
  importRules(json: string, replace = false): number {
    try {
      const imported = JSON.parse(json) as PolicyRule[];

      if (replace) {
        this.rules = this.rules.filter(r => r.tags?.includes('builtin'));
      }

      let count = 0;
      for (const rule of imported) {
        if (!rule.tags?.includes('builtin')) {
          this.rules.push({
            ...rule,
            id: rule.id || `imported-${Date.now()}-${count}`,
            createdAt: rule.createdAt || Date.now(),
          });
          count++;
        }
      }

      this.rules.sort((a, b) => b.priority - a.priority);
      return count;
    } catch {
      return 0;
    }
  }

  /**
   * Save rules to file
   */
  async saveRules(filePath?: string): Promise<void> {
    const savePath = filePath || this.config.rulesPath || path.join(os.homedir(), '.grok', 'execpolicy.json');

    // Ensure directory exists
    const dir = path.dirname(savePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const customRules = this.getRules(false);
    fs.writeFileSync(savePath, JSON.stringify(customRules, null, 2));
  }

  /**
   * Format policy dashboard
   */
  formatDashboard(): string {
    const lines: string[] = [
      '🔐 Execution Policy Dashboard',
      '',
      `Default Action: ${this.config.defaultAction.toUpperCase()}`,
      `Dangerous Detection: ${this.config.detectDangerous ? '✓ Enabled' : '✗ Disabled'}`,
      `Audit Log: ${this.config.auditLog ? '✓ Enabled' : '✗ Disabled'}`,
      '',
      `📜 Rules (${this.rules.length} total)`,
    ];

    // Group rules by action
    const byAction: Record<PolicyAction, PolicyRule[]> = {
      allow: [],
      deny: [],
      ask: [],
      sandbox: [],
    };

    for (const rule of this.rules) {
      byAction[rule.action].push(rule);
    }

    for (const [action, rules] of Object.entries(byAction)) {
      if (rules.length > 0) {
        lines.push(`  ${action.toUpperCase()}: ${rules.length} rules`);
      }
    }

    // Recent audit entries
    if (this.auditLog.length > 0) {
      lines.push('', '📊 Recent Evaluations');
      for (const entry of this.auditLog.slice(-5)) {
        const time = new Date(entry.timestamp).toLocaleTimeString();
        lines.push(`  [${time}] ${entry.command} → ${entry.action}`);
      }
    }

    return lines.join('\n');
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private matchesRule(command: string, args: string[], workDir: string, rule: PolicyRule): boolean {
    // Match command pattern
    let commandMatches = false;

    if (rule.isRegex) {
      const regex = new RegExp(rule.pattern);
      commandMatches = regex.test(command);
    } else {
      // Glob-style matching
      commandMatches = this.matchGlob(command, rule.pattern);
    }

    if (!commandMatches) return false;

    // Check constraints
    if (rule.constraints) {
      // Check allowed args
      if (rule.constraints.allowedArgs) {
        const argsStr = args.join(' ');
        const allowed = rule.constraints.allowedArgs.some(pattern => {
          const regex = new RegExp(pattern);
          return regex.test(argsStr);
        });
        if (!allowed && args.length > 0) return false;
      }

      // Check denied args
      if (rule.constraints.deniedArgs) {
        const argsStr = args.join(' ');
        const denied = rule.constraints.deniedArgs.some(pattern => {
          const regex = new RegExp(pattern);
          return regex.test(argsStr);
        });
        if (denied) return false;
      }

      // Check allowed directories
      if (rule.constraints.allowedDirs) {
        const inAllowed = rule.constraints.allowedDirs.some(dir =>
          workDir.startsWith(dir)
        );
        if (!inAllowed) return false;
      }

      // Check denied directories
      if (rule.constraints.deniedDirs) {
        const inDenied = rule.constraints.deniedDirs.some(dir =>
          workDir.startsWith(dir)
        );
        if (inDenied) return false;
      }
    }

    return true;
  }

  private matchGlob(str: string, pattern: string): boolean {
    // Simple glob matching (* and ?)
    const regex = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    return new RegExp(`^${regex}$`).test(str);
  }

  private detectDangerous(command: string): { severity: string; description: string } | null {
    for (const { pattern, severity, description } of DANGEROUS_PATTERNS) {
      if (pattern.test(command)) {
        return { severity, description };
      }
    }
    return null;
  }

  private recordAudit(evaluation: PolicyEvaluation): void {
    if (!this.config.auditLog) return;

    this.auditLog.push(evaluation);

    // Trim old entries
    if (this.auditLog.length > this.config.maxAuditEntries) {
      this.auditLog = this.auditLog.slice(-this.config.maxAuditEntries);
    }

    this.emit('audit', evaluation);
  }

  private async loadRulesFromFile(filePath: string): Promise<void> {
    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        const customRules = JSON.parse(content) as PolicyRule[];

        for (const rule of customRules) {
          if (!rule.tags?.includes('builtin')) {
            this.rules.push(rule);
          }
        }
      }
    } catch (error) {
      this.emit('error', { type: 'load', error });
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let policyInstance: ExecPolicy | null = null;

export function getExecPolicy(config?: Partial<ExecPolicyConfig>): ExecPolicy {
  if (!policyInstance) {
    policyInstance = new ExecPolicy(config);
  }
  return policyInstance;
}

export async function initializeExecPolicy(config?: Partial<ExecPolicyConfig>): Promise<ExecPolicy> {
  const policy = getExecPolicy(config);
  await policy.initialize();
  return policy;
}

export function resetExecPolicy(): void {
  policyInstance = null;
}
