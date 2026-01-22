/**
 * Docker Sandbox Mode
 *
 * Executes commands in isolated Docker containers for maximum security.
 * Provides filesystem isolation, network restrictions, and resource limits.
 *
 * Inspired by VibeKit's E2B/Modal/Daytona sandbox integration.
 */

import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import * as path from 'path';
import { existsSync } from 'fs';

// ============================================================================
// Types
// ============================================================================

export interface SandboxConfig {
  /** Docker image to use */
  image: string;
  /** Working directory inside container */
  workDir: string;
  /** Mount host directory to container */
  mounts: SandboxMount[];
  /** Environment variables */
  env: Record<string, string>;
  /** Resource limits */
  limits: ResourceLimits;
  /** Network mode */
  network: NetworkMode;
  /** User to run as */
  user?: string;
  /** Timeout for commands (ms) */
  timeout: number;
  /** Keep container alive between commands */
  persistent: boolean;
  /** Container name prefix */
  namePrefix: string;
}

export interface SandboxMount {
  hostPath: string;
  containerPath: string;
  readOnly: boolean;
}

export interface ResourceLimits {
  /** Memory limit (e.g., "512m", "2g") */
  memory: string;
  /** CPU limit (e.g., "1.0", "2.5") */
  cpus: string;
  /** Max processes */
  pidsLimit: number;
  /** Disk quota in bytes */
  storageQuota?: number;
}

export type NetworkMode = 'none' | 'bridge' | 'host';

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
  timedOut: boolean;
}

export interface SandboxStatus {
  running: boolean;
  containerId?: string;
  containerName?: string;
  image: string;
  uptime?: number;
  resourceUsage?: {
    memoryUsed: number;
    memoryLimit: number;
    cpuPercent: number;
  };
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: SandboxConfig = {
  image: 'node:20-slim',
  workDir: '/workspace',
  mounts: [],
  env: {},
  limits: {
    memory: '512m',
    cpus: '1.0',
    pidsLimit: 100,
  },
  network: 'none',
  timeout: 60000,
  persistent: true,
  namePrefix: 'grok-sandbox',
};

// Prebuilt images with common development tools
export const SANDBOX_IMAGES = {
  minimal: 'alpine:latest',
  node: 'node:20-slim',
  nodeFull: 'node:20',
  python: 'python:3.12-slim',
  pythonFull: 'python:3.12',
  rust: 'rust:slim',
  go: 'golang:1.22-alpine',
  deno: 'denoland/deno:latest',
  bun: 'oven/bun:latest',
  ubuntu: 'ubuntu:24.04',
} as const;

// ============================================================================
// Docker Sandbox
// ============================================================================

export class DockerSandbox extends EventEmitter {
  private config: SandboxConfig;
  private containerId: string | null = null;
  private containerName: string;
  private startTime: number | null = null;
  private dockerAvailable: boolean | null = null;

  constructor(config: Partial<SandboxConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.containerName = `${this.config.namePrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * Check if Docker is available
   */
  async isDockerAvailable(): Promise<boolean> {
    if (this.dockerAvailable !== null) {
      return this.dockerAvailable;
    }

    try {
      const result = await this.runDockerCommand(['version', '--format', '{{.Server.Version}}']);
      this.dockerAvailable = result.exitCode === 0;
      return this.dockerAvailable;
    } catch {
      this.dockerAvailable = false;
      return false;
    }
  }

  /**
   * Start the sandbox container
   */
  async start(): Promise<void> {
    if (this.containerId) {
      return; // Already running
    }

    if (!await this.isDockerAvailable()) {
      throw new Error('Docker is not available. Please install Docker to use sandbox mode.');
    }

    // Pull image if needed
    await this.pullImage();

    // Build docker run command
    const args = this.buildRunArgs();

    const result = await this.runDockerCommand(args);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to start sandbox: ${result.stderr}`);
    }

    this.containerId = result.stdout.trim();
    this.startTime = Date.now();

