/**
 * Task Scheduler - Priority-based task scheduling with execution timing
 *
 * Features:
 * - Priority queue with aging to prevent starvation
 * - Scheduled execution at specific times
 * - Dependency management between tasks
 * - Concurrent execution control
 * - Retry handling with backoff
 * - Task lifecycle events
 */

import { EventEmitter } from 'events';
import {
  ScheduledTask,
  ScheduledTaskStatus,
  TaskPriority,
  CreateTaskOptions,
  SchedulerConfig,
  SchedulerStats,
  TaskExecutionResult,
  DEFAULT_SCHEDULER_CONFIG,
} from './types.js';

export class Scheduler extends EventEmitter {
  private tasks: Map<string, ScheduledTask> = new Map();
  private config: SchedulerConfig;
  private running: boolean = false;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private agingTimer: ReturnType<typeof setInterval> | null = null;
  private executionTimes: number[] = [];
  private waitTimes: number[] = [];
  private completedCount: number = 0;
  private startTime: number = Date.now();

  constructor(config: Partial<SchedulerConfig> = {}) {
    super();
    this.config = { ...DEFAULT_SCHEDULER_CONFIG, ...config };
  }

  /**
   * Generate unique task ID
   */
  private generateId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `task_${timestamp}_${random}`;
  }

  /**
   * Create and add a new task to the scheduler
   */
  createTask(
    handler: () => Promise<unknown> | unknown,
    options: CreateTaskOptions = {}
  ): ScheduledTask {
    const id = this.generateId();
    const now = new Date();

    const task: ScheduledTask = {
      id,
      name: options.name || `Task ${id}`,
      handler,
      priority: options.priority ?? this.config.defaultPriority,
      status: options.scheduledAt ? 'scheduled' : 'pending',
      createdAt: now,
      scheduledAt: options.scheduledAt,
      retries: 0,
      maxRetries: options.maxRetries ?? this.config.defaultMaxRetries,
      timeout: options.timeout ?? this.config.defaultTimeout,
      dependencies: options.dependencies ?? [],
      tags: options.tags ?? [],
      metadata: options.metadata ?? {},
    };

    this.tasks.set(id, task);
    this.emit('task:created', task);

    return task;
  }

  /**
   * Add an existing task to the scheduler
   */
  addTask(task: ScheduledTask): void {
    this.tasks.set(task.id, task);
    this.emit('task:added', task);
  }

  /**
   * Get a task by ID
   */
  getTask(taskId: string): ScheduledTask | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * Get all tasks
   */
  getAllTasks(): ScheduledTask[] {
    return Array.from(this.tasks.values());
  }

  /**
   * Get tasks by status
   */
  getTasksByStatus(status: ScheduledTaskStatus): ScheduledTask[] {
    return this.getAllTasks().filter(t => t.status === status);
  }

  /**
   * Get tasks by tag
   */
  getTasksByTag(tag: string): ScheduledTask[] {
    return this.getAllTasks().filter(t => t.tags.includes(tag));
  }

  /**
   * Get pending tasks sorted by priority (lower number = higher priority)
   */
  getPendingTasks(): ScheduledTask[] {
    return this.getAllTasks()
      .filter(t => t.status === 'pending')
      .sort((a, b) => {
        // Sort by priority first (lower number = higher priority)
        if (a.priority !== b.priority) {
          return a.priority - b.priority;
        }
        // Then by creation time (older first)
        return a.createdAt.getTime() - b.createdAt.getTime();
      });
  }

  /**
   * Get scheduled tasks that are ready to run
   */
  getReadyScheduledTasks(): ScheduledTask[] {
    const now = Date.now();
    return this.getAllTasks()
      .filter(t => t.status === 'scheduled' && t.scheduledAt && t.scheduledAt.getTime() <= now)
      .sort((a, b) => a.priority - b.priority);
  }

  /**
   * Check if a task's dependencies are satisfied
   */
  areDependenciesSatisfied(task: ScheduledTask): boolean {
    for (const depId of task.dependencies) {
      const depTask = this.tasks.get(depId);
      if (!depTask || depTask.status !== 'completed') {
        return false;
      }
    }
    return true;
  }

  /**
   * Get next task to execute
   */
  getNextTask(): ScheduledTask | null {
    // First check scheduled tasks that are ready
    const readyScheduled = this.getReadyScheduledTasks();
    for (const task of readyScheduled) {
      if (this.areDependenciesSatisfied(task)) {
        return task;
      }
    }

    // Then check pending tasks
    const pending = this.getPendingTasks();
    for (const task of pending) {
      if (this.areDependenciesSatisfied(task)) {
        return task;
      }
    }

    return null;
  }

  /**
   * Get count of currently running tasks
   */
  getRunningCount(): number {
    return this.getTasksByStatus('running').length;
  }

  /**
   * Update task priority
   */
  updatePriority(taskId: string, priority: TaskPriority): boolean {
    const task = this.tasks.get(taskId);
    if (!task || task.status === 'running' || task.status === 'completed') {
      return false;
    }
    const oldPriority = task.priority;
    task.priority = priority;
    this.emit('task:priority-changed', { task, oldPriority, newPriority: priority });
    return true;
  }

  /**
   * Apply priority aging to prevent starvation
   */
  applyPriorityAging(): void {
    if (!this.config.enablePriorityAging) return;

    const pending = this.getTasksByStatus('pending');
    const scheduled = this.getTasksByStatus('scheduled');

    for (const task of [...pending, ...scheduled]) {
      // Increase priority (lower number) based on wait time
      const waitTime = Date.now() - task.createdAt.getTime();
      const agingFactor = Math.floor(waitTime / this.config.agingInterval) * this.config.agingRate;
      const newPriority = Math.max(1, Math.round(task.priority - agingFactor)) as TaskPriority;

      if (newPriority !== task.priority) {
        const oldPriority = task.priority;
        task.priority = newPriority;
        this.emit('task:priority-aged', { task, oldPriority, newPriority });
      }
    }
  }

  /**
   * Execute a single task
   */
  async executeTask(task: ScheduledTask): Promise<TaskExecutionResult> {
    const startTime = Date.now();
    task.status = 'running';
    task.startedAt = new Date();

    // Track wait time
    const waitTime = startTime - task.createdAt.getTime();
    this.waitTimes.push(waitTime);
    if (this.waitTimes.length > 1000) {
      this.waitTimes = this.waitTimes.slice(-500);
    }

    this.emit('task:started', task);

    try {
      // Create timeout promise with cleanup
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`Task timed out after ${task.timeout}ms`)), task.timeout);
      });

      // Execute with timeout
      const result = await Promise.race([
        Promise.resolve(task.handler()),
        timeoutPromise,
      ]);
      if (timeoutId) clearTimeout(timeoutId);

      const duration = Date.now() - startTime;
      this.executionTimes.push(duration);
      if (this.executionTimes.length > 1000) {
        this.executionTimes = this.executionTimes.slice(-500);
      }
      this.completedCount++;

      task.status = 'completed';
      task.completedAt = new Date();
      task.result = result;

      const executionResult: TaskExecutionResult = {
        taskId: task.id,
        success: true,
        result,
        duration,
        retries: task.retries,
      };

      this.emit('task:completed', task, executionResult);
      return executionResult;
    } catch (error) {
      const duration = Date.now() - startTime;
      task.error = error instanceof Error ? error : new Error(String(error));

      // Check if we should retry
      if (task.retries < task.maxRetries) {
        task.retries++;
        task.status = 'pending';
        this.emit('task:retry', task, task.retries);

        return {
          taskId: task.id,
          success: false,
          error: task.error,
          duration,
          retries: task.retries,
        };
      }

      task.status = 'failed';
      task.completedAt = new Date();

      const executionResult: TaskExecutionResult = {
        taskId: task.id,
        success: false,
        error: task.error,
        duration,
        retries: task.retries,
      };

      this.emit('task:failed', task, executionResult);
      return executionResult;
    }
  }

  /**
   * Process the scheduler tick
   */
  private async tick(): Promise<void> {
    if (!this.running) return;

    const runningCount = this.getRunningCount();
    const availableSlots = this.config.maxConcurrent - runningCount;

    if (availableSlots <= 0) return;

    // Get next tasks to execute
    const tasksToExecute: ScheduledTask[] = [];
    for (let i = 0; i < availableSlots; i++) {
      const nextTask = this.getNextTask();
      if (nextTask && !tasksToExecute.find(t => t.id === nextTask.id)) {
        // Mark as running to prevent re-selection
        nextTask.status = 'running';
        tasksToExecute.push(nextTask);
      } else {
        break;
      }
    }

    // Reset status for tasks we're about to execute (executeTask will set it properly)
    for (const task of tasksToExecute) {
      task.status = task.scheduledAt ? 'scheduled' : 'pending';
    }

    // Execute tasks in parallel
    for (const task of tasksToExecute) {
      this.executeTask(task).catch(err => {
        this.emit('error', err);
      });
    }
  }

  /**
   * Start the scheduler
   */
  start(): void {
    if (this.running) return;

    this.running = true;
    this.startTime = Date.now();
    this.emit('scheduler:started');

    // Start tick timer
    this.tickTimer = setInterval(() => this.tick(), this.config.tickInterval);

    // Start aging timer
    if (this.config.enablePriorityAging) {
      this.agingTimer = setInterval(
        () => this.applyPriorityAging(),
        this.config.agingInterval
      );
    }
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    if (!this.running) return;

    this.running = false;

    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }

    if (this.agingTimer) {
      clearInterval(this.agingTimer);
      this.agingTimer = null;
    }

    this.emit('scheduler:stopped');
  }

  /**
   * Check if scheduler is running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Cancel a task
   */
  cancelTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    if (task.status === 'completed' || task.status === 'cancelled') {
      return false;
    }

    task.status = 'cancelled';
    task.completedAt = new Date();
    this.emit('task:cancelled', task);
    return true;
  }

  /**
   * Pause a task
   */
  pauseTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'pending' && task.status !== 'scheduled') {
      return false;
    }

    task.status = 'paused';
    this.emit('task:paused', task);
    return true;
  }

  /**
   * Resume a paused task
   */
  resumeTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'paused') {
      return false;
    }

    task.status = task.scheduledAt ? 'scheduled' : 'pending';
    this.emit('task:resumed', task);
    return true;
  }

  /**
   * Remove a task from the scheduler
   */
  removeTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    if (task.status === 'running') {
      return false;
    }

    this.tasks.delete(taskId);
    this.emit('task:removed', taskId);
    return true;
  }

  /**
   * Clear all completed/failed/cancelled tasks
   */
  clearFinished(): number {
    const finishedStatuses: ScheduledTaskStatus[] = ['completed', 'failed', 'cancelled'];
    const finished = this.getAllTasks().filter(t => finishedStatuses.includes(t.status));

    for (const task of finished) {
      this.tasks.delete(task.id);
    }

    return finished.length;
  }

  /**
   * Get scheduler statistics
   */
  getStats(): SchedulerStats {
    const tasks = this.getAllTasks();
    const statusCounts = tasks.reduce((acc, task) => {
      acc[task.status] = (acc[task.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const avgWait = this.waitTimes.length > 0
      ? this.waitTimes.reduce((a, b) => a + b, 0) / this.waitTimes.length
      : 0;

    const avgExecution = this.executionTimes.length > 0
      ? this.executionTimes.reduce((a, b) => a + b, 0) / this.executionTimes.length
      : 0;

    const runtime = (Date.now() - this.startTime) / 1000; // in seconds
    const throughput = runtime > 0 ? this.completedCount / runtime : 0;

    return {
      totalTasks: tasks.length,
      pendingTasks: statusCounts['pending'] || 0,
      scheduledTasks: statusCounts['scheduled'] || 0,
      runningTasks: statusCounts['running'] || 0,
      completedTasks: statusCounts['completed'] || 0,
      failedTasks: statusCounts['failed'] || 0,
      cancelledTasks: statusCounts['cancelled'] || 0,
      pausedTasks: statusCounts['paused'] || 0,
      averageWaitTime: avgWait,
      averageExecutionTime: avgExecution,
      throughput,
    };
  }

  /**
   * Get scheduler configuration
   */
  getConfig(): SchedulerConfig {
    return { ...this.config };
  }

  /**
   * Update scheduler configuration
   */
  updateConfig(config: Partial<SchedulerConfig>): void {
    const wasRunning = this.running;

    if (wasRunning) {
      this.stop();
    }

    this.config = { ...this.config, ...config };

    if (wasRunning) {
      this.start();
    }

    this.emit('config:updated', this.config);
  }

  /**
   * Schedule a task to run at a specific time
   */
  scheduleAt(
    handler: () => Promise<unknown> | unknown,
    scheduledAt: Date,
    options: Omit<CreateTaskOptions, 'scheduledAt'> = {}
  ): ScheduledTask {
    return this.createTask(handler, { ...options, scheduledAt });
  }

  /**
   * Schedule a task to run after a delay
   */
  scheduleAfter(
    handler: () => Promise<unknown> | unknown,
    delayMs: number,
    options: Omit<CreateTaskOptions, 'scheduledAt'> = {}
  ): ScheduledTask {
    const scheduledAt = new Date(Date.now() + delayMs);
    return this.createTask(handler, { ...options, scheduledAt });
  }

  /**
   * Wait for all tasks to complete
   */
  async waitForAll(timeoutMs?: number): Promise<void> {
    const startWait = Date.now();

    return new Promise((resolve, reject) => {
      const check = () => {
        const active = this.getAllTasks().filter(
          t => t.status === 'pending' || t.status === 'scheduled' || t.status === 'running'
        );

        if (active.length === 0) {
          resolve();
          return;
        }

        if (timeoutMs && Date.now() - startWait > timeoutMs) {
          reject(new Error(`Timeout waiting for tasks after ${timeoutMs}ms`));
          return;
        }

        setTimeout(check, 50);
      };

      check();
    });
  }

  /**
   * Wait for a specific task to complete
   */
  async waitForTask(taskId: string, timeoutMs?: number): Promise<TaskExecutionResult> {
    const startWait = Date.now();

    return new Promise((resolve, reject) => {
      const check = () => {
        const task = this.tasks.get(taskId);

        if (!task) {
          reject(new Error(`Task not found: ${taskId}`));
          return;
        }

        if (task.status === 'completed') {
          resolve({
            taskId: task.id,
            success: true,
            result: task.result,
            duration: task.completedAt!.getTime() - task.startedAt!.getTime(),
            retries: task.retries,
          });
          return;
        }

        if (task.status === 'failed' || task.status === 'cancelled') {
          resolve({
            taskId: task.id,
            success: false,
            error: task.error,
            duration: task.completedAt ? task.completedAt.getTime() - (task.startedAt?.getTime() || task.createdAt.getTime()) : 0,
            retries: task.retries,
          });
          return;
        }

        if (timeoutMs && Date.now() - startWait > timeoutMs) {
          reject(new Error(`Timeout waiting for task ${taskId} after ${timeoutMs}ms`));
          return;
        }

        setTimeout(check, 50);
      };

      check();
    });
  }

  /**
   * Dispose of the scheduler and clean up resources
   */
  dispose(): void {
    this.stop();
    this.tasks.clear();
    this.executionTimes = [];
    this.waitTimes = [];
    this.removeAllListeners();
  }
}

// Singleton instance
let schedulerInstance: Scheduler | null = null;

export function createScheduler(config?: Partial<SchedulerConfig>): Scheduler {
  schedulerInstance = new Scheduler(config);
  return schedulerInstance;
}

export function getScheduler(): Scheduler {
  if (!schedulerInstance) {
    schedulerInstance = new Scheduler();
  }
  return schedulerInstance;
}

export function resetScheduler(): void {
  if (schedulerInstance) {
    schedulerInstance.dispose();
  }
  schedulerInstance = null;
}
