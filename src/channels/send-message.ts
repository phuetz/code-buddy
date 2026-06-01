import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';

import {
  getChannelManager,
  type ChannelManager,
  type ChannelType,
  type ContentType,
  type DeliveryResult,
  type OutboundMessage,
} from './core.js';
import { SendPolicyEngine } from './send-policy.js';

export type SendMessageStatus = 'preview' | 'sent' | 'failed' | 'blocked';
export type SendMessageParseMode = 'markdown' | 'html' | 'plain';

export interface SendMessageInput {
  channel: ChannelType;
  channelId: string;
  content: string;
  contentType?: ContentType;
  dryRun?: boolean;
  approvedBy?: string;
  parseMode?: SendMessageParseMode;
  threadId?: string;
  replyTo?: string;
  disablePreview?: boolean;
  silent?: boolean;
  peerId?: string;
  chatType?: 'dm' | 'group' | 'thread';
}

export interface SendMessageOutboxEntry {
  id: string;
  channel: ChannelType;
  channelId: string;
  content: string;
  contentType: ContentType;
  status: SendMessageStatus;
  dryRun: boolean;
  createdAt: string;
  approvedBy?: string;
  parseMode?: SendMessageParseMode;
  threadId?: string;
  replyTo?: string;
  disablePreview?: boolean;
  silent?: boolean;
  policy?: {
    allowed: boolean;
    reason?: string;
  };
  delivery?: {
    success: boolean;
    messageId?: string;
    error?: string;
    timestamp: string;
  };
  error?: string;
}

export interface SendMessageExecutionResult {
  kind: 'send_message_result';
  ok: boolean;
  action: 'send_message';
  status: SendMessageStatus;
  dryRun: boolean;
  outboxPath: string;
  entry: SendMessageOutboxEntry;
  error?: string;
}

export interface SendMessageExecutorOptions {
  rootDir?: string;
  outboxPath?: string;
  now?: () => Date;
  createId?: () => string;
  channelManager?: ChannelManager;
  sendPolicy?: SendPolicyEngine;
}

export const SEND_MESSAGE_CHANNELS = [
  'telegram',
  'discord',
  'slack',
  'whatsapp',
  'signal',
  'matrix',
  'google-chat',
  'teams',
  'webchat',
  'dingtalk',
  'wecom',
  'line',
  'nostr',
  'zalo',
  'mattermost',
  'nextcloud-talk',
  'twilio-voice',
  'imessage',
  'irc',
  'feishu',
  'synology-chat',
  'ntfy',
  'twitch',
  'tlon',
  'gmail',
  'cli',
  'web',
  'api',
] as const satisfies readonly ChannelType[];

const CHANNEL_SET = new Set<string>(SEND_MESSAGE_CHANNELS);

export async function executeSendMessage(
  input: SendMessageInput,
  options: SendMessageExecutorOptions = {},
): Promise<SendMessageExecutionResult> {
  const normalized = normalizeInput(input);
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? (() => randomUUID());
  const outboxPath = resolveOutboxPath(options);
  const dryRun = normalized.dryRun !== false;
  const createdAt = now().toISOString();

  const baseEntry: SendMessageOutboxEntry = {
    id: createId(),
    channel: normalized.channel,
    channelId: normalized.channelId,
    content: normalized.content,
    contentType: normalized.contentType ?? 'text',
    status: 'preview',
    dryRun,
    createdAt,
    ...(normalized.approvedBy ? { approvedBy: normalized.approvedBy } : {}),
    ...(normalized.parseMode ? { parseMode: normalized.parseMode } : {}),
    ...(normalized.threadId ? { threadId: normalized.threadId } : {}),
    ...(normalized.replyTo ? { replyTo: normalized.replyTo } : {}),
    ...(normalized.disablePreview !== undefined ? { disablePreview: normalized.disablePreview } : {}),
    ...(normalized.silent !== undefined ? { silent: normalized.silent } : {}),
  };

  if (dryRun) {
    await appendOutboxEntry(outboxPath, baseEntry);
    return resultFromEntry(baseEntry, outboxPath, true);
  }

  if (!normalized.approvedBy) {
    const entry: SendMessageOutboxEntry = {
      ...baseEntry,
      status: 'blocked',
      error: 'approved_by is required when dry_run is false',
    };
    await appendOutboxEntry(outboxPath, entry);
    return resultFromEntry(entry, outboxPath, false, entry.error);
  }

  const sendPolicy = options.sendPolicy ?? SendPolicyEngine.getInstance();
  const policy = sendPolicy.evaluate({
    sessionKey: `send_message:${normalized.channel}:${normalized.channelId}`,
    channel: normalized.channel,
    chatType: normalized.chatType,
    peerId: normalized.peerId,
  });

  if (!policy.allowed) {
    const entry: SendMessageOutboxEntry = {
      ...baseEntry,
      status: 'blocked',
      policy: {
        allowed: false,
        ...(policy.reason ? { reason: policy.reason } : {}),
      },
      error: policy.reason ?? 'send policy blocked delivery',
    };
    await appendOutboxEntry(outboxPath, entry);
    return resultFromEntry(entry, outboxPath, false, entry.error);
  }

  const channelManager = options.channelManager ?? getChannelManager();
  const delivery = await channelManager.send(normalized.channel, buildOutboundMessage(normalized));
  const entry: SendMessageOutboxEntry = {
    ...baseEntry,
    status: delivery.success ? 'sent' : 'failed',
    policy: {
      allowed: true,
      ...(policy.reason ? { reason: policy.reason } : {}),
    },
    delivery: serializeDelivery(delivery),
    ...(delivery.error ? { error: delivery.error } : {}),
  };
  await appendOutboxEntry(outboxPath, entry);
  return resultFromEntry(entry, outboxPath, delivery.success, delivery.error);
}

