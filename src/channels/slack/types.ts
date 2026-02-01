/**
 * Slack Channel Types
 *
 * Type definitions for Slack bot integration.
 */

import type { ChannelConfig } from '../index.js';

/**
 * Slack-specific configuration
 */
export interface SlackConfig extends ChannelConfig {
  type: 'slack';
  /** Bot token (xoxb-...) */
  token: string;
  /** App token for Socket Mode (xapp-...) */
  appToken?: string;
  /** Signing secret for request verification */
  signingSecret?: string;
  /** Use Socket Mode instead of HTTP */
  socketMode?: boolean;
  /** Admin user IDs */
  adminUsers?: string[];
  /** Default channel to post to */
  defaultChannel?: string;
  /** Bot user ID (set automatically) */
  botUserId?: string;
}

/**
 * Slack user object
 */
export interface SlackUser {
  id: string;
  team_id?: string;
  name?: string;
  deleted?: boolean;
  color?: string;
  real_name?: string;
  tz?: string;
  tz_label?: string;
  tz_offset?: number;
  profile?: SlackUserProfile;
  is_admin?: boolean;
  is_owner?: boolean;
  is_primary_owner?: boolean;
  is_restricted?: boolean;
  is_ultra_restricted?: boolean;
  is_bot?: boolean;
  is_app_user?: boolean;
  updated?: number;
}

/**
 * Slack user profile
 */
export interface SlackUserProfile {
  avatar_hash?: string;
  status_text?: string;
  status_emoji?: string;
  status_expiration?: number;
  real_name?: string;
  display_name?: string;
  real_name_normalized?: string;
  display_name_normalized?: string;
  email?: string;
  image_original?: string;
  image_24?: string;
  image_32?: string;
  image_48?: string;
  image_72?: string;
  image_192?: string;
  image_512?: string;
  team?: string;
  first_name?: string;
  last_name?: string;
  title?: string;
  phone?: string;
  skype?: string;
}

/**
 * Slack channel/conversation object
 */
export interface SlackConversation {
  id: string;
  name?: string;
  is_channel?: boolean;
  is_group?: boolean;
  is_im?: boolean;
  is_mpim?: boolean;
  is_private?: boolean;
  is_archived?: boolean;
  is_general?: boolean;
  is_shared?: boolean;
  is_ext_shared?: boolean;
  is_org_shared?: boolean;
  is_member?: boolean;
  topic?: { value: string; creator: string; last_set: number };
  purpose?: { value: string; creator: string; last_set: number };
  num_members?: number;
  creator?: string;
  created?: number;
  unlinked?: number;
  user?: string; // For DMs
}

/**
 * Slack message object
 */
export interface SlackMessage {
  type: string;
  subtype?: string;
  channel?: string;
  user?: string;
  text?: string;
  ts: string;
  thread_ts?: string;
  reply_count?: number;
  reply_users_count?: number;
  latest_reply?: string;
  reply_users?: string[];
  replies?: Array<{ user: string; ts: string }>;
  subscribed?: boolean;
  last_read?: string;
  blocks?: SlackBlock[];
  attachments?: SlackAttachment[];
  files?: SlackFile[];
  edited?: { user: string; ts: string };
  bot_id?: string;
  app_id?: string;
}

/**
 * Slack event object (for Events API)
 */
export interface SlackEvent {
  type: string;
  user?: string;
  channel?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
  event_ts?: string;
  channel_type?: 'channel' | 'group' | 'im' | 'mpim';
  files?: SlackFile[];
  blocks?: SlackBlock[];
  subtype?: string;
  bot_id?: string;
  app_id?: string;
  message?: SlackMessage;
  previous_message?: SlackMessage;
  item?: { type: string; channel: string; ts: string };
  reaction?: string;
  item_user?: string;
}

/**
 * Slack event callback wrapper
 */
