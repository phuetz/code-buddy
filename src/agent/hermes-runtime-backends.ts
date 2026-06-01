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
  routePlan: HermesRuntimeBackendRoutePlan;
  backends: HermesRuntimeBackend[];
  issues: string[];
  recommendations: string[];
}

export interface HermesRuntimeBackendRoutePlan {
  autoEligibleBackendIds?: string[];
  fallbackBackendIds: string[];
  gatedBackendIds?: string[];
  gatedBackends?: HermesRuntimeBackendRouteGate[];
  mode: 'hybrid';
  primaryBackendId: string | null;
  reason: string;
  smokeCommand: string | null;
}

export interface HermesRuntimeBackendRouteGate {
  backendId: string;
  label: string;
  reason: string;
  smokeCommand: string | null;
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
  allowDockerSmoke?: boolean;
  allowRemoteSmoke?: boolean;
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
}

interface SpawnInvocation {
  args: string[];
  command: string;
  windowsVerbatimArguments?: boolean;
}

const REMOTE_SMOKE_BACKEND_IDS = new Set(['ssh', 'modal', 'daytona', 'vercel-sandbox']);
const SAFE_AUTO_RUNTIME_BACKEND_IDS = ['local', 'wsl', 'os-sandbox', 'singularity'];

function firstPresentEnvValue(env: NodeJS.ProcessEnv, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  return null;
}

function isDockerSmokeAllowed(
  env: NodeJS.ProcessEnv,
  options: { allowDockerSmoke?: boolean },
): boolean {
  return options.allowDockerSmoke === true || env.CODEBUDDY_HERMES_ALLOW_DOCKER_SMOKE === 'true';
}

function isRemoteSmokeAllowed(
  env: NodeJS.ProcessEnv,
  options: { allowRemoteSmoke?: boolean },
): boolean {
  return options.allowRemoteSmoke === true || env.CODEBUDDY_HERMES_ALLOW_REMOTE_SMOKE === 'true';
}

function quoteWindowsCommandArg(value: string): string {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) {
    return value;
  }
  return `"${value.replace(/(["^&|<>%])/g, '^$1')}"`;
}

