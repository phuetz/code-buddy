import { buildCronJobSpec, type CronAddOptions } from '../commands/cron-cli/index.js';
import { getErrorMessage, type ToolResult } from '../types/index.js';
import type { CronJob, CronScheduler } from '../scheduler/cron-scheduler.js';

export type CronjobAction = 'list' | 'show' | 'create' | 'pause' | 'resume' | 'run' | 'remove';

export interface CronjobToolInput extends Record<string, unknown> {
  action?: unknown;
  id?: unknown;
  name?: unknown;
  every?: unknown;
  cron?: unknown;
  at?: unknown;
  message?: unknown;
  watchdog?: unknown;
  command?: unknown;
  skill?: unknown;
  skillRequest?: unknown;
  then?: unknown;
  preCheck?: unknown;
  continuity?: unknown;
  deliver?: unknown;
  format?: unknown;
}

const CRONJOB_ACTIONS = new Set<CronjobAction>([
  'list',
  'show',
  'create',
  'pause',
  'resume',
  'run',
  'remove',
]);

async function getLoadedCronScheduler(): Promise<CronScheduler> {
  const { getCronScheduler } = await import('../scheduler/cron-scheduler.js');
  const scheduler = getCronScheduler();
  await scheduler.loadFromDisk();
  return scheduler;
}

function normalizeString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function normalizeNumberishString(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return normalizeString(value);
}

function normalizeJsonOption(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function normalizeDeliver(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string') return [value];
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === 'string');
}

function buildCreateOptions(input: CronjobToolInput): CronAddOptions {
  return {
    every: normalizeNumberishString(input.every),
    cron: normalizeString(input.cron),
    at: normalizeString(input.at),
    message: normalizeString(input.message),
    watchdog: normalizeJsonOption(input.watchdog),
    script: normalizeJsonOption(input.command),
    skill: normalizeString(input.skill),
    skillRequest: normalizeString(input.skillRequest),
    then: normalizeString(input.then),
    preCheck: normalizeJsonOption(input.preCheck),
    continuity: normalizeJsonOption(input.continuity),
    deliver: normalizeDeliver(input.deliver),
    format: normalizeString(input.format),
  };
}

function serializePayload(payload: Record<string, unknown>): ToolResult {
  return {
    success: true,
    output: JSON.stringify(payload, null, 2),
    data: payload,
  };
}

function parseAction(value: unknown): CronjobAction | undefined {
  if (typeof value !== 'string') return undefined;
  return CRONJOB_ACTIONS.has(value as CronjobAction) ? (value as CronjobAction) : undefined;
}

function requireId(input: CronjobToolInput, action: CronjobAction): string | ToolResult {
  if (typeof input.id !== 'string' || input.id.trim().length === 0) {
    return { success: false, error: `cronjob: id is required for action "${action}"` };
  }
  return input.id.trim();
}

function findCronJob(jobs: CronJob[], idOrPrefix: string): CronJob | ToolResult {
  const exact = jobs.find((job) => job.id === idOrPrefix);
  if (exact) return exact;

  const prefixMatches = jobs.filter((job) => job.id.startsWith(idOrPrefix));
  if (prefixMatches.length === 0) {
    return { success: false, error: `cronjob: job not found: ${idOrPrefix}` };
  }
  if (prefixMatches.length > 1) {
    return {
      success: false,
      error: `cronjob: id prefix "${idOrPrefix}" is ambiguous (${prefixMatches.length} matches)`,
    };
  }
  return prefixMatches[0] as CronJob;
}

function isToolResult(value: CronJob | string | ToolResult): value is ToolResult {
  return typeof value === 'object' && value !== null && 'success' in value;
}

async function getTargetJob(
  scheduler: CronScheduler,
  input: CronjobToolInput,
  action: CronjobAction,
): Promise<CronJob | ToolResult> {
  const id = requireId(input, action);
  if (isToolResult(id)) return id;
  return findCronJob(scheduler.listJobs(), id);
}

export async function executeCronjobTool(input: CronjobToolInput): Promise<ToolResult> {
  const action = parseAction(input.action);
  if (!action) {
    return {
      success: false,
      error: `cronjob: action must be one of ${[...CRONJOB_ACTIONS].join(', ')}`,
    };
  }

  try {
    const scheduler = await getLoadedCronScheduler();

    if (action === 'list') {
      const jobs = scheduler.listJobs();
      return serializePayload({ action, count: jobs.length, jobs });
    }

    if (action === 'create') {
      const name = normalizeString(input.name) ?? '';
      const specResult = buildCronJobSpec(name, buildCreateOptions(input));
      if ('error' in specResult) {
        return { success: false, error: specResult.error };
      }
      const job = await scheduler.addJob(specResult.spec);
      return serializePayload({ action, job });
    }

    const job = await getTargetJob(scheduler, input, action);
    if (isToolResult(job)) return job;

    if (action === 'show') {
      return serializePayload({ action, job });
    }

    if (action === 'pause') {
      await scheduler.pauseJob(job.id);
      return serializePayload({ action, job: scheduler.getJob(job.id) ?? job });
    }

    if (action === 'resume') {
      await scheduler.resumeJob(job.id);
      return serializePayload({ action, job: scheduler.getJob(job.id) ?? job });
    }

    if (action === 'run') {
      const run = await scheduler.runJobNow(job.id);
      if (!run) {
        return { success: false, error: `cronjob: job not found: ${job.id}` };
      }
      const payload = { action, job: scheduler.getJob(job.id) ?? job, run };
      if (run.status === 'error') {
        return {
          success: false,
          error: run.error ?? 'cronjob: run failed',
          output: JSON.stringify(payload, null, 2),
          data: payload,
        };
      }
      return serializePayload(payload);
    }

    await scheduler.removeJob(job.id);
    return serializePayload({ action, job });
  } catch (error) {
    return { success: false, error: `cronjob: ${getErrorMessage(error)}` };
  }
}
