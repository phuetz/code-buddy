/**
 * Daemon Manager
 *
 * Manages the Code Buddy daemon process lifecycle:
 * - Start/stop/restart daemon as a detached background process
 * - PID file management (~/.codebuddy/daemon/codebuddy.pid)
 * - Log file management (~/.codebuddy/daemon/codebuddy.log)
 * - Auto-restart on crash (max 3 attempts)
 */

import { fork, ChildProcess } from 'child_process';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface DaemonConfig {
  /** PID file path */
  pidFile: string;
  /** Log file path */
  logFile: string;
  /** Max auto-restart attempts */
  maxRestarts: number;
  /** Services to auto-start */
  autoStart: ('server' | 'scheduler' | 'channels')[];
  /** Server port */
  port: number;
  /** Health check interval in ms */
  healthCheckIntervalMs: number;
}

export interface DaemonStatus {
  running: boolean;
  pid?: number;
  uptime?: number;
  startedAt?: Date;
  services: ServiceStatus[];
  restartCount: number;
}

export interface ServiceStatus {
  name: string;
  running: boolean;
  startedAt?: Date;
  error?: string;
}

export const DEFAULT_DAEMON_CONFIG: DaemonConfig = {
  pidFile: path.join(homedir(), '.codebuddy', 'daemon', 'codebuddy.pid'),
  logFile: path.join(homedir(), '.codebuddy', 'daemon', 'codebuddy.log'),
  maxRestarts: 3,
  autoStart: ['server', 'scheduler'],
  port: 3000,
  healthCheckIntervalMs: 30000,
};

// ============================================================================
// Daemon Manager
// ============================================================================

export class DaemonManager extends EventEmitter {
  private config: DaemonConfig;
  private childProcess: ChildProcess | null = null;
  private restartCount: number = 0;
  private startedAt: Date | null = null;

  constructor(config: Partial<DaemonConfig> = {}) {
    super();
    this.config = { ...DEFAULT_DAEMON_CONFIG, ...config };
  }

  /**
   * Start the daemon process
   */
  async start(detach: boolean = false): Promise<void> {
    // Check if already running
    const existingPid = await this.readPid();
    if (existingPid && this.isProcessRunning(existingPid)) {
      throw new Error(`Daemon already running (PID: ${existingPid})`);
    }

    // Remove stale PID file if process is no longer running
    if (existingPid && !this.isProcessRunning(existingPid)) {
      await this.removePid();
    }

    // Ensure directories exist
    await fs.mkdir(path.dirname(this.config.pidFile), { recursive: true });
    await fs.mkdir(path.dirname(this.config.logFile), { recursive: true });

    if (detach) {
      await this.startDetached();
    } else {
      await this.startForeground();
    }
  }

  /**
   * Start daemon as a detached background process
   */
  private async startDetached(): Promise<void> {
    const logFd = fsSync.openSync(this.config.logFile, 'a');

    try {
      // Resolve the entry point for the forked daemon process
      // Use process.argv[1] (the CLI entry point) to find index.js
      // This avoids import.meta.url which is not supported by ts-jest
      const entryPoint = process.argv[1] || path.resolve(process.cwd(), 'dist', 'index.js');

      const child = fork(
        entryPoint,
        ['daemon', '__run__', '--port', String(this.config.port)],
        {
          detached: true,
          stdio: ['ignore', logFd, logFd, 'ipc'],
          env: {
            ...process.env,
            CODEBUDDY_DAEMON: 'true',
            CODEBUDDY_DAEMON_CONFIG: JSON.stringify(this.config),
          },
        }
      );

      if (child.pid) {
        await this.writePid(child.pid);
        this.startedAt = new Date();
        child.unref();
        logger.info(`Daemon started (PID: ${child.pid})`);
        this.emit('started', { pid: child.pid, detached: true });
      }
    } finally {
      fsSync.closeSync(logFd);
    }
  }

