/**
 * Signal Channel Adapter
 *
 * Signal integration via signal-cli REST API.
 * Requires a running signal-cli-rest-api instance
 * (https://github.com/bbernhard/signal-cli-rest-api).
 *
 * Supports text messages, attachments, group messaging,
 * and message reactions via the REST API.
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
 * Signal-specific configuration
 */
export interface SignalConfig extends ChannelConfig {
  type: 'signal';
  /** signal-cli REST API base URL (default: http://localhost:8080) */
  apiUrl?: string;
  /** Phone number registered with signal-cli (with country code, e.g. +1234567890) */
  phoneNumber: string;
  /** Polling interval in ms for receiving messages (default: 2000) */
  pollInterval?: number;
  /** Trust all known identities (skip safety number verification) */
  trustAllIdentities?: boolean;
}

/**
 * Signal message from the REST API
 */
export interface SignalMessage {
  envelope: {
    source?: string;
    sourceNumber?: string;
    sourceName?: string;
    sourceUuid?: string;
    timestamp?: number;
    dataMessage?: {
      timestamp?: number;
      message?: string;
      expiresInSeconds?: number;
      groupInfo?: {
        groupId: string;
        type?: string;
      };
      attachments?: SignalAttachment[];
      quote?: {
        id: number;
        author: string;
        text: string;
      };
      reaction?: {
        emoji: string;
        targetAuthor: string;
        targetSentTimestamp: number;
        isRemove: boolean;
      };
      mentions?: Array<{
        start: number;
        length: number;
        uuid: string;
      }>;
    };
    typingMessage?: {
      action: 'STARTED' | 'STOPPED';
      timestamp: number;
      groupId?: string;
    };
    receiptMessage?: {
      type: 'DELIVERY' | 'READ';
      timestamps: number[];
    };
    syncMessage?: {
      sentMessage?: {
        destination?: string;
        timestamp?: number;
        message?: string;
        groupInfo?: { groupId: string };
      };
    };
  };
  account?: string;
}

/**
 * Signal attachment
 */
export interface SignalAttachment {
  contentType?: string;
  filename?: string;
  id?: string;
  size?: number;
  width?: number;
  height?: number;
  caption?: string;
  voiceNote?: boolean;
}

/**
 * Signal group info from the REST API
 */
export interface SignalGroup {
  id: string;
  name: string;
  description?: string;
  members: string[];
  admins?: string[];
  blocked?: boolean;
}

// ============================================================================
// Channel Implementation
// ============================================================================

/**
 * Signal channel via signal-cli REST API
 */
export class SignalChannel extends BaseChannel {
  private pollTimer: NodeJS.Timeout | null = null;
  private polling = false;
  private groupCache = new Map<string, SignalGroup>();
  private reconnectionManager: ReconnectionManager;
  private consecutiveErrors = 0;

  constructor(config: SignalConfig) {
    super('signal', config);

    if (!config.phoneNumber) {
      throw new Error('Signal phone number is required');
    }

    // Apply defaults
    if (!config.apiUrl) {
      (this.config as SignalConfig).apiUrl = 'http://localhost:8080';
    }
    if (config.pollInterval === undefined) {
      (this.config as SignalConfig).pollInterval = 2000;
    }
    this.reconnectionManager = new ReconnectionManager('signal', {
      maxRetries: 10,
      initialDelayMs: 2000,
      maxDelayMs: 60000,
    });
  }

  private get signalConfig(): SignalConfig {
    return this.config as SignalConfig;
  }

  private get apiBase(): string {
    return (this.signalConfig.apiUrl ?? 'http://localhost:8080').replace(/\/$/, '');
  }

  private get encodedNumber(): string {
    return encodeURIComponent(this.signalConfig.phoneNumber);
  }

  // ==========================================================================
  // REST API Helper
  // ==========================================================================

