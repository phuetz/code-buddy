/**
 * Cron Scheduler
 *
 * Gateway-integrated job scheduler supporting:
 * - One-shot (at) - ISO 8601 timestamp
 * - Fixed intervals (every) - millisecond-based
 * - Cron expressions (cron) - 5-field syntax + timezone
 *
 * Advanced enterprise architecture for cron scheduling system.
 */

import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { homedir } from 'os';
import { logger } from '../utils/logger.js';
import { canonicalizeTimeZone } from '../life-rhythm/day-context.js';
import { findNextZonedMinute } from '../life-rhythm/zoned-minute.js';
import type { CronPreCheck } from './pre-check-runner.js';
import type { CronWatchdog } from './watchdog-handlers.js';

/** Exponential backoff delays in ms: 30s, 1m, 5m, 15m, 60m */
const BACKOFF_DELAYS_MS = [30_000, 60_000, 300_000, 900_000, 3_600_000];

/** Maximum chain depth to guard against cyclic `then` references (A→B→A). */
const MAX_CHAIN_DEPTH = 10;

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
    /**
     * Task type.
     * - `message`/`tool`/`agent` instantiate a CodeBuddyAgent (LLM-backed).
     * - `watchdog` runs a non-LLM monitor (disk/http/repo/build).
     * - `script` runs a bounded allowlisted command WITHOUT an agent.
     * - `skill` loads a named skill from the SkillsHub/registry and runs it
     *   WITHOUT instantiating the full agent loop.
     */
    type: 'message' | 'tool' | 'agent' | 'watchdog' | 'script' | 'skill';
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
    /** Watchdog config (for watchdog type) — disk/http/repo/build checks. */
    watchdog?: CronWatchdog;
    /**
     * Script command (for `script` type) — spawned without a shell, with an
     * executable allowlist and a bounded timeout. No agent, no provider call.
     */
    command?: {
      executable: string;
      args?: string[];
      cwd?: string;
      /** Extra allowed executables (basename match), merged with defaults. */
      allowedExecutables?: string[];
      /** Command timeout in ms (default 600000, clamped). */
      timeoutMs?: number;
    };
    /** Skill name to load and execute (for `skill` type). */
    skill?: string;
    /** Optional request string passed to the skill executor as `request`. */
    skillRequest?: string;
  };
  /**
   * Optional non-LLM pre-check. When present, it is evaluated before the task;
   * if it decides nothing changed, the expensive task is skipped with evidence.
   * `lastFingerprint` is updated and persisted across runs by the bridge.
   */
  preCheck?: CronPreCheck;
  /** Delivery options */
  delivery?: {
    /** Delivery mode: 'channel' (default), 'webhook', or 'none' (silent, no notification) */
    mode?: 'channel' | 'webhook' | 'none';
    /** Channel to deliver to (single, kept for backward compatibility) */
    channel?: string;
    /** Multiple `type:id` channel targets for fan-out delivery */
    targets?: string[];
    /** Body format: 'full' (default) or mobile-safe 'summary' (redacted + truncated) */
    format?: 'full' | 'summary';
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
  /** Random stagger in milliseconds added to scheduled time (spreads load for concurrent jobs) */
  staggerMs?: number;
  /** Current backoff level (0 = no backoff) — incremented on error, reset on success */
  backoffLevel?: number;
  /** Next retry time when in backoff state */
  nextRetryAt?: Date;
  /** Enabled flag */
  enabled: boolean;
  /** Session target: 'current' binds to creating session, 'new' creates fresh session, or specific session ID */
  sessionTarget?: 'current' | 'new' | string;
  /** Resolved session ID (populated when sessionTarget='current' at creation time) */
  resolvedSessionId?: string;
  /**
   * Chained job: when this job completes successfully, the job whose id (or id
   * prefix) matches `then` is enqueued for immediate execution. Validated at
   * execution time (the target need not exist when this job is created).
   */
  then?: string;
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
  /** Structured output from this job run, passed as inputData to chained jobs. */
  outputData?: string;
  /** Input data received from a parent job in a chain. */
  inputData?: string;
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

const DEFAULT_CRON_ROOT = process.env.CODEBUDDY_CRON_HOME
  ? path.resolve(process.env.CODEBUDDY_CRON_HOME)
  : path.join(homedir(), '.codebuddy', 'cron');

export const DEFAULT_CRON_SCHEDULER_CONFIG: CronSchedulerConfig = {
  persistPath: path.join(DEFAULT_CRON_ROOT, 'jobs.json'),
  historyPath: path.join(DEFAULT_CRON_ROOT, 'runs'),
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
  const [minuteField, hourField, domField, monthField, dowField] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];

  const fields = {
    minute: parseField(minuteField, 0, 59),
    hour: parseField(hourField, 0, 23),
    dayOfMonth: parseField(domField, 1, 31),
    month: parseField(monthField, 1, 12),
    dayOfWeek: parseField(dowField, 0, 6),
  };
  if (Object.values(fields).some((field) => field.length === 0)) {
    throw new Error(`Invalid cron expression: one or more fields contain no valid value (${expr})`);
  }
  return fields;
}

