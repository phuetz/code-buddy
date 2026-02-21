/**
 * BashTool - Main coordinator class for shell command execution.
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

import { spawn, SpawnOptions, ChildProcess } from 'child_process';
import { ToolResult } from '../../types/index.js';
import { ConfirmationService } from '../../utils/confirmation-service.js';
import { getSandboxManager } from '../../security/sandbox.js';
import { getSelfHealingEngine, SelfHealingEngine } from '../../utils/self-healing.js';
import { parseTestOutput, isLikelyTestOutput } from '../../utils/test-output-parser.js';
import { Disposable, registerDisposable } from '../../utils/disposable.js';
import {
  bashToolSchemas,
  validateWithSchema,
  validateCommand as validateCommandSafety,
  sanitizeForShell
} from '../../utils/input-validator.js';
import { rgPath } from '@vscode/ripgrep';
import { validateCommand, getFilteredEnv } from './command-validator.js';
import { executeStreaming as executeStreamingImpl } from './streaming-executor.js';
import { parseBashCommand } from '../../security/bash-parser.js';
import { getCheckpointManager } from '../../checkpoints/checkpoint-manager.js';
import { auditLogger } from '../../security/audit-logger.js';

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
   * Validate command for dangerous patterns (delegates to command-validator)
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
    // Run static validation checks
    const staticValidation = validateCommand(command);
    if (!staticValidation.valid) {
      return staticValidation;
    }

    // Also use sandbox manager validation
    const sandboxValidation = this.sandboxManager.validateCommand(command);
    if (!sandboxValidation.valid) {
      return sandboxValidation;
    }

    return { valid: true };
  }

  /**
   * Execute a command with streaming output.
   * Yields each line of stdout/stderr as it arrives.
   * Validates and confirms the command before execution.
   */
  async *executeStreaming(command: string, timeout: number = 30000): AsyncGenerator<string, ToolResult, undefined> {
    return yield* executeStreamingImpl(command, timeout, {
      getCurrentDirectory: () => this.currentDirectory,
      getSandboxManager: () => this.sandboxManager,
      getRunningProcesses: () => this.runningProcesses,
    });
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
      const filteredEnv = getFilteredEnv();

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

      // Checkpoint files targeted by destructive commands (rm, mv, etc.)
      this.checkpointDestructiveTargets(command);

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
   * Checkpoint files that would be affected by destructive commands.
   * Parses command arguments to identify file targets of rm, mv, etc.
   */
  private checkpointDestructiveTargets(command: string): void {
    const DESTRUCTIVE_CMDS = new Set(['rm', 'mv', 'cp', 'truncate']);
    try {
      const parsed = parseBashCommand(command);
      const checkpointMgr = getCheckpointManager();

      for (const cmd of parsed.commands) {
        if (DESTRUCTIVE_CMDS.has(cmd.command)) {
          // Extract file arguments (skip flags starting with -)
          const fileArgs = cmd.args.filter(a => !a.startsWith('-'));
          for (const fileArg of fileArgs) {
            const resolved = fileArg.startsWith('/')
              ? fileArg
              : `${this.currentDirectory}/${fileArg}`;
            try {
              checkpointMgr.checkpointBeforeEdit(resolved);
              auditLogger.logFileOperation({
                action: 'file_edit',
                target: resolved,
                decision: 'allow',
                source: 'bash-checkpoint',
                details: `Pre-checkpoint before ${cmd.command}`,
              });
            } catch {
              // File might not exist or not be readable — skip
            }
          }
        }
      }
    } catch {
      // Parsing failed — skip checkpointing (command already validated)
    }
  }

  /**
   * Shell-free exec — Codex-inspired direct process execution.
   *
   * Executes a pre-parsed command token array via spawn with `shell: false`,
   * bypassing shell interpretation entirely. Prevents shell injection when the
   * caller has already validated / split the argument vector.
   *
   * Use this when the command has been parsed by bash-parser and you want to
   * avoid double-interpretation through sh/bash.
   *
   * @param argv    - [command, ...args] token array (must have at least 1 element)
   * @param timeout - Max execution time in ms (default: 30000)
   * @param cwd     - Working directory (default: currentDirectory)
   */
  async shellFreeExec(
    argv: string[],
    timeout: number = 30000,
    cwd?: string
  ): Promise<ToolResult> {
    if (!argv || argv.length === 0) {
      return { success: false, error: 'shellFreeExec: argv must be non-empty' };
    }

    const [cmd, ...args] = argv;
    const workDir = cwd ?? this.currentDirectory;
    const filteredEnv = getFilteredEnv();

    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const proc = spawn(cmd, args, {
        shell: false,
        cwd: workDir,
        env: filteredEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill('SIGKILL');
      }, timeout);

      const maxBuf = 1024 * 1024;
      proc.stdout?.on('data', (d: Buffer) => {
        if (stdout.length < maxBuf) stdout += d.toString();
      });
      proc.stderr?.on('data', (d: Buffer) => {
        if (stderr.length < maxBuf) stderr += d.toString();
      });

      proc.on('close', (code) => {
        clearTimeout(timer);
        if (timedOut) {
          resolve({ success: false, error: 'Command timed out' });
        } else if (code === 0) {
          resolve({ success: true, output: stdout.trim() || 'Done' });
        } else {
          resolve({ success: false, error: stderr.trim() || `Exit code ${code}` });
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        resolve({ success: false, error: err.message });
      });
    });
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
        env: getFilteredEnv(),
      });

      let stdout = '';
      let stderr = '';

      rg.stdout?.on('data', (data) => {
        if (stdout.length < 5_000_000) stdout += data.toString();
      });

      rg.stderr?.on('data', (data) => {
        if (stderr.length < 100_000) stderr += data.toString();
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
