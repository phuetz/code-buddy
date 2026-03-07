/**
 * Channel Management Handlers
 *
 * CLI handlers for `buddy channels` command.
 * Manages channel connections (Telegram, Discord, Slack, etc.)
 */

import fs from 'fs';
import path from 'path';
import { logger } from '../../utils/logger.js';

interface ChannelOptions {
  type?: string;
  config?: string;
}

interface ChannelConfigEntry {
  type: string;
  enabled: boolean;
  token?: string;
  webhookUrl?: string;
  allowedUsers?: string[];
  allowedChannels?: string[];
  options?: Record<string, unknown>;
}

interface ChannelsConfig {
  channels: ChannelConfigEntry[];
}

function loadChannelConfig(configPath?: string): ChannelsConfig | null {
  const paths = configPath
    ? [configPath]
    : [
        path.join(process.cwd(), '.codebuddy', 'channels.json'),
        path.join(process.env.HOME || process.env.USERPROFILE || '', '.codebuddy', 'channels.json'),
      ];

  for (const p of paths) {
    try {
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, 'utf-8');
        return JSON.parse(content) as ChannelsConfig;
      }
    } catch (err) {
      logger.debug(`Failed to load channel config from ${p}`, { error: err instanceof Error ? err.message : String(err) });
    }
  }
  return null;
}

