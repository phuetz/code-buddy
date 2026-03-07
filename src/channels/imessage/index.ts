/**
 * iMessage/BlueBubbles Channel Adapter
 *
 * Connects to a BlueBubbles server to send/receive iMessages.
 * Uses the BlueBubbles REST API for message operations with
 * a polling loop for inbound message detection.
 */

import { EventEmitter } from 'events';
import { logger } from '../../utils/logger.js';
import { BaseChannel, ChannelConfig, DeliveryResult, OutboundMessage } from '../core.js';

// ============================================================================
// Types
// ============================================================================

export interface IMessageConfig {
  serverUrl: string;
  password: string;
  port?: number;
  pollingInterval?: number;
  maxRetries?: number;
  retryDelay?: number;
}

export interface IMessageChannelConfig extends ChannelConfig {
  serverUrl: string;
  password: string;
  port?: number;
  pollingInterval?: number;
  maxRetries?: number;
  retryDelay?: number;
}

export interface IMessageChat {
  guid: string;
  displayName: string;
  participants: string[];
  lastMessage?: string;
  lastMessageDate?: string;
}

export interface IMessageMessage {
  guid: string;
  text: string;
  handle: string;
  chatGuid: string;
  dateCreated: string;
  isFromMe: boolean;
  attachments?: IMessageAttachment[];
}

export interface IMessageAttachment {
  guid: string;
  mimeType: string;
  filename: string;
  totalBytes: number;
}

interface BlueBubblesResponse<T> {
  status: number;
  message: string;
  data: T;
}

// ============================================================================
// IMessageAdapter
// ============================================================================

export class IMessageAdapter extends EventEmitter {
  private config: IMessageConfig;
  private running = false;
  private pollingTimer: ReturnType<typeof setInterval> | null = null;
  private lastMessageTimestamp: number = 0;
  private retryCount = 0;

