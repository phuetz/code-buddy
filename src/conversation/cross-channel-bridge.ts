import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { appendFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import type { ChannelType, ContentType } from '../channels/core.js';
import { getChannelManager } from '../channels/core.js';
import { resolveUserName } from '../companion/user-name.js';
import { logger } from '../utils/logger.js';
import type { ConversationTurn } from './types.js';

export type ConversationOrigin = 'voice' | 'channel' | 'cowork';

export interface CrossChannelTarget {
  channel: ChannelType;
  channelId: string;
  threadId?: string;
}

export interface CrossChannelConversationEvent extends ConversationTurn {
  id: string;
  conversationId: string;
  origin: ConversationOrigin;
  timestamp: string;
  externalId?: string;
  channel?: ChannelType;
  channelId?: string;
  threadId?: string;
}

export interface CrossChannelBridgeConfig {
  enabled: boolean;
  companionName: string;
  conversationId: string;
  target?: CrossChannelTarget;
  mirrorVoice: boolean;
  coworkEnabled: boolean;
  mirrorCowork: boolean;
  coworkHistoryTurns: number;
  persist: boolean;
  historyPath: string;
  maxEvents: number;
}

export interface CrossChannelBridgeDependencies {
  deliver?: (
    target: CrossChannelTarget,
    content: string,
    contentType: ContentType
  ) => Promise<boolean>;
  now?: () => Date;
  createId?: () => string;
}

const CHANNEL_TYPES = new Set<ChannelType>([
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
  'weixin',
  'qq',
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
]);

function envTrue(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(value);
}

function safeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'lisa';
}

export function resolveCrossChannelBridgeConfig(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir()
): CrossChannelBridgeConfig {
  const channelName = (env.CODEBUDDY_CONVERSATION_CHANNEL || 'telegram').trim();
  const channelId = (
    env.CODEBUDDY_CONVERSATION_CHANNEL_ID || env.CODEBUDDY_SENSORY_ALERT_CHAT || ''
  ).trim();
  const channel = CHANNEL_TYPES.has(channelName as ChannelType)
    ? (channelName as ChannelType)
    : undefined;
  const companionName = (env.CODEBUDDY_ROBOT_NAME || 'Lisa').trim() || 'Lisa';
  const conversationId =
    (env.CODEBUDDY_CONVERSATION_THREAD_ID || companionName.toLowerCase()).trim() || 'companion';
  const target = channel && channelId
    ? {
        channel,
        channelId,
        ...(env.CODEBUDDY_CONVERSATION_CHANNEL_THREAD?.trim()
          ? { threadId: env.CODEBUDDY_CONVERSATION_CHANNEL_THREAD.trim() }
          : {}),
      }
    : undefined;
  const requested = envTrue(env.CODEBUDDY_CONVERSATION_BRIDGE, true);
  const configuredMax = Number(env.CODEBUDDY_CONVERSATION_MAX_EVENTS ?? 200);
  const maxEvents = Number.isFinite(configuredMax)
    ? Math.max(20, Math.min(2_000, Math.floor(configuredMax)))
    : 200;
  const configuredCoworkHistory = Number(env.CODEBUDDY_CONVERSATION_COWORK_HISTORY ?? 24);
  const coworkHistoryTurns = Number.isFinite(configuredCoworkHistory)
    ? Math.max(4, Math.min(80, Math.floor(configuredCoworkHistory)))
    : 24;

  return {
    enabled: requested,
    companionName,
    conversationId,
    ...(target ? { target } : {}),
    mirrorVoice: envTrue(env.CODEBUDDY_CONVERSATION_MIRROR_VOICE, true),
    coworkEnabled: envTrue(env.CODEBUDDY_CONVERSATION_COWORK, true),
    mirrorCowork: envTrue(env.CODEBUDDY_CONVERSATION_MIRROR_COWORK, true),
    coworkHistoryTurns,
    persist: envTrue(env.CODEBUDDY_CONVERSATION_PERSIST, true),
    historyPath:
      env.CODEBUDDY_CONVERSATION_HISTORY_PATH?.trim() ||
      join(home, '.codebuddy', 'conversations', `${safeFileName(conversationId)}.jsonl`),
    maxEvents,
  };
}

function eventIsValid(value: unknown): value is CrossChannelConversationEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Partial<CrossChannelConversationEvent>;
  return (
    typeof event.id === 'string' &&
    typeof event.conversationId === 'string' &&
    (event.role === 'user' || event.role === 'assistant') &&
    typeof event.content === 'string' &&
    (event.origin === 'voice' || event.origin === 'channel' || event.origin === 'cowork') &&
    typeof event.timestamp === 'string'
  );
}

function mirroredLabel(event: CrossChannelConversationEvent, companionName: string): string {
  const speaker = event.role === 'user' ? resolveUserName() : companionName;
  if (event.origin === 'cowork') {
    return `💻 ${speaker} (Cowork)\n${event.content}`;
  }
  const icon = event.role === 'user' ? '🎙️' : '🔊';
  return `${icon} ${speaker} (voix)\n${event.content}`;
}

