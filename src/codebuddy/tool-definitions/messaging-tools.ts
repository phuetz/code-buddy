import { SEND_MESSAGE_CHANNELS } from '../../channels/send-message.js';
import type { CodeBuddyTool } from './types.js';

export const SEND_MESSAGE_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'send_message',
    description: 'Prepare or deliver an outbound channel message with dry-run outbox logging by default',
    parameters: {
      type: 'object',
      properties: {
        channel: {
          type: 'string',
          enum: [...SEND_MESSAGE_CHANNELS],
          description: 'Target channel type',
        },
        channel_id: {
          type: 'string',
          description: 'Target channel, chat, room, conversation, or recipient id',
        },
        content: {
          type: 'string',
          description: 'Message body to send or preview',
        },
        content_type: {
          type: 'string',
          enum: ['text', 'image', 'audio', 'video', 'file', 'location', 'contact', 'sticker', 'voice', 'command'],
          description: 'Message content type, default text',
        },
        dry_run: {
          type: 'boolean',
          description: 'Preview only and write to the local outbox; defaults to true',
        },
        approved_by: {
          type: 'string',
          description: 'Required when dry_run is false; records who approved external delivery',
        },
        parse_mode: {
          type: 'string',
          enum: ['markdown', 'html', 'plain'],
          description: 'Optional formatting mode',
        },
        thread_id: {
          type: 'string',
          description: 'Optional thread/topic id',
        },
        reply_to: {
          type: 'string',
          description: 'Optional message id to reply to',
        },
        disable_preview: {
          type: 'boolean',
          description: 'Disable link previews where supported',
        },
        silent: {
          type: 'boolean',
          description: 'Send without notification where supported',
        },
        peer_id: {
          type: 'string',
          description: 'Optional peer id for send-policy evaluation',
        },
        chat_type: {
          type: 'string',
          enum: ['dm', 'group', 'thread'],
          description: 'Optional chat type for send-policy evaluation',
        },
      },
      required: ['channel', 'channel_id', 'content'],
    },
  },
};

export const DISCORD_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'discord',
    description: [
      'Read and participate in a Discord server through the Discord REST API.',
      'Use fetch_messages for recent channel messages, search_members to find user IDs, and create_thread to create a public thread.',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['fetch_messages', 'search_members', 'create_thread'],
          description: 'Discord action to run',
        },
        guild_id: {
          type: 'string',
          description: 'Discord server (guild) ID; required for search_members',
        },
        channel_id: {
          type: 'string',
          description: 'Discord channel ID; required for fetch_messages and create_thread',
        },
        query: {
          type: 'string',
          description: 'Member name prefix to search for (search_members)',
        },
        name: {
          type: 'string',
          description: 'New thread name (create_thread)',
        },
        message_id: {
          type: 'string',
          description: 'Optional message ID to anchor create_thread to an existing message',
        },
        limit: {
          type: 'integer',
          description: 'Max results for fetch_messages or search_members; default 50',
        },
        before: {
          type: 'string',
          description: 'Snowflake ID for reverse pagination (fetch_messages)',
        },
        after: {
          type: 'string',
          description: 'Snowflake ID for forward pagination (fetch_messages)',
        },
        auto_archive_duration: {
          type: 'integer',
          description: 'Thread archive duration in minutes (create_thread); default 1440',
        },
      },
      required: ['action'],
    },
  },
};

export const MESSAGING_TOOLS: CodeBuddyTool[] = [
  SEND_MESSAGE_TOOL,
  DISCORD_TOOL,
];
