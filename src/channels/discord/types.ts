/**
 * Discord Channel Types
 *
 * Type definitions for Discord bot integration.
 */

import type { ChannelConfig } from '../index.js';

/**
 * Discord-specific configuration
 */
export interface DiscordConfig extends ChannelConfig {
  type: 'discord';
  /** Bot token */
  token: string;
  /** Application ID for slash commands */
  applicationId?: string;
  /** Guild IDs for guild-specific slash commands (faster registration) */
  guildIds?: string[];
  /** Intents to enable */
  intents?: DiscordIntent[];
  /** Admin user IDs */
  adminUsers?: string[];
  /** Slash commands to register */
  commands?: DiscordSlashCommand[];
  /** Presence settings */
  presence?: DiscordPresence;
  /** Whether to respond to mentions only */
  mentionOnly?: boolean;
}

/**
 * Discord gateway intents
 */
export type DiscordIntent =
  | 'Guilds'
  | 'GuildMembers'
  | 'GuildModeration'
  | 'GuildEmojisAndStickers'
  | 'GuildIntegrations'
  | 'GuildWebhooks'
  | 'GuildInvites'
  | 'GuildVoiceStates'
  | 'GuildPresences'
  | 'GuildMessages'
  | 'GuildMessageReactions'
  | 'GuildMessageTyping'
  | 'DirectMessages'
  | 'DirectMessageReactions'
  | 'DirectMessageTyping'
  | 'MessageContent'
  | 'GuildScheduledEvents'
  | 'AutoModerationConfiguration'
  | 'AutoModerationExecution';

/**
 * Discord slash command definition
 */
export interface DiscordSlashCommand {
  name: string;
  description: string;
  options?: DiscordCommandOption[];
}

/**
 * Discord command option
 */
export interface DiscordCommandOption {
  name: string;
  description: string;
  type: DiscordOptionType;
  required?: boolean;
  choices?: Array<{ name: string; value: string | number }>;
  options?: DiscordCommandOption[]; // For subcommands
}

/**
 * Discord command option types
 */
export type DiscordOptionType =
  | 'SUB_COMMAND'
  | 'SUB_COMMAND_GROUP'
  | 'STRING'
  | 'INTEGER'
  | 'BOOLEAN'
  | 'USER'
  | 'CHANNEL'
  | 'ROLE'
  | 'MENTIONABLE'
  | 'NUMBER'
  | 'ATTACHMENT';

/**
 * Discord presence settings
 */
export interface DiscordPresence {
  status?: 'online' | 'idle' | 'dnd' | 'invisible';
  activity?: {
    name: string;
    type: 'Playing' | 'Streaming' | 'Listening' | 'Watching' | 'Competing';
    url?: string;
  };
}

/**
 * Discord channel types
 */
export type DiscordChannelType =
  | 'GUILD_TEXT'
  | 'DM'
  | 'GUILD_VOICE'
  | 'GROUP_DM'
  | 'GUILD_CATEGORY'
  | 'GUILD_ANNOUNCEMENT'
  | 'ANNOUNCEMENT_THREAD'
  | 'PUBLIC_THREAD'
  | 'PRIVATE_THREAD'
  | 'GUILD_STAGE_VOICE'
  | 'GUILD_DIRECTORY'
  | 'GUILD_FORUM';

/**
 * Discord user object
 */
export interface DiscordUser {
  id: string;
  username: string;
  discriminator: string;
  global_name?: string;
  avatar?: string;
  bot?: boolean;
  system?: boolean;
}

/**
 * Discord guild member
 */
export interface DiscordGuildMember {
  user?: DiscordUser;
  nick?: string;
  avatar?: string;
  roles: string[];
  joined_at: string;
  premium_since?: string;
  deaf: boolean;
  mute: boolean;
  pending?: boolean;
  permissions?: string;
}

/**
 * Discord guild object
 */
export interface DiscordGuild {
  id: string;
  name: string;
  icon?: string;
  description?: string;
  owner_id: string;
  member_count?: number;
}

/**
 * Discord channel object
 */
