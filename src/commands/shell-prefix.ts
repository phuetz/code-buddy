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

export interface ShellResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  duration: number;
}

/**
 * Check if input is a shell command (starts with !)
 */
export function isShellCommand(input: string): boolean {
  return input.trim().startsWith('!');
}

/**
 * Extract command from shell prefix input
 */
export function extractCommand(input: string): string {
  return input.trim().slice(1).trim();
}

/**
 * Execute a shell command directly
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
 * Execute an interactive shell command (for commands like vim, top, etc.)
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
 * Format shell result for display
 */
export function formatShellResult(command: string, result: ShellResult): string {
  const lines: string[] = [];

  lines.push(`$ ${command}`);

  if (result.stdout) {
    lines.push(result.stdout.trimEnd());
  }

  if (result.stderr && !result.success) {
    lines.push(`\nError: ${result.stderr.trimEnd()}`);
  }

  if (!result.success) {
    lines.push(`\nExit code: ${result.exitCode}`);
  }

  lines.push(`\n(${result.duration}ms)`);

  return lines.join('\n');
}

/**
 * Check if command is interactive (needs PTY)
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