function resolveCommandForSpawn(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): SpawnInvocation {
  if (os.platform() !== 'win32' || path.isAbsolute(command) || command.includes('/') || command.includes('\\')) {
    return { command, args };
  }

  const probe = spawnSync('where.exe', [command], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 5000,
    windowsHide: true,
  });
  const resolved = firstLine(decodeProbeBuffer(probe.stdout));
  if (!resolved) {
    return { command, args };
  }

  if (!/\.(?:bat|cmd)$/i.test(resolved)) {
    return { command: resolved, args };
  }

  return {
    command: env.ComSpec || 'cmd.exe',
    args: ['/d', '/c', ['call', quoteWindowsCommandArg(resolved), ...args.map(quoteWindowsCommandArg)].join(' ')],
    windowsVerbatimArguments: true,
  };
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
  options: {
    allowDockerSmoke?: boolean;
    allowRemoteSmoke?: boolean;
    env: NodeJS.ProcessEnv;
  },
): SmokeInvocation | null {
  const { env } = options;
  if (backend.id === 'local') {
    return {
      command: process.execPath,
      args: ['-e', "console.log('OK-HERMES-LOCAL')"],
    };
  }

  if (backend.id === 'docker') {
    if (!isDockerSmokeAllowed(env, options)) {
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

  if (backend.id === 'os-sandbox' && backend.command === 'bwrap') {
    return {
      command: 'bwrap',
      args: [
        '--ro-bind',
        '/',
        '/',
        '--proc',
        '/proc',
        '--dev',
        '/dev',
        '--unshare-net',
        'sh',
        '-lc',
        'echo OK-HERMES-OS-SANDBOX',
      ],
    };
  }

  if (backend.id === 'os-sandbox' && backend.command === 'sandbox-exec') {
    return {
      command: 'sandbox-exec',
      args: ['-p', '(version 1) (allow default)', '/bin/echo', 'OK-HERMES-SEATBELT'],
    };
  }

  if (backend.id === 'singularity' && backend.command) {
    return {
      command: backend.command,
      args: ['--version'],
    };
  }

  if (REMOTE_SMOKE_BACKEND_IDS.has(backend.id)) {
    if (!isRemoteSmokeAllowed(env, options)) {
      return null;
    }

    if (backend.id === 'ssh') {
      const host = firstPresentEnvValue(env, ['CODEBUDDY_SSH_HOST', 'SSH_HOST', 'CODEBUDDY_REMOTE_HOST']);
      return host ? { command: 'ssh', args: ['-T', host, 'true'] } : null;
    }

    if (backend.id === 'modal') {
      return { command: 'modal', args: ['profile', 'current'] };
    }

    if (backend.id === 'daytona') {
      return { command: 'daytona', args: ['profile', 'list'] };
    }

    if (backend.id === 'vercel-sandbox') {
      return { command: 'vercel', args: ['whoami'] };
    }
  }

  return null;
}

function blockedSmokeReasonForBackend(
  backend: HermesRuntimeBackend,
  env: NodeJS.ProcessEnv,
  options: { allowDockerSmoke?: boolean; allowRemoteSmoke?: boolean },
): string {
  if (backend.id === 'docker' && !isDockerSmokeAllowed(env, options)) {
    return 'Docker smoke is heavy and requires --allow-docker or CODEBUDDY_HERMES_ALLOW_DOCKER_SMOKE=true.';
  }

  if (REMOTE_SMOKE_BACKEND_IDS.has(backend.id) && !isRemoteSmokeAllowed(env, options)) {
    return `${backend.label} smoke may contact a remote service and requires --allow-remote or CODEBUDDY_HERMES_ALLOW_REMOTE_SMOKE=true.`;
  }

  if (backend.id === 'ssh') {
    return 'SSH smoke requires an explicit CODEBUDDY_SSH_HOST, SSH_HOST, or CODEBUDDY_REMOTE_HOST value.';
  }

  return `${backend.label} does not have a safe live smoke runner yet.`;
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
  const spawnInvocation = resolveCommandForSpawn(invocation.command, invocation.args, options.env);
  const result = spawnSync(spawnInvocation.command, spawnInvocation.args, {
    env: options.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: options.timeoutMs,
    windowsVerbatimArguments: spawnInvocation.windowsVerbatimArguments,
    windowsHide: true,
  });
  const stdout = decodeProbeBuffer(result.stdout).trim();
  const stderr = decodeProbeBuffer(result.stderr).trim();
  const output = `${stdout}\n${stderr}`.trim();
  const ok = !result.error && result.status === 0;
  const errorOutput = result.error ? String(result.error.message || result.error) : '';
  const combinedOutput = output || errorOutput;

  return {
    args: invocation.args,
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
    const invocation = resolveCommandForSpawn(command, args, env);
    const result = spawnSync(invocation.command, invocation.args, {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5000,
      windowsVerbatimArguments: invocation.windowsVerbatimArguments,
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

function commandDisplayName(command: string | null): string | null {
  const trimmed = command?.trim();
  if (!trimmed) return null;
  const unquoted = trimmed.replace(/^["']|["']$/g, '');
  const segments = unquoted.split(/[\\/]/).filter(Boolean);
  if (path.isAbsolute(unquoted) || segments.length > 1) {
    return segments[segments.length - 1] ?? unquoted;
  }
  return unquoted;
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
    return fs.existsSync(sshConfigPath) ? [sshConfigPath] : [];
  } catch {
    return [];
  }
}

function localBackend(env: NodeJS.ProcessEnv): HermesRuntimeBackend {
  const probe = runProbe(process.execPath, ['--version'], env);
  const displayCommand = commandDisplayName(process.execPath) ?? 'node';
  return {
    id: 'local',
    label: 'Local process',
    officialSurface: 'local terminal backend',
    status: probe.ok ? 'available' : 'missing',
    installed: probe.ok,
    configured: true,
    runnable: probe.ok,
    command: displayCommand,
    version: firstLine(probe.output),
    credentialSources: [],
    smokeCommand: `${displayCommand} -e "console.log('OK-HERMES-LOCAL')"`,
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
    smokeCommand: configured ? 'ssh -T <configured-host> true' : 'ssh -V',
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

function buildRuntimeRoutePlan(backends: HermesRuntimeBackend[]): HermesRuntimeBackendRoutePlan {
  const runnableSafeBackends = SAFE_AUTO_RUNTIME_BACKEND_IDS
    .map((id) => backends.find((backend) => backend.id === id && backend.runnable))
    .filter(Boolean) as HermesRuntimeBackend[];
  const gatedBackends = buildRuntimeRouteGates(backends);
  const primary = runnableSafeBackends[0] ?? null;
  const fallbacks = runnableSafeBackends
    .filter((backend) => backend.id !== primary?.id)
    .map((backend) => backend.id);

  if (!primary) {
    return {
      autoEligibleBackendIds: [],
      fallbackBackendIds: [],
      gatedBackendIds: gatedBackends.map((backend) => backend.backendId),
      gatedBackends,
      mode: 'hybrid',
      primaryBackendId: null,
      reason: 'No safe runtime backend is currently runnable; install Node.js, WSL, or a native sandbox first.',
      smokeCommand: null,
    };
  }

  return {
    autoEligibleBackendIds: runnableSafeBackends.map((backend) => backend.id),
    fallbackBackendIds: fallbacks,
    gatedBackendIds: gatedBackends.map((backend) => backend.backendId),
    gatedBackends,
    mode: 'hybrid',
    primaryBackendId: primary.id,
    reason: fallbacks.length > 0
      ? `Auto runtime smoke will use ${primary.label}, with ${fallbacks.join(', ')} as fallback candidates.`
      : `Auto runtime smoke will use ${primary.label}; no secondary safe backend is currently runnable.`,
    smokeCommand: 'buddy hermes runtime-smoke auto --json',
  };
}

function buildRuntimeRouteGates(backends: HermesRuntimeBackend[]): HermesRuntimeBackendRouteGate[] {
  return backends.flatMap((backend) => {
    const reason = runtimeRouteGateReason(backend);
    return reason
      ? [{
        backendId: backend.id,
        label: backend.label,
        reason,
        smokeCommand: backend.smokeCommand,
      }]
      : [];
  });
}

function runtimeRouteGateReason(backend: HermesRuntimeBackend): string | null {
  if (!backend.runnable || SAFE_AUTO_RUNTIME_BACKEND_IDS.includes(backend.id)) {
    return null;
  }

  if (backend.id === 'docker') {
    return 'Docker is runnable but excluded from auto routing because its smoke can pull images and consume disk/network; opt in with `buddy hermes runtime-smoke docker --allow-docker --json`.';
  }

  if (REMOTE_SMOKE_BACKEND_IDS.has(backend.id)) {
    return `${backend.label} is runnable but excluded from auto routing because it may contact a remote service; opt in with \`buddy hermes runtime-smoke ${backend.id} --allow-remote --json\`.`;
  }

  return null;
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
  const routePlan = buildRuntimeRoutePlan(backends);
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
    routePlan,
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
    `Hybrid route: ${readiness.routePlan.primaryBackendId ?? 'none'}` +
      `${readiness.routePlan.smokeCommand ? ` | smoke: ${readiness.routePlan.smokeCommand}` : ''}`,
    '',
    'Backends:',
    ...readiness.backends.map(renderRuntimeBackendLine),
  ];

  if (readiness.issues.length > 0) {
    lines.push('', 'Issues:', ...readiness.issues.map((issue) => `- ${issue}`));
  }

  if (readiness.recommendations.length > 0) {
    lines.push('', 'Recommendations:', ...readiness.recommendations.map((recommendation) => `- ${recommendation}`));
  }

  const gatedBackends = readiness.routePlan.gatedBackends ?? [];
  if (gatedBackends.length > 0) {
    lines.push(
      '',
      'Gated auto-route backends:',
      ...gatedBackends.map((backend) => `- ${backend.backendId}: ${backend.reason}`),
    );
  }

  return lines.join('\n');
}

function renderRuntimeBackendLine(backend: HermesRuntimeBackend): string {
  const readinessFlags = `configured=${backend.configured ? 'yes' : 'no'}, runnable=${backend.runnable ? 'yes' : 'no'}`;
  const commandLabel = backend.runnable
    ? 'smoke'
    : backend.installed
      ? 'probe'
      : null;

  return `- ${backend.id}: ${backend.status}` +
    `${backend.version ? ` (${backend.version})` : ''}` +
    ` | ${readinessFlags}` +
    `${commandLabel && backend.smokeCommand ? ` | ${commandLabel}: ${backend.smokeCommand}` : ''}`;
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
  const timestamp = now();
  if (backendId === 'auto') {
    const primaryBackendId = readiness.routePlan.primaryBackendId;
    if (!primaryBackendId) {
      return blockedSmokeResult('auto', 'not-runnable', readiness.routePlan.reason, {
        command: readiness.routePlan.smokeCommand,
        now: timestamp,
      });
    }
    return runHermesRuntimeBackendSmoke({
      ...options,
      backendId: primaryBackendId,
      env,
      now,
    });
  }

  const backend = readiness.backends.find((candidate) => candidate.id === backendId);

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

  const invocation = smokeInvocationForBackend(backend, {
    allowDockerSmoke: options.allowDockerSmoke,
    allowRemoteSmoke: options.allowRemoteSmoke,
    env,
  });
  if (!invocation) {
    const reason = blockedSmokeReasonForBackend(backend, env, options);
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
