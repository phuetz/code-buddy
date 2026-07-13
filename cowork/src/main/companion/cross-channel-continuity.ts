/**
 * Explicit Cowork adapter for the core cross-channel companion journal.
 *
 * Cowork also hosts ordinary coding sessions, so continuity is fail-closed:
 * only a session carrying the durable `companion` (or legacy `lisa`) tag can
 * read or append the private voice/Telegram thread.
 */
import type { Session } from '../../renderer/types';
import { isCompanionThreadTags } from '../../shared/companion-thread';
import { loadCoreModule } from '../utils/core-loader';
import { logError, logWarn } from '../utils/logger';

export type CoworkEngineMessage = { role: string; content: string };

type ConversationRole = 'user' | 'assistant';
type ConversationOrigin = 'voice' | 'channel' | 'cowork';

interface CoreConversationEvent {
  id: string;
  role: ConversationRole;
  content: string;
  origin: ConversationOrigin;
  timestamp: string;
  externalId?: string;
}

interface CoreBridgeConfig {
  enabled: boolean;
  companionName: string;
  conversationId: string;
  coworkEnabled: boolean;
  coworkHistoryTurns: number;
  historyPath: string;
  target?: { channel: string; channelId: string; threadId?: string };
}

interface CoreConversationBridge {
  isActive(): boolean;
  snapshot(): CoreConversationEvent[];
  recordCoworkTurn(
    turn: { role: ConversationRole; content: string },
    input: { sessionId: string; messageId: string },
  ): Promise<boolean>;
}

interface CoreBridgeModule {
  CrossChannelConversationBridge: new (
    config: CoreBridgeConfig,
    dependencies?: {
      deliver?: (
        target: { channel: string; channelId: string; threadId?: string },
        content: string,
        contentType: string,
      ) => Promise<boolean>;
    },
  ) => CoreConversationBridge;
  resolveCrossChannelBridgeConfig: (env: Record<string, string | undefined>) => CoreBridgeConfig;
}

interface CoreAssistantConfigModule {
  readAssistantConfig?: () => Record<string, string>;
  readAssistantRuntimeEnv?: () => Record<string, string>;
}

interface CoreCompanionIdentityModule {
  LISA_COMPANION_SYSTEM_PROMPT?: string;
}

type CoreLoader = <T>(relativePath: string) => Promise<T | null>;

export interface PreparedCoworkContinuity {
  active: boolean;
  messages: CoworkEngineMessage[];
  systemPrompt?: string;
  recordAssistant: (messageId: string, content: string) => void;
}

interface CachedBridge {
  fingerprint: string;
  bridge: CoreConversationBridge;
  config: CoreBridgeConfig;
  identityPrompt: string;
}

const MAX_SHARED_HISTORY_CHARS = 12_000;
const EMPTY_CONTINUITY: PreparedCoworkContinuity = {
  active: false,
  messages: [],
  recordAssistant: () => undefined,
};

