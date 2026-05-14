import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'net';
import type { Server } from 'http';

import { startServer, stopServer } from '../../src/server/index.js';
import { createApiKey } from '../../src/server/auth/api-keys.js';
import { FleetListener } from '../../src/fleet/fleet-listener.js';

const previousJwtSecret = process.env.JWT_SECRET;
const previousPeerToolWorkspaceRoot = process.env.CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT;

async function startPeerSmokeServer(): Promise<{ server: Server; url: string }> {
  const started = await startServer({
    port: 0,
    host: '127.0.0.1',
    authEnabled: true,
    websocketEnabled: true,
    rateLimit: false,
  });
  const address = started.server.address() as AddressInfo;
  return {
    server: started.server,
    url: `ws://127.0.0.1:${address.port}/ws`,
  };
}

describe('peer WebSocket RPC smoke', () => {
  let server: Server | null = null;
  let listener: FleetListener | null = null;

  beforeEach(() => {
    process.env.JWT_SECRET = 'peer-websocket-smoke-secret';
    process.env.CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT = process.cwd();
  });

  afterEach(async () => {
    if (listener) {
      await listener.disconnect();
      listener = null;
    }
    if (server) {
      await stopServer(server);
      server = null;
    }
    if (previousJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousJwtSecret;
    if (previousPeerToolWorkspaceRoot === undefined) delete process.env.CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT;
    else process.env.CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT = previousPeerToolWorkspaceRoot;
  });

  it('lets an admin-scoped key invoke peer.ping over the real WebSocket path', async () => {
    const started = await startPeerSmokeServer();
    server = started.server;
    const { key } = createApiKey({
      name: 'Admin peer smoke',
      userId: 'peer-smoke-admin',
      scopes: ['admin'],
    });
    listener = new FleetListener({
      url: started.url,
      apiKey: key,
      authTimeoutMs: 5_000,
    });

    await listener.connect();
    const response = (await listener.request('peer.ping', {}, { timeoutMs: 5_000 })) as {
      pong?: boolean;
    };

    expect(response.pong).toBe(true);
  });

  it('lets an admin-scoped key invoke read-only peer tools over WebSocket', async () => {
    const started = await startPeerSmokeServer();
    server = started.server;
    const { key } = createApiKey({
      name: 'Admin peer tool smoke',
      userId: 'peer-smoke-tool-admin',
      scopes: ['admin'],
    });
    listener = new FleetListener({
      url: started.url,
      apiKey: key,
      authTimeoutMs: 5_000,
    });

    await listener.connect();
    const listing = await listener.invokeTool(
      'list_directory',
      { path: 'docs/reprise' },
      { timeoutMs: 5_000 }
    );
    const readme = await listener.invokeTool(
      'view_file',
      { file_path: 'docs/reprise/README.md', limit: 400 },
      { timeoutMs: 5_000 }
    );

    expect(listing.output).toContain('README.md');
    expect(readme.output).toContain('# Reprise Code Buddy');
  });

  it('returns a correlated FORBIDDEN peer response instead of timing out', async () => {
    const started = await startPeerSmokeServer();
    server = started.server;
    const { key } = createApiKey({
      name: 'Insufficient peer smoke',
      userId: 'peer-smoke-denied',
      scopes: ['fleet:listen'],
    });
    listener = new FleetListener({
      url: started.url,
      apiKey: key,
      authTimeoutMs: 5_000,
    });

    await listener.connect();

    await expect(listener.request('peer.ping', {}, { timeoutMs: 5_000 })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});
