/**
 * Runtime backend readiness for the native Hermes-inspired profile.
 *
 * The check is intentionally non-destructive: it probes installed CLIs and
 * configuration sources, then prints copy/paste smoke commands for heavier
 * runtime validation such as Docker image pulls or remote workspace execution.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

export type HermesRuntimeBackendStatus = 'available' | 'configured' | 'missing' | 'unsupported';

export interface HermesRuntimeBackend {
  id: string;
  label: string;
  officialSurface: string;
  status: HermesRuntimeBackendStatus;
  installed: boolean;
  configured: boolean;
  runnable: boolean;
  command: string | null;
  version: string | null;
  credentialSources: string[];
  smokeCommand: string | null;
  notes: string[];
  remediation: string[];
}

export interface HermesRuntimeBackendsReadiness {
  ok: boolean;
  generatedAt: string;
  platform: NodeJS.Platform;
  arch: string;
  availableCount: number;
  configuredRemoteCount: number;
  runnableCount: number;
  backends: HermesRuntimeBackend[];
  issues: string[];
  recommendations: string[];
}

export type HermesRuntimeSmokeStatus = 'passed' | 'failed' | 'blocked' | 'unsupported' | 'not-runnable';

export interface HermesRuntimeSmokeResult {
  args: string[];
  backendId: string;
  command: string | null;
  durationMs: number;
  exitCode: number | null;
  finishedAt: string;
  label: string | null;
  ok: boolean;
  output: string;
  signal: NodeJS.Signals | null;
  startedAt: string;
  status: HermesRuntimeSmokeStatus;
  stderr: string;
  stdout: string;
}

export interface HermesRuntimeBackendsOptions {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  now?: () => Date;
}

export interface HermesRuntimeSmokeOptions extends HermesRuntimeBackendsOptions {
  backendId: string;
  timeoutMs?: number;
}

interface ProbeResult {
  exitCode: number | null;
  ok: boolean;
  output: string;
  signal: NodeJS.Signals | null;
}

interface SmokeInvocation {
  args: string[];
  command: string;
  displayArgs?: string[];
  redactions?: Array<{ replacement: string; value: string }>;
}

function blockedSmokeResult(
  backendId: string,
  status: HermesRuntimeSmokeStatus,
  output: string,
  options: {
    backend?: HermesRuntimeBackend;
    command?: string | null;
    args?: string[];
    now: Date;
  },
): HermesRuntimeSmokeResult {
  const timestamp = options.now.toISOString();
  return {
    args: options.args ?? [],
    backendId,
    command: options.command ?? null,
    durationMs: 0,
    exitCode: null,
    finishedAt: timestamp,
    label: options.backend?.label ?? null,
    ok: false,
    output,
    signal: null,
    startedAt: timestamp,
    status,
    stderr: output,
    stdout: '',
  };
}

function smokeInvocationForBackend(
  backend: HermesRuntimeBackend,
  env: NodeJS.ProcessEnv,
): SmokeInvocation | null {
  if (backend.id === 'local') {
    return {
      command: process.execPath,
      args: ['-e', "console.log('OK-HERMES-LOCAL')"],
    };
  }

  if (backend.id === 'docker') {
    if (env.CODEBUDDY_HERMES_ALLOW_DOCKER_SMOKE !== 'true') {
      return null;
    }
    return {
      command: 'docker',
      args: [
        'run',
        '--rm',
        '--network',
        'none',
        'node:22-slim',
        'node',
        '-e',
        "console.log('OK-HERMES-DOCKER')",
      ],
    };
  }

  if (backend.id === 'wsl') {
    return {
      command: 'wsl',
      args: ['--exec', 'sh', '-lc', 'echo OK-HERMES-WSL'],
    };
  }

  if (backend.id === 'ssh') {
    if (env.CODEBUDDY_HERMES_ALLOW_SSH_SMOKE !== 'true') {
      return null;
    }
    const host = sshSmokeHost(env);
    if (!host) {
      return null;
    }
    return {
      command: 'ssh',
      args: ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-T', host, 'true'],
      displayArgs: ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-T', '<configured-host>', 'true'],
      redactions: [{ value: host, replacement: '<configured-host>' }],
    };
  }

  return null;
}

function sshSmokeHost(env: NodeJS.ProcessEnv): string | null {
  for (const key of ['CODEBUDDY_SSH_HOST', 'SSH_HOST', 'CODEBUDDY_REMOTE_HOST']) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  return null;
}

function redactSmokeText(value: string, redactions: SmokeInvocation['redactions']): string {
  if (!redactions || value.length === 0) return value;
  let redacted = value;
  for (const redaction of redactions) {
    if (!redaction.value) continue;
    redacted = redacted.split(redaction.value).join(redaction.replacement);
  }
  return redacted;
}

function runSmokeInvocation(
  backend: HermesRuntimeBackend,
  invocation: SmokeInvocation,
  options: {
    env: NodeJS.ProcessEnv;
    now: () => Date;
    timeoutMs: number;
  },
): HermesRuntimeSmokeResult {
  const started = options.now();
  const startedAtMs = Date.now();
  const result = spawnSync(invocation.command, invocation.args, {
    env: options.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: options.timeoutMs,
    windowsHide: true,
  });
  const stdout = redactSmokeText(decodeProbeBuffer(result.stdout).trim(), invocation.redactions);
  const stderr = redactSmokeText(decodeProbeBuffer(result.stderr).trim(), invocation.redactions);
  const output = `${stdout}\n${stderr}`.trim();
  const ok = !result.error && result.status === 0;
  const errorOutput = result.error ? String(result.error.message || result.error) : '';
  const combinedOutput = output || errorOutput;

  return {
    args: invocation.displayArgs ?? invocation.args,
    backendId: backend.id,
    command: invocation.command,
    durationMs: Math.max(0, Date.now() - startedAtMs),
    exitCode: result.status,
    finishedAt: options.now().toISOString(),
    label: backend.label,
    ok,
    output: combinedOutput,
    signal: result.signal,
    startedAt: started.toISOString(),
    status: ok ? 'passed' : 'failed',
    stderr: stderr || errorOutput,
    stdout,
  };
}

function runProbe(command: string, args: string[], env: NodeJS.ProcessEnv): ProbeResult {
  try {
    const result = spawnSync(command, args, {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5000,
      windowsHide: true,
    });
    const stdout = decodeProbeBuffer(result.stdout);
    const stderr = decodeProbeBuffer(result.stderr);
    const output = `${stdout}\n${stderr}`.trim();
    return {
      exitCode: result.status,
      ok: !result.error && result.status === 0,
      output,
      signal: result.signal,
    };
  } catch {
    return {
      exitCode: null,
      ok: false,
      output: '',
      signal: null,
    };
  }
}

function decodeProbeBuffer(value: string | Buffer | null | undefined): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  const hasUtf16Pattern = value.length > 1 && value.includes(0);
  return value.toString(hasUtf16Pattern ? 'utf16le' : 'utf8');
}

function firstLine(value: string): string | null {
  const line = value.split(/\r?\n/).map((item) => item.trim()).find(Boolean);
  return line ?? null;
}

function presentEnvKeys(env: NodeJS.ProcessEnv, keys: readonly string[]): string[] {
  return keys.filter((key) => Boolean(env[key]?.trim()));
}

function hasExecutable(command: string, env: NodeJS.ProcessEnv): boolean {
  const probe = os.platform() === 'win32'
    ? runProbe('where.exe', [command], env)
    : runProbe('which', [command], env);
  return probe.ok;
}

function detectLandlockSupport(): boolean {
  try {
    if (fs.existsSync('/proc/sys/kernel/unprivileged_landlock_restrict')) {
      return true;
    }
  } catch {
    return false;
  }

  const match = os.release().match(/^(\d+)\.(\d+)/);
  if (!match) return false;
  const major = Number.parseInt(match[1] ?? '', 10);
  const minor = Number.parseInt(match[2] ?? '', 10);
  return Number.isFinite(major) && Number.isFinite(minor) && (major > 5 || (major === 5 && minor >= 13));
}

function readSshConfigSource(homeDir: string): string[] {
  const sshConfigPath = path.join(homeDir, '.ssh', 'config');
  try {
    return fs.existsSync(sshConfigPath) ? ['~/.ssh/config'] : [];
  } catch {
    return [];
  }
}

function localBackend(env: NodeJS.ProcessEnv): HermesRuntimeBackend {
  const probe = runProbe(process.execPath, ['--version'], env);
  return {
    id: 'local',
    label: 'Local process',
    officialSurface: 'local terminal backend',
    status: probe.ok ? 'available' : 'missing',
    installed: probe.ok,
    configured: true,
    runnable: probe.ok,
    command: process.execPath,
    version: firstLine(probe.output),
    credentialSources: [],
    smokeCommand: `"${process.execPath}" -e "console.log('OK-HERMES-LOCAL')"`,
    notes: ['Uses the current Node.js runtime and workspace filesystem.'],
    remediation: probe.ok ? [] : ['Install Node.js or run Code Buddy from a valid Node.js runtime.'],
  };
}

function dockerBackend(env: NodeJS.ProcessEnv): HermesRuntimeBackend {
  const versionProbe = runProbe('docker', ['--version'], env);
  const daemonProbe = runProbe('docker', ['info', '--format', '{{.ServerVersion}}'], env);
  const installed = versionProbe.ok;
  const runnable = daemonProbe.ok;
  return {
    id: 'docker',
    label: 'Docker sandbox',
    officialSurface: 'Docker terminal backend',
    status: installed ? 'available' : 'missing',
    installed,
    configured: runnable,
    runnable,
    command: 'docker',
    version: installed ? firstLine(versionProbe.output) : null,
    credentialSources: [],
    smokeCommand: 'docker run --rm --network none node:22-slim node -e "console.log(\'OK-HERMES-DOCKER\')"',
    notes: [
      'Doctor only runs docker info; the smoke command validates real container execution and may pull an image.',
      ...(installed && !runnable ? ['Docker CLI is installed but the daemon is not reachable.'] : []),
    ],
    remediation: runnable ? [] : [installed ? 'Start Docker Desktop or Docker Engine before selecting docker sandbox jobs.' : 'Install Docker Desktop or Docker Engine before selecting docker sandbox jobs.'],
  };
}

function wslBackend(env: NodeJS.ProcessEnv): HermesRuntimeBackend {
  const probe = runProbe('wsl', ['--status'], env);
  const supported = os.platform() === 'win32';
  return {
    id: 'wsl',
    label: 'WSL',
    officialSurface: 'WSL terminal backend',
    status: !supported ? 'unsupported' : probe.ok ? 'available' : 'missing',
    installed: supported && probe.ok,
    configured: supported && probe.ok,
    runnable: supported && probe.ok,
    command: 'wsl',
    version: firstLine(probe.output),
    credentialSources: [],
    smokeCommand: supported ? 'wsl --exec sh -lc "echo OK-HERMES-WSL"' : null,
    notes: supported ? ['Used by research-script jobs with sandboxPolicy.provider = wsl.'] : ['WSL is Windows-only.'],
    remediation: supported && !probe.ok ? ['Install WSL and a Linux distribution before selecting wsl jobs.'] : [],
  };
}

function osSandboxBackend(env: NodeJS.ProcessEnv): HermesRuntimeBackend {
  const platform = os.platform();
  if (platform === 'linux') {
    const bwrap = runProbe('bwrap', ['--version'], env);
    const landlock = detectLandlockSupport();
    return {
      id: 'os-sandbox',
      label: landlock && bwrap.ok ? 'Landlock/bubblewrap sandbox' : 'Bubblewrap sandbox',
      officialSurface: 'native OS sandbox backend',
      status: bwrap.ok ? 'available' : 'missing',
      installed: bwrap.ok,
      configured: bwrap.ok,
      runnable: bwrap.ok,
      command: 'bwrap',
      version: firstLine(bwrap.output),
      credentialSources: [],
      smokeCommand: bwrap.ok ? 'bwrap --ro-bind / / --proc /proc --dev /dev --unshare-net sh -lc "echo OK-HERMES-OS-SANDBOX"' : null,
      notes: [
        landlock ? 'Kernel advertises Landlock support.' : 'Landlock support was not detected; bubblewrap remains the fallback.',
      ],
      remediation: bwrap.ok ? [] : ['Install bubblewrap to enable native Linux sandboxing.'],
    };
  }

  if (platform === 'darwin') {
    const installed = hasExecutable('sandbox-exec', env);
    return {
      id: 'os-sandbox',
      label: 'macOS seatbelt sandbox',
      officialSurface: 'native OS sandbox backend',
      status: installed ? 'available' : 'missing',
      installed,
      configured: installed,
      runnable: installed,
      command: 'sandbox-exec',
      version: null,
      credentialSources: [],
      smokeCommand: installed ? 'sandbox-exec -p "(version 1) (allow default)" /bin/echo OK-HERMES-SEATBELT' : null,
      notes: ['Uses the built-in macOS seatbelt sandbox.'],
      remediation: installed ? [] : ['sandbox-exec was not found on this macOS host.'],
    };
  }

  return {
    id: 'os-sandbox',
    label: 'Native OS sandbox',
    officialSurface: 'native OS sandbox backend',
    status: 'unsupported',
    installed: false,
    configured: false,
    runnable: false,
    command: null,
    version: null,
    credentialSources: [],
    smokeCommand: null,
    notes: ['No native OS sandbox backend is implemented for this platform; use Docker/WSL when available.'],
    remediation: [],
  };
}

function sshBackend(env: NodeJS.ProcessEnv, homeDir: string): HermesRuntimeBackend {
  const probe = runProbe('ssh', ['-V'], env);
  const configuredSources = [
    ...presentEnvKeys(env, ['CODEBUDDY_SSH_HOST', 'SSH_HOST', 'CODEBUDDY_REMOTE_HOST']),
    ...readSshConfigSource(homeDir),
  ];
  const configured = configuredSources.length > 0;
  return {
    id: 'ssh',
    label: 'SSH remote shell',
    officialSurface: 'SSH terminal backend',
    status: probe.ok && configured ? 'configured' : probe.ok ? 'available' : 'missing',
    installed: probe.ok,
    configured,
    runnable: probe.ok && configured,
    command: 'ssh',
    version: firstLine(probe.output),
    credentialSources: configuredSources,
    smokeCommand: configured ? 'CODEBUDDY_HERMES_ALLOW_SSH_SMOKE=true ssh -o BatchMode=yes -o ConnectTimeout=10 -T <configured-host> true' : 'ssh -V',
    notes: ['Code Buddy has SSH/device transport primitives; exact Hermes remote-backend lifecycle is still product-specific.'],
    remediation: probe.ok ? ['Configure CODEBUDDY_SSH_HOST or ~/.ssh/config before selecting SSH jobs.'] : ['Install an OpenSSH client.'],
  };
}

function singularityBackend(env: NodeJS.ProcessEnv): HermesRuntimeBackend {
  const apptainer = runProbe('apptainer', ['--version'], env);
  const singularity = apptainer.ok ? apptainer : runProbe('singularity', ['--version'], env);
  const command = apptainer.ok ? 'apptainer' : 'singularity';
  const ok = singularity.ok;
  return {
    id: 'singularity',
    label: 'Singularity/Apptainer',
    officialSurface: 'Singularity terminal backend',
    status: ok ? 'available' : 'missing',
    installed: ok,
    configured: ok,
    runnable: ok,
    command,
    version: firstLine(singularity.output),
    credentialSources: [],
    smokeCommand: ok ? `${command} --version` : null,
    notes: ['Detected as an optional HPC/container backend; no first-class Code Buddy runner is wired yet.'],
    remediation: ok ? ['Wire a first-class runner before claiming full Hermes Singularity parity.'] : ['Install Apptainer/Singularity if this backend is required.'],
  };
}

function modalBackend(env: NodeJS.ProcessEnv): HermesRuntimeBackend {
  const probe = runProbe('modal', ['--version'], env);
  const credentialSources = presentEnvKeys(env, ['MODAL_TOKEN_ID', 'MODAL_TOKEN_SECRET', 'MODAL_PROFILE']);
  const configured = credentialSources.includes('MODAL_PROFILE') ||
    (credentialSources.includes('MODAL_TOKEN_ID') && credentialSources.includes('MODAL_TOKEN_SECRET'));
  return {
    id: 'modal',
    label: 'Modal',
    officialSurface: 'Modal cloud terminal backend',
    status: probe.ok && configured ? 'configured' : probe.ok ? 'available' : 'missing',
    installed: probe.ok,
    configured,
    runnable: probe.ok && configured,
    command: 'modal',
    version: firstLine(probe.output),
    credentialSources,
    smokeCommand: configured ? 'modal profile current' : 'modal --version',
    notes: ['Modal is currently an optional provider/tool gateway surface, not a full terminal backend.'],
    remediation: probe.ok ? ['Configure Modal credentials before selecting Modal jobs.'] : ['Install the Modal CLI if cloud terminal jobs are required.'],
  };
}

function daytonaBackend(env: NodeJS.ProcessEnv): HermesRuntimeBackend {
  const probe = runProbe('daytona', ['--version'], env);
  const credentialSources = presentEnvKeys(env, ['DAYTONA_API_KEY', 'DAYTONA_SERVER_URL', 'DAYTONA_PROFILE']);
  const configured = credentialSources.length > 0;
  return {
    id: 'daytona',
    label: 'Daytona',
    officialSurface: 'Daytona remote terminal backend',
    status: probe.ok && configured ? 'configured' : probe.ok ? 'available' : 'missing',
    installed: probe.ok,
    configured,
    runnable: probe.ok && configured,
    command: 'daytona',
    version: firstLine(probe.output),
    credentialSources,
    smokeCommand: configured ? 'daytona profile list' : 'daytona --version',
    notes: ['Research-script remote jobs currently translate to daytona exec, but no managed lifecycle is claimed.'],
    remediation: probe.ok ? ['Configure Daytona credentials/workspaces before selecting remote jobs.'] : ['Install the Daytona CLI if this backend is required.'],
  };
}

function vercelSandboxBackend(env: NodeJS.ProcessEnv): HermesRuntimeBackend {
  const probe = runProbe('vercel', ['--version'], env);
  const credentialSources = presentEnvKeys(env, ['VERCEL_TOKEN', 'VERCEL_TEAM_ID', 'VERCEL_ORG_ID']);
  const configured = credentialSources.includes('VERCEL_TOKEN');
  return {
    id: 'vercel-sandbox',
    label: 'Vercel Sandbox',
    officialSurface: 'Vercel Sandbox remote backend',
    status: probe.ok && configured ? 'configured' : probe.ok ? 'available' : 'missing',
    installed: probe.ok,
    configured,
    runnable: probe.ok && configured,
    command: 'vercel',
    version: firstLine(probe.output),
    credentialSources,
    smokeCommand: configured ? 'vercel whoami' : 'vercel --version',
    notes: ['Vercel Sandbox is tracked as an optional remote backend; Code Buddy has no first-class runner yet.'],
    remediation: probe.ok ? ['Configure VERCEL_TOKEN before attempting remote Vercel jobs.'] : ['Install the Vercel CLI if this backend is required.'],
  };
}

export function buildHermesRuntimeBackendsReadiness(
  options: HermesRuntimeBackendsOptions = {},
): HermesRuntimeBackendsReadiness {
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? os.homedir();
  const now = options.now ?? (() => new Date());
  const backends = [
    localBackend(env),
    osSandboxBackend(env),
    dockerBackend(env),
    wslBackend(env),
    sshBackend(env, homeDir),
    singularityBackend(env),
    modalBackend(env),
    daytonaBackend(env),
    vercelSandboxBackend(env),
  ];
  const isolatedBackends = backends.filter((backend) =>
    ['os-sandbox', 'docker', 'wsl'].includes(backend.id) && backend.runnable,
  );
  const configuredRemoteBackends = backends.filter((backend) =>
    ['ssh', 'modal', 'daytona', 'vercel-sandbox'].includes(backend.id) && backend.configured,
  );
  const issues: string[] = [];
  const recommendations: string[] = [];

  if (isolatedBackends.length === 0) {
    issues.push('No isolated local runtime backend is currently runnable (Docker, WSL, or native OS sandbox).');
  }

  if (configuredRemoteBackends.length === 0) {
    recommendations.push('Configure SSH, Modal, Daytona, or Vercel Sandbox only if remote Hermes-style execution is a product goal.');
  }

  if (!backends.some((backend) => backend.id === 'docker' && backend.runnable)) {
    recommendations.push('Run the Docker smoke command when Docker is available to prove real sandbox execution, not just CLI presence.');
  }

  return {
    ok: issues.length === 0,
    generatedAt: now().toISOString(),
    platform: os.platform(),
    arch: os.arch(),
    availableCount: backends.filter((backend) => backend.installed).length,
    configuredRemoteCount: configuredRemoteBackends.length,
    runnableCount: backends.filter((backend) => backend.runnable).length,
    backends,
    issues,
    recommendations,
  };
}

export function renderHermesRuntimeBackendsReadiness(readiness: HermesRuntimeBackendsReadiness): string {
  const lines = [
    `Hermes runtime backends: ${readiness.ok ? 'ok' : 'needs attention'}`,
    `Platform: ${readiness.platform}/${readiness.arch}`,
    `Available: ${readiness.availableCount}/${readiness.backends.length}`,
    `Runnable: ${readiness.runnableCount}/${readiness.backends.length}`,
    `Configured remote: ${readiness.configuredRemoteCount}`,
    '',
    'Backends:',
    ...readiness.backends.map((backend) =>
      `- ${backend.id}: ${backend.status}` +
      `${backend.version ? ` (${backend.version})` : ''}` +
      `${backend.smokeCommand ? ` | smoke: ${backend.smokeCommand}` : ''}`,
    ),
  ];

  if (readiness.issues.length > 0) {
    lines.push('', 'Issues:', ...readiness.issues.map((issue) => `- ${issue}`));
  }

  if (readiness.recommendations.length > 0) {
    lines.push('', 'Recommendations:', ...readiness.recommendations.map((recommendation) => `- ${recommendation}`));
  }

  return lines.join('\n');
}

export function runHermesRuntimeBackendSmoke(
  options: HermesRuntimeSmokeOptions,
): HermesRuntimeSmokeResult {
  const env = options.env ?? process.env;
  const now = options.now ?? (() => new Date());
  const readiness = buildHermesRuntimeBackendsReadiness({
    env,
    homeDir: options.homeDir,
    now,
  });
  const backendId = options.backendId.trim();
  const backend = readiness.backends.find((candidate) => candidate.id === backendId);
  const timestamp = now();

  if (!backend) {
    return blockedSmokeResult(backendId, 'unsupported', `Unknown runtime backend: ${backendId}`, {
      now: timestamp,
    });
  }

  if (!backend.runnable) {
    return blockedSmokeResult(backend.id, 'not-runnable', `${backend.label} is not runnable on this host.`, {
      backend,
      command: backend.command,
      now: timestamp,
    });
  }

  const invocation = smokeInvocationForBackend(backend, env);
  if (!invocation) {
    const reason = backend.id === 'docker'
      ? 'Docker smoke is heavy and requires CODEBUDDY_HERMES_ALLOW_DOCKER_SMOKE=true.'
      : backend.id === 'ssh'
        ? 'SSH smoke requires CODEBUDDY_HERMES_ALLOW_SSH_SMOKE=true and an explicit CODEBUDDY_SSH_HOST/SSH_HOST/CODEBUDDY_REMOTE_HOST.'
      : `${backend.label} does not have a safe live smoke runner yet.`;
    return blockedSmokeResult(backend.id, 'blocked', reason, {
      backend,
      command: backend.command,
      now: timestamp,
    });
  }

  return runSmokeInvocation(backend, invocation, {
    env,
    now,
    timeoutMs: Math.max(1000, Math.min(options.timeoutMs ?? 15_000, 60_000)),
  });
}
