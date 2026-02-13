/**
 * Centralized Dangerous Patterns Registry
 *
 * Single source of truth for all dangerous pattern detection across:
 * - Bash command validation (bash tool, command-validator)
 * - Skill scanner (static analysis of SKILL.md files)
 * - Input validators (validators.ts)
 * - Bash parser (containsDangerousCommand)
 * - Code validator (generated code checks)
 *
 * Consolidates patterns previously scattered across 4+ files.
 */

export type PatternSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type PatternCategory =
  | 'filesystem_destruction'
  | 'remote_code_execution'
  | 'command_injection'
  | 'privilege_escalation'
  | 'network_exfiltration'
  | 'encoding_bypass'
  | 'code_execution'
  | 'dynamic_import'
  | 'prototype_pollution'
  | 'secret_exposure'
  | 'shell_injection'
  | 'system_control'
  | 'credential_access';

export interface DangerousPattern {
  /** Regex to match */
  pattern: RegExp;
  /** Severity level */
  severity: PatternSeverity;
  /** Human-readable description */
  description: string;
  /** Short identifier */
  name: string;
  /** Classification category */
  category: PatternCategory;
  /** Which subsystems use this pattern */
  appliesTo: Array<'bash' | 'skill' | 'code' | 'command'>;
}

// ============================================================================
// Dangerous Commands (for parsed command name matching)
// ============================================================================

/**
 * Commands that are always dangerous regardless of arguments.
 * Used by bash-parser's containsDangerousCommand() and bash tool's BLOCKED_COMMANDS.
 */
export const DANGEROUS_COMMANDS: ReadonlySet<string> = new Set([
  // Destructive file operations
  'rm', 'shred', 'wipefs', 'rmdir',
  // Disk operations
  'mkfs', 'fdisk', 'parted', 'dd',
  // Permission changes
  'chmod', 'chown', 'chgrp',
  // Privilege escalation
  'sudo', 'su', 'doas',
  // Network tools (dangerous modes)
  'nc', 'netcat', 'ncat', 'socat',
  // Insecure protocols
  'telnet', 'ftp',
  // Port scanning / packet capture
  'nmap', 'masscan', 'tcpdump', 'wireshark', 'tshark',
  // Process tracing / debugging
  'strace', 'ltrace', 'ptrace', 'gdb', 'lldb',
  // System control
  'reboot', 'shutdown', 'poweroff', 'halt',
  'init', 'systemctl', 'service',
  // Firewall
  'iptables', 'ip6tables', 'nft', 'firewall-cmd',
  // Mount operations
  'mount', 'umount',
  // Kernel modules
  'insmod', 'rmmod', 'modprobe', 'sysctl',
  // Scheduled tasks
  'crontab', 'at',
  // User management
  'useradd', 'userdel', 'usermod', 'groupadd',
  'passwd', 'chpasswd', 'visudo',
  // SSH / GPG / certs
  'ssh-keygen', 'ssh-add', 'gpg', 'openssl',
  // Kill (process control)
  'kill', 'killall', 'pkill',
]);

// ============================================================================
// Dangerous Bash Patterns (regex-based, for full command strings)
// ============================================================================

/**
 * Patterns that should block command execution.
 * Merged from bash tool's BLOCKED_PATTERNS + validators DANGEROUS_COMMAND_PATTERNS.
 */
