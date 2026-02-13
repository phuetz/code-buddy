/**
 * Discord Channel Client
 *
 * Discord bot implementation using the Discord API.
 * Supports messages, slash commands, and interactions.
 */

import { EventEmitter } from 'events';
import WebSocket from 'ws';
import type {
  DiscordConfig,
  DiscordUser,
  DiscordMessage,
  DiscordChannelObject,
  DiscordAttachment,
  DiscordEmbed,
  DiscordInteraction,
  DiscordActionRow,
  DiscordButton,
  DiscordGuild,
} from './types.js';
import type {
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
import { ReconnectionManager } from '../reconnection-manager.js';
import { logger } from '../../utils/logger.js';

const DISCORD_API_BASE = 'https://discord.com/api/v10';
const DISCORD_GATEWAY = 'wss://gateway.discord.gg/?v=10&encoding=json';

// Gateway opcodes
const OP = {
  DISPATCH: 0,
  HEARTBEAT: 1,
  IDENTIFY: 2,
  PRESENCE_UPDATE: 3,
  VOICE_STATE_UPDATE: 4,
  RESUME: 6,
  RECONNECT: 7,
  REQUEST_GUILD_MEMBERS: 8,
  INVALID_SESSION: 9,
  HELLO: 10,
  HEARTBEAT_ACK: 11,
};

// Intent flags
const INTENTS = {
  Guilds: 1 << 0,
  GuildMembers: 1 << 1,
  GuildModeration: 1 << 2,
  GuildEmojisAndStickers: 1 << 3,
  GuildIntegrations: 1 << 4,
  GuildWebhooks: 1 << 5,
  GuildInvites: 1 << 6,
  GuildVoiceStates: 1 << 7,
  GuildPresences: 1 << 8,
  GuildMessages: 1 << 9,
  GuildMessageReactions: 1 << 10,
  GuildMessageTyping: 1 << 11,
  DirectMessages: 1 << 12,
  DirectMessageReactions: 1 << 13,
  DirectMessageTyping: 1 << 14,
  MessageContent: 1 << 15,
  GuildScheduledEvents: 1 << 16,
  AutoModerationConfiguration: 1 << 20,
  AutoModerationExecution: 1 << 21,
};

/**
 * Discord channel implementation
 */
export class DiscordChannel extends BaseChannel {
  private ws: WebSocket | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private lastSequence: number | null = null;
  private sessionId: string | null = null;
  private resumeGatewayUrl: string | null = null;
  private botUser: DiscordUser | null = null;
  private reconnecting = false;
  private reconnectionManager: ReconnectionManager;

  constructor(config: DiscordConfig) {
    super('discord', config);
    if (!config.token) {
      throw new Error('Discord bot token is required');
    }
    this.reconnectionManager = new ReconnectionManager('discord', {
      maxRetries: 10,
      initialDelayMs: 1000,
      maxDelayMs: 60000,
    });
  }

  private get discordConfig(): DiscordConfig {
    return this.config as DiscordConfig;
  }

  /**
   * Make API request to Discord
   */
  private async apiRequest<T>(
    method: string,
    endpoint: string,
    body?: unknown
  ): Promise<T> {
    const url = `${DISCORD_API_BASE}${endpoint}`;

    const headers: Record<string, string> = {
      Authorization: `Bot ${this.discordConfig.token}`,
      'Content-Type': 'application/json',
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Discord API error: ${response.status} ${error}`);
    }

    // Handle empty responses
    const text = await response.text();
    if (!text) return {} as T;

    return JSON.parse(text) as T;
  }

  /**
   * Calculate intents bitmask
   */
  private getIntents(): number {
    const configIntents = this.discordConfig.intents ?? [
      'Guilds',
      'GuildMessages',
      'DirectMessages',
      'MessageContent',
    ];

    let intents = 0;
    for (const intent of configIntents) {
      if (intent in INTENTS) {
        intents |= INTENTS[intent as keyof typeof INTENTS];
      }
    }
    return intents;
  }

  /**
   * Connect to Discord
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const gatewayUrl = this.resumeGatewayUrl ?? DISCORD_GATEWAY;
        this.ws = new WebSocket(gatewayUrl);

        this.ws.on('open', () => {
          // Will identify after receiving HELLO
        });

        this.ws.on('message', async (data) => {
          try {
            const payload = JSON.parse(data.toString());
            await this.handleGatewayMessage(payload, resolve);
          } catch (error) {
            this.emit('error', 'discord', error);
          }
        });

        this.ws.on('close', (code, reason) => {
          this.handleClose(code, reason.toString());
        });

        this.ws.on('error', (error) => {
          this.emit('error', 'discord', error);
          if (!this.status.connected) {
            reject(error);
          }
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Handle gateway messages
   */
  private async handleGatewayMessage(
    payload: { op: number; d: unknown; s?: number; t?: string },
    resolve?: (value: void) => void
  ): Promise<void> {
    if (payload.s) {
      this.lastSequence = payload.s;
    }

    switch (payload.op) {
      case OP.HELLO:
        await this.handleHello(payload.d as { heartbeat_interval: number });
        break;

      case OP.HEARTBEAT:
        this.sendHeartbeat();
        break;

      case OP.HEARTBEAT_ACK:
        // Heartbeat acknowledged
        break;

      case OP.INVALID_SESSION:
        await this.handleInvalidSession(payload.d as boolean);
        break;

      case OP.RECONNECT:
        await this.reconnect();
        break;

      case OP.DISPATCH:
        await this.handleDispatch(payload.t!, payload.d, resolve);
        break;
    }
  }

  /**
   * Handle HELLO (start heartbeat and identify)
   */
  private async handleHello(data: { heartbeat_interval: number }): Promise<void> {
    // Clear any existing heartbeat before starting new one
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat();
    }, data.heartbeat_interval);

    // Send first heartbeat immediately
    this.sendHeartbeat();

    // Identify or resume
    if (this.sessionId && this.lastSequence !== null) {
      this.sendResume();
    } else {
      this.sendIdentify();
    }
  }

  /**
   * Send heartbeat
   */
  private sendHeartbeat(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          op: OP.HEARTBEAT,
          d: this.lastSequence,
        })
      );
    }
  }

  /**
   * Send identify
   */
  private sendIdentify(): void {
    const presence = this.discordConfig.presence;

    this.ws?.send(
      JSON.stringify({
        op: OP.IDENTIFY,
        d: {
          token: this.discordConfig.token,
          intents: this.getIntents(),
          properties: {
            os: process.platform,
            browser: 'code-buddy',
            device: 'code-buddy',
          },
          presence: presence
            ? {
                status: presence.status ?? 'online',
                activities: presence.activity
                  ? [
                      {
                        name: presence.activity.name,
                        type: this.getActivityType(presence.activity.type),
                        url: presence.activity.url,
                      },
                    ]
                  : [],
              }
            : undefined,
        },
      })
    );
  }

  /**
   * Send resume
   */
  private sendResume(): void {
    this.ws?.send(
      JSON.stringify({
        op: OP.RESUME,
        d: {
          token: this.discordConfig.token,
          session_id: this.sessionId,
          seq: this.lastSequence,
        },
      })
    );
  }

  /**
   * Handle invalid session
   */
  private async handleInvalidSession(resumable: boolean): Promise<void> {
    if (!resumable) {
      this.sessionId = null;
      this.lastSequence = null;
    }

    // Wait 1-5 seconds before reconnecting
    await new Promise((r) => setTimeout(r, 1000 + Math.random() * 4000));
    await this.reconnect();
  }

  /**
   * Handle connection close
   */
  private handleClose(code: number, reason: string): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    this.status.connected = false;

    // Check if we should reconnect
    const shouldReconnect = [4000, 4001, 4002, 4003, 4005, 4007, 4008, 4009].includes(
      code
    );

    if (shouldReconnect && !this.reconnecting) {
      this.reconnect();
    } else {
      this.emit('disconnected', 'discord', new Error(`Close: ${code} ${reason}`));
    }
  }

  /**
   * Reconnect to gateway using ReconnectionManager for backoff
   */
  private reconnect(): void {
    if (this.reconnecting) return;

    this.reconnectionManager.scheduleReconnect(async () => {
      this.reconnecting = true;
      try {
        if (this.ws) {
          this.ws.removeAllListeners();
          if (this.ws.readyState === WebSocket.OPEN) {
            this.ws.close();
          }
          this.ws = null;
        }
        await this.connect();
        this.reconnectionManager.onConnected();
      } finally {
        this.reconnecting = false;
      }
    });
  }

  /**
   * Handle dispatch events
   */
  private async handleDispatch(
    eventName: string,
    data: unknown,
    resolve?: (value: void) => void
  ): Promise<void> {
    switch (eventName) {
      case 'READY':
        await this.handleReady(data as { user: DiscordUser; session_id: string; resume_gateway_url: string });
        resolve?.();
        break;

      case 'RESUMED':
        this.status.connected = true;
        this.emit('connected', 'discord');
        resolve?.();
        break;

      case 'MESSAGE_CREATE':
        await this.handleMessageCreate(data as DiscordMessage);
        break;

      case 'INTERACTION_CREATE':
        await this.handleInteraction(data as DiscordInteraction);
        break;

      case 'MESSAGE_REACTION_ADD':
        // Could emit reaction event
        break;

      case 'TYPING_START':
        // Could emit typing event
        break;
    }
  }

  /**
   * Handle READY event
   */
  private async handleReady(data: {
    user: DiscordUser;
    session_id: string;
    resume_gateway_url: string;
  }): Promise<void> {
    this.botUser = data.user;
    this.sessionId = data.session_id;
    this.resumeGatewayUrl = data.resume_gateway_url;

    this.status.connected = true;
    this.status.authenticated = true;
    this.status.info = {
      botId: data.user.id,
      botUsername: data.user.username,
      botTag: `${data.user.username}#${data.user.discriminator}`,
    };

    this.reconnectionManager.onConnected();

    // Register slash commands if provided
    if (this.discordConfig.commands && this.discordConfig.commands.length > 0) {
      await this.registerCommands();
    }

    this.emit('connected', 'discord');
  }

  /**
   * Register slash commands
   */
  private async registerCommands(): Promise<void> {
    if (!this.discordConfig.applicationId) {
      logger.warn('Cannot register slash commands without applicationId');
      return;
    }

    const commands = this.discordConfig.commands!.map((cmd) => ({
      name: cmd.name,
      description: cmd.description,
      options: cmd.options?.map((opt) => ({
        name: opt.name,
        description: opt.description,
        type: this.getOptionType(opt.type),
        required: opt.required,
        choices: opt.choices,
      })),
    }));

    // Register to specific guilds (faster) or globally
    if (this.discordConfig.guildIds && this.discordConfig.guildIds.length > 0) {
      for (const guildId of this.discordConfig.guildIds) {
        await this.apiRequest(
          'PUT',
          `/applications/${this.discordConfig.applicationId}/guilds/${guildId}/commands`,
          commands
        );
      }
    } else {
      await this.apiRequest(
        'PUT',
        `/applications/${this.discordConfig.applicationId}/commands`,
        commands
      );
    }
  }

  /**
   * Handle message create
   */
  private async handleMessageCreate(msg: DiscordMessage): Promise<void> {
    // Ignore bot messages (including our own)
    if (msg.author.bot) return;

    // Check if user is allowed
    if (!this.isUserAllowed(msg.author.id)) return;

    // Check if channel is allowed
    if (!this.isChannelAllowed(msg.channel_id)) return;

    // Check mention-only mode
    if (
      this.discordConfig.mentionOnly &&
      this.botUser &&
      !msg.mentions.some((u) => u.id === this.botUser!.id)
    ) {
      return;
    }

    const message = await this.convertMessage(msg);
    const parsed = this.parseCommand(message);

    // Attach session key for session isolation
    parsed.sessionKey = getSessionKey(parsed);

    // DM pairing check: gate unapproved DM senders
    const pairingStatus = await checkDMPairing(parsed);
    if (!pairingStatus.approved) {
      const { getDMPairing } = await import('../dm-pairing.js');
      const pairingMessage = getDMPairing().getPairingMessage(pairingStatus);
      if (pairingMessage) {
        await this.send({
          channelId: msg.channel_id,
          content: pairingMessage,
        });
      }
      return;
    }

    this.emit('message', parsed);

    if (parsed.isCommand) {
      this.emit('command', parsed);
    }
  }

  /**
   * Handle interaction (slash command, button, etc.)
   */
  private async handleInteraction(interaction: DiscordInteraction): Promise<void> {
    // Type 2 = Application Command
    if (interaction.type === 2 && interaction.data) {
      const user = interaction.member?.user ?? interaction.user;

      if (user && !this.isUserAllowed(user.id)) {
        await this.respondToInteraction(
          interaction.id,
          interaction.token,
          'You are not authorized to use this bot.'
        );
        return;
      }

      // Build command arguments
      const args: string[] = [];
      if (interaction.data.options) {
        for (const opt of interaction.data.options) {
          if (opt.value !== undefined) {
            args.push(String(opt.value));
          }
        }
      }

      const message: InboundMessage = {
        id: interaction.id,
        channel: {
          id: interaction.channel_id ?? 'unknown',
          type: 'discord',
          name: 'slash-command',
        },
        sender: user ? this.convertUser(user) : { id: 'unknown' },
        content: `/${interaction.data.name} ${args.join(' ')}`.trim(),
        contentType: 'command',
        timestamp: new Date(),
        isCommand: true,
        commandName: interaction.data.name,
        commandArgs: args,
        raw: interaction,
      };

      // Attach session key for session isolation
      message.sessionKey = getSessionKey(message);

      this.emit('command', message);

      // Defer reply (bot should respond within 3 seconds)
      await this.deferInteraction(interaction.id, interaction.token);
    }

    // Type 3 = Message Component (button, select)
    if (interaction.type === 3 && interaction.data) {
      const user = interaction.member?.user ?? interaction.user;

      const message: InboundMessage = {
        id: interaction.id,
        channel: {
          id: interaction.channel_id ?? 'unknown',
          type: 'discord',
        },
        sender: user ? this.convertUser(user) : { id: 'unknown' },
        content: interaction.data.custom_id ?? '',
        contentType: 'command',
        timestamp: new Date(),
        isCommand: true,
        commandName: 'button',
        commandArgs: [interaction.data.custom_id ?? ''],
        raw: interaction,
      };

      // Attach session key for session isolation
      message.sessionKey = getSessionKey(message);

      this.emit('command', message);
    }
  }

  /**
   * Respond to interaction
   */
  async respondToInteraction(
    interactionId: string,
    interactionToken: string,
    content: string,
    options?: { ephemeral?: boolean; embeds?: DiscordEmbed[] }
  ): Promise<void> {
    await this.apiRequest(
      'POST',
      `/interactions/${interactionId}/${interactionToken}/callback`,
      {
        type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
        data: {
          content,
          flags: options?.ephemeral ? 64 : 0,
          embeds: options?.embeds,
        },
      }
    );
  }

  /**
   * Defer interaction response
   */
  async deferInteraction(
    interactionId: string,
    interactionToken: string
  ): Promise<void> {
    await this.apiRequest(
      'POST',
      `/interactions/${interactionId}/${interactionToken}/callback`,
      {
        type: 5, // DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE
      }
    );
  }

  /**
   * Edit deferred interaction response
   */
  async editInteractionResponse(
    applicationId: string,
    interactionToken: string,
    content: string,
    options?: { embeds?: DiscordEmbed[]; components?: DiscordActionRow[] }
  ): Promise<void> {
    await this.apiRequest(
      'PATCH',
      `/webhooks/${applicationId}/${interactionToken}/messages/@original`,
      {
        content,
        embeds: options?.embeds,
        components: options?.components,
      }
    );
  }

  /**
   * Disconnect from Discord
   */
  async disconnect(): Promise<void> {
    this.reconnectionManager.cancel();

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    if (this.ws) {
      this.ws.close(1000);
      this.ws = null;
    }

    this.status.connected = false;
    this.emit('disconnected', 'discord');
  }

  /**
   * Send a message
   */
  async send(message: OutboundMessage): Promise<DeliveryResult> {
    try {
      const payload: Record<string, unknown> = {
        content: message.content,
        tts: false,
      };

      // Add reply reference
      if (message.replyTo) {
        payload.message_reference = {
          message_id: message.replyTo,
        };
      }

      // Add embeds from attachments (images, etc.)
      if (message.attachments && message.attachments.length > 0) {
        payload.embeds = message.attachments
          .filter((a) => a.type === 'image' && a.url)
          .map((a) => ({
            type: 'image',
            image: { url: a.url },
          }));
      }

      // Add buttons
      if (message.buttons && message.buttons.length > 0) {
        payload.components = [this.buildActionRow(message.buttons)];
      }

      const result = await this.apiRequest<DiscordMessage>(
        'POST',
        `/channels/${message.channelId}/messages`,
        payload
      );

      return {
        success: true,
        messageId: result.id,
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

  /**
   * Convert Discord message to InboundMessage
   */
  private async convertMessage(msg: DiscordMessage): Promise<InboundMessage> {
    const attachments = msg.attachments.map((a) => this.convertAttachment(a));

    return {
      id: msg.id,
      channel: {
        id: msg.channel_id,
        type: 'discord',
        name: msg.guild_id ? `guild-${msg.guild_id}` : 'dm',
        isDM: !msg.guild_id,
        isGroup: !!msg.guild_id,
      },
      sender: this.convertUser(msg.author),
      content: msg.content,
      contentType: this.determineContentType(msg),
      attachments: attachments.length > 0 ? attachments : undefined,
      replyTo: msg.referenced_message?.id,
      timestamp: new Date(msg.timestamp),
      threadId: msg.thread?.id,
      raw: msg,
    };
  }

  /**
   * Convert Discord user to ChannelUser
   */
  private convertUser(user: DiscordUser): ChannelUser {
    return {
      id: user.id,
      username: user.username,
      displayName: user.global_name ?? user.username,
      avatarUrl: user.avatar
        ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
        : undefined,
      isBot: user.bot ?? false,
      raw: user,
    };
  }

  /**
   * Convert Discord attachment to MessageAttachment
   */
  private convertAttachment(attachment: DiscordAttachment): MessageAttachment {
    const type = this.getAttachmentType(attachment.content_type);

    return {
      type,
      url: attachment.url,
      fileName: attachment.filename,
      mimeType: attachment.content_type,
      size: attachment.size,
      width: attachment.width,
      height: attachment.height,
    };
  }

  /**
   * Get attachment type from content type
   */
  private getAttachmentType(contentType?: string): ContentType {
    if (!contentType) return 'file';
    if (contentType.startsWith('image/')) return 'image';
    if (contentType.startsWith('audio/')) return 'audio';
    if (contentType.startsWith('video/')) return 'video';
    return 'file';
  }

  /**
   * Determine content type from message
   */
  private determineContentType(msg: DiscordMessage): ContentType {
    if (msg.attachments.length > 0) {
      return this.getAttachmentType(msg.attachments[0].content_type);
    }
    if (msg.content.startsWith('/')) return 'command';
    return 'text';
  }

  /**
   * Get activity type number
   */
  private getActivityType(
    type: 'Playing' | 'Streaming' | 'Listening' | 'Watching' | 'Competing'
  ): number {
    const types = { Playing: 0, Streaming: 1, Listening: 2, Watching: 3, Competing: 5 };
    return types[type] ?? 0;
  }

  /**
   * Get command option type number
   */
  private getOptionType(type: string): number {
    const types: Record<string, number> = {
      SUB_COMMAND: 1,
      SUB_COMMAND_GROUP: 2,
      STRING: 3,
      INTEGER: 4,
      BOOLEAN: 5,
      USER: 6,
      CHANNEL: 7,
      ROLE: 8,
      MENTIONABLE: 9,
      NUMBER: 10,
      ATTACHMENT: 11,
    };
    return types[type] ?? 3;
  }

  /**
   * Build action row from buttons
   */
  private buildActionRow(buttons: MessageButton[]): DiscordActionRow {
    const components: DiscordButton[] = buttons.slice(0, 5).map((btn) => {
      if (btn.type === 'url' && btn.url) {
        return {
          type: 2,
          style: 5, // Link
          label: btn.text,
          url: btn.url,
        };
      }
      return {
        type: 2,
        style: 1, // Primary
        label: btn.text,
        custom_id: btn.data ?? btn.text,
      };
    });

    return {
      type: 1,
      components,
    };
  }

  /**
   * Send typing indicator
   */
  async sendTyping(channelId: string): Promise<void> {
    await this.apiRequest('POST', `/channels/${channelId}/typing`, {});
  }

  /**
   * Edit a message
   */
  async editMessage(
    channelId: string,
    messageId: string,
    content: string
  ): Promise<void> {
    await this.apiRequest('PATCH', `/channels/${channelId}/messages/${messageId}`, {
      content,
    });
  }

  /**
   * Delete a message
   */
  async deleteMessage(channelId: string, messageId: string): Promise<void> {
    await this.apiRequest('DELETE', `/channels/${channelId}/messages/${messageId}`);
  }

  /**
   * Add reaction to message
   */
  async addReaction(
    channelId: string,
    messageId: string,
    emoji: string
  ): Promise<void> {
    const encoded = encodeURIComponent(emoji);
    await this.apiRequest(
      'PUT',
      `/channels/${channelId}/messages/${messageId}/reactions/${encoded}/@me`,
      {}
    );
  }
}

export default DiscordChannel;
