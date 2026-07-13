/**
 * Docker Sandbox Module
 *
 * Executes commands in isolated Docker containers for maximum security.
 * Provides filesystem isolation, network restrictions, and resource limits.
 */

import { execSync, spawn, spawnSync } from 'child_process';
import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import type { SandboxBackendInterface, SandboxExecOptions } from './sandbox-backend.js';
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
  /** Preserve the host's absolute workspace path inside Linux containers. */
  preserveWorkspacePath: boolean;
  /** Workspace subpaths that must be overlaid read-only (for example .git). */
  workspaceReadOnly?: string[];
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
  /** Run with the current Unix uid/gid so generated files remain user-owned. */
  runAsHostUser: boolean;
  /** Extra environment variables passed as literal Docker argv entries. */
  environment: Record<string, string>;
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

export interface DockerProbeOptions {
  /** Successful probe lifetime. Defaults to 30 seconds; 0 disables caching. */
  ttlMs?: number;
  /** Ignore a cached success while still joining an identical in-flight probe. */
  force?: boolean;
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
  runAsHostUser: true,
  environment: {},
  preserveWorkspacePath: false,
};

const DEFAULT_DOCKER_PROBE_TTL_MS = 30_000;
const MAX_IMAGE_PROBE_CACHE_ENTRIES = 32;

interface PositiveProbeCacheEntry {
  expiresAt: number;
}

let availabilityProbeCache: { key: string; expiresAt: number } | null = null;
let availabilityProbeInFlight: { key: string; promise: Promise<boolean> } | null = null;
const imageProbeCache = new Map<string, PositiveProbeCacheEntry>();
const imageProbeInFlight = new Map<string, Promise<boolean>>();
let probeCacheGeneration = 0;

function dockerProbeContextKey(): string {
  return JSON.stringify([
    process.env.DOCKER_HOST || '',
    process.env.DOCKER_CONTEXT || '',
    process.env.DOCKER_TLS_VERIFY || '',
    process.env.DOCKER_CERT_PATH || '',
    process.env.DOCKER_CONFIG || '',
  ]);
}

function resolveProbeTtlMs(options: DockerProbeOptions): number {
  const ttlMs = options.ttlMs ?? DEFAULT_DOCKER_PROBE_TTL_MS;
  if (!Number.isFinite(ttlMs)) return DEFAULT_DOCKER_PROBE_TTL_MS;
  return Math.max(0, Math.min(300_000, Math.trunc(ttlMs)));
}

/** Defer the synchronous compatibility probe so concurrent callers can join it. */
function runSingleFlightProbe(probe: () => boolean): Promise<boolean> {
  return new Promise(resolve => {
    setImmediate(() => resolve(probe()));
  });
}

