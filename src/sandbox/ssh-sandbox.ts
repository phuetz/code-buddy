/**
 * SSH sandbox backend
 *
 * Executes a command on a *declared* remote host through OpenSSH. Opt-in only:
 * never selected by getActiveSandboxBackend(). Authentication is the SSH agent
 * or an existing identity file path — never a password on the command line.
 */

import { spawn as defaultSpawn, spawnSync } from 'child_process';
import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import { existsSync, statSync } from 'fs';
import type { SandboxBackendInterface, SandboxExecOptions, SandboxExecResult } from './sandbox-backend.js';
import { getSandboxBackendByName, registerSandboxBackend } from './sandbox-registry.js';
import { initializeExecPolicy, type PolicyAction } from './execpolicy.js';
import {
  isSafeEnvKey,
  loadSshHostCatalog,
  lookupSshHost,
  shellSingleQuote,
  type SshHostCatalog,
  type SshHostDefinition,
} from './ssh-hosts.js';
import { logger } from '../utils/logger.js';
import { scrubSecrets } from '../security/secret-scrubber.js';

export const SSH_SANDBOX_NAME = 'ssh';
export const DEFAULT_SSH_TIMEOUT_MS = 30_000;
export const DEFAULT_SSH_MAX_OUTPUT_BYTES = 1_048_576;
export const SSH_TRUNCATION_MARK = (stream: 'stdout' | 'stderr', maxBytes: number): string =>
  `\n[truncated: ${stream} exceeded ${maxBytes} bytes]\n`;

const CONNECTION_ERROR_RE =
  /permission denied|connection refused|could not resolve|name or service not known|connection timed out|host key verification failed|no route to host|connection closed|connection reset|banner exchange|no matching (?:host key|key exchange|cipher)|too many authentication failures|operation timed out/i;

export type SshPolicyDecision = { action: PolicyAction; reason: string };

export interface SshChildProcessLike {
  pid?: number;
  stdout?: EventEmitter | null;
  stderr?: EventEmitter | null;
  stdin?: { write: (chunk: string) => unknown; end: () => void } | null;
  kill: (signal?: NodeJS.Signals) => boolean;
  on: (event: 'close' | 'error', listener: (...args: unknown[]) => void) => unknown;
}

export type SshCommandLauncher = (
  command: string,
  args: string[],
) => SshChildProcessLike;

export interface SshSandboxConfig {
  hosts?: Record<string, SshHostDefinition>;
  catalog?: SshHostCatalog;
  /** Logical host used when execute() does not pass opts.host */
  defaultHost?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  spawn?: SshCommandLauncher;
  hasSshClient?: () => boolean;
  evaluatePolicy?: (command: string, workDir: string) => SshPolicyDecision | Promise<SshPolicyDecision>;
}

export interface SshSandboxExecOptions extends SandboxExecOptions {
  /** Logical name of a declared host. */
  host?: string;
}

interface ActiveJob {
  id: string;
  proc: SshChildProcessLike;
  host: SshHostDefinition;
  logicalName: string;
}

function hasSshClientDefault(): boolean {
  try {
    const result = spawnSync('ssh', ['-V'], { encoding: 'utf8', timeout: 5000 });
    return result.error === undefined && (result.status === 0 || result.status === 255);
  } catch {
    return false;
  }
}

async function defaultEvaluatePolicy(command: string, workDir: string): Promise<SshPolicyDecision> {
  const policy = await initializeExecPolicy();
  const evaluation = policy.evaluateShellCommand(command, workDir);
  return { action: evaluation.action, reason: evaluation.reason };
}

export function classifySshConnectionFailure(exitCode: number, stderr: string): string | null {
  if (exitCode !== 255 && exitCode !== 1) return null;
  if (CONNECTION_ERROR_RE.test(stderr)) {
    return `SSH connection failed: ${scrubSecrets(stderr.trim() || `exit ${exitCode}`)}`;
  }
  if (exitCode === 255) {
    return `SSH connection failed (exit 255)`;
  }
  return null;
}

export function buildSshClientArgs(host: SshHostDefinition, extra: string[] = []): string[] {
  const strict = host.strictHostKeyChecking ?? 'yes';
  const connectTimeout = host.connectTimeoutSec ?? 10;
  const args = [
    '-T',
    '-o', 'BatchMode=yes',
    '-o', 'PasswordAuthentication=no',
    '-o', 'KbdInteractiveAuthentication=no',
    '-o', 'PreferredAuthentications=publickey',
    '-o', 'NumberOfPasswordPrompts=0',
    '-o', `StrictHostKeyChecking=${strict}`,
    '-o', `ConnectTimeout=${connectTimeout}`,
    '-o', 'RequestTTY=no',
  ];
  if (host.port) {
    args.push('-p', String(host.port));
  }
  if (host.user) {
    args.push('-l', host.user);
  }
  if (host.identityFile) {
    args.push('-i', host.identityFile, '-o', 'IdentitiesOnly=yes');
  }
  args.push('--', host.host, 'bash', '-s');
  args.push(...extra);
  return args;
}

