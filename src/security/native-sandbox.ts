/**
 * Opt-in kernel confinement for shell commands (Bubblewrap / Landlock / seatbelt).
 *
 * Pure argv builders + injectable IO. When CODEBUDDY_NATIVE_SANDBOX is unset the
 * spawn argv is returned unchanged (no probe). When it is set and confinement
 * cannot be applied, the command is refused — never executed unsandboxed.
 */

import { spawnSync as realSpawnSync, type SpawnSyncOptions, type SpawnSyncReturns } from 'child_process';
import { existsSync as realExistsSync, mkdirSync as realMkdirSync, readFileSync as realReadFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';

export const NATIVE_SANDBOX_ENV = 'CODEBUDDY_NATIVE_SANDBOX';

export type NativeSandboxBackend = 'none' | 'bwrap' | 'landlock' | 'seatbelt';
export type RequestedNativeSandboxBackend = 'auto' | 'bwrap' | 'landlock' | 'seatbelt';

const OFF_TOKENS = new Set(['', '0', 'false', 'off', 'no', 'none', 'disabled']);

const DEFAULT_RO_ROOTS = ['/usr', '/bin', '/lib', '/lib64', '/sbin', '/proc', '/dev', '/opt', '/nix', '/snap'];
const FORBIDDEN_WRITABLE_ROOTS = new Set(['/', '/etc', '/tmp', '/var', '/var/tmp', '/usr', '/bin', '/sbin', '/root', '/home']);
const HOME_SECRET_NAMES = ['.ssh', '.gnupg', '.codebuddy', '.aws', '.kube', '.docker', '.netrc', '.npmrc'];

const LANDLOCK_ABI_PROBE = [
  'import ctypes,sys',
  "l=ctypes.CDLL('libc.so.6',use_errno=True)",
  'l.syscall.restype=ctypes.c_long',
  'print(int(l.syscall(444,None,0,1)))',
].join(';');

export interface NativeSandboxPolicy {
  projectRoot: string;
  tmpDir: string;
  homeDir: string;
  chdir: string;
  network: boolean;
  hidePaths: string[];
  readOnlyRoots: string[];
}

export interface NativeSandboxCapabilities {
  platform: NodeJS.Platform;
  bwrapPath: string | null;
  bwrapVersion: string | null;
  bwrapUsable: boolean;
  bwrapUnusableReason: string | null;
  landlockAbi: number | null;
  sandboxExecPath: string | null;
  pythonPath: string | null;
  recommended: NativeSandboxBackend;
  reason: string;
}

export interface ConfineSpawnInput {
  file: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  projectRoot?: string;
  network?: boolean;
}

export type ConfineSpawnResult =
  | { ok: true; file: string; args: string[]; env: NodeJS.ProcessEnv; backend: NativeSandboxBackend }
  | { ok: false; error: string };

type SpawnSyncFn = (
  command: string,
  args?: readonly string[],
  options?: SpawnSyncOptions,
) => SpawnSyncReturns<string | Buffer>;

export interface NativeSandboxIo {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homedir?: () => string;
  existsSync?: (target: string) => boolean;
  mkdirSync?: (target: string, options?: { recursive?: boolean }) => void;
  readFileSync?: (target: string, encoding: BufferEncoding) => string;
  spawnSync?: SpawnSyncFn;
  kernelRelease?: () => string;
  capabilities?: NativeSandboxCapabilities;
  helperPath?: string;
}

let cachedCapabilities: NativeSandboxCapabilities | null = null;

export function isNativeSandboxEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[NATIVE_SANDBOX_ENV];
  if (raw == null) return false;
  return !OFF_TOKENS.has(raw.trim().toLowerCase());
}

export function requestedNativeSandboxBackend(
  env: NodeJS.ProcessEnv = process.env,
): RequestedNativeSandboxBackend {
  const raw = (env[NATIVE_SANDBOX_ENV] ?? '').trim().toLowerCase();
  if (raw === 'bwrap' || raw === 'bubblewrap') return 'bwrap';
  if (raw === 'landlock') return 'landlock';
  if (raw === 'seatbelt' || raw === 'sandbox-exec') return 'seatbelt';
  return 'auto';
}

export function clearNativeSandboxCache(): void {
  cachedCapabilities = null;
}

