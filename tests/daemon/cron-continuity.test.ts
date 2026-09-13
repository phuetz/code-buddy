import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { Command } from 'commander';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CronAgentBridge, resetCronAgentBridge } from '../../src/daemon/cron-agent-bridge.js';
import { CronScheduler, getCronScheduler, resetCronScheduler } from '../../src/scheduler/cron-scheduler.js';
import { JobNotepadStore, MAX_VALUE_BYTES } from '../../src/scheduler/job-notepad.js';
import { registerDaemonCommands } from '../../src/commands/cli/daemon-commands.js';
import { logger } from '../../src/utils/logger.js';

const { mockProcessUserMessage, mockLearningEnabled } = vi.hoisted(() => ({
  mockProcessUserMessage: vi.fn(async (_message: string) => [
    { type: 'assistant', content: 'mock response' },
  ]),
  mockLearningEnabled: vi.fn(() => false),
}));

// Exercise the actual daemon command wiring without booting a daemon or server.
vi.mock('../../src/daemon/index.js', () => ({
  getDaemonManager: () => ({ start: vi.fn(async () => {}), stop: vi.fn(async () => {}) }),
}));
vi.mock('../../src/server/index.js', () => ({ startServer: vi.fn(async () => {}) }));
vi.mock('../../src/observability/run-store.js', () => ({ RunStore: { getInstance: () => undefined } }));
vi.mock('../../src/daemon/learning-cron-job.js', () => ({
  isLearningDaemonEnabled: mockLearningEnabled,
  registerLearningCronJob: vi.fn(async () => {}),
}));

vi.mock('../../src/agent/codebuddy-agent.js', () => ({
  CodeBuddyAgent: class MockCodeBuddyAgent {
    async processUserMessage(message: string) {
      return mockProcessUserMessage(message);
    }
  },
}));

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const QA_HOME = path.join(REPO_ROOT, '_qa', 'home');

