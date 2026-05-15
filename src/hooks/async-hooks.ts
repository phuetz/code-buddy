/**
 * Async Hook Manager
 *
 * Manages asynchronous hook execution with concurrency control,
 * job tracking, and result collection. Completed hook results
 * can be injected as system messages into the next conversation turn.
 */

import { randomUUID } from 'crypto';
import { logger } from '../utils/logger.js';
import type { SmartHookConfig, SmartHookResult } from './smart-hooks.js';
import { SmartHookRunner } from './smart-hooks.js';

// ============================================================================
// Types
// ============================================================================

export type AsyncHookStatus = 'running' | 'completed' | 'failed' | 'timeout' | 'cancelled';

export interface AsyncHookJob {
  /** Unique job ID */
  id: string;
  /** Hook configuration */
  hookConfig: SmartHookConfig;
  /** Input data */
  input: Record<string, any>;
  /** Start timestamp */
  startTime: number;
  /** Current status */
  status: AsyncHookStatus;
  /** Result (when completed) */
  result?: SmartHookResult;
  /** Error message (when failed) */
  error?: string;
}

export const ASYNC_HOOK_COMPLETED_WITH_NO_OUTPUT = 'completed successfully with no output.';

// ============================================================================
// AsyncHookManager
// ============================================================================

export class AsyncHookManager {
  private jobs: Map<string, AsyncHookJob> = new Map();
  private maxConcurrent: number;
  private runner: SmartHookRunner;
  private completedSinceLastCheck: string[] = [];
  private cancelTokens: Map<string, boolean> = new Map();

  constructor(maxConcurrent?: number) {
    this.maxConcurrent = maxConcurrent ?? 10;
    this.runner = new SmartHookRunner();
    logger.debug(`AsyncHookManager initialized with max ${this.maxConcurrent} concurrent`, { source: 'AsyncHookManager' });
  }

  /**
   * Submit an async hook for execution
   */
  submit(hook: SmartHookConfig, input: Record<string, any>): string {
    // Check concurrency limit
    const runningCount = this.getRunningCount();
    if (runningCount >= this.maxConcurrent) {
      logger.warn(`Max concurrent hooks reached (${this.maxConcurrent}), rejecting`, { source: 'AsyncHookManager' });
      const jobId = randomUUID();
      const job: AsyncHookJob = {
        id: jobId,
        hookConfig: hook,
        input,
        startTime: Date.now(),
        status: 'failed',
        error: 'Max concurrent hooks reached',
      };
      this.jobs.set(jobId, job);
      this.completedSinceLastCheck.push(jobId);
      return jobId;
    }

    const jobId = randomUUID();
    const job: AsyncHookJob = {
      id: jobId,
      hookConfig: hook,
      input,
      startTime: Date.now(),
      status: 'running',
    };

    this.jobs.set(jobId, job);
    this.cancelTokens.set(jobId, false);

    // Execute in background
    this.executeJob(jobId, hook, input);

    return jobId;
  }

  /**
   * Execute a job asynchronously
   */
  private async executeJob(
    jobId: string,
    hook: SmartHookConfig,
    input: Record<string, any>
  ): Promise<void> {
    const timeout = hook.timeout ?? 30000;

    try {
      // Create a timeout race
      const resultPromise = this.runner.runHook(hook, input);
      const timeoutPromise = new Promise<SmartHookResult>((_, reject) => {
        setTimeout(() => reject(new Error('Hook execution timed out')), timeout);
      });

      const result = await Promise.race([resultPromise, timeoutPromise]);

      const job = this.jobs.get(jobId);
      if (!job) return;

      // Check if cancelled
      if (this.cancelTokens.get(jobId)) {
        job.status = 'cancelled';
        job.error = 'Job was cancelled';
        this.completedSinceLastCheck.push(jobId);
        this.cancelTokens.delete(jobId);
        return;
      }

      job.status = 'completed';
      job.result = result;
      this.completedSinceLastCheck.push(jobId);
      this.cancelTokens.delete(jobId);

      logger.debug(`Async hook ${jobId} completed`, { source: 'AsyncHookManager' });
    } catch (error) {
      const job = this.jobs.get(jobId);
      if (!job) return;

      const message = error instanceof Error ? error.message : String(error);

      if (message.includes('timed out')) {
        job.status = 'timeout';
        job.error = 'Hook execution timed out';
      } else {
        job.status = 'failed';
        job.error = message;
      }

      this.completedSinceLastCheck.push(jobId);
      this.cancelTokens.delete(jobId);

      logger.warn(`Async hook ${jobId} failed: ${message}`, { source: 'AsyncHookManager' });
    }
  }

  /**
   * Get a job by ID
   */
  getJob(jobId: string): AsyncHookJob | null {
    return this.jobs.get(jobId) ?? null;
  }

  /**
   * Get all jobs completed since the last call to this method
   */
  getCompletedJobs(): AsyncHookJob[] {
    const completed: AsyncHookJob[] = [];

    for (const jobId of this.completedSinceLastCheck) {
      const job = this.jobs.get(jobId);
      if (job && job.status !== 'running') {
        completed.push({ ...job });
      }
    }

    this.completedSinceLastCheck = [];
    return completed;
  }

  /**
   * Get results formatted as system messages for the next conversation turn
   */
  getSystemMessages(): string[] {
    const completed = this.getCompletedJobs();
    const messages: string[] = [];

    for (const job of completed) {
      if (job.status === 'completed' && job.result) {
        const prefix = `[Async Hook: ${job.hookConfig.event}]`;
        if (job.result.ok) {
          const output = job.result.output?.trim()
            ? job.result.output
            : ASYNC_HOOK_COMPLETED_WITH_NO_OUTPUT;
          messages.push(`${prefix} Success: ${output}`);
        } else {
          messages.push(`${prefix} Failed: ${job.result.reason ?? 'Unknown error'}`);
        }
      } else if (job.status === 'failed' || job.status === 'timeout') {
        messages.push(`[Async Hook: ${job.hookConfig.event}] Error: ${job.error ?? 'Unknown error'}`);
      } else if (job.status === 'cancelled') {
        messages.push(`[Async Hook: ${job.hookConfig.event}] Cancelled`);
      }
    }

    return messages;
  }

  /**
   * Clear all completed/failed jobs
   */
  clearCompleted(): void {
    const toRemove: string[] = [];

    this.jobs.forEach((job, id) => {
      if (job.status !== 'running') {
        toRemove.push(id);
      }
    });

    for (const id of toRemove) {
      this.jobs.delete(id);
      this.cancelTokens.delete(id);
    }

    logger.debug(`Cleared ${toRemove.length} completed jobs`, { source: 'AsyncHookManager' });
  }

  /**
   * Cancel a running job
   */
  cancel(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== 'running') {
      return false;
    }

    this.cancelTokens.set(jobId, true);
    return true;
  }

  /**
   * Get the number of currently running jobs
   */
  getRunningCount(): number {
    let count = 0;
    this.jobs.forEach((job) => {
      if (job.status === 'running') {
        count++;
      }
    });
    return count;
  }

  /**
   * Get the total number of tracked jobs
   */
  getTotalCount(): number {
    return this.jobs.size;
  }

  /**
   * Dispose of all jobs and clean up
   */
  dispose(): void {
    // Mark all running as cancelled
    this.jobs.forEach((job, id) => {
      if (job.status === 'running') {
        this.cancelTokens.set(id, true);
      }
    });

    this.jobs.clear();
    this.cancelTokens.clear();
    this.completedSinceLastCheck = [];

    logger.debug('AsyncHookManager disposed', { source: 'AsyncHookManager' });
  }
}