function findOnPath(cmd: string, env: NodeJS.ProcessEnv, existsSync: (p: string) => boolean): string | null {
  if (cmd.includes('/') || cmd.includes('\\')) {
    return existsSync(cmd) ? cmd : null;
  }
  const pathVar = env.PATH ?? env.Path ?? '';
  for (const dir of pathVar.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, cmd);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function spawnText(
  spawnSync: SpawnSyncFn,
  command: string,
  args: string[],
  timeout = 2000,
): { status: number | null; stdout: string; stderr: string } {
  try {
    const result = spawnSync(command, args, {
      encoding: 'utf8',
      timeout,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return {
      status: typeof result.status === 'number' ? result.status : null,
      stdout: typeof result.stdout === 'string' ? result.stdout : '',
      stderr: typeof result.stderr === 'string' ? result.stderr : '',
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: 1, stdout: '', stderr: message };
  }
}

function abiFromKernelRelease(release: string): number | null {
  const match = release.match(/^(\d+)\.(\d+)/);
  if (!match?.[1] || !match[2]) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return null;
  if (major < 5 || (major === 5 && minor < 13)) return null;
  if (major > 6 || (major === 6 && minor >= 12)) return 7;
  if (minor >= 10) return 6;
  if (minor >= 7) return 5;
  if (minor >= 5) return 4;
  if (minor >= 2) return 3;
  if (major === 5 && minor >= 19) return 2;
  return 1;
}

function probeLandlockAbi(io: Required<Pick<NativeSandboxIo, 'platform' | 'spawnSync' | 'kernelRelease' | 'existsSync' | 'readFileSync'>>, pythonPath: string | null): number | null {
  if (io.platform !== 'linux') return null;
  if (pythonPath) {
    const probed = spawnText(io.spawnSync, pythonPath, ['-c', LANDLOCK_ABI_PROBE], 2000);
    if (probed.status === 0) {
      const abi = Number.parseInt(probed.stdout.trim(), 10);
      if (Number.isInteger(abi) && abi >= 1) return abi;
    }
  }
  try {
    const kallsyms = io.readFileSync('/proc/kallsyms', 'utf8');
    if (kallsyms && !kallsyms.includes('landlock_create_ruleset')) {
      return abiFromKernelRelease(io.kernelRelease());
    }
  } catch {
    // /proc/kallsyms may be unreadable; kernel version is the fallback.
  }
  return abiFromKernelRelease(io.kernelRelease());
}

function probeBwrap(
  spawnSync: SpawnSyncFn,
  bwrapPath: string,
  existsSync: (p: string) => boolean,
): { usable: boolean; reason: string | null; version: string | null } {
  const versionRun = spawnText(spawnSync, bwrapPath, ['--version'], 1500);
  const version = versionRun.status === 0 ? versionRun.stdout.trim() || versionRun.stderr.trim() || null : null;
  const trueBin = existsSync('/bin/true') ? '/bin/true' : 'true';
  const probe = spawnText(
    spawnSync,
    bwrapPath,
    ['--unshare-user', '--die-with-parent', '--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', trueBin],
    2000,
  );
  if (probe.status === 0) {
    return { usable: true, reason: null, version };
  }
  const detail = (probe.stderr || probe.stdout).trim() || `exit ${probe.status ?? 'unknown'}`;
  return { usable: false, reason: detail, version };
}

function resolveRecommended(caps: Omit<NativeSandboxCapabilities, 'recommended' | 'reason'>): Pick<NativeSandboxCapabilities, 'recommended' | 'reason'> {
  if (caps.platform === 'linux' && caps.bwrapUsable && caps.bwrapPath) {
    return { recommended: 'bwrap', reason: `bubblewrap ${caps.bwrapVersion || caps.bwrapPath} usable` };
  }
  if (caps.platform === 'linux' && caps.landlockAbi && caps.landlockAbi >= 1 && caps.pythonPath) {
    const bwrapNote = caps.bwrapPath
      ? `bubblewrap ${caps.bwrapPath} present but unusable (${caps.bwrapUnusableReason || 'probe failed'})`
      : 'bubblewrap not found';
    return {
      recommended: 'landlock',
      reason: `Landlock ABI ${caps.landlockAbi} usable; ${bwrapNote}`,
    };
  }
  if (caps.platform === 'darwin' && caps.sandboxExecPath) {
    return { recommended: 'seatbelt', reason: `sandbox-exec ${caps.sandboxExecPath} present` };
  }
  const parts: string[] = [];
  if (caps.platform === 'linux') {
    if (!caps.bwrapPath) parts.push('bubblewrap not found');
    else parts.push(`bubblewrap unusable (${caps.bwrapUnusableReason || 'probe failed'})`);
    if (!caps.landlockAbi) parts.push('Landlock ABI not detected');
    else if (!caps.pythonPath) parts.push(`Landlock ABI ${caps.landlockAbi} detected but python3 is missing`);
  } else if (caps.platform === 'darwin') {
    parts.push('sandbox-exec not found');
  } else {
    parts.push(`${caps.platform} has no Landlock/bubblewrap/seatbelt backend`);
  }
  return { recommended: 'none', reason: parts.join('; ') };
}

export function detectNativeSandboxCapabilities(io: NativeSandboxIo = {}): NativeSandboxCapabilities {
  if (io.capabilities) return io.capabilities;
  if (cachedCapabilities && !io.platform && !io.env && !io.spawnSync) {
    return cachedCapabilities;
  }
  const env = io.env ?? process.env;
  const platform = io.platform ?? process.platform;
  const existsSync = io.existsSync ?? realExistsSync;
  const spawnSync = io.spawnSync ?? realSpawnSync;
  const readFileSync = io.readFileSync ?? realReadFileSync;
  const kernelRelease = io.kernelRelease ?? os.release;

  const bwrapPath = platform === 'linux' ? findOnPath('bwrap', env, existsSync) : null;
  const pythonPath =
    platform === 'linux'
      ? findOnPath('python3', env, existsSync) ?? findOnPath('python', env, existsSync)
      : null;
  const sandboxExecPath = platform === 'darwin' ? findOnPath('sandbox-exec', env, existsSync) : null;

  let bwrapUsable = false;
  let bwrapUnusableReason: string | null = null;
  let bwrapVersion: string | null = null;
  if (bwrapPath) {
    const probed = probeBwrap(spawnSync, bwrapPath, existsSync);
    bwrapUsable = probed.usable;
    bwrapUnusableReason = probed.reason;
    bwrapVersion = probed.version;
  } else if (platform === 'linux') {
    bwrapUnusableReason = 'bwrap not found on PATH';
  }

  const landlockAbi = probeLandlockAbi(
    { platform, spawnSync, kernelRelease, existsSync, readFileSync },
    pythonPath,
  );

  const partial = {
    platform,
    bwrapPath,
    bwrapVersion,
    bwrapUsable,
    bwrapUnusableReason,
    landlockAbi,
    sandboxExecPath,
    pythonPath,
  };
  const rec = resolveRecommended(partial);
  const caps: NativeSandboxCapabilities = { ...partial, ...rec };
  if (!io.platform && !io.env && !io.spawnSync) {
    cachedCapabilities = caps;
  }
  return caps;
}

export function formatDoctorLine(caps: NativeSandboxCapabilities): string {
  const enabledHint = `opt-in ${NATIVE_SANDBOX_ENV}=true (fail-closed if confinement cannot be applied)`;
  if (caps.recommended === 'none') {
    return `Native sandbox: unavailable — ${caps.reason}. ${enabledHint}`;
  }
  if (caps.recommended === 'bwrap') {
    const landlock = caps.landlockAbi ? `; Landlock ABI ${caps.landlockAbi}` : '';
    return `Native sandbox: bubblewrap ${caps.bwrapPath ?? 'bwrap'} usable${landlock}. ${enabledHint}`;
  }
  if (caps.recommended === 'landlock') {
    return `Native sandbox: ${caps.reason}. ${enabledHint}`;
  }
  return `Native sandbox: seatbelt (${caps.sandboxExecPath}). ${enabledHint}`;
}

export function buildBwrapArgv(policy: NativeSandboxPolicy, command: string[]): string[] {
  const argv: string[] = [
    '--die-with-parent',
    '--new-session',
    '--unshare-user',
    '--unshare-pid',
    '--unshare-uts',
    '--unshare-ipc',
    '--unshare-cgroup',
  ];
  if (!policy.network) argv.push('--unshare-net');
  argv.push('--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc');
  argv.push('--tmpfs', '/tmp', '--remount-ro', '/tmp');
  argv.push('--bind', policy.projectRoot, policy.projectRoot);
  argv.push('--bind', policy.tmpDir, policy.tmpDir);
  for (const hide of policy.hidePaths) {
    argv.push('--tmpfs', hide, '--remount-ro', hide);
  }
  argv.push('--chdir', policy.chdir);
  argv.push('--setenv', 'TMPDIR', policy.tmpDir);
  argv.push('--', ...command);
  return argv;
}

export function buildLandlockArgv(
  policy: NativeSandboxPolicy,
  command: string[],
  helperPath: string,
): string[] {
  const argv: string[] = [helperPath, '--project', policy.projectRoot, '--tmp', policy.tmpDir];
  for (const root of policy.readOnlyRoots) {
    argv.push('--ro', root);
  }
  argv.push('--chdir', policy.chdir);
  if (policy.network) argv.push('--network');
  argv.push('--', ...command);
  return argv;
}

function seatbeltQuote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function buildSeatbeltProfile(policy: NativeSandboxPolicy): string {
  const lines = [
    '(version 1)',
    '(deny default)',
    '(allow file-read*)',
    '(allow process-exec)',
    '(allow process-fork)',
    '(allow signal (target same-sandbox))',
    '(allow sysctl-read)',
    '(allow file-write* (literal "/dev/null"))',
    `(allow file-write* (subpath ${seatbeltQuote(policy.projectRoot)}))`,
    `(allow file-write* (subpath ${seatbeltQuote(policy.tmpDir)}))`,
  ];
  for (const hide of policy.hidePaths) {
    lines.push(`(deny file-read* file-write* (subpath ${seatbeltQuote(hide)}))`);
  }
  if (policy.network) {
    lines.push('(allow network*)');
  }
  return lines.join('\n');
}

export function buildSeatbeltArgv(profile: string, command: string[]): string[] {
  return ['-p', profile, ...command];
}

function defaultHidePaths(homeDir: string): string[] {
  return [
    '/etc',
    ...HOME_SECRET_NAMES.map((name) => path.join(homeDir, name)),
    path.join(homeDir, '.docker', 'config.json'),
    path.join(homeDir, '.config', 'gh'),
    path.join(homeDir, '.config', 'gcloud'),
  ];
}

function isForbiddenWritableRoot(resolved: string, homeDir: string): boolean {
  if (FORBIDDEN_WRITABLE_ROOTS.has(resolved)) return true;
  if (resolved === homeDir) return true;
  for (const name of HOME_SECRET_NAMES) {
    const secret = path.join(homeDir, name);
    if (resolved === secret || resolved.startsWith(`${secret}${path.sep}`)) return true;
  }
  return false;
}

export function resolveLandlockHelperPath(existsSync: (p: string) => boolean = realExistsSync): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, 'landlock-confine.py'),
    path.join(here, '..', '..', 'src', 'security', 'landlock-confine.py'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function existingPaths(paths: string[], existsSync: (p: string) => boolean): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of paths) {
    if (!item || seen.has(item)) continue;
    seen.add(item);
    if (existsSync(item)) out.push(item);
  }
  return out;
}

export function buildDefaultPolicy(
  cwd: string,
  io: NativeSandboxIo = {},
): NativeSandboxPolicy | { error: string } {
  const existsSync = io.existsSync ?? realExistsSync;
  const homedir = io.homedir ?? os.homedir;
  const homeDir = homedir();
  const projectRoot = path.resolve(cwd);
  if (isForbiddenWritableRoot(projectRoot, path.resolve(homeDir))) {
    return {
      error:
        `${NATIVE_SANDBOX_ENV} is set, but the working directory ${projectRoot} is not a safe writable root ` +
        `(home, /tmp, /etc and similar paths cannot be the sandbox project). The command was not executed.`,
    };
  }
  const tmpDir = path.join(projectRoot, '.codebuddy', 'native-sandbox-tmp');
  return {
    projectRoot,
    tmpDir,
    homeDir,
    chdir: projectRoot,
    network: false,
    hidePaths: existingPaths(defaultHidePaths(homeDir), existsSync),
    readOnlyRoots: existingPaths(DEFAULT_RO_ROOTS, existsSync),
  };
}

function refusal(reason: string): ConfineSpawnResult {
  return {
    ok: false,
    error: `${NATIVE_SANDBOX_ENV} is set, but kernel confinement cannot be applied: ${reason} The command was not executed.`,
  };
}

function selectBackend(
  requested: RequestedNativeSandboxBackend,
  caps: NativeSandboxCapabilities,
): NativeSandboxBackend | { error: string } {
  const want = requested === 'auto' ? caps.recommended : requested;
  if (want === 'none') {
    return { error: `${caps.reason}.` };
  }
  if (want === 'bwrap' && !caps.bwrapUsable) {
    return {
      error: `bubblewrap is ${caps.bwrapPath ? 'present but unusable' : 'not available'} (${caps.bwrapUnusableReason || 'probe failed'}).`,
    };
  }
  if (want === 'landlock' && !(caps.landlockAbi && caps.landlockAbi >= 1 && caps.pythonPath)) {
    return {
      error: caps.pythonPath
        ? 'Landlock ABI is not available.'
        : 'python3 is required to apply Landlock and was not found.',
    };
  }
  if (want === 'seatbelt' && !caps.sandboxExecPath) {
    return { error: 'sandbox-exec is not available on this platform.' };
  }
  return want;
}

export function confineSpawn(input: ConfineSpawnInput, io: NativeSandboxIo = {}): ConfineSpawnResult {
  const flagEnv = io.env ?? process.env;
  if (!isNativeSandboxEnabled(flagEnv)) {
    return { ok: true, file: input.file, args: input.args, env: input.env, backend: 'none' };
  }

  const caps = detectNativeSandboxCapabilities(io);
  const selected = selectBackend(requestedNativeSandboxBackend(flagEnv), caps);
  if (typeof selected !== 'string') return refusal(selected.error);

  const policyOrError = buildDefaultPolicy(input.projectRoot ?? input.cwd, io);
  if ('error' in policyOrError) {
    return { ok: false, error: policyOrError.error };
  }
  const policy: NativeSandboxPolicy = {
    ...policyOrError,
    network: input.network ?? false,
    chdir: path.resolve(input.cwd),
  };

  const mkdirSync = io.mkdirSync ?? realMkdirSync;
  try {
    mkdirSync(policy.tmpDir, { recursive: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return refusal(`could not create dedicated TMPDIR ${policy.tmpDir} (${message}).`);
  }

  const nextEnv: NodeJS.ProcessEnv = {
    ...input.env,
    TMPDIR: policy.tmpDir,
    TMP: policy.tmpDir,
    TEMP: policy.tmpDir,
  };
  const command = [input.file, ...input.args];

  if (selected === 'bwrap') {
    const bwrapPath = caps.bwrapPath;
    if (!bwrapPath) return refusal('bubblewrap path missing after a successful probe.');
    logger.debug('native-sandbox: wrapping with bubblewrap');
    return { ok: true, file: bwrapPath, args: buildBwrapArgv(policy, command), env: nextEnv, backend: 'bwrap' };
  }

  if (selected === 'landlock') {
    const pythonPath = caps.pythonPath;
    const helperPath = io.helperPath ?? resolveLandlockHelperPath(io.existsSync ?? realExistsSync);
    if (!pythonPath) return refusal('python3 is required to apply Landlock.');
    if (!helperPath) return refusal('Landlock helper landlock-confine.py is missing.');
    logger.debug('native-sandbox: wrapping with Landlock helper');
    return {
      ok: true,
      file: pythonPath,
      args: buildLandlockArgv(policy, command, helperPath),
      env: nextEnv,
      backend: 'landlock',
    };
  }

  const sandboxExecPath = caps.sandboxExecPath;
  if (!sandboxExecPath) return refusal('sandbox-exec path missing.');
  logger.debug('native-sandbox: wrapping with sandbox-exec');
  return {
    ok: true,
    file: sandboxExecPath,
    args: buildSeatbeltArgv(buildSeatbeltProfile(policy), command),
    env: nextEnv,
    backend: 'seatbelt',
  };
}