export interface SlackEventCallback {
  token?: string;
  team_id: string;
  api_app_id: string;
  event: SlackEvent;
  type: 'event_callback';
  event_id: string;
  event_time: number;
  authorizations?: Array<{
    enterprise_id?: string;
    team_id?: string;
    user_id?: string;
    is_bot?: boolean;
  }>;
}

/**
 * Slack file object
 */
export interface SlackFile {
  id: string;
  created?: number;
  timestamp?: number;
  name?: string;
  title?: string;
  mimetype?: string;
  filetype?: string;
  pretty_type?: string;
  user?: string;
  editable?: boolean;
  size?: number;
  mode?: string;
  is_external?: boolean;
  external_type?: string;
  is_public?: boolean;
  public_url_shared?: boolean;
  display_as_bot?: boolean;
  username?: string;
  url_private?: string;
  url_private_download?: string;
  thumb_64?: string;
  thumb_80?: string;
  thumb_360?: string;
  thumb_360_w?: number;
  thumb_360_h?: number;
  thumb_480?: string;
  thumb_480_w?: number;
  thumb_480_h?: number;
  thumb_160?: string;
  original_w?: number;
  original_h?: number;
  permalink?: string;
  permalink_public?: string;
}

/**
 * Slack attachment (legacy, but still used)
 */
export interface SlackAttachment {
  fallback?: string;
  color?: string;
  pretext?: string;
  author_name?: string;
  author_link?: string;
  author_icon?: string;
  title?: string;
  title_link?: string;
  text?: string;
  fields?: Array<{
    title: string;
    value: string;
    short?: boolean;
  }>;
  image_url?: string;
  thumb_url?: string;
  footer?: string;
  footer_icon?: string;
  ts?: number | string;
  mrkdwn_in?: string[];
  actions?: SlackAction[];
  callback_id?: string;
}

/**
 * Slack interactive action (legacy)
 */
export interface SlackAction {
  name: string;
  text: string;
  type: 'button' | 'select';
  value?: string;
  style?: 'default' | 'primary' | 'danger';
  confirm?: {
    title: string;
    text: string;
    ok_text?: string;
    dismiss_text?: string;
  };
  options?: Array<{ text: string; value: string }>;
}

/**
 * Slack Block Kit block types
 */
export type SlackBlock =
  | SlackSectionBlock
  | SlackDividerBlock
  | SlackImageBlock
  | SlackActionsBlock
  | SlackContextBlock
  | SlackInputBlock
  | SlackHeaderBlock;

/**
 * Section block
 */
export interface SlackSectionBlock {
  type: 'section';
  block_id?: string;
  text?: SlackTextObject;
  fields?: SlackTextObject[];
  accessory?: SlackBlockElement;
}

/**
 * Divider block
 */
export interface SlackDividerBlock {
  type: 'divider';
  block_id?: string;
}

/**
 * Image block
 */
export interface SlackImageBlock {
  type: 'image';
  block_id?: string;
  image_url: string;
  alt_text: string;
  title?: SlackTextObject;
}

/**
 * Actions block
 */
export interface SlackActionsBlock {
  type: 'actions';
  block_id?: string;
  elements: SlackBlockElement[];
}

/**
 * Context block
 */
export interface SlackContextBlock {
  type: 'context';
  block_id?: string;
  elements: Array<SlackTextObject | SlackImageElement>;
}

/**
 * Input block
 */
export interface SlackInputBlock {
  type: 'input';
  block_id?: string;
  label: SlackTextObject;
  element: SlackBlockElement;
  hint?: SlackTextObject;
  optional?: boolean;
  dispatch_action?: boolean;
}

/**
 * Header block
 */
export interface SlackHeaderBlock {
  type: 'header';
  block_id?: string;
  text: SlackTextObject;
}

/**
 * Text object
 */
export interface SlackTextObject {
  type: 'plain_text' | 'mrkdwn';
  text: string;
  emoji?: boolean;
  verbatim?: boolean;
}

/**
 * Block elements
 */
export type SlackBlockElement =
  | SlackButtonElement
  | SlackImageElement
  | SlackStaticSelectElement
  | SlackOverflowElement
  | SlackDatepickerElement
  | SlackTextInputElement;