function pruneImageProbeCache(now: number): void {
  for (const [key, entry] of imageProbeCache) {
    if (entry.expiresAt <= now) imageProbeCache.delete(key);
  }
  while (imageProbeCache.size > MAX_IMAGE_PROBE_CACHE_ENTRIES) {
    const oldestKey = imageProbeCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    imageProbeCache.delete(oldestKey);
  }
}

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
   * Cached Docker daemon probe for hot command paths. Only successful probes
   * are cached, and a launcher failure invalidates that success immediately.
   */
  static async isAvailableCached(options: DockerProbeOptions = {}): Promise<boolean> {
    const key = dockerProbeContextKey();
    const now = Date.now();
    const ttlMs = resolveProbeTtlMs(options);
    if (
      !options.force &&
      availabilityProbeCache?.key === key &&
      availabilityProbeCache.expiresAt > now
    ) {
      return true;
    }
    if (availabilityProbeInFlight?.key === key) {
      return availabilityProbeInFlight.promise;
    }

    const generation = probeCacheGeneration;
    const promise = runSingleFlightProbe(() => DockerSandbox.isAvailable())
      .then(available => {
        if (available && ttlMs > 0 && generation === probeCacheGeneration) {
          availabilityProbeCache = { key, expiresAt: Date.now() + ttlMs };
        }
        return available;
      })
      .finally(() => {
        if (availabilityProbeInFlight?.promise === promise) {
          availabilityProbeInFlight = null;
        }
      });
    availabilityProbeInFlight = { key, promise };
    return promise;
  }

  /** Check for a pre-built local image without pulling or invoking a shell. */
  static hasLocalImage(image: string): boolean {
    if (!image || image.includes('\0') || image.includes('\n') || image.includes('\r')) {
      return false;
    }
    try {
      const result = spawnSync('docker', ['image', 'inspect', image], {
        stdio: 'ignore',
        timeout: 10000,
      });
      return result.status === 0;
    } catch {
      return false;
    }
  }

  /** Cached, single-flight variant used by the workspace fallback selector. */
  static async hasLocalImageCached(
    image: string,
    options: DockerProbeOptions = {},
  ): Promise<boolean> {
    if (!image || image.includes('\0') || image.includes('\n') || image.includes('\r')) {
      return false;
    }
    const key = `${dockerProbeContextKey()}\0${image}`;
    const now = Date.now();
    const ttlMs = resolveProbeTtlMs(options);
    pruneImageProbeCache(now);
    if (!options.force && (imageProbeCache.get(key)?.expiresAt ?? 0) > now) {
      return true;
    }
    const inFlight = imageProbeInFlight.get(key);
    if (inFlight) return inFlight;

    const generation = probeCacheGeneration;
    const promise = runSingleFlightProbe(() => DockerSandbox.hasLocalImage(image))
      .then(available => {
        if (available && ttlMs > 0 && generation === probeCacheGeneration) {
          imageProbeCache.delete(key);
          imageProbeCache.set(key, { expiresAt: Date.now() + ttlMs });
          pruneImageProbeCache(Date.now());
        }
        return available;
      })
      .finally(() => {
        if (imageProbeInFlight.get(key) === promise) imageProbeInFlight.delete(key);
      });
    imageProbeInFlight.set(key, promise);
    return promise;
  }

  /** Drop cached Docker assumptions after a daemon/launcher failure. */
  static invalidateProbeCache(image?: string): void {
    probeCacheGeneration++;
    availabilityProbeCache = null;
    availabilityProbeInFlight = null;
    imageProbeInFlight.clear();
    if (!image) {
      imageProbeCache.clear();
      return;
    }
    const suffix = `\0${image}`;
    for (const key of imageProbeCache.keys()) {
      if (key.endsWith(suffix)) imageProbeCache.delete(key);
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
  async execute(
    command: string,
    opts?: Partial<SandboxConfig> | SandboxExecOptions
  ): Promise<SandboxResult> {
    const merged = { ...this.config, ...opts };
    const containerName = `codebuddy-sandbox-${randomUUID().slice(0, 8)}`;
    const startTime = Date.now();

    const args = this.buildDockerArgs(containerName, merged, command);

    return new Promise<SandboxResult>((resolve) => {
      const proc = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      let timedOut = false;

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
        if (exitCode === 125) DockerSandbox.invalidateProbeCache(merged.image);
        const durationMs = Date.now() - startTime;

        if (timedOut) {
          resolve({
            success: false,
            output: stdout,
            error: `Command timed out after ${merged.timeout}ms`,
            exitCode: exitCode,
            durationMs,
            containerId: containerName,
          });
        } else {
          resolve({
            success: exitCode === 0,
            output: stdout,
            error: stderr || undefined,
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
        DockerSandbox.invalidateProbeCache(merged.image);

        resolve({
          success: false,
          output: '',
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
  async *executeStreaming(
    command: string,
    opts?: Partial<SandboxConfig>
  ): AsyncGenerator<string, SandboxResult> {
    const merged = { ...this.config, ...opts };
    const containerName = `codebuddy-sandbox-${randomUUID().slice(0, 8)}`;
    const startTime = Date.now();

    const args = this.buildDockerArgs(containerName, merged, command);

    const proc = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

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
        if ((code ?? 1) === 125) DockerSandbox.invalidateProbeCache(merged.image);
        if (resolveChunk) {
          const r = resolveChunk;
          resolveChunk = null;
          r();
        }
        resolve(code ?? 1);
      });

      proc.on('error', () => {
        clearTimeout(timer);
        streamDone = true;
        this.activeContainers.delete(containerName);
        globalActiveContainers.delete(containerName);
        this.emit('container:stopped', containerName);
        DockerSandbox.invalidateProbeCache(merged.image);
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
        await new Promise<void>((r) => {
          resolveChunk = r;
        });
      }
    }

    const exitCode = await exitPromise;
    const durationMs = Date.now() - startTime;

    return {
      success: timedOut ? false : exitCode === 0,
      output: stdout,
      error: timedOut ? `Command timed out after ${merged.timeout}ms` : stderr || undefined,
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
      const output = execSync('docker container prune -f --filter label=codebuddy-sandbox=true', {
        stdio: 'pipe',
        timeout: 30000,
      }).toString();

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
    const workspace = config.workspaceMount ? path.resolve(config.workspaceMount) : null;
    const containerWorkspace = workspace
      ? config.preserveWorkspacePath && process.platform !== 'win32'
        ? workspace
        : '/workspace'
      : null;
    const args = [
      'run',
      '--rm',
      '--name',
      containerName,
      '--label',
      'codebuddy-sandbox=true',
      '--init',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges:true',
      '--pids-limit',
      '512',
      '-m',
      config.memoryLimit,
      '--cpus',
      config.cpuLimit,
    ];

    // A caller may intentionally select /tmp itself as the workspace. Docker
    // rejects two mounts with that exact destination, so in that one case the
    // bind mount supplies writable temporary storage instead of a tmpfs.
    if (containerWorkspace !== '/tmp') {
      args.push('--tmpfs', '/tmp:rw,nosuid,nodev,size=512m');
    }

    if (!config.networkEnabled) {
      args.push('--network', 'none');
    }

    if (config.readOnly) {
      args.push('--read-only');
    }

    if (
      config.runAsHostUser &&
      process.platform !== 'win32' &&
      typeof process.getuid === 'function' &&
      typeof process.getgid === 'function'
    ) {
      args.push('--user', `${process.getuid()}:${process.getgid()}`);
    }

    if (config.workspaceMount) {
      if (config.workspaceMount.includes('..') || config.workspaceMount.includes('\0')) {
        throw new Error('Invalid workspace mount path');
      }
      if (!workspace || !containerWorkspace) {
        throw new Error('Failed to resolve workspace mount path');
      }
      args.push('-v', `${workspace}:${containerWorkspace}`, '-w', containerWorkspace);
      for (const relativePath of config.workspaceReadOnly ?? []) {
        const normalizedRelative = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
        if (
          !normalizedRelative ||
          normalizedRelative.includes('..') ||
          normalizedRelative.includes('\0')
        ) {
          continue;
        }
        const hostPath = path.resolve(workspace, normalizedRelative);
        const relative = path.relative(workspace, hostPath);
        if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(hostPath)) {
          continue;
        }
        args.push('-v', `${hostPath}:${containerWorkspace}/${normalizedRelative}:ro`);
      }
    }

    // Inject CODEBUDDY_CLI env vars so child processes know they're inside Code Buddy
    args.push('-e', `CODEBUDDY_CLI=${process.env.CODEBUDDY_CLI || '1'}`);
    if (process.env.CODEBUDDY_CLI_VERSION) {
      args.push('-e', `CODEBUDDY_CLI_VERSION=${process.env.CODEBUDDY_CLI_VERSION}`);
    }
    for (const [key, value] of Object.entries(config.environment ?? {})) {
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && !value.includes('\0')) {
        args.push('-e', `${key}=${value}`);
      }
    }

    // Timezone override (Native Engine v2026.3.8 — CODEBUDDY_TZ env)
    const tz = config.timezone || process.env.CODEBUDDY_TZ;
    if (tz) {
      // Validate IANA timezone format (Continent/City)
      if (/^[A-Z][a-zA-Z]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?$/.test(tz)) {
        args.push('-e', `TZ=${tz}`);
      }
    }

    // End Docker option parsing before the configurable image name. This
    // prevents a value such as `--privileged` from being interpreted as a
    // daemon flag even though spawn() itself does not invoke a shell.
    args.push('--', config.image, 'sh', '-c', command);

    return args;
  }
}
