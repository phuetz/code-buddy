/**
 * Real HTTP coverage for GET /api/fleet/status and /api/fleet/describe.
 * The CLI client that mocks fetch does not prove these Express routes.
 */
import type { Server as HttpServer } from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';

describe('Fleet HTTP routes', () => {
  let tmpDir: string;
  let cwdBefore: string;
  let server: HttpServer;
  let baseUrl: string;
  let port: number;

  beforeEach(async () => {
    cwdBefore = process.cwd();
    tmpDir = makeTmpDir('r30-fleet-http-', path.join(cwdBefore, 'tmp'));
    process.chdir(tmpDir);

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
    const address = server.address() as AddressInfo;
    port = address.port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    const { stopServer } = await import('../../src/server/index.js');
    await stopServer(server);
    process.chdir(cwdBefore);
    removeTmpDir(tmpDir);
  });

  it('serves status and describe on a port above 3100', async () => {
    expect(port).toBeGreaterThan(3100);

    const statusResponse = await fetch(`${baseUrl}/api/fleet/status`);
    expect(statusResponse.status).toBe(200);
    const status = (await statusResponse.json()) as {
      status: string;
      connections: { total?: number };
    };
    expect(status.status).toBe('ok');
    expect(status.connections).toEqual(expect.objectContaining({ total: expect.any(Number) }));

    const describeResponse = await fetch(`${baseUrl}/api/fleet/describe`);
    expect(describeResponse.status).toBe(200);
    const description = (await describeResponse.json()) as Record<string, unknown>;
    expect(description).toEqual(
      expect.objectContaining({
        hostname: expect.any(String),
        methods: expect.any(Array),
      }),
    );
    expect(description.httpMethods).toEqual(['peer.describe']);
    expect(Array.isArray(description.wsOnlyMethods)).toBe(true);
    const methods = description.methods as string[];
    const classified = new Set([
      ...(description.httpMethods as string[]),
      ...(description.wsOnlyMethods as string[]),
    ]);
    for (const method of methods) {
      expect(classified.has(method), `${method} is neither HTTP-backed nor listed as WS-only`).toBe(
        true,
      );
    }

    const missingHttp = await fetch(`${baseUrl}/api/fleet/chat`);
    expect(missingHttp.status).toBe(404);
    const missingTool = await fetch(`${baseUrl}/api/fleet/tool`);
    expect(missingTool.status).toBe(404);
    const missingCkg = await fetch(`${baseUrl}/api/fleet/ckg`);
    expect(missingCkg.status).toBe(404);
  });
});
