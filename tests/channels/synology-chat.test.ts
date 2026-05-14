import { describe, expect, it, vi } from 'vitest';
import { SynologyChatAdapter } from '../../src/channels/synology-chat/index.js';
import type { SynologyChatClient } from '../../src/channels/synology-chat/index.js';

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const createClient = (): SynologyChatClient => ({
  start: async () => undefined,
  stop: async () => undefined,
  sendMessage: async () => ({ success: true, messageId: 'synology-message-1' }),
  sendDirectMessage: async () => ({ success: true, messageId: 'synology-dm-1' }),
});

describe('SynologyChatAdapter', () => {
  it('rejects connection without a Synology Chat client', async () => {
    const adapter = new SynologyChatAdapter({
      incomingWebhookUrl: 'https://synology.example/webhook',
    });

    await expect(adapter.start()).rejects.toThrow('Synology Chat client is not configured');
  });

  it('delegates message sends to the configured client', async () => {
    const adapter = new SynologyChatAdapter({
      incomingWebhookUrl: 'https://synology.example/webhook',
      client: createClient(),
    });

    await adapter.start();
    const result = await adapter.sendMessage('hello', 'https://example.com/file.txt');

    expect(result).toEqual({ success: true, messageId: 'synology-message-1' });
    await adapter.stop();
  });

  it('delegates direct messages to the configured client', async () => {
    const adapter = new SynologyChatAdapter({
      incomingWebhookUrl: 'https://synology.example/webhook',
      client: createClient(),
    });

    await adapter.start();
    const result = await adapter.sendDirectMessage(42, 'hello');

    expect(result).toEqual({ success: true, messageId: 'synology-dm-1' });
    await adapter.stop();
  });
});
