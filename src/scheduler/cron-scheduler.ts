/**
 * Cron Scheduler
 *
 * Gateway-integrated job scheduler supporting:
 * - One-shot (at) - ISO 8601 timestamp
 * - Fixed intervals (every) - millisecond-based
 * - Cron expressions (cron) - 5-field syntax + timezone
 *
 * Inspired by OpenClaw's cron scheduling system.
 */

import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { homedir } from 'os';

// ============================================================================
// Types
// ============================================================================

export type ScheduleType = 'at' | 'every' | 'cron';

export type JobStatus = 'active' | 'paused' | 'completed' | 'error';

export interface CronJob {
  /** Unique job ID */
  id: string;
  /** Job name/label */
  name: string;
  /** Job description */
  description?: string;
  /** Schedule type */
  type: ScheduleType;
  /** Schedule specification */
  schedule: {
    /** ISO 8601 timestamp for 'at' type */
    at?: string;
    /** Interval in milliseconds for 'every' type */
    every?: number;
    /** Cron expression for 'cron' type (5-field) */
    cron?: string;
    /** IANA timezone (default: local) */
    timezone?: string;
  };
  /** Task to execute */
  task: {
    /** Task type */
    type: 'message' | 'tool' | 'agent';
    /** Message content (for message type) */
    message?: string;
    /** Tool name and arguments (for tool type) */
    tool?: {
      name: string;
      arguments: Record<string, unknown>;
    };
    /** Agent ID (for agent type) */
    agentId?: string;
    /** Model override */
    model?: string;
  };
  /** Delivery options */
  delivery?: {
    /** Channel to deliver to */
    channel?: string;
    /** Session key */
    sessionKey?: string;
    /** Webhook URL */
    webhookUrl?: string;
  };
  /** Job status */
  status: JobStatus;
  /** Creation timestamp */
  createdAt: Date;
  /** Last run timestamp */
  lastRunAt?: Date;
  /** Next run timestamp */
  nextRunAt?: Date;
  /** Run count */
  runCount: number;
  /** Error count */
  errorCount: number;
  /** Last error */
  lastError?: string;
  /** Max runs (undefined = unlimited) */
  maxRuns?: number;
  /** Enabled flag */
  enabled: boolean;
}

export interface JobRun {
  id: string;
  jobId: string;
  startedAt: Date;
  completedAt?: Date;
  status: 'running' | 'success' | 'error';
  result?: unknown;
  error?: string;
  duration?: number;
}

export interface CronSchedulerConfig {
  /** Jobs persist path */
  persistPath: string;
  /** Run history path */
  historyPath: string;
  /** Max history entries per job */
  maxHistoryPerJob: number;
  /** Tick interval in ms */
  tickIntervalMs: number;
  /** Default timezone */
  defaultTimezone: string;
}

export const DEFAULT_CRON_SCHEDULER_CONFIG: CronSchedulerConfig = {
  persistPath: path.join(homedir(), '.codebuddy', 'cron', 'jobs.json'),
  historyPath: path.join(homedir(), '.codebuddy', 'cron', 'runs'),
  maxHistoryPerJob: 100,
  tickIntervalMs: 1000,
  defaultTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
};

export interface CronSchedulerEvents {
  'job:created': (job: CronJob) => void;
  'job:updated': (job: CronJob) => void;
  'job:deleted': (jobId: string) => void;
  'job:run:start': (run: JobRun) => void;
  'job:run:complete': (run: JobRun) => void;
  'job:run:error': (run: JobRun, error: Error) => void;
  'error': (error: Error) => void;
}

// ============================================================================
// Cron Parser (5-field)
// ============================================================================

interface CronFields {
  minute: number[];
  hour: number[];
  dayOfMonth: number[];
  month: number[];
  dayOfWeek: number[];
}

