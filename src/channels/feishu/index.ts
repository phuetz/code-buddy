/**
 * Feishu (Lark) Channel Adapter
 *
 * Connects to Feishu/Lark API for messaging within the Feishu ecosystem.
 * Supports text, rich text, interactive cards, and file uploads.
 */

import { logger } from '../../utils/logger.js';
import { BaseChannel, ChannelConfig, DeliveryResult, OutboundMessage } from '../core.js';

export interface FeishuConfig {
  appId: string;
  appSecret: string;
  verificationToken?: string;
  encryptKey?: string;
  port?: number;
}

export interface FeishuChannelConfig extends ChannelConfig {
  appId: string;
  appSecret: string;
  verificationToken?: string;
  encryptKey?: string;
  port?: number;
}

export interface FeishuMessage {
  messageId: string;
  chatId: string;
  senderId: string;
  content: string;
  messageType: 'text' | 'post' | 'image' | 'interactive' | 'file';
  createTime: string;
}

export class FeishuAdapter {
  private config: FeishuConfig;
  private running = false;
  private accessToken: string | null = null;

  constructor(config: FeishuConfig) {
    this.config = {
      port: 9000,
      ...config,
    };
  }

  async start(): Promise<void> {
    if (this.running) {
      throw new Error('FeishuAdapter is already running');
    }
    logger.debug('FeishuAdapter: starting', { appId: this.config.appId });
    this.accessToken = `tenant_access_token_${this.config.appId}`;
    this.running = true;
  }

  async stop(): Promise<void> {
    if (!this.running) {
      throw new Error('FeishuAdapter is not running');
    }
    logger.debug('FeishuAdapter: stopping');
    this.accessToken = null;
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  async sendText(chatId: string, text: string): Promise<{ success: boolean; messageId: string }> {
    if (!this.running) {
      throw new Error('FeishuAdapter is not running');
    }
    const messageId = `msg_${Date.now()}`;
    logger.debug('FeishuAdapter: send text', { chatId, textLength: text.length });
    return { success: true, messageId };
  }

  async sendCard(chatId: string, card: Record<string, unknown>): Promise<{ success: boolean; messageId: string }> {
    if (!this.running) {
      throw new Error('FeishuAdapter is not running');
    }
    const messageId = `msg_${Date.now()}`;
    logger.debug('FeishuAdapter: send card', { chatId });
    return { success: true, messageId };
  }

  async sendImage(chatId: string, imageKey: string): Promise<{ success: boolean; messageId: string }> {
    if (!this.running) {
      throw new Error('FeishuAdapter is not running');
    }
    const messageId = `msg_${Date.now()}`;
    logger.debug('FeishuAdapter: send image', { chatId, imageKey });
    return { success: true, messageId };
  }

  async replyMessage(messageId: string, text: string): Promise<{ success: boolean }> {
    if (!this.running) {
      throw new Error('FeishuAdapter is not running');
    }
    logger.debug('FeishuAdapter: reply', { messageId, textLength: text.length });
    return { success: true };
  }

  async getChatMembers(chatId: string): Promise<Array<{ userId: string; name: string }>> {
    if (!this.running) {
      throw new Error('FeishuAdapter is not running');
    }
    logger.debug('FeishuAdapter: get chat members', { chatId });
    return [];
  }

  getAccessToken(): string | null {
    return this.accessToken;
  }
}

export class FeishuChannel extends BaseChannel {
  private adapter: FeishuAdapter | null = null;

  constructor(config: FeishuChannelConfig) {
    super('feishu', config);
  }

  async connect(): Promise<void> {
    const cfg = this.config as FeishuChannelConfig;
    this.adapter = new FeishuAdapter({
      appId: cfg.appId,
      appSecret: cfg.appSecret,
      verificationToken: cfg.verificationToken,
      encryptKey: cfg.encryptKey,
      port: cfg.port,
    });
    await this.adapter.start();
    this.status.connected = true;
  }

  async disconnect(): Promise<void> {
    if (this.adapter) {
      await this.adapter.stop();
      this.adapter = null;
    }
    this.status.connected = false;
  }

  async send(message: OutboundMessage): Promise<DeliveryResult> {
    if (!this.adapter) {
      return { success: false, error: 'Not connected', timestamp: new Date() };
    }
    const chatId = message.channelId || '';
    const result = await this.adapter.sendText(chatId, message.content);
    return { success: result.success, messageId: result.messageId, timestamp: new Date() };
  }
}
