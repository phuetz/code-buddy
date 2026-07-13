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
import { createHash } from 'node:crypto';
import { parseBashCommand } from '../security/bash-parser.js';

// ============================================================================
// Types
// ============================================================================

export type PolicyAction = 'allow' | 'deny' | 'ask' | 'sandbox';

const UNSAFE_BARE_PREFIXES = new Set([
  'bash', 'sh', 'zsh', 'fish', 'dash', 'ksh',
  'python', 'python3', 'node', 'deno', 'bun', 'ruby', 'perl',
  'sudo', 'su', 'doas', 'env', 'git',
]);

/**
 * Prefix rule — Codex-inspired token-array prefix matching.
 *
 * Unlike glob/regex `PolicyRule` which matches a command string, a PrefixRule
 * matches the exact token array prefix of the parsed command.  This is safer
 * than regex because it avoids bypass via quoting/encoding tricks.
 *
 * Example: `prefix: ['git', 'push']` will match `git push origin main` but
 * NOT `echo git push` because the first token is `echo`.
 *
 * When multiple prefix rules match, the longest prefix wins (most specific).
 */
export interface PrefixRule {
  id: string;
  /** Exact token-array prefix that must match argv[0..prefix.length-1] */
  prefix: string[];
  action: PolicyAction;
  description?: string;
  enabled: boolean;
  createdAt: number;
}

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

/**
 * Result of evaluating a complete shell expression.
 *
 * Shell strings are never authorised from argv[0] alone: every parsed segment
 * contributes a decision and the most restrictive one wins.  This mirrors the
 * Codex exec-policy boundary and prevents an allowed prefix such as
 * `git status` from hiding a later `rm`, a pipe to a shell, or a substitution.
 */
