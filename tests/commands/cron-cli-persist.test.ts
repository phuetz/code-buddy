import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * End-to-end CLI persistence: drive `registerCronCommands(program)` with
 * `parseAsync(...)` against a tempdir CODEBUDDY_CRON_HOME and assert that
 * `buddy cron add` writes a job with the correct task type / command / skill /
 * then into jobs.json. This proves the user-facing CLI path, not just the pure
 * builder.
 */

let tempCronHome: string;
let previousCronHome: string | undefined;
let logSpy: ReturnType<typeof vi.spyOn>;

interface PersistedJob {
  id: string;
  type: string;
  then?: string;
  task: {
    type: string;
    command?: { executable: string; args?: string[] };
    skill?: string;
    skillRequest?: string;
  };
}

async function readJobs(): Promise<PersistedJob[]> {
  const raw = await fs.readFile(path.join(tempCronHome, 'jobs.json'), 'utf-8');
  return JSON.parse(raw) as PersistedJob[];
}

async function buildProgram(): Promise<Command> {
  const { registerCronCommands } = await import('../../src/commands/cron-cli/index.js');
  const program = new Command();
  program.exitOverride();
  program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
  registerCronCommands(program);
  return program;
}

describe('buddy cron add — CLI persistence', () => {
  beforeEach(async () => {
    previousCronHome = process.env.CODEBUDDY_CRON_HOME;
    tempCronHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codebuddy-cron-cli-'));
    process.env.CODEBUDDY_CRON_HOME = tempCronHome;
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.resetModules();
  });

  afterEach(async () => {
    const { resetCronScheduler } = await import('../../src/scheduler/cron-scheduler.js');
    await resetCronScheduler();
    logSpy.mockRestore();
    if (previousCronHome === undefined) {
      delete process.env.CODEBUDDY_CRON_HOME;
    } else {
      process.env.CODEBUDDY_CRON_HOME = previousCronHome;
    }
    vi.resetModules();
    await fs.rm(tempCronHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('persists a script job created via `cron add --script`', async () => {
    const program = await buildProgram();
    await program.parseAsync([
      'node', 'buddy', 'cron', 'add', 'Nightly build',
      '--cron', '0 3 * * *',
      '--script', JSON.stringify({ executable: 'npm', args: ['run', 'build'] }),
    ]);

    const jobs = await readJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.type).toBe('cron');
    expect(jobs[0]?.task.type).toBe('script');
    expect(jobs[0]?.task.command).toEqual({ executable: 'npm', args: ['run', 'build'] });
  });

  it('persists a skill job created via `cron add --skill`', async () => {
    const program = await buildProgram();
    await program.parseAsync([
      'node', 'buddy', 'cron', 'add', 'Hourly cleanup',
      '--every', '3600000',
      '--skill', 'cleanup',
      '--skill-request', 'purge stale temp files',
    ]);

    const jobs = await readJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.task).toEqual({
      type: 'skill',
      skill: 'cleanup',
      skillRequest: 'purge stale temp files',
    });
  });

  it('persists a then chain target created via `cron add --then`', async () => {
    const program = await buildProgram();
    await program.parseAsync([
      'node', 'buddy', 'cron', 'add', 'Chained first',
      '--every', '60000',
      '--message', 'first',
      '--then', 'second-prefix',
    ]);

    const jobs = await readJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.then).toBe('second-prefix');
    expect(jobs[0]?.task.type).toBe('message');
  });

  it('edits a job to a script task and sets/clears then via `cron update`', async () => {
    const program = await buildProgram();
    await program.parseAsync([
      'node', 'buddy', 'cron', 'add', 'Editable',
      '--every', '60000',
      '--message', 'go',
      '--then', 'old-target',
    ]);
    const created = (await readJobs())[0];
    expect(created?.then).toBe('old-target');

    const program2 = await buildProgram();
    await program2.parseAsync([
      'node', 'buddy', 'cron', 'update', created!.id,
      '--script', JSON.stringify({ executable: 'git', args: ['fetch'] }),
      '--clear-then',
    ]);

    const updated = (await readJobs())[0];
    expect(updated?.task.type).toBe('script');
    expect(updated?.task.command).toEqual({ executable: 'git', args: ['fetch'] });
    expect(updated?.then).toBeUndefined();
  });
});
