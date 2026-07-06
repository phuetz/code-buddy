/**
 * Docker Sandbox Manager
 *
 * Manages per-session Docker container isolation.
 * Provides secure execution environment for tools and commands.
 */

import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import type {
  DockerSandboxConfig,
  SessionContainer,
  ContainerStatus,
  ExecutionOptions,
  ExecutionResult,
  NetworkPolicy,
  ContainerMetrics,
  SandboxEvents,
} from './types.js';
import {
  DEFAULT_SANDBOX_CONFIG,
  DEFAULT_NETWORK_POLICY,
} from './types.js';

// ============================================================================
// Docker API Interface (abstracts actual Docker client)
// ============================================================================

/**
 * Docker client interface
 * Can be implemented with dockerode or other Docker clients
 */
export interface IDockerClient {
  /** Check if Docker is available */
  isAvailable(): Promise<boolean>;
  /** Create container */
  createContainer(config: DockerContainerConfig): Promise<string>;
  /** Start container */
  startContainer(containerId: string): Promise<void>;
  /** Stop container */
  stopContainer(containerId: string, timeout?: number): Promise<void>;
  /** Remove container */
  removeContainer(containerId: string, force?: boolean): Promise<void>;
  /** Execute command in container */
  exec(containerId: string, command: string[], options?: DockerExecOptions): Promise<DockerExecResult>;
  /** Get container stats */
  getStats(containerId: string): Promise<DockerStats>;
  /** Get container status */
  getStatus(containerId: string): Promise<ContainerStatus>;
  /** Pull image */
  pullImage(image: string): Promise<void>;
  /** Check if image exists */
  imageExists(image: string): Promise<boolean>;
}

interface DockerContainerConfig {
  image: string;
  name?: string;
  env?: Record<string, string>;
  workDir?: string;
  user?: string;
  networkMode?: string;
  memory?: number;
  cpuShares?: number;
  volumes?: Array<{ source: string; target: string; readOnly?: boolean }>;
  labels?: Record<string, string>;
}

interface DockerExecOptions {
  workDir?: string;
  env?: Record<string, string>;
  user?: string;
  stdin?: string;
  timeout?: number;
}

interface DockerExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface DockerStats {
  cpuPercent: number;
  memoryUsage: number;
  memoryLimit: number;
  networkRx: number;
  networkTx: number;
  blockRead: number;
  blockWrite: number;
}

// ============================================================================
// Mock Docker Client (for testing/development)
// ============================================================================

/**
 * Mock Docker client for testing when Docker is not available
 */
export class MockDockerClient implements IDockerClient {
  private containers: Map<string, { status: ContainerStatus; config: DockerContainerConfig }> = new Map();

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async createContainer(config: DockerContainerConfig): Promise<string> {
    const id = crypto.randomUUID().slice(0, 12);
    this.containers.set(id, { status: 'creating', config });
    return id;
  }

  async startContainer(containerId: string): Promise<void> {
    const container = this.containers.get(containerId);
    if (container) {
      container.status = 'running';
    }
  }

  async stopContainer(containerId: string, _timeout?: number): Promise<void> {
    const container = this.containers.get(containerId);
    if (container) {
      container.status = 'stopped';
    }
  }

  async removeContainer(containerId: string, _force?: boolean): Promise<void> {
    this.containers.delete(containerId);
  }

  async exec(_containerId: string, command: string[], _options?: DockerExecOptions): Promise<DockerExecResult> {
    // Mock execution
    return {
      exitCode: 0,
      stdout: `Mock execution of: ${command.join(' ')}`,
      stderr: '',
    };
  }

  async getStats(_containerId: string): Promise<DockerStats> {
    return {
      cpuPercent: Math.random() * 10,
      memoryUsage: Math.floor(Math.random() * 100000000),
      memoryLimit: 536870912, // 512MB
      networkRx: Math.floor(Math.random() * 10000),
      networkTx: Math.floor(Math.random() * 10000),
      blockRead: Math.floor(Math.random() * 100000),
      blockWrite: Math.floor(Math.random() * 100000),
    };
  }

  async getStatus(containerId: string): Promise<ContainerStatus> {
    const container = this.containers.get(containerId);
    return container?.status || 'dead';
  }

  async pullImage(_image: string): Promise<void> {
    // Mock pull - instant
  }

  async imageExists(_image: string): Promise<boolean> {
    return true;
  }
}

