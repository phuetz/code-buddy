import fs from 'fs';
import os from 'os';
import path from 'path';
import { CronScheduler } from '../../src/scheduler/cron-scheduler.js';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cron-manual-run-test-'));
}

describe('CronScheduler manual runs', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('persists run history when runJobNow is used before start()', async () => {
    const scheduler = new CronScheduler({
      persistPath: path.join(tmpDir, 'jobs.json'),
      historyPath: path.join(tmpDir, 'runs'),
    });

    await scheduler.loadFromDisk();
    const job = await scheduler.addJob({
      name: 'Manual smoke',
      type: 'at',
      schedule: { at: '2030-01-01T00:00:00.000Z' },
      task: { type: 'message', message: 'hello from cron' },
    });

    const run = await scheduler.runJobNow(job.id);

    expect(run?.status).toBe('success');
    expect(run?.result).toEqual({ executed: true, task: job.task });
    const history = await scheduler.getRunHistory(job.id);
    expect(history).toHaveLength(1);
    expect(history[0]?.id).toBe(run?.id);
  });
});