function parseField(field: string, min: number, max: number): number[] {
  const values: Set<number> = new Set();

  for (const part of field.split(',')) {
    if (part === '*') {
      for (let i = min; i <= max; i++) values.add(i);
    } else if (part.includes('/')) {
      const [range = '', stepStr] = part.split('/');
      const step = stepStr === undefined ? NaN : parseInt(stepStr, 10);
      if (!Number.isFinite(step) || step <= 0) continue;
      let start = min;
      let end = max;

      if (range !== '*') {
        if (range.includes('-')) {
          const [s, e] = range.split('-').map(n => parseInt(n, 10));
          start = s ?? NaN;
          end = e ?? NaN;
        } else {
          start = parseInt(range, 10);
        }
      }

      for (let i = start; i <= end; i += step) values.add(i);
    } else if (part.includes('-')) {
      const [start, end] = part.split('-').map(n => parseInt(n, 10));
      for (let i = start ?? NaN; i <= (end ?? NaN); i++) values.add(i);
    } else {
      values.add(parseInt(part, 10));
    }
  }

  return Array.from(values).filter(v => v >= min && v <= max).sort((a, b) => a - b);
}

interface ZonedCronParts {
  localDate: string;
  minute: number;
  hour: number;
  dayOfMonth: number;
  month: number;
  dayOfWeek: number;
}

const CRON_WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};
const cronFormatterCache = new Map<string, Intl.DateTimeFormat>();

function cronFormatter(timezone: string): Intl.DateTimeFormat {
  let formatter = cronFormatterCache.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA-u-ca-iso8601-nu-latn', {
      timeZone: timezone,
      calendar: 'iso8601',
      numberingSystem: 'latn',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    cronFormatterCache.set(timezone, formatter);
  }
  return formatter;
}

