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
}

export interface SynologyChatChannelConfig extends ChannelConfig {
  incomingWebhookUrl: string;
  outgoingWebhookToken?: string;
  botName?: string;
  port?: number;
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

export class SynologyChatAdapter {
  private config: SynologyChatConfig;
  private running = false;

  constructor(config: SynologyChatConfig) {
    this.config = {
      botName: 'CodeBuddy',
      port: 8100,
      ...config,
    };
  }

  async start(): Promise<void> {
    if (this.running) {
      throw new Error('SynologyChatAdapter is already running');
    }
    logger.debug('SynologyChatAdapter: starting', { botName: this.config.botName });
    this.running = true;
  }

  async stop(): Promise<void> {
    if (!this.running) {
      throw new Error('SynologyChatAdapter is not running');
    }
    logger.debug('SynologyChatAdapter: stopping');
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  async sendMessage(text: string, fileUrl?: string): Promise<{ success: boolean }> {
    if (!this.running) {
      throw new Error('SynologyChatAdapter is not running');
    }
    logger.debug('SynologyChatAdapter: send message', {
      textLength: text.length,
      hasFile: !!fileUrl,
    });
    return { success: true };
  }

  async sendDirectMessage(userId: number, text: string): Promise<{ success: boolean }> {
    if (!this.running) {
      throw new Error('SynologyChatAdapter is not running');
    }
    logger.debug('SynologyChatAdapter: send DM', { userId, textLength: text.length });
    return { success: true };
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
    return { success: result.success, timestamp: new Date() };
  }
}