export async function readSendMessageOutbox(rootDir: string = process.cwd()): Promise<SendMessageOutboxEntry[]> {
  const outboxPath = resolveOutboxPath({ rootDir });
  try {
    const raw = await fs.readFile(outboxPath, 'utf8');
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as SendMessageOutboxEntry);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

function normalizeInput(input: SendMessageInput): SendMessageInput {
  const channel = normalizeChannel(input.channel);
  const channelId = input.channelId.trim();
  const content = input.content.trim();

  if (!channelId) {
    throw new Error('channel_id is required');
  }
  if (!content) {
    throw new Error('content is required');
  }
  if (content.length > 20000) {
    throw new Error('content must be 20000 characters or fewer');
  }

  return {
    ...input,
    channel,
    channelId,
    content,
    contentType: input.contentType ?? 'text',
    approvedBy: input.approvedBy?.trim() || undefined,
    parseMode: input.parseMode,
    threadId: input.threadId?.trim() || undefined,
    replyTo: input.replyTo?.trim() || undefined,
    peerId: input.peerId?.trim() || undefined,
  };
}

function normalizeChannel(channel: ChannelType): ChannelType {
  if (!CHANNEL_SET.has(channel)) {
    throw new Error(`channel must be one of: ${SEND_MESSAGE_CHANNELS.join(', ')}`);
  }
  return channel;
}

function resolveOutboxPath(options: SendMessageExecutorOptions): string {
  return options.outboxPath ?? path.join(options.rootDir ?? process.cwd(), '.codebuddy', 'messages', 'outbox.jsonl');
}

async function appendOutboxEntry(outboxPath: string, entry: SendMessageOutboxEntry): Promise<void> {
  await fs.mkdir(path.dirname(outboxPath), { recursive: true });
  await fs.appendFile(outboxPath, `${JSON.stringify(entry)}\n`, 'utf8');
}

function buildOutboundMessage(input: SendMessageInput): OutboundMessage {
  return {
    channelId: input.channelId,
    content: input.content,
    contentType: input.contentType ?? 'text',
    ...(input.threadId ? { threadId: input.threadId } : {}),
    ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    ...(input.parseMode ? { parseMode: input.parseMode } : {}),
    ...(input.disablePreview !== undefined ? { disablePreview: input.disablePreview } : {}),
    ...(input.silent !== undefined ? { silent: input.silent } : {}),
  };
}

function serializeDelivery(delivery: DeliveryResult): SendMessageOutboxEntry['delivery'] {
  return {
    success: delivery.success,
    timestamp: delivery.timestamp.toISOString(),
    ...(delivery.messageId ? { messageId: delivery.messageId } : {}),
    ...(delivery.error ? { error: delivery.error } : {}),
  };
}

function resultFromEntry(
  entry: SendMessageOutboxEntry,
  outboxPath: string,
  ok: boolean,
  error?: string,
): SendMessageExecutionResult {
  return {
    kind: 'send_message_result',
    ok,
    action: 'send_message',
    status: entry.status,
    dryRun: entry.dryRun,
    outboxPath,
    entry,
    ...(error ? { error } : {}),
  };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error;
}