function zonedCronParts(date: Date, timezone?: string): ZonedCronParts {
  if (!timezone) {
    return {
      localDate: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
      minute: date.getMinutes(),
      hour: date.getHours(),
      dayOfMonth: date.getDate(),
      month: date.getMonth() + 1,
      dayOfWeek: date.getDay(),
    };
  }

  const values = new Map(
    cronFormatter(timezone).formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );
  const year = Number(values.get('year'));
  const month = Number(values.get('month'));
  const dayOfMonth = Number(values.get('day'));
  const hour = Number(values.get('hour'));
  const minute = Number(values.get('minute'));
  const dayOfWeek = CRON_WEEKDAY_INDEX[values.get('weekday') ?? ''];
  if ([year, month, dayOfMonth, hour, minute, dayOfWeek].some((value) => !Number.isInteger(value))) {
    throw new Error(`Unable to resolve cron civil time in ${timezone}`);
  }
  return {
    localDate: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(dayOfMonth).padStart(2, '0')}`,
    minute,
    hour,
    dayOfMonth,
    month,
    dayOfWeek: dayOfWeek!,
  };
}

function localMinuteKey(parts: ZonedCronParts): string {
  return `${parts.localDate}T${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
}

function isUnrestrictedDaily(fields: CronFields): boolean {
  return fields.dayOfMonth.length === 31
    && fields.month.length === 12
    && fields.dayOfWeek.length === 7;
}

function getNextCronTime(
  fields: CronFields,
  after: Date = new Date(),
  timezone?: string,
  previousLocalMinute?: string
): Date {
  const canonicalTimeZone = timezone ? canonicalizeTimeZone(timezone) : undefined;
  const dailyCandidates = fields.hour.length * fields.minute.length;
  if (canonicalTimeZone && isUnrestrictedDaily(fields) && dailyCandidates <= 64) {
    const candidates = fields.hour.flatMap((hour) => fields.minute.map((minute) => (
      findNextZonedMinute(after, canonicalTimeZone, hour, minute).instant
    ))).filter((candidate) => (
      localMinuteKey(zonedCronParts(candidate, canonicalTimeZone)) !== previousLocalMinute
    ));
    candidates.sort((left, right) => left.getTime() - right.getTime());
    if (candidates[0]) return candidates[0];
  }
  const next = new Date(after);
  next.setUTCSeconds(0, 0);
  next.setUTCMinutes(next.getUTCMinutes() + 1);

  for (let iteration = 0; iteration < 366 * 24 * 60; iteration++) {
    const parts = zonedCronParts(next, canonicalTimeZone);
    const { month, dayOfMonth, dayOfWeek, hour, minute } = parts;

    if (
      fields.month.includes(month) &&
      fields.dayOfMonth.includes(dayOfMonth) &&
      fields.dayOfWeek.includes(dayOfWeek) &&
      fields.hour.includes(hour) &&
      fields.minute.includes(minute) &&
      localMinuteKey(parts) !== previousLocalMinute
    ) {
      return next;
    }

    next.setUTCMinutes(next.getUTCMinutes() + 1);
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
  private tickInFlight = false;
  private running: boolean = false;
  private taskExecutor?: (job: CronJob, inputData?: string) => Promise<unknown>;

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
  setTaskExecutor(executor: (job: CronJob, inputData?: string) => Promise<unknown>): void {
    this.taskExecutor = executor;
  }

  /**
   * Load persisted jobs into memory without starting the tick loop. Useful for
   * one-shot CLI commands (`buddy cron list/add/remove`) that must see the
   * existing job set before mutating it — otherwise a subsequent persist would
   * overwrite the file with only the in-memory jobs.
   */
  async loadFromDisk(): Promise<void> {
    if (this.jobs.size > 0) return;
    await fs.mkdir(path.dirname(this.config.persistPath), { recursive: true });
    await this.loadJobs();
  }

  async start(taskExecutor?: (job: CronJob, inputData?: string) => Promise<unknown>): Promise<void> {
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
    this.tickTimer = setInterval(() => {
      void this.tick().catch((error) => this.emit('error', error));
    }, this.config.tickIntervalMs);
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
    staggerMs?: number;
    enabled?: boolean;
    sessionTarget?: CronJob['sessionTarget'];
    preCheck?: CronJob['preCheck'];
    then?: string;
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
      staggerMs: params.staggerMs,
      enabled: params.enabled ?? true,
      sessionTarget: params.sessionTarget,
      preCheck: params.preCheck,
      then: params.then,
    };

    // Resolve 'current' session target to concrete session ID at creation time
    if (job.sessionTarget === 'current') {
      job.resolvedSessionId = job.delivery?.sessionKey || `session-${Date.now()}`;
    }

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
    updates: Partial<Pick<CronJob, 'name' | 'description' | 'type' | 'schedule' | 'task' | 'delivery' | 'maxRuns' | 'enabled' | 'preCheck' | 'then'>>
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
  async runJobNow(jobId: string, inputData?: string): Promise<JobRun | null> {
    const job = this.jobs.get(jobId);
    if (!job) return null;

    return await this.executeJob(job, 0, inputData);
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

    // Apply stagger jitter to spread load (Standard pattern)
    const stagger = job.staggerMs ? Math.floor(Math.random() * job.staggerMs) : 0;
    const jitteredDelay = delay + stagger;

    // For 'at' and 'every' types, use setTimeout directly
    if (job.type === 'at' || job.type === 'every') {
      const timer = setTimeout(async () => {
        await this.executeJob(job);
        // For 'every' type, reschedule
        if (job.type === 'every' && job.enabled && job.status === 'active') {
          this.scheduleJob(job);
        }
      }, Math.min(jitteredDelay, 2147483647)); // setTimeout max

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
          const zone = job.schedule.timezone || this.config.defaultTimezone;
          const previousLocalMinute = job.lastRunAt
            ? localMinuteKey(zonedCronParts(job.lastRunAt, canonicalizeTimeZone(zone)))
            : undefined;
          return getNextCronTime(
            fields,
            now,
            zone,
            previousLocalMinute
          );
        } catch (error) {
          job.status = 'error';
          job.lastError = `Invalid or unschedulable cron: ${error instanceof Error ? error.message : String(error)}`;
          logger.warn('Cron job could not be scheduled', {
            jobId: job.id,
            cron: job.schedule.cron,
            timezone: job.schedule.timezone || this.config.defaultTimezone,
            error: job.lastError,
          });
          return undefined;
        }

      default:
        return undefined;
    }
  }

  // ==========================================================================
  // Execution
  // ==========================================================================

  private async executeJob(job: CronJob, chainDepth = 0, inputData?: string): Promise<JobRun> {
    const run: JobRun = {
      id: crypto.randomUUID(),
      jobId: job.id,
      startedAt: new Date(),
      status: 'running',
      ...(inputData !== undefined ? { inputData } : {}),
    };

    this.emit('job:run:start', run);

    try {
      // Execute task
      let result: unknown;

      if (this.taskExecutor) {
        result = await this.taskExecutor(job, inputData);
      } else {
        // Default execution (just log)
        result = { executed: true, task: job.task };
      }

      run.completedAt = new Date();
      run.status = 'success';
      run.result = result;
      run.duration = run.completedAt.getTime() - run.startedAt.getTime();

      // Extract outputData from the executor result for cross-job data passing.
      // The executor may return an object with an `output` or `outputData`
      // field; we cap at 64KB to keep run history manageable.
      run.outputData = CronScheduler.extractOutputData(result);

      job.lastRunAt = run.startedAt;
      job.runCount++;

      // Reset backoff on success
      if (job.backoffLevel && job.backoffLevel > 0) {
        job.backoffLevel = 0;
        job.nextRetryAt = undefined;
      }

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

      // Exponential backoff: increment level, cap at max
      job.backoffLevel = Math.min((job.backoffLevel ?? 0) + 1, BACKOFF_DELAYS_MS.length - 1);
      // backoffLevel is clamped to [0, length-1] above, so the indexed delay is
      // always defined; fall back to the maximum delay (the cap) just in case.
      const backoffMs =
        BACKOFF_DELAYS_MS[job.backoffLevel] ?? BACKOFF_DELAYS_MS[BACKOFF_DELAYS_MS.length - 1] ?? 3_600_000;
      job.nextRetryAt = new Date(Date.now() + backoffMs);
      job.nextRunAt = job.nextRetryAt;

      this.emit('job:run:error', run, error instanceof Error ? error : new Error(String(error)));
    }

    // Save run history
    await this.saveRunHistory(run);
    await this.persistJobs();

    // Chained jobs: on success only, after this run is fully persisted, run the
    // `then` target. A chained failure must never bubble out of the parent's
    // successful run, so the chain runs inside a guarded helper that swallows
    // (and logs) any error from the chained job.
    if (run.status === 'success' && job.then) {
      await this.runChainedJob(job, chainDepth, run.outputData);
    }

    return run;
  }

  /** Max bytes for outputData passed between chained jobs. */
  private static readonly MAX_OUTPUT_DATA_BYTES = 65_536; // 64 KiB

  /**
   * Extract a string `outputData` from the executor result. Looks for an
   * explicit `outputData` field first, then falls back to `output`, then
   * stringifies the whole result. Always capped at 64KB.
   */
  static extractOutputData(result: unknown): string | undefined {
    if (result == null) return undefined;

    let raw: string | undefined;

    if (typeof result === 'string') {
      raw = result;
    } else if (typeof result === 'object') {
      const obj = result as Record<string, unknown>;
      if (typeof obj.outputData === 'string') {
        raw = obj.outputData;
      } else if (typeof obj.output === 'string') {
        raw = obj.output;
      } else {
        try {
          raw = JSON.stringify(result);
        } catch {
          return undefined;
        }
      }
    } else {
      raw = String(result);
    }

    if (!raw || raw.length === 0) return undefined;
    return raw.length > CronScheduler.MAX_OUTPUT_DATA_BYTES
      ? raw.slice(0, CronScheduler.MAX_OUTPUT_DATA_BYTES)
      : raw;
  }

  /**
   * Resolve and execute a chained (`then`) job after its parent succeeds.
   *
   * Validation happens here (not at creation) because chain targets may be
   * authored out of order. A missing/disabled target, a self-reference, or a
   * depth-cap breach is logged and stops the chain — it never throws.
   */
  private async runChainedJob(parent: CronJob, chainDepth: number, outputData?: string): Promise<void> {
    const target = parent.then;
    if (!target) return;

    if (chainDepth >= MAX_CHAIN_DEPTH) {
      logger.warn('Cron chain depth cap reached — stopping chain', {
        jobId: parent.id,
        then: target,
        chainDepth,
        maxChainDepth: MAX_CHAIN_DEPTH,
      });
      return;
    }

    const next = this.resolveChainTarget(target);
    if (!next) {
      logger.warn('Cron chained job target not found — stopping chain', {
        jobId: parent.id,
        then: target,
      });
      return;
    }
    if (next.id === parent.id) {
      logger.warn('Cron chained job points at itself — stopping chain', {
        jobId: parent.id,
        then: target,
      });
      return;
    }
    if (!next.enabled || next.status === 'paused') {
      logger.debug('Cron chained job target is disabled/paused — skipping chain', {
        jobId: parent.id,
        then: target,
        targetId: next.id,
        targetStatus: next.status,
      });
      return;
    }

    try {
      // Pass the parent job's outputData as the chained job's inputData.
      await this.executeJob(next, chainDepth + 1, outputData);
    } catch (err) {
      // A chained failure is captured in the chained job's own run record; it
      // must not fail the parent's already-successful run.
      logger.warn('Cron chained job failed', {
        jobId: parent.id,
        targetId: next.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Resolve a `then` reference by exact id, then by unique id prefix.
   */
  private resolveChainTarget(idOrPrefix: string): CronJob | undefined {
    const exact = this.jobs.get(idOrPrefix);
    if (exact) return exact;

    const prefixMatches = Array.from(this.jobs.values()).filter((job) =>
      job.id.startsWith(idOrPrefix),
    );
    return prefixMatches.length === 1 ? prefixMatches[0] : undefined;
  }

  // ==========================================================================
  // Tick (for cron jobs)
  // ==========================================================================

  private async tick(): Promise<void> {
    if (this.tickInFlight) return;
    this.tickInFlight = true;
    const now = new Date();
    try {
      for (const job of this.jobs.values()) {
        if (
          job.type === 'cron' &&
          job.enabled &&
          job.status === 'active' &&
          job.nextRunAt &&
          job.nextRunAt <= now
        ) {
          await this.executeJob(job);
          if (job.enabled && job.status === 'active') {
            job.nextRunAt = this.calculateNextRun(job);
          }
        }
      }
    } finally {
      this.tickInFlight = false;
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
      // Ensure the persist directory exists — addJob can be called before
      // start() (e.g. from the `buddy cron` CLI), which would otherwise fail.
      await fs.mkdir(path.dirname(this.config.persistPath), { recursive: true });
      const jobs = Array.from(this.jobs.values());
      await fs.writeFile(this.config.persistPath, JSON.stringify(jobs, null, 2));
    } catch (error) {
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
    }
  }

  private async saveRunHistory(run: JobRun): Promise<void> {
    try {
      await fs.mkdir(this.config.historyPath, { recursive: true });
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
