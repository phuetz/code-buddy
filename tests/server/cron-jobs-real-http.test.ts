import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import { resetDatabaseManager } from '../../src/database/database-manager.js';

describe('cron jobs HTTP routes', () => {
  let tmpHome: string;
  let tmpCron: string;
  let previousHome: string | undefined;

  beforeEach(() => {
    previousHome = process.env.CODEBUDDY_HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-cron-http-home-'));
    tmpCron = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-cron-http-store-'));
    process.env.CODEBUDDY_HOME = tmpHome;
    resetDatabaseManager();
  });

  afterEach(async () => {
    const { resetCronScheduler } = await import('../../src/scheduler/cron-scheduler.js');
    await resetCronScheduler();
    resetDatabaseManager();
    if (previousHome === undefined) {
      delete process.env.CODEBUDDY_HOME;
    } else {
      process.env.CODEBUDDY_HOME = previousHome;
    }
    fs.rmSync(tmpHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    fs.rmSync(tmpCron, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('loads persisted cron jobs before listing or triggering them over real HTTP', async () => {
    const {
      CronScheduler,
      getCronScheduler,
      resetCronScheduler,
    } = await import('../../src/scheduler/cron-scheduler.js');
    await resetCronScheduler();

    const cronConfig = {
      persistPath: path.join(tmpCron, 'jobs.json'),
      historyPath: path.join(tmpCron, 'runs'),
    };
    const writer = new CronScheduler(cronConfig);
    const job = await writer.addJob({
      name: 'real-http-cron',
      type: 'every',
      schedule: { every: 60_000 },
      task: { type: 'message', message: 'hello from persisted cron' },
    });

    getCronScheduler(cronConfig);

    const { startServer, stopServer } = await import('../../src/server/index.js');
    const started = await startServer({
      port: 0,
      host: '127.0.0.1',
      authEnabled: false,
      websocketEnabled: false,
      logging: false,
      rateLimit: false,
      cors: false,
    });

    try {
      const address = started.server.address() as AddressInfo;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      const listResponse = await fetch(`${baseUrl}/api/cron/jobs`);
      const listBody = await listResponse.json() as {
        jobs?: Array<{ id?: string; name?: string }>;
        stats?: { totalJobs?: number };
      };
      expect(listResponse.status).toBe(200);
      expect(listBody.jobs).toHaveLength(1);
      expect(listBody.jobs?.[0]?.id).toBe(job.id);
      expect(listBody.jobs?.[0]?.name).toBe('real-http-cron');
      expect(listBody.stats?.totalJobs).toBe(1);

      const triggerResponse = await fetch(`${baseUrl}/api/cron/jobs/${job.id}/trigger`, {
        method: 'POST',
      });
      const triggerBody = await triggerResponse.json() as {
        success?: boolean;
        run?: { jobId?: string; status?: string; result?: unknown };
      };
      expect(triggerResponse.status).toBe(200);
      expect(triggerBody.success).toBe(true);
      expect(triggerBody.run?.jobId).toBe(job.id);
      expect(triggerBody.run?.status).toBe('success');
    } finally {
      await stopServer(started.server);
    }
  });
});
