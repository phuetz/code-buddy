/**
 * Feishu (Lark) Channel Adapter
 *
 * Connects to Feishu/Lark API for messaging within the Feishu ecosystem.
 * Supports text, rich text, interactive cards, file uploads,
 * interactive approval cards, and reasoning stream hooks.
 *
 * Native Engine v2026.3.11 alignment: approval cards, reasoning streams,
 * identity-aware headers, full thread context.
 */

import { logger } from '../../utils/logger.js';
import { BaseChannel, ChannelConfig, DeliveryResult, OutboundMessage } from '../core.js';

// ============================================================================
// Types
// ============================================================================

export interface FeishuConfig {
  appId: string;
  appSecret: string;
  verificationToken?: string;
  encryptKey?: string;
  port?: number;
  client?: FeishuClient;
  /** Agent name for card headers (identity-aware) */
  agentName?: string;
  /** Agent avatar image key */
  agentAvatar?: string;
}

/**
 * Action button for interactive approval/launcher cards.
 */
export interface FeishuCardAction {
  /** Button label */
  label: string;
  /** Action identifier (sent back in card callback) */
  actionId: string;
  /** Button style: primary, danger, or default */
  style?: 'primary' | 'danger' | 'default';
}

/**
 * Reasoning stream handler — called during LLM reasoning.
 */
export type ReasoningStreamHandler = (chunk: string) => void;

/**
 * Reasoning end handler — called when reasoning completes.
 */
export type ReasoningEndHandler = (fullReasoning: string) => void;

export interface FeishuChannelConfig extends ChannelConfig {
  appId: string;
  appSecret: string;
  verificationToken?: string;
  encryptKey?: string;
  port?: number;
  client?: FeishuClient;
}

export interface FeishuMessage {
  messageId: string;
  chatId: string;
  senderId: string;
  content: string;
  messageType: 'text' | 'post' | 'image' | 'interactive' | 'file';
  createTime: string;
}

export interface FeishuClient {
  start(): Promise<{ accessToken?: string }>;
  stop?(): Promise<void>;
  sendText(chatId: string, text: string): Promise<{ success: boolean; messageId?: string }>;
  sendCard(chatId: string, card: Record<string, unknown>): Promise<{ success: boolean; messageId?: string }>;
  sendImage(chatId: string, imageKey: string): Promise<{ success: boolean; messageId?: string }>;
  replyMessage(messageId: string, text: string): Promise<{ success: boolean }>;
  getChatMembers(chatId: string): Promise<Array<{ userId: string; name: string }>>;
  getThreadMessages(chatId: string): Promise<FeishuMessage[]>;
}

export class FeishuAdapter {
  private config: FeishuConfig;
  private client?: FeishuClient;
  private running = false;
  private accessToken: string | null = null;

  constructor(config: FeishuConfig) {
    this.config = {
      port: 9000,
      ...config,
    };
    this.client = config.client;
  }

  async start(): Promise<void> {
    if (this.running) {
      throw new Error('FeishuAdapter is already running');
    }
    if (!this.client) {
      throw new Error('Feishu client is not configured. Provide a real Feishu client before connecting.');
    }
    logger.debug('FeishuAdapter: starting', { appId: this.config.appId });
    const result = await this.client.start();
    this.accessToken = result.accessToken ?? null;
    this.running = true;
  }

