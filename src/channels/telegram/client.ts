/**
 * Telegram Channel Client
 *
 * Telegram bot implementation using the Telegram Bot API.
 * Supports both polling and webhook modes.
 */

import { EventEmitter } from 'events';
import type {
  TelegramConfig,
  TelegramUpdate,
  TelegramMessage,
  TelegramUser,
  TelegramChat,
  TelegramCallbackQuery,
  TelegramApiResponse,
  TelegramInlineKeyboardMarkup,
} from './types.js';
import type {
  ChannelUser,
  ChannelInfo,
  InboundMessage,
  OutboundMessage,
  DeliveryResult,
  ChannelStatus,
  MessageAttachment,
  ContentType,
  MessageButton,
} from '../index.js';
import { BaseChannel } from '../index.js';

const TELEGRAM_API_BASE = 'https://api.telegram.org';

/**
 * Telegram channel implementation
 */
export class TelegramChannel extends BaseChannel {
  private pollingActive = false;
  private pollingTimeout: NodeJS.Timeout | null = null;
  private lastUpdateId = 0;
  private botInfo: TelegramUser | null = null;

  constructor(config: TelegramConfig) {
    super('telegram', config);
    if (!config.token) {
      throw new Error('Telegram bot token is required');
    }
  }

  private get telegramConfig(): TelegramConfig {
    return this.config as TelegramConfig;
  }

  private get apiUrl(): string {
    return `${TELEGRAM_API_BASE}/bot${this.telegramConfig.token}`;
  }

