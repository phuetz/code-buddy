/**
 * OS-Level Sandbox
 *
 * Native sandboxing using OS-level isolation:
 * - Linux: Landlock + seccomp (bwrap with seccomp BPF filters, strongest)
 * - Linux: bubblewrap (bwrap)
 * - macOS: sandbox-exec (seatbelt)
 * - Windows: Not yet supported (falls back to Docker)
 *
 * Inspired by Codex CLI's execpolicy and sandbox implementation.
 */

import { spawn, SpawnOptions } from 'child_process';
import { EventEmitter } from 'events';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { sanitizeEnvVars } from '../security/env-blocklist.js';
import type { SandboxBackendInterface, SandboxExecOptions, SandboxExecResult } from './sandbox-backend.js';

// ============================================================================
// Types
// ============================================================================

export type SandboxBackend = 'landlock' | 'bubblewrap' | 'seatbelt' | 'docker' | 'none';

export interface OSSandboxConfig {
  /** Sandbox backend to use (auto-detected if not specified) */
  backend?: SandboxBackend;
  /** Working directory */
  workDir: string;
  /** Read-only paths */
  readOnlyPaths: string[];
  /** Read-write paths */
  readWritePaths: string[];
  /** Allow network access */
  allowNetwork: boolean;
  /** Allow subprocess spawning */
  allowSubprocess: boolean;
  /** Environment variables to pass */
  env: Record<string, string>;
  /** Timeout in milliseconds */
  timeout: number;
  /** Optional cancellation for the currently tracked execution. */
  abortSignal?: AbortSignal;
  /** Resource limits */
  limits: {
    /** Max memory in bytes */
    maxMemory?: number;
    /** Max CPU time in seconds */
    maxCpuTime?: number;
    /** Max processes */
    maxProcesses?: number;
    /** Max file size in bytes */
    maxFileSize?: number;
  };
  /** Domain allowlist when network is enabled */
  allowedDomains: string[];
  /** Commands that bypass the sandbox */
  excludedCommands: string[];
  /** Allow running unsandboxed as fallback (default: true) */
  allowUnsandboxed: boolean;
}

export interface OSSandboxResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
  timedOut: boolean;
  backend: SandboxBackend;
  sandboxed: boolean;
}

export interface SandboxCapabilities {
  landlock: boolean;
  bubblewrap: boolean;
  seatbelt: boolean;
  docker: boolean;
  recommended: SandboxBackend;
}

// ============================================================================
// Default Configuration
// ============================================================================

export interface OSSandboxStats {
  commandsRun: number;
  commandsSandboxed: number;
  commandsBypassed: number;
}

const DEFAULT_CONFIG: OSSandboxConfig = {
  workDir: process.cwd(),
  readOnlyPaths: ['/usr', '/lib', '/lib64', '/bin', '/sbin', '/etc'],
  readWritePaths: [],
  allowNetwork: false,
  allowSubprocess: true,
  env: {},
  timeout: 60000,
  limits: {
    maxMemory: 512 * 1024 * 1024, // 512MB
    maxCpuTime: 60,
    maxProcesses: 100,
    maxFileSize: 100 * 1024 * 1024, // 100MB
  },
  allowedDomains: [],
  excludedCommands: [],
  allowUnsandboxed: true,
};

// ============================================================================
// Capability Detection
// ============================================================================

let cachedCapabilities: SandboxCapabilities | null = null;

/**
 * Detect available sandbox backends
 */
export async function detectCapabilities(): Promise<SandboxCapabilities> {
  if (cachedCapabilities) {
    return cachedCapabilities;
  }

  const platform = os.platform();

  const capabilities: SandboxCapabilities = {
    landlock: false,
    bubblewrap: false,
    seatbelt: false,
    docker: false,
    recommended: 'none',
  };

  // Check for Landlock support (Linux kernel >= 5.13)
  if (platform === 'linux') {
    capabilities.landlock = checkLandlockSupport();
  }

  // Check that bubblewrap can actually create a user namespace. Merely finding
  // the binary produced false positives on hosts where the kernel/container
  // policy rejects uid_map setup; the old runtime then attempted a sandbox and
  // failed every otherwise-valid command.
  if (platform === 'linux') {
    try {
      const result = await execSimple('bwrap', [
        '--unshare-user',
        '--unshare-pid',
        '--die-with-parent',
        '--ro-bind', '/', '/',
        '--proc', '/proc',
        '--dev', '/dev',
        'true',
      ]);
      capabilities.bubblewrap = result.exitCode === 0;
    } catch {
      capabilities.bubblewrap = false;
    }
  }

  // Check for seatbelt (macOS): sandbox-exec is built into every macOS, so
  // presence proves nothing — run a trivial command under the real profile.
  if (platform === 'darwin') {
    capabilities.seatbelt = await probeSeatbelt();
  }

  // Check for Docker
  try {
    const result = await execSimple('docker', ['version', '--format', '{{.Server.Version}}']);
    capabilities.docker = result.exitCode === 0;
  } catch {
    capabilities.docker = false;
  }

  // Determine recommended backend (priority: landlock > bubblewrap > seatbelt > docker)
  if (platform === 'linux' && capabilities.landlock && capabilities.bubblewrap) {
    capabilities.recommended = 'landlock';
  } else if (platform === 'linux' && capabilities.bubblewrap) {
    capabilities.recommended = 'bubblewrap';
  } else if (platform === 'darwin' && capabilities.seatbelt) {
    capabilities.recommended = 'seatbelt';
  } else if (capabilities.docker) {
    capabilities.recommended = 'docker';
  } else {
    capabilities.recommended = 'none';
  }

  cachedCapabilities = capabilities;
  return capabilities;
}

