import type { Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { RunStore } from '../../src/observability/run-store.js';
import {
  _resetFleetRegistryForTests,
  getFleetRegistry,
} from '../../src/fleet/fleet-registry.js';

describe('Mobile runs and status HTTP', () => {
  let tmpDir: string;
  let cwdBefore: string;
  let server: HttpServer;
  let baseUrl: string;
  const previousRuns = process.env.CODEBUDDY_RUNS_DIR;

  beforeEach(async () => {
    cwdBefore = process.cwd();
    tmpDir = makeTmpDir('mobile-runs-', path.join(cwdBefore, 'tmp'));
    process.chdir(tmpDir);
    process.env.CODEBUDDY_RUNS_DIR = path.join(tmpDir, 'runs');
    (RunStore as unknown as { _instance?: RunStore })._instance = undefined;
    _resetFleetRegistryForTests();
    getFleetRegistry().register({
      id: 'luna',
      url: 'ws://127.0.0.1:9/ws',
      startedAt: new Date(),
      eventCount: 1,
      autoReconnect: false,
      maxAttempts: 1,
      listener: {
        disconnect: async () => undefined,
        getReconnectAttempts: () => 0,
        isReconnecting: () => false,
        request: async (method) => {
          if (method === 'peer.describe') {
            return { hostname: 'luna-node', methods: ['peer.chat'] };
          }
          return {};
        },
        getLastSeen: () => ({ at: Date.now(), reason: 'test', ageMs: 1 }),
        isStale: () => false,
        getPeerCompactionState: () => ({
          active: false,
          startedAt: null,
          ageMs: null,
          lastResult: null,
        }),
        getEventHistory: () => [],
      },
    });

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
    server = started.server;
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    const { stopServer } = await import('../../src/server/index.js');
    await stopServer(server);
    process.chdir(cwdBefore);
    removeTmpDir(tmpDir);
    _resetFleetRegistryForTests();
    (RunStore as unknown as { _instance?: RunStore })._instance = undefined;
    if (previousRuns === undefined) delete process.env.CODEBUDDY_RUNS_DIR;
    else process.env.CODEBUDDY_RUNS_DIR = previousRuns;
  });

  it('lists runs and returns a trajectory', async () => {
    const store = RunStore.getInstance();
    const runId = store.startRun('mobile-pwa-v1');
    store.emit(runId, { type: 'tool_call', data: { name: 'view_file' } });
    store.emit(runId, { type: 'tool_result', data: { name: 'view_file', success: true } });
    store.endRun(runId, 'completed');

    const list = await fetch(`${baseUrl}/api/runs`);
    expect(list.status).toBe(200);
    const body = (await list.json()) as { runs: Array<{ runId: string; objective: string }> };
    expect(body.runs.some((run) => run.runId === runId)).toBe(true);

    const traj = await fetch(`${baseUrl}/api/runs/${runId}/trajectory`);
    expect(traj.status).toBe(200);
    const trajectory = (await traj.json()) as { runId: string; kind?: string };
    expect(trajectory.runId).toBe(runId);
  });

  it('returns 404 for an unknown run trajectory', async () => {
    const res = await fetch(`${baseUrl}/api/runs/run_missing/trajectory`);
    expect(res.status).toBe(404);
  });

  it('exposes provider, fallback, fleet peers', async () => {
    const res = await fetch(`${baseUrl}/api/status`);
    expect(res.status).toBe(200);
    const status = (await res.json()) as {
      provider: { id: string } | null;
      fleet: { peers: Array<{ id: string; describe: { hostname?: string } | null }> };
    };
    expect(status.fleet.peers.some((peer) => peer.id === 'luna')).toBe(true);
    const peers = await fetch(`${baseUrl}/api/fleet/peers`);
    const listed = (await peers.json()) as { peers: Array<{ id: string }> };
    expect(listed.peers.map((peer) => peer.id)).toContain('luna');
  });
});