  /**
   * Make API request to Telegram
   */
  private async apiRequest<T>(
    method: string,
    params?: Record<string, unknown>
  ): Promise<T> {
    const url = `${this.apiUrl}/${method}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: params ? JSON.stringify(params) : undefined,
    });

    const data = (await response.json()) as TelegramApiResponse<T>;

    if (!data.ok) {
      throw new Error(
        `Telegram API error: ${data.description || 'Unknown error'} (${data.error_code})`
      );
    }

    return data.result as T;
  }

  /**
   * Connect to Telegram
   */
  async connect(): Promise<void> {
    try {
      // Get bot info
      this.botInfo = await this.apiRequest<TelegramUser>('getMe');

      this.status.connected = true;
      this.status.authenticated = true;
      this.status.info = {
        botId: this.botInfo.id,
        botUsername: this.botInfo.username,
        botName: this.botInfo.first_name,
      };

      // Register commands if provided
      if (this.telegramConfig.commands && this.telegramConfig.commands.length > 0) {
        await this.setCommands();
      }

      // Start polling or set webhook
      if (this.telegramConfig.webhookUrl) {
        await this.setWebhook();
      } else {
        await this.startPolling();
      }

      this.emit('connected', 'telegram');
    } catch (error) {
      this.status.error = error instanceof Error ? error.message : String(error);
      this.emit('error', 'telegram', error);
      throw error;
    }
  }

  /**
   * Disconnect from Telegram
   */
  async disconnect(): Promise<void> {
    this.pollingActive = false;
    if (this.pollingTimeout) {
      clearTimeout(this.pollingTimeout);
      this.pollingTimeout = null;
    }

    // Delete webhook if set
    if (this.telegramConfig.webhookUrl) {
      try {
        await this.apiRequest('deleteWebhook');
      } catch {
        // Ignore errors during disconnect
      }
    }

    this.status.connected = false;
    this.emit('disconnected', 'telegram');
  }

  /**
   * Send a message
   */
  async send(message: OutboundMessage): Promise<DeliveryResult> {
    try {
      const params: Record<string, unknown> = {
        chat_id: message.channelId,
        text: message.content,
        parse_mode: this.getParseMode(message.parseMode),
        disable_notification: message.silent ?? this.telegramConfig.disableNotification,
        disable_web_page_preview: message.disablePreview,
      };

      // Add reply
      if (message.replyTo) {
        params.reply_to_message_id = parseInt(message.replyTo, 10);
      }

      // Add thread
      if (message.threadId) {
        params.message_thread_id = parseInt(message.threadId, 10);
      }

      // Add buttons
      if (message.buttons && message.buttons.length > 0) {
        params.reply_markup = this.buildKeyboard(message.buttons);
      }

      // Handle attachments
      if (message.attachments && message.attachments.length > 0) {
        return this.sendWithAttachments(message);
      }

      const result = await this.apiRequest<TelegramMessage>('sendMessage', params);

      return {
        success: true,
        messageId: String(result.message_id),
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
   * Send message with attachments
   */
  private async sendWithAttachments(message: OutboundMessage): Promise<DeliveryResult> {
    const attachment = message.attachments![0];
    const params: Record<string, unknown> = {
      chat_id: message.channelId,
      caption: message.content,
      parse_mode: this.getParseMode(message.parseMode),
    };

    let method: string;
    let fileParam: string;

    switch (attachment.type) {
      case 'image':
        method = 'sendPhoto';
        fileParam = 'photo';
        break;
      case 'audio':
        method = 'sendAudio';
        fileParam = 'audio';
        break;
      case 'video':
        method = 'sendVideo';
        fileParam = 'video';
        break;
      case 'voice':
        method = 'sendVoice';
        fileParam = 'voice';
        break;
      case 'file':
      default:
        method = 'sendDocument';
        fileParam = 'document';
        break;
    }

    // Use URL or file_id
    if (attachment.url) {
      params[fileParam] = attachment.url;
    } else if (attachment.data) {
      // Base64 data - would need multipart form upload
      // For now, just return an error
      return {
        success: false,
        error: 'Base64 attachment upload not yet supported',
        timestamp: new Date(),
      };
    }

    try {
      const result = await this.apiRequest<TelegramMessage>(method, params);
      return {
        success: true,
        messageId: String(result.message_id),
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
   * Set webhook
   */
  private async setWebhook(): Promise<void> {
    const params: Record<string, unknown> = {
      url: this.telegramConfig.webhookUrl,
      allowed_updates: ['message', 'edited_message', 'callback_query'],
    };

    if (this.telegramConfig.webhookSecret) {
      params.secret_token = this.telegramConfig.webhookSecret;
    }

    await this.apiRequest('setWebhook', params);
  }

  /**
   * Set bot commands
   */
  private async setCommands(): Promise<void> {
    const commands = this.telegramConfig.commands!.map((cmd) => ({
      command: cmd.command.replace(/^\//, ''),
      description: cmd.description,
    }));

    await this.apiRequest('setMyCommands', { commands });
  }

  /**
   * Start polling for updates
   */
  private async startPolling(): Promise<void> {
    this.pollingActive = true;

    // Delete any existing webhook
    await this.apiRequest('deleteWebhook');

    this.poll();
  }

  /**
   * Poll for updates
   */
  private async poll(): Promise<void> {
    if (!this.pollingActive) return;

    try {
      const updates = await this.apiRequest<TelegramUpdate[]>('getUpdates', {
        offset: this.lastUpdateId + 1,
        timeout: this.telegramConfig.pollingTimeout ?? 30,
        allowed_updates: ['message', 'edited_message', 'callback_query'],
      });

      for (const update of updates) {
        this.lastUpdateId = update.update_id;
        await this.handleUpdate(update);
      }
    } catch (error) {
      this.emit('error', 'telegram', error);
      // Backoff on error
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    // Schedule next poll
    if (this.pollingActive) {
      this.pollingTimeout = setTimeout(() => this.poll(), 100);
    }
  }

  /**
   * Handle webhook update
   */
  async handleWebhook(update: TelegramUpdate, secret?: string): Promise<boolean> {
    // Validate secret if configured
    if (this.telegramConfig.webhookSecret && secret !== this.telegramConfig.webhookSecret) {
      return false;
    }

    await this.handleUpdate(update);
    return true;
  }

  /**
   * Handle an update
   */
  private async handleUpdate(update: TelegramUpdate): Promise<void> {
    if (update.message) {
      await this.handleMessage(update.message);
    } else if (update.edited_message) {
      // Could emit 'message-edited' event
      await this.handleMessage(update.edited_message);
    } else if (update.callback_query) {
      await this.handleCallbackQuery(update.callback_query);
    }
  }

  /**
   * Handle incoming message
   */
  private async handleMessage(msg: TelegramMessage): Promise<void> {
    // Check if user is allowed
    const userId = msg.from?.id?.toString() ?? '';
    if (!this.isUserAllowed(userId)) {
      return;
    }

    // Check if channel is allowed
    const chatId = msg.chat.id.toString();
    if (!this.isChannelAllowed(chatId)) {
      return;
    }

    const message = this.convertMessage(msg);
    const parsed = this.parseCommand(message);

    this.emit('message', parsed);

    if (parsed.isCommand) {
      this.emit('command', parsed);
    }
  }

  /**
   * Handle callback query (button press)
   */
  private async handleCallbackQuery(query: TelegramCallbackQuery): Promise<void> {
    // Answer the callback to remove loading state
    try {
      await this.apiRequest('answerCallbackQuery', {
        callback_query_id: query.id,
      });
    } catch {
      // Ignore errors
    }

    // Emit as a command-like message
    if (query.data && query.message) {
      const message: InboundMessage = {
        id: query.id,
        channel: this.convertChat(query.message.chat),
        sender: this.convertUser(query.from),
        content: query.data,
        contentType: 'command',
        timestamp: new Date(),
        isCommand: true,
        commandName: 'callback',
        commandArgs: [query.data],
        raw: query,
      };

      this.emit('command', message);
    }
  }

  /**
   * Convert Telegram message to InboundMessage
   */
  private convertMessage(msg: TelegramMessage): InboundMessage {
    const content = msg.text || msg.caption || '';
    const attachments = this.extractAttachments(msg);

    return {
      id: String(msg.message_id),
      channel: this.convertChat(msg.chat),
      sender: this.convertUser(msg.from),
      content,
      contentType: this.determineContentType(msg),
      attachments: attachments.length > 0 ? attachments : undefined,
      replyTo: msg.reply_to_message
        ? String(msg.reply_to_message.message_id)
        : undefined,
      timestamp: new Date(msg.date * 1000),
      threadId: msg.message_thread_id ? String(msg.message_thread_id) : undefined,
      raw: msg,
    };
  }

  /**
   * Convert Telegram chat to ChannelInfo
   */
  private convertChat(chat: TelegramChat): ChannelInfo {
    return {
      id: String(chat.id),
      type: 'telegram',
      name: chat.title || chat.username || chat.first_name,
      isDM: chat.type === 'private',
      isGroup: chat.type === 'group' || chat.type === 'supergroup',
      description: chat.description,
      raw: chat,
    };
  }

  /**
   * Convert Telegram user to ChannelUser
   */
  private convertUser(user?: TelegramUser): ChannelUser {
    if (!user) {
      return { id: 'unknown' };
    }

    const displayName = [user.first_name, user.last_name]
      .filter(Boolean)
      .join(' ');

    return {
      id: String(user.id),
      username: user.username,
      displayName: displayName || user.username || String(user.id),
      isBot: user.is_bot,
      raw: user,
    };
  }

  /**
   * Extract attachments from message
   */
  private extractAttachments(msg: TelegramMessage): MessageAttachment[] {
    const attachments: MessageAttachment[] = [];

    if (msg.photo && msg.photo.length > 0) {
      // Get largest photo
      const photo = msg.photo[msg.photo.length - 1];
      attachments.push({
        type: 'image',
        url: photo.file_id, // Will need to call getFile to get actual URL
        width: photo.width,
        height: photo.height,
        size: photo.file_size,
      });
    }

    if (msg.audio) {
      attachments.push({
        type: 'audio',
        url: msg.audio.file_id,
        duration: msg.audio.duration,
        fileName: msg.audio.file_name,
        mimeType: msg.audio.mime_type,
        size: msg.audio.file_size,
      });
    }

    if (msg.video) {
      attachments.push({
        type: 'video',
        url: msg.video.file_id,
        width: msg.video.width,
        height: msg.video.height,
        duration: msg.video.duration,
        fileName: msg.video.file_name,
        mimeType: msg.video.mime_type,
        size: msg.video.file_size,
      });
    }

    if (msg.voice) {
      attachments.push({
        type: 'voice',
        url: msg.voice.file_id,
        duration: msg.voice.duration,
        mimeType: msg.voice.mime_type,
        size: msg.voice.file_size,
      });
    }

    if (msg.document) {
      attachments.push({
        type: 'file',
        url: msg.document.file_id,
        fileName: msg.document.file_name,
        mimeType: msg.document.mime_type,
        size: msg.document.file_size,
      });
    }

    if (msg.sticker) {
      attachments.push({
        type: 'sticker',
        url: msg.sticker.file_id,
        width: msg.sticker.width,
        height: msg.sticker.height,
      });
    }

    if (msg.location) {
      attachments.push({
        type: 'location',
        data: JSON.stringify({
          latitude: msg.location.latitude,
          longitude: msg.location.longitude,
        }),
      });
    }

    if (msg.contact) {
      attachments.push({
        type: 'contact',
        data: JSON.stringify({
          phoneNumber: msg.contact.phone_number,
          firstName: msg.contact.first_name,
          lastName: msg.contact.last_name,
        }),
      });
    }

    return attachments;
  }

  /**
   * Determine content type from message
   */
  private determineContentType(msg: TelegramMessage): ContentType {
    if (msg.photo) return 'image';
    if (msg.audio) return 'audio';
    if (msg.video) return 'video';
    if (msg.voice) return 'voice';
    if (msg.document) return 'file';
    if (msg.sticker) return 'sticker';
    if (msg.location) return 'location';
    if (msg.contact) return 'contact';
    if (msg.text?.startsWith('/')) return 'command';
    return 'text';
  }

  /**
   * Get Telegram parse mode
   */
  private getParseMode(
    mode?: 'markdown' | 'html' | 'plain'
  ): 'Markdown' | 'MarkdownV2' | 'HTML' | undefined {
    if (mode === 'plain') return undefined;
    if (mode === 'html') return 'HTML';
    if (mode === 'markdown') return this.telegramConfig.defaultParseMode ?? 'Markdown';
    return this.telegramConfig.defaultParseMode;
  }

  /**
   * Build inline keyboard from buttons
   */
  private buildKeyboard(buttons: MessageButton[]): TelegramInlineKeyboardMarkup {
    const keyboard: TelegramInlineKeyboardMarkup = {
      inline_keyboard: [],
    };

    // Create a row for each button (could be customized for multi-column layouts)
    for (const button of buttons) {
      const row: Array<{ text: string; url?: string; callback_data?: string }> = [];

      if (button.type === 'url' && button.url) {
        row.push({ text: button.text, url: button.url });
      } else if (button.type === 'callback' && button.data) {
        row.push({ text: button.text, callback_data: button.data });
      }

      if (row.length > 0) {
        keyboard.inline_keyboard.push(row);
      }
    }

    return keyboard;
  }

  /**
   * Get file download URL
   */
  async getFileUrl(fileId: string): Promise<string> {
    const result = await this.apiRequest<{ file_path: string }>('getFile', {
      file_id: fileId,
    });
    return `${TELEGRAM_API_BASE}/file/bot${this.telegramConfig.token}/${result.file_path}`;
  }

  /**
   * Answer callback query
   */
  async answerCallback(
    callbackId: string,
    options?: { text?: string; showAlert?: boolean }
  ): Promise<void> {
    await this.apiRequest('answerCallbackQuery', {
      callback_query_id: callbackId,
      text: options?.text,
      show_alert: options?.showAlert,
    });
  }

  /**
   * Edit message text
   */
  async editMessage(
    chatId: string,
    messageId: string,
    text: string,
    options?: { parseMode?: 'markdown' | 'html' | 'plain'; buttons?: MessageButton[] }
  ): Promise<void> {
    const params: Record<string, unknown> = {
      chat_id: chatId,
      message_id: parseInt(messageId, 10),
      text,
      parse_mode: this.getParseMode(options?.parseMode),
    };

    if (options?.buttons) {
      params.reply_markup = this.buildKeyboard(options.buttons);
    }

    await this.apiRequest('editMessageText', params);
  }

  /**
   * Delete message
   */
  async deleteMessage(chatId: string, messageId: string): Promise<void> {
    await this.apiRequest('deleteMessage', {
      chat_id: chatId,
      message_id: parseInt(messageId, 10),
    });
  }

  /**
   * Send typing indicator
   */
  async sendTyping(chatId: string): Promise<void> {
    await this.apiRequest('sendChatAction', {
      chat_id: chatId,
      action: 'typing',
    });
  }
}

export default TelegramChannel;
