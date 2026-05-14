/**
 * Twilio Voice Channel Adapter
 *
 * Manages voice calls via Twilio API.
 * Provides a lightweight in-process adapter for lifecycle and call flows.
 */

import { logger } from '../../utils/logger.js';
import { BaseChannel, ChannelConfig, DeliveryResult, OutboundMessage } from '../core.js';

export interface TwilioVoiceConfig {
  accountSid: string;
  authToken: string;
  phoneNumber: string;
  webhookUrl?: string;
  client?: TwilioVoiceClient;
}

export interface TwilioVoiceChannelConfig extends ChannelConfig {
  accountSid: string;
  authToken: string;
  phoneNumber: string;
  webhookUrl?: string;
  client?: TwilioVoiceClient;
}

export interface TwilioVoiceClient {
  start?(): Promise<void>;
  stop?(): Promise<void>;
  makeCall(params: { from: string; to: string; twiml: string; webhookUrl?: string }): Promise<{ success: boolean; callSid?: string }>;
  endCall(callSid: string): Promise<{ success: boolean }>;
}

export class TwilioVoiceAdapter {
  private config: TwilioVoiceConfig;
  private client?: TwilioVoiceClient;
  private running = false;
  private activeCalls: Map<string, { to: string; startedAt: Date }> = new Map();

  constructor(config: TwilioVoiceConfig) {
    this.config = { ...config };
    this.client = config.client;
  }

  async start(): Promise<void> {
    if (this.running) {
      throw new Error('TwilioVoiceAdapter is already running');
    }
    if (!this.client) {
      throw new Error('Twilio Voice client is not configured. Provide a real Twilio client before connecting.');
    }
    logger.debug('TwilioVoiceAdapter: initializing', {
      accountSid: this.config.accountSid,
      phoneNumber: this.config.phoneNumber,
    });
    await this.client.start?.();
    this.running = true;
  }

  async stop(): Promise<void> {
    if (!this.running) {
      throw new Error('TwilioVoiceAdapter is not running');
    }
    logger.debug('TwilioVoiceAdapter: stopping');
    this.activeCalls.clear();
    await this.client?.stop?.();
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  async makeCall(to: string, message: string): Promise<{ success: boolean; callSid?: string }> {
    if (!this.running) {
      throw new Error('TwilioVoiceAdapter is not running');
    }
    if (!this.client) {
      throw new Error('Twilio Voice client is not configured. Provide a real Twilio client before making calls.');
    }
    const twiml = this.generateTwiML(message);
    const result = await this.client.makeCall({
      from: this.config.phoneNumber,
      to,
      twiml,
      webhookUrl: this.config.webhookUrl,
    });
    if (result.success && result.callSid) {
      this.activeCalls.set(result.callSid, { to, startedAt: new Date() });
    }
    logger.debug('TwilioVoiceAdapter: making call', { to, callSid: result.callSid, messageLength: message.length });
    return result;
  }

  async endCall(callSid: string): Promise<{ success: boolean }> {
    if (!this.running) {
      throw new Error('TwilioVoiceAdapter is not running');
    }
    if (!this.client) {
      throw new Error('Twilio Voice client is not configured. Provide a real Twilio client before ending calls.');
    }
    const result = await this.client.endCall(callSid);
    if (result.success) {
      this.activeCalls.delete(callSid);
    }
    logger.debug('TwilioVoiceAdapter: ending call', { callSid, success: result.success });
    return result;
  }

  getActiveCalls(): Array<{ callSid: string; to: string; startedAt: Date }> {
    return Array.from(this.activeCalls.entries()).map(([callSid, info]) => ({
      callSid,
      ...info,
    }));
  }

  generateTwiML(message: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${this.escapeXml(message)}</Say></Response>`;
  }

  getConfig(): TwilioVoiceConfig {
    return { ...this.config };
  }

  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}

export class TwilioVoiceChannel extends BaseChannel {
  private adapter: TwilioVoiceAdapter;

  constructor(config: TwilioVoiceChannelConfig) {
    super('twilio-voice', {
      type: 'twilio-voice',
      enabled: config.enabled,
      token: config.token,
      webhookUrl: config.webhookUrl,
      allowedUsers: config.allowedUsers,
      allowedChannels: config.allowedChannels,
      autoReply: config.autoReply,
      rateLimit: config.rateLimit,
      options: config.options,
    });
    this.adapter = new TwilioVoiceAdapter({
      accountSid: config.accountSid,
      authToken: config.authToken,
      phoneNumber: config.phoneNumber,
      webhookUrl: config.webhookUrl,
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
      const result = await this.adapter.makeCall(message.channelId, message.content);
      this.status.lastActivity = new Date();
      return {
        success: result.success,
        messageId: result.callSid,
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

export default TwilioVoiceAdapter;
