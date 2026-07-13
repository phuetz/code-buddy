/**
 * Runtime bridge between ExecPolicy and the native workspace sandbox.
 *
 * The policy used to be a dashboard-only feature.  BashTool and its streaming
 * path now call this bridge so the same parsed decision is enforced at the
 * moment a command runs.
 */

import { initializeExecPolicy, type ShellPolicyEvaluation } from '../../sandbox/execpolicy.js';
import { createSandboxForMode, type OSSandboxResult } from '../../sandbox/os-sandbox.js';
import { DockerSandbox } from '../../sandbox/docker-sandbox.js';
import { getShellEnvPolicy } from '../../security/shell-env-policy.js';
import { checkDeclarativePermission } from '../../security/declarative-rules.js';
import { getPermissionModeManager } from '../../security/permission-modes.js';
import { PolicyEngine } from '../../security/policy-engine.js';
import { getFilteredEnv } from './command-validator.js';
import { CONTROLLED_SUBPROCESS_ENV } from './env-overrides.js';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

const LOCAL_WORKSPACE_SANDBOX_IMAGE = 'codebuddy-workspace-sandbox:1';

const SHELL_BUILTINS = new Set([
  'alias', 'bg', 'bind', 'break', 'builtin', 'caller', 'cd', 'command', 'compgen',
  'complete', 'continue', 'declare', 'dirs', 'disown', 'echo', 'enable', 'eval',
  'exec', 'exit', 'export', 'false', 'fc', 'fg', 'getopts', 'hash', 'help',
  'history', 'jobs', 'kill', 'let', 'local', 'logout', 'mapfile', 'popd', 'printf',
  'pushd', 'pwd', 'read', 'readarray', 'readonly', 'return', 'set', 'shift',
  'shopt', 'source', 'suspend', 'test', 'times', 'trap', 'true', 'type', 'typeset',
  'ulimit', 'umask', 'unalias', 'unset', 'wait',
]);

export interface ExecutableIdentity {
  token: string;
  kind: 'file' | 'builtin' | 'unresolved';
  resolvedPath?: string;
  device?: number;
  inode?: number;
  size?: number;
  modifiedMs?: number;
  mode?: number;
}

export interface RuntimeShellPolicyEvaluation extends ShellPolicyEvaluation {
  executableIdentities: ExecutableIdentity[];
}

function runtimeEnvironment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries({
      ...getShellEnvPolicy().buildEnv(getFilteredEnv()),
      ...CONTROLLED_SUBPROCESS_ENV,
    }).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

function executableCandidates(token: string, cwd: string, env: Record<string, string>): string[] {
  if (token.includes('/') || (process.platform === 'win32' && token.includes('\\'))) {
    return [path.resolve(cwd, token)];
  }
  const searchPath = env.PATH ?? process.env.PATH ?? '';
  const extensions = process.platform === 'win32'
    ? (env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';')
    : [''];
  return searchPath
    .split(path.delimiter)
    .filter(Boolean)
    .flatMap((directory) => extensions.map((extension) => path.join(directory, `${token}${extension}`)));
}

function resolveExecutableIdentity(
  token: string,
  cwd: string,
  env: Record<string, string>,
): ExecutableIdentity {
  if (SHELL_BUILTINS.has(token)) {
    return { token, kind: 'builtin' };
  }
  for (const candidate of executableCandidates(token, cwd, env)) {
    try {
      const resolvedPath = fs.realpathSync(candidate);
      const stat = fs.statSync(resolvedPath);
      if (!stat.isFile()) continue;
      return {
        token,
        kind: 'file',
        resolvedPath,
        device: stat.dev,
        inode: stat.ino,
        size: stat.size,
        modifiedMs: stat.mtimeMs,
        mode: stat.mode,
      };
    } catch {
      // Try the next PATH entry.
    }
  }
  return { token, kind: 'unresolved' };
}

