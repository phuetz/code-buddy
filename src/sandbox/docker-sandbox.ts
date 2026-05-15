/**
 * Docker Sandbox Module
 *
 * Executes commands in isolated Docker containers for maximum security.
 * Provides filesystem isolation, network restrictions, and resource limits.
 */

import { execSync, spawn, spawnSync, ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import type { SandboxBackendInterface, SandboxExecOptions, SandboxExecResult } from './sandbox-backend.js';
// Re-export SandboxExecResult to unify with the local SandboxResult shape
export type { SandboxExecOptions, SandboxExecResult } from './sandbox-backend.js';

// ============================================================================
// Types
// ============================================================================

export interface SandboxConfig {
  /** Docker image to use */
  image: string;
  /** Host path to mount as /workspace */
  workspaceMount?: string;
  /** Command timeout in ms */
  timeout: number;
  /** Memory limit (e.g., '512m') */
  memoryLimit: string;
  /** CPU limit (e.g., '1.0') */
  cpuLimit: string;
  /** Whether networking is enabled */
  networkEnabled: boolean;
  /** Whether the root filesystem is read-only */
  readOnly: boolean;
  /** Timezone override (IANA format e.g. 'America/New_York') — Native Engine v2026.3.8 alignment */
  timezone?: string;
}

export interface SandboxResult {
  success: boolean;
  output: string;
  error?: string;
  exitCode: number;
  durationMs: number;
  containerId?: string;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: SandboxConfig = {
  image: 'node:22.13-slim',
  timeout: 30000,
  memoryLimit: '512m',
  cpuLimit: '1.0',
  networkEnabled: false,
  readOnly: false,
};

// ============================================================================
// Docker Sandbox
// ============================================================================

/**
 * Module-level set of container names that need to be killed on process
 * exit. This is shared across DockerSandbox instances so a single
 * `process.on(...)` handler covers every sandbox in the runtime.
 *
 * Rationale (F22): the per-instance `activeContainers` Set is correctly
 * maintained on the async close/error handlers, but if the Node process
 * crashes, is killed with SIGKILL, or exits via an uncaught exception,
 * those handlers never fire and Docker containers stay up, silently
 * consuming RAM/CPU/ports until the user runs `docker rm -f` by hand.
 */
const globalActiveContainers: Set<string> = new Set();
let processCleanupInstalled = false;

function installProcessCleanup(): void {
  if (processCleanupInstalled) return;
  processCleanupInstalled = true;
  const killAll = () => {
    for (const name of globalActiveContainers) {
      try {
        spawnSync('docker', ['kill', name], { stdio: 'ignore', timeout: 3000 });
      } catch {
        // Best effort — the container may already be gone.
      }
    }
    globalActiveContainers.clear();
  };
  // `exit` fires for normal termination, SIGINT/SIGTERM for Ctrl+C /
  // supervisor kills. We use `.once` so a re-register doesn't stack.
  process.once('exit', killAll);
  process.once('SIGINT', killAll);
  process.once('SIGTERM', killAll);
}

export class DockerSandbox extends EventEmitter implements SandboxBackendInterface {
  readonly name = 'docker';
  private config: SandboxConfig;
  private activeContainers: Set<string> = new Set();

  constructor(config?: Partial<SandboxConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    // Install module-level cleanup the first time any DockerSandbox is
    // constructed so we don't pay the cost when Docker isn't used at all.
    installProcessCleanup();
  }

  /**
   * Check if Docker is available on the system.
   */
  static isAvailable(): boolean {
    try {
      execSync('docker info', { stdio: 'pipe', timeout: 10000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Instance-level availability check (satisfies SandboxBackendInterface).
   */
  async isAvailable(): Promise<boolean> {
    return DockerSandbox.isAvailable();
  }

  /**
   * Execute a command in a sandboxed container.
   */
  async execute(command: string, opts?: Partial<SandboxConfig> | SandboxExecOptions): Promise<SandboxResult> {
    const merged = { ...this.config, ...opts };
    const containerName = `codebuddy-sandbox-${randomUUID().slice(0, 8)}`;
    const startTime = Date.now();

    const args = this.buildDockerArgs(containerName, merged, command);

    return new Promise<SandboxResult>((resolve) => {
      const proc = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let killed = false;

      this.activeContainers.add(containerName);
      globalActiveContainers.add(containerName);
      this.emit('container:started', containerName);

      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      const timer = setTimeout(() => {
        timedOut = true;
        killed = true;
        // Kill the container on timeout
        try {
          spawnSync('docker', ['kill', containerName], { stdio: 'pipe', timeout: 5000 });
        } catch {
          // Container may already be gone
        }
        proc.kill('SIGKILL');
      }, merged.timeout);

      proc.on('close', (code) => {
        clearTimeout(timer);
        this.activeContainers.delete(containerName);
        globalActiveContainers.delete(containerName);
        this.emit('container:stopped', containerName);

        const exitCode = code ?? 1;
        const durationMs = Date.now() - startTime;

        if (timedOut) {
          const error = `Command timed out after ${merged.timeout}ms`;
          resolve({
            success: false,
            output: stdout || error,
            error,
            exitCode: exitCode,
            durationMs,
            containerId: containerName,
          });
        } else {
          const success = exitCode === 0;
          const error = stderr || undefined;
          resolve({
            success,
            output: stdout || (!success ? error ?? '' : ''),
            error,
            exitCode,
            durationMs,
            containerId: containerName,
          });
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        this.activeContainers.delete(containerName);
        globalActiveContainers.delete(containerName);
        this.emit('container:stopped', containerName);

        resolve({
          success: false,
          output: err.message,
          error: err.message,
          exitCode: 1,
          durationMs: Date.now() - startTime,
          containerId: containerName,
        });
      });
    });
  }

  /**
   * Execute with streaming output. Yields stdout chunks as they arrive.
   */
  async *executeStreaming(command: string, opts?: Partial<SandboxConfig>): AsyncGenerator<string, SandboxResult> {
    const merged = { ...this.config, ...opts };
    const containerName = `codebuddy-sandbox-${randomUUID().slice(0, 8)}`;
    const startTime = Date.now();

    const args = this.buildDockerArgs(containerName, merged, command);

    const proc = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let spawnError: string | undefined;

    this.activeContainers.add(containerName);
    globalActiveContainers.add(containerName);
    this.emit('container:started', containerName);

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        spawnSync('docker', ['kill', containerName], { stdio: 'pipe', timeout: 5000 });
      } catch {
        // Container may already be gone
      }
      proc.kill('SIGKILL');
    }, merged.timeout);

    // Create async iterator from stdout
    const chunks: string[] = [];
    let resolveChunk: (() => void) | null = null;
    let streamDone = false;

    proc.stdout.on('data', (data: Buffer) => {
      const chunk = data.toString();
      stdout += chunk;
      chunks.push(chunk);
      if (resolveChunk) {
        const r = resolveChunk;
        resolveChunk = null;
        r();
      }
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    const exitPromise = new Promise<number>((resolve) => {
      proc.on('close', (code) => {
        clearTimeout(timer);
        streamDone = true;
        this.activeContainers.delete(containerName);
        globalActiveContainers.delete(containerName);
        this.emit('container:stopped', containerName);
        if (resolveChunk) {
          const r = resolveChunk;
          resolveChunk = null;
          r();
        }
        resolve(code ?? 1);
      });

      proc.on('error', (err) => {
        spawnError = err.message;
        clearTimeout(timer);
        streamDone = true;
        this.activeContainers.delete(containerName);
        globalActiveContainers.delete(containerName);
        this.emit('container:stopped', containerName);
        if (resolveChunk) {
          const r = resolveChunk;
          resolveChunk = null;
          r();
        }
        resolve(1);
      });
    });

    // Yield chunks as they arrive
    while (!streamDone || chunks.length > 0) {
      if (chunks.length > 0) {
        yield chunks.shift()!;
      } else if (!streamDone) {
        await new Promise<void>((r) => { resolveChunk = r; });
      }
    }

    const exitCode = await exitPromise;
    const durationMs = Date.now() - startTime;
    const success = !timedOut && exitCode === 0;
    const error = timedOut
      ? `Command timed out after ${merged.timeout}ms`
      : spawnError || stderr || undefined;

    return {
      success,
      output: stdout || (!success ? error ?? '' : ''),
      error,
      exitCode,
      durationMs,
      containerId: containerName,
    };
  }

  /**
   * Kill a running container by name/id.
   */
  async kill(containerId: string): Promise<boolean> {
    try {
      spawnSync('docker', ['kill', containerId], { stdio: 'pipe', timeout: 10000 });
      this.activeContainers.delete(containerId);
      globalActiveContainers.delete(containerId);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Prune stopped sandbox containers (label-based).
   * Returns the number of containers pruned.
   */
  async prune(): Promise<number> {
    try {
      const output = execSync(
        'docker container prune -f --filter label=codebuddy-sandbox=true',
        { stdio: 'pipe', timeout: 30000 }
      ).toString();

      const match = output.match(/Deleted Containers:\n([\s\S]*?)\n\n/);
      if (match && match[1]) {
        return match[1].split('\n').filter((l) => l.trim()).length;
      }

      // Alternative: count lines that look like container IDs
      const idMatch = output.match(/Total reclaimed space:/);
      if (idMatch) {
        const lines = output.split('\n').filter((l) => /^[a-f0-9]{12,64}$/.test(l.trim()));
        return lines.length;
      }

      return 0;
    } catch {
      return 0;
    }
  }

  /**
   * Get list of active sandbox container names.
   */
  getActive(): string[] {
    return Array.from(this.activeContainers);
  }

  /**
   * Cleanup all active containers.
   */
  async dispose(): Promise<void> {
    const containers = Array.from(this.activeContainers);
    await Promise.all(containers.map((c) => this.kill(c)));
    this.activeContainers.clear();
    this.removeAllListeners();
  }

  /**
   * Clean up resources (satisfies SandboxBackendInterface).
   */
  async cleanup(): Promise<void> {
    await this.dispose();
  }

  /**
   * Build docker run arguments.
   */
  private buildDockerArgs(containerName: string, config: SandboxConfig, command: string): string[] {
    const args = [
      'run', '--rm',
      '--name', containerName,
      '--label', 'codebuddy-sandbox=true',
      '-m', config.memoryLimit,
      '--cpus', config.cpuLimit,
    ];

    if (!config.networkEnabled) {
      args.push('--network', 'none');
    }

    if (config.readOnly) {
      args.push('--read-only');
    }

    if (config.workspaceMount) {
      if (config.workspaceMount.includes('..') || config.workspaceMount.includes('\0')) {
        throw new Error('Invalid workspace mount path');
      }
      args.push('-v', `${config.workspaceMount}:/workspace`, '-w', '/workspace');
    }

    // Inject CODEBUDDY_CLI env vars so child processes know they're inside Code Buddy
    args.push('-e', `CODEBUDDY_CLI=${process.env.CODEBUDDY_CLI || '1'}`);
    if (process.env.CODEBUDDY_CLI_VERSION) {
      args.push('-e', `CODEBUDDY_CLI_VERSION=${process.env.CODEBUDDY_CLI_VERSION}`);
    }

    // Timezone override (Native Engine v2026.3.8 — CODEBUDDY_TZ env)
    const tz = config.timezone || process.env.CODEBUDDY_TZ;
    if (tz) {
      // Validate IANA timezone format (Continent/City)
      if (/^[A-Z][a-zA-Z]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?$/.test(tz)) {
        args.push('-e', `TZ=${tz}`);
      }
    }

    args.push(config.image, 'sh', '-c', command);

    return args;
  }
}
