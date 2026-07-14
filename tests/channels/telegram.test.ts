/**
 * Telegram Channel Tests
 */

import { TelegramChannel } from '../../src/channels/telegram/index.js';
import type { TelegramConfig, TelegramUpdate } from '../../src/channels/telegram/index.js';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

describe('TelegramChannel', () => {
  let channel: TelegramChannel;
  const mockConfig: TelegramConfig = {
    type: 'telegram',
    enabled: true,
    token: 'test-bot-token',
    pollingTimeout: 1,
    defaultParseMode: 'Markdown',
    enhancedCommands: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    channel = new TelegramChannel(mockConfig);
    channel.on('error', () => {}); // Prevent background polling errors from crashing tests
  });

  afterEach(async () => {
    await channel.disconnect();
  });

  describe('constructor', () => {
    it('should create channel with config', () => {
      expect(channel.type).toBe('telegram');
      expect(channel.getStatus().type).toBe('telegram');
    });

    it('should throw error without token', () => {
      expect(() => {
        new TelegramChannel({ ...mockConfig, token: '' });
      }).toThrow('Telegram bot token is required');
    });
  });

  describe('connect', () => {
    it('should connect and get bot info', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            ok: true,
            result: {
              id: 123456789,
              is_bot: true,
              first_name: 'TestBot',
              username: 'test_bot',
            },
          }),
      });

      // Mock deleteWebhook
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ ok: true }),
      });

      // Mock getUpdates (for polling)
      mockFetch.mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            ok: true,
            result: [],
          }),
      });

      await channel.connect();

      expect(channel.getStatus().connected).toBe(true);
      expect(channel.getStatus().authenticated).toBe(true);
      expect(channel.getStatus().info?.botUsername).toBe('test_bot');
    });

    it('should initialize enhanced commands under ESM', async () => {
      channel = new TelegramChannel({
        ...mockConfig,
        enhancedCommands: true,
      });
      channel.on('error', () => {});

      mockFetch.mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            ok: true,
            result: { id: 123, is_bot: true, first_name: 'Bot', username: 'bot' },
          }),
      });
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ ok: true }),
      });
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ ok: true }),
      });
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ ok: true, result: [] }),
      });

      await channel.connect();

      expect(mockFetch.mock.calls.some((call) => String(call[0]).includes('/setMyCommands'))).toBe(true);
    });

    it('should emit connected event', async () => {
      const connectedSpy = jest.fn();
      channel.on('connected', connectedSpy);

      mockFetch.mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            ok: true,
            result: { id: 123, is_bot: true, first_name: 'Bot', username: 'bot' },
          }),
      });
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ ok: true }),
      });
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ ok: true, result: [] }),
      });

      await channel.connect();

      expect(connectedSpy).toHaveBeenCalledWith('telegram');
    });

    it('should handle connection error', async () => {
      // Add error listener to prevent unhandled rejection
      channel.on('error', () => {});

      mockFetch.mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            ok: false,
            error_code: 401,
            description: 'Unauthorized',
          }),
      });

      await expect(channel.connect()).rejects.toThrow('Telegram API error');
    });
  });

  describe('disconnect', () => {
    it('should disconnect and emit event', async () => {
      const disconnectedSpy = jest.fn();
      channel.on('disconnected', disconnectedSpy);

      await channel.disconnect();

      expect(channel.getStatus().connected).toBe(false);
      expect(disconnectedSpy).toHaveBeenCalledWith('telegram');
    });
  });

  describe('send', () => {
    beforeEach(async () => {
      // Setup connected state
      mockFetch.mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            ok: true,
            result: { id: 123, is_bot: true, first_name: 'Bot', username: 'bot' },
          }),
      });
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ ok: true }),
      });
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ ok: true, result: [] }),
      });
      await channel.connect();
    });

    it('should send text message', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            ok: true,
            result: { message_id: 1 },
          }),
      });

      const result = await channel.send({
        channelId: '12345',
        content: 'Hello, World!',
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('1');
    });

    it('should send message with buttons', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            ok: true,
            result: { message_id: 2 },
          }),
      });

      const result = await channel.send({
        channelId: '12345',
        content: 'Choose an option:',
        buttons: [
          { text: 'Option A', type: 'callback', data: 'opt_a' },
          { text: 'Visit Site', type: 'url', url: 'https://example.com' },
        ],
      });

      expect(result.success).toBe(true);

      // Verify the fetch call included reply_markup
      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      const body = JSON.parse(lastCall[1].body);
      expect(body.reply_markup).toBeDefined();
      expect(body.reply_markup.inline_keyboard).toHaveLength(2);
    });

    it('should handle send error', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            ok: false,
            error_code: 400,
            description: 'Bad Request',
          }),
      });

      const result = await channel.send({
        channelId: '12345',
        content: 'Test',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Telegram API error');
    });
  });

  describe('webhook handling', () => {
    it('should handle webhook update', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      const update: TelegramUpdate = {
        update_id: 1,
        message: {
          message_id: 1,
          date: Math.floor(Date.now() / 1000),
          chat: {
            id: 12345,
            type: 'private',
            first_name: 'Test',
          },
          from: {
            id: 67890,
            is_bot: false,
            first_name: 'Test',
            username: 'testuser',
          },
          text: 'Hello bot!',
        },
      };

      const handled = await channel.handleWebhook(update);

      expect(handled).toBe(true);
      expect(messageSpy).toHaveBeenCalled();

      const message = messageSpy.mock.calls[0][0];
      expect(message.content).toBe('Hello bot!');
      expect(message.sender.username).toBe('testuser');
    });

    it('should reject invalid secret', async () => {
      channel = new TelegramChannel({
        ...mockConfig,
        webhookSecret: 'my-secret',
      });

      const update: TelegramUpdate = {
        update_id: 1,
        message: {
          message_id: 1,
          date: Math.floor(Date.now() / 1000),
          chat: { id: 1, type: 'private' },
          text: 'Test',
        },
      };

      const handled = await channel.handleWebhook(update, 'wrong-secret');

      expect(handled).toBe(false);
    });

    it('should parse commands', async () => {
      const commandSpy = jest.fn();
      channel.on('command', commandSpy);

      const update: TelegramUpdate = {
        update_id: 2,
        message: {
          message_id: 2,
          date: Math.floor(Date.now() / 1000),
          chat: { id: 12345, type: 'private' },
          from: { id: 67890, is_bot: false, first_name: 'Test' },
          text: '/start arg1 arg2',
        },
      };

      await channel.handleWebhook(update);

      expect(commandSpy).toHaveBeenCalled();

      const message = commandSpy.mock.calls[0][0];
      expect(message.isCommand).toBe(true);
      expect(message.commandName).toBe('start');
      expect(message.commandArgs).toEqual(['arg1', 'arg2']);
    });
  });

  describe('user/channel filtering', () => {
    it('should filter unauthorized users', async () => {
      channel = new TelegramChannel({
        ...mockConfig,
        allowedUsers: ['12345'],
      });

      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      const update: TelegramUpdate = {
        update_id: 1,
        message: {
          message_id: 1,
          date: Math.floor(Date.now() / 1000),
          chat: { id: 1, type: 'private' },
          from: { id: 99999, is_bot: false, first_name: 'Unauthorized' },
          text: 'Hello',
        },
      };

      await channel.handleWebhook(update);

      expect(messageSpy).not.toHaveBeenCalled();
    });

    it('should allow authorized users', async () => {
      channel = new TelegramChannel({
        ...mockConfig,
        allowedUsers: ['67890'],
      });

      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      const update: TelegramUpdate = {
        update_id: 1,
        message: {
          message_id: 1,
          date: Math.floor(Date.now() / 1000),
          chat: { id: 1, type: 'private' },
          from: { id: 67890, is_bot: false, first_name: 'Authorized' },
          text: 'Hello',
        },
      };

      await channel.handleWebhook(update);

      expect(messageSpy).toHaveBeenCalled();
    });
  });

  describe('message type detection', () => {
    it('should detect image messages', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      const update: TelegramUpdate = {
        update_id: 1,
        message: {
          message_id: 1,
          date: Math.floor(Date.now() / 1000),
          chat: { id: 1, type: 'private' },
          from: { id: 1, is_bot: false, first_name: 'Test' },
          photo: [
            { file_id: 'small', file_unique_id: '1', width: 100, height: 100 },
            { file_id: 'large', file_unique_id: '2', width: 800, height: 600 },
          ],
          caption: 'Nice photo!',
        },
      };

      await channel.handleWebhook(update);

      const message = messageSpy.mock.calls[0][0];
      expect(message.contentType).toBe('image');
      expect(message.content).toBe('Nice photo!');
      expect(message.attachments).toHaveLength(1);
      expect(message.attachments[0].type).toBe('image');
    });

    it('keeps a photo without a caption actionable', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      await channel.handleWebhook({
        update_id: 3,
        message: {
          message_id: 3,
          date: Math.floor(Date.now() / 1000),
          chat: { id: 1, type: 'private' },
          from: { id: 1, is_bot: false, first_name: 'Test' },
          photo: [{ file_id: 'photo', file_unique_id: '3', width: 800, height: 600 }],
        },
      });

      expect(messageSpy).toHaveBeenCalledOnce();
      expect(messageSpy.mock.calls[0][0].content).toBe('Analyse cette photo.');
    });

    it('groups every photo in a Telegram album into one multimodal turn', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);
      const base = {
        date: Math.floor(Date.now() / 1000),
        chat: { id: 1, type: 'private' as const },
        from: { id: 1, is_bot: false, first_name: 'Test' },
        media_group_id: 'album-1',
      };

      await channel.handleWebhook({
        update_id: 4,
        message: {
          ...base,
          message_id: 4,
          caption: 'Analyse ce produit thaïlandais',
          photo: [{ file_id: 'front', file_unique_id: '4', width: 800, height: 600 }],
        },
      });
      await channel.handleWebhook({
        update_id: 5,
        message: {
          ...base,
          message_id: 5,
          photo: [{ file_id: 'back', file_unique_id: '5', width: 800, height: 600 }],
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 520));

      expect(messageSpy).toHaveBeenCalledOnce();
      const message = messageSpy.mock.calls[0][0];
      expect(message.content).toBe('Analyse ce produit thaïlandais');
      expect(message.attachments).toHaveLength(2);
      expect(message.raw).toHaveLength(2);
    });

    it('should detect location messages', async () => {
      const messageSpy = jest.fn();
      channel.on('message', messageSpy);

      const update: TelegramUpdate = {
        update_id: 1,
        message: {
          message_id: 1,
          date: Math.floor(Date.now() / 1000),
          chat: { id: 1, type: 'private' },
          from: { id: 1, is_bot: false, first_name: 'Test' },
          location: { latitude: 51.5074, longitude: -0.1278 },
        },
      };

      await channel.handleWebhook(update);

      const message = messageSpy.mock.calls[0][0];
      expect(message.contentType).toBe('location');
      expect(message.attachments).toHaveLength(1);
      expect(message.attachments[0].type).toBe('location');
    });
  });
});