  /**
   * Start daemon in the foreground (for __run__ mode)
   */
  private async startForeground(): Promise<void> {
    const pid = process.pid;
    await this.writePid(pid);
    this.startedAt = new Date();
    logger.info(`Daemon started in foreground (PID: ${pid})`);
    this.emit('started', { pid, detached: false });
  }

  /**
   * Stop the daemon process
   */
  async stop(): Promise<void> {
    const pid = await this.readPid();
    if (!pid) {
      throw new Error('Daemon is not running (no PID file)');
    }

    if (!this.isProcessRunning(pid)) {
      await this.removePid();
      throw new Error('Daemon process not found (stale PID file removed)');
    }

    try {
      process.kill(pid, 'SIGTERM');
      // Wait for process to exit
      await this.waitForExit(pid, 10000);
    } catch {
      // Force kill if graceful shutdown fails
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // Process already gone
      }
    }

    await this.removePid();
    logger.info(`Daemon stopped (PID: ${pid})`);
    this.emit('stopped', { pid });
  }

  /**
   * Restart the daemon
   */
  async restart(): Promise<void> {
    try {
      await this.stop();
    } catch {
      // Ignore stop errors during restart
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
    await this.start(true);
  }

  /**
   * Get daemon status
   */
  async status(): Promise<DaemonStatus> {
    const pid = await this.readPid();

    if (!pid || !this.isProcessRunning(pid)) {
      return {
        running: false,
        services: [],
        restartCount: this.restartCount,
      };
    }

    const uptime = this.startedAt
      ? Date.now() - this.startedAt.getTime()
      : undefined;

    return {
      running: true,
      pid,
      uptime,
      startedAt: this.startedAt || undefined,
      services: [], // Populated by DaemonLifecycle
      restartCount: this.restartCount,
    };
  }

  /**
   * Get recent log lines
   */
  async logs(lines: number = 50): Promise<string> {
    try {
      const content = await fs.readFile(this.config.logFile, 'utf-8');
      const allLines = content.trim().split('\n');
      return allLines.slice(-lines).join('\n');
    } catch {
      return '(no logs available)';
    }
  }

  /**
   * Attempt auto-restart if crashes
   */
  async attemptAutoRestart(): Promise<boolean> {
    if (this.restartCount >= this.config.maxRestarts) {
      logger.error(`Max restart attempts reached (${this.config.maxRestarts})`);
      this.emit('max-restarts', { count: this.restartCount });
      return false;
    }

    this.restartCount++;
    logger.warn(`Auto-restart attempt ${this.restartCount}/${this.config.maxRestarts}`);

    try {
      await this.start(true);
      return true;
    } catch (error) {
      logger.error('Auto-restart failed', error as Error);
      return false;
    }
  }

  // ==========================================================================
  // PID management
  // ==========================================================================

  private async writePid(pid: number): Promise<void> {
    try {
      // Atomic exclusive-create: fails if PID file already exists (prevents race)
      const fd = fsSync.openSync(this.config.pidFile, 'wx', 0o600);
      fsSync.writeSync(fd, String(pid));
      fsSync.closeSync(fd);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new Error('PID file already exists — daemon may already be starting');
      }
      throw err;
    }
  }

  async readPid(): Promise<number | null> {
    try {
      const content = await fs.readFile(this.config.pidFile, 'utf-8');
      const pid = parseInt(content.trim(), 10);
      return Number.isFinite(pid) ? pid : null;
    } catch {
      return null;
    }
  }

  private async removePid(): Promise<void> {
    try {
      await fs.unlink(this.config.pidFile);
    } catch {
      // Ignore if already removed
    }
  }

  isProcessRunning(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  private async waitForExit(pid: number, timeoutMs: number): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (!this.isProcessRunning(pid)) return;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw new Error('Process did not exit in time');
  }

  getConfig(): DaemonConfig {
    return { ...this.config };
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: DaemonManager | null = null;

export function getDaemonManager(config?: Partial<DaemonConfig>): DaemonManager {
  if (!instance) {
    instance = new DaemonManager(config);
  }
  return instance;
}

export function resetDaemonManager(): void {
  instance = null;
}