    this.emit('started', { containerId: this.containerId, containerName: this.containerName });
  }

  /**
   * Execute a command in the sandbox
   */
  async exec(command: string, options: {
    timeout?: number;
    env?: Record<string, string>;
    workDir?: string;
    stdin?: string;
  } = {}): Promise<CommandResult> {
    if (!this.containerId) {
      if (this.config.persistent) {
        await this.start();
      } else {
        // Run in a one-shot container
        return this.execOneShot(command, options);
      }
    }

    const startTime = Date.now();
    const timeout = options.timeout ?? this.config.timeout;

    // Build exec args
    const args = ['exec'];

    // Add environment variables
    for (const [key, value] of Object.entries({ ...this.config.env, ...options.env })) {
      args.push('-e', `${key}=${value}`);
    }

    // Working directory
    if (options.workDir) {
      args.push('-w', options.workDir);
    }

    // Interactive mode for stdin
    if (options.stdin) {
      args.push('-i');
    }

    args.push(this.containerId!);
    args.push('sh', '-c', command);

    const result = await this.runDockerCommand(args, { timeout, stdin: options.stdin });

    return {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      duration: Date.now() - startTime,
      timedOut: result.timedOut || false,
    };
  }

  /**
   * Execute in a one-shot container
   */
  private async execOneShot(command: string, options: {
    timeout?: number;
    env?: Record<string, string>;
    workDir?: string;
    stdin?: string;
  } = {}): Promise<CommandResult> {
    const startTime = Date.now();
    const timeout = options.timeout ?? this.config.timeout;

    // Build run args for one-shot execution
    const args = ['run', '--rm'];
    args.push(...this.buildSecurityArgs());
    args.push(...this.buildMountArgs());
    args.push(...this.buildEnvArgs({ ...this.config.env, ...options.env }));
    args.push('-w', options.workDir || this.config.workDir);

    if (options.stdin) {
      args.push('-i');
    }

    args.push(this.config.image);
    args.push('sh', '-c', command);

    const result = await this.runDockerCommand(args, { timeout, stdin: options.stdin });

    return {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      duration: Date.now() - startTime,
      timedOut: result.timedOut || false,
    };
  }

  /**
   * Copy file to sandbox
   */
  async copyTo(hostPath: string, containerPath: string): Promise<void> {
    if (!this.containerId) {
      throw new Error('Docker sandbox is not running. Start it with start() before performing operations.');
    }

    const result = await this.runDockerCommand(['cp', hostPath, `${this.containerId}:${containerPath}`]);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to copy file: ${result.stderr}`);
    }
  }

  /**
   * Copy file from sandbox
   */
  async copyFrom(containerPath: string, hostPath: string): Promise<void> {
    if (!this.containerId) {
      throw new Error('Docker sandbox is not running. Start it with start() before performing operations.');
    }

    const result = await this.runDockerCommand(['cp', `${this.containerId}:${containerPath}`, hostPath]);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to copy file: ${result.stderr}`);
    }
  }

  /**
   * Get sandbox status
   */
  async getStatus(): Promise<SandboxStatus> {
    if (!this.containerId) {
      return {
        running: false,
        image: this.config.image,
      };
    }

    // Check if container is still running
    const inspect = await this.runDockerCommand([
      'inspect',
      '--format',
      '{{.State.Running}}',
      this.containerId,
    ]);

    const running = inspect.stdout.trim() === 'true';

    if (!running) {
      this.containerId = null;
      this.startTime = null;
      return {
        running: false,
        image: this.config.image,
      };
    }

    // Get resource usage
    const stats = await this.runDockerCommand([
      'stats',
      '--no-stream',
      '--format',
      '{{.MemUsage}},{{.MemPerc}},{{.CPUPerc}}',
      this.containerId,
    ]);

    let resourceUsage: SandboxStatus['resourceUsage'];
    if (stats.exitCode === 0) {
      const [memUsage, _memPerc, cpuPerc] = stats.stdout.trim().split(',');
      const memParts = memUsage?.split(' / ') || [];
      resourceUsage = {
        memoryUsed: this.parseMemory(memParts[0] || '0'),
        memoryLimit: this.parseMemory(memParts[1] || '0'),
        cpuPercent: parseFloat(cpuPerc?.replace('%', '') || '0'),
      };
    }

    return {
      running: true,
      containerId: this.containerId,
      containerName: this.containerName,
      image: this.config.image,
      uptime: this.startTime ? Date.now() - this.startTime : undefined,
      resourceUsage,
    };
  }

  /**
   * Stop the sandbox
   */
  async stop(): Promise<void> {
    if (!this.containerId) {
      return;
    }

    await this.runDockerCommand(['stop', '-t', '5', this.containerId]);
    await this.runDockerCommand(['rm', '-f', this.containerId]);

    this.emit('stopped', { containerId: this.containerId });

    this.containerId = null;
    this.startTime = null;
  }

  /**
   * Restart the sandbox
   */
  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  /**
   * Pull the Docker image
   */
  private async pullImage(): Promise<void> {
    // Check if image exists locally
    const check = await this.runDockerCommand(['images', '-q', this.config.image]);
    if (check.stdout.trim()) {
      return; // Image already exists
    }

    this.emit('pulling', { image: this.config.image });

    const result = await this.runDockerCommand(['pull', this.config.image], { timeout: 300000 });
    if (result.exitCode !== 0) {
      throw new Error(`Failed to pull image ${this.config.image}: ${result.stderr}`);
    }

    this.emit('pulled', { image: this.config.image });
  }

  /**
   * Build docker run arguments
   */
  private buildRunArgs(): string[] {
    const args = ['run', '-d'];

    // Container name
    args.push('--name', this.containerName);

    // Security options
    args.push(...this.buildSecurityArgs());

    // Mounts
    args.push(...this.buildMountArgs());

    // Environment
    args.push(...this.buildEnvArgs(this.config.env));

    // Working directory
    args.push('-w', this.config.workDir);

    // User
    if (this.config.user) {
      args.push('-u', this.config.user);
    }

    // Keep alive with sleep infinity
    args.push(this.config.image);
    args.push('sh', '-c', 'sleep infinity');

    return args;
  }

  /**
   * Build security-related arguments
   */
  private buildSecurityArgs(): string[] {
    const args: string[] = [];

    // Resource limits
    args.push('--memory', this.config.limits.memory);
    args.push('--cpus', this.config.limits.cpus);
    args.push('--pids-limit', String(this.config.limits.pidsLimit));

    // Network mode
    args.push('--network', this.config.network);

    // Security options
    args.push('--security-opt', 'no-new-privileges:true');

    // Drop capabilities
    args.push('--cap-drop', 'ALL');

    // Add only necessary capabilities
    args.push('--cap-add', 'CHOWN');
    args.push('--cap-add', 'DAC_OVERRIDE');
    args.push('--cap-add', 'FOWNER');
    args.push('--cap-add', 'SETGID');
    args.push('--cap-add', 'SETUID');

    // Read-only root filesystem (optional, can be enabled for max security)
    // args.push('--read-only');
    // args.push('--tmpfs', '/tmp:rw,noexec,nosuid,size=100m');

    return args;
  }

  /**
   * Build mount arguments
   */
  private buildMountArgs(): string[] {
    const args: string[] = [];

    for (const mount of this.config.mounts) {
      const hostPath = path.resolve(mount.hostPath);
      const opt = mount.readOnly ? ':ro' : ':rw';
      args.push('-v', `${hostPath}:${mount.containerPath}${opt}`);
    }

    return args;
  }

  /**
   * Build environment arguments
   */
  private buildEnvArgs(env: Record<string, string>): string[] {
    const args: string[] = [];

    for (const [key, value] of Object.entries(env)) {
      args.push('-e', `${key}=${value}`);
    }

    return args;
  }

  /**
   * Run a docker command
   */
  private runDockerCommand(args: string[], options: {
    timeout?: number;
    stdin?: string;
  } = {}): Promise<{ exitCode: number; stdout: string; stderr: string; timedOut?: boolean }> {
    return new Promise((resolve) => {
      const proc = spawn('docker', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      if (options.stdin) {
        proc.stdin.write(options.stdin);
        proc.stdin.end();
      }

      const timeout = options.timeout || 60000;
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
          timedOut,
        });
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        resolve({
          exitCode: 1,
          stdout: '',
          stderr: err.message,
          timedOut: false,
        });
      });
    });
  }

  /**
   * Parse memory string to bytes
   */
  private parseMemory(str: string): number {
    const match = str.match(/^([\d.]+)\s*(B|KB|KiB|MB|MiB|GB|GiB)?$/i);
    if (!match) return 0;

    const value = parseFloat(match[1]);
    const unit = (match[2] || 'B').toUpperCase();

    const multipliers: Record<string, number> = {
      B: 1,
      KB: 1000,
      KIB: 1024,
      MB: 1000000,
      MIB: 1048576,
      GB: 1000000000,
      GIB: 1073741824,
    };

    return value * (multipliers[unit] || 1);
  }

  /**
   * Dispose resources
   */
  async dispose(): Promise<void> {
    await this.stop();
    this.removeAllListeners();
  }
}

