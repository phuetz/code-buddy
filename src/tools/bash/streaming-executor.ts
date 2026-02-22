/**
 * Streaming execution for BashTool.
 *
 * Contains the executeStreaming AsyncGenerator that yields output chunks
 * as they arrive from the spawned process.
 */

import { spawn } from 'child_process';
import { ToolResult } from '../../types/index.js';
import { ConfirmationService } from '../../utils/confirmation-service.js';
import { validateCommand as validateCommandSafety } from '../../utils/input-validator.js';
import { validateCommand } from './command-validator.js';
import { getFilteredEnv } from './command-validator.js';
import { getShellEnvPolicy } from '../../security/shell-env-policy.js';

export interface StreamingExecutorDeps {
  getCurrentDirectory: () => string;
  getSandboxManager: () => { validateCommand(cmd: string): { valid: boolean; reason?: string } };
  getRunningProcesses: () => Set<import('child_process').ChildProcess>;
}

/**
 * Execute a command with streaming output.
 * Yields each line of stdout/stderr as it arrives.
 * Validates and confirms the command before execution.
 */
export async function* executeStreaming(
  command: string,
  timeout: number = 30000,
  deps: StreamingExecutorDeps
): AsyncGenerator<string, ToolResult, undefined> {
  // Validate command (static checks)
  const validation = validateCommand(command);
  if (!validation.valid) {
    return { success: false, error: `Command blocked: ${validation.reason}` };
  }

  // Sandbox manager validation (instance-level)
  const sandboxValidation = deps.getSandboxManager().validateCommand(command);
  if (!sandboxValidation.valid) {
    return { success: false, error: `Command blocked: ${sandboxValidation.reason}` };
  }

  const commandSafetyValidation = validateCommandSafety(command);
  if (!commandSafetyValidation.valid) {
    return { success: false, error: `Command blocked: ${commandSafetyValidation.error}` };
  }

  // Check confirmation
  const confirmationService = ConfirmationService.getInstance();
  const sessionFlags = confirmationService.getSessionFlags();
  if (!sessionFlags.bashCommands && !sessionFlags.allOperations) {
    const confirmationResult = await confirmationService.requestConfirmation(
      {
        operation: 'Run bash command (streaming)',
        filename: command,
        showVSCodeOpen: false,
        content: `Command: ${command}\nWorking directory: ${deps.getCurrentDirectory()}`,
      },
      'bash'
    );
    if (!confirmationResult.confirmed) {
      return { success: false, error: confirmationResult.feedback || 'Cancelled by user' };
    }
  }

  // Spawn the process
  const isWindows = process.platform === 'win32';
  const policyEnv = getShellEnvPolicy().buildEnv(getFilteredEnv());
  const controlledEnv: Record<string, string> = {
    ...policyEnv,
    HISTFILE: '/dev/null',
    HISTSIZE: '0',
    CI: 'true',
    NO_COLOR: '1',
    TERM: 'dumb',
    NO_TTY: '1',
    GIT_TERMINAL_PROMPT: '0',
    NPM_CONFIG_YES: 'true',
    LC_ALL: 'C.UTF-8',
    LANG: 'C.UTF-8',
    PYTHONIOENCODING: 'utf-8',
    DEBIAN_FRONTEND: 'noninteractive',
  };

  const proc = spawn('bash', ['-c', command], {
    shell: false,
    cwd: deps.getCurrentDirectory(),
    env: controlledEnv,
    detached: !isWindows,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const runningProcesses = deps.getRunningProcesses();
  runningProcesses.add(proc);
  let stdout = '';
  let stderr = '';
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    try { proc.kill('SIGTERM'); } catch { /* ignore */ }
  }, timeout);

  try {
    // Create a readable stream from stdout and stderr combined
    const chunks: string[] = [];
    let resolve: (() => void) | null = null;
    let done = false;

    const onData = (data: Buffer, isStderr: boolean) => {
      const text = data.toString();
      if (isStderr) stderr += text;
      else stdout += text;
      chunks.push(text);
      if (resolve) { resolve(); resolve = null; }
    };

    proc.stdout?.on('data', (data: Buffer) => onData(data, false));
    proc.stderr?.on('data', (data: Buffer) => onData(data, true));
    proc.on('close', () => { done = true; if (resolve) { resolve(); resolve = null; } });

    while (!done) {
      if (chunks.length > 0) {
        while (chunks.length > 0) {
          yield chunks.shift()!;
        }
      } else {
        await new Promise<void>(r => { resolve = r; });
      }
    }

    // Yield remaining chunks
    while (chunks.length > 0) {
      yield chunks.shift()!;
    }
  } finally {
    clearTimeout(timer);
    runningProcesses.delete(proc);
  }

  if (timedOut) {
    return { success: false, error: `Command timed out after ${timeout}ms` };
  }

  const exitCode = proc.exitCode ?? 0;
  if (exitCode !== 0) {
    return { success: false, error: stderr || `Exit code ${exitCode}`, output: stdout };
  }

  return { success: true, output: stdout };
}