/**
 * Button element
 */
export interface SlackButtonElement {
  type: 'button';
  action_id: string;
  text: SlackTextObject;
  url?: string;
  value?: string;
  style?: 'primary' | 'danger';
  confirm?: SlackConfirmDialog;
}

/**
 * Image element
 */
export interface SlackImageElement {
  type: 'image';
  image_url: string;
  alt_text: string;
}

/**
 * Static select element
 */
export interface SlackStaticSelectElement {
  type: 'static_select';
  action_id: string;
  placeholder?: SlackTextObject;
  options: SlackOption[];
  initial_option?: SlackOption;
  confirm?: SlackConfirmDialog;
}

/**
 * Overflow menu element
 */
export interface SlackOverflowElement {
  type: 'overflow';
  action_id: string;
  options: SlackOption[];
  confirm?: SlackConfirmDialog;
}

/**
 * Datepicker element
 */
export interface SlackDatepickerElement {
  type: 'datepicker';
  action_id: string;
  placeholder?: SlackTextObject;
  initial_date?: string; // YYYY-MM-DD
  confirm?: SlackConfirmDialog;
}

/**
 * Text input element
 */
export interface SlackTextInputElement {
  type: 'plain_text_input';
  action_id: string;
  placeholder?: SlackTextObject;
  initial_value?: string;
  multiline?: boolean;
  min_length?: number;
  max_length?: number;
  dispatch_action_config?: {
    trigger_actions_on: Array<'on_enter_pressed' | 'on_character_entered'>;
  };
}

/**
 * Option object for selects
 */
export interface SlackOption {
  text: SlackTextObject;
  value: string;
  description?: SlackTextObject;
  url?: string;
}

/**
 * Confirm dialog
 */
export interface SlackConfirmDialog {
  title: SlackTextObject;
  text: SlackTextObject;
  confirm: SlackTextObject;
  deny: SlackTextObject;
  style?: 'primary' | 'danger';
}

/**
 * Interactive payload (button click, select, etc.)
 */
export interface SlackInteractionPayload {
  type: 'block_actions' | 'message_action' | 'view_submission' | 'view_closed';
  team?: { id: string; domain: string };
  user: { id: string; username: string; name: string; team_id: string };
  api_app_id: string;
  token?: string;
  container?: {
    type: string;
    message_ts?: string;
    channel_id?: string;
    is_ephemeral?: boolean;
  };
  channel?: { id: string; name: string };
  message?: SlackMessage;
  response_url?: string;
  trigger_id?: string;
  actions?: SlackInteractionAction[];
  view?: SlackView;
}

/**
 * Interaction action
 */
export interface SlackInteractionAction {
  action_id: string;
  block_id: string;
  type: string;
  value?: string;
  selected_option?: SlackOption;
  selected_date?: string;
  action_ts: string;
}

/**
 * Slack view (modal)
 */
export interface SlackView {
  type: 'modal' | 'home';
  title: SlackTextObject;
  submit?: SlackTextObject;
  close?: SlackTextObject;
  blocks: SlackBlock[];
  private_metadata?: string;
  callback_id?: string;
  clear_on_close?: boolean;
  notify_on_close?: boolean;
  external_id?: string;
}

/**
 * Slash command payload
 */
export interface SlackSlashCommand {
  token?: string;
  team_id: string;
  team_domain: string;
  enterprise_id?: string;
  enterprise_name?: string;
  channel_id: string;
  channel_name: string;
  user_id: string;
  user_name: string;
  command: string;
  text: string;
  api_app_id: string;
  is_enterprise_install?: boolean;
  response_url: string;
  trigger_id: string;
}

/**
 * Slack API response
 */
export interface SlackApiResponse<T = unknown> {
  ok: boolean;
  error?: string;
  warning?: string;
  response_metadata?: {
    next_cursor?: string;
    scopes?: string[];
    acceptedScopes?: string[];
  };
  [key: string]: unknown;
}