async function defaultDeliver(
  target: CrossChannelTarget,
  content: string,
  contentType: ContentType
): Promise<boolean> {
  const result = await getChannelManager().send(target.channel, {
    channelId: target.channelId,
    content,
    contentType,
    ...(target.threadId ? { threadId: target.threadId } : {}),
    parseMode: 'plain',
  });
  if (result.success) return true;

  // The sensory Telegram token can still deliver before the channel manager has
  // connected. It is deliberately restricted to the same configured alert chat.
  if (
    target.channel === 'telegram' &&
    target.channelId === process.env.CODEBUDDY_SENSORY_ALERT_CHAT &&
    process.env.CODEBUDDY_SENSORY_ALERT_TOKEN
  ) {
    const { sendTelegramAlert } = await import('../sensory/alert.js');
    await sendTelegramAlert(content);
    return true;
  }
  logger.warn(`[conversation-bridge] delivery failed on ${target.channel}: ${result.error ?? 'unknown error'}`);
  return false;
}

/**
 * One logical Lisa thread shared by the resident microphone and a configured
 * messaging channel. Appends happen synchronously in memory; delivery and the
 * private local JSONL journal are best-effort and never block conversation.
 */
export class CrossChannelConversationBridge {
  private readonly events: CrossChannelConversationEvent[] = [];
  private readonly eventIds = new Set<string>();
  private readonly externalIds = new Set<string>();
  private readonly deliver: NonNullable<CrossChannelBridgeDependencies['deliver']>;
  private readonly now: NonNullable<CrossChannelBridgeDependencies['now']>;
  private readonly createId: NonNullable<CrossChannelBridgeDependencies['createId']>;
  private lastHistoryMtimeMs = -1;
  private persistenceQueue: Promise<void> = Promise.resolve();

  constructor(
    readonly config: CrossChannelBridgeConfig = resolveCrossChannelBridgeConfig(),
    dependencies: CrossChannelBridgeDependencies = {}
  ) {
    this.deliver = dependencies.deliver ?? defaultDeliver;
    this.now = dependencies.now ?? (() => new Date());
    this.createId = dependencies.createId ?? randomUUID;
    this.loadPersistedHistory();
  }

  isActive(): boolean {
    return this.config.enabled && Boolean(this.config.target);
  }

  matchesChannel(channel: ChannelType, channelId: string, threadId?: string): boolean {
    this.loadPersistedHistory();
    const target = this.config.target;
    if (!this.isActive() || !target) return false;
    if (target.channel !== channel || target.channelId !== channelId) return false;
    return !target.threadId || target.threadId === threadId;
  }

  history(limit = this.config.maxEvents): ConversationTurn[] {
    this.loadPersistedHistory();
    return this.events.slice(-Math.max(0, limit)).map(({ role, content }) => ({ role, content }));
  }

  snapshot(): CrossChannelConversationEvent[] {
    this.loadPersistedHistory();
    return this.events.map((event) => ({ ...event }));
  }

  /** Wait for this process' queued journal appends (tests and graceful shutdown). */
  async flush(): Promise<void> {
    await this.persistenceQueue;
  }

  async recordVoiceTurn(turn: ConversationTurn, externalId?: string): Promise<boolean> {
    if (!this.isActive()) return false;
    const target = this.config.target;
    const event = this.append({
      ...turn,
      origin: 'voice',
      ...(externalId ? { externalId } : {}),
      ...(target
        ? {
            channel: target.channel,
            channelId: target.channelId,
            ...(target.threadId ? { threadId: target.threadId } : {}),
          }
        : {}),
    });
    if (!event) return false;
    if (!this.config.mirrorVoice || !this.config.target) return true;
    try {
      return await this.deliver(
        this.config.target,
        mirroredLabel(event, this.config.companionName),
        'text'
      );
    } catch (error) {
      logger.warn(
        `[conversation-bridge] voice mirror failed: ${error instanceof Error ? error.message : String(error)}`
      );
      return false;
    }
  }

  recordChannelTurn(input: {
    role: ConversationTurn['role'];
    content: string;
    channel: ChannelType;
    channelId: string;
    threadId?: string;
    externalId?: string;
  }): boolean {
    if (!this.matchesChannel(input.channel, input.channelId, input.threadId)) return false;
    return Boolean(
      this.append({
        role: input.role,
        content: input.content,
        origin: 'channel',
        channel: input.channel,
        channelId: input.channelId,
        ...(input.threadId ? { threadId: input.threadId } : {}),
        ...(input.externalId ? { externalId: input.externalId } : {}),
      })
    );
  }

