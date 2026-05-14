import express from 'express';
import { createServer, type Server } from 'http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createChannelRoutes } from '../../src/server/routes/channels.js';
import { MockChannel, getChannelManager, resetChannelManager } from '../../src/channels/index.js';

describe('channel status routes', () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    resetChannelManager();
    const app = express();
    app.use('/api/channels', createChannelRoutes());

    await new Promise<void>((resolve) => {
      server = createServer(app);
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as { port: number };
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    await getChannelManager().shutdown();
    resetChannelManager();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('reports registered channel connectivity without config secrets', async () => {
    const manager = getChannelManager();
    const channel = new MockChannel({ type: 'telegram', token: 'secret-token' });
    manager.registerChannel(channel);
    await channel.connect();

    const resp = await fetch(`${baseUrl}/api/channels/status`);
    expect(resp.status).toBe(200);

    const body = await resp.json() as {
      total: number;
      connected: number;
      channels: Array<{ type: string; connected: boolean; authenticated: boolean; token?: string }>;
    };

    expect(body.total).toBe(1);
    expect(body.connected).toBe(1);
    expect(body.channels[0]).toMatchObject({
      type: 'telegram',
      connected: true,
      authenticated: true,
    });
    expect(body.channels[0]).not.toHaveProperty('token');
  });
});
