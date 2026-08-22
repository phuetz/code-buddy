import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tempCronHome: string;
let previousCronHome: string | undefined;

async function parseOutput(result: { success: boolean; output?: string; error?: string }) {
  expect(result.success, result.error).toBe(true);
  expect(result.output).toBeTruthy();
  return JSON.parse(result.output as string) as Record<string, unknown>;
}

describe('cronjob tool real scheduler integration', () => {
  beforeEach(async () => {
    previousCronHome = process.env.CODEBUDDY_CRON_HOME;
    tempCronHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codebuddy-cronjob-tool-'));
    process.env.CODEBUDDY_CRON_HOME = tempCronHome;
    vi.resetModules();
  });

  afterEach(async () => {
    const { resetCronScheduler } = await import('../../src/scheduler/cron-scheduler.js');
    await resetCronScheduler();
    if (previousCronHome === undefined) {
      delete process.env.CODEBUDDY_CRON_HOME;
    } else {
      process.env.CODEBUDDY_CRON_HOME = previousCronHome;
    }
    vi.resetModules();
    await fs.rm(tempCronHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('creates, lists, pauses, resumes, runs, and removes a persisted cron job', async () => {
    const { createCronjobTools } = await import('../../src/tools/registry/cronjob-tools.js');
    const [tool] = createCronjobTools();
    expect(tool?.getSchema().name).toBe('cronjob');

    const created = await parseOutput(await tool!.execute({
      action: 'create',
      name: 'Real scheduled hello',
      at: '2035-01-01T00:00:00Z',
      message: 'bonjour depuis un vrai CronScheduler',
    }));
    const createdJob = created.job as { id: string; name: string; schedule: { at: string } };
    expect(createdJob.name).toBe('Real scheduled hello');
    expect(createdJob.schedule.at).toBe('2035-01-01T00:00:00.000Z');

    const persisted = await fs.readFile(path.join(tempCronHome, 'jobs.json'), 'utf-8');
    expect(persisted).toContain('Real scheduled hello');

    const listed = await parseOutput(await tool!.execute({ action: 'list' }));
    expect(listed.count).toBe(1);

    const paused = await parseOutput(await tool!.execute({ action: 'pause', id: createdJob.id.slice(0, 8) }));
    expect((paused.job as { status: string; enabled: boolean }).status).toBe('paused');
    expect((paused.job as { status: string; enabled: boolean }).enabled).toBe(false);

    const resumed = await parseOutput(await tool!.execute({ action: 'resume', id: createdJob.id }));
    expect((resumed.job as { status: string; enabled: boolean }).status).toBe('active');
    expect((resumed.job as { status: string; enabled: boolean }).enabled).toBe(true);

    const runNow = await parseOutput(await tool!.execute({ action: 'run', id: createdJob.id }));
    expect((runNow.run as { status: string }).status).toBe('success');
    expect((runNow.job as { runCount: number }).runCount).toBe(1);

    const removed = await parseOutput(await tool!.execute({ action: 'remove', id: createdJob.id }));
    expect((removed.job as { id: string }).id).toBe(createdJob.id);

    const afterRemove = await parseOutput(await tool!.execute({ action: 'list' }));
    expect(afterRemove.count).toBe(0);
  });

  it('creates and persists a no-agent script job', async () => {
    const { createCronjobTools } = await import('../../src/tools/registry/cronjob-tools.js');
    const [tool] = createCronjobTools();

    const created = await parseOutput(await tool!.execute({
      action: 'create',
      name: 'Nightly build',
      cron: '0 3 * * *',
      command: { executable: 'npm', args: ['run', 'build'], timeoutMs: 30000 },
    }));
    const job = created.job as { id: string; task: { type: string; command?: { executable: string } } };
    expect(job.task.type).toBe('script');
    expect(job.task.command?.executable).toBe('npm');

    const persisted = JSON.parse(await fs.readFile(path.join(tempCronHome, 'jobs.json'), 'utf-8')) as Array<{
      task: { type: string; command?: { executable: string; args?: string[] } };
    }>;
    expect(persisted[0]?.task.type).toBe('script');
    expect(persisted[0]?.task.command).toEqual({ executable: 'npm', args: ['run', 'build'], timeoutMs: 30000 });
  });

  it('creates and persists a no-agent skill job', async () => {
    const { createCronjobTools } = await import('../../src/tools/registry/cronjob-tools.js');
    const [tool] = createCronjobTools();

    const created = await parseOutput(await tool!.execute({
      action: 'create',
      name: 'Hourly cleanup',
      every: 3600000,
      skill: 'cleanup',
      skillRequest: 'purge stale temp files',
    }));
    const job = created.job as { task: { type: string; skill?: string; skillRequest?: string } };
    expect(job.task.type).toBe('skill');
    expect(job.task.skill).toBe('cleanup');
    expect(job.task.skillRequest).toBe('purge stale temp files');

    const persisted = JSON.parse(await fs.readFile(path.join(tempCronHome, 'jobs.json'), 'utf-8')) as Array<{
      task: { type: string; skill?: string; skillRequest?: string };
    }>;
    expect(persisted[0]?.task).toEqual({
      type: 'skill',
      skill: 'cleanup',
      skillRequest: 'purge stale temp files',
    });
  });

  it('creates and persists a chained (then) job', async () => {
    const { createCronjobTools } = await import('../../src/tools/registry/cronjob-tools.js');
    const [tool] = createCronjobTools();

    const created = await parseOutput(await tool!.execute({
      action: 'create',
      name: 'Chained first',
      every: 60000,
      message: 'first',
      then: 'second-prefix',
    }));
    expect((created.job as { then?: string }).then).toBe('second-prefix');

    const persisted = JSON.parse(await fs.readFile(path.join(tempCronHome, 'jobs.json'), 'utf-8')) as Array<{
      then?: string;
    }>;
    expect(persisted[0]?.then).toBe('second-prefix');
  });
});
