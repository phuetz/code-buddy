/**
 * Microsoft Teams Channel Adapter
 *
 * Microsoft Teams integration via the Bot Framework REST API.
 * Uses the Bot Framework v4 protocol for authentication and messaging.
 *
 * Requires:
 * - An Azure Bot resource with a Microsoft App ID and Password
 * - The bot registered in the Teams Developer Portal
 *
 * The adapter receives activities via webhook (HTTP POST to /api/messages)
 * and sends messages via the Bot Framework connector service.
 *
 * Reference: https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-api-reference
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
  MessageButton,
} from '../index.js';
import { BaseChannel, getSessionKey, checkDMPairing } from '../index.js';
import { logger } from '../../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Teams-specific configuration
 */
export interface TeamsConfig extends ChannelConfig {
  type: 'teams';
  /** Microsoft App ID (from Azure Bot resource) */
  appId: string;
  /** Microsoft App Password/Secret */
  appPassword: string;
  /** Azure AD tenant ID (optional, defaults to 'botframework.com') */
  tenantId?: string;
  /** OAuth authority URL (optional, for sovereign clouds) */
  oauthAuthority?: string;
}

/**
 * Bot Framework Activity
 */
export interface BotFrameworkActivity {
  type: string;
  id?: string;
  timestamp?: string;
  localTimestamp?: string;
  channelId?: string;
  from?: BotFrameworkAccount;
  conversation?: BotFrameworkConversation;
  recipient?: BotFrameworkAccount;
  text?: string;
  textFormat?: string;
  attachments?: BotFrameworkAttachment[];
  entities?: Array<{
    type: string;
    mentioned?: BotFrameworkAccount;
    text?: string;
    [key: string]: unknown;
  }>;
  channelData?: Record<string, unknown>;
  serviceUrl?: string;
  replyToId?: string;
  value?: unknown;
  name?: string;
  action?: string;
  locale?: string;
  localTimezone?: string;
  summary?: string;
  suggestedActions?: {
    actions: Array<{
      type: string;
      title: string;
      value: string;
      image?: string;
    }>;
  };
}

/**
 * Bot Framework account reference
 */
export interface BotFrameworkAccount {
  id: string;
  name?: string;
  aadObjectId?: string;
  role?: string;
}

/**
 * Bot Framework conversation reference
 */
export interface BotFrameworkConversation {
  id: string;
  name?: string;
  isGroup?: boolean;
  conversationType?: string;
  tenantId?: string;
}

/**
 * Bot Framework attachment
 */
export interface BotFrameworkAttachment {
  contentType: string;
  contentUrl?: string;
  content?: unknown;
  name?: string;
  thumbnailUrl?: string;
}

/**
 * Stored conversation reference for proactive messaging
 */
export interface ConversationReference {
  activityId?: string;
  user: BotFrameworkAccount;
  bot: BotFrameworkAccount;
  conversation: BotFrameworkConversation;
  channelId: string;
  serviceUrl: string;
}

// ============================================================================
// Channel Implementation
// ============================================================================

const BOT_FRAMEWORK_TOKEN_URL = 'https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token';
const BOT_FRAMEWORK_SCOPE = 'https://api.botframework.com/.default';
const OPENID_METADATA_URL = 'https://login.botframework.com/v1/.well-known/openidconfiguration';

/**
 * Microsoft Teams channel using Bot Framework REST API
 */
export class TeamsChannel extends BaseChannel {
  private accessToken: string | null = null;
  private tokenExpiry = 0;
  private conversationRefs = new Map<string, ConversationReference>();
  private serviceUrls = new Set<string>();

  constructor(config: TeamsConfig) {
    super('teams', config);

    if (!config.appId) {
      throw new Error('Teams App ID is required');
    }
    if (!config.appPassword) {
      throw new Error('Teams App Password is required');
    }
  }

  private get teamsConfig(): TeamsConfig {
    return this.config as TeamsConfig;
  }

  // ==========================================================================
  // Authentication
  // ==========================================================================

