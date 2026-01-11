/**
 * Shell Prefix Handler - Direct Shell Execution (Gemini CLI inspired)
 *
 * Allows users to execute shell commands directly by prefixing with `!`
 * Example: !git status, !npm test, !ls -la
 *
 * This bypasses the AI and executes the command immediately.
 */

import { exec, spawn } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Result of a shell command execution.
 */
export interface ShellResult {
  /** Whether the command succeeded (exit code 0). */
  success: boolean;
  /** Standard output content. */
  stdout: string;
  /** Standard error content. */
  stderr: string;
  /** Command exit code. */
  exitCode: number;
  /** Execution duration in milliseconds. */
  duration: number;
}

/**
 * Checks if input is a shell command (starts with !).
 *
 * @param input - The user input string.
 * @returns True if it's a shell command.
 */
export function isShellCommand(input: string): boolean {
  return input.trim().startsWith('!');
}

/**
 * Extracts the command string from shell prefix input.
 * Removes the '!' prefix and trims whitespace.
 *
 * @param input - The user input (e.g., "!ls").
 * @returns The command to execute (e.g., "ls").
 */
export function extractCommand(input: string): string {
  return input.trim().slice(1).trim();
}

/**
 * Executes a shell command directly.
 * Captures stdout and stderr.
 *
 * @param command - The shell command to execute.
 * @param cwd - Working directory (defaults to process.cwd()).
 * @param timeout - Timeout in milliseconds (default: 30000).
 * @returns Promise resolving to ShellResult.
 */
export async function executeShellCommand(
  command: string,
  cwd: string = process.cwd(),
  timeout: number = 30000
): Promise<ShellResult> {
  const startTime = Date.now();

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout,
      maxBuffer: 10 * 1024 * 1024, // 10MB
      env: { ...process.env, FORCE_COLOR: '1' },
    });

    return {
      success: true,
      stdout: stdout.toString(),
      stderr: stderr.toString(),
      exitCode: 0,
      duration: Date.now() - startTime,
    };
  } catch (error: unknown) {
    const execError = error as { stdout?: string; stderr?: string; code?: number; killed?: boolean };

    if (execError.killed) {
      return {
        success: false,
        stdout: execError.stdout || '',
        stderr: `Command timed out after ${timeout}ms`,
        exitCode: 124,
        duration: Date.now() - startTime,
      };
    }

    return {
      success: false,
      stdout: execError.stdout || '',
      stderr: execError.stderr || String(error),
      exitCode: execError.code || 1,
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Executes an interactive shell command (for commands like vim, top, etc.).
 * Spawns a child process inheriting stdio.
 *
 * @param command - The command to execute.
 * @param cwd - Working directory.
 * @returns Promise resolving to exit code.
 */
export function executeInteractiveCommand(
  command: string,
  cwd: string = process.cwd()
): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(command, [], {
      cwd,
      shell: true,
      stdio: 'inherit',
    });

    child.on('close', (code) => {
      resolve(code ?? 0);
    });

    child.on('error', () => {
      resolve(1);
    });
  });
}

/**
 * Formats shell execution result for display.
 * Includes command, output, error, exit code, and duration.
 *
 * @param command - The executed command.
 * @param result - The execution result.
 * @returns Formatted string.
 */
export function formatShellResult(command: string, result: ShellResult): string {
  const lines: string[] = [];

  lines.push(`$ ${command}`);

  if (result.stdout) {
    lines.push(result.stdout.trimEnd());
  }

  if (result.stderr && !result.success) {
    lines.push(`
Error: ${result.stderr.trimEnd()}`);
  }

  if (!result.success) {
    lines.push(`
Exit code: ${result.exitCode}`);
  }

  lines.push(`
(${result.duration}ms)`);

  return lines.join('\n');
}

/**
 * Checks if a command is interactive (needs PTY/inherit stdio).
 * Includes common interactive tools like editors, pagers, etc.
 *
 * @param command - The command to check.
 * @returns True if the command is known to be interactive.
 */
export function isInteractiveCommand(command: string): boolean {
  const interactiveCommands = [
    'vim', 'nvim', 'nano', 'emacs',
    'top', 'htop', 'less', 'more',
    'ssh', 'telnet', 'ftp',
    'python', 'node', 'irb', 'ghci',
    'git rebase -i', 'git add -i',
  ];

  const cmd = command.split(/\s+/)[0];
  return interactiveCommands.some(ic =>
    command.includes(ic) || cmd === ic
  );
}