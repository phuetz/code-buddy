import { describe, expect, it } from 'vitest';
import { channelCompanionSessionKey } from '../../src/channels/channel-companion-session.js';

describe('channelCompanionSessionKey', () => {
  it('keeps an explicit session key', () => {
    expect(channelCompanionSessionKey({ sessionKey: 'telegram:42' })).toBe('telegram:42');
  });

  it('builds a stable key from chat and sender', () => {
    const key = channelCompanionSessionKey({
      channelType: 'telegram',
      chatId: '99',
      senderId: '7',
      env: {},
    });
    expect(key).toContain('99');
  });
});
