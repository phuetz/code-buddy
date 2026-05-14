import { describe, expect, it, afterEach } from 'vitest';
import type { Server } from 'http';

import { startServer, stopServer } from '../../src/server/index.js';
import { MockChannel, getChannelManager, resetChannelManager } from '../../src/channels/index.js';

class BlockingDisconnectChannel extends MockChannel {
  readonly disconnectStarted: Promise<void>;
  private readonly disconnectRelease: Promise<void>;
  private markDisconnectStarted: () => void = () => {};
  private releaseDisconnect: () => void = () => {};
  disconnected = false;

  constructor() {
    super({ type: 'cli' });
    this.disconnectStarted = new Promise((resolve) => {
      this.markDisconnectStarted = resolve;
    });
    this.disconnectRelease = new Promise((resolve) => {
      this.releaseDisconnect = resolve;
    });
  }

  async disconnect(): Promise<void> {
    this.markDisconnectStarted();
    await this.disconnectRelease;
    await super.disconnect();
    this.disconnected = true;
  }

  release(): void {
    this.releaseDisconnect();
  }
}

describe('stopServer channel lifecycle', () => {
  let server: Server | null = null;

  afterEach(async () => {
    if (server?.listening) {
      await stopServer(server);
    }
    server = null;
    resetChannelManager();
  });

  it('waits for ChannelManager.shutdown before resolving', async () => {
    resetChannelManager();
    const started = await startServer({
      port: 0,
      host: '127.0.0.1',
      authEnabled: false,
      websocketEnabled: false,
      rateLimit: false,
    });
    server = started.server;

    const channel = new BlockingDisconnectChannel();
    await channel.connect();
    getChannelManager().registerChannel(channel);

    const stopPromise = stopServer(server);
    server = null;
    await channel.disconnectStarted;

    let resolved = false;
    stopPromise.then(() => {
      resolved = true;
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(resolved).toBe(false);

    channel.release();
    await stopPromise;

    expect(resolved).toBe(true);
    expect(channel.disconnected).toBe(true);
    expect(getChannelManager().getAllChannels()).toHaveLength(0);
  });
});
