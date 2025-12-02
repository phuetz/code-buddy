/**
 * Sandboxed Terminal
 *
 * Provides secure, isolated terminal execution with:
 * - Network isolation (optional)
 * - Filesystem restrictions
 * - Resource limits
 * - Process isolation
 *
 * Inspired by Cursor 2.0's sandboxed terminals.
 */

import { spawn, SpawnOptions, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs-extra';

export interface SandboxTerminalConfig {
  // Isolation settings
  networkEnabled: boolean;
  allowedDomains?: string[];

  // Filesystem
  workspaceRoot: string;
  readOnlyPaths: string[];
  allowedWritePaths: string[];
  blockedPaths: string[];

  // Resource limits
  maxMemoryMB: number;
  maxCpuPercent: number;
  maxProcesses: number;
  timeoutMs: number;
  maxOutputSize: number;

  // Execution settings
  shell: string;
  env: Record<string, string>;

  // Sandbox method
  method: 'none' | 'namespace' | 'firejail' | 'docker' | 'bubblewrap';
}

export interface SandboxExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  killed: boolean;
  sandboxed: boolean;
  method: string;
  duration: number;
  resourceUsage?: {
    cpuTime: number;
    maxMemory: number;
  };
}

export interface SandboxSession {
  id: string;
  process: ChildProcess | null;
  config: SandboxTerminalConfig;
  startTime: number;
  commandHistory: string[];
  cwd: string;
}

const DEFAULT_CONFIG: SandboxTerminalConfig = {
  networkEnabled: false,
  workspaceRoot: process.cwd(),
  readOnlyPaths: ['/usr', '/bin', '/lib', '/lib64', '/etc'],
  allowedWritePaths: [],
  blockedPaths: [
    path.join(os.homedir(), '.ssh'),
    path.join(os.homedir(), '.gnupg'),
    path.join(os.homedir(), '.aws'),
    path.join(os.homedir(), '.config/gcloud'),
    path.join(os.homedir(), '.kube'),
    path.join(os.homedir(), '.docker'),
    '~/.ssh',      // Also block tilde-prefixed paths
    '~/.gnupg',
    '~/.aws',
    '~/.config/gcloud',
    '~/.kube',
    '~/.docker',
    '/etc/passwd',
    '/etc/shadow',
  ],
  maxMemoryMB: 512,
  maxCpuPercent: 50,
  maxProcesses: 10,
  timeoutMs: 30000,
  maxOutputSize: 1024 * 1024, // 1MB
  shell: '/bin/bash',
  env: {},
  method: 'namespace',
};

