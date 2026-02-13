/**
 * Security patterns and constants for BashTool command validation.
 *
 * Contains:
 * - BLOCKED_PATTERNS: Regex patterns for always-blocked commands
 * - BLOCKED_CONTROL_CHARS: Control characters that are never allowed
 * - ANSI_ESCAPE_PATTERN: Terminal manipulation sequences
 * - ALLOWED_COMMANDS: Allowlist for strict mode (reserved)
 * - BLOCKED_COMMANDS: Commands blocked even in non-strict mode
 * - SAFE_ENV_VARS: Allowlist of environment variables for child processes
 * - BLOCKED_PATHS: Sensitive paths that should never be accessed
 */

import path from 'path';
import os from 'os';

/**
 * Dangerous command patterns that are always blocked
 */
export const BLOCKED_PATTERNS: RegExp[] = [
  // Filesystem destruction
  /rm\s+(-rf?|--recursive)\s+[/~]/i,  // rm -rf / or ~
  /rm\s+.*\/\s*$/i,                      // rm something/
  />\s*\/dev\/sd[a-z]/i,                 // Write to disk device
  /dd\s+.*if=.*of=\/dev/i,              // dd to device
  /mkfs/i,                               // Format filesystem
  /:\(\)\s*\{\s*:\|:&\s*\};:/,          // Fork bomb :(){ :|:& };:
  /chmod\s+-R\s+777\s+\//i,             // chmod 777 /

  // Remote code execution via pipe to shell
  /wget.*\|\s*(ba)?sh/i,                // wget | sh
  /curl.*\|\s*(ba)?sh/i,                // curl | sh
  /sudo\s+(rm|dd|mkfs)/i,               // sudo dangerous commands

  // Command injection via command substitution
  /\$\([^)]*(?:rm|dd|mkfs|chmod|chown|curl|wget|nc|netcat|bash|sh|eval|exec)/i,  // $(dangerous_cmd)
  /`[^`]*(?:rm|dd|mkfs|chmod|chown|curl|wget|nc|netcat|bash|sh|eval|exec)/i,     // `dangerous_cmd`

  // Dangerous variable expansion that could leak secrets
  /\$\{?(?:GROK_API_KEY|AWS_SECRET|AWS_ACCESS_KEY|AWS_SESSION_TOKEN|GITHUB_TOKEN|NPM_TOKEN|MORPH_API_KEY|DATABASE_URL|DB_PASSWORD|SECRET_KEY|PRIVATE_KEY|API_KEY|API_SECRET|AUTH_TOKEN|ACCESS_TOKEN|OPENAI_API_KEY|ANTHROPIC_API_KEY|SLACK_TOKEN|DISCORD_TOKEN)\}?/i,

  // Eval and exec injection
  /\beval\s+.*\$/i,                      // eval with variable expansion
  /\bexec\s+\d*[<>]/i,                   // exec with redirections

  // Hex/octal encoded dangerous commands (bypass attempts)
  /\\x[0-9a-f]{2}/i,                     // Hex escape sequences
  /\\[0-7]{3}/,                          // Octal escape sequences
  /\$'\\x/i,                             // ANSI-C quoting with hex
  /\$'\\[0-7]/,                          // ANSI-C quoting with octal
  /\$'[^']*\\[nrtbfv]/i,                 // ANSI-C with escape sequences

  // Base64 decode piped to shell
  /base64\s+(-d|--decode).*\|\s*(ba)?sh/i,

  // Network exfiltration patterns
  /\|\s*(nc|netcat|curl|wget)\s+[^|]*(>|>>)/i,  // pipe to network tool with redirect
  />\s*\/dev\/(tcp|udp)\//i,             // bash network redirection
  /\bnc\s+-[elp]/i,                      // netcat listen/exec modes
  /\bbash\s+-i\s+>&?\s*\/dev\/(tcp|udp)/i, // bash reverse shell

  // Additional bypass patterns
  /\bprintf\s+['"]%b['"].*\\x/i,         // printf %b with hex (bypass)
  /\becho\s+-e\s+.*\\x/i,                // echo -e with hex
  /\becho\s+\$'\\x/i,                    // echo with ANSI-C quoting
  /\bxxd\s+-r.*\|\s*(ba)?sh/i,           // xxd decode to shell
  /\bpython[23]?\s+-c\s+['"].*(?:exec|eval|os\.system|subprocess|__import__)/i, // Python code exec
  /\bperl\s+-e\s+['"].*(?:system|exec|`)/i, // Perl code exec
  /\bruby\s+-e\s+['"].*(?:system|exec|`)/i, // Ruby code exec
  /\bnode\s+-e\s+['"].*(?:exec|spawn|child_process)/i, // Node.js code exec
  /\bawk\s+.*\bsystem\s*\(/i,            // awk system() call

  // Unicode/special character bypass attempts
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u001f]/,                     // Control characters (except common whitespace handled separately)
  /[\u007f-\u009f]/,                     // Delete and C1 control codes
  /[\u200b-\u200f]/,                     // Zero-width and directional chars
  /[\u2028\u2029]/,                      // Line/paragraph separators
  /[\ufeff]/,                            // BOM
  /[\ufff0-\uffff]/,                     // Specials block
];

/**
 * Control characters that are never allowed in commands
 * These could be used to manipulate terminal output or bypass validation
 */
// eslint-disable-next-line no-control-regex
export const BLOCKED_CONTROL_CHARS: RegExp = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;

/**
 * ANSI escape sequences that could manipulate terminal display
 */
// eslint-disable-next-line no-control-regex
export const ANSI_ESCAPE_PATTERN: RegExp = /\x1b\[[0-9;]*[a-zA-Z]|\x1b[PX^_][^\x1b]*\x1b\\|\x1b\][^\x07]*\x07/;

/**
 * Allowlist of safe base commands
 * Only commands starting with these are allowed in strict mode
 * Reserved for future strict mode implementation
 */
export const _ALLOWED_COMMANDS: Set<string> = new Set([
  // File operations (read-only or safe)
  'ls', 'cat', 'head', 'tail', 'less', 'more', 'file', 'stat', 'wc',
  'find', 'locate', 'which', 'whereis', 'type',
  // Text processing
  'grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack',
  'sed', 'awk', 'cut', 'sort', 'uniq', 'tr', 'diff', 'comm',
  // Development tools
  'git', 'npm', 'npx', 'yarn', 'pnpm', 'bun',
  'node', 'deno', 'python', 'python3', 'pip', 'pip3',
  'cargo', 'rustc', 'go', 'java', 'javac', 'mvn', 'gradle',
  'make', 'cmake', 'gcc', 'g++', 'clang',
  // Build and test
  'jest', 'vitest', 'mocha', 'pytest', 'tsc', 'esbuild', 'vite', 'webpack',
  'eslint', 'prettier', 'biome',
  // System info (safe read-only)
  'echo', 'printf', 'pwd', 'date', 'whoami', 'hostname', 'uname',
  'env', 'printenv', 'id', 'groups',
  // Process info
  'ps', 'top', 'htop', 'pgrep',
  // Network diagnostics (read-only)
  'ping', 'dig', 'nslookup', 'host',
  // Archives (read operations)
  'tar', 'zip', 'unzip', 'gzip', 'gunzip', 'bzip2', 'xz',
  // Directory operations
  'mkdir', 'rmdir', 'cd',
  // Safe file operations
  'cp', 'mv', 'touch', 'ln',
  // Docker (controlled)
  'docker', 'docker-compose', 'podman',
  // Kubernetes (controlled)
  'kubectl', 'helm',
  // Cloud CLI (controlled)
  'aws', 'gcloud', 'az',
  // Misc safe commands
  'jq', 'yq', 'tree', 'realpath', 'basename', 'dirname',
  'sleep', 'true', 'false', 'test', '[',
  // Package managers
  'apt', 'apt-get', 'brew', 'dnf', 'yum', 'pacman',
]);

/**
 * Commands that should be completely blocked even in non-strict mode
 */
export const BLOCKED_COMMANDS: Set<string> = new Set([
  'rm', 'shred', 'wipefs',           // Destructive file operations (blocked without confirmation path)
  'mkfs', 'fdisk', 'parted',         // Disk operations
  'dd',                               // Raw disk operations
  'chmod', 'chown', 'chgrp',         // Permission changes (blocked at base level)
  'sudo', 'su', 'doas',              // Privilege escalation
  'nc', 'netcat', 'ncat',            // Network tools that can be dangerous
  'socat',                            // Socket relay
  'telnet', 'ftp',                   // Insecure protocols
  'nmap', 'masscan',                 // Port scanning
  'tcpdump', 'wireshark', 'tshark', // Packet capture
  'strace', 'ltrace', 'ptrace',     // Process tracing
  'gdb', 'lldb',                     // Debuggers (can be abused)
  'reboot', 'shutdown', 'poweroff', 'halt', // System control
  'init', 'systemctl', 'service',   // Service control
  'iptables', 'nft', 'firewall-cmd', // Firewall
  'mount', 'umount',                 // Mount operations
  'insmod', 'rmmod', 'modprobe',    // Kernel modules
  'sysctl',                          // Kernel parameters
  'crontab', 'at',                   // Scheduled tasks
  'useradd', 'userdel', 'usermod',  // User management
  'passwd', 'chpasswd',              // Password changes
  'visudo',                          // Sudoers editing
  'ssh-keygen', 'ssh-add',          // SSH key operations
  'gpg',                             // GPG operations
  'openssl',                         // Certificate operations (can leak keys)
]);

/**
 * Whitelist of safe environment variables to pass to child processes
 * All other env vars (especially secrets) are filtered out
 */
export const SAFE_ENV_VARS: Set<string> = new Set([
  // System paths and locale
  'PATH',
  'HOME',
  'USER',
  'SHELL',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TERM',
  'TZ',
  'TMPDIR',
  'TEMP',
  'TMP',
  // Node.js
  'NODE_ENV',
  'NODE_PATH',
  'NODE_OPTIONS',
  // Development tools
  'EDITOR',
  'VISUAL',
  'PAGER',
  'LESS',
  // Git (non-sensitive)
  'GIT_AUTHOR_NAME',
  'GIT_AUTHOR_EMAIL',
  'GIT_COMMITTER_NAME',
  'GIT_COMMITTER_EMAIL',
  'GIT_TERMINAL_PROMPT',
  // CI/CD flags (non-sensitive)
  'CI',
  'CONTINUOUS_INTEGRATION',
  // Display
  'DISPLAY',
  'COLORTERM',
  // Python
  'PYTHONPATH',
  'PYTHONIOENCODING',
  'VIRTUAL_ENV',
  // Package managers (non-sensitive config)
  'NPM_CONFIG_YES',
  'YARN_ENABLE_PROGRESS_BARS',
  'DEBIAN_FRONTEND',
  // History control
  'HISTFILE',
  'HISTSIZE',
  // Output control
  'NO_COLOR',
  'FORCE_COLOR',
  'NO_TTY',
  // Current working directory
  'PWD',
  'OLDPWD',
]);

/**
 * Paths that should never be accessed
 */
export const BLOCKED_PATHS: string[] = [
  path.join(os.homedir(), '.ssh'),
  path.join(os.homedir(), '.gnupg'),
  path.join(os.homedir(), '.aws'),
  path.join(os.homedir(), '.docker'),
  path.join(os.homedir(), '.npmrc'),
  path.join(os.homedir(), '.gitconfig'),
  path.join(os.homedir(), '.netrc'),
  path.join(os.homedir(), '.env'),
  path.join(os.homedir(), '.config/gh'),
  path.join(os.homedir(), '.config/gcloud'),
  path.join(os.homedir(), '.kube'),
  '/etc/passwd',
  '/etc/shadow',
  '/etc/sudoers',
];
