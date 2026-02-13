/**
 * Google Chat Channel Adapter
 *
 * Google Chat integration via Google Workspace Chat API.
 * Uses service account authentication for bot-to-space messaging.
 *
 * Requires:
 * - A Google Cloud project with the Chat API enabled
 * - A service account with Chat Bot scope
 * - The service account JSON key file
 *
 * The adapter operates in two modes:
 * 1. Webhook mode (push): Google Chat sends events to a configured endpoint
 * 2. Pull mode: Polls for space activity via the REST API (limited, mainly for sending)
 *
 * Primary documentation: https://developers.google.com/workspace/chat/api/reference/rest
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
import { logger } from '../../utils/logger.js';
import { readFileSync } from 'fs';
import crypto from 'crypto';

// ============================================================================
// Types
// ============================================================================

/**
 * Google Chat-specific configuration
 */
export interface GoogleChatConfig extends ChannelConfig {
  type: 'google-chat';
  /** Path to the service account JSON key file */
  serviceAccountPath: string;
  /** Default space ID (spaces/{spaceId}) to send messages to */
  spaceId?: string;
  /** Webhook URL that Google Chat sends events to (push mode) */
  webhookUrl?: string;
  /** Bearer token for verifying incoming webhooks */
  verificationToken?: string;
  /** Project number for push subscription (Pub/Sub) */
  projectNumber?: string;
}

/**
 * Service account JSON key structure
 */
interface ServiceAccountKey {
  type: string;
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  auth_uri: string;
  token_uri: string;
}

/**
 * Google Chat space
 */
export interface GoogleChatSpace {
  name: string; // spaces/{spaceId}
  type: 'ROOM' | 'DM' | 'TYPE_UNSPECIFIED';
  displayName?: string;
  singleUserBotDm?: boolean;
  spaceThreadingState?: string;
}

/**
 * Google Chat user
 */
export interface GoogleChatUser {
  name: string; // users/{userId}
  displayName: string;
  domainId?: string;
  type: 'HUMAN' | 'BOT';
  isAnonymous?: boolean;
}

/**
 * Google Chat message
 */
export interface GoogleChatMessage {
  name?: string; // spaces/{spaceId}/messages/{messageId}
  sender?: GoogleChatUser;
  createTime?: string;
  text?: string;
  formattedText?: string;
  cards?: unknown[];
  cardsV2?: unknown[];
  annotations?: Array<{
    type: string;
    startIndex?: number;
    length?: number;
    userMention?: { user: GoogleChatUser; type: string };
    slashCommand?: { commandName: string; commandId: string };
  }>;
  thread?: { name: string; threadKey?: string };
  space?: GoogleChatSpace;
  argumentText?: string;
  attachment?: Array<{
    name: string;
    contentName: string;
    contentType: string;
    thumbnailUri?: string;
    downloadUri?: string;
    source?: string;
    attachmentDataRef?: { resourceName: string };
  }>;
  slashCommand?: { commandId: string };
  matchedUrl?: { url: string };
}

/**
 * Google Chat event (webhook payload)
 */
export interface GoogleChatEvent {
  type: 'MESSAGE' | 'ADDED_TO_SPACE' | 'REMOVED_FROM_SPACE' | 'CARD_CLICKED';
  eventTime: string;
  token?: string;
  message?: GoogleChatMessage;
  user?: GoogleChatUser;
  space?: GoogleChatSpace;
  action?: {
    actionMethodName: string;
    parameters?: Array<{ key: string; value: string }>;
  };
  configCompleteRedirectUrl?: string;
  threadKey?: string;
  common?: {
    userLocale?: string;
    hostApp?: string;
    platform?: string;
    timeZone?: { id: string; offset: number };
  };
}

// ============================================================================
// Channel Implementation
// ============================================================================

const GOOGLE_CHAT_API = 'https://chat.googleapis.com/v1';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_CHAT_SCOPE = 'https://www.googleapis.com/auth/chat.bot';

/**
 * Google Chat channel using the Workspace Chat API
 */
export class GoogleChatChannel extends BaseChannel {
  private serviceAccount: ServiceAccountKey | null = null;
  private accessToken: string | null = null;
  private tokenExpiry = 0;
  private spaceCache = new Map<string, GoogleChatSpace>();

  constructor(config: GoogleChatConfig) {
    super('google-chat', config);

    if (!config.serviceAccountPath) {
      throw new Error('Google Chat service account path is required');
    }
  }

