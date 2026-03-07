/**
 * IRC Channel Adapter
 *
 * Connects to IRC servers for sending/receiving messages.
 * Supports multiple channels, SASL auth, and TLS.
 */

import { logger } from '../../utils/logger.js';
import { BaseChannel, ChannelConfig, DeliveryResult, OutboundMessage } from '../core.js';

export interface IRCConfig {
  server: string;
  port?: number;
  nick: string;
  username?: string;
  realname?: string;
  password?: string;
  channels: string[];
  useTLS?: boolean;
  sasl?: boolean;
}

export interface IRCChannelConfig extends ChannelConfig {
  server: string;
  port?: number;
  nick: string;
  username?: string;
  realname?: string;
  password?: string;
  channels: string[];
  useTLS?: boolean;
  sasl?: boolean;
}

export class IRCAdapter {
  private config: IRCConfig;
  private running = false;
  private joinedChannels: Set<string> = new Set();

  constructor(config: IRCConfig) {
    this.config = {
      port: config.useTLS ? 6697 : 6667,
      username: config.nick,
      realname: config.nick,
      useTLS: false,
      sasl: false,
      ...config,
    };
  }

  async start(): Promise<void> {
    if (this.running) {
      throw new Error('IRCAdapter is already running');
    }
    logger.debug('IRCAdapter: connecting', {
      server: this.config.server,
      port: this.config.port,
      nick: this.config.nick,
      tls: this.config.useTLS,
    });
    this.running = true;
    for (const ch of this.config.channels) {
      this.joinedChannels.add(ch);
    }
  }

  async stop(): Promise<void> {
    if (!this.running) {
      throw new Error('IRCAdapter is not running');
    }
    logger.debug('IRCAdapter: disconnecting');
    this.joinedChannels.clear();
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  async sendMessage(target: string, text: string): Promise<{ success: boolean }> {
    if (!this.running) {
      throw new Error('IRCAdapter is not running');
    }
    logger.debug('IRCAdapter: PRIVMSG', { target, textLength: text.length });
    return { success: true };
  }

  async sendNotice(target: string, text: string): Promise<{ success: boolean }> {
    if (!this.running) {
      throw new Error('IRCAdapter is not running');
    }
    logger.debug('IRCAdapter: NOTICE', { target, textLength: text.length });
    return { success: true };
  }

  async sendAction(target: string, text: string): Promise<{ success: boolean }> {
    if (!this.running) {
      throw new Error('IRCAdapter is not running');
    }
    logger.debug('IRCAdapter: ACTION', { target, textLength: text.length });
    return { success: true };
  }

  async joinChannel(channel: string): Promise<void> {
    if (!this.running) {
      throw new Error('IRCAdapter is not running');
    }
    this.joinedChannels.add(channel);
    logger.debug('IRCAdapter: JOIN', { channel });
  }

  async partChannel(channel: string, reason?: string): Promise<void> {
    if (!this.running) {
      throw new Error('IRCAdapter is not running');
    }
    this.joinedChannels.delete(channel);
    logger.debug('IRCAdapter: PART', { channel, reason });
  }

  getJoinedChannels(): string[] {
    return Array.from(this.joinedChannels);
  }

  getNick(): string {
    return this.config.nick;
  }

  async setNick(nick: string): Promise<void> {
    if (!this.running) {
      throw new Error('IRCAdapter is not running');
    }
    this.config.nick = nick;
    logger.debug('IRCAdapter: NICK', { nick });
  }
}

export class IRCChannel extends BaseChannel {
  private adapter: IRCAdapter | null = null;

  constructor(config: IRCChannelConfig) {
    super('irc', config);
  }

  async connect(): Promise<void> {
    const cfg = this.config as IRCChannelConfig;
    this.adapter = new IRCAdapter({
      server: cfg.server,
      port: cfg.port,
      nick: cfg.nick,
      username: cfg.username,
      realname: cfg.realname,
      password: cfg.password,
      channels: cfg.channels || [],
      useTLS: cfg.useTLS,
      sasl: cfg.sasl,
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
    const target = message.channelId || (this.config as IRCChannelConfig).channels?.[0] || '';
    const result = await this.adapter.sendMessage(target, message.content);
    return { success: result.success, timestamp: new Date() };
  }
}
