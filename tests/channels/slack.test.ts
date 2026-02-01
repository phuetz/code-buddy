/**
 * Slack Channel Tests
 */

import { SlackChannel } from '../../src/channels/slack/index.js';
import type { SlackConfig, SlackEventCallback, SlackEvent } from '../../src/channels/slack/index.js';
import crypto from 'crypto';

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

describe('SlackChannel', () => {
  let channel: SlackChannel;
  const mockConfig: SlackConfig = {
    type: 'slack',
    enabled: true,
    token: 'xoxb-test-token',
    signingSecret: 'test-signing-secret',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    channel = new SlackChannel(mockConfig);
  });

  afterEach(async () => {
    await channel.disconnect();
  });

  describe('constructor', () => {
    it('should create channel with config', () => {
      expect(channel.type).toBe('slack');
      expect(channel.getStatus().type).toBe('slack');
    });

    it('should throw error without token', () => {
      expect(() => {
        new SlackChannel({ ...mockConfig, token: '' });
      }).toThrow('Slack bot token is required');
    });
  });

  describe('connect', () => {
    it('should connect and authenticate', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            ok: true,
            user_id: 'U12345',
            user: 'testbot',
            team: 'Test Team',
            team_id: 'T12345',
          }),
      });

      await channel.connect();

      expect(channel.getStatus().connected).toBe(true);
      expect(channel.getStatus().authenticated).toBe(true);
      expect(channel.getStatus().info?.botId).toBe('U12345');
    });

    it('should emit connected event', async () => {
      const connectedSpy = jest.fn();
      channel.on('connected', connectedSpy);

      mockFetch.mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            ok: true,
            user_id: 'U12345',
            user: 'testbot',
            team: 'Test Team',
            team_id: 'T12345',
          }),
      });

      await channel.connect();

      expect(connectedSpy).toHaveBeenCalledWith('slack');
    });

    it('should handle connection error', async () => {
      // Add error listener to prevent unhandled rejection
      channel.on('error', () => {});

      mockFetch.mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            ok: false,
            error: 'invalid_auth',
          }),
      });

      await expect(channel.connect()).rejects.toThrow('Slack API error');
    });
  });

  describe('disconnect', () => {
    it('should disconnect and emit event', async () => {
      const disconnectedSpy = jest.fn();
      channel.on('disconnected', disconnectedSpy);

      await channel.disconnect();

      expect(disconnectedSpy).toHaveBeenCalledWith('slack');
    });
  });

  describe('send', () => {
    it('should send text message', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            ok: true,
            ts: '1234567890.123456',
            channel: 'C12345',
          }),
      });

      const result = await channel.send({
        channelId: 'C12345',
        content: 'Hello, Slack!',
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('1234567890.123456');
    });

    it('should send message with buttons', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            ok: true,
            ts: '1234567890.123456',
            channel: 'C12345',
          }),
      });

      await channel.send({
        channelId: 'C12345',
        content: 'Click a button:',
        buttons: [
          { text: 'Action', type: 'callback', data: 'action_1' },
          { text: 'Link', type: 'url', url: 'https://example.com' },
        ],
      });

      const lastCall = mockFetch.mock.calls[0];
      const body = JSON.parse(lastCall[1].body);
      expect(body.blocks).toBeDefined();
      expect(body.blocks[0].type).toBe('actions');
      expect(body.blocks[0].elements).toHaveLength(2);
    });

    it('should send threaded message', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            ok: true,
            ts: '1234567890.123456',
            channel: 'C12345',
          }),
      });

      await channel.send({
        channelId: 'C12345',
        content: 'Thread reply',
        threadId: '1234567890.000001',
      });

      const lastCall = mockFetch.mock.calls[0];
      const body = JSON.parse(lastCall[1].body);
      expect(body.thread_ts).toBe('1234567890.000001');
    });

    it('should handle send error', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            ok: false,
            error: 'channel_not_found',
          }),
      });

      const result = await channel.send({
        channelId: 'C12345',
        content: 'Test',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Slack API error');
    });
  });

  describe('webhook handling', () => {
    it('should handle URL verification challenge', async () => {
      const challenge = await channel.handleWebhook({
        type: 'url_verification',
        challenge: 'test-challenge-string',
      } as any);

      expect(challenge).toBe('test-challenge-string');
    });

    it('should handle message event', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      // Mock user info
      mockFetch.mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            ok: true,
            user: {
              id: 'U12345',
              name: 'testuser',
              profile: { display_name: 'Test User' },
            },
          }),
      });

      // Mock channel info
      mockFetch.mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            ok: true,
            channel: { id: 'C12345', name: 'general' },
          }),
      });

      const event: SlackEventCallback = {
        type: 'event_callback',
        team_id: 'T12345',
        api_app_id: 'A12345',
        event_id: 'Ev12345',
        event_time: Date.now(),
        event: {
          type: 'message',
          user: 'U12345',
          channel: 'C12345',
          text: 'Hello!',
          ts: '1234567890.123456',
        },
      };

      await channel.handleWebhook(event);

      expect(messageSpy).toHaveBeenCalled();
      const message = messageSpy.mock.calls[0][0];
      expect(message.content).toBe('Hello!');
    });

    it('should verify request signature', async () => {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const body = JSON.stringify({ type: 'event_callback', event: {} });

      const sigBasestring = `v0:${timestamp}:${body}`;
      const signature = 'v0=' + crypto
        .createHmac('sha256', mockConfig.signingSecret!)
        .update(sigBasestring)
        .digest('hex');

      // This should not throw
      await expect(
        channel.handleWebhook(JSON.parse(body), signature, timestamp)
      ).resolves.not.toThrow();
    });

    it('should reject invalid signature', async () => {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const body = JSON.stringify({ type: 'event_callback', event: {} });

      // Create a valid-length but wrong signature
      const wrongSignature = 'v0=' + 'a'.repeat(64);

      await expect(
        channel.handleWebhook(
          JSON.parse(body),
          wrongSignature,
          timestamp
        )
      ).rejects.toThrow('Invalid request signature');
    });

    it('should ignore bot messages', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      const event: SlackEventCallback = {
        type: 'event_callback',
        team_id: 'T12345',
        api_app_id: 'A12345',
        event_id: 'Ev12345',
        event_time: Date.now(),
        event: {
          type: 'message',
          bot_id: 'B12345',
          channel: 'C12345',
          text: 'Bot message',
          ts: '1234567890.123456',
        },
      };

      await channel.handleWebhook(event);

      expect(messageSpy).not.toHaveBeenCalled();
    });
  });

  describe('message operations', () => {
    it('should update message', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ ok: true }),
      });

      await channel.updateMessage('C12345', '1234567890.123456', 'Updated text');

      const lastCall = mockFetch.mock.calls[0];
      expect(lastCall[0]).toContain('chat.update');
      const body = JSON.parse(lastCall[1].body);
      expect(body.text).toBe('Updated text');
    });

    it('should delete message', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ ok: true }),
      });

      await channel.deleteMessage('C12345', '1234567890.123456');

      const lastCall = mockFetch.mock.calls[0];
      expect(lastCall[0]).toContain('chat.delete');
    });

    it('should add reaction', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ ok: true }),
      });

      await channel.addReaction('C12345', '1234567890.123456', ':thumbsup:');

      const lastCall = mockFetch.mock.calls[0];
      expect(lastCall[0]).toContain('reactions.add');
      const body = JSON.parse(lastCall[1].body);
      expect(body.name).toBe('thumbsup');
    });

    it('should send ephemeral message', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ ok: true }),
      });

      await channel.sendEphemeral('C12345', 'U67890', 'Only you can see this');

      const lastCall = mockFetch.mock.calls[0];
      expect(lastCall[0]).toContain('chat.postEphemeral');
      const body = JSON.parse(lastCall[1].body);
      expect(body.user).toBe('U67890');
    });
  });

  describe('modals', () => {
    it('should open modal', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ ok: true }),
      });

      await channel.openModal('trigger-123', {
        title: 'Test Modal',
        blocks: [],
        submit: 'Submit',
        close: 'Cancel',
        callbackId: 'test-modal',
      });

      const lastCall = mockFetch.mock.calls[0];
      expect(lastCall[0]).toContain('views.open');
      const body = JSON.parse(lastCall[1].body);
      expect(body.view.type).toBe('modal');
      expect(body.view.title.text).toBe('Test Modal');
    });
  });

  describe('user filtering', () => {
    it('should check user authorization', () => {
      channel = new SlackChannel({
        ...mockConfig,
        allowedUsers: ['U12345', 'U67890'],
      });

      expect(channel['isUserAllowed']('U12345')).toBe(true);
      expect(channel['isUserAllowed']('U99999')).toBe(false);
    });
  });
});
