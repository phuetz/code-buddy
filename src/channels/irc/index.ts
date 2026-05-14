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
  transport?: IRCTransport;
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
  transport?: IRCTransport;
}

export interface IRCTransport {
  connect(config: IRCConfig): Promise<{ joinedChannels?: string[] }>;
  disconnect(): Promise<void>;
  sendMessage(target: string, text: string): Promise<{ success: boolean }>;
  sendNotice(target: string, text: string): Promise<{ success: boolean }>;
  sendAction(target: string, text: string): Promise<{ success: boolean }>;
  joinChannel(channel: string): Promise<void>;
  partChannel(channel: string, reason?: string): Promise<void>;
  setNick(nick: string): Promise<void>;
}

export class IRCAdapter {
  private config: IRCConfig;
  private transport?: IRCTransport;
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
    this.transport = config.transport;
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
    if (!this.transport) {
      throw new Error('IRC transport is not configured. Provide a real IRC transport before connecting.');
    }
    const result = await this.transport.connect(this.config);
    this.running = true;
    for (const ch of result.joinedChannels ?? this.config.channels) {
      this.joinedChannels.add(ch);
    }
  }

  async stop(): Promise<void> {
    if (!this.running) {
      throw new Error('IRCAdapter is not running');
    }
    logger.debug('IRCAdapter: disconnecting');
    await this.transport?.disconnect();
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
    if (!this.transport) {
      throw new Error('IRC transport is not configured. Provide a real IRC transport before sending messages.');
    }
    logger.debug('IRCAdapter: PRIVMSG', { target, textLength: text.length });
    return this.transport.sendMessage(target, text);
  }

  async sendNotice(target: string, text: string): Promise<{ success: boolean }> {
    if (!this.running) {
      throw new Error('IRCAdapter is not running');
    }
    if (!this.transport) {
      throw new Error('IRC transport is not configured. Provide a real IRC transport before sending notices.');
    }
    logger.debug('IRCAdapter: NOTICE', { target, textLength: text.length });
    return this.transport.sendNotice(target, text);
  }

  async sendAction(target: string, text: string): Promise<{ success: boolean }> {
    if (!this.running) {
      throw new Error('IRCAdapter is not running');
    }
    if (!this.transport) {
      throw new Error('IRC transport is not configured. Provide a real IRC transport before sending actions.');
    }
    logger.debug('IRCAdapter: ACTION', { target, textLength: text.length });
    return this.transport.sendAction(target, text);
  }

  async joinChannel(channel: string): Promise<void> {
    if (!this.running) {
      throw new Error('IRCAdapter is not running');
    }
    if (!this.transport) {
      throw new Error('IRC transport is not configured. Provide a real IRC transport before joining channels.');
    }
    await this.transport.joinChannel(channel);
    this.joinedChannels.add(channel);
    logger.debug('IRCAdapter: JOIN', { channel });
  }

  async partChannel(channel: string, reason?: string): Promise<void> {
    if (!this.running) {
      throw new Error('IRCAdapter is not running');
    }
    if (!this.transport) {
      throw new Error('IRC transport is not configured. Provide a real IRC transport before parting channels.');
    }
    await this.transport.partChannel(channel, reason);
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
    if (!this.transport) {
      throw new Error('IRC transport is not configured. Provide a real IRC transport before changing nick.');
    }
    await this.transport.setNick(nick);
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
      transport: cfg.transport,
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