describe('cron per-job continuity', () => {
  let previousHome: string | undefined;
  let previousCronHome: string | undefined;
  let tmpDir: string;
  let scheduler: CronScheduler;
  let bridge: CronAgentBridge;

  beforeEach(() => {
    previousHome = process.env.HOME;
    previousCronHome = process.env.CODEBUDDY_CRON_HOME;
    mkdirSync(QA_HOME, { recursive: true, mode: 0o700 });
    process.env.HOME = QA_HOME;
    tmpDir = mkdtempSync(path.join(QA_HOME, 'cron-'));
    process.env.CODEBUDDY_CRON_HOME = tmpDir;
    resetCronAgentBridge();
    mockLearningEnabled.mockReturnValue(false);
    mockProcessUserMessage.mockReset();
    mockProcessUserMessage.mockImplementation(async () => [
      { type: 'assistant', content: 'mock response' },
    ]);
    scheduler = new CronScheduler({
      persistPath: path.join(tmpDir, 'jobs.json'),
      historyPath: path.join(tmpDir, 'runs'),
    });
    bridge = new CronAgentBridge({
      apiKey: 'test-key',
      maxToolRounds: 5,
      jobTimeoutMs: 10_000,
      notepadDir: scheduler.notepadDir,
    });
  });

  afterEach(async () => {
    await scheduler.stop().catch(() => undefined);
    await resetCronScheduler();
    resetCronAgentBridge();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousCronHome === undefined) delete process.env.CODEBUDDY_CRON_HOME;
    else process.env.CODEBUDDY_CRON_HOME = previousCronHome;
    rmSync(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('injects last successful output after a scheduler restart', async () => {
    await scheduler.start(bridge.createTaskExecutor());
    const job = await scheduler.addJob({
      name: 'Lead follow-up',
      type: 'every',
      schedule: { every: 3_600_000 },
      task: { type: 'message', message: 'continue the list' },
      continuity: { enabled: true, notes: { cursor: 'seed-1' } },
    });

    const first = await scheduler.runJobNow(job.id);
    expect(first?.status).toBe('success');
    expect(mockProcessUserMessage).toHaveBeenCalledTimes(1);
    const firstPrompt = mockProcessUserMessage.mock.calls[0]?.[0] ?? '';
    expect(firstPrompt).toContain('- cursor: seed-1');
    expect(firstPrompt).toContain('[Task]:');
    expect(firstPrompt).toContain('continue the list');
    expect(firstPrompt).not.toContain('## Last successful output');

    await scheduler.stop();

    const reloaded = new CronScheduler({
      persistPath: path.join(tmpDir, 'jobs.json'),
      historyPath: path.join(tmpDir, 'runs'),
    });
    const reloadedBridge = new CronAgentBridge({
      apiKey: 'test-key',
      maxToolRounds: 5,
      jobTimeoutMs: 10_000,
      notepadDir: reloaded.notepadDir,
    });
    await reloaded.start(reloadedBridge.createTaskExecutor());
    try {
      const jobs = reloaded.listJobs();
      expect(jobs).toHaveLength(1);
      expect(jobs[0]?.continuity).toEqual({ enabled: true });
      mockProcessUserMessage.mockClear();
      const second = await reloaded.runJobNow(jobs[0]!.id);
      expect(second?.status).toBe('success');
      const secondPrompt = mockProcessUserMessage.mock.calls[0]?.[0] ?? '';
      expect(secondPrompt).toContain('- cursor: seed-1');
      expect(secondPrompt).toContain('## Last successful output');
      expect(secondPrompt).toContain('mock response');
    } finally {
      await reloaded.stop();
    }
  });

  it('retries an unchanged source after a failed run instead of skipping', async () => {
    const watched = path.join(tmpDir, 'seed.txt');
    writeFileSync(watched, 'v1', 'utf8');
    await scheduler.start(bridge.createTaskExecutor());

    const job = await scheduler.addJob({
      name: 'Fragile ingest',
      type: 'every',
      schedule: { every: 3_600_000 },
      task: { type: 'message', message: 'ingest' },
      preCheck: { type: 'file_changed', paths: [watched] },
    });

    mockProcessUserMessage.mockRejectedValueOnce(new Error('provider down'));
    const failed = await scheduler.runJobNow(job.id);
    expect(failed?.status).toBe('error');
    expect(scheduler.getJob(job.id)?.preCheck?.lastFingerprint).toBeUndefined();

    await scheduler.stop();
    const reloaded = new CronScheduler({
      persistPath: path.join(tmpDir, 'jobs.json'),
      historyPath: path.join(tmpDir, 'runs'),
    });
    const reloadedBridge = new CronAgentBridge({
      apiKey: 'test-key',
      maxToolRounds: 5,
      jobTimeoutMs: 10_000,
      notepadDir: reloaded.notepadDir,
    });
    await reloaded.start(reloadedBridge.createTaskExecutor());
    try {
      const reloadedJob = reloaded.listJobs()[0]!;
      expect(reloadedJob.preCheck?.lastFingerprint).toBeUndefined();
      mockProcessUserMessage.mockClear();
      mockProcessUserMessage.mockResolvedValueOnce([
        { type: 'assistant', content: 'recovered' },
      ]);
      const retry = await reloaded.runJobNow(reloadedJob.id);
      expect(retry?.status).toBe('success');
      const retryResult = retry?.result as { skipped?: boolean; output?: string };
      expect(retryResult.skipped).toBeUndefined();
      expect(retryResult.output).toBe('recovered');
      expect(mockProcessUserMessage).toHaveBeenCalledTimes(1);
      expect(typeof reloaded.getJob(reloadedJob.id)?.preCheck?.lastFingerprint).toBe('string');
    } finally {
      await reloaded.stop();
    }
  });

  it('does not write a notepad or alter the agent prompt when continuity is off', async () => {
    await scheduler.start(bridge.createTaskExecutor());
    const job = await scheduler.addJob({
      name: 'Plain',
      type: 'every',
      schedule: { every: 3_600_000 },
      task: { type: 'message', message: 'just this' },
    });
    const run = await scheduler.runJobNow(job.id);
    expect(run?.status).toBe('success');
    expect(mockProcessUserMessage.mock.calls[0]?.[0]).toBe('just this');
    expect(existsSync(path.join(scheduler.notepadDir, `${job.id}.json`))).toBe(false);
  });

  it('does not replace last successful output with a pre-check skip', async () => {
    const watched = path.join(tmpDir, 'stable.txt');
    writeFileSync(watched, 'same', 'utf8');
    await scheduler.start(bridge.createTaskExecutor());
    const job = await scheduler.addJob({
      name: 'Skip-safe',
      type: 'every',
      schedule: { every: 3_600_000 },
      task: { type: 'message', message: 'work' },
      preCheck: { type: 'file_changed', paths: [watched] },
      continuity: true,
    });

    const first = await scheduler.runJobNow(job.id);
    expect(first?.status).toBe('success');
    const notepad = new JobNotepadStore(scheduler.notepadDir);
    expect((await notepad.load(job.id)).lastSuccessfulOutput).toBe('mock response');

    const skip = await scheduler.runJobNow(job.id);
    const skipResult = skip?.result as { skipped?: boolean };
    expect(skipResult.skipped).toBe(true);
    expect((await notepad.load(job.id)).lastSuccessfulOutput).toBe('mock response');
  });

  it('keeps watchdog jobs on the no-LLM path even with continuity enabled', async () => {
    await scheduler.start(bridge.createTaskExecutor());
    const job = await scheduler.addJob({
      name: 'Disk',
      type: 'every',
      schedule: { every: 3_600_000 },
      task: { type: 'watchdog', watchdog: { checks: [{ type: 'disk', minFreeBytes: 0 }] } },
      continuity: true,
    });
    const run = await scheduler.runJobNow(job.id);
    expect(run?.status).toBe('success');
    const result = run?.result as { watchdogOk?: boolean; output?: string };
    expect(result.watchdogOk).toBe(true);
    expect(result.output).not.toContain('mock response');
    expect(mockProcessUserMessage).not.toHaveBeenCalled();
  });

  it('updates seeded notes through the job API without mixing jobs', async () => {
    await scheduler.loadFromDisk();
    const alpha = await scheduler.addJob({
      name: 'Alpha',
      type: 'at',
      schedule: { at: '2099-01-01T00:00:00.000Z' },
      task: { type: 'message', message: 'a' },
      continuity: { enabled: true, notes: { cursor: 'A' } },
    });
    const beta = await scheduler.addJob({
      name: 'Beta',
      type: 'at',
      schedule: { at: '2099-01-01T00:00:00.000Z' },
      task: { type: 'message', message: 'b' },
      continuity: { enabled: true, notes: { cursor: 'B' } },
    });
    await scheduler.updateJob(alpha.id, { continuity: { enabled: true, notes: { cursor: 'A2' } } });

    const notepad = new JobNotepadStore(scheduler.notepadDir);
    expect(await notepad.getNote(alpha.id, 'cursor')).toBe('A2');
    expect(await notepad.getNote(beta.id, 'cursor')).toBe('B');

    await scheduler.removeJob(alpha.id);
    expect(existsSync(path.join(scheduler.notepadDir, `${alpha.id}.json`))).toBe(false);
    expect(await notepad.getNote(beta.id, 'cursor')).toBe('B');
  });

  it('rejects invalid creation without leaving a phantom job to persist later', async () => {
    await scheduler.start(bridge.createTaskExecutor());
    await expect(scheduler.addJob({
      name: 'Rejected', type: 'every', schedule: { every: 1000 },
      task: { type: 'message', message: 'must not run' },
      continuity: { notes: { oversized: 'x'.repeat(MAX_VALUE_BYTES + 1) } },
    })).rejects.toThrow('value too large');
    expect(scheduler.listJobs()).toEqual([]);
    expect(existsSync(scheduler.notepadDir)).toBe(false);
    await scheduler.stop();
    const reloaded = new CronScheduler({ persistPath: path.join(tmpDir, 'jobs.json') });
    await reloaded.loadFromDisk();
    expect(reloaded.listJobs()).toEqual([]);
    expect(mockProcessUserMessage).not.toHaveBeenCalled();
  });

  it('keeps job state, notes and the original timer after invalid or locked note updates', async () => {
    await scheduler.start(bridge.createTaskExecutor());
    // The public completion event precedes history persistence. Observe the
    // timer's promise solely to drain those writes before removing the fixture.
    const execution = vi.spyOn(scheduler as unknown as {
      executeJob: (...args: unknown[]) => Promise<unknown>;
    }, 'executeJob');
    const job = await scheduler.addJob({
      name: 'Original', type: 'every', schedule: { every: 1000 },
      task: { type: 'message', message: 'original task' },
      continuity: { notes: { keep: 'original' } }, maxRuns: 1,
    });
    const ran = new Promise<void>(resolve => { scheduler.once('job:run:complete', () => resolve()); });
    const jobsFile = path.join(tmpDir, 'jobs.json');
    const diskBefore = readFileSync(jobsFile, 'utf8');
    const notepad = new JobNotepadStore(scheduler.notepadDir);
    const file = notepad.fileFor(job.id);
    await expect(scheduler.updateJob(job.id, {
      name: 'Rejected', enabled: false,
      continuity: { notes: { invalid: 'x'.repeat(MAX_VALUE_BYTES + 1) } },
    })).rejects.toThrow('value too large');
    writeFileSync(`${file}.lock`, 'another process');
    try {
      await expect(scheduler.updateJob(job.id, {
        name: 'Also rejected', enabled: false, continuity: { notes: { keep: 'changed' } },
      })).rejects.toThrow('mutation locked');
    } finally { unlinkSync(`${file}.lock`); }
    expect(scheduler.getJob(job.id)).toMatchObject({ name: 'Original', enabled: true, schedule: { every: 1000 } });
    expect(await notepad.getNote(job.id, 'keep')).toBe('original');
    expect(readFileSync(jobsFile, 'utf8')).toBe(diskBefore);
    await ran;
    expect(execution).toHaveBeenCalledTimes(1);
    await execution.mock.results[0]?.value;
    expect(mockProcessUserMessage).toHaveBeenCalledTimes(1);
    expect(mockProcessUserMessage.mock.calls[0]?.[0]).toContain('original task');
  });

  it('warns on corrupt continuity without losing the successful task or overwriting the record', async () => {
    await scheduler.start(bridge.createTaskExecutor());
    const job = await scheduler.addJob({
      name: 'Corrupt context', type: 'every', schedule: { every: 3_600_000 },
      task: { type: 'message', message: 'still run' }, continuity: true,
    });
    const file = new JobNotepadStore(scheduler.notepadDir).fileFor(job.id);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, '{broken');
    const warnings = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const run = await scheduler.runJobNow(job.id);
    expect(run?.status).toBe('success');
    expect(run?.result).toMatchObject({ success: true, output: 'mock response' });
    expect(mockProcessUserMessage.mock.calls[0]?.[0]).toBe('still run');
    expect(warnings).toHaveBeenCalledWith(
      'Cron task succeeded but its continuity output could not be saved',
      expect.objectContaining({ jobId: job.id }),
    );
    expect(readFileSync(file, 'utf8')).toBe('{broken');
  });

  it.each(['provider', 'learning'])('wires the custom scheduler notepad root through the %s daemon factory', async mode => {
    await resetCronScheduler();
    scheduler = getCronScheduler({
      persistPath: path.join(tmpDir, 'custom', 'jobs.json'), historyPath: path.join(tmpDir, 'custom', 'runs'),
    });
    vi.stubEnv('GROK_API_KEY', mode === 'provider' ? 'fixture-key' : '');
    vi.stubEnv('XAI_API_KEY', '');
    mockLearningEnabled.mockReturnValue(mode === 'learning');
    const previousListeners = new Set(process.listeners('SIGTERM'));
    const program = new Command().exitOverride();
    registerDaemonCommands(program);
    try {
      await program.parseAsync(['daemon', '__run__'], { from: 'user' });
      const job = await scheduler.addJob({
        name: 'Custom root', type: 'every', schedule: { every: 3_600_000 },
        task: { type: 'message', message: 'work' }, continuity: { notes: { source: 'custom root' } },
      });
      const run = await scheduler.runJobNow(job.id);
      expect(run?.status).toBe('success');
      expect(mockProcessUserMessage.mock.calls[0]?.[0]).toContain('- source: custom root');
      expect((await new JobNotepadStore(scheduler.notepadDir).load(job.id)).lastSuccessfulOutput).toBe('mock response');
      expect(existsSync(path.join(tmpDir, 'notepads', `${job.id}.json`))).toBe(false);
    } finally {
      for (const listener of process.listeners('SIGTERM')) {
        if (!previousListeners.has(listener)) process.removeListener('SIGTERM', listener);
      }
    }
  });
});
