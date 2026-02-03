/**
 * Multi-Channel Support
 *
 * Inspired by OpenClaw's multi-platform messaging support.
 * Provides unified interface for Telegram, Discord, Slack, and more.
 */

import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Supported channel types
 */
export type ChannelType =
  | 'telegram'
  | 'discord'
  | 'slack'
  | 'whatsapp'
  | 'signal'
  | 'matrix'
  | 'cli'
  | 'web'
  | 'api';

/**
 * Message direction
 */
export type MessageDirection = 'inbound' | 'outbound';

/**
 * Message content type
 */
export type ContentType =
  | 'text'
  | 'image'
  | 'audio'
  | 'video'
  | 'file'
  | 'location'
  | 'contact'
  | 'sticker'
  | 'voice'
  | 'command';

/**
 * User/sender information
 */
export interface ChannelUser {
  /** User ID on the channel */
  id: string;
  /** Username or handle */
  username?: string;
  /** Display name */
  displayName?: string;
  /** Profile picture URL */
  avatarUrl?: string;
  /** Is this a bot */
  isBot?: boolean;
  /** Is this the channel owner/admin */
  isAdmin?: boolean;
  /** Raw platform-specific data */
  raw?: unknown;
}

/**
 * Channel/chat information
 */
export interface ChannelInfo {
  /** Channel ID */
  id: string;
  /** Channel type */
  type: ChannelType;
  /** Channel name */
  name?: string;
  /** Is this a direct message */
  isDM?: boolean;
  /** Is this a group chat */
  isGroup?: boolean;
  /** Number of participants */
  participantCount?: number;
  /** Channel description */
  description?: string;
  /** Raw platform-specific data */
  raw?: unknown;
}

/**
 * Attachment in a message
 */
export interface MessageAttachment {
  /** Attachment type */
  type: ContentType;
  /** URL to the attachment */
  url?: string;
  /** Local file path */
  filePath?: string;
  /** Base64 encoded data */
  data?: string;
  /** MIME type */
  mimeType?: string;
  /** File name */
  fileName?: string;
  /** File size in bytes */
  size?: number;
  /** Duration for audio/video */
  duration?: number;
  /** Dimensions for images/videos */
  width?: number;
  height?: number;
  /** Caption */
  caption?: string;
}

/**
 * Incoming message
 */
export interface InboundMessage {
  /** Message ID */
  id: string;
  /** Channel info */
  channel: ChannelInfo;
  /** Sender info */
  sender: ChannelUser;
  /** Message content */
  content: string;
  /** Content type */
  contentType: ContentType;
  /** Attachments */
  attachments?: MessageAttachment[];
  /** Reply to message ID */
  replyTo?: string;
  /** Timestamp */
  timestamp: Date;
  /** Is this a command (starts with /) */
  isCommand?: boolean;
  /** Command name if isCommand */
  commandName?: string;
  /** Command arguments if isCommand */
  commandArgs?: string[];
  /** Thread/topic ID */
  threadId?: string;
  /** Raw platform message */
  raw?: unknown;
}

/**
 * Outgoing message
 */
export interface OutboundMessage {
  /** Target channel */
  channelId: string;
  /** Message content */
  content: string;
  /** Content type */
  contentType?: ContentType;
  /** Attachments */
  attachments?: MessageAttachment[];
  /** Reply to message ID */
  replyTo?: string;
  /** Thread/topic ID */
  threadId?: string;
  /** Parse mode (markdown, html, plain) */
  parseMode?: 'markdown' | 'html' | 'plain';
  /** Disable link preview */
  disablePreview?: boolean;
  /** Silent message (no notification) */
  silent?: boolean;
  /** Buttons/keyboard */
  buttons?: MessageButton[];
}

/**
 * Interactive button
 */
export interface MessageButton {
  /** Button text */
  text: string;
  /** Button type */
  type: 'url' | 'callback' | 'reply';
  /** URL for url type */
  url?: string;
  /** Callback data */
  data?: string;
}

/**
 * Message delivery result
 */
export interface DeliveryResult {
  /** Success flag */
  success: boolean;
  /** Sent message ID */
  messageId?: string;
  /** Error message if failed */
  error?: string;
  /** Timestamp */
  timestamp: Date;
}

