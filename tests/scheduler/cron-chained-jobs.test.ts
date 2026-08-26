import fs from 'fs';
import os from 'os';
import path from 'path';
import { CronScheduler, type CronJob } from '../../src/scheduler/cron-scheduler.js';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cron-chain-test-'));
}

describe('CronScheduler chained jobs', () => {
  let tmpDir: string;
  let scheduler: CronScheduler;

  beforeEach(async () => {
    tmpDir = makeTmpDir();
    scheduler = new CronScheduler({
      persistPath: path.join(tmpDir, 'jobs.json'),
      historyPath: path.join(tmpDir, 'runs'),
    });
    await scheduler.loadFromDisk();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('runs the chained `then` job after the parent succeeds', async () => {
    const order: string[] = [];
    scheduler.setTaskExecutor(async (job: CronJob) => {
      order.push(job.name);
      return { ok: true };
    });

    const second = await scheduler.addJob({
      name: 'second',
      type: 'at',
      schedule: { at: '2099-01-01T00:00:00.000Z' },
      task: { type: 'message', message: 'b' },
    });
    const first = await scheduler.addJob({
      name: 'first',
      type: 'at',
      schedule: { at: '2099-01-01T00:00:00.000Z' },
      task: { type: 'message', message: 'a' },
      then: second.id,
    });

    await scheduler.runJobNow(first.id);

    expect(order).toEqual(['first', 'second']);
    const secondHistory = await scheduler.getRunHistory(second.id);
    expect(secondHistory).toHaveLength(1);
    expect(secondHistory[0]?.status).toBe('success');
  });

  it('does not chain when the parent job fails', async () => {
    const order: string[] = [];
    scheduler.setTaskExecutor(async (job: CronJob) => {
      order.push(job.name);
      if (job.name === 'parent') {
        throw new Error('parent failed');
      }
      return { ok: true };
    });

    const child = await scheduler.addJob({
      name: 'child',
      type: 'at',
      schedule: { at: '2099-01-01T00:00:00.000Z' },
      task: { type: 'message', message: 'c' },
    });
    const parent = await scheduler.addJob({
      name: 'parent',
      type: 'at',
      schedule: { at: '2099-01-01T00:00:00.000Z' },
      task: { type: 'message', message: 'p' },
      then: child.id,
    });

    const run = await scheduler.runJobNow(parent.id);
    expect(run?.status).toBe('error');
    expect(order).toEqual(['parent']);
    expect(await scheduler.getRunHistory(child.id)).toHaveLength(0);
  });

  it('resolves a chain target by id prefix', async () => {
    const order: string[] = [];
    scheduler.setTaskExecutor(async (job: CronJob) => {
      order.push(job.name);
      return { ok: true };
    });

    const next = await scheduler.addJob({
      name: 'next',
      type: 'at',
      schedule: { at: '2099-01-01T00:00:00.000Z' },
      task: { type: 'message', message: 'n' },
    });
    const head = await scheduler.addJob({
      name: 'head',
      type: 'at',
      schedule: { at: '2099-01-01T00:00:00.000Z' },
      task: { type: 'message', message: 'h' },
      then: next.id.slice(0, 8),
    });

    await scheduler.runJobNow(head.id);
    expect(order).toEqual(['head', 'next']);
  });

  it('stops cleanly when the chain target is missing (logs, no throw)', async () => {
    const order: string[] = [];
    scheduler.setTaskExecutor(async (job: CronJob) => {
      order.push(job.name);
      return { ok: true };
    });

    const orphan = await scheduler.addJob({
      name: 'orphan',
      type: 'at',
      schedule: { at: '2099-01-01T00:00:00.000Z' },
      task: { type: 'message', message: 'o' },
      then: 'does-not-exist',
    });

    const run = await scheduler.runJobNow(orphan.id);
    expect(run?.status).toBe('success');
    expect(order).toEqual(['orphan']);
  });

  it('caps cyclic chains at the depth limit', async () => {
    let runs = 0;
    scheduler.setTaskExecutor(async () => {
      runs += 1;
      return { ok: true };
    });

    // a → b → a forms a cycle; the depth cap (10) must terminate it.
    const a = await scheduler.addJob({
      name: 'a',
      type: 'at',
      schedule: { at: '2099-01-01T00:00:00.000Z' },
      task: { type: 'message', message: 'a' },
    });
    const b = await scheduler.addJob({
      name: 'b',
      type: 'at',
      schedule: { at: '2099-01-01T00:00:00.000Z' },
      task: { type: 'message', message: 'b' },
      then: a.id,
    });
    await scheduler.updateJob(a.id, {});
    // updateJob can't set `then` (not in its Pick), so set it directly on the
    // in-memory job to form the cycle, mirroring a persisted cyclic config.
    (scheduler.getJob(a.id) as CronJob).then = b.id;

    await scheduler.runJobNow(a.id);

    // Bounded: the cycle terminates rather than running forever.
    expect(runs).toBeGreaterThan(0);
    expect(runs).toBeLessThanOrEqual(11); // initial run + at most MAX_CHAIN_DEPTH
  });
});
