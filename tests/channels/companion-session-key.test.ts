import { describe, expect, it } from 'vitest';
import { channelCompanionSessionKey } from '../../src/channels/channel-companion-session.js';

describe('channel companion session key', () => {
  it('is stable for the same chat', () => {
    const a = channelCompanionSessionKey({
      channelType: 'telegram',
      chatId: '42',
      senderId: '7',
    });
    const b = channelCompanionSessionKey({
      channelType: 'telegram',
      chatId: '42',
      senderId: '7',
    });
    expect(a).toBe(b);
    expect(a).toMatch(/telegram/);
  });

  it('differs across chats', () => {
    const a = channelCompanionSessionKey({ channelType: 'telegram', chatId: '1' });
    const b = channelCompanionSessionKey({ channelType: 'telegram', chatId: '2' });
    expect(a).not.toBe(b);
  });
});