export interface DiscordChannelObject {
  id: string;
  type: number;
  guild_id?: string;
  name?: string;
  topic?: string;
  nsfw?: boolean;
  last_message_id?: string;
  parent_id?: string;
  owner_id?: string;
}

/**
 * Discord message object
 */
export interface DiscordMessage {
  id: string;
  channel_id: string;
  guild_id?: string;
  author: DiscordUser;
  member?: DiscordGuildMember;
  content: string;
  timestamp: string;
  edited_timestamp?: string;
  tts: boolean;
  mention_everyone: boolean;
  mentions: DiscordUser[];
  mention_roles: string[];
  attachments: DiscordAttachment[];
  embeds: DiscordEmbed[];
  reactions?: DiscordReaction[];
  nonce?: string | number;
  pinned: boolean;
  webhook_id?: string;
  type: number;
  referenced_message?: DiscordMessage;
  thread?: DiscordChannelObject;
}

/**
 * Discord attachment
 */
export interface DiscordAttachment {
  id: string;
  filename: string;
  description?: string;
  content_type?: string;
  size: number;
  url: string;
  proxy_url: string;
  height?: number;
  width?: number;
  ephemeral?: boolean;
}

/**
 * Discord embed
 */
export interface DiscordEmbed {
  title?: string;
  type?: 'rich' | 'image' | 'video' | 'gifv' | 'article' | 'link';
  description?: string;
  url?: string;
  timestamp?: string;
  color?: number;
  footer?: {
    text: string;
    icon_url?: string;
  };
  image?: {
    url: string;
    height?: number;
    width?: number;
  };
  thumbnail?: {
    url: string;
    height?: number;
    width?: number;
  };
  video?: {
    url?: string;
    height?: number;
    width?: number;
  };
  provider?: {
    name?: string;
    url?: string;
  };
  author?: {
    name: string;
    url?: string;
    icon_url?: string;
  };
  fields?: Array<{
    name: string;
    value: string;
    inline?: boolean;
  }>;
}

/**
 * Discord reaction
 */
export interface DiscordReaction {
  count: number;
  me: boolean;
  emoji: {
    id?: string;
    name: string;
    animated?: boolean;
  };
}

/**
 * Discord interaction (slash command)
 */
export interface DiscordInteraction {
  id: string;
  application_id: string;
  type: 1 | 2 | 3 | 4 | 5; // PING, APPLICATION_COMMAND, MESSAGE_COMPONENT, etc.
  data?: DiscordInteractionData;
  guild_id?: string;
  channel_id?: string;
  member?: DiscordGuildMember;
  user?: DiscordUser;
  token: string;
  version: number;
  message?: DiscordMessage;
}

/**
 * Discord interaction data
 */
export interface DiscordInteractionData {
  id: string;
  name: string;
  type: number;
  resolved?: unknown;
  options?: DiscordInteractionOption[];
  custom_id?: string;
  component_type?: number;
  values?: string[];
  target_id?: string;
}

/**
 * Discord interaction option
 */
export interface DiscordInteractionOption {
  name: string;
  type: number;
  value?: string | number | boolean;
  options?: DiscordInteractionOption[];
  focused?: boolean;
}

/**
 * Discord button component
 */
export interface DiscordButton {
  type: 2;
  style: 1 | 2 | 3 | 4 | 5; // Primary, Secondary, Success, Danger, Link
  label?: string;
  emoji?: { id?: string; name: string; animated?: boolean };
  custom_id?: string;
  url?: string;
  disabled?: boolean;
}

/**
 * Discord select menu
 */
export interface DiscordSelectMenu {
  type: 3;
  custom_id: string;
  options: Array<{
    label: string;
    value: string;
    description?: string;
    emoji?: { id?: string; name: string };
    default?: boolean;
  }>;
  placeholder?: string;
  min_values?: number;
  max_values?: number;
  disabled?: boolean;
}

/**
 * Discord action row (container for buttons/selects)
 */
export interface DiscordActionRow {
  type: 1;
  components: Array<DiscordButton | DiscordSelectMenu>;
}
