import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import { resetDatabaseManager } from '../../src/database/database-manager.js';
import { resetHeartbeatEngine } from '../../src/daemon/heartbeat.js';
import { stopServer } from '../../src/server/index.js';

describe('native status report HTTP routes', () => {
  let tmpHome: string;
  let previousHome: string | undefined;

  beforeEach(() => {
    previousHome = process.env.CODEBUDDY_HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-native-status-http-'));
    process.env.CODEBUDDY_HOME = tmpHome;
    resetDatabaseManager();
    resetHeartbeatEngine();
  });

  afterEach(() => {
    resetDatabaseManager();
    resetHeartbeatEngine();
    if (previousHome === undefined) {
      delete process.env.CODEBUDDY_HOME;
    } else {
      process.env.CODEBUDDY_HOME = previousHome;
    }
    fs.rmSync(tmpHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('serves raw and report-shaped daemon and heartbeat status over real HTTP', async () => {
    const { startServer } = await import('../../src/server/index.js');
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

      const daemonRawResponse = await fetch(`${baseUrl}/api/daemon/status`);
      const daemonRaw = await daemonRawResponse.json() as Record<string, unknown>;
      expect(daemonRawResponse.status).toBe(200);
      expect(daemonRaw.kind).toBeUndefined();
      expect(typeof daemonRaw.running).toBe('boolean');

      const daemonReportResponse = await fetch(`${baseUrl}/api/daemon/status?format=report`);
      const daemonReport = await daemonReportResponse.json() as {
        kind?: unknown;
        schemaVersion?: unknown;
        status?: { running?: unknown };
        summary?: { serviceCount?: unknown };
        recommendations?: unknown;
      };
      expect(daemonReportResponse.status).toBe(200);
      expect(daemonReport.kind).toBe('codebuddy_daemon_status');
      expect(daemonReport.schemaVersion).toBe(1);
      expect(typeof daemonReport.status?.running).toBe('boolean');
      expect(typeof daemonReport.summary?.serviceCount).toBe('number');
      expect(Array.isArray(daemonReport.recommendations)).toBe(true);

      const heartbeatRawResponse = await fetch(`${baseUrl}/api/heartbeat/status`);
      const heartbeatRaw = await heartbeatRawResponse.json() as Record<string, unknown>;
      expect(heartbeatRawResponse.status).toBe(200);
      expect(heartbeatRaw.kind).toBeUndefined();
      expect(typeof heartbeatRaw.running).toBe('boolean');
      expect(typeof heartbeatRaw.totalTicks).toBe('number');

      const heartbeatReportResponse = await fetch(`${baseUrl}/api/heartbeat/status?format=report`);
      const heartbeatReport = await heartbeatReportResponse.json() as {
        kind?: unknown;
        schemaVersion?: unknown;
        status?: { running?: unknown };
        config?: { intervalMs?: unknown };
        recommendations?: unknown;
      };
      expect(heartbeatReportResponse.status).toBe(200);
      expect(heartbeatReport.kind).toBe('codebuddy_heartbeat_status');
      expect(heartbeatReport.schemaVersion).toBe(1);
      expect(typeof heartbeatReport.status?.running).toBe('boolean');
      expect(typeof heartbeatReport.config?.intervalMs).toBe('number');
      expect(Array.isArray(heartbeatReport.recommendations)).toBe(true);
    } finally {
      await stopServer(started.server);
    }
  });
});
