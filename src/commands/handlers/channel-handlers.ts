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
  const channelConfig = {
    type: config.type as import('../../channels/index.js').ChannelType,
    enabled: config.enabled,
    token: config.token,
    webhookUrl: config.webhookUrl,
    allowedUsers: config.allowedUsers,
    allowedChannels: config.allowedChannels,
    options: config.options,
  };

  switch (config.type) {
    case 'telegram': {
      const { TelegramChannel } = await import('../../channels/telegram/index.js');
      return new TelegramChannel({ botToken: config.token || '', ...config.options } as unknown as import('../../channels/index.js').TelegramConfig);
    }
    case 'discord': {
      const { DiscordChannel } = await import('../../channels/discord/index.js');
      return new DiscordChannel({ token: config.token || '', ...config.options } as unknown as import('../../channels/index.js').DiscordConfig);
    }
    case 'slack': {
      const { SlackChannel } = await import('../../channels/slack/index.js');
      return new SlackChannel({ botToken: config.token || '', ...config.options } as unknown as import('../../channels/index.js').SlackConfig);
    }
    case 'webchat': {
      const { WebChatChannel } = await import('../../channels/webchat/index.js');
      return new WebChatChannel({ ...config.options } as unknown as import('../../channels/index.js').WebChatConfig);
    }
    default: {
      logger.warn(`Unsupported channel type: ${config.type}, using generic config`);
      const { MockChannel } = await import('../../channels/index.js');
      return new MockChannel(channelConfig);
    }
  }
}
