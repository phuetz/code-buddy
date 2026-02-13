/**
 * Matrix Channel Adapter
 *
 * Matrix integration via the matrix-js-sdk.
 * Supports text, media messaging, room events, and end-to-end encryption (if olm is available).
 *
 * Requires: npm install matrix-js-sdk (optional dependency, loaded dynamically)
 *
 * Reference: https://spec.matrix.org/latest/client-server-api/
 */

import type {
  ChannelConfig,
  ChannelUser,
  ChannelInfo,
  InboundMessage,
  OutboundMessage,
  DeliveryResult,
  ContentType,
  MessageAttachment,
} from '../index.js';
import { BaseChannel, getSessionKey, checkDMPairing } from '../index.js';
import { ReconnectionManager } from '../reconnection-manager.js';
import { logger } from '../../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Matrix-specific configuration
 */
export interface MatrixConfig extends ChannelConfig {
  type: 'matrix';
  /** Homeserver URL (e.g. https://matrix.org) */
  homeserverUrl: string;
  /** Full Matrix user ID (e.g. @bot:matrix.org) */
  userId: string;
  /** Access token for authentication */
  accessToken: string;
  /** Device ID (optional, for E2EE sessions) */
  deviceId?: string;
  /** Auto-join rooms on invite (default: true) */
  autoJoin?: boolean;
  /** Room IDs to join on startup */
  initialRooms?: string[];
  /** Store path for sync/crypto state */
  storePath?: string;
  /** Enable end-to-end encryption support (requires olm) */
  enableEncryption?: boolean;
}

/**
 * Matrix room info
 */
export interface MatrixRoom {
  roomId: string;
  name?: string;
  topic?: string;
  isDirect?: boolean;
  memberCount?: number;
  canonicalAlias?: string;
}

/**
 * Matrix event content
 */
export interface MatrixEventContent {
  msgtype?: string;
  body?: string;
  formatted_body?: string;
  format?: string;
  url?: string;
  info?: {
    mimetype?: string;
    size?: number;
    w?: number;
    h?: number;
    duration?: number;
    thumbnail_url?: string;
  };
  'm.relates_to'?: {
    'm.in_reply_to'?: { event_id: string };
    rel_type?: string;
    event_id?: string;
    key?: string;
  };
  'm.new_content'?: MatrixEventContent;
  filename?: string;
}

/**
 * Matrix room event (simplified)
 */
export interface MatrixRoomEvent {
  event_id: string;
  type: string;
  room_id: string;
  sender: string;
  origin_server_ts: number;
  content: MatrixEventContent;
  unsigned?: {
    age?: number;
    transaction_id?: string;
  };
  state_key?: string;
}

// ============================================================================
// Channel Implementation
// ============================================================================

/**
 * Matrix channel using matrix-js-sdk
 */
export class MatrixChannel extends BaseChannel {
  private client: unknown = null;
  private roomCache = new Map<string, MatrixRoom>();
  private syncing = false;
  private reconnectionManager: ReconnectionManager;

  constructor(config: MatrixConfig) {
    super('matrix', config);

    if (!config.homeserverUrl) {
      throw new Error('Matrix homeserver URL is required');
    }
    if (!config.userId) {
      throw new Error('Matrix user ID is required');
    }
    if (!config.accessToken) {
      throw new Error('Matrix access token is required');
    }

    // Apply defaults
    if (config.autoJoin === undefined) {
      (this.config as MatrixConfig).autoJoin = true;
    }
    this.reconnectionManager = new ReconnectionManager('matrix', {
      maxRetries: 10,
      initialDelayMs: 2000,
      maxDelayMs: 60000,
    });
  }

  private get matrixConfig(): MatrixConfig {
    return this.config as MatrixConfig;
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  /**
   * Connect to Matrix using matrix-js-sdk
   */
  async connect(): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sdk: any;
    try {
      // @ts-expect-error -- optional dependency, loaded dynamically
      sdk = await import('matrix-js-sdk');
    } catch {
      throw new Error(
        'Matrix channel requires matrix-js-sdk. Install it with: npm install matrix-js-sdk'
      );
    }

    try {
      const createClient = sdk.createClient;

      const clientOpts: Record<string, unknown> = {
        baseUrl: this.matrixConfig.homeserverUrl,
        accessToken: this.matrixConfig.accessToken,
        userId: this.matrixConfig.userId,
        deviceId: this.matrixConfig.deviceId,
      };

      // Use a local store if path is configured
      if (this.matrixConfig.storePath) {
        try {
          const MemoryStore = (sdk as unknown as { MemoryStore?: new () => unknown }).MemoryStore;
          if (MemoryStore) {
            clientOpts.store = new MemoryStore();
          }
        } catch {
          // Fallback: no persistent store
        }
      }

      const client = createClient(clientOpts as Parameters<typeof createClient>[0]);
      this.client = client;

      // Register event handlers before starting sync
      this.registerEventHandlers(client);

      // Start the sync loop
      await client.startClient({ initialSyncLimit: 10 });
      this.syncing = true;

      // Wait for initial sync
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Matrix initial sync timed out after 30 seconds'));
        }, 30000);

