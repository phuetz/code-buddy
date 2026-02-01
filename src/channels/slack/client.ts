/**
 * Slack Channel Client
 *
 * Slack bot implementation using the Slack Web API.
 * Supports both HTTP mode and Socket Mode.
 */

import { EventEmitter } from 'events';
import WebSocket from 'ws';
import crypto from 'crypto';
import type {
  SlackConfig,
  SlackUser,
  SlackMessage,
  SlackConversation,
  SlackFile,
  SlackEvent,
  SlackEventCallback,
  SlackInteractionPayload,
  SlackSlashCommand,
  SlackBlock,
  SlackButtonElement,
  SlackActionsBlock,
  SlackApiResponse,
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
import { BaseChannel } from '../index.js';

const SLACK_API_BASE = 'https://slack.com/api';
const SLACK_SOCKET_URL = 'wss://wss-primary.slack.com/websocket';

/**
 * Slack channel implementation
 */
export class SlackChannel extends BaseChannel {
  private ws: WebSocket | null = null;
  private botUserId: string | null = null;
  private reconnecting = false;
  private pingInterval: NodeJS.Timeout | null = null;
  private userCache = new Map<string, SlackUser>();
  private channelCache = new Map<string, SlackConversation>();

  constructor(config: SlackConfig) {
    super('slack', config);
    if (!config.token) {
      throw new Error('Slack bot token is required');
    }
  }

  private get slackConfig(): SlackConfig {
    return this.config as SlackConfig;
  }

  /**
   * Make API request to Slack
   */
  private async apiRequest<T>(
    method: string,
    params?: Record<string, unknown>
  ): Promise<T> {
    const url = `${SLACK_API_BASE}/${method}`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.slackConfig.token}`,
      'Content-Type': 'application/json; charset=utf-8',
    };

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: params ? JSON.stringify(params) : undefined,
    });

    const data = (await response.json()) as SlackApiResponse<T>;

    if (!data.ok) {
      throw new Error(`Slack API error: ${data.error || 'Unknown error'}`);
    }

    return data as T;
  }

  /**
   * Connect to Slack
   */
  async connect(): Promise<void> {
    try {
      // Test authentication and get bot user ID
      const authTest = await this.apiRequest<{
        ok: boolean;
        user_id: string;
        user: string;
        team: string;
        team_id: string;
      }>('auth.test');

      this.botUserId = authTest.user_id;
      this.slackConfig.botUserId = authTest.user_id;

      this.status.connected = true;
      this.status.authenticated = true;
      this.status.info = {
        botId: authTest.user_id,
        botName: authTest.user,
        teamId: authTest.team_id,
        teamName: authTest.team,
      };

      // Connect via Socket Mode if configured
      if (this.slackConfig.socketMode && this.slackConfig.appToken) {
        await this.connectSocketMode();
      }

      this.emit('connected', 'slack');
    } catch (error) {
      this.status.error = error instanceof Error ? error.message : String(error);
      this.emit('error', 'slack', error);
      throw error;
    }
  }

  /**
   * Connect via Socket Mode
   */
  private async connectSocketMode(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // Get WebSocket URL
        this.getSocketUrl()
          .then((url) => {
            this.ws = new WebSocket(url);

            this.ws.on('open', () => {
              // Start ping interval
              this.pingInterval = setInterval(() => {
                if (this.ws?.readyState === WebSocket.OPEN) {
                  this.ws.ping();
                }
              }, 30000);

              resolve();
            });

            this.ws.on('message', async (data) => {
              try {
                const payload = JSON.parse(data.toString());
                await this.handleSocketMessage(payload);
              } catch (error) {
                this.emit('error', 'slack', error);
              }
            });

            this.ws.on('close', () => {
              this.handleClose();
            });

            this.ws.on('error', (error) => {
              this.emit('error', 'slack', error);
              if (!this.status.connected) {
                reject(error);
              }
            });
          })
          .catch(reject);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Get Socket Mode URL
   */
  private async getSocketUrl(): Promise<string> {
    const response = await fetch(`${SLACK_API_BASE}/apps.connections.open`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.slackConfig.appToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    const data = (await response.json()) as { ok: boolean; url?: string; error?: string };

    if (!data.ok || !data.url) {
      throw new Error(`Failed to get Socket Mode URL: ${data.error}`);
    }

    return data.url;
  }

  /**
   * Handle Socket Mode message
   */
  private async handleSocketMessage(payload: {
    type: string;
    envelope_id?: string;
    payload?: SlackEventCallback | SlackInteractionPayload | SlackSlashCommand;
    retry_attempt?: number;
    retry_reason?: string;
  }): Promise<void> {
    // Acknowledge the message
    if (payload.envelope_id) {
      this.ws?.send(JSON.stringify({ envelope_id: payload.envelope_id }));
    }

    switch (payload.type) {
      case 'events_api':
        if (payload.payload && 'event' in payload.payload) {
          await this.handleEvent(payload.payload.event);
        }
        break;

      case 'interactive':
        if (payload.payload && 'type' in payload.payload) {
          await this.handleInteraction(payload.payload as SlackInteractionPayload);
        }
        break;

      case 'slash_commands':
        if (payload.payload) {
          await this.handleSlashCommand(payload.payload as SlackSlashCommand);
        }
        break;

      case 'hello':
        // Connection established
        break;

      case 'disconnect':
        this.handleClose();
        break;
    }
  }

  /**
   * Handle event
   */
  private async handleEvent(event: SlackEvent): Promise<void> {
    // Ignore bot messages
    if (event.bot_id || event.app_id) return;

    // Check if user is allowed
    if (event.user && !this.isUserAllowed(event.user)) return;

    // Check if channel is allowed
    if (event.channel && !this.isChannelAllowed(event.channel)) return;

    switch (event.type) {
      case 'message':
        if (!event.subtype) {
          await this.handleMessage(event);
        } else if (event.subtype === 'message_changed') {
          // Could emit 'message-edited' event
        }
        break;

      case 'app_mention':
        await this.handleMessage(event);
        break;

      case 'reaction_added':
        // Could emit reaction event
        break;
    }
  }

  /**
   * Handle message event
   */
  private async handleMessage(event: SlackEvent): Promise<void> {
    if (!event.text && !event.files?.length) return;

    const message = await this.convertEvent(event);
    const parsed = this.parseCommand(message);

    this.emit('message', parsed);

    if (parsed.isCommand) {
      this.emit('command', parsed);
    }
  }

  /**
   * Handle interaction (button click, select, etc.)
   */
  private async handleInteraction(payload: SlackInteractionPayload): Promise<void> {
    if (payload.type === 'block_actions' && payload.actions?.length) {
      const action = payload.actions[0];

      const message: InboundMessage = {
        id: `interaction-${Date.now()}`,
        channel: {
          id: payload.channel?.id ?? 'unknown',
          type: 'slack',
          name: payload.channel?.name,
        },
        sender: {
          id: payload.user.id,
          username: payload.user.username,
          displayName: payload.user.name,
        },
        content: action.value ?? action.selected_option?.value ?? action.action_id,
        contentType: 'command',
        timestamp: new Date(),
        isCommand: true,
        commandName: 'action',
        commandArgs: [action.action_id, action.value ?? ''],
        raw: payload,
      };

      this.emit('command', message);
    }
  }

  /**
   * Handle slash command
   */
  private async handleSlashCommand(command: SlackSlashCommand): Promise<void> {
    const message: InboundMessage = {
      id: `command-${Date.now()}`,
      channel: {
        id: command.channel_id,
        type: 'slack',
        name: command.channel_name,
      },
      sender: {
        id: command.user_id,
        username: command.user_name,
      },
      content: `${command.command} ${command.text}`.trim(),
      contentType: 'command',
      timestamp: new Date(),
      isCommand: true,
      commandName: command.command.replace(/^\//, ''),
      commandArgs: command.text.split(/\s+/).filter(Boolean),
      raw: command,
    };

    this.emit('command', message);
  }

  /**
   * Handle webhook event (for HTTP mode)
   */
  async handleWebhook(
    body: SlackEventCallback | { type: 'url_verification'; challenge: string },
    signature?: string,
    timestamp?: string
  ): Promise<string | void> {
    // URL verification challenge
    if (body.type === 'url_verification') {
      return (body as { challenge: string }).challenge;
    }

    // Verify signature if signing secret is configured
    if (this.slackConfig.signingSecret && signature && timestamp) {
      if (!this.verifySignature(JSON.stringify(body), signature, timestamp)) {
        throw new Error('Invalid request signature');
      }
    }

    if (body.type === 'event_callback') {
      await this.handleEvent(body.event);
    }
  }

  /**
   * Verify request signature
   */
  private verifySignature(body: string, signature: string, timestamp: string): boolean {
    const sigBasestring = `v0:${timestamp}:${body}`;
    const mySignature =
      'v0=' +
      crypto
        .createHmac('sha256', this.slackConfig.signingSecret!)
        .update(sigBasestring)
        .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(mySignature),
      Buffer.from(signature)
    );
  }

  /**
   * Handle connection close
   */
  private handleClose(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    this.status.connected = false;

    if (!this.reconnecting && this.slackConfig.socketMode) {
      this.reconnect();
    } else {
      this.emit('disconnected', 'slack');
    }
  }

  /**
   * Reconnect to Socket Mode
   */
  private async reconnect(): Promise<void> {
    if (this.reconnecting) return;
    this.reconnecting = true;

    try {
      if (this.ws) {
        this.ws.removeAllListeners();
        if (this.ws.readyState === WebSocket.OPEN) {
          this.ws.close();
        }
        this.ws = null;
      }

      await new Promise((r) => setTimeout(r, 5000));
      await this.connect();
    } finally {
      this.reconnecting = false;
    }
  }

  /**
   * Disconnect from Slack
   */
  async disconnect(): Promise<void> {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.status.connected = false;
    this.emit('disconnected', 'slack');
  }

  /**
   * Send a message
   */
  async send(message: OutboundMessage): Promise<DeliveryResult> {
    try {
      const params: Record<string, unknown> = {
        channel: message.channelId,
        text: message.content,
        unfurl_links: !message.disablePreview,
        unfurl_media: !message.disablePreview,
      };

      // Add thread reference
      if (message.threadId) {
        params.thread_ts = message.threadId;
      }

      // Add reply reference (reply in thread)
      if (message.replyTo) {
        params.thread_ts = message.replyTo;
      }

      // Build blocks for rich content
      const blocks: SlackBlock[] = [];

      // Add buttons as action block
      if (message.buttons && message.buttons.length > 0) {
        blocks.push(this.buildActionsBlock(message.buttons));
      }

      // Add image attachments
      if (message.attachments) {
        for (const attachment of message.attachments) {
          if (attachment.type === 'image' && attachment.url) {
            blocks.push({
              type: 'image',
              image_url: attachment.url,
              alt_text: attachment.caption || 'Image',
            });
          }
        }
      }

      if (blocks.length > 0) {
        params.blocks = blocks;
      }

      const result = await this.apiRequest<{
        ok: boolean;
        ts: string;
        channel: string;
      }>('chat.postMessage', params);

      return {
        success: true,
        messageId: result.ts,
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
   * Convert Slack event to InboundMessage
   */
  private async convertEvent(event: SlackEvent): Promise<InboundMessage> {
    const channel = await this.getChannelInfo(event.channel!);
    const user = await this.getUserInfo(event.user!);
    const attachments = this.extractAttachments(event.files);

    return {
      id: event.ts ?? String(Date.now()),
      channel: {
        id: event.channel!,
        type: 'slack',
        name: channel?.name,
        isDM: channel?.is_im,
        isGroup: channel?.is_group || channel?.is_mpim,
      },
      sender: {
        id: event.user!,
        username: user?.name ?? user?.profile?.display_name,
        displayName:
          user?.profile?.real_name ??
          user?.profile?.display_name ??
          user?.name,
        avatarUrl: user?.profile?.image_72,
        isBot: user?.is_bot,
        isAdmin: user?.is_admin || user?.is_owner,
      },
      content: event.text ?? '',
      contentType: this.determineContentType(event),
      attachments: attachments.length > 0 ? attachments : undefined,
      threadId: event.thread_ts,
      timestamp: event.ts
        ? new Date(parseFloat(event.ts) * 1000)
        : new Date(),
      raw: event,
    };
  }

  /**
   * Get channel info (cached)
   */
  private async getChannelInfo(channelId: string): Promise<SlackConversation | null> {
    if (this.channelCache.has(channelId)) {
      return this.channelCache.get(channelId)!;
    }

    try {
      const result = await this.apiRequest<{
        ok: boolean;
        channel: SlackConversation;
      }>('conversations.info', { channel: channelId });

      this.channelCache.set(channelId, result.channel);
      return result.channel;
    } catch {
      return null;
    }
  }

  /**
   * Get user info (cached)
   */
  private async getUserInfo(userId: string): Promise<SlackUser | null> {
    if (this.userCache.has(userId)) {
      return this.userCache.get(userId)!;
    }

    try {
      const result = await this.apiRequest<{
        ok: boolean;
        user: SlackUser;
      }>('users.info', { user: userId });

      this.userCache.set(userId, result.user);
      return result.user;
    } catch {
      return null;
    }
  }

  /**
   * Extract attachments from files
   */
  private extractAttachments(files?: SlackFile[]): MessageAttachment[] {
    if (!files) return [];

    return files.map((file) => ({
      type: this.getFileType(file.mimetype),
      url: file.url_private,
      fileName: file.name,
      mimeType: file.mimetype,
      size: file.size,
      width: file.original_w,
      height: file.original_h,
    }));
  }

  /**
   * Get file type from mimetype
   */
  private getFileType(mimetype?: string): ContentType {
    if (!mimetype) return 'file';
    if (mimetype.startsWith('image/')) return 'image';
    if (mimetype.startsWith('audio/')) return 'audio';
    if (mimetype.startsWith('video/')) return 'video';
    return 'file';
  }

  /**
   * Determine content type from event
   */
  private determineContentType(event: SlackEvent): ContentType {
    if (event.files?.length) {
      return this.getFileType(event.files[0].mimetype);
    }
    if (event.text?.startsWith('/')) return 'command';
    return 'text';
  }

  /**
   * Build actions block from buttons
   */
  private buildActionsBlock(buttons: MessageButton[]): SlackActionsBlock {
    const elements: SlackButtonElement[] = buttons.slice(0, 5).map((btn, i) => {
      if (btn.type === 'url' && btn.url) {
        return {
          type: 'button',
          action_id: `link_${i}`,
          text: { type: 'plain_text', text: btn.text },
          url: btn.url,
        };
      }
      return {
        type: 'button',
        action_id: btn.data ?? `btn_${i}`,
        text: { type: 'plain_text', text: btn.text },
        value: btn.data,
      };
    });

    return {
      type: 'actions',
      elements,
    };
  }

  /**
   * Update a message
   */
  async updateMessage(
    channelId: string,
    messageTs: string,
    text: string,
    blocks?: SlackBlock[]
  ): Promise<void> {
    await this.apiRequest('chat.update', {
      channel: channelId,
      ts: messageTs,
      text,
      blocks,
    });
  }

  /**
   * Delete a message
   */
  async deleteMessage(channelId: string, messageTs: string): Promise<void> {
    await this.apiRequest('chat.delete', {
      channel: channelId,
      ts: messageTs,
    });
  }

  /**
   * Add reaction to message
   */
  async addReaction(
    channelId: string,
    messageTs: string,
    emoji: string
  ): Promise<void> {
    await this.apiRequest('reactions.add', {
      channel: channelId,
      timestamp: messageTs,
      name: emoji.replace(/:/g, ''),
    });
  }

  /**
   * Upload file
   */
  async uploadFile(
    channelId: string,
    file: Buffer,
    filename: string,
    options?: { title?: string; comment?: string; threadTs?: string }
  ): Promise<SlackFile> {
    const formData = new FormData();
    formData.append('file', new Blob([new Uint8Array(file)]), filename);
    formData.append('channels', channelId);

    if (options?.title) formData.append('title', options.title);
    if (options?.comment) formData.append('initial_comment', options.comment);
    if (options?.threadTs) formData.append('thread_ts', options.threadTs);

    const response = await fetch(`${SLACK_API_BASE}/files.upload`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.slackConfig.token}`,
      },
      body: formData,
    });

    const result = (await response.json()) as { ok: boolean; file: SlackFile; error?: string };

    if (!result.ok) {
      throw new Error(`Failed to upload file: ${result.error}`);
    }

    return result.file;
  }

  /**
   * Send ephemeral message (only visible to one user)
   */
  async sendEphemeral(
    channelId: string,
    userId: string,
    text: string,
    blocks?: SlackBlock[]
  ): Promise<void> {
    await this.apiRequest('chat.postEphemeral', {
      channel: channelId,
      user: userId,
      text,
      blocks,
    });
  }

  /**
   * Open a modal
   */
  async openModal(
    triggerId: string,
    view: {
      title: string;
      blocks: SlackBlock[];
      submit?: string;
      close?: string;
      callbackId?: string;
      privateMetadata?: string;
    }
  ): Promise<void> {
    await this.apiRequest('views.open', {
      trigger_id: triggerId,
      view: {
        type: 'modal',
        title: { type: 'plain_text', text: view.title },
        submit: view.submit ? { type: 'plain_text', text: view.submit } : undefined,
        close: view.close ? { type: 'plain_text', text: view.close } : undefined,
        blocks: view.blocks,
        callback_id: view.callbackId,
        private_metadata: view.privateMetadata,
      },
    });
  }
}

export default SlackChannel;
