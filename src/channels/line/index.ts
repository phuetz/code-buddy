/**
 * LINE Channel Adapter
 *
 * Connects to LINE Messaging API for sending/receiving messages.
 * Provides a lightweight in-process adapter for lifecycle and send flows.
 */

import { logger } from '../../utils/logger.js';
import { BaseChannel, ChannelConfig, DeliveryResult, OutboundMessage } from '../core.js';

export interface LINEConfig {
  channelAccessToken: string;
  channelSecret: string;
  port?: number;
  client?: LINEClient;
}

export interface LINEChannelConfig extends ChannelConfig {
  channelAccessToken: string;
  channelSecret: string;
  port?: number;
  client?: LINEClient;
}

export interface LINEProfile {
  userId: string;
  displayName: string;
  pictureUrl: string;
  statusMessage: string;
}

export interface LINEClient {
  start?(): Promise<void>;
  stop?(): Promise<void>;
  sendMessage(userId: string, text: string): Promise<{ success: boolean; messageId?: string }>;
  sendImage(userId: string, imageUrl: string): Promise<{ success: boolean; messageId?: string }>;
  sendSticker(userId: string, packageId: string, stickerId: string): Promise<{ success: boolean; messageId?: string }>;
  getProfile(userId: string): Promise<LINEProfile>;
}

export class LINEAdapter {
  private config: LINEConfig;
  private client?: LINEClient;
  private running = false;

  constructor(config: LINEConfig) {
    this.config = { ...config };
    this.client = config.client;
    if (this.config.port === undefined) {
      this.config.port = 8080;
    }
  }

  async start(): Promise<void> {
    if (this.running) {
      throw new Error('LINEAdapter is already running');
    }
    if (!this.client) {
      throw new Error('LINE client is not configured. Provide a real LINE client before connecting.');
    }
    logger.debug('LINEAdapter: starting webhook server', { port: this.config.port });
    await this.client.start?.();
    this.running = true;
  }

  async stop(): Promise<void> {
    if (!this.running) {
      throw new Error('LINEAdapter is not running');
    }
    logger.debug('LINEAdapter: stopping webhook server');
    await this.client?.stop?.();
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  async sendMessage(userId: string, text: string): Promise<{ success: boolean; messageId?: string }> {
    if (!this.running) {
      throw new Error('LINEAdapter is not running');
    }
    if (!this.client) {
      throw new Error('LINE client is not configured. Provide a real LINE client before sending messages.');
    }
    logger.debug('LINEAdapter: sending message', { userId, textLength: text.length });
    return this.client.sendMessage(userId, text);
  }

  async sendImage(userId: string, imageUrl: string): Promise<{ success: boolean; messageId?: string }> {
    if (!this.running) {
      throw new Error('LINEAdapter is not running');
    }
    if (!this.client) {
      throw new Error('LINE client is not configured. Provide a real LINE client before sending images.');
    }
    logger.debug('LINEAdapter: sending image', { userId, imageUrl });
    return this.client.sendImage(userId, imageUrl);
  }

  async sendSticker(userId: string, packageId: string, stickerId: string): Promise<{ success: boolean; messageId?: string }> {
    if (!this.running) {
      throw new Error('LINEAdapter is not running');
    }
    if (!this.client) {
      throw new Error('LINE client is not configured. Provide a real LINE client before sending stickers.');
    }
    logger.debug('LINEAdapter: sending sticker', { userId, packageId, stickerId });
    return this.client.sendSticker(userId, packageId, stickerId);
  }

  async getProfile(userId: string): Promise<LINEProfile> {
    if (!this.running) {
      throw new Error('LINEAdapter is not running');
    }
    if (!this.client) {
      throw new Error('LINE client is not configured. Provide a real LINE client before reading profiles.');
    }
    return this.client.getProfile(userId);
  }

  getConfig(): LINEConfig {
    return { ...this.config };
  }
}

export class LINEChannel extends BaseChannel {
  private adapter: LINEAdapter;

  constructor(config: LINEChannelConfig) {
    super('line', {
      type: 'line',
      enabled: config.enabled,
      token: config.token,
      webhookUrl: config.webhookUrl,
      allowedUsers: config.allowedUsers,
      allowedChannels: config.allowedChannels,
      autoReply: config.autoReply,
      rateLimit: config.rateLimit,
      options: config.options,
    });
    this.adapter = new LINEAdapter({
      channelAccessToken: config.channelAccessToken,
      channelSecret: config.channelSecret,
      port: config.port,
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
      const imageAttachment = message.attachments?.find(
        (a) => a.type === 'image' && !!a.url,
      );

      if (imageAttachment?.url) {
        const result = await this.adapter.sendImage(message.channelId, imageAttachment.url);
        this.status.lastActivity = new Date();
        return {
          success: result.success,
          messageId: result.messageId,
          timestamp: new Date(),
        };
      } else {
        const result = await this.adapter.sendMessage(message.channelId, message.content);
        this.status.lastActivity = new Date();
        return {
          success: result.success,
          messageId: result.messageId,
          timestamp: new Date(),
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date(),
      };
    }
  }
}

export default LINEAdapter;