  /**
   * Add a turn produced by an explicitly linked Cowork companion session.
   * The session/message pair is the cross-process idempotency key, so a
   * renderer retry cannot duplicate a personal turn in the shared journal.
   */
  async recordCoworkTurn(
    turn: ConversationTurn,
    input: { sessionId: string; messageId: string }
  ): Promise<boolean> {
    if (!this.isActive() || !this.config.coworkEnabled) return false;
    const target = this.config.target;
    const event = this.append({
      ...turn,
      origin: 'cowork',
      externalId: `${input.sessionId}:${input.messageId}`,
      ...(target
        ? {
            channel: target.channel,
            channelId: target.channelId,
            ...(target.threadId ? { threadId: target.threadId } : {}),
          }
        : {}),
    });
    if (!event) return false;
    if (!this.config.mirrorCowork || !target) return true;
    try {
      return await this.deliver(target, mirroredLabel(event, this.config.companionName), 'text');
    } catch (error) {
      logger.warn(
        `[conversation-bridge] Cowork mirror failed: ${error instanceof Error ? error.message : String(error)}`
      );
      return false;
    }
  }

  private append(
    input: ConversationTurn & {
      origin: ConversationOrigin;
      externalId?: string;
      channel?: ChannelType;
      channelId?: string;
      threadId?: string;
    }
  ): CrossChannelConversationEvent | null {
    const content = input.content.replace(/\s+/g, ' ').trim();
    if (!content) return null;
    if (input.externalId && this.externalIds.has(`${input.origin}:${input.externalId}`)) return null;

    const latest = this.events.at(-1);
    const now = this.now();
    if (
      latest?.origin === input.origin &&
      latest.role === input.role &&
      latest.content === content &&
      now.getTime() - new Date(latest.timestamp).getTime() < 5_000
    ) {
      return null;
    }

    const event: CrossChannelConversationEvent = {
      id: this.createId(),
      conversationId: this.config.conversationId,
      role: input.role,
      content,
      origin: input.origin,
      timestamp: now.toISOString(),
      ...(input.externalId ? { externalId: input.externalId } : {}),
      ...(input.channel ? { channel: input.channel } : {}),
      ...(input.channelId ? { channelId: input.channelId } : {}),
      ...(input.threadId ? { threadId: input.threadId } : {}),
    };
    this.events.push(event);
    this.eventIds.add(event.id);
    if (input.externalId) this.externalIds.add(`${input.origin}:${input.externalId}`);
    while (this.events.length > this.config.maxEvents) this.events.shift();
    if (this.config.persist) {
      this.persistenceQueue = this.persistenceQueue.then(() => this.persist(event));
    }
    return event;
  }

  private loadPersistedHistory(): void {
    if (!this.config.persist || !existsSync(this.config.historyPath)) return;
    try {
      const mtimeMs = statSync(this.config.historyPath).mtimeMs;
      if (mtimeMs === this.lastHistoryMtimeMs) return;
      this.lastHistoryMtimeMs = mtimeMs;
      const loaded = readFileSync(this.config.historyPath, 'utf8')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .flatMap((line) => {
          try {
            const event = JSON.parse(line) as unknown;
            return eventIsValid(event) && event.conversationId === this.config.conversationId
              ? [event]
              : [];
          } catch {
            return [];
          }
        })
        .slice(-this.config.maxEvents * 2);
      for (const event of loaded) {
        if (!this.eventIds.has(event.id)) {
          this.events.push(event);
          this.eventIds.add(event.id);
        }
        if (event.externalId) this.externalIds.add(`${event.origin}:${event.externalId}`);
      }
      this.events.sort((left, right) => left.timestamp.localeCompare(right.timestamp));
      while (this.events.length > this.config.maxEvents) this.events.shift();
      // Voice, Cowork, and Telegram commonly run in separate processes. A
      // bridged event carries its configured destination so another process
      // can discover the same thread without duplicating the chat ID in every env file.
      if (this.config.enabled && !this.config.target) {
        const rendezvous = [...loaded]
          .reverse()
          .find((event) => event.channel && event.channelId);
        if (rendezvous?.channel && rendezvous.channelId) {
          this.config.target = {
            channel: rendezvous.channel,
            channelId: rendezvous.channelId,
            ...(rendezvous.threadId ? { threadId: rendezvous.threadId } : {}),
          };
        }
      }
    } catch (error) {
      logger.warn(
        `[conversation-bridge] history unavailable: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async persist(event: CrossChannelConversationEvent): Promise<void> {
    try {
      await mkdir(dirname(this.config.historyPath), { recursive: true, mode: 0o700 });
      await appendFile(this.config.historyPath, `${JSON.stringify(event)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
    } catch (error) {
      logger.warn(
        `[conversation-bridge] history append failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

let bridgeInstance: CrossChannelConversationBridge | null = null;

export function getCrossChannelConversationBridge(): CrossChannelConversationBridge {
  bridgeInstance ??= new CrossChannelConversationBridge();
  return bridgeInstance;
}

export function resetCrossChannelConversationBridge(): void {
  bridgeInstance = null;
}
