/**
 * Discord Channel Tests
 */

import { DiscordChannel } from '../../src/channels/discord/index.js';
import type { DiscordConfig } from '../../src/channels/discord/index.js';

// Mock WebSocket
jest.mock('ws', () => {
  const EventEmitter = require('events');
  return class MockWebSocket extends EventEmitter {
    static OPEN = 1;
    readyState = 1;
    send = jest.fn();
    close = jest.fn();
    ping = jest.fn();
  };
});

// Mock fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('DiscordChannel', () => {
  let channel: DiscordChannel;
  const mockConfig: DiscordConfig = {
    type: 'discord',
    enabled: true,
    token: 'test-bot-token',
    applicationId: 'test-app-id',
    intents: ['Guilds', 'GuildMessages', 'DirectMessages', 'MessageContent'],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    channel = new DiscordChannel(mockConfig);
  });

  afterEach(async () => {
    await channel.disconnect();
  });

  describe('constructor', () => {
    it('should create channel with config', () => {
      expect(channel.type).toBe('discord');
      expect(channel.getStatus().type).toBe('discord');
    });

    it('should throw error without token', () => {
      expect(() => {
        new DiscordChannel({ ...mockConfig, token: '' });
      }).toThrow('Discord bot token is required');
    });
  });

  describe('getStatus', () => {
    it('should return initial status', () => {
      const status = channel.getStatus();
      expect(status.type).toBe('discord');
      expect(status.connected).toBe(false);
      expect(status.authenticated).toBe(false);
    });
  });

  describe('disconnect', () => {
    it('should emit disconnected event', async () => {
      const disconnectedSpy = jest.fn();
      channel.on('disconnected', disconnectedSpy);

      await channel.disconnect();

      expect(disconnectedSpy).toHaveBeenCalledWith('discord');
    });
  });

  describe('send', () => {
    it('should send text message', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ id: '123456789' })),
      });

      const result = await channel.send({
        channelId: '987654321',
        content: 'Hello, Discord!',
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('123456789');
    });

    it('should send message with buttons', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ id: '123456789' })),
      });

      const result = await channel.send({
        channelId: '987654321',
        content: 'Click a button:',
        buttons: [
          { text: 'Action', type: 'callback', data: 'action_1' },
          { text: 'Link', type: 'url', url: 'https://example.com' },
        ],
      });

      expect(result.success).toBe(true);

      const lastCall = mockFetch.mock.calls[0];
      const body = JSON.parse(lastCall[1].body);
      expect(body.components).toBeDefined();
      expect(body.components[0].type).toBe(1); // Action row
      expect(body.components[0].components).toHaveLength(2);
    });

    it('should send message with reply reference', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ id: '123456789' })),
      });

      await channel.send({
        channelId: '987654321',
        content: 'Reply message',
        replyTo: '111111111',
      });

      const lastCall = mockFetch.mock.calls[0];
      const body = JSON.parse(lastCall[1].body);
      expect(body.message_reference).toEqual({ message_id: '111111111' });
    });

    it('should handle send error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        text: () => Promise.resolve('{"message": "Missing Access", "code": 50001}'),
      });

      const result = await channel.send({
        channelId: '987654321',
        content: 'Test',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Discord API error');
    });
  });

  describe('interaction handling', () => {
    it('should respond to interaction', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(''),
      });

      await channel.respondToInteraction(
        'interaction-123',
        'token-abc',
        'Hello from bot!',
        { ephemeral: true }
      );

      const lastCall = mockFetch.mock.calls[0];
      expect(lastCall[0]).toContain('/interactions/interaction-123/token-abc/callback');

      const body = JSON.parse(lastCall[1].body);
      expect(body.type).toBe(4);
      expect(body.data.content).toBe('Hello from bot!');
      expect(body.data.flags).toBe(64); // Ephemeral flag
    });

    it('should defer interaction', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(''),
      });

      await channel.deferInteraction('interaction-123', 'token-abc');

      const lastCall = mockFetch.mock.calls[0];
      const body = JSON.parse(lastCall[1].body);
      expect(body.type).toBe(5); // Deferred
    });

    it('should edit interaction response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(''),
      });

      await channel.editInteractionResponse(
        'app-123',
        'token-abc',
        'Updated message'
      );

      const lastCall = mockFetch.mock.calls[0];
      expect(lastCall[0]).toContain('/webhooks/app-123/token-abc/messages/@original');
      expect(lastCall[1].method).toBe('PATCH');
    });
  });

  describe('message operations', () => {
    it('should edit message', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(''),
      });

      await channel.editMessage('channel-123', 'message-456', 'Updated content');

      const lastCall = mockFetch.mock.calls[0];
      expect(lastCall[0]).toContain('/channels/channel-123/messages/message-456');
      expect(lastCall[1].method).toBe('PATCH');
    });

    it('should delete message', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(''),
      });

      await channel.deleteMessage('channel-123', 'message-456');

      const lastCall = mockFetch.mock.calls[0];
      expect(lastCall[1].method).toBe('DELETE');
    });

    it('should add reaction', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(''),
      });

      await channel.addReaction('channel-123', 'message-456', '👍');

      const lastCall = mockFetch.mock.calls[0];
      expect(lastCall[0]).toContain('reactions');
      expect(lastCall[1].method).toBe('PUT');
    });

    it('should send typing indicator', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(''),
      });

      await channel.sendTyping('channel-123');

      const lastCall = mockFetch.mock.calls[0];
      expect(lastCall[0]).toContain('/channels/channel-123/typing');
      expect(lastCall[1].method).toBe('POST');
    });
  });

  describe('user filtering', () => {
    it('should check user authorization', () => {
      channel = new DiscordChannel({
        ...mockConfig,
        allowedUsers: ['user-123', 'user-456'],
      });

      expect(channel['isUserAllowed']('user-123')).toBe(true);
      expect(channel['isUserAllowed']('user-789')).toBe(false);
    });

    it('should allow all users when no filter set', () => {
      expect(channel['isUserAllowed']('any-user')).toBe(true);
    });
  });

  describe('intent calculation', () => {
    it('should calculate correct intents bitmask', () => {
      const intents = channel['getIntents']();

      // Guilds (1) + GuildMessages (512) + DirectMessages (4096) + MessageContent (32768)
      expect(intents).toBe(1 | 512 | 4096 | 32768);
    });
  });
});
