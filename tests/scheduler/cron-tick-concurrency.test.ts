import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CronScheduler } from '../../src/scheduler/cron-scheduler.js';

describe('CronScheduler tick serialization', () => {
  const dirs: string[] = [];
  afterEach(() => {
    dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
  });

  it('does not execute one long due job from two overlapping ticks', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cron-tick-race-'));
    dirs.push(dir);
    const scheduler = new CronScheduler({
      persistPath: join(dir, 'jobs.json'),
      historyPath: join(dir, 'runs'),
      defaultTimezone: 'UTC',
    });
    let release!: () => void;
    let started!: () => void;
    const executionStarted = new Promise<void>((resolve) => { started = resolve; });
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const executor = vi.fn(async () => {
      started();
      await blocked;
      return { ok: true };
    });
    scheduler.setTaskExecutor(executor);
    const job = await scheduler.addJob({
      name: 'Long job',
      type: 'cron',
      schedule: { cron: '0 4 * * *', timezone: 'UTC' },
      task: { type: 'message', message: 'long' },
    });
    job.nextRunAt = new Date(Date.now() - 1_000);
    const internal = scheduler as unknown as { tick(): Promise<void> };

    const first = internal.tick();
    await executionStarted;
    await internal.tick();
    expect(executor).toHaveBeenCalledTimes(1);
    release();
    await first;
  });
});
