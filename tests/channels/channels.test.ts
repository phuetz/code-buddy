/**
 * Multi-Channel Support Tests
 */

import {
  MockChannel,
  ChannelManager,
  getChannelManager,
  resetChannelManager,
  type InboundMessage,
  type OutboundMessage,
  type BaseChannel,
} from '../../src/channels/index.js';

describe('Multi-Channel Support', () => {
  describe('MockChannel', () => {
    let channel: MockChannel;

    beforeEach(() => {
      channel = new MockChannel();
    });

    afterEach(async () => {
      await channel.disconnect();
    });

    it('should connect successfully', async () => {
      await channel.connect();

      expect(channel.getStatus().connected).toBe(true);
      expect(channel.getStatus().authenticated).toBe(true);
    });

    it('should emit connected event', async () => {
      const events: string[] = [];
      channel.on('connected', (type) => events.push(type));

      await channel.connect();

      expect(events).toContain('cli');
    });

    it('should disconnect successfully', async () => {
      await channel.connect();
      await channel.disconnect();

      expect(channel.getStatus().connected).toBe(false);
    });

    it('should emit disconnected event', async () => {
      const events: string[] = [];
      channel.on('disconnected', (type) => events.push(type));

      await channel.connect();
      await channel.disconnect();

      expect(events).toContain('cli');
    });

    it('should send message', async () => {
      await channel.connect();

      const result = await channel.send({
        channelId: 'test',
        content: 'Hello World',
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBeDefined();
    });

    it('should track sent messages', async () => {
      await channel.connect();

      await channel.send({ channelId: 'test', content: 'Message 1' });
      await channel.send({ channelId: 'test', content: 'Message 2' });

      const sent = channel.getSentMessages();
      expect(sent.length).toBe(2);
      expect(sent[0].content).toBe('Message 1');
    });

    it('should simulate incoming message', async () => {
      await channel.connect();

      const received: InboundMessage[] = [];
      channel.on('message', (msg) => received.push(msg));

      channel.simulateMessage('Hello from user');

      expect(received.length).toBe(1);
      expect(received[0].content).toBe('Hello from user');
    });

    it('should parse commands', async () => {
      await channel.connect();

      const commands: InboundMessage[] = [];
      channel.on('command', (msg) => commands.push(msg));

      channel.simulateMessage('/help arg1 arg2');

      expect(commands.length).toBe(1);
      expect(commands[0].isCommand).toBe(true);
      expect(commands[0].commandName).toBe('help');
      expect(commands[0].commandArgs).toEqual(['arg1', 'arg2']);
    });

    it('should not parse non-commands', async () => {
      await channel.connect();

      const message = channel.simulateMessage('Regular message');

      expect(message.isCommand).toBeFalsy();
      expect(message.commandName).toBeUndefined();
    });

    it('should track received messages', async () => {
      await channel.connect();

      channel.simulateMessage('Message 1');
      channel.simulateMessage('Message 2');

      const messages = channel.getMessages();
      expect(messages.length).toBe(2);
    });

    it('should clear messages', async () => {
      await channel.connect();

      channel.simulateMessage('Test');
      await channel.send({ channelId: 'test', content: 'Test' });

      channel.clear();

      expect(channel.getMessages().length).toBe(0);
      expect(channel.getSentMessages().length).toBe(0);
    });

    it('should check allowed users', () => {
      const restricted = new MockChannel({
        type: 'cli',
        enabled: true,
        allowedUsers: ['user1', 'user2'],
      });

      expect(restricted.isUserAllowed('user1')).toBe(true);
      expect(restricted.isUserAllowed('user3')).toBe(false);
    });

    it('should allow all users when no restriction', () => {
      expect(channel.isUserAllowed('anyone')).toBe(true);
    });

    it('should check allowed channels', () => {
      const restricted = new MockChannel({
        type: 'cli',
        enabled: true,
        allowedChannels: ['channel1'],
      });

      expect(restricted.isChannelAllowed('channel1')).toBe(true);
      expect(restricted.isChannelAllowed('channel2')).toBe(false);
    });
  });

  describe('ChannelManager', () => {
    let manager: ChannelManager;
    let channel1: MockChannel;
    let channel2: MockChannel;

    beforeEach(() => {
      manager = new ChannelManager();
      channel1 = new MockChannel({ type: 'cli', enabled: true });
      channel2 = new MockChannel({ type: 'web', enabled: true });
    });

    afterEach(async () => {
      await manager.shutdown();
    });

    it('should register channel', () => {
      manager.registerChannel(channel1);

      expect(manager.getChannel('cli')).toBe(channel1);
    });

    it('should unregister channel', () => {
      manager.registerChannel(channel1);
      manager.unregisterChannel('cli');

      expect(manager.getChannel('cli')).toBeUndefined();
    });

    it('should get all channels', () => {
      manager.registerChannel(channel1);
      manager.registerChannel(channel2);

      const channels = manager.getAllChannels();
      expect(channels.length).toBe(2);
    });

    it('should connect all channels', async () => {
      manager.registerChannel(channel1);
      manager.registerChannel(channel2);

      await manager.connectAll();

      expect(channel1.getStatus().connected).toBe(true);
      expect(channel2.getStatus().connected).toBe(true);
    });

    it('should disconnect all channels', async () => {
      manager.registerChannel(channel1);
      manager.registerChannel(channel2);

      await manager.connectAll();
      await manager.disconnectAll();

      expect(channel1.getStatus().connected).toBe(false);
      expect(channel2.getStatus().connected).toBe(false);
    });

    it('should get status of all channels', async () => {
      manager.registerChannel(channel1);
      await channel1.connect();

      const status = manager.getStatus();

      expect(status.cli).toBeDefined();
      expect(status.cli.connected).toBe(true);
    });

    it('should send to specific channel', async () => {
      manager.registerChannel(channel1);
      await channel1.connect();

      const result = await manager.send('cli', {
        channelId: 'test',
        content: 'Hello',
      });

      expect(result.success).toBe(true);
    });

    it('should return error for unknown channel', async () => {
      const result = await manager.send('telegram', {
        channelId: 'test',
        content: 'Hello',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should broadcast to all connected channels', async () => {
      manager.registerChannel(channel1);
      manager.registerChannel(channel2);

      await manager.connectAll();

      const results = await manager.broadcast({ content: 'Broadcast message' });

      expect(results.size).toBe(2);
      expect(results.get('cli')?.success).toBe(true);
    });

    it('should forward message events', async () => {
      manager.registerChannel(channel1);
      await channel1.connect();

      const messages: InboundMessage[] = [];
      manager.on('message', (msg) => messages.push(msg));

      channel1.simulateMessage('Test message');

      expect(messages.length).toBe(1);
    });

    it('should forward command events', async () => {
      manager.registerChannel(channel1);
      await channel1.connect();

      const commands: InboundMessage[] = [];
      manager.on('command', (msg) => commands.push(msg));

      channel1.simulateMessage('/test command');

      expect(commands.length).toBe(1);
    });

    it('should call message handlers', async () => {
      manager.registerChannel(channel1);
      await channel1.connect();

      const handled: InboundMessage[] = [];
      manager.onMessage(async (msg) => {
        handled.push(msg);
      });

      channel1.simulateMessage('Test');

      // Wait for async handler
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(handled.length).toBe(1);
    });

    it('should emit channel-connected event', async () => {
      manager.registerChannel(channel1);

      const events: string[] = [];
      manager.on('channel-connected', (type) => events.push(type));

      await channel1.connect();

      expect(events).toContain('cli');
    });

    it('should emit channel-disconnected event', async () => {
      manager.registerChannel(channel1);
      await channel1.connect();

      const events: string[] = [];
      manager.on('channel-disconnected', (type) => events.push(type));

      await channel1.disconnect();

      expect(events).toContain('cli');
    });

    it('should shutdown cleanly', async () => {
      manager.registerChannel(channel1);
      manager.registerChannel(channel2);
      await manager.connectAll();

      await manager.shutdown();

      expect(manager.getAllChannels().length).toBe(0);
    });
  });

  describe('Singleton', () => {
    beforeEach(() => {
      resetChannelManager();
    });

    afterEach(() => {
      resetChannelManager();
    });

    it('should return same instance', () => {
      const manager1 = getChannelManager();
      const manager2 = getChannelManager();

      expect(manager1).toBe(manager2);
    });

    it('should reset instance', () => {
      const manager1 = getChannelManager();
      resetChannelManager();
      const manager2 = getChannelManager();

      expect(manager1).not.toBe(manager2);
    });
  });

  describe('Message Types', () => {
    let channel: MockChannel;

    beforeEach(async () => {
      channel = new MockChannel();
      await channel.connect();
    });

    afterEach(async () => {
      await channel.disconnect();
    });

    it('should handle text messages', () => {
      const msg = channel.simulateMessage('Hello', { contentType: 'text' });

      expect(msg.contentType).toBe('text');
    });

    it('should handle messages with attachments', () => {
      const msg = channel.simulateMessage('Check this out', {
        attachments: [
          {
            type: 'image',
            url: 'https://example.com/image.png',
            mimeType: 'image/png',
          },
        ],
      });

      expect(msg.attachments?.length).toBe(1);
      expect(msg.attachments?.[0].type).toBe('image');
    });

    it('should handle reply messages', () => {
      const original = channel.simulateMessage('Original');
      const reply = channel.simulateMessage('Reply', { replyTo: original.id });

      expect(reply.replyTo).toBe(original.id);
    });

    it('should handle thread messages', () => {
      const msg = channel.simulateMessage('In thread', { threadId: 'thread-123' });

      expect(msg.threadId).toBe('thread-123');
    });

    it('should preserve sender info', () => {
      const msg = channel.simulateMessage('Test', {
        sender: {
          id: 'user-456',
          username: 'johndoe',
          displayName: 'John Doe',
          isAdmin: true,
        },
      });

      expect(msg.sender.id).toBe('user-456');
      expect(msg.sender.isAdmin).toBe(true);
    });

    it('should preserve channel info', () => {
      const msg = channel.simulateMessage('Test', {
        channel: {
          id: 'channel-789',
          type: 'discord',
          name: 'General',
          isGroup: true,
        },
      });

      expect(msg.channel.id).toBe('channel-789');
      expect(msg.channel.isGroup).toBe(true);
    });
  });

  describe('Outbound Message Options', () => {
    let channel: MockChannel;

    beforeEach(async () => {
      channel = new MockChannel();
      await channel.connect();
    });

    afterEach(async () => {
      await channel.disconnect();
    });

    it('should send with parse mode', async () => {
      await channel.send({
        channelId: 'test',
        content: '**Bold** text',
        parseMode: 'markdown',
      });

      const sent = channel.getSentMessages();
      expect(sent[0].parseMode).toBe('markdown');
    });

    it('should send with buttons', async () => {
      await channel.send({
        channelId: 'test',
        content: 'Click a button',
        buttons: [
          { text: 'Option 1', type: 'callback', data: 'opt1' },
          { text: 'Visit', type: 'url', url: 'https://example.com' },
        ],
      });

      const sent = channel.getSentMessages();
      expect(sent[0].buttons?.length).toBe(2);
    });

    it('should send silently', async () => {
      await channel.send({
        channelId: 'test',
        content: 'Silent message',
        silent: true,
      });

      const sent = channel.getSentMessages();
      expect(sent[0].silent).toBe(true);
    });

    it('should disable preview', async () => {
      await channel.send({
        channelId: 'test',
        content: 'https://example.com',
        disablePreview: true,
      });

      const sent = channel.getSentMessages();
      expect(sent[0].disablePreview).toBe(true);
    });
  });
});