function normalizeContent(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function messageFingerprint(role: string, content: string): string {
  return `${role}:${normalizeContent(content).toLocaleLowerCase('fr')}`;
}

function configFingerprint(config: CoreBridgeConfig): string {
  return JSON.stringify({
    enabled: config.enabled,
    companionName: config.companionName,
    conversationId: config.conversationId,
    coworkEnabled: config.coworkEnabled,
    coworkHistoryTurns: config.coworkHistoryTurns,
    historyPath: config.historyPath,
    target: config.target ?? null,
  });
}

/** Telegram delivery owned by Electron main; credentials never cross IPC. */
export function createCoworkConversationDeliver(
  runtimeEnv: Record<string, string | undefined>,
  fetchImpl: typeof fetch = fetch,
): (
  target: { channel: string; channelId: string; threadId?: string },
  content: string,
) => Promise<boolean> {
  return async (target, content) => {
    if (target.channel !== 'telegram') return false;
    const token = (
      runtimeEnv.CODEBUDDY_SENSORY_ALERT_TOKEN
      || runtimeEnv.TELEGRAM_BOT_TOKEN
      || ''
    ).trim();
    if (!token || !target.channelId.trim() || !content.trim()) return false;

    const threadNumber = Number(target.threadId);
    const response = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: target.channelId,
        text: content,
        ...(target.threadId && Number.isSafeInteger(threadNumber)
          ? { message_thread_id: threadNumber }
          : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok;
  };
}

function boundedHistory(
  events: CoreConversationEvent[],
  limit: number,
): CoreConversationEvent[] {
  const selected: CoreConversationEvent[] = [];
  let chars = 0;
  for (let index = events.length - 1; index >= 0 && selected.length < limit; index -= 1) {
    const event = events[index];
    if (!event) continue;
    const length = event.content.length;
    if (selected.length > 0 && chars + length > MAX_SHARED_HISTORY_CHARS) break;
    selected.push(event);
    chars += length;
  }
  return selected.reverse();
}

export class CoworkCrossChannelContinuity {
  private cached?: CachedBridge;

  constructor(
    private readonly coreLoader: CoreLoader = <T>(relativePath: string) =>
      loadCoreModule<T>(relativePath),
  ) {}

  async prepare(
    session: Session,
    localMessages: CoworkEngineMessage[],
    currentPrompt: string,
    userMessageId: string,
  ): Promise<PreparedCoworkContinuity> {
    if (!isCompanionThreadTags(session.tags)) return EMPTY_CONTINUITY;

    try {
      const state = await this.resolveBridge();
      if (!state || !state.config.coworkEnabled || !state.bridge.isActive()) {
        return EMPTY_CONTINUITY;
      }

      const localFingerprints = new Set(
        [...localMessages, { role: 'user', content: currentPrompt }]
          .map((message) => messageFingerprint(message.role, message.content)),
      );
      const sessionPrefix = `${session.id}:`;
      const eligible = state.bridge.snapshot().filter((event) => {
        if (event.origin === 'cowork' && event.externalId?.startsWith(sessionPrefix)) return false;
        return !localFingerprints.has(messageFingerprint(event.role, event.content));
      });
      const history = boundedHistory(eligible, state.config.coworkHistoryTurns).map((event) => ({
        role: event.role,
        content: event.content,
      }));

      this.recordTurn(state.bridge, session.id, userMessageId, 'user', currentPrompt);

      const companionName = state.config.companionName || 'Lisa';
      return {
        active: true,
        messages: history,
        systemPrompt: [
          state.identityPrompt,
          '# Continuité multimodale explicite',
          `Cette session Cowork est reliée au fil personnel de ${companionName}.`,
          'Les messages antérieurs injectés peuvent provenir de la voix, de Telegram ou d\'une autre session Cowork reliée.',
          'Reprends naturellement le dernier sujet utile sans annoncer un changement de canal. Ne confonds jamais ce fil avec une session Cowork non reliée.',
        ].filter(Boolean).join('\n\n'),
        recordAssistant: (messageId, content) => {
          this.recordTurn(state.bridge, session.id, messageId, 'assistant', content);
        },
      };
    } catch (error) {
      logWarn(
        '[CoworkContinuity] shared companion thread unavailable:',
        error instanceof Error ? error.message : String(error),
      );
      return EMPTY_CONTINUITY;
    }
  }

  private async resolveBridge(): Promise<CachedBridge | null> {
    const [bridgeModule, assistantModule, identityModule] = await Promise.all([
      this.coreLoader<CoreBridgeModule>('conversation/cross-channel-bridge.js'),
      this.coreLoader<CoreAssistantConfigModule>('companion/assistant-config.js'),
      this.coreLoader<CoreCompanionIdentityModule>('identity/companion-identity.js'),
    ]);
    if (!bridgeModule?.CrossChannelConversationBridge || !bridgeModule.resolveCrossChannelBridgeConfig) {
      return null;
    }

    const runtimeEnv = assistantModule?.readAssistantRuntimeEnv?.() ?? {};
    const saved = assistantModule?.readAssistantConfig?.() ?? {};
    const mergedEnv = { ...process.env, ...runtimeEnv, ...saved };
    const config = bridgeModule.resolveCrossChannelBridgeConfig(mergedEnv);
    const fingerprint = configFingerprint(config);
    if (this.cached?.fingerprint === fingerprint) return this.cached;

    this.cached = {
      fingerprint,
      bridge: new bridgeModule.CrossChannelConversationBridge(config, {
        deliver: createCoworkConversationDeliver(mergedEnv),
      }),
      config,
      identityPrompt: identityModule?.LISA_COMPANION_SYSTEM_PROMPT?.trim() ?? '',
    };
    return this.cached;
  }

  private recordTurn(
    bridge: CoreConversationBridge,
    sessionId: string,
    messageId: string,
    role: ConversationRole,
    content: string,
  ): void {
    const normalized = normalizeContent(content);
    if (!normalized) return;
    void bridge
      .recordCoworkTurn({ role, content: normalized }, { sessionId, messageId })
      .catch((error) => logError('[CoworkContinuity] failed to record turn:', error));
  }
}