export function buildRemoteRunScript(options: {
  jobId: string;
  command: string;
  workDir?: string;
  env?: Record<string, string>;
  timeoutSec: number;
}): string {
  const pidFile = `/tmp/cbssh-${options.jobId}.pid`;
  const lines: string[] = [
    'set -u',
    'set -m 2>/dev/null || true',
    `pidfile=${shellSingleQuote(pidFile)}`,
    'echo $$ > "$pidfile"',
    'pgid=$$',
    'cleanup() {',
    '  rc=$?',
    '  kill -TERM -"$pgid" 2>/dev/null || kill -TERM "$pgid" 2>/dev/null || true',
    '  rm -f "$pidfile"',
    '  return $rc',
    '}',
    'trap cleanup EXIT HUP INT TERM',
  ];
  if (options.workDir) {
    lines.push(`cd ${shellSingleQuote(options.workDir)} || exit 1`);
  }
  if (options.env) {
    for (const [key, value] of Object.entries(options.env)) {
      if (!isSafeEnvKey(key)) continue;
      lines.push(`export ${key}=${shellSingleQuote(value)}`);
    }
  }
  const quotedCommand = shellSingleQuote(options.command);
  lines.push(
    `timeout_sec=${options.timeoutSec}`,
    'if command -v timeout >/dev/null 2>&1; then',
    `  timeout --foreground --signal=TERM --kill-after=2 "$timeout_sec" bash -lc ${quotedCommand}`,
    '  rc=$?',
    'else',
    `  bash -lc ${quotedCommand}`,
    '  rc=$?',
    'fi',
    'exit $rc',
    '',
  );
  return lines.join('\n');
}

export function buildRemoteKillScript(jobId: string): string {
  const pidFile = `/tmp/cbssh-${jobId}.pid`;
  return [
    'set +e',
    `pidfile=${shellSingleQuote(pidFile)}`,
    'if [ -f "$pidfile" ]; then',
    '  pid=$(cat "$pidfile" 2>/dev/null)',
    '  if [ -n "$pid" ]; then',
    '    kill -TERM -"$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null',
    '    sleep 0.2',
    '    kill -KILL -"$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null',
    '  fi',
    '  rm -f "$pidfile"',
    'fi',
    'exit 0',
    '',
  ].join('\n');
}

function appendBounded(
  current: string,
  chunk: string,
  maxBytes: number,
  stream: 'stdout' | 'stderr',
  truncated: { value: boolean },
): string {
  if (truncated.value) return current;
  const next = current + chunk;
  if (Buffer.byteLength(next, 'utf8') <= maxBytes) {
    return next;
  }
  truncated.value = true;
  let cut = next;
  while (Buffer.byteLength(cut, 'utf8') > maxBytes && cut.length > 0) {
    cut = cut.slice(0, Math.max(0, cut.length - 64));
  }
  return cut + SSH_TRUNCATION_MARK(stream, maxBytes);
}

function failedResult(
  startTime: number,
  error: string,
  extras: Partial<SandboxExecResult> = {},
): SandboxExecResult {
  return {
    success: false,
    output: extras.output ?? '',
    error: scrubSecrets(error),
    exitCode: extras.exitCode ?? 1,
    durationMs: extras.durationMs ?? Date.now() - startTime,
    ...('containerId' in extras ? { containerId: extras.containerId } : {}),
  };
}

export function resolveExplicitSshSandboxRequest(
  env: NodeJS.ProcessEnv = process.env,
): { host: string; catalog: SshHostCatalog } | null {
  const backend = (env.CODEBUDDY_SANDBOX_BACKEND ?? '').trim().toLowerCase();
  if (backend !== 'ssh') return null;
  const host = (env.CODEBUDDY_SSH_HOST ?? '').trim();
  return { host, catalog: loadSshHostCatalog(env) };
}

export class SshSandbox implements SandboxBackendInterface {
  readonly name = SSH_SANDBOX_NAME;
  private readonly catalog: SshHostCatalog;
  private readonly defaultHost?: string;
  private readonly timeoutMs: number;
  private readonly maxOutputBytes: number;
  private readonly spawnImpl: SshCommandLauncher;
  private readonly hasSshClient: () => boolean;
  private readonly evaluatePolicy: (
    command: string,
    workDir: string,
  ) => SshPolicyDecision | Promise<SshPolicyDecision>;
  private readonly activeJobs = new Map<string, ActiveJob>();

