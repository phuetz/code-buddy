import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { handleChannels, instantiateChannel } from '../../src/commands/handlers/channel-handlers.js';
import { getChannelManager, resetChannelManager } from '../../src/channels/index.js';
import type { ChannelType } from '../../src/channels/index.js';

describe('handleChannels additional channel activation', () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    resetChannelManager();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-channels-'));
    configPath = path.join(tmpDir, 'channels.json');
  });

  afterEach(async () => {
    const manager = getChannelManager();
    await manager.shutdown();
    resetChannelManager();
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const mockedConnectChannels = new Set<ChannelType>([
    'whatsapp',
    'signal',
    'matrix',
    'google-chat',
    'teams',
    'line',
    'nostr',
    'zalo',
    'mattermost',
    'nextcloud-talk',
    'twilio-voice',
    'imessage',
  ]);

  async function mockConnect(channelType: ChannelType): Promise<void> {
    const markConnected = async function (this: unknown): Promise<void> {
      const channel = this as {
        status?: { connected: boolean; authenticated: boolean; lastActivity?: Date };
      };
      if (channel.status) {
        channel.status.connected = true;
        channel.status.authenticated = true;
        channel.status.lastActivity = new Date();
      }
    };
    const markDisconnected = async function (this: unknown): Promise<void> {
      const channel = this as {
        status?: { connected: boolean; authenticated: boolean; lastActivity?: Date };
      };
      if (channel.status) {
        channel.status.connected = false;
        channel.status.authenticated = false;
        channel.status.lastActivity = new Date();
      }
    };

    switch (channelType) {
      case 'whatsapp': {
        const { WhatsAppChannel } = await import('../../src/channels/whatsapp/index.js');
        vi.spyOn(WhatsAppChannel.prototype, 'connect').mockImplementation(markConnected);
        break;
      }
      case 'signal': {
        const { SignalChannel } = await import('../../src/channels/signal/index.js');
        vi.spyOn(SignalChannel.prototype, 'connect').mockImplementation(markConnected);
        break;
      }
      case 'matrix': {
        const { MatrixChannel } = await import('../../src/channels/matrix/index.js');
        vi.spyOn(MatrixChannel.prototype, 'connect').mockImplementation(markConnected);
        break;
      }
      case 'google-chat': {
        const { GoogleChatChannel } = await import('../../src/channels/google-chat/index.js');
        vi.spyOn(GoogleChatChannel.prototype, 'connect').mockImplementation(markConnected);
        break;
      }
      case 'teams': {
        const { TeamsChannel } = await import('../../src/channels/teams/index.js');
        vi.spyOn(TeamsChannel.prototype, 'connect').mockImplementation(markConnected);
        break;
      }
      case 'line': {
        const { LINEChannel } = await import('../../src/channels/line/index.js');
        vi.spyOn(LINEChannel.prototype, 'connect').mockImplementation(markConnected);
        vi.spyOn(LINEChannel.prototype, 'disconnect').mockImplementation(markDisconnected);
        break;
      }
      case 'nostr': {
        const { NostrChannel } = await import('../../src/channels/nostr/index.js');
        vi.spyOn(NostrChannel.prototype, 'connect').mockImplementation(markConnected);
        vi.spyOn(NostrChannel.prototype, 'disconnect').mockImplementation(markDisconnected);
        break;
      }
      case 'zalo': {
        const { ZaloChannel } = await import('../../src/channels/zalo/index.js');
        vi.spyOn(ZaloChannel.prototype, 'connect').mockImplementation(markConnected);
        vi.spyOn(ZaloChannel.prototype, 'disconnect').mockImplementation(markDisconnected);
        break;
      }
      case 'mattermost': {
        const { MattermostChannel } = await import('../../src/channels/mattermost/index.js');
        vi.spyOn(MattermostChannel.prototype, 'connect').mockImplementation(markConnected);
        vi.spyOn(MattermostChannel.prototype, 'disconnect').mockImplementation(markDisconnected);
        break;
      }
      case 'nextcloud-talk': {
        const { NextcloudTalkChannel } = await import('../../src/channels/nextcloud-talk/index.js');
        vi.spyOn(NextcloudTalkChannel.prototype, 'connect').mockImplementation(markConnected);
        vi.spyOn(NextcloudTalkChannel.prototype, 'disconnect').mockImplementation(markDisconnected);
        break;
      }
      case 'twilio-voice': {
        const { TwilioVoiceChannel } = await import('../../src/channels/twilio-voice/index.js');
        vi.spyOn(TwilioVoiceChannel.prototype, 'connect').mockImplementation(markConnected);
        vi.spyOn(TwilioVoiceChannel.prototype, 'disconnect').mockImplementation(markDisconnected);
        break;
      }
      case 'imessage': {
        const { IMessageChannel } = await import('../../src/channels/imessage/index.js');
        vi.spyOn(IMessageChannel.prototype, 'connect').mockImplementation(markConnected);
        vi.spyOn(IMessageChannel.prototype, 'disconnect').mockImplementation(markDisconnected);
        break;
      }
      default:
        break;
    }
  }

  const channelCases: Array<{ type: ChannelType; config: Record<string, unknown> }> = [
    {
      type: 'whatsapp',
      config: {
        type: 'whatsapp',
        enabled: true,
        options: {
          phoneNumber: '+15551234567',
          sessionDataPath: path.join(os.tmpdir(), 'codebuddy-wa-session'),
        },
      },
    },
    {
      type: 'signal',
      config: {
        type: 'signal',
        enabled: true,
        options: { phoneNumber: '+15551234567' },
      },
    },
    {
      type: 'matrix',
      config: {
        type: 'matrix',
        enabled: true,
        token: 'matrix-token',
        options: {
          homeserverUrl: 'https://matrix.example.org',
          userId: '@bot:example.org',
        },
      },
    },
    {
      type: 'google-chat',
      config: {
        type: 'google-chat',
        enabled: true,
        options: {
          serviceAccountPath: path.join(os.tmpdir(), 'codebuddy-google-service-account.json'),
        },
      },
    },
    {
      type: 'teams',
      config: {
        type: 'teams',
        enabled: true,
        token: 'teams-app-password',
        options: {
          appId: 'teams-app-id',
        },
      },
    },
    {
      type: 'line',
      config: {
        type: 'line',
        enabled: true,
        token: 'line-token',
        options: { channelSecret: 'line-secret' },
      },
    },
    {
      type: 'nostr',
      config: {
        type: 'nostr',
        enabled: true,
        options: { relays: ['wss://relay.example.org'] },
      },
    },
    {
      type: 'zalo',
      config: {
        type: 'zalo',
        enabled: true,
        options: { appId: 'zalo-app', secretKey: 'zalo-secret', mode: 'bot' },
      },
    },
    {
      type: 'mattermost',
      config: {
        type: 'mattermost',
        enabled: true,
        token: 'mattermost-token',
        options: { url: 'https://mattermost.example.com' },
      },
    },
    {
      type: 'nextcloud-talk',
      config: {
        type: 'nextcloud-talk',
        enabled: true,
        options: {
          url: 'https://nextcloud.example.com',
          username: 'admin',
          password: 'admin-pass',
        },
      },
    },
    {
      type: 'twilio-voice',
      config: {
        type: 'twilio-voice',
        enabled: true,
        options: {
          accountSid: 'AC123456',
          authToken: 'auth-token',
          phoneNumber: '+15551234567',
        },
      },
    },
    {
      type: 'imessage',
      config: {
        type: 'imessage',
        enabled: true,
        token: 'bluebubbles-password',
        options: {
          serverUrl: 'http://localhost',
        },
      },
    },
  ];

  for (const channelCase of channelCases) {
    it(`starts ${channelCase.type} as a real channel implementation`, async () => {
      if (mockedConnectChannels.has(channelCase.type)) {
        await mockConnect(channelCase.type);
      }

      fs.writeFileSync(configPath, JSON.stringify({ channels: [channelCase.config] }, null, 2));

      await handleChannels('start', { type: channelCase.type, config: configPath });

      const manager = getChannelManager();
      const channel = manager.getChannel(channelCase.type);

      expect(channel).toBeDefined();
      expect(channel?.type).toBe(channelCase.type);
      expect(channel?.constructor.name).not.toBe('MockChannel');
      expect(channel?.getStatus().connected).toBe(true);

      await handleChannels('stop', { type: channelCase.type });
    });
  }
});

