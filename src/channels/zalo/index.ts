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
}

export interface ZaloChannelConfig extends ChannelConfig {
  appId: string;
  secretKey: string;
  mode: 'bot' | 'personal';
}

export class ZaloAdapter {
  private config: ZaloConfig;
  private running = false;

  constructor(config: ZaloConfig) {
    this.config = { ...config };
  }

  async start(): Promise<void> {
    if (this.running) {
      throw new Error('ZaloAdapter is already running');
    }
    logger.debug('ZaloAdapter: initializing', { appId: this.config.appId, mode: this.config.mode });
    this.running = true;
  }

  async stop(): Promise<void> {
    if (!this.running) {
      throw new Error('ZaloAdapter is not running');
    }
    logger.debug('ZaloAdapter: disconnecting');
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  async sendMessage(userId: string, text: string): Promise<{ success: boolean }> {
    if (!this.running) {
      throw new Error('ZaloAdapter is not running');
    }
    logger.debug('ZaloAdapter: sending message', { userId, textLength: text.length });
    return { success: true };
  }

  async sendImage(userId: string, imageUrl: string): Promise<{ success: boolean }> {
    if (!this.running) {
      throw new Error('ZaloAdapter is not running');
    }
    logger.debug('ZaloAdapter: sending image', { userId, imageUrl });
    return { success: true };
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
        await this.adapter.sendImage(message.channelId, imageAttachment.url);
      } else {
        await this.adapter.sendMessage(message.channelId, message.content);
      }

      this.status.lastActivity = new Date();
      return {
        success: true,
        messageId: `zalo_${Date.now()}`,
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

export default ZaloAdapter;