// ============================================================================
// Docker Sandbox Manager
// ============================================================================

/**
 * Docker Sandbox Manager
 *
 * Manages Docker containers for isolated code execution per session.
 */
export class DockerSandboxManager extends EventEmitter {
  private docker: IDockerClient;
  private defaultConfig: DockerSandboxConfig;
  private containers: Map<string, SessionContainer> = new Map();
  private sessionToContainer: Map<string, string> = new Map();
  private healthCheckTimer: NodeJS.Timeout | null = null;

  constructor(docker?: IDockerClient, config?: Partial<DockerSandboxConfig>) {
    super();
    this.docker = docker || new MockDockerClient();
    this.defaultConfig = { ...DEFAULT_SANDBOX_CONFIG, ...config };
  }

  // ============================================================================
  // Initialization
  // ============================================================================

  /**
   * Initialize the sandbox manager
   */
  async initialize(): Promise<void> {
    // Check Docker availability
    const available = await this.docker.isAvailable();
    if (!available) {
      throw new Error('Docker is not available');
    }

    // Ensure image exists
    const imageExists = await this.docker.imageExists(this.defaultConfig.image);
    if (!imageExists) {
      await this.docker.pullImage(this.defaultConfig.image);
    }

    // Start health check timer
    this.startHealthCheck();
  }

  /**
   * Shutdown the sandbox manager
   */
  async shutdown(): Promise<void> {
    this.stopHealthCheck();

    // Destroy all containers
    const destroyPromises = Array.from(this.containers.keys()).map(id =>
      this.destroyContainer(id).catch(() => {})
    );
    await Promise.all(destroyPromises);
  }

  // ============================================================================
  // Container Lifecycle
  // ============================================================================

  /**
   * Create a container for a session
   */
  async createContainer(
    sessionId: string,
    config?: Partial<DockerSandboxConfig>
  ): Promise<SessionContainer> {
    // Check if session already has a container
    const existingId = this.sessionToContainer.get(sessionId);
    if (existingId) {
      const existing = this.containers.get(existingId);
      if (existing && existing.status !== 'dead') {
        return existing;
      }
    }

    const mergedConfig = { ...this.defaultConfig, ...config };
    const id = crypto.randomUUID();

    // Create Docker container
    const containerId = await this.docker.createContainer({
      image: mergedConfig.image,
      name: `codebuddy-${sessionId.slice(0, 8)}-${id.slice(0, 8)}`,
      env: mergedConfig.env,
      workDir: mergedConfig.workDir,
      user: mergedConfig.user,
      networkMode: mergedConfig.networkMode,
      memory: this.parseMemory(mergedConfig.memoryLimit),
      cpuShares: Math.floor(mergedConfig.cpuLimit * 1024),
      volumes: mergedConfig.volumes?.map(v => ({
        source: v.source,
        target: v.target,
        readOnly: v.readOnly,
      })),
      labels: {
        'codebuddy.session': sessionId,
        'codebuddy.sandbox': 'true',
      },
    });

    // Start the container
    await this.docker.startContainer(containerId);

    const container: SessionContainer = {
      id,
      sessionId,
      containerId,
      status: 'running',
      image: mergedConfig.image,
      createdAt: new Date(),
      lastActivityAt: new Date(),
      toolAllowlist: [],
      toolDenylist: [],
      networkPolicy: DEFAULT_NETWORK_POLICY,
    };

    this.containers.set(id, container);
    this.sessionToContainer.set(sessionId, id);

    this.emit('container:created', container);
    this.emit('container:started', containerId);

    return container;
  }

  /**
   * Get container for a session
   */
  getContainerForSession(sessionId: string): SessionContainer | undefined {
    const id = this.sessionToContainer.get(sessionId);
    return id ? this.containers.get(id) : undefined;
  }

  /**
   * Get container by ID
   */
  getContainer(id: string): SessionContainer | undefined {
    return this.containers.get(id);
  }

  /**
   * Get all containers
   */
  getAllContainers(): SessionContainer[] {
    return Array.from(this.containers.values());
  }

  /**
   * Destroy a container
   */
  async destroyContainer(id: string): Promise<void> {
    const container = this.containers.get(id);
    if (!container) return;

    try {
      // Stop container if running
      if (container.status === 'running') {
        await this.docker.stopContainer(container.containerId, 10);
        this.emit('container:stopped', container.containerId, 'destroyed');
      }

      // Remove container
      await this.docker.removeContainer(container.containerId, true);
    } catch (_error) {
      // Container might already be gone
    }

    // Clean up mappings
    this.containers.delete(id);
    this.sessionToContainer.delete(container.sessionId);

    this.emit('container:destroyed', container.containerId);
  }