const DANGEROUS_COMMANDS = [
  /rm\s+(-rf?|--recursive)\s+[/~]/i,
  /dd\s+.*of=\/dev/i,
  /mkfs/i,
  /:\(\)\s*\{\s*:\|:&\s*\};:/,  // Fork bomb - escape parens and braces
  /chmod\s+-R\s+777\s+\//i,
  />\s*\/dev\/sd[a-z]/i,
  /wget.*\|\s*(ba)?sh/i,
  /curl.*\|\s*(ba)?sh/i,
  /eval\s+\$\(/i,
];

/**
 * Sandboxed Terminal Manager
 */
export class SandboxedTerminal extends EventEmitter {
  private config: SandboxTerminalConfig;
  private sessions: Map<string, SandboxSession> = new Map();
  private availableMethods: string[] = [];
  private sessionCounter: number = 0;

  constructor(config: Partial<SandboxTerminalConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.detectAvailableMethods();
  }

  /**
   * Detect available sandboxing methods
   */
  private async detectAvailableMethods(): Promise<void> {
    this.availableMethods = ['none'];

    // Check for Linux namespace support
    if (process.platform === 'linux') {
      try {
        await this.checkCommand('unshare --version');
        this.availableMethods.push('namespace');
      } catch {
        // Not available
      }
    }

    // Check for firejail
    try {
      await this.checkCommand('firejail --version');
      this.availableMethods.push('firejail');
    } catch {
      // Not available
    }

    // Check for bubblewrap
    try {
      await this.checkCommand('bwrap --version');
      this.availableMethods.push('bubblewrap');
    } catch {
      // Not available
    }

    // Check for docker
    try {
      await this.checkCommand('docker --version');
      this.availableMethods.push('docker');
    } catch {
      // Not available
    }

    this.emit('methods:detected', { methods: this.availableMethods });
  }

  /**
   * Check if a command exists
   */
  private checkCommand(command: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn('sh', ['-c', command], { stdio: 'pipe' });
      proc.on('close', code => {
        if (code === 0) resolve();
        else reject(new Error(`Command not found: ${command}`));
      });
      proc.on('error', reject);
    });
  }

  /**
   * Validate command before execution
   */
  validateCommand(command: string): { valid: boolean; reason?: string } {
    // Check for dangerous patterns
    for (const pattern of DANGEROUS_COMMANDS) {
      if (pattern.test(command)) {
        return {
          valid: false,
          reason: `Blocked dangerous pattern: ${pattern.source}`,
        };
      }
    }

    // Check for blocked path access
    for (const blockedPath of this.config.blockedPaths) {
      if (command.includes(blockedPath)) {
        return {
          valid: false,
          reason: `Access to blocked path: ${blockedPath}`,
        };
      }
    }

    return { valid: true };
  }

  /**
   * Execute command in sandbox
   */
  async execute(
    command: string,
    options: Partial<SandboxTerminalConfig> = {}
  ): Promise<SandboxExecResult> {
    const startTime = Date.now();
    const effectiveConfig = { ...this.config, ...options };

    // Validate command
    const validation = this.validateCommand(command);
    if (!validation.valid) {
      return {
        stdout: '',
        stderr: validation.reason || 'Command validation failed',
        exitCode: 1,
        timedOut: false,
        killed: false,
        sandboxed: false,
        method: 'none',
        duration: 0,
      };
    }

    this.emit('exec:start', { command, config: effectiveConfig });

    // Select best available method
    const method = this.selectMethod(effectiveConfig.method);

    let result: SandboxExecResult;

    switch (method) {
      case 'namespace':
        result = await this.executeWithNamespace(command, effectiveConfig);
        break;
      case 'firejail':
        result = await this.executeWithFirejail(command, effectiveConfig);
        break;
      case 'bubblewrap':
        result = await this.executeWithBubblewrap(command, effectiveConfig);
        break;
      case 'docker':
        result = await this.executeWithDocker(command, effectiveConfig);
        break;
      default:
        result = await this.executeNative(command, effectiveConfig);
    }

    result.duration = Date.now() - startTime;
    this.emit('exec:complete', { result });

    return result;
  }

  /**
   * Select best available sandbox method
   */
  private selectMethod(preferred: string): string {
    if (this.availableMethods.includes(preferred)) {
      return preferred;
    }

    // Priority: bubblewrap > firejail > namespace > none
    const priority = ['bubblewrap', 'firejail', 'namespace', 'none'];
    for (const method of priority) {
      if (this.availableMethods.includes(method)) {
        return method;
      }
    }

    return 'none';
  }

  /**
   * Execute with Linux namespaces (unshare)
   */
  private async executeWithNamespace(
    command: string,
    config: SandboxTerminalConfig
  ): Promise<SandboxExecResult> {
    const namespaceArgs = [
      '--mount',
      '--pid',
      '--fork',
    ];

    if (!config.networkEnabled) {
      namespaceArgs.push('--net');
    }

    const fullCommand = `unshare ${namespaceArgs.join(' ')} -- ${config.shell} -c "${command.replace(/"/g, '\\"')}"`;

    return this.executeRaw(fullCommand, config, 'namespace');
  }

  /**
   * Execute with firejail
   */
  private async executeWithFirejail(
    command: string,
    config: SandboxTerminalConfig
  ): Promise<SandboxExecResult> {
    const firejailArgs = [
      '--quiet',
      '--private-tmp',
      '--nogroups',
      '--nonewprivs',
      '--noroot',
      `--timeout=${Math.floor(config.timeoutMs / 1000)}`,
      `--rlimit-as=${config.maxMemoryMB * 1024 * 1024}`,
      `--rlimit-nproc=${config.maxProcesses}`,
    ];

    // Network
    if (!config.networkEnabled) {
      firejailArgs.push('--net=none');
    }

    // Filesystem
    firejailArgs.push(`--whitelist=${config.workspaceRoot}`);

    for (const blockedPath of config.blockedPaths) {
      firejailArgs.push(`--blacklist=${blockedPath}`);
    }

    for (const readOnlyPath of config.readOnlyPaths) {
      firejailArgs.push(`--read-only=${readOnlyPath}`);
    }

    const fullCommand = `firejail ${firejailArgs.join(' ')} -- ${config.shell} -c "${command.replace(/"/g, '\\"')}"`;

    return this.executeRaw(fullCommand, config, 'firejail');
  }

  /**
   * Execute with bubblewrap
   */
  private async executeWithBubblewrap(
    command: string,
    config: SandboxTerminalConfig
  ): Promise<SandboxExecResult> {
    const bwrapArgs = [
      '--unshare-pid',
      '--unshare-ipc',
      '--unshare-uts',
      '--die-with-parent',
      '--new-session',
      '--dev', '/dev',
      '--proc', '/proc',
      '--tmpfs', '/tmp',
    ];

    // Network
    if (!config.networkEnabled) {
      bwrapArgs.push('--unshare-net');
    }

    // Bind workspace as read-write
    bwrapArgs.push('--bind', config.workspaceRoot, config.workspaceRoot);

    // Bind system paths as read-only
    for (const readOnlyPath of config.readOnlyPaths) {
      if (fs.existsSync(readOnlyPath)) {
        bwrapArgs.push('--ro-bind', readOnlyPath, readOnlyPath);
      }
    }

    const fullCommand = `bwrap ${bwrapArgs.join(' ')} -- ${config.shell} -c "${command.replace(/"/g, '\\"')}"`;

    return this.executeRaw(fullCommand, config, 'bubblewrap');
  }

  /**
   * Execute with Docker
   */
  private async executeWithDocker(
    command: string,
    config: SandboxTerminalConfig
  ): Promise<SandboxExecResult> {
    const dockerArgs = [
      'run',
      '--rm',
      '-i',
      '--user', '1000:1000',
      '--memory', `${config.maxMemoryMB}m`,
      '--cpus', `${config.maxCpuPercent / 100}`,
      '--pids-limit', String(config.maxProcesses),
      '--read-only',
      '--tmpfs', '/tmp:rw,size=64m',
      '-v', `${config.workspaceRoot}:/workspace:rw`,
      '-w', '/workspace',
    ];

    // Network
    if (!config.networkEnabled) {
      dockerArgs.push('--network', 'none');
    }

    // Security options
    dockerArgs.push('--security-opt', 'no-new-privileges');
    dockerArgs.push('--cap-drop', 'ALL');

    dockerArgs.push('alpine:latest', '/bin/sh', '-c', command);

    const fullCommand = `docker ${dockerArgs.join(' ')}`;

    return this.executeRaw(fullCommand, config, 'docker');
  }

  /**
   * Execute without sandbox (fallback)
   */
  private async executeNative(
    command: string,
    config: SandboxTerminalConfig
  ): Promise<SandboxExecResult> {
    return this.executeRaw(command, config, 'none');
  }

  /**
   * Raw command execution
   */
  private executeRaw(
    command: string,
    config: SandboxTerminalConfig,
    method: string
  ): Promise<SandboxExecResult> {
    return new Promise(resolve => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let killed = false;

      const spawnOptions: SpawnOptions = {
        shell: true,
        cwd: config.workspaceRoot,
        env: {
          ...process.env,
          ...config.env,
          HISTFILE: '/dev/null',
          HISTSIZE: '0',
          HOME: config.workspaceRoot,
        },
      };

      const proc = spawn('sh', ['-c', command], spawnOptions);

      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill('SIGKILL');
      }, config.timeoutMs);

      proc.stdout?.on('data', data => {
        const chunk = data.toString();
        if (stdout.length + chunk.length <= config.maxOutputSize) {
          stdout += chunk;
        }
      });

      proc.stderr?.on('data', data => {
        const chunk = data.toString();
        if (stderr.length + chunk.length <= config.maxOutputSize) {
          stderr += chunk;
        }
      });

      proc.on('close', exitCode => {
        clearTimeout(timer);
        resolve({
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: exitCode ?? 1,
          timedOut,
          killed,
          sandboxed: method !== 'none',
          method,
          duration: 0, // Set by caller
        });
      });

      proc.on('error', error => {
        clearTimeout(timer);
        resolve({
          stdout: '',
          stderr: error.message,
          exitCode: 1,
          timedOut: false,
          killed: false,
          sandboxed: method !== 'none',
          method,
          duration: 0,
        });
      });
    });
  }

  /**
   * Create an interactive sandbox session
   */
  createSession(config?: Partial<SandboxTerminalConfig>): SandboxSession {
    const sessionConfig = { ...this.config, ...config };
    const session: SandboxSession = {
      id: `sandbox_${++this.sessionCounter}`,
      process: null,
      config: sessionConfig,
      startTime: Date.now(),
      commandHistory: [],
      cwd: sessionConfig.workspaceRoot,
    };

    this.sessions.set(session.id, session);
    this.emit('session:created', { sessionId: session.id });

    return session;
  }

  /**
   * Execute in session
   */
  async executeInSession(
    sessionId: string,
    command: string
  ): Promise<SandboxExecResult> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return {
        stdout: '',
        stderr: 'Session not found',
        exitCode: 1,
        timedOut: false,
        killed: false,
        sandboxed: false,
        method: 'none',
        duration: 0,
      };
    }

    session.commandHistory.push(command);

    // Handle cd command
    if (command.startsWith('cd ')) {
      const newDir = command.substring(3).trim().replace(/^["']|["']$/g, '');
      const targetDir = path.isAbsolute(newDir)
        ? newDir
        : path.join(session.cwd, newDir);

      // Ensure within workspace
      if (!targetDir.startsWith(session.config.workspaceRoot)) {
        return {
          stdout: '',
          stderr: 'Cannot navigate outside workspace',
          exitCode: 1,
          timedOut: false,
          killed: false,
          sandboxed: true,
          method: 'session',
          duration: 0,
        };
      }

      session.cwd = targetDir;
      return {
        stdout: `Changed directory to: ${targetDir}`,
        stderr: '',
        exitCode: 0,
        timedOut: false,
        killed: false,
        sandboxed: true,
        method: 'session',
        duration: 0,
      };
    }

    return this.execute(command, {
      ...session.config,
      workspaceRoot: session.cwd,
    });
  }

  /**
   * Close session
   */
  closeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      if (session.process) {
        session.process.kill('SIGTERM');
      }
      this.sessions.delete(sessionId);
      this.emit('session:closed', { sessionId });
    }
  }

  /**
   * Get available sandboxing methods
   */
  getAvailableMethods(): string[] {
    return [...this.availableMethods];
  }

  /**
   * Format status
   */
  formatStatus(): string {
    const lines = [
      '╔══════════════════════════════════════╗',
      '║      SANDBOXED TERMINAL STATUS       ║',
      '╠══════════════════════════════════════╣',
      `║ Available methods:                   ║`,
      ...this.availableMethods.map(m => `║   • ${m.padEnd(32)}║`),
      `║ Active sessions: ${this.sessions.size.toString().padEnd(19)}║`,
      `║ Network: ${(this.config.networkEnabled ? 'enabled' : 'disabled').padEnd(27)}║`,
      `║ Timeout: ${(this.config.timeoutMs + 'ms').padEnd(27)}║`,
      '╚══════════════════════════════════════╝',
    ];
    return lines.join('\n');
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<SandboxTerminalConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get configuration
   */
  getConfig(): SandboxTerminalConfig {
    return { ...this.config };
  }
}

// Singleton
let sandboxedTerminalInstance: SandboxedTerminal | null = null;

export function getSandboxedTerminal(
  config?: Partial<SandboxTerminalConfig>
): SandboxedTerminal {
  if (!sandboxedTerminalInstance) {
    sandboxedTerminalInstance = new SandboxedTerminal(config);
  }
  return sandboxedTerminalInstance;
}

export function resetSandboxedTerminal(): void {
  sandboxedTerminalInstance = null;
}
