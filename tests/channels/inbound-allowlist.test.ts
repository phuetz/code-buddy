/**
 * A-2 — `allowedUsers` must reach Telegram/Discord/Slack adapters, and an
 * unknown sender without allowlist and without pairing is fail-closed.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  isOnStaticAllowlist,
  resolveInboundSenderAccess,
  UNPAIRED_SENDER_REPLY,
  resetDMPairing,
  getDMPairing,
} from '../../src/channels/core.js';
import { instantiateChannel } from '../../src/commands/handlers/channel-handlers.js';
import { TelegramChannel } from '../../src/channels/telegram/index.js';
import type { TelegramUpdate } from '../../src/channels/telegram/index.js';

describe('inbound allowlist helpers', () => {
  it('matches numeric ids and @username, ignoring case', () => {
    expect(isOnStaticAllowlist(['123456789', '@Exemple_User'], ['123456789'])).toBe(true);
    expect(isOnStaticAllowlist(['123456789', 'exemple_user'], ['', 'Exemple_User'])).toBe(true);
    expect(isOnStaticAllowlist(['123456789'], ['999'])).toBe(false);
    expect(isOnStaticAllowlist(undefined, ['123456789'])).toBe(false);
    expect(isOnStaticAllowlist([], ['123456789'])).toBe(false);
  });

  it('allowlist members skip pairing; others pair or are refused', () => {
    expect(
      resolveInboundSenderAccess({
        allowedUsers: ['4242'],
        identities: ['4242'],
        pairingRequired: true,
      }),
    ).toBe('allow');
    expect(
      resolveInboundSenderAccess({
        allowedUsers: ['4242'],
        identities: ['99'],
        pairingRequired: true,
      }),
    ).toBe('pair');
    expect(
      resolveInboundSenderAccess({
        identities: ['99'],
        pairingRequired: false,
      }),
    ).toBe('refuse');
    expect(
      resolveInboundSenderAccess({
        identities: ['99'],
        pairingRequired: true,
        pairingApproved: true,
      }),
    ).toBe('allow');
  });
});

describe('instantiateChannel forwards allowedUsers', () => {
  afterEach(() => {
    resetDMPairing();
  });

  it('puts the root allowlist on the Telegram adapter', async () => {
    const channel = await instantiateChannel({
      type: 'telegram',
      enabled: true,
      token: '123456:factory-test-token',
      allowedUsers: ['424242424', '@exemple_user'],
      options: { pollingTimeout: 1 },
    });
    expect(channel).not.toBeNull();
    expect(channel!.getAllowedUsers()).toEqual(['424242424', '@exemple_user']);
    expect(channel!.isUserAllowed('424242424')).toBe(true);
    expect(channel!.isUserAllowed('exemple_user')).toBe(true);
    expect(channel!.isUserAllowed('999')).toBe(false);
    await channel?.disconnect();
  });

  it('puts the root allowlist on Discord and Slack adapters', async () => {
    const discord = await instantiateChannel({
      type: 'discord',
      enabled: true,
      token: 'discord-test-token',
      allowedUsers: ['user-123'],
    });
    const slack = await instantiateChannel({
      type: 'slack',
      enabled: true,
      token: 'xoxb-test-token',
      allowedUsers: ['U12345'],
    });
    expect(discord!.getAllowedUsers()).toEqual(['user-123']);
    expect(slack!.getAllowedUsers()).toEqual(['U12345']);
    await discord?.disconnect();
    await slack?.disconnect();
  });
});

describe('Telegram refuse without allowlist and without pairing', () => {
  afterEach(() => {
    resetDMPairing();
  });

  it('sends the polite line and does not emit a message for the LLM', async () => {
    resetDMPairing();
    getDMPairing({ enabled: false, allowlistPath: undefined });
    const channel = new TelegramChannel({
      type: 'telegram',
      enabled: true,
      token: '123456:refuse-test-token',
      pollingTimeout: 1,
    });
    const messageSpy = vi.fn();
    channel.on('message', messageSpy);
    const sent: string[] = [];
    vi.spyOn(channel, 'send').mockImplementation(async (outbound) => {
      sent.push(outbound.content);
      return { success: true, timestamp: new Date() };
    });

    const update: TelegramUpdate = {
      update_id: 1,
      message: {
        message_id: 1,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 99, type: 'private' },
        from: { id: 99, is_bot: false, first_name: 'Inconnu' },
        text: 'Réponds PONG',
      },
    };
    await channel.handleWebhook(update);
    expect(messageSpy).not.toHaveBeenCalled();
    expect(sent).toEqual([UNPAIRED_SENDER_REPLY]);
    await channel.disconnect();
  });

  it('lets an allowlisted numeric id through without pairing', async () => {
    resetDMPairing();
    getDMPairing({ enabled: false, allowlistPath: undefined });
    const channel = new TelegramChannel({
      type: 'telegram',
      enabled: true,
      token: '123456:allow-test-token',
      pollingTimeout: 1,
      allowedUsers: ['4242'],
    });
    const messageSpy = vi.fn();
    channel.on('message', messageSpy);
    const update: TelegramUpdate = {
      update_id: 2,
      message: {
        message_id: 2,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 4242, type: 'private' },
        from: { id: 4242, is_bot: false, first_name: 'Owner' },
        text: 'salut',
      },
    };
    await channel.handleWebhook(update);
    expect(messageSpy).toHaveBeenCalledTimes(1);
    await channel.disconnect();
  });
});