export const DANGEROUS_BASH_PATTERNS: DangerousPattern[] = [
  // --- Filesystem destruction ---
  { pattern: /rm\s+(-rf?|--recursive)\s+[/~]/i, severity: 'critical', description: 'Recursive force delete from root or home', name: 'rm-rf-root', category: 'filesystem_destruction', appliesTo: ['bash', 'command'] },
  { pattern: /rm\s+.*\/\s*$/i, severity: 'high', description: 'Delete ending with directory path', name: 'rm-dir-path', category: 'filesystem_destruction', appliesTo: ['bash', 'command'] },
  { pattern: />\s*\/dev\/sd[a-z]/i, severity: 'critical', description: 'Write to disk device', name: 'write-disk-device', category: 'filesystem_destruction', appliesTo: ['bash', 'command'] },
  { pattern: /dd\s+.*if=.*of=\/dev/i, severity: 'critical', description: 'dd to disk device', name: 'dd-device', category: 'filesystem_destruction', appliesTo: ['bash', 'command'] },
  { pattern: /mkfs/i, severity: 'critical', description: 'Format filesystem', name: 'mkfs', category: 'filesystem_destruction', appliesTo: ['bash', 'command'] },
  { pattern: /:\(\)\s*\{\s*:\|:&\s*\};:/, severity: 'critical', description: 'Fork bomb', name: 'fork-bomb', category: 'filesystem_destruction', appliesTo: ['bash', 'command'] },
  { pattern: /chmod\s+-R\s+777\s+\//i, severity: 'critical', description: 'chmod 777 on root', name: 'chmod-777-root', category: 'filesystem_destruction', appliesTo: ['bash', 'command'] },
  { pattern: />\s*\/etc\/(passwd|shadow|sudoers)/i, severity: 'critical', description: 'Overwrite system files', name: 'overwrite-sys-files', category: 'filesystem_destruction', appliesTo: ['bash', 'command'] },

  // --- Remote code execution via pipe to shell ---
  { pattern: /wget.*\|\s*(ba)?sh/i, severity: 'critical', description: 'wget | sh (remote code execution)', name: 'wget-pipe-sh', category: 'remote_code_execution', appliesTo: ['bash', 'command'] },
  { pattern: /curl.*\|\s*(ba)?sh/i, severity: 'critical', description: 'curl | sh (remote code execution)', name: 'curl-pipe-sh', category: 'remote_code_execution', appliesTo: ['bash', 'command'] },
  { pattern: /sudo\s+(rm|dd|mkfs)/i, severity: 'critical', description: 'Sudo with dangerous command', name: 'sudo-dangerous', category: 'privilege_escalation', appliesTo: ['bash', 'command'] },

  // --- Command injection via substitution ---
  { pattern: /\$\([^)]*(?:rm|dd|mkfs|chmod|chown|curl|wget|nc|netcat|bash|sh|eval|exec)/i, severity: 'high', description: 'Dangerous command in $() substitution', name: 'subst-dangerous', category: 'command_injection', appliesTo: ['bash'] },
  { pattern: /`[^`]*(?:rm|dd|mkfs|chmod|chown|curl|wget|nc|netcat|bash|sh|eval|exec)/i, severity: 'high', description: 'Dangerous command in backtick substitution', name: 'backtick-dangerous', category: 'command_injection', appliesTo: ['bash'] },

  // --- Secret variable expansion ---
  { pattern: /\$\{?(?:GROK_API_KEY|AWS_SECRET|AWS_ACCESS_KEY|AWS_SESSION_TOKEN|GITHUB_TOKEN|NPM_TOKEN|MORPH_API_KEY|DATABASE_URL|DB_PASSWORD|SECRET_KEY|PRIVATE_KEY|API_KEY|API_SECRET|AUTH_TOKEN|ACCESS_TOKEN|OPENAI_API_KEY|ANTHROPIC_API_KEY|SLACK_TOKEN|DISCORD_TOKEN)\}?/i, severity: 'high', description: 'Secret variable expansion', name: 'secret-var-expand', category: 'secret_exposure', appliesTo: ['bash'] },

  // --- Eval and exec injection ---
  { pattern: /\beval\s+.*\$/i, severity: 'high', description: 'eval with variable expansion', name: 'eval-var', category: 'code_execution', appliesTo: ['bash', 'command'] },
  { pattern: /\bexec\s+\d*[<>]/i, severity: 'high', description: 'exec with redirections', name: 'exec-redirect', category: 'code_execution', appliesTo: ['bash', 'command'] },

  // --- Encoding bypass attempts ---
  { pattern: /\\x[0-9a-f]{2}/i, severity: 'high', description: 'Hex escape sequences', name: 'hex-escape', category: 'encoding_bypass', appliesTo: ['bash'] },
  { pattern: /\\[0-7]{3}/, severity: 'high', description: 'Octal escape sequences', name: 'octal-escape', category: 'encoding_bypass', appliesTo: ['bash'] },
  { pattern: /\$'\\x/i, severity: 'high', description: 'ANSI-C quoting with hex', name: 'ansi-c-hex', category: 'encoding_bypass', appliesTo: ['bash'] },
  { pattern: /\$'\\[0-7]/, severity: 'high', description: 'ANSI-C quoting with octal', name: 'ansi-c-octal', category: 'encoding_bypass', appliesTo: ['bash'] },
  { pattern: /\$'[^']*\\[nrtbfv]/i, severity: 'medium', description: 'ANSI-C with special escape sequences', name: 'ansi-c-special', category: 'encoding_bypass', appliesTo: ['bash'] },
  { pattern: /base64\s+(-d|--decode).*\|\s*(ba)?sh/i, severity: 'critical', description: 'Base64 decode piped to shell', name: 'base64-pipe-sh', category: 'encoding_bypass', appliesTo: ['bash', 'command'] },

  // --- Network exfiltration ---
  { pattern: /\|\s*(nc|netcat|curl|wget)\s+[^|]*(>|>>)/i, severity: 'high', description: 'Pipe to network tool with redirect', name: 'net-redirect', category: 'network_exfiltration', appliesTo: ['bash'] },
  { pattern: />\s*\/dev\/(tcp|udp)\//i, severity: 'critical', description: 'Bash network redirection', name: 'dev-tcp', category: 'network_exfiltration', appliesTo: ['bash'] },
  { pattern: /\bnc\s+-[elp]/i, severity: 'high', description: 'Netcat listen/exec modes', name: 'nc-listen', category: 'network_exfiltration', appliesTo: ['bash'] },
  { pattern: /\bbash\s+-i\s+>&?\s*\/dev\/(tcp|udp)/i, severity: 'critical', description: 'Bash reverse shell', name: 'bash-reverse-shell', category: 'network_exfiltration', appliesTo: ['bash'] },
  { pattern: /nc\s+.*-e\s+.*sh/i, severity: 'critical', description: 'Netcat reverse shell', name: 'nc-reverse-shell', category: 'network_exfiltration', appliesTo: ['bash', 'command'] },

  // --- Additional bypass patterns ---
  { pattern: /\bprintf\s+['"]%b['"].*\\x/i, severity: 'high', description: 'printf %b with hex (bypass attempt)', name: 'printf-hex', category: 'encoding_bypass', appliesTo: ['bash'] },
  { pattern: /\becho\s+-e\s+.*\\x/i, severity: 'high', description: 'echo -e with hex', name: 'echo-hex', category: 'encoding_bypass', appliesTo: ['bash'] },
  { pattern: /\becho\s+\$'\\x/i, severity: 'high', description: 'echo with ANSI-C quoting', name: 'echo-ansi', category: 'encoding_bypass', appliesTo: ['bash'] },
  { pattern: /\bxxd\s+-r.*\|\s*(ba)?sh/i, severity: 'critical', description: 'xxd decode to shell', name: 'xxd-pipe-sh', category: 'encoding_bypass', appliesTo: ['bash'] },
  { pattern: /\bpython[23]?\s+-c\s+['"].*(?:exec|eval|os\.system|subprocess|__import__)/i, severity: 'high', description: 'Python code execution', name: 'python-exec', category: 'code_execution', appliesTo: ['bash'] },
  { pattern: /\bperl\s+-e\s+['"].*(?:system|exec|`)/i, severity: 'high', description: 'Perl code execution', name: 'perl-exec', category: 'code_execution', appliesTo: ['bash'] },
  { pattern: /\bruby\s+-e\s+['"].*(?:system|exec|`)/i, severity: 'high', description: 'Ruby code execution', name: 'ruby-exec', category: 'code_execution', appliesTo: ['bash'] },
  { pattern: /\bnode\s+-e\s+['"].*(?:exec|spawn|child_process)/i, severity: 'high', description: 'Node.js code execution', name: 'node-exec', category: 'code_execution', appliesTo: ['bash'] },
  { pattern: /\bawk\s+.*\bsystem\s*\(/i, severity: 'high', description: 'awk system() call', name: 'awk-system', category: 'code_execution', appliesTo: ['bash'] },
  { pattern: /\bsed\s+.*e\b/i, severity: 'medium', description: 'sed with e flag (exec)', name: 'sed-exec', category: 'code_execution', appliesTo: ['bash'] },
];

// ============================================================================
// Code Scanning Patterns (for skill files and generated code)
// ============================================================================

/**
 * Patterns for scanning code content (skill files, LLM output).
 * Merged from skill-scanner's DANGEROUS_PATTERNS + new additions.
 */
export const DANGEROUS_CODE_PATTERNS: DangerousPattern[] = [
  // --- Code execution ---
  { pattern: /\beval\s*\(/, severity: 'critical', description: 'Dynamic code execution via eval()', name: 'eval', category: 'code_execution', appliesTo: ['skill', 'code'] },
  { pattern: /\bnew\s+Function\s*\(/, severity: 'critical', description: 'Dynamic function creation', name: 'new-function', category: 'code_execution', appliesTo: ['skill', 'code'] },
  { pattern: /\bchild_process\b/, severity: 'high', description: 'Child process module usage', name: 'child_process', category: 'code_execution', appliesTo: ['skill', 'code'] },
  { pattern: /\bexecSync\s*\(/, severity: 'high', description: 'Synchronous command execution', name: 'execSync', category: 'code_execution', appliesTo: ['skill', 'code'] },
  { pattern: /\bexecFile\s*\(/, severity: 'high', description: 'File execution', name: 'execFile', category: 'code_execution', appliesTo: ['skill', 'code'] },
  { pattern: /\bspawn\s*\(/, severity: 'medium', description: 'Process spawning', name: 'spawn', category: 'code_execution', appliesTo: ['skill', 'code'] },
  { pattern: /\bexec\s*\(/, severity: 'high', description: 'Command execution', name: 'exec', category: 'code_execution', appliesTo: ['skill', 'code'] },

  // --- Filesystem dangers ---
  { pattern: /\brm\s+-rf\b/, severity: 'critical', description: 'Recursive force delete', name: 'rm-rf', category: 'filesystem_destruction', appliesTo: ['skill', 'code'] },
  { pattern: /\bunlinkSync\s*\(/, severity: 'medium', description: 'Synchronous file deletion', name: 'unlinkSync', category: 'filesystem_destruction', appliesTo: ['skill', 'code'] },
  { pattern: /\bwriteFileSync\s*\(/, severity: 'low', description: 'Synchronous file write', name: 'writeFileSync', category: 'filesystem_destruction', appliesTo: ['skill'] },
  { pattern: /\brmdirSync\s*\(/, severity: 'medium', description: 'Directory removal', name: 'rmdirSync', category: 'filesystem_destruction', appliesTo: ['skill', 'code'] },

  // --- Network ---
  { pattern: /\bfetch\s*\(\s*['"`]http/, severity: 'medium', description: 'External HTTP request', name: 'fetch-http', category: 'network_exfiltration', appliesTo: ['skill'] },
  { pattern: /\baxios\b/, severity: 'low', description: 'HTTP client library usage', name: 'axios', category: 'network_exfiltration', appliesTo: ['skill'] },
  { pattern: /\brequire\s*\(\s*['"`]https?['"`]\s*\)/, severity: 'medium', description: 'HTTP module import', name: 'http-require', category: 'network_exfiltration', appliesTo: ['skill'] },
  { pattern: /\bWebSocket\b/, severity: 'medium', description: 'WebSocket usage', name: 'websocket', category: 'network_exfiltration', appliesTo: ['skill'] },

  // --- Dynamic imports ---
  { pattern: /\brequire\s*\(\s*[a-zA-Z_$\[]/, severity: 'high', description: 'Dynamic require with variable', name: 'dynamic-require', category: 'dynamic_import', appliesTo: ['skill', 'code'] },
  { pattern: /\bimport\s*\(\s*[a-zA-Z_$\[]/, severity: 'high', description: 'Dynamic import with variable', name: 'dynamic-import', category: 'dynamic_import', appliesTo: ['skill', 'code'] },

  // --- Environment/secrets ---
  { pattern: /process\.env\[/, severity: 'low', description: 'Dynamic environment variable access', name: 'env-dynamic', category: 'secret_exposure', appliesTo: ['skill'] },
  { pattern: /\b(API_KEY|SECRET|PASSWORD|TOKEN)\b/i, severity: 'info', description: 'Possible secret reference', name: 'secret-ref', category: 'secret_exposure', appliesTo: ['skill'] },

  // --- Prototype pollution ---
  { pattern: /__proto__/, severity: 'high', description: 'Prototype pollution risk', name: 'proto', category: 'prototype_pollution', appliesTo: ['skill', 'code'] },
  { pattern: /\bconstructor\s*\[/, severity: 'high', description: 'Constructor access via bracket notation', name: 'constructor-bracket', category: 'prototype_pollution', appliesTo: ['skill', 'code'] },

  // --- Shell injection in code ---
  { pattern: /`\$\{.*\}`/, severity: 'medium', description: 'Template literal with interpolation (potential injection)', name: 'template-injection', category: 'shell_injection', appliesTo: ['skill', 'code'] },
  { pattern: /\$\(.*\)/, severity: 'medium', description: 'Shell command substitution', name: 'shell-subst', category: 'shell_injection', appliesTo: ['skill'] },

  // --- SQL injection patterns (for generated code) ---
  { pattern: /['"`]\s*\+\s*\w+\s*\+\s*['"`].*(?:SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\b/i, severity: 'high', description: 'SQL string concatenation (injection risk)', name: 'sql-concat', category: 'command_injection', appliesTo: ['code'] },
  { pattern: /\b(?:query|execute|exec)\s*\(\s*['"`].*\$\{/i, severity: 'high', description: 'SQL template literal interpolation', name: 'sql-template', category: 'command_injection', appliesTo: ['code'] },
  { pattern: /\b(?:query|execute|exec)\s*\(\s*\w+\s*\+/i, severity: 'medium', description: 'SQL with string concatenation', name: 'sql-string-concat', category: 'command_injection', appliesTo: ['code'] },

  // --- XSS patterns (for generated code) ---
  { pattern: /\.innerHTML\s*=\s*(?!\s*['"`]\s*['"`])/, severity: 'high', description: 'innerHTML assignment (XSS risk)', name: 'innerHTML', category: 'command_injection', appliesTo: ['code'] },
  { pattern: /document\.write\s*\(/, severity: 'high', description: 'document.write (XSS risk)', name: 'document-write', category: 'command_injection', appliesTo: ['code'] },
  { pattern: /\bdangerouslySetInnerHTML\b/, severity: 'medium', description: 'React dangerouslySetInnerHTML', name: 'react-dangerous-html', category: 'command_injection', appliesTo: ['code'] },

  // --- Hardcoded secrets ---
  { pattern: /(?:password|passwd|pwd|secret|token|api_key|apikey)\s*[:=]\s*['"][^'"]{8,}['"]/i, severity: 'high', description: 'Hardcoded secret in code', name: 'hardcoded-secret', category: 'secret_exposure', appliesTo: ['code'] },
  { pattern: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/, severity: 'critical', description: 'Private key in code', name: 'private-key', category: 'secret_exposure', appliesTo: ['code', 'skill'] },

  // --- Unsafe deserialization ---
  { pattern: /\bpickle\.loads?\b/, severity: 'high', description: 'Python pickle deserialization', name: 'pickle-loads', category: 'code_execution', appliesTo: ['code'] },
  { pattern: /\byaml\.load\s*\((?!.*Loader)/, severity: 'medium', description: 'Unsafe YAML load (no Loader specified)', name: 'yaml-unsafe-load', category: 'code_execution', appliesTo: ['code'] },
  { pattern: /\bJSON\.parse\s*\(.*\bthen\b/, severity: 'low', description: 'JSON.parse in promise chain (may swallow errors)', name: 'json-parse-promise', category: 'code_execution', appliesTo: ['code'] },
];

// ============================================================================
// Helper functions
// ============================================================================

/**
 * Get all patterns applicable to a specific subsystem.
 */
export function getPatternsFor(subsystem: 'bash' | 'skill' | 'code' | 'command'): DangerousPattern[] {
  return [
    ...DANGEROUS_BASH_PATTERNS.filter(p => p.appliesTo.includes(subsystem)),
    ...DANGEROUS_CODE_PATTERNS.filter(p => p.appliesTo.includes(subsystem)),
  ];
}

/**
 * Get patterns at or above a given severity level.
 */
export function getPatternsBySeverity(
  minSeverity: PatternSeverity,
  patterns?: DangerousPattern[],
): DangerousPattern[] {
  const severityOrder: PatternSeverity[] = ['info', 'low', 'medium', 'high', 'critical'];
  const minIndex = severityOrder.indexOf(minSeverity);
  const source = patterns ?? [...DANGEROUS_BASH_PATTERNS, ...DANGEROUS_CODE_PATTERNS];
  return source.filter(p => severityOrder.indexOf(p.severity) >= minIndex);
}

/**
 * Get patterns by category.
 */
export function getPatternsByCategory(
  category: PatternCategory,
  patterns?: DangerousPattern[],
): DangerousPattern[] {
  const source = patterns ?? [...DANGEROUS_BASH_PATTERNS, ...DANGEROUS_CODE_PATTERNS];
  return source.filter(p => p.category === category);
}

/**
 * Check if a string matches any dangerous pattern for the given subsystem.
 * Returns the first matching pattern or null.
 */
export function matchDangerousPattern(
  text: string,
  subsystem: 'bash' | 'skill' | 'code' | 'command',
): DangerousPattern | null {
  const patterns = getPatternsFor(subsystem);
  for (const p of patterns) {
    if (p.pattern.test(text)) {
      return p;
    }
  }
  return null;
}

/**
 * Check if a string matches any dangerous patterns, returning all matches.
 */
export function matchAllDangerousPatterns(
  text: string,
  subsystem: 'bash' | 'skill' | 'code' | 'command',
): DangerousPattern[] {
  const patterns = getPatternsFor(subsystem);
  return patterns.filter(p => p.pattern.test(text));
}

/**
 * Check if a command name is in the dangerous commands set.
 */
export function isDangerousCommand(commandName: string): boolean {
  return DANGEROUS_COMMANDS.has(commandName.toLowerCase());
}
