/**
 * Batch Processing Mode
 *
 * Process multiple files or tasks in batch:
 * - File-based batch operations
 * - Task queue processing
 * - Parallel execution
 * - Progress tracking
 * - Result aggregation
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import fg from 'fast-glob';

export interface BatchTask {
  id: string;
  type: 'file' | 'command' | 'prompt';
  input: string;
  options?: Record<string, unknown>;
  priority?: number;
}

export interface BatchResult {
  taskId: string;
  success: boolean;
  output?: string;
  error?: string;
  durationMs: number;
  startedAt: Date;
  completedAt: Date;
}

export interface BatchProgress {
  total: number;
  completed: number;
  failed: number;
  inProgress: number;
  percentage: number;
  currentTask?: string;
  estimatedRemainingMs?: number;
}

export interface BatchConfig {
  /** Maximum parallel tasks */
  concurrency?: number;
  /** Continue on error */
  continueOnError?: boolean;
  /** Timeout per task (ms) */
  taskTimeout?: number;
  /** Progress callback */
  onProgress?: (progress: BatchProgress) => void;
  /** Task complete callback */
  onTaskComplete?: (result: BatchResult) => void;
  /** Dry run (don't execute, just validate) */
  dryRun?: boolean;
}

export interface BatchSummary {
  totalTasks: number;
  successfulTasks: number;
  failedTasks: number;
  totalDurationMs: number;
  averageTaskDurationMs: number;
  results: BatchResult[];
}

const DEFAULT_CONFIG: Required<Omit<BatchConfig, 'onProgress' | 'onTaskComplete'>> = {
  concurrency: 4,
  continueOnError: true,
  taskTimeout: 60000,
  dryRun: false,
};

/**
 * Batch Processor
 */
export class BatchProcessor {
  private config: Required<Omit<BatchConfig, 'onProgress' | 'onTaskComplete'>>;
  private onProgress?: (progress: BatchProgress) => void;
  private onTaskComplete?: (result: BatchResult) => void;
  private tasks: BatchTask[] = [];
  private results: BatchResult[] = [];
  private isRunning: boolean = false;
  private aborted: boolean = false;

  constructor(config: BatchConfig = {}) {
    this.config = {
      concurrency: config.concurrency ?? DEFAULT_CONFIG.concurrency,
      continueOnError: config.continueOnError ?? DEFAULT_CONFIG.continueOnError,
      taskTimeout: config.taskTimeout ?? DEFAULT_CONFIG.taskTimeout,
      dryRun: config.dryRun ?? DEFAULT_CONFIG.dryRun,
    };
    this.onProgress = config.onProgress;
    this.onTaskComplete = config.onTaskComplete;
  }

  /**
   * Add a single task
   */
  addTask(task: BatchTask): void {
    this.tasks.push(task);
  }

  /**
   * Add multiple tasks
   */
  addTasks(tasks: BatchTask[]): void {
    this.tasks.push(...tasks);
  }

  /**
   * Add file tasks from glob pattern
   */
  async addFileTasks(
    pattern: string | string[],
    options: {
      cwd?: string;
      taskType?: 'file';
      taskOptions?: Record<string, unknown>;
    } = {}
  ): Promise<number> {
    const files = await fg(pattern, {
      cwd: options.cwd || process.cwd(),
      absolute: true,
    });

    for (const file of files) {
      this.addTask({
        id: `file-${path.basename(file)}-${Date.now()}`,
        type: options.taskType || 'file',
        input: file,
        options: options.taskOptions,
      });
    }

    return files.length;
  }