/**
 * Channel status
 */
export interface ChannelStatus {
  /** Channel type */
  type: ChannelType;
  /** Is connected */
  connected: boolean;
  /** Is authenticated */
  authenticated: boolean;
  /** Last activity time */
  lastActivity?: Date;
  /** Error if any */
  error?: string;
  /** Additional info */
  info?: Record<string, unknown>;
}

/**
 * Channel configuration
 */
export interface ChannelConfig {
  /** Channel type */
  type: ChannelType;
  /** Is enabled */
  enabled: boolean;
  /** API token/key */
  token?: string;
  /** Webhook URL */
  webhookUrl?: string;
  /** Allowed users (for security) */
  allowedUsers?: string[];
  /** Allowed channels */
  allowedChannels?: string[];
  /** Auto-reply enabled */
  autoReply?: boolean;
  /** Rate limit (messages per minute) */
  rateLimit?: number;
  /** Custom options */
  options?: Record<string, unknown>;
}

/**
 * Channel events
 */
export interface ChannelEvents {
  'message': (message: InboundMessage) => void;
  'command': (message: InboundMessage) => void;
  'connected': (channel: ChannelType) => void;
  'disconnected': (channel: ChannelType, error?: Error) => void;
  'error': (channel: ChannelType, error: Error) => void;
  'typing': (channel: ChannelInfo, user: ChannelUser) => void;
  'reaction': (channel: ChannelInfo, messageId: string, emoji: string, user: ChannelUser) => void;
}

// ============================================================================
// Base Channel Class
// ============================================================================

/**
 * Abstract base class for channel implementations
 */
export abstract class BaseChannel extends EventEmitter {
  readonly type: ChannelType;
  protected config: ChannelConfig;
  protected status: ChannelStatus;

  constructor(type: ChannelType, config: ChannelConfig) {
    super();
    this.type = type;
    this.config = config;
    this.status = {
      type,
      connected: false,
      authenticated: false,
    };
  }

  /**
   * Connect to the channel
   */
  abstract connect(): Promise<void>;

  /**
   * Disconnect from the channel
   */
  abstract disconnect(): Promise<void>;

  /**
   * Send a message
   */
  abstract send(message: OutboundMessage): Promise<DeliveryResult>;

  /**
   * Get channel status
   */
  getStatus(): ChannelStatus {
    return { ...this.status };
  }

  /**
   * Check if user is allowed
   */
  isUserAllowed(userId: string): boolean {
    if (!this.config.allowedUsers || this.config.allowedUsers.length === 0) {
      return true;
    }
    return this.config.allowedUsers.includes(userId);
  }

  /**
   * Check if channel is allowed
   */
  isChannelAllowed(channelId: string): boolean {
    if (!this.config.allowedChannels || this.config.allowedChannels.length === 0) {
      return true;
    }
    return this.config.allowedChannels.includes(channelId);
  }

  /**
   * Parse command from message
   */
  protected parseCommand(message: InboundMessage): InboundMessage {
    if (message.content.startsWith('/')) {
      const parts = message.content.slice(1).split(/\s+/);
      return {
        ...message,
        isCommand: true,
        commandName: parts[0],
        commandArgs: parts.slice(1),
      };
    }
    return message;
  }

