/**
 * Synology Chat Channel Adapter
 *
 * Connects to Synology Chat via incoming/outgoing webhooks.
 * Supports text messages, file sharing, and slash commands.
 */

import { logger } from '../../utils/logger.js';
import { BaseChannel, ChannelConfig, DeliveryResult, OutboundMessage } from '../core.js';

export interface SynologyChatConfig {
  incomingWebhookUrl: string;
  outgoingWebhookToken?: string;
  botName?: string;
  port?: number;
  client?: SynologyChatClient;
}

export interface SynologyChatChannelConfig extends ChannelConfig {
  incomingWebhookUrl: string;
  outgoingWebhookToken?: string;
  botName?: string;
  port?: number;
  client?: SynologyChatClient;
}

export interface SynologyChatMessage {
  token: string;
  channelId: string;
  channelName: string;
  userId: number;
  username: string;
  text: string;
  timestamp: string;
}

export interface SynologyChatClient {
  start?(): Promise<void>;
  stop?(): Promise<void>;
  sendMessage(text: string, fileUrl?: string): Promise<{ success: boolean; messageId?: string }>;
  sendDirectMessage(userId: number, text: string): Promise<{ success: boolean; messageId?: string }>;
}

export class SynologyChatAdapter {
  private config: SynologyChatConfig;
  private client?: SynologyChatClient;
  private running = false;

  constructor(config: SynologyChatConfig) {
    this.config = {
      botName: 'CodeBuddy',
      port: 8100,
      ...config,
    };
    this.client = config.client;
  }

  async start(): Promise<void> {
    if (this.running) {
      throw new Error('SynologyChatAdapter is already running');
    }
    if (!this.client) {
      throw new Error('Synology Chat client is not configured. Provide a real Synology Chat client before connecting.');
    }
    logger.debug('SynologyChatAdapter: starting', { botName: this.config.botName });
    await this.client.start?.();
    this.running = true;
  }

  async stop(): Promise<void> {
    if (!this.running) {
      throw new Error('SynologyChatAdapter is not running');
    }
    logger.debug('SynologyChatAdapter: stopping');
    await this.client?.stop?.();
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  async sendMessage(text: string, fileUrl?: string): Promise<{ success: boolean; messageId?: string }> {
    if (!this.running) {
      throw new Error('SynologyChatAdapter is not running');
    }
    if (!this.client) {
      throw new Error('Synology Chat client is not configured. Provide a real Synology Chat client before sending messages.');
    }
    logger.debug('SynologyChatAdapter: send message', {
      textLength: text.length,
      hasFile: !!fileUrl,
    });
    return this.client.sendMessage(text, fileUrl);
  }

  async sendDirectMessage(userId: number, text: string): Promise<{ success: boolean; messageId?: string }> {
    if (!this.running) {
      throw new Error('SynologyChatAdapter is not running');
    }
    if (!this.client) {
      throw new Error('Synology Chat client is not configured. Provide a real Synology Chat client before sending direct messages.');
    }
    logger.debug('SynologyChatAdapter: send DM', { userId, textLength: text.length });
    return this.client.sendDirectMessage(userId, text);
  }

  validateWebhookToken(token: string): boolean {
    if (!this.config.outgoingWebhookToken) {
      return true;
    }
    return token === this.config.outgoingWebhookToken;
  }

  getBotName(): string {
    return this.config.botName || 'CodeBuddy';
  }
}

export class SynologyChatChannel extends BaseChannel {
  private adapter: SynologyChatAdapter | null = null;

  constructor(config: SynologyChatChannelConfig) {
    super('synology-chat', config);
  }

  async connect(): Promise<void> {
    const cfg = this.config as SynologyChatChannelConfig;
    this.adapter = new SynologyChatAdapter({
      incomingWebhookUrl: cfg.incomingWebhookUrl,
      outgoingWebhookToken: cfg.outgoingWebhookToken,
      botName: cfg.botName,
      port: cfg.port,
      client: cfg.client,
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
    const result = await this.adapter.sendMessage(message.content);
    return { success: result.success, messageId: result.messageId, timestamp: new Date() };
  }
}
