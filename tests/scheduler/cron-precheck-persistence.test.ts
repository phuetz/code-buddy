/**
 * Integration: a pre-check fingerprint mutated by CronAgentBridge must survive
 * the CronScheduler persist → reload cycle, and the reloaded fingerprint must
 * drive the skip decision on the next run.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { CronScheduler } from '../../src/scheduler/cron-scheduler.js';
import { CronAgentBridge } from '../../src/daemon/cron-agent-bridge.js';

// The message task path instantiates CodeBuddyAgent; mock it so the first
// (non-skipped) run does not need a real provider.
vi.mock('../../src/agent/codebuddy-agent.js', () => ({
  CodeBuddyAgent: class MockCodeBuddyAgent {
    async processUserMessage() {
      return [{ type: 'assistant', content: 'mock response' }];
    }
  },
}));

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cron-precheck-test-'));
}

describe('cron pre-check fingerprint persistence', () => {
  let tmpDir: string;
  let bridge: CronAgentBridge;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    bridge = new CronAgentBridge({
      apiKey: 'test-key',
      baseURL: 'http://localhost:3000',
      model: 'test-model',
      maxToolRounds: 5,
      jobTimeoutMs: 10000,
    });
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch {
      // ignore
    }
  });

  function newScheduler(): CronScheduler {
    return new CronScheduler({
      persistPath: path.join(tmpDir, 'jobs.json'),
      historyPath: path.join(tmpDir, 'runs'),
    });
  }

  it('persists the fingerprint and reuses it to skip the next unchanged run', async () => {
    const watched = path.join(tmpDir, 'seed.txt');
    fs.writeFileSync(watched, 'v1', 'utf8');

    const scheduler = newScheduler();
    await scheduler.start(bridge.createTaskExecutor());
    try {
      const job = await scheduler.addJob({
        name: 'Lead discovery',
        type: 'every',
        schedule: { every: 3_600_000 },
        task: { type: 'message', message: 'expensive work' },
        preCheck: { type: 'file_changed', paths: [watched] },
      });

      // First run: file_changed always runs and records a fingerprint.
      const firstRun = await scheduler.runJobNow(job.id);
      const result = firstRun?.result as { skipped?: boolean; output?: string };
      expect(result.skipped).toBeUndefined();
      expect(result.output).toContain('mock response');

      const persistedFingerprint = scheduler.getJob(job.id)?.preCheck?.lastFingerprint;
      expect(typeof persistedFingerprint).toBe('string');
    } finally {
      await scheduler.stop();
    }

    // Reload from disk in a fresh scheduler.
    const reloaded = newScheduler();
    await reloaded.start(bridge.createTaskExecutor());
    try {
      const jobs = reloaded.listJobs();
      expect(jobs).toHaveLength(1);
      const reloadedJob = jobs[0]!;
      expect(typeof reloadedJob.preCheck?.lastFingerprint).toBe('string');

      // File unchanged → the persisted fingerprint matches → run is skipped.
      const secondRun = await reloaded.runJobNow(reloadedJob.id);
      const skipResult = secondRun?.result as { skipped?: boolean; output?: string };
      expect(skipResult.skipped).toBe(true);
      expect(skipResult.output).toMatch(/Skipped by pre-check/);

      // Change the file → next run should not be skipped.
      fs.writeFileSync(watched, 'v2', 'utf8');
      const thirdRun = await reloaded.runJobNow(reloadedJob.id);
      const runResult = thirdRun?.result as { skipped?: boolean; output?: string };
      expect(runResult.skipped).toBeUndefined();
      expect(runResult.output).toContain('mock response');
    } finally {
      await reloaded.stop();
    }
  });
});
