/**
 * GAP-7 P2 — inbound channel intake on server startup.
 *
 * `startConfiguredChannels` is what `buddy server` calls at boot (gated by
 * CODEBUDDY_SERVER_CHANNEL_INTAKE) so two-way messaging works without a
 * separately-started `buddy channels` process. These tests pin: the inbound AI
 * receiver loop is wired regardless, enabled channels connect, disabled channels
 * are skipped, and missing config is reported (not crashed).
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const hoisted = vi.hoisted(() => ({
  onMessage: vi.fn(),
  registerChannel: vi.fn(),
  unregisterChannel: vi.fn(),
  getChannel: vi.fn(),
  connect: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn().mockResolvedValue(undefined),
  telegramConfigs: [] as unknown[],
}));

vi.mock('../../src/channels/index.js', () => ({
  getChannelManager: () => ({
    onMessage: hoisted.onMessage,
    registerChannel: hoisted.registerChannel,
    unregisterChannel: hoisted.unregisterChannel,
    getChannel: hoisted.getChannel,
  }),
}));

vi.mock('../../src/channels/telegram/index.js', () => ({
  TelegramChannel: class {
    connect = hoisted.connect;
    disconnect = hoisted.disconnect;
    constructor(config: unknown) {
      hoisted.telegramConfigs.push(config);
    }
  },
}));

import {
  startConfiguredChannels,
  __resetChannelAIHandlerForTests,
} from '../../src/commands/handlers/channel-handlers.js';

const tmpFiles: string[] = [];
function writeConfig(config: unknown): string {
  const file = path.join(os.tmpdir(), `channels-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(file, JSON.stringify(config), 'utf-8');
  tmpFiles.push(file);
  return file;
}

describe('startConfiguredChannels server intake (GAP-7 P2)', () => {
  beforeEach(() => {
    __resetChannelAIHandlerForTests();
    vi.clearAllMocks();
    hoisted.getChannel.mockReturnValue(undefined);
    hoisted.telegramConfigs.length = 0;
  });

  afterAll(() => {
    for (const f of tmpFiles) {
      try { fs.unlinkSync(f); } catch { /* best effort */ }
    }
  });

  it('starts an enabled channel and wires the inbound AI receiver loop', async () => {
    const cfg = writeConfig({ channels: [{ type: 'telegram', enabled: true, token: 'bot-token' }] });

    const result = await startConfiguredChannels(cfg);

    // Inbound handler wired at boot…
    expect(hoisted.onMessage).toHaveBeenCalledTimes(1);
    // …enabled channel registered + connected.
    expect(result.registered).toEqual(['telegram']);
    expect(result.skipped).toEqual([]);
    expect(result.noConfig).toBe(false);
    expect(hoisted.registerChannel).toHaveBeenCalledTimes(1);
    expect(hoisted.connect).toHaveBeenCalledTimes(1);
  });

  it('skips a disabled channel but still wires the inbound handler', async () => {
    const cfg = writeConfig({ channels: [{ type: 'telegram', enabled: false }] });

    const result = await startConfiguredChannels(cfg);

    expect(hoisted.onMessage).toHaveBeenCalledTimes(1); // handler still wired
    expect(result.registered).toEqual([]);
    expect(result.skipped).toEqual(['telegram']);
    expect(hoisted.registerChannel).not.toHaveBeenCalled();
    expect(hoisted.connect).not.toHaveBeenCalled();
  });

  it('reports noConfig (does not crash) when the config file is missing', async () => {
    const result = await startConfiguredChannels(path.join(os.tmpdir(), 'does-not-exist-channels.json'));

    expect(result.noConfig).toBe(true);
    expect(result.registered).toEqual([]);
    // Even with no channels, the inbound loop is wired so a later-started channel works.
    expect(hoisted.onMessage).toHaveBeenCalledTimes(1);
  });

  it('collapses duplicate channel types and uses only the last declaration', async () => {
    const cfg = writeConfig({
      channels: [
        { type: 'telegram', enabled: true, token: 'obsolete-token' },
        { type: 'telegram', enabled: true, token: 'active-token', options: { name: 'Lisa' } },
      ],
    });

    const result = await startConfiguredChannels(cfg, 'telegram');

    expect(result.registered).toEqual(['telegram']);
    expect(result.deduplicated).toEqual(['telegram']);
    expect(hoisted.registerChannel).toHaveBeenCalledTimes(1);
    expect(hoisted.connect).toHaveBeenCalledTimes(1);
    expect(hoisted.telegramConfigs).toHaveLength(1);
    expect(hoisted.telegramConfigs[0]).toMatchObject({ token: 'active-token' });
  });

  it('selects one named instance before duplicate-type collapsing', async () => {
    const cfg = writeConfig({
      channels: [
        { type: 'telegram', enabled: true, token: 'lisa-token' },
        {
          type: 'telegram',
          enabled: true,
          token: 'laura-token',
          options: { name: 'Laura' },
        },
      ],
    });

    const lisa = await startConfiguredChannels(cfg, 'telegram', 'default');

    expect(lisa.registered).toEqual(['telegram']);
    expect(lisa.deduplicated).toEqual([]);
    expect(hoisted.telegramConfigs).toHaveLength(1);
    expect(hoisted.telegramConfigs[0]).toMatchObject({ token: 'lisa-token' });
  });

  it('reports no matching config for an unknown named instance', async () => {
    const cfg = writeConfig({
      channels: [
        { type: 'telegram', enabled: true, token: 'lisa-token' },
        {
          type: 'telegram',
          enabled: true,
          token: 'laura-token',
          options: { name: 'Laura' },
        },
      ],
    });

    const result = await startConfiguredChannels(cfg, 'telegram', 'unknown');

    expect(result.noConfig).toBe(true);
    expect(result.registered).toEqual([]);
    expect(hoisted.registerChannel).not.toHaveBeenCalled();
  });

  it('disconnects an existing runtime before replacing the same channel type', async () => {
    const existing = { disconnect: hoisted.disconnect };
    hoisted.getChannel.mockReturnValue(existing);
    const cfg = writeConfig({ channels: [{ type: 'telegram', enabled: true, token: 'new-token' }] });

    const result = await startConfiguredChannels(cfg, 'telegram');

    expect(result.registered).toEqual(['telegram']);
    expect(hoisted.disconnect).toHaveBeenCalledTimes(1);
    expect(hoisted.unregisterChannel).toHaveBeenCalledWith('telegram');
    expect(hoisted.registerChannel).toHaveBeenCalledTimes(1);
  });

  it('unregisters a channel whose connect() failed (jumeau D7)', async () => {
    hoisted.connect.mockRejectedValueOnce(new Error('auth failed'));
    const cfg = writeConfig({ channels: [{ type: 'telegram', enabled: true, token: 'bot-token' }] });

    const result = await startConfiguredChannels(cfg);

    expect(result.registered).toEqual([]);
    expect(result.failed).toEqual([{ type: 'telegram', error: 'auth failed' }]);
    expect(hoisted.registerChannel).toHaveBeenCalledTimes(1);
    expect(hoisted.unregisterChannel).toHaveBeenCalledWith('telegram');
  });
});
