/**
 * Type definitions for the Scheduler module
 */

export type ScheduledTaskStatus = 'pending' | 'scheduled' | 'running' | 'completed' | 'failed' | 'cancelled' | 'paused';
export type TaskPriority = 1 | 2 | 3 | 4 | 5; // 1 = highest, 5 = lowest

export interface ScheduledTask {
  id: string;
  name: string;
  handler: () => Promise<unknown> | unknown;
  priority: TaskPriority;
  status: ScheduledTaskStatus;
  createdAt: Date;
  scheduledAt?: Date;
  startedAt?: Date;
  completedAt?: Date;
  result?: unknown;
  error?: Error;
  retries: number;
  maxRetries: number;
  timeout: number;
  dependencies: string[];
  tags: string[];
  metadata: Record<string, unknown>;
}

export interface CreateTaskOptions {
  name?: string;
  priority?: TaskPriority;
  scheduledAt?: Date;
  maxRetries?: number;
  timeout?: number;
  dependencies?: string[];
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface SchedulerConfig {
  maxConcurrent: number;
  defaultPriority: TaskPriority;
  defaultTimeout: number;
  defaultMaxRetries: number;
  tickInterval: number;
  enablePriorityAging: boolean;
  agingRate: number;
  agingInterval: number;
}

export interface SchedulerStats {
  totalTasks: number;
  pendingTasks: number;
  scheduledTasks: number;
  runningTasks: number;
  completedTasks: number;
  failedTasks: number;
  cancelledTasks: number;
  pausedTasks: number;
  averageWaitTime: number;
  averageExecutionTime: number;
  throughput: number;
}

export interface TaskExecutionResult {
  taskId: string;
  success: boolean;
  result?: unknown;
  error?: Error;
  duration: number;
  retries: number;
}

export const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
  maxConcurrent: 5,
  defaultPriority: 3,
  defaultTimeout: 30000,
  defaultMaxRetries: 3,
  tickInterval: 100,
  enablePriorityAging: true,
  agingRate: 0.1,
  agingInterval: 10000,
};