/**
 * Clear cached capabilities
 */
export function clearCapabilitiesCache(): void {
  cachedCapabilities = null;
}

// ============================================================================
// Bubblewrap Sandbox (Linux)
// ============================================================================

/**
 * Execute command in bubblewrap sandbox
 */
async function execBubblewrap(
  command: string,
  args: string[],
  config: OSSandboxConfig
): Promise<OSSandboxResult> {
  const bwrapArgs: string[] = [
    // Unshare namespaces
    '--unshare-user',
    '--unshare-pid',
    '--unshare-uts',
    '--unshare-cgroup',
  ];

  // Network namespace
  if (!config.allowNetwork) {
    bwrapArgs.push('--unshare-net');
  }

  // Die with parent
  bwrapArgs.push('--die-with-parent');

  // Create minimal root filesystem
  bwrapArgs.push('--tmpfs', '/');

  // Mount /proc (required for many tools)
  bwrapArgs.push('--proc', '/proc');

  // Mount /dev minimally
  bwrapArgs.push('--dev', '/dev');

  // Mount read-write paths
  for (const p of config.readWritePaths) {
    if (fs.existsSync(p)) {
      bwrapArgs.push('--bind', p, p);
    }
  }

  // Mount working directory
  if (fs.existsSync(config.workDir)) {
    bwrapArgs.push('--bind', config.workDir, config.workDir);
    bwrapArgs.push('--chdir', config.workDir);
  }

  // Read-only overlays are deliberately mounted LAST.  Bubblewrap resolves
  // overlapping binds in order; doing this before the workspace bind made
  // `.git` and `.codebuddy` writable again despite the profile claiming the
  // opposite.
  for (const p of config.readOnlyPaths) {
    if (fs.existsSync(p)) {
      bwrapArgs.push('--ro-bind', p, p);
    }
  }

  // Create /tmp
  bwrapArgs.push('--tmpfs', '/tmp');

  // Set hostname
  bwrapArgs.push('--hostname', 'sandbox');

  // Environment variables
  bwrapArgs.push('--clearenv');
  const envVars: Record<string, string> = {
    HOME: '/tmp',
    PATH: '/usr/local/bin:/usr/bin:/bin',
    TERM: process.env.TERM || 'xterm',
    CODEBUDDY_CLI: process.env.CODEBUDDY_CLI || '1',
    CODEBUDDY_CLI_VERSION: process.env.CODEBUDDY_CLI_VERSION || '',
    ...sanitizeEnvVars(config.env),
  };

  for (const [key, value] of Object.entries(envVars)) {
    bwrapArgs.push('--setenv', key, value);
  }

  // Add the command
  bwrapArgs.push(command, ...args);

  return execWithTimeout('bwrap', bwrapArgs, config.timeout, 'bubblewrap', config.abortSignal);
}

// ============================================================================
// Seatbelt Sandbox (macOS)
// ============================================================================

/**
 * Canonical form of a path for seatbelt rules. The kernel matches `subpath`
 * against the resolved vnode path, so a rule written for `/var/folders/…` or
 * `/tmp` never matches on macOS where those are symlinks to `/private/…`.
 * Returns the lexical path and (when different) its realpath.
 */
function seatbeltPathForms(p: string): string[] {
  const lexical = path.resolve(p);
  const canonical = canonicalizeViaExistingAncestor(lexical);
  return canonical === lexical ? [lexical] : [lexical, canonical];
}

/**
 * Canonical form of a path whose leaf may not exist yet: realpath the nearest
 * existing ancestor and re-append the rest (same helper shape as
 * review-gate-helper.ts), so a not-yet-created `<workspace>/.git` or
 * `.codebuddy` is still protected under the CANONICAL workspace root.
 */
function canonicalizeViaExistingAncestor(resolved: string): string {
  const pending: string[] = [];
  let cursor = resolved;
  for (;;) {
    try {
      const real = fs.realpathSync(cursor);
      return pending.length ? path.join(real, ...pending.reverse()) : real;
    } catch {
      const parent = path.dirname(cursor);
      if (parent === cursor) return resolved;
      pending.push(path.basename(cursor));
      cursor = parent;
    }
  }
}

/**
 * Secrets that stay unreadable inside the seatbelt sandbox even though reads
 * are otherwise open. Aligned with `BLOCKED_PATHS` in
 * src/workspace/workspace-isolation.ts and the `workspaceReadOnly` list of the
 * Docker path (src/tools/bash/execution-policy.ts). Exported for tests.
 */
export function seatbeltUnreadablePaths(homeDir: string = os.homedir()): string[] {
  return [
    path.join(homeDir, '.ssh'),
    path.join(homeDir, '.gnupg'),
    path.join(homeDir, '.aws'),
    path.join(homeDir, '.kube'),
    path.join(homeDir, '.docker', 'config.json'),
    path.join(homeDir, '.npmrc'),
    path.join(homeDir, '.netrc'),
    path.join(homeDir, '.config', 'gh', 'hosts.yml'),
    path.join(homeDir, '.config', 'gcloud', 'credentials.db'),
    path.join(homeDir, '.codebuddy', 'credentials.enc'),
    '/etc/sudoers',
    '/etc/security',
  ];
}