// ============================================================================
// Sandbox Manager
// ============================================================================

export class SandboxManager extends EventEmitter {
  private sandboxes: Map<string, DockerSandbox> = new Map();
  private defaultConfig: Partial<SandboxConfig>;

  constructor(defaultConfig: Partial<SandboxConfig> = {}) {
    super();
    this.defaultConfig = defaultConfig;
  }

  /**
   * Create a new sandbox
   */
  async create(name: string, config: Partial<SandboxConfig> = {}): Promise<DockerSandbox> {
    if (this.sandboxes.has(name)) {
      throw new Error(`Sandbox "${name}" already exists`);
    }

    const sandbox = new DockerSandbox({ ...this.defaultConfig, ...config });
    this.sandboxes.set(name, sandbox);

    // Forward events
    sandbox.on('started', (data) => this.emit('sandbox:started', { name, ...data }));
    sandbox.on('stopped', (data) => this.emit('sandbox:stopped', { name, ...data }));

    return sandbox;
  }

  /**
   * Get sandbox by name
   */
  get(name: string): DockerSandbox | undefined {
    return this.sandboxes.get(name);
  }

  /**
   * Get or create sandbox
   */
  async getOrCreate(name: string, config: Partial<SandboxConfig> = {}): Promise<DockerSandbox> {
    const existing = this.sandboxes.get(name);
    if (existing) {
      return existing;
    }
    return this.create(name, config);
  }