function resolveExecutableIdentities(
  segments: string[][],
  cwd: string,
  env: Record<string, string>,
): ExecutableIdentity[] {
  return [
    resolveExecutableIdentity('bash', cwd, env),
    ...segments
      .map((segment) => segment[0])
      .filter((token): token is string => Boolean(token))
      .map((token) => resolveExecutableIdentity(token, cwd, env)),
  ];
}

function buildRuntimeApprovalKey(
  baseKey: string,
  cwd: string,
  environmentRecord: Record<string, string>,
  executableIdentities: ExecutableIdentity[],
): string {
  const environment = Object.entries(environmentRecord)
    .sort(([left], [right]) => left.localeCompare(right));
  const digest = createHash('sha256')
    .update(
      JSON.stringify({
        baseKey,
        cwd,
        sandboxProfile: 'workspace-write-v1',
        network: 'restricted',
        environment,
        executableIdentities,
      })
    )
    .digest('hex');
  return `shell-runtime:${digest}`;
}

export interface SandboxedExecution {
  available: boolean;
  result?: OSSandboxResult;
  reason?: string;
}

export async function evaluateShellExecution(
  command: string,
  cwd: string
): Promise<RuntimeShellPolicyEvaluation> {
  const policy = await initializeExecPolicy();
  const baseEvaluation = policy.evaluateShellCommand(command, cwd);
  const environment = runtimeEnvironment();
  const executableIdentities = resolveExecutableIdentities(
    baseEvaluation.parsedSegments,
    cwd,
    environment,
  );
  const evaluation: RuntimeShellPolicyEvaluation = {
    ...baseEvaluation,
    executableIdentities,
    approvalKey: buildRuntimeApprovalKey(
      baseEvaluation.approvalKey,
      cwd,
      environment,
      executableIdentities,
    ),
  };

  const permissionDecision = getPermissionModeManager().checkPermission(command, 'bash');
  if (!permissionDecision.allowed) {
    return {
      ...evaluation,
      action: 'deny',
      reason: permissionDecision.reason,
    };
  }

  const declarative = checkDeclarativePermission('Bash', { command }, cwd);
  if (declarative === 'deny') {
    return {
      ...evaluation,
      action: 'deny',
      reason: 'Blocked by declarative permission rule',
    };
  }

  const policyResult = PolicyEngine.getInstance().evaluate({
    capability: 'shell:safe',
    risk: evaluation.action === 'allow' ? 'low' : 'high',
    detail: { command, path: cwd },
  });
  if (policyResult.decision === 'deny') {
    return { ...evaluation, action: 'deny', reason: policyResult.reason };
  }
  if (evaluation.action === 'allow' && policyResult.decision === 'needs_approval') {
    return { ...evaluation, action: 'ask', reason: policyResult.reason };
  }

  // A declarative allow removes the prompt but never removes confinement.
  if (declarative === 'allow' && evaluation.action === 'ask') {
    return {
      ...evaluation,
      action: 'sandbox',
      reason: 'Declarative allow accepted; workspace sandbox remains enforced',
    };
  }

  // `allow` means "no approval needed", not "escape confinement". This is
  // intentionally stricter than the legacy SafeBinaries path: even `cat` and
  // `git status` run with workspace-scoped reads, no network, and protected
  // agent/VCS metadata. Direct host execution is reserved for an exact,
  // auditable escalation after an `ask` or a real sandbox boundary failure.
  if (evaluation.action === 'allow') {
    return {
      ...evaluation,
      action: 'sandbox',
      reason: 'Execution policy allowed the command; workspace sandbox remains enforced',
    };
  }
  return evaluation;
}

/**
 * Best-effort TOCTOU guard for direct host execution. A true execve broker is
 * stronger, but re-statting every resolved executable immediately before
 * spawn prevents a session grant from surviving PATH/symlink/binary changes.
 */
export function executableIdentitiesStillMatch(
  evaluation: RuntimeShellPolicyEvaluation,
  cwd: string,
): boolean {
  const current = resolveExecutableIdentities(
    evaluation.parsedSegments,
    cwd,
    runtimeEnvironment(),
  );
  return JSON.stringify(current) === JSON.stringify(evaluation.executableIdentities);
}

