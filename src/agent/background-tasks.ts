/**
 * Background Task Manager
 *
 * Launches and manages background shell commands, capturing output
 * and providing status tracking.
 */

import { spawn, ChildProcess } from 'child_process';
import { logger } from '../utils/logger.js';

export interface BackgroundTask {
  id: string;
  command: string;
  startTime: number;
  status: 'running' | 'completed' | 'failed';
  output: string;
  exitCode?: number;
}

const MAX_OUTPUT_BYTES = 1024 * 1024; // 1MB

/**
 * BackgroundTaskManager spawns and tracks background shell commands.
 */
export class BackgroundTaskManager {
  private tasks: Map<string, BackgroundTask> = new Map();
  private processes: Map<string, ChildProcess> = new Map();
  private counter = 0;

  /**
   * Launch a command in the background.
   * Returns the task ID.
   */
  launchTask(command: string): string {
    this.counter++;
    const id = `bg-${this.counter}`;

    const task: BackgroundTask = {
      id,
      command,
      startTime: Date.now(),
      status: 'running',
      output: '',
    };

    this.tasks.set(id, task);

    const isWindows = process.platform === 'win32';
    const shell = isWindows ? (process.env.COMSPEC || 'cmd.exe') : 'sh';
    const shellArgs = isWindows ? ['/d', '/s', '/c', command] : ['-c', command];

    const child = spawn(shell, shellArgs, {
      detached: !isWindows,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    this.processes.set(id, child);

    const appendOutput = (data: Buffer): void => {
      const t = this.tasks.get(id);
      if (t && t.output.length < MAX_OUTPUT_BYTES) {
        const remaining = MAX_OUTPUT_BYTES - t.output.length;
        t.output += data.toString('utf-8').slice(0, remaining);
      }
    };

    if (child.stdout) {
      child.stdout.on('data', appendOutput);
    }
    if (child.stderr) {
      child.stderr.on('data', appendOutput);
    }

    child.on('close', (code) => {
      const t = this.tasks.get(id);
      if (t) {
        t.exitCode = code ?? 1;
        t.status = code === 0 ? 'completed' : 'failed';
      }
      this.processes.delete(id);
      logger.debug(`[BackgroundTaskManager] Task ${id} finished with code ${code}`);
    });

    child.on('error', (err) => {
      const t = this.tasks.get(id);
      if (t) {
        t.status = 'failed';
        t.output += `\nError: ${err.message}`;
      }
      this.processes.delete(id);
      logger.debug(`[BackgroundTaskManager] Task ${id} error: ${err.message}`);
    });

    logger.debug(`[BackgroundTaskManager] Launched task ${id}: ${command}`);
    return id;
  }

  /**
   * Get the output for a task, optionally filtered by regex.
   */
  getTaskOutput(taskId: string, filter?: RegExp): string {
    const task = this.tasks.get(taskId);
    if (!task) {
      return '';
    }

    if (!filter) {
      return task.output;
    }

    return task.output
      .split('\n')
      .filter((line) => filter.test(line))
      .join('\n');
  }

  /**
   * Get a task by ID.
   */
  getTask(taskId: string): BackgroundTask | undefined {
    const task = this.tasks.get(taskId);
    if (!task) return undefined;
    return { ...task };
  }

  /**
   * List all tasks.
   */
  listTasks(): BackgroundTask[] {
    return Array.from(this.tasks.values()).map((t) => ({ ...t }));
  }

  /**
   * Kill a running task.
   */
  killTask(taskId: string): boolean {
    const child = this.processes.get(taskId);
    if (!child) {
      return false;
    }

    try {
      if (child.pid && process.platform !== 'win32') {
        process.kill(-child.pid, 'SIGTERM');
      } else {
        child.kill('SIGTERM');
      }
    } catch {
      try {
        child.kill('SIGTERM');
      } catch {
        // Process may have already exited or be unkillable on this platform.
      }
    }

    const task = this.tasks.get(taskId);
    if (task) {
      task.status = 'failed';
      task.exitCode = 137;
    }
    this.processes.delete(taskId);
    return true;
  }

  /**
   * Kill all running tasks (for process exit cleanup).
   */
  cleanup(): void {
    for (const [id] of this.processes) {
      this.killTask(id);
    }
    logger.debug('[BackgroundTaskManager] All tasks cleaned up');
  }
}

// Singleton
let instance: BackgroundTaskManager | null = null;

export function getBackgroundTaskManager(): BackgroundTaskManager {
  if (!instance) {
    instance = new BackgroundTaskManager();
  }
  return instance;
}

export function resetBackgroundTaskManager(): void {
  if (instance) {
    instance.cleanup();
  }
  instance = null;
}
