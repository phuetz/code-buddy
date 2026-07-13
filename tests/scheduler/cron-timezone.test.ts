import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CronScheduler } from '../../src/scheduler/cron-scheduler.js';

describe('CronScheduler IANA timezone scheduling', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cron-timezone-'));
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(dir, { recursive: true, force: true });
  });

  function scheduler(): CronScheduler {
    return new CronScheduler({
      persistPath: join(dir, 'jobs.json'),
      historyPath: join(dir, 'runs'),
    });
  }

  it('projects a wall-clock cron time into Europe/Paris', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-12T00:00:00.000Z'));

    const job = await scheduler().addJob({
      name: 'Paris morning',
      type: 'cron',
      schedule: { cron: '0 4 * * *', timezone: 'Europe/Paris' },
      task: { type: 'message', message: 'Bonjour' },
    });

    expect(job.nextRunAt?.toISOString()).toBe('2026-07-12T02:00:00.000Z');
  });

  it('runs at the first valid local minute after the spring DST gap', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-29T00:30:00.000Z'));

    const job = await scheduler().addJob({
      name: 'Paris 02:30',
      type: 'cron',
      schedule: { cron: '30 2 * * *', timezone: 'Europe/Paris' },
      task: { type: 'message', message: 'Boundary' },
    });

    expect(job.nextRunAt?.toISOString()).toBe('2026-03-29T01:00:00.000Z');
  });

  it('uses the scheduler default timezone when a job omits one', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-12T00:00:00.000Z'));
    const custom = new CronScheduler({
      persistPath: join(dir, 'jobs.json'),
      historyPath: join(dir, 'runs'),
      defaultTimezone: 'UTC',
    });

    const job = await custom.addJob({
      name: 'UTC morning',
      type: 'cron',
      schedule: { cron: '0 4 * * *' },
      task: { type: 'message', message: 'Bonjour' },
    });

    expect(job.nextRunAt?.toISOString()).toBe('2026-07-12T04:00:00.000Z');
  });

  it('does not replay the repeated wall-clock minute during the autumn fold', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-25T00:00:00.000Z'));
    const custom = scheduler();
    custom.setTaskExecutor(async () => ({ ok: true }));
    const job = await custom.addJob({
      name: 'Paris folded 02:30',
      type: 'cron',
      schedule: { cron: '30 2 * * *', timezone: 'Europe/Paris' },
      task: { type: 'message', message: 'once per civil day' },
    });
    expect(job.nextRunAt?.toISOString()).toBe('2026-10-25T00:30:00.000Z');

    vi.setSystemTime(new Date('2026-10-25T00:30:00.000Z'));
    await custom.runJobNow(job.id);

    expect(job.nextRunAt?.toISOString()).toBe('2026-10-26T01:30:00.000Z');
  });

  it('marks an invalid timezone visibly instead of leaving an active job with no date', async () => {
    const job = await scheduler().addJob({
      name: 'Broken zone',
      type: 'cron',
      schedule: { cron: '0 4 * * *', timezone: 'Mars/Olympus' },
      task: { type: 'message', message: 'never' },
    });
    expect(job.status).toBe('error');
    expect(job.nextRunAt).toBeUndefined();
    expect(job.lastError).toMatch(/invalid|unschedulable/i);
  });
});
