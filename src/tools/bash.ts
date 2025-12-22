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
  /rm\s+(-rf?|--recursive)\s+[/~]/i,  // rm -rf / or ~
  /rm\s+.*\/\s*$/i,                      // rm something/
  />\s*\/dev\/sd[a-z]/i,                 // Write to disk device
  /dd\s+.*if=.*of=\/dev/i,              // dd to device
  /mkfs/i,                               // Format filesystem
  /:\(\)\s*\{\s*:\|:&\s*\};:/,          // Fork bomb :(){ :|:& };:
  /chmod\s+-R\s+777\s+\//i,             // chmod 777 /
  /wget.*\|\s*(ba)?sh/i,                // wget | sh
  /curl.*\|\s*(ba)?sh/i,                // curl | sh
  /sudo\s+(rm|dd|mkfs)/i,               // sudo dangerous commands
];

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
   */
  private validateCommand(command: string): { valid: boolean; reason?: string } {
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

      // Controlled environment variables for deterministic output
      const controlledEnv: Record<string, string> = {
        ...process.env,
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
