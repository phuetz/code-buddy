/**
 * Streaming execution for BashTool.
 *
 * Contains the executeStreaming AsyncGenerator that yields output chunks
 * as they arrive from the spawned process.
 */

import { spawn } from 'child_process';
import { StringDecoder } from 'node:string_decoder';
import { BoundedOutput } from '../../utils/bounded-output.js';
import { ToolResult } from '../../types/index.js';
import { ConfirmationService } from '../../utils/confirmation-service.js';
import { validateCommand as validateCommandSafety } from '../../utils/input-validator.js';
import { validateCommand } from './command-validator.js';
import { getFilteredEnv } from './command-validator.js';
import { getShellEnvPolicy } from '../../security/shell-env-policy.js';
import { buildBashEnvPrelude, CONTROLLED_SUBPROCESS_ENV } from './env-overrides.js';
import { getShellConfiguration, shellWorkingDirectoryCommand } from '../../utils/shell-configuration.js';
import { rewriteCommandWithRtk } from './rtk-rewrite.js';
import {
  evaluateShellExecution,
  executableIdentitiesStillMatch,
  executeInWorkspaceSandbox,
  isSandboxBoundaryFailure,
} from './execution-policy.js';
import { confineSpawn } from '../../security/native-sandbox.js';
import { refusedUnconfinedEscalationResult } from './unconfined-escalation.js';

export interface StreamingExecutorDeps {
  getCurrentDirectory: () => string;
  maxOutputBytes?: number;
  getSandboxManager: () => { validateCommand(cmd: string): { valid: boolean; reason?: string } };
  getRunningProcesses: () => Set<import('child_process').ChildProcess>;
  /** Per-call flag from the MCP handler. The agent loop leaves it unset. */
  refuseUnconfinedEscalation?: boolean;
}

/**
 * Execute a command with streaming output.
 * Yields each line of stdout/stderr as it arrives.
 * Validates and confirms the command before execution.
 */
export async function* executeStreaming(
  command: string,
  timeout: number = 30000,
  deps: StreamingExecutorDeps,
  signal?: AbortSignal,
): AsyncGenerator<string, ToolResult, undefined> {
  if (signal?.aborted) {
    return { success: false, error: 'Command aborted by user' };
  }
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
  if (signal?.aborted) {
    return { success: false, error: 'Command aborted by user' };
  }
  if (policy.action === 'deny') {
    return { success: false, error: `Command blocked by execution policy: ${policy.reason}` };
  }

  let requiresDirectApproval = policy.action === 'ask';
  let escalationReason = policy.reason;

  if (policy.action === 'sandbox') {
    const sandboxed = await executeInWorkspaceSandbox(executionCommand, cwd, timeout, signal);
    if (signal?.aborted) {
      return { success: false, error: 'Command aborted by user' };
    }
    if (sandboxed.available && sandboxed.result) {
      const { stdout, stderr, exitCode, backend, timedOut } = sandboxed.result;
      if (timedOut) {
        if (stdout) yield stdout;
        return { success: false, error: `Command timed out after ${timeout}ms\n[sandbox:${backend}]` };
      }
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
  // MCP refuses that host retry before confirmation, so AUTO_CONFIRM cannot grant it.
  const confirmationService = ConfirmationService.getInstance();
  if (requiresDirectApproval) {
    const refused = refusedUnconfinedEscalationResult(
      policy.action,
      true,
      escalationReason,
      deps.refuseUnconfinedEscalation === true,
    );
    if (refused) return refused;

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

  const shellConfiguration = getShellConfiguration();
  const shellCommand = shellConfiguration.shell === 'bash'
    ? `${buildBashEnvPrelude()}\n${executionCommand}`
    : shellWorkingDirectoryCommand(executionCommand, shellConfiguration);
  const confined = confineSpawn({
    file: shellConfiguration.executable,
    args: [...shellConfiguration.argsPrefix, shellCommand],
    cwd,
    env: controlledEnv,
  });
  if (!confined.ok) {
    return { success: false, error: confined.error };
  }
  const proc = spawn(confined.file, confined.args, {
    shell: false,
    cwd,
    env: confined.env,
    detached: !isWindows,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const runningProcesses = deps.getRunningProcesses();
  runningProcesses.add(proc);
  const stdout = new BoundedOutput(deps.maxOutputBytes);
  const stderr = new BoundedOutput(deps.maxOutputBytes);
  const pending = new BoundedOutput(deps.maxOutputBytes);
  const outDecoder = new StringDecoder('utf8');
  const errDecoder = new StringDecoder('utf8');
  let done = false;
  let failure: string | undefined;
  let wake: (() => void) | undefined;
  let killTimer: NodeJS.Timeout | undefined;
  const notify = (): void => { wake?.(); wake = undefined; };
  const kill = (signal: NodeJS.Signals): void => {
    try {
      if (!isWindows && proc.pid) process.kill(-proc.pid, signal);
      else proc.kill(signal);
    } catch { /* The process or its group already exited. */ }
  };
  const stop = (reason: string): void => {
    if (done || failure) return;
    failure = reason;
    kill('SIGTERM');
    // Sending a signal is not proof of exit. Escalate even if the parent
    // closes its pipes while a descendant still holds the process group.
    killTimer = setTimeout(() => {
      kill('SIGKILL');
      done = true;
      notify();
    }, 250);
    notify();
  };
  const timer = setTimeout(() => stop(`Command timed out after ${timeout}ms`), timeout);
  const onAbort = (): void => stop('Command aborted by user');
  const onError = (error: Error): void => {
    failure ??= `Command failed to start: ${error.message}`;
    done = true;
    notify();
  };
  const onClose = (): void => {
    if (!failure) done = true;
    notify();
  };
  const onData = (data: Buffer, target: BoundedOutput, decoder: StringDecoder): void => {
    const text = decoder.write(data);
    target.append(text);
    pending.append(text);
    notify();
  };
  const onStdout = (data: Buffer): void => onData(data, stdout, outDecoder);
  const onStderr = (data: Buffer): void => onData(data, stderr, errDecoder);
  proc.stdout?.on('data', onStdout);
  proc.stderr?.on('data', onStderr);
  proc.on('error', onError);
  proc.on('close', onClose);
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) onAbort();

  try {
    while (!done || pending.retainedBytes > 0) {
      if (pending.retainedBytes > 0) yield pending.drain();
      else if (!done) await new Promise<void>(resolve => { wake = resolve; });
    }
  } finally {
    clearTimeout(timer);
    clearTimeout(killTimer);
    signal?.removeEventListener('abort', onAbort);
    // Also handles a consumer calling return() before the child exits.
    if (!done || failure) kill('SIGKILL');
    proc.stdout?.removeListener('data', onStdout);
    proc.stderr?.removeListener('data', onStderr);
    proc.removeListener('close', onClose);
    runningProcesses.delete(proc);
  }

  const output = stdout.text();
  if (failure) return { success: false, error: failure, output };
  if (proc.exitCode !== 0) {
    return { success: false, error: stderr.text() || `Exit code ${proc.exitCode}`, output };
  }
  return { success: true, output };
}
