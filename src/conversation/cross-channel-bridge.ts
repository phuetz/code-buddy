import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import {
  appendFile,
  chmod,
  mkdir,
  open,
  readFile,
  stat,
  unlink,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import type { ChannelType, ContentType } from '../channels/core.js';
import { getChannelManager } from '../channels/core.js';
import { resolveUserName } from '../companion/user-name.js';
import { logger } from '../utils/logger.js';
import { writeFileAtomic } from '../utils/atomic-write.js';
import {
  resolvePrefetchedTurnContextForConversation,
  type PrefetchedTurnContext,
} from './prefetched-turn-context.js';
import {
  reduceSharedRelationshipState,
  renderSharedRelationshipContext,
  type SharedRelationshipSnapshot,
} from './shared-relationship-state.js';
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

export interface CrossChannelChannelTurnInput {
  role: ConversationTurn['role'];
  content: string;
  channel: ChannelType;
  channelId: string;
  threadId?: string;
  externalId?: string;
}

export type DurableTurnClaim = 'committed' | 'duplicate' | 'failed';

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
  /** On-disk privacy bound; compaction keeps at most `maxEvents` valid events. */
  maxHistoryBytes?: number;
}

export interface CrossChannelBridgeDependencies {
  deliver?: (
    target: CrossChannelTarget,
    content: string,
    contentType: ContentType
  ) => Promise<boolean>;
  now?: () => Date;
  createId?: () => string;
  voiceMirrorContent?: (
    event: CrossChannelConversationEvent,
    history: CrossChannelConversationEvent[],
  ) => string;
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
  const defaultMaxHistoryBytes = Math.max(256 * 1_024, maxEvents * 4_096);
  const configuredHistoryBytes = Number(
    env.CODEBUDDY_CONVERSATION_MAX_HISTORY_BYTES ?? defaultMaxHistoryBytes
  );
  const maxHistoryBytes = Number.isFinite(configuredHistoryBytes)
    ? Math.max(32 * 1_024, Math.min(64 * 1_024 * 1_024, Math.floor(configuredHistoryBytes)))
    : defaultMaxHistoryBytes;
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
    maxHistoryBytes,
  };
}

const JOURNAL_LOCK_STALE_MS = 30_000;
const JOURNAL_LOCK_WAIT_MS = JOURNAL_LOCK_STALE_MS;
const JOURNAL_LOCK_RETRY_MS = 25;
const MIN_JOURNAL_BYTES = 32 * 1_024;
const MAX_PERSISTED_EVENT_CONTENT_CHARS = 16_384;
const MAX_PERSISTED_METADATA_CHARS = 512;
const INTERNAL_COWORK_CONTEXT_MARKERS = [
  /\[Attached files - use Read tool to access them\]/i,
  /\[Attached file text excerpts - verify against source before final answers\]/i,
  /\[Document workshop (?:guidance|path hints)\]/i,
  /\[Video(?: URL)? understanding guidance\]/i,
  /<context_mentions\b[^>]*>\s*<[^>]+\bsource=/i,
  /<icm_memories\b[^>]*>\s*Relevant memories from past sessions:/i,
  /<project_context\b[^>]*\bproject=/i,
  /<project_(instructions|knowledge|memory)\b[\s\S]*<\/project_\1>/i,
  /<session_recall_context\b[\s\S]*<\/session_recall_context>/i,
] as const;

/** Defense in depth: enriched Cowork engine prompts are never shareable conversation turns. */
export function isSafeCoworkSharedContent(content: string): boolean {
  return !INTERNAL_COWORK_CONTEXT_MARKERS.some((marker) => marker.test(content));
}