function seatbeltQuote(p: string): string {
  return `"${p.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Generate the seatbelt (sandbox-exec) profile.
 *
 * Shape follows the Codex CLI / Chromium profiles that are known to run on
 * macOS 12–15: closed by default, reads allowed everywhere, writes limited to
 * the canonicalized writable roots, network closed unless enabled.
 *
 * Why reads are not limited to `readOnlyPaths`: a macOS process cannot even
 * `exec` without reading the dyld shared cache (`/System/…`,
 * `/System/Volumes/Preboot/Cryptexes/…`), `/Library`, `/private/var/db`, and
 * developer toolchains live under `/Users/*`, `/opt/homebrew`,
 * `/Applications/Xcode.app`. There is no closed, portable "minimal system
 * read set" on Darwin, so a deny-default read policy makes every command exit
 * before it starts. Write confinement + no network is the property the
 * workspace sandbox actually provides (same as Codex's `workspace-write`).
 *
 * `readOnlyPaths` that sit under a writable root (e.g. `<workspace>/.git`,
 * `.codebuddy`) are carved out of the write grant with `require-not`, and
 * re-denied explicitly so the protection does not depend on rule ordering.
 *
 * Asymmetry vs the Linux bubblewrap path, on purpose: bwrap runs on a tmpfs
 * root with `HOME=/tmp`, so the child never sees the real home or the host
 * temp dir. Seatbelt has no mount namespace — the child shares the host's
 * real `/tmp`/`$TMPDIR` (writable scratch) and the real `$HOME` (readable).
 * The credential files and directories in `seatbeltUnreadablePaths()` are
 * therefore explicitly denied (read AND write) after the broad read allow;
 * SBPL gives later rules precedence, and the deny is written for both the
 * lexical and canonical spelling of each path.
 */
export function generateSeatbeltProfile(config: OSSandboxConfig): string {
  const rules: string[] = [
    '(version 1)',
    '',
    '; Code Buddy workspace sandbox. Inspired by the Codex CLI and Chromium',
    '; seatbelt policies: closed by default, read-everywhere, write-confined.',
    '(deny default)',
    '',
    '; Reads: see generateSeatbeltProfile() — Darwin has no minimal read set',
    '(allow file-read*)',
    '',
    '; …except credentials (shared real $HOME — see the asymmetry note above)',
    ...seatbeltUnreadablePaths()
      .flatMap(seatbeltPathForms)
      .flatMap((secret) => [
        `(deny file-read* file-write* (subpath ${seatbeltQuote(secret)}))`,
        `(deny file-read* file-write* (literal ${seatbeltQuote(secret)}))`,
      ]),
    '',
    '; Child processes inherit the policy of their parent',
    '(allow process-exec)',
    '(allow process-fork)',
    '(allow signal (target same-sandbox))',
    '(allow process-info* (target same-sandbox))',
    '',
    '; sysctls (hw.*, kern.osversion, … — used by every runtime at startup)',
    '(allow sysctl-read)',
    '',
    '; user/group lookups (getpwuid, ~ expansion, whoami)',
    '(allow mach-lookup (global-name "com.apple.system.opendirectoryd.libinfo"))',
    '',
    '; devices',
    '(allow file-write* (literal "/dev/null"))',
    '(allow file-ioctl (literal "/dev/null"))',
    '(allow pseudo-tty)',
    '(allow file-read* file-write* file-ioctl (literal "/dev/ptmx"))',
    '(allow file-ioctl (regex #"^/dev/ttys[0-9]+"))',
    '',
    '; Writable roots (lexical + canonical forms)',
  ];

  const readOnly = config.readOnlyPaths.flatMap(seatbeltPathForms);
  const writable = new Set<string>();
  for (const p of [...config.readWritePaths, config.workDir]) {
    for (const form of seatbeltPathForms(p)) writable.add(form);
  }
  // Scratch space is always writable (the Codex workspace-write default).
  for (const p of ['/tmp', os.tmpdir()]) {
    for (const form of seatbeltPathForms(p)) writable.add(form);
  }

  for (const root of writable) {
    const protectedBelow = readOnly.filter(
      (ro) => ro === root || ro.startsWith(root.endsWith('/') ? root : `${root}/`)
    );
    if (protectedBelow.length === 0) {
      rules.push(`(allow file-write* (subpath ${seatbeltQuote(root)}))`);
      continue;
    }
    const exclusions = protectedBelow
      .filter((ro) => ro !== root)
      .flatMap((ro) => [
        `(require-not (subpath ${seatbeltQuote(ro)}))`,
        `(require-not (literal ${seatbeltQuote(ro)}))`,
      ]);
    if (protectedBelow.includes(root)) continue; // whole root is read-only
    rules.push(
      `(allow file-write* (require-all (subpath ${seatbeltQuote(root)}) ${exclusions.join(' ')}))`
    );
  }

  const protectedSubpaths = readOnly.filter((ro) =>
    [...writable].some((root) => ro !== root && ro.startsWith(root.endsWith('/') ? root : `${root}/`))
  );
  if (protectedSubpaths.length > 0) {
    rules.push('');
    rules.push('; Protected metadata stays read-only even inside writable roots');
    for (const ro of protectedSubpaths) {
      rules.push(`(deny file-write* (subpath ${seatbeltQuote(ro)}))`);
      rules.push(`(deny file-write* (literal ${seatbeltQuote(ro)}))`);
    }
  }

  // Network
  if (config.allowNetwork) {
    rules.push('');
    rules.push('; Allow network access');
    rules.push('(allow network*)');
    rules.push('(allow system-socket)');
    rules.push(
      '(allow mach-lookup (global-name "com.apple.SecurityServer") (global-name "com.apple.networkd") (global-name "com.apple.trustd.agent") (global-name "com.apple.SystemConfiguration.DNSConfiguration") (global-name "com.apple.SystemConfiguration.configd"))'
    );
  }

  // Subprocess
  if (!config.allowSubprocess) {
    rules.push('');
    rules.push('; Deny subprocess creation');
    rules.push('(deny process-fork)');
  }

  return rules.join('\n');
}

/** Environment handed to the seatbelt child (mirrors the bubblewrap path). */
function seatbeltEnvironment(config: OSSandboxConfig): Record<string, string> {
  return {
    HOME: process.env.HOME || os.homedir(),
    PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
    TMPDIR: os.tmpdir(),
    TERM: process.env.TERM || 'xterm',
    CODEBUDDY_CLI: process.env.CODEBUDDY_CLI || '1',
    CODEBUDDY_CLI_VERSION: process.env.CODEBUDDY_CLI_VERSION || '',
    ...sanitizeEnvVars(config.env),
  };
}

/**
 * Probe that `sandbox-exec` can actually run a trivial command under a
 * REPRESENTATIVE profile. `which sandbox-exec` alone produced false
 * positives: the binary exists on every macOS, so a profile that cannot exec
 * (or a host that forbids sandbox-exec) turned every otherwise-valid command
 * into an exit-1 failure — the same trap the bubblewrap probe guards against.
 *
 * The probe config mirrors what `createSandboxConfigForMode('workspace-write')`
 * emits (a writable root with a protected `.git` below it), so every rule
 * shape of the real profile — `require-all`/`require-not`, the explicit
 * denies, the secret read denies — must compile and run. Any failure ⇒ the
 * backend is reported unavailable (fail-closed, callers escalate explicitly).
 */
export function seatbeltProbeConfig(): OSSandboxConfig {
  const scratch = os.tmpdir();
  return {
    ...DEFAULT_CONFIG,
    workDir: scratch,
    readWritePaths: [scratch],
    readOnlyPaths: ['/usr', '/bin', path.join(scratch, '.git'), path.join(scratch, '.codebuddy')],
  };
}

async function probeSeatbelt(): Promise<boolean> {
  const profile = generateSeatbeltProfile(seatbeltProbeConfig());
  try {
    const result = await execSimple('sandbox-exec', ['-p', profile, '/usr/bin/true']);
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Execute command in seatbelt sandbox
 */
async function execSeatbelt(
  command: string,
  args: string[],
  config: OSSandboxConfig
): Promise<OSSandboxResult> {
  // Generate profile
  const profile = generateSeatbeltProfile(config);

  // Write profile to temp file
  const profilePath = path.join(os.tmpdir(), `grok-sandbox-${Date.now()}-${process.pid}.sb`);
  fs.writeFileSync(profilePath, profile, { mode: 0o600 });

  try {
    const sandboxArgs = [
      '-f', profilePath,
      command,
      ...args,
    ];

    const result = await execWithTimeout(
      'sandbox-exec',
      sandboxArgs,
      config.timeout,
      'seatbelt',
      config.abortSignal,
      {
        ...(fs.existsSync(config.workDir) ? { cwd: config.workDir } : {}),
        env: seatbeltEnvironment(config),
      },
    );
    return result;
  } finally {
    // Clean up profile file
    try {
      fs.unlinkSync(profilePath);
    } catch {
      // Ignore cleanup errors
    }
  }
}

// ============================================================================
// Landlock + Seccomp Sandbox (Linux)
// ============================================================================

/**
 * Dangerous syscall numbers (x86_64) to block via seccomp BPF.
 * These syscalls allow kernel-level operations that should never
 * be available inside a sandbox.
 */
const BLOCKED_SYSCALLS: Record<string, number> = {
  mount: 165,
  umount2: 166,
  reboot: 169,
  kexec_load: 246,
  ptrace: 101,
  pivot_root: 155,
};

/**
 * Check if the Linux kernel supports Landlock LSM.
 * Returns true if /proc/sys/kernel/unprivileged_landlock_restrict exists
 * or kernel version >= 5.13.
 */
export function checkLandlockSupport(): boolean {
  try {
    // Primary check: proc filesystem indicator
    if (fs.existsSync('/proc/sys/kernel/unprivileged_landlock_restrict')) {
      return true;
    }
  } catch {
    // Ignore filesystem errors
  }

  try {
    // Fallback: check kernel version >= 5.13
    const release = os.release(); // e.g. "5.15.0-generic"
    const match = release.match(/^(\d+)\.(\d+)/);
    if (match) {
      const major = parseInt(match[1] ?? '', 10);
      const minor = parseInt(match[2] ?? '', 10);
      if (major > 5 || (major === 5 && minor >= 13)) {
        return true;
      }
    }
  } catch {
    // Ignore parse errors
  }

  return false;
}

/**
 * Generate a seccomp BPF filter file that blocks dangerous syscalls.
 *
 * The filter is a minimal BPF program in binary format:
 * - Load syscall number (BPF_LD | BPF_W | BPF_ABS, offset 0 for seccomp data)
 * - For each blocked syscall: compare and jump to KILL if matched
 * - Default action: ALLOW
 *
 * Format: each BPF instruction is 8 bytes (struct sock_filter):
 *   uint16 code, uint8 jt, uint8 jf, uint32 k
 */
export function generateSeccompFilter(): Buffer {
  const syscalls = Object.values(BLOCKED_SYSCALLS);
  const numSyscalls = syscalls.length;

  // BPF constants
  const BPF_LD = 0x00;
  const BPF_W = 0x00;
  const BPF_ABS = 0x20;
  const BPF_JMP = 0x05;
  const BPF_JEQ = 0x10;
  const BPF_K = 0x00;
  const BPF_RET = 0x06;

  const SECCOMP_RET_ALLOW = 0x7fff0000;
  const SECCOMP_RET_KILL = 0x00000000;

  // Layout: load + N compares + allow + kill
  // Compare i jt target: skip remaining compares + allow to reach kill
  // Compare i jf target: 0 (fall through to next compare)
  const totalInstructions = 1 + numSyscalls + 1 + 1;
  const buf = Buffer.alloc(totalInstructions * 8);
  let off = 0;

  // Instruction 0: Load syscall number from seccomp_data.nr (offset 0)
  buf.writeUInt16LE(BPF_LD | BPF_W | BPF_ABS, off);
  buf.writeUInt8(0, off + 2);  // jt (unused for LD)
  buf.writeUInt8(0, off + 3);  // jf (unused for LD)
  buf.writeUInt32LE(0, off + 4); // k = offsetof(seccomp_data, nr)
  off += 8;

  // Instructions 1..N: Compare each blocked syscall
  for (const [i, syscall] of syscalls.entries()) {
    const remainingCompares = numSyscalls - 1 - i;
    const jumpToKill = remainingCompares + 1; // skip remaining compares + allow
    buf.writeUInt16LE(BPF_JMP | BPF_JEQ | BPF_K, off);
    buf.writeUInt8(jumpToKill, off + 2); // jt: jump to KILL
    buf.writeUInt8(0, off + 3);          // jf: next instruction
    buf.writeUInt32LE(syscall, off + 4);
    off += 8;
  }

  // ALLOW (default action for non-blocked syscalls)
  buf.writeUInt16LE(BPF_RET | BPF_K, off);
  buf.writeUInt8(0, off + 2);
  buf.writeUInt8(0, off + 3);
  buf.writeUInt32LE(SECCOMP_RET_ALLOW, off + 4);
  off += 8;

  // KILL (action for blocked syscalls)
  buf.writeUInt16LE(BPF_RET | BPF_K, off);
  buf.writeUInt8(0, off + 2);
  buf.writeUInt8(0, off + 3);
  buf.writeUInt32LE(SECCOMP_RET_KILL, off + 4);

  return buf;
}

/**
 * Execute command in Landlock-enhanced sandbox.
 *
 * Uses bubblewrap with seccomp BPF filters for the strongest available
 * sandbox on Linux. If seccomp filter generation fails, falls back to
 * standard bubblewrap.
 */
async function execLandlock(
  command: string,
  args: string[],
  config: OSSandboxConfig
): Promise<OSSandboxResult> {
  let seccompPath: string | null = null;

  try {
    // Generate seccomp BPF filter
    const filter = generateSeccompFilter();
    seccompPath = path.join(os.tmpdir(), `grok-seccomp-${Date.now()}-${process.pid}.bpf`);
    fs.writeFileSync(seccompPath, filter);
  } catch {
    // If seccomp filter generation fails, fall back to standard bubblewrap
    return execBubblewrap(command, args, config);
  }

  try {
    const bwrapArgs: string[] = [
      // Unshare namespaces
      '--unshare-user',
      '--unshare-pid',
      '--unshare-uts',
      '--unshare-cgroup',
    ];

    // Network namespace
    if (!config.allowNetwork) {
      bwrapArgs.push('--unshare-net');
    }

    // Die with parent
    bwrapArgs.push('--die-with-parent');

    // Apply seccomp BPF filter
    bwrapArgs.push('--seccomp', '9');

    // Create minimal root filesystem
    bwrapArgs.push('--tmpfs', '/');

    // Mount /proc (required for many tools)
    bwrapArgs.push('--proc', '/proc');

    // Mount /dev minimally
    bwrapArgs.push('--dev', '/dev');

    // Mount read-write paths
    for (const p of config.readWritePaths) {
      if (fs.existsSync(p)) {
        bwrapArgs.push('--bind', p, p);
      }
    }

    // Mount working directory
    if (fs.existsSync(config.workDir)) {
      bwrapArgs.push('--bind', config.workDir, config.workDir);
      bwrapArgs.push('--chdir', config.workDir);
    }

    // See execBubblewrap: overlapping read-only paths must be applied after
    // every writable parent bind or the parent silently re-opens them.
    for (const p of config.readOnlyPaths) {
      if (fs.existsSync(p)) {
        bwrapArgs.push('--ro-bind', p, p);
      }
    }

    // Create /tmp
    bwrapArgs.push('--tmpfs', '/tmp');

    // Set hostname
    bwrapArgs.push('--hostname', 'sandbox');

    // Environment variables
    bwrapArgs.push('--clearenv');
    const envVars: Record<string, string> = {
      HOME: '/tmp',
      PATH: '/usr/local/bin:/usr/bin:/bin',
      TERM: process.env.TERM || 'xterm',
      CODEBUDDY_CLI: process.env.CODEBUDDY_CLI || '1',
      CODEBUDDY_CLI_VERSION: process.env.CODEBUDDY_CLI_VERSION || '',
      ...sanitizeEnvVars(config.env),
    };

    for (const [key, value] of Object.entries(envVars)) {
      bwrapArgs.push('--setenv', key, value);
    }

    // Add the command
    bwrapArgs.push(command, ...args);

    // Execute bwrap with the seccomp filter passed via fd 9
    const result = await execWithSeccomp(
      'bwrap',
      bwrapArgs,
      config.timeout,
      seccompPath,
      config.abortSignal,
    );
    return result;
  } finally {
    // Clean up seccomp filter file
    if (seccompPath) {
      try {
        fs.unlinkSync(seccompPath);
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

/**
 * Execute bwrap with a seccomp filter file passed via file descriptor.
 * The seccomp BPF data is piped through fd 9 to bwrap's --seccomp option.
 */
function execWithSeccomp(
  command: string,
  args: string[],
  timeout: number,
  seccompPath: string,
  signal?: AbortSignal,
): Promise<OSSandboxResult> {
  return new Promise((resolve) => {
    const startTime = Date.now();

    // Verify the seccomp filter file is readable
    try {
      fs.accessSync(seccompPath, fs.constants.R_OK);
    } catch {
      resolve({
        exitCode: 1,
        stdout: '',
        stderr: 'Failed to read seccomp filter',
        duration: Date.now() - startTime,
        timedOut: false,
        backend: 'landlock',
        sandboxed: false,
      });
      return;
    }

    // Use a shell wrapper to pass the seccomp filter via fd 9
    // bwrap --seccomp 9 ... 9< seccompfile
    const shellCmd = `${command} ${args.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' ')} 9< '${seccompPath.replace(/'/g, "'\\''")}'`;

    const proc = spawn('sh', ['-c', shellCmd], {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(signal ? { signal } : {}),
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    proc.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGKILL');
    }, timeout);

    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
        duration: Date.now() - startTime,
        timedOut,
        backend: 'landlock',
        sandboxed: true,
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        exitCode: 1,
        stdout: '',
        stderr: err.message,
        duration: Date.now() - startTime,
        timedOut: false,
        backend: 'landlock',
        sandboxed: false,
      });
    });
  });
}

// ============================================================================
// OS Sandbox Class
// ============================================================================

export class OSSandbox extends EventEmitter implements SandboxBackendInterface {
  readonly name = 'os-sandbox';
  private config: OSSandboxConfig;
  private backend: SandboxBackend = 'none';
  private initialized = false;
  private stats: OSSandboxStats = {
    commandsRun: 0,
    commandsSandboxed: 0,
    commandsBypassed: 0,
  };

  constructor(config: Partial<OSSandboxConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize sandbox and detect backend
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    const capabilities = await detectCapabilities();

    if (this.config.backend) {
      // Use specified backend if available
      if (this.config.backend === 'landlock' && capabilities.landlock && capabilities.bubblewrap) {
        this.backend = 'landlock';
      } else if (this.config.backend === 'bubblewrap' && capabilities.bubblewrap) {
        this.backend = 'bubblewrap';
      } else if (this.config.backend === 'seatbelt' && capabilities.seatbelt) {
        this.backend = 'seatbelt';
      } else if (this.config.backend === 'docker' && capabilities.docker) {
        this.backend = 'docker';
      } else {
        this.backend = 'none';
      }
    } else {
      // Auto-detect
      this.backend = capabilities.recommended;
    }

    this.initialized = true;
    this.emit('initialized', { backend: this.backend });
  }

  /**
   * Get current backend
   */
  getBackend(): SandboxBackend {
    return this.backend;
  }

  /**
   * Check if sandboxing is available (satisfies SandboxBackendInterface).
   */
  async isAvailable(): Promise<boolean> {
    if (!this.initialized) {
      await this.initialize();
    }
    return this.backend !== 'none';
  }

  /**
   * Execute command in sandbox
   */
  async exec(command: string, args: string[] = []): Promise<OSSandboxResult> {
    if (!this.initialized) {
      await this.initialize();
    }

    const startTime = Date.now();

    this.emit('exec:start', { command, args, backend: this.backend });

    let result: OSSandboxResult;

    try {
      switch (this.backend) {
        case 'landlock':
          result = await execLandlock(command, args, this.config);
          break;

        case 'bubblewrap':
          result = await execBubblewrap(command, args, this.config);
          break;

        case 'seatbelt':
          result = await execSeatbelt(command, args, this.config);
          break;

        case 'docker':
          // Fall back to Docker (handled elsewhere)
          result = await execUnsandboxed(command, args, this.config.timeout, this.config.abortSignal);
          result.backend = 'docker';
          result.sandboxed = false; // Mark as not sandboxed by OS
          break;

        case 'none':
        default:
          result = await execUnsandboxed(command, args, this.config.timeout, this.config.abortSignal);
          break;
      }
    } catch (error) {
      result = {
        exitCode: 1,
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
        timedOut: false,
        backend: this.backend,
        sandboxed: false,
      };
    }

    this.emit('exec:complete', result);
    return result;
  }

  /**
   * Execute shell command in sandbox
   */
  async execShell(shellCommand: string): Promise<OSSandboxResult> {
    const shell = os.platform() === 'win32' ? 'cmd' : 'sh';
    const shellArg = os.platform() === 'win32' ? '/c' : '-c';
    return this.exec(shell, [shellArg, shellCommand]);
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<OSSandboxConfig>): void {
    this.config = { ...this.config, ...config };
    // Reset initialization if backend changed
    if (config.backend) {
      this.initialized = false;
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): OSSandboxConfig {
    return { ...this.config };
  }

  /**
   * Check if a domain should be allowed through the network filter
   */
  shouldAllowDomain(domain: string): boolean {
    if (!this.config.allowNetwork) {
      return false;
    }

    if (this.config.allowedDomains.length === 0) {
      // No allowlist means allow all when network is enabled
      return true;
    }

    const normalizedDomain = domain.toLowerCase();
    return this.config.allowedDomains.some((allowed) => {
      const normalizedAllowed = allowed.toLowerCase();
      return (
        normalizedDomain === normalizedAllowed ||
        normalizedDomain.endsWith('.' + normalizedAllowed)
      );
    });
  }

  /**
   * Check if a command should bypass the sandbox
   */
  isCommandExcluded(command: string): boolean {
    const trimmed = command.trim();
    const baseCommand = trimmed.split(/\s+/)[0] ?? '';
    const binaryName = baseCommand.split('/').pop() || baseCommand;

    return this.config.excludedCommands.some((excluded) => {
      return binaryName === excluded || baseCommand === excluded;
    });
  }

  /**
   * Get execution statistics
   */
  getStats(): OSSandboxStats {
    return { ...this.stats };
  }

  /**
   * Execute a shell command with exclusion and stats tracking
   */
  async execShellTracked(shellCommand: string): Promise<OSSandboxResult> {
    this.stats.commandsRun++;

    if (this.isCommandExcluded(shellCommand)) {
      this.stats.commandsBypassed++;
      const shell = os.platform() === 'win32' ? 'cmd' : 'sh';
      const shellArg = os.platform() === 'win32' ? '/c' : '-c';
      return execUnsandboxed(shell, [shellArg, shellCommand], this.config.timeout);
    }

    if (!(await this.isAvailable())) {
      if (this.config.allowUnsandboxed) {
        this.stats.commandsBypassed++;
        const shell = os.platform() === 'win32' ? 'cmd' : 'sh';
        const shellArg = os.platform() === 'win32' ? '/c' : '-c';
        return execUnsandboxed(shell, [shellArg, shellCommand], this.config.timeout);
      }
      return {
        exitCode: 1,
        stdout: '',
        stderr: 'No OS sandbox backend is available and unsandboxed fallback is disabled',
        duration: 0,
        timedOut: false,
        backend: 'none',
        sandboxed: false,
      };
    }

    this.stats.commandsSandboxed++;
    return this.execShell(shellCommand);
  }

  // --------------------------------------------------------------------------
  // SandboxBackendInterface adapter methods
  // --------------------------------------------------------------------------

  /**
   * Execute a command in the sandbox (satisfies SandboxBackendInterface).
   * Adapts the SandboxExecOptions to the native exec API.
   */
  async execute(command: string, opts?: SandboxExecOptions): Promise<SandboxExecResult> {
    if (opts?.workDir) {
      this.updateConfig({ workDir: opts.workDir });
    }
    if (opts?.env) {
      this.updateConfig({ env: opts.env });
    }
    if (opts?.timeout) {
      this.updateConfig({ timeout: opts.timeout });
    }
    if (opts?.networkEnabled !== undefined) {
      this.updateConfig({ allowNetwork: opts.networkEnabled });
    }

    const result = await this.execShell(command);
    return {
      success: result.exitCode === 0 && !result.timedOut,
      output: result.stdout,
      error: result.stderr || undefined,
      exitCode: result.exitCode,
      durationMs: result.duration,
    };
  }

  /**
   * Kill a running sandbox instance (satisfies SandboxBackendInterface).
   * OS-level sandboxes are process-based; kill is not directly applicable.
   */
  async kill(_containerId: string): Promise<boolean> {
    // OS-level sandboxes don't use container IDs — processes are managed via spawn
    return false;
  }

  /**
   * Clean up resources (satisfies SandboxBackendInterface).
   */
  async cleanup(): Promise<void> {
    this.removeAllListeners();
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Simple exec wrapper
 */
function execSimple(command: string, args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });

    proc.on('error', () => {
      resolve({ exitCode: 1, stdout: '', stderr: 'Command not found' });
    });
  });
}

/**
 * Execute with timeout
 */
function execWithTimeout(
  command: string,
  args: string[],
  timeout: number,
  backend: SandboxBackend,
  signal?: AbortSignal,
  spawnOptions: { cwd?: string; env?: Record<string, string> } = {},
): Promise<OSSandboxResult> {
  return new Promise((resolve) => {
    const startTime = Date.now();

    const options: SpawnOptions = {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(signal ? { signal } : {}),
      ...(spawnOptions.cwd ? { cwd: spawnOptions.cwd } : {}),
      ...(spawnOptions.env ? { env: spawnOptions.env } : {}),
    };

    const proc = spawn(command, args, options);

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    proc.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGKILL');
    }, timeout);

    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
        duration: Date.now() - startTime,
        timedOut,
        backend,
        sandboxed: true,
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      // An AbortSignal cancellation surfaces as an 'error' (AbortError) on the
      // child: the sandbox did isolate the command, the caller cancelled it.
      // Reporting `sandboxed: false` here made every abort look like a backend
      // refusal and escalated it to an approval prompt.
      const aborted = Boolean(signal?.aborted);
      resolve({
        exitCode: 1,
        stdout: aborted ? stdout : '',
        stderr: aborted ? 'Command aborted by user' : err.message,
        duration: Date.now() - startTime,
        timedOut: false,
        backend,
        sandboxed: aborted,
      });
    });
  });
}

