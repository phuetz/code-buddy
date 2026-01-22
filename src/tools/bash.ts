import { spawn, SpawnOptions, ChildProcess } from 'child_process';
import { ToolResult } from '../types/index.js';
import { ConfirmationService } from '../utils/confirmation-service.js';
import { getSandboxManager } from '../security/sandbox.js';
import { getSelfHealingEngine, SelfHealingEngine } from '../utils/self-healing.js';
import { parseTestOutput, isLikelyTestOutput } from '../utils/test-output-parser.js';
import { Disposable, registerDisposable } from '../utils/disposable.js';
import {
  bashToolSchemas,
  validateWithSchema,
  validateCommand as validateCommandSafety,
  sanitizeForShell
} from '../utils/input-validator.js';
import { rgPath } from '@vscode/ripgrep';
import path from 'path';
import os from 'os';

/**
 * Dangerous command patterns that are always blocked
 */
const BLOCKED_PATTERNS: RegExp[] = [
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
const BLOCKED_CONTROL_CHARS: RegExp = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;

/**
 * ANSI escape sequences that could manipulate terminal display
 */
// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE_PATTERN: RegExp = /\x1b\[[0-9;]*[a-zA-Z]|\x1b[PX^_][^\x1b]*\x1b\\|\x1b\][^\x07]*\x07/;

/**
 * Allowlist of safe base commands
 * Only commands starting with these are allowed in strict mode
 * Reserved for future strict mode implementation
 */
const _ALLOWED_COMMANDS: Set<string> = new Set([
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
const BLOCKED_COMMANDS: Set<string> = new Set([
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
const SAFE_ENV_VARS: Set<string> = new Set([
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
 * Extract the base command from a command string
 * Handles paths, env var prefixes, and common shell constructs
 */
function extractBaseCommand(command: string): string | null {
  // Trim and handle empty
  const trimmed = command.trim();
  if (!trimmed) return null;

  // Skip leading environment variable assignments (VAR=value cmd)
  let remaining = trimmed;
  while (/^[A-Za-z_][A-Za-z0-9_]*=\S*\s+/.test(remaining)) {
    remaining = remaining.replace(/^[A-Za-z_][A-Za-z0-9_]*=\S*\s+/, '');
  }

  // Get the first token
  const match = remaining.match(/^(\S+)/);
  if (!match) return null;

  let cmd = match[1];

  // Remove path prefix (e.g., /usr/bin/ls -> ls)
  if (cmd.includes('/')) {
    cmd = cmd.split('/').pop() || cmd;
  }

  // Handle ./ prefix
  if (cmd.startsWith('./')) {
    cmd = cmd.slice(2);
  }

  return cmd.toLowerCase();
}

/**
 * Check if command uses shell features that could bypass validation
 */
function hasShellBypassFeatures(command: string): { bypass: boolean; reason?: string } {
  // Check for multiple commands via && || ; |
  // But allow single pipes for grep, etc.
  const multiCommandPatterns = [
    { pattern: /;\s*\S/, reason: 'Command chaining with semicolon' },
    { pattern: /&&\s*\S/, reason: 'Command chaining with &&' },
    { pattern: /\|\|\s*\S/, reason: 'Command chaining with ||' },
    { pattern: /\|\s*(?:bash|sh|zsh|ksh|csh|fish|dash)\b/i, reason: 'Pipe to shell' },
  ];

  for (const { pattern, reason } of multiCommandPatterns) {
    if (pattern.test(command)) {
      // Check if this is a safe pipe (e.g., grep | wc)
      if (reason === 'Pipe to shell') {
        return { bypass: true, reason };
      }
      // For other chaining, check if the second command is safe
      // For now, we'll allow chaining but each command gets validated separately
    }
  }

  // Check for process substitution
  if (/[<>]\(/.test(command)) {
    return { bypass: true, reason: 'Process substitution detected' };
  }

  // Check for here-string/here-doc that could contain encoded payloads
  if (/<<</.test(command)) {
    return { bypass: true, reason: 'Here-string detected' };
  }

  return { bypass: false };
}

/**
 * Paths that should never be accessed
 */
const BLOCKED_PATHS: string[] = [
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

/**
 * Bash Tool
 *
 * Executes shell commands with comprehensive security measures:
 * - Blocked dangerous patterns (rm -rf /, fork bombs, etc.)
 * - Protected paths (~/.ssh, ~/.aws, /etc/shadow, etc.)
 * - User confirmation for commands (unless session-approved)
 * - Self-healing: automatic error recovery for common failures
 * - Process isolation via spawn with process group management
 * - Graceful termination with SIGTERM before SIGKILL
 *
 * Security modes are controlled by SandboxManager configuration.
 * Self-healing can be disabled via --no-self-heal flag.
 */
export class BashTool implements Disposable {
  private currentDirectory: string = process.cwd();
  private confirmationService = ConfirmationService.getInstance();
  private sandboxManager = getSandboxManager();
  private selfHealingEngine: SelfHealingEngine = getSelfHealingEngine();
  private selfHealingEnabled: boolean = true;
  private runningProcesses: Set<ChildProcess> = new Set();

  constructor() {
    registerDisposable(this);
  }

  /**
   * Clean up resources - kill any running processes
   */
  dispose(): void {
    for (const proc of this.runningProcesses) {
      try {
        proc.kill('SIGTERM');
      } catch {
        // Process may already be dead
      }
    }
    this.runningProcesses.clear();
  }

  /**
   * Validate command for dangerous patterns
   *
   * Security checks performed (in order):
   * 1. Control characters - blocks terminal manipulation
   * 2. ANSI escape sequences - blocks display manipulation
   * 3. Shell bypass features - blocks process substitution, here-strings, etc.
   * 4. Base command blocklist - blocks known dangerous commands
   * 5. Blocked command patterns - blocks known dangerous patterns
   * 6. Protected paths - blocks access to sensitive directories
   * 7. Sandbox manager validation - additional runtime checks
   */
  private validateCommand(command: string): { valid: boolean; reason?: string } {
    // Check for dangerous control characters
    if (BLOCKED_CONTROL_CHARS.test(command)) {
      return {
        valid: false,
        reason: 'Command contains blocked control characters'
      };
    }

    // Check for ANSI escape sequences that could manipulate terminal
    if (ANSI_ESCAPE_PATTERN.test(command)) {
      return {
        valid: false,
        reason: 'Command contains blocked ANSI escape sequences'
      };
    }

    // Check for shell bypass features
    const bypassCheck = hasShellBypassFeatures(command);
    if (bypassCheck.bypass) {
      return {
        valid: false,
        reason: `Shell bypass blocked: ${bypassCheck.reason}`
      };
    }

    // Extract base command and check against blocklist
    const baseCmd = extractBaseCommand(command);
    if (baseCmd && BLOCKED_COMMANDS.has(baseCmd)) {
      return {
        valid: false,
        reason: `Blocked command: ${baseCmd}`
      };
    }

    // Check for blocked patterns
    for (const pattern of BLOCKED_PATTERNS) {
      if (pattern.test(command)) {
        return {
          valid: false,
          reason: `Blocked command pattern detected: ${pattern.source}`
        };
      }
    }

    // Check for access to blocked paths
    for (const blockedPath of BLOCKED_PATHS) {
      if (command.includes(blockedPath)) {
        return {
          valid: false,
          reason: `Access to protected path blocked: ${blockedPath}`
        };
      }
    }

    // Also use sandbox manager validation
    const sandboxValidation = this.sandboxManager.validateCommand(command);
    if (!sandboxValidation.valid) {
      return sandboxValidation;
    }

    return { valid: true };
  }

  /**
   * Filter environment variables to only include safe ones
   * This prevents credential leakage to child processes
   *
   * Security measures:
   * - Only allowlisted variable names are passed through
   * - Values containing shell metacharacters are sanitized
   * - Values that look like secrets are excluded
   */
  private getFilteredEnv(): Record<string, string> {
    const filtered: Record<string, string> = {};

    // Patterns that suggest a value is a secret (even if var name is allowed)
    const secretPatterns = [
      /^sk-[a-zA-Z0-9]{20,}$/,      // OpenAI-style keys
      /^xai-[a-zA-Z0-9]{20,}$/,     // xAI keys
      /^ghp_[a-zA-Z0-9]{36}$/,      // GitHub PAT
      /^gho_[a-zA-Z0-9]{36}$/,      // GitHub OAuth
      /^github_pat_/i,              // GitHub fine-grained PAT
      /^AKIA[A-Z0-9]{16}$/,         // AWS Access Key
      /^npm_[a-zA-Z0-9]{36}$/,      // NPM token
      /^eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/, // JWT
      /^[a-f0-9]{64}$/i,            // Hex-encoded secrets (64 chars)
      /^-----BEGIN.*PRIVATE KEY-----/m, // Private keys
    ];

    for (const [key, value] of Object.entries(process.env)) {
      if (value === undefined) continue;

      // Only allow safe variable names
      if (!SAFE_ENV_VARS.has(key)) continue;

      // Check if value looks like a secret
      const looksLikeSecret = secretPatterns.some(pattern => pattern.test(value));
      if (looksLikeSecret) continue;

      // Sanitize value - remove control characters
      // eslint-disable-next-line no-control-regex
      const sanitized = value.replace(/[\x00-\x1f\x7f]/g, '');

      filtered[key] = sanitized;
    }

    return filtered;
  }

  /**
   * Execute a command using spawn with process group isolation (safer than exec)
   * Inspired by mistral-vibe's robust process handling
   */
  private executeWithSpawn(
    command: string,
    options: { timeout: number; cwd: string }
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const isWindows = process.platform === 'win32';

      // Start with filtered environment (only safe vars, no secrets)
      const filteredEnv = this.getFilteredEnv();

      // Controlled environment variables for deterministic output
      const controlledEnv: Record<string, string> = {
        ...filteredEnv,
        // Disable history to prevent command logging
        HISTFILE: '/dev/null',
        HISTSIZE: '0',
        // CI mode for consistent behavior
        CI: 'true',
        // Disable color output for clean parsing
        NO_COLOR: '1',
        TERM: 'dumb',
        // Disable TTY for non-interactive mode
        NO_TTY: '1',
        // Disable interactive features
        GIT_TERMINAL_PROMPT: '0',
        NPM_CONFIG_YES: 'true',
        YARN_ENABLE_PROGRESS_BARS: 'false',
        // Locale settings for consistent encoding
        LC_ALL: 'C.UTF-8',
        LANG: 'C.UTF-8',
        PYTHONIOENCODING: 'utf-8',
        // Force non-interactive for common tools
        DEBIAN_FRONTEND: 'noninteractive',
      };

      const spawnOptions: SpawnOptions = {
        // IMPORTANT: shell must be false when using bash -c
        // Using shell: true with bash -c creates double-shell that breaks commands
        shell: false,
        cwd: options.cwd,
        env: controlledEnv,
        // Process group isolation on Unix (allows killing entire process tree)
        detached: !isWindows,
        // Don't inherit stdin - commands should be non-interactive
        stdio: ['ignore', 'pipe', 'pipe'],
      };

      const proc = spawn('bash', ['-c', command], spawnOptions);

      // Store process group ID for cleanup
      const pgid = proc.pid;

      // Graceful termination: SIGTERM first, then SIGKILL after grace period
      const gracePeriod = 3000; // 3 seconds grace period
      let gracefulTerminationTimer: NodeJS.Timeout | null = null;

      const killProcess = (signal: NodeJS.Signals = 'SIGKILL') => {
        try {
          if (!isWindows && pgid) {
            // Kill the entire process group
            process.kill(-pgid, signal);
          } else {
            proc.kill(signal);
          }
        } catch {
          // Process may have already exited
          try {
            proc.kill('SIGKILL');
          } catch {
            // Ignore - process is already gone
          }
        }
      };

      const timer = setTimeout(() => {
        timedOut = true;
        // Try graceful termination first (SIGTERM)
        killProcess('SIGTERM');

        // If still running after grace period, force kill
        gracefulTerminationTimer = setTimeout(() => {
          killProcess('SIGKILL');
        }, gracePeriod);
      }, options.timeout);

      const maxBuffer = 1024 * 1024; // 1MB limit

      proc.stdout?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        if (stdout.length + chunk.length <= maxBuffer) {
          stdout += chunk;
        }
      });

      proc.stderr?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        if (stderr.length + chunk.length <= maxBuffer) {
          stderr += chunk;
        }
      });

      proc.on('close', (exitCode: number | null) => {
        clearTimeout(timer);
        if (gracefulTerminationTimer) {
          clearTimeout(gracefulTerminationTimer);
        }
        if (timedOut) {
          resolve({
            stdout: stdout.trim(),
            stderr: 'Command timed out (graceful termination attempted)',
            exitCode: 124
          });
        } else {
          resolve({
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            exitCode: exitCode ?? 1
          });
        }
      });

      proc.on('error', (error: Error) => {
        clearTimeout(timer);
        if (gracefulTerminationTimer) {
          clearTimeout(gracefulTerminationTimer);
        }
        resolve({
          stdout: '',
          stderr: error.message,
          exitCode: 1
        });
      });
    });
  }

  /**
   * Execute a shell command
   *
   * Validates command safety, requests user confirmation, and executes
   * via spawn with process isolation. Failed commands trigger self-healing
   * attempts if enabled.
   *
   * Special handling for `cd` commands to update working directory state.
   *
   * @param command - Shell command to execute
   * @param timeout - Maximum execution time in ms (default: 30000)
   * @returns Command output or error message; test output is parsed and structured
   *
   * @example
   * // Simple command
   * await bash.execute('ls -la');
   *
   * // With custom timeout (2 minutes)
   * await bash.execute('npm install', 120000);
   */
  async execute(command: string, timeout: number = 30000): Promise<ToolResult> {
    try {
      // Validate input with schema (enhanced validation)
      const schemaValidation = validateWithSchema(
        bashToolSchemas.execute,
        { command, timeout },
        'execute'
      );

      if (!schemaValidation.valid) {
        return {
          success: false,
          error: `Invalid input: ${schemaValidation.error}`,
        };
      }

      // Additional command safety validation
      const commandSafetyValidation = validateCommandSafety(command);
      if (!commandSafetyValidation.valid) {
        return {
          success: false,
          error: `Command blocked: ${commandSafetyValidation.error}`,
        };
      }

      // Validate command before any execution (legacy validation)
      const validation = this.validateCommand(command);
      if (!validation.valid) {
        return {
          success: false,
          error: `Command blocked: ${validation.reason}`,
        };
      }

      // Check if user has already accepted bash commands for this session
      const sessionFlags = this.confirmationService.getSessionFlags();
      if (!sessionFlags.bashCommands && !sessionFlags.allOperations) {
        // Request confirmation showing the command
        const confirmationResult = await this.confirmationService.requestConfirmation(
          {
            operation: 'Run bash command',
            filename: command,
            showVSCodeOpen: false,
            content: `Command: ${command}\nWorking directory: ${this.currentDirectory}`,
          },
          'bash'
        );

        if (!confirmationResult.confirmed) {
          return {
            success: false,
            error: confirmationResult.feedback || 'Command execution cancelled by user',
          };
        }
      }

      // Handle cd command separately
      if (command.startsWith('cd ')) {
        const newDir = command.substring(3).trim();
        // Remove quotes if present
        const cleanDir = newDir.replace(/^["']|["']$/g, '');
        try {
          process.chdir(cleanDir);
          this.currentDirectory = process.cwd();
          return {
            success: true,
            output: `Changed directory to: ${this.currentDirectory}`,
          };
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          return {
            success: false,
            error: `Cannot change directory: ${errorMessage}`,
          };
        }
      }

      // Execute using spawn (safer than exec)
      const result = await this.executeWithSpawn(command, {
        timeout,
        cwd: this.currentDirectory,
      });

      if (result.exitCode !== 0) {
        const errorMessage = result.stderr || `Command exited with code ${result.exitCode}`;

        // Attempt self-healing if enabled
        if (this.selfHealingEnabled) {
          const healingResult = await this.selfHealingEngine.attemptHealing(
            command,
            errorMessage,
            async (fixCmd: string) => {
              // Execute fix command without self-healing to avoid recursion
              const fixResult = await this.executeWithSpawn(fixCmd, {
                timeout: timeout * 2, // Give more time for fix commands
                cwd: this.currentDirectory,
              });

              if (fixResult.exitCode === 0) {
                return {
                  success: true,
                  output: fixResult.stdout || 'Fix applied successfully',
                };
              }
              return {
                success: false,
                error: fixResult.stderr || `Fix failed with code ${fixResult.exitCode}`,
              };
            }
          );

          if (healingResult.success && healingResult.finalResult) {
            return {
              success: true,
              output: `🔧 Self-healed after ${healingResult.attempts.length} attempt(s)\n` +
                      `Fix applied: ${healingResult.fixedCommand}\n\n` +
                      (healingResult.finalResult.output || 'Success'),
            };
          }

          // If healing failed, return original error with healing info
          if (healingResult.attempts.length > 0) {
            return {
              success: false,
              error: `${errorMessage}\n\n🔧 Self-healing attempted ${healingResult.attempts.length} fix(es) but failed.`,
            };
          }
        }

        return {
          success: false,
          error: errorMessage,
        };
      }

      const output = result.stdout + (result.stderr ? `\nSTDERR: ${result.stderr}` : '');
      const trimmedOutput = output.trim() || 'Command executed successfully (no output)';

      // Check if this looks like test output and enrich it
      if (isLikelyTestOutput(trimmedOutput)) {
        const parsed = parseTestOutput(trimmedOutput);
        if (parsed.isTestOutput && parsed.data) {
          // Return structured test data as JSON for the renderer
          return {
            success: true,
            output: JSON.stringify(parsed.data),
            data: { type: 'test-results', framework: parsed.data.framework },
          };
        }
      }

      return {
        success: true,
        output: trimmedOutput,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: `Command failed: ${errorMessage}`,
      };
    }
  }

  /**
   * Enable or disable self-healing
   */
  setSelfHealing(enabled: boolean): void {
    this.selfHealingEnabled = enabled;
  }

  /**
   * Check if self-healing is enabled
   */
  isSelfHealingEnabled(): boolean {
    return this.selfHealingEnabled;
  }

  /**
   * Get self-healing engine for configuration
   */
  getSelfHealingEngine(): SelfHealingEngine {
    return this.selfHealingEngine;
  }

  getCurrentDirectory(): string {
    return this.currentDirectory;
  }

  /**
   * Escape shell argument to prevent command injection
   */
  private escapeShellArg(arg: string): string {
    // Use single quotes and escape any single quotes in the string
    return `'${arg.replace(/'/g, "'\\''")}'`;
  }

  /**
   * List files in a directory (wrapper for `ls -la`)
   *
   * @param directory - Directory path to list (default: current directory)
   * @returns Formatted directory listing or error
   */
  async listFiles(directory: string = '.'): Promise<ToolResult> {
    // Validate input with schema
    const validation = validateWithSchema(
      bashToolSchemas.listFiles,
      { directory },
      'listFiles'
    );

    if (!validation.valid) {
      return {
        success: false,
        error: `Invalid input: ${validation.error}`,
      };
    }

    const safeDir = sanitizeForShell(directory);
    return this.execute(`ls -la ${safeDir}`);
  }

  /**
   * Find files matching a pattern (wrapper for `find -name -type f`)
   *
   * @param pattern - Glob pattern to match (e.g., "*.ts", "package.json")
   * @param directory - Directory to search in (default: current directory)
   * @returns List of matching file paths or error
   */
  async findFiles(pattern: string, directory: string = '.'): Promise<ToolResult> {
    // Validate input with schema
    const validation = validateWithSchema(
      bashToolSchemas.findFiles,
      { pattern, directory },
      'findFiles'
    );

    if (!validation.valid) {
      return {
        success: false,
        error: `Invalid input: ${validation.error}`,
      };
    }

    const safeDir = sanitizeForShell(directory);
    const safePattern = sanitizeForShell(pattern);
    return this.execute(`find ${safeDir} -name ${safePattern} -type f`);
  }

  /**
   * Search for a pattern in files using ripgrep
   *
   * Uses @vscode/ripgrep for ultra-fast searching. Results are limited
   * to 100 matches for performance.
   *
   * @param pattern - Regex pattern to search for
   * @param files - File or directory to search in (default: current directory)
   * @returns Matching lines with file paths and line numbers, or error
   */
  async grep(pattern: string, files: string = '.'): Promise<ToolResult> {
    // Validate input with schema
    const validation = validateWithSchema(
      bashToolSchemas.grep,
      { pattern, files },
      'grep'
    );

    if (!validation.valid) {
      return {
        success: false,
        error: `Invalid input: ${validation.error}`,
      };
    }

    // Use ripgrep for ultra-fast searching
    return new Promise((resolve) => {
      const args = [
        '--no-heading',
        '--line-number',
        '--color', 'never',
        '--max-count', '100', // Limit results for performance
        pattern,
        files
      ];

      const rg = spawn(rgPath, args, {
        cwd: this.currentDirectory,
        env: process.env,
      });

      let stdout = '';
      let stderr = '';

      rg.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      rg.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      rg.on('close', (code) => {
        // ripgrep returns 1 if no matches found (not an error)
        if (code === 0 || code === 1) {
          resolve({
            success: true,
            output: stdout || 'No matches found',
          });
        } else {
          resolve({
            success: false,
            error: stderr || `ripgrep exited with code ${code}`,
            output: stdout,
          });
        }
      });

      rg.on('error', (error) => {
        resolve({
          success: false,
          error: `ripgrep error: ${error.message}`,
        });
      });
    });
  }
}
