/**
 * Scheduled executions create durable run records + artifacts (item 18) when a
 * RunStore is wired into the bridge.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { CronAgentBridge, resetCronAgentBridge } from '../../src/daemon/cron-agent-bridge.js';
import { RunStore } from '../../src/observability/run-store.js';
import type { CronJob } from '../../src/scheduler/cron-scheduler.js';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cron-run-rec-'));
}

describe('CronAgentBridge run recording', () => {
  let tmpDir: string;
  let store: RunStore;
  let bridge: CronAgentBridge;

  beforeEach(() => {
    resetCronAgentBridge();
    tmpDir = makeTmpDir();
    store = new RunStore(tmpDir);
    bridge = new CronAgentBridge({
      apiKey: 'k',
      baseURL: 'http://localhost:3000',
      model: 'm',
      maxToolRounds: 5,
      jobTimeoutMs: 10000,
      runStore: store,
    });
  });

  afterEach(async () => {
    store.dispose();
    await new Promise((r) => setTimeout(r, 60));
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch {
      // ignore
    }
    (RunStore as unknown as { _instance: RunStore | null })._instance = null;
  });

  function watchdogJob(): CronJob {
    return {
      id: 'wd-job',
      name: 'Disk Watchdog',
      type: 'every',
      schedule: { every: 60000 },
      task: { type: 'watchdog', watchdog: { checks: [{ type: 'disk', minFreeBytes: 0 }] } },
      status: 'active',
      createdAt: new Date(),
      runCount: 0,
      errorCount: 0,
      enabled: true,
    };
  }

  it('creates a completed run with an output artifact for a watchdog job', async () => {
    const result = await bridge.executeJob(watchdogJob());

    // The result references the real run id, not a synthetic placeholder.
    expect(result.runId).toMatch(/^run_/);

    const runs = store.listRuns(10);
    expect(runs).toHaveLength(1);
    const summary = runs[0]!;
    expect(summary.runId).toBe(result.runId);
    expect(summary.status).toBe('completed');
    expect(summary.objective).toBe('Cron: Disk Watchdog');
    expect(summary.metadata?.channel).toBe('scheduled');
    expect(summary.metadata?.tags).toEqual(expect.arrayContaining(['cron', 'watchdog']));

    const record = store.getRun(result.runId);
    expect(record?.artifacts).toContain('output.md');
    const artifact = store.getArtifact(result.runId, 'output.md');
    expect(artifact).toMatch(/watchdog ok/i);
  });

  it('records a completed run with a skip decision when a pre-check skips', async () => {
    const job: CronJob = {
      ...watchdogJob(),
      id: 'skip-job',
      name: 'Guarded Job',
      task: { type: 'message', message: 'expensive' },
      preCheck: { type: 'command', command: { executable: 'node', args: ['-e', 'process.exit(1)'] } },
    };

    const result = await bridge.executeJob(job);
    expect(result.skipped).toBe(true);

    const runs = store.listRuns(10);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe('completed');
    expect(runs[0]!.runId).toBe(result.runId);

    const artifact = store.getArtifact(result.runId, 'output.md');
    expect(artifact).toMatch(/Skipped by pre-check/);
  });

  it('does not create run records when no store is configured', async () => {
    resetCronAgentBridge();
    const noStoreBridge = new CronAgentBridge({
      apiKey: 'k',
      baseURL: 'http://localhost:3000',
      model: 'm',
      maxToolRounds: 5,
      jobTimeoutMs: 10000,
    });
    const result = await noStoreBridge.executeJob(watchdogJob());
    // Falls back to the synthetic placeholder id and writes nothing to disk.
    expect(result.runId).toMatch(/^run-\d+$/);
    expect(store.listRuns(10)).toHaveLength(0);
  });
});