  async stop(): Promise<void> {
    if (!this.running) {
      throw new Error('FeishuAdapter is not running');
    }
    logger.debug('FeishuAdapter: stopping');
    await this.client?.stop?.();
    this.accessToken = null;
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  async sendText(chatId: string, text: string): Promise<{ success: boolean; messageId?: string }> {
    if (!this.running) {
      throw new Error('FeishuAdapter is not running');
    }
    if (!this.client) {
      throw new Error('Feishu client is not configured. Provide a real Feishu client before sending messages.');
    }
    logger.debug('FeishuAdapter: send text', { chatId, textLength: text.length });
    return this.client.sendText(chatId, text);
  }

  async sendCard(chatId: string, card: Record<string, unknown>): Promise<{ success: boolean; messageId?: string }> {
    if (!this.running) {
      throw new Error('FeishuAdapter is not running');
    }
    if (!this.client) {
      throw new Error('Feishu client is not configured. Provide a real Feishu client before sending cards.');
    }
    logger.debug('FeishuAdapter: send card', { chatId });
    return this.client.sendCard(chatId, card);
  }

  async sendImage(chatId: string, imageKey: string): Promise<{ success: boolean; messageId?: string }> {
    if (!this.running) {
      throw new Error('FeishuAdapter is not running');
    }
    if (!this.client) {
      throw new Error('Feishu client is not configured. Provide a real Feishu client before sending images.');
    }
    logger.debug('FeishuAdapter: send image', { chatId, imageKey });
    return this.client.sendImage(chatId, imageKey);
  }

  async replyMessage(messageId: string, text: string): Promise<{ success: boolean }> {
    if (!this.running) {
      throw new Error('FeishuAdapter is not running');
    }
    if (!this.client) {
      throw new Error('Feishu client is not configured. Provide a real Feishu client before sending replies.');
    }
    logger.debug('FeishuAdapter: reply', { messageId, textLength: text.length });
    return this.client.replyMessage(messageId, text);
  }

  async getChatMembers(chatId: string): Promise<Array<{ userId: string; name: string }>> {
    if (!this.running) {
      throw new Error('FeishuAdapter is not running');
    }
    if (!this.client) {
      throw new Error('Feishu client is not configured. Provide a real Feishu client before reading chat members.');
    }
    logger.debug('FeishuAdapter: get chat members', { chatId });
    return this.client.getChatMembers(chatId);
  }

  getAccessToken(): string | null {
    return this.accessToken;
  }

  // ============================================================================
  // Interactive Cards (Native Engine v2026.3.11)
  // ============================================================================

  /**
   * Build an interactive approval card with approve/reject actions.
   */
  buildApprovalCard(
    title: string,
    description: string,
    actions: FeishuCardAction[],
  ): Record<string, unknown> {
    const header: Record<string, unknown> = {
      title: { tag: 'plain_text', content: title },
      template: 'blue',
    };
    // Identity-aware: inject agent name/avatar if configured
    if (this.config.agentName) {
      header.subtitle = { tag: 'plain_text', content: this.config.agentName };
    }

    return {
      config: { wide_screen_mode: true },
      header,
      elements: [
        { tag: 'div', text: { tag: 'lark_md', content: description } },
        { tag: 'hr' },
        {
          tag: 'action',
          actions: actions.map(a => ({
            tag: 'button',
            text: { tag: 'plain_text', content: a.label },
            type: a.style ?? 'default',
            value: { action_id: a.actionId },
          })),
        },
      ],
    };
  }

  /**
   * Build an action launcher card with multiple buttons.
   */
  buildActionLauncherCard(
    title: string,
    buttons: FeishuCardAction[],
  ): Record<string, unknown> {
    return {
      config: { wide_screen_mode: true },
      header: {
        title: { tag: 'plain_text', content: title },
        template: 'green',
      },
      elements: [
        {
          tag: 'action',
          actions: buttons.map(b => ({
            tag: 'button',
            text: { tag: 'plain_text', content: b.label },
            type: b.style ?? 'default',
            value: { action_id: b.actionId },
          })),
        },
      ],
    };
  }

  // ============================================================================
  // Reasoning Streams (Native Engine v2026.3.11)
  // ============================================================================

  private reasoningStreamHandlers: ReasoningStreamHandler[] = [];
  private reasoningEndHandlers: ReasoningEndHandler[] = [];

  /**
   * Register a handler for reasoning stream chunks.
   */
  onReasoningStream(handler: ReasoningStreamHandler): void {
    this.reasoningStreamHandlers.push(handler);
  }

  /**
   * Register a handler for reasoning completion.
   */
  onReasoningEnd(handler: ReasoningEndHandler): void {
    this.reasoningEndHandlers.push(handler);
  }

  /**
   * Emit a reasoning stream chunk to all registered handlers.
   */
  emitReasoningStream(chunk: string): void {
    for (const handler of this.reasoningStreamHandlers) {
      try {
        handler(chunk);
      } catch (err) {
        logger.debug(`Feishu reasoning stream handler error: ${err}`);
      }
    }
  }

  /**
   * Emit reasoning end to all registered handlers.
   */
  emitReasoningEnd(fullReasoning: string): void {
    for (const handler of this.reasoningEndHandlers) {
      try {
        handler(fullReasoning);
      } catch (err) {
        logger.debug(`Feishu reasoning end handler error: ${err}`);
      }
    }
  }

  // ============================================================================
  // Thread Context (Native Engine v2026.3.11)
  // ============================================================================

  /**
   * Fetch full thread messages including bot replies.
   */
  async getThreadMessages(chatId: string): Promise<FeishuMessage[]> {
    if (!this.running) {
      throw new Error('FeishuAdapter is not running');
    }
    if (!this.client) {
      throw new Error('Feishu client is not configured. Provide a real Feishu client before reading thread messages.');
    }
    logger.debug('FeishuAdapter: get thread messages', { chatId });
    return this.client.getThreadMessages(chatId);
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
    const chatId = message.channelId || '';

    // Send as card if channelData.feishu.card is provided
    const feishuData = (message as { channelData?: { feishu?: { card?: Record<string, unknown> } } }).channelData?.feishu;
    if (feishuData?.card) {
      const result = await this.adapter.sendCard(chatId, feishuData.card);
      return { success: result.success, messageId: result.messageId, timestamp: new Date() };
    }

    const result = await this.adapter.sendText(chatId, message.content);
    return { success: result.success, messageId: result.messageId, timestamp: new Date() };
  }

  /**
   * Get the underlying adapter (for direct card/reasoning API access).
   */
  getAdapter(): FeishuAdapter | null {
    return this.adapter;
  }
}