  /**
   * Destroy container for a session
   */
  async destroyContainerForSession(sessionId: string): Promise<void> {
    const id = this.sessionToContainer.get(sessionId);
    if (id) {
      await this.destroyContainer(id);
    }
  }

  // ============================================================================
  // Command Execution
  // ============================================================================

  /**
   * Execute a command in a container
   */
  async executeInContainer(
    id: string,
    command: string,
    options?: ExecutionOptions
  ): Promise<ExecutionResult> {
    const container = this.containers.get(id);
    if (!container) {
      throw new Error(`Container ${id} not found`);
    }

    if (container.status !== 'running') {
      throw new Error(`Container ${id} is not running (status: ${container.status})`);
    }

    // Update activity
    container.lastActivityAt = new Date();

    const timeout = options?.timeout || this.defaultConfig.timeout;
    const startTime = Date.now();

    this.emit('execution:start', container.containerId, command);

    try {
      // Parse command into array
      const cmdParts = this.parseCommand(command);

      // Execute with timeout
      const result = await Promise.race([
        this.docker.exec(container.containerId, cmdParts, {
          workDir: options?.workDir || this.defaultConfig.workDir,
          env: options?.env,
          user: options?.user,
          stdin: options?.stdin,
          timeout,
        }),
        new Promise<DockerExecResult>((_, reject) =>
          setTimeout(() => reject(new Error('Execution timed out')), timeout)
        ),
      ]);

      const executionResult: ExecutionResult = {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        durationMs: Date.now() - startTime,
        timedOut: false,
        oomKilled: false,
      };

      this.emit('execution:complete', container.containerId, executionResult);
      return executionResult;
    } catch (error) {
      const isTimeout = error instanceof Error && error.message.includes('timed out');

      const executionResult: ExecutionResult = {
        exitCode: isTimeout ? 124 : 1,
        stdout: '',
        stderr: error instanceof Error ? error.message : 'Unknown error',
        durationMs: Date.now() - startTime,
        timedOut: isTimeout,
        oomKilled: false,
      };

      this.emit('execution:complete', container.containerId, executionResult);
      return executionResult;
    }
  }

  /**
   * Execute in session's container
   */
  async executeInSession(
    sessionId: string,
    command: string,
    options?: ExecutionOptions
  ): Promise<ExecutionResult> {
    const container = this.getContainerForSession(sessionId);
    if (!container) {
      throw new Error(`No container for session ${sessionId}`);
    }
    return this.executeInContainer(container.id, command, options);
  }

  // ============================================================================
  // Tool Policies
  // ============================================================================

  /**
   * Set tool allowlist for a container
   */
  setToolAllowlist(id: string, tools: string[]): void {
    const container = this.containers.get(id);
    if (container) {
      container.toolAllowlist = [...tools];
    }
  }

  /**
   * Set tool denylist for a container
   */
  setToolDenylist(id: string, tools: string[]): void {
    const container = this.containers.get(id);
    if (container) {
      container.toolDenylist = [...tools];
    }
  }

  /**
   * Check if a tool is allowed
   */
  isToolAllowed(id: string, tool: string): boolean {
    const container = this.containers.get(id);
    if (!container) return false;

    // Check denylist first
    if (container.toolDenylist.includes(tool)) {
      this.emit('policy:violation', container.containerId, `Tool ${tool} is denied`);
      return false;
    }

    // If allowlist is empty, allow all (except denied)
    if (container.toolAllowlist.length === 0) {
      return true;
    }

    // Check allowlist
    const allowed = container.toolAllowlist.includes(tool);
    if (!allowed) {
      this.emit('policy:violation', container.containerId, `Tool ${tool} is not in allowlist`);
    }
    return allowed;
  }

  /**
   * Set network policy for a container
   */
  setNetworkPolicy(id: string, policy: NetworkPolicy): void {
    const container = this.containers.get(id);
    if (container) {
      container.networkPolicy = { ...policy };
    }
  }

  // ============================================================================
  // Metrics & Monitoring
  // ============================================================================