  constructor(config: IMessageConfig) {
    super();
    this.config = {
      pollingInterval: 3000,
      maxRetries: 5,
      retryDelay: 5000,
      ...config,
    };
    if (this.config.port === undefined) {
      this.config.port = 1234;
    }
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  async start(): Promise<void> {
    if (this.running) {
      throw new Error('IMessageAdapter is already running');
    }

    logger.info('IMessageAdapter: connecting to BlueBubbles server', {
      serverUrl: this.config.serverUrl,
      port: this.config.port,
    });

    // Verify connectivity
    await this.healthCheck();

    this.running = true;
    this.lastMessageTimestamp = Date.now();
    this.retryCount = 0;

    // Start polling loop
    this.startPolling();

    this.emit('connected');
    logger.info('IMessageAdapter: connected successfully');
  }

  async stop(): Promise<void> {
    if (!this.running) {
      throw new Error('IMessageAdapter is not running');
    }

    this.stopPolling();
    this.running = false;

    this.emit('disconnected');
    logger.info('IMessageAdapter: disconnected');
  }

  isRunning(): boolean {
    return this.running;
  }

  getConfig(): IMessageConfig {
    return { ...this.config };
  }

  // ============================================================================
  // API Methods
  // ============================================================================

  async sendMessage(chatGuid: string, text: string): Promise<{ success: boolean; messageGuid: string }> {
    if (!this.running) {
      throw new Error('IMessageAdapter is not running');
    }

    const response = await this.apiRequest<{ guid: string }>('/api/v1/message/text', {
      method: 'POST',
      body: JSON.stringify({
        chatGuid,
        message: text,
        method: 'apple-script',
      }),
    });

    logger.debug('IMessageAdapter: message sent', { chatGuid, guid: response.data.guid });

    return {
      success: true,
      messageGuid: response.data.guid,
    };
  }

  async sendReaction(chatGuid: string, messageGuid: string, reaction: string): Promise<{ success: boolean }> {
    if (!this.running) {
      throw new Error('IMessageAdapter is not running');
    }

    await this.apiRequest('/api/v1/message/react', {
      method: 'POST',
      body: JSON.stringify({
        chatGuid,
        selectedMessageGuid: messageGuid,
        reaction,
      }),
    });

    return { success: true };
  }

  async getChats(limit = 25, offset = 0): Promise<IMessageChat[]> {
    if (!this.running) {
      throw new Error('IMessageAdapter is not running');
    }

    const response = await this.apiRequest<IMessageChat[]>(
      `/api/v1/chat?limit=${limit}&offset=${offset}&sort=lastmessage`
    );

    return response.data;
  }

  async getMessages(chatGuid: string, limit = 25, offset = 0): Promise<IMessageMessage[]> {
    if (!this.running) {
      throw new Error('IMessageAdapter is not running');
    }

    const response = await this.apiRequest<IMessageMessage[]>(
      `/api/v1/message?chatGuid=${encodeURIComponent(chatGuid)}&limit=${limit}&offset=${offset}&sort=DESC`
    );

    return response.data;
  }

  async getAttachment(attachmentGuid: string): Promise<Buffer> {
    if (!this.running) {
      throw new Error('IMessageAdapter is not running');
    }

    const url = `${this.getBaseUrl()}/api/v1/attachment/${encodeURIComponent(attachmentGuid)}/download?password=${encodeURIComponent(this.config.password)}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to download attachment: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async getChatMessages(chatGuid: string, after?: number): Promise<IMessageMessage[]> {
    if (!this.running) {
      throw new Error('IMessageAdapter is not running');
    }

    let url = `/api/v1/message?chatGuid=${encodeURIComponent(chatGuid)}&limit=50&sort=DESC`;
    if (after) {
      url += `&after=${after}`;
    }

    const response = await this.apiRequest<IMessageMessage[]>(url);
    return response.data;
  }

  // ============================================================================
  // Polling
  // ============================================================================

  private startPolling(): void {
    if (this.pollingTimer) return;

    this.pollingTimer = setInterval(async () => {
      try {
        await this.pollMessages();
        this.retryCount = 0;
      } catch (error) {
        this.retryCount++;
        const errMsg = error instanceof Error ? error.message : String(error);
        logger.warn(`IMessageAdapter: polling error (attempt ${this.retryCount})`, { error: errMsg });

        if (this.retryCount >= (this.config.maxRetries || 5)) {
          logger.error('IMessageAdapter: max retries exceeded, attempting reconnect');
          this.emit('error', new Error('Polling failed after max retries'));
          await this.reconnect();
        }
      }
    }, this.config.pollingInterval);
  }

  private stopPolling(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
  }

  private async pollMessages(): Promise<void> {
    const response = await this.apiRequest<IMessageMessage[]>(
      `/api/v1/message?limit=50&sort=DESC&after=${this.lastMessageTimestamp}`
    );

    const messages = response.data;
    if (!messages || messages.length === 0) return;

    // Process in chronological order
    const sorted = messages.sort((a, b) =>
      new Date(a.dateCreated).getTime() - new Date(b.dateCreated).getTime()
    );

    for (const msg of sorted) {
      if (msg.isFromMe) continue;

      const msgTime = new Date(msg.dateCreated).getTime();
      if (msgTime > this.lastMessageTimestamp) {
        this.lastMessageTimestamp = msgTime;
      }

      this.emit('message', {
        id: msg.guid,
        chatGuid: msg.chatGuid,
        sender: msg.handle,
        content: msg.text,
        timestamp: new Date(msg.dateCreated),
        attachments: msg.attachments,
      });
    }
  }

  // ============================================================================
  // Reconnection
  // ============================================================================

  private async reconnect(): Promise<void> {
    this.stopPolling();

    const maxRetries = this.config.maxRetries || 5;
    const retryDelay = this.config.retryDelay || 5000;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logger.info(`IMessageAdapter: reconnection attempt ${attempt}/${maxRetries}`);

        await this.healthCheck();

        // Reconnected successfully
        this.retryCount = 0;
        this.startPolling();
        this.emit('reconnected');
        logger.info('IMessageAdapter: reconnected successfully');
        return;
      } catch {
        if (attempt < maxRetries) {
          const delay = retryDelay * Math.pow(2, attempt - 1);
          logger.warn(`IMessageAdapter: reconnection failed, retrying in ${delay}ms`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    this.running = false;
    this.emit('disconnected', new Error('Reconnection failed after all retries'));
    logger.error('IMessageAdapter: reconnection failed permanently');
  }

  // ============================================================================
  // Internal Helpers
  // ============================================================================

  private getBaseUrl(): string {
    const port = this.config.port || 1234;
    return `${this.config.serverUrl}:${port}`;
  }

  private async apiRequest<T>(
    endpoint: string,
    init?: RequestInit
  ): Promise<BlueBubblesResponse<T>> {
    const separator = endpoint.includes('?') ? '&' : '?';
    const url = `${this.getBaseUrl()}${endpoint}${separator}password=${encodeURIComponent(this.config.password)}`;

    const response = await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`BlueBubbles API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json() as BlueBubblesResponse<T>;
    return data;
  }

  private async healthCheck(): Promise<void> {
    const url = `${this.getBaseUrl()}/api/v1/server/info?password=${encodeURIComponent(this.config.password)}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`BlueBubbles server health check failed: ${response.status}`);
    }
  }
}

export class IMessageChannel extends BaseChannel {
  private adapter: IMessageAdapter;

  constructor(config: IMessageChannelConfig) {
    super('imessage', {
      type: 'imessage',
      enabled: config.enabled,
      token: config.token,
      webhookUrl: config.webhookUrl,
      allowedUsers: config.allowedUsers,
      allowedChannels: config.allowedChannels,
      autoReply: config.autoReply,
      rateLimit: config.rateLimit,
      options: config.options,
    });
    this.adapter = new IMessageAdapter({
      serverUrl: config.serverUrl,
      password: config.password,
      port: config.port,
      pollingInterval: config.pollingInterval,
      maxRetries: config.maxRetries,
      retryDelay: config.retryDelay,
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
      const result = await this.adapter.sendMessage(message.channelId, message.content);
      this.status.lastActivity = new Date();
      return {
        success: result.success,
        messageId: result.messageGuid,
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

export default IMessageAdapter;
