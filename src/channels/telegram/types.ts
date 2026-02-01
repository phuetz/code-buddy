/**
 * Telegram Channel Types
 *
 * Type definitions for Telegram bot integration.
 */

import type { ChannelConfig } from '../index.js';

/**
 * Telegram-specific configuration
 */
export interface TelegramConfig extends ChannelConfig {
  type: 'telegram';
  /** Bot token from @BotFather */
  token: string;
  /** Webhook URL (optional, uses polling if not set) */
  webhookUrl?: string;
  /** Webhook secret for validation */
  webhookSecret?: string;
  /** Polling timeout in seconds */
  pollingTimeout?: number;
  /** Bot username (without @) */
  botUsername?: string;
  /** Admin user IDs with elevated permissions */
  adminUsers?: string[];
  /** Commands to register with BotFather */
  commands?: TelegramCommand[];
  /** Parse mode for outgoing messages */
  defaultParseMode?: 'Markdown' | 'MarkdownV2' | 'HTML';
  /** Disable notifications by default */
  disableNotification?: boolean;
}

/**
 * Telegram command definition
 */
export interface TelegramCommand {
  command: string;
  description: string;
}

/**
 * Telegram update types
 */
export type TelegramUpdateType =
  | 'message'
  | 'edited_message'
  | 'channel_post'
  | 'edited_channel_post'
  | 'inline_query'
  | 'chosen_inline_result'
  | 'callback_query'
  | 'shipping_query'
  | 'pre_checkout_query'
  | 'poll'
  | 'poll_answer'
  | 'my_chat_member'
  | 'chat_member'
  | 'chat_join_request';

/**
 * Telegram chat types
 */
export type TelegramChatType = 'private' | 'group' | 'supergroup' | 'channel';

/**
 * Telegram user
 */
export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
}

/**
 * Telegram chat
 */
export interface TelegramChat {
  id: number;
  type: TelegramChatType;
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
  is_forum?: boolean;
  description?: string;
}

/**
 * Telegram message entity (formatting, mentions, etc.)
 */
export interface TelegramMessageEntity {
  type:
    | 'mention'
    | 'hashtag'
    | 'cashtag'
    | 'bot_command'
    | 'url'
    | 'email'
    | 'phone_number'
    | 'bold'
    | 'italic'
    | 'underline'
    | 'strikethrough'
    | 'spoiler'
    | 'code'
    | 'pre'
    | 'text_link'
    | 'text_mention'
    | 'custom_emoji';
  offset: number;
  length: number;
  url?: string;
  user?: TelegramUser;
  language?: string;
  custom_emoji_id?: string;
}

/**
 * Telegram message
 */
export interface TelegramMessage {
  message_id: number;
  message_thread_id?: number;
  from?: TelegramUser;
  sender_chat?: TelegramChat;
  date: number;
  chat: TelegramChat;
  forward_origin?: unknown;
  is_topic_message?: boolean;
  reply_to_message?: TelegramMessage;
  text?: string;
  entities?: TelegramMessageEntity[];
  caption?: string;
  caption_entities?: TelegramMessageEntity[];
  photo?: TelegramPhotoSize[];
  audio?: TelegramAudio;
  document?: TelegramDocument;
  video?: TelegramVideo;
  voice?: TelegramVoice;
  sticker?: TelegramSticker;
  location?: TelegramLocation;
  contact?: TelegramContact;
}

/**
 * Telegram photo size
 */
export interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

/**
 * Telegram audio
 */
export interface TelegramAudio {
  file_id: string;
  file_unique_id: string;
  duration: number;
  performer?: string;
  title?: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

/**
 * Telegram document
 */
export interface TelegramDocument {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

/**
 * Telegram video
 */
export interface TelegramVideo {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  duration: number;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

/**
 * Telegram voice message
 */
export interface TelegramVoice {
  file_id: string;
  file_unique_id: string;
  duration: number;
  mime_type?: string;
  file_size?: number;
}

/**
 * Telegram sticker
 */
export interface TelegramSticker {
  file_id: string;
  file_unique_id: string;
  type: 'regular' | 'mask' | 'custom_emoji';
  width: number;
  height: number;
  is_animated: boolean;
  is_video: boolean;
  emoji?: string;
  set_name?: string;
}

/**
 * Telegram location
 */
export interface TelegramLocation {
  longitude: number;
  latitude: number;
  horizontal_accuracy?: number;
  live_period?: number;
  heading?: number;
  proximity_alert_radius?: number;
}

/**
 * Telegram contact
 */
export interface TelegramContact {
  phone_number: string;
  first_name: string;
  last_name?: string;
  user_id?: number;
  vcard?: string;
}

/**
 * Telegram callback query (button press)
 */
export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  inline_message_id?: string;
  chat_instance: string;
  data?: string;
  game_short_name?: string;
}

/**
 * Telegram inline keyboard button
 */
export interface TelegramInlineKeyboardButton {
  text: string;
  url?: string;
  callback_data?: string;
  switch_inline_query?: string;
  switch_inline_query_current_chat?: string;
}

/**
 * Telegram inline keyboard markup
 */
export interface TelegramInlineKeyboardMarkup {
  inline_keyboard: TelegramInlineKeyboardButton[][];
}

/**
 * Telegram reply keyboard button
 */
export interface TelegramKeyboardButton {
  text: string;
  request_user?: { request_id: number; user_is_bot?: boolean };
  request_chat?: { request_id: number; chat_is_channel?: boolean };
  request_contact?: boolean;
  request_location?: boolean;
  request_poll?: { type?: 'quiz' | 'regular' };
}

/**
 * Telegram reply keyboard markup
 */
export interface TelegramReplyKeyboardMarkup {
  keyboard: TelegramKeyboardButton[][];
  is_persistent?: boolean;
  resize_keyboard?: boolean;
  one_time_keyboard?: boolean;
  input_field_placeholder?: string;
  selective?: boolean;
}

/**
 * Telegram update object
 */
export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
  edited_channel_post?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

/**
 * Telegram API response
 */
export interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}