/**
 * Execute without sandbox
 */
function execUnsandboxed(
  command: string,
  args: string[],
  timeout: number,
  signal?: AbortSignal,
): Promise<OSSandboxResult> {
  return new Promise((resolve) => {
    const startTime = Date.now();

    const proc = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(signal ? { signal } : {}),
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    proc.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGKILL');
    }, timeout);

    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
        duration: Date.now() - startTime,
        timedOut,
        backend: 'none',
        sandboxed: false,
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        exitCode: 1,
        stdout: '',
        stderr: err.message,
        duration: Date.now() - startTime,
        timedOut: false,
        backend: 'none',
        sandboxed: false,
      });
    });
  });
}

// ============================================================================
// Sandbox Mode — Codex-inspired workspace-write tiering
// ============================================================================

/**
 * Three sandbox tiers (mirrors Codex CLI sandboxing levels):
 * - 'read-only'         → all writes blocked; default for untrusted commands
 * - 'workspace-write'  → writes limited to git workspace root; .git/.codebuddy always read-only
 * - 'danger-full-access'→ no write restrictions (still uses network/syscall sandbox)
 */
export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';

/**
 * Detect the git workspace root by running `git rev-parse --show-toplevel`.
 * Falls back to `cwd` if not inside a git repository.
 */