function eventIsSafeForSharedConversation(event: CrossChannelConversationEvent): boolean {
  return event.origin !== 'cowork' || isSafeCoworkSharedContent(event.content);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function journalByteLimit(config: CrossChannelBridgeConfig): number {
  const requested = config.maxHistoryBytes
    ?? Math.max(256 * 1_024, config.maxEvents * 4_096);
  return Math.max(MIN_JOURNAL_BYTES, Math.min(64 * 1_024 * 1_024, requested));
}

function boundedPersistedMetadata(value: string): string {
  if (value.length <= MAX_PERSISTED_METADATA_CHARS) return value;
  const digest = createHash('sha256').update(value).digest('hex').slice(0, 32);
  const prefixLength = MAX_PERSISTED_METADATA_CHARS - digest.length - 1;
  return `${value.slice(0, prefixLength)}~${digest}`;
}

function externalDedupKey(origin: ConversationOrigin, externalId: string): string {
  return `${origin}:${boundedPersistedMetadata(externalId)}`;
}

function serializedEventBytes(event: CrossChannelConversationEvent): number {
  return Buffer.byteLength(`${JSON.stringify(event)}\n`, 'utf8');
}

function persistedEventWithin(
  event: CrossChannelConversationEvent,
  maxBytes: number,
): CrossChannelConversationEvent {
  // At the minimum journal size, maxBytes/8 leaves room for four-byte UTF-8,
  // JSON metadata and at least one additional recent turn.
  const contentLimit = Math.min(
    MAX_PERSISTED_EVENT_CONTENT_CHARS,
    Math.max(256, Math.floor(maxBytes / 8)),
  );
  const bounded: CrossChannelConversationEvent = {
    ...event,
    id: boundedPersistedMetadata(event.id),
    conversationId: boundedPersistedMetadata(event.conversationId),
    content: event.content.slice(0, contentLimit),
    timestamp: boundedPersistedMetadata(event.timestamp),
    ...(event.externalId
      ? { externalId: boundedPersistedMetadata(event.externalId) }
      : {}),
    ...(event.channelId
      ? { channelId: boundedPersistedMetadata(event.channelId) }
      : {}),
    ...(event.threadId
      ? { threadId: boundedPersistedMetadata(event.threadId) }
      : {}),
  };
  if (serializedEventBytes(bounded) <= maxBytes) return bounded;

  // JSON escaping can expand quotes, control characters, and backslashes far
  // beyond their UTF-8 input size. Find the longest content prefix whose full
  // serialized event (including its newline) fits the journal byte ceiling.
  let lower = 0;
  let upper = bounded.content.length;
  while (lower < upper) {
    const midpoint = Math.ceil((lower + upper) / 2);
    const candidate = { ...bounded, content: bounded.content.slice(0, midpoint) };
    if (serializedEventBytes(candidate) <= maxBytes) lower = midpoint;
    else upper = midpoint - 1;
  }
  let content = bounded.content.slice(0, lower);
  let result = { ...bounded, content };
  // A slice can split a surrogate pair, whose escaped JSON form is slightly
  // larger than the intact character. Keep the final invariant exact even at
  // that boundary.
  while (content && serializedEventBytes(result) > maxBytes) {
    content = content.slice(0, -1);
    result = { ...bounded, content };
  }
  return result;
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
    typeof event.timestamp === 'string' &&
    (event.externalId === undefined || typeof event.externalId === 'string') &&
    (event.channel === undefined || CHANNEL_TYPES.has(event.channel)) &&
    (event.channelId === undefined || typeof event.channelId === 'string') &&
    (event.threadId === undefined || typeof event.threadId === 'string')
  );
}

