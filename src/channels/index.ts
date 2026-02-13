/**
 * Multi-Channel Support
 *
 * Inspired by OpenClaw's multi-platform messaging support.
 * Provides unified interface for Telegram, Discord, Slack, and more.
 */

import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import { getSessionIsolator } from './session-isolation.js';
import { getIdentityLinker } from './identity-links.js';
import type { CanonicalIdentity, ChannelIdentity } from './identity-links.js';

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
  | 'google-chat'
  | 'teams'
  | 'webchat'
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
  /** Session isolation key (computed by SessionIsolator) */
  sessionKey?: string;
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
// Session Key Helper
// ============================================================================

/**
 * Generate a session key for an inbound message using the SessionIsolator.
 *
 * This is a convenience function that uses the singleton SessionIsolator
 * to compute a session key from the message's channel and sender info.
 * Returns undefined if session isolation is not available.
 *
 * @param message - The inbound message to generate a key for
 * @param accountId - Optional bot account ID for multi-account setups
 * @returns The session key string, or undefined if isolation fails
 */
export function getSessionKey(message: InboundMessage, accountId?: string): string | undefined {
  try {
    const isolator = getSessionIsolator();
    return isolator.getSessionKey(message, accountId);
  } catch {
    return undefined;
  }
}

// ============================================================================
// Identity Resolution Helper
// ============================================================================

/**
 * Resolve the canonical identity for an inbound message's sender.
 *
 * Uses the singleton IdentityLinker to look up cross-channel identity links.
 * Returns null if no canonical identity exists for the sender.
 *
 * @param message - The inbound message whose sender to resolve
 * @returns The canonical identity, or null if no link exists
 */
export function getCanonicalIdentity(message: InboundMessage): CanonicalIdentity | null {
  try {
    const linker = getIdentityLinker();
    return linker.resolve({
      channelType: message.channel.type,
      peerId: message.sender.id,
    });
  } catch {
    return null;
  }
}

// ============================================================================
// Peer Routing Helper
// ============================================================================

import { getPeerRouter } from './peer-routing.js';
import type { ResolvedRoute, RouteAgentConfig } from './peer-routing.js';

/**
 * Resolve the best route for an inbound message using the singleton PeerRouter.
 *
 * This is a convenience function similar to `getSessionKey()` and
 * `checkDMPairing()`. It delegates to the singleton PeerRouter and
 * returns the resolved route (or null if no route matches).
 *
 * @param message - The inbound message to resolve a route for
 * @param accountId - Optional bot account ID for multi-account setups
 * @returns The resolved route with agent config, or null if no route matches
 */
export function resolveRoute(message: InboundMessage, accountId?: string): ResolvedRoute | null {
  try {
    const router = getPeerRouter();
    return router.resolve(message, accountId);
  } catch {
    return null;
  }
}

/**
 * Get the effective agent configuration for an inbound message.
 *
 * Resolves the route and merges the matched agent config with defaults.
 * Always returns a config object (falls back to default if no route matches).
 *
 * @param message - The inbound message to get config for
 * @param accountId - Optional bot account ID for multi-account setups
 * @returns The effective agent configuration
 */