  /**
   * Format message for sending
   */
  protected formatMessage(content: string, parseMode?: 'markdown' | 'html' | 'plain'): string {
    if (parseMode === 'plain') {
      // Strip markdown/html
      return content
        .replace(/[*_`~]/g, '')
        .replace(/<[^>]+>/g, '');
    }
    return content;
  }
}

// ============================================================================
// Mock Channel (for testing)
// ============================================================================

export class MockChannel extends BaseChannel {
  private messages: InboundMessage[] = [];
  private sentMessages: OutboundMessage[] = [];

  constructor(config: Partial<ChannelConfig> = {}) {
    const channelType = config.type || 'cli';
    super(channelType, {
      type: channelType,
      enabled: true,
      ...config,
    });
  }

  async connect(): Promise<void> {
    this.status.connected = true;
    this.status.authenticated = true;
    this.emit('connected', this.type);
  }

  async disconnect(): Promise<void> {
    this.status.connected = false;
    this.emit('disconnected', this.type);
  }

  async send(message: OutboundMessage): Promise<DeliveryResult> {
    this.sentMessages.push(message);
    return {
      success: true,
      messageId: `mock-${Date.now()}`,
      timestamp: new Date(),
    };
  }

  /**
   * Simulate receiving a message
   */
  simulateMessage(content: string, options: Partial<InboundMessage> = {}): InboundMessage {
    const message: InboundMessage = {
      id: `msg-${Date.now()}`,
      channel: {
        id: 'mock-channel',
        type: 'cli',
        name: 'Mock Channel',
      },
      sender: {
        id: 'mock-user',
        username: 'testuser',
        displayName: 'Test User',
      },
      content,
      contentType: 'text',
      timestamp: new Date(),
      ...options,
    };

    const parsed = this.parseCommand(message);
    this.messages.push(parsed);
    this.emit('message', parsed);

    if (parsed.isCommand) {
      this.emit('command', parsed);
    }

    return parsed;
  }

  /**
   * Get received messages
   */
  getMessages(): InboundMessage[] {
    return [...this.messages];
  }

  /**
   * Get sent messages
   */
  getSentMessages(): OutboundMessage[] {
    return [...this.sentMessages];
  }

  /**
   * Clear messages
   */
  clear(): void {
    this.messages = [];
    this.sentMessages = [];
  }
}

// ============================================================================
// Channel Manager
// ============================================================================

/**
 * Manages multiple channels
 */
export class ChannelManager extends EventEmitter {
  private channels: Map<ChannelType, BaseChannel> = new Map();
  private messageHandlers: Array<(message: InboundMessage, channel: BaseChannel) => Promise<void>> = [];

  /**
   * Register a channel
   */
  registerChannel(channel: BaseChannel): void {
    this.channels.set(channel.type, channel);

    // Forward events
    channel.on('message', (message: InboundMessage) => {
      this.emit('message', message, channel);
      this.handleMessage(message, channel);
    });

    channel.on('command', (message: InboundMessage) => {
      this.emit('command', message, channel);
    });

    channel.on('connected', (type: ChannelType) => {
      this.emit('channel-connected', type);
    });

    channel.on('disconnected', (type: ChannelType, error?: Error) => {
      this.emit('channel-disconnected', type, error);
    });

    channel.on('error', (type: ChannelType, error: Error) => {
      this.emit('channel-error', type, error);
    });
  }

  /**
   * Unregister a channel
   */
  unregisterChannel(type: ChannelType): void {
    const channel = this.channels.get(type);
    if (channel) {
      channel.removeAllListeners();
      this.channels.delete(type);
    }
  }

  /**
   * Get a channel
   */
  getChannel(type: ChannelType): BaseChannel | undefined {
    return this.channels.get(type);
  }

  /**
   * Get all channels
   */
  getAllChannels(): BaseChannel[] {
    return Array.from(this.channels.values());
  }

  /**
   * Connect all channels
   */
  async connectAll(): Promise<void> {
    const promises = Array.from(this.channels.values()).map(c => c.connect());
    await Promise.all(promises);
  }

  /**
   * Disconnect all channels
   */
  async disconnectAll(): Promise<void> {
    const promises = Array.from(this.channels.values()).map(c => c.disconnect());
    await Promise.all(promises);
  }

  /**
   * Get status of all channels
   */
  getStatus(): Record<ChannelType, ChannelStatus> {
    const status: Record<string, ChannelStatus> = {};
    for (const [type, channel] of this.channels) {
      status[type] = channel.getStatus();
    }
    return status as Record<ChannelType, ChannelStatus>;
  }

  /**
   * Send to a specific channel
   */
  async send(type: ChannelType, message: OutboundMessage): Promise<DeliveryResult> {
    const channel = this.channels.get(type);
    if (!channel) {
      return {
        success: false,
        error: `Channel ${type} not found`,
        timestamp: new Date(),
      };
    }
    return channel.send(message);
  }

  /**
   * Broadcast to all connected channels
   */
  async broadcast(message: Omit<OutboundMessage, 'channelId'>): Promise<Map<ChannelType, DeliveryResult>> {
    const results = new Map<ChannelType, DeliveryResult>();

    for (const [type, channel] of this.channels) {
      if (channel.getStatus().connected) {
        const result = await channel.send({
          ...message,
          channelId: '*', // Will be handled by each channel
        });
        results.set(type, result);
      }
    }

    return results;
  }

  /**
   * Add message handler
   */
  onMessage(handler: (message: InboundMessage, channel: BaseChannel) => Promise<void>): void {
    this.messageHandlers.push(handler);
  }

  /**
   * Handle incoming message
   */
  private async handleMessage(message: InboundMessage, channel: BaseChannel): Promise<void> {
    for (const handler of this.messageHandlers) {
      try {
        await handler(message, channel);
      } catch (error) {
        this.emit('error', channel.type, error);
      }
    }
  }

  /**
   * Shutdown
   */
  async shutdown(): Promise<void> {
    await this.disconnectAll();
    this.channels.clear();
    this.messageHandlers = [];
    this.removeAllListeners();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let managerInstance: ChannelManager | null = null;

export function getChannelManager(): ChannelManager {
  if (!managerInstance) {
    managerInstance = new ChannelManager();
  }
  return managerInstance;
}

export function resetChannelManager(): void {
  if (managerInstance) {
    managerInstance.shutdown().catch((err) => {
      logger.debug('Channel manager shutdown error (ignored)', { error: err instanceof Error ? err.message : String(err) });
    });
    managerInstance = null;
  }
}

// ============================================================================
// Re-exports
// ============================================================================

// Telegram
export { TelegramChannel } from './telegram/index.js';
export type {
  TelegramConfig,
  TelegramCommand,
  TelegramUser,
  TelegramChat,
  TelegramMessage,
  TelegramUpdate,
} from './telegram/index.js';

// Discord
export { DiscordChannel } from './discord/index.js';
export type {
  DiscordConfig,
  DiscordUser,
  DiscordMessage,
  DiscordEmbed,
  DiscordInteraction,
  DiscordSlashCommand,
  DiscordIntent,
} from './discord/index.js';

// Slack
export { SlackChannel } from './slack/index.js';
export type {
  SlackConfig,
  SlackUser,
  SlackMessage,
  SlackEvent,
  SlackBlock,
  SlackSlashCommand,
} from './slack/index.js';

// Webhook Server
export {
  WebhookServer,
  getWebhookServer,
  resetWebhookServer,
} from './webhook-server.js';
export type {
  WebhookServerConfig,
  WebhookRequest,
  WebhookResponse,
} from './webhook-server.js';

// Session Isolation (OpenClaw-inspired)
export type {
  SessionScope,
  SessionKeyComponents,
  SessionIsolationConfig,
  SessionInfo,
} from './session-isolation.js';
export {
  DEFAULT_SESSION_ISOLATION_CONFIG,
  SessionIsolator,
  getSessionIsolator,
  resetSessionIsolator,
} from './session-isolation.js';

// Identity Links (OpenClaw-inspired)
export type {
  ChannelIdentity,
  CanonicalIdentity,
  IdentityLinkerConfig,
} from './identity-links.js';
export {
  IdentityLinker,
  getIdentityLinker,
  resetIdentityLinker,
} from './identity-links.js';

// Agent Peer Routing (OpenClaw-inspired)
export type {
  RouteAgentConfig,
  PeerRoute,
  RouteCondition,
  ResolvedRoute,
  PeerRouterConfig,
} from './peer-routing.js';
export {
  PeerRouter,
  getPeerRouter,
  resetPeerRouter,
} from './peer-routing.js';

// DM Pairing (OpenClaw-inspired)
export type {
  PairingStatus,
  ApprovedSender,
  PairingRequest,
  DMPairingConfig,
} from './dm-pairing.js';
export {
  DEFAULT_DM_PAIRING_CONFIG,
  DMPairingManager,
  getDMPairing,
  resetDMPairing,
} from './dm-pairing.js';
