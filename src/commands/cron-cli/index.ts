/**
 * `buddy cron` — author and manage scheduled cron jobs from the CLI.
 *
 * Hermes Agent exposes `hermes cron` for unattended scheduled work. Code
 * Buddy's CronScheduler previously had no user-facing authoring surface — jobs
 * could only be created programmatically. This wires the scheduler's job model
 * (including the new `watchdog` task type and `preCheck` gate) to the CLI:
 *
 *   buddy cron list [--json]
 *   buddy cron show <id> [--json]
 *   buddy cron pause <id> [--json]
 *   buddy cron resume <id> [--json]
 *   buddy cron run <id> [--json]
 *   buddy cron remove <id>
 *   buddy cron add <name> --every <ms>|--cron <expr>|--at <iso>
 *        [--message <text>] [--watchdog <json|@file>] [--pre-check <json|@file>]
 *        [--deliver <type:id>...] [--format full|summary]
 *
 * The job-spec construction is a pure, tested helper (`buildCronJobSpec`); the
 * Commander actions stay thin wrappers around the scheduler singleton.
 */

import * as fs from 'fs';
import type { Command } from 'commander';
import type { CronJob, CronScheduler, ScheduleType } from '../../scheduler/cron-scheduler.js';

export interface CronAddOptions {
  every?: string;
  cron?: string;
  at?: string;
  message?: string;
  watchdog?: string;
  preCheck?: string;
  deliver?: string[];
  format?: string;
}

export interface CronJobSpec {
  name: string;
  type: ScheduleType;
  schedule: CronJob['schedule'];
  task: CronJob['task'];
  delivery?: CronJob['delivery'];
  preCheck?: CronJob['preCheck'];
}

export type CronJobSpecResult = { spec: CronJobSpec } | { error: string };

/**
 * Build (and validate) a CronJob spec from CLI options. Pure: no side effects,
 * fully unit-testable. Returns either a spec or a human-readable error.
 */
export function buildCronJobSpec(name: string, opts: CronAddOptions): CronJobSpecResult {
  if (!name || !name.trim()) {
    return { error: 'cron add: a job name is required' };
  }

  // Exactly one schedule must be provided.
  const scheduleFlags = [opts.every, opts.cron, opts.at].filter((v) => v !== undefined);
  if (scheduleFlags.length === 0) {
    return { error: 'cron add: one of --every <ms>, --cron <expr> or --at <iso> is required' };
  }
  if (scheduleFlags.length > 1) {
    return { error: 'cron add: --every, --cron and --at are mutually exclusive' };
  }

  let type: ScheduleType;
  const schedule: CronJob['schedule'] = {};
  if (opts.every !== undefined) {
    const ms = Number(opts.every);
    if (!Number.isFinite(ms) || ms <= 0) {
      return { error: `cron add: --every must be a positive number of milliseconds (got "${opts.every}")` };
    }
    type = 'every';
    schedule.every = Math.trunc(ms);
  } else if (opts.cron !== undefined) {
    if (opts.cron.trim().split(/\s+/).length !== 5) {
      return { error: `cron add: --cron must be a 5-field expression (got "${opts.cron}")` };
    }
    type = 'cron';
    schedule.cron = opts.cron.trim();
  } else {
    const at = new Date(opts.at as string);
    if (Number.isNaN(at.getTime())) {
      return { error: `cron add: --at must be a valid ISO 8601 timestamp (got "${opts.at}")` };
    }
    type = 'at';
    schedule.at = at.toISOString();
  }

  // Task: watchdog when --watchdog is given, otherwise a message task.
  let task: CronJob['task'];
  if (opts.watchdog !== undefined) {
    const parsed = parseJsonOption(opts.watchdog, '--watchdog');
    if ('error' in parsed) return parsed;
    const watchdog = parsed.value as CronJob['task']['watchdog'];
    if (!watchdog || !Array.isArray(watchdog.checks) || watchdog.checks.length === 0) {
      return { error: '--watchdog config must include a non-empty "checks" array' };
    }
    task = { type: 'watchdog', watchdog };
  } else {
    if (!opts.message || !opts.message.trim()) {
      return { error: 'cron add: --message is required unless --watchdog is given' };
    }
    task = { type: 'message', message: opts.message };
  }

  const spec: CronJobSpec = { name: name.trim(), type, schedule, task };

  // Optional pre-check gate.
  if (opts.preCheck !== undefined) {
    const parsed = parseJsonOption(opts.preCheck, '--pre-check');
    if ('error' in parsed) return parsed;
    const preCheck = parsed.value as CronJob['preCheck'];
    if (!preCheck || (preCheck.type !== 'file_changed' && preCheck.type !== 'command')) {
      return { error: '--pre-check config must have type "file_changed" or "command"' };
    }
    spec.preCheck = preCheck;
  }

  // Optional delivery.
  const targets = (opts.deliver ?? []).filter((t) => typeof t === 'string' && t.trim().length > 0);
  const format = opts.format;
  if (targets.length > 0 || format) {
    if (format && format !== 'full' && format !== 'summary') {
      return { error: '--format must be "full" or "summary"' };
    }
    spec.delivery = {
      ...(targets.length > 0 ? { targets } : {}),
      ...(format === 'summary' || format === 'full' ? { format } : {}),
    };
  }

  return { spec };
}

