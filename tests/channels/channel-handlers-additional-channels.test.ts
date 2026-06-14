import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { handleChannels } from '../../src/commands/handlers/channel-handlers.js';
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
    'imessage',
    'mattermost',
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
      case 'mattermost': {
        // Mattermost now opens a real WebSocket; mock connect() so this
        // activation test doesn't dial out to a non-existent host (same tier
        // as the other genuinely-networked channels above). The real WS + REST
        // transport is proven against a loopback mock in
        // mattermost-transport.test.ts.
        const { MattermostChannel } = await import('../../src/channels/mattermost/index.js');
        vi.spyOn(MattermostChannel.prototype, 'connect').mockImplementation(markConnected);
        break;
      }
      case 'imessage': {
        const { IMessageChannel } = await import('../../src/channels/imessage/index.js');
        vi.spyOn(IMessageChannel.prototype, 'connect').mockImplementation(markConnected);
        vi.spyOn(IMessageChannel.prototype, 'disconnect').mockImplementation(async function (this: unknown): Promise<void> {
          const channel = this as { status?: { connected: boolean; authenticated: boolean; lastActivity?: Date } };
          if (channel.status) {
            channel.status.connected = false;
            channel.status.authenticated = false;
            channel.status.lastActivity = new Date();
          }
        });
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
      type: 'dingtalk',
      config: {
        type: 'dingtalk',
        enabled: true,
        token: 'dingtalk-access-token',
        webhookUrl: 'http://127.0.0.1:9/robot/send?access_token=dingtalk-access-token',
        options: { secret: 'SEC-test', msgType: 'text' },
      },
    },
    {
      type: 'wecom',
      config: {
        type: 'wecom',
        enabled: true,
        token: 'wecom-key',
        webhookUrl: 'http://127.0.0.1:9/cgi-bin/webhook/send?key=wecom-key',
        options: { msgType: 'text', mentionedList: ['@all'] },
      },
    },
    {
      type: 'weixin',
      config: {
        type: 'weixin',
        enabled: true,
        token: 'weixin-access-token',
        options: {
          apiBaseUrl: 'http://127.0.0.1:9/weixin',
          kfAccount: 'agent@example',
        },
      },
    },
    {
      type: 'qq',
      config: {
        type: 'qq',
        enabled: true,
        token: 'onebot-access-token',
        options: {
          baseUrl: 'http://127.0.0.1:9/onebot/v11',
          defaultMessageType: 'private',
          autoEscape: true,
        },
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
    {
      type: 'ntfy',
      config: {
        type: 'ntfy',
        enabled: true,
        token: 'ntfy-token',
        options: {
          serverUrl: 'http://127.0.0.1:9/tenant',
          topic: 'alerts',
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
