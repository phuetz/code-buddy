export * from './core.js';

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

// LINE
export { LINEAdapter, LINEChannel } from './line/index.js';
export type { LINEConfig, LINEChannelConfig } from './line/index.js';

// Nostr
export { NostrAdapter, NostrChannel } from './nostr/index.js';
export type { NostrConfig, NostrChannelConfig } from './nostr/index.js';

// Zalo
export { ZaloAdapter, ZaloChannel } from './zalo/index.js';
export type { ZaloConfig, ZaloChannelConfig } from './zalo/index.js';

// Mattermost
export { MattermostAdapter, MattermostChannel } from './mattermost/index.js';
export type { MattermostConfig, MattermostChannelConfig } from './mattermost/index.js';

// Nextcloud Talk
export { NextcloudTalkAdapter, NextcloudTalkChannel } from './nextcloud-talk/index.js';
export type { NextcloudTalkConfig, NextcloudTalkChannelConfig } from './nextcloud-talk/index.js';

// Twilio Voice
export { TwilioVoiceAdapter, TwilioVoiceChannel } from './twilio-voice/index.js';
export type { TwilioVoiceConfig, TwilioVoiceChannelConfig } from './twilio-voice/index.js';

// iMessage (BlueBubbles)
export { IMessageAdapter, IMessageChannel } from './imessage/index.js';
export type { IMessageConfig, IMessageChannelConfig } from './imessage/index.js';

// IRC
export { IRCAdapter, IRCChannel } from './irc/index.js';
export type { IRCConfig, IRCChannelConfig } from './irc/index.js';

// Feishu (Lark)
export { FeishuAdapter, FeishuChannel } from './feishu/index.js';
export type { FeishuConfig, FeishuChannelConfig, FeishuMessage } from './feishu/index.js';

// Synology Chat
export { SynologyChatAdapter, SynologyChatChannel } from './synology-chat/index.js';
export type { SynologyChatConfig, SynologyChatChannelConfig, SynologyChatMessage } from './synology-chat/index.js';

// Niche Channels (Twitch, Tlon, Gmail)
export { TwitchAdapter, TlonAdapter, GmailWebhookAdapter, DocsSearchTool } from './niche-channels.js';