function parseCronExpression(expr: string): CronFields {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression: expected 5 fields, got ${parts.length}`);
  }

  return {
    minute: parseField(parts[0], 0, 59),
    hour: parseField(parts[1], 0, 23),
    dayOfMonth: parseField(parts[2], 1, 31),
    month: parseField(parts[3], 1, 12),
    dayOfWeek: parseField(parts[4], 0, 6),
  };
}

function parseField(field: string, min: number, max: number): number[] {
  const values: Set<number> = new Set();

  for (const part of field.split(',')) {
    if (part === '*') {
      for (let i = min; i <= max; i++) values.add(i);
    } else if (part.includes('/')) {
      const [range, stepStr] = part.split('/');
      const step = parseInt(stepStr, 10);
      let start = min;
      let end = max;

      if (range !== '*') {
        if (range.includes('-')) {
          const [s, e] = range.split('-').map(n => parseInt(n, 10));
          start = s;
          end = e;
        } else {
          start = parseInt(range, 10);
        }
      }

      for (let i = start; i <= end; i += step) values.add(i);
    } else if (part.includes('-')) {
      const [start, end] = part.split('-').map(n => parseInt(n, 10));
      for (let i = start; i <= end; i++) values.add(i);
    } else {
      values.add(parseInt(part, 10));
    }
  }

  return Array.from(values).filter(v => v >= min && v <= max).sort((a, b) => a - b);
}

function getNextCronTime(fields: CronFields, after: Date = new Date()): Date {
  const next = new Date(after);
  next.setSeconds(0, 0);
  next.setMinutes(next.getMinutes() + 1);

  for (let iteration = 0; iteration < 366 * 24 * 60; iteration++) {
    const month = next.getMonth() + 1;
    const dayOfMonth = next.getDate();
    const dayOfWeek = next.getDay();
    const hour = next.getHours();
    const minute = next.getMinutes();

    if (
      fields.month.includes(month) &&
      fields.dayOfMonth.includes(dayOfMonth) &&
      fields.dayOfWeek.includes(dayOfWeek) &&
      fields.hour.includes(hour) &&
      fields.minute.includes(minute)
    ) {
      return next;
    }

    next.setMinutes(next.getMinutes() + 1);
  }

  throw new Error('Could not find next cron time within a year');
}

// ============================================================================
// Cron Scheduler
// ============================================================================

export class CronScheduler extends EventEmitter {
  private config: CronSchedulerConfig;
  private jobs: Map<string, CronJob> = new Map();
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private tickTimer: NodeJS.Timeout | null = null;
  private running: boolean = false;
  private taskExecutor?: (job: CronJob) => Promise<unknown>;

  constructor(config: Partial<CronSchedulerConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CRON_SCHEDULER_CONFIG, ...config };
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  /**
   * Set the task executor (for CronAgentBridge integration)
   */
  setTaskExecutor(executor: (job: CronJob) => Promise<unknown>): void {
    this.taskExecutor = executor;
  }

  async start(taskExecutor?: (job: CronJob) => Promise<unknown>): Promise<void> {
    if (this.running) return;

    if (taskExecutor) this.taskExecutor = taskExecutor;

    // Ensure directories exist
    await fs.mkdir(path.dirname(this.config.persistPath), { recursive: true });
    await fs.mkdir(this.config.historyPath, { recursive: true });

    // Load persisted jobs
    await this.loadJobs();

    // Schedule all active jobs
    for (const job of this.jobs.values()) {
      if (job.enabled && job.status === 'active') {
        this.scheduleJob(job);
      }
    }

    // Start tick timer for cron jobs
    this.tickTimer = setInterval(() => this.tick(), this.config.tickIntervalMs);
    this.running = true;
  }

  async stop(): Promise<void> {
    if (!this.running) return;

    // Stop tick timer
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }

    // Clear all timers
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();

    // Persist jobs
    await this.persistJobs();

    this.running = false;
  }

  // ==========================================================================
  // Job Management
  // ==========================================================================

  /**
   * Add a new job
   */
  async addJob(params: {
    name: string;
    description?: string;
    type: ScheduleType;
    schedule: CronJob['schedule'];
    task: CronJob['task'];
    delivery?: CronJob['delivery'];
    maxRuns?: number;
    enabled?: boolean;
  }): Promise<CronJob> {
    const id = crypto.randomUUID();
    const now = new Date();

    const job: CronJob = {
      id,
      name: params.name,
      description: params.description,
      type: params.type,
      schedule: params.schedule,
      task: params.task,
      delivery: params.delivery,
      status: 'active',
      createdAt: now,
      runCount: 0,
      errorCount: 0,
      maxRuns: params.maxRuns,
      enabled: params.enabled ?? true,
    };

    // Calculate next run
    job.nextRunAt = this.calculateNextRun(job);

    this.jobs.set(id, job);
    await this.persistJobs();

    if (job.enabled && this.running) {
      this.scheduleJob(job);
    }

    this.emit('job:created', job);
    return job;
  }

  /**
   * Update a job
   */
  async updateJob(
    jobId: string,
    updates: Partial<Pick<CronJob, 'name' | 'description' | 'schedule' | 'task' | 'delivery' | 'maxRuns' | 'enabled'>>
  ): Promise<CronJob | null> {
    const job = this.jobs.get(jobId);
    if (!job) return null;

    // Cancel existing timer
    this.cancelJobTimer(jobId);

    // Apply updates
    Object.assign(job, updates);

    // Recalculate next run
    job.nextRunAt = this.calculateNextRun(job);

    // Reschedule if enabled
    if (job.enabled && this.running) {
      this.scheduleJob(job);
    }

    await this.persistJobs();
    this.emit('job:updated', job);
    return job;
  }

  /**
   * Remove a job
   */
  async removeJob(jobId: string): Promise<boolean> {
    if (!this.jobs.has(jobId)) return false;

    this.cancelJobTimer(jobId);
    this.jobs.delete(jobId);
    await this.persistJobs();

    this.emit('job:deleted', jobId);
    return true;
  }

  /**
   * Get a job by ID
   */
  getJob(jobId: string): CronJob | undefined {
    return this.jobs.get(jobId);
  }

  /**
   * List all jobs
   */
  listJobs(params: {
    status?: JobStatus;
    type?: ScheduleType;
    enabled?: boolean;
  } = {}): CronJob[] {
    let jobs = Array.from(this.jobs.values());

    if (params.status !== undefined) {
      jobs = jobs.filter(j => j.status === params.status);
    }
    if (params.type !== undefined) {
      jobs = jobs.filter(j => j.type === params.type);
    }
    if (params.enabled !== undefined) {
      jobs = jobs.filter(j => j.enabled === params.enabled);
    }

    return jobs.sort((a, b) => (a.nextRunAt?.getTime() ?? 0) - (b.nextRunAt?.getTime() ?? 0));
  }

  /**
   * Pause a job
   */
  async pauseJob(jobId: string): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!job) return false;

    this.cancelJobTimer(jobId);
    job.status = 'paused';
    job.enabled = false;
    await this.persistJobs();

    this.emit('job:updated', job);
    return true;
  }

  /**
   * Resume a job
   */
  async resumeJob(jobId: string): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!job) return false;

    job.status = 'active';
    job.enabled = true;
    job.nextRunAt = this.calculateNextRun(job);

    if (this.running) {
      this.scheduleJob(job);
    }

    await this.persistJobs();
    this.emit('job:updated', job);
    return true;
  }

  /**
   * Run a job immediately
   */
  async runJobNow(jobId: string): Promise<JobRun | null> {
    const job = this.jobs.get(jobId);
    if (!job) return null;

    return await this.executeJob(job);
  }

  // ==========================================================================
  // Scheduling
  // ==========================================================================

  private scheduleJob(job: CronJob): void {
    // Cancel any existing timer
    this.cancelJobTimer(job.id);

    const nextRun = this.calculateNextRun(job);
    if (!nextRun) return;

    job.nextRunAt = nextRun;
    const delay = nextRun.getTime() - Date.now();

    if (delay <= 0) {
      // Run immediately
      this.executeJob(job).catch(err => this.emit('error', err));
      return;
    }

    // For 'at' and 'every' types, use setTimeout directly
    if (job.type === 'at' || job.type === 'every') {
      const timer = setTimeout(async () => {
        await this.executeJob(job);
        // For 'every' type, reschedule
        if (job.type === 'every' && job.enabled && job.status === 'active') {
          this.scheduleJob(job);
        }
      }, Math.min(delay, 2147483647)); // setTimeout max

      this.timers.set(job.id, timer);
    }
    // For 'cron' type, we use the tick mechanism
  }

  private cancelJobTimer(jobId: string): void {
    const timer = this.timers.get(jobId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(jobId);
    }
  }

  private calculateNextRun(job: CronJob): Date | undefined {
    const now = new Date();

    switch (job.type) {
      case 'at':
        if (!job.schedule.at) return undefined;
        const atTime = new Date(job.schedule.at);
        return atTime > now ? atTime : undefined;

      case 'every':
        if (!job.schedule.every) return undefined;
        const lastRun = job.lastRunAt || job.createdAt;
        return new Date(lastRun.getTime() + job.schedule.every);

      case 'cron':
        if (!job.schedule.cron) return undefined;
        try {
          const fields = parseCronExpression(job.schedule.cron);
          return getNextCronTime(fields, now);
        } catch {
          return undefined;
        }

      default:
        return undefined;
    }
  }

  // ==========================================================================
  // Execution
  // ==========================================================================

  private async executeJob(job: CronJob): Promise<JobRun> {
    const run: JobRun = {
      id: crypto.randomUUID(),
      jobId: job.id,
      startedAt: new Date(),
      status: 'running',
    };

    this.emit('job:run:start', run);

    try {
      // Execute task
      let result: unknown;

      if (this.taskExecutor) {
        result = await this.taskExecutor(job);
      } else {
        // Default execution (just log)
        result = { executed: true, task: job.task };
      }

      run.completedAt = new Date();
      run.status = 'success';
      run.result = result;
      run.duration = run.completedAt.getTime() - run.startedAt.getTime();

      job.lastRunAt = run.startedAt;
      job.runCount++;

      // Check max runs
      if (job.maxRuns !== undefined && job.runCount >= job.maxRuns) {
        job.status = 'completed';
        job.enabled = false;
      } else {
        // Calculate next run
        job.nextRunAt = this.calculateNextRun(job);
      }

      this.emit('job:run:complete', run);
    } catch (error) {
      run.completedAt = new Date();
      run.status = 'error';
      run.error = error instanceof Error ? error.message : String(error);
      run.duration = run.completedAt.getTime() - run.startedAt.getTime();

      job.lastRunAt = run.startedAt;
      job.errorCount++;
      job.lastError = run.error;

      this.emit('job:run:error', run, error instanceof Error ? error : new Error(String(error)));
    }

    // Save run history
    await this.saveRunHistory(run);
    await this.persistJobs();

    return run;
  }

  // ==========================================================================
  // Tick (for cron jobs)
  // ==========================================================================

  private async tick(): Promise<void> {
    const now = new Date();

    for (const job of this.jobs.values()) {
      if (
        job.type === 'cron' &&
        job.enabled &&
        job.status === 'active' &&
        job.nextRunAt &&
        job.nextRunAt <= now
      ) {
        // Execute and reschedule
        await this.executeJob(job);
        if (job.enabled && job.status === 'active') {
          job.nextRunAt = this.calculateNextRun(job);
        }
      }
    }
  }

  // ==========================================================================
  // Persistence
  // ==========================================================================

  private async loadJobs(): Promise<void> {
    try {
      const data = await fs.readFile(this.config.persistPath, 'utf-8');
      const persisted = JSON.parse(data) as CronJob[];

      for (const job of persisted) {
        job.createdAt = new Date(job.createdAt);
        if (job.lastRunAt) job.lastRunAt = new Date(job.lastRunAt);
        if (job.nextRunAt) job.nextRunAt = new Date(job.nextRunAt);
        this.jobs.set(job.id, job);
      }
    } catch (error) {
      // Warn if file exists but failed to parse (corruption vs missing file)
      try {
        await fs.access(this.config.persistPath);
        // File exists but failed to parse — likely corrupted
        this.emit('error', new Error(`Failed to load persisted jobs: ${error instanceof Error ? error.message : String(error)}`));
      } catch {
        // File doesn't exist — normal first run
      }
    }
  }

  private async persistJobs(): Promise<void> {
    try {
      const jobs = Array.from(this.jobs.values());
      await fs.writeFile(this.config.persistPath, JSON.stringify(jobs, null, 2));
    } catch (error) {
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
    }
  }

  private async saveRunHistory(run: JobRun): Promise<void> {
    try {
      const historyFile = path.join(this.config.historyPath, `${run.jobId}.jsonl`);

      // Append to JSONL
      await fs.appendFile(historyFile, JSON.stringify(run) + '\n');

      // Prune old entries
      await this.pruneRunHistory(run.jobId);
    } catch (error) {
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
    }
  }

  private async pruneRunHistory(jobId: string): Promise<void> {
    try {
      const historyFile = path.join(this.config.historyPath, `${jobId}.jsonl`);
      const data = await fs.readFile(historyFile, 'utf-8');
      const lines = data.trim().split('\n');

      if (lines.length > this.config.maxHistoryPerJob) {
        const pruned = lines.slice(-this.config.maxHistoryPerJob);
        await fs.writeFile(historyFile, pruned.join('\n') + '\n');
      }
    } catch {
      // Ignore errors during pruning
    }
  }

  /**
   * Get run history for a job
   */
  async getRunHistory(jobId: string, limit?: number): Promise<JobRun[]> {
    try {
      const historyFile = path.join(this.config.historyPath, `${jobId}.jsonl`);
      const data = await fs.readFile(historyFile, 'utf-8');
      const lines = data.trim().split('\n').filter(l => l);

      let runs = lines.map(line => {
        const run = JSON.parse(line) as JobRun;
        run.startedAt = new Date(run.startedAt);
        if (run.completedAt) run.completedAt = new Date(run.completedAt);
        return run;
      });

      // Sort by start time (most recent first)
      runs.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());

      if (limit !== undefined && limit > 0) {
        runs = runs.slice(0, limit);
      }

      return runs;
    } catch {
      return [];
    }
  }

  // ==========================================================================
  // Stats
  // ==========================================================================

  getStats(): {
    totalJobs: number;
    activeJobs: number;
    pausedJobs: number;
    completedJobs: number;
    byType: Record<ScheduleType, number>;
  } {
    const byType: Record<ScheduleType, number> = { at: 0, every: 0, cron: 0 };
    let activeJobs = 0;
    let pausedJobs = 0;
    let completedJobs = 0;

    for (const job of this.jobs.values()) {
      byType[job.type]++;
      if (job.status === 'active') activeJobs++;
      else if (job.status === 'paused') pausedJobs++;
      else if (job.status === 'completed') completedJobs++;
    }

    return {
      totalJobs: this.jobs.size,
      activeJobs,
      pausedJobs,
      completedJobs,
      byType,
    };
  }
}

// ============================================================================
// Singleton
// ============================================================================

let cronSchedulerInstance: CronScheduler | null = null;

export function getCronScheduler(config?: Partial<CronSchedulerConfig>): CronScheduler {
  if (!cronSchedulerInstance) {
    cronSchedulerInstance = new CronScheduler(config);
  }
  return cronSchedulerInstance;
}

export async function resetCronScheduler(): Promise<void> {
  if (cronSchedulerInstance) {
    await cronSchedulerInstance.stop();
  }
  cronSchedulerInstance = null;
}

export default CronScheduler;