async function journalContainsDuplicate(
  historyPath: string,
  candidate: CrossChannelConversationEvent,
): Promise<boolean> {
  let raw: string;
  try {
    raw = await readFile(historyPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
  const candidateConversationId = boundedPersistedMetadata(candidate.conversationId);
  const candidateId = boundedPersistedMetadata(candidate.id);
  const candidateExternalId = candidate.externalId
    ? externalDedupKey(candidate.origin, candidate.externalId)
    : undefined;
  return raw
    .split(/\r?\n/)
    .some((line) => {
      if (!line.trim()) return false;
      try {
        const persisted = JSON.parse(line) as unknown;
        if (!eventIsValid(persisted)) return false;
        if (
          boundedPersistedMetadata(persisted.conversationId) !== candidateConversationId
        ) {
          return false;
        }
        if (boundedPersistedMetadata(persisted.id) === candidateId) return true;
        return Boolean(
          candidateExternalId &&
          persisted.externalId &&
          externalDedupKey(persisted.origin, persisted.externalId) === candidateExternalId
        );
      } catch {
        return false;
      }
    });
}

function mirroredLabel(event: CrossChannelConversationEvent, companionName: string): string {
  const speaker = event.role === 'user' ? resolveUserName() : companionName;
  if (event.origin === 'cowork') {
    return `💻 ${speaker} (Cowork)\n${event.content}`;
  }
  const icon = event.role === 'user' ? '🎙️' : '🔊';
  return `${icon} ${speaker} (voix)\n${event.content}`;
}

type FreshContextResolver = (
  heard: string,
  history: ConversationTurn[],
) => Pick<
  PrefetchedTurnContext,
  'speech' | 'text' | 'citations' | 'fetchedAt' | 'freshness'
> | null;

function comparableText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLocaleLowerCase('fr');
}

/** Keep spoken prose natural while giving the mirrored text turn dated, clickable evidence. */
export function voiceMirrorContentForEvent(
  event: CrossChannelConversationEvent,
  history: CrossChannelConversationEvent[],
  resolveFreshContext: FreshContextResolver = resolvePrefetchedTurnContextForConversation,
): string {
  if (event.role !== 'assistant') return event.content;
  const priorEvents = history.filter((candidate) => candidate.id !== event.id);
  const previousUser = [...priorEvents]
    .reverse()
    .find((candidate) => candidate.role === 'user' && candidate.origin === 'voice');
  if (!previousUser) return event.content;
  const context = resolveFreshContext(
    previousUser.content,
    priorEvents.map(({ role, content }) => ({ role, content })),
  );
  if (!context?.citations.length) return event.content;
  const collectedAt = new Date(context.fetchedAt).toISOString();
  if (comparableText(event.content) === comparableText(context.speech)) {
    return [
      `Bulletin ${context.freshness}, collecte ${collectedAt}.`,
      context.text,
    ].join('\n');
  }
  if (/https?:\/\//i.test(event.content)) return event.content;
  const sources = context.citations
    .slice(0, 5)
    .map((citation, index) => `${index + 1}. ${citation.title} — ${citation.url}`)
    .join('\n');
  return [
    event.content,
    '',
    `Sources du bulletin (${context.freshness}, collecte ${collectedAt}) :`,
    sources,
  ].join('\n');
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
    return sendTelegramAlert(content);
  }
  logger.warn(`[conversation-bridge] delivery failed on ${target.channel}: ${result.error ?? 'unknown error'}`);
  return false;
}

/**
 * One logical Lisa thread shared by the resident microphone and a configured
 * messaging channel. Appends are projected synchronously in memory. Mirrored
 * delivery waits for the private journal's durable idempotency claim so two
 * processes can never send the same logical turn twice.
 */
export class CrossChannelConversationBridge {
  private readonly events: CrossChannelConversationEvent[] = [];
  private readonly eventIds = new Set<string>();
  private readonly externalIds = new Set<string>();
  private readonly deliver: NonNullable<CrossChannelBridgeDependencies['deliver']>;
  private readonly now: NonNullable<CrossChannelBridgeDependencies['now']>;
  private readonly createId: NonNullable<CrossChannelBridgeDependencies['createId']>;
  private readonly voiceMirrorContent: NonNullable<
    CrossChannelBridgeDependencies['voiceMirrorContent']
  >;
  private lastHistoryMtimeMs = -1;
  private lastHistorySize = -1;
  private persistenceQueue: Promise<void> = Promise.resolve();
  /** Commit + mirror operations are ordered so Telegram cannot see Lisa before the user turn. */
  private deliveryQueue: Promise<void> = Promise.resolve();

  constructor(
    readonly config: CrossChannelBridgeConfig = resolveCrossChannelBridgeConfig(),
    dependencies: CrossChannelBridgeDependencies = {}
  ) {
    this.deliver = dependencies.deliver ?? defaultDeliver;
    this.now = dependencies.now ?? (() => new Date());
    this.createId = dependencies.createId ?? randomUUID;
    this.voiceMirrorContent = dependencies.voiceMirrorContent ?? voiceMirrorContentForEvent;
    this.loadPersistedHistory();
  }

  isActive(): boolean {
    // Voice, Cowork, and channel adapters often live in separate processes.
    // Re-read the rendezvous journal here so a process that started before the
    // configured channel was known can become active without a restart.
    this.loadPersistedHistory();
    return this.config.enabled && Boolean(this.config.target);
  }

  matchesChannel(channel: ChannelType, channelId: string, threadId?: string): boolean {
    this.loadPersistedHistory();
    const target = this.config.target;
    if (!this.config.enabled || !target) return false;
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

  /**
   * Return an allowlisted view of relational continuity. Raw dialogue remains
   * exclusively in the private event journal and is never present in this value.
   */
  relationshipSnapshot(): SharedRelationshipSnapshot {
    this.loadPersistedHistory();
    return reduceSharedRelationshipState(this.events, { now: this.now() });
  }

  /** Fixed-label prompt context shared by voice, channels, and Cowork. */
  renderRelationshipContext(): string {
    return renderSharedRelationshipContext(this.relationshipSnapshot());
  }

  /** Wait for this process' queued journal appends (tests and graceful shutdown). */
  async flush(): Promise<void> {
    await Promise.all([this.persistenceQueue, this.deliveryQueue]);
  }

  async recordVoiceTurn(turn: ConversationTurn, externalId?: string): Promise<boolean> {
    if (!this.isActive()) return false;
    const target = this.config.target;
    const appended = this.append({
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
    if (!appended) return false;
    const { event } = appended;
    return this.enqueueCommittedDelivery(appended.committed, async () => {
      if (!this.config.mirrorVoice || !this.config.target) return true;
      try {
        const deliveryContent = this.voiceMirrorContent(event, this.events);
        return await this.deliver(
          this.config.target,
          mirroredLabel({ ...event, content: deliveryContent }, this.config.companionName),
          'text'
        );
      } catch (error) {
        logger.warn(
          `[conversation-bridge] voice mirror failed: ${error instanceof Error ? error.message : String(error)}`
        );
        return false;
      }
    });
  }

  recordChannelTurn(input: CrossChannelChannelTurnInput): boolean {
    return Boolean(this.appendChannelTurn(input));
  }

  /**
   * Persist a channel turn before its caller continues. Unlike the legacy
   * optimistic boolean API above, this reports the cross-process claim result:
   * only the process that durably appended a duplicated external ID gets true.
   */
  async recordChannelTurnDurably(input: CrossChannelChannelTurnInput): Promise<boolean> {
    return (await this.claimChannelTurnDurably(input)) === 'committed';
  }

  /**
   * Claim a channel update with a discriminated outcome. Callers may silently
   * ignore an idempotent transport retry, but must not mistake journal failure
   * for a duplicate and lose the user's message without feedback.
   */
  async claimChannelTurnDurably(
    input: CrossChannelChannelTurnInput,
  ): Promise<DurableTurnClaim> {
    if (!this.matchesChannel(input.channel, input.channelId, input.threadId)) return 'failed';
    const content = input.content.replace(/\s+/g, ' ').trim();
    if (!content) return 'failed';
    if (
      input.externalId &&
      this.externalIds.has(externalDedupKey('channel', input.externalId))
    ) {
      return 'duplicate';
    }
    const appended = this.appendChannelTurn(input);
    return appended ? appended.committed : 'duplicate';
  }

  /** Record content already delivered on the configured channel, without echoing it. */
  async recordTargetChannelTurnDurably(
    turn: ConversationTurn,
    externalId?: string,
  ): Promise<boolean> {
    if (!this.isActive() || !this.config.target) return false;
    const target = this.config.target;
    return this.recordChannelTurnDurably({
      ...turn,
      channel: target.channel,
      channelId: target.channelId,
      ...(target.threadId ? { threadId: target.threadId } : {}),
      ...(externalId ? { externalId } : {}),
    });
  }

  private appendChannelTurn(input: CrossChannelChannelTurnInput): {
    event: CrossChannelConversationEvent;
    committed: Promise<DurableTurnClaim>;
  } | null {
    if (!this.matchesChannel(input.channel, input.channelId, input.threadId)) return null;
    return this.append({
      role: input.role,
      content: input.content,
      origin: 'channel',
      channel: input.channel,
      channelId: input.channelId,
      ...(input.threadId ? { threadId: input.threadId } : {}),
      ...(input.externalId ? { externalId: input.externalId } : {}),
    });
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
    if (!isSafeCoworkSharedContent(turn.content)) {
      logger.warn('[conversation-bridge] blocked an enriched Cowork prompt at the shared boundary');
      return false;
    }
    const target = this.config.target;
    const appended = this.append({
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
    if (!appended) return false;
    const { event } = appended;
    return this.enqueueCommittedDelivery(appended.committed, async () => {
      if (!this.config.mirrorCowork || !target) return true;
      try {
        return await this.deliver(target, mirroredLabel(event, this.config.companionName), 'text');
      } catch (error) {
        logger.warn(
          `[conversation-bridge] Cowork mirror failed: ${error instanceof Error ? error.message : String(error)}`
        );
        return false;
      }
    });
  }

  private enqueueCommittedDelivery(
    committed: Promise<DurableTurnClaim>,
    deliver: () => Promise<boolean>,
  ): Promise<boolean> {
    const operation = this.deliveryQueue.then(async () => {
      if ((await committed) !== 'committed') return false;
      return deliver();
    });
    this.deliveryQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  private append(
    input: ConversationTurn & {
      origin: ConversationOrigin;
      externalId?: string;
      channel?: ChannelType;
      channelId?: string;
      threadId?: string;
    }
  ): { event: CrossChannelConversationEvent; committed: Promise<DurableTurnClaim> } | null {
    const content = input.content.replace(/\s+/g, ' ').trim();
    if (!content) return null;
    if (input.externalId && this.externalIds.has(externalDedupKey(input.origin, input.externalId))) {
      return null;
    }

    const latest = this.events.at(-1);
    const now = this.now();
    if (
      !input.externalId &&
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
    this.eventIds.add(boundedPersistedMetadata(event.id));
    if (input.externalId) this.externalIds.add(externalDedupKey(input.origin, input.externalId));
    this.trimEventWindow();
    const committed = this.config.persist
      ? this.persistenceQueue.then(() => this.persist(event))
      : Promise.resolve<DurableTurnClaim>('committed');
    if (this.config.persist) {
      // Keep the queue alive after a failed append; callers still receive the
      // precise claim result through `committed`.
      this.persistenceQueue = committed.then(
        () => undefined,
        () => undefined,
      );
    }
    return { event, committed };
  }

  private loadPersistedHistory(): void {
    if (!this.config.persist || !existsSync(this.config.historyPath)) return;
    try {
      const lockPath = `${this.config.historyPath}.lock`;
      if (existsSync(lockPath)) {
        try {
          const lockAge = Date.now() - statSync(lockPath).mtimeMs;
          // A Windows replacement fallback rewrites the destination under this
          // lock. Keep the last complete in-memory view until that short
          // critical section ends instead of parsing a transient partial file.
          if (lockAge <= JOURNAL_LOCK_STALE_MS) return;
        } catch {
          return;
        }
      }
      const historyStat = statSync(this.config.historyPath);
      const mtimeMs = historyStat.mtimeMs;
      const size = historyStat.size;
      // Some filesystems expose a coarse modification timestamp. Size makes an
      // append visible even when two processes write inside the same tick.
      if (mtimeMs === this.lastHistoryMtimeMs && size === this.lastHistorySize) return;
      this.lastHistoryMtimeMs = mtimeMs;
      this.lastHistorySize = size;
      const loaded = readFileSync(this.config.historyPath, 'utf8')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .flatMap((line) => {
          try {
            const event = JSON.parse(line) as unknown;
            return eventIsValid(event) &&
              eventIsSafeForSharedConversation(event) &&
              event.conversationId === boundedPersistedMetadata(this.config.conversationId)
              ? [event]
              : [];
          } catch {
            return [];
          }
        })
        .slice(-this.config.maxEvents * 2);
      for (const event of loaded) {
        const eventId = boundedPersistedMetadata(event.id);
        if (!this.eventIds.has(eventId)) {
          this.events.push(event);
          this.eventIds.add(eventId);
        }
        if (event.externalId) this.externalIds.add(externalDedupKey(event.origin, event.externalId));
      }
      this.events.sort((left, right) => left.timestamp.localeCompare(right.timestamp));
      this.trimEventWindow();
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

  private trimEventWindow(): void {
    while (this.events.length > this.config.maxEvents) this.events.shift();
    // Dedup bookkeeping follows the same bounded privacy window instead of
    // retaining every historical identifier for the lifetime of a daemon.
    this.eventIds.clear();
    this.externalIds.clear();
    for (const event of this.events) {
      this.eventIds.add(boundedPersistedMetadata(event.id));
      if (event.externalId) this.externalIds.add(externalDedupKey(event.origin, event.externalId));
    }
  }

  private async persist(event: CrossChannelConversationEvent): Promise<DurableTurnClaim> {
    const lockPath = `${this.config.historyPath}.lock`;
    let lock: Awaited<ReturnType<typeof open>> | undefined;
    let claimed = false;
    try {
      const historyDirectory = dirname(this.config.historyPath);
      await mkdir(historyDirectory, { recursive: true, mode: 0o700 });
      const lockDeadline = Date.now() + JOURNAL_LOCK_WAIT_MS;
      while (!lock && Date.now() <= lockDeadline) {
        try {
          lock = await open(lockPath, 'wx', 0o600);
          break;
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code !== 'EEXIST') throw error;
          try {
            const lockStat = await stat(lockPath);
            if (Date.now() - lockStat.mtimeMs >= JOURNAL_LOCK_STALE_MS) {
              await unlink(lockPath);
              continue;
            }
          } catch {
            continue;
          }
          const remainingMs = lockDeadline - Date.now();
          if (remainingMs <= 0) break;
          await delay(Math.min(JOURNAL_LOCK_RETRY_MS, remainingMs));
        }
      }
      if (!lock) throw new Error('conversation journal lock timed out');

      const maxBytes = journalByteLimit(this.config);
      const persistedEvent = persistedEventWithin(event, maxBytes);
      // The optimistic in-memory check cannot see another process between its
      // load and append. Recheck both idempotency keys under the journal lock.
      if (await journalContainsDuplicate(this.config.historyPath, persistedEvent)) {
        // This process lost an inter-process idempotency race. Roll back its
        // optimistic projection so a subsequent reload cannot contain both
        // the local phantom event and the winner's persisted event.
        const localIndex = this.events.findIndex((candidate) => candidate === event);
        if (localIndex >= 0) this.events.splice(localIndex, 1);
        this.trimEventWindow();
        return 'duplicate';
      }
      await appendFile(this.config.historyPath, `${JSON.stringify(persistedEvent)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
      claimed = true;
      try {
        await chmod(this.config.historyPath, 0o600);
      } catch {
        /* advisory on Windows */
      }

      const historyStat = await stat(this.config.historyPath);
      if (historyStat.size > maxBytes) await this.compactPersistedHistory();
      return 'committed';
    } catch (error) {
      logger.warn(
        `[conversation-bridge] history append failed: ${error instanceof Error ? error.message : String(error)}`
      );
      // Once appendFile succeeds the claim is durable even if a later stat or
      // compaction step fails. Delivery may proceed exactly once. Otherwise
      // remove the optimistic event/external ID so the same update can retry.
      if (!claimed) {
        const localIndex = this.events.findIndex((candidate) => candidate === event);
        if (localIndex >= 0) this.events.splice(localIndex, 1);
        this.trimEventWindow();
      }
      return claimed ? 'committed' : 'failed';
    } finally {
      try {
        await lock?.close();
      } catch {
        /* best effort */
      }
      if (lock) {
        try {
          await unlink(lockPath);
        } catch {
          /* another recovery path may already have removed it */
        }
      }
    }
  }

  /** Called only while holding the cross-process journal lock. */
  private async compactPersistedHistory(): Promise<void> {
    const raw = await readFile(this.config.historyPath, 'utf8');
    const candidates = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => {
        try {
          const parsed = JSON.parse(line) as unknown;
          return eventIsValid(parsed) &&
            eventIsSafeForSharedConversation(parsed) &&
            parsed.conversationId === boundedPersistedMetadata(this.config.conversationId)
            ? [parsed]
            : [];
        } catch {
          return [];
        }
      })
      .slice(-this.config.maxEvents);
    const maxBytes = journalByteLimit(this.config);
    const retained: CrossChannelConversationEvent[] = [];
    let retainedBytes = 0;
    for (let index = candidates.length - 1; index >= 0; index -= 1) {
      const candidate = persistedEventWithin(candidates[index]!, maxBytes);
      const candidateBytes = Buffer.byteLength(`${JSON.stringify(candidate)}\n`, 'utf8');
      if (retained.length > 0 && retainedBytes + candidateBytes > maxBytes) break;
      retained.unshift(candidate);
      retainedBytes += candidateBytes;
    }
    const serialized = retained.length > 0
      ? `${retained.map((item) => JSON.stringify(item)).join('\n')}\n`
      : '';
    await writeFileAtomic(this.config.historyPath, serialized);
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