describe('instantiateChannel common channel config', () => {
  afterEach(async () => {
    await getChannelManager().shutdown();
    resetChannelManager();
  });

  const coreChannelCases = [
    { type: 'telegram', token: 'telegram-token' },
    { type: 'discord', token: 'discord-token' },
    { type: 'slack', token: 'slack-token' },
    { type: 'webchat', token: undefined },
  ] as const;

  for (const channelCase of coreChannelCases) {
    it(`preserves auth allow-lists for ${channelCase.type}`, async () => {
      const channel = await instantiateChannel({
        type: channelCase.type,
        enabled: true,
        token: channelCase.token,
        allowedUsers: ['allowed-user'],
        allowedChannels: ['allowed-channel'],
        options: channelCase.type === 'webchat' ? { port: 0 } : {},
      });

      expect(channel).toBeDefined();
      expect(channel?.type).toBe(channelCase.type);
      expect(channel?.isUserAllowed('allowed-user')).toBe(true);
      expect(channel?.isUserAllowed('blocked-user')).toBe(false);
      expect(channel?.isChannelAllowed('allowed-channel')).toBe(true);
      expect(channel?.isChannelAllowed('blocked-channel')).toBe(false);
    });
  }

  it('rejects unsupported channel types instead of falling back to MockChannel', async () => {
    await expect(instantiateChannel({
      type: 'unknown-channel',
      enabled: true,
    })).rejects.toThrow('Unsupported channel type: unknown-channel');
  });
});
