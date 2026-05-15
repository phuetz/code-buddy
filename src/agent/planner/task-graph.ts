/**
 * Task Graph (DAG)
 *
 * Directed Acyclic Graph for task execution ordering.
 * Supports topological sort, parallel execution, cycle detection.
 */

import { EventEmitter } from 'events';

// ============================================================================
// Types
// ============================================================================

export interface PlannedTask {
  id: string;
  description: string;
  dependencies: string[];
  delegateTo?: 'code-reviewer' | 'debugger' | 'test-runner' | 'explorer' | 'refactorer' | 'documenter';
  parallel?: boolean;
  estimatedTokens?: number;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  result?: TaskResult;
}

export interface TaskResult {
  success: boolean;
  output: string;
  duration: number;
  error?: string;
}

export interface TaskGraphResult {
  success: boolean;
  results: Map<string, TaskResult>;
  totalDuration: number;
  completedCount: number;
  failedCount: number;
  skippedCount: number;
}

export function formatTaskFailureOutput(error: string | undefined): string {
  const detail = error?.trim();
  return detail
    ? `Task failed: ${detail}`
    : 'Task failed without output or error details.';
}

export function normalizeTaskResult(result: TaskResult): TaskResult {
  if (!result.success && result.output.trim().length === 0) {
    return {
      ...result,
      output: formatTaskFailureOutput(result.error),
      error: result.error?.trim() || 'Task failed without error details',
    };
  }

  return result;
}

// ============================================================================
// Task Graph
// ============================================================================

export class TaskGraph extends EventEmitter {
  private tasks: Map<string, PlannedTask> = new Map();

  constructor(tasks: PlannedTask[] = []) {
    super();
    for (const task of tasks) {
      this.tasks.set(task.id, { ...task, status: 'pending' });
    }
  }

  addTask(task: PlannedTask): void {
    this.tasks.set(task.id, { ...task, status: 'pending' });
  }

  getTask(id: string): PlannedTask | undefined {
    return this.tasks.get(id);
  }

  getAllTasks(): PlannedTask[] {
    return Array.from(this.tasks.values());
  }

  /**
   * Get tasks that are ready to execute (no pending dependencies)
   */
  getReady(): PlannedTask[] {
    return Array.from(this.tasks.values()).filter(task => {
      if (task.status !== 'pending') return false;
      return task.dependencies.every(depId => {
        const dep = this.tasks.get(depId);
        return dep && (dep.status === 'completed' || dep.status === 'skipped');
      });
    });
  }

  /**
   * Mark a task as complete
   */
  markComplete(id: string, result?: TaskResult): void {
    const task = this.tasks.get(id);
    if (task) {
      task.status = 'completed';
      task.result = result;
      this.emit('task:completed', { id, result });
    }
  }

  /**
   * Mark a task as failed
   */
  markFailed(id: string, error: string): void {
    const task = this.tasks.get(id);
    if (task) {
      task.status = 'failed';
      task.result = {
        success: false,
        output: formatTaskFailureOutput(error),
        duration: 0,
        error,
      };
      this.emit('task:failed', { id, error });

      // Skip dependent tasks
      this.skipDependents(id);
    }
  }

  /**
   * Skip all tasks that depend on a failed task
   */
  private skipDependents(failedId: string): void {
    for (const task of this.tasks.values()) {
      if (task.status === 'pending' && task.dependencies.includes(failedId)) {
        task.status = 'skipped';
        this.emit('task:skipped', { id: task.id, reason: `Dependency ${failedId} failed` });
        this.skipDependents(task.id);
      }
    }
  }

  /**
   * Detect cycles in the graph
   */
  hasCycle(): boolean {
    const visited = new Set<string>();
    const inStack = new Set<string>();

    const dfs = (id: string): boolean => {
      if (inStack.has(id)) return true;
      if (visited.has(id)) return false;

      visited.add(id);
      inStack.add(id);

      const task = this.tasks.get(id);
      if (task) {
        for (const depId of task.dependencies) {
          if (dfs(depId)) return true;
        }
      }

      inStack.delete(id);
      return false;
    };

    for (const id of this.tasks.keys()) {
      if (dfs(id)) return true;
    }
    return false;
  }

  /**
   * Get topological sort of tasks
   */
  topologicalSort(): PlannedTask[] {
    if (this.hasCycle()) {
      throw new Error('Cannot sort: graph contains a cycle');
    }

    const visited = new Set<string>();
    const result: PlannedTask[] = [];

    const visit = (id: string): void => {
      if (visited.has(id)) return;
      visited.add(id);

      const task = this.tasks.get(id);
      if (!task) return;

      for (const depId of task.dependencies) {
        visit(depId);
      }
      result.push(task);
    };

    for (const id of this.tasks.keys()) {
      visit(id);
    }

    return result;
  }

  /**
   * Execute all tasks respecting the dependency graph
   */
  async execute(
    executor: (task: PlannedTask) => Promise<TaskResult>,
    options: { maxParallel?: number } = {}
  ): Promise<TaskGraphResult> {
    const maxParallel = options.maxParallel || 5;
    const startTime = Date.now();
    const results = new Map<string, TaskResult>();
    let completedCount = 0;
    let failedCount = 0;
    let skippedCount = 0;

    if (this.hasCycle()) {
      throw new Error('Cannot execute: graph contains a cycle');
    }

    while (true) {
      const ready = this.getReady();
      if (ready.length === 0) {
        // Check if there are still pending tasks (would indicate a bug)
        const pending = Array.from(this.tasks.values()).filter(t => t.status === 'pending');
        if (pending.length > 0) {
          // Deadlock - mark remaining as failed
          for (const task of pending) {
            this.markFailed(task.id, 'Deadlocked - unreachable dependencies');
            failedCount++;
          }
        }
        break;
      }

      // Execute ready tasks (up to maxParallel at a time)
      const batch = ready.slice(0, maxParallel);

      for (const task of batch) {
        task.status = 'running';
        this.emit('task:running', { id: task.id });
      }

      const batchResults = await Promise.allSettled(
        batch.map(async task => {
          try {
            const result = normalizeTaskResult(await executor(task));
            results.set(task.id, result);

            if (result.success) {
              this.markComplete(task.id, result);
              completedCount++;
            } else {
              this.markFailed(task.id, result.error || 'Task failed');
              failedCount++;
            }
            return result;
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            this.markFailed(task.id, errorMsg);
            failedCount++;
            throw error;
          }
        })
      );

      this.emit('batch:complete', { batchSize: batchResults.length, completedCount, failedCount });
    }

    // Count skipped
    skippedCount = Array.from(this.tasks.values()).filter(t => t.status === 'skipped').length;

    return {
      success: failedCount === 0 && skippedCount === 0,
      results,
      totalDuration: Date.now() - startTime,
      completedCount,
      failedCount,
      skippedCount,
    };
  }

  /**
   * Get progress summary
   */
  getProgress(): { total: number; completed: number; failed: number; running: number; pending: number; skipped: number } {
    let completed = 0, failed = 0, running = 0, pending = 0, skipped = 0;

    for (const task of this.tasks.values()) {
      switch (task.status) {
        case 'completed': completed++; break;
        case 'failed': failed++; break;
        case 'running': running++; break;
        case 'pending': pending++; break;
        case 'skipped': skipped++; break;
      }
    }

    return { total: this.tasks.size, completed, failed, running, pending, skipped };
  }
}