export function getRouteAgentConfig(message: InboundMessage, accountId?: string): RouteAgentConfig {
  try {
    const router = getPeerRouter();
    return router.getAgentConfig(message, accountId);
  } catch {
    return {};
  }
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

  // =========================================================================
  // Proactive Messaging (Phase 4 - Iteration 4)
  // =========================================================================

  private outgoingQueue: Array<{ type: ChannelType; message: OutboundMessage; priority: number }> = [];
  private processingQueue: boolean = false;

  /**
   * Send a message to a user across channels with priority
   */
  async sendToUser(
    channelType: ChannelType,
    channelId: string,
    content: string,
    priority: 'low' | 'normal' | 'high' | 'urgent' = 'normal'
  ): Promise<DeliveryResult> {
    const priorityMap = { low: 0, normal: 1, high: 2, urgent: 3 };
    const message: OutboundMessage = {
      channelId,
      content,
      silent: priority === 'low',
    };

    this.outgoingQueue.push({ type: channelType, message, priority: priorityMap[priority] });
    // Sort by priority descending
    this.outgoingQueue.sort((a, b) => b.priority - a.priority);

    return this.processQueue();
  }

  /**
   * Process the outgoing message queue
   */
  private async processQueue(): Promise<DeliveryResult> {
    if (this.processingQueue || this.outgoingQueue.length === 0) {
      return { success: true, timestamp: new Date() };
    }

    this.processingQueue = true;
    let lastResult: DeliveryResult = { success: true, timestamp: new Date() };

    try {
      while (this.outgoingQueue.length > 0) {
        const item = this.outgoingQueue.shift()!;
        lastResult = await this.send(item.type, item.message);
        this.emit('message:sent', { type: item.type, result: lastResult });
      }
    } finally {
      this.processingQueue = false;
    }

    return lastResult;
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

// WhatsApp
export { WhatsAppChannel } from './whatsapp/index.js';
export type { WhatsAppConfig, WhatsAppContact } from './whatsapp/index.js';

// Signal
export { SignalChannel } from './signal/index.js';
export type {
  SignalConfig,
  SignalMessage,
  SignalAttachment,
  SignalGroup,
} from './signal/index.js';

// Google Chat
export { GoogleChatChannel } from './google-chat/index.js';
export type {
  GoogleChatConfig,
  GoogleChatSpace,
  GoogleChatUser,
  GoogleChatMessage,
  GoogleChatEvent,
} from './google-chat/index.js';

// Microsoft Teams
export { TeamsChannel } from './teams/index.js';
export type {
  TeamsConfig,
  BotFrameworkActivity,
  BotFrameworkAccount,
  BotFrameworkConversation,
  BotFrameworkAttachment,
  ConversationReference,
} from './teams/index.js';

// Matrix
export { MatrixChannel } from './matrix/index.js';
export type {
  MatrixConfig,
  MatrixRoom,
  MatrixEventContent,
  MatrixRoomEvent,
} from './matrix/index.js';

// WebChat
export { WebChatChannel } from './webchat/index.js';
export type { WebChatConfig } from './webchat/index.js';

// Reconnection Manager
export { ReconnectionManager } from './reconnection-manager.js';
export type { ReconnectionConfig, ReconnectionEvents } from './reconnection-manager.js';

// Offline Queue
export { OfflineQueue } from './offline-queue.js';
export type { QueuedMessage } from './offline-queue.js';

// ============================================================================
// Lane Queue Helpers
// ============================================================================

import { LaneQueue } from '../concurrency/lane-queue.js';
import type { TaskOptions } from '../concurrency/lane-queue.js';

/** Dedicated LaneQueue instance for channel message processing */
let channelLaneQueue: LaneQueue | null = null;

/**
 * Get the singleton LaneQueue for channel message processing.
 *
 * This is separate from the agent executor's lane queue so that
 * channel-level serialization and tool-level serialization each
 * have their own queue configurations.
 */
export function getChannelLaneQueue(): LaneQueue {
  if (!channelLaneQueue) {
    channelLaneQueue = new LaneQueue({
      maxParallel: 3,
      defaultTimeout: 120000, // 2 minutes for message processing
      maxPending: 200,
    });
  }
  return channelLaneQueue;
}

/**
 * Reset the channel lane queue (for testing).
 */
export function resetChannelLaneQueue(): void {
  if (channelLaneQueue) {
    channelLaneQueue.clear();
  }
  channelLaneQueue = null;
}

/**
 * Enqueue a message handler for serial execution within a session.
 *
 * Messages for the same session key are processed one at a time
 * (serial by default). Different sessions run in parallel.
 *
 * @param sessionKey - The session key used as the lane ID
 * @param handler - Async function to process the message
 * @param options - Optional task options (e.g., timeout, priority)
 * @returns Promise that resolves with the handler's return value
 */
export function enqueueMessage<T>(
  sessionKey: string,
  handler: () => Promise<T>,
  options?: TaskOptions,
): Promise<T> {
  const queue = getChannelLaneQueue();
  return queue.enqueue(sessionKey, handler, {
    category: 'channel-message',
    ...options,
  });
}

// ============================================================================
// DM Pairing Helper
// ============================================================================

import { getDMPairing } from './dm-pairing.js';
import type { PairingStatus } from './dm-pairing.js';

/**
 * Check if a DM sender is approved via the pairing system.
 *
 * When DM pairing is disabled (the default), this always returns
 * `{ approved: true }` so callers can skip gating logic.
 *
 * @param message - The inbound message to check
 * @returns PairingStatus indicating approval state and pairing code if needed
 */
export async function checkDMPairing(message: InboundMessage): Promise<PairingStatus> {
  const pairing = getDMPairing();

  // If pairing is not enabled, always approve
  if (!pairing.requiresPairing(message.channel.type)) {
    return {
      approved: true,
      senderId: message.sender.id,
      channelType: message.channel.type,
    };
  }

  // Only gate DM messages, not group messages
  if (!message.channel.isDM) {
    return {
      approved: true,
      senderId: message.sender.id,
      channelType: message.channel.type,
    };
  }

  return pairing.checkSender(message);
}