export async function handleChannels(action: string, options: ChannelOptions): Promise<void> {
  const { getChannelManager } = await import('../../channels/index.js');
  const manager = getChannelManager();

  switch (action) {
    case 'list': {
      const channels = manager.getAllChannels();
      if (channels.length === 0) {
        console.log('No channels registered.');
        console.log('\nTo configure channels, create .codebuddy/channels.json with:');
        console.log(JSON.stringify({
          channels: [{ type: 'telegram', enabled: true, token: 'BOT_TOKEN' }],
        }, null, 2));
      } else {
        console.log('Registered channels:\n');
        for (const ch of channels) {
          const status = ch.getStatus();
          const icon = status.connected ? '[ON]' : '[OFF]';
          console.log(`  ${icon} ${status.type} — ${status.connected ? 'connected' : 'disconnected'}`);
        }
      }
      break;
    }

    case 'status': {
      const allStatus = manager.getStatus();
      console.log('Channel Status:\n');
      for (const [type, status] of Object.entries(allStatus)) {
        console.log(`  ${type}: ${status.connected ? 'connected' : 'disconnected'}${status.error ? ` (error: ${status.error})` : ''}`);
      }
      if (Object.keys(allStatus).length === 0) {
        console.log('  No channels registered.');
      }
      break;
    }

    case 'start': {
      // Register AI message handler so incoming messages get responses
      await registerAIMessageHandler(manager);

      const channelType = options.type;
      if (!channelType) {
        // Start all configured channels
        const config = loadChannelConfig(options.config);
        if (!config || config.channels.length === 0) {
          console.log('No channel configuration found. Create .codebuddy/channels.json or use --config.');
          return;
        }

        for (const chConfig of config.channels) {
          if (!chConfig.enabled) continue;
          try {
            const channel = await instantiateChannel(chConfig);
            if (channel) {
              manager.registerChannel(channel);
              await channel.connect();
              console.log(`[OK] ${chConfig.type} channel started`);
            }
          } catch (err) {
            console.log(`[FAIL] ${chConfig.type}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      } else {
        // Start a specific channel
        const config = loadChannelConfig(options.config);
        const chConfig = config?.channels.find(c => c.type === channelType);
        if (!chConfig) {
          console.log(`No configuration found for channel type: ${channelType}`);
          return;
        }
        try {
          const channel = await instantiateChannel(chConfig);
          if (channel) {
            manager.registerChannel(channel);
            await channel.connect();
            console.log(`[OK] ${channelType} channel started`);
          }
        } catch (err) {
          console.log(`[FAIL] ${channelType}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      break;
    }

    case 'stop': {
      const channelType = options.type;
      if (channelType) {
        const channel = manager.getChannel(channelType as import('../../channels/index.js').ChannelType);
        if (channel) {
          await channel.disconnect();
          manager.unregisterChannel(channelType as import('../../channels/index.js').ChannelType);
          console.log(`${channelType} channel stopped`);
        } else {
          console.log(`Channel ${channelType} not found`);
        }
      } else {
        await manager.disconnectAll();
        console.log('All channels stopped');
      }
      break;
    }

    default:
      console.log(`Usage: buddy channels [start|stop|status|list] [--type <type>] [--config <path>]`);
  }
}

let aiHandlerRegistered = false;

/**
 * Register a message handler that processes incoming messages through the AI agent
 */
async function registerAIMessageHandler(manager: import('../../channels/index.js').ChannelManager): Promise<void> {
  if (aiHandlerRegistered) return;
  aiHandlerRegistered = true;

  manager.onMessage(async (message, channel) => {
    try {
      const apiKey = process.env.GROK_API_KEY || process.env.XAI_API_KEY || '';
      if (!apiKey) {
        logger.warn('No API key for channel AI responses');
        return;
      }

      const { CodeBuddyAgent } = await import('../../agent/codebuddy-agent.js');
      const agent = new CodeBuddyAgent(apiKey, process.env.GROK_BASE_URL, process.env.GROK_MODEL || 'grok-3-latest');
      const entries = await agent.processUserMessage(message.content);
      const response = entries.length > 0 ? String(entries[entries.length - 1].content) : '';

      await channel.send({
        channelId: message.channel.id,
        content: response,
        replyTo: message.id,
      });
    } catch (err) {
      logger.error('Channel AI response failed', { error: err instanceof Error ? err.message : String(err) });
    }
  });
}

async function instantiateChannel(config: ChannelConfigEntry): Promise<import('../../channels/index.js').BaseChannel | null> {
  const opts = config.options ?? {};
  const channelConfig = {
    type: config.type as import('../../channels/index.js').ChannelType,
    enabled: config.enabled,
    token: config.token,
    webhookUrl: config.webhookUrl,
    allowedUsers: config.allowedUsers,
    allowedChannels: config.allowedChannels,
    options: opts,
  };

  switch (config.type) {
    case 'telegram': {
      const { TelegramChannel } = await import('../../channels/telegram/index.js');
      return new TelegramChannel({ botToken: config.token || '', ...opts } as unknown as import('../../channels/index.js').TelegramConfig);
    }
    case 'discord': {
      const { DiscordChannel } = await import('../../channels/discord/index.js');
      return new DiscordChannel({ token: config.token || '', ...opts } as unknown as import('../../channels/index.js').DiscordConfig);
    }
    case 'slack': {
      const { SlackChannel } = await import('../../channels/slack/index.js');
      return new SlackChannel({ botToken: config.token || '', ...opts } as unknown as import('../../channels/index.js').SlackConfig);
    }
    case 'whatsapp': {
      const { WhatsAppChannel } = await import('../../channels/whatsapp/index.js');
      return new WhatsAppChannel({
        ...channelConfig,
        type: 'whatsapp',
        phoneNumber: typeof opts.phoneNumber === 'string' ? opts.phoneNumber : undefined,
        sessionDataPath: typeof opts.sessionDataPath === 'string' ? opts.sessionDataPath : undefined,
        qrTimeout: typeof opts.qrTimeout === 'number' ? opts.qrTimeout : undefined,
        printQrInTerminal: typeof opts.printQrInTerminal === 'boolean' ? opts.printQrInTerminal : undefined,
        browserName: typeof opts.browserName === 'string' ? opts.browserName : undefined,
        markOnlineOnConnect: typeof opts.markOnlineOnConnect === 'boolean' ? opts.markOnlineOnConnect : undefined,
      } as import('../../channels/index.js').WhatsAppConfig);
    }
    case 'signal': {
      const { SignalChannel } = await import('../../channels/signal/index.js');
      return new SignalChannel({
        ...channelConfig,
        type: 'signal',
        phoneNumber: String(opts.phoneNumber ?? ''),
        apiUrl: typeof opts.apiUrl === 'string' ? opts.apiUrl : undefined,
        pollInterval: typeof opts.pollInterval === 'number' ? opts.pollInterval : undefined,
        trustAllIdentities: typeof opts.trustAllIdentities === 'boolean' ? opts.trustAllIdentities : undefined,
      } as import('../../channels/index.js').SignalConfig);
    }
    case 'matrix': {
      const { MatrixChannel } = await import('../../channels/matrix/index.js');
      return new MatrixChannel({
        ...channelConfig,
        type: 'matrix',
        homeserverUrl: String(opts.homeserverUrl ?? ''),
        userId: String(opts.userId ?? ''),
        accessToken: String(config.token ?? opts.accessToken ?? ''),
        deviceId: typeof opts.deviceId === 'string' ? opts.deviceId : undefined,
        autoJoin: typeof opts.autoJoin === 'boolean' ? opts.autoJoin : undefined,
        initialRooms: Array.isArray(opts.initialRooms)
          ? opts.initialRooms.filter((v): v is string => typeof v === 'string')
          : undefined,
        storePath: typeof opts.storePath === 'string' ? opts.storePath : undefined,
        enableEncryption: typeof opts.enableEncryption === 'boolean' ? opts.enableEncryption : undefined,
      } as import('../../channels/index.js').MatrixConfig);
    }
    case 'google-chat': {
      const { GoogleChatChannel } = await import('../../channels/google-chat/index.js');
      return new GoogleChatChannel({
        ...channelConfig,
        type: 'google-chat',
        serviceAccountPath: String(opts.serviceAccountPath ?? ''),
        spaceId: typeof opts.spaceId === 'string' ? opts.spaceId : undefined,
        verificationToken: typeof opts.verificationToken === 'string' ? opts.verificationToken : undefined,
        projectNumber: typeof opts.projectNumber === 'string' ? opts.projectNumber : undefined,
      } as import('../../channels/index.js').GoogleChatConfig);
    }
    case 'teams': {
      const { TeamsChannel } = await import('../../channels/teams/index.js');
      return new TeamsChannel({
        ...channelConfig,
        type: 'teams',
        appId: String(opts.appId ?? ''),
        appPassword: String(config.token ?? opts.appPassword ?? ''),
        tenantId: typeof opts.tenantId === 'string' ? opts.tenantId : undefined,
        oauthAuthority: typeof opts.oauthAuthority === 'string' ? opts.oauthAuthority : undefined,
      } as import('../../channels/index.js').TeamsConfig);
    }
    case 'webchat': {
      const { WebChatChannel } = await import('../../channels/webchat/index.js');
      return new WebChatChannel({ ...opts } as unknown as import('../../channels/index.js').WebChatConfig);
    }
    case 'line': {
      const { LINEChannel } = await import('../../channels/line/index.js');
      return new LINEChannel({
        ...channelConfig,
        channelAccessToken: String(opts.channelAccessToken ?? config.token ?? ''),
        channelSecret: String(opts.channelSecret ?? ''),
        port: typeof opts.port === 'number' ? opts.port : undefined,
      } as import('../../channels/index.js').LINEChannelConfig);
    }
    case 'nostr': {
      const { NostrChannel } = await import('../../channels/nostr/index.js');
      return new NostrChannel({
        ...channelConfig,
        privateKey: typeof opts.privateKey === 'string' ? opts.privateKey : config.token,
        relays: Array.isArray(opts.relays) ? opts.relays.filter((v): v is string => typeof v === 'string') : [],
      } as import('../../channels/index.js').NostrChannelConfig);
    }
    case 'zalo': {
      const { ZaloChannel } = await import('../../channels/zalo/index.js');
      return new ZaloChannel({
        ...channelConfig,
        appId: String(opts.appId ?? ''),
        secretKey: String(opts.secretKey ?? config.token ?? ''),
        mode: opts.mode === 'personal' ? 'personal' : 'bot',
      } as import('../../channels/index.js').ZaloChannelConfig);
    }
    case 'mattermost': {
      const { MattermostChannel } = await import('../../channels/mattermost/index.js');
      return new MattermostChannel({
        ...channelConfig,
        url: String(opts.url ?? ''),
        token: String(config.token ?? opts.token ?? ''),
        teamId: typeof opts.teamId === 'string' ? opts.teamId : undefined,
      } as import('../../channels/index.js').MattermostChannelConfig);
    }
    case 'nextcloud-talk': {
      const { NextcloudTalkChannel } = await import('../../channels/nextcloud-talk/index.js');
      return new NextcloudTalkChannel({
        ...channelConfig,
        url: String(opts.url ?? ''),
        username: String(opts.username ?? ''),
        password: String(opts.password ?? ''),
      } as import('../../channels/index.js').NextcloudTalkChannelConfig);
    }
    case 'twilio-voice': {
      const { TwilioVoiceChannel } = await import('../../channels/twilio-voice/index.js');
      return new TwilioVoiceChannel({
        ...channelConfig,
        accountSid: String(opts.accountSid ?? ''),
        authToken: String(opts.authToken ?? config.token ?? ''),
        phoneNumber: String(opts.phoneNumber ?? ''),
        webhookUrl: typeof opts.webhookUrl === 'string' ? opts.webhookUrl : config.webhookUrl,
      } as import('../../channels/index.js').TwilioVoiceChannelConfig);
    }
    case 'imessage': {
      const { IMessageChannel } = await import('../../channels/imessage/index.js');
      return new IMessageChannel({
        ...channelConfig,
        serverUrl: String(opts.serverUrl ?? 'http://localhost'),
        password: String(opts.password ?? config.token ?? ''),
        port: typeof opts.port === 'number' ? opts.port : undefined,
        pollingInterval: typeof opts.pollingInterval === 'number' ? opts.pollingInterval : undefined,
        maxRetries: typeof opts.maxRetries === 'number' ? opts.maxRetries : undefined,
        retryDelay: typeof opts.retryDelay === 'number' ? opts.retryDelay : undefined,
      } as import('../../channels/index.js').IMessageChannelConfig);
    }
    default: {
      logger.warn(`Unsupported channel type: ${config.type}, using generic config`);
      const { MockChannel } = await import('../../channels/index.js');
      return new MockChannel(channelConfig);
    }
  }
}
