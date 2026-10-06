/**
 * Progress Tracker
 *
 * Tracks task execution progress with ETA estimation and checkpoints.
 */

import { EventEmitter } from 'events';

export interface ProgressUpdate {
  taskId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  total: number;
  completed: number;
  failed: number;
  eta?: number; // ms remaining
  message?: string;
}

export class ProgressTracker extends EventEmitter {
  private total: number = 0;
  private completed: number = 0;
  private failed: number = 0;
  private startTime: number = 0;
  private taskTimes: Map<string, number> = new Map();

  start(total: number): void {
    this.total = total;
    this.completed = 0;
    this.failed = 0;
    this.startTime = Date.now();
    this.emit('start', { total });
  }

  update(taskId: string, status: ProgressUpdate['status'], message?: string): void {
    if (status === 'completed') {
      this.completed++;
      this.taskTimes.set(taskId, Date.now());
    } else if (status === 'failed') {
      this.failed++;
    }

    const update: ProgressUpdate = {
      taskId,
      status,
      total: this.total,
      completed: this.completed,
      failed: this.failed,
      eta: this.estimateETA(),
      message,
    };

    this.emit('progress', update);
  }

  private estimateETA(): number | undefined {
    if (this.completed === 0) return undefined;
    const elapsed = Date.now() - this.startTime;
    const avgTime = elapsed / this.completed;
    // Tool calls can outnumber the declared total (rounds vs calls): never
    // report a negative remainder.
    const remaining = Math.max(0, this.total - this.completed - this.failed);
    return Math.round(avgTime * remaining);
  }

  getProgress(): { percentage: number; completed: number; total: number; eta?: number } {
    const done = Math.min(this.completed + this.failed, this.total);
    return {
      percentage: this.total > 0 ? Math.min(100, Math.round((done / this.total) * 100)) : 0,
      completed: this.completed,
      total: this.total,
      eta: this.estimateETA(),
    };
  }

  reset(): void {
    this.total = 0;
    this.completed = 0;
    this.failed = 0;
    this.startTime = 0;
    this.taskTimes.clear();
  }
}