        const onSync = (state: string) => {
          if (state === 'PREPARED' || state === 'SYNCING') {
            clearTimeout(timeout);
            client.removeListener('sync' as string, onSync);
            resolve();
          } else if (state === 'ERROR') {
            clearTimeout(timeout);
            client.removeListener('sync' as string, onSync);
            reject(new Error('Matrix sync failed'));
          }
        };

        client.on('sync' as string, onSync);
      });

      // Join initial rooms if configured
      if (this.matrixConfig.initialRooms) {
        for (const roomId of this.matrixConfig.initialRooms) {
          try {
            await client.joinRoom(roomId);
            logger.debug('Matrix: joined room', { roomId });
          } catch (err) {
            logger.debug('Matrix: failed to join room', {
              roomId,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }

      // Get user profile for status info
      let displayName = this.matrixConfig.userId;
      try {
        const profile = await client.getProfileInfo(this.matrixConfig.userId);
        displayName = (profile as { displayname?: string }).displayname ?? displayName;
      } catch {
        // Non-critical
      }

      this.status.connected = true;
      this.status.authenticated = true;
      this.status.info = {
        userId: this.matrixConfig.userId,
        homeserver: this.matrixConfig.homeserverUrl,
        displayName,
        deviceId: this.matrixConfig.deviceId,
      };

      logger.debug('Matrix connected', {
        userId: this.matrixConfig.userId,
        homeserver: this.matrixConfig.homeserverUrl,
      });
      this.emit('connected', 'matrix');
    } catch (error) {
      this.status.error = error instanceof Error ? error.message : String(error);
      this.emit('error', 'matrix', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Disconnect from Matrix
   */
  async disconnect(): Promise<void> {
    this.reconnectionManager.cancel();

    if (this.client) {
      try {
        const client = this.client as { stopClient: () => void };
        client.stopClient();
      } catch {
        // Ignore errors during disconnect
      }
      this.client = null;
    }

    this.syncing = false;
    this.roomCache.clear();
    this.status.connected = false;
    this.status.authenticated = false;
    this.emit('disconnected', 'matrix');
  }

  /**
   * Send a message to a Matrix room
   */
  async send(message: OutboundMessage): Promise<DeliveryResult> {
    if (!this.client || !this.status.connected) {
      return { success: false, error: 'Matrix not connected', timestamp: new Date() };
    }

    const client = this.client as {
      sendMessage: (roomId: string, content: unknown) => Promise<{ event_id: string }>;
      sendEvent: (roomId: string, type: string, content: unknown) => Promise<{ event_id: string }>;
    };

    try {
      const roomId = message.channelId;

      // Handle media attachments
      if (message.attachments && message.attachments.length > 0) {
        return this.sendMedia(roomId, message.attachments[0], message.content);
      }

      // Determine content format
      const content: MatrixEventContent = {
        body: message.content,
        msgtype: 'm.text',
      };

      // Add formatted body for markdown/html
      if (message.parseMode === 'html') {
        content.format = 'org.matrix.custom.html';
        content.formatted_body = message.content;
      } else if (message.parseMode !== 'plain') {
        // Default to markdown - Matrix clients typically render markdown
        content.format = 'org.matrix.custom.html';
        content.formatted_body = message.content; // Could convert MD->HTML here
      }

      // Reply threading
      if (message.replyTo) {
        content['m.relates_to'] = {
          'm.in_reply_to': { event_id: message.replyTo },
        };
      }

      // Thread support (MSC3440)
      if (message.threadId) {
        content['m.relates_to'] = {
          ...content['m.relates_to'],
          rel_type: 'm.thread',
          event_id: message.threadId,
        };
      }

      const result = await client.sendMessage(roomId, content);

      return {
        success: true,
        messageId: result.event_id,
        timestamp: new Date(),
      };
    } catch (error) {
      logger.debug('Matrix send error', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date(),
      };
    }
  }

  // ==========================================================================
  // Media Sending
  // ==========================================================================

  /**
   * Send a media attachment to a room
   */
  private async sendMedia(
    roomId: string,
    attachment: MessageAttachment,
    caption?: string
  ): Promise<DeliveryResult> {
    const client = this.client as {
      uploadContent: (data: unknown, opts?: unknown) => Promise<{ content_uri: string }>;
      sendMessage: (roomId: string, content: unknown) => Promise<{ event_id: string }>;
    };

    try {
      let mxcUrl: string | undefined;

      // If we have a data URI or buffer, upload it
      if (attachment.data) {
        const buffer = Buffer.from(attachment.data, 'base64');
        const uploadResult = await client.uploadContent(buffer, {
          name: attachment.fileName ?? 'attachment',
          type: attachment.mimeType ?? 'application/octet-stream',
        });
        mxcUrl = uploadResult.content_uri;
      } else if (attachment.url) {
        // For remote URLs, we'd need to download and re-upload to Matrix
        // For now, send as a text message with the URL
        const result = await client.sendMessage(roomId, {
          msgtype: 'm.text',
          body: `${caption ? caption + '\n' : ''}${attachment.url}`,
        });
        return { success: true, messageId: result.event_id, timestamp: new Date() };
      }

      if (!mxcUrl) {
        return { success: false, error: 'No attachment data to upload', timestamp: new Date() };
      }

      const msgtype = this.contentTypeToMsgtype(attachment.type);
      const content: MatrixEventContent = {
        msgtype,
        body: caption ?? attachment.fileName ?? 'attachment',
        url: mxcUrl,
        info: {
          mimetype: attachment.mimeType,
          size: attachment.size,
          w: attachment.width,
          h: attachment.height,
          duration: attachment.duration ? attachment.duration * 1000 : undefined,
        },
        filename: attachment.fileName,
      };

      const result = await client.sendMessage(roomId, content);
      return { success: true, messageId: result.event_id, timestamp: new Date() };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date(),
      };
    }
  }

  // ==========================================================================
  // Event Handling
  // ==========================================================================

  /**
   * Register event handlers on the Matrix client
   */
  private registerEventHandlers(client: unknown): void {
     
    const c = client as {
      on: (event: string, handler: (...args: any[]) => void) => void;
      getUserId: () => string;
      joinRoom: (roomId: string) => Promise<void>;
    };

    // Room timeline events (messages)
    c.on('Room.timeline', (event: unknown, room: unknown, toStartOfTimeline: unknown) => {
      if (toStartOfTimeline) return; // Ignore backfill
      this.handleTimelineEvent(event as MatrixRoomEvent, room);
    });

    // Room invites (auto-join)
    c.on('RoomMember.membership', (event: unknown, member: unknown) => {
      this.handleMembershipChange(c, event as MatrixRoomEvent, member);
    });

    // Typing notifications
    c.on('RoomMember.typing', (event: unknown, member: unknown) => {
      this.handleTypingEvent(event as MatrixRoomEvent, member);
    });

    // Sync state changes with reconnection support
    c.on('sync', (state: unknown, prevState: unknown) => {
      if (state === 'PREPARED' || state === 'SYNCING') {
        this.reconnectionManager.onConnected();
      } else if (state === 'ERROR') {
        logger.debug('Matrix: sync error, scheduling reconnect');
        this.status.connected = false;
        this.emit('error', 'matrix', new Error('Matrix sync error'));
        this.reconnectionManager.scheduleReconnect(async () => {
          if (this.client) {
            try {
              const cli = this.client as { stopClient: () => void };
              cli.stopClient();
            } catch {
              // Ignore
            }
          }
          await this.connect();
          this.reconnectionManager.onConnected();
        });
      } else if (state === 'RECONNECTING') {
        logger.debug('Matrix: reconnecting');
      }
    });
  }

  /**
   * Handle a room timeline event
   */
  private async handleTimelineEvent(event: MatrixRoomEvent, room: unknown): Promise<void> {
    // Only process m.room.message events
    if (event.type !== 'm.room.message') return;

    // Ignore our own messages
    if (event.sender === this.matrixConfig.userId) return;

    // Ignore redacted/edited messages (for now)
    const content = event.content;
    if (!content || content.msgtype === undefined) return;

    // Check user allowlist
    if (!this.isUserAllowed(event.sender)) return;

    // Check room allowlist
    if (!this.isChannelAllowed(event.room_id)) return;

    // Determine room info
    const roomInfo = this.getRoomInfo(event.room_id, room);

    // Build InboundMessage
    const text = content.body ?? '';
    const attachments = this.extractAttachments(content);

    const inbound: InboundMessage = {
      id: event.event_id,
      channel: {
        id: event.room_id,
        type: 'matrix',
        name: roomInfo.name ?? event.room_id,
        isDM: roomInfo.isDirect,
        isGroup: !roomInfo.isDirect,
        participantCount: roomInfo.memberCount,
        description: roomInfo.topic,
      },
      sender: {
        id: event.sender,
        username: event.sender,
        displayName: this.getDisplayName(event.sender, room),
      },
      content: text,
      contentType: this.msgtypeToContentType(content.msgtype),
      attachments: attachments.length > 0 ? attachments : undefined,
      replyTo: content['m.relates_to']?.['m.in_reply_to']?.event_id,
      threadId: content['m.relates_to']?.rel_type === 'm.thread'
        ? content['m.relates_to']?.event_id
        : undefined,
      timestamp: new Date(event.origin_server_ts),
      raw: event,
    };

    const parsed = this.parseCommand(inbound);
    parsed.sessionKey = getSessionKey(parsed);

    // DM pairing check
    const pairingStatus = await checkDMPairing(parsed);
    if (!pairingStatus.approved) {
      const { getDMPairing } = await import('../dm-pairing.js');
      const pairingMessage = getDMPairing().getPairingMessage(pairingStatus);
      if (pairingMessage) {
        await this.send({ channelId: event.room_id, content: pairingMessage });
      }
      return;
    }

    this.status.lastActivity = new Date();
    this.emit('message', parsed);

    if (parsed.isCommand) {
      this.emit('command', parsed);
    }
  }

  /**
   * Handle membership changes (auto-join on invite)
   */
  private async handleMembershipChange(
    client: { getUserId: () => string; joinRoom: (roomId: string) => Promise<void> },
    event: MatrixRoomEvent,
    member: unknown
  ): Promise<void> {
    const m = member as { userId?: string; membership?: string; roomId?: string };

    if (
      m.userId === client.getUserId() &&
      m.membership === 'invite' &&
      this.matrixConfig.autoJoin
    ) {
      try {
        const roomId = m.roomId ?? event.room_id;
        await client.joinRoom(roomId);
        logger.debug('Matrix: auto-joined room on invite', { roomId });
      } catch (err) {
        logger.debug('Matrix: failed to auto-join room', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  /**
   * Handle typing notifications
   */
  private handleTypingEvent(event: MatrixRoomEvent, member: unknown): void {
    const m = member as { userId?: string; typing?: boolean; roomId?: string };
    if (m.typing && m.userId && m.userId !== this.matrixConfig.userId) {
      this.emit('typing', {
        id: m.roomId ?? event.room_id,
        type: 'matrix',
      }, {
        id: m.userId,
      });
    }
  }

  // ==========================================================================
  // Room Management
  // ==========================================================================

  /**
   * Join a Matrix room by ID or alias
   */
  async joinRoom(roomIdOrAlias: string): Promise<string> {
    if (!this.client) throw new Error('Matrix not connected');
    const client = this.client as { joinRoom: (id: string) => Promise<{ roomId: string }> };
    const result = await client.joinRoom(roomIdOrAlias);
    return result.roomId;
  }

  /**
   * Leave a Matrix room
   */
  async leaveRoom(roomId: string): Promise<void> {
    if (!this.client) throw new Error('Matrix not connected');
    const client = this.client as { leave: (roomId: string) => Promise<void> };
    await client.leave(roomId);
    this.roomCache.delete(roomId);
  }

  /**
   * Get joined rooms
   */
  async getJoinedRooms(): Promise<string[]> {
    if (!this.client) return [];
    const client = this.client as { getJoinedRooms: () => Promise<{ joined_rooms: string[] }> };
    try {
      const result = await client.getJoinedRooms();
      return result.joined_rooms;
    } catch {
      return [];
    }
  }

  /**
   * Send a typing indicator
   */
  async sendTyping(roomId: string, typing = true, timeoutMs = 10000): Promise<void> {
    if (!this.client) return;
    const client = this.client as {
      sendTyping: (roomId: string, typing: boolean, timeoutMs: number) => Promise<void>;
    };
    try {
      await client.sendTyping(roomId, typing, timeoutMs);
    } catch {
      // Non-critical
    }
  }

  /**
   * Send a read receipt for an event
   */
  async sendReadReceipt(roomId: string, eventId: string): Promise<void> {
    if (!this.client) return;
    const client = this.client as {
      sendReadReceipt: (event: { roomId: string; getId: () => string }) => Promise<void>;
    };
    try {
      await client.sendReadReceipt({ roomId, getId: () => eventId });
    } catch {
      // Non-critical
    }
  }

  /**
   * React to a message with an emoji
   */
  async react(roomId: string, eventId: string, emoji: string): Promise<void> {
    if (!this.client) return;
    const client = this.client as {
      sendEvent: (roomId: string, type: string, content: unknown) => Promise<void>;
    };
    try {
      await client.sendEvent(roomId, 'm.reaction', {
        'm.relates_to': {
          rel_type: 'm.annotation',
          event_id: eventId,
          key: emoji,
        },
      });
    } catch (err) {
      logger.debug('Matrix: react error', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Redact (delete) a message
   */
  async redactMessage(roomId: string, eventId: string, reason?: string): Promise<void> {
    if (!this.client) throw new Error('Matrix not connected');
    const client = this.client as {
      redactEvent: (roomId: string, eventId: string, txnId?: string, opts?: { reason?: string }) => Promise<void>;
    };
    await client.redactEvent(roomId, eventId, undefined, reason ? { reason } : undefined);
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  /**
   * Get room info from the SDK room object or cache
   */
  private getRoomInfo(roomId: string, room: unknown): MatrixRoom {
    if (this.roomCache.has(roomId)) {
      return this.roomCache.get(roomId)!;
    }

    const r = room as {
      name?: string;
      roomId?: string;
      getJoinedMemberCount?: () => number;
      currentState?: {
        getStateEvents?: (type: string) => Array<{ getContent: () => { topic?: string } }>;
      };
      getDMInviter?: () => string | null;
    } | null;

    const info: MatrixRoom = {
      roomId,
      name: r?.name ?? roomId,
      memberCount: r?.getJoinedMemberCount?.() ?? undefined,
      isDirect: !!r?.getDMInviter?.(),
    };

    // Get topic
    try {
      const topicEvents = r?.currentState?.getStateEvents?.('m.room.topic');
      if (topicEvents && topicEvents.length > 0) {
        info.topic = topicEvents[0].getContent().topic;
      }
    } catch {
      // Non-critical
    }

    // Cache with size limit
    if (this.roomCache.size >= 1000) {
      const oldest = this.roomCache.keys().next().value;
      if (oldest) this.roomCache.delete(oldest);
    }
    this.roomCache.set(roomId, info);

    return info;
  }

  /**
   * Get display name for a user from the room member list
   */
  private getDisplayName(userId: string, room: unknown): string {
    const r = room as {
      getMember?: (userId: string) => { name?: string; rawDisplayName?: string } | null;
    } | null;

    try {
      const member = r?.getMember?.(userId);
      return member?.name ?? member?.rawDisplayName ?? userId;
    } catch {
      return userId;
    }
  }

  /**
   * Extract attachments from Matrix event content
   */
  private extractAttachments(content: MatrixEventContent): MessageAttachment[] {
    const attachments: MessageAttachment[] = [];

    if (!content.msgtype) return attachments;

    const mediaTypes = ['m.image', 'm.audio', 'm.video', 'm.file'];
    if (!mediaTypes.includes(content.msgtype)) return attachments;

    attachments.push({
      type: this.msgtypeToContentType(content.msgtype),
      url: content.url, // mxc:// URL
      fileName: content.filename ?? content.body,
      mimeType: content.info?.mimetype,
      size: content.info?.size,
      width: content.info?.w,
      height: content.info?.h,
      duration: content.info?.duration ? Math.floor(content.info.duration / 1000) : undefined,
    });

    return attachments;
  }

  /**
   * Convert Matrix msgtype to ContentType
   */
  private msgtypeToContentType(msgtype?: string): ContentType {
    switch (msgtype) {
      case 'm.image': return 'image';
      case 'm.audio': return 'audio';
      case 'm.video': return 'video';
      case 'm.file': return 'file';
      case 'm.location': return 'location';
      default: return 'text';
    }
  }

  /**
   * Convert ContentType to Matrix msgtype
   */
  private contentTypeToMsgtype(type: ContentType): string {
    switch (type) {
      case 'image': return 'm.image';
      case 'audio':
      case 'voice': return 'm.audio';
      case 'video': return 'm.video';
      case 'file': return 'm.file';
      case 'location': return 'm.location';
      default: return 'm.file';
    }
  }
}

export default MatrixChannel;