  /**
   * Make a request to the signal-cli REST API
   */
  private async apiRequest<T>(
    method: string,
    endpoint: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.apiBase}${endpoint}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Signal API error: ${response.status} ${text}`);
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      return (await response.json()) as T;
    }

    const text = await response.text();
    if (!text) return {} as T;

    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  /**
   * Connect to Signal by verifying the phone number is registered
   * and starting the message polling loop
   */
  async connect(): Promise<void> {
    try {
      // Verify the signal-cli API is reachable
      await this.apiRequest<unknown>('GET', '/v1/about');

      // Verify the phone number is registered
      // The accounts endpoint varies by signal-cli version
      try {
        await this.apiRequest<unknown>('GET', `/v1/accounts/${this.encodedNumber}`);
      } catch {
        // Some versions use /v2/accounts
        logger.debug('Signal: /v1/accounts check failed, trying health check instead');
        await this.apiRequest<unknown>('GET', '/v1/health');
      }

      // Optionally trust all known identities
      if (this.signalConfig.trustAllIdentities) {
        try {
          await this.apiRequest('PUT', `/v1/configuration/${this.encodedNumber}/settings`, {
            trust_mode: 'always',
          });
        } catch {
          logger.debug('Signal: could not set trust_mode (non-critical)');
        }
      }

      this.status.connected = true;
      this.status.authenticated = true;
      this.status.info = {
        phoneNumber: this.signalConfig.phoneNumber,
        apiUrl: this.apiBase,
      };

      // Pre-load group cache
      await this.loadGroups();

      // Start polling
      this.startPolling();

      logger.debug('Signal connected', {
        phoneNumber: this.signalConfig.phoneNumber,
        apiUrl: this.apiBase,
      });
      this.emit('connected', 'signal');
    } catch (error) {
      this.status.error = error instanceof Error ? error.message : String(error);
      this.emit('error', 'signal', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Disconnect: stop polling
   */
  async disconnect(): Promise<void> {
    this.reconnectionManager.cancel();
    this.consecutiveErrors = 0;
    this.stopPolling();
    this.status.connected = false;
    this.status.authenticated = false;
    this.groupCache.clear();
    this.emit('disconnected', 'signal');
  }

  /**
   * Send a Signal message
   */
  async send(message: OutboundMessage): Promise<DeliveryResult> {
    if (!this.status.connected) {
      return { success: false, error: 'Signal not connected', timestamp: new Date() };
    }

    try {
      const isGroup = this.isGroupId(message.channelId);

      const payload: Record<string, unknown> = {
        message: message.content,
        number: this.signalConfig.phoneNumber,
        text_mode: message.parseMode === 'plain' ? 'normal' : undefined,
      };

      if (isGroup) {
        payload.recipients = [];
        payload.group_id = message.channelId;
      } else {
        payload.recipients = [message.channelId];
      }

      // Handle attachments
      if (message.attachments && message.attachments.length > 0) {
        payload.base64_attachments = message.attachments
          .filter((a) => a.data)
          .map((a) => ({
            filename: a.fileName ?? 'attachment',
            content_type: a.mimeType ?? 'application/octet-stream',
            data: a.data,
          }));
      }

      // Quote/reply
      if (message.replyTo) {
        payload.quote_timestamp = parseInt(message.replyTo, 10) || undefined;
      }

      const result = await this.apiRequest<{
        timestamp?: string | number;
      }>('POST', `/v2/send`, payload);

      const messageId = result.timestamp
        ? String(result.timestamp)
        : String(Date.now());

      return {
        success: true,
        messageId,
        timestamp: new Date(),
      };
    } catch (error) {
      logger.debug('Signal send error', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date(),
      };
    }
  }

  /**
   * Send a typing indicator
   */
  async sendTyping(recipient: string): Promise<void> {
    try {
      const payload: Record<string, unknown> = {
        recipient,
      };
      await this.apiRequest('PUT', `/v1/typing-indicator/${this.encodedNumber}`, payload);
    } catch {
      // Typing indicators are non-critical
    }
  }

  /**
   * React to a message with an emoji
   */
  async react(
    recipient: string,
    targetAuthor: string,
    timestamp: number,
    emoji: string
  ): Promise<void> {
    try {
      await this.apiRequest('POST', `/v1/reactions/${this.encodedNumber}`, {
        recipient,
        reaction: {
          emoji,
          target_author: targetAuthor,
          target_sent_timestamp: timestamp,
        },
      });
    } catch (err) {
      logger.debug('Signal react error', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * List groups the registered number is a member of
   */
  async listGroups(): Promise<SignalGroup[]> {
    try {
      return await this.apiRequest<SignalGroup[]>(
        'GET',
        `/v1/groups/${this.encodedNumber}`
      );
    } catch {
      return [];
    }
  }

  // ==========================================================================
  // Polling
  // ==========================================================================

  /**
   * Start the message polling loop with reconnection support
   */
  private startPolling(): void {
    if (this.polling) return;
    this.polling = true;

    const pollFn = async () => {
      if (!this.polling) return;

      try {
        const messages = await this.apiRequest<SignalMessage[]>(
          'GET',
          `/v1/receive/${this.encodedNumber}`
        );

        // Reset consecutive error count on success
        this.consecutiveErrors = 0;
        this.reconnectionManager.onConnected();

        if (Array.isArray(messages)) {
          for (const msg of messages) {
            try {
              await this.handleIncoming(msg);
            } catch (err) {
              logger.debug('Signal: error processing message', {
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }
        }
      } catch (err) {
        this.consecutiveErrors++;
        logger.debug('Signal polling error', {
          error: err instanceof Error ? err.message : String(err),
          consecutiveErrors: this.consecutiveErrors,
        });

        if (this.consecutiveErrors >= 5) {
          // Too many consecutive errors -- use reconnection manager
          logger.debug('Signal: too many consecutive polling errors, attempting reconnect');
          this.polling = false;
          this.status.connected = false;
          this.reconnectionManager.scheduleReconnect(async () => {
            this.consecutiveErrors = 0;
            await this.connect();
            this.reconnectionManager.onConnected();
          });
          return;
        }
      }

      if (this.polling) {
        this.pollTimer = setTimeout(pollFn, this.signalConfig.pollInterval ?? 2000);
      }
    };

    pollFn();
  }

  /**
   * Stop polling
   */
  private stopPolling(): void {
    this.polling = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  // ==========================================================================
  // Message Handling
  // ==========================================================================

  /**
   * Handle a received Signal message
   */
  private async handleIncoming(msg: SignalMessage): Promise<void> {
    const envelope = msg.envelope;
    if (!envelope) return;

    // Handle typing indicators
    if (envelope.typingMessage) {
      const sender = envelope.sourceNumber ?? envelope.source ?? '';
      this.emit('typing', {
        id: envelope.typingMessage.groupId ?? sender,
        type: 'signal',
      }, { id: sender });
      return;
    }

    // Handle reactions
    if (envelope.dataMessage?.reaction) {
      const reaction = envelope.dataMessage.reaction;
      if (!reaction.isRemove) {
        this.emit('reaction', {
          id: envelope.dataMessage.groupInfo?.groupId ?? envelope.sourceNumber ?? '',
          type: 'signal',
        }, String(reaction.targetSentTimestamp), reaction.emoji, {
          id: envelope.sourceNumber ?? envelope.source ?? '',
        });
      }
      return;
    }

    // Only process data messages with text or attachments
    const data = envelope.dataMessage;
    if (!data) return;
    if (!data.message && (!data.attachments || data.attachments.length === 0)) return;

    const sourceNumber = envelope.sourceNumber ?? envelope.source ?? '';
    if (!sourceNumber) return;

    // Check user allowlist
    if (!this.isUserAllowed(sourceNumber)) return;

    // Determine channel ID (group or DM)
    const isGroup = !!data.groupInfo;
    const channelId = data.groupInfo?.groupId ?? sourceNumber;

    // Check channel allowlist
    if (!this.isChannelAllowed(channelId)) return;

    // Build InboundMessage
    const groupInfo = isGroup ? this.groupCache.get(channelId) : null;

    const inbound: InboundMessage = {
      id: String(data.timestamp ?? envelope.timestamp ?? Date.now()),
      channel: {
        id: channelId,
        type: 'signal',
        name: groupInfo?.name ?? (isGroup ? channelId : sourceNumber),
        isDM: !isGroup,
        isGroup,
        participantCount: groupInfo?.members.length,
        description: groupInfo?.description,
      },
      sender: {
        id: sourceNumber,
        username: sourceNumber,
        displayName: envelope.sourceName ?? sourceNumber,
      },
      content: data.message ?? '',
      contentType: this.determineContentType(data),
      attachments: this.convertAttachments(data.attachments),
      replyTo: data.quote ? String(data.quote.id) : undefined,
      timestamp: data.timestamp ? new Date(data.timestamp) : new Date(),
      raw: msg,
    };

    const parsed = this.parseCommand(inbound);
    parsed.sessionKey = getSessionKey(parsed);

    // DM pairing check
    const pairingStatus = await checkDMPairing(parsed);
    if (!pairingStatus.approved) {
      const { getDMPairing } = await import('../dm-pairing.js');
      const pairingMessage = getDMPairing().getPairingMessage(pairingStatus);
      if (pairingMessage) {
        await this.send({ channelId: sourceNumber, content: pairingMessage });
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
   * Convert Signal attachments to MessageAttachment format
   */
  private convertAttachments(
    attachments?: SignalAttachment[]
  ): MessageAttachment[] | undefined {
    if (!attachments || attachments.length === 0) return undefined;

    return attachments.map((a) => {
      const type: ContentType = a.voiceNote
        ? 'voice'
        : this.mimeToContentType(a.contentType);

      return {
        type,
        fileName: a.filename,
        mimeType: a.contentType,
        size: a.size,
        width: a.width,
        height: a.height,
        caption: a.caption,
        // signal-cli stores attachments by id; the URL is available at GET /v1/attachments/{id}
        url: a.id ? `${this.apiBase}/v1/attachments/${a.id}` : undefined,
      };
    });
  }

  /**
   * Determine content type from a Signal data message
   */
  private determineContentType(
    data: NonNullable<SignalMessage['envelope']['dataMessage']>
  ): ContentType {
    if (data.attachments && data.attachments.length > 0) {
      const first = data.attachments[0];
      if (first.voiceNote) return 'voice';
      return this.mimeToContentType(first.contentType);
    }
    if (data.message?.startsWith('/')) return 'command';
    return 'text';
  }

  /**
   * Map MIME type to ContentType
   */
  private mimeToContentType(mime?: string): ContentType {
    if (!mime) return 'file';
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('audio/')) return 'audio';
    if (mime.startsWith('video/')) return 'video';
    return 'file';
  }

  /**
   * Check if an ID looks like a Signal group ID (base64)
   */
  private isGroupId(id: string): boolean {
    // Signal group IDs are base64-encoded and typically 44 chars
    return /^[A-Za-z0-9+/=]{20,}$/.test(id);
  }

  /**
   * Pre-load groups into the cache
   */
  private async loadGroups(): Promise<void> {
    try {
      const groups = await this.listGroups();
      for (const group of groups) {
        this.groupCache.set(group.id, group);
      }
      logger.debug('Signal: loaded groups', { count: groups.length });
    } catch {
      logger.debug('Signal: failed to load groups (non-critical)');
    }
  }
}

export default SignalChannel;
