/**
 * WeCom Channel Adapter
 *
 * Publishes outbound Code Buddy messages to WeCom group robot webhooks.
 */

import { logger } from '../../utils/logger.js';
import { BaseChannel, ChannelConfig, DeliveryResult, OutboundMessage } from '../core.js';

export type WeComMessageType = 'text' | 'markdown';

export interface WeComConfig {
  webhookUrl?: string;
  key?: string;
  msgType?: WeComMessageType;
  mentionedList?: string[];
  mentionedMobileList?: string[];
}

export interface WeComChannelConfig extends ChannelConfig {
  key?: string;
  msgType?: WeComMessageType;
  mentionedList?: string[];
  mentionedMobileList?: string[];
}

export interface WeComSendOptions {
  msgType?: WeComMessageType;
  mentionedList?: string[];
  mentionedMobileList?: string[];
}

export interface WeComSendResult {
  errcode?: number;
  errmsg?: string;
  success: boolean;
  status: number;
}

interface WeComPayload {
  markdown?: {
    content: string;
  };
  msgtype: WeComMessageType;
  text?: {
    content: string;
    mentioned_list?: string[];
    mentioned_mobile_list?: string[];
  };
}

type WeComChannelData = Partial<WeComSendOptions>;

export class WeComAdapter {
  private readonly config: Required<Pick<WeComConfig, 'webhookUrl'>> & Omit<WeComConfig, 'webhookUrl'>;
  private running = false;

  constructor(config: WeComConfig = {}) {
    this.config = {
      ...config,
      webhookUrl: resolveWebhookUrl(config),
    };
  }

  async start(): Promise<void> {
    if (this.running) {
      throw new Error('WeComAdapter is already running');
    }
    new URL(this.config.webhookUrl);
    logger.debug('WeComAdapter: ready', sanitizeWebhookInfo(this.config.webhookUrl));
    this.running = true;
  }

  async stop(): Promise<void> {
    if (!this.running) {
      throw new Error('WeComAdapter is not running');
    }
    logger.debug('WeComAdapter: stopping');
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  getWebhookInfo(): Record<string, unknown> {
    return sanitizeWebhookInfo(this.config.webhookUrl);
  }

  getConfig(): WeComConfig {
    return {
      ...this.config,
      ...(this.config.mentionedList ? { mentionedList: [...this.config.mentionedList] } : {}),
      ...(this.config.mentionedMobileList ? { mentionedMobileList: [...this.config.mentionedMobileList] } : {}),
    };
  }

  async send(content: string, options: WeComSendOptions = {}): Promise<WeComSendResult> {
    if (!this.running) {
      throw new Error('WeComAdapter is not running');
    }

    const response = await fetch(this.config.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildPayload(content, this.config, options)),
    });
    const responseText = await response.text();
    const body = parseJsonObject(responseText);
    const errcode = typeof body.errcode === 'number' ? body.errcode : undefined;
    const errmsg = typeof body.errmsg === 'string' ? body.errmsg : undefined;

    if (!response.ok || (errcode !== undefined && errcode !== 0)) {
      const errorMessage = errmsg ?? (responseText.trim() || 'empty response');
      throw new Error(`WeCom send failed (${response.status}${errcode !== undefined ? `/${errcode}` : ''}): ${errorMessage}`);
    }

    return {
      errcode,
      errmsg,
      success: true,
      status: response.status,
    };
  }
}

export class WeComChannel extends BaseChannel {
  private adapter: WeComAdapter;
  private readonly defaultMsgType?: WeComMessageType;
  private readonly defaultMentionedList?: string[];
  private readonly defaultMentionedMobileList?: string[];

  constructor(config: WeComChannelConfig) {
    super('wecom', {
      type: 'wecom',
      enabled: config.enabled,
      token: config.token,
      webhookUrl: config.webhookUrl,
      allowedUsers: config.allowedUsers,
      allowedChannels: config.allowedChannels,
      autoReply: config.autoReply,
      rateLimit: config.rateLimit,
      options: config.options,
    });
    this.defaultMsgType = config.msgType;
    this.defaultMentionedList = config.mentionedList;
    this.defaultMentionedMobileList = config.mentionedMobileList;
    this.adapter = new WeComAdapter({
      webhookUrl: config.webhookUrl,
      key: config.key ?? config.token,
      msgType: config.msgType,
      mentionedList: config.mentionedList,
      mentionedMobileList: config.mentionedMobileList,
    });
  }

  async connect(): Promise<void> {
    await this.adapter.start();
    this.status.connected = true;
    this.status.authenticated = true;
    this.status.lastActivity = new Date();
    this.status.info = this.adapter.getWebhookInfo();
    this.emit('connected', this.type);
  }

  async disconnect(): Promise<void> {
    if (!this.status.connected) return;
    await this.adapter.stop();
    this.status.connected = false;
    this.status.authenticated = false;
    this.status.lastActivity = new Date();
    this.emit('disconnected', this.type);
  }

  async send(message: OutboundMessage): Promise<DeliveryResult> {
    try {
      const channelData = extractWeComChannelData(message);
      const result = await this.adapter.send(this.formatMessage(message.content, message.parseMode), {
        msgType: channelData.msgType ?? this.defaultMsgType,
        mentionedList: channelData.mentionedList ?? this.defaultMentionedList,
        mentionedMobileList: channelData.mentionedMobileList ?? this.defaultMentionedMobileList,
      });
      this.status.lastActivity = new Date();
      return {
        success: result.success,
        messageId: result.errmsg,
        timestamp: new Date(),
      };
    } catch (error) {
      this.status.error = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: this.status.error,
        timestamp: new Date(),
      };
    }
  }
}

function resolveWebhookUrl(config: WeComConfig): string {
  const explicit = config.webhookUrl?.trim();
  if (explicit) return explicit;
  const key = config.key?.trim();
  if (key) {
    const url = new URL('https://qyapi.weixin.qq.com/cgi-bin/webhook/send');
    url.searchParams.set('key', key);
    return url.toString();
  }
  throw new Error('WeCom webhookUrl or key is required');
}

function buildPayload(content: string, config: WeComConfig, options: WeComSendOptions): WeComPayload {
  const msgtype = options.msgType ?? config.msgType ?? 'text';
  if (msgtype === 'markdown') {
    return {
      msgtype,
      markdown: {
        content,
      },
    };
  }
  const mentionedList = options.mentionedList ?? config.mentionedList;
  const mentionedMobileList = options.mentionedMobileList ?? config.mentionedMobileList;
  return {
    msgtype: 'text',
    text: {
      content,
      ...(mentionedList?.length ? { mentioned_list: mentionedList } : {}),
      ...(mentionedMobileList?.length ? { mentioned_mobile_list: mentionedMobileList } : {}),
    },
  };
}

function extractWeComChannelData(message: OutboundMessage): WeComChannelData {
  const raw = message.channelData?.wecom;
  if (!isRecord(raw)) return {};
  return {
    msgType: raw.msgType === 'markdown' || raw.msgType === 'text' ? raw.msgType : undefined,
    mentionedList: Array.isArray(raw.mentionedList)
      ? raw.mentionedList.filter((value): value is string => typeof value === 'string')
      : undefined,
    mentionedMobileList: Array.isArray(raw.mentionedMobileList)
      ? raw.mentionedMobileList.filter((value): value is string => typeof value === 'string')
      : undefined,
  };
}

function sanitizeWebhookInfo(webhookUrl: string): Record<string, unknown> {
  const url = new URL(webhookUrl);
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  return {
    webhookOrigin: url.origin,
    webhookPath: url.pathname,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJsonObject(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export default WeComAdapter;
