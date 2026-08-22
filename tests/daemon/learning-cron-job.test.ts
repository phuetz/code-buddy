import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { CronScheduler } from '../../src/scheduler/cron-scheduler.js';
import {
  DEFAULT_LEARNING_INTERVAL_MS,
  LEARNING_CRON_JOB_NAME,
  isLearningDaemonEnabled,
  registerLearningCronJob,
  resolveLearningIntervalMs,
} from '../../src/daemon/learning-cron-job.js';

let dir: string;
let scheduler: CronScheduler;
const savedEnv: Record<string, string | undefined> = {};
const ENV_KEYS = ['CODEBUDDY_LEARNING_DAEMON', 'CODEBUDDY_LEARNING_DAEMON_INTERVAL_MS'] as const;

describe('learning daemon cron job (S6)', () => {
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'learning-cron-'));
    scheduler = new CronScheduler({ persistPath: path.join(dir, 'jobs.json') });
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  });

  afterEach(async () => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('registers a bounded script job that runs `improve cycle --apply`, silently', async () => {
    const job = await registerLearningCronJob({
      scheduler,
      nodeExecutable: '/usr/bin/node',
      cliEntry: '/app/dist/index.js',
      intervalMs: 30 * 60 * 1000,
    });

    expect(job.name).toBe(LEARNING_CRON_JOB_NAME);
    expect(job.type).toBe('every');
    expect(job.schedule.every).toBe(30 * 60 * 1000);
    expect(job.task.type).toBe('script');
    expect(job.task.command).toMatchObject({
      executable: '/usr/bin/node',
      args: ['/app/dist/index.js', 'improve', 'cycle', '--apply'],
      allowedExecutables: ['node'],
    });
    expect(job.delivery?.mode).toBe('none');

    // Persisted to the isolated store.
    expect(scheduler.listJobs().filter((j) => j.name === LEARNING_CRON_JOB_NAME)).toHaveLength(1);
  });

  it('is idempotent across daemon restarts (no duplicate job)', async () => {
    const first = await registerLearningCronJob({ scheduler, cliEntry: '/app/dist/index.js' });
    const second = await registerLearningCronJob({ scheduler, cliEntry: '/app/dist/index.js' });

    expect(second.id).toBe(first.id);
    expect(scheduler.listJobs().filter((j) => j.name === LEARNING_CRON_JOB_NAME)).toHaveLength(1);
  });

  it('gates on CODEBUDDY_LEARNING_DAEMON and clamps the interval to the floor', () => {
    delete process.env.CODEBUDDY_LEARNING_DAEMON;
    expect(isLearningDaemonEnabled()).toBe(false);
    process.env.CODEBUDDY_LEARNING_DAEMON = 'true';
    expect(isLearningDaemonEnabled()).toBe(true);

    delete process.env.CODEBUDDY_LEARNING_DAEMON_INTERVAL_MS;
    expect(resolveLearningIntervalMs()).toBe(DEFAULT_LEARNING_INTERVAL_MS);

    process.env.CODEBUDDY_LEARNING_DAEMON_INTERVAL_MS = '1000'; // below the 5-min floor
    expect(resolveLearningIntervalMs()).toBe(5 * 60 * 1000);

    process.env.CODEBUDDY_LEARNING_DAEMON_INTERVAL_MS = String(2 * 60 * 60 * 1000);
    expect(resolveLearningIntervalMs()).toBe(2 * 60 * 60 * 1000);
  });
});