  /**
   * Add tasks from a batch file (JSON or text)
   */
  async addTasksFromFile(filePath: string): Promise<number> {
    const content = await fs.readFile(filePath, 'utf-8');
    const ext = path.extname(filePath).toLowerCase();

    if (ext === '.json') {
      const data = JSON.parse(content);
      const tasks = Array.isArray(data) ? data : data.tasks || [];
      this.addTasks(tasks);
      return tasks.length;
    } else {
      // Text file - one task per line
      const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('#'));
      for (const line of lines) {
        this.addTask({
          id: `line-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          type: 'prompt',
          input: line.trim(),
        });
      }
      return lines.length;
    }
  }

  /**
   * Execute all tasks
   */
  async execute(taskHandler: (task: BatchTask) => Promise<{ success: boolean; output?: string; error?: string }>): Promise<BatchSummary> {
    this.isRunning = true;
    this.aborted = false;
    this.results = [];

    const startTime = Date.now();

    // Sort by priority
    const sortedTasks = [...this.tasks].sort((a, b) => (b.priority || 0) - (a.priority || 0));

    if (this.config.dryRun) {
      // Dry run - just validate
      for (const task of sortedTasks) {
        this.results.push({
          taskId: task.id,
          success: true,
          output: `[DRY RUN] Would process: ${task.input}`,
          durationMs: 0,
          startedAt: new Date(),
          completedAt: new Date(),
        });
      }
    } else {
      // Execute with concurrency control
      await this.executeWithConcurrency(sortedTasks, taskHandler);
    }

    this.isRunning = false;

    const totalDurationMs = Date.now() - startTime;
    const successfulTasks = this.results.filter(r => r.success).length;
    const failedTasks = this.results.filter(r => !r.success).length;

    return {
      totalTasks: this.tasks.length,
      successfulTasks,
      failedTasks,
      totalDurationMs,
      averageTaskDurationMs: this.results.length > 0
        ? this.results.reduce((sum, r) => sum + r.durationMs, 0) / this.results.length
        : 0,
      results: this.results,
    };
  }

  /**
   * Execute tasks with concurrency limit
   */
  private async executeWithConcurrency(
    tasks: BatchTask[],
    handler: (task: BatchTask) => Promise<{ success: boolean; output?: string; error?: string }>
  ): Promise<void> {
    const queue = [...tasks];
    const inProgress = new Set<string>();
    let completed = 0;
    let failed = 0;
    const taskDurations: number[] = [];

    const updateProgress = (currentTask?: string) => {
      if (this.onProgress) {
        const avgDuration = taskDurations.length > 0
          ? taskDurations.reduce((a, b) => a + b, 0) / taskDurations.length
          : undefined;

        this.onProgress({
          total: tasks.length,
          completed,
          failed,
          inProgress: inProgress.size,
          percentage: Math.round((completed / tasks.length) * 100),
          currentTask,
          estimatedRemainingMs: avgDuration
            ? avgDuration * (tasks.length - completed)
            : undefined,
        });
      }
    };

    const processTask = async (task: BatchTask): Promise<void> => {
      if (this.aborted) return;

      inProgress.add(task.id);
      updateProgress(task.input);

      const startedAt = new Date();
      let result: BatchResult;

      try {
        // Create timeout promise
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Task timeout')), this.config.taskTimeout);
        });

        // Race between task and timeout
        const taskResult = await Promise.race([
          handler(task),
          timeoutPromise,
        ]);

        const completedAt = new Date();
        const durationMs = completedAt.getTime() - startedAt.getTime();
        taskDurations.push(durationMs);

        result = {
          taskId: task.id,
          success: taskResult.success,
          output: taskResult.output,
          error: taskResult.error,
          durationMs,
          startedAt,
          completedAt,
        };

        if (taskResult.success) {
          completed++;
        } else {
          failed++;
        }
      } catch (error) {
        const completedAt = new Date();
        const durationMs = completedAt.getTime() - startedAt.getTime();

        result = {
          taskId: task.id,
          success: false,
          error: error instanceof Error ? error.message : String(error),
          durationMs,
          startedAt,
          completedAt,
        };
        failed++;

        if (!this.config.continueOnError) {
          this.aborted = true;
        }
      }

      this.results.push(result);
      inProgress.delete(task.id);

      if (this.onTaskComplete) {
        this.onTaskComplete(result);
      }

      updateProgress();
    };

    // Process with concurrency
    const workers: Promise<void>[] = [];

    for (let i = 0; i < this.config.concurrency; i++) {
      workers.push((async () => {
        while (queue.length > 0 && !this.aborted) {
          const task = queue.shift();
          if (task) {
            await processTask(task);
          }
        }
      })());
    }

    await Promise.all(workers);
  }

  /**
   * Abort execution
   */
  abort(): void {
    this.aborted = true;
  }

  /**
   * Check if running
   */
  isExecuting(): boolean {
    return this.isRunning;
  }

  /**
   * Get current results
   */
  getResults(): BatchResult[] {
    return [...this.results];
  }

  /**
   * Clear all tasks
   */
  clear(): void {
    this.tasks = [];
    this.results = [];
  }

  /**
   * Get task count
   */
  getTaskCount(): number {
    return this.tasks.length;
  }

  /**
   * Format summary for display
   */
  static formatSummary(summary: BatchSummary): string {
    const lines: string[] = [
      '',
      '═══════════════════════════════════════',
      '          BATCH PROCESSING SUMMARY',
      '═══════════════════════════════════════',
      '',
      `Total Tasks:      ${summary.totalTasks}`,
      `Successful:       ${summary.successfulTasks}`,
      `Failed:           ${summary.failedTasks}`,
      `Success Rate:     ${((summary.successfulTasks / summary.totalTasks) * 100).toFixed(1)}%`,
      '',
      `Total Duration:   ${formatDuration(summary.totalDurationMs)}`,
      `Avg Task Time:    ${summary.averageTaskDurationMs.toFixed(0)}ms`,
      '',
    ];

    if (summary.failedTasks > 0) {
      lines.push('Failed Tasks:');
      const failed = summary.results.filter(r => !r.success);
      for (const result of failed.slice(0, 10)) {
        lines.push(`  - ${result.taskId}: ${result.error}`);
      }
      if (failed.length > 10) {
        lines.push(`  ... and ${failed.length - 10} more`);
      }
    }

    lines.push('═══════════════════════════════════════');

    return lines.join('\n');
  }
}

/**
 * Format duration
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;

  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

/**
 * Create a batch processor with file tasks
 */
export async function createFileBatchProcessor(
  pattern: string | string[],
  config?: BatchConfig
): Promise<BatchProcessor> {
  const processor = new BatchProcessor(config);
  await processor.addFileTasks(pattern);
  return processor;
}

export default BatchProcessor;