  private get gchatConfig(): GoogleChatConfig {
    return this.config as GoogleChatConfig;
  }

  // ==========================================================================
  // Auth (Service Account JWT -> Access Token)
  // ==========================================================================

  /**
   * Load the service account key from disk
   */
  private loadServiceAccount(): ServiceAccountKey {
    try {
      const raw = readFileSync(this.gchatConfig.serviceAccountPath, 'utf-8');
      return JSON.parse(raw) as ServiceAccountKey;
    } catch (err) {
      throw new Error(
        `Failed to load Google service account from ${this.gchatConfig.serviceAccountPath}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  /**
   * Create a signed JWT for the service account
   */
  private createJwt(sa: ServiceAccountKey): string {
    const now = Math.floor(Date.now() / 1000);
    const expiry = now + 3600; // 1 hour

    const header = { alg: 'RS256', typ: 'JWT' };
    const payload = {
      iss: sa.client_email,
      scope: GOOGLE_CHAT_SCOPE,
      aud: GOOGLE_TOKEN_URL,
      iat: now,
      exp: expiry,
    };

    const encode = (obj: unknown) =>
      Buffer.from(JSON.stringify(obj)).toString('base64url');

    const unsigned = `${encode(header)}.${encode(payload)}`;

    const signer = crypto.createSign('RSA-SHA256');
    signer.update(unsigned);
    const signature = signer.sign(sa.private_key, 'base64url');

    return `${unsigned}.${signature}`;
  }

  /**
   * Exchange the signed JWT for a Google OAuth2 access token
   */
  private async getAccessToken(): Promise<string> {
    // Return cached token if still valid (with 60s buffer)
    if (this.accessToken && Date.now() < this.tokenExpiry - 60000) {
      return this.accessToken;
    }

    if (!this.serviceAccount) {
      this.serviceAccount = this.loadServiceAccount();
    }

    const jwt = this.createJwt(this.serviceAccount);

    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Google OAuth token exchange failed: ${response.status} ${text}`);
    }

    const data = (await response.json()) as {
      access_token: string;
      expires_in: number;
      token_type: string;
    };

    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + data.expires_in * 1000;
    return data.access_token;
  }

  // ==========================================================================
  // API Requests
  // ==========================================================================

