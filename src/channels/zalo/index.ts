/**
 * Zalo Channel Adapter
 *
 * Connects to Zalo API for messaging in bot or personal mode.
 * Provides a lightweight in-process adapter for lifecycle and send flows.
 */

import { logger } from '../../utils/logger.js';
import { BaseChannel, ChannelConfig, DeliveryResult, OutboundMessage } from '../core.js';

export interface ZaloConfig {
  appId: string;
  secretKey: string;
  mode: 'bot' | 'personal';
  client?: ZaloClient;
}

export interface ZaloChannelConfig extends ChannelConfig {
  appId: string;
  secretKey: string;
  mode: 'bot' | 'personal';
  client?: ZaloClient;
}

export interface ZaloClient {
  start?(): Promise<void>;
  stop?(): Promise<void>;
  sendMessage(userId: string, text: string): Promise<{ success: boolean; messageId?: string }>;
  sendImage(userId: string, imageUrl: string): Promise<{ success: boolean; messageId?: string }>;
}

export class ZaloAdapter {
  private config: ZaloConfig;
  private client?: ZaloClient;
  private running = false;

  constructor(config: ZaloConfig) {
    this.config = { ...config };
    this.client = config.client;
  }

  async start(): Promise<void> {
    if (this.running) {
      throw new Error('ZaloAdapter is already running');
    }
    if (!this.client) {
      throw new Error('Zalo client is not configured. Provide a real Zalo client before connecting.');
    }
    logger.debug('ZaloAdapter: initializing', { appId: this.config.appId, mode: this.config.mode });
    await this.client.start?.();
    this.running = true;
  }

  async stop(): Promise<void> {
    if (!this.running) {
      throw new Error('ZaloAdapter is not running');
    }
    logger.debug('ZaloAdapter: disconnecting');
    await this.client?.stop?.();
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  async sendMessage(userId: string, text: string): Promise<{ success: boolean; messageId?: string }> {
    if (!this.running) {
      throw new Error('ZaloAdapter is not running');
    }
    if (!this.client) {
      throw new Error('Zalo client is not configured. Provide a real Zalo client before sending messages.');
    }
    logger.debug('ZaloAdapter: sending message', { userId, textLength: text.length });
    return this.client.sendMessage(userId, text);
  }

  async sendImage(userId: string, imageUrl: string): Promise<{ success: boolean; messageId?: string }> {
    if (!this.running) {
      throw new Error('ZaloAdapter is not running');
    }
    if (!this.client) {
      throw new Error('Zalo client is not configured. Provide a real Zalo client before sending images.');
    }
    logger.debug('ZaloAdapter: sending image', { userId, imageUrl });
    return this.client.sendImage(userId, imageUrl);
  }

  getMode(): 'bot' | 'personal' {
    return this.config.mode;
  }

  getConfig(): ZaloConfig {
    return { ...this.config };
  }
}

export class ZaloChannel extends BaseChannel {
  private adapter: ZaloAdapter;

  constructor(config: ZaloChannelConfig) {
    super('zalo', {
      type: 'zalo',
      enabled: config.enabled,
      token: config.token,
      webhookUrl: config.webhookUrl,
      allowedUsers: config.allowedUsers,
      allowedChannels: config.allowedChannels,
      autoReply: config.autoReply,
      rateLimit: config.rateLimit,
      options: config.options,
    });
    this.adapter = new ZaloAdapter({
      appId: config.appId,
      secretKey: config.secretKey,
      mode: config.mode,
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

export default ZaloAdapter;