function parseJsonOption(
  raw: string,
  flag: string,
): { value: unknown } | { error: string } {
  let text = raw;
  if (raw.startsWith('@')) {
    const filePath = raw.slice(1);
    try {
      text = fs.readFileSync(filePath, 'utf-8');
    } catch (err) {
      return { error: `${flag}: cannot read file ${filePath}: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
  try {
    return { value: JSON.parse(text) };
  } catch (err) {
    return { error: `${flag}: invalid JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
}

function collectOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}

async function getLoadedCronScheduler(): Promise<CronScheduler> {
  const { getCronScheduler } = await import('../../scheduler/cron-scheduler.js');
  const scheduler = getCronScheduler();
  await loadPersistedJobs(scheduler);
  return scheduler;
}

function findCronJob(jobs: CronJob[], id: string): CronJob | undefined {
  return jobs.find((j) => j.id === id || j.id.startsWith(id));
}

function requireCronJob(jobs: CronJob[], id: string): CronJob {
  const job = findCronJob(jobs, id);
  if (!job) {
    console.error(`Cron job not found: ${id}`);
    process.exit(1);
  }
  return job;
}

export function registerCronCommands(program: Command): void {
  const cron = program
    .command('cron')
    .description('Author and manage scheduled cron jobs (incl. watchdog + pre-check)');

  cron
    .command('list')
    .description('List scheduled cron jobs')
    .option('--json', 'output JSON')
    .action(async (opts: { json?: boolean }) => {
      const scheduler = await getLoadedCronScheduler();
      const jobs = scheduler.listJobs();
      if (opts.json) {
        console.log(JSON.stringify({ count: jobs.length, jobs }, null, 2));
        return;
      }
      if (jobs.length === 0) {
        console.log('No cron jobs. Use `buddy cron add` to create one.');
        return;
      }
      console.log(`\nCron jobs (${jobs.length}):`);
      for (const job of jobs) {
        const status = job.enabled ? '+' : '-';
        const next = job.nextRunAt ? new Date(job.nextRunAt).toISOString() : 'n/a';
        console.log(`  ${status} [${job.id.slice(0, 8)}] ${job.name}  (${job.task.type}, ${job.type})  next: ${next}`);
      }
      console.log('');
    });

  cron
    .command('show <id>')
    .description('Show one cron job')
    .option('--json', 'output JSON')
    .action(async (id: string, opts: { json?: boolean }) => {
      const scheduler = await getLoadedCronScheduler();
      const job = requireCronJob(scheduler.listJobs(), id);
      console.log(JSON.stringify(job, null, 2));
      if (!opts.json) { /* JSON is the readable form for a full job */ }
    });

  cron
    .command('pause <id>')
    .description('Pause a cron job by id (or id prefix)')
    .option('--json', 'output JSON')
    .action(async (id: string, opts: { json?: boolean }) => {
      const scheduler = await getLoadedCronScheduler();
      const job = requireCronJob(scheduler.listJobs(), id);
      await scheduler.pauseJob(job.id);
      const updated = scheduler.getJob(job.id) ?? job;
      if (opts.json) {
        console.log(JSON.stringify({ action: 'pause', job: updated }, null, 2));
        return;
      }
      console.log(`Cron job paused: [${updated.id.slice(0, 8)}] ${updated.name}`);
    });

  cron
    .command('resume <id>')
    .description('Resume a cron job by id (or id prefix)')
    .option('--json', 'output JSON')
    .action(async (id: string, opts: { json?: boolean }) => {
      const scheduler = await getLoadedCronScheduler();
      const job = requireCronJob(scheduler.listJobs(), id);
      await scheduler.resumeJob(job.id);
      const updated = scheduler.getJob(job.id) ?? job;
      if (opts.json) {
        console.log(JSON.stringify({ action: 'resume', job: updated }, null, 2));
        return;
      }
      console.log(`Cron job resumed: [${updated.id.slice(0, 8)}] ${updated.name}`);
    });

  cron
    .command('run <id>')
    .description('Run a cron job immediately by id (or id prefix)')
    .option('--json', 'output JSON')
    .action(async (id: string, opts: { json?: boolean }) => {
      const scheduler = await getLoadedCronScheduler();
      const job = requireCronJob(scheduler.listJobs(), id);
      const run = await scheduler.runJobNow(job.id);
      if (!run) {
        console.error(`Cron job not found: ${id}`);
        process.exit(1);
        return;
      }
      const updated = scheduler.getJob(job.id) ?? job;
      if (opts.json) {
        console.log(JSON.stringify({ action: 'run', job: updated, run }, null, 2));
        return;
      }
      const duration = run.duration !== undefined ? `${run.duration}ms` : 'n/a';
      console.log(`Cron job run completed: [${updated.id.slice(0, 8)}] ${updated.name} (${run.status}, ${duration})`);
      if (run.status === 'error') {
        process.exit(1);
      }
    });

  cron
    .command('add <name>')
    .description('Add a cron job (message or --watchdog), with optional --pre-check and --deliver')
    .option('--every <ms>', 'run every N milliseconds')
    .option('--cron <expr>', '5-field cron expression')
    .option('--at <iso>', 'run once at an ISO 8601 timestamp')
    .option('--message <text>', 'agent message to run (default task)')
    .option('--watchdog <json>', 'watchdog config as inline JSON or @file (no-LLM monitor)')
    .option('--pre-check <json>', 'pre-check gate as inline JSON or @file')
    .option('--deliver <target>', 'delivery target type:id (repeatable)', collectOption, [])
    .option('--format <fmt>', 'delivery body format: full|summary')
    .action(async (name: string, opts: CronAddOptions) => {
      const result = buildCronJobSpec(name, opts);
      if ('error' in result) {
        console.error(result.error);
        process.exit(1);
        return;
      }
      const scheduler = await getLoadedCronScheduler();
      const job = await scheduler.addJob(result.spec);
      console.log(`Cron job created: [${job.id.slice(0, 8)}] ${job.name} (${job.task.type}, ${job.type})`);
    });

  cron
    .command('remove <id>')
    .description('Remove a cron job by id (or id prefix)')
    .action(async (id: string) => {
      const scheduler = await getLoadedCronScheduler();
      const job = requireCronJob(scheduler.listJobs(), id);
      await scheduler.removeJob(job.id);
      console.log(`Cron job removed: [${job.id.slice(0, 8)}] ${job.name}`);
    });
}

/**
 * Load persisted jobs into the scheduler without starting its tick loop, so a
 * one-shot CLI command sees the existing job set before mutating it.
 */
async function loadPersistedJobs(
  scheduler: CronScheduler,
): Promise<void> {
  await scheduler.loadFromDisk();
}