  /**
   * Make an authenticated request to the Google Chat API
   */
  private async apiRequest<T>(
    method: string,
    endpoint: string,
    body?: unknown
  ): Promise<T> {
    const token = await this.getAccessToken();
    const url = `${GOOGLE_CHAT_API}${endpoint}`;

    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Google Chat API error: ${response.status} ${text}`);
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      return (await response.json()) as T;
    }
    return {} as T;
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  /**
   * Connect to Google Chat by validating the service account and
   * verifying API access
   */
  async connect(): Promise<void> {
    try {
      // Load and validate service account
      this.serviceAccount = this.loadServiceAccount();

      // Get an access token (validates the key)
      await this.getAccessToken();

      // Verify we can list spaces (basic API access check)
      try {
        const resp = await this.apiRequest<{ spaces?: GoogleChatSpace[] }>(
          'GET',
          '/spaces?pageSize=1'
        );

        if (resp.spaces) {
          for (const space of resp.spaces) {
            this.spaceCache.set(space.name, space);
          }
        }
      } catch (err) {
        // Non-fatal: some bots might only work via DMs and not have list permission
        logger.debug('Google Chat: could not list spaces (non-critical)', {
          error: err instanceof Error ? err.message : String(err),
        });
      }

      this.status.connected = true;
      this.status.authenticated = true;
      this.status.info = {
        serviceAccount: this.serviceAccount.client_email,
        projectId: this.serviceAccount.project_id,
        defaultSpace: this.gchatConfig.spaceId,
      };

      logger.debug('Google Chat connected', {
        serviceAccount: this.serviceAccount.client_email,
      });
      this.emit('connected', 'google-chat');
    } catch (error) {
      this.status.error = error instanceof Error ? error.message : String(error);
      this.emit('error', 'google-chat', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Disconnect from Google Chat
   */
  async disconnect(): Promise<void> {
    this.accessToken = null;
    this.tokenExpiry = 0;
    this.serviceAccount = null;
    this.spaceCache.clear();
    this.status.connected = false;
    this.status.authenticated = false;
    this.emit('disconnected', 'google-chat');
  }

  /**
   * Send a message to a Google Chat space
   */
  async send(message: OutboundMessage): Promise<DeliveryResult> {
    if (!this.status.connected) {
      return { success: false, error: 'Google Chat not connected', timestamp: new Date() };
    }

    try {
      // channelId should be a space name like "spaces/AAAA" or just the space ID
      const spaceName = message.channelId.startsWith('spaces/')
        ? message.channelId
        : `spaces/${message.channelId}`;

      const payload: Record<string, unknown> = {
        text: message.content,
      };

      // Thread support
      if (message.threadId) {
        payload.thread = { name: message.threadId };
        // Reply in the same thread
      }

      // Card support for attachments/buttons
      if (message.buttons && message.buttons.length > 0) {
        payload.cardsV2 = [
          {
            cardId: `card-${Date.now()}`,
            card: {
              sections: [
                {
                  widgets: [
                    {
                      buttonList: {
                        buttons: message.buttons.map((btn) => {
                          if (btn.type === 'url' && btn.url) {
                            return {
                              text: btn.text,
                              onClick: { openLink: { url: btn.url } },
                            };
                          }
                          return {
                            text: btn.text,
                            onClick: {
                              action: {
                                actionMethodName: btn.data ?? btn.text,
                              },
                            },
                          };
                        }),
                      },
                    },
                  ],
                },
              ],
            },
          },
        ];
      }

      const queryParams = message.threadId
        ? '?messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD'
        : '';

      const result = await this.apiRequest<GoogleChatMessage>(
        'POST',
        `/${spaceName}/messages${queryParams}`,
        payload
      );

      // Extract message ID from the name (spaces/{spaceId}/messages/{messageId})
      const messageId = result.name?.split('/').pop();

      return {
        success: true,
        messageId,
        timestamp: new Date(),
      };
    } catch (error) {
      logger.debug('Google Chat send error', {
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
  // Webhook Handling (Push Mode)
  // ==========================================================================

  /**
   * Handle an incoming Google Chat webhook event.
   * Call this from your HTTP server route handler.
   *
   * @param event - The parsed request body
   * @param bearerToken - The Bearer token from the Authorization header (optional)
   * @returns Response body to send back to Google Chat (can include a synchronous reply)
   */
  async handleWebhook(
    event: GoogleChatEvent,
    bearerToken?: string
  ): Promise<Record<string, unknown> | void> {
    // Verify token if configured
    if (this.gchatConfig.verificationToken) {
      if (event.token !== this.gchatConfig.verificationToken) {
        logger.debug('Google Chat: webhook token mismatch');
        return;
      }
    }

    switch (event.type) {
      case 'MESSAGE':
        return this.handleMessageEvent(event);

      case 'ADDED_TO_SPACE':
        logger.debug('Google Chat: bot added to space', {
          space: event.space?.name,
          user: event.user?.displayName,
        });
        if (event.space) {
          this.spaceCache.set(event.space.name, event.space);
        }
        // Return a greeting
        return { text: 'Hello! I\'m ready to help.' };

      case 'REMOVED_FROM_SPACE':
        logger.debug('Google Chat: bot removed from space', {
          space: event.space?.name,
        });
        if (event.space) {
          this.spaceCache.delete(event.space.name);
        }
        return;

      case 'CARD_CLICKED':
        return this.handleCardClicked(event);

      default:
        logger.debug('Google Chat: unhandled event type', { type: event.type });
        return;
    }
  }

  /**
   * Handle MESSAGE event
   */
  private async handleMessageEvent(event: GoogleChatEvent): Promise<void> {
    const msg = event.message;
    const user = event.user ?? msg?.sender;
    const space = event.space ?? msg?.space;

    if (!msg || !user || !space) return;

    // Ignore bot messages
    if (user.type === 'BOT') return;

    const userId = user.name?.replace('users/', '') ?? '';
    if (!this.isUserAllowed(userId)) return;

    const spaceId = space.name?.replace('spaces/', '') ?? '';
    if (!this.isChannelAllowed(spaceId)) return;

    // Extract text (argumentText strips the @mention prefix)
    const text = msg.argumentText?.trim() ?? msg.text ?? '';

    // Check for slash commands
    let isCommand = false;
    let commandName: string | undefined;
    let commandArgs: string[] | undefined;

    if (msg.slashCommand || msg.annotations?.some((a) => a.type === 'SLASH_COMMAND')) {
      const annotation = msg.annotations?.find((a) => a.type === 'SLASH_COMMAND');
      isCommand = true;
      commandName = annotation?.slashCommand?.commandName ?? text.split(/\s+/)[0]?.replace(/^\//, '');
      commandArgs = text.split(/\s+/).slice(1);
    }

    // Build attachments
    const attachments: MessageAttachment[] = (msg.attachment ?? []).map((a) => ({
      type: this.mimeToContentType(a.contentType),
      fileName: a.contentName,
      mimeType: a.contentType,
      url: a.downloadUri ?? a.thumbnailUri,
    }));

    const inbound: InboundMessage = {
      id: msg.name?.split('/').pop() ?? `gchat-${Date.now()}`,
      channel: {
        id: spaceId,
        type: 'google-chat',
        name: space.displayName ?? spaceId,
        isDM: space.type === 'DM',
        isGroup: space.type === 'ROOM',
      },
      sender: {
        id: userId,
        displayName: user.displayName,
        isBot: false, // Bot messages are filtered above
      },
      content: text,
      contentType: isCommand ? 'command' : (attachments.length > 0 ? attachments[0].type : 'text'),
      attachments: attachments.length > 0 ? attachments : undefined,
      isCommand,
      commandName,
      commandArgs,
      threadId: msg.thread?.name,
      timestamp: msg.createTime ? new Date(msg.createTime) : new Date(),
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
        await this.send({ channelId: space.name, content: pairingMessage });
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
   * Handle CARD_CLICKED event (button press)
   */
  private async handleCardClicked(event: GoogleChatEvent): Promise<void> {
    const user = event.user;
    const space = event.space;
    if (!user || !space) return;

    const actionName = event.action?.actionMethodName ?? '';
    const params = event.action?.parameters ?? [];

    const userId = user.name?.replace('users/', '') ?? '';
    const spaceId = space.name?.replace('spaces/', '') ?? '';

    const inbound: InboundMessage = {
      id: `card-${Date.now()}`,
      channel: {
        id: spaceId,
        type: 'google-chat',
        name: space.displayName ?? spaceId,
        isDM: space.type === 'DM',
        isGroup: space.type === 'ROOM',
      },
      sender: {
        id: userId,
        displayName: user.displayName,
      },
      content: actionName,
      contentType: 'command',
      isCommand: true,
      commandName: 'card_action',
      commandArgs: [actionName, ...params.map((p) => `${p.key}=${p.value}`)],
      timestamp: new Date(),
      raw: event,
    };

    inbound.sessionKey = getSessionKey(inbound);
    this.emit('command', inbound);
  }

  // ==========================================================================
  // Space Management
  // ==========================================================================

  /**
   * List spaces the bot has access to
   */
  async listSpaces(): Promise<GoogleChatSpace[]> {
    try {
      const result = await this.apiRequest<{
        spaces?: GoogleChatSpace[];
        nextPageToken?: string;
      }>('GET', '/spaces?pageSize=100');
      return result.spaces ?? [];
    } catch {
      return [];
    }
  }

  /**
   * Get a specific space
   */
  async getSpace(spaceName: string): Promise<GoogleChatSpace | null> {
    const normalized = spaceName.startsWith('spaces/') ? spaceName : `spaces/${spaceName}`;
    if (this.spaceCache.has(normalized)) {
      return this.spaceCache.get(normalized)!;
    }

    try {
      const space = await this.apiRequest<GoogleChatSpace>('GET', `/${normalized}`);
      this.spaceCache.set(space.name, space);
      return space;
    } catch {
      return null;
    }
  }

  /**
   * Update a previously sent message
   */
  async updateMessage(messageName: string, text: string): Promise<void> {
    const normalized = messageName.startsWith('spaces/')
      ? messageName
      : `spaces/${messageName}`;

    await this.apiRequest('PUT', `/${normalized}?updateMask=text`, { text });
  }

  /**
   * Delete a previously sent message
   */
  async deleteMessage(messageName: string): Promise<void> {
    const normalized = messageName.startsWith('spaces/')
      ? messageName
      : `spaces/${messageName}`;

    await this.apiRequest('DELETE', `/${normalized}`);
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

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
}

export default GoogleChatChannel;