export interface ShellPolicyEvaluation extends PolicyEvaluation {
  parsedSegments: string[][];
  segmentEvaluations: PolicyEvaluation[];
  complex: boolean;
  approvalKey: string;
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
  // Unknown does not mean forbidden. The runtime executes this decision in a
  // workspace-write OS sandbox and only asks to leave that boundary.
  defaultAction: 'sandbox',
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
    pattern: '^(ls|cat|head|tail|less|more|grep|sort|uniq|cut|paste|diff|comm|wc|pwd|whoami|hostname|uname|date|echo|printf|printenv|which|whereis|file|stat|du|df|free|uptime|id|groups|basename|dirname|realpath|readlink|sha256sum|md5sum|jq|tree)$',
    isRegex: true,
    action: 'allow',
    priority: 100,
    enabled: true,
    createdAt: Date.now(),
    tags: ['builtin', 'safe', 'read-only'],
  },

  // Read-oriented search tools have options that can execute or delete.  They
  // therefore need their own option-aware rules rather than the generic
  // read-only bucket above.
  {
    id: 'builtin-find-safe',
    name: 'Safe find',
    description: 'Allow find only when it cannot delete or execute commands',
    pattern: '^find$',
    isRegex: true,
    action: 'allow',
    constraints: {
      deniedArgs: ['(^|\\s)-(delete|exec|execdir|ok|okdir)(\\s|$)'],
    },
    priority: 105,
    enabled: true,
    createdAt: Date.now(),
    tags: ['builtin', 'safe', 'read-only'],
  },
  {
    id: 'builtin-ripgrep-safe',
    name: 'Safe ripgrep',
    description: 'Allow ripgrep unless an option can launch a helper program',
    pattern: '^(rg|ripgrep)$',
    isRegex: true,
    action: 'allow',
    constraints: {
      deniedArgs: ['(^|\\s)--(pre|hostname-bin)(=|\\s|$)'],
    },
    priority: 105,
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
        '^(?:status|log|diff|show|rev-parse|describe|ls-files|ls-tree|cat-file|blame|shortlog)(?:\\s|$).*',
        '^remote(?:\\s+-v)?$',
        '^branch(?:\\s+(?:--list|--show-current|--contains|--no-contains|--merged|--no-merged)(?:\\s.*)?)?$',
        '^tag(?:\\s+--list(?:\\s.*)?)?$',
      ],
      deniedArgs: [
        '(^|\\s)(?:-C|--git-dir|--work-tree|--paginate)(?:\\s|=|$)',
        '(^|\\s)(?:branch\\s+-(?:D|d)|log\\s+--output|push|reset.*--hard|clean|commit|merge|rebase|checkout|switch|restore|tag\\s+-d)(?:\\s|$).*',
      ],
    },
    priority: 90,
    enabled: true,
    createdAt: Date.now(),
    tags: ['builtin', 'git'],
  },
  {
    id: 'builtin-git-boundary',
    name: 'Git mutations and network',
    description: 'Ask before changing repository metadata or contacting a remote',
    pattern: '^git$',
    isRegex: true,
    action: 'ask',
    constraints: {
      allowedArgs: [
        '^(?:add|commit|push|fetch|pull|clone|merge|rebase|checkout|switch|restore|reset|clean|config|worktree|submodule|remote\\s+(?:add|remove|rename|set-url|update)|log\\s+--output)(?:\\s|$).*',
        '^branch\\s+(?:-[dDmMcC]|--delete|--move|--copy|--edit-description|--set-upstream-to|--unset-upstream|--create-reflog)(?:\\s|$).*',
        '^tag\\s+(?!--list(?:\\s|$)).*',
        '^(?:-C|--git-dir|--work-tree|--paginate)(?:\\s|=|$).*',
      ],
    },
    priority: 115,
    enabled: true,
    createdAt: Date.now(),
    tags: ['builtin', 'git', 'boundary', 'approval'],
  },

  // Reversible development tasks can proceed autonomously inside the
  // workspace sandbox. Package installation/publishing still falls through to
  // the generic package-manager prompt below because it needs network and may
  // execute lifecycle scripts.
  {
    id: 'builtin-pkg-routines',
    name: 'Package development routines',
    description: 'Run tests, builds and static checks in the workspace sandbox',
    pattern: '^(npm|npx|yarn|pnpm|bun|cargo|go)$',
    isRegex: true,
    action: 'sandbox',
    constraints: {
      allowedArgs: [
        '^(?:run\\s+)?(?:test|build|lint|typecheck|check|verify|format|fmt|clippy|vet)(?:\\s|$).*',
      ],
      requireSandbox: true,
      allowNetwork: false,
    },
    priority: 95,
    enabled: true,
    createdAt: Date.now(),
    tags: ['builtin', 'development', 'sandbox'],
  },

  // Package managers - ask
  {
    id: 'builtin-pkg-managers',
    name: 'Package Managers',
    description: 'Ask before running package managers',
    pattern: '^(npm|yarn|pnpm|pip|pip3|cargo|go|bundle|gem|composer|apt|apt-get|brew|yum|dnf|pacman)$',
    isRegex: true,
    action: 'ask',
    constraints: {
      deniedArgs: [
        '^(?:run\\s+)?(?:test|build|lint|typecheck|check|verify|format|fmt|clippy|vet)(?:\\s|$).*',
      ],
    },
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

  // Workspace mutations are useful and reversible. They run without a prompt
  // only inside the workspace-write sandbox; catastrophic targets are still
  // caught by DANGEROUS_PATTERNS before this rule is considered.
  {
    id: 'builtin-dangerous',
    name: 'Workspace mutations',
    description: 'Confine file mutations to the workspace',
    pattern: '^(rm|rmdir|mkdir|cp|mv|touch|truncate|chmod)$',
    isRegex: true,
    action: 'sandbox',
    constraints: {
      requireSandbox: true,
      allowNetwork: false,
    },
    priority: 110,
    enabled: true,
    createdAt: Date.now(),
    tags: ['builtin', 'mutation', 'sandbox'],
  },

  // Operations that cross the workspace/process boundary are possible, but
  // require a precise approval rather than being hard-disabled by binary name.
  {
    id: 'builtin-system-boundary',
    name: 'System boundary commands',
    description: 'Ask before changing services, processes, ownership or system state',
    pattern: '^(chown|chgrp|systemctl|service|kill|killall|pkill|mount|umount|crontab|at|sudo|su|doas|gpg|openssl|ssh-keygen|ssh-add|nmap|tcpdump|strace|gdb|lldb)$',
    isRegex: true,
    action: 'ask',
    priority: 120,
    enabled: true,
    createdAt: Date.now(),
    tags: ['builtin', 'boundary', 'approval'],
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

  {
    id: 'builtin-dev-tools',
    name: 'Development tools',
    description: 'Run local compilers, test runners and linters in the workspace sandbox',
    pattern: '^(vitest|jest|mocha|pytest|tsc|eslint|prettier|biome|rustc|gcc|g\\+\\+|clang|javac|gradle|mvn|ant|make|cmake|ninja)$',
    isRegex: true,
    action: 'sandbox',
    constraints: {
      requireSandbox: true,
      allowNetwork: false,
    },
    priority: 76,
    enabled: true,
    createdAt: Date.now(),
    tags: ['builtin', 'development', 'sandbox'],
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
  // Filesystem destruction
  { pattern: /rm\s+(-rf?|--recursive)\s+\/$/, severity: 'critical', description: 'Delete root filesystem' },
  { pattern: /rm\s+(-rf?|--recursive)\s+~\/?$/, severity: 'critical', description: 'Delete home directory' },
  { pattern: /rm\s+(-rf?|--recursive)\s+\/home\/?$/, severity: 'critical', description: 'Delete all home directories' },
  { pattern: /rm\s+(-rf?|--recursive)\s+\*\s*$/, severity: 'high', description: 'Recursive delete with wildcard' },
  { pattern: /rm\s+(-rf?|--recursive)\s+\.\s*$/, severity: 'high', description: 'Delete current directory recursively' },

  // Disk operations
  { pattern: /dd\s+.*of=\/dev\/sd[a-z]/, severity: 'critical', description: 'Overwrite disk device' },
  { pattern: /dd\s+.*of=\/dev\/nvme/, severity: 'critical', description: 'Overwrite NVMe device' },
  { pattern: /mkfs\s+/, severity: 'critical', description: 'Format filesystem' },
  { pattern: />\s*\/dev\/sd[a-z]/, severity: 'high', description: 'Write to disk device' },
  { pattern: />\s*\/dev\/nvme/, severity: 'high', description: 'Write to NVMe device' },

  // Fork bombs and resource exhaustion (multiple variants)
  { pattern: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, severity: 'critical', description: 'Fork bomb (classic)' },
  { pattern: /bomb\(\)\s*\{.*bomb\s*\|\s*bomb.*\}/, severity: 'critical', description: 'Fork bomb (named)' },
  { pattern: /\.\(\)\s*\{\s*\.\s*\|\s*\.\s*&\s*\}/, severity: 'critical', description: 'Fork bomb (dot)' },
  { pattern: /while\s+true.*fork/, severity: 'critical', description: 'Fork loop' },
  { pattern: /while\s*:\s*;\s*do.*&.*done/, severity: 'critical', description: 'Background loop bomb' },
  { pattern: /for\s+\(\s*;\s*;\s*\)\s*.*fork/, severity: 'critical', description: 'Infinite fork loop' },
  { pattern: /\$0\s*\|\s*\$0\s*&/, severity: 'critical', description: 'Self-replicating fork' },
  { pattern: /\$\{0\}.*\|\s*\$\{0\}.*&/, severity: 'critical', description: 'Self-replicating fork (braces)' },

  // Memory/resource exhaustion
  { pattern: /perl\s+-e\s*['"].*x.*\*.*['"]/, severity: 'high', description: 'Perl memory bomb' },
  { pattern: /python.*\*\*\s*\d{10,}/, severity: 'high', description: 'Python memory exhaustion' },
  { pattern: /yes\s*\|.*>\s*\/dev\//, severity: 'high', description: 'Infinite write to device' },

  // Permissions
  { pattern: /chmod\s+(-R\s+)?777\s+\//, severity: 'high', description: 'Insecure permissions on root' },
  { pattern: /chmod\s+(-R\s+)?777\s+~/, severity: 'high', description: 'Insecure permissions on home' },
  { pattern: /chown\s+(-R\s+)?root.*\//, severity: 'high', description: 'Change ownership to root' },

  // Remote code execution
  { pattern: /curl.*\|\s*(bash|sh|zsh|python|perl|ruby)/, severity: 'high', description: 'Pipe curl to interpreter' },
  { pattern: /wget.*\|\s*(bash|sh|zsh|python|perl|ruby)/, severity: 'high', description: 'Pipe wget to interpreter' },
  { pattern: /curl.*-o-.*\|/, severity: 'high', description: 'Curl output to pipe' },
  { pattern: /eval\s+"\$\(curl/, severity: 'critical', description: 'Eval curl output' },
  { pattern: /eval\s+"\$\(wget/, severity: 'critical', description: 'Eval wget output' },
  { pattern: /eval\s+"\$\(/, severity: 'medium', description: 'Eval command substitution' },
  { pattern: /base64\s+-d.*\|\s*(bash|sh)/, severity: 'high', description: 'Decode and execute' },

  // Credential/data exfiltration
  { pattern: /cat\s+.*\.ssh.*\|\s*(curl|wget|nc)/, severity: 'critical', description: 'Exfiltrate SSH keys' },
  { pattern: /cat\s+\/etc\/passwd.*\|/, severity: 'high', description: 'Exfiltrate passwd file' },
  { pattern: /cat\s+\/etc\/shadow/, severity: 'critical', description: 'Read shadow file' },
  { pattern: /history\s*\|\s*(curl|wget|nc)/, severity: 'high', description: 'Exfiltrate shell history' },

  // Network backdoors
  { pattern: /nc\s+-[le].*\|\s*(bash|sh)/, severity: 'critical', description: 'Netcat reverse shell' },
  { pattern: /bash\s+-i\s*>&\s*\/dev\/tcp/, severity: 'critical', description: 'Bash reverse shell' },
  { pattern: /\/dev\/tcp\/[0-9.]+\/[0-9]+/, severity: 'high', description: 'Bash TCP connection' },
  { pattern: /mkfifo.*nc.*\/bin\/(ba)?sh/, severity: 'critical', description: 'Named pipe reverse shell' },

  // Cron/persistence
  { pattern: /crontab\s+-r/, severity: 'high', description: 'Remove all cron jobs' },
  { pattern: /echo.*>\s*\/etc\/cron/, severity: 'high', description: 'Modify system cron' },
];

// ============================================================================
// ExecPolicy Class
// ============================================================================

export class ExecPolicy extends EventEmitter {
  private config: ExecPolicyConfig;
  private rules: PolicyRule[] = [];
  private prefixRules: PrefixRule[] = [];
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
      const defaultPath = path.join(os.homedir(), '.codebuddy', 'execpolicy.json');
      if (fs.existsSync(defaultPath)) {
        await this.loadRulesFromFile(defaultPath);
      }
    }

    // Sort rules by priority
    this.rules.sort((a, b) => b.priority - a.priority);
    this.prefixRules.sort((a, b) => b.prefix.length - a.prefix.length);

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

    // Keep every matching rule and let the most restrictive decision win.
    // Priority only breaks ties between rules with the same decision. This is
    // safer than first-match wins: a broad allow can no longer hide a precise
    // deny/prompt rule loaded later.
    const matchingRules = this.rules.filter(
      (rule) => rule.enabled && this.matchesRule(command, args, workDir, rule),
    );
    if (matchingRules.length > 0) {
      matchingRules.sort((a, b) => {
        const actionDelta = this.actionRank(b.action) - this.actionRank(a.action);
        return actionDelta !== 0 ? actionDelta : b.priority - a.priority;
      });
      const rule = matchingRules[0];
      if (rule) {
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
   * Check argv against prefix rules (token-array matching).
   * Returns the strictest matching rule, then the longest prefix on ties.
   *
   * This is evaluated BEFORE regex/glob rules to give prefix rules higher
   * specificity. Call this from evaluate() or use checkPrefix() standalone.
   */
  checkPrefix(argv: string[]): PrefixRule | null {
    const matches = this.prefixRules.filter((rule) =>
      rule.enabled &&
      argv.length >= rule.prefix.length &&
      rule.prefix.every((token, index) => token === argv[index]),
    );
    matches.sort((a, b) => {
      const actionDelta = this.actionRank(b.action) - this.actionRank(a.action);
      return actionDelta !== 0 ? actionDelta : b.prefix.length - a.prefix.length;
    });
    return matches[0] ?? null;
  }

  /**
   * Add a prefix rule (token-array exact prefix matching).
   * The new rule is inserted at the front and sorted by prefix length desc
   * so that more-specific rules are evaluated first.
   */
  addPrefixRule(rule: Omit<PrefixRule, 'id' | 'createdAt'>): PrefixRule {
    const prefix = rule.prefix.map((token) => token.trim()).filter(Boolean);
    if (prefix.length === 0) {
      throw new Error('Prefix rules require at least one non-empty argv token');
    }
    if (prefix.length === 1 && UNSAFE_BARE_PREFIXES.has(prefix[0] ?? '')) {
      throw new Error(`Refusing an over-broad prefix rule for interpreter/launcher: ${prefix[0]}`);
    }
    if (prefix.some((token) => token.includes('\0') || token.includes('\n') || token.includes('\r'))) {
      throw new Error('Prefix rule tokens cannot contain control characters');
    }
    const newRule: PrefixRule = {
      ...rule,
      prefix,
      id: `prefix-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now(),
    };
    this.prefixRules.push(newRule);
    // Longest prefix first (most specific)
    this.prefixRules.sort((a, b) => b.prefix.length - a.prefix.length);
    this.emit('prefixRule:added', newRule);
    return newRule;
  }

  /** Remove a prefix rule by ID. */
  removePrefixRule(id: string): boolean {
    const idx = this.prefixRules.findIndex(r => r.id === id);
    if (idx === -1) return false;
    const removed = this.prefixRules.splice(idx, 1)[0];
    this.emit('prefixRule:removed', removed);
    return true;
  }

  /** List all prefix rules. */
  getPrefixRules(): PrefixRule[] {
    return [...this.prefixRules];
  }

  /**
   * Evaluate argv token array — combines prefix rules + regex/glob rules.
   * Prefix rules are checked first (longest-match wins).
   */
  evaluateArgv(argv: string[], workDir: string = process.cwd()): PolicyEvaluation {
    const command = argv[0] ?? '';
    const args = argv.slice(1);

    // 1. Prefix rules (token-array, most specific)
    const prefixMatch = this.checkPrefix(argv);
    if (prefixMatch) {
      const evaluation: PolicyEvaluation = {
        command,
        args,
        workDir,
        matchedRule: null,
        action: prefixMatch.action,
        reason: `Matched prefix rule: ${prefixMatch.prefix.join(' ')}${prefixMatch.description ? ' — ' + prefixMatch.description : ''}`,
        constraints: {},
        timestamp: Date.now(),
      };
      this.recordAudit(evaluation);
      return evaluation;
    }

    // 2. Fall through to pattern-based evaluation
    return this.evaluate(command, args, workDir);
  }

  /**
   * Evaluate a complete shell expression, not just its first binary.
   *
   * Every AST segment is checked independently. Unknown commands and shell
   * constructs with write redirections/substitutions are confined to the OS
   * sandbox; explicit prompts and denials remain stronger.
   */
  evaluateShellCommand(shellCommand: string, workDir: string = process.cwd()): ShellPolicyEvaluation {
    const parsed = parseBashCommand(shellCommand);
    const parsedSegments: string[][] = [];
    const segmentEvaluations: PolicyEvaluation[] = [];

    for (const segment of parsed.commands) {
      const normalizedCommand = this.normalizeCommandName(segment.command);
      const argv = [normalizedCommand, ...segment.args];
      parsedSegments.push(argv);
      segmentEvaluations.push(this.evaluateArgv(argv, workDir));
    }

    if (segmentEvaluations.length === 0) {
      const fallback = this.makeEvaluation(
        '',
        [],
        workDir,
        'ask',
        'Shell command could not be parsed safely',
      );
      return {
        ...fallback,
        parsedSegments,
        segmentEvaluations,
        complex: true,
        approvalKey: this.buildApprovalKey(shellCommand, workDir, parsedSegments),
      };
    }

    const complex = parsed.warnings.length > 0 || this.hasComplexShellSyntax(shellCommand);
    const hasWriteRedirection = this.hasUnquotedWriteRedirection(shellCommand);

    const ordered = [...segmentEvaluations].sort(
      (a, b) => this.actionRank(b.action) - this.actionRank(a.action),
    );
    const strongest = ordered[0] ?? segmentEvaluations[0];
    let action = strongest?.action ?? 'ask';
    let reason = strongest?.reason ?? 'No policy decision';

    if ((complex || hasWriteRedirection) && this.actionRank(action) < this.actionRank('sandbox')) {
      action = 'sandbox';
      reason = complex
        ? 'Complex shell syntax requires workspace sandboxing'
        : 'Output redirection requires workspace sandboxing';
    }

    const result: ShellPolicyEvaluation = {
      command: strongest?.command ?? '',
      args: strongest?.args ?? [],
      workDir,
      matchedRule: strongest?.matchedRule ?? null,
      action,
      reason,
      constraints: strongest?.constraints ?? {},
      timestamp: Date.now(),
      parsedSegments,
      segmentEvaluations,
      complex,
      approvalKey: this.buildApprovalKey(shellCommand, workDir, parsedSegments),
    };
    this.recordAudit(result);
    return result;
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
    const savePath = filePath || this.config.rulesPath || path.join(os.homedir(), '.codebuddy', 'execpolicy.json');

    // Ensure directory exists
    const dir = path.dirname(savePath);
    await fs.promises.mkdir(dir, { recursive: true });

    const document = {
      version: 2,
      rules: this.getRules(false),
      prefixRules: this.getPrefixRules(),
    };
    const temporaryPath = `${savePath}.tmp-${process.pid}-${Date.now()}`;
    await fs.promises.writeFile(temporaryPath, JSON.stringify(document, null, 2), {
      encoding: 'utf-8',
      mode: 0o600,
    });
    await fs.promises.rename(temporaryPath, savePath);
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

  /** `deny > ask > sandbox > allow` — the shared aggregation order. */
  private actionRank(action: PolicyAction): number {
    switch (action) {
      case 'deny': return 4;
      case 'ask': return 3;
      case 'sandbox': return 2;
      case 'allow': return 1;
    }
  }

  private makeEvaluation(
    command: string,
    args: string[],
    workDir: string,
    action: PolicyAction,
    reason: string,
  ): PolicyEvaluation {
    return {
      command,
      args,
      workDir,
      matchedRule: null,
      action,
      reason,
      constraints: {},
      timestamp: Date.now(),
    };
  }

  /**
   * Match well-known system binary paths by basename, but never reinterpret an
   * arbitrary executable such as `/tmp/git` as the trusted `git` command.
   */
  private normalizeCommandName(command: string): string {
    if (!command.includes('/') && !command.includes('\\')) return command;
    const normalized = command.replace(/\\/g, '/');
    const trustedPrefixes = ['/bin/', '/usr/bin/', '/usr/local/bin/', '/sbin/', '/usr/sbin/'];
    if (trustedPrefixes.some((prefix) => normalized.startsWith(prefix))) {
      return path.posix.basename(normalized);
    }
    return normalized;
  }

  /** Detect substitutions/control structures that must never inherit a broad allow. */
  private hasComplexShellSyntax(command: string): boolean {
    let quote: 'none' | 'single' | 'double' = 'none';
    let escaped = false;
    for (let i = 0; i < command.length; i += 1) {
      const char = command[i];
      const next = command[i + 1];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === "'" && quote !== 'double') {
        quote = quote === 'single' ? 'none' : 'single';
        continue;
      }
      if (char === '"' && quote !== 'single') {
        quote = quote === 'double' ? 'none' : 'double';
        continue;
      }
      if (quote === 'single') continue;
      if (char === '`') return true;
      if (char === '$' && next === '(') return true;
      if ((char === '<' || char === '>') && next === '(') return true;
      if (char === '<' && next === '<') return true;
      if (char === '\n' || char === '\r') return true;
    }
    return quote !== 'none';
  }

  /** Detect unquoted `>`, `>>` and `&>` while ignoring descriptor duplication (`2>&1`). */
  private hasUnquotedWriteRedirection(command: string): boolean {
    let quote: 'none' | 'single' | 'double' = 'none';
    let escaped = false;
    for (let i = 0; i < command.length; i += 1) {
      const char = command[i];
      const next = command[i + 1];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === "'" && quote !== 'double') {
        quote = quote === 'single' ? 'none' : 'single';
        continue;
      }
      if (char === '"' && quote !== 'single') {
        quote = quote === 'double' ? 'none' : 'double';
        continue;
      }
      if (quote !== 'none') continue;
      if (char === '&' && next === '>') return true;
      if (char === '>' && next !== '&' && next !== '(') return true;
    }
    return false;
  }

  private buildApprovalKey(command: string, workDir: string, segments: string[][]): string {
    const canonicalCwd = path.resolve(workDir);
    const digest = createHash('sha256')
      .update(JSON.stringify({ cwd: canonicalCwd, command: command.trim(), segments }))
      .digest('hex');
    return `shell:${digest}`;
  }

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
        const parsed = JSON.parse(content) as
          | PolicyRule[]
          | { rules?: PolicyRule[]; prefixRules?: PrefixRule[] };
        const customRules = Array.isArray(parsed) ? parsed : (parsed.rules ?? []);
        const prefixRules = Array.isArray(parsed) ? [] : (parsed.prefixRules ?? []);

        for (const rule of customRules) {
          if (rule && typeof rule.pattern === 'string' && !rule.tags?.includes('builtin')) {
            this.rules.push(rule);
          }
        }
        for (const rule of prefixRules) {
          if (
            rule &&
            Array.isArray(rule.prefix) &&
            rule.prefix.length > 0 &&
            !(rule.prefix.length === 1 && UNSAFE_BARE_PREFIXES.has(rule.prefix[0] ?? '')) &&
            ['allow', 'deny', 'ask', 'sandbox'].includes(rule.action)
          ) {
            this.prefixRules.push(rule);
          }
        }
      }
    } catch (error) {
      // EventEmitter treats the literal `error` event as fatal when no listener
      // is registered. A malformed/missing optional policy file must degrade to
      // built-ins, not crash command execution.
      this.emit('load:error', { type: 'load', error });
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
