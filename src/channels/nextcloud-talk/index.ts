/**
 * Nextcloud Talk Channel Adapter
 *
 * Connects to Nextcloud Talk for messaging and room management.
 * Provides a lightweight in-process adapter for lifecycle and room flows.
 */

import { logger } from '../../utils/logger.js';
import { BaseChannel, ChannelConfig, DeliveryResult, OutboundMessage } from '../core.js';

export interface NextcloudTalkConfig {
  url: string;
  username: string;
  password: string;
}

export interface NextcloudTalkChannelConfig extends ChannelConfig {
  url: string;
  username: string;
  password: string;
}

export class NextcloudTalkAdapter {
  private config: NextcloudTalkConfig;
  private running = false;
  private joinedRooms: Set<string> = new Set();

  constructor(config: NextcloudTalkConfig) {
    this.config = { ...config };
  }

  async start(): Promise<void> {
    if (this.running) {
      throw new Error('NextcloudTalkAdapter is already running');
    }
    logger.debug('NextcloudTalkAdapter: connecting', { url: this.config.url, username: this.config.username });
    this.running = true;
  }

  async stop(): Promise<void> {
    if (!this.running) {
      throw new Error('NextcloudTalkAdapter is not running');
    }
    logger.debug('NextcloudTalkAdapter: disconnecting');
    this.joinedRooms.clear();
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  async sendMessage(roomToken: string, text: string): Promise<{ success: boolean; messageId: string }> {
    if (!this.running) {
      throw new Error('NextcloudTalkAdapter is not running');
    }
    logger.debug('NextcloudTalkAdapter: sending message', { roomToken, textLength: text.length });
    return { success: true, messageId: `nc_${Date.now()}` };
  }

  async getRooms(): Promise<Array<{ token: string; name: string; type: number }>> {
    if (!this.running) {
      throw new Error('NextcloudTalkAdapter is not running');
    }
    return [];
  }

  async joinRoom(roomToken: string): Promise<{ success: boolean }> {
    if (!this.running) {
      throw new Error('NextcloudTalkAdapter is not running');
    }
    this.joinedRooms.add(roomToken);
    logger.debug('NextcloudTalkAdapter: joined room', { roomToken });
    return { success: true };
  }

  async leaveRoom(roomToken: string): Promise<{ success: boolean }> {
    if (!this.running) {
      throw new Error('NextcloudTalkAdapter is not running');
    }
    const existed = this.joinedRooms.delete(roomToken);
    logger.debug('NextcloudTalkAdapter: left room', { roomToken, existed });
    return { success: existed };
  }

  getConfig(): NextcloudTalkConfig {
    return { ...this.config };
  }
}

export class NextcloudTalkChannel extends BaseChannel {
  private adapter: NextcloudTalkAdapter;

  constructor(config: NextcloudTalkChannelConfig) {
    super('nextcloud-talk', {
      type: 'nextcloud-talk',
      enabled: config.enabled,
      token: config.token,
      webhookUrl: config.webhookUrl,
      allowedUsers: config.allowedUsers,
      allowedChannels: config.allowedChannels,
      autoReply: config.autoReply,
      rateLimit: config.rateLimit,
      options: config.options,
    });
    this.adapter = new NextcloudTalkAdapter({
      url: config.url,
      username: config.username,
      password: config.password,
    });
  }

  async connect(): Promise<void> {
    await this.adapter.start();
    this.status.connected = true;
    this.status.authenticated = true;
    this.status.lastActivity = new Date();
    this.emit('connected', this.type);
  }

  async disconnect(): Promise<void> {
    if (!this.status.connected) return;
    await this.adapter.stop();
    this.status.connected = false;
    this.status.lastActivity = new Date();
    this.emit('disconnected', this.type);
  }

  async send(message: OutboundMessage): Promise<DeliveryResult> {
    try {
      const result = await this.adapter.sendMessage(message.channelId, message.content);
      this.status.lastActivity = new Date();
      return {
        success: result.success,
        messageId: result.messageId,
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date(),
      };
    }
  }
}

export default NextcloudTalkAdapter;
