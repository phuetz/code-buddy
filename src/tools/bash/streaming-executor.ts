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
import { buildBashEnvPrelude, CONTROLLED_SUBPROCESS_ENV } from './env-overrides.js';
import { rewriteCommandWithRtk } from './rtk-rewrite.js';
import {
  evaluateShellExecution,
  executableIdentitiesStillMatch,
  executeInWorkspaceSandbox,
  isSandboxBoundaryFailure,
} from './execution-policy.js';

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

  const cwd = deps.getCurrentDirectory();
  const rewrite = await rewriteCommandWithRtk(command);
  let executionCommand = command;
  if (rewrite.rewritten) {
    const rewrittenValidation = validateCommand(rewrite.command);
    const rewrittenSandboxValidation = deps.getSandboxManager().validateCommand(rewrite.command);
    const rewrittenSafetyValidation = validateCommandSafety(rewrite.command);
    if (
      rewrittenValidation.valid &&
      rewrittenSandboxValidation.valid &&
      rewrittenSafetyValidation.valid
    ) {
      executionCommand = rewrite.command;
    }
  }

  // Freeze the transformed command before policy/approval. Buffered and
  // streaming execution now authorize exactly what they dispatch.
  const policy = await evaluateShellExecution(executionCommand, cwd);
  if (policy.action === 'deny') {
    return { success: false, error: `Command blocked by execution policy: ${policy.reason}` };
  }

  let requiresDirectApproval = policy.action === 'ask';
  let escalationReason = policy.reason;

  if (policy.action === 'sandbox') {
    const sandboxed = await executeInWorkspaceSandbox(executionCommand, cwd, timeout);
    if (sandboxed.available && sandboxed.result) {
      const { stdout, stderr, exitCode, backend } = sandboxed.result;
      if (exitCode === 0 || !isSandboxBoundaryFailure(sandboxed.result)) {
        if (stdout) yield stdout;
        if (stderr) yield stderr;
        return exitCode === 0
          ? { success: true, output: (stdout || stderr || 'Command executed successfully (no output)').trim() }
          : {
              success: false,
              error: `${(stderr || stdout || `Command exited with code ${exitCode}`).trim()}\n[sandbox:${backend}; exit code ${exitCode}]`,
            };
      }
      requiresDirectApproval = true;
      escalationReason = `Sandbox boundary denied the command: ${stderr || stdout}`;
    } else {
      requiresDirectApproval = true;
      escalationReason = sandboxed.reason || 'Workspace sandbox unavailable';
    }
  }

  // Ask only when the command needs authority outside the workspace sandbox.
  const confirmationService = ConfirmationService.getInstance();
  if (requiresDirectApproval) {
    const confirmationResult = await confirmationService.requestConfirmation(
      {
        operation: 'Run command outside the workspace sandbox (streaming)',
        filename: executionCommand,
        showVSCodeOpen: false,
        content:
          (executionCommand === command
            ? `Command: ${executionCommand}\n`
            : `Original command: ${command}\nTransformed command: ${executionCommand}\n`) +
          `Working directory: ${cwd}\n` +
          `Boundary: ${escalationReason}`,
        approvalKey: policy.approvalKey,
        riskLevel: 'high',
        detail: { cwd },
      },
      'bash'
    );
    if (!confirmationResult.confirmed) {
      return { success: false, error: confirmationResult.feedback || 'Cancelled by user' };
    }
  }

  if (!executableIdentitiesStillMatch(policy, cwd)) {
    return {
      success: false,
      error: 'Executable identity changed after policy evaluation; retry the command for a fresh decision.',
    };
  }

  // Spawn the process
  const isWindows = process.platform === 'win32';
  const policyEnv = getShellEnvPolicy().buildEnv(getFilteredEnv());
  const controlledEnv: NodeJS.ProcessEnv = {
    ...policyEnv,
    ...CONTROLLED_SUBPROCESS_ENV,
  };

  const proc = spawn('bash', ['-c', `${buildBashEnvPrelude()}\n${executionCommand}`], {
    shell: false,
    cwd,
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
    if (!proc.killed && proc.exitCode === null) {
      proc.kill('SIGTERM');
      setTimeout(() => {
        try { if (!proc.killed) proc.kill('SIGKILL'); } catch { /* already dead */ }
      }, 5000);
    }
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
