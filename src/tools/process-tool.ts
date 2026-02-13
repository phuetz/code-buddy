/**
 * Process Management Tool
 *
 * OpenClaw-inspired process management: list, poll, log, write (stdin), kill, clear, remove.
 * Manages both OS processes (via ps) and tracked managed processes (from BashTool).
 */

import { execSync } from 'child_process';
import type { ChildProcess } from 'child_process';
import type { ToolResult } from '../types/index.js';
import { logger } from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface ProcessInfo {
  pid: number;
  command: string;
  cpuPercent?: number;
  memoryMB?: number;
  status: string;
  startTime: string;
}

export interface ManagedProcess {
  pid: number;
  command: string;
  process: ChildProcess;
  stdoutLines: string[];
  stderrLines: string[];
  startedAt: Date;
}

// ============================================================================
// Process Tool
// ============================================================================

export class ProcessTool {
  private managed = new Map<number, ManagedProcess>();
  private maxBufferLines = 1000;

  /**
   * List OS processes, optionally filtered
   */
  async list(filter?: string): Promise<ToolResult> {
    try {
      const output = execSync('ps aux', {
        encoding: 'utf-8',
        timeout: 5000,
      });

      const lines = output.trim().split('\n');
      const header = lines[0];
      let dataLines = lines.slice(1);

      if (filter) {
        const lowerFilter = filter.toLowerCase();
        dataLines = dataLines.filter(line => line.toLowerCase().includes(lowerFilter));
      }

      const result = [header, ...dataLines.slice(0, 50)].join('\n');
      const total = dataLines.length;

      return {
        success: true,
        output: `${result}\n\n${total} process(es) found${total > 50 ? ' (showing first 50)' : ''}`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to list processes: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Poll whether a process is still running
   */
  async poll(pid: number): Promise<ToolResult> {
    try {
      process.kill(pid, 0);
      const managed = this.managed.get(pid);
      return {
        success: true,
        output: `Process ${pid} is running${managed ? ` (managed: "${managed.command}")` : ''}`,
      };
    } catch {
      return {
        success: true,
        output: `Process ${pid} is not running`,
      };
    }
  }

  /**
   * Get log buffer for a managed process
   */
  async log(pid: number, opts?: { lines?: number; stderr?: boolean }): Promise<ToolResult> {
    const managed = this.managed.get(pid);
    if (!managed) {
      return {
        success: false,
        error: `Process ${pid} is not a managed process. Only processes started via BashTool can have logs.`,
      };
    }

    const buffer = opts?.stderr ? managed.stderrLines : managed.stdoutLines;
    const limit = opts?.lines ?? 100;
    const lines = buffer.slice(-limit);

    return {
      success: true,
      output: lines.length > 0 ? lines.join('\n') : '(no output)',
    };
  }

  /**
   * Write to stdin of a managed process
   */
  async write(pid: number, input: string): Promise<ToolResult> {
    const managed = this.managed.get(pid);
    if (!managed) {
      return {
        success: false,
        error: `Process ${pid} is not a managed process.`,
      };
    }

    if (!managed.process.stdin || managed.process.stdin.destroyed) {
      return {
        success: false,
        error: `Process ${pid} stdin is not writable.`,
      };
    }

    try {
      managed.process.stdin.write(input + '\n');
      return {
        success: true,
        output: `Wrote ${input.length + 1} bytes to process ${pid} stdin`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to write to process ${pid}: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Kill a process
   */
  async kill(pid: number, signal?: string): Promise<ToolResult> {
    try {
      const sig = signal || 'SIGTERM';
      process.kill(pid, sig as NodeJS.Signals);

      return {
        success: true,
        output: `Sent ${sig} to process ${pid}`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to kill process ${pid}: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Clear log buffer for a managed process
   */
  async clear(pid: number): Promise<ToolResult> {
    const managed = this.managed.get(pid);
    if (!managed) {
      return {
        success: false,
        error: `Process ${pid} is not a managed process.`,
      };
    }

    const clearedStdout = managed.stdoutLines.length;
    const clearedStderr = managed.stderrLines.length;
    managed.stdoutLines.length = 0;
    managed.stderrLines.length = 0;

    return {
      success: true,
      output: `Cleared ${clearedStdout} stdout and ${clearedStderr} stderr lines for process ${pid}`,
    };
  }

  /**
   * Remove a managed process from tracking
   */
  async remove(pid: number): Promise<ToolResult> {
    if (!this.managed.has(pid)) {
      return {
        success: false,
        error: `Process ${pid} is not a managed process.`,
      };
    }

    this.managed.delete(pid);

    return {
      success: true,
      output: `Untracked process ${pid}`,
    };
  }

  /**
   * Register a process for tracking (called from BashTool for background processes)
   */
  trackProcess(pid: number, cmd: string, proc: ChildProcess): void {
    const managed: ManagedProcess = {
      pid,
      command: cmd,
      process: proc,
      stdoutLines: [],
      stderrLines: [],
      startedAt: new Date(),
    };

    proc.stdout?.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n').filter(l => l.length > 0);
      managed.stdoutLines.push(...lines);
      // Trim buffer
      if (managed.stdoutLines.length > this.maxBufferLines) {
        managed.stdoutLines.splice(0, managed.stdoutLines.length - this.maxBufferLines);
      }
    });

    proc.stderr?.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n').filter(l => l.length > 0);
      managed.stderrLines.push(...lines);
      if (managed.stderrLines.length > this.maxBufferLines) {
        managed.stderrLines.splice(0, managed.stderrLines.length - this.maxBufferLines);
      }
    });

    proc.on('exit', (code) => {
      logger.debug(`Managed process ${pid} exited with code ${code}`);
    });

    this.managed.set(pid, managed);
    logger.debug(`Tracking managed process ${pid}: ${cmd}`);
  }

  /**
   * Get list of managed processes
   */
  getManagedProcesses(): Map<number, ManagedProcess> {
    return this.managed;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let processToolInstance: ProcessTool | null = null;

export function getProcessTool(): ProcessTool {
  if (!processToolInstance) {
    processToolInstance = new ProcessTool();
  }
  return processToolInstance;
}

export function resetProcessTool(): void {
  processToolInstance = null;
}
