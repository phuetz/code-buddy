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
  client?: NextcloudTalkClient;
}

export interface NextcloudTalkChannelConfig extends ChannelConfig {
  url: string;
  username: string;
  password: string;
  client?: NextcloudTalkClient;
}

export interface NextcloudTalkRoom {
  token: string;
  name: string;
  type: number;
}

export interface NextcloudTalkClient {
  start?(): Promise<void>;
  stop?(): Promise<void>;
  sendMessage(roomToken: string, text: string): Promise<{ success: boolean; messageId?: string }>;
  getRooms(): Promise<NextcloudTalkRoom[]>;
  joinRoom(roomToken: string): Promise<{ success: boolean }>;
  leaveRoom(roomToken: string): Promise<{ success: boolean }>;
}

export class NextcloudTalkAdapter {
  private config: NextcloudTalkConfig;
  private client?: NextcloudTalkClient;
  private running = false;

  constructor(config: NextcloudTalkConfig) {
    this.config = { ...config };
    this.client = config.client;
  }

  async start(): Promise<void> {
    if (this.running) {
      throw new Error('NextcloudTalkAdapter is already running');
    }
    if (!this.client) {
      throw new Error('Nextcloud Talk client is not configured. Provide a real Nextcloud Talk client before connecting.');
    }
    logger.debug('NextcloudTalkAdapter: connecting', { url: this.config.url, username: this.config.username });
    await this.client.start?.();
    this.running = true;
  }

  async stop(): Promise<void> {
    if (!this.running) {
      throw new Error('NextcloudTalkAdapter is not running');
    }
    logger.debug('NextcloudTalkAdapter: disconnecting');
    await this.client?.stop?.();
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  async sendMessage(roomToken: string, text: string): Promise<{ success: boolean; messageId?: string }> {
    if (!this.running) {
      throw new Error('NextcloudTalkAdapter is not running');
    }
    if (!this.client) {
      throw new Error('Nextcloud Talk client is not configured. Provide a real Nextcloud Talk client before sending messages.');
    }
    logger.debug('NextcloudTalkAdapter: sending message', { roomToken, textLength: text.length });
    return this.client.sendMessage(roomToken, text);
  }

  async getRooms(): Promise<NextcloudTalkRoom[]> {
    if (!this.running) {
      throw new Error('NextcloudTalkAdapter is not running');
    }
    if (!this.client) {
      throw new Error('Nextcloud Talk client is not configured. Provide a real Nextcloud Talk client before reading rooms.');
    }
    return this.client.getRooms();
  }

  async joinRoom(roomToken: string): Promise<{ success: boolean }> {
    if (!this.running) {
      throw new Error('NextcloudTalkAdapter is not running');
    }
    if (!this.client) {
      throw new Error('Nextcloud Talk client is not configured. Provide a real Nextcloud Talk client before joining rooms.');
    }
    logger.debug('NextcloudTalkAdapter: joined room', { roomToken });
    return this.client.joinRoom(roomToken);
  }

  async leaveRoom(roomToken: string): Promise<{ success: boolean }> {
    if (!this.running) {
      throw new Error('NextcloudTalkAdapter is not running');
    }
    if (!this.client) {
      throw new Error('Nextcloud Talk client is not configured. Provide a real Nextcloud Talk client before leaving rooms.');
    }
    logger.debug('NextcloudTalkAdapter: leaving room', { roomToken });
    return this.client.leaveRoom(roomToken);
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
      client: config.client,
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