  /**
   * Destroy sandbox
   */
  async destroy(name: string): Promise<void> {
    const sandbox = this.sandboxes.get(name);
    if (sandbox) {
      await sandbox.dispose();
      this.sandboxes.delete(name);
    }
  }

  /**
   * List all sandboxes
   */
  list(): string[] {
    return Array.from(this.sandboxes.keys());
  }

  /**
   * Destroy all sandboxes
   */
  async destroyAll(): Promise<void> {
    const names = this.list();
    await Promise.all(names.map(name => this.destroy(name)));
  }

  /**
   * Dispose manager and all sandboxes
   */
  async dispose(): Promise<void> {
    await this.destroyAll();
    this.removeAllListeners();
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a sandbox for project development
 */
export async function createProjectSandbox(
  projectPath: string,
  options: {
    image?: string;
    network?: NetworkMode;
    env?: Record<string, string>;
  } = {}
): Promise<DockerSandbox> {
  // Detect project type
  let image = options.image || 'node:20-slim';

  if (!options.image) {
    if (existsSync(path.join(projectPath, 'package.json'))) {
      image = 'node:20-slim';
    } else if (existsSync(path.join(projectPath, 'requirements.txt')) ||
               existsSync(path.join(projectPath, 'pyproject.toml'))) {
      image = 'python:3.12-slim';
    } else if (existsSync(path.join(projectPath, 'Cargo.toml'))) {
      image = 'rust:slim';
    } else if (existsSync(path.join(projectPath, 'go.mod'))) {
      image = 'golang:1.22-alpine';
    }
  }

  const sandbox = new DockerSandbox({
    image,
    mounts: [
      {
        hostPath: projectPath,
        containerPath: '/workspace',
        readOnly: false,
      },
    ],
    network: options.network || 'bridge', // Allow network for npm/pip
    env: options.env || {},
    workDir: '/workspace',
    persistent: true,
  });

  await sandbox.start();
  return sandbox;
}

/**
 * Quick execute in a temporary sandbox
 */
export async function sandboxExec(
  command: string,
  options: {
    image?: string;
    env?: Record<string, string>;
    timeout?: number;
    workDir?: string;
    mounts?: SandboxMount[];
  } = {}
): Promise<CommandResult> {
  const sandbox = new DockerSandbox({
    image: options.image || 'alpine:latest',
    env: options.env || {},
    mounts: options.mounts || [],
    workDir: options.workDir || '/workspace',
    persistent: false,
    network: 'none',
  });

  try {
    return await sandbox.exec(command, { timeout: options.timeout });
  } finally {
    await sandbox.dispose();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let sandboxManagerInstance: SandboxManager | null = null;

export function getSandboxManager(): SandboxManager {
  if (!sandboxManagerInstance) {
    sandboxManagerInstance = new SandboxManager();
  }
  return sandboxManagerInstance;
}

export function resetSandboxManager(): void {
  if (sandboxManagerInstance) {
    sandboxManagerInstance.dispose();
  }
  sandboxManagerInstance = null;
}
