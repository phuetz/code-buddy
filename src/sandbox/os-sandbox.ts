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

  // Check for bubblewrap (Linux)
  if (platform === 'linux') {
    try {
      const result = await execSimple('which', ['bwrap']);
      capabilities.bubblewrap = result.exitCode === 0;
    } catch {
      capabilities.bubblewrap = false;
    }
  }

  // Check for seatbelt (macOS)
  if (platform === 'darwin') {
    try {
      // sandbox-exec is built into macOS
      const result = await execSimple('which', ['sandbox-exec']);
      capabilities.seatbelt = result.exitCode === 0;
    } catch {
      capabilities.seatbelt = false;
    }
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

  // Mount read-only paths
  for (const p of config.readOnlyPaths) {
    if (fs.existsSync(p)) {
      bwrapArgs.push('--ro-bind', p, p);
    }
  }

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
    ...config.env,
  };

  for (const [key, value] of Object.entries(envVars)) {
    bwrapArgs.push('--setenv', key, value);
  }

  // Add the command
  bwrapArgs.push(command, ...args);

  return execWithTimeout('bwrap', bwrapArgs, config.timeout, 'bubblewrap');
}

// ============================================================================
// Seatbelt Sandbox (macOS)
// ============================================================================

/**
 * Generate seatbelt profile for sandbox-exec
 */
function generateSeatbeltProfile(config: OSSandboxConfig): string {
  const rules: string[] = [
    '(version 1)',
    '(deny default)',
    '',
    '; Allow basic operations',
    '(allow process-fork)',
    '(allow process-exec)',
    '(allow signal (target self))',
    '',
    '; Allow sysctl reads',
    '(allow sysctl-read)',
    '',
    '; Allow reading system files',
  ];

  // Read-only paths
  for (const p of config.readOnlyPaths) {
    rules.push(`(allow file-read* (subpath "${p}"))`);
  }

  // Read-write paths
  for (const p of config.readWritePaths) {
    rules.push(`(allow file-read* file-write* (subpath "${p}"))`);
  }

  // Working directory
  rules.push(`(allow file-read* file-write* (subpath "${config.workDir}"))`);

  // Temp directory
  rules.push('(allow file-read* file-write* (subpath "/tmp"))');
  rules.push('(allow file-read* file-write* (subpath "/private/tmp"))');

  // Allow reading /dev/null, /dev/random, etc.
  rules.push('(allow file-read* (literal "/dev/null"))');
  rules.push('(allow file-read* (literal "/dev/random"))');
  rules.push('(allow file-read* (literal "/dev/urandom"))');
  rules.push('(allow file-write* (literal "/dev/null"))');

  // Network
  if (config.allowNetwork) {
    rules.push('');
    rules.push('; Allow network access');
    rules.push('(allow network*)');
  }

  // Subprocess
  if (!config.allowSubprocess) {
    rules.push('');
    rules.push('; Deny subprocess creation');
    rules.push('(deny process-fork)');
  }

  return rules.join('\n');
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
  const profilePath = path.join(os.tmpdir(), `grok-sandbox-${Date.now()}.sb`);
  fs.writeFileSync(profilePath, profile);

  try {
    const sandboxArgs = [
      '-f', profilePath,
      command,
      ...args,
    ];

    const result = await execWithTimeout('sandbox-exec', sandboxArgs, config.timeout, 'seatbelt');
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
      const major = parseInt(match[1], 10);
      const minor = parseInt(match[2], 10);
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
  for (let i = 0; i < numSyscalls; i++) {
    const remainingCompares = numSyscalls - 1 - i;
    const jumpToKill = remainingCompares + 1; // skip remaining compares + allow
    buf.writeUInt16LE(BPF_JMP | BPF_JEQ | BPF_K, off);
    buf.writeUInt8(jumpToKill, off + 2); // jt: jump to KILL
    buf.writeUInt8(0, off + 3);          // jf: next instruction
    buf.writeUInt32LE(syscalls[i], off + 4);
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

    // Mount read-only paths
    for (const p of config.readOnlyPaths) {
      if (fs.existsSync(p)) {
        bwrapArgs.push('--ro-bind', p, p);
      }
    }

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
      ...config.env,
    };

    for (const [key, value] of Object.entries(envVars)) {
      bwrapArgs.push('--setenv', key, value);
    }

    // Add the command
    bwrapArgs.push(command, ...args);

    // Execute bwrap with the seccomp filter passed via fd 9
    const result = await execWithSeccomp('bwrap', bwrapArgs, config.timeout, seccompPath);
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
  seccompPath: string
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

export class OSSandbox extends EventEmitter {
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
   * Check if sandboxing is available
   */
  isAvailable(): boolean {
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
          result = await execUnsandboxed(command, args, this.config.timeout);
          result.backend = 'docker';
          result.sandboxed = false; // Mark as not sandboxed by OS
          break;

        case 'none':
        default:
          result = await execUnsandboxed(command, args, this.config.timeout);
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
    const baseCommand = trimmed.split(/\s+/)[0];
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

    if (!this.isAvailable() && this.config.allowUnsandboxed) {
      this.stats.commandsBypassed++;
      const shell = os.platform() === 'win32' ? 'cmd' : 'sh';
      const shellArg = os.platform() === 'win32' ? '/c' : '-c';
      return execUnsandboxed(shell, [shellArg, shellCommand], this.config.timeout);
    }

    this.stats.commandsSandboxed++;
    return this.execShell(shellCommand);
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
  backend: SandboxBackend
): Promise<OSSandboxResult> {
  return new Promise((resolve) => {
    const startTime = Date.now();

    const options: SpawnOptions = {
      stdio: ['ignore', 'pipe', 'pipe'],
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
      resolve({
        exitCode: 1,
        stdout: '',
        stderr: err.message,
        duration: Date.now() - startTime,
        timedOut: false,
        backend,
        sandboxed: false,
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
  timeout: number
): Promise<OSSandboxResult> {
  return new Promise((resolve) => {
    const startTime = Date.now();

    const proc = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
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
