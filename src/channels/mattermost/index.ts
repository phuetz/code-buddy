/**
 * Mattermost Channel Adapter
 *
 * Connects to Mattermost via WebSocket for real-time messaging.
 * Provides a lightweight in-process adapter for lifecycle and send flows.
 */

import { logger } from '../../utils/logger.js';
import { BaseChannel, ChannelConfig, DeliveryResult, OutboundMessage } from '../core.js';

export interface MattermostConfig {
  url: string;
  token: string;
  teamId?: string;
  client?: MattermostClient;
}

export interface MattermostChannelConfig extends ChannelConfig {
  url: string;
  token: string;
  teamId?: string;
  client?: MattermostClient;
}

export interface MattermostChannelSummary {
  id: string;
  name: string;
  type: string;
}

export interface MattermostClient {
  start?(): Promise<void>;
  stop?(): Promise<void>;
  sendMessage(channelId: string, text: string): Promise<{ success: boolean; postId?: string }>;
  sendReply(channelId: string, rootId: string, text: string): Promise<{ success: boolean; postId?: string }>;
  getChannels(): Promise<MattermostChannelSummary[]>;
}

export class MattermostAdapter {
  private config: MattermostConfig;
  private client?: MattermostClient;
  private running = false;

  constructor(config: MattermostConfig) {
    this.config = { ...config };
    this.client = config.client;
  }

  async start(): Promise<void> {
    if (this.running) {
      throw new Error('MattermostAdapter is already running');
    }
    if (!this.client) {
      throw new Error('Mattermost client is not configured. Provide a real Mattermost client before connecting.');
    }
    logger.debug('MattermostAdapter: connecting via WebSocket', { url: this.config.url });
    await this.client.start?.();
    this.running = true;
  }

  async stop(): Promise<void> {
    if (!this.running) {
      throw new Error('MattermostAdapter is not running');
    }
    logger.debug('MattermostAdapter: disconnecting');
    await this.client?.stop?.();
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  async sendMessage(channelId: string, text: string): Promise<{ success: boolean; postId?: string }> {
    if (!this.running) {
      throw new Error('MattermostAdapter is not running');
    }
    if (!this.client) {
      throw new Error('Mattermost client is not configured. Provide a real Mattermost client before sending messages.');
    }
    logger.debug('MattermostAdapter: sending message', { channelId, textLength: text.length });
    return this.client.sendMessage(channelId, text);
  }

  async sendReply(channelId: string, rootId: string, text: string): Promise<{ success: boolean; postId?: string }> {
    if (!this.running) {
      throw new Error('MattermostAdapter is not running');
    }
    if (!this.client) {
      throw new Error('Mattermost client is not configured. Provide a real Mattermost client before sending replies.');
    }
    logger.debug('MattermostAdapter: sending reply', { channelId, rootId, textLength: text.length });
    return this.client.sendReply(channelId, rootId, text);
  }

  async getChannels(): Promise<MattermostChannelSummary[]> {
    if (!this.running) {
      throw new Error('MattermostAdapter is not running');
    }
    if (!this.client) {
      throw new Error('Mattermost client is not configured. Provide a real Mattermost client before reading channels.');
    }
    return this.client.getChannels();
  }

  getConfig(): MattermostConfig {
    return { ...this.config };
  }
}

export class MattermostChannel extends BaseChannel {
  private adapter: MattermostAdapter;

  constructor(config: MattermostChannelConfig) {
    super('mattermost', {
      type: 'mattermost',
      enabled: config.enabled,
      token: config.token,
      webhookUrl: config.webhookUrl,
      allowedUsers: config.allowedUsers,
      allowedChannels: config.allowedChannels,
      autoReply: config.autoReply,
      rateLimit: config.rateLimit,
      options: config.options,
    });
    this.adapter = new MattermostAdapter({
      url: config.url,
      token: config.token,
      teamId: config.teamId,
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
      const result = message.replyTo
        ? await this.adapter.sendReply(message.channelId, message.replyTo, message.content)
        : await this.adapter.sendMessage(message.channelId, message.content);

      this.status.lastActivity = new Date();
      return {
        success: result.success,
        messageId: result.postId,
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

export default MattermostAdapter;