  constructor(config: SshSandboxConfig = {}) {
    this.catalog = config.catalog ?? { hosts: config.hosts ?? loadSshHostCatalog().hosts };
    this.defaultHost = config.defaultHost;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_SSH_TIMEOUT_MS;
    this.maxOutputBytes = config.maxOutputBytes ?? DEFAULT_SSH_MAX_OUTPUT_BYTES;
    this.spawnImpl = config.spawn ?? ((command, args) =>
      defaultSpawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] }) as SshChildProcessLike);
    this.hasSshClient = config.hasSshClient ?? hasSshClientDefault;
    this.evaluatePolicy = config.evaluatePolicy ?? defaultEvaluatePolicy;
  }

  async isAvailable(): Promise<boolean> {
    return this.hasSshClient() && Object.keys(this.catalog.hosts).length > 0;
  }

  async execute(command: string, opts?: SshSandboxExecOptions): Promise<SandboxExecResult> {
    const startTime = Date.now();
    const logicalName = opts?.host ?? this.defaultHost;

    if (!logicalName) {
      return failedResult(startTime, "SSH host is not declared (pass sandbox: { backend: 'ssh', host: '<name>' })");
    }

    const host = lookupSshHost(this.catalog, logicalName);
    if (!host) {
      logger.warn(`SSH sandbox refused undeclared host '${logicalName}'`);
      return failedResult(startTime, `SSH host '${logicalName}' is not declared`);
    }

    if (!this.hasSshClient()) {
      return failedResult(startTime, 'SSH client is not available on this machine');
    }

    if (host.identityFile) {
      if (/BEGIN [A-Z ]*PRIVATE KEY/.test(host.identityFile) || host.identityFile.includes('\n')) {
        return failedResult(startTime, 'SSH identityFile must be a path to an existing key file');
      }
      try {
        if (!existsSync(host.identityFile) || !statSync(host.identityFile).isFile()) {
          return failedResult(startTime, `SSH identityFile does not exist for host '${logicalName}'`);
        }
      } catch {
        return failedResult(startTime, `SSH identityFile does not exist for host '${logicalName}'`);
      }
    }

    const remoteWorkDir = opts?.workDir ?? host.workDir ?? '/';
    let policy: SshPolicyDecision;
    try {
      policy = await this.evaluatePolicy(command, remoteWorkDir);
    } catch (error) {
      return failedResult(
        startTime,
        `Execution policy could not be evaluated: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (policy.action === 'deny' || policy.action === 'ask') {
      logger.warn(`SSH sandbox refused command on '${logicalName}': ${policy.reason}`);
      return failedResult(
        startTime,
        `Command refused by execution policy: ${policy.reason}`,
      );
    }

    const timeoutMs = opts?.timeout ?? this.timeoutMs;
    const timeoutSec = Math.max(1, Math.ceil(timeoutMs / 1000));
    const jobId = randomUUID().replace(/-/g, '').slice(0, 16);
    const sshArgs = buildSshClientArgs(host);
    const script = buildRemoteRunScript({
      jobId,
      command,
      workDir: opts?.workDir ?? host.workDir,
      env: opts?.env,
      timeoutSec,
    });

    logger.debug(`SSH sandbox exec host=${logicalName} job=${jobId} timeoutMs=${timeoutMs}`);

    return this.runSshJob({
      jobId,
      logicalName,
      host,
      sshArgs,
      script,
      startTime,
      timeoutMs,
      signal: opts?.signal,
    });
  }

  async kill(containerId: string): Promise<boolean> {
    const job = this.activeJobs.get(containerId);
    if (!job) return false;
    this.sendRemoteKill(job);
    try {
      job.proc.kill('SIGTERM');
    } catch {
      // already gone
    }
    return true;
  }

  async cleanup(): Promise<void> {
    for (const job of this.activeJobs.values()) {
      this.sendRemoteKill(job);
      try {
        job.proc.kill('SIGKILL');
      } catch {
        // already gone
      }
    }
    this.activeJobs.clear();
  }

  private runSshJob(params: {
    jobId: string;
    logicalName: string;
    host: SshHostDefinition;
    sshArgs: string[];
    script: string;
    startTime: number;
    timeoutMs: number;
    signal?: AbortSignal;
  }): Promise<SandboxExecResult> {
    const { jobId, logicalName, host, sshArgs, script, startTime, timeoutMs, signal } = params;

    return new Promise<SandboxExecResult>((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let killGrace: ReturnType<typeof setTimeout> | undefined;
      let onAbort: (() => void) | undefined;
      const settle = (result: SandboxExecResult): void => {
        if (settled) return;
        settled = true;
        this.activeJobs.delete(jobId);
        if (onAbort) signal?.removeEventListener('abort', onAbort);
        if (timer) clearTimeout(timer);
        if (killGrace) clearTimeout(killGrace);
        resolve(result);
      };

      let proc: SshChildProcessLike;
      try {
        proc = this.spawnImpl('ssh', sshArgs);
      } catch (error) {
        settle(failedResult(
          startTime,
          `SSH connection failed: ${error instanceof Error ? error.message : String(error)}`,
        ));
        return;
      }

      const job: ActiveJob = { id: jobId, proc, host, logicalName };
      this.activeJobs.set(jobId, job);

      let stdout = '';
      let stderr = '';
      const stdoutTruncated = { value: false };
      const stderrTruncated = { value: false };
      let timedOut = false;
      let aborted = false;

      proc.stdout?.on('data', (data: Buffer | string) => {
        stdout = appendBounded(
          stdout,
          typeof data === 'string' ? data : data.toString('utf8'),
          this.maxOutputBytes,
          'stdout',
          stdoutTruncated,
        );
      });
      proc.stderr?.on('data', (data: Buffer | string) => {
        stderr = appendBounded(
          stderr,
          typeof data === 'string' ? data : data.toString('utf8'),
          this.maxOutputBytes,
          'stderr',
          stderrTruncated,
        );
      });

      try {
        proc.stdin?.write(script);
        proc.stdin?.end();
      } catch {
        // launcher may not expose stdin
      }

      const abortSession = (kind: 'timeout' | 'abort'): void => {
        if (settled) return;
        if (kind === 'timeout') timedOut = true;
        else aborted = true;
        this.sendRemoteKill(job);
        try {
          proc.kill('SIGTERM');
        } catch {
          // already gone
        }
      };

      timer = setTimeout(() => abortSession('timeout'), timeoutMs);
      killGrace = setTimeout(() => {
        if (!settled && (timedOut || aborted)) {
          try {
            proc.kill('SIGKILL');
          } catch {
            // already gone
          }
        }
      }, timeoutMs + 2000);
      killGrace.unref?.();

      onAbort = (): void => abortSession('abort');
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();

      proc.on('error', (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        settle(failedResult(startTime, `SSH connection failed: ${message}`, { containerId: jobId }));
      });

      proc.on('close', (code: unknown) => {
        const exitCode = typeof code === 'number' ? code : 1;
        const durationMs = Date.now() - startTime;
        if (aborted) {
          settle({
            success: false,
            output: stdout,
            error: 'Command aborted by user',
            exitCode: 130,
            durationMs,
            containerId: jobId,
          });
          return;
        }
        if (timedOut) {
          settle({
            success: false,
            output: stdout,
            error: `Command timed out after ${timeoutMs}ms`,
            exitCode: exitCode || 124,
            durationMs,
            containerId: jobId,
          });
          return;
        }
        const connectionError = classifySshConnectionFailure(exitCode, stderr);
        if (connectionError) {
          settle(failedResult(startTime, connectionError, {
            output: stdout,
            exitCode,
            durationMs,
            containerId: jobId,
          }));
          return;
        }
        settle({
          success: exitCode === 0,
          output: stdout,
          error: stderr || undefined,
          exitCode,
          durationMs,
          containerId: jobId,
        });
      });
    });
  }

  private sendRemoteKill(job: ActiveJob): void {
    try {
      const killer = this.spawnImpl('ssh', buildSshClientArgs(job.host));
      try {
        killer.stdin?.write(buildRemoteKillScript(job.id));
        killer.stdin?.end();
      } catch {
        // ignore
      }
      const failSafe = setTimeout(() => {
        try {
          killer.kill('SIGKILL');
        } catch {
          // ignore
        }
      }, 5000);
      failSafe.unref?.();
      killer.on('close', () => clearTimeout(failSafe));
      killer.on('error', () => clearTimeout(failSafe));
    } catch (error) {
      logger.debug(
        `SSH remote kill spawn failed for job ${job.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export function createSshSandbox(config: SshSandboxConfig = {}): SshSandbox {
  return new SshSandbox(config);
}

/**
 * Register the SSH backend as explicit-only so auto-selection never picks it.
 */
export function ensureSshSandboxRegistered(config?: SshSandboxConfig): SshSandbox {
  const existing = getSandboxBackendByName(SSH_SANDBOX_NAME);
  if (existing instanceof SshSandbox) return existing;
  const backend = new SshSandbox(config);
  registerSandboxBackend(backend, 0, { explicitOnly: true });
  return backend;
}