  /**
   * Get container metrics
   */
  async getMetrics(id: string): Promise<ContainerMetrics | null> {
    const container = this.containers.get(id);
    if (!container || container.status !== 'running') {
      return null;
    }

    try {
      const stats = await this.docker.getStats(container.containerId);
      const metrics: ContainerMetrics = {
        cpuPercent: stats.cpuPercent,
        memoryUsage: stats.memoryUsage,
        memoryLimit: stats.memoryLimit,
        networkRxBytes: stats.networkRx,
        networkTxBytes: stats.networkTx,
        blockIoReadBytes: stats.blockRead,
        blockIoWriteBytes: stats.blockWrite,
      };
      container.metrics = metrics;
      return metrics;
    } catch {
      return null;
    }
  }

  /**
   * Get all container metrics
   */
  async getAllMetrics(): Promise<Map<string, ContainerMetrics>> {
    const metrics = new Map<string, ContainerMetrics>();

    for (const [id] of this.containers) {
      const m = await this.getMetrics(id);
      if (m) {
        metrics.set(id, m);
      }
    }

    return metrics;
  }

  // ============================================================================
  // Cleanup
  // ============================================================================

  /**
   * Clean up idle containers
   */
  async cleanupIdleContainers(maxIdleMs: number): Promise<number> {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, container] of this.containers) {
      const idleTime = now - container.lastActivityAt.getTime();
      if (idleTime > maxIdleMs) {
        await this.destroyContainer(id);
        cleaned++;
      }
    }

    return cleaned;
  }

  /**
   * Get manager statistics
   */
  getStats(): {
    totalContainers: number;
    runningContainers: number;
    stoppedContainers: number;
    sessionsWithContainers: number;
  } {
    const containers = Array.from(this.containers.values());
    return {
      totalContainers: containers.length,
      runningContainers: containers.filter(c => c.status === 'running').length,
      stoppedContainers: containers.filter(c => c.status === 'stopped').length,
      sessionsWithContainers: this.sessionToContainer.size,
    };
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private parseMemory(limit: string): number {
    const match = limit.match(/^(\d+)([kmg]?)$/i);
    if (!match) return 536870912; // Default 512MB

    // match[1] is the required \d+ group; match[2] is the optional [kmg]? group
    // (empty string when absent, which falls through to the default case below).
    const [, digits = '', suffix = ''] = match;
    const value = parseInt(digits, 10);
    const unit = suffix.toLowerCase();

    switch (unit) {
      case 'k': return value * 1024;
      case 'm': return value * 1024 * 1024;
      case 'g': return value * 1024 * 1024 * 1024;
      default: return value;
    }
  }

  private parseCommand(command: string): string[] {
    // Simple shell-style parsing
    const parts: string[] = [];
    let current = '';
    let inQuote = false;
    let quoteChar = '';

    for (const char of command) {
      if (!inQuote && (char === '"' || char === "'")) {
        inQuote = true;
        quoteChar = char;
      } else if (inQuote && char === quoteChar) {
        inQuote = false;
        quoteChar = '';
      } else if (!inQuote && char === ' ') {
        if (current) {
          parts.push(current);
          current = '';
        }
      } else {
        current += char;
      }
    }

    if (current) {
      parts.push(current);
    }

    return parts.length > 0 ? parts : ['sh', '-c', command];
  }

  private startHealthCheck(): void {
    if (this.healthCheckTimer) return;

    this.healthCheckTimer = setInterval(async () => {
      for (const [id, container] of this.containers) {
        try {
          const status = await this.docker.getStatus(container.containerId);
          if (status !== container.status) {
            container.status = status;
            if (status === 'dead') {
              this.emit('container:stopped', container.containerId, 'died');
            }
          }
        } catch {
          // Container might be gone
          container.status = 'dead';
        }
      }
    }, 30000); // Check every 30 seconds
  }

  private stopHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let sandboxManagerInstance: DockerSandboxManager | null = null;

/**
 * Get Docker sandbox manager instance
 */
export function getDockerSandboxManager(
  docker?: IDockerClient,
  config?: Partial<DockerSandboxConfig>
): DockerSandboxManager {
  if (!sandboxManagerInstance) {
    sandboxManagerInstance = new DockerSandboxManager(docker, config);
  }
  return sandboxManagerInstance;
}

/**
 * Reset sandbox manager instance
 */
export async function resetDockerSandboxManager(): Promise<void> {
  if (sandboxManagerInstance) {
    await sandboxManagerInstance.shutdown();
    sandboxManagerInstance = null;
  }
}

export default DockerSandboxManager;