export async function getWorkspaceRoot(cwd: string = process.cwd()): Promise<string> {
  return new Promise((resolve) => {
    const proc = spawn('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let out = '';
    proc.stdout?.on('data', (d: Buffer) => { out += d.toString(); });
    proc.on('close', (code) => {
      const root = out.trim();
      resolve(code === 0 && root ? root : cwd);
    });
    proc.on('error', () => resolve(cwd));
  });
}

/**
 * Paths that are always read-only regardless of SandboxMode.
 * Writing to these directories could break version control, secrets, or the agent itself.
 */
const ALWAYS_READONLY_SUFFIXES = ['.git', '.codebuddy', '.ssh', '.gnupg', '.aws'];

/**
 * Build an `OSSandboxConfig` appropriate for the given `SandboxMode`.
 *
 * @param mode       - Desired sandbox tier
 * @param cwd        - Working directory (used to locate workspace root)
 * @param extraReadOnly  - Additional paths to mount read-only
 * @param extraReadWrite - Additional paths to mount read-write (ignored in read-only mode)
 */
export async function createSandboxConfigForMode(
  mode: SandboxMode,
  cwd: string = process.cwd(),
  extraReadOnly: string[] = [],
  extraReadWrite: string[] = []
): Promise<Partial<OSSandboxConfig>> {
  const workspaceRoot = await getWorkspaceRoot(cwd);

  const systemReadOnly = ['/usr', '/lib', '/lib64', '/bin', '/sbin', '/etc'];

  if (mode === 'read-only') {
    return {
      workDir: cwd,
      readOnlyPaths: [...systemReadOnly, workspaceRoot, ...extraReadOnly],
      readWritePaths: [],
      allowNetwork: false,
      allowUnsandboxed: false,
    };
  }

  if (mode === 'workspace-write') {
    // Start with workspace as read-write, then carve out always-readonly subdirs
    // by not including them in readWritePaths.
    // Note: bubblewrap/seatbelt apply mounts in order, so later read-only binds
    // override earlier read-write ones for the same subtree.
    const protectedPaths = ALWAYS_READONLY_SUFFIXES.map(suffix =>
      `${workspaceRoot}/${suffix}`
    );

    return {
      workDir: cwd,
      readOnlyPaths: [...systemReadOnly, ...protectedPaths, ...extraReadOnly],
      readWritePaths: [workspaceRoot, ...extraReadWrite],
      allowNetwork: false,
      allowUnsandboxed: false,
    };
  }

  // danger-full-access — write anywhere, still sandbox network/syscalls
  return {
    workDir: cwd,
    readOnlyPaths: [...systemReadOnly, ...extraReadOnly],
    readWritePaths: [workspaceRoot, '/', ...extraReadWrite],
    allowNetwork: true,
  };
}

/**
 * Convenience: create and initialize an OSSandbox pre-configured for the given mode.
 */
export async function createSandboxForMode(
  mode: SandboxMode,
  cwd?: string,
  extraReadOnly?: string[],
  extraReadWrite?: string[]
): Promise<OSSandbox> {
  const config = await createSandboxConfigForMode(mode, cwd, extraReadOnly, extraReadWrite);
  const sandbox = new OSSandbox(config);
  await sandbox.initialize();
  return sandbox;
}

// ============================================================================
// Singleton
// ============================================================================

let sandboxInstance: OSSandbox | null = null;

export function getOSSandbox(config?: Partial<OSSandboxConfig>): OSSandbox {
  if (!sandboxInstance) {
    sandboxInstance = new OSSandbox(config);
  }
  return sandboxInstance;
}

export function resetOSSandbox(): void {
  sandboxInstance = null;
}

// ============================================================================
// Exports
// ============================================================================

export { OSSandboxConfig as OSConfig };
