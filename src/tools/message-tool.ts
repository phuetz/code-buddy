/**
 * Cross-Channel Message Tool
 *
 * Provides unified messaging operations (send, react, pin, thread, search,
 * role management, kick, ban) across all supported channels.
 */

import { logger } from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export type MessageAction = 'send' | 'react' | 'pin' | 'thread_create' | 'search' | 'role_add' | 'kick' | 'ban';

export interface MessageTarget {
  channel: string;
  chatId: string;
  userId?: string;
}

export interface MessageToolResult {
  success: boolean;
  action: MessageAction;
  messageId?: string;
  error?: string;
}

export interface MessageToolTransport {
  supportedChannels?: string[];
  send(target: MessageTarget, text: string): MessageToolResult;
  react(target: MessageTarget, messageId: string, emoji: string): MessageToolResult;
  pin(target: MessageTarget, messageId: string): MessageToolResult;
  threadCreate(target: MessageTarget, messageId: string, text: string): MessageToolResult;
  search(target: MessageTarget, query: string): MessageToolResult;
  roleAdd(target: MessageTarget, userId: string, role: string): MessageToolResult;
  kick(target: MessageTarget, userId: string, reason?: string): MessageToolResult;
  ban(target: MessageTarget, userId: string, reason?: string): MessageToolResult;
}

export interface MessageToolConfig {
  transport?: MessageToolTransport;
}

interface RecordedAction {
  action: MessageAction;
  target: MessageTarget;
  timestamp: number;
  details: Record<string, unknown>;
}

// ============================================================================
// MessageTool
// ============================================================================

export class MessageTool {
  private static instance: MessageTool | null = null;
  private actions: RecordedAction[] = [];
  private transport?: MessageToolTransport;
  private supportedChannels = ['telegram', 'discord', 'slack', 'whatsapp', 'signal', 'matrix', 'teams', 'webchat'];

  constructor(config: MessageToolConfig = {}) {
    this.transport = config.transport;
  }

  static getInstance(config: MessageToolConfig = {}): MessageTool {
    if (!MessageTool.instance) {
      MessageTool.instance = new MessageTool(config);
    } else if (config.transport) {
      MessageTool.instance.setTransport(config.transport);
    }
    return MessageTool.instance;
  }

  static resetInstance(): void {
    MessageTool.instance = null;
  }

  setTransport(transport: MessageToolTransport): void {
    this.transport = transport;
  }

  send(target: MessageTarget, text: string): MessageToolResult {
    logger.info(`Sending message to ${target.channel}/${target.chatId}: ${text.substring(0, 50)}`);
    return this.runWithTransport('send', target, { text }, () => this.transport!.send(target, text));
  }

  react(target: MessageTarget, messageId: string, emoji: string): MessageToolResult {
    logger.info(`Adding reaction ${emoji} to ${messageId} on ${target.channel}`);
    return this.runWithTransport('react', target, { messageId, emoji }, () => this.transport!.react(target, messageId, emoji));
  }

  pin(target: MessageTarget, messageId: string): MessageToolResult {
    logger.info(`Pinning message ${messageId} on ${target.channel}`);
    return this.runWithTransport('pin', target, { messageId }, () => this.transport!.pin(target, messageId));
  }

  threadCreate(target: MessageTarget, messageId: string, text: string): MessageToolResult {
    logger.info(`Creating thread on ${messageId} in ${target.channel}`);
    return this.runWithTransport(
      'thread_create',
      target,
      { messageId, text },
      () => this.transport!.threadCreate(target, messageId, text),
    );
  }

  search(target: MessageTarget, query: string): MessageToolResult {
    logger.info(`Searching messages in ${target.channel}/${target.chatId}: ${query}`);
    return this.runWithTransport('search', target, { query }, () => this.transport!.search(target, query));
  }

  roleAdd(target: MessageTarget, userId: string, role: string): MessageToolResult {
    logger.info(`Adding role ${role} to ${userId} in ${target.channel}`);
    return this.runWithTransport('role_add', target, { userId, role }, () => this.transport!.roleAdd(target, userId, role));
  }

  kick(target: MessageTarget, userId: string, reason?: string): MessageToolResult {
    logger.info(`Kicking ${userId} from ${target.channel}: ${reason || 'no reason'}`);
    return this.runWithTransport('kick', target, { userId, reason }, () => this.transport!.kick(target, userId, reason));
  }

  ban(target: MessageTarget, userId: string, reason?: string): MessageToolResult {
    logger.info(`Banning ${userId} from ${target.channel}: ${reason || 'no reason'}`);
    return this.runWithTransport('ban', target, { userId, reason }, () => this.transport!.ban(target, userId, reason));
  }

  getActions(): RecordedAction[] {
    return [...this.actions];
  }

  getSupportedChannels(): string[] {
    return [...(this.transport?.supportedChannels ?? this.supportedChannels)];
  }

  private runWithTransport(
    action: MessageAction,
    target: MessageTarget,
    details: Record<string, unknown>,
    operation: () => MessageToolResult,
  ): MessageToolResult {
    if (!this.transport) {
      return {
        success: false,
        action,
        error: 'Message transport is not configured. Provide a real channel transport before executing message actions.',
      };
    }

    try {
      const result = operation();
      if (result.success) {
        this.actions.push({
          action,
          target,
          timestamp: Date.now(),
          details,
        });
      }
      return result;
    } catch (error) {
      return {
        success: false,
        action,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