  /**
   * Get a Bot Framework access token
   */
  private async getAccessToken(): Promise<string> {
    // Return cached token if still valid (with 60s buffer)
    if (this.accessToken && Date.now() < this.tokenExpiry - 60000) {
      return this.accessToken;
    }

    const authority = this.teamsConfig.oauthAuthority ?? BOT_FRAMEWORK_TOKEN_URL;

    const response = await fetch(authority, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.teamsConfig.appId,
        client_secret: this.teamsConfig.appPassword,
        scope: BOT_FRAMEWORK_SCOPE,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Bot Framework token exchange failed: ${response.status} ${text}`);
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

  /**
   * Make an authenticated request to the Bot Connector API
   */
  private async apiRequest<T>(
    method: string,
    serviceUrl: string,
    endpoint: string,
    body?: unknown
  ): Promise<T> {
    const token = await this.getAccessToken();
    const baseUrl = serviceUrl.replace(/\/$/, '');
    const url = `${baseUrl}${endpoint}`;

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
      throw new Error(`Bot Framework API error: ${response.status} ${text}`);
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
   * Connect to Teams by validating the app credentials.
   * The actual message receiving happens via webhooks.
   */
  async connect(): Promise<void> {
    try {
      // Validate credentials by fetching a token
      await this.getAccessToken();

      this.status.connected = true;
      this.status.authenticated = true;
      this.status.info = {
        appId: this.teamsConfig.appId,
        tenantId: this.teamsConfig.tenantId ?? 'botframework.com',
      };

      logger.debug('Teams connected', { appId: this.teamsConfig.appId });
      this.emit('connected', 'teams');
    } catch (error) {
      this.status.error = error instanceof Error ? error.message : String(error);
      this.emit('error', 'teams', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Disconnect from Teams
   */
  async disconnect(): Promise<void> {
    this.accessToken = null;
    this.tokenExpiry = 0;
    this.conversationRefs.clear();
    this.serviceUrls.clear();
    this.status.connected = false;
    this.status.authenticated = false;
    this.emit('disconnected', 'teams');
  }

  /**
   * Send a message to a Teams conversation
   */
  async send(message: OutboundMessage): Promise<DeliveryResult> {
    if (!this.status.connected) {
      return { success: false, error: 'Teams not connected', timestamp: new Date() };
    }

    try {
      // Look up conversation reference to find the serviceUrl
      const ref = this.conversationRefs.get(message.channelId);
      if (!ref) {
        return {
          success: false,
          error: `No conversation reference found for ${message.channelId}. The bot must receive a message first.`,
          timestamp: new Date(),
        };
      }

      const activity: Record<string, unknown> = {
        type: 'message',
        text: message.content,
        textFormat: message.parseMode === 'html' ? 'xml' : 'markdown',
      };

      // Reply threading
      if (message.replyTo) {
        activity.replyToId = message.replyTo;
      }

      // Attachments
      if (message.attachments && message.attachments.length > 0) {
        activity.attachments = message.attachments
          .filter((a) => a.url)
          .map((a) => ({
            contentType: a.mimeType ?? 'application/octet-stream',
            contentUrl: a.url,
            name: a.fileName,
          }));
      }

      // Buttons via hero card
      if (message.buttons && message.buttons.length > 0) {
        const heroCard = this.buildHeroCard(message.content, message.buttons);
        activity.attachments = [
          {
            contentType: 'application/vnd.microsoft.card.hero',
            content: heroCard,
          },
        ];
        // When using a card, text goes in the card
        delete activity.text;
      }

      const result = await this.apiRequest<{ id?: string }>(
        'POST',
        ref.serviceUrl,
        `/v3/conversations/${encodeURIComponent(ref.conversation.id)}/activities`,
        activity
      );

      return {
        success: true,
        messageId: result.id,
        timestamp: new Date(),
      };
    } catch (error) {
      logger.debug('Teams send error', {
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
  // Webhook / Activity Handling
  // ==========================================================================

  /**
   * Handle an incoming Bot Framework activity.
   * Call this from your HTTP server when you receive a POST to /api/messages.
   *
   * @param activity - The parsed request body (Bot Framework Activity)
   * @param authHeader - The Authorization header from the request (for validation)
   */
  async handleActivity(activity: BotFrameworkActivity, authHeader?: string): Promise<void> {
    // Basic validation: ensure it's from Teams
    if (activity.channelId && activity.channelId !== 'msteams' && activity.channelId !== 'emulator') {
      logger.debug('Teams: ignoring activity from non-Teams channel', {
        channelId: activity.channelId,
      });
    }

    // Store conversation reference for proactive messaging
    if (activity.from && activity.conversation && activity.serviceUrl && activity.recipient) {
      this.storeConversationReference(activity);
    }

    switch (activity.type) {
      case 'message':
        await this.handleMessageActivity(activity);
        break;

      case 'conversationUpdate':
        this.handleConversationUpdate(activity);
        break;

      case 'invoke':
        await this.handleInvoke(activity);
        break;

      case 'event':
        logger.debug('Teams: event activity', { name: activity.name });
        break;

      case 'messageReaction':
        // Could emit reaction event
        break;

      default:
        logger.debug('Teams: unhandled activity type', { type: activity.type });
    }
  }

  /**
   * Handle a message activity
   */
  private async handleMessageActivity(activity: BotFrameworkActivity): Promise<void> {
    if (!activity.from || !activity.conversation) return;

    // Check user allowlist
    if (!this.isUserAllowed(activity.from.id)) return;

    // Check channel allowlist
    if (!this.isChannelAllowed(activity.conversation.id)) return;

    // Strip bot @mention from the text
    let text = activity.text ?? '';
    if (activity.entities) {
      for (const entity of activity.entities) {
        if (entity.type === 'mention' && entity.mentioned?.id === activity.recipient?.id) {
          text = text.replace(entity.text ?? '', '').trim();
        }
      }
    }

    // Build attachments
    const attachments: MessageAttachment[] = (activity.attachments ?? [])
      .filter((a) => a.contentUrl)
      .map((a) => ({
        type: this.mimeToContentType(a.contentType),
        url: a.contentUrl,
        fileName: a.name,
        mimeType: a.contentType,
      }));

    const isGroup = activity.conversation.isGroup ??
      (activity.conversation.conversationType === 'groupChat' ||
      activity.conversation.conversationType === 'channel');

    const inbound: InboundMessage = {
      id: activity.id ?? `teams-${Date.now()}`,
      channel: {
        id: activity.conversation.id,
        type: 'teams',
        name: activity.conversation.name ?? activity.conversation.id,
        isDM: !isGroup,
        isGroup,
      },
      sender: {
        id: activity.from.id,
        displayName: activity.from.name,
        isBot: activity.from.role === 'bot',
      },
      content: text,
      contentType: attachments.length > 0 ? attachments[0].type : (text.startsWith('/') ? 'command' : 'text'),
      attachments: attachments.length > 0 ? attachments : undefined,
      replyTo: activity.replyToId,
      timestamp: activity.timestamp ? new Date(activity.timestamp) : new Date(),
      raw: activity,
    };

    const parsed = this.parseCommand(inbound);
    parsed.sessionKey = getSessionKey(parsed);

    // DM pairing check
    const pairingStatus = await checkDMPairing(parsed);
    if (!pairingStatus.approved) {
      const { getDMPairing } = await import('../dm-pairing.js');
      const pairingMessage = getDMPairing().getPairingMessage(pairingStatus);
      if (pairingMessage) {
        await this.send({ channelId: activity.conversation.id, content: pairingMessage });
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
   * Handle conversation update (members added/removed)
   */
  private handleConversationUpdate(activity: BotFrameworkActivity): void {
    const channelData = activity.channelData ?? {};
    const eventType = channelData.eventType as string | undefined;

    logger.debug('Teams: conversation update', {
      conversationId: activity.conversation?.id,
      eventType,
    });
  }

  /**
   * Handle invoke activity (adaptive card actions, messaging extensions, etc.)
   */
  private async handleInvoke(activity: BotFrameworkActivity): Promise<void> {
    if (!activity.from || !activity.conversation) return;

    if (activity.name === 'adaptiveCard/action') {
      const value = activity.value as Record<string, unknown> | undefined;
      if (value) {
        const inbound: InboundMessage = {
          id: activity.id ?? `invoke-${Date.now()}`,
          channel: {
            id: activity.conversation.id,
            type: 'teams',
            name: activity.conversation.name ?? activity.conversation.id,
          },
          sender: {
            id: activity.from.id,
            displayName: activity.from.name,
          },
          content: JSON.stringify(value),
          contentType: 'command',
          isCommand: true,
          commandName: 'card_action',
          commandArgs: Object.entries(value).map(([k, v]) => `${k}=${v}`),
          timestamp: new Date(),
          raw: activity,
        };

        inbound.sessionKey = getSessionKey(inbound);
        this.emit('command', inbound);
      }
    }
  }

  // ==========================================================================
  // Proactive Messaging
  // ==========================================================================

  /**
   * Store a conversation reference for later proactive messaging
   */
  private storeConversationReference(activity: BotFrameworkActivity): void {
    if (!activity.conversation || !activity.from || !activity.recipient || !activity.serviceUrl) return;

    const ref: ConversationReference = {
      activityId: activity.id,
      user: activity.from,
      bot: activity.recipient,
      conversation: activity.conversation,
      channelId: activity.channelId ?? 'msteams',
      serviceUrl: activity.serviceUrl,
    };

    this.conversationRefs.set(activity.conversation.id, ref);
    this.serviceUrls.add(activity.serviceUrl);
  }

  /**
   * Get a stored conversation reference
   */
  getConversationReference(conversationId: string): ConversationReference | undefined {
    return this.conversationRefs.get(conversationId);
  }

  /**
   * Send a proactive message to a conversation.
   * The bot must have previously received a message from that conversation.
   */
  async sendProactive(conversationId: string, text: string): Promise<DeliveryResult> {
    return this.send({ channelId: conversationId, content: text });
  }

  /**
   * Send typing indicator to a conversation
   */
  async sendTyping(conversationId: string): Promise<void> {
    const ref = this.conversationRefs.get(conversationId);
    if (!ref) return;

    try {
      await this.apiRequest(
        'POST',
        ref.serviceUrl,
        `/v3/conversations/${encodeURIComponent(conversationId)}/activities`,
        { type: 'typing' }
      );
    } catch {
      // Typing indicators are non-critical
    }
  }

  /**
   * Update a previously sent message
   */
  async updateMessage(
    conversationId: string,
    activityId: string,
    text: string
  ): Promise<void> {
    const ref = this.conversationRefs.get(conversationId);
    if (!ref) throw new Error(`No conversation reference for ${conversationId}`);

    await this.apiRequest(
      'PUT',
      ref.serviceUrl,
      `/v3/conversations/${encodeURIComponent(conversationId)}/activities/${encodeURIComponent(activityId)}`,
      {
        type: 'message',
        text,
        id: activityId,
      }
    );
  }

  /**
   * Delete a previously sent message
   */
  async deleteMessage(conversationId: string, activityId: string): Promise<void> {
    const ref = this.conversationRefs.get(conversationId);
    if (!ref) throw new Error(`No conversation reference for ${conversationId}`);

    await this.apiRequest(
      'DELETE',
      ref.serviceUrl,
      `/v3/conversations/${encodeURIComponent(conversationId)}/activities/${encodeURIComponent(activityId)}`
    );
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  /**
   * Build a hero card with buttons
   */
  private buildHeroCard(
    text: string,
    buttons: MessageButton[]
  ): Record<string, unknown> {
    return {
      title: '',
      text,
      buttons: buttons.map((btn) => {
        if (btn.type === 'url' && btn.url) {
          return { type: 'openUrl', title: btn.text, value: btn.url };
        }
        return {
          type: 'messageBack',
          title: btn.text,
          text: btn.data ?? btn.text,
          value: btn.data ?? btn.text,
        };
      }),
    };
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
}

export default TeamsChannel;