/**
 * Run inside the Codex-style workspace-write profile.  This function never
 * falls back to direct execution: if OS isolation is unavailable the caller
 * must request a precise unsandboxed escalation.
 */
export async function executeInWorkspaceSandbox(
  command: string,
  cwd: string,
  timeout: number
): Promise<SandboxedExecution> {
  const shellEnv = getShellEnvPolicy().buildEnv(getFilteredEnv());
  const env = Object.fromEntries(
    Object.entries(shellEnv).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    )
  );
  const sandbox = await createSandboxForMode('workspace-write', cwd);
  sandbox.updateConfig({
    timeout,
    allowUnsandboxed: false,
    env,
  });

  if (!(await sandbox.isAvailable()) || sandbox.getBackend() === 'docker') {
    const configuredImage = process.env.CODEBUDDY_SANDBOX_IMAGE?.trim();
    const [dockerAvailable, hasDedicatedImage] = await Promise.all([
      DockerSandbox.isAvailableCached(),
      configuredImage
        ? Promise.resolve(false)
        : DockerSandbox.hasLocalImageCached(LOCAL_WORKSPACE_SANDBOX_IMAGE),
    ]);
    const image =
      configuredImage ||
      (hasDedicatedImage
        ? LOCAL_WORKSPACE_SANDBOX_IMAGE
        : 'node:22-slim');
    const docker = new DockerSandbox({
      image,
      workspaceMount: cwd,
      preserveWorkspacePath: true,
      workspaceReadOnly: ['.git', '.codebuddy', '.agents', '.ssh', '.gnupg', '.aws'],
      networkEnabled: false,
      readOnly: true,
      memoryLimit: process.env.CODEBUDDY_SANDBOX_MEMORY || '8g',
      cpuLimit: process.env.CODEBUDDY_SANDBOX_CPUS || '4.0',
      environment: {
        ...CONTROLLED_SUBPROCESS_ENV,
        HOME: '/tmp/codebuddy-home',
        NPM_CONFIG_CACHE: '/tmp/codebuddy-npm-cache',
        XDG_CACHE_HOME: '/tmp/codebuddy-cache',
      },
      timeout,
    });
    if (!dockerAvailable) {
      return {
        available: false,
        reason: 'No native or Docker workspace sandbox is available',
      };
    }
    const dockerResult = await docker.execute(command);
    await docker.cleanup();
    return {
      available: true,
      result: {
        exitCode: dockerResult.exitCode,
        stdout: dockerResult.output,
        stderr: dockerResult.error || '',
        duration: dockerResult.durationMs,
        timedOut: dockerResult.error?.includes('timed out') ?? false,
        backend: 'docker',
        sandboxed: true,
      },
    };
  }

  const result = await sandbox.execShellTracked(command);
  if (!result.sandboxed) {
    return {
      available: false,
      reason: 'The sandbox backend refused isolation; direct fallback was not used',
    };
  }
  return { available: true, result };
}

/** Best-effort distinction used to offer a precise escalation after sandbox denial. */
export function isSandboxBoundaryFailure(result: OSSandboxResult): boolean {
  if (result.exitCode === 0) return false;
  // Shell/application failures are not proof that the sandbox denied access.
  // In particular, 126/127 used to trigger a host retry for any missing or
  // non-executable command. That turns an ordinary typo (or hostile script)
  // into an escalation prompt. Match Codex's conservative denial heuristic:
  // only an explicit boundary diagnostic below may request a retry.
  if (result.exitCode === 2 || result.exitCode === 126 || result.exitCode === 127) {
    return false;
  }
  const diagnostic = `${result.stderr}\n${result.stdout}`.toLowerCase();
  return [
    'read-only file system',
    'permission denied',
    'operation not permitted',
    'network is unreachable',
    'temporary failure in name resolution',
    'could not resolve host',
  ].some((marker) => diagnostic.includes(marker));
}
